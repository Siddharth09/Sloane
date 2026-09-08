/**
 * Pricing tiers. Character limits are enforced server-side in src/lib/db.ts
 * - these are the single source of truth, referenced by both the Stripe
 * checkout flow and the usage-gating middleware, so a plan change here
 * takes effect everywhere at once.
 *
 * Cost basis (see PROJECT_CONTEXT.md "Pricing" section): Chatterbox audio
 * generation costs roughly $0.002/minute of output in GPU time, so even a
 * Plus user maxing out their monthly cap costs us well under $1 against a
 * $3 subscription.
 *
 * Video is intentionally not sold as a plan feature (2026-09-08) - our
 * zero-shot video quality isn't good enough to charge for yet (see
 * PROJECT_CONTEXT.md Sec 8), so Pro's differentiator is just a much
 * higher character allowance instead of a video allotment.
 */
export type PlanId = "free" | "plus" | "pro";

export type Plan = {
  id: PlanId;
  name: string;
  priceUsdCents: number;
  stripePriceEnvVar: string; // which env var holds this plan's Stripe Price ID
  charactersPerMonth: number;
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceUsdCents: 0,
    stripePriceEnvVar: "",
    charactersPerMonth: 10_000,
  },
  plus: {
    id: "plus",
    name: "Plus",
    priceUsdCents: 300,
    stripePriceEnvVar: "STRIPE_PRICE_PLUS",
    charactersPerMonth: 200_000,
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceUsdCents: 900,
    stripePriceEnvVar: "STRIPE_PRICE_PRO",
    charactersPerMonth: 1_500_000,
  },
};

export function planFromStripePriceId(priceId: string): PlanId | null {
  if (priceId === process.env.STRIPE_PRICE_PLUS) return "plus";
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  return null;
}
