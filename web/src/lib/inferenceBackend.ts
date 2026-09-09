import { initSchema, getSetting, setSetting } from "./db";
import { submitJob } from "./runpod";
import { submitModalJob, warmModal } from "./modal";

// Three-way backend toggle: audio generation can run against the always-on
// GPU Pod (fast, billed hourly - good for a launch window with real
// concurrent traffic where latency matters), RunPod Serverless (cheap, but
// real-world cold starts turned out to be 2-3 minutes - kept running only to
// burn down its remaining prepaid credit and as a same-day rollback path,
// not recommended for live traffic), or Modal (cheap AND fast - the current
// default, see STATUS.md "Modal migration" for why RunPod's cold starts
// didn't hold up and what replaced them).
//
// Switchable at runtime from the admin dashboard (/admin), stored in
// Postgres rather than an env var - env vars need a fresh Vercel deploy to
// take effect (the CLI's `redeploy` turned out not to reliably pick up
// changed values), which is real friction for something that should be a
// one-click operational toggle, especially mid-incident. Falls back to the
// INFERENCE_BACKEND env var (default "modal") only if the DB has never been
// set - that's the one-time initial value, not the source of truth.
const INFERENCE_SERVER_URL = process.env.INFERENCE_SERVER_URL;
const SETTING_KEY = "inference_backend";
type InferenceBackend = "pod" | "serverless" | "modal";

export async function getInferenceBackend(): Promise<InferenceBackend> {
  await initSchema();
  const stored = await getSetting(SETTING_KEY);
  if (stored === "pod" || stored === "serverless" || stored === "modal") return stored;
  return process.env.INFERENCE_BACKEND === "pod" ? "pod" : "modal";
}

export async function setInferenceBackend(mode: InferenceBackend) {
  await initSchema();
  await setSetting(SETTING_KEY, mode);
}

export async function isPodMode(): Promise<boolean> {
  return (await getInferenceBackend()) === "pod";
}

// Job-submission dispatch for the two async (non-Pod) backends - kept here
// rather than duplicated in generate-preset/clone-voice so a caller doesn't
// need to know which backend produced the jobId, only how to poll it later
// (job-status/route.ts branches on the "modal:" prefix Modal's own submit
// function adds - see @/lib/modal.ts).
export async function submitGenerationJob(input: Record<string, unknown>): Promise<{ jobId: string }> {
  const backend = await getInferenceBackend();
  return backend === "modal" ? submitModalJob(input) : submitJob(input);
}

// Best-effort pre-warm, called when someone opens the generation page (see
// @/app/api/warm-inference/route.ts) - a no-op on Pod (already always warm)
// and RunPod Serverless (legacy path, not worth building this for). Never
// throws.
export async function warmInferenceBackend(): Promise<void> {
  if ((await getInferenceBackend()) === "modal") {
    await warmModal();
  }
}

// Pod mode fetches synchronously and returns already-decoded base64 audio,
// so callers can treat pod-mode and Serverless-mode responses identically
// (see generate-preset/clone-voice routes) - the Pod is always on, so there's
// no cold start to hide behind a job/poll dance the way Serverless needs.
export async function generateViaPod(
  path: "/api/generate-preset" | "/api/clone-voice",
  upstreamForm: FormData,
): Promise<{ audioBase64: string }> {
  const upstream = await fetch(`${INFERENCE_SERVER_URL}${path}`, { method: "POST", body: upstreamForm });
  const data = await upstream.json();
  if (!upstream.ok) {
    throw new Error(data.error ?? `Pod request failed (${upstream.status})`);
  }
  const audioUpstream = await fetch(`${INFERENCE_SERVER_URL}${data.audio_url}`);
  if (!audioUpstream.ok) {
    throw new Error("Could not fetch generated audio from the pod");
  }
  const buffer = Buffer.from(await audioUpstream.arrayBuffer());
  return { audioBase64: buffer.toString("base64") };
}
