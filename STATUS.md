# Lucy Labs — Status Summary

_Last updated: 2026-09-08_

**What this is:** a plain-language overview of what we're building, what's done, and what's left. For full technical decision history, see [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md).

**Naming:** the product is **Lucy Labs**, part of the **Astryks Group**. The codebase, this folder, and the git repo intentionally keep the original working name **Sloane** — that's internal-only and doesn't need to change.

**Handoff note (2026-09-08):** this doc was rewritten right before switching from a Windows machine to a Mac, specifically so a fresh Claude Code session (with no memory of the prior conversation) can pick up accurately. Read this whole file before doing anything.

---

## What we're building

A voice-cloning platform, live in production, with video cloning intentionally paused as a sold feature (see below).

- **Preset voices:** type text, hear it narrated in one of **10 named, fine-tuned voices** — Vicky, Patrick, Alice, Megan, Katie, Brad, Izzy, Robbo, Michelle, Mark (customer-facing names; internal folder/git identifiers stay neutral, e.g. `art_instructor`, `voice_business` — see `web/src/components/VoicePicker.tsx` for the id→name mapping). Fully working, live.
- **Clone any voice:** upload ~10-20 seconds of anyone's voice, type any text, get it narrated back in that voice (zero-shot cloning). Working, live.
- **Video cloning:** **not sold as a feature right now.** The home page shows an honest static demo (embedded EchoMimicV3 test clip) with a message that we're not ready yet, and points users to Kling and Utopai Studios' PAI (what the "Chloe vs History" AI creator runs on) as the current best options. The Pro plan still lists a 30-second/month video allotment, with an explicit on-page disclaimer that it's reserved for when it ships, not a working feature today.

It runs as:
- A **web app** (Next.js, live at **lucylabs.app**, deployed on Vercel)
- An **iOS app** (Expo/React Native, mirrors the web app's voice features) — **not yet submitted to the App Store.** Just brought to feature/style parity with the web app (2026-09-08) but has never been run on a real device or simulator — only type-checked. See "Next steps."
- A **GPU inference server** (FastAPI, `scripts/06_inference_server.py`) on a RunPod pod (`sloane-retrain`, proxy URL in `web/.env.local` as `INFERENCE_SERVER_URL`) that both apps call through Next.js API proxy routes (never called directly by clients)

---

## What's done

### Billing (live, real money)
- Stripe Checkout is **live mode** (real card charges), fully working end-to-end
- Plans: Free (10,000 chars/mo), Plus ($3/mo, 200,000 chars/mo), Pro ($9/mo, 1,500,000 chars/mo + 30s/mo video allotment, reserved not working — see above)
- Access-code based auth (no passwords), Postgres (Neon via Vercel) backing subscriber records/usage
- User still needs to personally verify a real subscribe-with-own-card flow — not something Claude should do

### Audio generation quality (several real bugs found and fixed 2026-09-08)
- **Truncation bug** ("audio isn't playing for all the text, just 3-4 words"): Chatterbox's alignment-stream safety mechanism occasionally forces early EOS. Fixed with a duration-based retry (`generate_sentence_with_retry` in `06_inference_server.py`).
- **Word-skipping bug** (Alice skipped words mid-sentence, duration-only retry didn't catch it): added real content verification — transcribe each generation with faster-whisper, compare word overlap against the input text, retry on mismatch. Both retry mechanisms now live together.
- **Unnatural flat sentence endings**: added a real DSP fix using the WORLD vocoder (`pyworld`) — decomposes each sentence's audio tail into F0/spectral-envelope/aperiodicity, forces the F0 to actually slope downward from its peak (not just transpose the whole tail lower, which was tried first and didn't work — blending the corrected pitch back in with the original was the bug, since it layers two pitches instead of replacing one). Applies to every voice automatically, not a per-voice toggle.
- **Michelle (meditation)** instability: was flagged as unresolved in earlier sessions; retested 2026-09-08 (3x back-to-back generations, all stable ~6.2-6.3s) — turned out the Whisper content-verification fix above resolved it as a side effect. No separate fix was needed.
- **Robbo (sales)** sounds robotic: root-caused precisely — he has **only ~16 training clips (9MB)** vs **514-2368 clips (143-609MB)** for the other voices. That's the real cause, confirmed by comparing `training_data/<voice>/metadata.csv` row counts across voices. Shipped a real DSP mitigation (`apply_pitch_jitter` — a smoothed random-walk wobble on the F0 contour, since a data-starved voice produces unnaturally flat/steady pitch) but this is explicitly a stopgap. **The actual fix needs more Robbo source audio and a retrain — nothing else will fix this.**
- Real delivery controls added: Expressiveness (`exaggeration`) and Speed sliders, honestly labeled (no fake "happy/sad" emotion control — Chatterbox has no such knob), wired through both web and mobile UIs and the generate-preset/clone-voice API routes.

### MP3 download + no longer exposing the raw GPU pod URL
- `web/src/app/api/audio/[filename]/route.ts` — proxies generated audio through our own domain (`/api/audio/<file>.wav`) instead of returning the raw RunPod proxy URL to clients
- `web/src/app/api/download-mp3/route.ts` — real server-side wav→mp3 transcode (pure-JS via `lamejs`/`node-wav`, no ffmpeg dependency), served as a real "Download MP3" button. Both routes take only a validated filename from the client and build the upstream URL themselves (SSRF guard — never fetch a client-supplied URL).

### Design (logo + background), several iterations, 2026-09-08
- **Logo**: redesigned the mic icon — background properly transparent (smooth alpha falloff, not a hard threshold), a white heartbeat/pulse-line waveform running through the capsule (several rounds of position/thickness/shape feedback — final version: full-width single pulse, thicker stroke, sits just below the third grille bar), recolored to match a specific purple sampled from a background art piece the user picked, plus a subtle canvas-grain texture blended in at low strength. **All ~14 iterations archived in `design/logo-versions/`** for reference, not just the final file.
- **Background**: went through several images/treatments — tried an AI-generated abstract painting (color-field style, evocative of but confirmed **not** an actual Rothko piece — composition doesn't match any real Rothko; still worth double-checking the generating tool's commercial-use terms), user asked to revert due to Rothko-similarity concerns from potential viewers. **Current state: back to the original mosaic-courtyard artwork**, with separate CSS `background-size`/`position` tuned per breakpoint (mobile vs desktop — `cover` crops a completely different dimension depending on aspect ratio, so one framing doesn't work for both; this fixed both a red-plant-in-frame complaint and a jarring hard-edge-seam-in-frame complaint). Design iterations archived in `design/background-versions/`.
- Logo placement: sits inside the header card (not floating separately outside it) — transparent PNG blends into the card's cream background with no wrapper box-shadow (that shadow, cast around the image's rectangular bounding box rather than its actual round silhouette, was the real cause of an earlier "white background behind the logo" complaint).

### Voice/UI naming and styling
- Voices renamed for customer-facing display (internal ids unchanged): Kirsty→Vicky, Matt→Patrick, plus Alice/Megan/Katie/Brad/Izzy/Robbo/Michelle/Mark already in place
- Voice picker selected-state: bigger + darker on both web (scale/brightness/saturate via CSS filter) and mobile (RN has no CSS-filter equivalent — used a scale transform + translucent black scrim instead)
- Mobile brought to parity with web: delivery sliders (previously missing entirely — mobile was silently generating with default params regardless of what a user might have wanted), voice-picker overflow fix (10 voices in one unwrapped row doesn't fit a phone width — now wraps), native Share button, and a background-fill bug fix (`ScrollView` content container was only as tall as its content, leaving a gap at the bottom showing the wrong color on short screens — standard RN `flexGrow: 1` fix, verified via `react-native-web` in-browser but not yet confirmed on a real device)

### Video model comparison — done, 2026-09-08
- Ran a genuine side-by-side: **EchoMimicV3 vs Hallo2**, same reference photo (`art_instructor.png`) and driving audio, both zero-shot (no fine-tuning involved for either)
- **User's verdict: EchoMimicV3 is better.** Hallo2 remains the only one of the two with real fine-tuning code (EchoMimicV3 has none, confirmed in an earlier session) — so the honest tradeoff is: EchoMimicV3 wins zero-shot quality now, but Hallo2 is the only path to ever improve past zero-shot via fine-tuning on real footage.
- **Real timing/cost data captured** (previously only guessed): EchoMimicV3's "flash" variant (8 diffusion steps) generates a ~3.24s clip in about **14 seconds of actual GPU sampling time**. Cold-start model loading is ~9.5 minutes (one-time per pod boot, not per generation). Once warm, **each generation costs roughly $0.005** at $0.74/hr — genuinely cheap. The earlier assumption that a "user uploads a photo, get a fun demo video" feature would be too expensive to run was wrong on a per-generation basis; the real cost is keeping a GPU pod warm 24/7 (~$533/mo fixed), not the generation itself. Worth revisiting if video becomes a priority.
- Hallo2 fine-tuning reality check: there is **no lightweight per-persona fine-tune path** in Hallo2's own training code — the only scripts (`stage1.yaml`/`stage2_long.yaml`) are full-scale runs, **30,000 steps**, reference config uses **8 GPUs** (A100s). On our single RTX 4090 this is plausibly hundreds of GPU-hours, not a quick job. Recommended approach if this gets prioritized: run a short test at a fraction of the steps first (500-1000) to get a real per-step timing/quality number before committing to a full run.

### RunPod pod management
- **9 pods total** on the account; only `sloane-retrain` (audio, `q613gzxs6xrs3h`, IP `213.173.99.21`) should stay running — it serves live production traffic. Everything else, including `sloane-video` (`25cqq216cqtfkn`), should be stopped when not actively in use.
- `sloane-video` and `sloane-retrain` (and all other pods) share the **same persistent network volume** (`oc6yvg9b19`) mounted at `/workspace` — files created via one pod are visible from any other pod, so there's rarely a need to start a stopped pod just to fetch a file.
- Starting a stopped pod can fail with `"not enough free GPUs on the host machine"` — this is normal, the pod is pinned to a specific physical host; retrying every ~30s usually succeeds within 10-40 minutes. A RunPod API key is saved in `web/.env.local` as `RUNPOD_API_KEY` (⚠️ **`.env.local` is gitignored and will NOT come across on a fresh clone** — copy it manually, or the key + all other secrets there are lost).
- Balance was hovering around **$3-5** as of 2026-09-08 (RunPod warns below $5) — **check current balance before assuming there's runway for a new pod session.**

---

## What's pending

**Mobile / iOS App Store**
- User is about to test the app for real for the first time, from a Mac, via `npx expo start` + Expo Go on a real iPhone (this doc was updated in anticipation of that). **Whatever that test finds should be the next session's first priority.**
- App Store readiness assessment (2026-09-08): **not ready.** Three concrete blockers — (1) never tested on a real device before now, (2) billing currently routes to a Stripe **web** checkout, which is a likely App Store rejection reason for digital subscriptions (Apple generally requires In-App Purchase for this) and needs a real decision, not just a code fix, (3) voice/video-cloning apps get extra App Review scrutiny for misuse potential — worth having safeguards/messaging ready before submitting, not after a rejection.

**Voice quality**
- Robbo needs real new source audio + a retrain — the DSP mitigation shipped is a stopgap, not a fix (see above)
- Michelle appears resolved (retested clean) but was flagged wrong once before — worth a second look if instability resurfaces

**Video**
- Not an active build target right now — home page and Pro plan both say so honestly, with references to Kling/Utopai's PAI
- If revisited: real per-generation cost for EchoMimicV3 is cheap (~$0.005/generation warm) — see above, changes the calculus for a "fun demo" feature
- Hallo2 fine-tuning is a real option for eventually beating EchoMimicV3's zero-shot quality, but is a **major** GPU-hour commitment (see above) — do a small-scale timing test before committing to a full run

**Copyright / rights**
- The abstract-painting background image (no longer in use, but still in `design/background-versions/`) was AI-generated, not a scan of a real painting, and doesn't match a specific known Rothko composition — but the generating tool's own commercial-use terms were never actually checked. Low priority since it's not in use, but worth resolving before ever reusing it.

---

## Next steps, in order

1. **Test on a real iPhone via Expo Go** (`cd mobile && npx expo start`, scan the QR) — first real device test ever. Check especially: the background-gap fix, delivery sliders, voice-picker sizing/wrapping, native Share button.
2. Based on what that finds, either fix issues or move to the App Store IAP-compliance decision (Apple IAP vs. some other approach) before attempting submission.
3. If prioritizing video: decide whether to pursue the Hallo2 fine-tune (do a small-scale timing test first, per above) or keep video paused.
4. If prioritizing voice quality: source more Robbo audio for a real retrain.
5. Copy `.env.local` secrets (Stripe live key, RunPod API key, Postgres URLs) to the new machine manually — they will not come across via git.
