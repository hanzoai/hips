---
hip: 1105
title: Benchmark — The Measurement Arena
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: benchmark
status: Draft
created: 2026-08-20
requires: HIP-0106, HIP-0139
---

# HIP-1105: Benchmark — The Measurement Arena

## Abstract

`/v1/benchmark` is one honest score for any model, on the canonical public tests
everyone quotes: a fixed catalog of benchmarks run under one standardized
harness, a leaderboard that layers what our harness measured beside what a
vendor reports, and the gap between the two as the signal. It is implemented in
`hanzoai/cloud` at `apps/benchmark`. Its sibling is `/v1/eval` — evals is your
data and your judge; benchmark is the shared public tests.

## Motivation

A reported score is a claim about a model on a protocol on a day, and claims
from different sources are routinely blended into one number. The arena's rule
is provenance-first, never blended: a provider-reported claim and a
harness-measured attempt are separate planes, each row of either carrying where
it came from, and a comparison exists only where both do
(`apps/benchmark/benchmark.go`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 Two planes, never blended

A `publishedClaim` is what a source reports — provider card or third-party
leaderboard — and every write of one MUST carry its citation; a claim without a
source is refused (`apps/benchmark/claims.go`, "a claim needs its source"). A
measured attempt is what the harness got, per item. The leaderboard shows
measured beside published with the gap computed only where both exist; a model
with only a claim shows measured null and vice versa. 274 imported claims seed
the published plane, generated from cited sources, and the measured plane stays
empty until a harness run writes it (`apps/benchmark/published_seed.go`).

### §2 The store

Append-only, idempotent by `(benchmark, item, model)`: re-running is free
(cache-before-spend), a re-scored label is a new score event, raw responses are
never overwritten. The interface is `AttemptStore` plus a claim store; the
local-dev backend is JSONL under `{DataDir}/benchmark/{attempts,claims}`, and
the cloud backend implements the same interface so the API pod stays stateless
(`apps/benchmark/store.go`). The data carries no tenant axis — the catalog is
deployment-wide and identical for every caller (`apps/benchmark/benchmark.go`,
"there is no tenant in it"), which is also why this HIP names no per-org store:
it owns one store, and that store is the deployment's.

### §3 Addresses

Nine typed operations under `/v1/benchmark`: catalog, leaderboard, compare,
history, presets, claims read/write, preset composition, and run admission.
`POST /v1/benchmark/runs` validates the model or endpoint and the benchmark ids
against the catalog and answers 202 queued; the harness that executes attempts
is out of process, and results land in the same store the reads consume
(`apps/benchmark/benchmark.go:576`).

### §4 Scores are stated with their uncertainty

A leaderboard row carries n (coverage), the run id, the measurement date, and
the 95% Wilson interval — Wilson rather than the normal approximation because
the normal one produces bounds past 100 exactly where benchmark scores live.
Two measured numbers over different item counts MUST NOT be compared, and the
board shows the latest run per model rather than a blend of every run ever made.

### §5 Money, events, telemetry, stage, upstream

Free (`plugin/benchmark/main.go`, `cloud.Free`) — the spend a run causes is
model inference, priced where inference is priced, and the append-only cache
exists to avoid repeating it. It publishes nothing to the bus. Beyond the
request span it emits structured log lines only. Stage `beta`: the manifest row declares
`Stage: Beta` (`manifest/apps.go:409`), so per HIP-0139 §8 the capability is
dropped from the public projection and its prefix answers 404 unless the
caller's org holds the `benchmark` flag. It derives from no OSS upstream; each
catalog row names the public dataset its items come from as data, and the
Python research prototype it supersedes is Hanzo's own.

## Rationale

The alternative is one blended number per model, which is what most boards show
and why they disagree. Keeping the claim plane and the measured plane separate
costs a second column and buys the only fact a reader cannot reconstruct later:
whose number each number is.

## Security Considerations

The arena's integrity target is provenance, not tenancy — there is no tenant
data to leak. The wrong implementation lets a claim masquerade as a
measurement: an uncited write, an overwrite of a raw response, or a blend of the
two planes each manufacture a number nobody can check. The refusals in §1 and
the append-only store in §2 are the controls; the seeded plane is generated,
marked, and never mixed into attempts.

## References

- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
