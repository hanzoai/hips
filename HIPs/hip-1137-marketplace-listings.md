---
hip: 1137
title: Marketplace — Listings and Installs
author: Hanzo AI
type: Standards Track
category: Interface
capability: marketplace
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1137: Marketplace — Listings and Installs

## Abstract

`/v1/marketplace` is the shop for tools and agents: browse, install into your
project, publish your own free or priced. It is a thin layer over the unified
tool plane — discovery reads the tool registry, install and uninstall ARE the
registry's activation writes — plus a listing store that says what a tool costs
and which wallet is paid. Marketplace never dispatches a tool and never moves
money itself. It is implemented in `hanzoai/cloud` at `apps/marketplace`
(HIP-0106).

## Motivation

A marketplace that keeps its own installed-tools table drifts from the registry
that actually dispatches, and a price that lives only in one process's memory
is not enforced anywhere else. Both defects were real here: the price table,
the charger and the wallet resolver were process-globals, the fleet runs one
process per app, so in the settling process the table was nil — and reading a
nil table as "nothing is priced" made every listed tool free the moment the
fleet split (`apps/marketplace/marketplace.go:17-33`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 One store, and what is deliberately not in it

The listing store is one encrypted SQLite file, the deployment's own
`marketplace` (`apps/marketplace/store.go:51`), keyed by (publisher_org, id) —
a publisher only ever mutates its own listings. Installs are NOT in it:
install and uninstall are the tool registry's activation writes for the
caller's (org, project), so there is one store and one truth for what is
active (`apps/marketplace/marketplace.go:8-15`).

### §2 The address

Six operations under `/v1/marketplace`, all typed: discovery (catalog plus
listing overlay plus installed flag), the caller org's own listings, publish,
unpublish, install, uninstall. A published listing must name a tool that
already resolves in the publisher's own scope, so a listing can never
advertise a capability that does not exist; a priced listing must name the
payout wallet, so a monetized offer is never unpayable; the price is exact to
18 decimal places, so a per-call price below a cent is a real price and not a
rounded-away zero.

### §3 Money: the table here, the rail elsewhere

Marketplace itself is free (`cloud.Free`, `plugin/marketplace/main.go`). A
monetized listing is enforced per call by the x402 rail, and the enforcement is
four internal-plane operations, each served by the process that owns the
answer: tools asks x402 to settle; x402 asks marketplace what it costs and who
is paid; x402 asks wallets to resolve the payee; x402 asks commerce to credit
it (`apps/marketplace/marketplace.go:33-44`). The in-process seam stays the
fast path where an owner is co-resident; both paths are the same policy and
both fail closed, asserted against each other by a one-process test and a
five-process test (`apps/marketplace/marketplace.go:45-48`).

On the plane, the price answer carries the row's recipient, never a request's:
a buyer that could state either would buy at its own price or redirect the
credit. `priced=false` means FREE and is an ANSWER — an unlisted tool lands
there — while a store failure is an ERROR, because "I could not look it up"
must never read as "it costs nothing" (`apps/marketplace/rpc.go:22-33,47-50`).
The price op reads no tenant and requires none: a price is the shop window,
the same figure for everyone.

### §4 Tenancy

Every REST operation is org-gated on the validated principal (HIP-0026),
parked by the bridge the composer installs once at the root. The payee is
structurally the publisher's: PublisherOrg is the payee org, and the wallet id
resolves only within the org that is asked for, which makes a cross-org credit
unconstructible rather than merely unlikely
(`apps/marketplace/store.go:25-31`).

### §5 Events, observability, stage, upstream

It publishes nothing on the bus and emits nothing beyond the request span
every route gets. Stage `ga`: it is the install door of the core tool plane.
It derives from no upstream.

## Rationale

The alternative to "install is activation" is a marketplace-owned installs
table, which is a second copy of the registry's fact — the defect the plugin
contract names — and it would disagree first exactly where it matters, on
whether a priced tool is active. The alternative to asking the owning process
for the price was replicating the table into the rail's process, a cache that
turns every price change into a coherence problem on the money path.

## Security Considerations

The money path is the exposure, and its two failure shapes are opposite. Fail
open: a missing price table read as "free" dispensed paid tools for nothing —
closed by making absence an error and free an explicit answer. Redirection: a
caller-influenced recipient or price turns the rail into a payout to the
attacker — closed by binding both to the listing row, publisher-owned and
publisher-org-payable only. The listing store's own writes are bounded by the
(publisher_org, id) key, so a tenant can unpublish only what it published.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
