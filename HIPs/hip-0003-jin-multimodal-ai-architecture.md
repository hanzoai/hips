---
hip: "0003"
title: Jin — An Unbuilt Multimodal Model
author: Hanzo AI
type: Standards Track
category: Core
status: Draft
created: 2025-01-09
requires: HIP-0039
---

# HIP-0003: Jin — An Unbuilt Multimodal Model

## Abstract

Jin names Hanzo's joint-embedding multimodal model line. It is not built:

- No Jin weights exist.
- `hanzoai/jin` is archived (`ARCHIVED.md` at `9f3d7d0e`) and holds a copy of
  `LumenPallidium/jepa` (MIT): I-JEPA and Saccade-JEPA experiments. No Hanzo commit touches
  that code.

This HIP records what exists, reserves the name, and states what a Jin release must carry
before this HIP moves to Final. Until then it is Draft.

## Motivation

Two surfaces describe Jin as if it existed:

- **The papers.** `hanzoai/papers` holds `hanzo-jin` and `hanzo-jin-architecture`. They report
  results, including 82.1% zero-shot ImageNet accuracy, with no checkpoint or harness behind
  them.
- **The site.** `hanzo.ai/jin` links to the private repository and to `docs.hanzo.ai/docs/jin`,
  which answers 404.

A reader could take these as a model they can use. There is none.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as in RFC 2119.

### §1 What exists

| Artifact | Where | Status |
|:--|:--|:--|
| JEPA experiments: I-JEPA (ViT and energy-transformer variants), Saccade-JEPA (ConvNeXt teacher and student, MLP predictor; prediction, cycle-consistency and VICReg losses), MAE with self-distillation | `hanzoai/jin`, private, archived. `zenlm/jin`, private, holds the same history. | Research code copied from `LumenPallidium/jepa` (MIT, © 2023 LumenPallidium; its last commit is `hanzoai/jin`'s `895a5a17`). Hanzo's commits add docs, CI, `.gitignore` and `papers/`, and touch nothing under `jepa/`. No tests, no package metadata. |
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
   and code actually have. No figure from the papers carries over without its own receipt.
4. **Safe format.** The weights are safetensors. A pickled checkpoint runs code when it is
   loaded.

## Rationale

- **Why a HIP for an unbuilt model.** HIP-0019 requires HIP-0003, and HIP-0511 and hanzo.ai
  cite Jin. Numbers are never reused, and a missing HIP would leave those references pointing
  at nothing. A Draft that says "not built" is the accurate target for them.
- **Why Draft and not Final.** Final means the thing exists in code. It does not.
- **Why not re-specify Jin as the JEPA research.** That code is a copy of a third party's MIT
  repository. It is archived and private, and `ARCHIVED.md` says no successor continues it.
  Specifying it as Jin would claim someone else's work and describe work nobody is doing.

## Security Considerations

- **Numbers with no model behind them.** No Jin model exists, so there is no model to attack. The
  risk is the claims: someone who relies on published numbers for a model that does not exist is
  relying on nothing. §2 is the control, and it is checkable by fetching the surfaces it names.
- **Attribution.** The copied JEPA code is MIT-licensed, and its `LICENSE` names the upstream
  author. Any release built from that code MUST keep the upstream copyright notice, as the MIT
  licence requires.

## References

- HIP-0002 HLLM; HIP-0019 tensor operations, which requires this HIP; HIP-0039 Zen; HIP-0135
  what is public; HIP-0511 model families.
- `hanzoai/jin` `ARCHIVED.md` at `9f3d7d0e`.
- Upstream code: https://github.com/LumenPallidium/jepa (MIT).
- I-JEPA: https://arxiv.org/abs/2301.08243

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
