"use client";

import { useState } from "react";
import { AccountWidget } from "@/components/AccountWidget";
import { Footer } from "@/components/Footer";
import { LogoMark } from "@/components/LogoMark";
import { RecordOrUpload } from "@/components/RecordOrUpload";
import { ShareButtons } from "@/components/ShareButtons";
import { VoicePicker, PRESET_VOICES } from "@/components/VoicePicker";
import { DeliverySliders, DEFAULT_DELIVERY, type Delivery } from "@/components/DeliverySliders";
import { useAccessToken } from "@/lib/useAccessToken";

// Video cloning isn't wired to the gated proxy yet (Feature C backend still
// in progress - see PROJECT_CONTEXT.md), so it still calls the inference
// server's public URL directly for now.
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

function ResultPlayer({ url, kind }: { url: string | null; kind: "audio" | "video" }) {
  if (!url) return null;
  // generate-preset/clone-voice now return a path on our own domain
  // (/api/audio/<file>.wav); clone-video still returns a path relative to
  // API_BASE (not yet wired through a proxy - still hits the GPU pod directly).
  const fullUrl = url.startsWith("http") ? url : `${url.startsWith("/api/") ? "" : API_BASE}${url}`;
  const filename = url.split("/").pop();
  return (
    <div className="mt-4">
      {kind === "video" ? (
        <video className="w-full rounded-xl" src={fullUrl} controls />
      ) : (
        <audio className="w-full" src={fullUrl} controls />
      )}
      {kind === "audio" && filename && (
        <a
          href={`/api/download-mp3?file=${encodeURIComponent(filename)}&name=lucy-${Date.now()}`}
          className="mt-3 inline-block rounded-full border border-border bg-white px-4 py-2 text-xs font-semibold text-foreground hover:bg-white/70"
        >
          Download MP3
        </a>
      )}
      <ShareButtons url={fullUrl} text="Listen to what I made with Lucy!" />
    </div>
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
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("text", text);
      form.append("voice_id", voiceId);
      form.append("exaggeration", String(delivery.expressiveness));
      form.append("speed", String(delivery.speed));
      if (token) form.append("access_token", token);
      const res = await fetch("/api/generate-preset", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setAudioUrl(data.audio_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card
      wash="bg-pink-wash/90"
      iconColor="text-pink"
      icon="✎"
      title="Text to speech"
      subtitle="Type anything, pick a voice, hear it narrated — no length limit."
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
      <button
        className="shadow-soft rounded-full bg-pink py-3 text-sm font-bold text-white transition hover:brightness-105 active:brightness-95 disabled:opacity-40 disabled:shadow-none"
        disabled={!text || loading}
        onClick={handleGenerate}
      >
        {loading ? "Generating…" : "Generate"}
      </button>
      {error && <p className="text-sm text-coral-dark">{error}</p>}
      <ResultPlayer url={audioUrl} kind="audio" />
    </Card>
  );
}

function CloneVoiceSection() {
  const { token } = useAccessToken();
  const [text, setText] = useState("");
  const [file, setFile] = useState<Blob | File | null>(null);
  const [delivery, setDelivery] = useState<Delivery>(DEFAULT_DELIVERY);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("text", text);
      form.append("reference_audio", file, "reference.webm");
      form.append("exaggeration", String(delivery.expressiveness));
      form.append("speed", String(delivery.speed));
      if (token) form.append("access_token", token);
      const res = await fetch("/api/clone-voice", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setAudioUrl(data.audio_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card
      wash="bg-blue-wash/90"
      iconColor="text-blue"
      icon="🎙"
      title="Clone any voice"
      subtitle="Record or upload ~10-20 seconds of a voice, then type what it should say. Custom audio generation has some latency — it may take a couple minutes to load."
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
      <button
        className="shadow-soft rounded-full bg-blue py-3 text-sm font-bold text-white transition hover:brightness-105 active:brightness-95 disabled:opacity-40 disabled:shadow-none"
        disabled={!text || !file || loading}
        onClick={handleGenerate}
      >
        {loading ? "Generating…" : "Generate"}
      </button>
      {error && <p className="text-sm text-coral-dark">{error}</p>}
      <ResultPlayer url={audioUrl} kind="audio" />
    </Card>
  );
}

function VideoCloneSection() {
  return (
    <Card
      wash="bg-purple-wash/90"
      iconColor="text-purple"
      icon="🎬"
      title="Video, coming later"
      subtitle="Not a real feature yet — just a peek at where we're headed."
    >
      <video
        className="w-full rounded-xl"
        src="/echomimic-demo.mp4"
        controls
        loop
        muted
        playsInline
      />
      <p className="text-sm leading-relaxed text-muted">
        We at Lucy Labs aren&apos;t ready for video yet, but we&apos;re working on it. The clip above is
        one of our own early tests — a still photo animated to match audio. It&apos;s clearly not
        perfect, and we&apos;d rather be upfront about that than oversell it. If you need
        production-quality AI video today, the current best options are{" "}
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
        (the engine behind the &quot;Chloe vs History&quot; AI creator). We&apos;ll bring real video
        cloning here once it&apos;s actually good.
      </p>
    </Card>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen px-6 py-20">
      <main className="mx-auto flex max-w-2xl flex-col gap-10">
        <div className="mx-auto rounded-[32px] border border-white/60 bg-surface/90 px-8 py-8 text-center shadow-soft-lg backdrop-blur-xl">
          <a href="/" className="shadow-soft inline-flex rounded-3xl">
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
