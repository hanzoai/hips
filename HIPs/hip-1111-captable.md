---
hip: 1111
title: Captable — Who Owns What
author: Hanzo AI
type: Standards Track
category: Interface
capability: captable
status: Final
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1111: Captable — Who Owns What

## Abstract

`/v1/captable` is a company's cap table: stakeholders, share classes, share
certificates and transfers, option grants and equity plans, SAFEs and
convertible notes, priced rounds and their investments, and the summary that
totals outstanding and fully-diluted ownership from them. It is implemented in
`hanzoai/cloud` `apps/captable`. This HIP states the design worth holding to:
the business logic is a ported bundle that carries no storage, the Go host is
storage that carries no business logic, and each tenant's table is its own
database file.

## Motivation

The predecessor was a standalone application — Next.js, Prisma, Postgres — that
duplicated the platform's identity, storage and deployment for one vertical.
The fold retires that deployment entirely (`apps/captable/captable.go:28-33`):
cloud's per-tenant store is authoritative from the first write, with no data to
migrate and no second pod to keep honest.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 Logic and storage are two artifacts

The cap-table logic — validation, conversion math, round mechanics — lives in a
self-contained bundle, `github.com/hanzoai/captable` (v1.0.0 in `go.mod:140`),
executed by the reusable goja host (`apps/goja`, over `dop251/goja`, MIT). The
Go host injects exactly three primitives — `__db`, `__newId`, `__now` — and
gives each request one SQLite transaction (`apps/captable/captable.go:9-22`).
The bundle MUST NOT reach storage except through them, and the host MUST NOT
reimplement a rule the bundle carries: one owner per concern, so the math
cannot drift between two copies.

### §2 The store

One SQLite file per tenant, selected by the validated org, under the host's
data directory. The org selects the file AND scopes every row
(`apps/captable/captable.go:24-26`): a cross-tenant read requires both a wrong
file and a wrong predicate, which is the point of paying for two mechanisms.
The per-tenant schema is seeded on first touch (`apps/captable/schema.go:224`).

### §3 The addresses

Everything is under `/v1/captable`: `company`, `stakeholders`, `classes`,
`shares` (and `shares/transfer`), `plans`, `options`, `safes`, `convertibles`,
`rounds` (with `close` and `investments`), `investments`, and `summary` —
collection and record routes composed on one group from the single prefix.
Operations are typed through the registry; the wire tests
(`apps/captable/typed_test.go`, `bodyless_test.go`) hold the surface to it.

### §4 The in-process seam

`apps/captable/facade.go` lets a sibling subsystem — company formation, import
and fundraising flows — write to a tenant's cap table without an HTTP hop, by
dispatching the same bundle routes the handlers do. The caller MUST pass an
already-validated org (`apps/captable/facade.go:15-19`); the facade grants no
authority the HTTP path does not, it only removes the hop.

### §5 Tenancy, money, events, telemetry, stage

Every route resolves the org from the validated principal (`principal.Org` /
`principal.Acting`, HIP-0026), never a client header
(`apps/captable/captable.go:359-361`); no principal, no answer. The capability
is free (`plugin/captable/main.go:21`, `cloud.Free`). It publishes no events on
the bus. It emits nothing to observability beyond the request span. Its stage
is `beta`: a vertical application, not the agentic-OS core.

### §6 Upstreams

`dop251/goja` (MIT) is embedded as the bundle interpreter, through the shared
`apps/goja` host. `hanzoai/captable` is our own module, a port of the retired
application's tRPC logic. Storage is the `hanzoai/sqlite` facade like every
store in the binary. Nothing else is forked or mirrored.

## Rationale

The alternative to the bundle-plus-host split is a rewrite of the cap-table
math in Go. That is a second implementation of conversion and dilution rules to
keep in agreement with the one that was already trusted, and cap-table math is
exactly where a quiet divergence costs the most. Porting the logic whole and
giving it persistence keeps one implementation; the goja host is the price, and
it is shared with esign and dataroom rather than paid three times
(`apps/captable/captable.go:14-16`).

## Security Considerations

A cap table is the ownership record of a company: who holds what, at what
price, under what terms. A wrong implementation leaks a competitor's round to a
tenant, or worse, lets one tenant write another's ledger — a forged transfer is
a forged ownership claim. Tenancy is therefore physical (a file per tenant)
plus scoped (org on every row), and the org is never an input on any HTTP
route. The facade is the one path that takes org as a parameter, which is why
its contract requires the caller to have validated it first; a caller that
passes an unvalidated org has recreated the client-supplied-header hole
in-process.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
