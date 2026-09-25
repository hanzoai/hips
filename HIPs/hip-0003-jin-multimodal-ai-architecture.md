---
hip: "0003"
title: Jin — A Multimodal Model That Was Not Built
author: Hanzo AI
type: Standards Track
category: Core
status: Draft
created: 2025-01-09
requires: HIP-0039
---

# HIP-0003: Jin — A Multimodal Model That Was Not Built

## Abstract

On 2025-01-09 this HIP specified Jin: Hanzo's multimodal model, putting text, vision, audio and
3D into one joint embedding space with a diffusion-transformer mixture of experts from 1B to
over 1T parameters.

It was never built.

- `hanzoai/jin` was archived with that finding on 2026-05-12 (`ARCHIVED.md`, commit
  `9f3d7d0e`).
- What the repository holds is a copy of `LumenPallidium/jepa` (MIT, 2023): I-JEPA and
  Saccade-JEPA experiments. No Hanzo commit touches that code.
- No Jin weights exist.

This revision removes the unbuilt specification, records what exists, and states what a Jin
release must carry before this HIP can move to Final. Until then it stays Draft.

## Motivation

**The 2025 text.** It specified five model sizes, training runs, deployment latencies and a
benchmark table against named products. Nothing backed any of it: no code, no weights, no log.

**The papers.** `hanzoai/papers` holds two papers on the same architecture, `hanzo-jin` and
`hanzo-jin-architecture`. They report results, including 82.1% zero-shot ImageNet accuracy, with
no checkpoint or harness behind them.

**The site.** `hanzo.ai/jin` links to the private repository and to `docs.hanzo.ai/docs/jin`,
which answers 404.

A reader could take all of this as a model they can use. This HIP says there is none.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as in RFC 2119.

### §1 What exists

Measured on 2026-09-25:

| Artifact | Where | Status |
|:--|:--|:--|
| JEPA experiments: I-JEPA (ViT and energy-transformer variants), Saccade-JEPA (ConvNeXt teacher and student, MLP predictor; prediction, cycle-consistency and VICReg losses), MAE with self-distillation | `hanzoai/jin`, private, archived 2026-05-12. `zenlm/jin`, private, holds the same history. | Research code copied from `LumenPallidium/jepa` (MIT, © 2023 LumenPallidium; its last commit, dated 2024-01-05, is `hanzoai/jin`'s `895a5a17`). Hanzo's commits add docs, CI, `.gitignore` and `papers/`, and touch nothing under `jepa/`. No tests, no package metadata. |
| Weights | Hugging Face `hanzoai/jin` and `zenlm/jin` | none; both answer 404 to an authenticated request |
| Papers | `hanzoai/papers` `hanzo-jin/`, `hanzo-jin-architecture/` | describe the unbuilt architecture; their numbers carry no receipt |

`zenlm/vjepa2` is a public fork of `facebookresearch/vjepa2`. No repository calls it Jin, and this
HIP does not.

### §2 The name

Jin names a joint-embedding multimodal model line. Until §3 is met, no surface MAY list Jin as a
model that can be called or downloaded: not hanzo.ai, not docs.hanzo.ai, not `/v1/models`
(HIP-0039 §2.2), and not a catalog.

### §3 Release contract

This HIP moves to Final only when all of the following hold:

1. **Weights.** Jin weights are public on Hugging Face under `zenlm` or `hanzoai`. The card meets
   HIP-0039 §3 items 1, 2, 4, 5 and 6. Item 3, the Qwen3 base, is a Zen rule and does not bind
   Jin.
2. **Code.** Public code loads those weights and reproduces one stated evaluation, with the
   command, revision, hardware and date. Per HIP-0135, code a release depends on is public.
3. **Rewrite.** This HIP is rewritten to the modalities, size and objective the released config
   and code actually have. No figure in the 2025 text or in the papers carries over without its
   own receipt.
4. **Safe format.** The weights are safetensors. A pickled checkpoint runs code when it is
   loaded.

### §4 Removed

The 2025 text specified all of the following:

- Jin-nano through Jin-ultra: 1B to over 1T parameters, 8 to 128 experts;
- an 8,192-dimension joint space on a Poincaré ball;
- a three-phase training plan on up to 1,024 H100s;
- latency targets for edge, cloud and enterprise;
- a `hanzoai.Jin` Python API;
- benchmark rows against named products;
- an integration with HLLM (HIP-0002).

None of it was built, so all of it is removed. Git history keeps it.

## Rationale

- **Why keep the HIP and not delete it.** HIP-0019 requires HIP-0003, and HIP-0511 and hanzo.ai
  cite Jin. Deleting this HIP would free no number, since numbers are never reused, and would
  leave those references pointing at nothing. A Draft that says "not built" is the accurate
  target for them.
- **Why Draft and not Final.** Final means the thing exists in code. It does not.
- **Why not re-specify Jin as the JEPA research.** That code is a copy of a third party's MIT
  repository. It is archived and private, and `ARCHIVED.md` says no successor continues it.
  Specifying it as Jin would claim someone else's work and describe work nobody is doing.

## Security Considerations

- **Numbers with no model behind them.** No Jin model exists, so there is no model to attack. The
  risk is the claims: someone who relies on published numbers for a model that does not exist is
  relying on nothing. §2 is the control, and it is checkable by fetching the surfaces it names.
- **Attribution.** The copied JEPA code is MIT-licensed, and its `LICENSE` names the upstream
  author. Commit `cf327634`, "Remove upstream references", changed `README.md`. Any release built
  from that code MUST keep the upstream copyright notice, as the MIT licence requires.

## References

- HIP-0002 HLLM; HIP-0019 tensor operations, which requires this HIP; HIP-0039 Zen; HIP-0135
  what is public; HIP-0511 model families.
- `hanzoai/jin` `ARCHIVED.md` at `9f3d7d0e`.
- Upstream code: https://github.com/LumenPallidium/jepa (MIT).
- I-JEPA: https://arxiv.org/abs/2301.08243

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
