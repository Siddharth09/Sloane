import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getVideoPaygoJob, completeVideoPaygoJob, failVideoPaygoJob, refundVideoCredit, setVideoPaygoJobMergeRequestId } from "@/lib/db";
import { getFalJobStatus, getFalJobResult, submitMergeAudioVideo, FFMPEG_MERGE_ENDPOINT } from "@/lib/fal";

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

  if (job.status === "completed") {
    return NextResponse.json({ status: "COMPLETED", videoUrl: job.video_url });
  }
  if (job.status === "failed") {
    return NextResponse.json({ status: "FAILED", error: job.error });
  }
  if (!job.fal_request_id || !job.fal_endpoint) {
    return NextResponse.json({ status: "IN_PROGRESS" });
  }

  // Merge already submitted (own/cloned audio being muxed onto the video) -
  // poll THAT job for the final result instead of the original generation.
  if (job.merge_request_id) {
    const mergeStatus = await getFalJobStatus(FFMPEG_MERGE_ENDPOINT, job.merge_request_id);
    if (mergeStatus === "COMPLETED") {
      try {
        const result = await getFalJobResult(FFMPEG_MERGE_ENDPOINT, job.merge_request_id);
        const videoUrl = result.video?.url;
        if (!videoUrl) throw new Error("merge result had no video url");
        await completeVideoPaygoJob(job.id, videoUrl);
        return NextResponse.json({ status: "COMPLETED", videoUrl });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch merged result";
        await failVideoPaygoJob(job.id, message);
        await refundVideoCredit(user.id);
        return NextResponse.json({ status: "FAILED", error: message });
      }
    }
    if (mergeStatus === "FAILED") {
      await failVideoPaygoJob(job.id, "Combining your audio with the video failed");
      await refundVideoCredit(user.id);
      return NextResponse.json({ status: "FAILED", error: "Generation failed - your credit has been refunded" });
    }
    return NextResponse.json({ status: "IN_PROGRESS" });
  }

  const falStatus = await getFalJobStatus(job.fal_endpoint, job.fal_request_id);

  if (falStatus === "COMPLETED") {
    try {
      const result = await getFalJobResult(job.fal_endpoint, job.fal_request_id);
      const videoUrl = result.video?.url;
      if (!videoUrl) throw new Error("fal result had no video url");

      if (job.needs_merge && job.input_audio_url) {
        const mergeRequestId = await submitMergeAudioVideo(videoUrl, job.input_audio_url);
        await setVideoPaygoJobMergeRequestId(job.id, mergeRequestId);
        return NextResponse.json({ status: "IN_PROGRESS" });
      }

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
