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
  title,
  subtitle,
  children,
}: {
  color: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
        <h2 className="text-lg font-extrabold">{title}</h2>
      </div>
      <p className="mt-1 text-sm text-muted">{subtitle}</p>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
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
    <Card color="bg-rose" title="Text to speech" subtitle="Type anything, pick a voice, hear it narrated — no length limit.">
      <textarea
        className="w-full rounded-2xl border border-border bg-white p-4 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-coral"
        rows={4}
        placeholder="Type what you want narrated..."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <VoicePicker value={voiceId} onChange={setVoiceId} />
      <button
        className="rounded-full bg-coral py-3 text-sm font-bold text-white transition disabled:opacity-40"
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
      color="bg-lavender"
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
        className="rounded-full bg-coral py-3 text-sm font-bold text-white transition disabled:opacity-40"
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
      color="bg-butter"
      title="Clone a video"
      subtitle="Record with your camera or upload a clip, then type what it should say. (In progress — see PROJECT_CONTEXT.md.)"
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
        className="rounded-full bg-coral py-3 text-sm font-bold text-white transition disabled:opacity-40"
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
    <div className="min-h-screen bg-background px-6 py-16">
      <main className="mx-auto flex max-w-2xl flex-col gap-8">
        <div>
          <h1 className="text-3xl font-extrabold text-foreground">Lucy</h1>
          <p className="mt-1 text-sm text-muted">
            by Lucy Labs — private prototype. Requires the RunPod inference server; falls back to
            a local mock if NEXT_PUBLIC_API_BASE isn&apos;t set.
          </p>
        </div>
        <PresetVoiceSection />
        <CloneVoiceSection />
        <VideoCloneSection />
      </main>
    </div>
  );
}
