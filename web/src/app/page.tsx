"use client";

import { useEffect, useState } from "react";
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
import { CHARACTERS, LUCY_VOICE_CREDIT_COST, VEO_VOICE_CREDIT_COST } from "@/lib/characters";

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
    form.append("reference_audio", file, "reference.webm");
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
  const videoCredits = PLANS.video.videoCreditsPerMonth;

  return (
    <Card
      wash="bg-purple-wash/90"
      iconColor="text-purple"
      icon="🎬"
      title="Video"
      subtitle="Three real modes, being wired up now — not a vague someday."
    >
      <p className="text-sm leading-relaxed text-muted">
        Video is landing as three distinct modes, each built on the AI video engine that's actually
        best at that job: Kling for a talking-head video in any voice, Veo for a fully AI-generated
        cinematic scene, and Seedance for ad-style videos built around your own reusable AI actor. The
        clips below are real tests run against the live APIs, not mockups — here&apos;s exactly what to
        expect, drawbacks included.
      </p>

      <VideoModeCard
        badge="Talking head"
        title="Kling + any Lucy voice (or Kling's own)"
        videoSrc="/trailers/kirsty-kling-dub.mp4"
        description="Upload a photo or short video of a face, plus audio — either type text narrated in one of Lucy's voices (including a cloned one), or let Kling use its own voice. We lip-sync it to that face."
      />

      <VideoModeCard
        badge="Cinematic"
        title="Veo, any scene you describe"
        videoSrc="/trailers/kirsty-moon-veo-audio.mp4"
        description="Upload a photo and describe a scene in a prompt — Veo generates the video around it, with a choice of its own AI-generated voice/dialogue or a Lucy voice dubbed in afterward for shots calm enough for the dub to sync convincingly."
        promptExamples={CINEMATIC_PROMPT_EXAMPLES}
        footnote="The more the character moves within a scene, the more their face can drift or distort from the original reference photo — a real limitation of current AI video technology broadly, ours included, not something we can fully fix on our end. Cinematic mode isn't reliable yet for a shot that needs the face to stay consistent throughout a lot of motion."
      />

      <VideoModeCard
        badge="Ads"
        title="Your own exclusive AI actor"
        videoSrc="/trailers/ads-veo-demo.mp4"
        description="Describe your actor in a text prompt, or start from a photo or a short video — either way, you type the script and your actor says it back in the video. That actor is generated privately for your account: we never hand the same generated actor to another customer, and every new one is checked against everyone else's before it's finalized so even an accidental lookalike gets regenerated. Reuse that one actor across unlimited ads afterward - new scripts, new scenes, or upload an existing ad/UGC video and Seedance recreates its content and motion with your actor instead - one consistent 'face' across every ad, at a click, without booking a real actor each time."
        footnote="This demo (and any hyper-realistic actor) is generated through Veo - Seedance's own safety filter blocks fully AI-generated faces that look too photorealistic, so it's reserved for its unique upload-a-video recreation trick and more stylized actor looks instead."
      />

      <p className="rounded-2xl bg-white/70 p-3 text-xs leading-relaxed text-muted">
        <strong className="text-foreground">Video credits are shared across all three modes</strong> —
        one monthly balance. 1 credit ≈ {VIDEO_CREDIT_COSTS.talkingHeadSecondsPerCredit}s of
        talking-head, or ≈{Math.round(VIDEO_CREDIT_COSTS.cinematicSecondsPerCredit * 100) / 100}s of
        cinematic (cinematic costs more to produce) - ads-mode pricing depends on which engine a given
        generation actually uses and is still being finalized. Once this ships: the Video plan gets{" "}
        {videoCredits} credits/month - Free/Starter/Plus don&apos;t include video. Whichever mode you
        use, your photo, video, and any reference audio are sent to third-party AI vendors (Kling, Veo,
        Seedance, and the fal.ai platform we use to reach them) for processing — different from our
        audio feature, which runs entirely on our own servers.
      </p>
    </Card>
  );
}

const CHARACTER_POLL_INTERVAL_MS = 3000;
const CHARACTER_POLL_TIMEOUT_MS = 300_000;

function CharacterVideoSection() {
  const { token } = useAccessToken();
  const [characterId, setCharacterId] = useState(CHARACTERS[0].id);
  const [voiceChoice, setVoiceChoice] = useState<string>("veo");
  const [script, setScript] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const creditsCost = voiceChoice === "veo" ? VEO_VOICE_CREDIT_COST : LUCY_VOICE_CREDIT_COST;

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setVideoUrl(null);
    try {
      const res = await fetch("/api/generate-character-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: token, character_id: characterId, voice_choice: voiceChoice, script }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      const jobId = data.jobId as string;

      const startedAt = Date.now();
      for (;;) {
        if (Date.now() - startedAt > CHARACTER_POLL_TIMEOUT_MS) throw new Error("Taking much longer than usual - try again shortly.");
        await new Promise((resolve) => setTimeout(resolve, CHARACTER_POLL_INTERVAL_MS));
        const statusRes = await fetch(`/api/generate-character-video/status?jobId=${encodeURIComponent(jobId)}`);
        const statusData = await statusRes.json();
        if (statusData.status === "COMPLETED") {
          setVideoUrl(statusData.videoUrl);
          break;
        }
        if (statusData.status === "FAILED") throw new Error(statusData.error ?? "Generation failed");
      }
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
      title="Pick a character, make an ad"
      subtitle="5 pre-made AI actors - choose one, pick a voice, type a script."
    >
      {!token ? (
        <p className="rounded-2xl bg-white/70 p-3 text-sm text-muted">
          This needs the Video plan and an access code - paste yours above (or{" "}
          <a href="/billing" className="font-semibold text-purple underline">
            see plans
          </a>
          ) to use it.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-5 gap-2">
            {CHARACTERS.map((c) => (
              <button
                key={c.id}
                onClick={() => setCharacterId(c.id)}
                className="flex flex-col items-center gap-1"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={c.imageUrl}
                  alt={c.name}
                  className={`h-16 w-16 rounded-full object-cover shadow-soft transition ${
                    characterId === c.id ? "ring-4 ring-purple" : "opacity-70 hover:opacity-100"
                  }`}
                />
                <span className={`text-xs ${characterId === c.id ? "font-bold text-purple" : "text-muted"}`}>{c.name}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setVoiceChoice("veo")}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                voiceChoice === "veo" ? "bg-purple text-white shadow-soft" : "bg-white text-muted"
              }`}
            >
              This character&apos;s own voice ({VEO_VOICE_CREDIT_COST} credits)
            </button>
            {PRESET_VOICES.map((v) => (
              <button
                key={v.id}
                onClick={() => setVoiceChoice(v.id)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                  voiceChoice === v.id ? "bg-purple text-white shadow-soft" : "bg-white text-muted"
                }`}
              >
                {v.label} ({LUCY_VOICE_CREDIT_COST} credits)
              </button>
            ))}
          </div>
          {voiceChoice === "veo" && (
            <p className="text-xs italic leading-relaxed text-coral-dark">
              Heads up: the character&apos;s own voice re-generates the whole scene, and in testing this has
              sometimes drifted to a different-looking face than the photo shown above - a real, unresolved
              limitation. A Lucy voice (Kling Avatar lip-sync onto the actual photo) is more reliable for
              keeping the exact character.
            </p>
          )}

          <textarea
            className="w-full rounded-2xl border border-border bg-white p-4 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-purple"
            rows={3}
            placeholder="What should they say?"
            value={script}
            onChange={(e) => setScript(e.target.value)}
          />

          <button
            onClick={handleGenerate}
            disabled={loading || !script.trim()}
            className="w-full rounded-2xl bg-purple py-3 text-sm font-bold text-white shadow-soft disabled:opacity-50"
          >
            {loading ? "Generating… (usually 30-90s)" : `Generate (${creditsCost} video credits)`}
          </button>

          {error && <p className="rounded-2xl bg-white/70 p-3 text-sm text-coral-dark">{error}</p>}
          {videoUrl && <video className="w-full rounded-xl" src={videoUrl} controls autoPlay loop playsInline />}
        </>
      )}

      <p className="text-xs italic leading-relaxed text-muted">
        Video credits come from your Video plan&apos;s existing 40/month allotment - a Lucy-voice video costs{" "}
        {LUCY_VOICE_CREDIT_COST} credits (real lip-sync via Kling Avatar), the character&apos;s own Veo-generated voice costs{" "}
        {VEO_VOICE_CREDIT_COST} (Veo generates both the video and the dialogue).
      </p>
    </Card>
  );
}

const PAYGO_ENGINES: { id: "veo" | "kling" | "seedance"; label: string; blurb: string }[] = [
  { id: "veo", label: "Veo", blurb: "Most realistic, 8s clips" },
  { id: "kling", label: "Kling", blurb: "Reliable, 5s clips" },
  { id: "seedance", label: "Seedance", blurb: "Stylized/UGC look, 8s clips" },
];

const PAYGO_PACKS = [
  { id: "single", credits: 1, priceLabel: "$6.99" },
  { id: "pack5", credits: 5, priceLabel: "$32.00" },
  { id: "pack10", credits: 10, priceLabel: "$59.00" },
];

const PAYGO_POLL_INTERVAL_MS = 3000;
const PAYGO_POLL_TIMEOUT_MS = 300_000; // 5 min - each of these engines' own generation is short, not a long-form narration

function PayAsYouGoVideoSection() {
  const [signedIn, setSignedIn] = useState(false);
  const [balance, setBalance] = useState(0);
  const [engine, setEngine] = useState<"veo" | "kling" | "seedance">("veo");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [buyingPack, setBuyingPack] = useState<string | null>(null);

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
    setVideoUrl(null);
    try {
      const res = await fetch("/api/video-paygo/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engine, prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      const jobId = data.jobId as string;

      const startedAt = Date.now();
      for (;;) {
        if (Date.now() - startedAt > PAYGO_POLL_TIMEOUT_MS) throw new Error("Taking much longer than usual - try again shortly.");
        await new Promise((resolve) => setTimeout(resolve, PAYGO_POLL_INTERVAL_MS));
        const statusRes = await fetch(`/api/video-paygo/status?jobId=${encodeURIComponent(jobId)}`);
        const statusData = await statusRes.json();
        if (statusData.status === "COMPLETED") {
          setVideoUrl(statusData.videoUrl);
          break;
        }
        if (statusData.status === "FAILED") throw new Error(statusData.error ?? "Generation failed");
      }
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
      title="Pay as you go: any prompt, any engine"
      subtitle="Type any prompt, pick Kling, Veo, or Seedance, get an 8-second (5s for Kling) 720p video - no subscription."
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
            {PAYGO_PACKS.map((pack) => (
              <button
                key={pack.id}
                onClick={() => handleBuy(pack.id)}
                disabled={buyingPack !== null}
                className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-purple shadow-soft disabled:opacity-50"
              >
                {buyingPack === pack.id ? "Redirecting…" : `${pack.credits} video${pack.credits > 1 ? "s" : ""} - ${pack.priceLabel}`}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            {PAYGO_ENGINES.map((e) => (
              <button
                key={e.id}
                onClick={() => setEngine(e.id)}
                className={`flex-1 rounded-2xl border p-2 text-center text-xs transition ${
                  engine === e.id ? "border-purple bg-purple text-white shadow-soft" : "border-border bg-white text-muted"
                }`}
              >
                <div className="font-bold">{e.label}</div>
                <div className="mt-0.5">{e.blurb}</div>
              </button>
            ))}
          </div>

          <textarea
            className="w-full rounded-2xl border border-border bg-white p-4 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-purple"
            rows={3}
            placeholder="Describe the video you want..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />

          <button
            onClick={handleGenerate}
            disabled={loading || !prompt.trim() || balance < 1}
            className="w-full rounded-2xl bg-purple py-3 text-sm font-bold text-white shadow-soft disabled:opacity-50"
          >
            {loading ? "Generating… (usually 30-90s)" : balance < 1 ? "Buy credits to generate" : "Generate (1 credit)"}
          </button>

          {error && <p className="rounded-2xl bg-white/70 p-3 text-sm text-coral-dark">{error}</p>}
          {videoUrl && <video className="w-full rounded-xl" src={videoUrl} controls autoPlay loop playsInline />}
        </>
      )}

      <p className="text-xs italic leading-relaxed text-muted">
        Same flat price per video regardless of engine - real clip length differs (Kling is a hard 5s, Veo/Seedance are 8s) since
        each vendor's own API enforces different duration limits, not something we can unify further on our end.
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
        <VideoCloneSection />
        <CharacterVideoSection />
        <PayAsYouGoVideoSection />
        <Footer />
      </main>
    </div>
  );
}
