"use client";

import { useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

const PRESET_VOICES = [
  { id: "art_instructor", label: "Art Instructor" },
  { id: "music_instructor", label: "Music Instructor" },
];

function AudioResult({ url }: { url: string | null }) {
  if (!url) return null;
  return <audio className="mt-4 w-full" controls src={`${API_BASE}${url}`} />;
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
    <section className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
      <h2 className="text-lg font-semibold">Text to speech — preset voices</h2>
      <p className="mt-1 text-sm text-zinc-500">Type text, pick a voice, hear it read back.</p>

      <textarea
        className="mt-4 w-full rounded-md border border-zinc-300 p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        rows={4}
        placeholder="Type what you want narrated..."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <select
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          value={voiceId}
          onChange={(e) => setVoiceId(e.target.value)}
        >
          {PRESET_VOICES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>

        <button
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
          disabled={!text || loading}
          onClick={handleGenerate}
        >
          {loading ? "Generating..." : "Generate"}
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <AudioResult url={audioUrl} />
    </section>
  );
}

function CloneVoiceSection() {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
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
      form.append("reference_audio", file);
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
    <section className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
      <h2 className="text-lg font-semibold">Clone a voice from a clip</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Upload ~30-60 seconds of a voice, type any text, hear it read back in that voice.
      </p>

      <input
        className="mt-4 block w-full text-sm"
        type="file"
        accept="audio/*"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />

      <textarea
        className="mt-3 w-full rounded-md border border-zinc-300 p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        rows={4}
        placeholder="Type what you want read back in the uploaded voice..."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <button
        className="mt-3 rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        disabled={!text || !file || loading}
        onClick={handleGenerate}
      >
        {loading ? "Generating..." : "Generate"}
      </button>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <AudioResult url={audioUrl} />
    </section>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-16 dark:bg-black">
      <main className="mx-auto flex max-w-2xl flex-col gap-8">
        <div>
          <h1 className="text-2xl font-bold">Sloane</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Private prototype — both sections currently return a mock tone until the RunPod
            Chatterbox backend is wired up (see PROJECT_CONTEXT.md, Phase 4).
          </p>
        </div>
        <PresetVoiceSection />
        <CloneVoiceSection />
      </main>
    </div>
  );
}
