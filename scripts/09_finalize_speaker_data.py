#!/usr/bin/env python3
"""
Apply the speaker-cluster decisions from scripts/08_isolate_speaker.py: keep
only the confirmed target-speaker cluster's rows in each voice's metadata.csv
(clip files themselves are left alone - just narrowing which ones the
training run actually uses). See PROJECT_CONTEXT.md "Speaker isolation,
2026-09-07" for how each keep-cluster was confirmed.

Run on the pod:
    python3 scripts/09_finalize_speaker_data.py
"""
import csv
from pathlib import Path

TRAINING_DATA = Path("/workspace/sloane/training_data")

# voice -> cluster id to keep (from speaker_clusters.csv), or None if the
# voice is already single-speaker and needs no filtering.
KEEP_CLUSTER = {
    "voice_business": 0,   # Adele - confirmed via cluster0_sample1_00241
    "voice_finance": 1,    # Natasha - confirmed via cluster1_sample_00269;
                            # cluster0 contains a confirmed interviewer line
                            # (clip 00007) mixed with her longer answers
    "voice_broadcast": 1,  # Jacqui - confirmed via cluster1_sample1_00085
    "voice_tech": None,    # Patrick - already single-speaker, no filtering
}


def main() -> None:
    for voice, keep_cluster in KEEP_CLUSTER.items():
        voice_dir = TRAINING_DATA / voice
        metadata_path = voice_dir / "metadata.csv"

        if keep_cluster is None:
            print(f"{voice}: no filtering needed")
            continue

        clusters_path = voice_dir / "speaker_clusters.csv"
        keep_clips = set()
        with open(clusters_path, newline="") as f:
            for row in csv.DictReader(f):
                if int(row["cluster"]) == keep_cluster:
                    keep_clips.add(row["clip"])

        with open(metadata_path, encoding="utf-8") as f:
            lines = [l for l in f if l.strip()]

        kept_lines = [l for l in lines if l.split("|", 1)[0] in keep_clips]

        backup_path = voice_dir / "metadata_unfiltered.csv"
        if not backup_path.exists():
            metadata_path.rename(backup_path)
        with open(metadata_path, "w", encoding="utf-8") as f:
            f.writelines(kept_lines)

        print(f"{voice}: kept {len(kept_lines)}/{len(lines)} rows (cluster {keep_cluster}) -> {metadata_path}")


if __name__ == "__main__":
    main()
