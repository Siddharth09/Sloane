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
  code MIT licensed. Kept as a secondary reference — see below for why it's
  not the active Feature C pick.
- **`echomimic_v3-upstream/`** — [antgroup/echomimic_v3](https://github.com/antgroup/echomimic_v3)
  (AAAI 2026), Apache-2.0 covering the models/weights explicitly, not just
  the code. **Active Feature C candidate.** Demo assets (`datasets/`, ~30MB
  of sample images/audio) were dropped before committing — not needed to
  preserve, we only care about the code.

## Feature C model selection: OmniTalker → Hallo3 → EchoMimicV3

PROJECT_CONTEXT.md originally named OmniTalker (Alibaba/HumanAIGC) as the
Feature C candidate. Checked 2026-09-07 while vendoring: **OmniTalker has no
public model code or weights** — its GitHub repo
([HumanAIGC/omnitalker](https://github.com/HumanAIGC/omnitalker)) is only a
project page (paper links, demo videos), and its Hugging Face Space
(`Mrwrichard/OmniTalker`) is a thin Gradio UI that forwards requests to a
private internal Alibaba backend (`OMNITALKER_URL`, not publicly reachable)
— nothing runnable to self-host, and no commercial API/DashScope listing
found either. Completely inaccessible.

First pivoted to Hallo3 (real repo, MIT code, downloadable weights) — then
superseded the same day once actually compared against alternatives rather
than just taking the first available option: a benchmark comparison flagged
Hallo3 with "severe limitations in preserving character identity" (a
dealbreaker here — the product needs the video to look like the *specific*
real person), and it's a heavier CogVideoX-5B-backed model. **EchoMimicV3**
won the comparison: Apache-2.0 explicitly covering the weights (not just
code, unlike Hallo3), lighter (1.3B params, a "Flash" variant runs on as
little as 12GB VRAM), and no identity-preservation red flag found against
it. See PROJECT_CONTEXT.md Sec 8 for the full writeup.
