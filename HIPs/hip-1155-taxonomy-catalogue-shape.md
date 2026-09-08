---
hip: 1155
title: Taxonomy — The Catalogue's Shape
author: Hanzo AI
type: Standards Track
category: Interface
capability: taxonomy
status: Final
implementation-go: shipped
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1155: Taxonomy — The Catalogue's Shape

## Abstract

`/v1/taxonomy` is the product catalogue's shape: which categories exist, what
each product is called, which category it sits in, what it is tagged with, and
the order the two are shown in. A TAXON is one product's place in the catalogue.
It is implemented in `hanzoai/cloud` at `apps/taxonomy`, and it is the editable
home of a thing that was source code: the console rendered its whole navigation
from a hardcoded TypeScript array — 184 products across 14 categories — so
renaming a category was a commit, a review and a deploy. Nothing about that list
is a program; it is data a person maintains.

## Motivation

The word TAXON is chosen because the obvious alternatives are not free: the
catalog app already publishes a schema called Entry, and Product is the thing
commerce charges for. A name colliding with either would make an SDK bind the
wrong shape or a reader reach for the wrong store. For the same reason this is
NOT the billing catalogue: commerce owns the priced SKU, and most rows here are
not purchasable — filing them as billing products would put priceless rows in
the ledger and make "what do we sell" unanswerable (`apps/taxonomy/taxonomy.go`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### The store

One SQLite file through the fleet's one opener (`sqlpool.Open("taxonomy", dir)`,
`apps/taxonomy/store.go:51`), two tables, `(owner, id)` as the primary key,
seeded on a first-ever boot from the committed seed. One table serves two
audiences: the platform catalogue is the rows owned by the hanzo org, a
customer's rows are owned by that customer, and there is deliberately no second
table for "customer taxonomy" — one record projected per audience cannot drift
into two answers.

### The address

One read, four writes, all typed: `GET /v1/taxonomy` returns the whole ordered
catalogue; `PUT`/`DELETE` on `/v1/taxonomy/categories/{id}` and
`/v1/taxonomy/taxa/{id}` create-or-replace and remove one row. There is no POST
beside the PUT: an id is a stable slug the editor chooses, so the URL addresses
the row whether or not it exists and create and replace are the same act. There
is no PATCH for the same reason — a list editor sends what the row should BE.

### Tenancy

The read is the platform's rows PLUS the caller's own, and never another
customer's. A signed-out visitor gets the platform catalogue alone — which is
what the marketing landing renders from — public by the mechanism the binary
already has: the identity middleware never rejects, it strips and re-mints, so a
route is public by not calling a gate. Who is calling decides only whose rows
join the platform's, and whether unpublished ones are shown.

Writes use the platform's two existing scopes and add no third: an org admin
edits their OWN org's rows (org from the validated principal, HIP-0026); only a
SuperAdmin (`cloud.Super`) edits the platform's. The platform owner is the hanzo
org, which is deliberately NOT the SuperAdmin org — whose products these are is
a different fact from who holds platform sudo — so an admin OF the hanzo org is
still refused the platform rows unless they are also platform sudo.

### Money, events, observability, stage

It is free — the surface declares `cloud.Free` (`plugin/taxonomy/main.go`). It
publishes nothing on the bus and emits nothing beyond the request span every
route gets. The stage is `beta`, declared on the manifest row (`Stage: Beta`):
per HIP-0139 §8 the prefix is flag-gated until promotion, though the console's
navigation and the marketing landing already render from this store.

### Upstream

It derives from no OSS. The data lineage is the console's own hardcoded array,
promoted into a store; the seed is that promotion, committed beside the app.

## Rationale

The alternative to `(owner, id)` is a global id, and a global id is an oracle:
one org's write would fail because a different org already used that slug, and a
refusal is an observation — org A learns org B holds "crm" without reading a
row. Two customers may each have a "crm", and neither may learn the other
exists. Lists (tags, brands) are stored as JSON text rather than join tables
because nothing selects by tag from the database — a caller's whole catalogue is
one small read — and a join table per list would triple the schema to answer a
question nobody asks.

## Security Considerations

The escalation to guard is org admin reaching platform rows: a customer admin
who could edit the shared catalogue would rename a category for every other
tenant. That is exactly what the platform-sudo scope was drawn for — an act
against shared platform state that no customer-org admin may take however much
authority they hold inside their own org — and conflating "admin of the hanzo
org" with "SuperAdmin" reopens it, which is why the two are distinct values in
the code. The rows themselves hold no secrets; within its audience everything
here is public by design.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
