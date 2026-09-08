/**
 * Two real, honest controls over generated delivery:
 * - Expressiveness: Chatterbox's actual "exaggeration" parameter (flat <->
 *   animated intensity). Named for what it does, not framed as an emotion
 *   picker - there's no happy/sad dial, see PROJECT_CONTEXT.md "Voice
 *   tuning requests".
 * - Speed: real audio time-stretching applied after generation (genuinely
 *   changes pacing, unlike exaggeration/cfg_weight which only influence
 *   generation itself).
 */
export type Delivery = { expressiveness: number; speed: number };

export const DEFAULT_DELIVERY: Delivery = { expressiveness: 0.6, speed: 1.0 };

export function DeliverySliders({
  value,
  onChange,
  accentColor,
}: {
  value: Delivery;
  onChange: (next: Delivery) => void;
  accentColor: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-white/60 p-4">
      <label className="flex flex-col gap-1.5">
        <span className="flex items-center justify-between text-xs font-semibold text-foreground">
          <span>Expressiveness</span>
          <span className="text-muted">{value.expressiveness < 0.55 ? "Flat" : value.expressiveness > 0.75 ? "Animated" : "Natural"}</span>
        </span>
        <input
          type="range"
          min={0.3}
          max={1.0}
          step={0.05}
          value={value.expressiveness}
          onChange={(e) => onChange({ ...value, expressiveness: Number(e.target.value) })}
          className={accentColor}
          style={{ accentColor: "currentColor" }}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="flex items-center justify-between text-xs font-semibold text-foreground">
          <span>Speed</span>
          <span className="text-muted">{value.speed < 0.9 ? "Slower" : value.speed > 1.1 ? "Faster" : "Normal"}</span>
        </span>
        <input
          type="range"
          min={0.7}
          max={1.3}
          step={0.05}
          value={value.speed}
          onChange={(e) => onChange({ ...value, speed: Number(e.target.value) })}
          className={accentColor}
          style={{ accentColor: "currentColor" }}
        />
      </label>
    </div>
  );
}
