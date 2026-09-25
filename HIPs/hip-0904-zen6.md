---
hip: 0904
title: Zen6 — Dense, Coder and Ternary Checkpoints
author: Hanzo AI
type: Standards Track
category: Core
status: Final
created: 2026-09-25
requires: HIP-0039
---

# HIP-0904: Zen6 — Dense, Coder and Ternary Checkpoints

## Abstract

Zen6 is the current Zen generation (HIP-0039). It was published on 2026-09-21 as three
open-weight Hugging Face repositories:

- **`zenlm/zen6`.** A 64-layer hybrid-attention model in mixed NVFP4 and FP8, with a DFlash 2
  drafter bundled beside it and YaRN scaling to 1,048,576 positions.
- **`zenlm/zen6-coder`.** A 512-expert mixture as GGUF IQ4_XS, with a one-layer MTP drafter.
- **`zenlm/zen6-flash`.** A 64-layer model in ternary GGUF, with a vision projector and a
  DFlash 2 drafter.

**All three are re-hosts.**

- Every weight file is byte-identical to a named upstream file.
- Only zen6 changes a model file: three rope fields in its `config.json`.
- The only measured number in any of the three repositories is the upstream's GSM8K
  qualification of zen6.

`zen6` and `zen6-coder` are also served SKU ids on `/v1/models`. Under HIP-0039 §2.3 they do not
promise these weights.

This HIP records the layout of each repository, where each file came from, what has been measured
and what is only claimed, and the defects found on 2026-09-25.

## Motivation

Zen6 was published on Hugging Face on 2026-09-21 and is served on `/v1/models`. Until
2026-09-25, no HIP, catalog, site or doc named it.

Its cards also disagree with the files beside them. The zen6 card's architecture table gives a
different head count, vocabulary and attention type from its `config.json`. The zen6-coder card
describes a file format that is not in its repository.

A reader choosing between the three needs the artifacts, not the cards: what each file is, where
it came from, what runs it, and which numbers carry a receipt.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as in RFC 2119.

Every fact below was read on 2026-09-25 from the Hugging Face API
(`https://huggingface.co/api/models/<id>?blobs=true`) and from the files at the revision given.
GGUF metadata was read from the file headers with HTTP range requests.

### §1 Repositories

| Checkpoint | Hugging Face @ revision | Bytes | Licence | Served SKU |
|:--|:--|--:|:--|:--|
| zen6 | `zenlm/zen6` @ `574c3066` | 25,794,104,008 | apache-2.0 | `zen6` |
| zen6-coder | `zenlm/zen6-coder` @ `3f803c67` | 97,820,026,179 | other: qwen-community-1.0 | `zen6-coder` |
| zen6-flash | `zenlm/zen6-flash` @ `b5e7a43c` | 16,769,698,285 | apache-2.0 | none |

GitHub has `zenlm/zen6`, `zenlm/zen6-coder` and `zenlm/zen6-flash`. They hold the card, plus a
`training/` recipe for zen6 and zen6-coder, and no weights.

### §2 zen6

The target model is a `Qwen3_5ForConditionalGeneration` (`model_type: qwen3_5`):

| Field | Value (`config.json`) |
|:--|:--|
| layers | 64: 48 `linear_attention` (Gated DeltaNet) and 16 `full_attention`, one full every 4 |
| hidden, intermediate | 5,120 and 17,408 |
| full attention | 24 query heads, 4 key/value heads, head dim 256, output gate |
| linear attention | 16 key heads and 48 value heads, head dim 128, conv kernel 4 |
| vocabulary | 248,320 |
| MTP | 1 layer |
| vision | 27-layer vision tower, hidden 1,152; image and video tokens; `language_model_only: false` |
| positions | 262,144 native; `rope_type: yarn`, `factor: 4.0` → 1,048,576; `rope_theta` 10,000,000; `partial_rotary_factor` 0.25; interleaved mRoPE |

Quantization is NVIDIA ModelOpt 0.47.0.dev0 `MIXED_PRECISION`:

- **NVFP4** (4-bit float weights and activations, group size 16) on 193 modules: every
  `gate_proj`, `up_proj` and `down_proj`, plus `lm_head`.
- **FP8** (8-bit float weights and activations) on 208 modules: every attention projection,
  linear and full.
- **KV cache:** FP8.
- **Unquantized:** MTP.

The weights are three safetensors shards holding 2,194 tensors and 21,921,428,072 bytes: 1,842
language-model tensors, 333 vision, 15 MTP and 4 `lm_head`.

The drafter is `dflash2/`: `DFlash2DraftModel` in bfloat16, 3,848,817,896 bytes.

| Field | Value (`dflash2/config.json`) |
|:--|:--|
| layers | 5, `sliding_attention`, window 2,048 |
| hidden | 5,120; 32 query heads, 8 key/value heads |
| `block_size` | 8 |
| `target_layer_ids` | 5, 19, 33, 47, 61 |
| positions | 262,144, `rope_type: default` |

### §3 zen6-coder

The zen6-coder GGUF headers give:

| Field | Value (GGUF header) |
|:--|:--|
| `general.architecture` | `qwen4exp`; `general.name` "Qwen3.8 Flash Next" |
| blocks | 48, one full-attention block every 4 |
| embedding | 2,560 |
| attention | 24 heads, 2 key/value heads, key and value length 256; an indexer of 4 heads, key length 128, top-k 2,048 |
| experts | 512, 10 used, expert FFN 640, shared-expert FFN 640 |
| linear blocks | SSM conv kernel 4, state 128, 16 groups, inner 6,144 |
| hyper-connections | 4, low rank 320 |
| per-layer n-gram embedding | n-gram size 3; 16 hashed heads of about 20,000,000 entries each; `embedding_length_per_layer_input` 160 |
| context | 262,144 |
| quantization | Unsloth imatrix, file type IQ4_XS, 1,224 tensors across 3 splits |

The repository holds five files:

- `UD-IQ4_XS/Qwen3.8-Flash-Next-UD-IQ4_XS-0000{1,2,3}-of-00003.gguf`, 93,682,584,224 bytes in
  total.
- `MTP/mtp-Qwen3.8-Flash-Next-Q8_0.gguf`, 4,137,429,120 bytes. It is the same architecture with
  49 blocks and `nextn_predict_layers: 1`.
- `MTP/README.md`.

The card states 180B total parameters, 125B in the base model and 6B active per token. The
headers are consistent with that but do not prove it, and this HIP does not assert it.

### §4 zen6-flash

The PQ2_0 GGUF header gives:

| Field | Value (PQ2_0 GGUF header) |
|:--|:--|
| `general.architecture` | `qwen35` |
| blocks | 64, one full-attention block every 4 |
| embedding, FFN | 5,120 and 17,408 |
| attention | 24 heads, 4 key/value heads, key and value length 256 |
| context | 262,144 |
| tensors | 851: 402 of GGML type 142, 96 of BF16, 353 of F32 |
| transform | a Walsh–Hadamard pre-rotation over 401 weights, block 1,024, recorded under `prism.hadamard.*` |

A loader MUST implement GGML type 142 and apply the recorded Hadamard transform before these
weights mean anything.

| File | Bytes |
|:--|--:|
| `Ternary-Bonsai-2-27B-PQ2_0.gguf` | 7,206,168,928 |
| `Ternary-Bonsai-2-27B-PTQ1_0.gguf` | 5,946,648,928 |
| `Ternary-Bonsai-2-27B-mmproj-Q8_0.gguf` | 629,246,976 |
| `Ternary-Bonsai-2-27B-mmproj-BF16.gguf` | 931,145,856 |
| `Bonsai-2-27B-DFlash2-Q8_0.gguf` | 2,056,415,104 |
| `SHA256SUMS` | 65,916 |

### §5 Provenance

Files match their upstream when the LFS SHA-256 or git blob id is equal. The comparison was run
against each upstream's file listing from the same API.

| Checkpoint | Upstream | What matches | What differs |
|:--|:--|:--|:--|
| zen6 | `RadixArk/Qwen3.8-27B-NVFP4` (base `Qwen/Qwen3.8-27B` @ `e13a4f0e`) | 19 files: all shards, the index, the tokenizer files, the chat template, and the conversion, audit and qualification receipts | `config.json`, in three fields (below); the README; no `LICENSE`, which the upstream ships |
| zen6 | `incoai/Qwen3.8-27B-DFlash2` | `config.json` and `model.safetensors`, placed under `dflash2/` | none |
| zen6-coder | `unsloth/Qwen3.8-Flash-Next-GGUF` (base `Qwen/Qwen3.8-Flash-Next`) | all five files | the README |
| zen6-flash | `prism-ml/Ternary-Bonsai-2-27B-gguf` (base `Qwen/Qwen3.8-27B`) | the four model and projector files | the README |
| zen6-flash | `ProCreations/Ternary-Bonsai-2-27B-DFlash2` | the drafter and `SHA256SUMS` | none |

The three fields that differ in zen6's `config.json`, all under `text_config.rope_parameters`:

- `rope_type`: `default` → `yarn`
- `factor`: absent → `4.0`
- `original_max_position_embeddings`: absent → `262144`

All three checkpoints descend from Qwen3.8, so they meet HIP-0039 §3.3.

### §6 Measured

The only receipt in any Zen6 repository is zen6's `qualification.json` with its
`qualification-criteria.json`. Both are byte-identical to the upstream's.

| Field | Value |
|:--|:--|
| task | GSM8K, 1,283 correct of 1,319 = 0.9727, against a gate of 0.965 |
| failures | 0 empty generations, 0 truncations, 0 request errors |
| harness | `sgl-eval` @ `6690895` |
| server | SGLang @ `2948168` |
| hardware | 4 × NVIDIA GB300, tensor parallel 4 |
| KV cache | FP8 E4M3; scales not calibrated, so they default to 1.0 |
| speculation | NEXTN on the MTP head, resolved as EAGLE; final acceptance length 2.775 |
| sampling | thinking on, temperature 1.0, top-p 0.95, top-k 20 |

**What the receipt covers.** It measures the upstream checkpoint with its upstream config. No
receipt covers the YaRN edit, any context above 262,144, or the DFlash 2 drafter.

**Unmeasured claims.** The cards' throughput tables, DFlash 2 speedups, retention percentages and
benchmark comparisons carry no receipt. This HIP relies on none of them.

**Serving.** The live SKUs `zen6` and `zen6-coder` report a 1,000,000-token window on
`/v1/models`. Under HIP-0039 §2.3, that window is the SKU's contract and says nothing about these
files.

### §7 Runtimes

The upstream receipt names only one runtime for these weights: SGLang @ `2948168` running zen6
(§6).

`hanzoai/engine` @ `d25f18e` contains:

- a `qwen4exp` model (`hanzo-engine/src/models/qwen4exp.rs` and `quantized_qwen4exp.rs`);
- a `--dflash <dir>` draft option;
- an `--mtp-model` option.

Whether it loads any of these three checkpoints has not been measured.

### §8 Defects

As of 2026-09-25. A card fix is a new revision of that repository, and the repository revisions
in §1 move with it.

1. **Licence files.** None of the three repositories carries `LICENSE` or `NOTICE`, which
   HIP-0039 §3.2 requires.
2. **zen6 card against `config.json`.** Under HIP-0039 §3.5 the config is the fact.

   | Field | Card says | `config.json` says |
   |:--|:--|:--|
   | heads | 32 query, 8 key/value | 24 query, 4 key/value |
   | vocabulary | 152,064 | 248,320 |
   | target attention | "Sliding-Window Attention" | full attention; sliding windows are the drafter's |
   | drafter block | 3–5 tokens | `block_size: 8` |
   | drafter positions | a 1M position table | 262,144 |
   | modality | `pipeline_tag: text-generation` | ships a vision tower |
3. **zen6-coder.** The card describes a "Halogen W4B" format, and no such file is in the
   repository. The GitHub description says "38B-Class"; the card says 180B.
4. **zen6-flash.** The card lists the BF16 projector as 1.2 GB. The file is 931,145,856 bytes.
5. **Commands that cannot run.** The `hanzo-engine serve` commands on the zen6 and zen6-coder
   cards pass `--context-window`, `--kv-cache-quant` and `--mtp`. The engine at `d25f18e` defines
   none of them.
6. **Not HIP-0039 §3.4.** None of the cards says it is a re-host, and none names the files it
   copied.

## Rationale

- **Why re-host.** It puts a current checkpoint under the Zen name the day upstream publishes
  one, with no training cost. Its price is that Zen6 open weights are exactly as good as their
  upstreams, and the cards have to say so (HIP-0039 §3.4). Training a Zen-specific checkpoint
  would be a later generation with its own receipt.
- **Why the files are the specification.** `config.json`, the GGUF headers and LFS hashes are
  what a runtime reads and what a reader can re-check. Card prose is neither.
- **Why the defects are listed here.** A HIP that repeated the cards would carry their errors.
  One that silently corrected them would hide that the published cards are wrong. Listing the
  defects lets each be fixed and struck through.

## Security Considerations

- **Pin revisions.** A loader SHOULD pin the revision in §1, or its successor, and check LFS
  SHA-256 against the upstream (§5).
- **zen6-flash `SHA256SUMS`.** It is the drafter repository's, and it lists 481 files. Of the
  files zen6-flash ships, it covers only the drafter. It does not cover the PQ2_0, PTQ1_0 or
  projector files, and it names a `LICENSE` and `NOTICE` that zen6-flash does not ship.
- **YaRN beyond the receipt.** The zen6 YaRN edit takes the model outside its measured regime. A
  runtime that applies YaRN statically scales every position, including the short prompts the
  receipt measured. A deployment that relies on either long context or short-prompt accuracy MUST
  measure its own.
- **Uncalibrated KV cache.** The FP8 KV cache ran with uncalibrated scales, and the qualification
  record says so. This affects accuracy, not isolation.
- **Custom tensor types.** zen6-flash stores weights as GGML type 142 behind a Hadamard
  transform. Only a runtime that implements that type decodes them; any other loader MUST refuse
  the file rather than guess.
- **Licence.** zen6-coder is licensed qwen-community-1.0, not Apache-2.0. Its terms bind anyone
  who redistributes or serves it.
- **Remote code.** No Zen6 repository ships Python, and none carries the `custom_code` tag.

## References

- HIP-0039 Zen; HIP-0043 inference engine; HIP-0510 Enso router; HIP-0511 model families.
- https://huggingface.co/zenlm/zen6 · https://huggingface.co/zenlm/zen6-coder ·
  https://huggingface.co/zenlm/zen6-flash
- Upstreams: `RadixArk/Qwen3.8-27B-NVFP4`, `incoai/Qwen3.8-27B-DFlash2`,
  `unsloth/Qwen3.8-Flash-Next-GGUF`, `prism-ml/Ternary-Bonsai-2-27B-gguf`,
  `ProCreations/Ternary-Bonsai-2-27B-DFlash2`.
- https://github.com/zenlm/zen6 · https://github.com/zenlm/zen6-coder ·
  https://github.com/zenlm/zen6-flash

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
