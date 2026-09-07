# Lucy — Voice Clone Platform — Full Project Context

**Naming note (2026-09-07):** the public/customer-facing product is named
**Lucy** (domain: lucyvoice.ai). The codebase, local folder, and GitHub repo
keep the original working name **Sloane** — a deliberate choice (internal
codename vs. public product name is normal practice), not an oversight. Don't
"fix" mismatched Sloane/Lucy references in file paths, the repo URL, or
git history — those are correct as-is.

Last updated: 2026-09-06. This file is meant to be self-contained — read this
top to bottom on a fresh machine and you'll have full context to keep going
without re-explaining anything.

---

## 0. Decisions locked in

- **Engine: Chatterbox** (Resemble AI, MIT licensed) — zero-shot TTS voice
  cloning, plus fine-tuning per preset voice. Not RVC, not XTTS-v2, not
  building a model from scratch (TL;DR: a *modest* scratch-built TTS model
  still runs ~$50K + 10,000 hours of curated data; Chatterbox was trained on
  ~500,000 hours by a funded team — fine-tuning their MIT-licensed weights
  gives you a model you fully own without that cost).
- **Compute: RunPod** — for the prototype build-out *and* planned as the
  production inference host (RunPod Serverless once live). Vast.ai is
  cheaper on paper but carries real reliability risk on unverified hosts
  (~20-40% effective cost increase once you count restarts/lost progress
  from interruptions), and verified Vast.ai hosts cost about the same as
  RunPod anyway — going with RunPod throughout for consistency and its
  better documentation/precedent for this exact workflow.
- **Product = two features on one page**, both described precisely in §2.
- **Local GPU checked on both machines — neither works, RunPod is not
  optional**: the Mac (M1) has no CUDA GPU, and the Windows PC was checked
  2026-09-06 — Intel Iris Xe integrated graphics only, no NVIDIA card, no
  `nvidia-smi`. Rent a pod; don't spend more time looking for a local-GPU
  shortcut.
- **No RunPod plugin/MCP integration for Claude Code** — RunPod's official
  agent-setup doc (`docs.runpod.io/agent-setup.md`) offers a Claude Code
  plugin marketplace + OAuth-connected MCP server, but it's unneeded for
  this project: everything in Phases 1-6 is plain shell commands once a pod
  exists. Decided 2026-09-06 to skip it (avoids a standing third-party
  integration + OAuth grant for no real benefit) and instead drive the pod
  directly over **SSH** once it's deployed.

---

## 1. What we're building

1. **Prototype** — clone the voices of two named instructors (a male music
   teacher and a female art teacher) from an existing masterclass video
   series, as the testbed for the two features below. Consent for using this
   footage this way has been confirmed by the project owner (you).
2. **Public platform ("Lucy")** — a web + iOS product, three features (see
   §9 for the expanded scope decided 2026-09-07).

## 2. Feature specs (precise)

### Feature A — Text box + voice picker (preset voices)

- User types text into a box, picks a voice from a dropdown/toggle (the two
  instructor voices — described casually as "girl or boy voice"; more
  presets can be added later the same way).
- Backend generates narration audio in that preset voice and returns it for
  playback/download.
- Model: Chatterbox, **fine-tuned per instructor** using the hours of clean
  masterclass audio already extracted (far more data than a zero-shot
  reference needs, so a fine-tune sounds materially better than treating
  these two like generic uploads).
- API contract (draft):
  ```
  POST /api/generate-preset
  { "text": string, "voice_id": "art_instructor" | "music_instructor" }
  -> { "audio_url": string }
  ```

### Feature B — Upload a clip + text box (clone any voice)

- User uploads a short clip (~30-60 sec) of any voice, types any text, hits
  generate, gets that text spoken back in the uploaded voice.
- Model: Chatterbox **zero-shot cloning** — no training step, reference clip
  supplies the speaker embedding at inference time.
- API contract (draft):
  ```
  POST /api/clone-voice
  { "text": string, "reference_audio": file }
  -> { "audio_url": string }
  ```
- **This is the higher-risk feature** (any user, any voice) — see §3 for the
  consent/safety gate that must exist before it's exposed to anyone beyond
  you testing with your own voice or the two already-consented instructors.

---

## 3. Consent & safety posture (non-negotiable before any public exposure)

- The two instructors' masterclass footage: **consent confirmed by project
  owner**. Keep documentation of that on file.
- Before **Feature B** goes in front of anyone other than you/internal
  testing: required, not optional, and this is standard practice across
  every legitimate voice-cloning product (ElevenLabs, Resemble, PlayHT)
  specifically because this category is one of the most abused in AI
  (impersonation, fraud calls, non-consensual content):
  - **Consent capture at upload**: live "voice captcha" — user records a
    fresh, randomly-generated phrase live through the browser mic right
    after uploading, a speaker-verification model (embedding cosine
    similarity) confirms it matches the uploaded sample. Users can only
    clone **their own voice** by default, not someone else's.
  - **No-go list** for public figures/politicians.
  - **Inaudible watermarking** on every generated output (e.g. Meta's
    AudioSeal, MIT licensed) for traceability.
  - **Abuse controls**: per-account rate limits, anomaly detection on rapid
    multi-voice enrollment, a report/takedown flow.
  - **Audit trail**: every generated clip traceable back to an account.
- Feature A (preset voices only) doesn't need the consent-captcha (there's
  no user-supplied voice), but should still carry watermarking + rate limits
  once public.

---

## 4. What's already been done

**Current location (Windows):**
`C:\Users\SidMehta\Downloads\Sloane the voice clone\`
(moved here from the original Mac path
`/Users/siddharthmehta/Desktop/Sloane the voice clone/` — zip transferred and
extracted 2026-09-06; the Mac's `.venv` and macOS metadata were dropped since
neither is usable on Windows/a RunPod pod — you'll create a fresh venv
wherever the code actually runs.)

- Project scaffolded: `scripts/`, `raw_audio/`, `docs/`.
- **`scripts/01_extract_audio.py`** — ran locally, done. Extracted audio from
  hand-picked, speech-heavy masterclass videos (skipped ones with
  singing/music overlay) into `raw_audio/`:
  - `art_instructor/`: instructor intro, "Anyone Can Paint", "Tracing", "What
    to paint", "Painting a parrot in watercolour" → **~95 min raw audio**
  - `music_instructor/` (Matt Landi): "Where to begin writing a song",
    "Really listen to your favourite songs", "JUST START", "Finding the
    pitch", "Find your note range" → **~47 min raw audio**
  - Source videos (Mac): `/Users/siddharthmehta/Desktop/Astryks/Art/ART` and
    `/Users/siddharthmehta/Desktop/Astryks/Music/Music production - Matt Landi/MUSIC REVISED`
    — several more hours of unprocessed footage available if more data is
    ever needed (e.g. two ~57-59 min "Painting a..." videos).
- **`scripts/02_separate_vocals.py`** — **done** (2026-09-06, on RunPod). Fixed
  a version-drift bug first (newer `torchaudio` defaulted to a
  `torchcodec`-backed loader we didn't have installed; switched the script to
  use `soundfile` for I/O instead). Output: `clean_audio/` on the pod's
  network volume, 603MB, all 10 source files processed.
- **`scripts/03_chunk_by_speech.py`** — running as of this writing. Needs a
  CUDA GPU (faster-whisper). Transcribes + cuts `clean_audio/` into
  utterance-level clips (2-15 sec) with `filelist.csv` (clip path,
  transcript, duration) per speaker — the audio+text format Chatterbox
  fine-tuning needs.
- `requirements-local.txt` / `requirements-cloud.txt` written.
- Neither the Mac nor the Windows PC has a usable GPU (see §0) — RunPod is
  the only path forward for steps 2 onward.

### RunPod operational notes (learned 2026-09-06/07)

- **Web app + API scaffolded and pushed**: `web/` (Next.js) and `api/`
  (FastAPI, currently mocked pending real Chatterbox wiring) live in this
  repo at github.com/Siddharth09/Sloane, both verified running locally.
- **SSH access**: RunPod's account-level SSH key (added under Settings → SSH
  Public Keys) does **not** reliably propagate into a pod's own
  `authorized_keys` if the pod was already running when the key was added —
  direct-TCP SSH failed with "Permission denied" until fixed. Workaround
  used once: connect via the `ssh.runpod.io` proxy (that one *does*
  authenticate against the account key, but only gives an interactive shell —
  no scriptable command execution, no SCP/SFTP), pipe commands into it via
  stdin to manually append the key to `~/.ssh/authorized_keys`. On the
  *second* pod (below) the key was present automatically from pod creation —
  seems to depend on whether the key existed on the account before the pod
  was created.
- **Stopping/restarting pods risks losing your host's GPU capacity.**
  Stopped the first pod (`classic_lime_cuckoo`, id `8edb8a1th43nze`) to pause
  billing after Phase 2 Demucs step finished — its host machine then had no
  free RTX 4090 to restart into (Community Cloud is shared capacity, not
  guaranteed). Fix: deployed a **new** pod attached to the *same* network
  volume (`oc6yvg9b19`, 50GB, datacenter `EU-RO-1` — network volumes are
  datacenter-locked but independent of any specific pod/host, so all data
  survived) — Community Cloud had zero capacity for any GPU type in that
  datacenter at the time, but **Secure Cloud** in the same datacenter did,
  at the same $0.74/hr price. Current pod: `sloane-pod-2`
  (id `oxo0ndci51nv1g`).
- **Takeaway for next time**: stopping a pod to save money is still worth
  doing, but be ready to redeploy a fresh pod (same network volume, broaden
  `gpuTypeIds` to a list + `gpuTypePriority: "availability"`, try `SECURE`
  cloudType if `COMMUNITY` has no capacity) rather than assuming the exact
  same pod will restart cleanly.
- **RunPod API key** stored locally at `.secrets/runpod_api_key`
  (git-ignored, never committed) — used directly via
  `https://rest.runpod.io/v1/...` (Bearer auth) for stop/start/create, no
  plugin/MCP integration installed (see §0).

---

## 5. Precise next steps, in order

### Phase 1 — RunPod environment ← done
1. Create a RunPod account at runpod.io, add a payment method. (This step
   is yours to do directly — account creation/billing needs your own
   details.)
2. Spin up a Community Cloud pod, RTX 4090, a PyTorch/CUDA base template.
3. On the pod's page in the RunPod dashboard, click **Connect** and copy the
   SSH connection command/details (host, port, and either a password or that
   it uses your SSH key).
4. Send those SSH details over — from there everything is driven directly
   over SSH (upload `raw_audio/`, `pip install -r requirements-cloud.txt`,
   run the scripts) — no RunPod plugin/MCP/OAuth needed (see §0).

Once you have a RunPod account with billing set up and a pod deployed, send
the SSH details and the rest of Phase 1-2 gets run directly.

### Phase 2 — Data cleanup (run on the pod) ← **done**
5. ~~`python3 scripts/02_separate_vocals.py` → `clean_audio/`~~ done
6. ~~`python3 scripts/03_chunk_by_speech.py` → `training_data/<speaker>/clips/`
   + `filelist.csv`~~ done — **art_instructor: 712 clips, 47.5 min;
   music_instructor: 390 clips, 36.5 min**. Pod stopped after this
   (`sloane-pod-2`, ~34 min runtime, ~$0.42).

### Phase 3 — Zero-shot validation ← **done** (2026-09-07)
7. ~~Install Chatterbox on the pod~~ done — `pip install chatterbox-tts`.
   Two bugs hit and fixed along the way: (a) `perth` (Resemble's bundled
   audio watermarker — nice, means watermarking from §3 is already half
   handled) failed to import because `pkg_resources` was missing under
   newer `setuptools` (85+ dropped it); fixed by pinning `setuptools<80`.
   (b) background/detached remote processes (`nohup`, even `setsid`) kept
   getting silently killed on this pod for long-running installs — the
   fix that actually worked was running the install directly over a single
   held-open SSH connection (foreground from the client's side) rather than
   detaching it remotely at all. Worth remembering for any future long job.
8. ~~Pick one clean ~30-90 sec reference clip per instructor~~ done —
   `scripts/04_zeroshot_test.py`, one ~14-15 sec clip per speaker from
   `training_data/<speaker>/clips/`, 2 test sentences each. **All 4
   generated successfully and were sent to the user to listen to.** This
   is already a rough working backend for **both Feature A and Feature B**
   (Feature A pins the reference clip server-side; Feature B takes it from
   upload) — zero-shot, no fine-tuning yet.

### Phase 4 — Real backend API ← **done** (2026-09-07)
9. ~~Small FastAPI service on the pod~~ done —
   `scripts/06_inference_server.py`, run via `uvicorn` in tmux on the pod
   (port 8000, exposed through RunPod's HTTP proxy at
   `https://<pod-id>-8000.proxy.runpod.net`). Loads three engines once at
   startup: the two fine-tuned preset voices (Feature A — reuses the same
   LoRA-adapter loading pattern as `inference.py`, proven in Phase 6, not
   the untested merged-checkpoint path) plus one base zero-shot engine
   (Feature B). Same endpoint contract as the local mock
   (`api/main.py`): `/api/generate-preset`, `/api/clone-voice`.
   "No character limit" implemented via sentence-chunking + VAD silence
   trim + concatenation (reuses `trim_silence_with_vad` from the
   fine-tuning toolkit). Feature B enforces an 8 sec minimum upload
   (between the ~3 sec internal reference window and the ~10-20 sec
   guidance from Sec 9 — 8 sec is a practical floor, not a hard technical
   one). First request after cold start took ~37 sec (model
   warmup/CUDA kernel compilation); subsequent requests 3-8 sec depending
   on text length.
10. ~~Store generated audio in temporary storage~~ done — local disk on the
    pod (`/workspace/sloane/api_generated_audio/`), served via FastAPI's
    `StaticFiles` mount. Object storage still deferred to the real platform
    build (§7).

### Phase 5 — Frontend ← **done**, now wired to the real backend
11. The two-section page from Phase 5 originally called a **local mock**
    (`api/main.py` on Windows, returns a sine-wave tone) — now
    `web/.env.local` sets `NEXT_PUBLIC_API_BASE` to the pod's proxy URL, so
    the exact same frontend hits real fine-tuned/zero-shot generation.
    Verified end-to-end through the actual browser (not just curl) for
    both features. **`.env.local` is git-ignored and pod-specific** — every
    time the pod is redeployed (new pod id → new proxy URL) this file needs
    updating, same as the SSH host/port dance in §0/Phase 1.
12. ~~This is enough for you to test both features end-to-end~~ confirmed
    working, 2026-09-07.

### Phase 6 — Quality upgrade ← **done** (2026-09-07)
13. ~~Fine-tune Chatterbox per instructor~~ done. User feedback on the
    zero-shot clips (Phase 3) was clear: **"they sound robotic... they don't
    have the Australian accent, intonation, pitch, pausing, speed,
    personality"** — expected for zero-shot (one 14-sec clip can't teach
    accent/prosody, only approximate timbre). Fine-tuning fixes this because
    it actually updates model weights on the full dataset.
    - **Tooling**: [gokhaneraslan/chatterbox-finetuning](https://github.com/gokhaneraslan/chatterbox-finetuning)
      (Apache-2.0, commercial-friendly), LoRA mode (recommended for <10hrs of
      data — ours is 47.5/36.5 min). Vendors its own copy of the Chatterbox
      code (`src/chatterbox_/`) rather than depending on the pip package.
    - **Data format conversion**: our `filelist.csv` (from faster-whisper,
      §4) → the toolkit's LJSpeech-style `metadata.csv`
      (`filename|raw_text|normalized_text`, pipe-delimited, **no header** —
      the parser uses `header=None`, an included header row gets treated as
      a bogus, harmless data row). One 14-15 sec clip per speaker
      (`training_data/<speaker>/clips/00266.wav` art, `00042.wav` music —
      the same ones used for the Phase 3 zero-shot reference) reused as the
      training-time reference prompt too.
    - **Bugs hit and fixed, in order** (worth reading before doing this
      again):
      1. `check_pretrained_models()` in the toolkit hardcodes a relative
         `./pretrained_models` path and **ignores** the `model_dir` config
         value entirely (a bug in the toolkit) → fixed by symlinking
         `pretrained_models` into each speaker's working directory rather
         than patching the toolkit's source.
      2. Missing `peft` package (listed in `requirements.txt` but not
         actually installed until explicitly done).
      3. `peft==0.17.1` vs. an already-installed `transformers==5.2.0`:
         `ImportError: cannot import name 'HybridCache'` (newer transformers
         renamed/removed classes peft 0.17.1 expects).
      4. Missing `tensorboard` (also listed in `requirements.txt`, also not
         actually installed — HuggingFace `Trainer` auto-detects and
         requires it for logging).
      5. **Root fix for #2-4**: stop installing packages one at a time —
         `pip install -r requirements.txt` (the toolkit's own file) in one
         shot resolved everything consistently, landing on
         `chatterbox-tts==0.1.2` + `transformers==4.46.3` (the versions the
         toolkit was actually built/tested against — note this downgrades
         the pip `chatterbox-tts` package from the 0.1.7 used in Phase 3;
         shouldn't matter for training since it uses vendored code, but
         worth knowing if Phase 3's zero-shot script needs rerunning).
      6. `inference.py`/`merge_lora.py` for **LoRA mode specifically**
         require running `merge_lora.py` **before** `inference.py` (the
         script looks for an already-merged `t3_finetuned_merged.safetensors`
         file, not the raw adapter) — contradicts the README's stated
         "test the adapter directly" workflow; treat merge-then-infer as the
         real order.
      7. `inference.py`'s test text/reference-audio/output path are
         **hardcoded Python constants inside the script** (`TEXT_TO_SAY`,
         `AUDIO_PROMPT`, `OUTPUT_FILE`), not read from `config.py` — edit the
         script directly each time.
    - **Reliability lesson (separate from the above, cost real time)**:
      background/detached remote processes (plain `nohup`, even `nohup` +
      `setsid`) kept getting silently killed on this pod with no error/OOM
      evidence once the parent SSH connection's channel closed — even
      though they should have survived detachment. What actually worked:
      **`tmux`** (a real detached session, `tmux new-session -d`) for
      anything that might run longer than a few minutes; a single
      held-open SSH connection (no remote backgrounding at all) for
      shorter one-shot commands. Don't trust `nohup`/`setsid` alone on this
      environment.
    - **Result**: both LoRA adapters trained fast once the environment was
      correct — ~2.5 min actual training time each (712 clips/220 steps for
      art, 390 clips/120 steps for music; 10 epochs, batch size 8 ×
      grad_accum 4). Merged into standalone checkpoints
      (`t3_finetuned_merged.safetensors`, ~2.1GB each) at
      `/workspace/sloane/chatterbox-ft-<speaker>/chatterbox_output/` on the
      pod's network volume (not downloaded locally — large binary
      artifacts, not committed to git). Test clips generated and sent to
      the user for a listen — **awaiting feedback** on whether quality is
      good enough to wire into the real API (Phase 4) or needs another
      pass (more epochs, more data, or hyperparameter changes).
    - Pod runtime for all of Phase 6: ~45 min, ~$0.55.

### Phase 7 — Before any public/external user touches Feature B
14. Build the consent-captcha, watermarking, rate limiting, and audit trail
    from §3. Do not skip this to "launch faster" — it's the difference
    between a normal product and a legal/abuse liability.

**Summary:** Phases 1-5 get a working private demo of both features; Phase 6
is a quality pass; Phase 7 is the gate before anyone but you uses Feature B.

---

## 6. Cost recap (prototype phase, RunPod, both speakers)

| Item | Estimate |
|---|---|
| Local extraction/cleanup prep | $0 (already done) |
| RunPod pod, cleanup + zero-shot validation (Phases 1-3) | ~$2-5 GPU time |
| Fine-tune both preset voices (Phase 6) | ~$5-15 GPU time |
| Generous experimentation/iteration throughout | ~$20-30 total |

Public platform running costs are a separate, later conversation once usage
patterns are known — RunPod Serverless's pay-per-second model keeps early
costs low regardless.

---

## 7. The product platform (once the prototype validates)

### Suggested stack

- **Frontend**: Next.js (React) — the two-section page from Phase 5, later
  polished.
- **Backend API**: FastAPI (Python) — voice enrollment, generation requests,
  job queueing.
- **Inference**: RunPod Serverless endpoint running Chatterbox.
- **Accounts/DB**: Supabase (Postgres + auth + storage bundled, fast to
  stand up, generous free tier) — accounts, voice profiles (embeddings, not
  necessarily raw audio), generation history.
- **Audio storage**: Supabase Storage or Cloudflare R2 (no egress fees).
- **Hosting**: Vercel (frontend), Fly.io/Render (API layer).

### Domain & naming (decided 2026-09-07)

Product name: **Lucy**. Domain: **lucyvoice.ai** — grab it soon, cheap
(~$10-40/yr via Cloudflare Registrar or Namecheap), squatting risk is real
for a good name. Purchase is yours to do directly on your own account.

Company/brand name alternatives to "Lucy Labs" (the "Labs" domain was
taken): **Lucy Studio**, **Lucy Voice Co.**, **Lucy Audio**, **Lucy Sound**,
**Lucy Forge**, **Lucy Works**, or singular **Lucy Lab** (worth checking —
"Lab" singular is often still available when "Labs" plural is taken).

---

## 8. Feature C: video cloning (EchoMimicV3) — **activated 2026-09-07**

Raised 2026-09-06: a third feature where a user uploads a video of
themselves and types text, and the system generates a video of them
speaking that text in their own voice/likeness ("text-to-video" cloning,
lip-synced). **Update 2026-09-07: no longer deferred — user wants this
built now, see §9.** Original deferral reasoning kept below for the
cost/safety context, which still applies and still needs addressing before
any public exposure of this feature specifically. Ship
Features A+B first, validate the core product, then scope this properly as
its own effort. Reasoning below, kept here so the idea isn't lost.

### Why this is a different order of magnitude, not just "one more feature"

- **Compute cost per generation is roughly 10-100x higher than audio.**
  Chatterbox (audio) generates faster than real-time even on a 4090 — a
  20-sec clip costs a fraction of a cent in GPU time. Talking-head video is
  diffusion-based and far from real-time — a 10-20 sec clip can take tens of
  seconds to a couple minutes of compute, and generally wants an
  A100/H100-class card for acceptable speed, not a 4090. Rough, unverified
  order of magnitude: audio ~$0.001-0.01/generation vs. video
  ~$0.05-0.50+/generation — **treat this as directional only**; benchmark
  for real on the RunPod pod before relying on any number here.
- **UX shape changes.** Sub-2-min-wait TTS is synchronous request/response;
  60-90+ sec video generation needs a job queue + "we'll notify you" pattern,
  plus much larger file storage/egress (video: tens of MB vs. a voice clip's
  few hundred KB).
- **Safety bar jumps hard.** Audio cloning is already regulated-adjacent;
  face-cloned video is the core "deepfake" category most AI-generated-media
  laws specifically target (several US states, EU AI Act synthetic-media
  disclosure rules). On top of everything in §3, this needs: face-liveness
  consent capture (live selfie + spoken phrase, video analog of the voice
  captcha), **visible** on-screen AI-disclosure/watermark or C2PA-style
  provenance (inaudible watermarking alone, as used for audio, isn't
  considered sufficient for video), and a stricter no-go list. This is closer
  to needing an actual moderation/legal review pass before public launch,
  not a checkbox like Feature B's gate in §3/Phase 7.

### Model choice: OmniTalker vs. Hallo3

- **OmniTalker** (Alibaba Tongyi) — better conceptual fit: a single model
  takes reference video + text and jointly generates voice + lip-synced
  video in one pass, closer to real-time, avoids the error-compounding of a
  two-stage pipeline.
- **Hallo3** (Fudan/Baidu) — cascaded approach (Chatterbox generates audio
  first, Hallo3 separately animates the face to it). More mature/documented,
  wider community support, but the cascade adds latency and lip-sync can
  drift slightly since the two models weren't trained together.
- **Unresolved, verify before committing to either:** current commercial-use
  licensing terms for both — fast-moving open-source releases from Chinese
  labs sometimes carry non-commercial/research-only clauses that would block
  using them in a paid public product.

### When to pick this back up

~~After Phases 1-6 are done~~ — Phases 1-6 are done (2026-09-07), and the
user wants Feature C started now rather than waiting further. Still do the
real benchmarking/license-check/safety-design pass described above before
building on top of whichever model is chosen — none of that changed, just
the timing.

### Important correction (2026-09-07): OmniTalker isn't actually available

While vendoring dependencies for backup (see `vendor/README.md`), found that
**OmniTalker has no public model code or weights** — its GitHub repo is only
a project page (paper links, demo videos, no source), and its Hugging Face
Space is a thin UI that calls a private internal Alibaba backend not
reachable outside their infra. There's nothing to self-host, and no
commercial/API access path either — checked for an Alibaba Cloud
DashScope listing or any paid API; found nothing connecting OmniTalker to
any public offering. It is simply not accessible by any means right now.

**First replacement pick was Hallo3** (Fudan, CVPR 2025) — real repo, MIT
code, downloadable weights. **Superseded same day** after actually
comparing options instead of taking the first available one: a benchmark
comparison specifically flagged Hallo3 as having **"severe limitations in
preserving character identity"** — a dealbreaker for a product whose whole
point is the video looking like the *specific* real person, not just
looking generally realistic. Also heavier to run (CogVideoX-5B backbone).

### Feature C candidate, revised: EchoMimicV3 (Ant Group/Alipay)

[antgroup/echomimic_v3](https://github.com/antgroup/echomimic_v3) (AAAI
2026) — chosen over Hallo3 because:
- **License covers the weights explicitly**, not just the code: "The
  models in this repository are licensed under the Apache 2.0 License" —
  a cleaner story than Hallo3's code-only MIT license with weight terms
  still unverified.
- **Lighter/faster**: 1.3B parameters vs. Hallo3's 5B-backbone CogVideoX —
  a "Flash" variant needs as little as 12GB VRAM, comfortably fits our
  existing RTX 4090/L4 pods without needing a bigger (pricier) GPU.
- **No identity-preservation red flag** found in the comparison that
  flagged Hallo3's weakness.
- Real weights confirmed downloadable (Hugging Face + ModelScope).

Hallo3 stays vendored (small, no harm keeping it as a secondary reference/
fallback) but EchoMimicV3 is the active plan. Cascaded pipeline as
originally scoped (Chatterbox generates audio, EchoMimicV3 separately
animates the face/body to it) — same OmniTalker-style joint generation
advantage doesn't apply to either alternative since only cascaded models
are actually available.

**Lesson for next time**: don't lock in the first technically-available
option under time pressure — do the comparison pass (license terms
covering weights specifically, VRAM/speed, and the metric that actually
matters for the product, here identity preservation over generic FID/FVD
scores) before vendoring/committing to a specific model.

---

## 9. Expanded scope, decided 2026-09-07

After hearing the two fine-tuned voices, user confirmed quality is good
enough to build the real product. Scope grew in this conversation:

### Product surface: web + iOS app, three features
1. **Feature A (preset voices)**: text box, no character limit, voice
   picker — expanding from 2 to **5** preset voices (user will provide 3
   more source audio sets; same consent posture as §3/§2 applies to each
   new one — confirm consent before adding).
2. **Feature B (upload-and-clone)**: user uploads a clip, types text (no
   character limit), gets it read back in that voice. Minimum upload
   length relaxed from the original "~30-60 sec" spec to **~10-20 seconds**
   — Chatterbox's own reference-conditioning window is a fixed ~3 sec
   internally (per the fine-tuning toolkit's `prompt_duration` config), so
   feeding it much more than ~20 sec of reference doesn't meaningfully
   improve zero-shot quality the way more data helps *fine-tuning*. Guidance
   to users should still be "clean, single-speaker audio," not just "10 sec
   of anything."
3. **Feature C (video cloning)**: activated, see §8 — EchoMimicV3 (revised
   from an initial OmniTalker→Hallo3→EchoMimicV3 pivot the same day, not
   deferred anymore).

### No character limit — technical approach
Chatterbox generates per-sentence/per-chunk, not arbitrary-length text in
one call (there's a practical token/length ceiling per generation - our own
scripts already split per sentence). "No character limit" is achievable by
chunking input text into sentences/clauses, generating each separately, and
concatenating the audio (trimming inter-chunk silence — the fine-tuning
toolkit's `trim_silence_with_vad` utility already does this and can be
reused). Not a blocker, just needs building into the real API (Phase 4).

### Emotion/pacing control
Chatterbox has real, non-per-word controls worth exposing in the product
eventually: `exaggeration` (emotional intensity), `cfg_weight` (pacing/
adherence to reference), `temperature` (natural micro-variation). True
per-word emotional/pacing control isn't natively supported — the practical
path is varying these per sentence-chunk (see above), not per word.

### iOS + web platform decision — **React Native/Expo, decided 2026-09-07**
User chose to build the iOS app in React Native/Expo from the start (over
"web-first, PWA on iOS" or "fully native Swift"). Note this needs an Apple
Developer Program membership ($99/yr, user's own account) and App Store
review before public release — App Store review can be stricter for AI
voice/likeness apps specifically, separate from whatever web-side consent/
safety work (§3) is needed.

**Re-examined 2026-09-07 (user pushed back on "is this actually the best
way"), confirmed correct**: the earlier framing of "sharing logic with the
web build" overstated things — Next.js (DOM: `div`/`input`) and React
Native (native views: `View`/`TextInput`) don't share actual UI component
code, only the language (TypeScript) and, if factored out deliberately, the
API-calling/business-logic functions. A fully unified codebase is possible
via Expo + `react-native-web`, but that means rewriting the *already-built
and verified* Next.js UI in RN-primitive style — not worth it given how
simple these screens actually are (a handful of form fields + an audio/
video player). **Decision: build a separate, small Expo/React Native app
that duplicates the same few screens against the same backend API**, rather
than unifying — the duplication cost is low precisely because the app is
simple, which is the same reasoning the user offered. React Native (over
Flutter) remains the right call specifically because it shares the
language and API logic with the existing TypeScript/Next.js backend calls;
Flutter (Dart) would share nothing.

### Making the fine-tuned voices even better — options, roughly in order of
effort/impact
1. **More training data**: several more hours of unprocessed source footage
   already known about (§4) but not yet extracted/used — likely the single
   highest-impact next step given how little (47.5/36.5 min) produced the
   quality jump already heard.
2. **More epochs / tune LoRA rank up** from the current defaults (10
   epochs, `lora_r=128`) — cheap to experiment with given each run took
   only ~2.5 min.
3. **Per-speaker `exaggeration`/`cfg_weight`/`temperature` tuning** — quick,
   cheap A/B listening tests once wired into inference.
4. **Not recommended**: switching from LoRA to full fine-tune — the
   toolkit's own guidance is full fine-tune needs "strictly larger than 10
   hours" of data to be worth it; we're nowhere near that even with more
   footage extracted.
5. Keep iterating with real listening feedback (what's already working) —
   quality judgments here are inherently subjective/human, not something to
   over-automate.
