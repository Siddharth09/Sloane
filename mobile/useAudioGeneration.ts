import { useState } from "react";
import { File, Paths } from "expo-file-system";

// Mirrors web/src/app/page.tsx's useAudioGeneration - generation now runs on
// a scale-to-zero RunPod Serverless endpoint instead of an always-on Pod, so
// a request submits a job and this polls for its result rather than
// blocking on one fetch (see STATUS.md "Serverless migration"). Kept as a
// plain hook (not shared code with web - no shared package between the two
// apps yet) but the shape and timing constants match exactly so behavior is
// consistent across platforms.
const WEB_BASE = process.env.EXPO_PUBLIC_WEB_BASE ?? "https://lucylabs.app";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 180_000;

export function loadingMessageFor(elapsedMs: number): string {
  if (elapsedMs < 15_000) return "Waking up the voice engine…";
  if (elapsedMs < 40_000) return "Generating your audio…";
  return "Almost there, thanks for your patience…";
}

// expo-audio's player expects a real file:// or https:// URI, not a data:
// URI (unconfirmed/unsupported for base64 audio) - write the decoded bytes
// to a cache file instead and hand back its uri.
async function base64WavToLocalUri(audioBase64: string): Promise<string> {
  const file = new File(Paths.cache, `lucy-${Date.now()}.wav`);
  file.create({ overwrite: true });
  file.write(audioBase64, { encoding: "base64" });
  return file.uri;
}

export function useAudioGeneration(endpoint: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  async function generate(form: FormData) {
    setLoading(true);
    setError(null);
    setAudioUri(null);
    const startedAt = Date.now();
    setStatusMessage(loadingMessageFor(0));
    try {
      const res = await fetch(`${WEB_BASE}${endpoint}`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      const jobId = data.jobId as string;

      for (;;) {
        const elapsed = Date.now() - startedAt;
        if (elapsed > POLL_TIMEOUT_MS) {
          throw new Error("Generation is taking much longer than usual — please try again.");
        }
        setStatusMessage(loadingMessageFor(elapsed));
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        const statusRes = await fetch(`${WEB_BASE}/api/job-status?jobId=${encodeURIComponent(jobId)}`);
        const statusData = await statusRes.json();
        if (statusData.status === "COMPLETED") {
          setAudioUri(await base64WavToLocalUri(statusData.audioBase64));
          return;
        }
        if (statusData.status === "FAILED") {
          throw new Error(statusData.error ?? "Generation failed");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return { generate, loading, error, audioUri, statusMessage };
}
