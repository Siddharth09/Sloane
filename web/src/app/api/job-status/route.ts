import { NextRequest, NextResponse } from "next/server";
import { getJobStatus } from "@/lib/runpod";

// Polled by the client after generate-preset/clone-voice hand back a jobId
// (see web/src/app/page.tsx's handleGenerate). On COMPLETED, the audio comes
// back as base64 straight from RunPod's job output - nothing is written to
// disk here, deliberately: Vercel functions have an ephemeral, per-invocation
// filesystem, so a file written in one request wouldn't exist for a later
// one anyway. The client builds a data: URL from the base64 directly.
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  let result;
  try {
    result = await getJobStatus(jobId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not check job status" },
      { status: 502 },
    );
  }

  if (result.status === "FAILED" || result.status === "CANCELLED" || result.status === "TIMED_OUT") {
    const output = result.output as { error?: string } | undefined;
    return NextResponse.json({
      status: "FAILED",
      error: result.error ?? output?.error ?? `Generation ${result.status.toLowerCase().replace("_", " ")}`,
    });
  }

  if (result.status !== "COMPLETED") {
    return NextResponse.json({ status: result.status });
  }

  const output = result.output as { audio_base64?: string; sample_rate?: number; voice_id?: string; error?: string } | undefined;
  if (!output?.audio_base64) {
    return NextResponse.json({ status: "FAILED", error: output?.error ?? "No audio in job output" });
  }

  return NextResponse.json({
    status: "COMPLETED",
    audioBase64: output.audio_base64,
    sampleRate: output.sample_rate,
    voiceId: output.voice_id,
  });
}
