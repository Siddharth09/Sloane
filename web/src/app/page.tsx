"use client";

import { useEffect, useState } from "react";
import { AccountWidget } from "@/components/AccountWidget";
import { Footer } from "@/components/Footer";
import { LogoMark } from "@/components/LogoMark";
import { RecordOrUpload } from "@/components/RecordOrUpload";
import { ShareButtons } from "@/components/ShareButtons";
import { VoicePicker, PRESET_VOICES } from "@/components/VoicePicker";
import { DeliverySliders, DEFAULT_DELIVERY, type Delivery } from "@/components/DeliverySliders";
import { WaitingGame } from "@/components/WaitingGame";
import { useAccessToken } from "@/lib/useAccessToken";
import { PLANS, VIDEO_CREDIT_COSTS } from "@/lib/plans";

// Video cloning isn't wired to the gated proxy yet (Feature C backend still
// in progress - see PROJECT_CONTEXT.md), so it still calls the inference
// server's public URL directly for now.
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

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

function VideoResultPlayer({ url }: { url: string | null }) {
  if (!url) return null;
  // clone-video still returns a path relative to API_BASE (not yet wired
  // through a proxy - still hits the GPU pod directly).
  const fullUrl = url.startsWith("http") ? url : `${API_BASE}${url}`;
  return (
    <div className="mt-4">
      <video className="w-full rounded-xl" src={fullUrl} controls />
      <ShareButtons url={fullUrl} text="Listen to what I made with Lucy!" />
    </div>
  );
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
const POLL_TIMEOUT_MS = 180_000; // generous - well past worst observed cold start + generation
const SHOW_WAITING_UI_AFTER_MS = 6000;

function loadingMessageFor(elapsedMs: number): string {
  if (elapsedMs < 15_000) return "Waking up the voice engine…";
  if (elapsedMs < 40_000) return "Generating your audio…";
  return "Almost there, thanks for your patience…";
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
  children,
}: {
  wash: string;
  iconColor: string;
  icon: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`shadow-soft-lg rounded-[28px] border border-white/60 p-7 backdrop-blur-xl transition hover:shadow-soft-lg ${wash}`}
    >
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
      <div className="mt-5 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function PresetVoiceSection() {
  const { token } = useAccessToken();
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState(PRESET_VOICES[0].id);
  const [delivery, setDelivery] = useState<Delivery>(DEFAULT_DELIVERY);
  const isPodMode = useIsPodMode();
  const { generate, loading, error, audioBase64, statusMessage, showWaitingUi } = useAudioGeneration("/api/generate-preset");

  async function handleGenerate() {
    const form = new FormData();
    form.append("text", text);
    form.append("voice_id", voiceId);
    form.append("exaggeration", String(delivery.expressiveness));
    form.append("speed", String(delivery.speed));
    if (token) form.append("access_token", token);
    await generate(form);
  }

  return (
    <Card
      wash="bg-pink-wash/90"
      iconColor="text-pink"
      icon="✎"
      title="Text to speech"
      subtitle="Type anything, pick a voice, hear it narrated — no per-message length cap, just your plan's monthly character allowance."
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
        <p className="text-xs text-muted">Generation can take 20-60 seconds, sometimes a little longer after a quiet period.</p>
      )}
      <GenerateButton loading={loading} disabled={!text || loading} onClick={handleGenerate} colorClassName="bg-pink" />
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
  const [text, setText] = useState("");
  const [file, setFile] = useState<Blob | File | null>(null);
  const [delivery, setDelivery] = useState<Delivery>(DEFAULT_DELIVERY);
  const isPodMode = useIsPodMode();
  const { generate, loading, error, audioBase64, statusMessage, showWaitingUi } = useAudioGeneration("/api/clone-voice");

  async function handleGenerate() {
    if (!file) return;
    const form = new FormData();
    form.append("text", text);
    form.append("reference_audio", file, "reference.webm");
    form.append("exaggeration", String(delivery.expressiveness));
    form.append("speed", String(delivery.speed));
    if (token) form.append("access_token", token);
    await generate(form);
  }

  return (
    <Card
      wash="bg-blue-wash/90"
      iconColor="text-blue"
      icon="🎙"
      title="Clone any voice"
      subtitle="Record or upload ~10-20 seconds of a voice, then type what it should say."
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
        <p className="text-xs text-muted">Generation can take 20-60 seconds, sometimes a little longer after a quiet period.</p>
      )}
      <GenerateButton loading={loading} disabled={!text || !file || loading} onClick={handleGenerate} colorClassName="bg-blue" />
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

const CINEMATIC_PROMPT_EXAMPLES = [
  "A sun-drenched clifftop terrace in Santorini, blue domes and the Aegean Sea behind me",
  "Walking a neon-lit street in Tokyo at night, rain reflecting off the pavement",
  "Standing in a quiet Kyoto bamboo forest at dawn, soft mist drifting through",
  "On a black-sand beach in Iceland, glaciers in the distance, moody light",
];

function VideoModeCard({
  badge,
  title,
  videoSrc,
  description,
  promptExamples,
  footnote,
}: {
  badge: string;
  title: string;
  videoSrc: string;
  description: string;
  promptExamples?: string[];
  footnote?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/60 bg-white/60 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-full bg-purple px-2.5 py-0.5 text-xs font-bold text-white">{badge}</span>
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
      </div>
      <video className="w-full rounded-xl" src={videoSrc} controls loop muted playsInline />
      <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
      {promptExamples && (
        <div className="mt-2">
          <p className="text-xs font-semibold text-foreground">Example prompts:</p>
          <ul className="mt-1 list-disc pl-4 text-xs leading-relaxed text-muted">
            {promptExamples.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {footnote && <p className="mt-2 text-xs italic leading-relaxed text-coral-dark">{footnote}</p>}
    </div>
  );
}

function VideoCloneSection() {
  const plusCredits = PLANS.plus.videoCreditsPerMonth;
  const proCredits = PLANS.pro.videoCreditsPerMonth;

  return (
    <Card
      wash="bg-purple-wash/90"
      iconColor="text-purple"
      icon="🎬"
      title="Video, coming later"
      subtitle="Not live yet — here's exactly what's planned, shown with real early test clips."
    >
      <p className="text-sm leading-relaxed text-muted">
        We at Lucy Labs aren&apos;t ready for video yet, but we&apos;re building toward two distinct modes.
        Both clips below are real early tests, not polished demos — we&apos;d rather be upfront about
        where things stand than oversell it.
      </p>

      <VideoModeCard
        badge="Talking head"
        title="Kling + your Lucy voice"
        videoSrc="/trailers/kirsty-moon-kling-dub.mp4"
        description="Upload a photo or short video of a face, plus audio — either type text narrated in your Lucy voice, or upload your own audio. We lip-sync it to that face. The voice is yours."
      />

      <VideoModeCard
        badge="Cinematic"
        title="Veo, any scene you describe"
        videoSrc="/trailers/kirsty-moon-veo-audio.mp4"
        description="Upload a photo and describe a scene in a prompt — Veo generates the video around it. The voice you hear is AI-generated dialogue, not your Lucy voice: dubbing a separate voice over this much camera motion doesn't sync convincingly, so we don't pretend it does."
        promptExamples={CINEMATIC_PROMPT_EXAMPLES}
        footnote="Faces can distort or drift from the original photo during generation — a real limitation of current AI video technology, ours included."
      />

      <VideoModeCard
        badge="Also tested"
        title="Kling's own voice (not shipping this way)"
        videoSrc="/trailers/kirsty-moon-kling-with-audio.mp4"
        description="We also tried letting Kling generate its own voice instead of dubbing with Lucy. Lip sync was noticeably worse this way — it's why Talking head mode dubs with your Lucy voice instead of a vendor's own generated speech."
      />

      <p className="rounded-2xl bg-white/70 p-3 text-xs leading-relaxed text-muted">
        <strong className="text-foreground">Video credits are shared across both modes</strong> — one
        monthly balance, spend it on talking-head, cinematic, or a mix of both. 1 credit ≈{" "}
        {VIDEO_CREDIT_COSTS.talkingHeadSecondsPerCredit}s of talking-head, or ≈
        {Math.round(VIDEO_CREDIT_COSTS.cinematicSecondsPerCredit * 100) / 100}s of cinematic (cinematic
        costs more to produce). Once this ships: Plus gets {plusCredits} credits/month, Pro gets{" "}
        {proCredits} credits/month, Free gets none. Whichever mode you use, your photo, video, and any
        reference audio are sent to third-party AI vendors (Kling, Veo, and the fal.ai platform we use
        to reach them) for processing — different from our audio feature, which runs entirely on our
        own servers.
      </p>

      <p className="text-sm leading-relaxed text-muted">
        If you need production-quality AI video today, the current best options are{" "}
        <a
          href="https://kling.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-purple underline"
        >
          Kling
        </a>{" "}
        and{" "}
        <a
          href="https://www.utopaistudios.com"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-purple underline"
        >
          Utopai Studios&apos; PAI
        </a>{" "}
        (the engine behind the &quot;Chloe vs History&quot; AI creator). We&apos;ll bring both modes here
        once they&apos;re actually good.
      </p>
    </Card>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen px-6 py-20">
      <main className="mx-auto flex max-w-2xl flex-col gap-10">
        <div className="mx-auto rounded-[32px] border border-white/60 bg-surface/90 px-8 py-8 text-center shadow-soft-lg backdrop-blur-xl">
          <a href="/" className="inline-flex">
            <LogoMark size={64} />
          </a>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-foreground">Lucy Labs</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
            Narrate, clone, and share, in a voice that sounds like someone real.
          </p>
        </div>
        <AccountWidget />
        <PresetVoiceSection />
        <CloneVoiceSection />
        <VideoCloneSection />
        <Footer />
      </main>
    </div>
  );
}
