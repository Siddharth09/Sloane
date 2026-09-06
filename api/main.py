"""Sloane backend API.

Two endpoints, both eventually wrapping a Chatterbox call running on the
RunPod GPU pod (see PROJECT_CONTEXT.md, Phase 4). Until that pod is wired up,
both endpoints return a short mock tone so the frontend can be built and
tested end-to-end now.
"""

import io
import math
import struct
import uuid
import wave
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="Sloane API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

AUDIO_DIR = Path(__file__).parent / "generated_audio"
AUDIO_DIR.mkdir(exist_ok=True)
app.mount("/audio", StaticFiles(directory=AUDIO_DIR), name="audio")

PRESET_VOICES = {"art_instructor", "music_instructor"}


def _write_mock_tone(path: Path, seconds: float = 2.0, freq: float = 220.0) -> None:
    """Writes a short sine-wave tone as a placeholder for real TTS output."""
    framerate = 22050
    n_frames = int(seconds * framerate)
    with wave.open(str(path), "w") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(framerate)
        for i in range(n_frames):
            sample = int(32767 * 0.3 * math.sin(2 * math.pi * freq * i / framerate))
            wav_file.writeframesraw(struct.pack("<h", sample))


@app.post("/api/generate-preset")
async def generate_preset(text: str = Form(...), voice_id: str = Form(...)):
    if voice_id not in PRESET_VOICES:
        return {"error": f"unknown voice_id, expected one of {sorted(PRESET_VOICES)}"}

    # TODO(Phase 4/6): replace with a call to the RunPod-hosted Chatterbox
    # endpoint, passing `text` + the fine-tuned checkpoint (or zero-shot
    # reference clip, pre-fine-tune) for `voice_id`.
    filename = f"{uuid.uuid4().hex}.wav"
    _write_mock_tone(AUDIO_DIR / filename, freq=220.0 if voice_id == "music_instructor" else 330.0)
    return {"audio_url": f"/audio/{filename}", "mock": True, "text": text, "voice_id": voice_id}


@app.post("/api/clone-voice")
async def clone_voice(text: str = Form(...), reference_audio: UploadFile = File(...)):
    # TODO(Phase 4): replace with a call to the RunPod-hosted Chatterbox
    # zero-shot endpoint, passing `text` + the uploaded reference clip as the
    # speaker embedding source.
    _ = await reference_audio.read()  # not yet used by the mock

    filename = f"{uuid.uuid4().hex}.wav"
    _write_mock_tone(AUDIO_DIR / filename, freq=440.0)
    return {"audio_url": f"/audio/{filename}", "mock": True, "text": text}


@app.get("/api/health")
async def health():
    return {"status": "ok"}
