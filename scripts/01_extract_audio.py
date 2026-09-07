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
DOWNLOADS_DIR = Path(r"C:\Users\SidMehta\Downloads")

# Curated per-speaker source lists: chosen for solo-instructor talking (no music
# overlays, no singing demos) to keep the extracted audio clean for voice training.
# Speaker keys are deliberately role/register-based, not the real name of whoever
# is speaking in the source video - matches the art_instructor/music_instructor
# convention (see PROJECT_CONTEXT.md Sec 3 on consent-posture naming).
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
    # 2026-09-07: 5 new voices, one source clip each, consented per the user
    # (see PROJECT_CONTEXT.md "New preset voices" entry for the consent note
    # and the mapping of neutral name -> real source, kept out of code).
    "voice_business": [
        DOWNLOADS_DIR / "YTDown.com_YouTube_Adele-Moynihan-talks-about-Antler-a-glob_Media_COwV0IuK7I_001_1080p.mp4",
    ],
    "voice_comedy": [
        DOWNLOADS_DIR / "YTDown.com_YouTube_Aisling-Bea-Stand-Up-Things-People-Only-_Media_gjQSJPadGYM_001_1080p.mp4",
    ],
    "voice_finance": [
        DOWNLOADS_DIR / "YTDown.com_YouTube_Alternative-Investments-Will-Grow-Your-W_Media_Gpi1r0MbWyk_001_1080p.mp4",
    ],
    "voice_broadcast": [
        DOWNLOADS_DIR / "YTDown.com_YouTube_Jacqui-Felgate-s-tip-off-on-magistrates-_Media_pUFLx1OlBts_001_1080p.mp4",
    ],
    "voice_tech": [
        DOWNLOADS_DIR / "YTDown.com_YouTube_The-Impact-of-Digital-Disruption_Media_XyP5-2UvPv8_001_1080p.mp4",
    ],
    "voice_meditation": [
        DOWNLOADS_DIR / "1-The_Calm_Breath 2.mp3",
        DOWNLOADS_DIR / "2-Calm_Birth 2.mp3",
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
