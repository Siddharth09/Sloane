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
# clips) works completely unmodified.
#
# `ln -sfn /runpod-volume /workspace` alone is NOT enough: the base image
# (same one the Pods use) already has /workspace as a real, pre-existing
# directory, and `ln`'s target-directory behavior means pointing a symlink
# AT an existing directory nests it inside instead of replacing it - so
# every hardcoded /workspace/sloane/... path would silently resolve to a
# location that doesn't exist. Remove the pre-existing directory first so
# the symlink actually replaces it. Also installs `runpod` into the shared
# venv on every boot rather than relying on a one-time manual setup step -
# a no-op in ~1s once it's already installed, but self-healing if it isn't.
# Prints filesystem state before/after so a broken mount is visible in the
# worker's Container logs instead of failing silently.
CMD ["/bin/bash", "-c", "set -e; echo '[boot] /workspace before:'; ls -la /workspace 2>&1 || true; rm -rf /workspace; ln -s /runpod-volume /workspace; echo '[boot] /workspace after:'; ls -la /workspace; echo '[boot] venv python:'; ls -la /workspace/sloane/.venv/bin/python; /workspace/sloane/.venv/bin/python -m pip install --quiet runpod; echo '[boot] starting handler...'; PYTHONPATH=/app exec /workspace/sloane/.venv/bin/python -u /app/handler.py"]
