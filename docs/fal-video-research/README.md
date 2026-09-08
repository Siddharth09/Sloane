# Lucy Labs — Fal video research (2026-09-08)

Self-contained handoff for the fal / Kling / Veo smoke tests. If this chat thread is lost, this folder + `STATUS.md` should be enough to resume.

**Product decision (locked 2026-09-08 evening):**

| Mode | Ship? | Stack | Voice |
| --- | --- | --- | --- |
| **Talking head** | Yes (primary) | Kling AI Avatar **v2 Standard** + **Lucy TTS** | Lucy clone (real accent) |
| **Cinematic scene** | Yes (separate mode) | **Veo 3.1 Fast** I2V + `generate_audio: true` | Veo native voice (not Lucy) |
| Kling native walk+speak | No | Lip sync way off | — |
| Seedance real-face I2V | No | `content_policy_violation` on real likeness | — |
| MiniMax I2V | No | Weak vs Veo/Kling | — |

Do **not** blend walk + speech into one hero-face generate. Keep **hero face** (Avatar + Lucy) separate from **wide cinematic B-roll** (Veo).

Voice under test: **Vicky** = internal id `art_instructor` (source `ART (INSTRUCTOR INTRO).mp4` / studio stills). Repo/product still named Sloane internally; public product is Lucy Labs (`lucylabs.app`).

---

## Folder map

```
docs/fal-video-research/
  README.md                 ← this file (conclusions, costs, pricing, Stripe, how to implement)
  prompts/PROMPTS.md        ← exact prompts used
  stills/                   ← input stills
  audio/                    ← Lucy TTS / voice refs used in tests
  videos/talking-head/      ← Avatar + Lucy (and early Avatar tests)
  videos/cinematic/         ← Veo / Kling I2V walk & ambient
  videos/failed-or-ab/      ← Seedance / MiniMax / Grok A/B rejects or secondary
```

Excluded from git (too large / source masters): `ART_INSTRUCTOR_INTRO.mp4` (~91MB), raw speak-frame dumps.

---

## What we ran (chronological)

1. **Alice smoke** — Kling Avatar Standard on a simple still → `videos/talking-head/test_kling_avatar.mp4`
2. **Welcome talking head** — ART-intro face + Lucy line → `vicky_welcome_avatar.mp4`, refined `vicky_welcome_v2.mp4` (**the clip we originally liked**)
3. **Moon cutout + Avatar** — rembg cutout onto moon still (Seedance blocked real face) → `vicky_moon_avatar.mp4`, `vicky_moon_talk.mp4`
4. **Rover / moon-city A/B** from a weak composite still — Grok / Veo / Kling / MiniMax / Seedance  
   - Winners: Veo, Kling  
   - Usable: Grok  
   - Bad: MiniMax  
   - Blocked: Seedance  
   Files under `videos/cinematic/` and `videos/failed-or-ab/`
5. **Better still** — Flux Kontext place-on-lunar-ground → `stills/vicky_on_surface_still.jpg` (feet on regolith, rover + moon city)
6. **Ambient walk from good still** — Veo Fast + Kling v3 with audio flags → `vicky_veo_surface_audio.mp4`, `vicky_kling_v3_surface_audio.mp4`
7. **Walk + speak accent test** — same still + welcome script  
   - Kling 2.6 Pro + cloned voice → `vicky_kling_walk_speak.mp4` (lip sync poor)  
   - Veo Fast + native dialogue in prompt → `vicky_veo_walk_speak.mp4` (voice ≠ Lucy; face can drift)  
   - Kling Avatar + Lucy TTS on surface still → `vicky_kling_lucy_avatar.mp4` (voice good; lip sync weak on **wide** full-body still)

Studio still used for early Veo: `stills/vicky_frame_12.jpg`. Lucy line audio: `audio/vicky_line1.wav`.

---

## Technical conclusions

1. **Lucy dub sounds best.** Native Kling/Veo speech will not reliably match Vicky’s accent.
2. **Avatar lip sync** fails mostly from pipeline, not “Avatar is useless”: wide full-body Kontext still (few face pixels + identity drift), ~9s continuous speech, Avatar **Standard**. Better path: tight face crop / `frame_12` → Avatar **Pro** → shorter chunks (≤8–12s).
3. **Cinematic face change:** single-still I2V has no face lock; Kontext placement softens identity; walk+speech worsens drift. ART intro source is fine — hit-and-miss is the pipeline.
4. **Veo ≈ Kling** for silent/ambient cinematic quality; prefer **Veo Fast** when you want built-in scene audio/dialogue without a second lip-sync pass.
5. **Kling Avatar** takes `image_url` + `audio_url` only (no text prompt required).
6. **Grok video in Grok Bot** = fal `xai/grok-imagine-video`, not a SuperGrok entitlement.
7. EchoMimic / open lip-sync remains the **free GPU** path (Lane C); fal Avatar is the paid Lane B.

---

## Fal COGS (2026-09-08 list prices)

| Mode | Endpoint | Rate |
| --- | --- | --- |
| Talking head | `fal-ai/kling-video/ai-avatar/v2/standard` | **$0.0562 / s** |
| Talking head HQ | `.../ai-avatar/v2/pro` | $0.115 / s |
| Cinematic + Veo voice | `fal-ai/veo3.1/fast/image-to-video` audio on | **$0.15 / s** (720p/1080p) |
| Cinematic silent | same, audio off | $0.10 / s |
| Kling 2.1 Standard I2V | `fal-ai/kling-video/v2.1/standard/image-to-video` | ~$0.056 / s (5s ≈ $0.28) |

Lucy TTS COGS: RunPod warm inference is ~**$0.005 / gen** once warm; the real audio cost is the **warm GPU** (~$533/mo if 24/7), already paid for TTS. Treat Lucy audio as ~$0 incremental for video credit math.

Examples: 5s talk ≈ $0.28 · 8s talk ≈ $0.45 · 5s Veo+audio ≈ $0.75 · 8s Veo+audio ≈ $1.20 · 30s all-talk ≈ $1.69 · 30s all-cine ≈ $4.50.

Cinematic-with-voice ≈ **2.7×** talking-head Standard per second.

---

## Credit plan (proposed — wire into Stripe tiers)

### Credit weights

- **1 talk-second** (Avatar Standard + Lucy) = **1 credit**
- **1 cine-second** (Veo Fast + audio) = **3 credits** (≈ 0.15 / 0.056)
- Avatar Pro = **2 credits / s** if offered as a toggle
- Failed fal calls: do not debit. Optional: 1 free regen / clip = half credit or full debit (pick one and stick to it)

### Clip caps (hard)

- Talking head: TTS + Avatar ≤ **10–12 s** per job (chunk longer scripts)
- Cinematic: Veo duration knobs only — **4s / 6s / 8s**
- Deduct credits **only on success**

### Current live Stripe tiers (audio today)

From production / `STATUS.md` — Stripe Checkout **live mode**:

| Plan | Price | Chars / mo | Video today |
| --- | --- | --- | --- |
| **Free** | $0 | 10,000 | none |
| **Plus** | $3 / mo | 200,000 | none |
| **Pro** | $9 / mo | 1,500,000 | “30s reserved” disclaimer (not working) |

### Proposed video credits on the same 3 tiers

Keep char limits as-is. Add **video credits** so cine can’t bankrupt a $9 Pro:

| Plan | Price | Audio (unchanged) | Video credits / mo | ≈ talk-only | ≈ cine-only (÷3) | Worst-case fal COGS @ list |
| --- | --- | --- | --- | --- | --- | --- |
| **Free** | $0 | 10k chars | **0** (or 5 talk credits as watermarked demo later) | — | — | $0 |
| **Plus** | **$5 / mo** (was $3) *or keep $3 with 0 video* | 200k chars | **30 credits** if priced $5; **0** if stay $3 | 30s talk | 10s cine | ≤ ~$1.70 |
| **Pro** | **$12 / mo** (was $9) | 1.5M chars | **90 credits** | 90s talk | 30s cine | ≤ ~$5.05 |

**Why raise Pro $9 → $12 and Plus $3 → $5 (recommended view):**

- Video is variable fal spend on top of **fixed RunPod TTS** (~hundreds $/mo). Margin must cover fal + Stripe fees (~2.9% + $0.30) + support + retries.
- At **$9 / 90 credits**, worst-case fal ≈ $5 and contribution after Stripe ≈ $3.4 before GPU — tight if Pro users max cine.
- At **$12 / 90 credits**, Stripe net ≈ $11.3, fal worst ≈ $5, **~$6** left toward GPU/overhead — healthier.
- Alternative if you refuse to raise prices: keep **$9 Pro** but only **60 credits** (≈ $3.4 fal worst) and keep Plus audio-only at $3.

**Pay-as-you-go top-ups (Stripe one-time / Checkout):**

| Pack | Price | Credits | Effective |
| --- | --- | --- | --- |
| Small | $4 | 40 | $0.10 / credit |
| Medium | $10 | 120 | ~$0.083 / credit |
| Large | $25 | 350 | ~$0.071 / credit |

Internal floor: never sell below ~**2× fal** ($0.12 / talk-s, $0.30 / cine-s) after fees.

### Mix examples on Pro @ 90 credits

- 60s talk + 10s cine = 60 + 30 = 90  
- 30s talk + 20s cine = 30 + 60 = 90  
- 90s talk only  
- 30s cine only  

---

## Stripe / billing implementation notes

Already live: Stripe Checkout for Free / Plus / Pro subscriptions.

When turning video on:

1. **Products / Prices** — either new Prices on existing Products (Plus $5, Pro $12) or keep old Prices and add add-on Product `video_credits_monthly`. Prefer **new Prices** + migrate subscriptions with Stripe Subscription update (proration off or always_invoice — decide explicitly).
2. **Customer metadata / DB** — store `video_credits_balance`, `video_credits_reset_at` (billing period), `plan_id`. Reset balance on `invoice.paid` / `customer.subscription.updated`.
3. **Webhooks** — handle `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`, and one-time top-up Checkout. Idempotent credit grants.
4. **Preflight** — `/api/generate-video` checks credits + mode weight before calling fal; reserve or debit-after-success.
5. **Metering** — log `fal_request_id`, seconds, mode, credits_debited for support + margin dashboards.
6. **iOS** — App Store likely requires IAP for digital subscriptions; current Stripe web checkout is a rejection risk (already noted in `STATUS.md`). Don’t ship video-only IAP until that decision is settled; web can ship first.
7. **Secrets** — Stripe live keys stay in `web/.env.local` (gitignored). Fal key same. Never commit keys.
8. **Honesty copy** — Talking head: “your Lucy voice.” Cinematic: “AI scene voice (not your clone); face may vary.”

---

## How to implement (engineering sketch)

1. UI mode toggle: **Talking head** | **Cinematic scene**
2. Talk path: Lucy TTS → upload audio to fal storage → `kling-video/ai-avatar/v2/standard` with tight face crop (`frame_12` or face-detect crop). Optional Pro toggle.
3. Cine path: user still or Kontext place-in-scene → `veo3.1/fast/image-to-video`, `generate_audio: true`, dialogue in prompt, duration 4/6/8s.
4. Quotas: weighted credits as above; soft warn at 80%.
5. Do not expose Kling native voice for product lines until lip sync is fixed.
6. Wire under something like `/api/generate-video` with server-side fal key.

Exact prompts: see [`prompts/PROMPTS.md`](./prompts/PROMPTS.md).

---

## Asset index

### Talking head

| File | Notes |
| --- | --- |
| `videos/talking-head/vicky_welcome_v2.mp4` | **Preferred demo** — Avatar + Lucy, face talking |
| `videos/talking-head/vicky_welcome_avatar.mp4` | Earlier welcome Avatar |
| `videos/talking-head/vicky_kling_lucy_avatar.mp4` | Avatar + Lucy on moon surface still (wide; lips weaker) |
| `videos/talking-head/vicky_moon_talk.mp4` | Moon cutout + Lucy upload pitch |
| `videos/talking-head/vicky_moon_avatar.mp4` | Moon Avatar variant |
| `videos/talking-head/test_kling_avatar.mp4` | Alice smoke test |

### Cinematic

| File | Notes |
| --- | --- |
| `videos/cinematic/vicky_veo_surface_audio.mp4` | Veo Fast + ambient from good still |
| `videos/cinematic/vicky_kling_v3_surface_audio.mp4` | Kling v3 ambient |
| `videos/cinematic/vicky_veo_walk_speak.mp4` | Veo walk + native dialogue |
| `videos/cinematic/vicky_kling_walk_speak.mp4` | Kling walk + cloned voice (lips off) |
| `videos/cinematic/vicky_veo_rover.mp4` | Early Veo rover/moon-city |
| `videos/cinematic/vicky_kling_rover.mp4` | Early Kling rover/moon-city |

### Failed / A/B

| File | Notes |
| --- | --- |
| `videos/failed-or-ab/vicky_grok_rover.mp4` | Usable but below Veo/Kling |
| `videos/failed-or-ab/vicky_minimax_rover.mp4` | Weak |
| `videos/failed-or-ab/test_seedance.mp4` | Policy / weak path |

### Stills / audio

| File | Notes |
| --- | --- |
| `stills/vicky_frame_12.jpg` | Studio still — good for Avatar / early Veo |
| `stills/vicky_on_surface_still.jpg` | Kontext lunar-ground still |
| `audio/vicky_line1.wav` | Lucy TTS welcome/test line |
| `audio/vicky_speak_ref_8s.mp4` | Clip used for Kling create-voice ref |

---

## Related product docs

- [`STATUS.md`](../../STATUS.md) — live product status + billing  
- [`PROJECT_CONTEXT.md`](../../PROJECT_CONTEXT.md) — longer decision history  

_Last updated: 2026-09-08 (Sydney)._
