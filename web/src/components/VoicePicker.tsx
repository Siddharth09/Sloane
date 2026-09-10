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
];

export function VoicePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-4">
      {PRESET_VOICES.map((v) => {
        const selected = value === v.id;
        return (
          <button
            key={v.id}
            onClick={() => onChange(v.id)}
            className="flex flex-col items-center gap-1.5"
          >
            <span
              className={`flex h-14 w-14 items-center justify-center rounded-full text-lg font-bold text-white ${v.color} transition-all ${
                selected
                  ? "shadow-soft-lg scale-[1.3] brightness-75 saturate-150 ring-4 ring-coral ring-offset-2 ring-offset-surface"
                  : "shadow-soft opacity-70 hover:opacity-100"
              }`}
            >
              {v.initial}
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
