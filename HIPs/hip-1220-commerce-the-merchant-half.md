---
hip: 1220
title: Commerce — The Merchant Half
author: Hanzo AI
type: Standards Track
category: Application
capability: commerce
status: Final
created: 2026-08-20
requires: HIP-0018, HIP-0026, HIP-0106, HIP-0139
---

# HIP-1220: Commerce — The Merchant Half

## Abstract

`/v1/commerce` is selling: checkout, subscriptions, invoices, spend alerts,
payment webhooks, the storefront and its catalog, carts, priced SKUs and the
typed payment endpoint. It is `hanzoai/cloud` `apps/commerce`, which mounts the
`hanzoai/commerce` module natively on the cloud's own router — one router, one
specificity space, zero handler adaptation (`apps/commerce/mount.go:3-14`).

This HIP states the target surface — one root for every merchant noun — and the
boundary with `billing`, the customer money endpoint HIP-0018 declares: commerce is
the merchant half and the store it owns; billing is the address a customer's
money questions are answered at.

## Motivation

The app answers at eight top-level roots today (`manifest/apps.go:116`), which
puts a cart, a storefront and a payment in three different generated client
classes for one subsystem. HIP-0139 §7.1's default closes that: an app with one
store is one capability, however many nouns it answers for.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 One root

Every route commerce serves MUST be under `/v1/commerce`:

- `/v1/commerce/cart` — the shopper's basket (from `/v1/cart`; HIP-1220).
- `/v1/commerce/catalog` — the merchant catalog rows in commerce's store,
  merging the SuperAdmin CRUD now at `/v1/catalog/*`.
- `/v1/commerce/payments` — the typed payment endpoint (from `/v1/payments`;
  HIP-1220).
- `/v1/commerce/plans` — plan ROWS in commerce's datastore (from
  `/v1/plans/{entries,seed}`). The `/v1/plans` root is the plans capability's;
  these rows are not that catalog and take commerce's prefix.
- `/v1/commerce/store` — storefronts, listings, checkout (from `/v1/store`;
  HIP-1220).
- the tenant-admin surface, from `/_/commerce` — HIP-0139 §3.3, nothing outside
  `/v1`; same audience, same binary. This half of the fold lands in the
  `hanzoai/commerce` module, which registers those routes (one module release).

Where the router still serves the old spellings, the pairs are the `commerce`
lines in cloud's `openapi/misfiled.txt`, and each closes by fold, never alias.

### §2 The billing boundary

Commerce MUST NOT serve `/v1/billing`. That address is billing's (HIP-0018),
answered over the plane; commerce keeps the store and publishes the plane
operations — balance, the prepaid gate, credit, usage, transactions, spend and
scope rules (`apps/commerce/mount.go:204-210`) — that the money endpoint and every
metered surface debit through. One store, one publisher, one address that is
somebody else's.

### §3 The store it owns

Per-tenant merchant and money stores under `<DataDir>/commerce`
(`apps/commerce/mount.go:319-323`), encrypted under the process master key when
the sqlcipher codec is linked. The at-rest posture is decided in exactly one
function (`apps/commerce/mount.go:161-170`): a production build refuses to open
money data unencrypted, and a pure-Go dev build gets the module's documented
unencrypted dev store rather than no money plane at all.

The customer ledger of record is NOT here: `EmbedConfig.Ledger` injects
`apps/finance`, so a credit minted by a settled charge lands in the one ledger
(`apps/commerce/mount.go:6-8`).

### §4 Tenant

The paying org is read from the validated principal (HIP-0026) and never from a
request field — a field is caller-supplied, and an org read from one is a
cross-tenant write the caller asserted for itself
(`apps/commerce/payments.go:25-30`). A card payment taken here can only credit
the caller's own org.

### §5 Price, and the screen on the mint

The surface is free, in those words: `Price: cloud.Free`
(`plugin/commerce/main.go:21`) — it is the path to payment itself. The meter
downstream of the edge is the one §2 publishes.

Both endpoints that mint spendable balance from a settled charge — the browser
top-up and the typed payment op — MUST wrap their handler, not their route, with
the one risk screen (`apps/commerce/mount.go`, the credit-screen note;
`apps/commerce/risk.go`): a typed op is projected four ways and only the handler
is the point all four run through.

### §6 Events and observability

No `commerce.<noun>.<verb>` events reach the platform bus, so a customer's
webhooks (HIP-1310) receive nothing from it directly. A settled charge is
stated once, as the analytics event `order_completed` through the same capture
core `POST /v1/event` reaches (`apps/commerce/emit.go:24-31`, `:58`, `:80`) —
counted by the same lenses, forwarded by the same destinations fan-out. The
emit is detached and bounded: a conversion row is expendable, a settled payment
is not. Beyond the request span every route gets, it emits nothing.

### §7 Typed and declared

The operations this repo owns are typed: payments, invoices, cart, the health
probe and the plane ops. The embedded module's surface is declared with prose
beside the live route (`apps/commerce/describe.go:3-14`), which cannot add an
operation, only explain one that exists. Each declared route is a typing the
module still owes — the honest typed op exports a value-taking core from the
module first — not a route that can never be typed
(`apps/commerce/mount.go`, the module-handler note).

### §8 Stage and upstream

The stage is `ga` — the manifest row declares none, and absent is `ga`
(HIP-0139 §8).

It derives from `hanzoai/commerce` (pinned v1.50.58 in cloud's `go.mod:18`),
dual-licensed MIT / Apache-2.0. The whole module survives in HEAD — routes,
datastore, middleware — embedded in-process. PAN-touching paths relay to the
out-of-process Payments/Vault; this binary holds tokens and intent ids only
and is not in PCI-DSS scope (`apps/commerce/mount.go:16-19`).

## Rationale

The alternative to the fold is a split into cart, store, payments and catalog
capabilities. All of them read and write commerce's one datastore, so the split
is four apps on one store — the defect HIP-0139 §7.2 refuses by name. The nouns
stay; they become path segments of the app that owns their rows.

## Security Considerations

The wrong implementation hands an attacker the mint. A screen mounted on the
router instead of the handler leaves the same authorized deposit reachable
unscreened through the tool projection; an org taken from a request field turns a card
payment into a cross-tenant credit; a per-config at-rest posture lets a
production build quietly write plaintext money data where the per-build
decision in §3 refuses to boot.

## References

- HIP-0018 — Payment Processing Standard
- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-1220 — Cart · HIP-1220 — Payments · HIP-1220 — Store

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
