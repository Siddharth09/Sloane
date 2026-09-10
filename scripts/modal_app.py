#!/usr/bin/env python3
"""Modal Serverless deployment for Lucy Labs' audio generation.

Replaces RunPod Serverless as the production inference backend (see
STATUS.md "Modal migration") because RunPod's real-world cold starts turned
out to be 2-3 minutes - far worse than the 20-60s the original Serverless
migration was designed around - almost certainly because loading the model
off RunPod's network-attached volume on every cold start is disk-I/O bound.
Modal's Volume is a different (faster) storage layer built specifically for
this, so the fix is a platform swap, not more tuning on RunPod.

Uses the exact same scripts/lucy_tts_engine.py as RunPod - zero logic
changes, only the deploy target differs. See that file's MODEL_ROOT env var:
this app sets it to /models (this Volume's mount point) instead of RunPod's
/workspace/sloane default.

RunPod Serverless is deliberately left running and untouched (see
web/src/lib/inferenceBackend.ts "modal" branch) - there's remaining prepaid
RunPod credit worth using, and it's a same-day fallback if anything about
this migration needs to be rolled back.

One-time setup (see STATUS.md for exact commands):
    modal volume create lucy-tts-models
    modal volume put lucy-tts-models <local staging dir> /
Deploy:
    modal deploy scripts/modal_app.py
Local smoke test (runs the function directly, no deploy):
    modal run scripts/modal_app.py
"""
import base64
import io
import os

import fastapi
import modal

app = modal.App("lucy-tts")

# Resolved relative to this file, not the CWD `modal deploy` is run from -
# add_local_file needs an exact path either way.
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

MODEL_ROOT = "/models"

# Pinned to the exact versions already proven working on RunPod's venv
# (checked via `pip list` there 2026-09-09) - avoids any silent behavior
# drift in generated audio from picking up newer library versions.
image = (
    modal.Image.from_registry("nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04", add_python="3.12")
    # build-essential: pyworld has no prebuilt wheel for this platform/Python
    # combo and compiles its C++ extension from source at install time.
    .apt_install("libsndfile1", "ffmpeg", "git", "build-essential")
    .pip_install(
        "torch==2.6.0",
        "torchaudio==2.6.0",
        extra_index_url="https://download.pytorch.org/whl/cu124",
    )
    .pip_install(
        "transformers==4.46.3",
        "tokenizers==0.20.3",
        "huggingface_hub==0.36.2",
        "peft==0.17.1",
        "faster-whisper==1.2.1",
        "pyworld==0.3.5",
        "librosa==0.11.0",
        "soundfile==0.13.1",
        "scipy==1.17.1",
        "numpy==1.26.4",
        "fastapi[standard]",
        # The rest of this list is every top-level import actually reached
        # by vendor/chatterbox-finetuning-upstream/src/ and lucy_tts_engine.py
        # at inference time (checked by grepping the source directly, after
        # the first deploy crashed on a missing "perth" import that wasn't
        # obvious from a `pip list` skim alone) - excludes pykakasi/
        # dicta_onnx/spacy_pkuseg/russian_text_stresser, which the tokenizer
        # only imports lazily inside try/except ImportError for Japanese/
        # Hebrew/Chinese/Russian text, none of which this product uses.
        "conformer==0.3.2",
        "diffusers==0.29.0",
        "einops==0.8.2",
        "omegaconf==2.3.1",
        "resemble-perth==1.0.1",
        "pyloudnorm==0.2.0",
        "s3tokenizer==0.3.0",
        # pyworld has no prebuilt wheel for this image and compiles its C++
        # extension at install time - this base image's Python was built
        # expecting clang++ (not present, only g++ from build-essential is),
        # so distutils picks clang++ by default and fails. Force gcc/g++.
        env={"CXX": "g++", "CC": "gcc"},
    )
    # Only the shared engine module - the actual model weights and the
    # chatterbox-ft-art/src package live on the Volume (see module docstring),
    # matching how RunPod's own image only carries the handler code too.
    .add_local_file(os.path.join(_SCRIPT_DIR, "lucy_tts_engine.py"), "/app/lucy_tts_engine.py")
)

model_volume = modal.Volume.from_name("lucy-tts-models", create_if_missing=True)


def _encode_wav(audio, sr) -> str:
    buf = io.BytesIO()
    import soundfile as sf

    sf.write(buf, audio, sr, format="WAV")
    return base64.b64encode(buf.getvalue()).decode("ascii")


@app.cls(
    image=image,
    # Was "L4" ($0.80/hr) - measured 2026-09-10 at only ~13-15 tokens/sec
    # sampling throughput, roughly half the ~25-29 tokens/sec seen testing
    # directly on the RTX 4090 RunPod used previously. L40S ($1.95/hr) is
    # the same Ada Lovelace generation as that 4090 - closest real match,
    # not just a guess. Per-request cost doesn't scale 2.4x with the
    # hourly-rate difference since it finishes proportionally faster.
    gpu="L40S",
    volumes={MODEL_ROOT: model_volume},
    # Container stays warm 5 minutes after its last request before scaling
    # back to zero - covers someone generating a couple of clips back to
    # back without paying for a second cold start, while still scaling to
    # $0 well within an idle hour. Tune from real usage once live.
    scaledown_window=300,
    # Deliberately NOT capping max_containers - tried max_containers=1 on
    # 2026-09-10 to make the pre-warm trick (web/src/lib/modal.ts's
    # warmModal()) actually share one container instead of racing a second
    # one, and it worked for that narrow case, but it means every
    # concurrent real user queues behind whoever's already generating -
    # rejected per direct user feedback ("i dont like the modal plan of
    # users queuing for one gpu it will not be a good result"). Left
    # uncapped (Modal's normal autoscaling) so real concurrent traffic
    # scales properly; see STATUS.md "Inference backend" for the full
    # pre-warm trade-off writeup and why there's no config that gives both
    # "pre-warm reliably shares a container" and "no queuing under load."
    timeout=300,
    env={"LUCY_MODEL_ROOT": MODEL_ROOT},
    # Tried enable_memory_snapshot=True + @modal.enter(snap=True) on
    # 2026-09-10 - made things WORSE, not better: cold start went from
    # ~85-141s to 194s, AND the restored container generated at ~3
    # tokens/sec instead of the normal ~13-14 (visible in `modal app logs`
    # sampling progress bars) - the GPU/CUDA state clearly didn't restore
    # cleanly from the snapshot. Reverted same day. Do not re-enable without
    # a real fix for the post-restore GPU slowdown, not just a retry.
)
class LucyTTS:
    @modal.enter()
    def load(self):
        # Runs once per container start (the actual "cold start" cost) and
        # is cached for every request that container handles afterward -
        # this is the whole reason Modal's Volume matters here: it's the
        # fast path this load() reads from.
        import sys

        sys.path.insert(0, "/app")
        global generate_preset, generate_clone, UnknownVoiceError, ReferenceAudioTooShortError, UnsupportedReferenceAudioError
        from lucy_tts_engine import (
            ReferenceAudioTooShortError as _RATSE,
            UnknownVoiceError as _UVE,
            UnsupportedReferenceAudioError as _URAE,
            generate_clone as _gc,
            generate_preset as _gp,
        )

        generate_preset, generate_clone = _gp, _gc
        UnknownVoiceError, ReferenceAudioTooShortError = _UVE, _RATSE
        UnsupportedReferenceAudioError = _URAE

    @modal.method()
    def run_generate_preset(self, text: str, voice_id: str, exaggeration=None, cfg_weight=None, pitch_semitones=None, speed=None):
        try:
            audio, sr = generate_preset(
                text, voice_id,
                exaggeration=exaggeration, cfg_weight=cfg_weight,
                pitch_semitones=pitch_semitones, speed=speed,
            )
        except (UnknownVoiceError, ReferenceAudioTooShortError) as exc:
            return {"error": str(exc)}
        if audio is None:
            return {"error": "no audio generated"}
        return {"audio_base64": _encode_wav(audio, sr), "sample_rate": sr, "voice_id": voice_id}

    @modal.method()
    def run_generate_clone(self, text: str, reference_audio_base64: str, exaggeration=None, cfg_weight=None, speed=None):
        try:
            reference_audio_bytes = base64.b64decode(reference_audio_base64)
            audio, sr = generate_clone(
                text, reference_audio_bytes,
                exaggeration=exaggeration, cfg_weight=cfg_weight, speed=speed,
            )
        except (UnknownVoiceError, ReferenceAudioTooShortError, UnsupportedReferenceAudioError) as exc:
            return {"error": str(exc)}
        if audio is None:
            return {"error": "no audio generated"}
        return {"audio_base64": _encode_wav(audio, sr), "sample_rate": sr}

    @modal.method()
    def warmup(self):
        # Deliberately synthesizes nothing - the point is to pay for the
        # container boot + shared-engine load (which @modal.enter()/load()
        # already triggers just by being called, since importing
        # lucy_tts_engine eagerly loads the base T3/vocoder/voice-encoder
        # onto the GPU) without also burning GPU time generating audio
        # nobody asked for. Called from the web app the moment someone
        # opens the generation page, well before they've finished typing
        # and hit Generate for real - see web/src/lib/modal.ts's warmModal().
        return {"status": "warm"}


# --- HTTP surface for the Next.js app -----------------------------------
#
# Mirrors RunPod's submit-then-poll contract (web/src/lib/runpod.ts) so
# job-status/route.ts needs only a small backend-dispatch branch, not a
# rewrite: POST /submit spawns the GPU function and returns a call_id
# immediately (well under Vercel's timeout even on a cold start); GET
# /status?call_id=... does a non-blocking check and returns RunPod-shaped
# status strings so the rest of the polling logic reads identically.
#
# These run on cheap CPU containers, not the GPU - they only submit/check
# function calls, they never load the model themselves.
@app.function(image=image)
@modal.fastapi_endpoint(method="POST")
async def submit(request: fastapi.Request):
    body = await request.json()
    action = body.get("action", "generate-preset")
    lucy = LucyTTS()
    if action == "generate-preset":
        call = await lucy.run_generate_preset.spawn.aio(
            body.get("text", ""),
            body["voice_id"],
            exaggeration=body.get("exaggeration"),
            cfg_weight=body.get("cfg_weight"),
            pitch_semitones=body.get("pitch_semitones"),
            speed=body.get("speed"),
        )
    elif action == "clone-voice":
        call = await lucy.run_generate_clone.spawn.aio(
            body.get("text", ""),
            body["reference_audio_base64"],
            exaggeration=body.get("exaggeration"),
            cfg_weight=body.get("cfg_weight"),
            speed=body.get("speed"),
        )
    elif action == "warmup":
        call = await lucy.warmup.spawn.aio()
    else:
        return {"error": f"unknown action '{action}'"}
    return {"call_id": call.object_id}


@app.function(image=image)
@modal.fastapi_endpoint(method="GET")
def status(call_id: str):
    function_call = modal.FunctionCall.from_id(call_id)
    try:
        result = function_call.get(timeout=0)
    except TimeoutError:
        return {"status": "IN_PROGRESS"}
    except Exception as exc:
        return {"status": "FAILED", "error": str(exc)}
    if isinstance(result, dict) and result.get("error"):
        return {"status": "FAILED", "error": result["error"]}
    return {"status": "COMPLETED", "output": result}
