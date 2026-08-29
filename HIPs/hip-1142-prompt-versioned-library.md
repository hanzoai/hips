---
hip: 1142
title: Prompt — A Named, Versioned Value
author: Hanzo AI
type: Standards Track
category: Interface
capability: prompt
status: Final
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1142: Prompt — A Named, Versioned Value

## Abstract

`/v1/prompt` is an org's prompt library, versioned, so nothing changes
silently: creating a prompt whose name already exists appends a new version and
the prior one is retained — real, inspectable history, never a fabricated
rollup. It is implemented in `hanzoai/cloud` at `apps/prompt`, plus an
embedded read-only starter catalog.

## Motivation

A prompt is production configuration that happens to be prose. Kept in source
or in a chat scroll, it changes without a record, and the question "which
prompt produced last week's answers" has no answer. A named, versioned,
org-owned record is the smallest thing that makes that question answerable
(`apps/prompt/prompts.go:1-8`).

## Specification

The key words MUST, MUST NOT and SHOULD are to be interpreted as in RFC 2119.

### The store

One system-namespace SQLite file, `prompts.db`, opened through `sqlpool.Open`
(cek-encrypted, single-connection); tenancy is the `org` column, enforced on
every query (`apps/prompt/store.go`). It holds template text plus taxonomy and
MUST never hold a secret. The starter catalog is a separate embedded
`catalog.json` — read-only, with no write route, so nothing a customer does can
put a row in it.

### Addresses

Six operations, all typed ops (`apps/prompt/prompts.go:216-229`):

- `GET /v1/prompt` — the org's library, one row per prompt with version
  numbers and taxonomy, never the bodies.
- `POST /v1/prompt` — create, or append a version to an existing name; 201.
- `GET /v1/prompt/metrics` — real per-prompt statistics, every number counted
  in the store, nothing estimated.
- `GET /v1/prompt/catalog` — the embedded starter set, each entry importable
  as-is.
- `GET /v1/prompt/{name}` — current body plus version-history METADATA,
  capped at 100 entries and carrying no per-version bodies, so a long history
  cannot inflate the response.
- `DELETE /v1/prompt/{name}` — the prompt and its whole history; 204.

The name is both the org-unique handle and the URL segment, so it MUST match
`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` — the injection and traversal guard at the
boundary — and `metrics`, `new` and `catalog` are reserved so a prompt can
never shadow a static route (`apps/prompt/prompts.go:36-42`). A version body
is capped at 64 KiB: a prompt is a template, not a blob.

### Tenancy

Every op resolves the org through the validated principal
(`principal.Acting`); an org-less or unvalidated caller is refused before any
row is touched. A name another tenant owns answers the same 404 an unknown name
does — existence is not disclosed across the boundary.

### Money, events, telemetry

Free, said in those words: `plugin/prompt/main.go` declares `cloud.Free`. It
publishes nothing to the bus, so a customer's webhooks receive nothing from it.
It emits nothing beyond the request span every route gets.

### Stage

`ga`: the manifest row (`manifest/apps.go:163`) declares no stage, and absent
means `ga`.

### Upstream

Derives from none. Store and catalog are this repository's own code over the
platform's encrypted SQLite.

## Rationale

Append-a-version-on-name-collision, rather than 409-on-conflict or
overwrite-in-place, is the design decision the rest follows from. Overwrite
destroys the history the capability exists to keep; a 409 pushes versioning
onto every client as a naming convention (`greeting-v2`), which is versioning
without the record. Appending makes the common act — improving a prompt — the
cheap one, and makes rollback a read. History responses carrying metadata only
is the corollary: history must be inspectable without being an amplification
vector.

## Security Considerations

The name doubles as a URL path segment, so the wrong implementation is an
injection: an unconstrained name walks the route table (a prompt named
`metrics` shadows the statistics route) or smuggles path structure. The strict
name grammar and the reserved set close that at the boundary. The other
exposure is cross-tenant read: prompts routinely embed proprietary product
logic, so the org predicate on every statement — with the org taken only from
the validated principal — is the confidentiality boundary, and the shared-file
design makes that predicate load-bearing on every query rather than physical.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
