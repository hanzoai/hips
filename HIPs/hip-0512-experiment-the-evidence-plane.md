---
hip: 0512
title: Experiment — The Evidence Plane
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Active
created: 2026-07-27
requires: HIP-0111, HIP-0119, HIP-0129
---

# HIP-512: Experiment — The Evidence Plane

## Abstract

`/v1/experiment` is the durable record of what we measured and what it turned out to
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

`POST /v1/experiment` ingests a batch (`{experiments:[], attempts:[]}`, both arrays
always present); `GET` the same path lists canonical rows. `GET /v1/experiment/total` is
the headline aggregate, `GET /v1/experiment/project` the per-project roll-up, `POST
/v1/experiment/artifact` files a content-addressed diary artifact, and `POST
/v1/experiment/grant` sets visibility.

**What ships today is `/v1/research/*` with plural sub-resources.** The rename to the
paths above moves the cloud subsystem and all four producers in ONE pass — a surface
half-renamed is two surfaces, which is the thing this HIP exists to prevent.

Auth is the per-org key ONLY. The client MUST NOT send `X-User-Id` or `X-Org-Id` — the
gateway mints the validated principal, and a client-supplied tenant is a forgery the
edge strips.

### §5 Private by default

Recording is not publishing. Records are private; `trainable` and `publishable` are
each a SEPARATE authorized grant against a stable id. Nothing becomes training data or
a public claim as a side effect of being measured.

## The noun — decided

The surface is **`/v1/experiment`**, and the framework repo is **`hanzoai/method`**.

`research` named the wrong thing twice over: it is also a product capability (agentic
deep research, a `mode` on `/v1/answer`), and as a noun it describes an activity rather
than the thing recorded. What is recorded is an **experiment** — a falsifiable claim with
arms and a verdict — whether the arms are kernels, prices, or ad creatives. One surface
for R&D, product, growth and marketing, because they are the same shape and splitting
them is how a company ends up unable to ask whether a change helped.

The repo is `method` rather than `science`: `science` names a field, and a field is a
basket. `method` names the discipline actually being applied, and it is the discipline —
not the domain — that generalizes from a kernel A/B to an ad test.

Paths under it are singular per HIP-0119 §2: `/v1/experiment`, `/v1/experiment/{id}`.
The plural sub-resources this HIP documented (`experiments`, `grants`, `artifacts`) move
with the rename, in one pass, across the four producers.

## References

HIP-0111 (identity) · HIP-0119 (service conventions) · HIP-0129 (the eval plane) ·
`hanzoai/cloud/clients/research` · `hanzoai/method`
