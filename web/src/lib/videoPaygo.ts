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
 * **Re-priced twice on 2026-09-11 - first cheaper, then raised again once a
 * hard profit floor was set.** First pass: dropped from a launch price of
 * $6.99 to a flat $2.99/video per feedback to price this like a true
 * reseller markup over fal's own cost ("fal ai is so cheap... basically
 * like a reseller of fal ai which is a reseller"). That $2.99 number
 * turned out to net only ~$0.35-0.40 profit in the worst case (Seedance)
 * once Stripe's real ~2.9%+$0.30 fee was subtracted - nowhere near a
 * separately-stated hard requirement of **at least $1 profit/video, in the
 * worst case, after every real cost**. Re-priced again to the numbers
 * below, which do clear $1 in every case:
 *
 * Worst case is always Seedance ($2.23 buffered generation cost - see
 * VIDEO_PAYGO_ENGINE_COST_USD below):
 * - $3.99 single video: net after Stripe fee ($0.4157) = $3.574;
 *   profit = $3.574 - $2.23 = **$1.34**
 * - $18.00 for 5 (=$3.60/video): net after Stripe fee ($0.522 total,
 *   $0.1044/video) = $3.4356/video; profit = **$1.21/video**
 * - $35.00 for 10 (=$3.50/video): net after Stripe fee ($0.315 gone
 *   from division, $0.0315/video... actual: fee=$1.315 total/10=$0.1315/
 *   video) = $3.3685/video; profit = **$1.14/video**
 * All three clear the $1 floor with real margin to spare, not razor-thin
 * at exactly $1.00, since real costs (fal price changes, more retries than
 * the 15% buffer assumes) can move against us.
 *
 * **Other costs checked and confirmed negligible/not applicable, so
 * nothing here is silently missing**: Vercel serverless compute for the
 * generate/status routes (a few seconds of function time per video,
 * effectively sub-cent); Neon Postgres row writes (negligible at this
 * volume); no video storage cost (never persisted server-side - users get
 * the fal-hosted URL directly and download it themselves); Stripe payout
 * fees (a periodic account-level fee, not per-transaction, standard to
 * exclude from per-unit COGS); no sales tax currently collected
 * (`managed_payments: {enabled: false}` on the checkout route, same
 * deliberate deferral as the subscription checkout - a real future cost if
 * enabled, not one being incurred today).
 */

export type VideoEngine = "kling" | "veo" | "seedance";

export const VIDEO_PAYGO_RESOLUTION = "720p";
export const VIDEO_PAYGO_PRICE_USD_CENTS = 399; // $3.99, flat across all three engines

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

// Packs give a small volume discount over the flat $3.99 single-video price
// while still clearing the $1/video profit floor (see the module comment
// above for the exact worst-case math): pack5 nets ~$1.21/video, pack10
// ~$1.14/video - real numbers, not round-number guesses.
export const VIDEO_CREDIT_PACKS: VideoCreditPack[] = [
  { id: "single", credits: 1, priceUsdCents: 399, stripePriceEnvVar: "STRIPE_PRICE_VIDEO_CREDIT_1" },
  { id: "pack5", credits: 5, priceUsdCents: 1800, stripePriceEnvVar: "STRIPE_PRICE_VIDEO_CREDIT_5" },
  { id: "pack10", credits: 10, priceUsdCents: 3500, stripePriceEnvVar: "STRIPE_PRICE_VIDEO_CREDIT_10" },
];

export function videoCreditPackFromStripePriceId(priceId: string): VideoCreditPack | null {
  for (const pack of VIDEO_CREDIT_PACKS) {
    if (process.env[pack.stripePriceEnvVar] === priceId) return pack;
  }
  return null;
}
