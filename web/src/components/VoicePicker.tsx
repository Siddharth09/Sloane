export type Voice = { id: string; label: string; color: string; initial: string };

export const PRESET_VOICES: Voice[] = [
  { id: "art_instructor", label: "Art Instructor", color: "bg-rose", initial: "A" },
  { id: "music_instructor", label: "Music Instructor", color: "bg-sage", initial: "M" },
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
