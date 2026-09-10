import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { initSchema, spendVideoCredit, refundVideoCredit, createVideoPaygoJob, setVideoPaygoJobRequestId, failVideoPaygoJob } from "@/lib/db";
import { VIDEO_PAYGO_ENGINES, VIDEO_PAYGO_RESOLUTION, type VideoEngine } from "@/lib/videoPaygo";
import { submitFalJob } from "@/lib/fal";

const MAX_PROMPT_LENGTH = 600;

function buildFalInput(engine: VideoEngine, prompt: string): Record<string, unknown> {
  const def = VIDEO_PAYGO_ENGINES[engine];
  switch (engine) {
    case "veo":
      return {
        prompt,
        duration: def.falDurationValue,
        resolution: VIDEO_PAYGO_RESOLUTION,
        generate_audio: true,
      };
    case "kling":
      return {
        prompt,
        duration: def.falDurationValue,
      };
    case "seedance":
      return {
        prompt,
        duration: def.falDurationValue,
        resolution: VIDEO_PAYGO_RESOLUTION,
      };
  }
}

// Pay-as-you-go video generation: spend one credit, submit to whichever
// engine the user picked, return our own job id immediately (client polls
// /api/video-paygo/status, same async pattern as audio generation). Credit
// is spent BEFORE submission (not after success) so a user can't double-
// submit while a slow fal job is still pending on the same credit - if
// submission itself fails outright, the credit is refunded immediately
// below rather than left in limbo.
export async function POST(req: NextRequest) {
  try {
    await initSchema();
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }

    const body = await req.json();
    const engine = body.engine as VideoEngine;
    const prompt = String(body.prompt ?? "").trim();

    if (!VIDEO_PAYGO_ENGINES[engine]) {
      return NextResponse.json({ error: "Unknown engine" }, { status: 400 });
    }
    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return NextResponse.json({ error: `Prompt is too long (max ${MAX_PROMPT_LENGTH} characters)` }, { status: 400 });
    }

    const spent = await spendVideoCredit(user.id);
    if (!spent) {
      return NextResponse.json({ error: "No video credits left - buy more to keep generating" }, { status: 402 });
    }

    const jobId = await createVideoPaygoJob({ userId: user.id, engine, prompt });
    try {
      const falEndpoint = VIDEO_PAYGO_ENGINES[engine].falEndpoint;
      const requestId = await submitFalJob(falEndpoint, buildFalInput(engine, prompt));
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
