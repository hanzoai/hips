---
hip: 1066
title: Channels — One Inbox
author: Hanzo AI
type: Standards Track
category: Interface
capability: channels
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0126, HIP-0139
---

# HIP-1066: Channels — One Inbox

## Abstract

An org connects its chat surfaces and reads them in one place. `/v1/channels`
carries a portable message envelope, a per-org access policy, a durable inbox, the
outbound send across every connected transport, and the agent turn that answers.

This HIP specifies the envelope contract, where the access decision is made, and
the one-way dependency that keeps identity and token custody out of this package.
The implementation is `hanzoai/cloud` `apps/channels`.

## Motivation

The same message arriving on four transports has four shapes, four notions of a
room, four ways of naming a sender and four rules about who may speak. Every
consumer that reads them raw re-derives all four, and the derivations disagree.

There was also a concrete duplication worth recording, because the shape of the
fix is the shape of this spec. Each transport adapter used to emit an event into
the inbox *and*, separately, spawn an agent turn of its own. One message drove two
mechanisms and only the second ever replied. The turn belongs beside the inbox
because everything it needs is already there — the policy that says whether the
sender may speak, the route that says where a reply goes, and the egress doors.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### The envelope

There is one message shape. Every transport normalizes into it on ingress and
renders out of it on egress (`apps/channels/envelope.go`).

Every union in it is **closed and kind-tagged**: room kind, action kind,
attachment kind. Nothing in the envelope infers meaning from the shape of a
string. A transport that grows a concept the envelope does not have adds a tagged
member; it does not overload an existing one.

The transport registry is likewise closed and enumerated in fixed order, so the
listing is deterministic. Each transport declares what it can actually render —
direct messages, group rooms, threading — and those declarations are honest rather
than aspirational: a transport whose ingress cannot produce a direct message
declares that it has none, and a send addressed at one is refused rather than
silently dropped.

### The dependency points one way

Identity and token custody stay in the integrations package. Inbound events arrive
here over the internal plane and replies leave through that package's send doors.

**channels depends on integrations; integrations MUST NOT depend on channels.**

The consequence for the turn: which Hanzo account a chat user has linked is
integrations' question to answer, because the link lives in custody under that
subsystem. Only the answer crosses. **A token never does.**

### The gate

Access is decided per (org, channel), on two axes
(`apps/channels/policy.go`):

- Direct messages: pairing, allowlist, or open.
- Group surfaces: open, allowlist, or disabled.

An absent policy row means the defaults, and the zero row is never stored.

Gate outcomes are a **closed set of reason codes**, and a reason code is the only
decision detail that may be logged. **Sender identifiers MUST NOT appear in
logs.** An inbox is a record of who talked to whom, and log retention is not the
place for it.

There are no public routes on this surface. Platform webhooks stay in
integrations, which is where signature verification lives. Mutating the policy or
the allowlist additionally requires an org admin; reading the inbox does not.

### Ingest is detached and bounded

Ingest runs on a per-event goroutine under a bounded context, so nothing in this
package can delay the webhook delivery that produced the event. It publishes its
service state before serving the ingest door, so the first event finds a mounted
store, and unpublishes before closing, so a late event cannot adopt a store that
is about to close.

### The turn is bounded three ways

A turn is a real model completion, so it gets a generous end-to-end budget, a
global ceiling on simultaneous turns, and a **per-org** ceiling that is a fraction
of the global one. The per-org ceiling is what stops one tenant from starving the
others; the global one is what stops all of them from exhausting the process.

Each turn emits one span. The tracer is rebindable in tests, because a span that
is created and never exported is exactly the failure worth catching.

### Send is not a typed operation

One route on this surface stays untyped, and it has two independent blockers,
both pinned by `TestSendKeepsItsCapAndItsStrictness`:

1. It reads the raw body and refuses anything over a package-local cap. A typed
   operation never sees raw bytes — decoding happens first — and the global limit
   is far larger, so the cap would silently vanish.
2. It decodes with unknown fields **refused**. The outbound body is a deliberately
   narrow projection of the envelope: identity fields are not decodable, and a
   request carrying one is refused loudly rather than having it dropped. The typed
   decoder has no strictness option, so every such request would start succeeding
   with the field ignored — which is the silent acceptance the route exists to
   prevent.

The closed ledger of untyped routes has one entry, and a second one added without
a stated wire fact fails.

### What it owns, charges and emits

The store is one SQL database (`sqlpool.Open("channels", …)`,
apps/channels/store.go:43): policy, pairing, allowlist, access-group and owner
rows beside the inbox and the send record. The four transports in the closed
registry are discord, slack, teams and telegram (apps/channels/registry.go).

The addresses are the operations at `/v1/channels`
(plugin/channels/openapi.json): the transport listing, the inbox read, the
allowlist (read, replace), pairing (list, approve), and the per-channel send —
the send being the one declared route, per the section above.

It is free, in those words: the plugin declares `Price: cloud.Free`
(plugin/channels/main.go:21). The model completion a turn spends is metered
where inference is metered, behind the AI door, not here.

It publishes no events on the platform bus, so a customer's webhooks (HIP-0061)
receive nothing from it. Beyond the request span every route gets, the turn's
span comes from this package's own tracer, `hanzo.channels`
(apps/channels/turn.go:35).

The stage is `ga` — the manifest row declares none, and absent is `ga`
(HIP-0139 §8). The capability derives from no OSS upstream: transport wire
shapes are normalized in this package, and delivery rides integrations' own
doors.

## Rationale

Placing the gate in the shared package rather than in each adapter is the load
bearing choice. Per-adapter gating means four implementations of one policy, and
the transport that arrives next inherits none of them. The cost is that the
envelope must be expressive enough for every transport's notion of a room, which
is why room kind is a closed union of three rather than a free string.

## Security Considerations

Two boundaries carry this surface.

The **credential boundary** is the one-way dependency: this package holds no
provider token and cannot, because the custody client is in the package it depends
on and the plane call returns an answer rather than material.

The **speech boundary** is the gate. Its dangerous failure is admitting a sender,
not refusing one, so the default for direct messages is pairing rather than open,
and a group surface can be disabled outright. Reason codes rather than sender
identifiers in logs keep the audit trail from becoming a second copy of the
inbox.

The send route's strict decode is a security property, not a style choice:
accepting an identity field on an outbound body would let a caller assert who a
message is from.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0126 — Integrations, Connectors and the Extension Runtime

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
