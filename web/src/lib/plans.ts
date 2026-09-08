/**
 * Pricing tiers. Character limits are enforced server-side in src/lib/db.ts
 * - these are the single source of truth, referenced by both the Stripe
 * checkout flow and the usage-gating middleware, so a plan change here
 * takes effect everywhere at once.
 *
 * Two separate quota systems, deliberately not the same unit:
 * - Audio: plain CHARACTERS of text-to-speech. Cost basis: Chatterbox
 *   generation costs roughly $0.002/minute of output in GPU time, so even
 *   a Plus user maxing out their monthly cap costs us well under $1
 *   against a $3 subscription.
 * - Video: VIDEO CREDITS (see VIDEO_CREDIT_COSTS below) - not seconds
 *   directly, because a talking-head second and a cinematic second cost
 *   very different amounts in real vendor fees (fal.ai, proxying Kling/
 *   Veo), so a flat "seconds" cap would let a cinematic-only user cost
 *   ~2.7x what the cap was priced for. Reviewed against worst-case COGS
 *   2026-09-08 (see PROJECT_CONTEXT.md Sec 12 / STATUS.md "Pricing/margin
 *   review"): every allotment below is sized to hold >=56% gross margin
 *   even if a subscriber spends their entire credit balance on the single
 *   most expensive option (worst case, not the average case). Do not
 *   raise these caps without re-running that check.
 *
 * Video credits are reserved/aspirational, not a working feature yet -
 * our zero-shot video quality is well behind production tools like Kling
 * or Veo (see PROJECT_CONTEXT.md Sec 8/12 and the video section on the
 * home page, which says this plainly). Kept on each plan rather than
 * removed so subscribers have the allotment the moment it ships, but
 * billing/page.tsx is explicit that it's not there yet.
 */
export type PlanId = "free" | "plus" | "pro";

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
  plus: {
    id: "plus",
    name: "Plus",
    priceUsdCents: 300,
    stripePriceEnvVar: "STRIPE_PRICE_PLUS",
    charactersPerMonth: 200_000,
    videoCreditsPerMonth: 15, // worst-case (all talking-head) COGS ~$0.84, ~59% margin at $3
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceUsdCents: 900,
    stripePriceEnvVar: "STRIPE_PRICE_PRO",
    charactersPerMonth: 1_500_000,
    videoCreditsPerMonth: 60, // worst-case (all talking-head) COGS ~$3.37, ~56% margin at $9
  },
};

export function planFromStripePriceId(priceId: string): PlanId | null {
  if (priceId === process.env.STRIPE_PRICE_PLUS) return "plus";
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  return null;
}
