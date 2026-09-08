// Dual-backend toggle: audio generation can run against either the
// always-on GPU Pod (fast, billed hourly - good for a launch window with
// real concurrent traffic where latency matters) or RunPod Serverless
// (cheap, cold starts - good once traffic is quiet). See
// STATUS.md "Dual backend toggle" for the operational runbook.
//
// Controlled by INFERENCE_BACKEND=pod|serverless (server-only) and mirrored
// to NEXT_PUBLIC_INFERENCE_BACKEND for the one piece of UI copy that needs
// to know before a request is even made (the "may take 20-60s" note).
// Keep both env vars in sync - nothing enforces that automatically.
const INFERENCE_SERVER_URL = process.env.INFERENCE_SERVER_URL;

export function isPodMode(): boolean {
  return process.env.INFERENCE_BACKEND === "pod";
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
