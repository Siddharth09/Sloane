import { NextRequest, NextResponse } from "next/server";
import {
  getSubscriptionVideoJob,
  completeSubscriptionVideoJob,
  failSubscriptionVideoJob,
  setSubscriptionVideoJobRequestId,
  setSubscriptionVideoJobResolvedAudio,
  setSubscriptionVideoJobMergeRequestId,
  incrementUsage,
} from "@/lib/db";
import { getFalJobStatus, getFalJobResult, uploadBufferToFal, submitFalJob, submitMergeAudioVideo, FFMPEG_MERGE_ENDPOINT } from "@/lib/fal";
import { getModalJobStatus } from "@/lib/modal";

const VEO_ENDPOINT = "fal-ai/veo3.1/fast/image-to-video";
const VEO_DURATION = "8s";

// Up to three phases, depending on audio_source (see generate-cinematic-video/route.ts):
// 0. (lucy_preset/lucy_cloned only) wait on the Lucy TTS/clone job, then
//    submit Veo (silent/ambient - generate_audio: false).
// 1. wait on Veo's own clip.
// 2. (own_upload/lucy_preset/lucy_cloned only - i.e. whenever needs_merge)
//    mux the resolved audio onto Veo's finished clip via
//    fal-ai/ffmpeg-api/merge-audio-video, then wait on THAT job.
// engine_native skips both the TTS wait and the merge - Veo's clip IS the
// final result the moment it finishes.
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const job = await getSubscriptionVideoJob(jobId);
  if (!job || job.mode !== "cinematic") {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.status === "completed") {
    return NextResponse.json({ status: "COMPLETED", videoUrl: job.video_url });
  }
  if (job.status === "failed") {
    return NextResponse.json({ status: "FAILED", error: job.error });
  }

  // Phase 0: waiting on Lucy TTS/clone before Veo can even be submitted.
  if (job.modal_job_id && !job.fal_request_id) {
    let modalStatus;
    try {
      modalStatus = await getModalJobStatus(job.modal_job_id.startsWith("modal:") ? job.modal_job_id.slice(6) : job.modal_job_id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Voice generation status check failed";
      await failSubscriptionVideoJob(job.id, message);
      return NextResponse.json({ status: "FAILED", error: message });
    }
    if (modalStatus.status === "FAILED") {
      await failSubscriptionVideoJob(job.id, modalStatus.error ?? "Voice generation failed");
      return NextResponse.json({ status: "FAILED", error: modalStatus.error ?? "Voice generation failed" });
    }
    if (modalStatus.status !== "COMPLETED") {
      return NextResponse.json({ status: "IN_PROGRESS" });
    }
    try {
      const audioBase64 = modalStatus.output?.audio_base64 as string | undefined;
      if (!audioBase64) throw new Error("Voice generation produced no audio");
      const audioUrl = await uploadBufferToFal(Buffer.from(audioBase64, "base64"), "audio/wav", `${job.id}.wav`);
      await setSubscriptionVideoJobResolvedAudio(job.id, audioUrl);
      const requestId = await submitFalJob(VEO_ENDPOINT, {
        prompt: job.prompt,
        image_url: job.reference_image_url,
        duration: VEO_DURATION,
        resolution: "720p",
        generate_audio: false,
      });
      await setSubscriptionVideoJobRequestId(job.id, requestId);
      return NextResponse.json({ status: "IN_PROGRESS" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Scene generation submission failed";
      await failSubscriptionVideoJob(job.id, message);
      return NextResponse.json({ status: "FAILED", error: message });
    }
  }

  if (!job.fal_request_id) {
    return NextResponse.json({ status: "IN_PROGRESS" });
  }

  // Phase 2: merge already submitted - poll the merge job for the final result.
  if (job.merge_request_id) {
    const mergeStatus = await getFalJobStatus(FFMPEG_MERGE_ENDPOINT, job.merge_request_id);
    if (mergeStatus === "COMPLETED") {
      try {
        const result = await getFalJobResult(FFMPEG_MERGE_ENDPOINT, job.merge_request_id);
        const videoUrl = result.video?.url;
        if (!videoUrl) throw new Error("merge result had no video url");
        await completeSubscriptionVideoJob(job.id, videoUrl);
        await incrementUsage(job.access_token, 0, job.credits_cost);
        return NextResponse.json({ status: "COMPLETED", videoUrl });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch merged result";
        await failSubscriptionVideoJob(job.id, message);
        return NextResponse.json({ status: "FAILED", error: message });
      }
    }
    if (mergeStatus === "FAILED") {
      await failSubscriptionVideoJob(job.id, "Combining your audio with the video failed");
      return NextResponse.json({ status: "FAILED", error: "Generation failed" });
    }
    return NextResponse.json({ status: "IN_PROGRESS" });
  }

  // Phase 1: waiting on Veo's own clip.
  const falStatus = await getFalJobStatus(job.fal_endpoint, job.fal_request_id);
  if (falStatus === "FAILED") {
    await failSubscriptionVideoJob(job.id, "Generation failed at the vendor (often a content-policy block)");
    return NextResponse.json({ status: "FAILED", error: "Generation failed" });
  }
  if (falStatus !== "COMPLETED") {
    return NextResponse.json({ status: "IN_PROGRESS" });
  }

  try {
    const result = await getFalJobResult(job.fal_endpoint, job.fal_request_id);
    const veoVideoUrl = result.video?.url;
    if (!veoVideoUrl) throw new Error("fal result had no video url");

    if (!job.needs_merge) {
      // engine_native: Veo's own clip already has the voice baked in.
      await completeSubscriptionVideoJob(job.id, veoVideoUrl);
      await incrementUsage(job.access_token, 0, job.credits_cost);
      return NextResponse.json({ status: "COMPLETED", videoUrl: veoVideoUrl });
    }

    if (!job.resolved_audio_url) throw new Error("No resolved audio to merge onto the video");
    const mergeRequestId = await submitMergeAudioVideo(veoVideoUrl, job.resolved_audio_url);
    await setSubscriptionVideoJobMergeRequestId(job.id, mergeRequestId);
    return NextResponse.json({ status: "IN_PROGRESS" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch result";
    await failSubscriptionVideoJob(job.id, message);
    return NextResponse.json({ status: "FAILED", error: message });
  }
}
