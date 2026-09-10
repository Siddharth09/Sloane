import { useRef, useState } from "react";
import { File, Paths } from "expo-file-system";

// Mirrors web/src/app/page.tsx's useAudioGeneration - dual backend, same
// reasoning: generation runs against either an always-on GPU Pod (fast, the
// initial POST already returns {status:"COMPLETED", audioBase64}) or RunPod
// Serverless (cheap, cold starts - the initial POST returns {jobId} and
// needs polling instead). See web/src/lib/inferenceBackend.ts for the
// server-side toggle. Kept as a plain hook (not shared code with web - no
// shared package between the two apps yet) but the shape and timing
// constants match exactly so behavior is consistent across platforms.
const WEB_BASE = process.env.EXPO_PUBLIC_WEB_BASE ?? "https://www.lucylabs.app";
const POLL_INTERVAL_MS = 2000;
// See web/src/app/page.tsx's POLL_TIMEOUT_MS comment - raised 2026-09-10
// from 240_000 alongside the same fix there: long-form text (a long story/
// meditation script chunked into dozens of generations) can legitimately
// take several minutes, and the old timeout gave up on a job that was still
// working fine server-side.
const POLL_TIMEOUT_MS = 1_500_000;
const SHOW_WAITING_UI_AFTER_MS = 6000;

export function loadingMessageFor(elapsedMs: number): string {
  if (elapsedMs < 15_000) return "Waking up the voice engine…";
  if (elapsedMs < 40_000) return "Generating your audio…";
  if (elapsedMs < 120_000) return "Almost there, thanks for your patience…";
  return "Still narrating - longer pieces of text take a few minutes…";
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
  const [showWaitingUi, setShowWaitingUi] = useState(false);
  // Every generation writes a new cache file (expo-audio needs a real
  // file:// uri, not a data: uri) - without cleanup, a long-lived app
  // install accumulates one .wav per generation forever. Delete the
  // previous one once a new one is about to replace it.
  const previousUri = useRef<string | null>(null);

  async function generate(form: FormData) {
    setLoading(true);
    setError(null);
    setAudioUri(null);
    setShowWaitingUi(false);
    const startedAt = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startedAt;
      setStatusMessage(loadingMessageFor(elapsed));
      setShowWaitingUi(elapsed >= SHOW_WAITING_UI_AFTER_MS);
    };
    tick();
    const ticker = setInterval(tick, 1000);

    async function setAudioUriAndCleanup(audioBase64: string) {
      const staleUri = previousUri.current;
      const newUri = await base64WavToLocalUri(audioBase64);
      previousUri.current = newUri;
      setAudioUri(newUri);
      if (staleUri) {
        try {
          new File(staleUri).delete();
        } catch {
          // Best-effort - a failed cleanup isn't worth surfacing to the user.
        }
      }
    }

    try {
      const res = await fetch(`${WEB_BASE}${endpoint}`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);

      if (data.status === "COMPLETED") {
        // Pod mode - already finished, nothing to poll.
        await setAudioUriAndCleanup(data.audioBase64);
        return;
      }

      const jobId = data.jobId as string;
      for (;;) {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          throw new Error("Generation is taking much longer than usual — please try again.");
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        const statusRes = await fetch(`${WEB_BASE}/api/job-status?jobId=${encodeURIComponent(jobId)}`);
        const statusData = await statusRes.json();
        if (statusData.status === "COMPLETED") {
          await setAudioUriAndCleanup(statusData.audioBase64);
          return;
        }
        if (statusData.status === "FAILED") {
          throw new Error(statusData.error ?? "Generation failed");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      clearInterval(ticker);
      setLoading(false);
    }
  }

  return { generate, loading, error, audioUri, statusMessage, showWaitingUi };
}
