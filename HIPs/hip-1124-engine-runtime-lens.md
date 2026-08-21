---
hip: 1124
title: Engine — The Serving Runtime Lens
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: engine
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1124: Engine — The Serving Runtime Lens

## Abstract

`/v1/engine` reports what the serving runtime behind Hanzo's models has loaded
and the hardware under it. The product is `github.com/hanzoai/engine` — the
Rust inference engine — and the cloud subsystem at `apps/engine` reimplements
none of it: every operation is a typed passthrough to the engine deployment's
own management plane over an HTTP seam (`apps/engine/engine.go:9-16`). This HIP
states the honest slice that is served, why it is read-only, and why inference
is deliberately somewhere else.

## Motivation

Twenty-two paths were once authored for this product — GPU clusters, jobs, Ray,
pipelines, fleet inventory — and were deleted as unserved: nothing answered
them anywhere (`apps/engine/engine.go:18-24`). The engine is not a cluster
manager. What it genuinely answers is its own management plane, and a
capability that claims more than the runtime serves is the defect the deletion
closed. This HIP pins the slice to what a live backend has proven.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The served slice

Four operations, all GET, each proven against a live `hanzo-server` and
re-proven on demand (`apps/engine/live_test.go`): `status` (reachability plus
build revision), `models` (the server's model table with load state), `model`
(one model's state, addressed by query because model ids carry slashes),
`system` (the host's device inventory). Three of the four relay the product's
payload verbatim as a raw message — the model list is the server's own
envelope, the system report its own document — so this plane carries no schema
of its own for them and therefore cannot drift from the product's shapes.
Every mutation the product's server exposes — load, unload, reload, tune,
requantize, doctor — is refused, and the refusal ledger is a measured gate
(`apps/engine/typed_wire_test.go`, `intentRefused`), not a comment. Cluster,
job, Ray and pipeline intent stays refused; those live on the cluster planes
where they are real.

### §2 No store

engine owns no store. Its state is the engine deployment's, read at the
in-cluster service — port 36900, the port the deployed Service actually
carries, a value corrected once from a default that named a different engine
(`apps/engine/engine.go:64-77`) — overridable via `ENGINE_UPSTREAM`.

### §3 Tenancy

The engine deployment is one shared runtime with no per-org primitive, so
every read is a platform fact. The gate is authentication, not org scoping:
no validated principal → 403 before any upstream byte
(`apps/engine/engine.go:306`, `principal.ValidatedFrom`). A validated caller
whose token names no home org is served — on a tenant-less plane that caller is
the operator this lens exists for — and both halves of the gate are pinned by
their own tests. An upstream that refuses the platform credential is reported
503, a deployment fault rather than the caller's.

### §4 Inference is not here

The fleet's one inference door is the OpenAI-compatible `/v1` surface, where
requests are metered and billed. A second completion door under `/v1/engine`
would split billing, so it MUST NOT exist (`apps/engine/engine.go:31-35`).

### §5 Money, events, telemetry

engine is free, in those words (`plugin/engine/main.go:23`, `cloud.Free`; not
in `spend.go:275`) — the billed act is inference, which happens at the other
door. It publishes no events on the bus, and emits nothing to observability
beyond the request span every route gets.

### §6 Stage

engine is `ga`: the intelligence core's runtime lens, part of the agentic OS.

### §7 Upstream

The product this plane fronts is `github.com/hanzoai/engine`, a Hanzo
repository; the cloud subsystem imports no third-party code for it and derives
from none.

## Rationale

The alternative to refusing mutations is org-scoping them, and on a shared
runtime that hands each tenant every other tenant's availability: one org's
unload is every org's missing model. Mutations arrive when engines are per-org
instances, not before. Relaying payloads verbatim, rather than remodelling
them, trades a typed response schema for the guarantee that this plane can
never disagree with the runtime it describes.

## Security Considerations

The wrong implementation is either an open window or an open switch. The
window: an unauthenticated caller reading the deployment's model and hardware
inventory — closed by the 403-before-any-upstream-byte gate. The switch: any
authenticated tenant reaching a mutation on the shared runtime — closed by the
measured refusal ledger, which a new upstream route cannot bypass silently
because the test enumerates what is refused.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
