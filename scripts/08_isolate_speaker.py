#!/usr/bin/env python3
"""
Separate a two-speaker training set (e.g. an interview: guest + interviewer)
into per-speaker clusters, using Chatterbox's own voice-encoder embeddings
rather than a new dependency. Input clips are already utterance-level
(from scripts/03_chunk_by_speech.py), so this only needs speaker
*clustering*, not full audio-level diarization.

For each target speaker folder in TARGETS:
  1. Embed every clip in training_data/<speaker>/clips/*.wav
  2. K-means (k=2) cluster the embeddings
  3. Write training_data/<speaker>/speaker_clusters.csv (clip, cluster)
  4. Copy a few representative clips per cluster into
     training_data/<speaker>/review_samples/ for a human to listen to and
     say which cluster is the actual target speaker

Run on the pod (needs the Chatterbox voice encoder + GPU):
    python3 scripts/08_isolate_speaker.py
"""
import csv
import shutil
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from sklearn.cluster import KMeans

BASE_MODEL_DIR = "/workspace/sloane/chatterbox-finetuning/pretrained_models"
PROJECT_ROOT = Path("/workspace/sloane")
TRAINING_DATA = PROJECT_ROOT / "training_data"

# Voices known/suspected to have two speakers mixed together (interviewer +
# target). See PROJECT_CONTEXT.md "Speaker isolation" entry for the transcript
# evidence per file.
TARGETS = ["voice_business", "voice_finance", "voice_broadcast", "voice_comedy"]
SAMPLES_PER_CLUSTER = 3


def main() -> None:
    import sys

    sys.path.insert(0, "/workspace/sloane/chatterbox-ft-art")
    from src.chatterbox_.tts import ChatterboxTTS

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"loading voice encoder on {device}...")
    engine = ChatterboxTTS.from_local(BASE_MODEL_DIR, device=device)
    ve = engine.ve

    for speaker in TARGETS:
        clips_dir = TRAINING_DATA / speaker / "clips"
        clip_paths = sorted(clips_dir.glob("*.wav"))
        if not clip_paths:
            print(f"{speaker}: no clips found, skipping")
            continue

        print(f"\n=== {speaker}: embedding {len(clip_paths)} clips ===")
        wavs, srs = [], []
        for p in clip_paths:
            wav, sr = sf.read(str(p))
            if wav.ndim > 1:
                wav = wav.mean(axis=1)
            wavs.append(wav.astype(np.float32))
            srs.append(sr)
        assert len(set(srs)) == 1, "mixed sample rates, unexpected"

        embeds = ve.embeds_from_wavs(wavs, sample_rate=srs[0], as_spk=False)

        print("clustering into 2 speakers...")
        km = KMeans(n_clusters=2, n_init=10, random_state=0)
        labels = km.fit_predict(embeds)

        out_csv = TRAINING_DATA / speaker / "speaker_clusters.csv"
        with open(out_csv, "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["clip", "cluster"])
            for p, label in zip(clip_paths, labels):
                writer.writerow([p.name, int(label)])

        counts = {c: int((labels == c).sum()) for c in set(labels)}
        print(f"cluster sizes: {counts} -> {out_csv}")

        review_dir = TRAINING_DATA / speaker / "review_samples"
        if review_dir.exists():
            shutil.rmtree(review_dir)
        review_dir.mkdir(parents=True)

        for cluster_id in sorted(counts):
            cluster_clips = [p for p, label in zip(clip_paths, labels) if label == cluster_id]
            # pick clips with the most speech (longest files) as clearer samples
            cluster_clips.sort(key=lambda p: p.stat().st_size, reverse=True)
            for i, p in enumerate(cluster_clips[:SAMPLES_PER_CLUSTER]):
                dest = review_dir / f"cluster{cluster_id}_sample{i+1}_{p.name}"
                shutil.copy(p, dest)

        print(f"sample clips for review -> {review_dir}")


if __name__ == "__main__":
    main()
