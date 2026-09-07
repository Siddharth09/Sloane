#!/usr/bin/env python3
"""
Phase 6 prep: convert our filelist.csv (from 03_chunk_by_speech.py, i.e.
faster-whisper transcription) into the LJSpeech-style metadata.csv that
github.com/gokhaneraslan/chatterbox-finetuning expects.

Format: filename|raw_text|normalized_text, pipe-delimited, NO header line
(the toolkit's preprocess_ljspeech.py reads it with pandas header=None; an
included header row gets silently treated as a bogus, harmless data row —
better to just leave it out).

Usage (run on the pod, after 03_chunk_by_speech.py has produced
training_data/<speaker>/filelist.csv):
    python3 scripts/05_prepare_finetune_metadata.py
"""
import csv
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
TRAINING_DATA = PROJECT_ROOT / "training_data"
SPEAKERS = [
    "art_instructor",
    "music_instructor",
    "voice_business",
    "voice_comedy",
    "voice_finance",
    "voice_broadcast",
    "voice_tech",
    "voice_meditation",
    "voice_sales",
    "voice_mark",
]


def main() -> None:
    for speaker in SPEAKERS:
        src = TRAINING_DATA / speaker / "filelist.csv"
        out = TRAINING_DATA / speaker / "metadata.csv"
        rows = []
        with open(src, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                filename = Path(r["clip"]).name  # strip 'clips/' prefix
                text = r["text"].strip().replace("|", ",")
                if not text:
                    continue
                rows.append(f"{filename}|{text}|{text}")
        with open(out, "w", encoding="utf-8") as f:
            f.write("\n".join(rows) + "\n")
        print(f"{speaker}: wrote {len(rows)} rows -> {out}")


if __name__ == "__main__":
    main()
