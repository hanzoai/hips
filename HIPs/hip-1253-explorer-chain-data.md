---
hip: 1253
title: Explorer — Chain Data
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: explorer
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1253: Explorer — Chain Data

## Abstract

Explorer is chain data read from one place: the deployment's block indexers and
how far each has caught up, and the on-chain price feeds. `hanzoai/cloud`
`apps/explorer` serves both as a thin, principal-gated translator over the
chain-data plane — it owns no chain state and never fabricates a row.

This HIP declares the capability: no store, the target surface under
`/v1/explorer`, the honest-failure contract, and the stage.

## Motivation

The console's Indexer and Oracles pages rendered "not connected" because no
API address answered with real chain state. The chain-data plane existed — an
indexer per network, a query layer over the oracle registry — but nothing
translated it into the console's shape at the one address everything else reads
(`api.hanzo.ai/v1/*`). This capability is that translation and nothing more.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store

The capability owns none. Chain state is owned by its two upstreams — the
per-network block indexer (`luxfi/indexer`, its explorer REST) and the GraphQL
query layer over the O-Chain price-feed registry (`luxfi/graph`) — reached over
one HTTP client (`apps/explorer/client.go`), based at `INDEXER_URL` and
`GRAPH_URL`.

### §2 The address

The target surface is `/v1/explorer`: `GET /v1/explorer/indexers` and
`GET /v1/explorer/oracles`, both typed (`apps/explorer/explorer.go:93`), each
keeping its envelope — `{indexers:[...]}` and `{oracles:[...]}` — unchanged.
Today both answer at their own roots, `/v1/indexers` and `/v1/oracles`; the
pairs are carried by cloud's `openapi/misfiled.txt:56,70` and close by fold —
no store, so no boundary to split on, and no single address word to rename to:
two collections under one faculty people call the explorer. The console
hard-codes both old addresses in its proxy targets and allowlist
(`console/src/components/products/IndexerModule.tsx:8`,
`OraclesModule.tsx:8`, `console/src/lib/server/proxy-allow.ts:294`); all three
MUST move in the release that folds, or the two pages render "not connected"
again — the exact failure this capability was built to end.

### §3 Honest data, honest failure

A row is never fabricated: an indexer row is a real indexer's real chain and
indexed height, an oracle row a real on-chain price feed, and telemetry the
upstream does not carry — the chain head, hence true indexing lag — is honestly
omitted rather than invented. An unreachable upstream degrades to an
honest-empty list with 200, not a 502 surfaced as a console error for every org
without a chain-data deployment; a reachable-but-empty upstream answers the
same empty list. The client maps upstream errors without masking: unreachable
is 502, a non-2xx status is that status, a GraphQL error envelope is 502 with
the upstream message.

### §4 Tenancy

Every route requires a validated principal (HIP-0026): `principal.OrgFrom`
answers 403 without one, so an unauthenticated caller reads nothing. Within a
brand the ledger is public, so there is no per-org row to leak; isolation is
per brand — each brand's cloud is wired to its own indexer and graph, so the
surfaced networks are always the caller's brand's. When a service token is
configured (`CHAIN_DATA_TOKEN`) it is sent as a Bearer to both upstreams and
never logged; otherwise the caller's own Authorization is forwarded when
present.

### §5 Metering, events, telemetry, stage

The capability is free, said in those words (`plugin/explorer/main.go:26`,
`Price: cloud.Free`). It publishes no events on the bus and emits nothing to
observability beyond the request span every route gets. Stage: `beta` — a
chain-operations vertical, not part of the agentic-OS `ga` set; per HIP-0139
§8 the prefix answers 404 to orgs without the `explorer` flag.

### §6 Upstream

The capability forks, embeds and mirrors none. Its two upstreams are reached
over the wire only — `luxfi/indexer` and `luxfi/graph`, both public
repositories — and none of their code survives in this package.

## Rationale

The alternative is for the console to dial the indexer and graph directly. That
puts upstream base URLs, auth and two decode shapes in a browser-facing proxy
per page, and repeats them in every other client that wants chain data. One
translator behind the one API address keeps the wire contract in one file and
makes the console pages ordinary API consumers.

## Security Considerations

The wrong implementation either leaks or lies. Leaking: an ungated route would
let an unauthenticated caller enumerate a brand's chain deployment, and a
logged service token would hand out read access to the chain-data plane — the
principal gate and the never-logged token close both. Lying is the subtler
failure: a translator that fabricates an indexer row or masks an upstream error
as success turns an operations page into fiction, which is why never-fabricate
and honest error mapping are stated as normative rather than as style.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
