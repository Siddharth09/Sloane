# Vendored upstream dependencies

Mirrors of the open-source projects this build depends on or is evaluating,
kept here in case the upstream repos disappear, go private, or change
license terms. Snapshots as of 2026-09-07, not kept in sync automatically —
re-pull manually if a newer version is needed.

- **`chatterbox-upstream/`** — [resemble-ai/chatterbox](https://github.com/resemble-ai/chatterbox),
  MIT licensed. The actual TTS model we fine-tune (see PROJECT_CONTEXT.md
  Phase 3/6). Not directly imported by our code (we use the vendored copy
  inside `chatterbox-finetuning-upstream/src/chatterbox_/` for
  training/inference — see below), but kept for reference and as a backup
  of the canonical upstream.
- **`chatterbox-finetuning-upstream/`** — [gokhaneraslan/chatterbox-finetuning](https://github.com/gokhaneraslan/chatterbox-finetuning),
  Apache-2.0 licensed. The LoRA fine-tuning toolkit actually used in Phase 6
  — a smaller community project, higher disappearance risk than Chatterbox
  itself, so worth mirroring.
- **`hallo3-upstream/`** — [fudan-generative-vision/hallo3](https://github.com/fudan-generative-vision/hallo3),
  code MIT licensed. Candidate for Feature C (video cloning) — see note
  below on why this replaced OmniTalker.

## Why Hallo3, not OmniTalker

PROJECT_CONTEXT.md originally named OmniTalker (Alibaba/HumanAIGC) as the
Feature C candidate. Checked 2026-09-07 while vendoring: **OmniTalker has no
public model code or weights** — its GitHub repo
([HumanAIGC/omnitalker](https://github.com/HumanAIGC/omnitalker)) is only a
project page (paper links, demo videos), and its Hugging Face Space
(`Mrwrichard/OmniTalker`) is a thin Gradio UI that forwards requests to a
private internal Alibaba backend (`OMNITALKER_URL`, not publicly reachable)
— there is nothing runnable to self-host. Hallo3 is confirmed to have a real
public repo, real downloadable weights
(`huggingface-cli download fudan-generative-ai/hallo3`), and MIT-licensed
code. **Still unverified**: the model *weights'* own license terms
specifically (code license and weight license aren't always the same thing)
— check Hallo3's Hugging Face model card before using it commercially, same
diligence needed for any future Feature C model choice.
