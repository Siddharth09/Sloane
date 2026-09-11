import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  getVideoPaygoJob,
  completeVideoPaygoJob,
  failVideoPaygoJob,
  refundVideoCredit,
  setVideoPaygoJobMergeRequestId,
  setVideoPaygoJobRequestId,
  setVideoPaygoJobResolvedAudio,
} from "@/lib/db";
import { getFalJobStatus, getFalJobResult, submitMergeAudioVideo, submitFalJob, uploadBufferToFal, FFMPEG_MERGE_ENDPOINT } from "@/lib/fal";
import { getModalJobStatus } from "@/lib/modal";
import { VIDEO_PAYGO_ENGINES, buildFalInput, type VideoEngine } from "@/lib/videoPaygo";

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

  // Phase 0 ("a Lucy voice" only): wait on the Modal TTS job, then submit
  // the real video job now that real audio exists - Kling goes to Avatar
  // (needs the audio_url up front), everything else renders silent (the
  // generic merge phase below picks up the resolved audio once THAT
  // finishes). Mirrors generate-cinematic-video/status/route.ts's phase 0.
  if (job.modal_job_id && !job.fal_request_id) {
    let modalStatus;
    try {
      modalStatus = await getModalJobStatus(job.modal_job_id.startsWith("modal:") ? job.modal_job_id.slice(6) : job.modal_job_id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Voice generation status check failed";
      if (await failVideoPaygoJob(job.id, message)) await refundVideoCredit(user.id);
      return NextResponse.json({ status: "FAILED", error: message });
    }
    if (modalStatus.status === "FAILED") {
      if (await failVideoPaygoJob(job.id, modalStatus.error ?? "Voice generation failed")) await refundVideoCredit(user.id);
      return NextResponse.json({ status: "FAILED", error: modalStatus.error ?? "Voice generation failed" });
    }
    if (modalStatus.status !== "COMPLETED") {
      return NextResponse.json({ status: "IN_PROGRESS" });
    }
    try {
      const audioBase64 = modalStatus.output?.audio_base64 as string | undefined;
      if (!audioBase64) throw new Error("Voice generation produced no audio");
      const audioUrl = await uploadBufferToFal(Buffer.from(audioBase64, "base64"), "audio/wav", `${job.id}.wav`);
      await setVideoPaygoJobResolvedAudio(job.id, audioUrl);
      if (!job.fal_endpoint) throw new Error("Job is missing its target endpoint");
      const isKlingAvatar = job.fal_endpoint === VIDEO_PAYGO_ENGINES.kling.falAvatarEndpoint;
      const requestId = isKlingAvatar
        ? await submitFalJob(job.fal_endpoint, { image_url: job.input_image_url, audio_url: audioUrl })
        : await submitFalJob(job.fal_endpoint, buildFalInput(job.engine as VideoEngine, job.prompt, job.input_image_url, false));
      await setVideoPaygoJobRequestId(job.id, requestId);
      return NextResponse.json({ status: "IN_PROGRESS" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Video submission failed";
      if (await failVideoPaygoJob(job.id, message)) await refundVideoCredit(user.id);
      return NextResponse.json({ status: "FAILED", error: message });
    }
  }

  if (!job.fal_request_id || !job.fal_endpoint) {
    return NextResponse.json({ status: "IN_PROGRESS" });
  }

  // Merge already submitted (own/cloned audio being muxed onto the video) -
  // poll THAT job for the final result instead of the original generation.
  if (job.merge_request_id) {
    let mergeStatus;
    try {
      mergeStatus = await getFalJobStatus(FFMPEG_MERGE_ENDPOINT, job.merge_request_id);
    } catch {
      // Transient error checking status (not a real vendor failure) - try
      // again on the next poll instead of failing the job.
      return NextResponse.json({ status: "IN_PROGRESS" });
    }
    if (mergeStatus === "COMPLETED") {
      try {
        const result = await getFalJobResult(FFMPEG_MERGE_ENDPOINT, job.merge_request_id);
        const videoUrl = result.video?.url;
        if (!videoUrl) throw new Error("merge result had no video url");
        await completeVideoPaygoJob(job.id, videoUrl);
        return NextResponse.json({ status: "COMPLETED", videoUrl });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch merged result";
        // Atomic claim - only refund if THIS call actually transitioned the
        // job to failed, so two overlapping polls can't both refund it.
        if (await failVideoPaygoJob(job.id, message)) await refundVideoCredit(user.id);
        return NextResponse.json({ status: "FAILED", error: message });
      }
    }
    if (mergeStatus === "FAILED") {
      if (await failVideoPaygoJob(job.id, "Combining your audio with the video failed")) {
        await refundVideoCredit(user.id);
      }
      return NextResponse.json({ status: "FAILED", error: "Generation failed - your credit has been refunded" });
    }
    return NextResponse.json({ status: "IN_PROGRESS" });
  }

  let falStatus;
  try {
    falStatus = await getFalJobStatus(job.fal_endpoint, job.fal_request_id);
  } catch {
    return NextResponse.json({ status: "IN_PROGRESS" });
  }

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
      if (await failVideoPaygoJob(job.id, message)) await refundVideoCredit(user.id);
      return NextResponse.json({ status: "FAILED", error: message });
    }
  }

  if (falStatus === "FAILED") {
    if (await failVideoPaygoJob(job.id, "Generation failed at the vendor (often a content-policy block)")) {
      await refundVideoCredit(user.id);
    }
    return NextResponse.json({ status: "FAILED", error: "Generation failed - your credit has been refunded" });
  }

  return NextResponse.json({ status: "IN_PROGRESS" });
}
