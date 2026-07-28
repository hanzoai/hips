---
hip: 0516
title: Translate — One Endpoint, Two Tiers, Permissive Weights
author: Hanzo AI Team
type: Standards Track
category: Core
status: Final
created: 2026-07-26
---

# HIP-516: Translate

## Abstract

`POST /v1/translate` is the one translation surface: a quality tier served by our
own models and a bulk tier served by MADLAD-400. Both sit behind one endpoint, so
callers choose cost and latency, never a vendor.

## Motivation

Translation was a third-party pipeline. Crowdin held our locale files, the workflow
that drove it had never run (`if: false`), and its config pointed at an external
project id. Removing it leaves a gap we should fill with a product rather than
another vendor: we already run a model plane, so translation is a capability we
can sell, not a bill we pay.

## Weights and the license constraint

The license decides this before quality does. The three most cited open translation
models are **CC-BY-NC** and therefore unusable in a paid service:

| Model | License | Usable |
|---|---|---|
| MADLAD-400 3B / 10B | apache-2.0 | yes |
| Opus-MT / Marian | MIT | yes |
| M2M-100, mBART-50 | MIT | yes |
| NLLB-200 | cc-by-nc-4.0 | no |
| SeamlessM4T v2 | cc-by-nc-4.0 | no |
| TowerInstruct | cc-by-nc-4.0 | no |

Verified against the HuggingFace model API, not from memory. This is not a
hypothetical risk: an audit already found NC weights shipping inside our repos.

**LibreTranslate is excluded as a component.** It is AGPL-3.0, the one license that
reaches through a hosted service to the service itself.

MADLAD-400 3B is the default bulk model: Apache-2.0, 419 languages, and by far the
most exercised of the permissive options.

## Specification

```
POST /v1/translate
  { text | batch[], target, source?, tier?, glossary?, format? }
  -> { translations[], detected_source?, tier, usage }
```

`tier` selects the engine and defaults to `quality`:

- **`quality`** routes to the model plane (zen through the gateway). It carries
  context, terminology and tone, and it is what an LLM is genuinely better at. Our
  own S2ST measurements found the LLM path beat a joint translation model on
  fluency, so this is the default on evidence rather than fashion.
- **`bulk`** routes to MADLAD-400 under CTranslate2 (MIT) for high-volume,
  low-latency, cost-sensitive work where an LLM is overkill.

Two tiers, one endpoint, one auth path, one meter. No second inference stack: the
quality tier reuses the serving infrastructure already in production, and the bulk
tier is a model behind the same door.

`source` is optional; when absent the engine detects it and returns
`detected_source`. `/v1/` only, and never a `v2` — a new capability is a new field.

## Determinism and the translation memory

LLM output is non-deterministic, so a naive rebuild rewrites every string in every
locale file. That churn is the main thing Crowdin was actually providing, and it
must be replaced rather than dropped.

`/v1/translate` therefore keys a translation memory on
`(source_text, target, glossary_version, tier)`. A hit returns the stored value
unchanged; only new or changed source strings reach a model. This makes locale
rebuilds idempotent and makes the bill proportional to what actually changed.

The memory is the mechanism that lets translation be a product rather than a
one-shot call, and it is normative, not an optimisation.

## Dogfooding

The locale sync that replaces Crowdin calls `/v1/translate` like any other client.
Our own product translation is the reference deployment, which keeps us honest: a
regression in the service shows up in our own surfaces first.

## Security and tenancy

Standard IAM: org-scoped by bearer, metered per org, no cross-tenant read of a
translation memory. Submitted text is customer content — it is not training data
and not retained beyond the memory the customer's own org owns.

## Rationale

The alternative was a dedicated translation stack (its own serving, scaling and
on-call). That is a second way to do inference, which the architecture forbids. One
model plane, two tiers, one endpoint keeps the surface orthogonal to everything
else we serve.

## References

- HIP-0510 — learned per-request model routing
- HIP-0111 — IAM authentication
