import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getVideoPaygoJob, completeVideoPaygoJob, failVideoPaygoJob, refundVideoCredit } from "@/lib/db";
import { VIDEO_PAYGO_ENGINES, type VideoEngine } from "@/lib/videoPaygo";
import { getFalJobStatus, getFalJobResult } from "@/lib/fal";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const job = await getVideoPaygoJob(jobId);
  if (!job || job.user_id !== user.id) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // Already resolved from a previous poll - no need to hit fal again.
  if (job.status === "completed") {
    return NextResponse.json({ status: "COMPLETED", videoUrl: job.video_url });
  }
  if (job.status === "failed") {
    return NextResponse.json({ status: "FAILED", error: job.error });
  }
  if (!job.fal_request_id) {
    return NextResponse.json({ status: "IN_PROGRESS" });
  }

  const falEndpoint = VIDEO_PAYGO_ENGINES[job.engine as VideoEngine].falEndpoint;
  const falStatus = await getFalJobStatus(falEndpoint, job.fal_request_id);

  if (falStatus === "COMPLETED") {
    try {
      const result = await getFalJobResult(falEndpoint, job.fal_request_id);
      const videoUrl = result.video?.url;
      if (!videoUrl) throw new Error("fal result had no video url");
      await completeVideoPaygoJob(job.id, videoUrl);
      return NextResponse.json({ status: "COMPLETED", videoUrl });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch result";
      await failVideoPaygoJob(job.id, message);
      await refundVideoCredit(user.id);
      return NextResponse.json({ status: "FAILED", error: message });
    }
  }

  if (falStatus === "FAILED") {
    await failVideoPaygoJob(job.id, "Generation failed at the vendor (often a content-policy block)");
    await refundVideoCredit(user.id);
    return NextResponse.json({ status: "FAILED", error: "Generation failed - your credit has been refunded" });
  }

  return NextResponse.json({ status: "IN_PROGRESS" });
}
