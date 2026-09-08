---
hip: 1112
title: Catalog — Cross-Org Discovery
author: Hanzo AI
type: Standards Track
category: Interface
capability: catalog
status: Final
implementation-go: shipped
created: 2026-08-20
requires: HIP-0026, HIP-0139
---

# HIP-1112: Catalog — Cross-Org Discovery

## Abstract

`/v1/catalog` is one place to browse every project, app and site built on the
platform, whichever org built it. It is implemented in `hanzoai/cloud`
`apps/catalog`, and it owns no store: the corpus lives in the lexical index
(`apps/index`, the store the Meilisearch REST dialect serves), so relevance,
paging, persistence and encryption at rest are the ones the platform already
runs. What this capability adds is the one thing the index cannot express on
its own — a corpus that spans orgs — and this HIP states how that stays safe.

## Motivation

The index pins every row to an org and every query to one org. That is the
right default and it makes discovery impossible: a template or a community
project is findable only by the org that built it. The two hanzo.app lanes —
/templates and /community — need one corpus they are both views of, cut on the
`origin` axis, so they cannot disagree (`apps/catalog/catalog.go:41-45`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 Two corpora, not a weaker filter

Cross-org discovery MUST be a second corpus, never a widened query
(`apps/catalog/catalog.go:14-25`):

- **`~catalog`**, the published, world-readable corpus. Every caller reads it.
  No principal can write it, because an org id is minted from a validated IAM
  owner claim and IAM org slugs begin with an alphanumeric — so no principal
  can ever *be* `~catalog`.
- **the caller's own org**, read with `principal.Org` and nothing else
  (HIP-0026). An anonymous caller simply gets the published corpus
  (`apps/catalog/catalog.go:290`).

A private project cannot appear in another tenant's results because the query
that would return it is never run for them. Each row carries `scope` saying
which corpus it came from, so a client can warn before sharing a link.

### §2 No write route

The surface is one operation: `GET /v1/catalog` — search and browse with the
`q`, `org`, `kind`, `archetype`, `language`, `origin`, `template`, `forkable`
and `official` filters, answering the page, the total before paging, and facet
counts. There is no write route. The published corpus reconciles itself from
sources that are public by construction (`apps/catalog/sync.go`), and the swap
lands over the internal plane — a socket the edge router does not carry — so
"no write route" stays literally true of every surface a caller can reach
(`apps/catalog/catalog.go:26-33`). No credential exists that could promote a
tenant row into the published corpus.

### §3 Money, events, telemetry, stage, upstreams

Free (`plugin/catalog/main.go:21`, `cloud.Free`). It publishes no events on the
bus and emits nothing to observability beyond the request span. Its stage is
`ga`: it is the discovery lens of the self-service platform — the entry point
templates and community projects are found through. It derives from no
upstream; it is a query composer over `apps/index`
(`apps/catalog/catalog.go:338`, and the index-peer call at
`apps/catalog/catalog.go:357` when the index lives in another process).

## Rationale

The alternative is a catalog with its own store — a second copy of every
project row, with its own relevance, its own paging and its own encryption
story, drifting from the index the moment a project renames. Owning no store
costs one constraint (this capability can only express what the index can) and
buys the property that matters: there is exactly one place a project's
existence is recorded, so publishing and unpublishing are one write, not a
reconciliation between two.

The other alternative — one corpus with a visibility flag — is a weaker filter
by construction: every query must remember the predicate, and the first one
that forgets leaks a private project to the world. Two corpora make the leak
require a write into `~catalog`, which no principal can perform.

## Security Considerations

The attack surface is disclosure: a tenant's unreleased project appearing in
public results, or one tenant reading another's private corpus. Both are closed
structurally rather than by filtering — the public corpus is unwritable from
any authenticated surface, and the private read is pinned to the caller's own
minted org. The residual risk is the reconciler: `sync.go` MUST only ingest
sources that are public by construction, because anything it ingests becomes
world-readable by definition.

## References

- HIP-0026 — Identity and Access Management
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
