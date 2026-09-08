# Lucy Labs — Status Summary

_Last updated: 2026-09-08 (evening)_

**What this is:** a plain-language overview of what we're building, what's done, and what's left. For full technical decision history, see [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md).

**Naming:** the product is **Lucy Labs**, part of the **Astryks Group**. The codebase, this folder, and the git repo intentionally keep the original working name **Sloane** — that's internal-only and doesn't need to change.

**Handoff note:** this doc is kept current specifically so a fresh Claude Code session (no memory of prior conversations) can pick up correctly. Read this whole file before doing anything. Git working tree is clean as of this update — everything described below is committed and pushed to `main`.

---

## What we're building

A voice-cloning platform, live in production, with video cloning intentionally paused as a sold feature (see below).

- **Preset voices:** type text, hear it narrated in one of **10 named, fine-tuned voices** — Vicky, Patrick, Alice, Megan, Katie, Brad, Izzy, Robbo, Michelle, Mark (customer-facing names; internal folder/git identifiers stay neutral, e.g. `art_instructor`, `voice_business` — see `web/src/components/VoicePicker.tsx` for the id→name mapping). Fully working, live.
- **Clone any voice:** upload ~10-20 seconds of anyone's voice, type any text, get it narrated back in that voice (zero-shot cloning). Working, live.
- **Video cloning:** **not sold as a feature right now.** The home page shows an honest static demo (embedded EchoMimicV3 test clip) with a message that we're not ready yet, and points users to Kling and Utopai Studios' PAI (what the "Chloe vs History" AI creator runs on) as the current best options. The Pro plan still lists a 30-second/month video allotment, with an explicit on-page disclaimer that it's reserved for when it ships, not a working feature today.

It runs as:
- A **web app** (Next.js, live at **lucylabs.app**, deployed on Vercel)
- An **iOS app** (Expo/React Native, mirrors the web app's voice features) — **not yet submitted to the App Store, and not yet confirmed working on a real device.** Brought to feature/style parity with web, and a real background-rendering bug was found and fixed, but the actual "run it on a real iPhone via Expo Go" verification step (handed to the user, since this environment can't run the iOS Simulator) was never confirmed completed this session — **check this first** if picking up mobile work.
- A **GPU inference server** (FastAPI, `scripts/06_inference_server.py`) on a RunPod pod (`sloane-retrain`, proxy URL in `web/.env.local` as `INFERENCE_SERVER_URL`) that both apps call through Next.js API proxy routes (never called directly by clients)

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
- **Michelle (meditation) — root cause found and actually fixed at the data level, not just mitigated**: `scripts/03_chunk_by_speech.py` was silently **discarding** any transcribed segment longer than her clip-length cap instead of splitting it. Guided-meditation narration has long pauses, so whisper's VAD merges speech across them into segments that almost always exceeded the cap — meaning **only 6.6 of ~50 minutes** of her already-cleaned (vocal-isolated) source audio ever reached training data. Fixed to split at the largest internal word-to-word gap instead of discarding; recovered **318 clips / 29.7 minutes** from the *same* source audio. Re-ran the pipeline (03 → 05 → 09) on the pod; re-running 05 for all speakers as a side effect reset the speaker-isolation filtering for `voice_business`/`voice_finance`/`voice_broadcast` (05 regenerates unfiltered metadata for everyone) — caught this and re-ran 09 to correctly re-apply their cluster filters, verified row counts match pre-existing values exactly. **Retraining Michelle's LoRA on this expanded dataset has not happened yet** (blocked on GPU pod availability — see below).
- **Michelle — immediate live mitigation (separate from the data fix, shipped same day)**: her LoRA (like Robbo's) can't reliably handle a long continuous generation the way better-trained voices can — reproduced live: grouping her into ~30-word chunks (the new multi-sentence chunking above) caused near-total generation failure. Added `MAX_CHUNK_WORDS_BY_VOICE` capping her and Robbo at 14 words/chunk, close to one-sentence-at-a-time. Confirmed fixed live (3x retest, all healthy 7.5-10s durations, vs. 0.5-0.6s failures before).
- **Robbo (sales)**: root cause confirmed precisely earlier — only ~16 training clips (9MB) vs. 500+ clips (140-600MB) for other voices. A DSP mitigation (`apply_pitch_jitter`) shipped as a stopgap. **New today**: the user provided a new 58-minute source video (`Downloads/robbo.mp4`) containing two similar-sounding men, with an explicit instruction to blend both into one voice rather than isolate a single speaker (unlike voice_business/finance/broadcast, which *were* isolated to one speaker). Audio extracted locally via ffmpeg, uploaded to the pod as a second raw-audio source. A processing script is staged and ready (`/workspace/process_robbo.py` on the pod — vocal separation, chunking with the same split-not-discard fix, metadata regen, re-applying the other voices' isolation filters) but **has not been run yet** — blocked on the same GPU pod availability issue.
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

### RunPod pod management — an important operational lesson from today
- Only `sloane-retrain` (audio, `q613gzxs6xrs3h`, IP `213.173.99.21`) should stay `RUNNING` — it serves live production traffic. All 8 other pods, including `sloane-video` (`25cqq216cqtfkn`), are `EXITED` as of this update.
- All pods share the **same persistent network volume** (`oc6yvg9b19`) mounted at `/workspace` — training data, venvs, and scripts are visible from any pod, so there's rarely a need to start a specific stopped pod just to fetch a file.
- **New lesson today**: a stopped pod's "not enough free GPUs on the host machine" failure, while normally resolved by retrying every ~30s for 10-40 minutes, can occasionally persist far longer — `sloane-video`'s specific host was unavailable for **90+ minutes across three full retry cycles** today, well outside the normal range. **If this happens again, the better move is to create a brand-new pod on a different host rather than keep waiting** — since everything that matters lives on the shared network volume, a fresh pod gets full access to all existing data/scripts immediately. This wasn't done today (user called it off for the day before we got to it) but is the clear next step.
- `RUNPOD_API_KEY` is saved in `web/.env.local` (gitignored — copy manually to any new machine, it will not come across via git).
- Balance dipped to **$1.36** at one point today (below the user's $2 alert threshold, flagged in the moment) and was topped up — currently **~$10.27**.

---

## What's pending

**Immediate next step (queued, ready to run)**
- Get GPU time on any pod (existing or freshly created — see lesson above), then: (1) run `/workspace/process_robbo.py` on the pod (vocal separation + chunking + metadata for the new Robbo video, deliberately not speaker-isolated), (2) run `bash scripts/07_finetune_new_voices.sh` (already configured for `voice_meditation` + `voice_sales`) to retrain both LoRAs on their expanded datasets, (3) update each voice's reference clip path in `PRESET_VOICES` (06_inference_server.py) since clip numbering will have changed, (4) redeploy and test both voices by ear.

**Mobile / iOS App Store**
- **Confirm the real-device test actually happened** — it was planned (`npx expo start` + Expo Go on a real iPhone from the user's Mac) but never confirmed completed or reported back this session.
- App Store readiness: **not ready** — untested on a real device (see above), billing routes to a Stripe web checkout which likely needs real Apple In-App Purchase for digital subscriptions (unresolved decision), and voice/video-cloning apps draw extra App Review scrutiny not yet specifically prepared for.

**Voice quality**
- Robbo and Michelle: data recovered/added, retraining queued but not run (see "Immediate next step").

**Video**
- Not an active build target — home page and Pro plan both say so honestly. Real per-generation cost is cheap if revisited (~$0.005/gen warm); Hallo2 fine-tuning remains a major GPU-hour commitment if ever pursued.

**Copyright / rights**
- The unused abstract-painting background image (still in `design/background-versions/`) was AI-generated and doesn't match a specific real Rothko composition, but the generating tool's commercial-use terms were never checked. Low priority since it's not in use.

---

## Next steps, in order

1. Get a GPU pod running (retry `sloane-video`, or create a fresh one on a different host if that stalls again like it did today) and run the queued Robbo + Michelle data processing and retraining.
2. Confirm (or actually do, if it hasn't happened) the real-iPhone Expo Go test, then act on whatever it finds.
3. Resolve the Apple In-App Purchase question before attempting an App Store submission.
4. Copy `.env.local` secrets to any new machine manually if not already done — they do not transfer via git.
