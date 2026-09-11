import { NextRequest, NextResponse } from "next/server";
import {
  getSubscriptionVideoJob,
  completeSubscriptionVideoJob,
  failSubscriptionVideoJob,
  setSubscriptionVideoJobRequestId,
  setSubscriptionVideoJobResolvedAudio,
  releaseVideoCredits,
} from "@/lib/db";
import { submitFalJob, getFalJobStatus, getFalJobResult, uploadBufferToFal } from "@/lib/fal";
import { getModalJobStatus } from "@/lib/modal";

const KLING_AVATAR_ENDPOINT = "fal-ai/kling-video/ai-avatar/v2/standard";

// Two-phase poll, same shape as generate-character-video/status/route.ts:
// phase 1 waits on the Lucy TTS/clone job (needed as Kling Avatar's audio
// input), phase 2 waits on Kling Avatar itself. No merge phase here - Kling
// Avatar's lip-synced output already IS the final video+audio together.
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  const accessToken = req.nextUrl.searchParams.get("access_token");
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const job = await getSubscriptionVideoJob(jobId);
  // Ownership check - see generate-character-video/status/route.ts for the
  // same fix and why it matters (this route previously had none at all).
  if (!job || job.mode !== "custom" || job.access_token !== accessToken) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.status === "completed") {
    return NextResponse.json({ status: "COMPLETED", videoUrl: job.video_url });
  }
  if (job.status === "failed") {
    return NextResponse.json({ status: "FAILED", error: job.error });
  }

  if (job.modal_job_id && !job.fal_request_id) {
    let modalStatus;
    try {
      modalStatus = await getModalJobStatus(job.modal_job_id.startsWith("modal:") ? job.modal_job_id.slice(6) : job.modal_job_id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Voice generation status check failed";
      if (await failSubscriptionVideoJob(job.id, message)) await releaseVideoCredits(job.access_token, job.credits_cost);
      return NextResponse.json({ status: "FAILED", error: message });
    }

    if (modalStatus.status === "FAILED") {
      if (await failSubscriptionVideoJob(job.id, modalStatus.error ?? "Voice generation failed")) {
        await releaseVideoCredits(job.access_token, job.credits_cost);
      }
      return NextResponse.json({ status: "FAILED", error: modalStatus.error ?? "Voice generation failed" });
    }
    if (modalStatus.status !== "COMPLETED") {
      return NextResponse.json({ status: "IN_PROGRESS" });
    }

    try {
      const audioBase64 = modalStatus.output?.audio_base64 as string | undefined;
      if (!audioBase64) throw new Error("Voice generation produced no audio");
      const audioBuffer = Buffer.from(audioBase64, "base64");
      const audioUrl = await uploadBufferToFal(audioBuffer, "audio/wav", `${job.id}.wav`);
      await setSubscriptionVideoJobResolvedAudio(job.id, audioUrl);
      const requestId = await submitFalJob(KLING_AVATAR_ENDPOINT, {
        image_url: job.reference_image_url,
        audio_url: audioUrl,
      });
      await setSubscriptionVideoJobRequestId(job.id, requestId);
      return NextResponse.json({ status: "IN_PROGRESS" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Lip-sync submission failed";
      if (await failSubscriptionVideoJob(job.id, message)) await releaseVideoCredits(job.access_token, job.credits_cost);
      return NextResponse.json({ status: "FAILED", error: message });
    }
  }

  if (!job.fal_request_id) {
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
      await completeSubscriptionVideoJob(job.id, videoUrl);
      // Usage already recorded atomically at submission time (see
      // reserveVideoCredits in generate-custom-video/route.ts).
      return NextResponse.json({ status: "COMPLETED", videoUrl });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch result";
      if (await failSubscriptionVideoJob(job.id, message)) await releaseVideoCredits(job.access_token, job.credits_cost);
      return NextResponse.json({ status: "FAILED", error: message });
    }
  }
  if (falStatus === "FAILED") {
    if (await failSubscriptionVideoJob(job.id, "Generation failed at the vendor (often a content-policy block)")) {
      await releaseVideoCredits(job.access_token, job.credits_cost);
    }
    return NextResponse.json({ status: "FAILED", error: "Generation failed" });
  }
  return NextResponse.json({ status: "IN_PROGRESS" });
}
