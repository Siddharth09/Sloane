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

---

## 2026-09-10 update — third mode locked (Ads/Seedance), all three engines live-tested

**Decision: video ships as three modes, not two, and it's no longer framed as "coming soon."** Talking head (Kling), Cinematic (Veo), and a new **Ads** mode built on Seedance's newer reference-to-video capability plus a persistent, exclusive AI-actor concept modeled on Arcads.ai. Product copy on the home page/mobile/billing was rewritten from hedged "coming soon" language to a confident "three real modes, being wired up now" framing, matching the tone shift already applied once before in Sec 13.

### Real API tests run today (fal.ai, real billed generations, not mocks)

All three called directly via `fal_client` against production fal.ai endpoints:

| Mode | Endpoint | Input | Result |
| --- | --- | --- | --- |
| Talking head | `fal-ai/kling-video/ai-avatar/v2/standard` | AI-generated face (stylized, then hyper-realistic) + real Lucy TTS audio (`art_instructor` voice) | **Worked both times** - Kling has no issue with photorealistic AI faces |
| Cinematic | `fal-ai/veo3.1/fast/image-to-video` | Same stylized face + prompt, `generate_audio: true`, `duration: "4s"` | **Worked** (note: `duration` must be exactly `"4s"`/`"6s"`/`"8s"`, not an arbitrary number) |
| Ads | `bytedance/seedance-2.0/fast/reference-to-video` | `@Image1` = AI face + text prompt describing an action, `generate_audio: false` | **Blocked on the hyper-realistic face** (`content_policy_violation`: "may contain likenesses of real people") - **worked fine on the more stylized face** |

**Real, load-bearing finding**: Seedance's own safety filter cannot tell a very convincing AI-generated face from an actual photo of a real person, and blocks both. Kling has no equivalent restriction and accepted the identical hyper-realistic image without issue. This directly decides how "Ads" mode routes:

- **Photorealistic actor** (the common case, matches what was asked for - "hyper realistic" like Arcads) → generation runs through **Kling** (Avatar for talking, standard image-to-video for non-talking action shots) using the same stored actor image.
- **Stylized/3D-character actor**, or specifically the **upload-a-video, recreate-with-my-actor** trick → **Seedance reference-to-video**, which is the only one of the three with a real multi-reference (`@Image1`/`@Video1`/`@Audio1`) motion-transfer capability. Confirmed via fal's own docs/GitHub example: `"@Image1 performs the choreography from @Video1 on a rooftop at sunset."` - exactly the "upload a video, get it recreated with an AI character" mechanic that was asked about.

Demo clip saved to the repo: `web/public/trailers/ads-seedance-demo.mp4` (force-added past the `*.mp4` gitignore, same as the two existing trailer clips) - Seedance reference-to-video, stylized AI character holding a product, UGC-style.

### Seedance 2.0/2.5 reference-to-video - what it actually is (researched via fal's own docs, not guessed)

- Endpoint accepts up to 12 (2.0) or 50 (2.5) reference files across images/videos/audio, referenced in the prompt as `@Image1`/`@Video1`/`@Audio1`, plus a required text prompt.
- Pricing (720p): Standard ~$0.30/s, Standard-with-video-input ~$0.18/s (40% discount for supplying a video reference), Fast tiers roughly 20% cheaper than Standard. 2.5 supports up to 30s in one pass and up to 50 references but costs more per second.
- This is a real, documented capability (not inferred) - fal's own GitHub README shows the exact `@Image1 ... @Video1` prompt pattern for motion transfer.

### Arcads.ai research - how the "exclusive AI actor" concept actually works there

Fetched Arcads' own site plus the auto-generated captions of a demo video the user linked (via `yt-dlp --write-auto-sub`, transcript only, no video downloaded/redistributed). Confirmed mechanics, direct quotes from the demo:

- **Avatar creation is text-prompt-driven** ("instead of selecting an existing actor from the library, you can like type your own script... type this prompt and our model - that's a proprietary model - will basically generate multiple images for you"), or photo-driven.
- **Exclusivity is an account-scoping guarantee, not cryptography**: "this one will be unique to your account. You will be the only one to be able to use this one." I.e., the generated avatar is simply never surfaced to any other customer - a private-storage/access-control guarantee, the same mechanism proposed below for Lucy Labs, not an NFT/blockchain claim despite the "kind of like an NFT" framing.
- **Consistency across settings/products**: the same actor identity gets re-rendered in new scenes/outfits/holding a specific product photo, explicitly contrasted against Veo/"V3" which the demo says can't hold one consistent actor across different situations - this maps directly to why Ads mode needs its own persistent actor-image asset rather than relying on Cinematic's per-generation Veo pipeline.
- **Non-talking action shots exist too** (an actor "typing on a laptop... without talking", "looking at the glass... admiring", etc.) - Ads mode should support both a talking path (actor + script + voice, same shape as Talking head) and a silent action path (actor + prompt describing what they're doing, no audio).
- Arcads explicitly lists Seedance 2.5, Kling, and Sora 2 Pro as backend models it uses - confirms Seedance is a real, current choice for this category of product, not a stretch.

### Exclusive-avatar architecture (proposed, not yet built)

Directly answers "how can we ensure it will be exclusive": exclusivity here means **Lucy Labs' own systems privately own and gate the generated asset** - a real, enforceable guarantee within our platform, not a claim that the underlying image model could never coincidentally produce something similar for someone else (an AI image model is a shared third-party service; that part genuinely can't be locked down, and the copy shouldn't imply otherwise).

1. **Generation inputs**: text prompt, an uploaded photo, or a frame/reference from an uploaded video - all three route to an image-generation call (text→image for a prompt, image-to-image/character-consistency for a photo or video frame) producing one or more candidate portraits.
2. **Private storage**: the chosen portrait is stored in our own DB/blob storage (same pattern as `generations` table + Vercel Blob already used for audio history) under a new `ai_actors` table, keyed to `user_id`. Never added to any shared/public gallery, never referenced in a generation request for a different account. This is the actual exclusivity mechanism - straightforward to build and enforce since Lucy Labs' backend is the only thing that ever calls fal with that image URL.
3. **Duplicate/lookalike safeguard**: before finalizing a new actor, compute a face-embedding (a small, fast face-recognition model - several free/cheap options exist, e.g. `insightface`/fal's own face-embedding utilities) and compare it against every other stored actor's embedding. Above a similarity threshold, discard and regenerate with a new seed automatically before showing the user any result. This gives a real technical backstop against two different customers ending up with visually-confusable actors, on top of the private-storage guarantee - not built yet, flagged as a concrete next step.
4. **Reuse**: every later ad generation (talking or silent, Kling or Seedance) references that same stored image URL, giving one consistent "face" across a brand's whole campaign, exactly matching the Arcads pattern above.
5. **Contractual reinforcement**: ToS language granting the customer an exclusive usage license to their generated actor within the platform - a policy commitment layered on top of the technical access control, same idea as a design agency not reselling a client's custom logo.

### Still not built (next engineering steps, in order)

1. `ai_actors` DB table + an avatar-generation API route (text/photo/video-frame → candidate image(s) → user picks → stored privately).
2. The face-embedding similarity safeguard described above.
3. `/api/generate-video` itself - routes to Kling or Seedance depending on the chosen actor's realism level and whether a reference video was supplied; handles the talking (script + voice) vs. silent-action path.
4. Ads-mode credit pricing - genuinely varies by engine (Kling path costs the same per-second as Talking head; Seedance path costs meaningfully more, especially without a video-reference discount) - needs a real decision, not a placeholder ratio like Talking head/Cinematic have.
5. Mobile parity for actor creation/upload UI once the web version exists.

_Last updated: 2026-09-10 (Sydney)._
