import { NextRequest, NextResponse } from "next/server";
import {
  getCharacterVideoJob,
  completeCharacterVideoJob,
  failCharacterVideoJob,
  setCharacterVideoJobRequestId,
  incrementUsage,
} from "@/lib/db";
import { getCharacter } from "@/lib/characters";
import { submitFalJob, getFalJobStatus, getFalJobResult, uploadBufferToFal } from "@/lib/fal";
import { getModalJobStatus } from "@/lib/modal";

const KLING_AVATAR_ENDPOINT = "fal-ai/kling-video/ai-avatar/v2/standard";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const job = await getCharacterVideoJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.status === "completed") {
    return NextResponse.json({ status: "COMPLETED", videoUrl: job.video_url });
  }
  if (job.status === "failed") {
    return NextResponse.json({ status: "FAILED", error: job.error });
  }

  // Phase 1 (Lucy-voice only): still waiting on the TTS generation before
  // Kling Avatar can even be submitted (needs the finished audio as input).
  if (job.modal_job_id && !job.fal_request_id) {
    let modalStatus;
    try {
      modalStatus = await getModalJobStatus(job.modal_job_id.startsWith("modal:") ? job.modal_job_id.slice(6) : job.modal_job_id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "TTS status check failed";
      await failCharacterVideoJob(job.id, message);
      return NextResponse.json({ status: "FAILED", error: message });
    }

    if (modalStatus.status === "FAILED") {
      await failCharacterVideoJob(job.id, modalStatus.error ?? "Voice generation failed");
      return NextResponse.json({ status: "FAILED", error: modalStatus.error ?? "Voice generation failed" });
    }
    if (modalStatus.status !== "COMPLETED") {
      return NextResponse.json({ status: "IN_PROGRESS" });
    }

    // TTS done - upload the audio to fal storage, then submit Kling Avatar.
    try {
      const audioBase64 = modalStatus.output?.audio_base64 as string | undefined;
      if (!audioBase64) throw new Error("Voice generation produced no audio");
      const character = getCharacter(job.character_id);
      if (!character) throw new Error("Unknown character");
      const audioBuffer = Buffer.from(audioBase64, "base64");
      const audioUrl = await uploadBufferToFal(audioBuffer, "audio/wav", `${job.id}.wav`);
      const requestId = await submitFalJob(KLING_AVATAR_ENDPOINT, {
        image_url: character.imageUrl,
        audio_url: audioUrl,
      });
      await setCharacterVideoJobRequestId(job.id, requestId);
      return NextResponse.json({ status: "IN_PROGRESS" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Lip-sync submission failed";
      await failCharacterVideoJob(job.id, message);
      return NextResponse.json({ status: "FAILED", error: message });
    }
  }

  // Phase 2 (both voice paths converge here): poll fal for the actual video.
  if (!job.fal_request_id) {
    return NextResponse.json({ status: "IN_PROGRESS" });
  }

  const falStatus = await getFalJobStatus(job.fal_endpoint, job.fal_request_id);
  if (falStatus === "COMPLETED") {
    try {
      const result = await getFalJobResult(job.fal_endpoint, job.fal_request_id);
      const videoUrl = result.video?.url;
      if (!videoUrl) throw new Error("fal result had no video url");
      await completeCharacterVideoJob(job.id, videoUrl);
      // video_seconds_used doubles as "video credits used" (see plans.ts -
      // 1 credit = 1s talking-head) - incrementUsage's videoSeconds param
      // is exactly this same unit, 0 characters since no audio quota is
      // touched by this feature.
      await incrementUsage(job.access_token, 0, job.credits_cost);
      return NextResponse.json({ status: "COMPLETED", videoUrl });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch result";
      await failCharacterVideoJob(job.id, message);
      return NextResponse.json({ status: "FAILED", error: message });
    }
  }
  if (falStatus === "FAILED") {
    await failCharacterVideoJob(job.id, "Generation failed at the vendor (often a content-policy block)");
    return NextResponse.json({ status: "FAILED", error: "Generation failed" });
  }
  return NextResponse.json({ status: "IN_PROGRESS" });
}
