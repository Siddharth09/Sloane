import { initSchema, getSetting, setSetting } from "./db";

// Dual-backend toggle: audio generation can run against either the
// always-on GPU Pod (fast, billed hourly - good for a launch window with
// real concurrent traffic where latency matters) or RunPod Serverless
// (cheap, cold starts - good once traffic is quiet). See
// STATUS.md "Dual backend toggle" for the operational runbook.
//
// Switchable at runtime from the admin dashboard (/admin), stored in
// Postgres rather than an env var - env vars need a fresh Vercel deploy to
// take effect (the CLI's `redeploy` turned out not to reliably pick up
// changed values), which is real friction for something that should be a
// one-click operational toggle, especially mid-incident. Falls back to the
// INFERENCE_BACKEND env var (default "serverless") only if the DB has never
// been set - that's the one-time initial value, not the source of truth.
const INFERENCE_SERVER_URL = process.env.INFERENCE_SERVER_URL;
const SETTING_KEY = "inference_backend";

export async function getInferenceBackend(): Promise<"pod" | "serverless"> {
  await initSchema();
  const stored = await getSetting(SETTING_KEY);
  if (stored === "pod" || stored === "serverless") return stored;
  return process.env.INFERENCE_BACKEND === "pod" ? "pod" : "serverless";
}

export async function setInferenceBackend(mode: "pod" | "serverless") {
  await initSchema();
  await setSetting(SETTING_KEY, mode);
}

export async function isPodMode(): Promise<boolean> {
  return (await getInferenceBackend()) === "pod";
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
