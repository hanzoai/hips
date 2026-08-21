---
hip: 1162
title: World — The News Feed
author: Hanzo AI
type: Standards Track
category: Application
capability: world
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1162: World — The News Feed

## Abstract

`/v1/world` is a live news feed filtered to what a project cares about: GDELT
and host-allowlisted RSS/Atom normalized into one `NewsItem` stream, narrowed
by the project's keyword/region/source pipeline, served over REST and SSE. It
is the Go backend for the World monitor frontend (`hanzoai/world`), replacing
that app's edge functions with an org-scoped, in-binary subsystem. The
implementation is `hanzoai/cloud` `apps/world`.

## Motivation

The World frontend ran its data plane as Vercel edge functions — an
unauthenticated proxy with no tenant, no per-project config that survives, and
a second deployment target beside the cloud. Moving the fetchers into the
binary gives the feed an org, gives the pipeline a durable home, and puts the
SSRF boundary where the rest of the estate's boundaries are enforced.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store

One SQLite store, `world` (`apps/world/store.go:68`), holds the pipeline
config — the feed URLs to poll plus the filters applied to the merged result.
Tenancy is the (org, project) composite primary key and a mandatory
`WHERE org=? AND project=?` on every statement. News items themselves are
never stored: they are fetched, normalized and filtered per request, with a
ten-minute in-memory TTL cache keyed on the upstream identity (feed URL, GDELT
query) — NOT the tenant, because an upstream feed's content is a public value
identical for every org, and the per-project narrowing happens after the cache
read (`apps/world/fetch.go`).

### §2 The address

Every route is under `/v1/world` (`manifest/apps.go:375`): six operations,
five typed. `GET /v1/world/stream` is the one declared route — an SSE stream
is not a value, so it carries prose beside the wire fact
(`apps/world/stream.go:120`). Two reads are public by design and carry no
tenant data: `GET /v1/world` (the front door naming the product's wires) and
`GET /v1/world/limits` (a plan's gates). Two more wires answer under this
prefix and are NOT served by this binary — `/v1/world/mcp` and `/v1/world/zap`
are carved off by the ingress and answered by world-gw; the generated document
cannot declare them (prose renders only for a route this router serves), so
`GET /v1/world` names them, and that op is the only place they appear.

### §3 Tenancy

The (org, project) tuple is `principal.Org` + `principal.Project` — the values
the identity boundary minted from the validated bearer (HIP-0026) — never a
query, body or client header. A request with no validated principal is 403,
except the two public reads in §2. The SSE bus filters on org and the stream
loop drops other projects.

### §4 Money

The surface is free, said in those words: `cloud.Free`
(`plugin/world/main.go`), no meter, no entry in the standing gate. What a plan
changes is limits, not price: rate and alert gates resolve from the
`hanzoai/plans` catalog through the one `world.*` entitlement vocabulary
(`apps/world/entitlement.go`), read, never duplicated.

### §5 Events and telemetry

It publishes nothing on the bus; a customer's webhooks receive no `world.*`
events. The SSE stream is an in-process fan-out, best-effort and non-blocking
— a slow subscriber is dropped and re-fetches truth from `GET /v1/world/news`,
which MUST remain the source of truth; the stream is a live hint. Beyond the
request span it emits only its own log lines.

### §6 Upstream

It derives from no third-party OSS: the fetchers are a Go port of this
product's own edge functions (`hanzoai/world` `api/gdelt-doc.js`,
`api/rss-proxy.js`). What it consumes are public data services — the GDELT 2.0
Doc API and the ~180 allowlisted RSS/Atom hosts, ported verbatim from the
frontend's list (`apps/world/allowlist.go`). Persistence is
`github.com/hanzoai/sqlite` (MIT / Apache-2.0 dual).

### §7 Stage

`beta`: a vertical application (an intelligence monitor), not part of the
self-service agentic-OS core. The manifest row does not yet carry a stage
field, so today the operations serve as `ga` does; the declaration here is
what the row inherits when stage lands in `manifest.App` (HIP-0139 §8).

## Rationale

Filtering after a global cache, rather than caching per tenant, was chosen
because the cached value is public news and the tenant-specific part is the
projection: caching per org multiplies identical upstream fetches by the
number of orgs and buys no isolation the filter does not already provide. The
pipeline store keeps only config because news is the upstream's fact — storing
items would make this a second archive that ages, instead of a view that is as
fresh as its sources.

## Security Considerations

The RSS fetcher is an SSRF boundary: a pipeline's feed URL is
attacker-writable config that this binary will dereference from inside the
cluster. The host MUST be on the allowlist, enforced at both the PUT write
boundary and at fetch time, including on every redirect target
(`apps/world/world.go:35`) — checking only at write time leaves a redirect
from an allowed host as a free pass to an internal address. The other exposure
is a cross-tenant pipeline read, closed by §3's composite key and the
never-caller-supplied org.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
