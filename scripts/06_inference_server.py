#!/usr/bin/env python3
"""Local/manual Pod-based inference server - dev and admin testing only.

Production traffic now goes through RunPod Serverless
(scripts/09_serverless_handler.py); this FastAPI server is kept around for
manually starting a Pod and testing generation by hand (e.g. verifying a
retrain by ear) without needing to go through the Serverless job API. Both
this file and the serverless handler share the same generation logic from
scripts/lucy_tts_engine.py - no behavior differs between them.

Usage (on a manually-started pod):
    /workspace/sloane/.venv/bin/python scripts/06_inference_server.py
Then reachable at the pod's RunPod HTTP-proxy URL for port 8000.
"""
import uuid
from pathlib import Path

import soundfile as sf
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from lucy_tts_engine import (
    DEVICE,
    PRESET_VOICES,
    ReferenceAudioTooShortError,
    UnknownVoiceError,
    generate_clone,
    generate_preset,
    preset_t3_cache,
)

app = FastAPI(title="Lucy Inference API (dev/admin)")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

AUDIO_DIR = Path("/workspace/sloane/api_generated_audio")
AUDIO_DIR.mkdir(exist_ok=True)
app.mount("/audio", StaticFiles(directory=AUDIO_DIR), name="audio")


@app.post("/api/generate-preset")
async def generate_preset_route(
    text: str = Form(...),
    voice_id: str = Form(...),
    exaggeration: float | None = Form(None),
    cfg_weight: float | None = Form(None),
    pitch_semitones: float | None = Form(None),
    speed: float | None = Form(None),
):
    try:
        audio, sr = generate_preset(
            text,
            voice_id,
            exaggeration=exaggeration,
            cfg_weight=cfg_weight,
            pitch_semitones=pitch_semitones,
            speed=speed,
        )
    except UnknownVoiceError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    if audio is None:
        return JSONResponse({"error": "no audio generated"}, status_code=500)

    filename = f"{uuid.uuid4().hex}.wav"
    sf.write(str(AUDIO_DIR / filename), audio, sr)
    return {"audio_url": f"/audio/{filename}", "mock": False, "voice_id": voice_id}


@app.post("/api/clone-voice")
async def clone_voice_route(
    text: str = Form(...),
    reference_audio: UploadFile = File(...),
    exaggeration: float | None = Form(None),
    cfg_weight: float | None = Form(None),
    speed: float | None = Form(None),
):
    content = await reference_audio.read()
    try:
        audio, sr = generate_clone(
            text,
            content,
            exaggeration=exaggeration,
            cfg_weight=cfg_weight,
            speed=speed,
        )
    except ReferenceAudioTooShortError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
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
