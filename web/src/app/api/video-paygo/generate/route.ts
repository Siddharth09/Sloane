import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { initSchema, spendVideoCredit, refundVideoCredit, createVideoPaygoJob, setVideoPaygoJobRequestId, failVideoPaygoJob } from "@/lib/db";
import { VIDEO_PAYGO_ENGINES, VIDEO_PAYGO_RESOLUTION, type VideoEngine } from "@/lib/videoPaygo";
import { submitFalJob, uploadBufferToFal } from "@/lib/fal";

const MAX_PROMPT_LENGTH = 600;
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

// Pay-as-you-go now accepts an optional reference photo/video-frame and/or
// an optional audio track alongside the text prompt, on any of the five
// engines - see @/lib/videoFrame.ts for the client-side video-frame
// extraction that means this route only ever receives a still image, never
// a raw video file.
//
// Routing, decided per what was actually uploaded (all within the SAME
// price bracket already budgeted in videoPaygo.ts, see its cost-comment
// for the one exception - Kling+audio is actually cheaper, not riskier):
// - Kling + audio given -> Kling Avatar (the only proven lip-sync path;
//   requires an image, since Avatar animates a photo to match audio).
// - Any engine + image, no audio -> that engine's image-to-video endpoint,
//   Veo's own voice/ambient audio baked in (generate_audio: true, Veo only
//   - Seedance/Grok/MiniMax have no native-audio field on their schemas,
//   so they render silent either way).
// - Any engine except Kling + audio given -> silent/ambient generation,
//   then muxed with the given audio afterward (fal ffmpeg
//   merge-audio-video) - a straight audio-track swap, not lip-sync,
//   disclosed as such in the UI. Originally just Veo/Seedance; Grok and
//   MiniMax (added 2026-09-12) have the same no-native-audio schema shape,
//   so they need the same treatment - see needsMerge below.
// - Neither image nor audio -> unchanged existing text-to-video behavior.
function buildFalInput(engine: VideoEngine, prompt: string, imageUrl: string | null, wantsNativeAudio: boolean): Record<string, unknown> {
  const def = VIDEO_PAYGO_ENGINES[engine];
  switch (engine) {
    case "veo":
      return {
        prompt,
        image_url: imageUrl ?? undefined,
        duration: def.falDurationValue,
        resolution: VIDEO_PAYGO_RESOLUTION,
        generate_audio: wantsNativeAudio,
      };
    case "kling":
      return { prompt, duration: def.falDurationValue, image_url: imageUrl ?? undefined };
    case "seedance":
      return { prompt, duration: def.falDurationValue, resolution: VIDEO_PAYGO_RESOLUTION, image_url: imageUrl ?? undefined };
    case "grok":
      // duration is a real integer field on this endpoint's schema (not a
      // string enum like Kling/Veo) - sent as a number, not the string
      // falDurationValue is stored as elsewhere, to match.
      return { prompt, image_url: imageUrl ?? undefined, duration: Number(def.falDurationValue), resolution: def.falResolutionValue ?? VIDEO_PAYGO_RESOLUTION };
    case "minimax":
      // prompt_expansion_mode is required by this endpoint's schema -
      // "balanced" (~1s overhead) rather than "quality" (~30s), same choice
      // made in the real test submission this engine's cost was verified
      // against.
      return {
        prompt,
        image_url: imageUrl ?? undefined,
        duration: Number(def.falDurationValue),
        resolution: def.falResolutionValue ?? VIDEO_PAYGO_RESOLUTION,
        prompt_expansion_mode: "balanced",
      };
  }
}

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

    if (!VIDEO_PAYGO_ENGINES[engine]) {
      return NextResponse.json({ error: "Unknown engine" }, { status: 400 });
    }
    const hasAudio = referenceAudio instanceof Blob && referenceAudio.size > 0;
    const hasImage = referenceImage instanceof Blob && referenceImage.size > 0;
    const useKlingAvatar = hasAudio && engine === "kling";
    if (!prompt && !useKlingAvatar) {
      // Kling Avatar is the only path needing no text prompt (it lip-syncs
      // to the given audio) - every other path (including Veo/Seedance
      // with audio, which render silent then get the audio muxed on
      // afterward) still needs a real scene/subject description, or it'd
      // submit an empty prompt to the vendor and spend a real credit on a
      // generation nobody actually described.
      return NextResponse.json({ error: "Describe the video you want" }, { status: 400 });
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return NextResponse.json({ error: `Prompt is too long (max ${MAX_PROMPT_LENGTH} characters)` }, { status: 400 });
    }
    if (hasAudio && engine === "kling" && !hasImage) {
      return NextResponse.json({ error: "Kling needs a photo (or video) to lip-sync your audio to" }, { status: 400 });
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

    const needsMerge = hasAudio && engine !== "kling";
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
    });

    try {
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
