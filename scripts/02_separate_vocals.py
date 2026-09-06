#!/usr/bin/env python3
"""
Cloud-side step 1: isolate vocals from any background music/noise using Demucs.
Run this on the rented GPU pod (not locally) — torch + demucs are heavy installs.

Input:  raw_audio/<speaker>/*.wav   (uploaded from the local extraction step)
Output: clean_audio/<speaker>/*.wav (vocals-only stem, same sample rate)

Usage:
    python3 scripts/02_separate_vocals.py
"""
from pathlib import Path

import torchaudio
from demucs.pretrained import get_model
from demucs.apply import apply_model

PROJECT_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = PROJECT_ROOT / "raw_audio"
CLEAN_DIR = PROJECT_ROOT / "clean_audio"

MODEL_NAME = "htdemucs"  # general-purpose source separation model


def separate_file(model, device, in_path: Path, out_path: Path) -> None:
    wav, sr = torchaudio.load(str(in_path))
    if sr != model.samplerate:
        wav = torchaudio.functional.resample(wav, sr, model.samplerate)
        sr = model.samplerate
    if wav.shape[0] == 1:
        wav = wav.repeat(2, 1)  # demucs expects stereo
    wav = wav.to(device)

    sources = apply_model(model, wav[None], device=device, progress=True)[0]
    vocals = sources[model.sources.index("vocals")]
    vocals_mono = vocals.mean(dim=0, keepdim=True).cpu()

    out_path.parent.mkdir(parents=True, exist_ok=True)
    torchaudio.save(str(out_path), vocals_mono, sr)


def main() -> None:
    import torch

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"device: {device}")
    model = get_model(MODEL_NAME)
    model.eval()

    for speaker_dir in sorted(RAW_DIR.iterdir()):
        if not speaker_dir.is_dir():
            continue
        for wav_path in sorted(speaker_dir.glob("*.wav")):
            out_path = CLEAN_DIR / speaker_dir.name / wav_path.name
            if out_path.exists():
                print(f"skip (exists): {out_path}")
                continue
            print(f"separating: {wav_path.relative_to(PROJECT_ROOT)}")
            separate_file(model, device, wav_path, out_path)


if __name__ == "__main__":
    main()
