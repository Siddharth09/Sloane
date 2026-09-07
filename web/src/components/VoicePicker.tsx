export type Voice = { id: string; label: string; color: string; initial: string };

export const PRESET_VOICES: Voice[] = [
  { id: "art_instructor", label: "Kirsty", color: "bg-rose", initial: "K" },
  { id: "music_instructor", label: "Matt", color: "bg-sage", initial: "M" },
  { id: "voice_business", label: "Alice", color: "bg-pink", initial: "A" },
  { id: "voice_finance", label: "Megan", color: "bg-blue", initial: "M" },
  { id: "voice_broadcast", label: "Katie", color: "bg-purple", initial: "K" },
  { id: "voice_tech", label: "Brad", color: "bg-butter", initial: "B" },
  { id: "voice_comedy", label: "Izzy", color: "bg-lavender", initial: "I" },
  { id: "voice_sales", label: "Robbo", color: "bg-coral", initial: "R" },
  { id: "voice_meditation", label: "Michelle", color: "bg-coral-dark", initial: "F" },
  { id: "voice_mark", label: "Mark", color: "bg-sage", initial: "M" },
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
              className={`shadow-soft flex h-14 w-14 items-center justify-center rounded-full text-lg font-bold text-white ${v.color} transition ${
                selected
                  ? "ring-4 ring-coral ring-offset-2 ring-offset-surface"
                  : "opacity-75 hover:opacity-100"
              }`}
            >
              {v.initial}
            </span>
            <span className={`text-xs ${selected ? "font-semibold text-foreground" : "text-muted"}`}>
              {v.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
