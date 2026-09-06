# Sloane — Voice Clone Platform — Full Project Context

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
2. **Public platform ("Sloane")** — a web product, one page, two sections.

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

### Phase 1 — RunPod environment ← **you are here, do this first**
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

### Phase 2 — Data cleanup (run on the pod) ← **you are here**
5. ~~`python3 scripts/02_separate_vocals.py` → `clean_audio/`~~ done
6. `python3 scripts/03_chunk_by_speech.py` → `training_data/<speaker>/clips/`
   + `filelist.csv` — running now

### Phase 3 — Zero-shot validation (fast, unblocks both features immediately)
7. Install Chatterbox on the pod (`pip install chatterbox-tts` or clone the
   Resemble AI repo — confirm exact package name at install time, it's a
   fast-moving repo).
8. Pick one clean ~30-90 sec reference clip per instructor from
   `clean_audio/`, run it through Chatterbox zero-shot with a few test
   sentences. This validates voice-identity capture **before** any training
   investment, and — because it's zero-shot — this is already a working
   backend for **both Feature A and Feature B** in rough form (Feature A
   just uses a fixed reference clip per preset instead of a user upload).

### Phase 4 — Minimal backend API
9. Small FastAPI service on the pod (or a RunPod Serverless handler) exposing
   the two endpoints from §2: `/api/generate-preset` and `/api/clone-voice`.
   Both call the same underlying Chatterbox zero-shot function — Feature A
   just pins the reference audio to one of the two instructor clips server-
   side, Feature B takes the reference audio from the request upload.
10. Store generated audio in temporary storage (local disk on the pod is
    fine for now; object storage comes with the real platform build, §8).

### Phase 5 — Minimal frontend
11. One simple page, two sections:
    - Text box + voice dropdown ("Art Instructor" / "Music Instructor") →
      calls `/api/generate-preset` → audio player.
    - Upload widget (file picker, ~30-60 sec clip) + text box → calls
      `/api/clone-voice` → audio player.
12. This is enough for **you to test both features end-to-end** privately.

### Phase 6 — Quality upgrade (parallel, not blocking)
13. Fine-tune Chatterbox per instructor using `training_data/` from Phase 2,
    swap Feature A's preset voices from zero-shot-reference to the fine-tuned
    checkpoints once ready. ~1-2 hrs GPU time per speaker.

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

### Domain

Worth grabbing early if you like "Sloane" — cheap (~$10-40/yr via Cloudflare
Registrar or Namecheap), squatting risk is real for a good name. This is a
purchase you'll need to do yourself on your own account; happy to help
brainstorm/check name variations.

---

## 8. v2 idea (not in current scope) — Feature C: video cloning

Raised 2026-09-06: a third feature where a user uploads a video of
themselves and types text, and the system generates a video of them
speaking that text in their own voice/likeness ("text-to-video" cloning,
lip-synced). **Decision: defer this — do not fold it into Phases 1-7.** Ship
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

After Phases 1-6 are done and Features A+B are validated with real usage —
scope it then as its own effort: real benchmarking on rented hardware for
actual cost/latency numbers, a license check on whichever model is chosen,
and a dedicated safety/consent design pass (not just an extension of §3).
