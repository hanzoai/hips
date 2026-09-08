---
hip: 1123
title: Domain — Name Registration
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: domain
status: Final
implementation-go: shipped
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1123: Domain — Name Registration

## Abstract

`/v1/domain` is Hanzo Domains: search a name, see the price, buy it from the
org's prepaid balance. It is implemented in `hanzoai/cloud` at `apps/domain`,
reselling a wholesale registrar behind one interface and handing every new zone
to Hanzo DNS. This HIP states the purchase pipeline, where the money moves, and
what the ownership store is and is not.

## Motivation

DNS manages records for a domain an org already controls; nothing acquired the
domain. Domains is the acquisition product, distinct on purpose
(`apps/domain/domain.go:8-12`): buy here, manage records there. The core is
transport-free — availability → price → authorize → register → provision-zone →
capture → record, orchestrated over four interfaces (Registrar, Biller, Zones,
Store) — so the policy is unit-testable with no HTTP, registrar or billing
backend (`apps/domain/domain.go:13-18`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store, honestly

The registrar account is the authority on what is registered. What domain owns
is the domain↔org Holding row it writes on a successful purchase, and its
default Store is in-memory (`apps/domain/store.go:9-13`, `MemStore`) —
sufficient for a single-process deployment, swapped behind the same interface
for a durable one in a multi-replica deployment. A restart loses the
projection, never the registration.

### §2 The addresses

Every route is under `/v1/domain` (`manifest/apps.go:162`) and every operation
is typed: health, search, availability, the org's holdings, register, renew,
transfer (`apps/domain/mount.go:24-32`).

### §3 The price and the debit

The price a customer sees carries the markup applied in exactly one place
(`apps/domain/pricing.go:11-16`): multiplier over wholesale, a minimum absolute
margin, rounded up to whole cents, never below cost. A purchase is two-phase
through the Biller (`apps/domain/domain.go:57-71`): Authorize refuses with 402
when the prepaid balance cannot cover the marked-up cents — before the
registrar is touched — and Capture debits after the registrar succeeds. The
Biller is cloud's ResourceMeter (`apps/domain/mount.go:56`, `mount.go:159-186`):
Gate is the authorization, `MeterUsage` under the `domain.register` meter is the
capture, so the debit lands on the org's ledger through the same money plane as
every other charge. The plugin declares `cloud.Metered`
(`plugin/domain/main.go:29`) and the capability is in `spend.go`'s metered
list (`spend.go:299`): every purchase moves money, in integer cents.

### §4 Tenancy

Every read and every mutation resolves the org from the validated principal
(`principal.Acting`, `apps/domain/mount.go:417`, HIP-0026); the org owns the
purchase and is the ledger the charge lands on. Renew and transfer on a domain
the org does not hold answer `ErrNotOwned`; a purchase of a name the org
already holds answers `ErrAlreadyOwned` (`apps/domain/domain.go:29-40`).

### §5 Money, events, telemetry

The metered facts are in §3. domain publishes no events on the bus, and emits
nothing to observability beyond the request span every route gets.

### §6 Stage

domain is `ga`: acquiring a name for a deployment is developer tooling in the
agentic-OS core, not a vertical application.

### §7 Upstream

domain derives from no forked code. It implements the name.com Core API v4 wire
as its wholesale registrar client (`apps/domain/namecom`), and hands zones to
`hanzoai/dns`. Registrar credentials arrive as operator-injected env from the
platform secret store, never hard-coded (`apps/domain/mount.go:34-37`).

## Rationale

Two-phase billing with authorize-before-registrar, rather than charge-then-buy
or buy-then-charge, is the only order in which neither party is left holding
the other's failure: a refused balance costs the registrar nothing, and a
registrar failure costs the customer nothing. Capture deliberately takes no
idempotency key named after the domain (`apps/domain/domain.go:63-70`): a renew
and a lapse-and-rebuy are distinct acts, and keying the ledger by the name
silently collapsed them into one charge.

## Security Considerations

The wrong implementation spends someone else's balance or sells below cost.
The org on a purchase comes only from the validated principal, so a caller
cannot name the ledger to debit. The markup floor is clamped at 1 and the sell
price at cost (`apps/domain/pricing.go:23-34`), so no configuration sells below
wholesale. A deployment with no registrar credential fails every purchase
closed with 503 (`ErrNotConfigured`), and the credential itself lives in the
secret store, reachable only as injected env.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
