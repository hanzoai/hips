---
hip: 1006
title: Store — Storefronts, Listings and Checkout
author: Hanzo AI
type: Standards Track
category: Application
status: Active
created: 2026-08-20
---

# HIP-1006: Store — Storefronts, Listings and Checkout

## Abstract

`/v1/store` is a storefront: the shop record itself, the overlay that decides how
that shop presents catalog items, the least-privilege key a logged-out shopper's
browser reads it with, and the checkout that turns a cart into a paid order. It is
implemented in `hanzoai/cloud` at `apps/commerce`, over the store and checkout
model of `hanzoai/commerce`. This HIP states the three layers, the ordering rules
checkout must hold to, and the behaviours the surface refuses.

## Motivation

A storefront is read by three different callers with three different rights: an
administrator managing it, a merchant surface asking whether it may trade, and an
anonymous browser rendering it. Conflating those is how a published catalog key
ends up able to write. Separating them is most of what this capability is.

The other half is ordering. Checkout touches inventory, a payment processor and an
order record; the sequence in which it touches them decides what a failure leaves
behind.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### The three layers

**The store** is the shop record, held in the caller org's own namespaced
database. An id outside that namespace is absent there and answers 404 rather than
disclosing that it exists (`apps/commerce/describe.go:740-747`).

**The listing overlay** is an override map, not a catalog. A listing says how *this*
storefront presents an item that exists independently; removing a listing
un-overrides the item rather than deleting it
(`apps/commerce/describe.go:824-831`). Overlaying is what lets two storefronts sell
one catalog item at their own price, name and media, and the overlay MUST force the
store's own currency so a shop cannot display a price in a currency it does not
transact in.

**Checkout** turns a cart into an order — either two-step (authorize, then capture)
or one-step.

### Entitlement is per store, not per org

A store trades on its own current subscription. An org-wide balance or a sibling
store's plan unlocks nothing (`apps/commerce/describe.go:704-714`). A backing-store
failure MUST answer as unavailable — a retry signal — and MUST NOT be reported as a
denial, because "you may not trade" and "I could not find out" are different facts
and a merchant surface acts differently on each.

### The anonymous key reads and never writes

The storefront key carries published-read and nothing else, is bound to the org and
signed with the org's own secret, so it can never act on another tenant. **Minting
rotates**: the previous key is dropped and is invalid immediately, so re-minting is
how revocation happens (`apps/commerce/describe.go:728-738`). Minting MUST be
admin-gated in the handler as well as on the route, because the route's token gate
does not apply on the identity path and an ordinary member must not be able to mint
their org's key.

### The default store is provisioned lazily and idempotently

Resolving the current store from the authenticated org provisions the org's
canonical default when it has none, carrying no payment credentials
(`apps/commerce/describe.go:716-726`). Only when there is no org in context, or
provisioning fails, does the answer fall back to a placeholder named `default`,
which a storefront edge MUST treat as unconfigured rather than as a shop.

### Checkout ordering

The store is loaded **before** any payment work, and its currency **overrides**
whatever the body asked for. A store that will not load therefore ends the call
with nothing charged (`apps/commerce/describe.go:889-899`).

Items are reserved **before** the processor is called. On an authorization failure
the reservations are released and the order and payment are persisted as
**cancelled**, so a failed attempt still leaves a durable record rather than
vanishing. On a capture failure the reservations are released and the call fails,
so a failed settlement never leaves items held
(`apps/commerce/describe.go:911-919`).

Successful capture is the moment the rest of the system learns about the sale:
redemptions, referral, cart and stats are written, the confirmation goes out, and
the paid and completed events are emitted. Those side effects MUST run only on
success, and on the one-step flow only when both halves succeed
(`apps/commerce/describe.go:921-930`).

Continuing an existing order **merges** the body's order object onto the stored one
before the tally. This is the rule callers get wrong most often: it is not a
read-only reference, and a field sent there overwrites what is stored
(`apps/commerce/describe.go:901-909`).

### Two spellings, one operation

The `checkout`-prefixed addresses bind the same handlers as their shorter siblings.
They are one operation at two spellings, not two behaviours, and the prefix is the
newer one (`apps/commerce/describe.go:880-886`). New work SHOULD build against one
spelling; a future revision MUST NOT let the two diverge.

### The router must own this prefix

`/v1/store` is named explicitly on the routing table. Unowned, it fell through to
the general remainder, whose prepaid balance requirement refused every store read —
a store-metadata read demanding a balance (`apps/commerce/mount.go:79-86`). A
prefix that the app serves but the router does not hand it is indistinguishable
from an unmounted route from outside.

### Known refusals and one documented defect

- **A wallet-processor confirm or cancel addressed only by pay key refuses.** The
  shared handler resolves its order from an order id that those addresses do not
  carry, so it refuses before the key is ever looked up
  (`apps/commerce/describe.go:943-963`). Drive such a return through an address
  that carries the order id.
- **The method-override tunnel defaults to a partial update.** Naming no override
  at all is treated as a partial update, never as a create, and a verb outside the
  three accepted resolves to 405 (`apps/commerce/describe.go:766-774`).
- **Creating a listing under an existing key is refused rather than overwriting.**
  Changing an existing listing has to be an explicit replace
  (`apps/commerce/describe.go:842-851`).
- **Partial update of a single listing does not write.** The decoded body is
  applied to a copy taken out of the map and never assigned back, so the stored
  listing is unchanged (`apps/commerce/describe.go:861-870`). This is a defect,
  documented rather than hidden because callers depend on the observed behaviour;
  the upsert is the path that actually writes. Fixing it changes an answer clients
  see, so it is a change to make deliberately.

Deleting a store writes the entity once more under a tombstone kind before the live
row goes, so a deletion leaves a recoverable copy
(`apps/commerce/describe.go:776-784`).

## Rationale

Per-store entitlement rather than per-org is the choice that surprises people. Per
org is simpler and it makes one paid plan cover an unbounded number of shops, which
is a pricing hole rather than a feature. The cost is that an org with several
storefronts subscribes several times, and that is the intended commercial shape.

An override map rather than per-store product rows keeps one catalog. Copying the
product per storefront would make every catalog edit a fan-out, and fan-outs drift.

Rotation rather than accumulation on the storefront key means there is no key list
to audit and no forgotten key to leak. The cost is that re-minting breaks any
client still holding the old one, which is exactly what makes it a usable
revocation.

## Security Considerations

The storefront key is handed to a logged-out browser, so it must be assumed public.
It carries read of published catalog only, it is org-bound, and rotation is
immediate. Any scope added to it is a scope handed to every visitor.

Tenancy throughout is the namespace, not a filter on a row, and a foreign id
answers as absent. Any change that distinguishes "not yours" from "not there" turns
the store id space into an existence oracle.

Checkout is the one path here that reaches a payment processor. The ordering rules
above are the security-relevant part: reserving before charging bounds oversell,
and releasing on failure bounds a denial-of-inventory attack that would otherwise
consist of starting authorizations that never settle.

## References

- HIP-1002 — Cart — The Basket a Sale Begins In
- HIP-1005 — Payments — Taking a Card
- HIP-0135 — What Is Public

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
