---
hip: 1151
title: Settings — Per-Product Org Configuration
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: settings
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1151: Settings — Per-Product Org Configuration

## Abstract

`/v1/settings` is how an org configures each product it uses, secret fields
included. One engine serves every product: a product is just an `(org, product)`
key, so the console drives every product's Settings tab through this single
surface with no per-product server code. It is implemented in `hanzoai/cloud` at
`apps/settings`, and its one hard property is custody: a secret value can reach
KMS or nothing, never the database.

## Motivation

Without one configuration plane, each product grows its own — its own table, its
own masking rule, its own idea of what a secret is — and the console grows a
bespoke client per product. The drift is not hypothetical: this package once
shared a surface with the observability read paths, and separating them was the
recognition that a product's config and a product's telemetry are different
questions with different stores (`apps/settings/settings.go`, "NOT
OBSERVABILITY").

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### The store

One SQLite file, opened through the fleet's one opener
(`sqlpool.Open("settings", dir)`, `apps/settings/store.go:54`), holding one JSON
config document per `(org, product)` — that composite is the primary key and the
mandatory predicate on every statement. The document is bounded (64 KiB), and the
org value is stored exactly as minted, never normalized: casing or trimming
collapses distinct owners into one bucket.

### The address

Two typed operations: `GET /v1/settings/{product}` (read, secrets masked) and
`PUT /v1/settings/{product}` (write). The product is a console catalog slug,
validated against a DNS-label shape because it becomes both a store key segment
and a KMS ref segment — that regex is the boundary guard.

One further read lives on the internal plane, not under `/v1`: the platform's own
configuration of a product (`apps/settings/fleet_rpc.go`). It answers for the
reserved platform org and takes no org argument — the plane carries no principal,
so an op with an org parameter would be a cross-tenant read available to any app
in the pod. The constant is `authz.AdminOrg`, the same predicate the admin guard
reads, so there is no second notion of "the platform" to drift. It replaces the
environment variable as the deployment knob: an operator edits it and the next
request reads it, no restart.

### Tenancy

The org is `principal.Org` — the value the identity middleware minted from the
validated bearer owner (HIP-0026) — and MUST NOT be read from a query parameter,
body, or client header. The client chooses a product; it never supplies the org.

### Secret custody

A secret field's VALUE lives only in KMS at
`orgs/{org}/settings/{product}/{key}`; the store keeps the non-secret JSON plus
the list of secret key NAMES, so the read path knows which fields are
set-but-masked. Reads return a mask, and a PUT that echoes the mask back means
"unchanged" — the real value is never round-tripped. With no KMS configured, a
write carrying any secret MUST be refused whole (503) rather than dropped or
persisted in the clear; a secret the body omits keeps its stored value, so a
partial write never silently clears one.

### Money, events, observability, stage

It is free — the surface declares `cloud.Free` (`plugin/settings/main.go`). It
publishes nothing on the bus and emits nothing beyond the request span every
route gets. The stage is `ga`: it is the configuration plane of the self-service
console itself, and every product's detail view depends on it.

### Upstream

It derives from no upstream: the store discipline and the SQLite driver are the
fleet's own.

## Rationale

The alternative to one engine is a settings table per product, which is what the
console had to assume before this surface existed. One `(org, product)` key costs
each product the ability to have a bespoke schema — config is one opaque JSON
document — and buys the platform a single masking rule, a single custody rule and
a single client. Products that need typed, validated configuration keep it in
their own stores; this plane is for the knobs a person edits in a Settings tab.

## Security Considerations

The wrong implementation is plaintext custody: a secret written into the SQLite
file makes a copy of the deployment's data directory a copy of every org's
credentials for every product. The design closes it structurally — the write path
routes secret-shaped fields to KMS or fails closed, so the table cannot hold a
value even by bug-adjacent paths like a partial write. The second exposure is the
internal-plane read: parameterizing its org would hand any co-resident app a
cross-tenant config read, which is why the org there is a constant.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
