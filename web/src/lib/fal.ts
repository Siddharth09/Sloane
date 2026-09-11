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

// Real balance-guard infrastructure (2026-09-12) - direct answer to "what if
// $10k of requests land at once and we don't have that much prepaid on fal."
// Lucy Labs already collects payment BEFORE ever calling fal (Stripe ->
// prepaid video credits -> then generate), so no customer can cost real
// money we haven't already banked - the actual exposure is just a treasury-
// timing gap (fal's own prepaid balance keeping pace with revenue already
// collected), not a billing-passthrough problem. This closes that gap two
// ways: checked live on every generation request (real-time guard, so a
// burst of demand can't silently drain the balance and start failing mid-
// generation) and via a periodic low-balance email alert (see
// @/lib/email.ts's sendLowFalBalanceEmail and
// api/cron/check-fal-balance/route.ts) so a human tops up before it's ever
// actually zero.
export type FalBalance = { usd: number };

// Real finding while wiring this up: fal's billing endpoint requires a
// separate ADMIN-scoped API key - the regular FAL_KEY used for generation
// (falHeaders() above) gets a real 401 ("This API key is not permitted to
// perform this action") against it, confirmed directly against the live
// account. FAL_ADMIN_KEY needs to be created on fal's dashboard (an API key
// with admin scope, not the generation key) and set as its own env var -
// until that exists, getFalBalance throws and hasEnoughFalBalanceToGenerate
// below fails open (allows generation) rather than silently blocking every
// real customer over a missing credential.
export async function getFalBalance(): Promise<FalBalance> {
  if (!process.env.FAL_ADMIN_KEY) {
    throw new Error("FAL_ADMIN_KEY is not set - an admin-scoped fal.ai API key is required for balance checks");
  }
  const res = await fetch("https://api.fal.ai/v1/account/billing?expand=credits", {
    headers: { Authorization: `Key ${process.env.FAL_ADMIN_KEY}` },
  });
  if (!res.ok) {
    throw new Error(`fal balance check failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  // Schema not fully documented publicly - defensively check the couple of
  // shapes fal's own docs/examples show credits under, rather than assuming
  // one exact path and silently reporting $0 (which would trip the guard
  // below and block real generation) if fal's response shape differs.
  const usd =
    data?.credits?.balance_usd ?? data?.credits?.balance ?? data?.balance_usd ?? data?.balance ?? null;
  if (typeof usd !== "number") {
    throw new Error(`fal balance check returned an unexpected shape: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { usd };
}

// Worst-case real cost of a single pay-as-you-go video (Seedance, see
// videoPaygo.ts's VIDEO_PAYGO_ENGINE_COST_USD) - if fal's live balance can't
// cover even one more worst-case video, decline before spending a customer
// credit rather than find out mid-generation. Deliberately not per-engine
// (the guard runs before we necessarily know the exact cost path - e.g.
// whether a lip-sync pass will be needed) - erring toward blocking a little
// early over letting a real generation fail after a credit's already spent.
export const FAL_MIN_BALANCE_TO_GENERATE_USD = 2.5;

export async function hasEnoughFalBalanceToGenerate(): Promise<boolean> {
  try {
    const { usd } = await getFalBalance();
    return usd >= FAL_MIN_BALANCE_TO_GENERATE_USD;
  } catch (err) {
    // If the balance check itself fails (network blip, fal API change), we
    // can't prove there's enough - but we also shouldn't block every real
    // generation on a transient check failure. Logs loudly so this is
    // visible without ever silently locking out paying customers over it.
    console.error("[fal] balance guard check failed, allowing generation to proceed", err);
    return true;
  }
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
