# Sloane — voice clone prototype

Prototype for cloning the two masterclass instructors' voices (art + music), as a
testbed before the public voice-conversion platform. Consent for using this
footage this way has been confirmed by the project owner.

## Status

- [x] Project scaffolded
- [x] Step 1: raw audio extracted locally from selected masterclass videos
- [ ] Step 2: vocal separation (Demucs) — run on cloud GPU
- [ ] Step 3: transcribe + chunk into training clips — run on cloud GPU
- [ ] Step 4: zero-shot test (OpenVoice / seed-vc) — no training needed
- [ ] Step 5: RVC fine-tune per speaker — higher fidelity, needs training

## Why local vs. cloud is split this way

This Mac has ~11GB free disk, no Homebrew/ffmpeg, and only system Python 3.9 —
not a place to install torch/demucs/RVC. Audio extraction is cheap (ffmpeg via
a self-contained `imageio-ffmpeg` pip package, no system changes) so it runs
locally. Everything GPU-heavy (source separation, transcription, training)
should run on a rented CUDA GPU pod instead.

## What's been done

`scripts/01_extract_audio.py` pulled clean speech-heavy source videos and
extracted their audio tracks (48kHz mono 16-bit WAV) into `raw_audio/`:

- **art_instructor**: instructor intro, "Anyone Can Paint", "Tracing", "What to
  paint", "Painting a parrot in watercolour" — ~95 min raw audio
- **music_instructor** (Matt Landi): "Where to begin writing a song", "Really
  listen to your favourite songs", "JUST START", "Finding the pitch", "Find
  your note range" — ~47 min raw audio

Videos with heavy singing/music overlay (e.g. "Creating Fortnite on
GarageBand", "Vocal exercises", "Singing my original song") were deliberately
skipped for this speech-training set — good candidates to add later for
style/emotion range, but not for the initial clean-speech dataset.

This is already well above the ~30-60 min of clean speech RVC needs for a
good fine-tune, before even accounting for the two ~1hr "Painting a self
portrait" / "Painting a parrot" files, most of which is likely usable talking.

## Next steps: cloud GPU setup

1. **Rent a pod.** RunPod or Vast.ai, RTX 4090 (~$0.34-0.69/hr on RunPod
   Community Cloud; Vast.ai unverified hosts often cheaper). You'll need to
   create the account and add billing yourself.
2. **Upload data.** Copy this project's `raw_audio/` folder to the pod (a few
   hundred MB, quick over any normal connection).
3. **Install deps.** `pip install -r requirements-cloud.txt` on the pod.
4. **Run cleanup pipeline:**
   ```bash
   python3 scripts/02_separate_vocals.py     # strips any background music/noise
   python3 scripts/03_chunk_by_speech.py     # transcribes + cuts utterance clips
   ```
   Output: `training_data/<speaker>/clips/*.wav` + `filelist.csv` per speaker.
5. **Quick zero-shot test (no training, minutes not hours):** pick one clean
   30-90 sec reference clip from `clean_audio/` and run it through OpenVoice V2
   or seed-vc directly. This is the fastest way to sanity-check voice identity
   capture before investing in a full fine-tune. Ask to have this script
   written once you're on the pod and ready to test.
6. **RVC fine-tune (higher fidelity):** use `training_data/<speaker>/clips/`
   as the per-speaker dataset with the RVC-Project WebUI/CLI
   (https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI).
   ~300 epochs on ~30-45 min of clips takes roughly 1-2 hours on a single
   consumer GPU.

## Cost recap for this prototype (1-2 speakers)

| Item | Estimate |
|---|---|
| Local extraction/cleanup prep | $0 (already done) |
| Zero-shot test (OpenVoice/seed-vc) | $0 model cost, ~$1-2 GPU time |
| RVC fine-tune, both speakers | ~$2-6 GPU time |
| Generous experimentation/iteration | ~$15-25 total |

## Reminders carried over from planning

- Consent for these two voices has been confirmed — keep documentation of that
  on file since this becomes load-bearing if the prototype turns into a real
  product.
- If/when this becomes the public platform (any user, any voice), the
  consent-capture (live voice-captcha), watermarking, and abuse-prevention
  pieces from the earlier design discussion are required before launch, not
  optional extras.
