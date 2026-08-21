---
hip: 1323
title: Kafka — A Wire Onto the One Bus
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: kafka
status: Draft
created: 2026-08-21
requires: HIP-0106, HIP-0139
---

# HIP-1323: Kafka — A Wire Onto the One Bus

## Abstract

`kafka` is the Kafka binary protocol spoken on `:9092` and translated to and
from the JetStream that `pubsub` serves. A standard producer or consumer points
at the port and works unchanged. It is implemented in `hanzoai/cloud` at
`apps/kafka` (HIP-0106) over the adaptor at `github.com/hanzoai/kafka`.

It is an ADAPTOR, not a broker. There is one bus; this is one of the wires onto
it.

## Motivation

A team arrives with a Kafka client already written, or a framework that only
knows how to be a Kafka consumer. The two ordinary answers are both bad: tell
them to rewrite against a different client library, or run a second broker
beside the first. The second is worse than it looks — two brokers is two
retention policies, two backlogs, two things to be up, and a message published
on one that a consumer on the other will wait for forever.

The third answer is to keep one bus and meet each client on the wire it already
speaks. That is what this capability is, and it is the reason to state the shape
once here rather than per protocol: `kafka` is the first of a family, not a
special case.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The message plane, and where each name sits

One bus. Several wires onto it. One managed product over it.

| Capability | What it is | Where a client meets it |
|---|---|---|
| `pubsub` (HIP-1060) | **the bus** — embedded NATS/JetStream | `:4222`, and `/v1/pubsub` |
| `kafka` | a wire-protocol adaptor over that bus | `:9092` |
| `mq` (HIP-1061) | the managed product: org-scoped durable queues and streams | `/v1/mq` |

`pubsub` is the only store. An adaptor MUST NOT hold subscription state,
retention or offsets of its own that the bus does not hold — the moment it does,
the two disagree and a consumer's position depends on which wire it used.

A capability in this family MUST dial the bus through `pubsub.URL` — the one
knob every app in the process reads — so an adaptor cannot end up bridging a
different bus than the one the rest of the fleet publishes to. There is no
second address to configure, and therefore no silent half-embed.

### §2 It mounts no HTTP routes

The adaptor serves the Kafka protocol and nothing else. Cloud's generic
per-subsystem liveness route answers `/v1/kafka/health`, and the Kubernetes
Service TCP-probes `:9092`.

This has a consequence for the gates, and it is the reason this HIP exists at
all. `hanzoai/openapi`'s `capabilities.yaml` is curation over the EMITTED
DOCUMENT, and `publish.py` refuses a name the document does not carry — so a
capability serving no HTTP operation can never appear there, and the coverage
gate that reads that file cannot see it. `kafka` shipped and no gate could
report it had no spec. `scripts/coverage.py` therefore takes cloud's
hand-authored `manifest/apps.go` as a second capability source, and the
capability universe is the union of what the fleet ships and what the document
serves.

### §3 Stateless, and no ZooKeeper

The adaptor is stateless over JetStream. It MUST NOT require ZooKeeper or any
second coordination service: the bus already has consensus, and adding another
would put two answers to "who leads" in one system.

### §4 Fail closed at boot

`Mount` fails CLOSED. A connect or bind error inside the startup window aborts
boot rather than serving a phantom broker — a broker that accepts a produce and
drops it is worse than a port that refuses, because the producer believes it
published.

Mount order is the row position in `manifest/apps.go`, and this row MUST stay
after `pubsub` so the embedded `:4222` is already accepting when the adaptor
dials it.

### §5 The name

`kafka` is the word people say for the protocol, and the protocol is what this
capability is. Per HIP-0139 §2.5 it is a word because it is the word — a client
author looking for "does this speak Kafka" finds it under exactly that name in
the manifest, the package, the port's documentation and this HIP.

## Rationale

The alternative was folding this into `pubsub` as a transport option. It reads
economical and it loses the thing worth keeping: a capability is a name someone
can look for. "Can I point my Kafka consumer at it" is the question, and burying
the answer inside another capability's spec means the answer is only found by
whoever already knew.

Keeping it separate also makes the family extensible without renegotiating the
bus: a further wire is a new adaptor row, not a change to `pubsub`.

## Security Considerations

The Kafka wire is a SEPARATE credential surface from the HTTP one, and this is
the sharp edge of the whole design. An HTTP caller is authenticated by IAM and
scoped by the `owner` claim; a `:9092` client presents whatever the Kafka
protocol carries. The adaptor MUST NOT grant a wire client more of the bus than
the equivalent HTTP principal would reach, and an unauthenticated connection MUST
NOT be able to enumerate, produce to, or consume from another org's subjects.

Because the adaptor is stateless and every subject lives on the one bus, the
authorization decision belongs to the bus and MUST NOT be re-implemented here —
a second policy engine on a second wire is how two answers to one question get
shipped.

The port is a listener on the pod, so exposure is a Service decision. It SHOULD
NOT be published beyond the fabric that needs it.

## References

- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1060 — PubSub — The Tenant Door on the Bus
- HIP-1061 — MQ — Queues and Streams

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
