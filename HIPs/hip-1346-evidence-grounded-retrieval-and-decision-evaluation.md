---
hip: 1346
title: Evidence-Grounded Retrieval and Decision Evaluation
author: Zach Kelling, Hanzo AI Research
type: Standards Track
category: Core
status: Draft
implementation-go: partial
implementation-rust: partial
created: 2026-11-16
requires: HIP-0119, HIP-1332, HIP-1334
---

# HIP-1346: Evidence-Grounded Retrieval and Decision Evaluation

## Abstract

This specification defines canonical evaluation harnesses, immutable vector index metadata contracts, retrieval-policy boundaries between `Kai` and `Zen`, and Research Bounties #21 through #30 across `hanzoai/index`, `hanzoai/agents`, and `hanzoai/ml`.

## Motivation

Adding another index backend does not solve poor evidence selection, silent dimension or prefix mismatches across flexible embedding models, or ungrounded hallucinations. Moreover, retrieval workflows frequently waste latency fetching unnecessary context or concatenating distractors without objective diagnosis. Evaluating retrieval behavior, enforcing immutable vector metadata, and letting `Kai` make structured gating decisions while `Zen` handles synthesis establishes clear, measurable accountability.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as in RFC 2119.

### 1. Immutable Vector Index Metadata Contract

Every vector index or collection across `hanzoai/cloud`, `hanzoai/index`, `hanzoai/memory`, `hanzoai/brain`, and `hanzoai/vector` MUST persist and enforce immutable collection metadata upon creation, insert, and query:

1. `model_id` (canonical model identifier),
2. `model_revision` (pinned immutable artifact revision / commit digest),
3. `dimensions` (positive integer vector width, e.g., `128`, `256`, `512`, or `768` under Matryoshka truncation),
4. `normalization` (e.g., `l2`),
5. `query_prefix` and `doc_prefix` (asymmetric task-prefix policy).

Insertions or queries whose runtime parameters disagree with any stored metadata field MUST fail explicitly rather than mixing incompatible embeddings. Hosted comparisons (e.g., against external embedding APIs) MUST align identical dimensions, normalization, and task prefixes and account for media transfer, storage, rebuild, and query latency in addition to inference token cost.

### 2. Kai Decision vs Zen Generation Boundary

1. `Kai` (`HIP-1332`) MUST remain a structure-only decision head returning calibrated discrete choices and confidence scores for retrieve-or-answer gating (#22), source-expansion escalation (#23), and verification triggers (#30).
2. `Zen` (`hanzoai/ml` / `hanzoai/engine`) owns text/passage generation for hypothetical documents (#24), distractor-aware fine-tuning (#27), and grounded response synthesis.

### 3. Retrieval & Evaluation Bounties (Bounties #21–#30)

1. **Online On-Disk ANN Insertion (Bounty #21, `hanzoai/index`)**: Benchmark direct concurrent insertions into on-disk ANN structures under continuous query traffic (`recall@10` vs p99 query latency).
2. **Adaptive Retrieve-or-Answer Policy (Bounty #22 — Wave 1 #8, `hanzoai/agents` / `hanzoai/index`)**: Gate retrieval decisions with `Kai` before `Zen` generation, measuring avoided retrievals, factual accuracy, and total cost.
3. **Retrieval-Quality Correction (Bounty #23, `hanzoai/index` / `hanzoai/agents`)**: Detect weak evidence and invoke secondary retrieval or source expansion on corrupted or irrelevant top-k sets.
4. **Hypothetical-Document Retrieval (Bounty #24, `hanzoai/index`)**: Generate synthetic passages with `Zen` for query expansion and compare recall and dollar cost against direct query embeddings.
5. **Fine-Grained RAG Diagnosis (Bounty #25, `hanzoai/index`)**: Attribute errors across retrieval misses, irrelevant evidence, unsupported claims, and answer omissions.
6. **Visual Document Retrieval (Bounty #26, `hanzoai/index`)**: Benchmark page-image retrieval on scientific PDFs, charts, and tables against text-only extraction.
7. **Retrieval-Aware Zen Fine-Tuning (Bounty #27, `hanzoai/ml` / `hanzoai/index`)**: Fine-tune eligible `Zen` checkpoints with distractor rejection and compare citation accuracy and training cost.
8. **Temporal Memory Benchmark (Bounty #28, `hanzoai/agents`)**: Evaluate existing memory policies (`LongMemEval` updates, contradiction, temporal order, abstention, cross-session recall) without introducing a parallel memory store.
9. **Evidence-Ordering Robustness (Bounty #29, `hanzoai/agents`)**: Measure answer accuracy and token budget across document positions in packed contexts.
10. **Atomic Factuality Verification (Bounty #30, `hanzoai/index` / `hanzoai/agents`)**: Decompose generated answers into atomic testable claims linked to evidence spans and measure supported-claim precision and verifier calibration.

## Rationale

Separating retrieval gating (`Kai`), synthesis (`Zen`), and immutable embedding metadata eliminates silent recall degradation from mismatched vector spaces while yielding reproducible diagnostic baselines across memory and search subsystems.

## Security Considerations

Mixing unpinned model revisions or unsalted task prefixes inside shared collections corrupts ranking and can suppress authorized results or surface wrong-tenant/out-of-scope candidates. Immutable collection metadata (§1) plus ingress ACL checks prior to retrieval enforce scope integrity.

## References

- HIP-0119 — Hanzo Service Conventions
- HIP-1332 — Kai — The Decision Model
- HIP-1334 — Research — The Unified Research Runtime
- `hanzoai/index`, `hanzoai/agents`, `hanzoai/ml`, `hanzoai/brain`, `hanzoai/memory`

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
