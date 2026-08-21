---
hip: 1121
title: Dataroom — Documents Shared by Link
author: Hanzo AI
type: Standards Track
category: Interface
capability: dataroom
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1121: Dataroom — Documents Shared by Link

## Abstract

`/v1/dataroom` is a secure document room: upload documents, group them into
rooms, share them by access-controlled link, and watch who read what, page by
page. It is implemented in `hanzoai/cloud` at `apps/dataroom`, which runs the
ported Papermark business logic in-process rather than as a separate service.
This HIP states where the bytes live, where the rows live, and how an
unauthenticated viewer is routed to exactly one tenant.

## Motivation

The upstream product was a Next.js + Prisma + Postgres deployment — a pod, a
database and a framework for what is, to the cloud, one subsystem. The fold
(`apps/dataroom/dataroom.go:4-9`) retires that deployment: cloud serves the
surface itself, on the same per-tenant storage every folded application uses,
and the standalone pod holds nothing to migrate.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 Two stores, one owner

Rows — documents, rooms, links, viewers, page-view events — live in one SQLite
file per tenant, opened by the shared goja host with one transaction per
request (`apps/dataroom/dataroom.go:12-20`). Document bytes never touch the
bundle or local disk: they go through the object-storage seam (`deps.VFS`)
under an org-scoped opaque key, and the tenant DB persists only the key
(`apps/dataroom/dataroom.go:30-35`). Beside the tenant files sits one
system-namespace index, `link_index` (`apps/dataroom/index.go:26`) — the link
id → org routing table, the single deliberately cross-tenant piece.

### §2 The addresses

Every route is under `/v1/dataroom` (`manifest/apps.go:336`). Ten routes are
typed operations. Seven stay raw, each for a reason in the wire
(`apps/dataroom/dataroom.go:159-163`): the upload takes the file itself as the
raw body, the two `/file` routes answer a byte stream, and the four
`/view/{linkId}` routes carry no validated org a typed op could read — they are
the visitor's surface. Each raw route declares its prose beside the wire fact
(`apps/dataroom/dataroom.go:212-236`).

### §3 Tenancy

Admin routes require a validated principal and resolve the org from it
(`apps/dataroom/dataroom.go:344-346`, HIP-0026); refusal is `principal.Refused`,
never the unscoped store. Viewer routes carry no principal: the link id is
resolved through the link index to the owning org before any per-tenant store
opens, and a link with a password checks it through a bcrypt host function.
Isolation is therefore a host property — the bundle is handed a database already
pinned to one tenant and cannot name another.

### §4 Money, events, telemetry

dataroom is free, in those words (`plugin/dataroom/main.go:21`,
`cloud.Free`; not in `spend.go:275`). It publishes no events on the bus —
page views are rows in the tenant DB read back through the analytics routes,
not bus events — and it emits nothing to observability beyond the request span
every route gets.

### §5 Stage

dataroom is `beta`: a vertical application, not the agentic-OS core. The
manifest row declares it (`manifest/apps.go:336`, `Stage: Beta`), so the
capability is reached by flag (HIP-0139 §8).

### §6 Upstream

dataroom embeds `github.com/hanzoai/dataroom` v1.1.7 — the ESM-free port of the
Papermark API handlers, pinned and checksummed rather than copied in. The
upstream is Papermark, AGPL-3.0 outside its `ee/` directories (the module's
LICENSE carries the split), and what survives in HEAD is the domain logic as a
goja bundle: documents, rooms, links, viewers, analytics. The Go leaf adds only
the tenant schema, the object-storage seam, the bcrypt host function and the
link index; zero domain logic lives in Go (`apps/dataroom/dataroom.go:17-20`).

## Rationale

The alternative to the link index is scanning tenant files for a link id, which
turns every anonymous view into a walk of every tenant's store — slow, and a
cross-tenant read performed on every request instead of never. One small
routing table that maps id → org keeps the cross-tenant surface to a single
lookup whose answer is an org name, not data.

## Security Considerations

The viewer path is an unauthenticated door into tenant data by design, so the
whole exposure concentrates in the link: a guessable id is a readable dataroom.
Link ids are crypto-random, a passworded link verifies through bcrypt before
any page is served, and the index answers only the owning org — never rows. The
other exposure is the bytes: they are keyed by org-scoped opaque keys on the
object store, so a copy of one tenant's SQLite file contains no document
content, only keys the store will not honour for another caller.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
