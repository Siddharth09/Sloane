# RunPod Serverless worker for Lucy Labs' audio generation.
#
# Deliberately thin: all the heavy ML dependencies (torch, chatterbox, peft,
# faster_whisper, pyworld, etc.) already live in the pre-built .venv on the
# shared network volume (oc6yvg9b19) - the same one the "sloane-retrain" Pod
# has always used. This image just needs to be able to run that venv's
# python against the handler script; it doesn't reinstall or duplicate any
# of those dependencies.
#
# Base image matches the exact image the Pods were built from, so the
# already-compiled torch/CUDA stack in the venv is guaranteed compatible.
FROM runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404

WORKDIR /

# Handler + shared engine code - the only things not already on the network
# volume via git (this repo's own scripts/ directory also lives at
# /workspace/sloane/scripts on the volume, kept in sync via git pull/scp, but
# copying them into the image too means the image is self-contained and
# doesn't depend on the volume's git state matching what was tested).
COPY scripts/lucy_tts_engine.py /app/lucy_tts_engine.py
COPY scripts/09_serverless_handler.py /app/handler.py

# Serverless workers mount the network volume at /runpod-volume, not
# /workspace like Pods do - symlink it so every hardcoded /workspace/sloane/...
# path already in lucy_tts_engine.py (model paths, LoRA adapters, reference
# clips) works completely unmodified. Then run the handler using the
# network volume's own venv (already has runpod installed - see the
# one-time `pip install runpod` setup step in STATUS.md), with /app on the
# path so the handler's local imports resolve.
CMD ["/bin/bash", "-c", "ln -sfn /runpod-volume /workspace && PYTHONPATH=/app /workspace/sloane/.venv/bin/python -u /app/handler.py"]
