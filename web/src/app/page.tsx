"use client";

import { useEffect, useRef, useState } from "react";
import { AccountWidget } from "@/components/AccountWidget";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { RecordOrUpload } from "@/components/RecordOrUpload";
import { ShareButtons } from "@/components/ShareButtons";
import { VoicePicker, PRESET_VOICES } from "@/components/VoicePicker";
import { DeliverySliders, DEFAULT_DELIVERY, type Delivery } from "@/components/DeliverySliders";
import { WaitingGame } from "@/components/WaitingGame";
import { useAccessToken } from "@/lib/useAccessToken";
import { useFreeTierId } from "@/lib/useFreeTierId";
import { PLANS, VIDEO_CREDIT_COSTS } from "@/lib/plans";
import { CHARACTERS, LUCY_VOICE_CREDIT_COST } from "@/lib/characters";
import { VIDEO_PAYGO_ENGINES, VIDEO_CREDIT_PACKS, type VideoEngine } from "@/lib/videoPaygo";
import { extractVideoFrame, isVideoFile, isAudioFile } from "@/lib/videoFrame";
import { useMediaRecorder } from "@/lib/useMediaRecorder";

// Backend mode is switchable at runtime from /admin (see
// @/lib/inferenceBackend) - fetched here rather than read from a build-time
// env var, so the UI copy stays accurate without needing a redeploy every
// time the mode is flipped. Module-level cache so both generation sections
// share one fetch instead of duplicating it.
let cachedPodMode: boolean | null = null;

function useIsPodMode(): boolean {
  const [isPodMode, setIsPodMode] = useState(cachedPodMode ?? false);
  useEffect(() => {
    if (cachedPodMode !== null) return;
    fetch("/api/inference-mode")
      .then((r) => r.json())
      .then((data) => {
        cachedPodMode = data.mode === "pod";
        setIsPodMode(cachedPodMode);
      })
      .catch(() => {
        // Leave the default (Serverless-style copy) - harmless either way,
        // it's just informational text, not enforcement.
      });
  }, []);
  return isPodMode;
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
}

// Generated audio now comes back as base64 straight from a RunPod
// Serverless job (see web/src/lib/runpod.ts) - nothing is written to a
// persisted, shareable URL anywhere on our infra anymore (see STATUS.md
// "Serverless migration"). Playback uses a data: URL directly; MP3 download
// POSTs the base64 to /api/download-mp3 for server-side transcoding and
// triggers a local file download from the response.
function AudioResultPlayer({ audioBase64 }: { audioBase64: string | null }) {
  if (!audioBase64) return null;
  const dataUrl = `data:audio/wav;base64,${audioBase64}`;
  const shareFile = new File([base64ToBlob(audioBase64, "audio/wav")], "lucy-audio.wav", { type: "audio/wav" });

  async function handleDownloadMp3() {
    const res = await fetch("/api/download-mp3", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64, name: `lucy-${Date.now()}` }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = `lucy-${Date.now()}.mp3`;
    a.click();
    URL.revokeObjectURL(objectUrl);
  }

  return (
    <div className="mt-4">
      <audio className="w-full" src={dataUrl} controls />
      <button
        onClick={handleDownloadMp3}
        className="mt-3 inline-block rounded-full border border-border bg-white px-4 py-2 text-xs font-semibold text-foreground hover:bg-white/70"
      >
        Download MP3
      </button>
      <ShareButtons file={shareFile} text="Listen to what I made with Lucy!" />
    </div>
  );
}

// Dual backend: generation runs against either an always-on GPU Pod (fast,
// no cold start - the initial POST already returns {status:"COMPLETED",
// audioBase64}) or RunPod Serverless (cheap, but a cold start can take
// ~60s+, well past Vercel's function timeout - the initial POST returns
// {jobId} and needs polling instead). See @/lib/inferenceBackend for the
// server-side toggle. This hook handles both response shapes so neither
// generation section needs to know which backend is active.
//
// The elapsed-time status message/WaitingGame only appear after
// SHOW_WAITING_UI_AFTER_MS - a fast Pod-mode response (or a warm Serverless
// worker) finishes well before that and never shows them, so switching
// backends doesn't require also touching this UI logic.
const POLL_INTERVAL_MS = 2000;
// Was 240_000 (4min), sized around a single short clip's cold start + a
// couple retries. Real bug found 2026-09-10: a long-form text (a multi-
// hundred-word story/meditation script, chunked into dozens of ~40-word
// generations) can legitimately take many minutes end-to-end, and the
// client was giving up with "taking much longer than usual" while Modal
// was still working fine - see modal_app.py's timeout for the matching
// server-side raise. 25 minutes gives real margin above Modal's own 30min
// ceiling's realistic worst case without polling forever on a truly stuck
// job.
const POLL_TIMEOUT_MS = 1_500_000;
const SHOW_WAITING_UI_AFTER_MS = 6000;

function loadingMessageFor(elapsedMs: number): string {
  if (elapsedMs < 15_000) return "Waking up the voice engine…";
  if (elapsedMs < 40_000) return "Generating your audio…";
  if (elapsedMs < 120_000) return "Almost there, thanks for your patience…";
  // Past 2 minutes this is very likely a long piece of text being narrated
  // chunk by chunk, not a stuck/slow single clip - say so instead of
  // repeating "almost there" for several more minutes.
  return "Still narrating - longer pieces of text take a few minutes…";
}

function useAudioGeneration(endpoint: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [showWaitingUi, setShowWaitingUi] = useState(false);

  async function generate(form: FormData) {
    setLoading(true);
    setError(null);
    setAudioBase64(null);
    setShowWaitingUi(false);
    const startedAt = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startedAt;
      setStatusMessage(loadingMessageFor(elapsed));
      setShowWaitingUi(elapsed >= SHOW_WAITING_UI_AFTER_MS);
    };
    tick();
    const ticker = setInterval(tick, 1000);
    try {
      const res = await fetch(endpoint, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);

      if (data.status === "COMPLETED") {
        // Pod mode - already finished, nothing to poll.
        setAudioBase64(data.audioBase64);
        return;
      }

      const jobId = data.jobId as string;
      for (;;) {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          throw new Error("Generation is taking much longer than usual — please try again.");
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        const statusRes = await fetch(`/api/job-status?jobId=${encodeURIComponent(jobId)}`);
        const statusData = await statusRes.json();
        if (statusData.status === "COMPLETED") {
          setAudioBase64(statusData.audioBase64);
          return;
        }
        if (statusData.status === "FAILED") {
          throw new Error(statusData.error ?? "Generation failed");
        }
        // IN_QUEUE / IN_PROGRESS - keep polling
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      clearInterval(ticker);
      setLoading(false);
    }
  }

  return { generate, loading, error, audioBase64, statusMessage, showWaitingUi };
}

function GenerateButton({
  loading,
  disabled,
  onClick,
  colorClassName,
}: {
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
  colorClassName: string;
}) {
  return (
    <button
      className={`shadow-soft flex items-center justify-center gap-2 rounded-full ${colorClassName} py-3 text-sm font-bold text-white transition hover:brightness-105 active:brightness-95 disabled:opacity-40 disabled:shadow-none`}
      disabled={disabled}
      onClick={onClick}
    >
      {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
      {loading ? "Generating…" : "Generate"}
    </button>
  );
}

function Card({
  wash,
  iconColor,
  icon,
  title,
  subtitle,
  headerRight,
  children,
  id,
}: {
  wash: string;
  iconColor: string;
  icon: string;
  title: string;
  subtitle: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`shadow-soft-lg rounded-[28px] border border-white/60 p-7 backdrop-blur-xl transition hover:shadow-soft-lg ${wash}`}
    >
      <div className="flex items-start justify-between gap-3.5">
        <div className="flex items-center gap-3.5">
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/70 text-lg ${iconColor}`}
          >
            {icon}
          </span>
          <div>
            <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
            <p className="text-sm text-muted">{subtitle}</p>
          </div>
        </div>
        {headerRight}
      </div>
      <div className="mt-5 flex flex-col gap-4">{children}</div>
    </section>
  );
}

type UsageInfo = { charactersUsed: number; charactersLimit: number; periodEnd: string; planName: string; isFree: boolean };

// Works for BOTH anonymous free-tier visitors and paying subscribers -
// shown "at all times" per direct request, not just for the free tier.
// Paying subscribers previously had no usage visible anywhere except a
// separate /account page; this shows it right where they're generating.
// Refetches after every generation so the count visibly ticks down, and
// once exhausted, blocks further generation client-side too (the server
// enforces this either way - see @/lib/db's checkFreeQuota/checkQuota -
// this is just to avoid a wasted round-trip and show the reset date/
// upgrade link inline instead of as a generic error).
function useUsage(token: string | null, freeTierId: string | null) {
  const [usage, setUsage] = useState<UsageInfo | null>(null);

  async function refresh() {
    try {
      if (token) {
        const res = await fetch(`/api/billing/status?token=${encodeURIComponent(token)}`);
        const data = await res.json();
        if (res.ok && !data.error) {
          setUsage({
            charactersUsed: data.charactersUsed,
            charactersLimit: data.charactersLimit,
            periodEnd: data.periodEnd,
            planName: data.plan,
            isFree: false,
          });
        }
      } else if (freeTierId) {
        const res = await fetch(`/api/free-tier-status?id=${encodeURIComponent(freeTierId)}`);
        const data = await res.json();
        if (res.ok) {
          setUsage({
            charactersUsed: data.charactersUsed,
            charactersLimit: data.charactersLimit,
            periodEnd: data.periodEnd,
            planName: "Free",
            isFree: true,
          });
        }
      }
    } catch {
      // Leave stale/no usage shown - not worth surfacing an error for a
      // purely informational counter.
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, freeTierId]);

  return { usage, refresh };
}

function UsageBadge({ usage }: { usage: UsageInfo | null }) {
  if (!usage) return null;
  const remaining = Math.max(0, usage.charactersLimit - usage.charactersUsed);
  const resetDate = new Date(usage.periodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric" });
  return (
    <div className="shrink-0 text-right">
      <p className="text-xs font-semibold text-foreground">{remaining.toLocaleString()} characters left</p>
      {remaining === 0 ? (
        <p className="mt-0.5 text-[11px] text-coral-dark">
          Resets {resetDate} —{" "}
          <a href="/billing" className="underline">
            {usage.isFree ? "see plans" : "upgrade"}
          </a>
        </p>
      ) : (
        <p className="mt-0.5 text-[11px] text-muted">
          {usage.planName} · resets {resetDate}
        </p>
      )}
    </div>
  );
}

function PresetVoiceSection() {
  const { token } = useAccessToken();
  const freeTierId = useFreeTierId();
  const { usage, refresh: refreshUsage } = useUsage(token, freeTierId);
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState(PRESET_VOICES[0].id);
  const [delivery, setDelivery] = useState<Delivery>(DEFAULT_DELIVERY);
  const isPodMode = useIsPodMode();
  const { generate, loading, error, audioBase64, statusMessage, showWaitingUi } = useAudioGeneration("/api/generate-preset");

  const quotaExhausted = !!usage && usage.charactersUsed >= usage.charactersLimit;

  async function handleGenerate() {
    const form = new FormData();
    form.append("text", text);
    form.append("voice_id", voiceId);
    form.append("exaggeration", String(delivery.expressiveness));
    form.append("speed", String(delivery.speed));
    if (token) form.append("access_token", token);
    else if (freeTierId) form.append("free_tier_id", freeTierId);
    await generate(form);
    refreshUsage();
  }

  return (
    <Card
      wash="bg-pink-wash/90"
      iconColor="text-pink"
      icon="✎"
      title="Text to speech"
      subtitle="Type anything, pick a voice, hear it narrated — no per-message length cap, just your plan's monthly character allowance."
      headerRight={<UsageBadge usage={usage} />}
    >
      <textarea
        className="w-full rounded-2xl border border-border bg-white p-4 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-pink"
        rows={4}
        placeholder="Type what you want narrated..."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <VoicePicker value={voiceId} onChange={setVoiceId} />
      <DeliverySliders value={delivery} onChange={setDelivery} accentColor="text-pink" />
      {!isPodMode && (
        <p className="text-xs text-muted">Generation usually takes under a minute, but can take up to a few minutes after a quiet period while the voice engine wakes up.</p>
      )}
      {quotaExhausted ? (
        <p className="rounded-2xl bg-white/70 p-3 text-sm text-coral-dark">
          You&apos;ve used your {usage!.isFree ? "free" : usage!.planName} {usage!.charactersLimit.toLocaleString()}{" "}
          characters this month. Resets{" "}
          {new Date(usage!.periodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric" })} — or{" "}
          <a href="/billing" className="font-semibold underline">
            {usage!.isFree ? "see plans" : "upgrade"}
          </a>{" "}
          to keep going now.
        </p>
      ) : (
        <GenerateButton loading={loading} disabled={!text || loading} onClick={handleGenerate} colorClassName="bg-pink" />
      )}
      {showWaitingUi && (
        <>
          <p className="text-sm text-muted">{statusMessage}</p>
          <WaitingGame />
        </>
      )}
      {error && <p className="text-sm text-coral-dark">{error}</p>}
      <AudioResultPlayer audioBase64={audioBase64} />
    </Card>
  );
}

function CloneVoiceSection() {
  const { token } = useAccessToken();
  const freeTierId = useFreeTierId();
  const { usage, refresh: refreshUsage } = useUsage(token, freeTierId);
  const [text, setText] = useState("");
  const [file, setFile] = useState<Blob | File | null>(null);
  const [delivery, setDelivery] = useState<Delivery>(DEFAULT_DELIVERY);
  const isPodMode = useIsPodMode();
  const { generate, loading, error, audioBase64, statusMessage, showWaitingUi } = useAudioGeneration("/api/clone-voice");

  const quotaExhausted = !!usage && usage.charactersUsed >= usage.charactersLimit;

  async function handleGenerate() {
    if (!file) return;
    const form = new FormData();
    form.append("text", text);
    // Match the filename's extension to the real recorded/uploaded type
    // (Safari records mp4, Chrome/Firefox record webm) rather than
    // hardcoding "reference.webm" for every browser.
    const ext = file.type.includes("mp4") ? "mp4" : file.type.includes("ogg") ? "ogg" : file.type.includes("wav") ? "wav" : "webm";
    const referenceFilename = file instanceof File ? file.name : `reference.${ext}`;
    form.append("reference_audio", file, referenceFilename);
    form.append("exaggeration", String(delivery.expressiveness));
    form.append("speed", String(delivery.speed));
    if (token) form.append("access_token", token);
    else if (freeTierId) form.append("free_tier_id", freeTierId);
    await generate(form);
    refreshUsage();
  }

  return (
    <Card
      wash="bg-blue-wash/90"
      iconColor="text-blue"
      icon="🎙"
      title="Clone any voice"
      subtitle="Record or upload ~10-20 seconds of a voice, then type what it should say."
      headerRight={<UsageBadge usage={usage} />}
    >
      <RecordOrUpload kind="audio" onChange={setFile} />
      <textarea
        className="w-full rounded-2xl border border-border bg-white p-4 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-blue"
        rows={4}
        placeholder="Type what you want read back in that voice..."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <DeliverySliders value={delivery} onChange={setDelivery} accentColor="text-blue" />
      {!isPodMode && (
        <p className="text-xs text-muted">Generation usually takes under a minute, but can take up to a few minutes after a quiet period while the voice engine wakes up.</p>
      )}
      {quotaExhausted ? (
        <p className="rounded-2xl bg-white/70 p-3 text-sm text-coral-dark">
          You&apos;ve used your {usage!.isFree ? "free" : usage!.planName} {usage!.charactersLimit.toLocaleString()}{" "}
          characters this month. Resets{" "}
          {new Date(usage!.periodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric" })} — or{" "}
          <a href="/billing" className="font-semibold underline">
            {usage!.isFree ? "see plans" : "upgrade"}
          </a>{" "}
          to keep going now.
        </p>
      ) : (
        <GenerateButton loading={loading} disabled={!text || !file || loading} onClick={handleGenerate} colorClassName="bg-blue" />
      )}
      {showWaitingUi && (
        <>
          <p className="text-sm text-muted">{statusMessage}</p>
          <WaitingGame />
        </>
      )}
      {error && <p className="text-sm text-coral-dark">{error}</p>}
      <AudioResultPlayer audioBase64={audioBase64} />
    </Card>
  );
}

// Shared by all 4 video modes below.
const VIDEO_POLL_INTERVAL_MS = 3000;
const VIDEO_POLL_TIMEOUT_MS = 300_000;

// accessToken is required for the 3 subscription-video modes (their status
// routes now check job.access_token against the caller - see
// generate-character-video/status/route.ts and its siblings for the fix)
// and unused/omittable for "paygo" (that one's owned by the signed-in
// cookie session instead).
async function pollVideoJob(statusEndpoint: string, jobId: string, accessToken?: string | null): Promise<string> {
  const startedAt = Date.now();
  const tokenQuery = accessToken ? `&access_token=${encodeURIComponent(accessToken)}` : "";
  for (;;) {
    if (Date.now() - startedAt > VIDEO_POLL_TIMEOUT_MS) throw new Error("Taking much longer than usual - try again shortly.");
    await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_INTERVAL_MS));
    const res = await fetch(`${statusEndpoint}?jobId=${encodeURIComponent(jobId)}${tokenQuery}`);
    const data = await res.json();
    if (data.status === "COMPLETED") return data.videoUrl as string;
    if (data.status === "FAILED") throw new Error(data.error ?? "Generation failed");
  }
}

type VideoJobType = "paygo" | "character" | "custom" | "cinematic";

// Real video + a real "Download MP4" that streams through our own domain
// (see /api/download-video) instead of sending people to fal's raw CDN URL.
function VideoResultPlayer({
  videoUrl,
  jobId,
  jobType,
  accessToken,
}: {
  videoUrl: string;
  jobId: string;
  jobType: VideoJobType;
  accessToken?: string | null;
}) {
  const tokenQuery = accessToken ? `&access_token=${encodeURIComponent(accessToken)}` : "";
  return (
    <div>
      <video className="w-full rounded-xl" src={videoUrl} controls autoPlay loop playsInline />
      <a
        href={`/api/download-video?jobType=${jobType}&jobId=${encodeURIComponent(jobId)}${tokenQuery}`}
        className="mt-3 inline-block rounded-full border border-border bg-white px-4 py-2 text-xs font-semibold text-foreground hover:bg-white/70"
      >
        Download MP4
      </a>
    </div>
  );
}

// Shared image/video-upload control used by all 3 upload-driven video modes.
// Accepts MULTIPLE photos/videos at once - upload a few and pick which one
// actually gets used, since every engine we call (Kling Avatar, Veo image-
// to-video) only takes a single reference image. A video is never sent to
// the server as-is for that image - a frame is grabbed client-side (see
// @/lib/videoFrame.ts) the moment it's chosen.
type ReferenceMediaItem = { blob: Blob; sourceFile: File | null; previewUrl: string; isVideo: boolean };

function useReferenceMedia() {
  const [items, setItems] = useState<ReferenceMediaItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const chosen = Array.from(files).filter((f) => {
      if (isAudioFile(f)) {
        setError("Audio files go in the separate voice/audio option below, not here.");
        return false;
      }
      return true;
    });
    if (chosen.length === 0) return;
    setExtracting(true);
    try {
      const newItems: ReferenceMediaItem[] = [];
      for (const f of chosen) {
        if (isVideoFile(f)) {
          const frame = await extractVideoFrame(f);
          newItems.push({ blob: frame, sourceFile: f, previewUrl: URL.createObjectURL(frame), isVideo: true });
        } else {
          newItems.push({ blob: f, sourceFile: null, previewUrl: URL.createObjectURL(f), isVideo: false });
        }
      }
      setItems((prev) => {
        setSelectedIndex(prev.length);
        return [...prev, ...newItems];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read one of those files");
    } finally {
      setExtracting(false);
    }
  }

  // Real bug fixed here: every URL.createObjectURL() above was never
  // paired with a revoke - not on removal, not on reset, not on unmount -
  // so each discarded photo/video-frame Blob stayed pinned in the tab's
  // memory for the rest of the page's life. removeAt/reset now revoke the
  // specific URL(s) being dropped, and an unmount effect below revokes
  // whatever's still left if the user navigates away with items still in
  // the list.
  function removeAt(i: number) {
    setItems((prev) => {
      URL.revokeObjectURL(prev[i]?.previewUrl);
      return prev.filter((_, idx) => idx !== i);
    });
    setSelectedIndex((prev) => (prev === i ? 0 : prev > i ? prev - 1 : prev));
  }

  function reset() {
    setItems((prev) => {
      prev.forEach((it) => URL.revokeObjectURL(it.previewUrl));
      return [];
    });
    setSelectedIndex(0);
    setError(null);
  }

  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    return () => {
      itemsRef.current.forEach((it) => URL.revokeObjectURL(it.previewUrl));
    };
  }, []);

  const selected = items[selectedIndex] ?? null;
  return {
    items,
    selectedIndex,
    setSelectedIndex,
    imageBlob: selected?.blob ?? null,
    videoFile: selected?.isVideo ? selected.sourceFile : null,
    extracting,
    error,
    handleFiles,
    removeAt,
    reset,
  };
}

function ReferenceMediaField({ media, label }: { media: ReturnType<typeof useReferenceMedia>; label: string }) {
  return (
    <div className="flex flex-col gap-2">
      {media.items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {media.items.map((it, i) => (
            <button key={it.previewUrl} onClick={() => media.setSelectedIndex(i)} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={it.previewUrl}
                alt="Your reference"
                className={`h-14 w-14 rounded-xl object-cover shadow-soft ${media.selectedIndex === i ? "ring-2 ring-purple" : "opacity-60"}`}
              />
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  media.removeAt(i);
                }}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs shadow-soft"
              >
                ×
              </span>
            </button>
          ))}
        </div>
      )}
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-full border border-border bg-white py-3 text-sm font-semibold text-foreground hover:bg-white/70">
        {media.extracting ? "Grabbing a frame…" : media.items.length > 0 ? "Add another photo/video" : label}
        <input type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => media.handleFiles(e.target.files)} />
      </label>
      {media.items.length > 1 && <p className="text-xs text-muted">Tap one to pick which photo/video we actually use.</p>}
      {media.error && <p className="text-xs text-coral-dark">{media.error}</p>}
    </div>
  );
}

// Same "upload/record several, pick one" pattern as ReferenceMediaField
// above, for voice/audio references - reuses the existing single-clip
// recorder hook but keeps every take in a list instead of overwriting the
// last one.
type AudioItem = { blob: Blob; previewUrl: string; label: string };

function useMultiAudio() {
  const [items, setItems] = useState<AudioItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const rec = useMediaRecorder("audio");

  useEffect(() => {
    if (!rec.blob) return;
    // A fresh object URL, independent of rec's own previewUrl - rec.reset()
    // (below) revokes rec's own URL as soon as we're done copying the
    // blob out, and this hook owns the lifetime of this new one from here
    // (revoked by removeAt/reset/unmount, same as the upload-driven items).
    const url = URL.createObjectURL(rec.blob);
    setItems((prev) => {
      setSelectedIndex(prev.length);
      return [...prev, { blob: rec.blob!, previewUrl: url, label: `Recording ${prev.length + 1}` }];
    });
    rec.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.blob]);

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const chosen = Array.from(files).filter((f) => !isVideoFile(f));
    const newItems = chosen.map((f) => ({ blob: f, previewUrl: URL.createObjectURL(f), label: f.name }));
    setItems((prev) => {
      setSelectedIndex(prev.length);
      return [...prev, ...newItems];
    });
  }

  // Real bug fixed here: same unrevoked-object-URL leak as
  // useReferenceMedia above, for every uploaded/recorded audio take.
  function removeAt(i: number) {
    setItems((prev) => {
      URL.revokeObjectURL(prev[i]?.previewUrl);
      return prev.filter((_, idx) => idx !== i);
    });
    setSelectedIndex((prev) => (prev === i ? 0 : prev > i ? prev - 1 : prev));
  }

  function reset() {
    setItems((prev) => {
      prev.forEach((it) => URL.revokeObjectURL(it.previewUrl));
      return [];
    });
    setSelectedIndex(0);
    rec.reset();
  }

  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    return () => {
      itemsRef.current.forEach((it) => URL.revokeObjectURL(it.previewUrl));
    };
  }, []);

  const selected = items[selectedIndex] ?? null;
  return { items, selectedIndex, setSelectedIndex, selectedBlob: selected?.blob ?? null, rec, addFiles, removeAt, reset };
}

function MultiAudioField({ audio }: { audio: ReturnType<typeof useMultiAudio> }) {
  return (
    <div className="flex flex-col gap-2">
      {audio.items.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {audio.items.map((it, i) => (
            <div key={it.previewUrl} className="flex items-center gap-2">
              <button
                onClick={() => audio.setSelectedIndex(i)}
                className={`flex-1 truncate rounded-full border px-3 py-1.5 text-left text-xs font-semibold ${
                  audio.selectedIndex === i ? "border-purple bg-purple text-white" : "border-border bg-white text-muted"
                }`}
              >
                {audio.selectedIndex === i ? "✓ " : ""}
                {it.label}
              </button>
              <button onClick={() => audio.removeAt(i)} className="text-sm text-coral-dark">
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={audio.rec.recording ? audio.rec.stop : audio.rec.start}
          className={`flex-1 rounded-full py-2.5 text-xs font-semibold ${
            audio.rec.recording ? "bg-coral text-white" : "border border-border bg-white text-foreground"
          }`}
        >
          {audio.rec.recording ? "⏹ Stop" : "🎙 Record"}
        </button>
        <label className="flex flex-1 cursor-pointer items-center justify-center rounded-full border border-border bg-white py-2.5 text-xs font-semibold text-foreground">
          ↑ Upload
          <input type="file" accept="audio/*" multiple className="hidden" onChange={(e) => audio.addFiles(e.target.files)} />
        </label>
      </div>
      {audio.items.length > 1 && <p className="text-xs text-muted">Tap one to pick which take we actually use.</p>}
      {audio.rec.error && <p className="text-xs text-coral-dark">{audio.rec.error}</p>}
    </div>
  );
}

function VideoIntroSection() {
  const videoCredits = PLANS.video.videoCreditsPerMonth;
  return (
    <Card wash="bg-purple-wash/90" iconColor="text-purple" icon="🎬" title="Video" subtitle="Four ways to make a video with Lucy - pick what fits.">
      <ul className="grid gap-2 text-sm leading-relaxed text-muted sm:grid-cols-2">
        <li>
          <strong className="text-foreground">Your video, hyper-realistic.</strong> Your own photo/video + a script -
          exactly your face, powered by Kling.
        </li>
        <li>
          <strong className="text-foreground">Cinematic.</strong> Your photo + a scene you describe - Veo generates
          the shot.
        </li>
        <li>
          <strong className="text-foreground">Pick a character.</strong> 5 ready-made AI actors, always the same
          face.
        </li>
        <li>
          <strong className="text-foreground">Pay as you go.</strong> Any prompt (+ optional photo/audio), any
          engine, no subscription.
        </li>
      </ul>
      <p className="rounded-2xl bg-white/70 p-3 text-xs leading-relaxed text-muted">
        The first three modes share one Video-plan balance: {videoCredits} credits/month. Whichever mode you use,
        your photo, video, and any audio are sent to third-party AI vendors (Kling, Veo, Seedance, and the fal.ai
        platform we use to reach them) for processing.
      </p>
    </Card>
  );
}

// --- Mode 1: your own photo/video, hyper-realistic, exactly your likeness ---

function CustomVideoSection() {
  const { token } = useAccessToken();
  const media = useReferenceMedia();
  const [script, setScript] = useState("");
  const [voiceMode, setVoiceMode] = useState<"preset" | "own">("preset");
  const [presetVoiceId, setPresetVoiceId] = useState(PRESET_VOICES[0].id);
  const ownVoice = useMultiAudio();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ videoUrl: string; jobId: string } | null>(null);

  async function handleGenerate() {
    if (!media.imageBlob) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("access_token", token ?? "");
      form.append("script", script);
      form.append("reference_image", media.imageBlob, "reference.jpg");
      form.append("voice_mode", voiceMode);
      if (voiceMode === "preset") {
        form.append("preset_voice_id", presetVoiceId);
      } else {
        // Their own recorded/uploaded voice sample, or - if they uploaded a
        // video and never separately gave a voice sample - the original
        // video file itself: the backend already transcodes any container
        // (including a video's own audio track) into the reference clip.
        const audioSource = ownVoice.selectedBlob ?? media.videoFile;
        if (!audioSource) throw new Error("Add a short sample of your voice, or upload a video that has your voice in it");
        form.append("reference_audio", audioSource);
      }
      const res = await fetch("/api/generate-custom-video", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      const jobId = data.jobId as string;
      const videoUrl = await pollVideoJob("/api/generate-custom-video/status", jobId, token);
      setResult({ videoUrl, jobId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card
      id="hyper-realistic"
      wash="bg-purple-wash/90"
      iconColor="text-purple"
      icon="🪞"
      title="Your video, hyper-realistic"
      subtitle="Upload your photo or a short video of yourself, type what to say - we animate exactly your face to say it."
    >
      <div className="rounded-2xl border border-white/60 bg-white/60 p-3">
        <video className="mx-auto w-full max-w-xs rounded-xl" src="/trailers/kirsty-kling-dub.mp4" controls loop muted playsInline />
        <p className="mt-1.5 text-xs text-muted">Example: a real photo, dubbed with a Lucy voice via Kling.</p>
      </div>

      <ReferenceMediaField media={media} label="Upload your photo(s) or video(s)" />

      <textarea
        className="w-full rounded-2xl border border-border bg-white p-4 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-purple"
        rows={3}
        placeholder="Type what you want to say..."
        value={script}
        onChange={(e) => setScript(e.target.value)}
      />

      <div className="flex gap-2">
        <button
          onClick={() => setVoiceMode("preset")}
          className={`flex-1 rounded-full py-2 text-xs font-semibold ${voiceMode === "preset" ? "bg-purple text-white shadow-soft" : "border border-border bg-white text-muted"}`}
        >
          Pick a Lucy voice
        </button>
        <button
          onClick={() => setVoiceMode("own")}
          className={`flex-1 rounded-full py-2 text-xs font-semibold ${voiceMode === "own" ? "bg-purple text-white shadow-soft" : "border border-border bg-white text-muted"}`}
        >
          Use my own voice
        </button>
      </div>

      {voiceMode === "preset" ? (
        <select
          value={presetVoiceId}
          onChange={(e) => setPresetVoiceId(e.target.value)}
          className="w-full rounded-2xl border border-border bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple"
        >
          {PRESET_VOICES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      ) : (
        <>
          <MultiAudioField audio={ownVoice} />
          {ownVoice.items.length === 0 && media.videoFile && (
            <p className="text-xs text-muted">No sample given - we&apos;ll use the audio from your uploaded video instead.</p>
          )}
        </>
      )}

      {!token ? (
        <p className="rounded-2xl bg-white/70 p-3 text-sm text-muted">
          Sign in with a Video-plan access code (paste yours above, or{" "}
          <a href="/billing" className="font-semibold text-purple underline">
            see plans
          </a>
          ) to generate.
        </p>
      ) : (
        <button
          onClick={handleGenerate}
          disabled={loading || !media.imageBlob || !script.trim() || (voiceMode === "own" && !ownVoice.selectedBlob && !media.videoFile)}
          className="w-full rounded-2xl bg-purple py-3 text-sm font-bold text-white shadow-soft disabled:opacity-50"
        >
          {loading ? "Generating… (usually 30-90s)" : `Generate (${LUCY_VOICE_CREDIT_COST} video credits)`}
        </button>
      )}

      {error && <p className="rounded-2xl bg-white/70 p-3 text-sm text-coral-dark">{error}</p>}
      {result && <VideoResultPlayer videoUrl={result.videoUrl} jobId={result.jobId} jobType="custom" accessToken={token} />}
      <p className="text-xs text-muted">Powered by Kling - the only engine in our tests that reliably keeps your exact face, not a lookalike.</p>
    </Card>
  );
}

// --- Mode 2: cinematic scenes with Veo, from your own photo ---

type CinematicAudioSource = "engine_native" | "own_upload" | "lucy_preset" | "lucy_cloned";

// Guides people toward a genuinely more detailed prompt (Veo's real output
// quality tracks how specific the description is), quoting the real prompt
// used for the moon-surface demo clip on this page as a worked example.
const CINEMATIC_PROMPT_PLACEHOLDER = `Describe the scene in detail - the more specific, the better the result. For example, for the astronaut-on-the-moon video above, we used: "Cinematic wide shot on the lunar surface: this exact same woman walks slowly beside a NASA-style lunar rover, dust kicking up under her boots, Earth hanging in the black sky. In the mid-ground a futuristic..."`;

function CinematicVideoSection() {
  const { token } = useAccessToken();
  const media = useReferenceMedia();
  const [prompt, setPrompt] = useState("");
  const [audioSource, setAudioSource] = useState<CinematicAudioSource>("engine_native");
  const [presetVoiceId, setPresetVoiceId] = useState(PRESET_VOICES[0].id);
  const ownAudio = useMultiAudio();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ videoUrl: string; jobId: string } | null>(null);
  const cinematicCredits = Math.round(8 / VIDEO_CREDIT_COSTS.cinematicSecondsPerCredit);

  async function handleGenerate() {
    if (!media.imageBlob) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      // Real bug fixed here: "My own audio"/"Clone my voice" silently
      // omitted reference_audio if none was ever added, wasting a round-
      // trip on a request the server was always going to reject - check
      // client-side first instead, matching CustomVideoSection's pattern.
      if ((audioSource === "own_upload" || audioSource === "lucy_cloned") && !ownAudio.selectedBlob) {
        throw new Error(audioSource === "own_upload" ? "Add the audio you want on this video" : "Add a short sample of your voice to clone");
      }
      const form = new FormData();
      form.append("access_token", token ?? "");
      form.append("prompt", prompt);
      form.append("reference_image", media.imageBlob, "reference.jpg");
      form.append("audio_source", audioSource);
      if (audioSource === "lucy_preset") form.append("preset_voice_id", presetVoiceId);
      if ((audioSource === "own_upload" || audioSource === "lucy_cloned") && ownAudio.selectedBlob) {
        form.append("reference_audio", ownAudio.selectedBlob);
      }
      const res = await fetch("/api/generate-cinematic-video", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      const jobId = data.jobId as string;
      const videoUrl = await pollVideoJob("/api/generate-cinematic-video/status", jobId, token);
      setResult({ videoUrl, jobId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  }

  const AUDIO_OPTIONS: { id: CinematicAudioSource; label: string }[] = [
    { id: "engine_native", label: "Veo's own voice" },
    { id: "own_upload", label: "My own audio" },
    { id: "lucy_preset", label: "A Lucy voice" },
    { id: "lucy_cloned", label: "Clone my voice" },
  ];

  return (
    <Card
      id="cinematic"
      wash="bg-purple-wash/90"
      iconColor="text-purple"
      icon="🎬"
      title="Cinematic"
      subtitle="Your photo + a scene you describe - Veo generates the shot around it."
    >
      <div className="rounded-2xl border border-white/60 bg-white/60 p-3">
        <video className="mx-auto w-full max-w-xs rounded-xl" src="/trailers/kirsty-moon-veo-audio.mp4" controls loop muted playsInline />
        <p className="mt-1.5 text-xs text-muted">Example: the moon-surface scene, from the prompt below.</p>
      </div>

      <ReferenceMediaField media={media} label="Upload your photo(s) or video(s)" />

      <textarea
        className="w-full rounded-2xl border border-border bg-white p-4 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-purple"
        rows={4}
        placeholder={CINEMATIC_PROMPT_PLACEHOLDER}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />

      <div className="grid grid-cols-2 gap-2">
        {AUDIO_OPTIONS.map((o) => (
          <button
            key={o.id}
            onClick={() => setAudioSource(o.id)}
            className={`rounded-2xl border p-2 text-xs font-semibold ${audioSource === o.id ? "border-purple bg-purple text-white shadow-soft" : "border-border bg-white text-muted"}`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {audioSource === "lucy_preset" && (
        <select
          value={presetVoiceId}
          onChange={(e) => setPresetVoiceId(e.target.value)}
          className="w-full rounded-2xl border border-border bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple"
        >
          {PRESET_VOICES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      )}
      {(audioSource === "own_upload" || audioSource === "lucy_cloned") && <MultiAudioField audio={ownAudio} />}
      {audioSource !== "engine_native" && (
        <p className="text-xs italic text-muted">
          {audioSource === "lucy_cloned" ? "This clones your voice reading the text above." : "Your audio is layered onto the finished video afterward - not lip-synced frame-by-frame the way our Kling modes are, since Veo doesn't support that."}
        </p>
      )}

      {!token ? (
        <p className="rounded-2xl bg-white/70 p-3 text-sm text-muted">
          Sign in with a Video-plan access code (paste yours above, or{" "}
          <a href="/billing" className="font-semibold text-purple underline">
            see plans
          </a>
          ) to generate.
        </p>
      ) : (
        <button
          onClick={handleGenerate}
          disabled={
            loading ||
            !media.imageBlob ||
            !prompt.trim() ||
            ((audioSource === "own_upload" || audioSource === "lucy_cloned") && !ownAudio.selectedBlob)
          }
          className="w-full rounded-2xl bg-purple py-3 text-sm font-bold text-white shadow-soft disabled:opacity-50"
        >
          {loading ? "Generating… (usually 30-90s)" : `Generate (${cinematicCredits} video credits)`}
        </button>
      )}

      {error && <p className="rounded-2xl bg-white/70 p-3 text-sm text-coral-dark">{error}</p>}
      {result && <VideoResultPlayer videoUrl={result.videoUrl} jobId={result.jobId} jobType="cinematic" accessToken={token} />}
      <p className="text-xs text-muted">
        A real limitation, not hidden: the more your reference photo moves within the scene, the more the face can
        drift from your real one - Veo regenerates the whole scene rather than animating your exact photo.
      </p>
    </Card>
  );
}

// --- Model comparison showcase: same photo + same prompt, five engines ---

const MODEL_SHOWCASE_PROMPT =
  'Cinematic wide shot on the lunar surface: this exact same woman walks slowly beside a NASA-style lunar rover, dust kicking up under her boots, Earth hanging in the black sky, dramatic lighting, photorealistic, 4K quality.';

type ShowcaseModel = {
  id: string;
  name: string;
  note: string;
  videoUrl: string | null;
  blockedReason?: string;
};

const SHOWCASE_MODELS: ShowcaseModel[] = [
  {
    id: "kling",
    name: "Kling v3 Pro",
    note: "Our pick: the best face consistency and scene quality of the five we tested. Note: this is a newer Kling version than the \"Kling 2.1 Master\" you can actually generate with above.",
    videoUrl: "/model-showcase/moon_kling_v3_pro.mp4",
  },
  {
    id: "veo",
    name: "Veo 3.1",
    note: "Strong, reliable cinematic quality - what Cinematic mode above uses today.",
    videoUrl: "/model-showcase/moon_veo.mp4",
  },
  {
    id: "grok",
    name: "Grok Imagine 1.5",
    note: "Usable quality and the cheapest of the five to generate.",
    videoUrl: "/model-showcase/moon_grok_1.5.mp4",
  },
  {
    id: "minimax",
    name: "MiniMax H3 Max",
    note: "Weakest likeness and motion quality of the engines that actually rendered.",
    videoUrl: "/model-showcase/moon_minimax_h3max.mp4",
  },
  {
    id: "seedance",
    name: "Seedance 2.0",
    note: "Couldn't offer us a result on this test - see below.",
    videoUrl: null,
    blockedReason:
      "Seedance can't offer us a realistic video for this scene right now because of their own privacy policy around hyper-realistic AI faces. Every engine has its own quirks scene-to-scene - try your own prompt and photo above and see how it does for you.",
  },
];

function ModelShowcaseSection() {
  const [modelId, setModelId] = useState(SHOWCASE_MODELS[0].id);
  const model = SHOWCASE_MODELS.find((m) => m.id === modelId)!;

  return (
    <Card
      wash="bg-purple-wash/90"
      iconColor="text-purple"
      icon="🎞️"
      title="Compare video models"
      subtitle="We ran the same reference photo and the same prompt through five video engines - tap one to see the result."
    >
      <p className="text-sm leading-relaxed text-muted">
        Pay as you go above lets you generate with Kling, Veo, Grok, MiniMax, or Seedance. Quality, speed, and
        reliability vary a lot by engine and by scene - here&apos;s the identical lunar scene, run through each one,
        so you can see the difference before you pick an engine to generate your own.
      </p>

      {model.videoUrl ? (
        <video key={model.id} className="mx-auto w-full max-w-xs rounded-xl" src={model.videoUrl} controls loop muted playsInline />
      ) : (
        <div className="rounded-2xl border border-coral-dark/30 bg-white/70 p-4 text-sm text-coral-dark">
          {model.blockedReason}
        </div>
      )}

      <div className="flex flex-wrap justify-center gap-3">
        {SHOWCASE_MODELS.map((m) => (
          <button
            key={m.id}
            onClick={() => setModelId(m.id)}
            className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
              modelId === m.id
                ? "bg-purple text-white shadow-soft"
                : m.videoUrl
                  ? "border border-border bg-white text-muted hover:opacity-100"
                  : "border border-coral-dark/30 bg-white text-coral-dark opacity-80"
            }`}
          >
            {m.name}
            {!m.videoUrl && " ⚠️"}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted">{model.note}</p>

      <div className="rounded-2xl bg-white/70 p-3">
        <p className="text-xs font-semibold text-muted">The exact prompt used for all five:</p>
        <p className="mt-1 text-xs italic text-muted">{MODEL_SHOWCASE_PROMPT}</p>
      </div>

      <p className="text-xs text-muted">
        Caveat: these models change constantly - the labs and fal ship new versions often. This is a snapshot of
        where each one stood when we tested it (2026-09-12), not a permanent ranking.
      </p>
    </Card>
  );
}

// --- "Just for fun" product-ad showcase: Beth + our own product, five engines ---

const PRODUCT_AD_PROMPT =
  "Cinematic tracking shot: this exact woman strides confidently out of a bright modern yoga studio holding her " +
  "pink tumbler, which has a purple microphone logo and the words LUCY LABS printed on it, and the shot flows " +
  "into her walking into a sleek New York high-rise office with floor-to-ceiling windows and skyscrapers behind " +
  "her, still holding the same tumbler, energetic and professional, photorealistic, 4k, cinematic commercial ad, " +
  "dramatic lighting";

type ProductAdModel = {
  id: string;
  name: string;
  note: string;
  videoUrl: string | null;
  blockedReason?: string;
};

const PRODUCT_AD_MODELS: ProductAdModel[] = [
  {
    id: "minimax",
    name: "MiniMax",
    note: "The cleanest result of the five - crisp logo (mic icon and all), warm and natural, straight out of a real ad.",
    videoUrl: "/product-showcase/beth_ad_minimax.mp4",
  },
  {
    id: "grok",
    name: "Grok",
    note: "Nailed the exact Lucy Labs logo and mic icon purely from the text description - it never even saw a photo of the real cup.",
    videoUrl: "/product-showcase/beth_ad_grok.mp4",
  },
  {
    id: "kling",
    name: "Kling",
    note: "Recognizably Beth, but without a real photo of the cup to work from, the logo came out as an illegible scribble.",
    videoUrl: "/product-showcase/beth_ad_kling.mp4",
  },
  {
    id: "veo",
    name: "Veo",
    note: "Couldn't offer us a result on this one - see below.",
    videoUrl: null,
    blockedReason:
      "Veo's own safety checker rejected this scene before it ever started generating - one of its more sensitive content filters, not something we can configure around.",
  },
  {
    id: "seedance",
    name: "Seedance",
    note: "Couldn't offer us a result on this one - see below.",
    videoUrl: null,
    blockedReason:
      "Seedance can't offer us a realistic video with Beth in it because of their own privacy policy around hyper-realistic AI faces - the same reason it sat out our other test above.",
  },
];

function ProductAdShowcaseSection() {
  const [modelId, setModelId] = useState(PRODUCT_AD_MODELS[0].id);
  const model = PRODUCT_AD_MODELS.find((m) => m.id === modelId)!;

  return (
    <Card
      wash="bg-purple-wash/90"
      iconColor="text-purple"
      icon="🥤"
      title="Can AI promote your product?"
      subtitle="We asked each model to put one of our AI characters in a real ad for our own product - no distortion allowed."
    >
      <p className="text-sm leading-relaxed text-muted">
        This time we made it harder: show Beth, one of our AI characters, leaving a yoga studio and walking into
        her New York office, carrying a Lucy Labs tumbler (the same one below, relabeled with our real logo). Only
        Beth&apos;s photo was given as the actual reference image - none of these engines can take a second photo
        of the cup at the same time for a real person, so the cup itself was only described in words.
      </p>

      <div className="flex items-center justify-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/product-showcase/beth_reference.jpg" alt="Beth, the photo we uploaded" className="h-40 w-auto rounded-xl object-contain" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/product-showcase/lucylabs_cup_v2.png" alt="Our Lucy Labs tumbler" className="h-40 w-auto rounded-xl object-contain" />
      </div>
      <p className="text-center text-xs text-muted">Beth&apos;s photo (the actual reference image) and our tumbler (described in the prompt only).</p>

      {model.videoUrl ? (
        <video key={model.id} className="mx-auto w-full max-w-xs rounded-xl" src={model.videoUrl} controls loop muted playsInline />
      ) : (
        <div className="rounded-2xl border border-coral-dark/30 bg-white/70 p-4 text-sm text-coral-dark">
          {model.blockedReason}
        </div>
      )}

      <div className="flex flex-wrap justify-center gap-3">
        {PRODUCT_AD_MODELS.map((m) => (
          <button
            key={m.id}
            onClick={() => setModelId(m.id)}
            className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
              modelId === m.id
                ? "bg-purple text-white shadow-soft"
                : m.videoUrl
                  ? "border border-border bg-white text-muted hover:opacity-100"
                  : "border border-coral-dark/30 bg-white text-coral-dark opacity-80"
            }`}
          >
            {m.name}
            {!m.videoUrl && " ⚠️"}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted">{model.note}</p>

      <div className="rounded-2xl bg-white/70 p-3">
        <p className="text-xs font-semibold text-muted">The exact prompt used for all five:</p>
        <p className="mt-1 text-xs italic text-muted">{PRODUCT_AD_PROMPT}</p>
      </div>

      <p className="text-xs text-muted">
        Honest caveat: none of the five actually cut between two locations - that&apos;s a real limit of a single
        generation (they render one continuous shot, not a multi-scene edit), not a bug on our end. What you see
        is each engine&apos;s best one-take interpretation. Same as above: a snapshot from 2026-09-12, not a
        permanent ranking.
      </p>
    </Card>
  );
}

function CharacterVideoSection() {
  const { token } = useAccessToken();
  const [characterId, setCharacterId] = useState(CHARACTERS[0].id);
  const [script, setScript] = useState("");
  const [voiceMode, setVoiceMode] = useState<"default" | "pick" | "own">("default");
  const [presetVoiceId, setPresetVoiceId] = useState(PRESET_VOICES[0].id);
  const ownVoice = useMultiAudio();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ videoUrl: string; jobId: string } | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);

  const character = CHARACTERS.find((c) => c.id === characterId)!;

  // Click a character to select them AND hear/see their intro preview -
  // same one-shared-element toggle pattern as VoicePicker.tsx's audio
  // previews (click again to stop, click again to replay).
  function handlePickCharacter(id: (typeof CHARACTERS)[number]["id"]) {
    setCharacterId(id);
    const el = previewRef.current;
    if (!el) return;
    if (playingId === id) {
      el.pause();
      el.currentTime = 0;
      setPlayingId(null);
      return;
    }
    el.pause();
    el.src = `/character-samples/${id}.mp4`;
    el.currentTime = 0;
    el.play().catch(() => {});
    setPlayingId(id);
  }

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("access_token", token ?? "");
      form.append("character_id", characterId);
      form.append("script", script);
      if (voiceMode === "own") {
        if (!ownVoice.selectedBlob) throw new Error("Add a short sample of your voice, or pick a Lucy voice instead");
        form.append("voice_choice", "__own__");
        form.append("reference_audio", ownVoice.selectedBlob);
      } else {
        form.append("voice_choice", voiceMode === "pick" ? presetVoiceId : character.defaultVoiceId);
      }
      const res = await fetch("/api/generate-character-video", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      const jobId = data.jobId as string;
      const videoUrl = await pollVideoJob("/api/generate-character-video/status", jobId, token);
      setResult({ videoUrl, jobId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card
      wash="bg-purple-wash/90"
      iconColor="text-purple"
      icon="🎭"
      title="Pick a character"
      subtitle="5 ready-made AI actors, always the same face - tap one to hear them, then type what they should say."
    >
      <div className="rounded-2xl border border-white/60 bg-white/60 p-3">
        <video className="mx-auto w-full max-w-xs rounded-xl" src="/trailers/ads-veo-demo.mp4" controls loop muted playsInline />
        <p className="mt-1.5 text-xs text-muted">Example: Harper, one of the 5 characters below.</p>
      </div>

      <video
        ref={previewRef}
        onEnded={() => setPlayingId(null)}
        controls
        playsInline
        className={playingId ? "mx-auto w-full max-w-xs rounded-xl" : "hidden"}
      />
      <div className="flex flex-wrap justify-center gap-4">
        {CHARACTERS.map((c) => (
          <button key={c.id} onClick={() => handlePickCharacter(c.id)} className="flex flex-col items-center gap-1.5">
            <span className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={c.imageUrl}
                alt={c.name}
                className={`h-16 w-16 rounded-full object-cover shadow-soft transition ${
                  characterId === c.id ? "shadow-soft-lg scale-110 ring-4 ring-purple" : "opacity-70 hover:opacity-100"
                }`}
              />
              {playingId === c.id && (
                <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] shadow-soft">
                  🔊
                </span>
              )}
            </span>
            <span className={`text-xs ${characterId === c.id ? "font-bold text-purple" : "text-muted"}`}>{c.name}</span>
          </button>
        ))}
      </div>

      {!token ? (
        <p className="rounded-2xl bg-white/70 p-3 text-sm text-muted">
          Sign in with a Video-plan access code (paste yours above, or{" "}
          <a href="/billing" className="font-semibold text-purple underline">
            see plans
          </a>
          ) to actually generate a video with them.
        </p>
      ) : (
        <>
          <textarea
            className="w-full rounded-2xl border border-border bg-white p-4 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-purple"
            rows={3}
            placeholder="What should they say?"
            value={script}
            onChange={(e) => setScript(e.target.value)}
          />

          <div className="flex gap-2">
            {(["default", "pick", "own"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setVoiceMode(m)}
                className={`flex-1 rounded-full py-2 text-xs font-semibold ${voiceMode === m ? "bg-purple text-white shadow-soft" : "border border-border bg-white text-muted"}`}
              >
                {m === "default" ? `${character.name}'s voice` : m === "pick" ? "Another Lucy voice" : "My own voice"}
              </button>
            ))}
          </div>
          {voiceMode === "pick" && (
            <select
              value={presetVoiceId}
              onChange={(e) => setPresetVoiceId(e.target.value)}
              className="w-full rounded-2xl border border-border bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple"
            >
              {PRESET_VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          )}
          {voiceMode === "own" && <MultiAudioField audio={ownVoice} />}

          <button
            onClick={handleGenerate}
            disabled={loading || !script.trim() || (voiceMode === "own" && !ownVoice.selectedBlob)}
            className="w-full rounded-2xl bg-purple py-3 text-sm font-bold text-white shadow-soft disabled:opacity-50"
          >
            {loading ? "Generating… (usually 30-90s)" : `Generate (${LUCY_VOICE_CREDIT_COST} video credits)`}
          </button>

          {error && <p className="rounded-2xl bg-white/70 p-3 text-sm text-coral-dark">{error}</p>}
          {result && <VideoResultPlayer videoUrl={result.videoUrl} jobId={result.jobId} jobType="character" accessToken={token} />}
        </>
      )}

      <p className="text-xs text-muted">Comes from your Video plan&apos;s 40 credits/month - each video costs {LUCY_VOICE_CREDIT_COST}.</p>
    </Card>
  );
}

type PaygoAudioMode = "none" | "own" | "lucy";

function PayAsYouGoVideoSection() {
  const [signedIn, setSignedIn] = useState(false);
  const [balance, setBalance] = useState(0);
  const [engine, setEngine] = useState<VideoEngine>("veo");
  const media = useReferenceMedia();
  const audio = useMultiAudio();
  const [audioMode, setAudioMode] = useState<PaygoAudioMode>("none");
  const [presetVoiceId, setPresetVoiceId] = useState(PRESET_VOICES[0].id);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ videoUrl: string; jobId: string } | null>(null);
  const [buyingPack, setBuyingPack] = useState<string | null>(null);

  // Same shared-<audio>-element click-to-preview pattern as VoicePicker.tsx
  // and the character/model-showcase pickers above - click a voice to hear
  // its sample, click again to stop, click again to replay.
  function togglePreview(id: string) {
    const el = previewAudioRef.current;
    if (!el) return;
    if (previewingVoiceId === id) {
      el.pause();
      el.currentTime = 0;
      setPreviewingVoiceId(null);
      return;
    }
    el.pause();
    el.src = `/voice-samples/${id}.wav`;
    el.currentTime = 0;
    el.play().catch(() => {});
    setPreviewingVoiceId(id);
  }

  // Matches the server's real rule (video-paygo/generate/route.ts): Kling
  // Avatar's own uploaded audio already carries every word, so it's the
  // only case a text prompt can be skipped - a Lucy voice still needs the
  // prompt (it's the TTS script) same as every other path.
  const promptSkippable = engine === "kling" && audioMode === "own" && !!audio.selectedBlob;

  async function refreshBalance() {
    const res = await fetch("/api/video-paygo/balance");
    const data = await res.json();
    setSignedIn(data.signedIn);
    setBalance(data.balance);
  }

  useEffect(() => {
    refreshBalance().catch(() => {});
  }, []);

  async function handleBuy(packId: string) {
    setBuyingPack(packId);
    try {
      const res = await fetch("/api/video-paygo/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else setError(data.error ?? "Checkout failed");
    } finally {
      setBuyingPack(null);
    }
  }

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("engine", engine);
      form.append("prompt", prompt);
      form.append("audio_mode", audioMode);
      if (media.imageBlob) form.append("reference_image", media.imageBlob, "reference.jpg");
      if (audioMode === "own" && audio.selectedBlob) form.append("reference_audio", audio.selectedBlob);
      if (audioMode === "lucy") form.append("preset_voice_id", presetVoiceId);
      const res = await fetch("/api/video-paygo/generate", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      const jobId = data.jobId as string;
      const videoUrl = await pollVideoJob("/api/video-paygo/status", jobId);
      setResult({ videoUrl, jobId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setLoading(false);
      refreshBalance().catch(() => {});
    }
  }

  return (
    <Card
      id="pay-as-you-go"
      wash="bg-purple-wash/90"
      iconColor="text-purple"
      icon="🎟"
      title="Pay as you go"
      subtitle="Any prompt, plus an optional photo/video and audio - pick your engine, no subscription."
    >
      {!signedIn ? (
        <p className="rounded-2xl bg-white/70 p-3 text-sm text-muted">
          <a href="/account" className="font-semibold text-purple underline">
            Sign in
          </a>{" "}
          to buy video credits and generate.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">
            Credit balance: <span className="font-bold text-foreground">{balance}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {VIDEO_CREDIT_PACKS.map((pack) => (
              <button
                key={pack.id}
                onClick={() => handleBuy(pack.id)}
                disabled={buyingPack !== null}
                className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-purple shadow-soft disabled:opacity-50"
              >
                {buyingPack === pack.id
                  ? "Redirecting…"
                  : `${pack.credits} video${pack.credits > 1 ? "s" : ""} - $${(pack.priceUsdCents / 100).toFixed(2)}`}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(Object.entries(VIDEO_PAYGO_ENGINES) as [VideoEngine, (typeof VIDEO_PAYGO_ENGINES)[VideoEngine]][]).map(([id, e]) => (
              <div key={id}>
                <button
                  onClick={() => setEngine(id)}
                  className={`w-full rounded-2xl border p-2 text-center text-xs transition ${
                    engine === id ? "border-purple bg-purple text-white shadow-soft" : "border-border bg-white text-muted"
                  }`}
                >
                  <div className="font-bold">{e.label}</div>
                  <div className="mt-0.5">{e.versionLabel}</div>
                </button>
                <a
                  href={e.exampleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block text-center text-[11px] text-purple underline"
                >
                  See examples ↗
                </a>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted">
            Only Veo can speak on its own with no audio given - Kling, Seedance, Grok, and MiniMax always render
            silent unless you add your own audio or pick a Lucy voice below.
          </p>

          <ReferenceMediaField media={media} label="Add photo(s) or video(s) (optional)" />

          <div className="grid grid-cols-3 gap-2">
            {(["none", "own", "lucy"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setAudioMode(m)}
                className={`rounded-2xl border p-2 text-center text-xs font-semibold transition ${
                  audioMode === m ? "border-purple bg-purple text-white shadow-soft" : "border-border bg-white text-muted"
                }`}
              >
                {m === "none" ? "No extra audio" : m === "own" ? "My own audio" : "A Lucy voice"}
              </button>
            ))}
          </div>

          {audioMode === "own" && <MultiAudioField audio={audio} />}

          {audioMode === "lucy" && (
            <div className="flex items-center gap-2">
              <audio ref={previewAudioRef} onEnded={() => setPreviewingVoiceId(null)} className="hidden" />
              <select
                value={presetVoiceId}
                onChange={(e) => setPresetVoiceId(e.target.value)}
                className="flex-1 rounded-2xl border border-border bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple"
              >
                {PRESET_VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => togglePreview(presetVoiceId)}
                className="rounded-full border border-border bg-white px-3 py-2.5 text-xs font-semibold text-purple shadow-soft"
              >
                {previewingVoiceId === presetVoiceId ? "⏸ Stop" : "▶ Preview"}
              </button>
            </div>
          )}

          {(audioMode === "own" || audioMode === "lucy") && (
            <p className="text-xs italic leading-relaxed text-muted">
              {engine === "kling"
                ? "Kling lip-syncs your photo directly to this audio in one step - the mouth movements actually follow what's said."
                : `${VIDEO_PAYGO_ENGINES[engine].label} renders the scene first, then a separate lip-sync pass matches the mouth movements to this audio afterward - two steps instead of one, same real lip-sync result.`}
            </p>
          )}

          <textarea
            className="w-full rounded-2xl border border-border bg-white p-4 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-purple"
            rows={3}
            placeholder={audioMode === "lucy" ? "What should the voice say?" : "Describe the video you want..."}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />

          <button
            onClick={balance < 1 ? () => handleBuy("single") : handleGenerate}
            disabled={
              loading ||
              (balance >= 1 && !prompt.trim() && !promptSkippable) ||
              (audioMode === "own" && !audio.selectedBlob) ||
              buyingPack !== null
            }
            className="w-full rounded-2xl bg-purple py-3 text-sm font-bold text-white shadow-soft disabled:opacity-50"
          >
            {loading
              ? "Generating… (usually 30-90s)"
              : balance < 1
                ? buyingPack === "single"
                  ? "Redirecting…"
                  : "Buy credits to generate"
                : "Generate (1 credit)"}
          </button>

          {error && <p className="rounded-2xl bg-white/70 p-3 text-sm text-coral-dark">{error}</p>}
          {result && <VideoResultPlayer videoUrl={result.videoUrl} jobId={result.jobId} jobType="paygo" />}
        </>
      )}

      <p className="text-xs italic leading-relaxed text-muted">
        Same flat price per video regardless of engine - real clip length differs (Kling is a hard 5s, the other four are 8s).
        Every engine gives you real lip-sync when you add audio: Kling does it in one step (needs a photo); every
        other engine renders the scene first, then a separate lip-sync pass matches the mouth movements afterward.
      </p>
    </Card>
  );
}

export default function Home() {
  useEffect(() => {
    // Fire-and-forget: wakes up Modal well before the visitor finishes
    // typing and hits Generate for real - see api/warm-inference/route.ts.
    fetch("/api/warm-inference", { method: "POST" }).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen px-6 py-20">
      <main className="mx-auto flex max-w-2xl flex-col gap-10">
        <SiteHeader
          title="Lucy Labs"
          subtitle="The AI Voice Clone, narrate any text or upload your voice and try it out!"
          current="home"
          logoSize={64}
        />
        <AccountWidget />
        <PresetVoiceSection />
        <CloneVoiceSection />
        <VideoIntroSection />
        <CustomVideoSection />
        <CinematicVideoSection />
        <CharacterVideoSection />
        <PayAsYouGoVideoSection />
        <ModelShowcaseSection />
        <ProductAdShowcaseSection />
        <Footer />
      </main>
    </div>
  );
}
