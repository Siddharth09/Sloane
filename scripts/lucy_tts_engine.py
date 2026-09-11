#!/usr/bin/env python3
"""Shared TTS engine: model loading, chunking/DSP pipeline, and the two
generation entry points (preset voice + zero-shot clone), extracted out of
scripts/06_inference_server.py so both the FastAPI server (kept for local/
manual Pod-based testing) and the RunPod Serverless handler
(scripts/09_serverless_handler.py, the production path) can share one
implementation instead of two copies drifting apart.

Pure extraction - no behavior changes. Every function/constant here is
unchanged from 06_inference_server.py as of the 2026-09-09 long-sentence
chunking fix.
"""
import os
import re
import shutil
import string
import subprocess
import sys
import tempfile
from collections import OrderedDict
from pathlib import Path

import librosa
import numpy as np
import pyworld as pw
import soundfile as sf
import torch
from faster_whisper import WhisperModel
from scipy.signal import butter, sosfilt
from peft import PeftModel

# Everything below was hardcoded to /workspace/sloane/... - the path RunPod's
# network volume mounts at. Modal mounts its own Volume at a different path
# (/models), so this root is now an env var (defaulting to the RunPod path,
# so RunPod's Dockerfile/CMD needs no changes) rather than a literal - the
# only change needed to run this exact engine on either platform.
MODEL_ROOT = os.environ.get("LUCY_MODEL_ROOT", "/workspace/sloane")

# The fine-tuning toolkit's own package layout (src.*) - reuse it directly
# rather than reimplementing model loading.
sys.path.insert(0, f"{MODEL_ROOT}/chatterbox-ft-art")
from src.model import resize_and_load_t3_weights  # noqa: E402
from src.utils import trim_silence_with_vad  # noqa: E402
from src.chatterbox_.tts import ChatterboxTTS  # noqa: E402
from src.chatterbox_.models.t3.t3 import T3  # noqa: E402

BASE_MODEL_DIR = f"{MODEL_ROOT}/chatterbox-finetuning/pretrained_models"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
NEW_VOCAB_SIZE = 2454  # matches TrainConfig.new_vocab_size for is_turbo=False

PRESET_VOICES = {
    # Kirsty and Matt reuse the very first two fine-tuned voices (Phase 6) -
    # renamed for the customer-facing preset picker, no retraining needed.
    "art_instructor": {
        "adapter_dir": f"{MODEL_ROOT}/chatterbox-ft-art/chatterbox_output/new_lang_adapter",
        # Was 00266.wav - reproduced live 2026-09-09 as a near-silent-output
        # bug (0.14-0.26s clips instead of several seconds), independent of
        # chunk length/word count (unlike Michelle's issue). Root-caused to
        # the reference clip, not text length: tested 6 candidate clips from
        # her own training data with identical text/settings, only 2 of 6
        # avoided an almost-immediate forced-EOS (Chatterbox's alignment-
        # stream safety net firing on "token_repetition" within the first
        # ~5-100 sampling steps, all 4 retries, every time) - no correlation
        # with clip duration (2.98-6.29s spanned in both groups). 00010.wav
        # confirmed reliable across 3 separate test sentences post-swap.
        "reference": f"{MODEL_ROOT}/training_data/art_instructor/clips/00010.wav",
    },
    "music_instructor": {
        "adapter_dir": f"{MODEL_ROOT}/chatterbox-ft-music/chatterbox_output/new_lang_adapter",
        "reference": f"{MODEL_ROOT}/training_data/music_instructor/clips/00042.wav",
    },
    "voice_business": {  # Alice
        "adapter_dir": f"{MODEL_ROOT}/chatterbox-ft-voice_business/chatterbox_output/new_lang_adapter",
        "reference": f"{MODEL_ROOT}/training_data/voice_business/clips/00040.wav",
    },
    "voice_finance": {  # Megan
        "adapter_dir": f"{MODEL_ROOT}/chatterbox-ft-voice_finance/chatterbox_output/new_lang_adapter",
        "reference": f"{MODEL_ROOT}/training_data/voice_finance/clips/00001.wav",
    },
    "voice_broadcast": {  # Katie
        "adapter_dir": f"{MODEL_ROOT}/chatterbox-ft-voice_broadcast/chatterbox_output/new_lang_adapter",
        "reference": f"{MODEL_ROOT}/training_data/voice_broadcast/clips/00018.wav",
    },
    "voice_tech": {  # Brad
        "adapter_dir": f"{MODEL_ROOT}/chatterbox-ft-voice_tech/chatterbox_output/new_lang_adapter",
        "reference": f"{MODEL_ROOT}/training_data/voice_tech/clips/00001.wav",
    },
    "voice_mark": {  # Mark
        "adapter_dir": f"{MODEL_ROOT}/chatterbox-ft-voice_mark/chatterbox_output/new_lang_adapter",
        "reference": f"{MODEL_ROOT}/training_data/voice_mark/clips/00001.wav",
    },
    "voice_sales": {  # Robbo
        "adapter_dir": f"{MODEL_ROOT}/chatterbox-ft-voice_sales/chatterbox_output/new_lang_adapter",
        "reference": f"{MODEL_ROOT}/training_data/voice_sales/clips/00008.wav",
    },
    "voice_comedy": {  # Izzy
        "adapter_dir": f"{MODEL_ROOT}/chatterbox-ft-voice_comedy/chatterbox_output/new_lang_adapter",
        "reference": f"{MODEL_ROOT}/training_data/voice_comedy/clips/00001.wav",
    },
    "voice_adam": {  # Adam - 2026-09-10, isolated via k=2 speaker clustering
        # from a user-supplied podcast (kept cluster 1, 567/662 clips - the
        # other cluster was a second speaker in the same recording).
        "adapter_dir": f"{MODEL_ROOT}/chatterbox-ft-voice_adam/chatterbox_output/new_lang_adapter",
        "reference": f"{MODEL_ROOT}/training_data/voice_adam/clips/00001.wav",
    },
    "voice_rachel": {  # Rachel - 2026-09-10, from a user-supplied podcast.
        # Deliberately NOT speaker-isolated - explicit instruction was to
        # merge all clusters into one voice, same precedent as voice_sales.
        "adapter_dir": f"{MODEL_ROOT}/chatterbox-ft-voice_rachel/chatterbox_output/new_lang_adapter",
        "reference": f"{MODEL_ROOT}/training_data/voice_rachel/clips/00001.wav",
    },
    "voice_emily": {  # Emily - 2026-09-10, isolated via k=2 speaker
        # clustering from a third user-supplied podcast (kept cluster 0,
        # 155/254 clips - confirmed by ear).
        "adapter_dir": f"{MODEL_ROOT}/chatterbox-ft-voice_emily/chatterbox_output/new_lang_adapter",
        "reference": f"{MODEL_ROOT}/training_data/voice_emily/clips/00018.wav",
    },
    # Michelle (voice_meditation) removed 2026-09-10 per direct user
    # feedback ("not good at all we can remove her") - also the voice this
    # session's own notes already flagged as never actually fixed (see
    # MAX_CHUNK_WORDS_BY_VOICE history below and PROJECT_CONTEXT.md Sec 12):
    # capped at a 14-word chunk limit because anything longer reproduced a
    # near-silent-clip forced-EOS bug even after a 4.5x larger retrain. Not
    # deleting her LoRA/training data on the Volume - just no longer offered
    # as a preset.
}

# "Preset" voices backed by zero-shot cloning against a FIXED reference
# clip, instead of a real LoRA fine-tune (see PRESET_VOICES above) - for a
# voice with no real training data to fine-tune on. Harper (2026-09-11):
# her only source is a single ~6s clip from a Veo-generated demo (looped
# to clear MIN_UPLOAD_SECONDS - see generate_preset), not the many minutes
# every other preset voice has. Quality expectation set honestly: zero-
# shot cloning from one short, already-synthetic clip is a rougher
# approximation than a real fine-tune, not the same bar as the voices in
# PRESET_VOICES above. Reference paths point at files bundled directly
# into the Modal image (see modal_app.py's add_local_file) since these are
# small and don't need the Volume's fine-tuned-checkpoint machinery.
ZERO_SHOT_PRESET_VOICES: dict[str, str] = {
    "harper": "/app/voice_references/harper.wav",
    # 2026-09-11: same zero-shot pattern, source is a Veo-generated 4s clip
    # (looped x3 to clear MIN_UPLOAD_SECONDS) rather than real recorded
    # audio of a real person - jess/liam/ryan/tyler are AI-generated voices
    # from the start, not clones of anyone. jess (originally generated as
    # "aoife", renamed same day to match the character's own renaming) = a
    # second, distinct Irish accent for Jess/formerly-Vicky's character
    # video (separate from Izzy/voice_comedy, per direct request "give
    # vicky another irish accent"); liam/ryan/tyler are the requested "male
    # version of Izzy/Katie/Harper" - matched by accent/vibe (Irish,
    # Australian, Australian-surfer) rather than by timbre, since there's
    # no way to derive a "male version" of an existing voice's actual
    # voiceprint.
    "jess": "/app/voice_references/jess.wav",
    "liam": "/app/voice_references/liam.wav",
    "ryan": "/app/voice_references/ryan.wav",
    "tyler": "/app/voice_references/tyler.wav",
}

# Runtime pitch adjustment, applied as post-processing (librosa.effects.
# pitch_shift) after generation - a real audio-signal change, not a
# training-time effect, so it's cheap to tune per-voice without retraining.
# Positive = higher. See PROJECT_CONTEXT.md "Voice tuning requests" for the
# real limitation here, stated plainly rather than oversold: naive
# pitch-shifting doesn't adjust vocal-tract resonance (formants), which is
# why Katie's own +1.5 semitone attempt was reverted (sounded artificial) -
# a pitch bump is a real but imperfect proxy, not a genuine timbre change;
# only retraining on source audio with the actually-desired quality does
# that. Used here anyway as the best available knob, per direct request.
PITCH_SEMITONES_BY_VOICE: dict[str, float] = {
    "voice_rachel": 1.0,  # Rachel - "more feminine" - see the honest caveat above; a real but limited lever, not a genuine timbre change
    # Izzy's pitch/clarity tuning (1.5, then 2.5 semitones) removed 2026-09-10
    # per "revert izzy back to original voice" - the real fix for her pitch
    # and accent is retraining on blended source audio (see the 3m5.mp4
    # blend below), not stacking more DSP on the same LoRA checkpoint.
    #
    # 2026-09-11 "make all voices sound slightly different, still human"
    # request - a small +0.3 semitone nudge on every voice EXCEPT Rachel
    # (already has her own +1.0 tuned in, not stacking on it) and Izzy
    # (explicitly reverted to zero DSP above per direct request - not
    # re-adding any pitch shift for her). Deliberately much smaller than
    # the 1.5-2.5 semitone shifts that were reported "artificial"/
    # "robotic" for Katie/Izzy earlier in this project - this is a
    # genuinely different, much more conservative magnitude, not the same
    # mistake repeated. Still: pitch-shifting doesn't touch vocal-tract
    # resonance (see the honest caveat above) and has NOT been confirmed by
    # ear yet - needs a real listen before treating this as final, same as
    # every other DSP tuning pass in this project's history.
    "art_instructor": 0.3,
    "music_instructor": 0.3,
    "voice_business": 0.3,
    "voice_finance": 0.3,
    "voice_broadcast": 0.3,
    "voice_tech": 0.3,
    "voice_mark": 0.3,
    "voice_sales": 0.3,
    "voice_adam": 0.3,
    "voice_emily": 0.3,
}

# Per-voice high-pass filter cutoff (Hz) - cuts low-frequency room
# resonance/boom that reads as "echoey", without touching vocal clarity
# (speech fundamentals sit well above these cutoffs). Real signal
# processing, not a training-time effect. Tried for Katie 2026-09-08 (less
# echoey/softer request) but reverted per feedback - keeping the mechanism
# since it's a real, useful knob for whichever voice actually needs it.
HIGHPASS_HZ_BY_VOICE: dict[str, float] = {}

# Per-voice bandstop notch (center Hz, defaults to a 400Hz-wide band) -
# targets the nasal resonance region (~800Hz-1.2kHz is the typical range
# for a "nasal" quality) directly, unlike pitch-shift (transposes the whole
# register) or highpass (only removes sub-vocal rumble) - a genuinely
# different mechanism from Katie's two earlier reverted attempts (see
# PITCH_SEMITONES_BY_VOICE and HIGHPASS_HZ_BY_VOICE comments above).
# Starting value, not ear-verified.
NOTCH_HZ_BY_VOICE: dict[str, float] = {
    "voice_broadcast": 1000.0,  # Katie - "a little less nasal", 2026-09-10
}

# Per-voice generation-parameter overrides, layered on DEFAULT_GEN_PARAMS.
# These are baseline *delivery* biases for Chatterbox's real knobs only
# (exaggeration / cfg_weight / temperature) — not fake happy/sad emotion
# classes. plan_delivery() may nudge further from punctuation/discourse;
# explicit request form fields still win last.
GEN_PARAMS_BY_VOICE: dict[str, dict] = {
    # Punchier comedy timing — a bit more expressive intensity, looser cfg.
    # Reverted back to these original values 2026-09-10 ("revert izzy back
    # to original voice") after a same-day tightened variant
    # (0.65/0.5/0.65, tried to fix a "not clear" report) - the clarity/
    # accent fix is being done properly via retraining on blended source
    # audio instead (see the 3m5.mp4 blend below).
    "voice_comedy": {
        "exaggeration": 0.75,
        "cfg_weight": 0.35,
        "temperature": 0.80,  # was 0.85 - same -0.05 clarity nudge as DEFAULT_GEN_PARAMS, see its comment
    },
    # Sales energy (Robbo). Was cfg_weight 0.35 / temperature 0.85 (looser
    # than DEFAULT_GEN_PARAMS's 0.4/0.8 in both directions) - reported live
    # 2026-09-10 as switching accents mid-sentence and sounding sped up.
    # Both symptoms point the same direction: looser cfg_weight gives the
    # model more freedom to drift from the reference accent/pacing, and
    # higher temperature adds more sampling randomness on top of that -
    # exactly the two knobs that were pushed further from center for
    # "energy." Pulled cfg_weight up and temperature down past even the
    # default (tighter than any other voice) to prioritize staying on-accent
    # over sales punch, kept some exaggeration for a bit of energy without
    # the loose sampling that let it drift. Needs re-testing by ear - this
    # is a targeted hypothesis based on which knobs were pushed and in which
    # direction, not a verified-by-listening fix (see PROJECT_CONTEXT.md
    # "Voice tuning requests" for why pitch-shifting/highpass aren't the
    # right tool for an accent problem - this is a generation-conditioning
    # problem, not a signal-processing one).
    "voice_sales": {
        "exaggeration": 0.55,
        "cfg_weight": 0.55,
        "temperature": 0.60,  # was 0.65 - same -0.05 clarity nudge, and consistent with this voice's own existing "tighter = less accent drift" reasoning above
    },
    # Adam - "softer", 2026-09-10: lower exaggeration (less intense/forceful
    # delivery) + slightly higher cfg_weight (steadier, less erratic) for a
    # gentler overall feel. Paired with a small highpass below to trim any
    # boomy low-end that can read as "heavy."
    "voice_adam": {
        "exaggeration": 0.45,
        "cfg_weight": 0.5,
        "temperature": 0.70,  # was 0.75 - same -0.05 clarity nudge, see DEFAULT_GEN_PARAMS comment
    },
    # Rachel - "less husky, more feminine, soft yet bold", 2026-09-10.
    # Honest framing: none of these knobs change vocal-tract resonance
    # (what actually makes a voice sound husky/feminine - see
    # PITCH_SEMITONES_BY_VOICE comment), only delivery character. Moderate
    # exaggeration for "bold" without tipping into "husky"-reading
    # intensity, tighter cfg_weight for a controlled ("soft," not loose or
    # breathy-sounding) delivery, slightly lower temperature to reduce
    # stochastic roughness.
    "voice_rachel": {
        "exaggeration": 0.55,
        "cfg_weight": 0.5,
        "temperature": 0.65,  # was 0.7 - same -0.05 clarity nudge, see DEFAULT_GEN_PARAMS comment
    },
    # Broadcast / instructor voices stay near DEFAULT_GEN_PARAMS (no entry).
}

# Was {"voice_comedy": 0.82, "voice_business": 0.88, "voice_sales": 0.88} -
# tried 2026-09-10 to fix Izzy/Alice/Robbo sounding sped up, by
# time-stretching their default output slower via apply_speed(). Reverted
# same day: reported live as making exactly those three voices sound
# "distorted"/"like a robot" - a phase-vocoder time-stretch (librosa's
# time_stretch, an STFT-based method) is a well-known source of that kind
# of metallic/robotic artifact, especially stacked on audio that's already
# been through pitch reshaping (pitch_jitter, apply_terminal_fall). Every
# other voice only ever gets time-stretched when a *user* explicitly drags
# the Speed slider (rare, their own choice) - this was the only path that
# forced it into every single generation of three voices by default, which
# is almost certainly why the distortion was reported on exactly those
# three and no others. "Too fast" is still a real unaddressed complaint for
# these voices, but the fix needs to come from generation-time parameters
# (GEN_PARAMS_BY_VOICE - cfg_weight/exaggeration/pause_multiplier) or a
# genuinely higher-quality time-stretch, not this.
#
# Re-added for Izzy only, 2026-09-10 ("slightly slower pace") at a gentler
# 0.96 than the 0.82 that caused the earlier distortion - but reverted again
# same day after the user reported Izzy sounding distorted, confirming this
# is the same phase-vocoder artifact at any stretch factor, not just extreme
# ones. Do not re-add time-stretching for Izzy (or anyone) as a default -
# see the block above for why this mechanism keeps failing. "Slightly slower
# pace" for Izzy is not yet solved; needs a genuinely different approach
# (e.g. GEN_PARAMS_BY_VOICE pacing/pause tuning) next time it's attempted.
SPEED_BY_VOICE: dict[str, float] = {}

# Per-voice natural pitch micro-jitter (semitones), applied across the whole
# generation. Was {"voice_sales": 0.4} - Robbo had only ~16 training clips
# vs. 500+ for the other voices (confirmed 2026-09-08), nowhere near enough
# for the LoRA fine-tune to learn natural pitch variation on its own, which
# is why this signal-processing mitigation existed. Removed 2026-09-09
# after the retrain expanded Robbo's source data to ~665 clips / ~53min
# (exceeding the well-trained-voice benchmark) - the actual data problem
# this was mitigating is resolved, so the mitigation itself should go too
# rather than stack on top of a voice that no longer needs it. If Robbo's
# pitch still sounds flat after this, that's new information (not this old
# data-scarcity issue) and should be diagnosed fresh rather than assumed to
# need the same fix.
PITCH_JITTER_BY_VOICE: dict[str, float] = {}

# Chatterbox's real (previously unused) expressiveness controls - see
# PROJECT_CONTEXT.md Sec "Voice quality improvements" for what these do and
# why these starting values, and note they're overridable per-request below
# so they can be A/B tested by ear without a redeploy.
DEFAULT_GEN_PARAMS = {
    # Was 0.8. 2026-09-11 "make the voices clearer" request: temperature
    # controls sampling randomness, so a small decrease trades a little
    # spontaneity for more consistent, clearer pronunciation - deliberately
    # NOT using cfg_weight for this (this file's own comment two lines down
    # already documents that pushing cfg_weight UP trends toward robotic-
    # sounding, the opposite of "clearer and human-like"). Not yet
    # ear-verified - needs a real listen, same as every DSP tuning pass in
    # this project's history.
    "temperature": 0.75,
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
ELLIPSIS_PAUSE_SECONDS = 0.42  # hesitation / trailing-off
DEFAULT_PAUSE_SECONDS = 0.22

# Safe clamps for Chatterbox knobs (plan_delivery offsets land inside these).
EXAGGERATION_RANGE = (0.25, 0.95)
CFG_WEIGHT_RANGE = (0.15, 0.85)
TEMPERATURE_RANGE = (0.5, 1.15)
PAUSE_MULTIPLIER_RANGE = (0.7, 1.6)


# Every preset voice previously loaded a FULL separate ChatterboxTTS
# (duplicating s3gen + the voice-encoder on the GPU for each one, ~10x more
# VRAM than needed) even though only the T3 module actually differs
# per-voice (that's what the LoRA adapter is fine-tuned on) - s3gen/ve are
# identical, untrained, shared weights across every voice including the
# zero-shot base engine. Loading all preset voices this way OOM'd at ~23.5GB
# on the 24GB card this ran on at the time, once the roster grew past ~8
# voices. Fixed with lazy loading: only the shared components load at
# startup (fast); each voice's much-smaller T3+LoRA loads on its first
# request and is kept in an LRU cache capped at MAX_CACHED_VOICES, evicting
# the least-recently-used voice if a new one is requested at capacity.
#
# On Modal (L40S, 48GB) this cap was still only 6 out of the roster's
# voices, and that turned out to be a real, previously-undiscovered latency
# bug, not just a memory optimization: a Modal container can be fully
# "warm" (shared engine loaded, already served a request) and still eat a
# per-voice LoRA-load-from-Volume cost on every request for whichever voice
# isn't in that container's cache yet - reproduced live 2026-09-10, a
# "warm" container logging "loading fine-tuned T3 for 'voice_business'
# (cache miss)" on a real request, directly explaining "Modal is slow even
# after warmed up" for realistic traffic that tries more than 6 voices
# across a container's lifetime. MAX_CACHED_VOICES now covers every preset
# voice (~2GB/voice x12 + ~10GB shared ≈ 34GB, comfortable headroom on 48GB -
# recomputed 2026-09-11 after Adam/Rachel/Emily brought the roster from 9 to
# 12; the 2GB/voice figure is still an estimate, not independently
# re-verified) and modal_app.py's @modal.enter() eagerly preloads all of
# them at container start - trading a somewhat longer cold start (already
# the dominant cost at 85-150s) for eliminating this per-voice tax on every
# later request, cold or warm. MAX_CACHED_VOICES auto-scales with
# len(PRESET_VOICES), so recompute this math again if the roster grows
# enough to threaten the VRAM budget.
MAX_CACHED_VOICES = len(PRESET_VOICES)


def warm_all_preset_voices() -> None:
    """Preloads every preset voice's T3+LoRA into preset_t3_cache - see
    MAX_CACHED_VOICES comment above for why this now runs eagerly at
    container start instead of lazily per-voice."""
    for voice_id in PRESET_VOICES:
        get_preset_t3(voice_id)


def load_finetuned_t3(pretrained_state: dict, t3_hp, adapter_dir: str):
    t3_hp.text_tokens_dict_size = NEW_VOCAB_SIZE
    new_t3 = T3(hp=t3_hp)
    new_t3 = resize_and_load_t3_weights(new_t3, pretrained_state)
    new_t3 = PeftModel.from_pretrained(new_t3, adapter_dir, is_trainable=False)
    new_t3.to(DEVICE).eval()
    return new_t3


print(f"[engine] device: {DEVICE}")
print("[engine] loading shared engine (s3gen/voice-encoder + base T3 for Feature B zero-shot)...")
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
        print(f"[engine] evicted '{evicted_id}' from GPU cache to make room for '{voice_id}'")

    print(f"[engine] loading fine-tuned T3 for '{voice_id}' (cache miss)...")
    t3 = load_finetuned_t3(pretrained_t3_state, base_engine.t3.hp, PRESET_VOICES[voice_id]["adapter_dir"])
    preset_t3_cache[voice_id] = t3
    return t3


print("[engine] loading whisper for output content verification...")
verifier_model = WhisperModel("small", device=DEVICE, compute_type="float16" if DEVICE == "cuda" else "int8")

print("[engine] shared engine loaded - preset voices load lazily on first use")


def split_sentences(text: str) -> list[str]:
    """Split on sentence endings and blank/newline boundaries.

    Ellipses ("..." / "…") are protected so three dots are not treated as
    three period boundaries; a trailing ellipsis stays one unit. Bare
    newlines still create separate chunks even without terminal punctuation.
    """
    if not text or not text.strip():
        return []
    normalized = text.replace("…", "...").strip()
    parts: list[str] = []
    ellipsis_token = "\0ELLIPSIS\0"
    for paragraph in re.split(r"\n+", normalized):
        paragraph = paragraph.strip()
        if not paragraph:
            continue
        protected = paragraph.replace("...", ellipsis_token)
        for piece in re.split(r"(?<=[.?!])\s+", protected):
            restored = piece.replace(ellipsis_token, "...").strip()
            if restored:
                parts.append(restored)
    return parts


def pause_seconds_for(sentence: str) -> float:
    stripped = sentence.rstrip()
    if not stripped:
        return DEFAULT_PAUSE_SECONDS
    if stripped.endswith("...") or stripped.endswith("…"):
        return ELLIPSIS_PAUSE_SECONDS
    if stripped[-1] in PAUSE_SECONDS_BY_ENDING:
        return PAUSE_SECONDS_BY_ENDING[stripped[-1]]
    return DEFAULT_PAUSE_SECONDS


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


# Lexicon-based happy/sad valence, 2026-09-10 - direct request: "when it is
# a sentence, it needs to understand if the context is happy or sad."
# Same honest heuristic tradeoff as EMPHASIS_WORDS: a curated word list, not
# real sentiment understanding - no negation ("not happy" still scores
# happy), no sarcasm, no context beyond the current chunk.
HAPPY_WORDS = {
    "happy", "happier", "happiest", "joy", "joyful", "joyous", "excited",
    "exciting", "thrilled", "delighted", "cheerful", "cheery", "wonderful",
    "amazing", "fantastic", "great", "love", "loved", "loving", "laugh",
    "laughing", "laughter", "celebrate", "celebrating", "celebration",
    "fun", "yay", "awesome", "brilliant", "glad", "grateful", "blessed",
    "smile", "smiling", "sunshine", "playful", "giggle", "giggling",
}
SAD_WORDS = {
    "sad", "sadder", "saddest", "sadness", "sorry", "unfortunately", "miss",
    "missed", "missing", "lost", "loss", "grief", "grieving", "alone",
    "lonely", "cry", "crying", "cried", "tears", "hurt", "hurting",
    "painful", "difficult", "heartbroken", "devastated", "sorrow", "mourn",
    "mourning", "depressed", "tragic", "tragedy", "gloomy", "somber",
    "regret", "regretful", "ashamed", "hopeless", "grim",
}


def plan_delivery(text: str, voice_id: str | None = None) -> dict:
    """Punctuation/discourse/lexical delivery hints for Chatterbox knobs,
    called PER GENERATION CHUNK (a few sentences at a time - see synthesize),
    not once for a whole request - so a happy paragraph followed by a sad
    one actually gets two different deliveries, not one averaged-out blend.

    Inspects surface cues (questions, exclamations, ellipses, lists, quotes,
    soft/energetic lexical markers) plus a lexicon-based happy/sad valence
    score (added 2026-09-10, direct request: "understand if the context is
    happy or sad"). This IS a heuristic word-list, same honest tradeoff as
    EMPHASIS_WORDS - not real sentiment understanding, no negation handling
    ("not happy" still scores as happy), no sarcasm detection. Returns
    *offsets* / multipliers. Caller merges: DEFAULT -> GEN_PARAMS_BY_VOICE ->
    these offsets -> explicit request overrides (which still win).
    """
    del voice_id  # reserved for future per-voice discourse biases; voice baselines live in GEN_PARAMS_BY_VOICE
    t = (text or "").strip()
    lower = t.lower()
    tokens = re.findall(r"[a-z']+", lower)  # word-boundary tokens, not substring hits - "hurt" shouldn't match inside a longer word

    exaggeration_offset = 0.0
    cfg_weight_offset = 0.0
    temperature_offset = 0.0
    pause_multiplier = 1.0
    pitch_offset_semitones = 0.0

    q_count = t.count("?")
    excl_count = t.count("!")
    ellipsis_count = t.count("...") + t.count("…")
    quote_count = len(re.findall(r"[\"\'“”‘’]", t))
    # rough list cues: newlines with bullets/numbers, or many semicolons
    list_cues = bool(re.search(r"(?m)^\s*([-*•]|\d+[.)])\s+", t)) or t.count(";") >= 2

    soft_markers = (
        "please", "gently", "gently,", "calm", "softly", "slowly", "quietly",
        "carefully", "peacefully", "breathe", "relax", "soothing", "tender",
    )
    soft_hits = sum(1 for m in soft_markers if m in lower)

    energetic_markers = (
        "wow", "amazing", "incredible", "let's go", "exciting", "fantastic",
        "awesome", "hurry", "now!",
    )
    energy_hits = sum(1 for m in energetic_markers if m in lower)

    if q_count:
        # Questions: slight lift in expressiveness; a touch looser cfg for rise.
        exaggeration_offset += min(0.08, 0.04 * q_count)
        cfg_weight_offset -= min(0.06, 0.03 * q_count)
        pause_multiplier *= 1.0 + min(0.15, 0.06 * q_count)

    if excl_count:
        exaggeration_offset += min(0.12, 0.05 * excl_count)
        temperature_offset += min(0.06, 0.03 * excl_count)
        pause_multiplier *= 1.0 + min(0.1, 0.04 * excl_count)

    if ellipsis_count:
        # Hesitation / trailing-off: softer, longer gaps — not "sad".
        exaggeration_offset -= min(0.1, 0.04 * ellipsis_count)
        cfg_weight_offset += min(0.08, 0.03 * ellipsis_count)
        temperature_offset -= min(0.06, 0.02 * ellipsis_count)
        pause_multiplier *= 1.0 + min(0.35, 0.12 * ellipsis_count)

    if soft_hits:
        exaggeration_offset -= min(0.15, 0.05 * soft_hits)
        cfg_weight_offset += min(0.12, 0.04 * soft_hits)
        temperature_offset -= min(0.08, 0.03 * soft_hits)
        pause_multiplier *= 1.0 + min(0.25, 0.08 * soft_hits)

    if energy_hits:
        exaggeration_offset += min(0.1, 0.04 * energy_hits)
        cfg_weight_offset -= min(0.06, 0.02 * energy_hits)

    if quote_count >= 2:
        # Light dialogue lift when quoted speech is present.
        exaggeration_offset += 0.04
        temperature_offset += 0.02

    if list_cues:
        # Lists read clearer with slightly tighter inter-chunk gaps.
        pause_multiplier *= 0.9
        cfg_weight_offset += 0.03

    happy_hits = sum(1 for tok in tokens if tok in HAPPY_WORDS)
    sad_hits = sum(1 for tok in tokens if tok in SAD_WORDS)
    if happy_hits > sad_hits:
        # Happy: higher energy (more exaggeration, looser cfg lets it move),
        # a touch brighter/less monotone (temperature up slightly), a
        # smaller pitch lift than the "high pitch" per-voice knob elsewhere
        # (real per-chunk risk from librosa.effects.pitch_shift's phase-
        # vocoder artifacts scales with magnitude - see PITCH_SEMITONES_BY_
        # VOICE history - so this stays deliberately modest), and shorter
        # pauses so the pacing itself feels quicker without touching the
        # word-rate DSP (apply_speed) that's caused real distortion
        # complaints twice already this project (see SPEED_BY_VOICE
        # history) - pause length is a genuinely safe lever for "faster
        # pace," actual time-stretching is not.
        intensity = min(1.0, 0.3 * (happy_hits - sad_hits))
        exaggeration_offset += 0.15 * intensity
        cfg_weight_offset -= 0.08 * intensity
        temperature_offset += 0.05 * intensity
        pitch_offset_semitones = 1.2 * intensity
        pause_multiplier *= 1.0 - 0.15 * intensity
    elif sad_hits > happy_hits:
        # Sad: lower energy, steadier/tighter cfg and lower temperature for
        # a measured, introspective (not erratic) read, a small downward
        # pitch nudge, and longer pauses for a slower, weightier feel -
        # same pause-not-speed reasoning as above.
        intensity = min(1.0, 0.3 * (sad_hits - happy_hits))
        exaggeration_offset -= 0.15 * intensity
        cfg_weight_offset += 0.10 * intensity
        temperature_offset -= 0.06 * intensity
        pitch_offset_semitones = -1.0 * intensity
        pause_multiplier *= 1.0 + 0.25 * intensity

    pause_multiplier = _clamp(pause_multiplier, *PAUSE_MULTIPLIER_RANGE)
    return {
        "exaggeration_offset": exaggeration_offset,
        "cfg_weight_offset": cfg_weight_offset,
        "temperature_offset": temperature_offset,
        "pause_multiplier": pause_multiplier,
        "pitch_offset_semitones": pitch_offset_semitones,
    }


def resolve_gen_params(
    text: str,
    voice_id: str | None = None,
    exaggeration: float | None = None,
    cfg_weight: float | None = None,
    temperature: float | None = None,
) -> tuple[dict, float, float]:
    """Merge DEFAULT -> per-voice -> plan_delivery offsets -> request overrides.

    Returns (gen_params, pause_multiplier, pitch_offset_semitones). Explicit
    exaggeration/cfg/temperature from the client win when provided; speed is
    handled separately by callers. Called per-chunk by synthesize() (not
    once for a whole request) so happy/sad valence and pacing can genuinely
    vary within one piece of text.
    """
    plan = plan_delivery(text, voice_id)
    params = {
        **DEFAULT_GEN_PARAMS,
        **(GEN_PARAMS_BY_VOICE.get(voice_id, {}) if voice_id else {}),
    }
    params["exaggeration"] = _clamp(
        float(params["exaggeration"]) + plan["exaggeration_offset"],
        *EXAGGERATION_RANGE,
    )
    params["cfg_weight"] = _clamp(
        float(params["cfg_weight"]) + plan["cfg_weight_offset"],
        *CFG_WEIGHT_RANGE,
    )
    params["temperature"] = _clamp(
        float(params["temperature"]) + plan["temperature_offset"],
        *TEMPERATURE_RANGE,
    )
    if exaggeration is not None:
        params["exaggeration"] = float(exaggeration)
    if cfg_weight is not None:
        params["cfg_weight"] = float(cfg_weight)
    if temperature is not None:
        params["temperature"] = float(temperature)
    return params, plan["pause_multiplier"], plan["pitch_offset_semitones"]


# Generating one isolated sentence per model call (the original design) is
# exactly why multi-sentence text sounds rushed/disconnected/emotionless -
# each sentence gets zero context about what came before or after it, so
# there's no cross-sentence prosody: no building emphasis, no continuity of
# pacing, nothing. Grouping consecutive sentences into one generation call
# lets the model produce real continuous delivery within a chunk. Kept
# conservative (not "the whole paragraph in one call") because longer single
# generations are more prone to Chatterbox's alignment-stream forced-EOS
# bug (see generate_sentence_with_retry) - this is a real tradeoff, not a
# free win, so MAX_CHUNK_WORDS deliberately stays well under where that
# instability was observed to get worse.
MAX_CHUNK_WORDS = 40

# Was {"voice_meditation": 14, "voice_sales": 14} - both were mitigations
# for too little training data to sustain a long continuous generation
# (reproduced live 2026-09-08/09: 24-30 word chunks for voice_meditation hit
# Chatterbox's alignment-stream forced-EOS bug on nearly every attempt,
# exhausting all 4 retries and shipping a near-silent clip).
#
# 2026-09-09 retrain expanded voice_sales to ~665 clips/~53min (now exceeds
# the well-trained-voice benchmark) - tested raising to the shared 40-word
# default post-retrain with a real ~60-word generation: fixed, ~10s of
# audio, no truncation. Removed from this dict entirely (uses the 40-word
# default). voice_meditation was never fixed the same way (a ~50-word
# generation still produced a 0.64s near-silent clip after her retrain too)
# but that voice (Michelle) was removed from the roster entirely 2026-09-10
# per direct user feedback, so the entry moot either way. Empty for now -
# every remaining voice uses the shared MAX_CHUNK_WORDS default.
MAX_CHUNK_WORDS_BY_VOICE: dict[str, int] = {}


def split_long_sentence(sentence: str, max_words: int) -> list[str]:
    """A single sentence longer than max_words used to get emitted as one
    chunk regardless of the cap (see chunk_sentences) - harmless for voices
    whose cap comfortably exceeds a normal sentence length, but for voices
    with a low cap (Michelle/Robbo, 14 words - shorter than plenty of
    ordinary sentences) it silently defeated the cap entirely. Reproduced
    live 2026-09-09: a 24-word sentence for voice_meditation was generated
    as one chunk despite her 14-word cap, and failed retries almost every
    time. Splits at clause boundaries (commas/semicolons) first, greedily
    grouping clauses up to max_words - falls back to a hard word-count
    split only if a single clause alone still exceeds max_words.
    """
    clauses = re.split(r"(?<=[,;])\s+", sentence.strip())
    pieces: list[str] = []
    current: list[str] = []
    current_words = 0
    for clause in clauses:
        clause_words = len(clause.split())
        if clause_words > max_words:
            if current:
                pieces.append(" ".join(current))
                current, current_words = [], 0
            words = clause.split()
            for i in range(0, len(words), max_words):
                pieces.append(" ".join(words[i : i + max_words]))
            continue
        if current and current_words + clause_words > max_words:
            pieces.append(" ".join(current))
            current, current_words = [], 0
        current.append(clause)
        current_words += clause_words
    if current:
        pieces.append(" ".join(current))
    return pieces


def chunk_sentences(sentences: list[str], max_words: int = MAX_CHUNK_WORDS) -> list[tuple[str, str]]:
    """Group sentences into generation chunks.

    Returns list of (chunk_text, last_sentence) so pause / terminal-fall
    selection can use the *last* sentence's ending even when several
    sentences were generated together.
    """
    chunks: list[tuple[str, str]] = []
    current: list[str] = []
    current_words = 0
    for sentence in sentences:
        word_count = len(sentence.split())
        if word_count > max_words:
            if current:
                chunks.append((" ".join(current), current[-1]))
                current, current_words = [], 0
            for piece in split_long_sentence(sentence, max_words):
                chunks.append((piece, piece))
            continue
        if current and current_words + word_count > max_words:
            chunks.append((" ".join(current), current[-1]))
            current = []
            current_words = 0
        current.append(sentence)
        current_words += word_count
    if current:
        chunks.append((" ".join(current), current[-1]))
    return chunks


def apply_highpass(audio: np.ndarray, sr: int, cutoff_hz: float) -> np.ndarray:
    sos = butter(4, cutoff_hz, btype="highpass", fs=sr, output="sos")
    return sosfilt(sos, audio).astype(np.float32)


def apply_notch(audio: np.ndarray, sr: int, center_hz: float, bandwidth_hz: float) -> np.ndarray:
    """A real, different DSP mechanism from pitch-shift/highpass - a mild
    bandstop around the nasal resonance region (~800Hz-1.2kHz is typical),
    the standard EQ move for a "nasal" complaint, as opposed to lowering the
    whole register (pitch-shift) or cutting only sub-vocal rumble
    (highpass). Requested for Katie 2026-09-10, whose two *other* tuning
    attempts (a pitch shift, then a highpass - see those constants' history
    above) were both reverted as not working - this is a genuinely
    different technique, not a third guess at the same one."""
    low = max(20.0, center_hz - bandwidth_hz / 2)
    high = min(sr / 2 - 100, center_hz + bandwidth_hz / 2)
    sos = butter(2, [low, high], btype="bandstop", fs=sr, output="sos")
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
        # peak_idx == last_idx means the pitch is STILL climbing on the very
        # last voiced frame - it never actually turns over within the tail
        # window at all. Reproduced live 2026-09-10 (Katie/voice_broadcast:
        # a monotonic 177Hz -> 487Hz climb across the whole 450ms tail,
        # "doesn't inflect downward at the end"). The old bail-out treated
        # "no room after the peak" as "already resolved," but here there's
        # no room *because the recording cuts off mid-rise* - the worst
        # case this function exists to fix, not a case to skip. Anchor from
        # the first voiced frame instead so there's a real span to force
        # down; min() below still protects any genuinely-already-falling
        # tail elsewhere, so this only engages when the whole tail rises.
        peak_idx = voiced_idx[0]
        if last_idx <= peak_idx:
            return audio  # only one voiced frame in range - truly nothing to reshape

    peak_semitone = 69.0 + 12.0 * np.log2(f0[peak_idx] / 440.0)
    target_f0 = f0.copy()
    span = last_idx - peak_idx
    for i in range(peak_idx, last_idx + 1):
        if f0[i] <= 0:
            continue
        frac = (i - peak_idx) / span
        target_semitone = peak_semitone - TERMINAL_FALL_SEMITONES * frac
        # min(), not a flat overwrite - reproduced live 2026-09-10 ("it went
        # up in this demo") on a take whose natural fall from the peak
        # already dropped ~24 semitones (356Hz -> a genuine low creaky-voice
        # ~77Hz at the very end, real vocal fry, not a pyworld tracking
        # glitch - checked by re-running pw.harvest on the full utterance,
        # not just the isolated tail, same result). The old code
        # unconditionally overwrote every frame with the forced curve, which
        # only ever falls TERMINAL_FALL_SEMITONES (5) below the peak - on a
        # tail that had already fallen much further than that naturally,
        # this *raised* the ending back up to the shallower forced target,
        # clobbering an already-good deep fall with a shallower, relatively
        # higher-sounding one. Taking whichever is lower means this only
        # ever pulls a flat/rising ending down (the actual bug it exists to
        # fix) and leaves an already-adequate natural fall alone.
        natural_semitone = 69.0 + 12.0 * np.log2(f0[i] / 440.0)
        target_f0[i] = 440.0 * (2.0 ** ((min(natural_semitone, target_semitone) - 69.0) / 12.0))

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


TERMINAL_RISE_SEMITONES = 4.0  # smaller than the 5.0 fall - a question should lift, not sound cartoonish


def apply_terminal_rise(audio: np.ndarray, sr: int, sentence: str) -> np.ndarray:
    """The mirror of apply_terminal_fall() above, for questions - added
    2026-09-10 ("questions in a high tone"). apply_terminal_fall() already
    skipped forcing anything on questions so a natural rise wouldn't get
    flattened, but "don't suppress a rise" and "actively ensure one" are
    different guarantees - this makes the rise a real, engineered part of
    every question's ending instead of hoping the model supplies it.
    Deliberately reuses apply_terminal_fall's exact anchor/reshape/crossfade
    approach (trough instead of peak, max() instead of min(), rise instead
    of fall) rather than a fresh design, since that function's two prior
    broken attempts (see its docstring) already paid down the real bugs in
    this class of edit - no reason to risk hitting them again from scratch.
    """
    stripped = sentence.rstrip()
    if not stripped or stripped[-1] != "?":
        return audio
    tail_len = int(sr * TERMINAL_FALL_TAIL_MS / 1000)
    if len(audio) < tail_len * 2:
        return audio

    head, tail = audio[:-tail_len], audio[-tail_len:]
    tail64 = np.ascontiguousarray(tail.astype(np.float64))
    try:
        f0, t = pw.harvest(tail64, sr)
        sp = pw.cheaptrick(tail64, f0, t, sr)
        ap = pw.d4c(tail64, f0, t, sr)
    except Exception:
        return audio

    voiced_idx = np.where(f0 > 0)[0]
    if len(voiced_idx) < 2:
        return audio

    trough_idx = voiced_idx[np.argmin(f0[voiced_idx])]
    last_idx = voiced_idx[-1]
    if last_idx <= trough_idx:
        # Mirrors apply_terminal_fall's "still moving on the last voiced
        # frame" case: if the tail is still falling right to the end, the
        # trough IS the last frame - anchor from the first voiced frame
        # instead so there's a real span left to force upward.
        trough_idx = voiced_idx[0]
        if last_idx <= trough_idx:
            return audio

    trough_semitone = 69.0 + 12.0 * np.log2(f0[trough_idx] / 440.0)
    target_f0 = f0.copy()
    span = last_idx - trough_idx
    for i in range(trough_idx, last_idx + 1):
        if f0[i] <= 0:
            continue
        frac = (i - trough_idx) / span
        target_semitone = trough_semitone + TERMINAL_RISE_SEMITONES * frac
        natural_semitone = 69.0 + 12.0 * np.log2(f0[i] / 440.0)
        # max(), not min() (the fall's choice) - only ever pulls a flat or
        # falling ending UP; leaves an already-adequate natural rise alone.
        target_f0[i] = 440.0 * (2.0 ** ((max(natural_semitone, target_semitone) - 69.0) / 12.0))

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


def apply_pitch_shift_clean(audio: np.ndarray, sr: int, semitones: float) -> np.ndarray:
    """Static per-voice pitch shift via pyworld's harvest/cheaptrick/d4c/
    synthesize - the same real parametric-vocoder approach apply_pitch_jitter
    and apply_terminal_fall/rise already use, instead of
    librosa.effects.pitch_shift's STFT phase vocoder.

    Real bug fixed here: a small +0.3 semitone PITCH_SEMITONES_BY_VOICE pass
    (2026-09-11) used librosa's phase vocoder and was reported live as
    sounding echoey/underwater on every voice - a textbook phase-vocoder
    "phasiness" artifact (smeared, reverberant-sounding output from naive
    STFT-domain pitch-shifting), not something that needed a smaller shift,
    a different algorithm entirely. pyworld separates F0/spectral envelope/
    aperiodicity and only moves F0 before resynthesizing, so the spectral
    envelope (what actually carries timbre/formants) is untouched - the
    same reason this project already switched to pyworld for jitter/
    terminal-fall/rise instead of naive DSP. Only the F0 curve moves;
    silence/unvoiced frames (f0 <= 0) are left alone.
    """
    if not semitones:
        return audio
    audio64 = np.ascontiguousarray(audio.astype(np.float64))
    try:
        f0, t = pw.harvest(audio64, sr)
        sp = pw.cheaptrick(audio64, f0, t, sr)
        ap = pw.d4c(audio64, f0, t, sr)
    except Exception:
        return audio

    if (f0 > 0).sum() < 2:
        return audio

    new_f0 = np.where(f0 > 0, f0 * (2.0 ** (semitones / 12.0)), f0)
    reshaped = pw.synthesize(new_f0, sp, ap, sr).astype(np.float32)
    if len(reshaped) < len(audio):
        reshaped = np.pad(reshaped, (0, len(audio) - len(reshaped)), mode="edge")
    elif len(reshaped) > len(audio):
        reshaped = reshaped[: len(audio)]
    return reshaped


# Words carrying real emotional/semantic weight - when one of these appears,
# give it a subtle localized pitch+volume lift instead of leaving every word
# at identical prosody. Requested live 2026-09-10: "when it's emotions like
# love, he should stress a little, very subtly on that word as humans do...
# understanding the meaning of the sentence and highlighting accordingly."
# Lexicon-based, same honest tradeoff plan_delivery() already makes for
# whole-utterance offsets ("surface cues only... not fake happy/sad emotion
# classes") - real semantic understanding would need an actual NLP call,
# this is a heuristic word list, not true comprehension.
EMPHASIS_WORDS = {
    "love", "loves", "loved", "loving", "adore", "adores", "cherish", "cherishes",
    "passion", "passionate", "amazing", "incredible", "wonderful", "beautiful",
    "gorgeous", "fantastic", "excited", "exciting", "thrilled", "delighted",
    "joy", "joyful", "happy", "happiest", "hate", "hates", "afraid", "scared",
    "terrified", "fear", "worried", "anxious", "sad", "devastated", "heartbroken",
    "furious", "angry", "frustrated", "best", "worst", "favorite", "favourite",
    "dream", "dreams", "hope", "hopes", "proud", "grateful", "inspiring", "inspired",
}
EMPHASIS_PITCH_SEMITONES = 1.0  # small - a whole-utterance offset like plan_delivery() uses is <=0.15; a single word can carry a bit more without reading as fake
EMPHASIS_GAIN = 1.15  # +15% amplitude on the emphasized word only
EMPHASIS_CROSSFADE_MS = 15.0
EMPHASIS_MIN_WORD_SECONDS = 0.05  # skip words too short for a pyworld reshape to be reliable

# Possessive pronouns - "my girls", "my family", "my dog" - carry a sense of
# ownership/personal stake, requested live 2026-09-10 ("should be a little
# emphasised"). Deliberately a SEPARATE, much lighter lift than
# EMPHASIS_WORDS above rather than folding "my"/"our" into that lexicon at
# the same strength: "my"/"our" appear far more often per sentence than
# "love" or "amazing" ever would, so the same 1.0-semitone/+15% treatment on
# every occurrence would read as a tic, not "a little." Half the pitch lift,
# a third of the gain boost.
POSSESSIVE_EMPHASIS_WORDS = {"my", "our", "mine", "ours"}
POSSESSIVE_EMPHASIS_PITCH_SEMITONES = 0.5
POSSESSIVE_EMPHASIS_GAIN = 1.05


def apply_word_emphasis(audio: np.ndarray, sr: int, whisper_words: list) -> np.ndarray:
    """Reshapes just the emphasized word(s)' own time span - pitch +
    amplitude only, no duration/time-stretch (that's exactly what
    SPEED_BY_VOICE tried elsewhere and reverted for sounding "like a
    robot" - a real, hard-learned lesson, not a style choice). Uses the
    per-word timestamps Whisper already produced for the retry-validation
    transcription (word_timestamps=True), so this costs no extra inference.
    whisper_words: list of objects/tuples with .word/.start/.end (or
    (word, start, end) tuples) in seconds, relative to `audio`.
    """
    if not whisper_words:
        return audio
    result = audio.copy()
    for w in whisper_words:
        word_text, start_s, end_s = (w.word, w.start, w.end) if hasattr(w, "word") else w
        cleaned = word_text.lower().strip(string.punctuation + " ")
        if cleaned in EMPHASIS_WORDS:
            pitch_lift, gain = EMPHASIS_PITCH_SEMITONES, EMPHASIS_GAIN
        elif cleaned in POSSESSIVE_EMPHASIS_WORDS:
            pitch_lift, gain = POSSESSIVE_EMPHASIS_PITCH_SEMITONES, POSSESSIVE_EMPHASIS_GAIN
        else:
            continue
        start_sample = max(0, int(start_s * sr))
        end_sample = min(len(result), int(end_s * sr))
        if end_sample - start_sample < int(sr * EMPHASIS_MIN_WORD_SECONDS):
            continue
        segment = result[start_sample:end_sample]
        seg64 = np.ascontiguousarray(segment.astype(np.float64))
        try:
            f0, t = pw.harvest(seg64, sr)
            sp = pw.cheaptrick(seg64, f0, t, sr)
            ap = pw.d4c(seg64, f0, t, sr)
        except Exception:
            continue
        if (f0 > 0).sum() < 2:
            continue

        new_f0 = f0.copy()
        for i in range(len(f0)):
            if f0[i] <= 0:
                continue
            semitone = 69.0 + 12.0 * np.log2(f0[i] / 440.0) + pitch_lift
            new_f0[i] = 440.0 * (2.0 ** ((semitone - 69.0) / 12.0))

        reshaped = pw.synthesize(new_f0, sp, ap, sr).astype(np.float32)
        if len(reshaped) < len(segment):
            reshaped = np.pad(reshaped, (0, len(segment) - len(reshaped)), mode="edge")
        elif len(reshaped) > len(segment):
            reshaped = reshaped[: len(segment)]
        reshaped = reshaped * gain

        fade_len = min(int(sr * EMPHASIS_CROSSFADE_MS / 1000), len(segment) // 4)
        if fade_len > 0:
            fade_in = np.linspace(0.0, 1.0, fade_len, dtype=np.float32)
            fade_out = np.linspace(1.0, 0.0, fade_len, dtype=np.float32)
            segment_f32 = segment.astype(np.float32)
            reshaped[:fade_len] = segment_f32[:fade_len] * (1 - fade_in) + reshaped[:fade_len] * fade_in
            reshaped[-fade_len:] = segment_f32[-fade_len:] * (1 - fade_out) + reshaped[-fade_len:] * fade_out
        result[start_sample:end_sample] = reshaped
    return result


# Was 4. Raised same day ends_abruptly() was added (2026-09-10) - the retry
# loop now has 4 independent rejection reasons (duration, cutoff, overlap,
# filler) instead of 2, which measurably raised how often ALL attempts get
# exhausted before landing on a clean take: reproduced live twice in one
# batch of 9 test generations right after adding the cutoff check (Brad,
# then Patrick), both confirmed to be exhaustion bad luck rather than a
# deterministic failure - an isolated single re-run of each succeeded on
# its first attempt. More attempts meaningfully lowers the chance every one
# of them fails at once (independent Bernoulli trials), at the cost of more
# GPU seconds on the relatively rare case that needs them.
MAX_GENERATION_ATTEMPTS = 6
# Was 0.7. Multi-sentence chunking (grouping several sentences into one
# generation call for cross-sentence prosody, see chunk_sentences) means a
# generation can drop one *entire* sentence out of several and still clear
# a lenient overlap bar - e.g. losing a 12-word middle sentence out of a
# 40-word chunk only drops overlap to ~70%, exactly at the old threshold.
# Reported live 2026-09-10 as "skipped most of the words" (Megan), "skipped
# a whole sentence in the middle" (Katie), and "skipped some words"
# (Brad/Mark) - all the same failure mode, just at different severities.
# Raised to catch a dropped sentence/clause reliably. Trade-off, stated
# plainly: this means more retries (and more GPU seconds) on borderline
# generations, compounding the separate "Modal is slow" complaint - the
# real fix for the underlying instability is still more training data or a
# better base model, not a stricter proxy metric, but this is the honest
# lever available today without retraining.
MIN_WORD_OVERLAP_RATIO = 0.85  # below this, treat as a bad generation (words skipped/mangled) and retry

# Filler words Chatterbox has been observed to prepend that weren't in the
# input at all - reported live 2026-09-10 as "Alice is saying 'so' for no
# reason." Whisper transcribes it same as any other word, so it doesn't fail
# the overlap check above (overlap only measures *missing* input words, not
# *extra* output ones) - a single inserted "so" among 20 real words barely
# moves that ratio. Rather than trying to surgically cut audio (fragile -
# no reliable word-level timestamps here), treat a leading filler that
# isn't how the input actually starts as a bad take and retry, the same
# stochastic-retry approach already proven to work for missing/mangled
# words below.
LEADING_FILLER_WORDS = {"so", "um", "uh", "well", "okay", "ok", "like", "and", "now", "right"}


def _normalize_words(text: str) -> set[str]:
    stripped = text.lower().translate(str.maketrans("", "", string.punctuation))
    return set(stripped.split())


def word_overlap_ratio(input_text: str, transcribed_text: str) -> float:
    input_words = _normalize_words(input_text)
    if not input_words:
        return 1.0
    output_words = _normalize_words(transcribed_text)
    return len(input_words & output_words) / len(input_words)


def has_spurious_leading_filler(input_text: str, transcribed_text: str) -> bool:
    input_words = input_text.strip().split()
    transcribed_words = transcribed_text.strip().split()
    if not input_words or not transcribed_words:
        return False
    said_first = transcribed_words[0].lower().strip(string.punctuation)
    if said_first not in LEADING_FILLER_WORDS:
        return False
    wrote_first = input_words[0].lower().strip(string.punctuation)
    return said_first != wrote_first


# Reported live 2026-09-10 as several voices (Megan, Patrick, others) "get
# cut off in their last words - they don't end sentences cleanly." Neither
# existing check catches this: duration/overlap both look at the whole
# clip, and Whisper often still guesses a word correctly from a partially-
# clipped tail, so a chopped-off final consonant can pass both. Root-caused
# against a real reported clip (Megan) by looking at the raw RMS envelope:
# a clean ending decays well before the clip stops (measured on 5 known-good
# clips: final-100ms RMS was 1-12% of the preceding 200ms) while the bad
# clip was still at 115% (i.e. not decaying at all, cut off mid-word) - see
# STATUS.md for the full comparison table across all 9 voices.
CUTOFF_MIN_ABS_RMS = 0.01  # ignore already-near-silent tails - a tiny/near-zero ratio there is meaningless noise, not a cutoff signal
# Was 0.55, calibrated against only 2 known-bad + a few known-good clips.
# Loosened to 0.65 same day after the stricter value, combined with the 3
# other existing rejection reasons, measurably raised how often every retry
# attempt failed at once (see MAX_GENERATION_ATTEMPTS comment) - some of
# that was almost certainly this check false-positiving on legitimately
# fine (just quieter, not silent) endings. Still comfortably separates the
# two real confirmed-bad clips (0.80, 1.15) from the confirmed-good ones
# (0.01-0.13) measured 2026-09-10 - see STATUS.md for the full table.
CUTOFF_RATIO_THRESHOLD = 0.65


def ends_abruptly(audio: np.ndarray, sr: int) -> bool:
    if len(audio) < int(sr * 0.3):
        return False  # too short to have a meaningful "preceding 200ms"
    final = audio[-int(sr * 0.1):]
    preceding = audio[-int(sr * 0.3): -int(sr * 0.1)]
    final_rms = float(np.sqrt(np.mean(final.astype(np.float64) ** 2)))
    if final_rms < CUTOFF_MIN_ABS_RMS:
        return False  # already quiet/silent by the end - a real, clean ending
    preceding_rms = float(np.sqrt(np.mean(preceding.astype(np.float64) ** 2)))
    if preceding_rms <= 0:
        return False
    return (final_rms / preceding_rms) >= CUTOFF_RATIO_THRESHOLD


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
    # Was "ship whichever attempt happened to run last" when every attempt
    # fails - harmless when there were only 2-3 rejection reasons, but
    # adding ends_abruptly() as a 4th one (on top of duration/overlap/
    # filler) makes exhausting all MAX_GENERATION_ATTEMPTS attempts more
    # likely for ANY voice, and "last" can easily be the single worst take
    # (e.g. a near-silent 0.1s clip) rather than the closest-to-passing one.
    # Reproduced live 2026-09-10 (Brad/voice_tech shipped 0.1s of near-
    # silence after all 4 attempts failed in a batch run - a re-run in
    # isolation succeeded fine on the first try, confirming this was
    # exhaustion bad luck, not a deterministic bug for that text). Now
    # tracks the best-scoring attempt seen and ships that instead.
    best_trimmed = np.array([], dtype=np.float32)
    best_score = -1.0
    best_words: list = []

    for attempt in range(MAX_GENERATION_ATTEMPTS):
        wav_tensor = engine.generate(text=sentence, audio_prompt_path=reference_path, **kwargs)
        if isinstance(wav_tensor, tuple):
            wav_tensor = wav_tensor[0]
        wav_np = wav_tensor.squeeze().cpu().numpy()
        trimmed = trim_silence_with_vad(wav_np, engine.sr)
        duration = len(trimmed) / engine.sr

        if duration < min_expected_seconds:
            print(f"[engine] short generation ({duration:.2f}s for {word_count} words), retrying ({attempt + 1}/{MAX_GENERATION_ATTEMPTS})...")
            # Real bug fixed here: this docstring says the exhaustion
            # fallback "tracks the best-scoring attempt seen" (added after
            # a near-silent 0.1s clip shipped from a *worse* later attempt
            # - see the comment above), but every short attempt was scored
            # a flat 0.0, and `best_score < 0.0` is only ever true once (the
            # very first update) - so the FIRST short attempt always won,
            # not the longest/least-bad one, exactly the bug this was
            # supposed to fix. Score by how close to passing the duration
            # actually was instead, capped below the ends_abruptly tier's
            # 0.2 so a real-content-but-cut-off take is still always
            # preferred over any too-short one, same tier ordering as before.
            if duration > 0:
                duration_score = min(0.19, (duration / min_expected_seconds) * 0.19)
                if duration_score > best_score:
                    best_trimmed, best_score, best_words = trimmed, duration_score, []
            continue

        if ends_abruptly(trimmed, engine.sr):
            print(f"[engine] audio cuts off abruptly (not decaying by the end), retrying ({attempt + 1}/{MAX_GENERATION_ATTEMPTS})...")
            if best_score < 0.2:
                best_trimmed, best_score, best_words = trimmed, 0.2, []
            continue

        # word_timestamps=True costs no extra inference pass - same
        # transcription already needed for the overlap/filler checks below
        # also gives per-word timing, reused for apply_word_emphasis().
        segments, _ = verifier_model.transcribe(trimmed, language="en", word_timestamps=True)
        segments = list(segments)
        transcribed_text = " ".join(seg.text for seg in segments)
        overlap = word_overlap_ratio(sentence, transcribed_text)
        whisper_words = [w for seg in segments for w in (seg.words or [])]
        if overlap < MIN_WORD_OVERLAP_RATIO:
            print(f"[engine] word mismatch (overlap {overlap:.0%}) - said \"{transcribed_text[:80]}\" for \"{sentence[:80]}\", retrying ({attempt + 1}/{MAX_GENERATION_ATTEMPTS})...")
            if overlap > best_score:
                best_trimmed, best_score, best_words = trimmed, overlap, whisper_words
            continue
        if has_spurious_leading_filler(sentence, transcribed_text):
            print(f"[engine] spurious leading filler - said \"{transcribed_text[:40]}\" for \"{sentence[:40]}\", retrying ({attempt + 1}/{MAX_GENERATION_ATTEMPTS})...")
            if overlap - 0.05 > best_score:
                best_trimmed, best_score, best_words = trimmed, overlap - 0.05, whisper_words
            continue
        return apply_word_emphasis(trimmed, engine.sr, whisper_words)

    if len(best_trimmed) == 0:
        # Real bug fixed here: every attempt came back completely
        # zero-length (not just short/mismatched) - there is no "closest-
        # to-passing" fallback to ship. The caller (synthesize) silently
        # dropped this chunk from the final output with no error and no
        # log line at all - a chunk of real text (up to ~40 words) missing
        # from a customer's finished audio with the job still reporting
        # COMPLETED. This can't be recovered here (nothing was generated to
        # ship), but it's now loudly logged so it's at least searchable/
        # alertable instead of invisible.
        print(f"[engine] CRITICAL: all {MAX_GENERATION_ATTEMPTS} attempts produced zero-length audio for chunk \"{sentence[:80]}\" - this chunk will be MISSING from the final output")
        return best_trimmed
    print(f"[engine] all {MAX_GENERATION_ATTEMPTS} attempts came back bad - shipping the closest-to-passing one rather than failing outright")
    return apply_word_emphasis(best_trimmed, engine.sr, best_words)


def synthesize(
    engine: ChatterboxTTS,
    text: str,
    reference_path: str,
    voice_id: str | None = None,
    exaggeration: float | None = None,
    cfg_weight: float | None = None,
    temperature: float | None = None,
    pitch_semitones: float = 0.0,
    highpass_hz: float = 0.0,
    notch_hz: float = 0.0,
    notch_bandwidth_hz: float = 400.0,
    pitch_jitter_semitones: float = 0.0,
    speed: float = 1.0,
    max_chunk_words: int = MAX_CHUNK_WORDS,
):
    """voice_id/exaggeration/cfg_weight/temperature are forwarded to
    resolve_gen_params() PER CHUNK below (added 2026-09-10 for happy/sad
    delivery - see plan_delivery) rather than resolved once by the caller
    for the whole request, so a paragraph's own happy/sad words, pacing, and
    pitch actually change chunk-to-chunk instead of being averaged across
    the entire input text."""
    all_chunks = []
    sr = 24000
    sentences = split_sentences(text)
    text_chunks = chunk_sentences(sentences, max_words=max_chunk_words)
    rng = np.random.default_rng()
    # Generate first, then insert pauses only between kept chunks so a failed
    # final attempt cannot leave trailing metronomic silence.
    generated: list[tuple[np.ndarray, str, float]] = []
    for chunk, last_sentence in text_chunks:
        gen_params, chunk_pause_mult, chunk_pitch_offset = resolve_gen_params(
            chunk, voice_id, exaggeration=exaggeration, cfg_weight=cfg_weight, temperature=temperature
        )
        trimmed = generate_sentence_with_retry(engine, chunk, reference_path, **gen_params)
        if len(trimmed) == 0:
            print(f"[engine] dropping empty chunk from final output: \"{chunk[:80]}\"")
        if len(trimmed) > 0:
            sr = engine.sr
            if chunk_pitch_offset:
                # This chunk's own happy/sad pitch nudge - separate from and
                # applied before the per-voice static pitch_semitones below.
                # Uses apply_pitch_shift_clean (pyworld), not librosa's phase
                # vocoder - see that function's docstring for the real
                # echo/underwater artifact this switch fixes.
                trimmed = apply_pitch_shift_clean(trimmed, sr, chunk_pitch_offset)
            # Terminal fall/rise keyed off the *last* sentence ending in this
            # chunk - statements get the forced fall, questions get a real
            # forced rise (added 2026-09-10) instead of just an unforced one.
            trimmed = apply_terminal_fall(trimmed, sr, last_sentence)
            trimmed = apply_terminal_rise(trimmed, sr, last_sentence)
            generated.append((trimmed, last_sentence, chunk_pause_mult))
    for i, (trimmed, last_sentence, chunk_pause_mult) in enumerate(generated):
        all_chunks.append(trimmed)
        if i < len(generated) - 1:
            base_pause = pause_seconds_for(last_sentence)
            pause_mult = _clamp(chunk_pause_mult, *PAUSE_MULTIPLIER_RANGE)
            # subtle randomization instead of an identical, metronomic gap
            # every time - real pause length between phrases isn't perfectly
            # uniform even from the same speaker
            jittered_pause = max(0.08, base_pause * pause_mult * rng.uniform(0.8, 1.25))
            all_chunks.append(np.zeros(int(sr * jittered_pause), dtype=np.float32))
    if not all_chunks:
        return None, None
    audio = np.concatenate(all_chunks)
    if pitch_jitter_semitones:
        audio = apply_pitch_jitter(audio, sr, pitch_jitter_semitones)
    if pitch_semitones:
        audio = apply_pitch_shift_clean(audio, sr, pitch_semitones)
    if highpass_hz:
        audio = apply_highpass(audio, sr, highpass_hz)
    if notch_hz:
        audio = apply_notch(audio, sr, notch_hz, notch_bandwidth_hz)
    if speed and speed != 1.0:
        audio = apply_speed(audio, speed)
    return audio, sr


class UnknownVoiceError(ValueError):
    pass


class ReferenceAudioTooShortError(ValueError):
    def __init__(self, duration: float):
        self.duration = duration
        super().__init__(f"reference audio too short ({duration:.1f}s) — need at least {MIN_UPLOAD_SECONDS}s")


class UnsupportedReferenceAudioError(ValueError):
    def __init__(self):
        super().__init__("couldn't read that recording — please try again or upload a file instead")


def _write_reference_wav(reference_audio_bytes: bytes, tmp_dir: Path) -> Path:
    """A real uploaded .wav file always worked here, but a browser/app mic
    recording never actually did: MediaRecorder produces WebM/Opus (web) and
    expo-audio produces M4A/AAC (mobile) - neither is a WAV container, yet
    the bytes were written straight to a ".wav"-suffixed file and handed to
    soundfile (libsndfile), which only decodes WAV/AIFF/FLAC/OGG-Vorbis.
    Reproduced live 2026-09-10 from a real browser recording:
    "Error opening '/tmp/....wav': Format not recognised." ffmpeg is already
    in the deploy image (see modal_app.py's apt_install, added for a
    different dependency but happens to cover this) and decodes effectively
    any container/codec, so transcode whenever the bytes aren't already a
    RIFF/WAVE file instead of assuming the client always sends real WAV.
    """
    wav_path = tmp_dir / "reference.wav"
    if reference_audio_bytes[:4] == b"RIFF" and reference_audio_bytes[8:12] == b"WAVE":
        wav_path.write_bytes(reference_audio_bytes)
        return wav_path

    src_path = tmp_dir / "reference.src"
    src_path.write_bytes(reference_audio_bytes)
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", str(src_path), "-ar", "24000", "-ac", "1", str(wav_path)],
        capture_output=True,
    )
    # Real gap fixed here: ffmpeg can exit 0 while writing a near-empty/
    # corrupt WAV (an unsupported or garbled codec it silently no-ops on) -
    # checking only wav_path.exists() let that through as a "successful"
    # transcode, only to blow up later as an unhandled soundfile/libsndfile
    # exception (not one of the friendly error types callers catch for),
    # surfacing a raw internal error to the customer instead of "couldn't
    # read that recording." 44 bytes is a real WAV header's minimum size
    # with zero audio frames - anything at or below that is empty in
    # practice, not a real recording.
    if result.returncode != 0 or not wav_path.exists() or wav_path.stat().st_size <= 44:
        raise UnsupportedReferenceAudioError()
    return wav_path


def generate_preset(
    text: str,
    voice_id: str,
    exaggeration: float | None = None,
    cfg_weight: float | None = None,
    pitch_semitones: float | None = None,
    speed: float | None = None,
) -> tuple[np.ndarray | None, int | None]:
    """Feature A: one of the named preset voices. Raises UnknownVoiceError
    for an unrecognized voice_id. Returns (audio, sr), or (None, None) if
    generation produced nothing at all (empty input text)."""
    if voice_id in ZERO_SHOT_PRESET_VOICES:
        # No LoRA adapter to swap onto - zero-shot preset (see
        # ZERO_SHOT_PRESET_VOICES comment), same base T3 generate_clone uses.
        base_engine.t3 = base_t3
        reference = ZERO_SHOT_PRESET_VOICES[voice_id]
    elif voice_id in PRESET_VOICES:
        base_engine.t3 = get_preset_t3(voice_id)  # swap onto the one shared engine (see load_finetuned_t3 note); loads on first use
        reference = PRESET_VOICES[voice_id]["reference"]
    else:
        raise UnknownVoiceError(f"unknown voice_id, expected one of {sorted(set(PRESET_VOICES) | set(ZERO_SHOT_PRESET_VOICES))}")
    pitch = pitch_semitones if pitch_semitones is not None else PITCH_SEMITONES_BY_VOICE.get(voice_id, 0.0)
    highpass = HIGHPASS_HZ_BY_VOICE.get(voice_id, 0.0)
    notch_hz = NOTCH_HZ_BY_VOICE.get(voice_id, 0.0)
    jitter = PITCH_JITTER_BY_VOICE.get(voice_id, 0.0)
    max_chunk_words = MAX_CHUNK_WORDS_BY_VOICE.get(voice_id, MAX_CHUNK_WORDS)
    # Multiplied with the client's speed (default 1.0 = "this voice's own
    # normal pace"), not replaced by it - see SPEED_BY_VOICE comment.
    effective_speed = SPEED_BY_VOICE.get(voice_id, 1.0) * (speed if speed is not None else 1.0)
    # DEFAULT -> per-voice -> plan_delivery offsets -> explicit overrides is
    # now resolved PER CHUNK inside synthesize() (see its docstring), not
    # here once for the whole text - voice_id/exaggeration/cfg_weight are
    # just forwarded through.
    return synthesize(
        base_engine,
        text,
        reference,
        voice_id=voice_id,
        exaggeration=exaggeration,
        cfg_weight=cfg_weight,
        pitch_semitones=pitch,
        highpass_hz=highpass,
        notch_hz=notch_hz,
        pitch_jitter_semitones=jitter,
        speed=effective_speed,
        max_chunk_words=max_chunk_words,
    )


def generate_clone(
    text: str,
    reference_audio_bytes: bytes,
    exaggeration: float | None = None,
    cfg_weight: float | None = None,
    speed: float | None = None,
) -> tuple[np.ndarray | None, int | None]:
    """Feature B: zero-shot clone from an uploaded reference clip. Raises
    ReferenceAudioTooShortError if the upload is under MIN_UPLOAD_SECONDS, or
    UnsupportedReferenceAudioError if the bytes can't be decoded at all (see
    _write_reference_wav - covers browser/app mic recordings, not just
    unrecognized file uploads).
    Returns (audio, sr), or (None, None) if generation produced nothing."""
    tmp_dir = Path(tempfile.mkdtemp())
    try:
        tmp_path = _write_reference_wav(reference_audio_bytes, tmp_dir)
        duration = sf.info(str(tmp_path)).duration
        if duration < MIN_UPLOAD_SECONDS:
            raise ReferenceAudioTooShortError(duration)

        base_engine.t3 = base_t3  # zero-shot Feature B always uses the unmodified base T3, not a preset's LoRA
        return synthesize(
            base_engine,
            text,
            str(tmp_path),
            voice_id=None,
            exaggeration=exaggeration,
            cfg_weight=cfg_weight,
            speed=speed if speed is not None else 1.0,
        )
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
