"use client";

import { useRef, useState } from "react";
import { PRESET_VOICES, type Voice } from "@/lib/presetVoices";

// Re-exported for backward compatibility - every existing import of these
// from "@/components/VoicePicker" (page.tsx, characters.ts, mobile,
// generate-cinematic-video/route.ts) keeps working unchanged. The actual
// data now lives in @/lib/presetVoices.ts - see that file's comment for
// why (a real bug this fixes: server Route Handlers importing a plain
// array from a "use client" file).
export { PRESET_VOICES, type Voice };

export function VoicePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  // Clicking a bubble both selects that voice for generation (unchanged)
  // and toggles a canned preview sample - click once to hear it, click the
  // same bubble again while it's playing to stop, click again to replay.
  // One shared <audio> element (not per-bubble) since only one preview can
  // ever play at once. Deliberately not tied to PresetVoiceSection's own
  // result player in page.tsx - previewing a voice should never interfere
  // with listening to what the user actually generated.
  function handleClick(id: string) {
    onChange(id);
    const audio = audioRef.current;
    if (!audio) return;
    if (playingId === id) {
      audio.pause();
      audio.currentTime = 0;
      setPlayingId(null);
      return;
    }
    audio.pause();
    audio.src = `/voice-samples/${id}.wav`;
    audio.currentTime = 0;
    audio.play().catch(() => {});
    setPlayingId(id);
  }

  return (
    <div className="flex flex-wrap gap-4">
      <audio ref={audioRef} onEnded={() => setPlayingId(null)} className="hidden" />
      {PRESET_VOICES.map((v) => {
        const selected = value === v.id;
        const playing = playingId === v.id;
        return (
          <button
            key={v.id}
            onClick={() => handleClick(v.id)}
            className="flex flex-col items-center gap-1.5"
          >
            <span
              className={`relative flex h-14 w-14 items-center justify-center rounded-full text-lg font-bold text-white ${v.color} transition-all ${
                selected
                  ? "shadow-soft-lg scale-[1.3] brightness-75 saturate-150 ring-4 ring-coral ring-offset-2 ring-offset-surface"
                  : "shadow-soft opacity-70 hover:opacity-100"
              }`}
            >
              {v.initial}
              {playing && (
                <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[9px] shadow-soft">
                  🔊
                </span>
              )}
            </span>
            <span
              className={`rounded-full transition-all ${
                selected
                  ? "shadow-soft bg-coral px-2.5 py-0.5 text-xs font-bold text-white"
                  : "px-2.5 py-0.5 text-xs text-muted"
              }`}
            >
              {v.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
