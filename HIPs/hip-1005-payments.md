---
hip: 1005
title: Payments — Taking a Card
author: Hanzo AI
type: Standards Track
category: Application
status: Superseded
superseded-by: HIP-1220
created: 2026-08-20
---

# HIP-1005: Payments — Taking a Card

> **Superseded by HIP-1220.** The card endpoint answers at `/v1/commerce/payments`.
> It shares the merchant store with the cart and the storefront, so it is one
> capability with them (HIP-0139 §7.2). The customer's own money questions —
> balance, ledger, invoices — are `billing`'s address, not this one.

## Abstract

`/v1/payments` takes a card payment and credits the paying org's balance. It is
implemented in `hanzoai/cloud` at `apps/commerce/payments.go` and is a second endpoint
onto the same money move the console's top-up button uses. This HIP states the one
rule that matters — one implementation of the charge, screened on the handler and
not on the route — and the inputs the capability refuses to accept.

## Motivation

A settled card charge is its own mint authority: it turns into spendable balance,
and balance buys inference. Money could already be taken through the browser endpoint.
What could not happen was an agent taking a payment, and the reason was shape
rather than policy — the browser route was a raw handler, so it produced a route
and nothing else: no schema, no tool, no generated client, no command
(`apps/commerce/payments.go:5-15`).

Adding a second charge implementation would have been the easy fix and the wrong
one. Two implementations means two sets of bounds to drift and two idempotency
derivations to disagree, which is a double charge waiting for the right retry
(`apps/commerce/payments.go:17-24`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### One core, several endpoints

There is exactly one card money move. The browser route and the typed operations
are endpoints onto it, and any further endpoint MUST compose the same core rather than
restate it. Bounds, idempotency derivation, processor selection, the charge and the
ledger credit all live there.

### Identity is not an input, and neither is the beneficiary

The paying org is read from the validated principal, never from a field
(`apps/commerce/payments.go:25-31`). There is deliberately no subject field: a
payment credits the caller's own account, so there is no value a caller can send
that steers money elsewhere. A future revision MUST NOT add one without a
correspondingly stronger gate, because an org field on this operation is a
cross-tenant credit the caller asserts for itself.

### The card never reaches this process

The input is a single-use token minted in the browser, not a card number. That is
what keeps the process out of cardholder-data scope, and any change that accepts a
raw instrument here changes the compliance posture of the whole binary.

### Bounds are server-side and authoritative

The amount is whole cents, and floor and ceiling are enforced here, not by the
client (`apps/commerce/payments.go:59-64`). A fat-fingered or hostile amount is
refused before any money moves.

### Retries collapse, with or without a key

A supplied idempotency key MUST replay the first result rather than charge again.
An absent key falls back to a windowed key derived from amount and currency, so a
double submit inside the window still collapses onto one charge
(`apps/commerce/payments.go:66-73`). An agent SHOULD always send a key, because an
agent retries by construction.

### Test mode belongs to the org, not the caller

Sandbox or production follows the org's own credentials and test flag, and the
answer states which bucket it credited (`apps/commerce/payments.go:32-37`,
`apps/commerce/payments.go:90`). A caller that could ask for a test charge could
mint spendable balance from a sandbox card, so it **MUST NOT** be able to ask.

### The screen goes on the handler, never on the router

A typed operation is recorded once and every projection dispatches to the same
handler: the route, the tool listing, the by-name call plane and the command line.
Router middleware wraps only the route. A screen mounted as router middleware
therefore guards the URL and waves the tool through — which was the whole control
absent on the one plane it was built for
(`apps/commerce/risk.go:29-37`).

So the screen composes onto the **handler** of each endpoint: one decision, one payer
rule, one settlement key, every projection
(`apps/commerce/risk.go:39-41`). Every endpoint onto the charge core MUST be screened
this way.

The gate declares itself privileged rather than relying on a grant list it is not
on, because the default for an unlisted path is fail-open — and failing open here
means a scorer outage waves through every payment on the only two routes that mint
spendable balance (`apps/commerce/risk.go:42-47`,
`apps/commerce/risk.go:616-619`). A scorer that is present and cannot answer MUST
refuse.

### What this refuses

- **No second charge implementation.**
- **No beneficiary field.**
- **No caller-selected test mode.**
- **No raw card data.**
- **No status field for a failed charge.** A charge that did not settle is an
  error carrying the processor's reason, not a success body to inspect
  (`apps/commerce/payments.go:81-84`).

## Rationale

The alternative to screening on the handler is screening the route and telling
agents to use the route. That is a control that depends on callers choosing the
guarded projection of an operation, which is not a control.

The alternative to a windowed fallback key is to require an idempotency key. It is
cleaner and it makes the common browser double-click a double charge, because the
browser form did not send one. Requiring the key on the typed endpoint and defaulting
on both is the compromise that keeps one core.

## Security Considerations

This is the sharpest lifecycle moment the commerce plane owns: a stolen card that
clears is money in an account, and that account buys compute. The screen exists for
that, and it is only a control if it stands in front of every entrance to the same
ledger write.

The screening model ships without enforcement — an unreviewed model is held in
shadow, and shadow makes the decision advisory while still recording what the model
would have said. Widening the gate to a new endpoint therefore widens the **record**,
not the enforcement, and the default regime is unchanged. What does refuse today is
a scorer that is present and unable to answer.

The absence of a beneficiary field is a tenancy control, not an ergonomic choice.
The absence of a caller-selected test mode is a mint control: sandbox credentials
plus a caller-chosen bucket is free balance.

## References

- HIP-1002 — Cart — The Basket a Sale Begins In
- HIP-0135 — What Is Public

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
