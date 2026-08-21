---
hip: 1147
title: Search — Hybrid Retrieval
author: Hanzo AI
type: Standards Track
category: Interface
capability: search
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1147: Search — Hybrid Retrieval

## Abstract

`POST /v1/search` is one ranked result set over everything an org has stored.
It owns no store: it fuses the two retrieval stores the platform already runs —
the lexical index (`apps/index`) and the vector index (`apps/knowledge`) — into
one ranked answer, with per-leg provenance on every hit and a per-leg status on
every response. It is implemented in `hanzoai/cloud` at `apps/search`.

## Motivation

Before this surface a caller had to know which of `/v1/kb/search`,
`/v1/index/indexes/{uid}/search` and `/v1/code/search` held the answer, and got
a different request shape and a different score scale from each
(`apps/search/search.go:14-18`). One query shape over both legs ends that.
What belongs here is bounded by a rule, not a list: a query whose honest answer
has a SCORE. A query whose honest answer has a truth value — a symbol's
definition, a function's callers — belongs to `/v1/code`, because a definition
is not 0.87 relevant. And `/v1/websearch` stays separate: it searches the
public web, with a different tenancy, cost and failure model.

## Specification

The key words MUST, MUST NOT and SHOULD are to be interpreted as in RFC 2119.

### The store, and there is none

This capability owns no store and holds no state between requests. Both legs
are in-process seams of stores other capabilities own; deleting this subsystem
loses a door, not data.

### The address

One operation: `POST /v1/search`, a typed op
(`apps/search/search.go:162-178`). The manifest row routes the bare prefix here
(`manifest/apps.go:400`); the deeper product prefixes — provisioning's search
instance CRUD — still win by longest match. The request carries `query`, a
`mode` (`auto` | `text` | `semantic` | `hybrid`, where `auto` resolves to
whatever this deployment actually has), an optional project narrowing, and
paging bounded at 50. There is deliberately no `org` field on the request
(`apps/search/search.go:88-90`).

A second, in-process door exists for callers that established their tenant by
other means: `ForOrg(ctx, org, in)` — the Team transactor's path — returns the
identical fused answer with no HTTP hop, and its org is the CALLER's boundary
to have authenticated (`apps/search/search.go:200-208`).

### Tenancy

The op resolves the org from the validated principal parked on the context and
refuses when there is none; the org is then the bound every leg queries under —
the index's org predicate and the knowledge store's org field — so a caller can
never search another org by asking.

### Degradation is the contract

Every response MUST name every leg and that leg's outcome, four distinct facts
never collapsed: `ok`, `degraded` (configured and FAILED, carrying the error),
`disabled` (not provisioned — not a fault), `skipped` (excluded by the caller's
mode). A leg that is down produces results from the survivors plus an explicit
degraded entry — never a silent empty. This is not a nicety: a silent empty is
exactly how a vector-credential drift went unnoticed for five days behind a
fail-empty predecessor (`apps/search/search.go:31-36`). The response's overall
status is folded honestly: `partial` when a consulted leg failed,
`unavailable` when every consulted leg did — which a caller must not read as
"no results".

### Fusion

Ranks feed fusion; payloads map fused keys back to rows, so the `rank` package
stays a leaf that knows nothing about documents. A document both legs found
fuses into ONE reinforced hit keyed on its identity, and each hit carries its
`matched` provenance — which backend, at what rank, with what native score. The
lexical store ranks by match count and exposes no per-row score, so none is
reported for that leg: an invented number would be precision the store never
had (`apps/search/search.go:385-389`).

### Money, events, telemetry, stage, upstream

Free, said in those words: `plugin/search/main.go` declares `cloud.Free`. It
publishes nothing to the bus, so a customer's webhooks receive nothing from it.
Beyond the request span it emits one warning log per failed leg — the response
tells the caller, the log tells the operator, and the five-day outage happened
because neither was told. Stage `ga`: retrieval over the org's own data is data
core, and the manifest row declares no stage. It derives from no upstream: both
legs are in-house seams, and the Meilisearch dialect the lexical store speaks
is that capability's fact, not this one's.

## Rationale

Composition over a third store: the obvious alternative — search owning its own
index fed by both — buys ranking freedom and costs a copy of every tenant's
data that must be kept consistent with two writers it does not control. Fusing
at query time keeps one owner per document and makes this capability
stateless, which is also what makes its honesty contract cheap: a leg's status
is observed per request, not reconstructed from a sync lag. Per-leg provenance
on every hit is the debuggability half of the same choice — a fused ranking
without it cannot distinguish a hit both legs agreed on from a hit one leg saw.

## Security Considerations

The wrong implementation is a cross-tenant read dressed as relevance: an org
field on the request, or an in-process caller passing an unauthenticated org to
`ForOrg`, searches another tenant's corpus. The typed op closes the first by
construction — there is nowhere on the wire to name a tenant — and the second
is stated as the caller's boundary in the seam's own contract. The other
failure is the honest-empty inversion this surface exists to end: a leg failing
silently returns a confident subset of the truth, which for a security-relevant
query (an audit search) is worse than an error, and is why degradation
reporting is specified as contract rather than as logging.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
