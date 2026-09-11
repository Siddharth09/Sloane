// Thin wrapper around fal.ai's REST queue API - submit a job, poll its
// status, fetch its result once done. Server-side only (uses FAL_KEY,
// never exposed to the client) - the video-generation scripts elsewhere in
// this repo use the Python fal_client SDK instead since they run outside
// Next.js; this is the equivalent for API routes.

const FAL_BASE = "https://queue.fal.run";

function falHeaders() {
  return {
    Authorization: `Key ${process.env.FAL_KEY}`,
    "Content-Type": "application/json",
  };
}

export async function submitFalJob(endpoint: string, input: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${FAL_BASE}/${endpoint}`, {
    method: "POST",
    headers: falHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`fal submit failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.request_id as string;
}

export type FalJobStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

// fal's status/result queue routes live at the base org/app id (first two
// path segments), NOT the full submission endpoint path, whenever that path
// has extra segments beyond the app id. This is NOT a kling-video-specific
// quirk (originally thought so) - verified empirically 2026-09-11 across
// THREE separate fal apps, all 405ing on the full path and succeeding on
// the base app id: `fal-ai/kling-video/ai-avatar/v2/standard`,
// `fal-ai/flux-pro/v1.1-ultra`, and `fal-ai/veo3.1/fast`. Every one of them
// exposes multiple model-variant sub-paths for submission but registers
// its queue status/result backend once, at the base app - so this is a
// general fal.ai deployment pattern, not an exception. Without this, every
// live generation through any endpoint with a sub-path (Kling Avatar +
// Veo cinematic/paygo, both used in production) would throw on every
// status poll and hang in "IN_PROGRESS" forever.
function pollingEndpoint(submitEndpoint: string): string {
  const parts = submitEndpoint.split("/");
  return parts.length > 2 ? parts.slice(0, 2).join("/") : submitEndpoint;
}

// Real bug fixed here: this used to return "FAILED" on ANY non-2xx HTTP
// response from fal's own status endpoint - indistinguishable from fal
// genuinely reporting the underlying generation as failed. Every caller
// treats "FAILED" the same way: mark the job failed and refund the user's
// credit. A transient blip on fal's side (a 500/429 while the real Kling/
// Veo job is still running or has already succeeded) would falsely refund
// a credit for a video that either doesn't exist yet or does exist and
// just got orphaned (no fal_request_id follow-up ever recorded it) -
// costing real fal money for nothing while also giving the credit back for
// free. Now throws on a non-2xx response instead, so callers can retry on
// the next poll rather than treating "we couldn't check" as "it failed."
export async function getFalJobStatus(endpoint: string, requestId: string): Promise<FalJobStatus> {
  const res = await fetch(`${FAL_BASE}/${pollingEndpoint(endpoint)}/requests/${requestId}/status`, {
    headers: falHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`fal status check failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.status as FalJobStatus) ?? "IN_PROGRESS";
}

// Result shape differs slightly per engine (all three so far return
// {video: {url}}), so this stays loosely typed and callers pull `.video.url`.
export async function getFalJobResult(endpoint: string, requestId: string): Promise<{ video?: { url: string } }> {
  const res = await fetch(`${FAL_BASE}/${pollingEndpoint(endpoint)}/requests/${requestId}`, {
    headers: falHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`fal result fetch failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

// Two-step upload to fal's own storage (verified working 2026-09-11 against
// the real REST API - the "storage_type=gcs" query param some docs mention
// returns "Invalid storage type" on this account; omit it entirely).
// Needed for the character-video Lucy-voice path: Kling Avatar's audio_url
// input needs a real hosted URL, and generated TTS audio only exists as
// in-memory bytes until uploaded somewhere fal can fetch it from.
// Merges a generated (often silent/ambient) video with a separate audio
// track - used by Cinematic/Custom mode when the user supplies their own
// audio or a Lucy voice instead of the engine's own native voice. This is
// NOT lip-sync - it's a straight audio-track replacement, disclosed as such
// in the UI. Pay-as-you-go used this same endpoint until 2026-09-12, when it
// switched to real lip-sync via submitLipsyncJob below instead (see that
// function's comment) - kept here only for Cinematic/Custom, still real code.
export const FFMPEG_MERGE_ENDPOINT = "fal-ai/ffmpeg-api/merge-audio-video";

export async function submitMergeAudioVideo(videoUrl: string, audioUrl: string): Promise<string> {
  return submitFalJob(FFMPEG_MERGE_ENDPOINT, { video_url: videoUrl, audio_url: audioUrl });
}

// Real lip-sync (2026-09-12) - takes ANY existing video + a separate audio
// track and re-animates the mouth to match, regardless of which engine
// rendered the video. This is what makes real lip-sync possible on engines
// that can't do it themselves (Veo/Seedance/Grok/MiniMax all render
// silent/ambient only - none of their schemas have an audio-conditioning
// input). Found and verified 2026-09-12 while investigating "how do we lip
// sync a Grok video" for pay-as-you-go: `fal-ai/kling-video/lipsync/
// audio-to-video` costs **$0.014 per 5s (rounded up)** - negligible next to
// the $0.64-2.23 real cost of the video generation itself, comfortably
// inside the existing 15% buffer in videoPaygo.ts with no repricing needed.
// Real constraints (from fal's own API docs, not guessed): input video must
// be .mp4/.mov, <=100MB, 2-10s, and (per fal's docs) "720p/1080p only" -
// every pay-as-you-go engine's output duration (5-8s) and resolution
// (720p, except MiniMax's 768p - not yet confirmed accepted, flagged for
// real testing) fits this. `sync_mode: "cut_off"` (the default) truncates
// if audio runs longer than the video rather than erroring - acceptable
// for now, a real limitation for longer Lucy-voice scripts worth revisiting
// if it comes up in practice.
export const LIPSYNC_ENDPOINT = "fal-ai/kling-video/lipsync/audio-to-video";

export async function submitLipsyncJob(videoUrl: string, audioUrl: string): Promise<string> {
  return submitFalJob(LIPSYNC_ENDPOINT, { video_url: videoUrl, audio_url: audioUrl });
}

export async function uploadBufferToFal(data: Buffer, contentType: string, fileName: string): Promise<string> {
  const initRes = await fetch("https://rest.fal.ai/storage/upload/initiate", {
    method: "POST",
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ file_name: fileName, content_type: contentType }),
  });
  if (!initRes.ok) {
    throw new Error(`fal storage initiate failed (${initRes.status}): ${(await initRes.text()).slice(0, 300)}`);
  }
  const { upload_url, file_url } = await initRes.json();
  const putRes = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: new Uint8Array(data),
  });
  if (!putRes.ok) {
    throw new Error(`fal storage upload failed (${putRes.status}): ${(await putRes.text()).slice(0, 300)}`);
  }
  return file_url as string;
}
