#!/usr/bin/env python3
"""
Cloud-side step 2: transcribe + cut clean vocal tracks into utterance-level clips.

Uses faster-whisper for transcription/segment timestamps, then slices each
segment out as its own clip. Filters out clips that are too short/long or look
like silence, and writes a filelist.csv (clip path, transcript, duration) that
feeds directly into RVC training or an OpenVoice/seed-vc reference set.

Input:  clean_audio/<speaker>/*.wav
Output: training_data/<speaker>/clips/*.wav + training_data/<speaker>/filelist.csv

Usage:
    python3 scripts/03_chunk_by_speech.py
"""
import csv
from pathlib import Path

import soundfile as sf
from faster_whisper import WhisperModel

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CLEAN_DIR = PROJECT_ROOT / "clean_audio"
OUT_DIR = PROJECT_ROOT / "training_data"

MIN_CLIP_SECONDS = 2.0
MAX_CLIP_SECONDS = 15.0
# Per-speaker override: slow, pause-heavy narration (e.g. guided meditation)
# gets VAD-merged into clips that hug MAX_CLIP_SECONDS and contain long
# internal silences, which destabilized that voice's training (see
# PROJECT_CONTEXT.md "Francois-Michelle generation instability"). A tighter
# ceiling for those speakers forces cleaner, silence-free clips.
MAX_CLIP_SECONDS_OVERRIDE = {
    "voice_meditation": 8.0,
}
PAD_SECONDS = 0.15  # small buffer so words aren't clipped at boundaries


def process_speaker(model: WhisperModel, speaker_dir: Path) -> None:
    speaker = speaker_dir.name
    max_clip_seconds = MAX_CLIP_SECONDS_OVERRIDE.get(speaker, MAX_CLIP_SECONDS)
    clips_dir = OUT_DIR / speaker / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)
    filelist_path = OUT_DIR / speaker / "filelist.csv"

    rows = []
    clip_idx = 0

    for wav_path in sorted(speaker_dir.glob("*.wav")):
        print(f"transcribing: {wav_path.name}")
        audio, sr = sf.read(str(wav_path))
        segments, _ = model.transcribe(str(wav_path), vad_filter=True)

        for seg in segments:
            duration = seg.end - seg.start
            if duration < MIN_CLIP_SECONDS or duration > max_clip_seconds:
                continue
            text = seg.text.strip()
            if not text:
                continue

            start_sample = max(0, int((seg.start - PAD_SECONDS) * sr))
            end_sample = min(len(audio), int((seg.end + PAD_SECONDS) * sr))
            clip = audio[start_sample:end_sample]

            clip_idx += 1
            clip_name = f"{clip_idx:05d}.wav"
            sf.write(str(clips_dir / clip_name), clip, sr)
            rows.append(
                {
                    "clip": f"clips/{clip_name}",
                    "text": text,
                    "duration_sec": round(duration, 2),
                    "source": wav_path.name,
                }
            )

    with open(filelist_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["clip", "text", "duration_sec", "source"])
        writer.writeheader()
        writer.writerows(rows)

    total_minutes = sum(r["duration_sec"] for r in rows) / 60
    print(f"{speaker}: {len(rows)} clips, {total_minutes:.1f} minutes total -> {filelist_path}")


def main() -> None:
    model = WhisperModel("small", device="cuda", compute_type="float16")
    for speaker_dir in sorted(CLEAN_DIR.iterdir()):
        if speaker_dir.is_dir():
            process_speaker(model, speaker_dir)


if __name__ == "__main__":
    main()
