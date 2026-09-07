#!/usr/bin/env python3
"""
Phase 3: zero-shot Chatterbox sanity check.

Picks one reference clip per instructor (already chosen by hand from the
longest clean utterances) and generates a few test sentences in each voice,
with no fine-tuning. Validates voice-identity capture before any training
investment, and doubles as the first real (non-mock) test of the API's
generation path.

Usage:
    python3 scripts/04_zeroshot_test.py
"""
from pathlib import Path

import torch
import torchaudio
from chatterbox.tts import ChatterboxTTS

PROJECT_ROOT = Path(__file__).resolve().parent.parent
TRAINING_DATA = PROJECT_ROOT / "training_data"
OUT_DIR = PROJECT_ROOT / "zeroshot_test_output"

REFERENCE_CLIPS = {
    "art_instructor": TRAINING_DATA / "art_instructor" / "clips" / "00266.wav",
    "music_instructor": TRAINING_DATA / "music_instructor" / "clips" / "00042.wav",
}

TEST_SENTENCES = [
    "Hello, my name is Sloane, and I'm excited to help you create something today.",
    "Welcome back. Let's pick up right where we left off last time.",
]


def main() -> None:
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"device: {device}")
    model = ChatterboxTTS.from_pretrained(device=device)

    OUT_DIR.mkdir(exist_ok=True)
    for speaker, ref_path in REFERENCE_CLIPS.items():
        print(f"\n=== {speaker} (reference: {ref_path.name}) ===")
        for i, sentence in enumerate(TEST_SENTENCES, start=1):
            print(f"  generating [{i}]: {sentence[:60]}...")
            wav = model.generate(sentence, audio_prompt_path=str(ref_path))
            out_path = OUT_DIR / f"{speaker}_{i:02d}.wav"
            torchaudio.save(str(out_path), wav, model.sr)
            print(f"  -> {out_path.relative_to(PROJECT_ROOT)}")


if __name__ == "__main__":
    main()
