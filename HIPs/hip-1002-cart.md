---
hip: 1002
title: Cart — The Basket a Sale Begins In
author: Hanzo AI
type: Standards Track
category: Application
status: Draft
created: 2026-08-20
capability: cart
---

# HIP-1002: Cart — The Basket a Sale Begins In

## Abstract

`/v1/cart` is the shopper's basket: open one, set what is in it, read what it
comes to, discard it. Checkout turns a cart into an order. It is implemented in
`hanzoai/cloud` at `apps/commerce/cart.go`, over the cart model of
`hanzoai/commerce`. This HIP states the vocabulary the capability commits to and
the two things it deliberately does not carry.

## Motivation

The checkout addresses have been served for as long as the binary has existed. The
cart they operate on had no address at all, so the first step of a documented flow
was unreachable while the last three were (`apps/commerce/cart.go:5-13`). The
capability was never missing — the module implements the whole noun — only the
door was. This HIP records the shape that door commits to, so the next reader does
not mistake it for a second cart.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### One way to change a line

Quantity is the resulting count, not a delta: setting three twice leaves three.
**Zero removes the line**, and that is the only removal — there is no delete beside
the set (`apps/commerce/cart.go:23-27`, `apps/commerce/cart.go:93-97`). Setting a
quantity on an item not in the cart adds it; setting zero on one that is not there
is a no-op, not an error.

A second spelling of one act is a second set of edge cases, so a future revision
MUST NOT add one.

An item is named by product or by variant, never both, and a request naming
neither is refused. Anything sold in sizes, tiers or colours SHOULD be addressed by
variant, because the price and the stock belong to the variant.

### The rules stay in the model

These operations resolve a product or variant into a line through the cart model's
own method and MUST NOT restate its rules
(`apps/commerce/cart.go:15-21`). What this capability adds is an address, a
declared input, a declared answer and the prose that makes all three legible to a
generated client, a tool listing and a command line. A rule reimplemented at the
door is a rule that will disagree with the module that owns it.

### Identity is not an input

The org comes from the validated principal, never from the body
(`apps/commerce/cart.go:29-33`). A cart is created, found and amended only inside
the caller's own namespace. A cart id belonging to another tenant is **404, never
403**, so the id space cannot be probed for existence.

### Currency and store are hints, not commitments

The store defaults to the org's default storefront and the currency to `usd`.
Checkout overrides the currency with the store's own when the sale is authorized,
so a currency set at open time is a hint. Shipping and tax stay zero until
checkout resolves an option and a tax region; a cart total before checkout is a
subtotal with those two at zero, and a caller MUST NOT present it as a final
amount.

### No money and no marketing ride on this door

A cart moves no money, so no credit screen is composed onto it — the screen belongs
on the acts that mint, which is why HIP-1005 puts it on the payment door
(`apps/commerce/cart.go:178-181`).

The standalone deployment of the commerce module mirrors cart writes into an
external abandoned-basket feed when an org has that integration configured. That is
a storefront-marketing side effect of that deployment, not part of what a cart is,
and it is deliberately absent here rather than reimplemented
(`apps/commerce/cart.go:35-40`). A second copy of an integration is a second thing
to drift.

## Rationale

The obvious alternative is `DELETE /v1/cart/:id/item/:key` beside the set. It reads
naturally and it doubles the state space: two paths to an empty line, two places to
get the coupon recomputation right, two things to keep idempotent. Quantity zero is
already exactly what the model's own set does, so the second door would be a
spelling and not a capability.

The second alternative is to accept the org on the request so a storefront service
can fill a cart on a shopper's behalf. That makes a cross-tenant write something a
caller can assert for itself. A storefront that needs to act for an org gets a
token scoped to that org instead — see HIP-1006.

## Security Considerations

The cart is the only pre-checkout object a logged-out shopper can create, so it is
the cheapest thing for an unauthenticated client to make a lot of. It holds no
payment instrument and no address book, which bounds what a filled cart discloses.

Reading another tenant's cart is prevented by the namespace, not by a check on the
row, and the answer for an id outside the namespace is indistinguishable from the
answer for an id that never existed. Any future change that answers 403 for a
foreign id turns the cart id space into an existence oracle.

## References

- HIP-1005 — Payments — Taking a Card
- HIP-1006 — Store — Storefronts, Listings and Checkout
- HIP-0135 — What Is Public

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
