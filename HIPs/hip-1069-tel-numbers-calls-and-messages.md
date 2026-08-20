---
hip: 1069
title: Tel — Numbers, Calls and Messages
author: Hanzo AI
type: Standards Track
category: Interface
capability: tel
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0119
---

# HIP-1069: Tel — Numbers, Calls and Messages

## Abstract

`/v1/tel` is the telecommunications surface: an org searches for and holds phone
numbers, places and ends calls, sends messages, and reads the records of all
three. A call may be handed to an assistant, which is ours.

This HIP specifies the carrier contract that keeps the surface white-label, the
honesty rule about what "sent" means, and the tenancy boundary. The implementation
is `hanzoai/cloud` `apps/tel`.

## Motivation

A telecom surface acquires a vendor faster than almost anything else: a base URL
here, a status string there, and within a release the product cannot terminate on
a different network without a rewrite. Numbering is national and regulated, so a
brand operating in another jurisdiction may have no choice about which network it
terminates on.

The second pressure is the assistant. A carrier that also answers calls with its
own voice agent is deciding what our product says. That is not a dependency worth
having.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### The carrier is an interface, and nothing above it names a network

Three verbs — numbers, calls, messages — are the whole contract
(`apps/tel/carrier.go:15`). Everything else in the package is tenancy, records and
policy on top of them.

No code above that interface may name a carrier or a brand. The concrete carrier
is built from configuration at mount, so terminating on a different network in a
different jurisdiction is an environment change rather than an edit. Credentials
come from the environment, populated from the key store on a cluster; **there is
no literal credential in the source and there must never be one.**

A deployment with no carrier credential falls back to a carrier that answers
without a network, whose numbers are in the range reserved for fiction. That is
also what the tests run against, so the surface is exercised end to end without
placing a call.

### Acceptance is not delivery

The carrier answers with an identifier as soon as it has **accepted** a request.
The outcome — connected, delivered, failed — arrives later on the event stream.

A message submission MUST NOT be recorded as delivered because the submission
succeeded. A carrier that returns "sent" synchronously is telling you it accepted
the request, and recording that as delivery is how a message that never arrived
becomes a message the record says arrived.

### Assistants are ours

A call handed to an agent is answered by a Hanzo assistant on Hanzo inference: the
same models, prompts and tools every other surface uses. The carrier moves the
audio and does not decide what is said.

The package reaches the platform's own AI door rather than a model package
(`apps/tel/agent.go:24`), so an assistant improved for chat is improved for calls
in the same release, and which model answers is the catalog's decision behind that
door rather than a constant in a telecom package.

### Tenancy

The org is the value minted from the validated bearer's owner claim (HIP-0026),
enforced server-side on every request and never a client-supplied header. Every
store query filters on it, so one tenant can neither read nor mutate another's
numbers, calls or messages.

### The surface is an exact set

Every route is a typed operation, and the served set is pinned as an **exact set**
rather than a floor, so a route added here fails whether or not anyone remembers
the test (`apps/tel/typed_wire_test.go`).

There is no untyped-by-design ledger, because nothing on this surface refuses: no
raw bytes, no multi-status answer, no verbatim relay. The day one appears it is
named with its wire fact and the set still has to match.

## Rationale

The alternative is to build against one carrier's API and generalize later.
Measured against how this surface actually changes — a brand, a jurisdiction, a
regulator — later is exactly when generalizing is most expensive, because by then
the vendor's vocabulary has leaked into the records, the status values and the
console. Three verbs behind an interface cost one indirection now.

## Security Considerations

The tenant boundary is server-side on every request and derives from a validated
credential rather than an asserted header, because the objects behind it are
billable and externally visible: a number bought under another tenant's org is a
charge and a phone line.

Carrier credentials live in configuration sourced from the key store and never
appear in a response. Records carry what the carrier reported; a delivery status
is written only when the event arrives, so the record cannot claim an outcome
nobody observed.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0119 — Hanzo Service Conventions

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
