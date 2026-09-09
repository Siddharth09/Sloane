/**
 * Pricing tiers. Character limits are enforced server-side in src/lib/db.ts
 * - these are the single source of truth, referenced by both the Stripe
 * checkout flow and the usage-gating middleware, so a plan change here
 * takes effect everywhere at once.
 *
 * Two separate quota systems, deliberately not the same unit:
 *
 * - Audio: plain CHARACTERS of text-to-speech.
 *
 *   **Re-priced 2026-09-09 - the original $3/200k and $9/1.5M numbers were
 *   built on a stale "$0.002/minute" cost assumption that was never
 *   measured against the real pipeline.** Actually measured against live
 *   RunPod Serverless jobs the same day: a ~300-character generation took
 *   44-55 SECONDS of billed GPU compute (whisper-verification retries +
 *   DSP post-processing on top of raw generation, not just raw generation
 *   time) - a real-time factor of ~3x, i.e. it costs ~3 seconds of GPU
 *   time per second of output audio. That's roughly $0.06-0.09 per minute
 *   of output audio depending on which GPU tier gets assigned (endpoint's
 *   pool: $0.69/$1.10/$1.58 per hour) - 30-45x the old assumption. At the
 *   old caps, a Plus user maxing 200k chars/mo cost us $6-16 against $3 of
 *   revenue, and a Pro user maxing 1.5M chars/mo cost us $42-120 against
 *   $9 - both real, uncapped losses, not edge cases.
 *
 *   New COGS assumption, padded for safety: 0.18s of compute per
 *   character (rounded up from the ~0.14-0.18s/char actually measured) at
 *   the worst-case GPU rate ($1.58/hr) = **$0.00008/character**
 *   (~$80/million characters). New caps below are sized so a subscriber
 *   maxing their ENTIRE monthly quota still holds ~60% gross margin -
 *   worst case, not average case, same philosophy as the video credits.
 *   For context, the new Plus/Pro numbers land close to what ElevenLabs
 *   actually charges for comparable character allotments - a useful
 *   external sanity check that this isn't an arbitrary number.
 *
 *   Do not raise these caps (or add cheaper GPU tiers to the endpoint's
 *   pool without accounting for the mix shifting) without re-running this
 *   math against fresh measured data - it was 2 real data points, not a
 *   large sample, and real per-request overhead may not scale perfectly
 *   linearly with text length.
 *
 * - Video: VIDEO CREDITS (see VIDEO_CREDIT_COSTS below) - not seconds
 *   directly, because a talking-head second and a cinematic second cost
 *   very different amounts in real vendor fees (fal.ai, proxying Kling/
 *   Veo), so a flat "seconds" cap would let a cinematic-only user cost
 *   ~2.7x what the cap was priced for. Reviewed against worst-case COGS
 *   2026-09-08 (see PROJECT_CONTEXT.md Sec 12 / STATUS.md "Pricing/margin
 *   review"): every allotment below is sized to hold >=56% gross margin
 *   even if a subscriber spends their entire credit balance on the single
 *   most expensive option (worst case, not the average case) - unaffected
 *   by the 2026-09-09 audio re-pricing above since it's based on real
 *   fal.ai vendor list prices, not the same stale assumption. Margin only
 *   improves now that the plans carrying these credits cost more. Do not
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
    priceUsdCents: 600, // was 300 - see re-pricing note above
    stripePriceEnvVar: "STRIPE_PRICE_PLUS",
    charactersPerMonth: 30_000, // was 200_000 - worst-case audio COGS ~$2.40, ~60% margin at $6
    videoCreditsPerMonth: 15, // worst-case (all talking-head) COGS ~$0.84, now ~86% margin at $6 (was ~59% at $3)
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceUsdCents: 2000, // was 900 - see re-pricing note above
    stripePriceEnvVar: "STRIPE_PRICE_PRO",
    charactersPerMonth: 100_000, // was 1_500_000 - worst-case audio COGS ~$8.00, ~60% margin at $20
    videoCreditsPerMonth: 60, // worst-case (all talking-head) COGS ~$3.37, now ~83% margin at $20 (was ~56% at $9)
  },
};

export function planFromStripePriceId(priceId: string): PlanId | null {
  if (priceId === process.env.STRIPE_PRICE_PLUS) return "plus";
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  return null;
}
