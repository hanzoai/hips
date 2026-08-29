---
hip: 1061
title: MQ — Queues and Streams
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: mq
status: Final
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0119, HIP-0139
---

# HIP-1061: MQ — Queues and Streams

## Abstract

`/v1/mq` is the queue side of the platform bus: an org creates durable streams,
inspects and purges them, reads stored messages by sequence, manages pull
consumers and pulls the next batch. It rides the same embedded broker the tenant
publish endpoint rides (HIP-1060) and shares none of its operations.

This HIP specifies the split, the tenancy encoding, and the delivery semantics a
client has to know because they are not the broker's defaults. The implementation
is `hanzoai/cloud` `apps/mq`.

## Motivation

One broker can front two products or one confused one. When the authored intent
for this surface was written it carried publish, subscribe, request/reply, keyed
storage and object storage alongside the queue operations — five capabilities on
one address, three of which the platform already serves elsewhere. Serving all of
it would have meant the same broker call behind two endpoints with two shapes, and a
client choosing between them by accident.

The split is therefore the first normative statement here, not a footnote.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### The split

The subject side — publishing, request/reply, keyed state — is the pubsub
capability's surface (HIP-1060). The queue side — stream lifecycle, stored-message
access, consumer lifecycle, pull delivery — is this one. **No operation appears on
both**, and an operation added to either that already exists on the other is a
defect.

Two further families stay off this surface for the same reason: keyed storage is
already a product of its own, and object storage is `/v1/s3`. The broker's own
mechanisms for both are an implementation detail of this deployment, not a second
endpoint.

The served set and the refused set are both closed lists in
`apps/mq/typed_wire_test.go`, checked against the live router in both directions:
an operation leaving the served list fails, and an operation that starts being
served while still named as refused fails. A refusal row MUST be deleted the day
its fact stops being true.

### Tenancy

The broker also carries platform-internal streams, so isolation is enforced by
this surface and not by the broker:

- Stream names are namespaced per org on the wire and presented bare to the
  caller (`apps/mq/mq.go:194`).
- Stream subjects are confined to the org's subject root
  (`apps/mq/mq.go:206`); callers state subjects relative to it, the root is added
  inbound and stripped outbound.

The org encoding MUST be injective into the broker's name alphabet, so two
distinct orgs can never share a namespace. `TestNamespaceEncodingIsInjective`
holds that property.

Consequences: two orgs cannot bind overlapping subjects, no tenant stream can
capture a platform subject, and a caller's handle can only ever resolve to a
stream inside its own namespace. The org comes from the validated principal
(HIP-0026) and MUST NOT be nameable in a request.

### Delivery semantics that are not the broker's defaults

- **A pull acknowledges on delivery.** This surface has no acknowledge operation,
  so an explicit consumer whose messages were never acknowledged would redeliver
  forever. The operation says so in its own prose and
  `TestConsumerPullAcksOnDelivery` pins it. A client that needs
  acknowledge-after-processing MUST use the broker port, where the acknowledgement
  is expressible.
- **An empty waiting pull answers 408**; a no-wait pull answers 200 with an empty
  page. The distinction is the caller's, chosen per request.
- **A pull's wait is bounded** by a server cap, so a caller cannot park requests
  on this surface indefinitely.
- **Purge reports the difference** between the stream's message count before and
  after, because the client library discards the broker's own purged count.

### Availability is honest

Mount never requires a live broker: the connection retries, so the surface mounts
and can describe itself with nothing running. Until the plane is reachable, every
operation answers 503 and the health operation reports degraded. It MUST NOT
report healthy on a connection it does not have.

### What it owns, charges and emits

The capability owns no store: the durable log it administers is the broker's one
file store, owned by the pubsub capability that runs the node (HIP-1060). This
surface reaches it as a client over the one bus knob (`apps/mq/mq.go:93`) and
forks nothing of its own; the client library is `nats.go` (Apache 2.0).

The addresses are the operations at `/v1/mq` (plugin/mq/openapi.json): health
and info; stream list, create, get, update, delete and purge; stored-message
read and delete by sequence; consumer list, create, get and delete; and the
pull. All typed, none declared.

It is free, in those words: the plugin declares `Price: cloud.Free`
(plugin/mq/main.go:23), and no meter runs behind any route.

It publishes no events on the platform bus, so a customer's webhooks (HIP-1310)
receive nothing from it. It emits nothing to observability beyond the request
span every route gets; the degraded state is answered on the health operation,
not exported.

The stage is `ga` — the manifest row declares none, and absent is `ga`
(HIP-0139 §8).

## Rationale

The alternative to a closed refusal ledger is a comment saying "not yet". Measured
on this corpus, that is how a servable operation stays unserved forever: nobody
can tell whether the sentence is still true, so nobody acts on it. Making both
directions a test means the refusal expires by itself the day the wire moves.

## Security Considerations

The name and subject encoding is the whole tenant boundary. It is injective by
construction rather than by convention, because a collision is a cross-tenant
read of a durable log. The org is never an input field, so there is no request
shape that asks the surface to trust the caller about who it is.

Every functional test opens a real embedded broker node on a random port with a
temporary store and drives the HTTP surface over it — stream lifecycle, pull and
acknowledge, a second org seeing nothing, platform streams invisible, and the
degraded answer when the plane is down.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0119 — Hanzo Service Conventions
- HIP-1060 — Pubsub — The Tenant Endpoint on the Bus

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
