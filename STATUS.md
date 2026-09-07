# Lucy — Status Summary

_Last updated: 2026-09-07_

**What this is:** a plain-language overview of what we're building, what's done, and what's left. For full technical decision history, see [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md).

**Naming:** the product is **Lucy**, published by **Lucy Labs**, part of the **Astryks Group**. The codebase, this folder, and the git repo intentionally keep the original working name **Sloane** — that's internal-only and doesn't need to change.

---

## What we're building

A voice- and video-cloning platform with three features:

- **Feature A — Preset voices:** type text, hear it narrated in one of a small number of pre-consented, fine-tuned voices (currently an "art instructor" and a "music instructor"). Fully working, safe to make public.
- **Feature B — Clone any voice:** upload ~10-20 seconds of anyone's voice, type any text, get it narrated back in that voice (zero-shot cloning). Working, but not yet safe to make public without a consent-verification step (see below).
- **Feature C — Clone a face + voice into video:** upload a reference photo/voice and generate a talking-head video. Backend pipeline is working on the GPU server; not yet wired into the app's API.

It runs as:
- A **web app** (Next.js, live at **lucylabs.app**)
- An **iOS app** (Expo/React Native, mirrors the web app's features — not yet submitted to the App Store)
- A **GPU inference server** (FastAPI, runs on a RunPod cloud GPU pod) that both the web and iOS app call

---

## What's done

**Product / brand**
- Product renamed to Lucy Labs throughout the customer-facing site and app (hero heading, browser tab, mobile app name) — codebase/repo stay "Sloane" internally, by design
- Web app redesigned: warm pastel palette, pink/blue/purple sections per feature, custom "Lucy Labs" logo (mic + waveform on a blue-purple gradient badge with a yellow streak), footer with Lucy Labs / Astryks Group / support@astryks.com
- iOS app (Expo/React Native) built mirroring all web features, using the same logo and color language
- Live deployment: **lucylabs.app** is purchased, DNS configured at GoDaddy, deployed on Vercel, verified working (200 OK)

**Voice cloning (Feature A & B)**
- Real (non-mock) inference server built and deployed on a RunPod GPU pod — replaced the earlier mock/placeholder tone generator
- Two preset voices fine-tuned via LoRA on Chatterbox TTS and serving live
- Zero-shot arbitrary voice cloning (Feature B) working end-to-end
- No character-limit handling: long text is split into sentences, generated separately, silence-trimmed, and stitched back together
- Just added: real emotional-intensity and pacing controls (`exaggeration`, `cfg_weight`) instead of flat defaults, plus punctuation-aware pauses (a question lingers slightly longer than a period) — tunable live per-request without redeploying, but **not yet tested by ear on a live pod**

**Video cloning (Feature C)**
- Evaluated three candidate open-source models: OmniTalker (no public code/weights — genuine dead end, confirmed), Hallo3 (found to have weak identity preservation in benchmarks — rejected), **EchoMimicV3** (chosen for generation: Apache-2.0 licensed weights, smaller 1.3B model, no identity red flags)
- Got EchoMimicV3 actually generating video end-to-end on the GPU pod, after fixing six separate environment issues (disk quota, missing dependency, and two rounds of version-compatibility pinning between torch/diffusers/transformers) — that first successful generation used **a Chatterbox-generated audio clip** as the driving audio (not raw recorded speech), confirming the intended design: Chatterbox speaks the text, EchoMimicV3 just lip-syncs a face to that audio. There's no separate "video voice" to worry about — improving Chatterbox's voice quality improves Feature C's audio too, automatically.
- Read the OmniTalker research paper and documented what we can still learn from it even without access to the model itself
- Discovered EchoMimicV3 (all versions) never released *training* code, only inference — so it can't be personalized to a specific person's face without us writing a training loop from scratch (a multi-week undertaking). Researched alternatives and picked **Hallo2** (MIT, has real working training scripts) as the model to actually fine-tune once real video is available; EchoMimicV3 stays as the generation engine for now. Plan: run both zero-shot on the same reference photo, compare quality, then commit a real fine-tuning run to whichever wins.

**Risk management**
- All five open-source projects we depend on or are evaluating (Chatterbox, the Chatterbox fine-tuning toolkit, Hallo3, EchoMimicV3, Hallo2) have their **source code** copied into our own git history under `vendor/`, so we're not exposed if any of them go private, get deleted, or relicense. (Model *weights* — multi-gigabyte files — can't live in git; they stay on the RunPod persistent storage volume, but the exact download commands to regenerate them are documented in `PROJECT_CONTEXT.md`.)

**Safety / policy decisions**
- Agreed approach: launch Feature A (preset voices) publicly first; keep Features B/C (arbitrary cloning) gated until consent-verification is in place — this mirrors how ElevenLabs handles the same risk, and avoids the exact abuse pattern (unconsented voice/face cloning) that gets AI apps rejected from the App Store or scrutinized publicly
- Consent-capture design decided: reuse the voice-embedding step the server already computes, ask the user to read a live phrase, compare embeddings via cosine similarity — no new model or dependency needed
- Face ID requirement agreed as an app-access gate (proves it's the account holder's device), separate from — not a replacement for — the voice-consent check above

---

## What's pending

**Highest priority / blocking everything else**
- **More source footage needed from the instructor(s).** This is the single biggest lever on both open quality issues below (voice accent/tonality AND video facial realism), and needs to come from the Mac — currently blocked on getting that footage onto this machine. *(In progress right now: user has more instructor video on their Mac; see note below on file transfer.)*

**Voice quality** (user feedback: video looks good, voice "needs a lot of work" — emotion, pauses, natural reactions, accent, pitch, tonality, melody)
- Code-level tuning shipped (see above) but not yet tested by ear on a live pod — pod needs to be started back up
- The real fix for accent/tonality is more training data per voice, which needs more source audio/video

**Video facial realism** (user ask: model should learn where the person looks, blinks, facial twitches, subtle expressions, eyebrows, lips, breathing/swallowing)
- Investigated: the current EchoMimicV3 pipeline only accepts a single static reference photo — there's no "learn this person's mannerisms from video" mode in the codebase today. Blinks/gaze/breathing currently come from the model's general pretrained behavior, not anything learned about this specific person.
- Things we can tune right now without new data: longer generated clip length, switching to the slower/higher-quality inference mode, adjusting guidance-scale parameters, using a cleaner reference photo (current one is a cropped screenshot with UI overlays) — none of this tested yet
- The real fix — fine-tuning a model on actual video of the person — needs real source video footage, same blocker as above. Hallo2 (see above) is now vendored and ready to be that fine-tuning target once footage arrives.

**Not yet built**
- Consent-capture flow — design is decided, code isn't written yet
- Feature C wired into the real API — the video-clone button in the app currently calls an endpoint that doesn't exist yet and shows a graceful "coming soon" message

**Paused on purpose**
- iOS App Store submission — intentionally scoped down to Feature A only for now, until the consent-capture safety work above is done. Full B/C launch waits on that.

---

## Next steps, in order

1. **Get the Mac footage onto this Windows machine.** Still the #1 blocker — see note below, this hasn't changed and needs a file transfer, not just permission.
2. Once footage is here: run the Chatterbox fine-tuning pipeline (`scripts/01`-`05`) on the added audio to improve accent/tonality for each voice.
3. Zero-shot compare EchoMimicV3 vs. Hallo2 on the same reference photo/audio (no training needed for this step) to see which is the better starting point.
4. Run a real Hallo2 fine-tuning pass on the new video footage, using whichever model won step 3.
5. Wire Feature C (`/api/clone-video`) into `06_inference_server.py` for real — currently a manual test script only, the app's video button shows "coming soon."
6. Build the consent-capture flow (design already decided — reuse the voice-embedding step, cosine-similarity check against a live-read phrase).
7. Test the voice-quality tuning (exaggeration/cfg_weight/pauses) by ear on a live pod — shipped in code, not yet listened to.

## Right now

The user's Mac (which has more instructor video footage) is a different device from this Windows machine. Claude Code here only has filesystem access to this PC — checked again and confirmed there's still no mapped network drive, iCloud Drive, or synced cloud folder bridging the two machines, so there's no way to reach the Mac's files directly, regardless of permission. To get that footage in: AirDrop-to-cloud, iCloud Drive/Google Drive/OneDrive synced to a folder on this PC, or a direct USB/cable transfer — then point Claude at the resulting local folder.
