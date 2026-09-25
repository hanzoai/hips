---
hip: 0511
title: Model Families — Zen Generates, Enso Routes, Kai Decides
author: Hanzo AI
type: Informational
category: Core
status: Living
created: 2026-09-25
requires: HIP-0039, HIP-0510, HIP-1211, HIP-1332
---

# HIP-0511: Model Families — Zen Generates, Enso Routes, Kai Decides

## Abstract

Hanzo's models fall into families by the job each does. **Zen** generates: the
open-weight generative family. **Enso** routes: the router family that picks what
serves each request. **Kai** decides: the typed decision model. **Policy**
governs: deterministic authority, not a model. This HIP maps every family and
model line to its HIP, its API and where it runs, and states the order of one
request: Enso asks Kai before it asks Zen.

It is Living: amended when a model ships, moves or retires.

## Motivation

One name was carrying several things. "Enso" is a router, a SKU family, a
diffusion fork and a browser fork. The public `hanzoai/kai-1` repositories hold
baseline weights, not Kai. Zen6 shipped open weights and a live API with no HIP
naming it. HIP-0003 described a Jin model that was never built. A reader who
wants to call a model, run one or cite one needs one table that says what a name
is, where its spec is, and whether it exists.

## Specification

This HIP requires nothing; it describes. Status words: **shipped** (served, or
downloadable, now), **in progress** (code exists, nothing served), **upcoming**
(named, not built), **retiring**, **baseline** (not ours; used for comparison).
Every fact is as of 2026-09-25:

```sh
curl -s https://api.hanzo.ai/v1/models                           # Hanzo Cloud: what serves
curl -s 'https://huggingface.co/api/models?author=zenlm&limit=500' # open weights (public)
curl -s 'https://huggingface.co/api/models?author=hanzoai'
```

`zenlm` holds 85 repositories, 5 of them private; `hanzoai` holds 3.

### 1. Families

| Family | Job | Output | HIP | API (HIP-1211) |
|---|---|---|---|---|
| Zen | generates | text, code, embeddings, images, audio, video | HIP-0039 | `/v1/chat/completions`, `/v1/responses`, `/v1/messages`, `/v1/embeddings`, `/v1/rerank`, `/v1/images/*`, `/v1/audio/*`, `/v1/videos/*` |
| Enso | routes | a model per request | HIP-0510 | `model=auto` and the `enso*` ids on the wire above; `/v1/ai/router`, `/v1/ai/feedback` |
| Kai | decides | typed state: choice, score, predicate, defer | HIP-1332 | `POST /v1/decisions` |
| Policy | governs | allow, ask, deny | HIP-1332 §10 | none of its own |

### 2. Zen

Open weights live under `zenlm/` on Hugging Face, licence and base per model
card. Hanzo Cloud serves the ids in the third column.

| Line | Open weights | Hanzo Cloud | Status |
|---|---|---|---|
| Zen6 | `zenlm/zen6`, `zenlm/zen6-coder`, `zenlm/zen6-flash` (2026-09-21) | `zen6`, `zen6-coder` | shipped |
| Zen5.8 | none | `zen5.8`, `zen5.8-coder`, `zen5.8-spark`, `zen5.8-evo` | shipped, cloud only |
| Zen5 | GGUF: `zenlm/zen5-gguf`, `zen5-coder-gguf`, `zen5-mini-gguf`, `zen5-pro-gguf`, `zen5-max-gguf`, `zen5-nano-9B-gguf`; `zen5-flash-gguf` and three `zen5-nano` sizes private | `zen5`, `zen5-mini`, `zen5-flash`, `zen5-coder`, `zen5-pro`, `zen5-spark`, `zen5-evo` | shipped |
| Zen7 | none | none | upcoming; the successor to Satori; no repository, weights or spec yet |
| Satori | none (`zenlm/satori` is a video-generation scaffold on Open-Sora, never trained) | none | retiring; replaced by Zen7 |
| Vision-language | `zenlm/zen-vl-{4b,8b,30b}-{instruct,agent}`, `zenlm/zen3-vl` | `zen-vl` | shipped |
| Embedding | `zenlm/zen-embedding`, `zen-embedding-{0.6B,4B,8B}`, GGUF for 0.6B and 8B | `zen-embedding` | shipped |
| Guard | `zenlm/zen-guard`, `zen-guard-gen`, `zen-guard-gen-8b`, `zen-guard-stream`, `zen-guard-stream-4b`, `zen3-guard` | `zen-guard` | shipped |
| Reranker | `zenlm/zen-reranker`, `zen-reranker-{0.6B,4B,8B}` and their GGUF | not listed | open weights only |
| Speech | `zenlm/zen3-asr`, `zen3-asr-0.6B`, `zen3-asr-aligner`, `zen3-tts`, `zen3-tts-0.6B`, `zen3-tts-custom-voice`, `zen3-tts-voice-design`, `zen-dub-live` | not listed | open weights only |
| Image | `zenlm/zen3-image`, `zen3-image-fast`, `zen3-image-ssd`, `zen-image-edit` | not listed | open weights only |
| Video | `zenlm/zen-director`, `zen-world`, `zen-video-i2v` | not listed | open weights only |
| 3D, music | `zenlm/zen-3d`, `zen-musician` | not listed | open weights only |
| Earlier lines | `zenlm/zen-nano*`, `zen-eco*`, `zen-omni*`, `zen-pro`, `zen-agent-4b`, `zen-designer*`, `zen3-nano`, `zen3-omni`, `zen-finance`, `zen-legal`, `zen-medical`, `zen-sql`, `zen-multilingual`, `zen-translate`, `zen-translator`, `zen-blog`, `zen-scribe`, `zen-family` | not listed | open weights; not served |

Hanzo Cloud also lists `zen-free`.

### 3. Enso

| Member | HIP | API | Runs | Status |
|---|---|---|---|---|
| Router | HIP-0510 §1–§4 | `model=auto` (alias `zen-router`); the response header `X-Routed-Model` names what served | Hanzo Cloud; code open in `hanzoai/engine` and `hanzoai/ai` | shipped |
| SKUs | HIP-0510 §5 | `enso`, `enso-auto`, `enso-flash`, `enso-free`, `enso-pro`, `enso-ultra` | Hanzo Cloud only | shipped |
| Router model | HIP-0510 §8 | `zen-router`, called by the gateway only when `router.endpoint` is set | open weights (`zenlm/zen-router`) | experimental |
| Enso Diffusion | HIP-0510 §8 | none | code only (`zenlm/enso`) | research code; no weights |
| Enso Browser | HIP-0510 §8 | none | none | unreleased private fork |

### 4. Kai

| Item | HIP | API | Runs | Status |
|---|---|---|---|---|
| Kai, one line (`hanzoai/kai`) | HIP-1332 | `POST /v1/decisions` (§17); `enso.decide` in process (§13) | self-hosted or Hanzo Cloud (§20) | in progress: code in `hanzoai/decision` (private); no checkpoint published; `/v1/decisions` answers 404 on api.hanzo.ai |
| `hanzoai/kai-1`, `kai-1-multilingual`, `kai-1-agent` | HIP-1332 §18 | none | open weights on Hugging Face | baseline: Laya weights, byte-identical to upstream; the cards are titled Laya; not a Kai version |
| Laya, Jev | HIP-1332 §18 | none | upstream | baseline; not ours |

### 5. Other names

| Name | HIP | Status |
|---|---|---|
| Jin | HIP-0003 | not built as specified: `hanzoai/jin` was archived 2026-05-12 and holds JEPA representation-learning research |
| HLLM | HIP-0002 | a specification; no model or weights exist |

### 6. One request, in order

HIP-1332 §13 makes Kai native to Enso. Enso splits every operation into a bounded
decision or generation:

```text
request ─▶ Enso
            ├─ bounded decision: model, context depth, tools, reasoning budget,
            │  stop, retry, escalate
            │     └─▶ Kai ─▶ typed answer ─▶ Policy (allow < ask < deny) ─▶ act
            │            └─ defer ─▶ Zen
            └─ generation ─▶ Zen, on the model Enso chose
```

A Decision Program (HIP-1332 §5) is the graph form of the same split. Its nodes are
deterministic, Kai, Zen, solver, simulation or human, and only the Zen nodes
generate, so an agent workflow spends generative compute only where generation is
the work.

Today the routing decision is the router's own policy (HIP-0510 §1): rules, then
`xᵀWp`. Kai takes a decision over one program at a time, `shadow`, then
`advisory`, then `enforced` (HIP-1332 §13.1). On 2026-09-25 no program has made
that move: no repository implements `enso.decide`.

### 7. Calling each family

```sh
# Enso picks the model; X-Routed-Model says which one served.
curl https://api.hanzo.ai/v1/chat/completions \
  -H "Authorization: Bearer $HANZO_API_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"auto","messages":[{"role":"user","content":"Summarize this diff."}]}'

# A Zen model by name.
curl https://api.hanzo.ai/v1/responses \
  -H "Authorization: Bearer $HANZO_API_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"zen6","input":"Write a failing test for this bug."}'

# Tell the router how it did (HIP-0510 §2).
curl https://api.hanzo.ai/v1/ai/feedback \
  -H "Authorization: Bearer $HANZO_API_KEY" -H 'Content-Type: application/json' \
  -d '{"request_id":"<id from the response>","reward":1}'

# Kai (HIP-1332 §17). Specified; not served yet.
curl https://api.hanzo.ai/v1/decisions \
  -H "Authorization: Bearer $HANZO_API_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"kai","program":"agent.preflight@4","evidence":[],"state":{}}'
```

### 8. Names that collide

- `zen-router` is both the gateway's alias for `auto` (HIP-0510 §1) and the router
  model `zenlm/zen-router`.
- The Enso Browser tree still carries its upstream's name, "Zen Browser", which is
  also the generative family's name.
- `hanzoai/kai-1*` carry the Kai name and Laya weights.
- Enso names both the router family and Enso Diffusion, which does not route.

## Rationale

Families are split by job, not by architecture or vendor, because the job decides
the API and the cost. A generation spends tokens; a decision has a known answer
space and generates none. Putting routing and decisions in their own families is what
lets a request reach a generative model only when generation is the work.

## References

- HIP-0039 — Zen, the open-weight generative family
- HIP-0510 — Enso, the router family
- HIP-1211 — AI, the model API
- HIP-1332 — Kai, the decision model and the decision plane
- HIP-0002 — HLLM; HIP-0003 — Jin

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
