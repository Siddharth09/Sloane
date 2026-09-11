import { NextRequest, NextResponse } from "next/server";
import {
  initSchema,
  getSubscriberByToken,
  checkVideoCreditQuota,
  reserveVideoCredits,
  releaseVideoCredits,
  createSubscriptionVideoJob,
  setSubscriptionVideoJobModalId,
  setSubscriptionVideoJobRequestId,
  setSubscriptionVideoJobResolvedAudio,
  failSubscriptionVideoJob,
  type SubscriptionVideoAudioSource,
} from "@/lib/db";
import { PRESET_VOICES } from "@/components/VoicePicker";
import { submitModalJob } from "@/lib/modal";
import { submitFalJob, uploadBufferToFal } from "@/lib/fal";
import { VIDEO_CREDIT_COSTS, PLANS } from "@/lib/plans";

const MAX_PROMPT_LENGTH = 600;
const MAX_REFERENCE_AUDIO_BYTES = 7 * 1024 * 1024;
const VEO_ENDPOINT = "fal-ai/veo3.1/fast/image-to-video";
const VEO_DURATION = "8s";

// 8s clip / (1/3 s per credit) = 24 credits - same rate already reserved
// for cinematic in plans.ts/characters.ts (the removed Veo-voice character
// option would have cost the same).
const CINEMATIC_CREDIT_COST = Math.round(8 / VIDEO_CREDIT_COSTS.cinematicSecondsPerCredit);

// Mode 2: "Cinematic" - the user's own photo (or a video frame) drives a
// Veo-generated scene from a text prompt. Audio is one of three sources:
// - "engine_native": Veo generates its own voice/dialogue baked into the
//   clip (generate_audio: true) - most reliable lip-timing, Veo's own voice.
// - "own_upload" / lucy voices: Veo generates the scene WITHOUT dialogue
//   (ambient/silent), then the user's audio (or a Lucy TTS/clone result) is
//   muxed on afterward via fal's ffmpeg merge-audio-video utility - this is
//   a straight audio-track replacement, NOT lip-sync (Kling Avatar is the
//   only proven lip-sync path in this stack, and it needs a static photo,
//   not an already-generated Veo scene) - disclosed as such in the UI.
export async function POST(req: NextRequest) {
  try {
    await initSchema();
    const form = await req.formData();
    const accessToken = String(form.get("access_token") ?? "");
    const prompt = String(form.get("prompt") ?? "").trim();
    const audioSource = String(form.get("audio_source") ?? "") as SubscriptionVideoAudioSource;
    const presetVoiceId = String(form.get("preset_voice_id") ?? "");
    const referenceImage = form.get("reference_image");
    const referenceAudio = form.get("reference_audio");

    if (!accessToken) {
      return NextResponse.json({ error: "Sign in with your access code to use this" }, { status: 401 });
    }
    const sub = await getSubscriberByToken(accessToken);
    if (!sub) {
      return NextResponse.json({ error: "Access code not recognized" }, { status: 401 });
    }
    if (!prompt) {
      return NextResponse.json({ error: "Describe the scene" }, { status: 400 });
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return NextResponse.json({ error: `Prompt is too long (max ${MAX_PROMPT_LENGTH} characters)` }, { status: 400 });
    }
    if (!(referenceImage instanceof Blob)) {
      return NextResponse.json({ error: "A photo (or video, we'll grab a frame) is required" }, { status: 400 });
    }
    if (!["engine_native", "own_upload", "lucy_preset", "lucy_cloned"].includes(audioSource)) {
      return NextResponse.json({ error: "Unknown audio source" }, { status: 400 });
    }
    if (audioSource === "lucy_preset" && !PRESET_VOICES.find((v) => v.id === presetVoiceId)) {
      return NextResponse.json({ error: "Unknown voice choice" }, { status: 400 });
    }
    if ((audioSource === "own_upload" || audioSource === "lucy_cloned") && !(referenceAudio instanceof Blob)) {
      return NextResponse.json(
        { error: audioSource === "own_upload" ? "Upload the audio you want on this video" : "A short audio sample of your voice is required" },
        { status: 400 },
      );
    }
    if (referenceAudio instanceof Blob && referenceAudio.size > MAX_REFERENCE_AUDIO_BYTES) {
      return NextResponse.json(
        { error: `Audio is too large (max ${Math.round(MAX_REFERENCE_AUDIO_BYTES / 1024 / 1024)}MB)` },
        { status: 400 },
      );
    }

    // checkVideoCreditQuota is a fast, friendly pre-check; reserveVideoCredits
    // is the real atomic enforcement (see its comment in db.ts).
    const quotaError = checkVideoCreditQuota(sub, CINEMATIC_CREDIT_COST);
    if (quotaError) {
      return NextResponse.json({ error: quotaError }, { status: 402 });
    }
    const reserved = await reserveVideoCredits(accessToken, CINEMATIC_CREDIT_COST, PLANS[sub.plan].videoCreditsPerMonth);
    if (!reserved) {
      return NextResponse.json({ error: quotaError ?? "Not enough video credits left this billing period" }, { status: 402 });
    }

    let referenceImageUrl: string;
    try {
      const imageBuffer = Buffer.from(await referenceImage.arrayBuffer());
      referenceImageUrl = await uploadBufferToFal(imageBuffer, referenceImage.type || "image/jpeg", "reference.jpg");
    } catch (err) {
      await releaseVideoCredits(accessToken, CINEMATIC_CREDIT_COST);
      const message = err instanceof Error ? err.message : "Upload failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }
    const needsMerge = audioSource !== "engine_native";

    const jobId = await createSubscriptionVideoJob({
      accessToken,
      mode: "cinematic",
      referenceImageUrl,
      prompt,
      audioSource,
      presetVoiceId: audioSource === "lucy_preset" ? presetVoiceId : null,
      creditsCost: CINEMATIC_CREDIT_COST,
      falEndpoint: VEO_ENDPOINT,
      needsMerge,
    });

    try {
      if (audioSource === "lucy_preset" || audioSource === "lucy_cloned") {
        // Needs a Lucy TTS/clone pass first - Veo isn't submitted until the
        // status route sees that finish (see its "phase 0").
        const { jobId: modalJobId } =
          audioSource === "lucy_cloned"
            ? await submitModalJob({
                action: "clone-voice",
                text: prompt,
                reference_audio_base64: Buffer.from(await (referenceAudio as Blob).arrayBuffer()).toString("base64"),
              })
            : await submitModalJob({ action: "generate-preset", text: prompt, voice_id: presetVoiceId });
        await setSubscriptionVideoJobModalId(jobId, modalJobId);
        return NextResponse.json({ jobId });
      }

      // engine_native or own_upload: Veo can start generating right away -
      // no TTS to wait on. own_upload's audio is uploaded to fal now so
      // it's ready the moment Veo's clip finishes (see status route).
      if (audioSource === "own_upload") {
        const audioBuffer = Buffer.from(await (referenceAudio as Blob).arrayBuffer());
        const audioUrl = await uploadBufferToFal(audioBuffer, (referenceAudio as Blob).type || "audio/mpeg", "soundtrack");
        await setSubscriptionVideoJobResolvedAudio(jobId, audioUrl);
      }
      const requestId = await submitFalJob(VEO_ENDPOINT, {
        prompt,
        image_url: referenceImageUrl,
        duration: VEO_DURATION,
        resolution: "720p",
        generate_audio: audioSource === "engine_native",
      });
      await setSubscriptionVideoJobRequestId(jobId, requestId);
      return NextResponse.json({ jobId });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Submission failed";
      await failSubscriptionVideoJob(jobId, message);
      await releaseVideoCredits(accessToken, CINEMATIC_CREDIT_COST);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  } catch (err) {
    console.error("generate-cinematic-video failed", err);
    const message = err instanceof Error ? err.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
