/**
 * Pricing tiers. Character limits are enforced server-side in src/lib/db.ts
 * - these are the single source of truth, referenced by both the Stripe
 * checkout flow and the usage-gating middleware, so a plan change here
 * takes effect everywhere at once.
 *
 * **Re-priced twice on 2026-09-09** - first to $6/$20 after discovering the
 * original $3/200k and $9/1.5M numbers were built on a stale "$0.002/min"
 * cost assumption (measured against real RunPod Serverless jobs the same
 * day: actual cost is ~$0.06-0.09/minute of output audio, 30-45x higher -
 * see git history on this file for that full analysis if needed). Then
 * restructured again per direct user feedback: keep $3 as a real entry
 * price point, but pair it with a correspondingly smaller cap instead of
 * the old large one, and split video into its own dedicated tier rather
 * than bundling it into the top audio tier.
 *
 * Final structure - 4 tiers, audio-only Free/Starter/Plus plus a Video
 * tier that bundles both:
 *
 * - Audio COGS: **$0.00008/character** (~$80/million), from real measured
 *   RunPod data (0.14-0.18s of billed GPU compute per character - whisper-
 *   verification retries + DSP post-processing on top of raw generation,
 *   not just raw generation time - at the worst-case GPU rate in the
 *   endpoint's pool, $1.58/hr). Every audio allotment below is sized so a
 *   subscriber maxing their ENTIRE monthly quota still holds ~60% gross
 *   margin - worst case, not average case. This was 2 real data points,
 *   not a large sample - re-run this measurement before raising any cap.
 *
 * - Video COGS: real fal.ai vendor list prices (Kling Avatar Standard
 *   ~$0.0562/s talking-head, Veo 3.1 Fast+audio ~$0.15/s cinematic), via
 *   VIDEO_CREDIT_COSTS below. Talking-head actually costs MORE per credit
 *   than cinematic ($0.0562 vs $0.05), so "all talking-head" is the real
 *   worst case for a credit balance, not the more expensive-sounding
 *   cinematic mode. The Video tier's credits are sized against that
 *   worst case at ~60% combined margin (audio + video COGS together).
 *
 * Video credits/generation are reserved/aspirational, not a working
 * feature yet - our zero-shot video quality is well behind production
 * tools like Kling or Veo (see PROJECT_CONTEXT.md Sec 8/12 and the video
 * section on the home page, which says this plainly). Kept on the Video
 * plan rather than removed so subscribers have the allotment the moment
 * it ships, but billing/page.tsx is explicit that it's not there yet.
 */
export type PlanId = "free" | "starter" | "plus" | "video";

// What one video credit buys, if/when video ships - these ratios come
// directly from real fal.ai list prices (Kling Avatar Standard ~$0.0562/s
// talking-head, Veo 3.1 Fast+audio ~$0.15/s cinematic), so the credit
// costs below track real COGS instead of an arbitrary made-up ratio.
export const VIDEO_CREDIT_COSTS = {
  talkingHeadSecondsPerCredit: 1, // 1 credit = 1 second of talking-head (Kling Avatar Standard + Lucy TTS)
  cinematicSecondsPerCredit: 1 / 3, // 1 credit = 1/3 second of cinematic (Veo Fast + audio) - ~2.7x the per-second cost of talking-head
};

export type Plan = {
  id: PlanId;
  name: string;
  priceUsdCents: number;
  stripePriceEnvVar: string; // which env var holds this plan's Stripe Price ID
  charactersPerMonth: number;
  videoCreditsPerMonth: number;
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceUsdCents: 0,
    stripePriceEnvVar: "",
    charactersPerMonth: 10_000,
    videoCreditsPerMonth: 0,
  },
  starter: {
    id: "starter",
    name: "Starter",
    priceUsdCents: 300,
    stripePriceEnvVar: "STRIPE_PRICE_STARTER",
    charactersPerMonth: 15_000, // worst-case audio COGS ~$1.20, ~60% margin at $3
    videoCreditsPerMonth: 0,
  },
  plus: {
    id: "plus",
    name: "Plus",
    priceUsdCents: 600,
    stripePriceEnvVar: "STRIPE_PRICE_PLUS",
    charactersPerMonth: 30_000, // worst-case audio COGS ~$2.40, ~60% margin at $6
    videoCreditsPerMonth: 0,
  },
  video: {
    id: "video",
    name: "Video",
    priceUsdCents: 1200,
    stripePriceEnvVar: "STRIPE_PRICE_VIDEO",
    // Same 30k audio allotment as Plus (COGS ~$2.40) + 40 video credits
    // (worst-case all-talking-head COGS ~$2.25) = ~$4.65 combined COGS,
    // ~61% margin at $12. 40 credits ~= 40s talking-head or ~13s cinematic.
    charactersPerMonth: 30_000,
    videoCreditsPerMonth: 40,
  },
};

export function planFromStripePriceId(priceId: string): PlanId | null {
  if (priceId === process.env.STRIPE_PRICE_STARTER) return "starter";
  if (priceId === process.env.STRIPE_PRICE_PLUS) return "plus";
  if (priceId === process.env.STRIPE_PRICE_VIDEO) return "video";
  return null;
}
