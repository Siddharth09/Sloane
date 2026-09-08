import { NextRequest, NextResponse } from "next/server";
import { getSubscriberByToken, checkQuota, incrementUsage } from "@/lib/db";
import { PLANS } from "@/lib/plans";

const INFERENCE_SERVER_URL = process.env.INFERENCE_SERVER_URL!;

// Proxies to the GPU inference server, but only after checking the caller's
// plan/usage first - the browser never talks to the inference server
// directly, so there's no way to bypass this by just calling that URL
// (its address is a server-only env var, never sent to the client).
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

  const upstreamForm = new FormData();
  upstreamForm.append("text", text);
  upstreamForm.append("voice_id", String(form.get("voice_id") ?? ""));
  const exaggeration = form.get("exaggeration");
  if (exaggeration) upstreamForm.append("exaggeration", String(exaggeration));
  const speed = form.get("speed");
  if (speed) upstreamForm.append("speed", String(speed));

  const upstream = await fetch(`${INFERENCE_SERVER_URL}/api/generate-preset`, {
    method: "POST",
    body: upstreamForm,
  });
  const data = await upstream.json();

  if (upstream.ok && accessToken) {
    await incrementUsage(accessToken, text.length, 0);
  }

  // audio_url comes back as a path relative to the inference server (e.g.
  // "/audio/xyz.wav") - make it absolute here since the client never has
  // INFERENCE_SERVER_URL itself (that env var isn't NEXT_PUBLIC_-prefixed).
  if (data.audio_url) {
    data.audio_url = `${INFERENCE_SERVER_URL}${data.audio_url}`;
  }

  return NextResponse.json(data, { status: upstream.status });
}
