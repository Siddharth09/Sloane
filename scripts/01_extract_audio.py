#!/usr/bin/env python3
"""
Extract raw audio tracks from selected masterclass videos, per speaker.
Runs locally (no GPU needed) using the ffmpeg binary bundled by imageio-ffmpeg.

Output: 48kHz mono 16-bit PCM WAV per source video, under raw_audio/<speaker>/.
These files are the input to the cloud-side cleanup pipeline (source separation,
transcription/chunking) in scripts/02 and 03.
"""
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ART_DIR = Path("/Users/siddharthmehta/Desktop/Astryks/Art/ART")
MUSIC_DIR = Path(
    "/Users/siddharthmehta/Desktop/Astryks/Music/Music production - Matt Landi/MUSIC REVISED"
)

# Curated per-speaker source lists: chosen for solo-instructor talking (no music
# overlays, no singing demos) to keep the extracted audio clean for voice training.
SOURCES = {
    "art_instructor": [
        ART_DIR / "ART (INSTRUCTOR INTRO).mp4",
        ART_DIR / "Anyone Can Paint.mp4",
        ART_DIR / "Tracing.mp4",
        ART_DIR / "What to paint - Anything around you! .mp4",
        ART_DIR / "Painting a parrot in watercolour .mp4",
    ],
    "music_instructor": [
        MUSIC_DIR / "1. Where to begin writing a song.  (REVISED).mp4",
        MUSIC_DIR
        / "2. Really listen to your favourite songs. The melody, the feeling, the story of a song. (REVISED).mp4",
        MUSIC_DIR / "3. JUST START (REVISED).mp4",
        MUSIC_DIR / "7. Finding the pitch. Let's look at Elvis.  (REVISED).mp4",
        MUSIC_DIR / "8. Find your note range (REVISED).mp4",
    ],
}


def extract(video_path: Path, out_path: Path, ffmpeg_exe: str) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg_exe,
        "-y",
        "-i",
        str(video_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-c:a",
        "pcm_s16le",
        str(out_path),
    ]
    print(f"  extracting -> {out_path.name}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stderr[-2000:], file=sys.stderr)
        raise RuntimeError(f"ffmpeg failed on {video_path}")


def main() -> None:
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    for speaker, videos in SOURCES.items():
        print(f"\n=== {speaker} ===")
        out_dir = PROJECT_ROOT / "raw_audio" / speaker
        for video_path in videos:
            if not video_path.exists():
                print(f"  MISSING, skipping: {video_path}")
                continue
            stem = video_path.stem.strip().replace("/", "-")
            out_path = out_dir / f"{stem}.wav"
            if out_path.exists():
                print(f"  already extracted, skipping: {out_path.name}")
                continue
            extract(video_path, out_path, ffmpeg_exe)


if __name__ == "__main__":
    main()
