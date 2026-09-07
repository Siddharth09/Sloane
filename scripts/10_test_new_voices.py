#!/usr/bin/env python3
"""
Generate one test sentence per newly fine-tuned voice, using each voice's own
merged LoRA checkpoint - same loading pattern as
scripts/06_inference_server.py's load_finetuned_engine, just run once instead
of served as an API. Reference clip is the first clip listed in each voice's
(already speaker-filtered) metadata.csv.

Run on the pod:
    /workspace/sloane/.venv/bin/python scripts/10_test_new_voices.py
"""
import csv
import sys
from pathlib import Path

import torch
import torchaudio
from peft import PeftModel

sys.path.insert(0, "/workspace/sloane/chatterbox-ft-art")
from src.model import resize_and_load_t3_weights
from src.chatterbox_.tts import ChatterboxTTS
from src.chatterbox_.models.t3.t3 import T3

BASE_MODEL_DIR = "/workspace/sloane/chatterbox-finetuning/pretrained_models"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
NEW_VOCAB_SIZE = 2454

PROJECT_ROOT = Path("/workspace/sloane")
OUT_DIR = PROJECT_ROOT / "new_voices_test_output"

VOICES = ["voice_meditation", "voice_comedy"]
TEST_SENTENCE = "Hello, my name is Sloane, and I'm excited to help you create something today."


def first_clip(voice: str) -> Path:
    metadata_path = PROJECT_ROOT / "training_data" / voice / "metadata.csv"
    with open(metadata_path, encoding="utf-8") as f:
        first_line = f.readline()
    clip_name = first_line.split("|", 1)[0]
    return PROJECT_ROOT / "training_data" / voice / "clips" / clip_name


def load_finetuned_engine(adapter_dir: str) -> ChatterboxTTS:
    temp_engine = ChatterboxTTS.from_local(BASE_MODEL_DIR, device="cpu")
    pretrained_state = temp_engine.t3.state_dict()
    t3_config = temp_engine.t3.hp
    t3_config.text_tokens_dict_size = NEW_VOCAB_SIZE

    new_t3 = T3(hp=t3_config)
    new_t3 = resize_and_load_t3_weights(new_t3, pretrained_state)
    del temp_engine, pretrained_state

    engine = ChatterboxTTS.from_local(BASE_MODEL_DIR, device="cpu")
    engine.t3 = new_t3
    engine.t3 = PeftModel.from_pretrained(engine.t3, adapter_dir, is_trainable=False)
    engine.t3.to(DEVICE).eval()
    engine.s3gen.to(DEVICE).eval()
    engine.ve.to(DEVICE).eval()
    engine.device = DEVICE
    return engine


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    for voice in VOICES:
        adapter_dir = f"/workspace/sloane/chatterbox-ft-{voice}/chatterbox_output/new_lang_adapter"
        ref_path = first_clip(voice)
        print(f"\n=== {voice} (reference: {ref_path.name}) ===")
        engine = load_finetuned_engine(adapter_dir)
        wav = engine.generate(text=TEST_SENTENCE, audio_prompt_path=str(ref_path))
        if isinstance(wav, tuple):
            wav = wav[0]
        out_path = OUT_DIR / f"{voice}.wav"
        torchaudio.save(str(out_path), wav.cpu(), engine.sr)
        print(f"  -> {out_path}")
        del engine
        torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
