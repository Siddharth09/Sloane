import { NextRequest, NextResponse } from "next/server";
import { getSubscriberByToken, checkQuota, incrementUsage } from "@/lib/db";
import { PLANS } from "@/lib/plans";
import { submitJob } from "@/lib/runpod";

// Submits a RunPod Serverless job and returns immediately with a jobId,
// after checking the caller's plan/usage first - the browser never talks to
// RunPod directly, so there's no way to bypass this (RUNPOD_API_KEY/
// RUNPOD_ENDPOINT_ID are server-only env vars, never sent to the client).
//
// This used to be a single blocking fetch straight to an always-on GPU Pod.
// Now that generation runs on a scale-to-zero Serverless endpoint, a cold
// start plus generation can take well past Vercel's function timeout, so
// the client submits here then polls /api/job-status until the job
// completes - see web/src/app/page.tsx's handleGenerate for the poll loop,
// and STATUS.md "Serverless migration" for why.
//
// Usage is credited on submission, not completion - a job failing after
// this point (rare) is a cost we eat rather than a billing/quota
// discrepancy we'd need to reconcile after the fact.
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

  const exaggeration = form.get("exaggeration");
  const speed = form.get("speed");

  let jobId: string;
  try {
    ({ jobId } = await submitJob({
      action: "generate-preset",
      text,
      voice_id: String(form.get("voice_id") ?? ""),
      ...(exaggeration ? { exaggeration: Number(exaggeration) } : {}),
      ...(speed ? { speed: Number(speed) } : {}),
    }));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not start generation" },
      { status: 502 },
    );
  }

  if (accessToken) {
    await incrementUsage(accessToken, text.length, 0);
  }

  return NextResponse.json({ jobId });
}
