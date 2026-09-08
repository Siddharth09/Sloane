import { NextRequest, NextResponse } from "next/server";
import { getSubscriberByToken, checkQuota, incrementUsage } from "@/lib/db";
import { PLANS } from "@/lib/plans";
import { submitJob } from "@/lib/runpod";
import { isPodMode, generateViaPod } from "@/lib/inferenceBackend";

// RunPod's /run input cap is 10MB - a base64-encoded reference clip much
// past a minute or two of decent-quality audio could exceed that. The UI
// only asks for ~10-20s, but nothing enforced it upstream before either;
// this is a clearer failure than RunPod's own rejection would be. Pod mode
// doesn't have this limit (it's a direct multipart upload, not a RunPod job
// input), but the cap applies uniformly so behavior doesn't change based on
// which backend happens to be active.
const MAX_REFERENCE_AUDIO_BYTES = 7 * 1024 * 1024;

// See generate-preset/route.ts for the pod/serverless dual-backend toggle -
// same reasoning applies here.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const text = String(form.get("text") ?? "");
  const accessToken = String(form.get("access_token") ?? "");
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
  } else if (text.length > PLANS.free.charactersPerMonth) {
    return NextResponse.json(
      { error: `Free tier is limited to ${PLANS.free.charactersPerMonth.toLocaleString()} characters per request. Sign up for a plan for more.` },
      { status: 402 },
    );
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

  try {
    if (await isPodMode()) {
      const upstreamForm = new FormData();
      upstreamForm.append("text", text);
      upstreamForm.append("reference_audio", referenceAudio, "reference.wav");
      if (exaggeration) upstreamForm.append("exaggeration", String(exaggeration));
      if (speed) upstreamForm.append("speed", String(speed));
      const { audioBase64 } = await generateViaPod("/api/clone-voice", upstreamForm);
      if (accessToken) await incrementUsage(accessToken, text.length, 0);
      return NextResponse.json({ status: "COMPLETED", audioBase64 });
    }

    const referenceAudioBase64 = Buffer.from(await referenceAudio.arrayBuffer()).toString("base64");
    const { jobId } = await submitJob({
      action: "clone-voice",
      text,
      reference_audio_base64: referenceAudioBase64,
      ...(exaggeration ? { exaggeration: Number(exaggeration) } : {}),
      ...(speed ? { speed: Number(speed) } : {}),
    });
    if (accessToken) await incrementUsage(accessToken, text.length, 0);
    return NextResponse.json({ jobId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not start generation" },
      { status: 502 },
    );
  }
}
