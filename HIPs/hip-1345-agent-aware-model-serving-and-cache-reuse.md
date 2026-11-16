---
hip: 1345
title: Agent-Aware Model Serving and Cache Reuse
author: Zach Kelling, Hanzo AI Research
type: Standards Track
category: Infrastructure
status: Draft
implementation-go: partial
implementation-rust: partial
created: 2026-11-16
requires: HIP-0119, HIP-1332, HIP-1334, HIP-1343
---

# HIP-1345: Agent-Aware Model Serving and Cache Reuse

## Abstract

This specification defines architectural interfaces, multi-tenant KV isolation invariants, inference provenance fields, capability-aware Enso routing contracts, and acceptance benchmarks for Research Bounties #11 through #20 across `hanzoai/engine`, `hanzoai/ml`, `hanzoai/cloud`, and `hanzoai/index`.

## Motivation

Interactive agent loops exhibit execution patterns poorly served by generic throughput batching: non-prefix repetition of tool and system segments, large RAG KV caches that relocate in prompt position, multi-tenant LoRA customization, strict JSON-schema tool grammars, pause/resume GPU workloads, and stringent privacy/retention constraints across upstream models. At the same time, shared KV prefix caches and older third-party serving pools pose cross-tenant state-contamination hazards unless ownership boundaries and runtime provenance are enforced end to end.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as in RFC 2119.

### 1. Multi-Tenant KV Ownership, Computed Bounds & Provenance

#### 1.1 Salted Prefix & Offload Keys
Every shared KV tier in `hanzoai/engine` — GPU paged block hash (`ExtraHashKey::CacheSalt`), sequence prefix cache, disk KV spill files, and distributed `hanzo-kv-fabric` directories — MUST include the resolved tenant salt (`cache_salt` / `org_id`) in cache lookup and insertion keys when serving multi-tenant traffic.

#### 1.2 Computed-Slot Publication Bound
Scheduler block caching MUST pass strictly the count of tokens whose K/V projections were actually computed (`kv_computed_tokens`), NEVER `sequence.tokens.len()` containing an uncomputed sampled token, and MUST NOT publish incomplete blocks from aborted, errored, or prefill-canceled sequences.

#### 1.3 Runtime Provenance on Inference Traces
Every inference span and usage record emitted by `hanzoai/engine`, Enso, and `hanzoai/cloud` MUST carry `runtime_digest` (`gen_ai.hanzo.runtime_digest`) and `cache_connector` (`gen_ai.hanzo.cache_connector`) identifying the serving runtime image/digest and active KV cache connector. Pools earlier than fixed upstream baselines MUST NOT serve multi-tenant traffic.

### 2. Serving, Caching & Scheduling Bounties (Bounties #11–#20)

#### 2.1 Sparse SSD KV Offload (Bounty #11)
`hanzoai/engine` MAY prototype coarse-grained SSD KV block offload with predictive prefetching for memory-constrained deployments, reporting decoded tokens/s, p99 stall latency, and accuracy delta against full GPU KV residence.

#### 2.2 Position-Shifted Prompt Reuse (Bounty #12 — Wave 1 #1)
`hanzoai/engine` SHOULD evaluate position-independent KV reuse for unchanged system and tool segments when prompt offsets shift, measuring output equivalence, TTFT, and GPU memory footprint relative to strict prefix caching.

#### 2.3 KV-Residency-Aware & Distributed Locality Scheduling (Bounties #13, #18)
Single-node schedulers (`hanzoai/engine`, #13) and distributed Enso gateways (`hanzoai/cloud`, #18) MAY route requests using estimated KV load latency, cache residency, skew, and eviction pressure, measuring p95/p99 TTFT and goodput against least-loaded routing.

#### 2.4 Model-Loading IO Templates & Multi-Tenant LoRA Paging (Bounties #14–#15)
`hanzoai/engine` and `hanzoai/ml` MAY record weight-loading page access templates across NVMe, host RAM, and device memory (#14), and page multi-rank Zen adapters over shared base weights (#15), reporting cold-load latency, adapters per GPU, and adapter-switch overhead.

#### 2.5 Constrained Generation vs Kai Separation (Bounty #16 — Wave 1 #3)
`hanzoai/engine` MAY prototype compiled grammar masks (such as Apache-2.0 XGrammar-2 approaches) to accelerate JSON-schema and tool-call constrained text generation in Zen models. Constrained grammar decoding MUST remain scoped to generative text output; structured non-generative decision heads belong exclusively to `Kai` (`HIP-1332`).

#### 2.6 Quality-Constrained Model Routing (Bounty #17 — Wave 1 #4)
Enso (`hanzoai/cloud`) SHOULD evaluate learned cost-quality routers selecting the lowest-cost eligible model meeting a verified quality floor, subject to hard capability, plan-entitlement, and retention constraints:
- Required retention window and `zero_retention` eligibility (filtering out 30-day-retention models when ZDR is enforced).
- Compatible `thinking_family` boundaries (pinning one model per generation turn and stripping incompatible reasoning blocks on explicit model switches).
- Forced `tool_choice` and sampling parameter compatibility (returning HTTP `400` rather than silently corrupting mandatory-thinking calls).

#### 2.7 Non-Prefix RAG KV Fusion & Incremental GPU Checkpointing (Bounties #19–#20)
`hanzoai/engine` and `hanzoai/index` MAY fuse cached document KV blocks across non-prefix layouts with selective recomputation (#19, measuring TTFT and answer parity), and pause/resume inference or training state via incremental GPU checkpoints (#20 — Wave 1 #9, measuring pause/resume latency and checkpoint byte volume).

## Rationale

Unifying KV safety invariants (§1) with position-shifted reuse (§2.2) and capability-aware Enso routing (§2.6) prevents speculative serving optimizations from violating tenant isolation, zero-retention contracts, or Kai's non-generative separation.

## Security Considerations

Unsalted prefix caches or off-by-one uncomputed tail tokens can allow one tenant to attend to evicted KV projections from a prior tenant. Both `cache_salt` keying (§1.1) and `kv_computed_tokens` bounds (§1.2) MUST hold unconditionally across GPU, host, disk, and network KV fabrics. Retention-incompatible or account-bound thinking states MUST be rejected or reset before cross-model dispatch.

## References

- HIP-0119 — Hanzo Service Conventions
- HIP-1332 — Kai — The Decision Model
- HIP-1334 — Research — The Unified Research Runtime
- HIP-1343 — Visor — The Sandbox Runtime
- `hanzoai/engine`, `hanzoai/ml`, `hanzoai/cloud`, `hanzoai/index`

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
