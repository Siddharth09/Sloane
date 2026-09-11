"use client";

import { useRef, useState } from "react";

export type Voice = { id: string; label: string; color: string; initial: string };

export const PRESET_VOICES: Voice[] = [
  { id: "art_instructor", label: "Vicky", color: "bg-rose", initial: "V" },
  { id: "music_instructor", label: "Patrick", color: "bg-sage", initial: "P" },
  { id: "voice_business", label: "Alice", color: "bg-pink", initial: "A" },
  { id: "voice_finance", label: "Megan", color: "bg-blue", initial: "M" },
  { id: "voice_broadcast", label: "Katie", color: "bg-purple", initial: "K" },
  { id: "voice_tech", label: "Brad", color: "bg-butter", initial: "B" },
  { id: "voice_comedy", label: "Izzy", color: "bg-lavender", initial: "I" },
  { id: "voice_sales", label: "Robbo", color: "bg-coral", initial: "R" },
  { id: "voice_mark", label: "Mark", color: "bg-sage", initial: "M" },
  // Adam/Rachel added 2026-09-10 - 11 voices, only 9 defined brand colors,
  // so these reuse existing ones (freed bg-coral-dark from Michelle's
  // removal; bg-rose shared with Vicky) rather than inventing new ones -
  // same documented design constraint as Patrick/Mark sharing bg-sage.
  { id: "voice_adam", label: "Adam", color: "bg-coral-dark", initial: "A" },
  { id: "voice_rachel", label: "Rachel", color: "bg-rose", initial: "R" },
  { id: "voice_emily", label: "Emily", color: "bg-blue", initial: "E" },
  // Harper (2026-09-11) - zero-shot cloned from the surfing ads-demo clip's
  // own audio (see scripts/lucy_tts_engine.py's ZERO_SHOT_PRESET_VOICES),
  // not a real fine-tune - honest quality expectation is a rougher
  // approximation than the other 12, whose LoRA adapters were each trained
  // on many minutes of real source audio. Reuses bg-pink (already Alice's)
  // - same documented color-reuse constraint as Patrick/Mark sharing sage.
  { id: "harper", label: "Harper", color: "bg-pink", initial: "H" },
  // 2026-09-11: jess (second, distinct Irish accent - see characters.ts,
  // now Jess/formerly-Vicky's character-video default; originally named
  // "Aoife", renamed to "Jess" per direct request to match the character's
  // own renaming) + liam/ryan/tyler ("male version of Izzy/Katie/Harper",
  // matched by accent/vibe not timbre). All 4 are zero-shot from
  // Veo-generated reference clips, same honest-quality caveat as Harper
  // above - reuses colors per the same documented 9-colors-for-more-voices
  // constraint.
  { id: "jess", label: "Jess", color: "bg-lavender", initial: "J" },
  { id: "liam", label: "Liam", color: "bg-purple", initial: "L" },
  { id: "ryan", label: "Ryan", color: "bg-butter", initial: "R" },
  { id: "tyler", label: "Tyler", color: "bg-coral", initial: "T" },
];

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
