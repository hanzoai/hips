---
hip: "0039"
title: Zen — The Open-Weight Generative Family
author: Hanzo AI
type: Standards Track
category: Core
status: Final
created: 2025-01-15
requires: HIP-1211
---

# HIP-0039: Zen — The Open-Weight Generative Family

## Abstract

Zen is Hanzo's generative model family: models that write text and code and make images,
speech, music, video and 3D, plus the embedding, rerank and guard models published beside them.
It ships two ways: open weights in the `zenlm` organization on
Hugging Face, and served SKUs on `api.hanzo.ai` (HIP-1211). This HIP says what a Zen name means,
what an open-weight release must carry, and what exists, as measured on 2026-09-25.

```text
Zen     generates   open weights, served SKUs      this HIP; Zen6 in HIP-0904
Enso    routes      model=auto, the Enso SKUs      HIP-0510
Kai     decides     typed decisions                HIP-1332
Policy  governs     deterministic authority        HIP-1332 §10
```

HIP-0511 maps every family to its HIP, API and host.

The current generation is Zen6, published 2026-09-21 (HIP-0904). Zen7 is upcoming and
unspecified. Satori is being retired; Zen7 succeeds it.

This revision replaces the 2025 text. That text specified zen-600m to zen-480b checkpoints with a
"Mixture of Diverse Experts" design, a zen-gateway, benchmark and throughput tables, and prices.
None of those models exists on Hugging Face, in the catalog or on `/v1/models`, so the text is
removed rather than corrected. It is still in git history.

## Motivation

Four places described the family, and no two of them agreed:

- this HIP listed models that were never built;
- `@zenlm/models` 1.0.4 lists the zen5 lineup and has no zen5.8 and no zen6;
- `/v1/models` serves zen5, zen5.8 and zen6;
- Hugging Face holds 85 `zenlm` repositories, 81 of them public.

So a reader could not tell which Zen models exist, which are open, or what a served id runs. A
family name that means something different in each place is not a contract.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as in RFC 2119.

### §1 Names

1. A generation id is `zen<N>[-<role>]`. The generations so far are `zen3`, `zen4`, `zen5`,
   `zen5.8` and `zen6`, and `zen7` is next. `N` orders releases. It says nothing about
   architecture, size or modality.
2. An unversioned line is `zen-<role>`, for example `zen-embedding`, `zen-guard` or `zen-vl`.
3. The same id MAY name both an open-weight repository and a served SKU. They are still two
   artifacts (§2.3).
4. `zen-router` names two things: the Hugging Face classifier `zenlm/zen-router`, and HIP-0510's
   alias for `auto`. Nothing in this HIP assumes one is the other.

### §2 Open weights and served SKUs

1. **Open weights** are a public Hugging Face repository under `zenlm`.
2. **Served SKUs.** A served SKU is an id that `GET https://api.hanzo.ai/v1/models` lists with
   `owned_by: zenlm`. A SKU is live if and only if that list contains it. A site, doc or catalog
   MUST NOT call a SKU available when that list does not contain it.
3. **A shared name is not a shared artifact.**
   - A served SKU's contract is its id, context window and capabilities, as `/v1/models`
     reports them. It does not promise the weights of the repository with the same name, and a
     caller MUST NOT infer either one from the other.
   - Which model serves a SKU, and at what price, is out of scope here (HIP-0130 §3).

### §3 Release contract

Every new open-weight repository in `zenlm` MUST meet all six of the following:

1. **Upstream.** Card front matter carries `license` and `base_model`. `base_model` names the
   repository or repositories whose bytes were copied, quantized or fine-tuned, not just an
   ancestor of them.
2. **Licence files.** The repository contains `LICENSE`, and also `NOTICE` where the upstream
   has one.
3. **Base.** The base is Qwen3 or later, reached directly or through a named chain of
   `base_model` repositories.
4. **What changed.** The card says what Zen changed relative to the upstream: a re-host, a
   quantization, a config edit, or a fine-tune together with its recipe. A card MUST NOT call a
   re-host trained.
5. **Config wins.** Where the card and `config.json` disagree, `config.json` is the fact and the
   card is the defect.
6. **Numbers carry receipts.** A number on a card comes with the harness, its revision, the
   hardware and the date, or with a receipt file in the repository. zen6's `qualification.json`
   is the form to follow (HIP-0904 §6).

Measured against the 81 public repositories:

- **Base (§3.3):** 66 declare a Qwen3-or-later lineage.
  - 2 declare Qwen-Image, which carries no generation number: zen3-image and zen-image-edit.
  - 11 declare another base: zen5-mini-gguf (MiniMax), zen5-pro-gguf and zen5-max-gguf
    (DeepSeek), zen3-guard (Granite), zen3-image-fast (FLUX), zen3-image-ssd (SSD-1B), zen-world,
    zen-director and zen-video-i2v (Wan), zen-musician (YuE) and zen-3d (TRELLIS).
  - 2 declare no base: zen-scribe and zen-translator.
  - All 15 of these predate this contract.
- **Licence files (§3.2):** the three zen6 repositories carry no `LICENSE` (HIP-0904 §8).
- **Upstream (§3.1):** zen5-gguf's card declares `Qwen/Qwen3.6-35B-A3B`. Its prose says the GGUF
  was quantized from `huihui-ai/Huihui-Qwen3.6-35B-A3B-abliterated`, and its file name agrees
  with the prose.

### §4 Lineup

This section is a measurement, not a normative list. The lineup changes with every release; the
definitions in §2 do not. It was taken on 2026-09-25 with:

```sh
curl -s https://api.hanzo.ai/v1/models \
  | jq -r '.data[] | select(.owned_by=="zenlm") | "\(.id) \(.context_window)"'
curl -s 'https://huggingface.co/api/models?author=zenlm&limit=500' | jq -r '.[].id'
```

The authenticated listing returns 85 repositories. The four private ones are `zen5-flash-gguf` and
`zen5-nano-{0.8B,2B,4B}-gguf`.

#### §4.1 Generations

| Generation | Status | Served SKUs | Open weights (`zenlm/…`) |
|:--|:--|:--|:--|
| zen3 | open weights only; SKUs retired 2026-05-30 | none | zen3-asr, zen3-asr-0.6B, zen3-asr-aligner, zen3-guard, zen3-image, zen3-image-fast, zen3-image-ssd, zen3-nano, zen3-omni, zen3-tts, zen3-tts-0.6B, zen3-tts-custom-voice, zen3-tts-voice-design, zen3-vl |
| zen4 | retired 2026-05-30 | none | none |
| zen5 | shipped | zen5, zen5-coder, zen5-flash, zen5-mini, zen5-pro, zen5-spark, zen5-evo | zen5-gguf, zen5-coder-gguf, zen5-mini-gguf, zen5-pro-gguf, zen5-max-gguf, zen5-nano-9B-gguf |
| zen5.8 | shipped, served only | zen5.8, zen5.8-coder, zen5.8-spark, zen5.8-evo | none |
| zen6 | shipped 2026-09-21 | zen6, zen6-coder | zen6, zen6-coder, zen6-flash (HIP-0904) |
| zen7 | upcoming | none | none |

Four notes on the table:

- **Satori and Zen7.**
  - Satori is being retired. Its GitHub repository `zenlm/satori` is a scaffold over Open-Sora
    with no weights; its README says the model is not yet trained.
  - Zen7 succeeds Satori. Zen7 has no repository and no weights, and this HIP specifies nothing
    about its architecture, modality, size or date.
- **The `zenlm/zen5` repository.** On GitHub it describes a routed "Mixture of Diverse Experts"
  design. No checkpoint of that design is published. The Zen5 open weights are the
  single-upstream repositories listed in the table.
- **Host suffixes.** The `-spark` and `-evo` suffixes name hosts, not models. `evo` is the former
  name of `halo`.
- **Served-only.** zen5-max is open weights with no served SKU. zen5.8 is the reverse: served
  SKUs with no open weights.

#### §4.2 Unversioned lines

| Line | Open weights (`zenlm/…`) | Served SKU |
|:--|:--|:--|
| embedding | zen-embedding, zen-embedding-0.6B, zen-embedding-0.6B-GGUF, zen-embedding-4B, zen-embedding-8B, zen-embedding-8B-GGUF | zen-embedding |
| rerank | zen-reranker, zen-reranker-0.6B, zen-reranker-0.6B-GGUF, zen-reranker-4B, zen-reranker-4B-GGUF, zen-reranker-8B, zen-reranker-8B-GGUF | none |
| guard | zen-guard, zen-guard-gen, zen-guard-gen-8b, zen-guard-stream, zen-guard-stream-4b | zen-guard |
| vision-language | zen-vl-4b-instruct, zen-vl-4b-agent, zen-vl-8b-instruct, zen-vl-8b-agent, zen-vl-30b-instruct, zen-vl-30b-agent | zen-vl |
| omni | zen-omni, zen-omni-30b-instruct, zen-omni-30b-thinking | none |
| small | zen-nano, zen-nano-0.6b, zen-eco, zen-eco-instruct, zen-eco-4b-instruct, zen-eco-4b-thinking, zen-eco-4b-agent-gguf, zen-eco-4b-agent-mlx, zen-agent-4b | none |
| domain | zen-pro, zen-family, zen-blog, zen-finance, zen-legal, zen-medical, zen-multilingual, zen-sql, zen-translate | none |
| design | zen-designer-235b-a22b-instruct, zen-designer-235b-a22b-thinking, zen-designer-gguf | none |
| image, video, 3D | zen3-image family above, zen-image-edit, zen-world, zen-director, zen-video-i2v, zen-3d | none |
| speech, music | zen3-tts and zen3-asr families above, zen-dub-live, zen-scribe, zen-translator, zen-musician | none |
| router | zen-router | none |
| free lane | none | zen-free |

**Media SKUs.** zen-image, zen-voice, zen-music, zen-foley, zen-video and zen-rerank are not
served SKUs, because `/v1/models` does not list them (§2.2).

#### §4.3 Served context windows

| Context (tokens) | SKUs |
|:--|:--|
| 1,000,000 | zen5, zen5-coder, zen5-flash, zen5-pro, zen5-spark, zen5.8, zen5.8-coder, zen5.8-spark, zen6, zen6-coder, zen-vl, zen-free |
| 262,144 | zen5-evo, zen5.8-evo |
| 131,072 | zen5-mini |
| 128,000 | zen-guard |
| 32,768 | zen-embedding |

#### §4.4 Catalog

`@zenlm/models` 1.0.4 (`github.com/zenlm/models` at `b3fe63c`) calls itself the single source of
truth for Zen model definitions. It covers the zen3 and zen5 generations and the unversioned
lines. It has no zen5.8 and no zen6, so it is behind §4.1.

## Rationale

- **Why the lineup is a measurement.** Written as a normative list, it would be wrong at the next
  release. The durable rule is §2.2: live means listed by `/v1/models`. That rule is what
  exposes a stale site, doc or catalog.
- **Why SKUs and weights are separate artifacts.** Zen publishes weights for local use and sells
  a served contract. Binding the two by name would promise callers something the serving path
  is not bound to keep, and would make every serving change a breaking change to a model card.
- **Why one base lineage.** It leaves one upstream to track for runtime support in
  `hanzoai/engine` (HIP-0043) and one provenance chain to audit per release. The 15 exceptions in
  §3 are listed rather than hidden, so each can be retired or re-based on purpose.
- **Why the 2025 text was deleted rather than marked historical.** It specified models, prices
  and benchmark numbers that never existed. Kept in place, it would keep being read as the spec.

## Security Considerations

- **Refusal training.** zen5-gguf is quantized from an abliterated variant: refusal training has
  been removed, and its card says so. Open weights carry no refusal guarantee. A deployer that
  needs content safety MUST put a classifier in front, such as the zen-guard line. A served SKU is
  governed by whatever serves it (§2.3), not by these weights.
- **Re-hosts.** A re-host is as trustworthy as its upstream. The zen6 files are byte-identical to
  their named upstreams, checked by LFS SHA-256 (HIP-0904 §5). A loader SHOULD pin a commit
  rather than `main`, which can change under it.
- **Remote code.** zen-guard-stream and zen-guard-stream-4b carry the `custom_code` tag, so
  loading them runs Python from the repository. Pin the revision and read that code first. No
  other `zenlm` repository carries the tag.
- **Missing licence files.** A release without `LICENSE` does not give recipients a copy of the
  license, which Apache-2.0 §4(a) requires. §3.2 closes this for new releases. The zen6 gap is
  recorded in HIP-0904 §8.
- **What an audit covers.** Auditing an open-weight repository does not audit the served SKU of
  the same name (§2.3).

## References

- HIP-0003 Jin; HIP-0043 inference engine; HIP-0130 open-core split, §3; HIP-0135 what is public.
- HIP-0510 Enso router; HIP-0511 model families; HIP-0904 Zen6; HIP-1211 model API; HIP-1332 Kai.
- Weights: https://huggingface.co/zenlm
- Catalog: https://github.com/zenlm/models (`@zenlm/models` 1.0.4)
- Satori scaffold: https://github.com/zenlm/satori

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
