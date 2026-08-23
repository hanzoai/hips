---
hip: 1060
title: Pubsub — The Tenant Endpoint on the Bus
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: pubsub
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0119, HIP-0139
---

# HIP-1060: Pubsub — The Tenant Endpoint on the Bus

## Abstract

One message bus runs inside the cloud binary, and it has many endpoints. The
cluster's endpoint is the broker's own client port: in-process apps and in-cluster
clients, unscoped, speaking the broker protocol. `/v1/pubsub` is this
capability's tenant endpoint: a JSON surface for publish and request/reply, where
every subject a caller can name is confined to that caller's org.

Keyed state is NOT here. A bucket holds values and answers reads; nothing about
it publishes or subscribes, so it is its own capability at `/v1/kv`
(HIP-1324), riding this same node through the four calls this package exports
for a rider. One bus, more than one product on it.

This HIP specifies the tenant endpoint — what it guarantees, what it will not carry,
and why the isolation is a namespace rather than a broker account. The
implementation is `hanzoai/cloud` `apps/pubsub`; the endpoint itself is
`apps/pubsub/typed.go`.

## Motivation

The bus is shared on purpose. The event plane, the queue admin surface
(HIP-1061), the log pipeline and the wire-compatible facade all ride the same
embedded node over one file store, because a second broker would be a second
durability story and a second thing to lose. Sharing means a tenant surface over
that node cannot be a thin relay: a caller who could name a subject would be able
to name `event.>` and read the platform's own facts.

So the endpoint carries the tenancy, and the only question worth specifying is where
that boundary is drawn and what it costs.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### The org comes from the principal

Every operation derives its org from the validated principal parked on the
request context (HIP-0026), never from a request field and never from a header a
caller may set. A request with no validated principal MUST be refused before it
reaches the bus.

### Isolation is a namespace, not an account

The node runs one domain shared with the platform's own streams, so the endpoint maps
names on the way in and strips them on the way out:

- Subjects live under a per-org root. A caller sees its own clean subject space
  and cannot express a subject outside it, and wildcards are refused outright:
  both operations here address ONE subject, and `*` or `>` names a set.
- Streams and buckets carry a physical prefix that keeps the tenant plane
  disjoint from platform state. The rule is stated once, by this package, and
  every rider on the node qualifies its names through it.

The encoding MUST be injective: a physical name decodes to exactly one
(org, name) pair. Caller-supplied names are constrained so the separator cannot
appear in them, which is what makes the decode unambiguous rather than merely
unlikely.

### The broker's refusal is the caller's answer

Handlers relay the broker's own outcome. A refusal surfaces as the status it is —
not found, conflict, timeout — and MUST NOT be reshaped into a success. There is
no store of the endpoint's own and no second bus: the endpoint dials the one bus this
process serves.

### Payloads are text

Message data and stored values are JSON strings carried verbatim as UTF-8. The
JSON endpoint is a text endpoint and its round trip is exact. Binary payloads belong on
the broker port; bytes published there that are not UTF-8 read back lossily here,
and that is a stated limit rather than a bug to be fixed by base64 on one side.

### What this endpoint refuses

Three families are refused by decision, each pinned to a route-level 404 by
`TestRefusedPubsubOpsStayRefused` (`apps/pubsub/typed_wire_test.go:353`):

- **A subscription stream.** A typed operation writes one JSON answer and has no
  vocabulary for an event stream. Consumption is served by the pull operation on
  the queue surface and by the broker port, which speaks native subscriptions.
- **An object store.** Objects are `/v1/s3`. A second object endpoint riding stream
  chunks would be two endpoints onto one noun.
- **Server telemetry.** Connection, stream and route listings are server-wide and
  cross-tenant by construction — one of them lists every client of every tenant.
  Operator telemetry is the observability plane; publishing it on a tenant
  surface is a leak, not a feature.

Queue and stream administration is likewise absent here: it is the sibling
capability specified in HIP-1061. No operation appears on both.

### The bus address is one knob

Every app in the process reaches the bus through one resolver, which defaults to
the loopback address of the server this same binary bound. There is deliberately
no per-app address variable and no way to run with the bus off: mount fails
closed, so a cloud that is up has a bus.

### What it owns, charges and emits

The store this capability owns is the bus's: the embedded node and its durable
file store under cloud's data dir are run by this same package
(`apps/pubsub/pubsub.go`), and every other plane — the event plane, the queue
surface (HIP-1061), the wire facades — rides it. The endpoint adds no second one.

The addresses are the two operations at `/v1/pubsub` (plugin/pubsub/openapi.json):
publish and request. Both typed, neither declared.

What the endpoint exports is part of the contract, because a second capability
depends on it. A rider on this node reaches it through four calls and no others
— the dialer, the validated org, the plane-wide name of a caller's stream or
bucket, and the translation of a broker refusal into a wire refusal. The dialer
MUST hand back the in-process handle where this process runs the node and MUST
dial the one bus address otherwise, so a rider in its own binary reaches the
same server without a second address variable of its own.

It is free, in those words: the plugin declares `Price: cloud.Free`
(plugin/pubsub/main.go:21), and no meter runs behind any route.

It publishes no events of its own — it is what events ride — so a customer's
webhooks (HIP-1310) receive nothing from it, and it emits nothing to
observability beyond the request span every route gets.

The stage is `ga` — the manifest row declares none, and absent is `ga`
(HIP-0139 §8).

The node is `hanzoai/pubsub` (pinned in cloud's go.mod), a derivative of NATS
Server (Apache 2.0); the broker core, the stream layer and the key-value layer
survive in HEAD. In-process callers reach it over the `nats.go` client
(Apache 2.0).

## Rationale

The obvious alternative is broker-native accounts — one account per org, isolation
enforced by the broker. It costs an account lifecycle (create, credential, rotate,
delete) that must stay in step with the org lifecycle, and it fragments the one
domain the platform's own streams live in, so cross-plane reads inside the process
would need bridging. Namespacing at the endpoint keeps one domain, one durability
story, and puts the boundary in code that is tested against the live node rather
than in broker configuration that is not.

The cost is real and worth stating: the endpoint is the only thing standing between
tenants, so a mapping bug is a cross-tenant read. That is why the mapping is
injective by construction and why the wire tests drive the real embedded node
instead of a fake.

## Security Considerations

The whole surface is a tenancy boundary. Three properties carry it:

- An unvalidated principal reaches no handler.
- A caller cannot express a name outside its own root, in either direction: the
  root is added inbound and stripped outbound, so an org root never appears in a
  response and cannot be replayed as input.
- Server-wide telemetry has no route, so there is no operation whose correct
  answer would be another tenant's data.

Tests exercise the produce–store–consume loop, request/reply against a live
responder, the keyed round trip and the tenancy properties against a real
embedded node on an ephemeral port — no fakes in the path
(`apps/pubsub/typed_wire_test.go`).

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0119 — Hanzo Service Conventions
- HIP-1061 — MQ — Queue and Stream Administration
- HIP-1324 — KV — Buckets of Versioned Values

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
