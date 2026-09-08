#!/usr/bin/env python3
"""RunPod Serverless entry point - the production path for audio generation.

Thin wrapper around lucy_tts_engine.py: no static file serving, no persisted
disk output. Audio comes back as base64-encoded WAV directly in the job
result, since Serverless workers don't expose a stable HTTP file server the
way the old always-on Pod did (see scripts/06_inference_server.py, kept for
local/manual Pod-based testing only - not used in production anymore).

Runs inside the worker container (see Dockerfile) with the network volume
symlinked to /workspace so every existing /workspace/sloane/... path in
lucy_tts_engine.py works unmodified.

Job input shape:
    {"action": "generate-preset", "text": ..., "voice_id": ...,
     "exaggeration": ..., "cfg_weight": ..., "speed": ...}
    {"action": "clone-voice", "text": ..., "reference_audio_base64": ...,
     "exaggeration": ..., "cfg_weight": ..., "speed": ...}

Job output shape (success):
    {"audio_base64": "...", "sample_rate": 24000, "voice_id": ... | null}
Job output shape (error):
    {"error": "..."}
"""
import base64
import io

import runpod
import soundfile as sf

from lucy_tts_engine import (
    ReferenceAudioTooShortError,
    UnknownVoiceError,
    generate_clone,
    generate_preset,
)


def _encode_wav(audio, sr) -> str:
    buf = io.BytesIO()
    sf.write(buf, audio, sr, format="WAV")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def handler(job):
    inp = job.get("input", {})
    action = inp.get("action", "generate-preset")
    text = inp.get("text", "")

    try:
        if action == "generate-preset":
            voice_id = inp["voice_id"]
            audio, sr = generate_preset(
                text,
                voice_id,
                exaggeration=inp.get("exaggeration"),
                cfg_weight=inp.get("cfg_weight"),
                pitch_semitones=inp.get("pitch_semitones"),
                speed=inp.get("speed"),
            )
            if audio is None:
                return {"error": "no audio generated"}
            return {"audio_base64": _encode_wav(audio, sr), "sample_rate": sr, "voice_id": voice_id}

        elif action == "clone-voice":
            reference_audio_bytes = base64.b64decode(inp["reference_audio_base64"])
            audio, sr = generate_clone(
                text,
                reference_audio_bytes,
                exaggeration=inp.get("exaggeration"),
                cfg_weight=inp.get("cfg_weight"),
                speed=inp.get("speed"),
            )
            if audio is None:
                return {"error": "no audio generated"}
            return {"audio_base64": _encode_wav(audio, sr), "sample_rate": sr}

        else:
            return {"error": f"unknown action '{action}'"}

    except UnknownVoiceError as exc:
        return {"error": str(exc)}
    except ReferenceAudioTooShortError as exc:
        return {"error": str(exc)}


runpod.serverless.start({"handler": handler})
