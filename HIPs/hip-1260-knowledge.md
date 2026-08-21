---
hip: 1260
title: Knowledge — Wiki and Agent Memory
author: Hanzo AI
type: Standards Track
category: Application
capability: knowledge
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1260: Knowledge — Wiki and Agent Memory

## Abstract

`/v1/knowledge` is one organization's knowledge, searchable by meaning: wiki
pages a person writes, memories an agent files, and documents a connector
ingests are ONE document store, indexed into that organization's own vector
namespace on every save and read back as semantic search, a link graph, or an
imported vault. It is implemented in `hanzoai/cloud` at `apps/knowledge`. This
HIP states the property everything rests on — human wiki and agent memory are one
store indexed once, so an agent retrieves exactly what the team can read — and
the surface that exposes it.

## Motivation

A team wiki and an agent's memory are usually two systems: two stores, two
permission models, two search indexes, and an integration that copies one into
the other and drifts. Here a wiki page IS a document, a memory IS a
document, an ingested Slack thread IS a document (`apps/knowledge/kb.go:15-24`),
and one indexing path serves them all — so "what does this org know about X"
has one answer whether a person or an agent asks.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### It owns no store

The documents are the framework engine's, as module `kb`
(`apps/knowledge/kb.go:40`): CRUD, permissions and tenant isolation are the
framework's generic surface, and this capability adds behaviour, not storage.
The vectors are the shared vector store's, one collection per organization,
written only through the one index path (`apps/knowledge/index.go:22-27`).
Both stores are owned elsewhere; this capability MUST NOT open a store of its
own, and any new document kind MUST enter as a framework DocType so the same
hooks index it.

### The address

The capability answers under `/v1/knowledge`: semantic search (the RAG entry
point), the link graph, vault import, and the connector set — list, catalog,
connect, callback, sync, disconnect (`apps/knowledge/subsystem.go:84-99`).
Today's router still serves this surface at `/v1/kb`; that pair is carried by
`hanzoai/cloud` `openapi/misfiled.txt` and closes by fold, the route group
being one literal (`apps/knowledge/subsystem.go:82`).

Every operation is typed except the import, which cannot be: its body is the
upload itself — a vault zip, an `.enex` XML document or a JSON export chosen by
`?format=` — not JSON a typed input could decode, so it is declared with prose
beside the route (`apps/knowledge/subsystem.go:92-99`,
`apps/knowledge/import.go:129-150`). An importer normalizes to one pure shape
(`apps/knowledge/vault/vault.go`) and files through the same ingest path a
connector uses; no importer MAY write the store or the index directly.

### Tenant

Every handler resolves its organization from the validated principal —
`principal.Acting` (`apps/knowledge/subsystem.go:141`,
`apps/knowledge/connectors.go:223`) — and a request without one is refused.
Isolation at the index is physical AND filtered: each organization has its own
collection and every point carries the organization in its payload, so a
search must pass both (`apps/knowledge/index.go:31-35`, `:297`).

### Meter, events, observability, stage

Metered, and the unit is one connector piece run (`plugin/knowledge/main.go`,
`Price: cloud.Metered`): a long-tail connector's sync executes a JavaScript
piece on the auto engine's sandbox pods, and reaching that capacity by
in-cluster URL does not make the pod cheaper. The fee is
`CLOUD_KB_FEE_CENTS_PIECE` over `CLOUD_KB_FEE_CENTS`, defaulting to one cent —
sized like the compute it buys, one bounded execution on a pod already held —
gated before the engine is asked and debited only after it answers
(`apps/knowledge/meter.go`). The native-Go connectors start no pod and stay
free, as does everything else on the surface. The other debit lands through
`ai`: embeddings for index and query go the metered gateway path with the same
model on both sides (`apps/knowledge/index.go:50-51`).

It publishes no events on the bus. Beyond the request span it registers
nothing; its degradations are on the wire instead — indexing is fail-open (a
save never blocks on the index) and query is fail-honest, answering an empty
result with `degraded: true` rather than a 5xx or a fabricated hit
(`apps/knowledge/index.go:37-42`, `apps/knowledge/subsystem.go:124-127`).

Its stage is `ga`.

### Upstreams

It derives from none: no OSS project is forked, embedded or mirrored. The
importers implement third-party export formats from their public shapes, in
pure Go with no upstream code taken — the Lexical EditorState JSON the editor
renders (`apps/knowledge/lexical/lexical.go`), Obsidian vault markdown, Roam's
JSON export, Evernote ENEX/ENML, and the Notion API's result shapes
(`apps/knowledge/{obsidian,roam,evernote,notion}`).

## Rationale

The alternative is a dedicated knowledge service with its own database and its
own permission model. It buys nothing the framework does not already have and
costs a second tenancy implementation — the exact place a wiki leaks. Attaching
behaviour to the framework's store means the fourth app lane after cms, erp and
help reuses isolation that is already tested, and the only new code is the one
index path and the pure normalizers.

Fail-open indexing was chosen because the store is the record and the index is
derived: losing a search hit until reindex is recoverable; losing a save is not.

## Security Considerations

The surface is an organization's institutional memory — the most valuable
single corpus a tenant hands us — so the wrong implementation leaks a whole
company at once. The cross-tenant argument is doubled on purpose: a
collection-name bug cannot leak because the payload filter still excludes
foreign points, and vice versa (`apps/knowledge/index.go:31-35`).

Connector tokens are third-party credentials (Slack, GitHub, Google). They
live in KMS at a per-org path; the connector document holds only the path and
non-secret metadata, and the token is never logged
(`apps/knowledge/connectors.go:13-15`). The OAuth state is HMAC-bound to the
organization (`apps/knowledge/connectors.go:16`), so a callback cannot be
replayed into another tenant's connection.

The import route parses attacker-supplied archives; every read is bounded
(`apps/knowledge/import.go:142`, `:174`), so a crafted zip exhausts a limit, not
the process. And because everything indexed is retrieved into agent context,
ingested text is data, never instructions — the retrieval surface returns
documents and MUST NOT execute them.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
