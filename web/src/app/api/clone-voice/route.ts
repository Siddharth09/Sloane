import { NextRequest, NextResponse } from "next/server";
import { getSubscriberByToken, checkQuota, incrementUsage } from "@/lib/db";
import { PLANS } from "@/lib/plans";

const INFERENCE_SERVER_URL = process.env.INFERENCE_SERVER_URL!;

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

  const upstreamForm = new FormData();
  upstreamForm.append("text", text);
  if (referenceAudio) upstreamForm.append("reference_audio", referenceAudio);
  const exaggeration = form.get("exaggeration");
  if (exaggeration) upstreamForm.append("exaggeration", String(exaggeration));
  const speed = form.get("speed");
  if (speed) upstreamForm.append("speed", String(speed));

  const upstream = await fetch(`${INFERENCE_SERVER_URL}/api/clone-voice`, {
    method: "POST",
    body: upstreamForm,
  });
  const data = await upstream.json();

  if (upstream.ok && accessToken) {
    await incrementUsage(accessToken, text.length, 0);
  }

  if (data.audio_url) {
    data.audio_url = `${INFERENCE_SERVER_URL}${data.audio_url}`;
  }

  return NextResponse.json(data, { status: upstream.status });
}
