#!/usr/bin/env bash
# Runs ON the RunPod pod (not locally) - trains a LoRA adapter per new voice,
# the same way art_instructor/music_instructor were trained in Phase 6 (see
# PROJECT_CONTEXT.md). Assumes:
#   - /workspace/sloane/chatterbox-finetuning/  already has pretrained_models/
#     downloaded (the base Chatterbox checkpoint) - reused read-only per voice.
#   - training_data/<voice>/clips/ and training_data/<voice>/metadata.csv
#     already exist (from scripts/02, 03, 05 - run those first, they loop
#     over every speaker under raw_audio/ automatically, no changes needed
#     for the new voices).
#
# Usage (from /workspace/sloane on the pod):
#   bash scripts/07_finetune_new_voices.sh
#
# One voice at a time, ~2-3 min GPU training each based on Phase 6's timing
# (712 clips/220 steps took ~2.5 min) - these sources are longer than the
# original curated clips, so expect more clips and proportionally more time.
set -euo pipefail

BASE_TOOLKIT=/workspace/sloane/chatterbox-finetuning
PROJECT_ROOT=/workspace/sloane
VOICES=(voice_comedy voice_meditation)
# voice_business/voice_finance/voice_broadcast/voice_tech/voice_meditation
# already trained. voice_comedy has only 1.9 min of usable audio after
# chunking - trying it anyway per explicit request, expect weaker quality
# (see PROJECT_CONTEXT.md "Speaker isolation" entry for the data-volume
# comparison against the other voices).

for voice in "${VOICES[@]}"; do
  echo ""
  echo "=== $voice ==="
  WORK_DIR="$PROJECT_ROOT/chatterbox-ft-$voice"

  if [ ! -d "$WORK_DIR" ]; then
    echo "  copying toolkit template -> $WORK_DIR"
    cp -r "$BASE_TOOLKIT" "$WORK_DIR"
    rm -rf "$WORK_DIR/pretrained_models"  # replace copy with a symlink (see Phase 6 bug note)
    ln -s "$BASE_TOOLKIT/pretrained_models" "$WORK_DIR/pretrained_models"
  fi

  echo "  writing config.py"
  cat > "$WORK_DIR/src/config.py" <<PYCONFIG
from dataclasses import dataclass, field
from typing import List

@dataclass
class TrainConfig:
    model_dir: str = "./pretrained_models"
    csv_path: str = "$PROJECT_ROOT/training_data/$voice/metadata.csv"
    wav_dir: str = "$PROJECT_ROOT/training_data/$voice/clips"
    preprocessed_dir = "./preprocess_cache"
    output_dir: str = "./chatterbox_output"

    is_inference = False
    inference_prompt_path: str = "$PROJECT_ROOT/training_data/$voice/clips/00001.wav"
    inference_test_text: str = "This is a test of the fine-tuned voice."

    ljspeech = True
    json_format = False
    preprocess = True

    is_turbo: bool = False
    is_lora: bool = True

    lora_r: int = 128
    lora_alpha: int = 256
    turbo_lora_target_modules: List[str] = field(default_factory=lambda: ["c_attn", "c_proj", "c_fc", "spkr_enc"])
    lora_target_modules: List[str] = field(default_factory=lambda: ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj", "spkr_enc"])
    lora_modules_to_save: List[str] = field(default_factory=lambda: ["text_emb", "text_head"])

    new_vocab_size: int = 2454

    batch_size: int = 8
    grad_accum: int = 4
    learning_rate: float = 1e-4
    num_epochs: int = 10

    save_steps: int = 500
    save_total_limit: int = 5
    dataloader_num_workers: int = 8

    start_text_token = 255
    stop_text_token = 0
    max_text_len: int = 256
    max_speech_len: int = 850
    prompt_duration: float = 3.0
PYCONFIG

  echo "  training..."
  (cd "$WORK_DIR" && /workspace/sloane/.venv/bin/python train.py)

  echo "  merging LoRA adapter into a standalone checkpoint..."
  (cd "$WORK_DIR" && /workspace/sloane/.venv/bin/python merge_lora.py)

  echo "  done: $WORK_DIR/chatterbox_output/t3_finetuned_merged.safetensors"
done

echo ""
echo "All 4 voices trained. Next: add each to PRESET_VOICES in"
echo "scripts/06_inference_server.py (adapter_dir + a reference clip), same"
echo "pattern as art_instructor/music_instructor, then restart the server."
