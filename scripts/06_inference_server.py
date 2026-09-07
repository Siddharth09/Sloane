#!/usr/bin/env python3
"""
Phase 4: real inference API, meant to run ON the RunPod GPU pod (not locally
— no GPU here). Loads the two fine-tuned preset voices (Feature A) plus one
base (zero-shot) engine for arbitrary voice cloning (Feature B) once at
startup, then serves the same endpoint contract as the local mock
(api/main.py): /api/generate-preset and /api/clone-voice.

Reuses the fine-tuning toolkit's vendored Chatterbox code (src/chatterbox_)
and its LoRA-adapter loading pattern (proven working in
scripts/04_zeroshot_test.py's fine-tuned successor, Phase 6) rather than the
pip chatterbox-tts package, to avoid the version conflicts documented in
PROJECT_CONTEXT.md Phase 6.

"No character limit": splits input text into sentences, generates each
separately, trims silence (VAD), concatenates with a small pause between.

Usage (on the pod):
    /workspace/sloane/.venv/bin/python scripts/06_inference_server.py
Then reachable at the pod's RunPod HTTP-proxy URL for port 8000.
"""
import re
import sys
import uuid
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf
import torch
from scipy.signal import butter, sosfilt
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from peft import PeftModel

# The fine-tuning toolkit's own package layout (src.*) - reuse it directly
# rather than reimplementing model loading.
sys.path.insert(0, "/workspace/sloane/chatterbox-ft-art")
from src.model import resize_and_load_t3_weights  # noqa: E402
from src.utils import trim_silence_with_vad  # noqa: E402
from src.chatterbox_.tts import ChatterboxTTS  # noqa: E402
from src.chatterbox_.models.t3.t3 import T3  # noqa: E402

BASE_MODEL_DIR = "/workspace/sloane/chatterbox-finetuning/pretrained_models"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
NEW_VOCAB_SIZE = 2454  # matches TrainConfig.new_vocab_size for is_turbo=False

PRESET_VOICES = {
    # Kirsty and Matt reuse the very first two fine-tuned voices (Phase 6) -
    # renamed for the customer-facing preset picker, no retraining needed.
    "art_instructor": {
        "adapter_dir": "/workspace/sloane/chatterbox-ft-art/chatterbox_output/new_lang_adapter",
        "reference": "/workspace/sloane/training_data/art_instructor/clips/00266.wav",
    },
    "music_instructor": {
        "adapter_dir": "/workspace/sloane/chatterbox-ft-music/chatterbox_output/new_lang_adapter",
        "reference": "/workspace/sloane/training_data/music_instructor/clips/00042.wav",
    },
    "voice_business": {  # Alice
        "adapter_dir": "/workspace/sloane/chatterbox-ft-voice_business/chatterbox_output/new_lang_adapter",
        "reference": "/workspace/sloane/training_data/voice_business/clips/00040.wav",
    },
    "voice_finance": {  # Megan
        "adapter_dir": "/workspace/sloane/chatterbox-ft-voice_finance/chatterbox_output/new_lang_adapter",
        "reference": "/workspace/sloane/training_data/voice_finance/clips/00001.wav",
    },
    "voice_broadcast": {  # Katie
        "adapter_dir": "/workspace/sloane/chatterbox-ft-voice_broadcast/chatterbox_output/new_lang_adapter",
        "reference": "/workspace/sloane/training_data/voice_broadcast/clips/00018.wav",
    },
    "voice_tech": {  # Brad
        "adapter_dir": "/workspace/sloane/chatterbox-ft-voice_tech/chatterbox_output/new_lang_adapter",
        "reference": "/workspace/sloane/training_data/voice_tech/clips/00001.wav",
    },
    "voice_mark": {  # Mark
        "adapter_dir": "/workspace/sloane/chatterbox-ft-voice_mark/chatterbox_output/new_lang_adapter",
        "reference": "/workspace/sloane/training_data/voice_mark/clips/00001.wav",
    },
    "voice_sales": {  # Robbo
        "adapter_dir": "/workspace/sloane/chatterbox-ft-voice_sales/chatterbox_output/new_lang_adapter",
        "reference": "/workspace/sloane/training_data/voice_sales/clips/00008.wav",
    },
    # voice_comedy (Izzy) and voice_meditation (Francois-Michelle) are
    # mid-retrain as of 2026-09-08 - added once those checkpoints land.
}

# Runtime pitch adjustment, applied as post-processing (librosa.effects.
# pitch_shift) after generation - a real audio-signal change, not a
# training-time effect, so it's cheap to tune per-voice without retraining.
# Positive = higher. See PROJECT_CONTEXT.md "Voice tuning requests" for why
# this exists, and why it's empty now: Katie's +1.5 semitone version was
# reverted per feedback - naive pitch-shifting doesn't adjust vocal-tract
# resonance (formants), which is exactly why shifted voices tend to sound
# artificial. "Raspier"/"more feminine" have no equivalent runtime knob
# either - those are textures the model would need to actually be trained
# on, not something a signal-processing tweak can fake convincingly.
PITCH_SEMITONES_BY_VOICE: dict[str, float] = {}

# Per-voice high-pass filter cutoff (Hz) - cuts low-frequency room
# resonance/boom that reads as "echoey", without touching vocal clarity
# (speech fundamentals sit well above these cutoffs). Real signal
# processing, not a training-time effect. Tried for Katie 2026-09-08 (less
# echoey/softer request) but reverted per feedback - keeping the mechanism
# since it's a real, useful knob for whichever voice actually needs it.
HIGHPASS_HZ_BY_VOICE: dict[str, float] = {}

# Per-voice generation-parameter overrides, layered on DEFAULT_GEN_PARAMS.
GEN_PARAMS_BY_VOICE: dict[str, dict] = {}

# Chatterbox's real (previously unused) expressiveness controls - see
# PROJECT_CONTEXT.md Sec "Voice quality improvements" for what these do and
# why these starting values, and note they're overridable per-request below
# so they can be A/B tested by ear without a redeploy.
DEFAULT_GEN_PARAMS = {
    "temperature": 0.8,
    "repetition_penalty": 1.2,
    "exaggeration": 0.6,  # emotional intensity; 0.5 = flat/neutral default
    "cfg_weight": 0.4,  # lower = looser/more natural pacing, less robotic
}
MIN_UPLOAD_SECONDS = 8  # practical floor; see PROJECT_CONTEXT.md Sec 9

# Punctuation-aware pause length instead of one fixed gap for every sentence
# boundary - a real (if small) step toward natural rhythm rather than a
# metronomic 0.2s everywhere regardless of what the sentence just did.
PAUSE_SECONDS_BY_ENDING = {
    "?": 0.32,  # slight lingering, like a real question
    "!": 0.28,
    ".": 0.24,
}
DEFAULT_PAUSE_SECONDS = 0.22


# Every preset voice previously loaded a FULL separate ChatterboxTTS
# (duplicating s3gen + the voice-encoder on the GPU for each one, ~10x more
# VRAM than needed) even though only the T3 module actually differs
# per-voice (that's what the LoRA adapter is fine-tuned on) - s3gen/ve are
# identical, untrained, shared weights across every voice including the
# zero-shot base engine. Loading 10 preset voices this way OOM'd at ~23.5GB
# on a 24GB card. Fixed by loading s3gen/ve exactly once and only building
# a separate (much smaller) T3+LoRA per voice, swapped onto the one shared
# engine right before each generation call - safe because this server
# processes one generation at a time anyway (no thread offloading), so
# there's no concurrent-request race on the shared engine object.
def load_finetuned_t3(pretrained_state: dict, t3_hp, adapter_dir: str):
    t3_hp.text_tokens_dict_size = NEW_VOCAB_SIZE
    new_t3 = T3(hp=t3_hp)
    new_t3 = resize_and_load_t3_weights(new_t3, pretrained_state)
    new_t3 = PeftModel.from_pretrained(new_t3, adapter_dir, is_trainable=False)
    new_t3.to(DEVICE).eval()
    return new_t3


print(f"[server] device: {DEVICE}")
print("[server] loading shared engine (s3gen/voice-encoder + base T3 for Feature B zero-shot)...")
base_engine = ChatterboxTTS.from_local(BASE_MODEL_DIR, device=DEVICE)
base_t3 = base_engine.t3  # kept aside so Feature B (arbitrary voice clone) can always swap back to it
pretrained_t3_state = base_engine.t3.state_dict()

preset_t3_by_voice: dict[str, object] = {}
for name, cfg in PRESET_VOICES.items():
    print(f"[server] loading fine-tuned T3: {name}...")
    preset_t3_by_voice[name] = load_finetuned_t3(pretrained_t3_state, base_engine.t3.hp, cfg["adapter_dir"])

print("[server] all engines loaded, starting API")

app = FastAPI(title="Lucy Inference API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

AUDIO_DIR = Path("/workspace/sloane/api_generated_audio")
AUDIO_DIR.mkdir(exist_ok=True)
app.mount("/audio", StaticFiles(directory=AUDIO_DIR), name="audio")


def split_sentences(text: str) -> list[str]:
    sentences = re.split(r"(?<=[.?!])\s+", text.strip())
    return [s for s in sentences if s.strip()]


def pause_seconds_for(sentence: str) -> float:
    stripped = sentence.rstrip()
    if stripped and stripped[-1] in PAUSE_SECONDS_BY_ENDING:
        return PAUSE_SECONDS_BY_ENDING[stripped[-1]]
    return DEFAULT_PAUSE_SECONDS


def apply_highpass(audio: np.ndarray, sr: int, cutoff_hz: float) -> np.ndarray:
    sos = butter(4, cutoff_hz, btype="highpass", fs=sr, output="sos")
    return sosfilt(sos, audio).astype(np.float32)


def synthesize(
    engine: ChatterboxTTS,
    text: str,
    reference_path: str,
    pitch_semitones: float = 0.0,
    highpass_hz: float = 0.0,
    **kwargs,
):
    all_chunks = []
    sr = 24000
    sentences = split_sentences(text)
    for sentence in sentences:
        wav_tensor = engine.generate(text=sentence, audio_prompt_path=reference_path, **kwargs)
        if isinstance(wav_tensor, tuple):
            wav_tensor = wav_tensor[0]
        wav_np = wav_tensor.squeeze().cpu().numpy()
        trimmed = trim_silence_with_vad(wav_np, engine.sr)
        if len(trimmed) > 0:
            all_chunks.append(trimmed)
            sr = engine.sr
            all_chunks.append(np.zeros(int(sr * pause_seconds_for(sentence)), dtype=np.float32))
    if not all_chunks:
        return None, None
    audio = np.concatenate(all_chunks)
    if pitch_semitones:
        audio = librosa.effects.pitch_shift(audio, sr=sr, n_steps=pitch_semitones)
    if highpass_hz:
        audio = apply_highpass(audio, sr, highpass_hz)
    return audio, sr


@app.post("/api/generate-preset")
async def generate_preset(
    text: str = Form(...),
    voice_id: str = Form(...),
    exaggeration: float | None = Form(None),
    cfg_weight: float | None = Form(None),
    pitch_semitones: float | None = Form(None),
):
    if voice_id not in preset_t3_by_voice:
        return JSONResponse(
            {"error": f"unknown voice_id, expected one of {sorted(preset_t3_by_voice)}"},
            status_code=400,
        )
    base_engine.t3 = preset_t3_by_voice[voice_id]  # swap onto the one shared engine (see load_finetuned_t3 note)
    reference = PRESET_VOICES[voice_id]["reference"]
    gen_params = {
        **DEFAULT_GEN_PARAMS,
        **GEN_PARAMS_BY_VOICE.get(voice_id, {}),
        **({"exaggeration": exaggeration} if exaggeration is not None else {}),
        **({"cfg_weight": cfg_weight} if cfg_weight is not None else {}),
    }
    pitch = pitch_semitones if pitch_semitones is not None else PITCH_SEMITONES_BY_VOICE.get(voice_id, 0.0)
    highpass = HIGHPASS_HZ_BY_VOICE.get(voice_id, 0.0)
    audio, sr = synthesize(base_engine, text, reference, pitch_semitones=pitch, highpass_hz=highpass, **gen_params)
    if audio is None:
        return JSONResponse({"error": "no audio generated"}, status_code=500)

    filename = f"{uuid.uuid4().hex}.wav"
    sf.write(str(AUDIO_DIR / filename), audio, sr)
    return {"audio_url": f"/audio/{filename}", "mock": False, "voice_id": voice_id}


@app.post("/api/clone-voice")
async def clone_voice(
    text: str = Form(...),
    reference_audio: UploadFile = File(...),
    exaggeration: float | None = Form(None),
    cfg_weight: float | None = Form(None),
):
    tmp_path = AUDIO_DIR / f"ref_{uuid.uuid4().hex}.wav"
    content = await reference_audio.read()
    with open(tmp_path, "wb") as f:
        f.write(content)

    duration = sf.info(str(tmp_path)).duration
    if duration < MIN_UPLOAD_SECONDS:
        tmp_path.unlink(missing_ok=True)
        return JSONResponse(
            {"error": f"reference audio too short ({duration:.1f}s) — need at least {MIN_UPLOAD_SECONDS}s"},
            status_code=400,
        )

    gen_params = {
        **DEFAULT_GEN_PARAMS,
        **({"exaggeration": exaggeration} if exaggeration is not None else {}),
        **({"cfg_weight": cfg_weight} if cfg_weight is not None else {}),
    }
    base_engine.t3 = base_t3  # zero-shot Feature B always uses the unmodified base T3, not a preset's LoRA
    audio, sr = synthesize(base_engine, text, str(tmp_path), **gen_params)
    tmp_path.unlink(missing_ok=True)
    if audio is None:
        return JSONResponse({"error": "no audio generated"}, status_code=500)

    filename = f"{uuid.uuid4().hex}.wav"
    sf.write(str(AUDIO_DIR / filename), audio, sr)
    return {"audio_url": f"/audio/{filename}", "mock": False}


@app.get("/api/health")
async def health():
    return {"status": "ok", "device": DEVICE, "preset_voices": sorted(preset_t3_by_voice)}
