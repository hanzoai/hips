---
hip: 0512
title: Research — The Evidence Plane
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Active
created: 2026-07-27
requires: HIP-0111, HIP-0119, HIP-0129
---

# HIP-512: Research — The Evidence Plane

## Abstract

`/v1/research` is the durable record of what we measured and what it turned out to
mean. Every falsifiable claim across the company — a kernel A/B, a training ablation,
a pricing test, an ad creative — states a hypothesis, records its arms, and concludes
**proven**, **refuted**, or **inconclusive**. A refutation is a first-class result,
stored as plainly as a proof; an evidence plane that only kept wins would be a
marketing plane.

This HIP was cited by the shipped SDKs and the cloud subsystem before it existed. It
is written to what ships, not to an intention.

The plane answers one question the rest of the stack cannot: *did the change help?*
o11y records what happened, `/v1/eval` (HIP-0129) judges model output, and this plane
holds the standing verdict with the provenance to re-run it.

## Motivation

Before it, a measurement lived wherever it was taken. GPU results survived as `.log`
files in the home directory of the box that produced them — recoverable only by the
person who remembered the filename, and lost with the disk. Two engineers could chase
the same dead end a month apart because the first refutation was never written down
anywhere the second would look.

The failure is specific and worth naming: **a result with no home is a result you will
pay for twice.** So the plane is not a dashboard — it is a write path that a harness
can call at the moment of measurement, in whatever language the harness is written in.

## Specification

The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted as in RFC 2119.

### §1 The record

An experiment is keyed `(project, id)` where `id = kind:subject:task`. That key is the
whole idempotency story: a Rust harness, a Python notebook and a Go service that name
the same triple upsert the SAME row, so re-running a benchmark revises its result
rather than accumulating duplicates.

Fields carried on the wire, with the JSON names as the cross-language contract:

| field | meaning |
|---|---|
| `kind` `subject` `task` | the key triple |
| `metric` `value` | the headline number and its unit |
| `n` `n_total` | measured attempts / the denominator |
| `status` | `planning \| running \| complete \| faulted` — execution |
| `meta.verdict` | `proven \| refuted \| inconclusive` — epistemic |
| `meta.hypothesis` `meta.predict` `meta.because` | the falsifiable frame |
| `git_sha` `git_branch` `git_dirty` `lib_versions` | provenance |
| `revision` | `original \| corrected \| retracted` |

`status` and `verdict` are ORTHOGONAL and MUST NOT be collapsed: a run can complete
cleanly and refute its hypothesis, and a faulted run is evidence without being a wrong
answer. `git_dirty` is load-bearing — a number measured on an uncommitted tree is not
reproducible, and the plane records that rather than implying otherwise.

`kind` MUST be an open string, never an enum. `kernel-perf`, `training`, `ablation`
**and** `marketing-experiment`, `ad-test`, `pricing-test`. A marketing A/B records
identically to a kernel A/B — that symmetry is the point, because "did this change
help" is one question whatever changed.

### §2 Two planes, named

The plane is stored twice, on purpose, with a strict hierarchy:

1. **Per-org SQLite — the transactional source of truth.** The ingest write commits
   here. Reads that must be correct read here.
2. **The datastore roll-up — a projection.** Each org's rows mirror into
   `hanzoai/datastore` (column-oriented OLAP) beside `hanzo.account_usage`, reusing the
   same connection the usage warehouse uses, so the cross-project leaderboard reads ONE
   aggregate surface instead of fanning out per tenant.

**Fail-soft is the contract.** The roll-up is best-effort: an absent or still-connecting
datastore makes the mirror a no-op whose error the caller swallows. Losing a roll-up
MUST NEVER fail an ingest whose SQLite write already committed. A dropped projection is
a query-completeness problem; a dropped ingest is a lost measurement.

**Versioned and retained.** `content_hash` is part of the warehouse ORDER BY key, so
every distinct version of an experiment is its own row. `ReplacingMergeTree(ts)`
collapses ONLY a re-roll-up of the same version — idempotent dedup of one observation,
NOT supersession across versions. History is not overwritten by a correction; a
`corrected` or `retracted` revision sits beside what it revises.

### §3 Producers

Four, verb-for-verb, because the plane is only as good as the harnesses that can reach
it and harnesses are not written in one language:

- Python — `hanzo/python-sdk/pkg/hanzo-research`
- TypeScript
- Go — `hanzoai/research`, stdlib-only so any service imports it without a graph
- Rust — `hanzoai/research/rust`, where the GPU harnesses live

A producer MUST emit the §1 JSON names verbatim. A producer SHOULD be inert without a
key — every verb a no-op returning success — so a `record` call is safe to leave on a
production path where no key is provisioned.

### §4 Surface

`POST /v1/research/experiments` ingests a batch (`{experiments:[], attempts:[]}`, both
arrays always present); `GET` the same path lists canonical rows. `GET
/v1/research/totals` is the headline aggregate, `GET /v1/research/projects` the
per-project roll-up, `POST /v1/research/artifacts` files a content-addressed diary
artifact, and `POST /v1/research/grants` sets visibility.

Auth is the per-org key ONLY. The client MUST NOT send `X-User-Id` or `X-Org-Id` — the
gateway mints the validated principal, and a client-supplied tenant is a forgery the
edge strips.

### §5 Private by default

Recording is not publishing. Records are private; `trainable` and `publishable` are
each a SEPARATE authorized grant against a stable id. Nothing becomes training data or
a public claim as a side effect of being measured.

## Open question — the noun

The routes ship as `/v1/research`, but "research" also names a product capability
(agentic deep research, a `mode` on `/v1/answer`). The plane's own code already calls
itself "the R&D EVIDENCE plane". Renaming the surface to `/v1/evidence` — the record —
beside `/v1/experiment` — the process that produces it — would free the word and name
each thing what it is. That rename touches four SDKs and a live surface, so it is
recorded here as the open decision rather than made silently.

Related: §4's sub-resources are plural, which HIP-0119 §2's resource grammar would
write singular. The tension is stated rather than quietly broken; resolving it belongs
with the rename, in one pass.

## References

HIP-0111 (identity) · HIP-0119 (service conventions) · HIP-0129 (the eval plane) ·
`hanzoai/cloud/clients/research` · `hanzoai/research`
