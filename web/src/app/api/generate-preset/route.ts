import { NextRequest, NextResponse } from "next/server";
import { getSubscriberByToken, checkQuota, incrementUsage, checkFreeQuota, recordFreeUsage, createPendingGeneration, initSchema } from "@/lib/db";
import { submitJob } from "@/lib/runpod";
import { isPodMode, generateViaPod } from "@/lib/inferenceBackend";
import { getSessionUser } from "@/lib/auth";
import { saveGenerationAudio } from "@/lib/generationHistory";

// Checks the caller's plan/usage first, then generates via whichever
// backend INFERENCE_BACKEND selects - the browser never talks to RunPod or
// the Pod directly either way (see @/lib/inferenceBackend for the toggle).
//
// Serverless mode submits a job and returns a jobId immediately - a cold
// start plus generation can take well past Vercel's function timeout, so
// the client polls /api/job-status until it completes (see
// web/src/app/page.tsx's handleGenerate). Pod mode is always-on and fast
// enough to just block and return the finished audio directly, no polling
// needed - the client's hook handles both response shapes.
//
// Usage is credited on submission/completion of this request, not any
// later poll - a job failing after this point (rare) is a cost we eat
// rather than a billing/quota discrepancy we'd need to reconcile after.
export async function POST(req: NextRequest) {
  // Whole body wrapped in try/catch, including the quota checks below - an
  // uncaught throw here (a transient DB blip, etc.) used to fall through to
  // Vercel's default plain-text error page instead of JSON, which the
  // client's `res.json()` then failed to parse ("Unexpected token 'I',
  // "Internal S"... is not valid JSON" - reported live 2026-09-09).
  try {
    await initSchema();
    const form = await req.formData();
    const text = String(form.get("text") ?? "");
    const accessToken = String(form.get("access_token") ?? "");
    const freeTierId = String(form.get("free_tier_id") ?? "");

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

    const voiceId = String(form.get("voice_id") ?? "");
    const exaggeration = form.get("exaggeration");
    const speed = form.get("speed");
    const sessionUser = await getSessionUser();

    let result: { status: "COMPLETED"; audioBase64: string; voiceId: string } | { jobId: string };
    if (await isPodMode()) {
      const upstreamForm = new FormData();
      upstreamForm.append("text", text);
      upstreamForm.append("voice_id", voiceId);
      if (exaggeration) upstreamForm.append("exaggeration", String(exaggeration));
      if (speed) upstreamForm.append("speed", String(speed));
      const { audioBase64 } = await generateViaPod("/api/generate-preset", upstreamForm);
      result = { status: "COMPLETED", audioBase64, voiceId };
      if (sessionUser) {
        await saveGenerationAudio({ userId: sessionUser.id, kind: "preset", voiceLabel: voiceId, text, audioBase64 });
      }
    } else {
      const { jobId } = await submitJob({
        action: "generate-preset",
        text,
        voice_id: voiceId,
        ...(exaggeration ? { exaggeration: Number(exaggeration) } : {}),
        ...(speed ? { speed: Number(speed) } : {}),
      });
      result = { jobId };
      if (sessionUser) {
        // Best-effort like saveGenerationAudio below - a DB hiccup here
        // should cost the user their history entry, not their generation.
        await createPendingGeneration({ jobId, userId: sessionUser.id, kind: "preset", voiceLabel: voiceId, text }).catch(
          (err) => console.error("[generate-preset] failed to record pending generation", err),
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
