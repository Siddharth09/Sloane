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
 * - $18.00 for 5 (=$3.60/video): net after Stripe fee (2.9%*18+$0.30 =
 *   $0.822 total, $0.1644/video) = $3.4356/video; profit = **$1.21/video**
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

export type VideoEngine = "kling" | "veo" | "seedance" | "grok" | "minimax";

export const VIDEO_PAYGO_RESOLUTION = "720p";
export const VIDEO_PAYGO_PRICE_USD_CENTS = 399; // $3.99, flat across all three engines

// versionLabel is shown directly in the UI so the engine picker is honest
// about exactly which model version is running, per direct request ("give
// a dropdown ... mention which version we offer like veo 2 etc"). These are
// deliberately the SAME model tier/version already priced and proven above
// (Veo 3.1 fast, Kling 2.1 master, Seedance 2.0 fast) - not silently
// upgraded to a newer/pricier version (e.g. Seedance 2.5), which would
// invalidate the worst-case cost math this file's margin comment depends
// on without re-verifying its real fal price first.
export const VIDEO_PAYGO_ENGINES: Record<
  VideoEngine,
  {
    label: string;
    versionLabel: string;
    falEndpoint: string;
    falImageToVideoEndpoint: string;
    falAvatarEndpoint?: string; // only Kling has a proven lip-sync/avatar path in this stack
    durationSeconds: number;
    falDurationValue: string;
    // Only set when an engine's resolution enum doesn't match the shared
    // VIDEO_PAYGO_RESOLUTION constant below - MiniMax H3 Max has no "720p"
    // option at all (its enum is "480P"/"768P"/"1080P", capitalized
    // differently too), so it needs its own value rather than silently
    // reusing Veo/Seedance/Grok's "720p".
    falResolutionValue?: string;
    // fal's own model page for this exact endpoint - real example galleries
    // showing that engine's actual output quality, linked directly from the
    // engine picker per direct request ("so they can see the quality of
    // each") rather than us maintaining our own curated gallery per engine.
    exampleUrl: string;
  }
> = {
  veo: {
    label: "Veo",
    versionLabel: "Veo 3.1 Fast",
    falEndpoint: "fal-ai/veo3.1/fast",
    falImageToVideoEndpoint: "fal-ai/veo3.1/fast/image-to-video",
    durationSeconds: 8,
    falDurationValue: "8s",
    exampleUrl: "https://fal.ai/models/fal-ai/veo3.1/fast",
  },
  kling: {
    label: "Kling",
    versionLabel: "Kling 2.1 Master",
    falEndpoint: "fal-ai/kling-video/v2.1/master/text-to-video",
    falImageToVideoEndpoint: "fal-ai/kling-video/v2.1/master/image-to-video",
    falAvatarEndpoint: "fal-ai/kling-video/ai-avatar/v2/standard",
    durationSeconds: 5,
    falDurationValue: "5",
    exampleUrl: "https://fal.ai/models/fal-ai/kling-video/v2.1/master/text-to-video",
  },
  seedance: {
    label: "Seedance",
    versionLabel: "Seedance 2.0 Fast",
    falEndpoint: "bytedance/seedance-2.0/fast/text-to-video",
    falImageToVideoEndpoint: "bytedance/seedance-2.0/fast/image-to-video",
    durationSeconds: 8,
    falDurationValue: "8",
    exampleUrl: "https://fal.ai/models/bytedance/seedance-2.0/fast/text-to-video",
  },
  // Added 2026-09-12 per direct request ("add minimax grok and our other
  // models") after a real head-to-head test of both against the existing
  // three (see the model-comparison showcase section on the home page).
  // Endpoints/schemas confirmed directly against fal's own API docs and a
  // real test submission that day, not guessed.
  grok: {
    label: "Grok",
    versionLabel: "Grok Imagine Video 1.5",
    falEndpoint: "xai/grok-imagine-video/v1.5/text-to-video",
    falImageToVideoEndpoint: "xai/grok-imagine-video/v1.5/image-to-video",
    durationSeconds: 8,
    falDurationValue: "8",
    exampleUrl: "https://fal.ai/models/xai/grok-imagine-video/v1.5/text-to-video",
  },
  minimax: {
    label: "MiniMax",
    versionLabel: "MiniMax H3 Max",
    falEndpoint: "minimax/h3-max/text-to-video",
    falImageToVideoEndpoint: "minimax/h3-max/image-to-video",
    durationSeconds: 8,
    falDurationValue: "8",
    // "768P" (its default/mid resolution) - see falResolutionValue comment
    // above for why this can't just reuse the shared 720p constant.
    falResolutionValue: "768P",
    exampleUrl: "https://fal.ai/models/minimax/h3-max/text-to-video",
  },
};

// Real cost per engine at each engine's own duration above, +15% buffer -
// kept here (not just in the comment above) so a future engine price
// change is easy to re-verify margin against, not just documented once and
// forgotten.
//
// **Upload-driven paths added 2026-09-11 (image/video/audio references,
// see /api/video-paygo/generate) - cost impact checked, not assumed:**
// - An image/video-frame reference switches Veo/Seedance to their own
//   image-to-video endpoint at the SAME price bracket (same model tier,
//   same duration) - no cost change.
// - Kling + an uploaded/cloned audio track routes through Kling's Avatar
//   endpoint instead (the only proven lip-sync path in this stack) at
//   real list price ~$0.0562/s -> ~$0.28-0.45 for a 5-8s clip, CHEAPER
//   than the $1.40 flat this file already budgets for Kling - strictly
//   safer for the profit floor, not a new risk.
// - Veo/Seedance + an uploaded/cloned audio track render silent/ambient
//   then get muxed via fal's ffmpeg merge-audio-video utility - **verified
//   2026-09-11 against fal's own model page: $0.0002/second**, so ~$0.0016
//   for an 8s clip. Negligible, comfortably inside the existing 15%
//   buffer - confirmed, not just assumed.
// Grok/MiniMax added 2026-09-12, same +15% buffer methodology as the three
// above. Real list prices checked directly (fal's own pricing pages,
// 2026-09-12):
// - Grok Imagine Video 1.5, 720p, 8s: $0.14/s -> $1.12, +$0.01 for the one
//   reference image when given -> $1.13 -> buffered $1.30.
// - MiniMax H3 Max, 768p, 8s: **using the REGULAR $0.08/s rate, not the
//   75%-off promotional $0.02/s rate** - that promo explicitly expires
//   2026-09-14, two days from this being written, and this is a permanent
//   engine option, not a one-off test - budgeting off a rate that expires
//   almost immediately would quietly blow the profit floor the day after
//   ship. $0.08/s * 8s = $0.64 -> buffered $0.74.
// Both land well under Seedance's $2.23 (still the worst case), so the
// existing $3.99 flat price and $1/video profit floor both hold with no
// repricing needed - see the module comment above for the full worst-case
// math this depends on.
export const VIDEO_PAYGO_ENGINE_COST_USD: Record<VideoEngine, number> = {
  veo: 1.38,
  kling: 1.61,
  seedance: 2.23,
  grok: 1.30,
  minimax: 0.74,
};

// Builds the fal input body for a plain (non-Kling-Avatar) engine
// submission. Shared by /api/video-paygo/generate (immediate submission)
// and its status route (the deferred "a Lucy voice" phase-0 submission,
// once TTS resolves) - lives here rather than in either route file since
// Next.js route.ts files may only export HTTP method handlers.
export function buildFalInput(engine: VideoEngine, prompt: string, imageUrl: string | null, wantsNativeAudio: boolean): Record<string, unknown> {
  const def = VIDEO_PAYGO_ENGINES[engine];
  switch (engine) {
    case "veo":
      return {
        prompt,
        image_url: imageUrl ?? undefined,
        duration: def.falDurationValue,
        resolution: VIDEO_PAYGO_RESOLUTION,
        generate_audio: wantsNativeAudio,
      };
    case "kling":
      return { prompt, duration: def.falDurationValue, image_url: imageUrl ?? undefined };
    case "seedance":
      return { prompt, duration: def.falDurationValue, resolution: VIDEO_PAYGO_RESOLUTION, image_url: imageUrl ?? undefined };
    case "grok":
      // duration is a real integer field on this endpoint's schema (not a
      // string enum like Kling/Veo) - sent as a number, not the string
      // falDurationValue is stored as elsewhere, to match.
      return { prompt, image_url: imageUrl ?? undefined, duration: Number(def.falDurationValue), resolution: def.falResolutionValue ?? VIDEO_PAYGO_RESOLUTION };
    case "minimax":
      // prompt_expansion_mode is required by this endpoint's schema -
      // "balanced" (~1s overhead) rather than "quality" (~30s), same choice
      // made in the real test submission this engine's cost was verified
      // against.
      return {
        prompt,
        image_url: imageUrl ?? undefined,
        duration: Number(def.falDurationValue),
        resolution: def.falResolutionValue ?? VIDEO_PAYGO_RESOLUTION,
        prompt_expansion_mode: "balanced",
      };
  }
}

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
