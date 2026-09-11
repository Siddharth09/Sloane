import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  initSchema,
  spendVideoCredit,
  refundVideoCredit,
  createVideoPaygoJob,
  setVideoPaygoJobRequestId,
  setVideoPaygoJobModalId,
  failVideoPaygoJob,
} from "@/lib/db";
import { VIDEO_PAYGO_ENGINES, buildFalInput, type VideoEngine } from "@/lib/videoPaygo";
import { submitFalJob, uploadBufferToFal } from "@/lib/fal";
import { submitModalJob } from "@/lib/modal";
import { PRESET_VOICES } from "@/lib/presetVoices";

const MAX_PROMPT_LENGTH = 600;
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

type AudioMode = "none" | "own" | "lucy";

// Pay-as-you-go now accepts an optional reference photo/video-frame and/or
// an optional audio track alongside the text prompt, on any of the five
// engines - see @/lib/videoFrame.ts for the client-side video-frame
// extraction that means this route only ever receives a still image, never
// a raw video file.
//
// Routing, decided per what was actually uploaded (all within the SAME
// price bracket already budgeted in videoPaygo.ts, see its cost-comment
// for the one exception - Kling+audio is actually cheaper, not riskier):
// - Kling + own audio OR a Lucy voice -> Kling Avatar (real lip-sync in
//   one step; requires an image, since Avatar animates a photo to match
//   audio). A Lucy voice needs a TTS pass first (see the phase-0 handling
//   in status/route.ts) so Avatar isn't submitted from THIS route for that
//   case - only the modal TTS job is.
// - Any engine + image, no audio -> that engine's image-to-video endpoint,
//   Veo's own voice/ambient audio baked in (generate_audio: true, Veo only
//   - Seedance/Grok/MiniMax have no native-audio field on their schemas,
//   so they render silent either way).
// - Any engine except Kling + own audio OR a Lucy voice -> silent/ambient
//   generation first, THEN a real lip-sync pass via Kling's dedicated
//   lipsync endpoint (added 2026-09-12 - see submitLipsyncJob in fal.ts;
//   negligible extra cost, ~$0.014-0.03/video). Every engine ends up
//   genuinely lip-synced, not just Kling - it's just a two-step pipeline
//   instead of one. A Lucy voice still needs its TTS pass first, but the
//   video itself can start submitting right away (unlike Kling, its input
//   never depends on the resolved audio) - see needsMerge below and the
//   phase-0/lipsync handling in status/route.ts.
// - Neither image nor audio -> unchanged existing text-to-video behavior.
// buildFalInput itself now lives in @/lib/videoPaygo.ts (shared with
// status/route.ts's phase-0 submission) since route.ts files may only
// export HTTP method handlers.

export async function POST(req: NextRequest) {
  try {
    await initSchema();
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }

    const form = await req.formData();
    const engine = String(form.get("engine") ?? "") as VideoEngine;
    const prompt = String(form.get("prompt") ?? "").trim();
    const referenceImage = form.get("reference_image");
    const referenceAudio = form.get("reference_audio");
    const audioMode = (String(form.get("audio_mode") ?? "none") || "none") as AudioMode;
    const presetVoiceId = String(form.get("preset_voice_id") ?? "");

    if (!VIDEO_PAYGO_ENGINES[engine]) {
      return NextResponse.json({ error: "Unknown engine" }, { status: 400 });
    }
    if (!["none", "own", "lucy"].includes(audioMode)) {
      return NextResponse.json({ error: "Unknown audio option" }, { status: 400 });
    }
    const wantsLucyVoice = audioMode === "lucy";
    if (wantsLucyVoice && !PRESET_VOICES.find((v) => v.id === presetVoiceId)) {
      return NextResponse.json({ error: "Unknown voice choice" }, { status: 400 });
    }
    const hasAudio = audioMode === "own" && referenceAudio instanceof Blob && referenceAudio.size > 0;
    if (audioMode === "own" && !hasAudio) {
      return NextResponse.json({ error: "Add the audio you want on this video" }, { status: 400 });
    }
    const hasImage = referenceImage instanceof Blob && referenceImage.size > 0;
    const useKlingAvatar = engine === "kling" && (hasAudio || wantsLucyVoice);
    // Kling Avatar's own audio already carries every word the video needs -
    // the only case a text prompt can be skipped entirely. A Lucy voice
    // still needs the prompt (it's the TTS script - see phase 0 in
    // status/route.ts), same as every non-Kling path.
    const promptOptional = engine === "kling" && hasAudio;
    if (!prompt && !promptOptional) {
      return NextResponse.json(
        { error: wantsLucyVoice ? "Write what you want the voice to say" : "Describe the video you want" },
        { status: 400 },
      );
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return NextResponse.json({ error: `Prompt is too long (max ${MAX_PROMPT_LENGTH} characters)` }, { status: 400 });
    }
    if ((hasAudio || wantsLucyVoice) && engine === "kling" && !hasImage) {
      return NextResponse.json(
        { error: wantsLucyVoice ? "Kling needs a photo (or video) to lip-sync the voice to" : "Kling needs a photo (or video) to lip-sync your audio to" },
        { status: 400 },
      );
    }
    for (const f of [referenceImage, referenceAudio]) {
      if (f instanceof Blob && f.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: `File too large (max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB)` }, { status: 400 });
      }
    }

    const spent = await spendVideoCredit(user.id);
    if (!spent) {
      return NextResponse.json({ error: "No video credits left - buy more to keep generating" }, { status: 402 });
    }

    let inputImageUrl: string | null = null;
    let inputAudioUrl: string | null = null;
    try {
      if (hasImage) {
        const buf = Buffer.from(await (referenceImage as Blob).arrayBuffer());
        inputImageUrl = await uploadBufferToFal(buf, (referenceImage as Blob).type || "image/jpeg", "reference.jpg");
      }
      if (hasAudio) {
        const buf = Buffer.from(await (referenceAudio as Blob).arrayBuffer());
        inputAudioUrl = await uploadBufferToFal(buf, (referenceAudio as Blob).type || "audio/mpeg", "audio");
      }
    } catch (err) {
      await refundVideoCredit(user.id);
      const message = err instanceof Error ? err.message : "Upload failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }

    const needsMerge = (hasAudio || wantsLucyVoice) && engine !== "kling";
    const falEndpoint = useKlingAvatar
      ? VIDEO_PAYGO_ENGINES.kling.falAvatarEndpoint!
      : hasImage
        ? VIDEO_PAYGO_ENGINES[engine].falImageToVideoEndpoint
        : VIDEO_PAYGO_ENGINES[engine].falEndpoint;

    const jobId = await createVideoPaygoJob({
      userId: user.id,
      engine,
      prompt,
      falEndpoint,
      inputImageUrl,
      inputAudioUrl,
      needsMerge,
      presetVoiceId: wantsLucyVoice ? presetVoiceId : null,
    });

    try {
      if (wantsLucyVoice) {
        // Defer the real video submission to status/route.ts's phase 0,
        // once this TTS pass actually finishes - mirrors
        // generate-cinematic-video/route.ts's lucy_preset handling.
        const { jobId: modalJobId } = await submitModalJob({ action: "generate-preset", text: prompt, voice_id: presetVoiceId });
        await setVideoPaygoJobModalId(jobId, modalJobId);
        return NextResponse.json({ jobId });
      }
      const falInput = useKlingAvatar
        ? { image_url: inputImageUrl, audio_url: inputAudioUrl }
        : buildFalInput(engine, prompt, inputImageUrl, !needsMerge && engine === "veo");
      const requestId = await submitFalJob(falEndpoint, falInput);
      await setVideoPaygoJobRequestId(jobId, requestId);
      return NextResponse.json({ jobId });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Submission failed";
      await failVideoPaygoJob(jobId, message);
      await refundVideoCredit(user.id);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  } catch (err) {
    console.error("video-paygo generate failed", err);
    const message = err instanceof Error ? err.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
