# Lucy — Voice Clone Platform — Full Project Context

**Naming note (2026-09-07):** the public/customer-facing product is named
**Lucy**, published by **Lucy Labs** (App Store publisher name — no conflict
with the app's own display name "Lucy", totally normal setup). Domain
purchased: **lucylabs.app** (supersedes the earlier lucyvoice.ai idea — not
purchased, no longer the plan). The codebase, local folder, and GitHub repo
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

### Consent-capture implementation plan (decided 2026-09-07)

User's direction: use ElevenLabs' approach as the standard, but take the
easiest/lowest-effort path to the same safety outcome rather than copying
their implementation blindly — don't add complexity that isn't necessary.

- **Random phrase, live recording**: keep as-is from the ElevenLabs pattern
  — server returns an unpredictable short phrase, user reads it aloud live
  right after uploading. Cheap, and the unpredictability is what actually
  defeats replay-attack abuse (can't reuse a pre-recorded clip of someone
  else). Not worth simplifying further.
- **Similarity check — the actual simplification**: rather than standing up
  a separate speaker-verification model, **reuse the voice-embedding step
  our inference server already runs**. Feature B's zero-shot cloning
  (`06_inference_server.py`) already extracts a speaker embedding from the
  uploaded reference clip as part of generation — extract one from the
  live-recorded phrase too and compare via cosine similarity. No new model,
  no new dependency, one extra comparison step reusing what's already
  loaded in memory.
- **Threshold**: start with a reasonable default (commonly ~0.75-0.8 cosine
  similarity for speaker-verification embeddings) and tune from real usage
  rather than extensive upfront calibration — least-resistance here too.
- **Same idea applies to Feature C (face) later**: EchoMimicV3's pipeline
  already does face detection (`retina-face` dependency, `src/face_detect.py`
  in the vendored code) — likely reusable for a face-embedding similarity
  check the same way, instead of adding a separate face-verification model.
  Not yet implemented/verified — flag for when Feature C's consent gate is
  actually built.
- **Face ID (iOS)**: separate, complementary concern — an **app-access
  gate** (require Face ID to open the app / before generating), not a
  substitute for the above. Face ID only proves "this is the device's
  registered owner," it can't verify "this uploaded voice/face is the same
  person" — Apple doesn't expose biometric matching against arbitrary
  third-party content. Adds accountability (ties usage to a real
  authenticated device) but doesn't replace the consent-capture flow.

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

### Domain & naming (decided 2026-09-07, domain purchased same day)

Product name: **Lucy**, published by **Lucy Labs**. Domain: **lucylabs.app**
— purchased. DNS not configured yet — nothing to point it at until the app
is actually deployed (Vercel or wherever); once deployed, add the domain in
that host's dashboard and it'll show the exact DNS records to add at the
registrar. iOS App Store: "Lucy Labs" as the publisher/developer name and
"Lucy" as the app's display name is a completely normal, non-conflicting
setup (e.g. "Instagram" published by "Meta Platforms, Inc.").

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

### What OmniTalker's paper teaches us, even though we can't use it

Can't self-host OmniTalker (§ above), but its paper
([arxiv.org/abs/2504.02433](https://arxiv.org/abs/2504.02433),
[project page](https://humanaigc.github.io/omnitalker/)) is genuinely
useful to study on its own merits — read in full 2026-09-07. It's a
**joint** audio+video model (single dual-branch diffusion transformer, both
modalities generated together); we're running a **cascaded** pipeline
(Chatterbox generates audio, then EchoMimicV3 separately animates video to
that audio) — most of its architecture isn't transferable to a
black-box-model cascade, but several findings are directly useful:

- **Confirms our EchoMimicV3 pick already uses the same speed trick.**
  OmniTalker's 25 FPS real-time performance comes partly from **flow
  matching** (Conditional Flow Matching / rectified flow) instead of
  standard diffusion noise schedules — and the EchoMimicV3 repo we already
  vendored ships `fm_solvers.py` / `fm_solvers_unipc.py`, meaning it already
  uses flow-matching solvers too. Not a new lesson to apply — a reassuring
  confirmation the alternative we picked isn't missing this optimization.
- **Our cascade sidesteps a problem OmniTalker had to solve.** A real
  chunk of their design (the duration-prediction module, estimating target
  sequence length from a character-count ratio before generation) exists
  because they generate audio and video *simultaneously* and need to agree
  on length upfront. Since our pipeline generates audio *first*
  (Chatterbox) and video is driven by that already-fixed-duration audio
  track, this synchronization problem doesn't arise for us at all — a
  genuine structural advantage of cascading for this specific concern, not
  just a consolation prize for lacking joint generation.
- **Evaluation gotcha worth remembering when judging our own output later**:
  the paper's authors note some standard sync metrics (Sync-C, CSIM)
  "favor forward-facing videos" and penalize models (like theirs) that
  preserve the reference's actual head angle/orientation instead of
  forcing a frontal bias. When we evaluate EchoMimicV3 output quality,
  judge identity/likeness accuracy directly (the reason we picked it over
  Hallo3) rather than leaning on generic sync scores that can reward the
  wrong thing.
- **If we ever fine-tune EchoMimicV3 per-instructor** (mirroring what we
  did for Chatterbox voices): OmniTalker's style-capture trick is a
  masked-infilling in-context method — split same-identity video into two
  segments, mask one, learn to predict it from the other, discard the
  reference at inference. Worth checking whether EchoMimicV3's own
  (vendored) training scripts support something analogous before assuming
  a from-scratch approach is needed — not yet checked, flag for when
  Feature C fine-tuning actually starts.
- **Reinforces, doesn't change, the safety posture already in §3**:
  OmniTalker's own paper includes an explicit misuse-risk/ethics statement
  — the same category of concern already driving our consent-capture/
  watermarking/no-go-list requirements for Feature C before any public
  exposure.

### First working EchoMimicV3 generation — **done** (2026-09-07)

Set up a dedicated pod (`sloane-echomimic`), separate Python 3.10 venv
(isolated from the Chatterbox venv — different, heavier dependency tree:
tensorflow, retina-face, moviepy). Downloaded the Flash variant's weights
(Wan2.1-Fun-V1.1-1.3B-InP base model, chinese-wav2vec2-base audio encoder,
EchoMimicV3-flash-pro transformer — ~24GB total) via `hf download`
(the `huggingface-cli` command is deprecated in favor of `hf` in this
environment's `huggingface_hub` version).

Ran `infer_flash.py` with the real art instructor reference photo (a
cropped screenshot the user provided — no clean standalone photo of the
instructors exists yet, this was a placeholder-quality input, not a proper
reference image) and a Chatterbox-generated audio clip as the driving
audio. **Produced a real output video** on the third clean attempt, after
fixing:

1. **Network volume disk quota** — 50GB wasn't enough once `.venv` (19GB,
   mostly tensorflow/torch) plus model downloads were added. Fixed via
   `POST /networkvolumes/{id}/update` with `{"size": 100}` — RunPod
   supports live-resizing a network volume via the API; freed ~6GB more by
   deleting the Chatterbox LoRA training checkpoints (`checkpoint-220`/
   `checkpoint-120` dirs) we no longer needed (adapter + merged weights
   already saved separately).
2. **`pyloudnorm` missing** — listed nowhere in the toolkit's own
   `requirements.txt` despite being a real import; installed directly.
3. **CUDA OOM (23.4/23.5GB used)** despite the README's "12GB VRAM" claim
   — root cause was a `diffusers` version too new to have
   `load_model_dict_into_meta` (an internal memory-efficient-loading
   helper), forcing a much less efficient loading path. Downgraded
   `diffusers` to `0.31.0`.
4. **That downgrade broke a different import** (`FLAX_WEIGHTS_NAME` from
   `transformers.utils`, removed in whatever `transformers` version was
   auto-resolved) — needed an *era-consistent pairing*, not just one
   package downgraded in isolation. Pinned `transformers==4.46.3` (the
   same version that already worked well for Chatterbox) alongside
   `diffusers==0.31.0`, and both required symbols imported cleanly.

**Result**: 8-step Flash inference took ~13 seconds of actual GPU compute
once the environment was correct (model loading from the 24GB of weights
on the network volume was the slow part, several minutes each attempt).
Pod runtime for this whole session: ~1h40m, ~$1.24 — most of that was
environment debugging, not generation itself.

**Still needed before this is a real product feature, not just a proof of
concept**: a proper clean reference photo per instructor (what we used was
a cropped screenshot, not ideal), the consent-capture/watermarking/no-go-
list work from §3, and wiring this into `06_inference_server.py` /
`/api/clone-video` the way Chatterbox is already wired for Features A/B.

### Facial realism request, 2026-09-07 — eyes, blinks, twitches, breathing

User asked for the model to learn person-specific eye gaze, blinks, facial
twitches, subtle expressions, eyebrows, lips, breathing, swallowing.
**Checked the actual pipeline code before answering** (`infer_flash.py`,
`infer_preview.py`): both take **only a single static image**
(`--image_path`) — there is no video-reference or style-input mode in this
codebase. Important consequence: none of the above can be *learned* from
the specific instructor via a photo. It's generated entirely from
EchoMimicV3's own pretrained prior on "how humans generally move," applied
to our still image + audio — not lifted from real footage of the person,
since we never gave it any.

**Tunable now, no fine-tuning needed** (not yet empirically tested — needs
a real pod session):
- **`video_length`**: used 81 frames (~3.24 sec) for the first test —
  likely too short to naturally fit a blink cycle (humans blink roughly
  every 2-10 sec) or a breath. Try longer.
- **`infer_preview.py` instead of `infer_flash.py`**: Flash's 8-step
  process trades subtlety for speed; the repo's own tuning tips suggest
  15-25 steps for "talking body" quality — worth comparing against Flash's
  faster-but-cruder output.
- **`guidance_scale` (3-6) / `audio_guidance_scale` (1.8-2)**: documented
  real tradeoffs (tighter audio/prompt adherence vs. better raw visual
  quality) — worth A/B testing rather than guessing a value.
- **A real reference photo**, not a cropped screenshot with UI overlays.

**What would actually deliver instructor-specific mannerisms** (not just
generic human behavior): fine-tuning EchoMimicV3 itself on real *video* of
the instructor — meaningfully bigger than the Chatterbox LoRA work (video
diffusion fine-tuning needs more data/compute), and hits the **same
blocker as the voice-accent issue**: real video source footage only exists
on the Mac, not this machine. Both "make the voice/accent better" and
"make the face more personally realistic" converge on the same next
decision needed from the user: get more of the original source video
transferred, or confirm what we already have is what we're working with.

### EchoMimicV3 has no training code — Hallo2 added as the fine-tuning path, 2026-09-07

Checked whether we could build our own training loop against EchoMimicV3
to close the gap above. Confirmed via the vendored copy: EchoMimicV3
upstream ships **inference only** (`infer_flash.py`, `infer_preview.py`)
— Ant Group never released training/fine-tuning code for any version of
the EchoMimic family (v1, v2, or v3). Writing that ourselves against a
closed recipe would be a multi-week undertaking (loss design, data
loading for video instead of a single image, GPU-memory handling for
video-diffusion training, avoiding catastrophic forgetting) — not
something to take on speculatively.

Researched alternatives that actually ship public training code with a
permissive license and a reasonable identity-preservation reputation.
Ruled out: EchoMimic v1/v2 (same dead end, no training code ever
released), LivePortrait (no training code, and video-driven not
audio-driven), MuseTalk (has training code but only inpaints lip-sync
onto an existing driving video — doesn't generate blinks/gaze/breathing
itself), SyncTalk/DreamTalk (non-commercial-only licenses), AniTalker
(authors declined to release training code on purpose).

**Chosen: Hallo2** ([fudan-generative-vision/hallo2](https://github.com/fudan-generative-vision/hallo2),
MIT, vendored to `vendor/hallo2-upstream/`) — a real, complete training
pipeline (`scripts/train_stage1.py`, `scripts/train_stage2_long.py`),
confirmed present in the vendored copy, not just claimed in the README.
Earlier "reference-network" architecture than Hallo3 (which we already
rejected for weak identity preservation) — a plausible reason Hallo3
regressed, and a reason to expect Hallo2 holds identity better.
AniPortrait (Tencent, Apache-2.0, also has full training code, landmark-
driven) is the runner-up if Hallo2 underperforms. Ditto (Ant Group,
Apache-2.0, training code on a separate branch, released Nov 2025) is
too new to have a track record — worth a future look, not a first bet.

**Important: this does not merge with EchoMimicV3.** Different base
architectures (EchoMimicV3 is a Wan2.1 diffusion-transformer model;
Hallo2 is a UNet + reference-network model) — their weights can't be
combined. The plan is to run them as two separate pipelines:
1. Now, no new data needed: get Hallo2 running zero-shot (no training)
   on the same reference photo + audio already used for EchoMimicV3, and
   compare output quality/identity preservation side by side.
2. Once real source video arrives from the Mac: run one real fine-tuning
   pass, on whichever model wins step 1.

RunPod pod status checked 2026-09-07: no pod currently running (all
`EXITED`), so no active GPU cost while this decision was made.

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
3. ~~**Per-speaker `exaggeration`/`cfg_weight`/`temperature` tuning**~~ —
   wired into `06_inference_server.py` 2026-09-07, see below.
4. **Not recommended**: switching from LoRA to full fine-tune — the
   toolkit's own guidance is full fine-tune needs "strictly larger than 10
   hours" of data to be worth it; we're nowhere near that even with more
   footage extracted.
5. Keep iterating with real listening feedback (what's already working) —
   quality judgments here are inherently subjective/human, not something to
   over-automate.

### Voice quality pass, 2026-09-07 — user feedback: video good, voice needs work

Specifically asked for: emotion, pause, human-like reactions, accent,
pitch, tonality, melody. Worth noting up front — since EchoMimicV3 animates
the face *from the audio track*, better emotional/paced audio should
improve facial expressiveness too as a side effect, not just the sound.

**Shipped now (code-only, no GPU/retraining needed):**
- Chatterbox's real expressiveness controls (`exaggeration`,
  `cfg_weight`) were never actually being set — silently defaulting to
  neutral 0.5/0.5. Set starting values (`exaggeration=0.6` for a bit more
  warmth, `cfg_weight=0.4` for looser/less robotic pacing, per the
  fine-tuning toolkit's own tuning tips) and — more importantly — made
  both **overridable per-request** (`/api/generate-preset` and
  `/api/clone-voice` now accept optional `exaggeration`/`cfg_weight` form
  fields) so the *actual* right values can be found by ear via real A/B
  listening, not guessed once and left alone. These starting values are
  informed by the model's documented behavior, not empirically verified by
  listening yet — that still needs a real pod session.
- Punctuation-aware pause length between sentences, replacing one fixed
  0.2s gap everywhere: `?` lingers slightly longer (0.32s), `!` and `.`
  shorter, matching how a real speaker's pacing actually varies by what
  the sentence just did. Small, but a concrete, unambiguous improvement
  (not a tuning question) unlike the exaggeration/cfg_weight starting
  values above.

**Not a code fix — needs a real decision:** pitch, tonality, melody, and
especially **accent** are primarily learned from training data, not
inference-time parameters. The single biggest lever is still #1 above —
more training data — and it's now the honest blocker: the additional
hours of unprocessed source footage mentioned in §4 live on the **Mac**,
not this Windows machine (only `raw_audio/` — the already-extracted clips —
made the transfer). Needs the user to either transfer more source video
from the Mac, or confirm there's no more footage worth using beyond what
we already have.

---

## 10. Web app redesign, 2026-09-07

Visual + UX overhaul of `web/` — warm pastel palette (cream background,
coral/rose/sage/lavender/butter accents, Nunito font replacing the default
Geist), replacing the plain black-and-white functional prototype look.

- **Feature A**: circular color-coded voice avatars (`VoicePicker.tsx`)
  instead of a plain dropdown.
- **Feature B & C**: `RecordOrUpload.tsx` + `useMediaRecorder.ts` — a shared
  component/hook for both audio and video, giving users a real in-browser
  **record** option (mic for audio, live webcam preview for video via
  `getUserMedia`/`MediaRecorder`) alongside file **upload**, not just a
  file picker. Feature C's UI is built even though the backend isn't ready
  yet (calls `/api/clone-video`, not yet implemented — shows a graceful
  "coming soon" error until EchoMimicV3 is wired up).
- **Social sharing** (`ShareButtons.tsx`): Facebook and WhatsApp have real
  web share URLs (`facebook.com/sharer/sharer.php`, `wa.me`) and are wired
  directly. **Instagram has no equivalent web share URL** — there's no
  fabricating one. The real cross-platform answer is the native Web Share
  API (`navigator.share`), which hands off to whatever's installed
  (Instagram included) on supporting browsers; a "copy link" fallback
  covers browsers without it.
- No new icon library added — a handful of inline SVGs
  (`components/Icons.tsx`) instead, keeping dependencies minimal.
- Verified rendering and structure via the browser (screenshots + DOM
  measurements + accessibility tree) — actual in-browser mic/camera
  recording still needs testing on a real device with real hardware
  permissions, not verifiable from this automated environment.

## 11. Session updates, 2026-09-08

Long session, many small real fixes plus two larger investigations. Full
plain-language summary in `STATUS.md` — this section has the technical
detail that doesn't fit there.

**Audio generation bugs (all in `scripts/06_inference_server.py`):**
- Added Whisper-based content verification (`faster_whisper`, model
  `"small"`) alongside the existing duration-based retry in
  `generate_sentence_with_retry()` — transcribes each generated sentence,
  computes word-overlap ratio against the input text
  (`word_overlap_ratio()`), retries (up to `MAX_GENERATION_ATTEMPTS = 4`)
  when either duration is too short OR overlap < `MIN_WORD_OVERLAP_RATIO =
  0.7`. Fixed a reported mid-sentence word-skipping bug (Alice) that the
  duration check alone couldn't catch.
- `apply_terminal_fall()`: forces a real downward F0 slope on each
  sentence's tail using `pyworld` (WORLD vocoder — `harvest`/`cheaptrick`/
  `d4c`/`synthesize`). Went through two broken iterations before landing
  correctly: v1 did a flat `librosa.effects.pitch_shift` on the tail (only
  transposes register, doesn't change contour shape — a rising ending
  stayed rising, just lower-pitched). v2 computed a corrected F0 via
  pyworld but then amplitude-crossfaded it back in with the original over
  the whole tail — **wrong**, blending two differently-pitched signals in
  the amplitude domain layers two simultaneous pitches rather than
  replacing one, so the ear kept tracking the untouched original. v3 (final,
  live): commits fully to the corrected pitch for the whole tail (only a
  ~15ms crossfade at the splice point, to avoid a click — not a pitch
  blend), and anchors the forced fall to the tail's actual F0 **peak**
  rather than its first frame, since a rise can keep climbing past where
  the tail window starts. `TERMINAL_FALL_SEMITONES = 5.0`,
  `TERMINAL_FALL_TAIL_MS = 450.0`. Applies unconditionally to every voice
  (not per-voice gated), skipped for sentences ending in `?`.
- `apply_pitch_jitter()`: new per-voice mitigation for Robbo (`voice_sales`)
  sounding robotic. Root cause confirmed by comparing
  `training_data/<voice>/metadata.csv` row counts: voice_sales has 16
  clips/9MB vs 514-2368 clips/143-609MB for voice_business/voice_tech/
  voice_finance. Adds a smoothed random-walk wobble to the F0 contour
  (`PITCH_JITTER_BY_VOICE = {"voice_sales": 0.4}`) via pyworld, mimicking
  natural pitch micro-instability a data-starved LoRA doesn't produce on
  its own. Explicitly documented in-code as a mitigation, not a fix — real
  fix needs more source audio + a retrain.
- `pyworld` added to `requirements-cloud.txt` (installed fine via pip on
  the pod, no compiler issues despite building from source).

**Billing / API surface (`web/src/`):**
- `api/audio/[filename]/route.ts` (new) + `api/download-mp3/route.ts`
  (new): stopped returning the raw `INFERENCE_SERVER_URL` to clients.
  `generate-preset`/`clone-voice` routes now rewrite `audio_url` to
  `/api/audio/<file>.wav` (same domain). MP3 download does a real
  server-side transcode via `@breezystack/lamejs` + `node-wav` (pure JS,
  no ffmpeg binary needed — kept Vercel serverless deploy simple). Both
  new routes take a validated filename only (`^[a-zA-Z0-9_-]+\.wav$`),
  never a client-supplied URL, to avoid SSRF.
- `lib/plans.ts`: video removed from the Pro plan, then **restored** same
  day per explicit user direction — keep the 30s/mo allotment listed (it's
  reserved/aspirational) but make the "not ready yet" messaging explicit
  in `billing/page.tsx` (a `note` field on the Pro plan card) referencing
  Kling and Utopai Studios' PAI by name. Pro's character limit was bumped
  750k→1.5M along the way and left there.
- `app/page.tsx` `VideoCloneSection`: replaced the non-functional
  upload/generate UI (called `/api/clone-video`, which was never wired up)
  with a static embed of a real EchoMimicV3 test clip
  (`public/echomimic-demo.mp4`) plus the same honest copy/model references.

**Design assets:**
- `design/logo-versions/` and `design/background-versions/` (new) — every
  iteration of both, not just the final file, per explicit user request
  ("save all logo versions and background versions"). ~14 logo iterations,
  3 background iterations.
- Final logo: transparent background (smooth per-pixel alpha falloff based
  on distance-from-white, not a hard threshold — the earlier hard-threshold
  version left a visible halo against non-pure-white page backgrounds),
  white heartbeat/pulse-line waveform (multiple rounds of position/
  thickness feedback), recolored via HSV hue/saturation swap (keeping
  per-pixel value/brightness for the existing glossy-3D shading) to match
  a purple swatch the user sampled directly from a reference painting, plus
  a low-strength (35%) overlay-blend texture pass using that same
  painting's canvas-grain as the blend source.
- Background: swapped between the original `mosaic-courtyard.png` and an
  AI-generated abstract painting a couple of times based on feedback (the
  abstract one read as too similar to a real Rothko to some viewers,
  despite not matching any actual Rothko composition — reverted back to
  mosaic-courtyard as the shipped choice). Landed on breakpoint-specific
  `background-size`/`background-position` (not just `cover` + one
  position) because `cover` crops a different dimension depending on
  viewport aspect ratio, so a single framing that avoided one problem
  (a distracting element in the source image) on desktop created a new one
  (landing on a hard color-block seam in the source art) on mobile.

**Video model comparison (real, not simulated):**
- Ran actual EchoMimicV3 and Hallo2 zero-shot inference on the same
  `art_instructor.png` + `driving_audio.wav`, on the `sloane-video` pod
  (host machine `ddqsq8hvnt1h`, network volume `oc6yvg9b19` shared with
  `sloane-retrain`). User's verdict: EchoMimicV3 better.
- Hallo2 setup completed for real this session (earlier attempts had
  failed with "connection reset by peer" — turned out to just be the pod
  going idle/stopped, not a real install bug): all deps installed clean
  (torch 2.2.2+cu121, confirmed CUDA available), 13GB of pretrained
  weights downloaded via `huggingface-cli download fudan-generative-ai/
  hallo2 --local-dir ./pretrained_models` (36 files, ~90s on this pod's
  bandwidth), inference run via `scripts/inference_long.py` with
  `--source_image`/`--driving_audio` CLI overrides.
- Real EchoMimicV3 timing captured via a dedicated timed test
  (`infer_flash.py`, the 8-step "flash" checkpoint,
  `video_length 81, fps 25` = 3.24s output): **~14s actual sampling time**,
  ~9.5min cold-start (one-time per pod boot, model loading from disk).
  Warm per-generation cost ≈ $0.005 at $0.74/hr. This directly
  contradicts an earlier-session assumption that a user-facing "upload a
  photo, get a fun demo video" feature would be too expensive to run —
  the real fixed cost is keeping a pod warm 24/7, not the generation
  itself.
- Hallo2's training code (`configs/train/stage1.yaml`,
  `stage2_long.yaml`) is full-scale training, not a lightweight per-
  persona adapter: `max_train_steps: 30000` for both stages,
  `accelerate_config.yaml` defaults to `num_processes: 8`
  (DeepSpeed ZeRO stage 2), README says "Tested GPUs: A100." No LoRA/
  DreamBooth-style path exists in the repo. On a single RTX 4090 this is
  plausibly hundreds of GPU-hours, not the "few hours" originally assumed
  — corrected course with the user on this mid-session.

**RunPod operational notes:**
- Full pod inventory fetched via `GET https://rest.runpod.io/v1/pods`:
  9 pods total, only `sloane-retrain` (`q613gzxs6xrs3h`) should stay
  `RUNNING`. `sloane-video` (`25cqq216cqtfkn`) was started/stopped twice
  this session for the comparison + timing test work, each time hitting
  `"not enough free GPUs on the host machine"` on the first several start
  attempts (resolved by polling `POST /v1/pods/{id}/start` every 30s —
  succeeded within 8-18 minutes both times).
  Balance checked via GraphQL (`POST https://api.runpod.io/graphql` with
  `query { myself { clientBalance } }` — the REST API has no equivalent
  endpoint) — hovered $3-5 across the session.
- `RUNPOD_API_KEY` saved to `web/.env.local` (gitignored — does not
  transfer via git, must be copied manually to any new machine).

**Mobile app** (`mobile/App.tsx`, `mobile/DeliverySliders.tsx` new):
- Brought to parity with the web redesign: delivery sliders (added
  `@react-native-community/slider` dependency — mobile had no sliders at
  all before, silently generating with default params), voice-picker
  selected-state styling (scale transform + translucent scrim, since RN
  has no CSS `filter` equivalent), a native `Share.share()` button, and a
  fix for 10 voice circles overflowing an unwrapped flex row off-screen
  (`flexWrap: "wrap"`).
- Fixed a background-fill bug: `ScrollView`'s content container only
  sizes to its content by default, leaving a gap at the bottom on screens
  taller than the content, showing the wrong background color. Fixed with
  `style={{flex:1}}` on the ScrollView + `flexGrow: 1` on
  `contentContainerStyle`. Verified via `expo start --web` (added as a
  `mobile-web` entry in `.claude/launch.json`) using `react-native-web`,
  **not yet verified on a real device/simulator** — this environment is
  Windows and cannot run the iOS Simulator; real-device testing via Expo
  Go was handed off to the user to run from their own machine.
- App Store readiness assessed and found lacking: never run on a real
  device before this session, billing routes to a Stripe web checkout
  (likely needs real Apple In-App Purchase for digital subscriptions,
  unresolved), and voice/video-cloning apps draw extra App Review
  scrutiny that hasn't been specifically prepared for.

## 12. Session updates, 2026-09-08 (evening) - natural pacing, Michelle root
cause, Robbo new source, RunPod host-availability incident

Continuation of the same day's session (see Sec 11). Full plain-language
summary in `STATUS.md`.

**Multi-sentence naturalness (`scripts/06_inference_server.py`):**
User reported multi-sentence audio sounds "rushed and has no emotion."
Correctly diagnosed as a pipeline architecture problem, not a training
problem: `synthesize()` generated one sentence per isolated model call
(zero cross-sentence context) and stitched with an identical fixed-length
silence gap - true for every voice equally, so no amount of retraining a
single voice would fix it.
- `chunk_sentences()`: groups consecutive sentences into one generation
  call up to `MAX_CHUNK_WORDS = 40`, returning `list[tuple[chunk_text,
  last_sentence]]` so pause/terminal-fall selection can still key off the
  actual last sentence's punctuation even when several sentences were
  generated together. Handles the over-length-single-sentence edge case
  by emitting it as its own chunk rather than looping incorrectly.
  Deliberately conservative (not "whole paragraph in one call") because
  longer generations are more prone to Chatterbox's alignment-stream
  forced-EOS bug - the original reason sentences were split one-at-a-time.
- Pause length between chunks: randomized +/-20% instead of identical
  every time.
- A synthesized breath sound (`synthesize_breath()` - band-passed shaped
  noise, attack/decay envelope, inserted before ~55% of sentence-ending
  pauses) was added, tested live, and then **fully removed** per direct
  feedback ("very unnatural") - deleted the function and its call site
  entirely rather than leaving it disabled, since it wasn't going to be
  revisited.
- `MAX_CHUNK_WORDS_BY_VOICE = {"voice_meditation": 14, "voice_sales": 14}`:
  the two data-scarce voices can't reliably produce a long continuous
  generation the way better-trained voices can. Reproduced live: grouping
  voice_meditation into ~30-word chunks caused the alignment-stream
  forced-EOS bug to fire on nearly every attempt (2 of 3 test generations
  exhausted all 4 retries, shipped near-silent). Capping their chunk size
  much smaller fixed it (confirmed live, 3x retest, all healthy 7.5-10s).

**`plan_delivery()` - built via a parallel Claude Code session on the
user's Mac, working the same file concurrently, reviewed and deployed by
this session:** a punctuation/discourse-cue heuristic (question marks,
exclamation count, ellipsis/hesitation, quoted dialogue, list structure via
regex, soft-lexical-marker list e.g. "gently"/"softly"/"breathe", energetic-
marker list e.g. "amazing"/"let's go") producing bounded offsets to
exaggeration/cfg_weight/temperature and a pause multiplier, clamped to
explicit ranges (`EXAGGERATION_RANGE`, `CFG_WEIGHT_RANGE`,
`TEMPERATURE_RANGE`, `PAUSE_MULTIPLIER_RANGE`). New `resolve_gen_params()`
merges DEFAULT_GEN_PARAMS -> GEN_PARAMS_BY_VOICE -> plan_delivery offsets
-> explicit client-supplied overrides (client always wins). Also fixed a
subtler pre-existing bug as part of the same change: pauses are now
computed and inserted only between chunks that generated successfully
(after generation completes, not interleaved with it), so a failed final
chunk can no longer leave trailing metronomic silence at the end of a
clip. Verified: full file reviewed line-by-line for consistency (all
referenced range constants exist, chunk_sentences/synthesize/
generate_sentence_with_retry integration checked), deployed to the live
pod, tested with a real request exercising multiple punctuation cues at
once - clean generation, retry logic and terminal-fall still correctly
keyed off the last sentence in each chunk.

**Michelle (voice_meditation) - actual root cause found and fixed, not
just mitigated, via `scripts/03_chunk_by_speech.py`:**
The chunking script was discarding (not splitting) any whisper-transcribed
segment longer than a voice's `max_clip_seconds` override. Guided-
meditation narration has long deliberate pauses; whisper's `vad_filter=True`
merges speech across those pauses into single long segments, so nearly
everything exceeded her 8.0s override and was silently thrown away - only
6.6 of ~50 minutes of her already-demucs-cleaned source audio (confirmed:
`clean_audio/voice_meditation/source_01.wav` 1641s + `source_02.wav` 1360s,
both already vocal-isolated from a prior session) ever reached
`training_data/voice_meditation/`.
- Fix: `split_long_segment(words, max_seconds)` - recursive split at the
  single largest internal word-to-word timing gap (the biggest real pause),
  repeated until every sub-segment fits. Requires `word_timestamps=True` on
  `model.transcribe()` (previously not passed). Ships a segment as-is if it
  already fits; drops only if literally no internal gap exists to split on
  (a genuine run-on with no pause at all).
- Result: reprocessing the same two source files produced **318 clips /
  29.7 minutes** (`training_data/voice_meditation/filelist.csv`), a 4.5x
  increase in usable duration from identical source audio. Ran via a
  one-off wrapper (`/workspace/rechunk_michelle.py`, imports
  `03_chunk_by_speech.py` directly and calls `process_speaker()` for just
  this one speaker dir, clearing old clips first) rather than the full
  `main()` loop, to avoid re-transcribing every other voice unnecessarily.
- **Real regression caught and fixed in the same pass**: re-running
  `05_prepare_finetune_metadata.py` (which loops over all 10 speakers)
  regenerates *unfiltered* `metadata.csv` for every voice as a side effect
  - this silently reverted the speaker-isolation filtering already applied
  to `voice_business`/`voice_finance`/`voice_broadcast` via
  `09_finalize_speaker_data.py` in an earlier session. Caught before any
  retraining happened; re-ran `09_finalize_speaker_data.py` and confirmed
  identical row counts to the pre-existing isolated state (374/514,
  329/2368, 168/226 respectively) - `09`'s `metadata_unfiltered.csv` backup
  (written once, on first run only) meant no data was actually lost, just
  needed the filter step re-applied. `voice_comedy` was confirmed unaffected
  - its speaker separation was done via source-level timestamp trimming in
  an earlier session, not the 08/09 cluster-filter pipeline, so it has no
  `metadata_unfiltered.csv` and re-running 05 for it is a no-op concern.
  **Lesson reinforced for next time**: 05 must always be followed by 09 for
  any voice in `KEEP_CLUSTER` (`voice_business`, `voice_finance`,
  `voice_broadcast`) whenever 05 is re-run for *any* reason, even if that
  voice's own source data didn't change.
- Retraining Michelle's LoRA on the expanded dataset was queued
  (`scripts/07_finetune_new_voices.sh` updated: `VOICES=(voice_meditation
  voice_sales)`) but never executed this session - blocked on GPU pod
  availability (see below).

**Robbo (voice_sales) - new source material added, deliberately not
speaker-isolated:**
User provided `Downloads/robbo.mp4` (1.15GB, 58 minutes, 1920x1080, found
via case-insensitive search - user referred to it as a "folder called
robbo" but it was two flat files, `robbo.mp4` + an unrelated small
`robbo.wav` that was actually a leftover test-output file from earlier in
this same session, not source material). Video contains two similar-
sounding men; explicit instruction was to blend both into one voice rather
than isolate a single speaker (the opposite of the
voice_business/finance/broadcast treatment).
- Audio extracted locally via a discovered local ffmpeg binary
  (`AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg.../ffmpeg.exe` -
  no local Python available in this environment, but ffmpeg was present)
  rather than uploading the full 1.15GB video: `-vn -ac 1 -ar 48000 -c:a
  pcm_s16le`, producing a 334.7MB WAV, uploaded to
  `raw_audio/voice_sales/source_02.wav` (alongside the existing tiny
  `source_01.wav`, ~6.2MB, the original 16-clip source).
- A combined processing script was written and uploaded to the pod
  (`/workspace/process_robbo.py`): runs demucs vocal separation targeted
  at just `voice_sales` (checks `out_path.exists()` per-file so it's safe
  to run without re-processing already-separated speakers), then the fixed
  chunking script (clears old `training_data/voice_sales/` first), then
  `05_prepare_finetune_metadata.py` (all speakers, idempotent for the
  unaffected ones), then `09_finalize_speaker_data.py` again as a
  precaution (same regression class as Michelle's, above) - **written and
  uploaded but never executed**, blocked on GPU pod availability.

**RunPod host-availability incident - the "not enough free GPUs" failure
persisted far longer than the normal range observed twice earlier the same
day (8-18 minutes each):** three full 30-minute retry cycles (using the
same `for i in 1..60; sleep 30` pattern as before) against `sloane-video`
(host `ddqsq8hvnt1h`) all failed completely - 90+ minutes with zero
successful starts, also tried the other 6 stopped pods on the account
during this window, all returned the identical error (broader capacity
pressure on that RunPod tier at the time, not specific to one host).
Presented the user a real alternative (create a fresh pod on a different
host - the network volume `oc6yvg9b19` makes this low-risk since training
data/venvs/scripts are already there regardless of which pod mounts it) via
`AskUserQuestion`; user gave no preference, then before the new pod was
actually created, called off the work for the day (`cancel for today shut
pod down`). Confirmed via `GET /v1/pods` that all 8 non-production pods
were already `EXITED` (the failed start attempts never left anything
running/billing), killed the background retry-loop process directly (`ps
-ef | grep retry_start_pod`, `kill`) to prevent a lucky late success from
starting a pod after the "stand down" instruction. Balance dipped to $1.36
mid-session (below the user's self-set $2 alert - flagged immediately) and
was topped up by the user to ~$10.27 before the session ended.
**Unresolved and queued for next session**: create a new pod (recommended
over continuing to retry `sloane-video`) and run
`process_robbo.py` + `07_finetune_new_voices.sh` for both voice_meditation
and voice_sales.

## 13. Video product spec - locked 2026-09-09

Four-product structure, decided directly by the user. Supersedes the fal
research doc's "product split" as a rough direction (Sec 12) - this is the
actual spec to build against.

### The four products

1. **Audio, preset voices** (existing, live) - type text, hear it in one of
   the 10 named voices. Unchanged.
2. **Audio, custom voice** (existing, live) - upload ~10-20s of a voice,
   type any text, get it cloned back. Unchanged.
3. **Video, talking head (Kling)** - user uploads a photo *or* a short
   video of a person, plus audio - either typed text narrated in a Lucy
   preset/cloned voice, or a separately uploaded audio file. Kling Avatar
   lip-syncs the face to that audio.
   - **Voice choice, updated 2026-09-09**: default is still **Lucy voice**
     dubbed over the face (already tested and preferred - see the "Also
     tested: Kling's own voice" comparison below, cut from the home page
     as a *marketing* card but the finding stands as a real product
     input). Per direct instruction, **also offer Kling's own native
     voice as a selectable option** rather than only ever dubbing Lucy -
     some users may prefer it or want faster turnaround. Disclose plainly
     that Lucy-dubbed lip sync is the better-tested, recommended default.
   - **Explicitly unresolved (user's own words: "we'll have to work that
     out so it's seamless")**: the exact UX for the photo-vs-video input,
     the typed-text-vs-uploaded-audio input, and now also the vendor-
     voice-vs-Lucy-voice choice - none of these flows are designed yet.
     This is real design work, not a small detail.
4. **Video, cinematic (Veo)** - user gives a text prompt (e.g. "an exotic
   beach at sunset") plus a photo, and Veo generates a cinematic scene.
   - **Voice choice, updated 2026-09-09**: default is still **Veo's own
     generated dialogue**, not Lucy's - deliberate, because dubbing a
     separately-generated voice over a fully-animated cinematic scene
     doesn't lip-sync convincingly (confirmed in the fal research, Sec
     12: "native Kling/Veo speech will not reliably match Vicky's accent"
     was about the reverse case, but the same lip-sync mismatch problem
     applies here in full force since there's much more camera/face
     motion to sync against than a static talking-head shot). Per direct
     instruction, **also offer Lucy-voice dubbing as a selectable option**
     for users who want brand-voice consistency over lip-sync accuracy -
     disclose plainly that this combination is the least lip-sync-
     accurate option available, don't bury that tradeoff.
   - Net effect: **both video modes should offer a voice-source choice**
     (vendor-native vs. Lucy-dubbed) once built, each with its own honest
     quality caveat, rather than a single hardcoded voice per mode.

### Honesty requirement - explicit, non-negotiable per the user

Ship a visible, upfront pros/cons disclaimer before any video generation,
not buried in fine print. Required content, per direct instruction:
- Cinematic (Veo) generation **may distort or drift the person's face**
  from the reference photo - a known, real limitation of current I2V
  models with no face-lock, not something we can promise away.
- **Data sharing**: the uploaded photo/video and any reference audio go to
  third-party AI vendors (Kling, Veo, and the fal.ai platform connecting to
  them) for processing - materially different from the audio pipeline,
  which is fully self-hosted. Say this plainly, don't imply everything is
  processed in-house.
- General framing: be honest that AI video generation overall has real
  failure modes (identity drift, occasional lip-sync mismatch, generation
  failures) - not a promise of consistent, perfect output every time.

Draft copy (needs final wording/design pass before shipping, but this is
the substance that must be conveyed):

> **Before you generate a video, know this:**
> - **Talking head**: uses your uploaded photo/video, dubbed with your
>   Lucy voice. Lip-sync quality depends on your source photo/video -
>   a clear, front-facing shot works best.
> - **Cinematic**: uses your photo to generate a scene anywhere you
>   describe. The voice you hear is AI-generated dialogue, not your Lucy
>   voice - dubbing a separate voice over this much camera motion doesn't
>   sync convincingly. **Faces can distort or drift from the original
>   photo during generation** - this is a real limitation of current AI
>   video technology, ours included.
> - **Your photo, video, and any reference audio are sent to third-party
>   AI vendors (Kling, Veo, and the fal.ai platform we use to reach them)
>   for processing** - this is different from our audio feature, which
>   runs entirely on our own servers. Only upload what you're comfortable
>   sharing with those vendors.
> - Each generation uses video credits from your plan (see pricing) -
>   separate from your audio character limit.

### Caps (already real code, not just this spec - see Sec 12/STATUS.md)

**Restructured to 4 tiers 2026-09-09** (see `web/src/lib/plans.ts` for the
full math) - Free ($0), Starter ($3/mo, audio only), Plus ($6/mo, audio
only), Video ($12/mo, audio + video credits). Went through an intermediate
$6/$20 2-tier version first after discovering the original $3/200k and
$9/1.5M numbers were built on a GPU-cost assumption ~30-45x too low, then
restructured again per direct user feedback to keep $3 as a real entry
price (paired with a smaller cap) and split video into its own tier
instead of bundling it into the top audio tier.

- **Audio**: character-based - Free 10,000/mo, Starter 15,000/mo, Plus
  30,000/mo, Video 30,000/mo. All three paid tiers hold ~60% gross margin
  at full worst-case usage against real measured RunPod costs.
- **Video**: credit-based, `VIDEO_CREDIT_COSTS` in `web/src/lib/plans.ts` -
  only the Video tier includes credits (40/mo) - Free/Starter/Plus don't.
  1 credit = 1s talking-head or 1/3s cinematic, reviewed against worst-case
  fal COGS (talking-head is actually the pricier-per-credit option) at
  ~61% combined margin with the Video tier's audio allotment.
- Both are real, live constraints in `lib/plans.ts` and enforced via
  `src/lib/db.ts` for audio today; video enforcement doesn't exist yet
  since `/api/generate-video` doesn't exist yet (see below).

### Gaps not yet addressed - flagged, not decided

Raised proactively, not yet discussed with the user:

1. **Photo/likeness consent for video is a new surface**, distinct from
   the existing voice-consent posture (Sec 3). A user could upload someone
   else's photo. At minimum needs the same kind of attestation step voice
   cloning presumably needs - not yet designed for video.
2. **Content moderation for cinematic prompts** - Veo will attempt
   virtually any text prompt; no filtering exists for requests that would
   produce inappropriate scenes involving a real uploaded photo.
3. **Failed-generation credit policy** - if Kling/Veo returns a policy
   block (like Seedance did in testing) or a low-quality/unusable result,
   is the credit refunded? The fal research doc says "debit only on
   success" but doesn't define what counts as a usable success vs. a
   technically-completed-but-bad result.
4. **Photo/video quality guidance** - the fal research found tight face
   crops dramatically outperform wide/full-body shots for talking-head
   lip-sync. The product should probably guide or auto-crop uploads rather
   than silently producing a worse result from a bad source photo.
5. **Preview/confirm before spending credits** - given credits map to real
   vendor cost, consider a "this will use N credits" confirmation step
   before generating, especially for cinematic (3x the per-second cost).
6. **Generated video storage/hosting** - fal returns results from its own
   infrastructure; no plan yet for whether/how we persist, re-serve, or
   offer download of generated clips (audio already has a real MP3
   download button - video would want a comparable pattern). **Partially
   resolved 2026-09-09**: output format decided - plain MP4 (H.264/AAC),
   same as the trailer clips already in `web/public/trailers/` and the
   existing EchoMimic self-hosted demo. Persistence/re-serving mechanism
   itself still undecided.
7. **App Store privacy disclosure** - sending user photos/video/voice to
   third-party vendors (Kling/Veo/fal) will very likely need to be
   declared in Apple's App Store "privacy nutrition label" if this ships
   to iOS, on top of the already-known In-App Purchase question (Sec 11/
   12). A new App Review consideration, not just IAP. **Partially
   addressed 2026-09-09**: a real privacy policy now exists
   (`web/src/app/privacy/page.tsx`, linked from the footer) covering
   current audio practices (self-hosted, no third-party sharing) and the
   planned video third-party-sharing arrangement in plain language -
   explicitly flagged in the policy itself as not lawyer-reviewed and not
   yet addressing GDPR/CCPA specifics. The App Store privacy *nutrition
   label* (a separate, structured disclosure Apple requires at submission
   time, distinct from a website privacy policy) still needs completing
   when iOS submission is actually attempted.
8. **Mobile parity - resolved 2026-09-09**: both video modes (talking-head
   and cinematic) are planned for **both web and mobile**, not web-only -
   direct user instruction. Not yet built on either platform; this just
   settles the target, not the implementation.

Remaining open items above (1-5) are not decided - listed so they don't
get lost, not to block the spec above.

## 14. Audio inference platform migration + Vicky voice fix, 2026-09-09

**Decision: moved production audio inference from RunPod Serverless to
Modal.** RunPod Serverless's real-world cold starts (2-3 minutes on a plain
uncontended request, confirmed live) were a genuinely bad user experience -
direct feedback: "it took a long time, this won't work well." Researched
alternatives (Modal, Baseten, Replicate, Beam Cloud, RunPod's own
FlashBoot/active-workers) before committing; verdict was that Modal and Beam
Cloud were the only two with a real architectural answer to cold starts
(snapshot-based fast-restore, the same class of tech RunPod's FlashBoot was
supposed to be), both still pure usage-based billing, both worth a real test
before switching stacks. Modal was built and tested end-to-end; it works.

**What it actually delivers**: cold start ~141s measured (not dramatically
better than RunPod's worst case - don't oversell this to the user again),
but a *warm* container (any request within 5 minutes of the last one)
answers in ~10-17s. The real win is typical-case latency during any burst of
real usage, not a fix for the very first request after a quiet period.
Modal's experimental memory-snapshotting feature could close that remaining
gap further but wasn't tested - flagged as a future stretch goal, not
promised.

**Full technical detail (exact gotchas, exact commands, env vars, the
RunPod-kept-as-fallback rationale) lives in `STATUS.md`'s "Inference
backend" section**, not duplicated here - that file is the one to update
again if this changes further. The one thing worth recording here as a
*decision*, not an operational detail: RunPod Serverless is being kept
running and selectable from `/admin` on purpose, specifically to burn down
existing prepaid RunPod credit before it's ever fully retired - not an
oversight, not tech debt.

**Separately, in the course of auditing all 10 voices before/after this
migration**: found and fixed a real, fully reproducible bug in Vicky
(`art_instructor`) - near-silent output (0.14-0.26s) on every attempt,
independent of text. Root-caused to her specific reference audio clip
(swapped for a different, verified-reliable clip from her own training
data) rather than a training-data-quantity or chunk-length problem like
Michelle's known issue - see `STATUS.md` "Audio generation quality" for the
full diagnostic story. This settles one more entry in the long-running
"`PRESET_VOICES` reference clips were never re-picked post-retrain" open
item (Sec 12), though for an unrelated reason (a genuine bug, not a
retrain-driven clip renumbering) - Robbo and Michelle's clips remain
un-re-picked.

**Also fixed this session, smaller items surfaced by real usage rather than
code review**: the Expressiveness/Speed delivery sliders' default values
weren't actually centered on their own tracks (expressiveness's true
midpoint is 0.65, not the 0.6 default) - visible in a screenshot, fixed on
both platforms. Mobile-specific bugs found via the first real-device Expo Go
test (see `STATUS.md` "Mobile / iOS App Store"): Play button not working a
second time, no mic-recording option on Clone Voice, the whole-app
decorative background never having been added to mobile at all, and video
trailer clips never actually starting playback.

## 15. Voice-quality bug batch + Modal per-voice latency bug, 2026-09-10

A batch of live bug reports arrived together: Alice inserting a spurious
"so", Megan/Katie/Brad/Mark all skipping words, Izzy/Alice/Robbo sounding
sped up, Robbo switching accents mid-sentence, Michelle judged bad enough to
remove outright, and separately "Modal is slow even after warmed up." Full
technical detail (exact code changes, exact verification done vs. not done)
lives in `STATUS.md`'s "Voice quality + Modal latency fixes, 2026-09-10" -
not duplicated here. Decisions worth recording at this level:

**The "slow even warmed up" report had a real, previously-undocumented root
cause, not just retry variance.** Sec 14 above documented container-level
warm/cold (whole GPU container up or not) but missed a second layer: each
preset voice's fine-tuned LoRA adapter also has its own load-from-Volume
cost on that voice's first request per container, gated by an LRU cache
capped below the actual roster size. A "warm" container could still eat
this cost on any voice it hadn't served yet - confirmed directly in
`modal app logs` via a real `"cache miss"` line on a request to an
already-warm container. Fixed by preloading every voice at container start
instead of lazily (L40S has enough VRAM headroom for all of them at once,
unlike the 24GB card this design was originally built for).

**Michelle (`voice_meditation`) is now off the roster** - decided by direct
user feedback, not a technical fix. This retires the long-running "her
chunk cap can't be safely raised" open item from Sec 12 by removing the
voice rather than solving the underlying instability. Her training
data/LoRA are untouched on the network volume in case this is revisited.

**Everything else in this batch (word-skipping retry threshold, the
spurious-filler retry check, Robbo's re-tuning, per-voice speed correction)
was shipped from code-level reasoning plus a non-crashing smoke test, not
verified by actually listening** - stated this plainly to the user rather
than implying these are confirmed fixes, and STATUS.md's next-steps now
lead with getting real ear-feedback before any further tuning.

Also fixed the same day, unrelated to voice tuning but reported live in a
screenshot: clone-voice ("record yourself") was silently broken for every
real recording, not just slow - browser/mobile mic recordings are WebM/Opus
or M4A/AAC, never WAV, but were written to a `.wav`-suffixed file and handed
to a WAV-only decoder. Fixed with an ffmpeg transcode step; this one *was*
verified end-to-end with a real non-WAV test upload against the live
endpoint, unlike the voice-tuning items above.

## 16. Third video mode (Ads/Seedance) added, all three engines live-tested, 2026-09-10

**Decision: video ships as three modes - Talking head (Kling), Cinematic
(Veo), and a new Ads mode (Seedance + a persistent, exclusive-per-account AI
actor) - and product copy no longer frames video as a vague "coming soon."**
Full technical detail (exact API payloads, pricing, the Arcads.ai research,
the proposed exclusivity architecture, what's still not built) lives in
`docs/fal-video-research/README.md`'s 2026-09-10 section - not duplicated
here. Decisions worth recording at this level:

**Real API access was the actual blocker, not knowledge** - a `FAL_KEY` had
to be sourced fresh (the account was locked on "exhausted balance" until
topped up), after which all three engines - Kling Avatar, Veo 3.1 Fast, and
Seedance 2.0 reference-to-video - were called for real and produced real
video. This replaces "we should test these APIs" with an actual, verified
answer: all three work as advertised for this product's needs.

**Seedance has a real, specific limitation that decided the architecture**:
its own content-policy filter blocks a fully AI-generated but
hyper-realistic face as a possible real-person likeness, while Kling has no
such issue on the identical image. Rather than treat this as a dead end for
"hyper-realistic AI actors" (which is explicitly what was asked for, modeled
on Arcads.ai), the fix is architectural: route a given Ads-mode generation
to Kling when the actor is photorealistic, and to Seedance specifically for
its unique capability neither Kling nor Veo has - recreating an *uploaded
video's* motion/content with a different character
(`@Image1 performs the choreography from @Video1`, a real documented fal
capability) - or for a more stylized actor look. Same stored actor image
either way; the engine choice is an implementation detail, not something
the user needs to think about.

**"Exclusive" avatar - researched what this actually means in a shipped
product (Arcads.ai), not invented from scratch.** Fetched Arcads' own site
and a demo video's auto-captions (transcript only, via `yt-dlp`, nothing
downloaded/redistributed) - their own explanation confirms exclusivity is
an account-scoping/access-control guarantee ("you will be the only one to
be able to use this one"), not a cryptographic or NFT-backed claim despite
the surface-level "kind of like an NFT" resemblance. The proposed Lucy Labs
design mirrors this: a private per-account `ai_actors` table, never
surfaced to any other customer, plus a new safeguard Arcads' own materials
didn't describe - a face-embedding similarity check against every other
stored actor before finalizing a new one, to catch even an accidental
lookalike across two unrelated customers. Stated plainly to the user: this
guarantees Lucy Labs' own platform never reuses a generated actor for
someone else - it cannot guarantee the underlying third-party image model
could never coincidentally produce something similar for anyone, anywhere,
which is a meaningfully different (weaker) claim than "exclusive" might
otherwise imply, and the product copy was written to reflect the real
guarantee rather than the stronger-sounding one.

**Nothing here is wired into the live product yet** - today's work was real
API verification plus a product-copy/architecture decision, not
`/api/generate-video` itself. The `ai_actors` table, the similarity
safeguard, the actual generation endpoint, and ads-mode credit pricing are
all still open engineering work, listed in order in STATUS.md's "Next
steps."

## 17. Open-source model research: Wan 2.2 (video) + Qwen3-TTS (audio), 2026-09-10

The user pointed at two open, ungated, Apache-2.0 models with real public
weights (not vaporware - checked and confirmed, same diligence as Sec 15's
OmniTalker-turned-out-to-be-inaccessible lesson) and asked about training
them to reach Kling/Veo quality. Two different, deliberately separate
verdicts:

**Wan 2.2 (video): the "match Kling/Veo" framing itself is the wrong goal.**
Kling and Veo are large, closed, heavily-funded commercial models - matching
them in general via a from-scratch or lightly-fine-tuned open 5B model isn't
realistic on this project's GPU budget. The framing that *is* realistic
mirrors exactly what already works here for TTS: fine-tune narrowly on our
own avatar/character look (not general video quality), the same way
Chatterbox is LoRA-fine-tuned per preset voice rather than retrained from
scratch. Real prerequisites this would need that don't exist yet: a
consistent-character video training dataset, and meaningfully more GPU time
than the audio fine-tunes needed (video diffusion training is far more
compute-hungry). Scoped explicitly as a **future, separate R&D project** -
vendored the code (`vendor/wan2.2-upstream/`) for reference, did not start
training, did not spend GPU money on it.

**Qwen3-TTS (audio): genuinely promising, verified with one real, cheap
test, not just a migration decision.** Desk research surfaced real
advantages relevant to this project's two biggest recurring pain points this
session - state-of-the-art word-error-rate on the public Seed-TTS
benchmark (directly relevant to the skipped-words bugs just fixed in
Chatterbox with a retry-threshold workaround) and a streaming architecture
with ~100-130ms latency (directly relevant to the whole "Modal is slow"
saga). Rather than accept those claims on faith, ran one real test against
fal.ai's hosted endpoint: cloned Vicky's own voice (from a Chatterbox
output, not raw training data) and synthesized the same sentence used
earlier to reproduce Megan's word-skipping bug. Real result: 16s total
end-to-end vs. 132s for the same sentence on our own Chatterbox/Modal setup
in that run (a cold-start hit, so not perfectly apples-to-apples, but a real
number, and still favorable to Qwen3-TTS even against Chatterbox's
documented warm-case numbers). Both clips sent to the user directly for a
real quality judgment, since audio quality isn't something Claude can
evaluate - only timing and Whisper-measured word overlap. **This is
evidence a closer look might be worthwhile, not a decision to migrate** -
switching production TTS engines means re-fine-tuning all 9 preset voices
on a different architecture and rebuilding `lucy_tts_engine.py`'s entire
generation/chunking/retry pipeline, real work on top of everything already
invested in the current one. Vendored at `vendor/qwen3-tts-upstream/` for
when/if a real fine-tuning trial is decided on.
