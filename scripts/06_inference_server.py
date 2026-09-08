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
import string
import sys
import uuid
from collections import OrderedDict
from pathlib import Path

import librosa
import numpy as np
import pyworld as pw
import soundfile as sf
import torch
from faster_whisper import WhisperModel
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
    "voice_comedy": {  # Izzy
        "adapter_dir": "/workspace/sloane/chatterbox-ft-voice_comedy/chatterbox_output/new_lang_adapter",
        "reference": "/workspace/sloane/training_data/voice_comedy/clips/00001.wav",
    },
    "voice_meditation": {  # Michelle
        "adapter_dir": "/workspace/sloane/chatterbox-ft-voice_meditation/chatterbox_output/new_lang_adapter",
        "reference": "/workspace/sloane/training_data/voice_meditation/clips/00001.wav",
    },
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

# Per-voice natural pitch micro-jitter (semitones), applied across the whole
# generation. Robbo (voice_sales) has only ~16 training clips vs. 500+ for
# the other voices (confirmed 2026-09-08) - nowhere near enough for the
# LoRA fine-tune to learn natural pitch variation, which is why he sounds
# flat/robotic. The real fix is more source audio and a retrain; this is a
# real signal-processing mitigation in the meantime, not a substitute -
# it adds a slow, smoothed random walk to the F0 contour (mimicking the
# micro-instability real voices have and robotic-sounding flat pitch
# lacks), not a fake "sound human" trick.
PITCH_JITTER_BY_VOICE: dict[str, float] = {"voice_sales": 0.4}

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
# zero-shot base engine. Loading all preset voices this way OOM'd at ~23.5GB
# on a 24GB card even after sharing s3gen/ve, once the roster grew past ~8
# voices. Fixed with lazy loading: only the shared components load at
# startup (fast); each voice's much-smaller T3+LoRA loads on its first
# request and is kept in an LRU cache capped at MAX_CACHED_VOICES, evicting
# the least-recently-used voice if a new one is requested at capacity. This
# also directly answers "can we run this on-demand instead of 24/7" - this
# is the same fix that makes serverless (scale-to-zero) viable, since it
# turns "load all 10 voices, several minutes" into "load shared components
# once (still needed even cold), then ~seconds per new voice."
MAX_CACHED_VOICES = 6  # ~2GB/voice + ~10GB shared comfortably fits a 24GB card with headroom for inference itself


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

preset_t3_cache: "OrderedDict[str, object]" = OrderedDict()  # voice_id -> loaded T3+LoRA, most-recently-used last


def get_preset_t3(voice_id: str):
    if voice_id in preset_t3_cache:
        preset_t3_cache.move_to_end(voice_id)
        return preset_t3_cache[voice_id]

    if len(preset_t3_cache) >= MAX_CACHED_VOICES:
        evicted_id, evicted_t3 = preset_t3_cache.popitem(last=False)
        del evicted_t3
        torch.cuda.empty_cache()
        print(f"[server] evicted '{evicted_id}' from GPU cache to make room for '{voice_id}'")

    print(f"[server] loading fine-tuned T3 for '{voice_id}' (cache miss)...")
    t3 = load_finetuned_t3(pretrained_t3_state, base_engine.t3.hp, PRESET_VOICES[voice_id]["adapter_dir"])
    preset_t3_cache[voice_id] = t3
    return t3


print("[server] loading whisper for output content verification...")
verifier_model = WhisperModel("small", device=DEVICE, compute_type="float16" if DEVICE == "cuda" else "int8")

print("[server] shared engine loaded, starting API - preset voices load lazily on first use")

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


def apply_speed(audio: np.ndarray, rate: float) -> np.ndarray:
    """rate > 1.0 = faster, < 1.0 = slower. Real time-stretching (changes
    duration, preserves pitch) - not the same as pitch_semitones, and a
    genuine "speak slower" control, unlike emotion which Chatterbox has no
    equivalent knob for (see PITCH_SEMITONES_BY_VOICE comment)."""
    return librosa.effects.time_stretch(audio, rate=rate)


TERMINAL_FALL_SEMITONES = 5.0  # forced pitch drop from the tail's own peak down to its last voiced frame
TERMINAL_FALL_TAIL_MS = 450.0
SPLICE_CROSSFADE_MS = 15.0  # just enough to avoid an audible click at the head/tail seam


def apply_terminal_fall(audio: np.ndarray, sr: int, sentence: str) -> np.ndarray:
    """Two bugs in the first two versions of this, both found by ear on the
    live site:
    1. A flat pitch-shift-down only lowers the whole tail's register - it
       doesn't change whether the *contour* rises or falls, so a naturally
       rising ending still sounded like it was rising, just transposed
       lower.
    2. Forcing a fall via pyworld but then amplitude-crossfading it back in
       with the original over the whole tail doesn't work either: blending
       two differently-pitched signals in the amplitude domain layers two
       simultaneous pitches rather than producing one falling one, and the
       ear kept tracking the untouched original ("it again is ascending").
    Fix: commit fully to the corrected pitch for the whole tail (only a
    ~15ms crossfade at the splice point, to avoid a click - not a pitch
    blend), and anchor the forced fall to the tail's actual F0 *peak*
    rather than its first frame, since a rise can keep climbing past where
    the tail window starts - falling from frame 0 while the peak is still
    ahead doesn't read as a descending ending. Skipped for questions, which
    should keep their natural rise. Applies to every voice.
    """
    stripped = sentence.rstrip()
    if not stripped or stripped[-1] == "?":
        return audio
    tail_len = int(sr * TERMINAL_FALL_TAIL_MS / 1000)
    if len(audio) < tail_len * 2:
        return audio  # too short for a contour edit to read as natural rather than warped

    head, tail = audio[:-tail_len], audio[-tail_len:]
    tail64 = np.ascontiguousarray(tail.astype(np.float64))
    try:
        f0, t = pw.harvest(tail64, sr)
        sp = pw.cheaptrick(tail64, f0, t, sr)
        ap = pw.d4c(tail64, f0, t, sr)
    except Exception:
        return audio  # WORLD can fail to analyze very short/quiet tails - ship the original rather than crash

    voiced_idx = np.where(f0 > 0)[0]
    if len(voiced_idx) < 2:
        return audio  # nothing pitched to reshape (e.g. a trailing consonant/breath)

    peak_idx = voiced_idx[np.argmax(f0[voiced_idx])]
    last_idx = voiced_idx[-1]
    if last_idx <= peak_idx:
        return audio  # already falls (or flat) after its own peak - nothing to fix

    peak_semitone = 69.0 + 12.0 * np.log2(f0[peak_idx] / 440.0)
    target_f0 = f0.copy()
    span = last_idx - peak_idx
    for i in range(peak_idx, last_idx + 1):
        if f0[i] <= 0:
            continue
        frac = (i - peak_idx) / span
        target_semitone = peak_semitone - TERMINAL_FALL_SEMITONES * frac
        target_f0[i] = 440.0 * (2.0 ** ((target_semitone - 69.0) / 12.0))

    reshaped = pw.synthesize(target_f0, sp, ap, sr).astype(np.float32)
    if len(reshaped) < len(tail):
        reshaped = np.pad(reshaped, (0, len(tail) - len(reshaped)), mode="edge")
    elif len(reshaped) > len(tail):
        reshaped = reshaped[: len(tail)]

    fade_len = min(int(sr * SPLICE_CROSSFADE_MS / 1000), len(tail) // 4)
    if fade_len > 0:
        fade = np.linspace(0.0, 1.0, fade_len, dtype=np.float32)
        reshaped[:fade_len] = tail[:fade_len].astype(np.float32) * (1 - fade) + reshaped[:fade_len] * fade
    return np.concatenate([head, reshaped])


def apply_pitch_jitter(audio: np.ndarray, sr: int, jitter_semitones: float, seed: int | None = None) -> np.ndarray:
    """Adds a slow, smoothed random-walk wobble to the F0 contour across the
    whole utterance - real human pitch is never perfectly steady, and a
    LoRA voice trained on very little data (see PITCH_JITTER_BY_VOICE
    comment) tends to produce an unnaturally flat, steady pitch that reads
    as robotic. This is a mitigation, not a fix for the underlying data
    shortage - it doesn't add natural word-level emphasis or pacing, only
    removes some of the mechanical flatness in the raw pitch.
    """
    if jitter_semitones <= 0:
        return audio
    audio64 = np.ascontiguousarray(audio.astype(np.float64))
    try:
        f0, t = pw.harvest(audio64, sr)
        sp = pw.cheaptrick(audio64, f0, t, sr)
        ap = pw.d4c(audio64, f0, t, sr)
    except Exception:
        return audio

    voiced = f0 > 0
    if voiced.sum() < 2:
        return audio

    n = len(f0)
    rng = np.random.default_rng(seed)
    walk = np.cumsum(rng.normal(0, 0.15, size=n))
    kernel_size = max(3, n // 20)
    kernel = np.ones(kernel_size) / kernel_size
    walk_smooth = np.convolve(walk, kernel, mode="same")
    walk_smooth -= walk_smooth.mean()
    peak = np.max(np.abs(walk_smooth)) or 1.0
    walk_norm = walk_smooth / peak * jitter_semitones

    new_f0 = f0.copy()
    for i in range(n):
        if f0[i] <= 0:
            continue
        semitone = 69.0 + 12.0 * np.log2(f0[i] / 440.0) + walk_norm[i]
        new_f0[i] = 440.0 * (2.0 ** ((semitone - 69.0) / 12.0))

    reshaped = pw.synthesize(new_f0, sp, ap, sr).astype(np.float32)
    if len(reshaped) < len(audio):
        reshaped = np.pad(reshaped, (0, len(audio) - len(reshaped)), mode="edge")
    elif len(reshaped) > len(audio):
        reshaped = reshaped[: len(audio)]
    return reshaped


MAX_GENERATION_ATTEMPTS = 4  # see generate_sentence_with_retry - the underlying bugs this works around
MIN_WORD_OVERLAP_RATIO = 0.7  # below this, treat as a bad generation (words skipped/mangled) and retry


def _normalize_words(text: str) -> set[str]:
    stripped = text.lower().translate(str.maketrans("", "", string.punctuation))
    return set(stripped.split())


def word_overlap_ratio(input_text: str, transcribed_text: str) -> float:
    input_words = _normalize_words(input_text)
    if not input_words:
        return 1.0
    output_words = _normalize_words(transcribed_text)
    return len(input_words & output_words) / len(input_words)


def generate_sentence_with_retry(engine: ChatterboxTTS, sentence: str, reference_path: str, **kwargs) -> np.ndarray:
    """
    Two distinct, real generation glitches this works around, both hit
    repeatedly during manual testing across every voice this project has,
    and both reported live in production with no recovery:
    1. Chatterbox's alignment-stream safety mechanism occasionally forces
       an early EOS on an otherwise-fine sentence, producing audio far too
       short for the text ("audio isn't playing for all the text, just
       3-4 words") - caught by the duration check below.
    2. Separately, a generation can come back the *right* length but with
       words dropped or mangled mid-sentence ("Alice skipped some words") -
       duration alone can't catch this, so we transcribe the result with
       Whisper and compare against the input text; too little word overlap
       means retry, same as the duration case.
    Generation is stochastic - a retry reliably gets a clean result in the
    manual testing that uncovered both of these, so retrying with identical
    inputs is a real fix, not a hack.
    """
    word_count = len(sentence.split())
    min_expected_seconds = max(0.3, word_count / 5.0)  # generous - real speech is rarely faster than this
    last_trimmed = np.array([], dtype=np.float32)

    for attempt in range(MAX_GENERATION_ATTEMPTS):
        wav_tensor = engine.generate(text=sentence, audio_prompt_path=reference_path, **kwargs)
        if isinstance(wav_tensor, tuple):
            wav_tensor = wav_tensor[0]
        wav_np = wav_tensor.squeeze().cpu().numpy()
        trimmed = trim_silence_with_vad(wav_np, engine.sr)
        last_trimmed = trimmed
        duration = len(trimmed) / engine.sr

        if duration < min_expected_seconds:
            print(f"[server] short generation ({duration:.2f}s for {word_count} words), retrying ({attempt + 1}/{MAX_GENERATION_ATTEMPTS})...")
            continue

        segments, _ = verifier_model.transcribe(trimmed, language="en")
        transcribed_text = " ".join(seg.text for seg in segments)
        overlap = word_overlap_ratio(sentence, transcribed_text)
        if overlap >= MIN_WORD_OVERLAP_RATIO:
            return trimmed
        print(f"[server] word mismatch (overlap {overlap:.0%}) - said \"{transcribed_text[:80]}\" for \"{sentence[:80]}\", retrying ({attempt + 1}/{MAX_GENERATION_ATTEMPTS})...")

    print(f"[server] all {MAX_GENERATION_ATTEMPTS} attempts came back bad - shipping the last one rather than failing outright")
    return last_trimmed


def synthesize(
    engine: ChatterboxTTS,
    text: str,
    reference_path: str,
    pitch_semitones: float = 0.0,
    highpass_hz: float = 0.0,
    pitch_jitter_semitones: float = 0.0,
    speed: float = 1.0,
    **kwargs,
):
    all_chunks = []
    sr = 24000
    sentences = split_sentences(text)
    for sentence in sentences:
        trimmed = generate_sentence_with_retry(engine, sentence, reference_path, **kwargs)
        if len(trimmed) > 0:
            trimmed = apply_terminal_fall(trimmed, sr, sentence)
            all_chunks.append(trimmed)
            sr = engine.sr
            all_chunks.append(np.zeros(int(sr * pause_seconds_for(sentence)), dtype=np.float32))
    if not all_chunks:
        return None, None
    audio = np.concatenate(all_chunks)
    if pitch_jitter_semitones:
        audio = apply_pitch_jitter(audio, sr, pitch_jitter_semitones)
    if pitch_semitones:
        audio = librosa.effects.pitch_shift(audio, sr=sr, n_steps=pitch_semitones)
    if highpass_hz:
        audio = apply_highpass(audio, sr, highpass_hz)
    if speed and speed != 1.0:
        audio = apply_speed(audio, speed)
    return audio, sr


@app.post("/api/generate-preset")
async def generate_preset(
    text: str = Form(...),
    voice_id: str = Form(...),
    exaggeration: float | None = Form(None),
    cfg_weight: float | None = Form(None),
    pitch_semitones: float | None = Form(None),
    speed: float | None = Form(None),
):
    if voice_id not in PRESET_VOICES:
        return JSONResponse(
            {"error": f"unknown voice_id, expected one of {sorted(PRESET_VOICES)}"},
            status_code=400,
        )
    base_engine.t3 = get_preset_t3(voice_id)  # swap onto the one shared engine (see load_finetuned_t3 note); loads on first use
    reference = PRESET_VOICES[voice_id]["reference"]
    gen_params = {
        **DEFAULT_GEN_PARAMS,
        **GEN_PARAMS_BY_VOICE.get(voice_id, {}),
        **({"exaggeration": exaggeration} if exaggeration is not None else {}),
        **({"cfg_weight": cfg_weight} if cfg_weight is not None else {}),
    }
    pitch = pitch_semitones if pitch_semitones is not None else PITCH_SEMITONES_BY_VOICE.get(voice_id, 0.0)
    highpass = HIGHPASS_HZ_BY_VOICE.get(voice_id, 0.0)
    jitter = PITCH_JITTER_BY_VOICE.get(voice_id, 0.0)
    audio, sr = synthesize(
        base_engine,
        text,
        reference,
        pitch_semitones=pitch,
        highpass_hz=highpass,
        pitch_jitter_semitones=jitter,
        speed=speed or 1.0,
        **gen_params,
    )
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
    speed: float | None = Form(None),
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
    audio, sr = synthesize(base_engine, text, str(tmp_path), speed=speed or 1.0, **gen_params)
    tmp_path.unlink(missing_ok=True)
    if audio is None:
        return JSONResponse({"error": "no audio generated"}, status_code=500)

    filename = f"{uuid.uuid4().hex}.wav"
    sf.write(str(AUDIO_DIR / filename), audio, sr)
    return {"audio_url": f"/audio/{filename}", "mock": False}


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "device": DEVICE,
        "preset_voices": sorted(PRESET_VOICES),
        "voices_cached_in_gpu": list(preset_t3_cache.keys()),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
