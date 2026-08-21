---
hip: 1063
title: Auto — Flows That Run Themselves
author: Hanzo AI
type: Standards Track
category: Interface
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0126
---

# HIP-1063: Auto — Flows That Run Themselves

## Abstract

An automation is a trigger and a tree of connector actions. `/v1/auto` is where an
org authors them, enables them, and reads what they did. HIP-0126 fixed the
vocabulary — an Integration has three kinds, and a Flow consumes Connectors as
nodes. This HIP specifies the plane those flows actually run on: what it composes,
what bounds a run, and which of its routes are deliberately not typed operations.

The implementation is `hanzoai/cloud` `apps/automations`, registered at
`apps/automations/automations.go:206`.

## Motivation

An automation plane is a machine for turning one event into many actions, which is
also the definition of an amplifier. Every serious property of this surface is
about keeping that amplification bounded and attributable: a flow that triggers a
flow, a redelivered webhook, a burst of runs from one tenant, a step tree grown
until it is a denial of service against the store.

The second motivation is composition. Credentials, durability and tenancy already
exist in this binary. A plane that re-implemented any of them would have a second
answer to a question that must have one.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### It composes; it does not reinvent

Three seams, and no local substitute for any of them:

- **Credentials.** A connector reaches a token only through the integrations
  seam. This package MUST NOT read the key store directly.
- **Durability.** A flow runs as a durable workflow on the one shared in-process
  engine (HIP-1062), in the owner's namespace. There is no second engine.
- **Tenancy.** Every handler resolves the org through the one principal gate
  (HIP-0026). A forged org with no bearer is refused.

### One dispatch door, three entrances

An inbound event becomes runs of the flows that subscribe to it. The shape handed
to dispatch is one type regardless of entrance — an authenticated producer posting
to the event sink, an external provider webhook, or an inbound channel message all
arrive as the same event with a source, a name, a payload and an optional dedupe
key (`apps/automations/trigger.go:26`).

Delivery MUST fail closed on a missing or unverified org: the org is the sole
tenant key, so an event without one starts nothing.

### What bounds a run

Every one of these is a normative ceiling, not a default to be tuned away:

- **Idempotency.** A flow fires at most once per dedupe key, so a redelivered
  event does not become a second run.
- **Causation depth.** An in-platform producer propagates how many hops an event
  is from an external origin, and an event past the ceiling starts nothing
  (`apps/automations/trigger.go:34`). A cycle terminates instead of amplifying.
- **Run starts per org per rolling minute**, counted from persisted rows so the
  ceiling survives a restart, enforced before every start.
- **Flow size**, in both step count and total serialized bytes, checked at every
  write.
- **Resume payload size.**
- **Concurrent in-flight starts and tool executions per org**, so one tenant
  cannot exhaust worker goroutines.

A run start and a tool call each meter one unit, and each emits one observability
event and one audit record under the same exactly-once guard as the meter — so a
run is observed on the same plane as inference rather than through a private side
channel (HIP-0132).

### The connector catalogue

The catalogue is compiled into the binary and its schema is a build-time contract:
a mismatch fails the build rather than the first request. The pre-rename path
remains a byte-identical alias of the catalogue route so clients pinned to it keep
working; the retired term is not used anywhere else (HIP-0126).

### Three routes are not typed operations

A typed operation is the single registry entry every projection reads. Three
routes here cannot be one, and the reason in each case is a wire fact that typing
would move. `apps/automations/untyped_wire_test.go` pins each fact, so the
exclusion is enforced rather than asserted:

- **Applying a flow operation** answers with two different shapes depending on the
  operation — the flow for a status change, the edited version otherwise. An
  operation declares one output.
- **Resuming a run** takes an arbitrary JSON value delivered verbatim into the
  waitpoint, while the run is addressed by the URL.
- **The event sink** takes an open-keyed payload, while the source and event are
  in the URL.

The last two share one rule, and it is sharper than "an input cannot be both a
body and an address":

> A typed operation MUST be addressable through its input alone, because on two of
> its four transports the input is the whole message.

Over the tool plane and the internal call plane the arguments object *is* the
request; no path is bound from it. So a structured input that swallows the body in
its own decoder is not the escape hatch it appears to be: it keeps the REST wire
intact and silently makes the operation unaddressable everywhere else, while the
published schema goes on describing an object whose keys the body never carries.
That retype was measured — the whole suite stays green — which is exactly why a
separate test addresses through arguments alone.

A fourth exclusion used to exist for a local tool door. It is gone rather than
retyped: the fleet serves one tool door, on the host, and every connector action
reaches it there. A transport nobody duplicates needs no exclusion.

## Rationale

The alternative to bounding amplification at the plane is bounding it per
connector, which is where the amplification is easiest to see and hardest to keep
correct: every new connector would have to re-derive the same ceilings, and the
one that forgot would be the incident. Depth, dedupe and the per-org budgets sit
at dispatch, so a connector cannot opt out of them by existing.

## Security Considerations

The org is the only tenant key and is never taken from a request body. Dispatch
refuses an unverified org outright, because the failure mode is not an error but a
run executing under someone else's credentials.

The event sink is the exposed edge: it accepts an open payload from a producer and
turns it into credentialed action. Idempotency, depth and the per-org run budget
are what keep a replayed or looping delivery from becoming unbounded work, and
they are enforced before a run starts rather than as a cleanup after one.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0126 — Integrations, Connectors and the Extension Runtime
- HIP-0132 — One Telemetry Plane
- HIP-1062 — Tasks — The Durable Run

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
