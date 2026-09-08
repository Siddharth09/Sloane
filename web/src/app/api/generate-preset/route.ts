import { NextRequest, NextResponse } from "next/server";
import { getSubscriberByToken, checkQuota, incrementUsage } from "@/lib/db";
import { PLANS } from "@/lib/plans";
import { submitJob } from "@/lib/runpod";
import { isPodMode, generateViaPod } from "@/lib/inferenceBackend";

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
  const form = await req.formData();
  const text = String(form.get("text") ?? "");
  const accessToken = String(form.get("access_token") ?? "");

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
    // No access code = free tier. We don't yet track anonymous usage across
    // requests (would need a device/IP identity, deliberately not built
    // yet - see PROJECT_CONTEXT.md "Pricing"), so this per-request check is
    // a soft limit: it stops any single generation from exceeding the free
    // monthly allowance outright, not cumulative usage across many requests.
    return NextResponse.json(
      { error: `Free tier is limited to ${PLANS.free.charactersPerMonth.toLocaleString()} characters per request. Sign up for a plan for more.` },
      { status: 402 },
    );
  }

  const voiceId = String(form.get("voice_id") ?? "");
  const exaggeration = form.get("exaggeration");
  const speed = form.get("speed");

  try {
    if (isPodMode()) {
      const upstreamForm = new FormData();
      upstreamForm.append("text", text);
      upstreamForm.append("voice_id", voiceId);
      if (exaggeration) upstreamForm.append("exaggeration", String(exaggeration));
      if (speed) upstreamForm.append("speed", String(speed));
      const { audioBase64 } = await generateViaPod("/api/generate-preset", upstreamForm);
      if (accessToken) await incrementUsage(accessToken, text.length, 0);
      return NextResponse.json({ status: "COMPLETED", audioBase64, voiceId });
    }

    const { jobId } = await submitJob({
      action: "generate-preset",
      text,
      voice_id: voiceId,
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
