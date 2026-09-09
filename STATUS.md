# Lucy Labs — Status Summary

_Last updated: 2026-09-09 (Michelle + Robbo LoRAs retrained; training pod stopped)_

**What this is:** a plain-language overview of what we're building, what's done, and what's left. For full technical decision history, see [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md).

**Naming:** the product is **Lucy Labs**, part of the **Astryks Group**. The codebase, this folder, and the git repo intentionally keep the original working name **Sloane** — that's internal-only and doesn't need to change.

**Handoff note:** this doc is kept current specifically so a fresh Claude Code session (no memory of prior conversations) can pick up correctly. Read this whole file before doing anything. Git working tree is clean as of this update — everything described below is committed and pushed to `main`.

---

## What we're building

A voice-cloning platform, live in production, with video cloning intentionally paused as a sold feature (see below).

- **Preset voices:** type text, hear it narrated in one of **10 named, fine-tuned voices** — Vicky, Patrick, Alice, Megan, Katie, Brad, Izzy, Robbo, Michelle, Mark (customer-facing names; internal folder/git identifiers stay neutral, e.g. `art_instructor`, `voice_business` — see `web/src/components/VoicePicker.tsx` for the id→name mapping). Fully working, live.
- **Clone any voice:** upload ~10-20 seconds of anyone's voice, type any text, get it narrated back in that voice (zero-shot cloning). Working, live.
- **Video cloning:** **not sold as a feature right now** (home page still honest). Direction after 2026-09-08 fal tests: **talking head** = Kling Avatar + Lucy voice; **cinematic** = Veo + Veo voice — details/assets in `docs/fal-video-research/`. Pro still lists a reserved 30s/mo allotment with disclaimer until credits + `/api/generate-video` ship. Points users to Kling / Utopai PAI as external options meanwhile.

It runs as:
- A **web app** (Next.js, live at **lucylabs.app**, deployed on Vercel)
- An **iOS app** (Expo/React Native, mirrors the web app's voice features) — **not yet submitted to the App Store, and not yet confirmed working on a real device.** Brought to feature/style parity with web, and a real background-rendering bug was found and fixed, but the actual "run it on a real iPhone via Expo Go" verification step (handed to the user, since this environment can't run the iOS Simulator) was never confirmed completed this session — **check this first** if picking up mobile work.
- A **GPU inference backend** — either an always-on RunPod Pod or a scale-to-zero RunPod Serverless endpoint, switchable at runtime with no redeploy (see "Inference backend: Pod vs Serverless" below) — that both apps call through Next.js API proxy routes (never called directly by clients)

---

## What's done

### Billing (live, real money)
- Stripe Checkout is **live mode** (real card charges), fully working end-to-end
- Plans: Free (10,000 chars/mo), Plus ($3/mo, 200,000 chars/mo), Pro ($9/mo, 1,500,000 chars/mo + 30s/mo video allotment, reserved not working — see above)
- User still needs to personally verify a real subscribe-with-own-card flow — not something Claude should do

### Audio generation quality — several real bugs found and fixed
- **Truncation bug**: Chatterbox's alignment-stream safety mechanism occasionally forces early EOS. Fixed with a duration-based retry (`generate_sentence_with_retry`).
- **Word-skipping bug**: added real content verification — transcribe each generation with faster-whisper, compare word overlap against the input text, retry on mismatch.
- **Unnatural flat sentence endings**: real DSP fix using the WORLD vocoder (`pyworld`, `apply_terminal_fall`) — forces F0 to actually slope downward from its peak. Went through two broken attempts before landing correctly (see PROJECT_CONTEXT.md Sec 11 for exactly why the first two didn't work) — applies to every voice automatically.
- **Multi-sentence text sounding rushed/disconnected/emotionless**: root-caused correctly — every sentence was being generated as a fully isolated model call with zero cross-sentence context, then stitched with an identical digital-silence gap. Not a training problem, a pipeline problem (affects every voice equally). Fixed by grouping consecutive sentences into one generation call (`chunk_sentences`, up to ~40 words, smaller for data-limited voices — see below) plus randomized pause-length jitter. A synthesized "breath" sound was also tried at pause points, then **removed** per direct feedback ("very unnatural") — pause jitter and chunking stayed, breath did not.
- **`plan_delivery()`** (new, built during this session via a parallel Mac-based Claude Code session working the same file, reviewed and deployed by this session): a real heuristic layer that reads punctuation/discourse cues in the text (questions, exclamations, ellipses/hesitation, quoted dialogue, list structure, soft vs. energetic language) and translates them into small bounded offsets to Chatterbox's real knobs (exaggeration/cfg_weight/temperature) plus a pause-length multiplier — not a fake emotion classifier. Merge order: default → per-voice baseline → these offsets → explicit client override. Live and tested in production.
- **Michelle (meditation) — data fix + LoRA retrain done (2026-09-09)**: `scripts/03_chunk_by_speech.py` was silently **discarding** long Whisper segments; fixed to split-at-gap; recovered **~318 clips / ~29.7 min** (filelist ~319 lines on pod). **LoRA retrained** on that expanded set on a fresh RTX 4090 pod (`sloane-ft-michelle-robbo`, id `1kq3e5i11wwj6j`); adapters + merged T3 checkpoint under `/workspace/sloane/chatterbox-ft-voice_meditation/chatterbox_output/` (`new_lang_adapter/adapter_model.safetensors`, `t3_finetuned_merged.safetensors`). Training wall ~72s. **Still live:** `MAX_CHUNK_WORDS_BY_VOICE=14` bandage until ear-tests confirm long chunks are stable; then raise toward ~40 and optionally soften terminal F0 fall for meditation.
- **Robbo (sales) — data expand + LoRA retrain done (2026-09-09)**: was ~16 clips / 9MB; new ~58 min dual-speaker source blended on purpose (not isolated). Ran `/workspace/process_robbo.py` → **~665 clips / ~53.1 min** (`voice_sales` filelist 666 lines). **LoRA retrained** same pod/session; outputs under `/workspace/sloane/chatterbox-ft-voice_sales/chatterbox_output/` (adapter + `t3_finetuned_merged.safetensors`); wall ~149s. Pitch-jitter stopgap still in code — dial down/remove after ear-test. Training pod **stopped** after DONE marker `/workspace/finetune_michelle_robbo.DONE`.
- Real delivery controls (Expressiveness/Speed sliders) remain honestly labeled, wired through both web and mobile.

### MP3 download + no longer exposing the raw GPU pod URL
- `web/src/app/api/audio/[filename]/route.ts` + `web/src/app/api/download-mp3/route.ts` — audio proxied through our own domain, real server-side wav→mp3 transcode (pure JS, no ffmpeg dep), SSRF-guarded (client supplies only a validated filename, never a URL).

### Design (logo + background) — many iterations, converged
- **Logo**: transparent background (smooth alpha falloff), white heartbeat/pulse-line waveform through the capsule, recolored to **an exact purple sampled by the user** from a reference painting (HSV hue/saturation swap, brightness kept per-pixel for the existing glossy shading), plus a **subtle** canvas-grain texture blended in (a bolder version was tried and rejected — too much texture at icon size just reads as noise). Placement: sits **inside** the header card, not floating separately — a brief experiment moving it outside was reverted; the earlier "white background behind the logo" complaint was actually a stray `box-shadow` on the wrapper `<a>` (cast around its rectangular bounding box, not the icon's real silhouette), now removed, so the transparent PNG just blends into the card's cream background directly. **All iterations archived in `design/logo-versions/`** (14+ files), not just the final one.
- **Background**: settled on the original mosaic-courtyard artwork (an AI-generated abstract painting was tried and reverted — evocative of, though confirmed not matching, a real Rothko composition; some viewers might still mistake it, and that was reason enough to revert). Uses **breakpoint-specific** `background-size`/`background-position` (not a single `cover` + position) — `cover` crops a completely different dimension depending on viewport aspect ratio, so a desktop-tuned framing that avoided one problem (a distracting red plant pot in frame) landed squarely on a different problem on mobile (a jarring hard color-block seam in the source art). Both fixed with separate mobile/desktop values. Iterations archived in `design/background-versions/`.

### Voice/UI naming and styling
- Voices renamed for customer-facing display (internal ids unchanged): Kirsty→Vicky, Matt→Patrick, plus Alice/Megan/Katie/Brad/Izzy/Robbo/Michelle/Mark already in place.
- Voice picker selected-state bigger + darker on web (CSS filter) and mobile (scale transform + translucent scrim, since RN has no CSS-filter equivalent).
- Mobile brought to parity with web: delivery sliders (previously silently missing), voice-picker overflow fix (10 voices didn't fit one unwrapped row on a phone), native Share button, and a real background-rendering bug fix — `ScrollView`'s content container only sizes to its content by default, leaving a gap at the bottom showing the wrong color on screens taller than the content (`flexGrow: 1` fix, standard RN pattern). **Verified via `react-native-web` in-browser only — not yet confirmed on an actual device.**

### Video model comparison — done
- Real side-by-side: EchoMimicV3 vs. Hallo2, same reference photo/audio, both zero-shot. **User's verdict: EchoMimicV3 better.** Hallo2 remains the only one with real fine-tuning code.
- Real cost data captured: EchoMimicV3 "flash" variant generates a ~3.24s clip in ~14s of actual GPU sampling; ~9.5min one-time cold start per pod boot; **~$0.005/generation once warm**. This means a "user uploads a photo, gets a fun demo video" feature would be cheap per-use — the real cost is keeping a pod warm 24/7 (~$533/mo), not the generation itself. Worth revisiting if video becomes a priority.
- Hallo2's own training code is full-scale (30,000 steps, reference config uses 8×A100s, no lightweight per-persona adapter path exists) — plausibly hundreds of GPU-hours on our single RTX 4090, not a quick job.
- **Fal smoke tests 2026-09-08 (Vicky / `art_instructor`):** full write-up, exact prompts, curated mp4s/stills/audio, fal COGS, weighted **video credits**, and Stripe tier proposal live in [`docs/fal-video-research/README.md`](./docs/fal-video-research/README.md). **Product split locked:** talking head = Kling Avatar Standard + Lucy TTS; cinematic = Veo 3.1 Fast I2V + Veo audio (separate mode). Prefer demo `docs/fal-video-research/videos/talking-head/vicky_welcome_v2.mp4`. Seedance blocked real face; MiniMax weak; Kling native walk+speak lip sync not shippable. Not wired to `/api/generate-video` yet.

### Inference backend: Pod vs Serverless — default policy
- **Default is Serverless (usage-only billing).** Only switch to Pod (hourly billing) when the user explicitly asks for it — e.g. "we're launching, switch to Pod for a bit." Once traffic quiets down or the explicit ask ends, switch back to Serverless. **Do not leave Pod running by default** — that's exactly the always-on-idle-cost problem Serverless exists to solve.
- **Switch mechanism**: `settings` table in Postgres, key `inference_backend`, values `"pod"` or `"serverless"` — read by `web/src/lib/inferenceBackend.ts`, takes effect immediately on the next request, no redeploy. Toggle from `/admin` (password-gated dashboard) via the "Audio generation backend" buttons, or directly: `UPDATE settings SET value = 'serverless' WHERE key = 'inference_backend';`.
- **Required Vercel env vars for Serverless to work at all**: `RUNPOD_API_KEY` and `RUNPOD_ENDPOINT_ID` (endpoint `2yykjy1xyuecrj`, name `lucy-audio`). **These were missing from Vercel production entirely on 2026-09-09** (only `INFERENCE_SERVER_URL`, the Pod-mode var, was set) — switching to Serverless without them causes every generation to fail with a RunPod 404. Fixed by adding both as Config-type env vars + a redeploy. If Serverless ever silently fails again, check these exist in Vercel first before assuming a RunPod-side problem.
- **Also check `workersMax` isn't stuck at 0** — it was set to 0 on a prior date to halt spend while investigating a capacity issue, and forgetting to raise it back means Serverless will accept jobs but never run them (they sit `IN_QUEUE` forever). Check via the RunPod GraphQL API (`myself { endpoints { workersMax } }`) or console; raise via `saveEndpoint` mutation if needed. Currently set to 3.
- **Real measured cold-start latency (2026-09-09, single uncontended request, live production endpoint): ~177 seconds total** (~149s delay before a worker picked it up + ~28s actual generation) — notably worse than the ~30-90s this was originally sized around. Client-side poll timeout (`POLL_TIMEOUT_MS` in `web/src/app/page.tsx` and `mobile/useAudioGeneration.ts`) was bumped from 180s to **240s** to keep real margin above this. On-page copy was corrected from "20-60 seconds" to "usually under a minute, but can take up to a few minutes after a quiet period" — the old copy was no longer honest once this was actually measured. If cold-start latency is ever revisited, re-measure with a clean single request (not concurrent test jobs, which inflate queue delay and gave a misleadingly worse first impression).

### RunPod pod management — an important operational lesson from today
- Only `sloane-retrain` (audio, `q613gzxs6xrs3h`, IP `213.173.99.21`) should stay `RUNNING` **when Pod mode is explicitly in use** — see "Inference backend" above; by default no pod should be running at all. All 8 other pods, including `sloane-video` (`25cqq216cqtfkn`), are `EXITED` as of this update.
- All pods share the **same persistent network volume** (`oc6yvg9b19`) mounted at `/workspace` — training data, venvs, and scripts are visible from any pod, so there's rarely a need to start a specific stopped pod just to fetch a file.
- **New lesson today**: a stopped pod's "not enough free GPUs on the host machine" failure, while normally resolved by retrying every ~30s for 10-40 minutes, can occasionally persist far longer — `sloane-video`'s specific host was unavailable for **90+ minutes across three full retry cycles** today, well outside the normal range. **If this happens again, the better move is to create a brand-new pod on a different host rather than keep waiting** — since everything that matters lives on the shared network volume, a fresh pod gets full access to all existing data/scripts immediately. This wasn't done today (user called it off for the day before we got to it) but is the clear next step.
- `RUNPOD_API_KEY` is saved in `web/.env.local` (gitignored — copy manually to any new machine, it will not come across via git).
- Balance dipped to **$1.36** at one point today (below the user's $2 alert threshold, flagged in the moment) and was topped up — currently **~$10.27**.
- **2026-09-09:** existing pod hosts had no free GPUs; spun fresh on-demand RTX 4090 `sloane-ft-michelle-robbo` (`1kq3e5i11wwj6j`, shared volume `oc6yvg9b19`) for `process_robbo.py` + `07_finetune_new_voices.sh`; **stopped via runpodctl when training finished**. Production `sloane-retrain` was EXITED during this window — restart before serving traffic.

---

## What's pending

**Immediate next step**
- Start production inference pod `sloane-retrain` (`q613gzxs6xrs3h`) — it was EXITED when training ran; shared volume already has the new LoRAs.
- Re-pick `PRESET_VOICES` reference clips for `voice_meditation` / `voice_sales` in `scripts/06_inference_server.py` (clip numbering may have changed), restart inference, ear-test Michelle + Robbo.
- After ear-tests look good: raise `MAX_CHUNK_WORDS_BY_VOICE` toward ~40 for those voices; reduce/remove `PITCH_JITTER_BY_VOICE["voice_sales"]`.

**Mobile / iOS App Store**
- **Confirm the real-device test actually happened** — it was planned (`npx expo start` + Expo Go on a real iPhone from the user's Mac) but never confirmed completed or reported back this session.
- App Store readiness: **not ready** — untested on a real device (see above), billing routes to a Stripe web checkout which likely needs real Apple In-App Purchase for digital subscriptions (unresolved decision), and voice/video-cloning apps draw extra App Review scrutiny not yet specifically prepared for.

**Voice quality**
- Robbo and Michelle: **retrained 2026-09-09** — still need ref-clip refresh + production ear-tests; then relax chunk cap / pitch jitter.

**Video**
- Research pack committed under `docs/fal-video-research/` (prompts, assets, credit/Stripe plan). Home page still says video isn't sold yet — keep that until `/api/generate-video` ships.
- Next build: wire talking-head (Avatar + Lucy) and cinematic (Veo Fast + audio) with weighted credits on Free/Plus/Pro; see research README for proposed $12 Pro / 90 credits (or $9 / 60). EchoMimic remains free-GPU backup; Hallo2 fine-tune still a major GPU-hour commitment.

**Copyright / rights**
- The unused abstract-painting background image (still in `design/background-versions/`) was AI-generated and doesn't match a specific real Rothko composition, but the generating tool's commercial-use terms were never checked. Low priority since it's not in use.

---

## Next steps, in order

1. Bring `sloane-retrain` back up, point Michelle/Robbo at the new merged checkpoints + fresh reference clips, ear-test, then relax chunk/jitter mitigations if quality holds.
2. Confirm (or actually do, if it hasn't happened) the real-iPhone Expo Go test, then act on whatever it finds.
3. Resolve the Apple In-App Purchase question before attempting an App Store submission.
4. Copy `.env.local` secrets to any new machine manually if not already done — they do not transfer via git.
5. Fal video research pack / credits plan: see `docs/fal-video-research/` (may still need git push from handoff folder if not on GitHub yet).
