/**
 * Pay-as-you-go video generation (2026-09-11) - prepaid credits, NOT a
 * subscription (see plans.ts for the recurring PLANS system, which this is
 * deliberately kept separate from). One credit = one video, same flat price
 * regardless of which of the three engines the user picks.
 *
 * **Duration is NOT uniform across engines - a real constraint, not a
 * choice.** Checked directly against each engine's own fal API schema
 * (not just docs, which turned out incomplete for Veo):
 * - Veo 3.1 fast: `duration` is a strict enum ["4s","6s","8s"] - 8s is its
 *   hard ceiling, no 5s or 10s option exists.
 * - Kling 2.1 master: `duration` is a strict enum ["5","10"] - no 8s, no
 *   value under 5. These two engines' valid durations don't even overlap.
 * - Seedance 2.0 fast: genuinely flexible, "4" through "15" (or "auto").
 * Given Veo and Kling's enums share no common value, one identical
 * universal duration across all three is not possible - each engine below
 * uses its own best-fit duration (Veo 8s, Kling 5s to avoid doubling cost
 * at 10s, Seedance 8s to match Veo/Seedance parity). The flat price still
 * holds across all three; what differs is real clip length (5-8s
 * depending on engine), disclosed to the user rather than pretended away.
 *
 * **Cost math (real fal.ai list prices, checked 2026-09-11):**
 * - Veo 3.1 fast, 720p w/ audio, 8s: $0.15/s -> $1.20
 * - Kling 2.1 master (T2V), 5s: flat $1.40 (base price, no extra seconds)
 * - Seedance 2.0 fast, 720p, 8s: $0.2419/s -> $1.94
 * Each gets a +15% buffer folded in below to cover failed/rejected
 * generations (content-policy blocks, vendor errors) that still cost real
 * money even though the user is refunded their credit (see
 * refundVideoCredit in db.ts) - that cost has to be spread across the
 * successful ones, not eaten silently.
 *
 * **Re-priced 2026-09-11 to a true reseller markup, per direct feedback**
 * ("fal ai is so cheap, we need to make our pay as you go cheap like them
 * with a little markup... basically like a reseller of fal ai which is a
 * reseller"). Originally launched at a flat $6.99 (60-80% margin, sized
 * like the rest of this project's subscription pricing) - dropped to a
 * flat $2.99/video instead: ~25% margin over Seedance's $2.23 buffered
 * cost (the worst case), thinner but positive even after Stripe's ~2.9%+
 * $0.30 fee on a single no-commitment purchase (~14% net). Packs still
 * give a volume discount and better net margin once Stripe's flat fee is
 * amortized over more than one video. No persistent storage of generated
 * videos either - users get the fal-hosted URL directly and download it
 * themselves, so there's no ongoing storage cost to price in here.
 */

export type VideoEngine = "kling" | "veo" | "seedance";

export const VIDEO_PAYGO_RESOLUTION = "720p";
export const VIDEO_PAYGO_PRICE_USD_CENTS = 299; // $2.99, flat across all three engines

export const VIDEO_PAYGO_ENGINES: Record<
  VideoEngine,
  { label: string; falEndpoint: string; durationSeconds: number; falDurationValue: string }
> = {
  veo: { label: "Veo", falEndpoint: "fal-ai/veo3.1/fast", durationSeconds: 8, falDurationValue: "8s" },
  kling: {
    label: "Kling",
    falEndpoint: "fal-ai/kling-video/v2.1/master/text-to-video",
    durationSeconds: 5,
    falDurationValue: "5",
  },
  seedance: {
    label: "Seedance",
    falEndpoint: "bytedance/seedance-2.0/fast/text-to-video",
    durationSeconds: 8,
    falDurationValue: "8",
  },
};

// Real cost per engine at each engine's own duration above, +15% buffer -
// kept here (not just in the comment above) so a future engine price
// change is easy to re-verify margin against, not just documented once and
// forgotten.
export const VIDEO_PAYGO_ENGINE_COST_USD: Record<VideoEngine, number> = {
  veo: 1.38,
  kling: 1.61,
  seedance: 2.23,
};

export type VideoCreditPack = {
  id: string;
  credits: number;
  priceUsdCents: number;
  stripePriceEnvVar: string;
};

// Packs give a small volume discount over the flat $2.99 single-video price
// while keeping the worst-case (Seedance, $2.23 buffered cost) margin
// positive: pack5 is $2.70/video (~17% margin, better net after Stripe fees
// amortize), pack10 is $2.50/video (~11% margin) - thin, deliberately, per
// the reseller-pricing request - real numbers, not round-number guesses.
export const VIDEO_CREDIT_PACKS: VideoCreditPack[] = [
  { id: "single", credits: 1, priceUsdCents: 299, stripePriceEnvVar: "STRIPE_PRICE_VIDEO_CREDIT_1" },
  { id: "pack5", credits: 5, priceUsdCents: 1350, stripePriceEnvVar: "STRIPE_PRICE_VIDEO_CREDIT_5" },
  { id: "pack10", credits: 10, priceUsdCents: 2500, stripePriceEnvVar: "STRIPE_PRICE_VIDEO_CREDIT_10" },
];

export function videoCreditPackFromStripePriceId(priceId: string): VideoCreditPack | null {
  for (const pack of VIDEO_CREDIT_PACKS) {
    if (process.env[pack.stripePriceEnvVar] === priceId) return pack;
  }
  return null;
}
