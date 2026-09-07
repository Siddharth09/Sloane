"use client";

import { useState } from "react";
import { RecordOrUpload } from "@/components/RecordOrUpload";
import { ShareButtons } from "@/components/ShareButtons";
import { VoicePicker, PRESET_VOICES } from "@/components/VoicePicker";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

function ResultPlayer({ url, kind }: { url: string | null; kind: "audio" | "video" }) {
  if (!url) return null;
  const fullUrl = `${API_BASE}${url}`;
  return (
    <div className="mt-4">
      {kind === "video" ? (
        <video className="w-full rounded-xl" src={fullUrl} controls />
      ) : (
        <audio className="w-full" src={fullUrl} controls />
      )}
      <ShareButtons url={fullUrl} text="Listen to what I made with Lucy!" />
    </div>
  );
}

function Card({
  color,
  icon,
  title,
  subtitle,
  children,
}: {
  color: string;
  icon: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="shadow-soft rounded-[28px] border border-border bg-surface p-7 transition hover:shadow-soft-lg">
      <div className="flex items-center gap-3.5">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-lg ${color}`}
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
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState(PRESET_VOICES[0].id);
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
      const res = await fetch(`${API_BASE}/api/generate-preset`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setAudioUrl(data.audio_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card
      color="bg-rose/25 text-rose"
      icon="✎"
      title="Text to speech"
      subtitle="Type anything, pick a voice, hear it narrated — no length limit."
    >
      <textarea
        className="w-full rounded-2xl border border-border bg-white p-4 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-coral"
        rows={4}
        placeholder="Type what you want narrated..."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <VoicePicker value={voiceId} onChange={setVoiceId} />
      <button
        className="shadow-soft rounded-full bg-gradient-to-b from-coral to-coral-dark py-3 text-sm font-bold text-white transition hover:brightness-105 active:brightness-95 disabled:opacity-40 disabled:shadow-none"
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
  const [text, setText] = useState("");
  const [file, setFile] = useState<Blob | File | null>(null);
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
      const res = await fetch(`${API_BASE}/api/clone-voice`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setAudioUrl(data.audio_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card
      color="bg-lavender/25 text-lavender"
      icon="🎙"
      title="Clone any voice"
      subtitle="Record or upload ~10-20 seconds of a voice, then type what it should say."
    >
      <RecordOrUpload kind="audio" onChange={setFile} />
      <textarea
        className="w-full rounded-2xl border border-border bg-white p-4 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-coral"
        rows={4}
        placeholder="Type what you want read back in that voice..."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        className="shadow-soft rounded-full bg-gradient-to-b from-coral to-coral-dark py-3 text-sm font-bold text-white transition hover:brightness-105 active:brightness-95 disabled:opacity-40 disabled:shadow-none"
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
  const [text, setText] = useState("");
  const [file, setFile] = useState<Blob | File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("text", text);
      form.append("reference_video", file, "reference.webm");
      const res = await fetch(`${API_BASE}/api/clone-video`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setVideoUrl(data.video_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Coming soon — video cloning is still being built.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card
      color="bg-butter/25 text-butter"
      icon="🎬"
      title="Clone a video"
      subtitle="Record with your camera or upload a clip, then type what it should say. (In progress.)"
    >
      <RecordOrUpload kind="video" onChange={setFile} />
      <textarea
        className="w-full rounded-2xl border border-border bg-white p-4 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-coral"
        rows={4}
        placeholder="Type what you want the video to say..."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        className="shadow-soft rounded-full bg-gradient-to-b from-coral to-coral-dark py-3 text-sm font-bold text-white transition hover:brightness-105 active:brightness-95 disabled:opacity-40 disabled:shadow-none"
        disabled={!text || !file || loading}
        onClick={handleGenerate}
      >
        {loading ? "Generating…" : "Generate"}
      </button>
      {error && <p className="text-sm text-coral-dark">{error}</p>}
      <ResultPlayer url={videoUrl} kind="video" />
    </Card>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen px-6 py-20">
      <main className="mx-auto flex max-w-2xl flex-col gap-10">
        <div className="text-center">
          <span className="shadow-soft inline-flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-rose to-coral text-2xl font-extrabold text-white">
            L
          </span>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-foreground">Lucy</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
            by Lucy Labs — narrate, clone, and share, in a voice that sounds like someone real.
          </p>
        </div>
        <PresetVoiceSection />
        <CloneVoiceSection />
        <VideoCloneSection />
      </main>
    </div>
  );
}
