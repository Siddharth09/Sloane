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
import { getFalJobStatus, getFalJobResult, submitLipsyncJob, submitFalJob, uploadBufferToFal, LIPSYNC_ENDPOINT } from "@/lib/fal";
import { getModalJobStatus } from "@/lib/modal";
import { VIDEO_PAYGO_ENGINES, buildFalInput, type VideoEngine } from "@/lib/videoPaygo";
import { probeAudioDurationSeconds, padWavToMinDuration, LIPSYNC_MIN_AUDIO_SECONDS } from "@/lib/audioDuration";

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
  // (needs the audio_url up front, real lip-sync from the same step),
  // everything else renders silent (the lipsync phase below runs a real
  // lip-sync pass once THAT finishes). Mirrors
  // generate-cinematic-video/status/route.ts's phase 0.
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
      // Pad up to the real, confirmed 2-second floor before this audio ever
      // reaches Kling (Avatar or the standalone lipsync pass both take real
      // audio input) - fixes for every Lucy-voice line in production the
      // exact bug hit for real on Harper's "I'm on a yoga mat" line during
      // testing (1.05s, rejected). Real (possibly now-padded) duration is
      // also what shrinks the silent video generation to match on the
      // non-Kling engines below - see videoPaygo.ts's buildFalInput.
      const rawAudio = Buffer.from(audioBase64, "base64");
      const paddedAudio = padWavToMinDuration(rawAudio, LIPSYNC_MIN_AUDIO_SECONDS);
      const resolvedAudioSeconds = await probeAudioDurationSeconds(paddedAudio, "audio/wav");
      const audioUrl = await uploadBufferToFal(paddedAudio, "audio/wav", `${job.id}.wav`);
      await setVideoPaygoJobResolvedAudio(job.id, audioUrl);
      if (!job.fal_endpoint) throw new Error("Job is missing its target endpoint");
      const isKlingAvatar = job.fal_endpoint === VIDEO_PAYGO_ENGINES.kling.falAvatarEndpoint;
      const requestId = isKlingAvatar
        ? await submitFalJob(job.fal_endpoint, { image_url: job.input_image_url, audio_url: audioUrl })
        : await submitFalJob(job.fal_endpoint, buildFalInput(job.engine as VideoEngine, job.prompt, job.input_image_url, false, resolvedAudioSeconds));
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

  // Lip-sync pass already submitted (real lip-sync via Kling's dedicated
  // lipsync endpoint, not the plain audio-track swap Cinematic/Custom still
  // use - see submitLipsyncJob's comment in fal.ts) - poll THAT job for the
  // final result instead of the original silent generation. The DB column
  // is still named merge_request_id (no schema change needed - same
  // one-extra-fal-job-after-the-video shape either way).
  if (job.merge_request_id) {
    let mergeStatus;
    try {
      mergeStatus = await getFalJobStatus(LIPSYNC_ENDPOINT, job.merge_request_id);
    } catch {
      // Transient error checking status (not a real vendor failure) - try
      // again on the next poll instead of failing the job.
      return NextResponse.json({ status: "IN_PROGRESS" });
    }
    if (mergeStatus === "COMPLETED") {
      try {
        const result = await getFalJobResult(LIPSYNC_ENDPOINT, job.merge_request_id);
        const videoUrl = result.video?.url;
        if (!videoUrl) throw new Error("lip-sync result had no video url");
        await completeVideoPaygoJob(job.id, videoUrl);
        return NextResponse.json({ status: "COMPLETED", videoUrl });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch lip-synced result";
        // Atomic claim - only refund if THIS call actually transitioned the
        // job to failed, so two overlapping polls can't both refund it.
        if (await failVideoPaygoJob(job.id, message)) await refundVideoCredit(user.id);
        return NextResponse.json({ status: "FAILED", error: message });
      }
    }
    if (mergeStatus === "FAILED") {
      if (await failVideoPaygoJob(job.id, "Lip-syncing your audio to the video failed")) {
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
        const lipsyncRequestId = await submitLipsyncJob(videoUrl, job.input_audio_url);
        await setVideoPaygoJobMergeRequestId(job.id, lipsyncRequestId);
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
