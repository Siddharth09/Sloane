import { NextRequest, NextResponse } from "next/server";
import { getSubscriberByToken, checkQuota, incrementUsage, checkFreeQuota, recordFreeUsage, createPendingGeneration, initSchema } from "@/lib/db";
import { isPodMode, generateViaPod } from "@/lib/inferenceBackend";
import { submitJob } from "@/lib/runpod";
import { getSessionUser } from "@/lib/auth";
import { saveGenerationAudio } from "@/lib/generationHistory";

// RunPod's /run input cap is 10MB - a base64-encoded reference clip much
// past a minute or two of decent-quality audio could exceed that. The UI
// only asks for ~10-20s, but nothing enforced it upstream before either;
// this is a clearer failure than RunPod's own rejection would be. Pod mode
// doesn't have this limit (it's a direct multipart upload, not a RunPod job
// input), but the cap applies uniformly so behavior doesn't change based on
// which backend happens to be active.
const MAX_REFERENCE_AUDIO_BYTES = 7 * 1024 * 1024;

// See generate-preset/route.ts for the pod/serverless dual-backend toggle
// and the try/catch-everything reasoning (avoids a non-JSON error response
// the client can't parse) - same treatment applies here.
export async function POST(req: NextRequest) {
  try {
    await initSchema();
    const form = await req.formData();
    const text = String(form.get("text") ?? "");
    const accessToken = String(form.get("access_token") ?? "");
    const freeTierId = String(form.get("free_tier_id") ?? "");
    const referenceAudio = form.get("reference_audio");

    if (accessToken) {
      const sub = await getSubscriberByToken(accessToken);
      if (!sub) {
        return NextResponse.json({ error: "Access code not recognized" }, { status: 401 });
      }
      const quotaError = checkQuota(sub, text.length);
      if (quotaError) {
        return NextResponse.json({ error: quotaError }, { status: 402 });
      }
    } else {
      const freeError = await checkFreeQuota(freeTierId, text.length);
      if (freeError) {
        return NextResponse.json({ error: freeError }, { status: 402 });
      }
    }

    if (!(referenceAudio instanceof Blob)) {
      return NextResponse.json({ error: "Missing reference_audio" }, { status: 400 });
    }
    if (referenceAudio.size > MAX_REFERENCE_AUDIO_BYTES) {
      return NextResponse.json(
        { error: `Reference audio is too large (max ${Math.round(MAX_REFERENCE_AUDIO_BYTES / 1024 / 1024)}MB) - try a shorter clip.` },
        { status: 400 },
      );
    }
    const exaggeration = form.get("exaggeration");
    const speed = form.get("speed");
    const sessionUser = await getSessionUser();

    let result: { status: "COMPLETED"; audioBase64: string } | { jobId: string };
    if (await isPodMode()) {
      const upstreamForm = new FormData();
      upstreamForm.append("text", text);
      upstreamForm.append("reference_audio", referenceAudio, "reference.wav");
      if (exaggeration) upstreamForm.append("exaggeration", String(exaggeration));
      if (speed) upstreamForm.append("speed", String(speed));
      const { audioBase64 } = await generateViaPod("/api/clone-voice", upstreamForm);
      result = { status: "COMPLETED", audioBase64 };
      if (sessionUser) {
        await saveGenerationAudio({ userId: sessionUser.id, kind: "clone", voiceLabel: null, text, audioBase64 });
      }
    } else {
      const referenceAudioBase64 = Buffer.from(await referenceAudio.arrayBuffer()).toString("base64");
      const { jobId } = await submitJob({
        action: "clone-voice",
        text,
        reference_audio_base64: referenceAudioBase64,
        ...(exaggeration ? { exaggeration: Number(exaggeration) } : {}),
        ...(speed ? { speed: Number(speed) } : {}),
      });
      result = { jobId };
      if (sessionUser) {
        // Best-effort like saveGenerationAudio - a DB hiccup here should
        // cost the user their history entry, not their generation.
        await createPendingGeneration({ jobId, userId: sessionUser.id, kind: "clone", voiceLabel: null, text }).catch(
          (err) => console.error("[clone-voice] failed to record pending generation", err),
        );
      }
    }

    if (accessToken) {
      await incrementUsage(accessToken, text.length, 0);
    } else {
      await recordFreeUsage(freeTierId, text.length);
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Something went wrong - please try again." },
      { status: 502 },
    );
  }
}
