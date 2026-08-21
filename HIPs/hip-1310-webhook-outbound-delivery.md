---
hip: 1310
title: Webhook — Delivery to an Endpoint You Own
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: webhook
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139, HIP-1060
---

# HIP-1310: Webhook — Delivery to an Endpoint You Own

## Abstract

`/v1/webhook` is how a customer's own software hears about what happens in
their tenant: register an HTTPS endpoint, receive every event that names the
org, signed. The implementation is `hanzoai/cloud` `apps/webhook`.

Two orthogonal halves: a **registry** the customer writes — endpoints, secrets,
delivery log — and a **dispatcher** that consumes the platform bus and POSTs. It
is a consumer only, owning no stream, because the producer lives with the data.

## Motivation

Before the platform-global layer, each subsystem that wanted to tell a customer
something grew its own delivery loop — commerce had one, billing-scoped
(`apps/webhook/webhooks.go`). N loops is N retry ladders, N signature schemes
and N answers to "did it arrive", each implemented separately by every receiver.

It also shared HIP-0061 with `notify`: two specifications in one file, which
HIP-0139 §6 allows only for a merge in flight. Nothing is merging — `notify`
sends to a person through the org's provider credential, `webhook` delivers to
a machine at an address the customer registered.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The registry

CRUD under `/v1/webhook` (`plugin/webhook/openapi.json`): list, create, get,
replace and delete an endpoint; `GET /{id}/deliveries` reads the attempt log;
`POST /{id}/secret` rotates the signing secret; `POST /{id}/test` sends one
delivery on demand. Every operation is typed; none is declared. An endpoint URL
MUST be `https://` (`apps/webhook/api.go:490`), refused at create, because the
signature protects integrity and nothing protects a payload sent in the clear.

### §2 The dispatcher

A durable consumer on the platform bus (HIP-1060) over streams it does not own —
the commerce plane (`commerce.>`, owned by `hanzoai/commerce`) and the canonical
event plane (`event.>`, owned and published by analytics), `apps/webhook/dispatch.go`.

It MUST resolve each event's org from the envelope's own tenant field and match
ONLY that org's active subscriptions, with subject-wildcard semantics so
`commerce.order.>` selects the family. Isolation is by construction, not by
filter: the lookup reads one org's store, so no query shape makes another
tenant's endpoint a candidate.

It MUST NOT publish — it once held the publish half too, making two subsystems
owners of one subject space, and the broker settles that by refusing the second
owner permanently. The registry always mounts; the dispatcher is best-effort, so
a down bus means background reconnect-retry and a messaging fault MUST NOT take
`/v1/webhook` down with it.

### §3 The delivery contract

Every delivery is signed fresh: `X-Webhook-Signature: t=<unix>,v1=<hex>`, where
`v1` is HMAC-SHA256 of `"<t>.<body>"` under the endpoint's secret, beside
`X-Webhook-Event` (the subject) and `X-Webhook-Delivery` (a UUID stable across
the attempt group) — `apps/webhook/dispatch.go:415`. A receiver MUST validate
the signature before processing; the timestamp is inside the signed string, so a
captured body cannot be replayed under a fresh one.

Delivery is at-most-once per attempt group with a bounded ladder: three
attempts, 1s then 5s between them, each POST bounded by a 10-second timeout
(`apps/webhook/dispatch.go:68`). A non-2xx answer or a timeout is a failed
attempt. There is no auto-disable and no dead-letter queue; each outcome is a
row in the endpoint's delivery log, which `GET /{id}/deliveries` reads back.

The signing secret is minted server-side — 256 random bits, `whsec_`-prefixed so
a leaked value is greppable (`apps/webhook/api.go:559`) — and leaves the server
exactly twice, on create and on rotate; every other response redacts it, and
rotation is immediate.

### §4 Tenant, store, price, emission, stage, upstream

The org is the validated principal's (HIP-0026), never a client-supplied header;
an unauthenticated caller gets 401. The store it owns is the per-org registry
and delivery log — `endpoint` and `delivery` tables in
`{DataDir}/orgs/{slug}/webhooks.db` via `cloud.OrgStore`
(`apps/webhook/store.go:59`) — one file per org, physically separate, which is
the fact §2's isolation rests on.

It is free, in those words: `Price: cloud.Free` (`plugin/webhook/main.go:21`).
It publishes no events on the bus: what a customer's webhooks receive is the
whole point of the capability — every event on the consumed planes that names
their org — and none of it originates here. It emits nothing to observability
beyond the request span every route gets, because "did my endpoint answer" is
answered from the delivery log rather than from an exported span.

The stage is `ga` — the manifest row declares none, and absent is `ga`
(HIP-0139 §8). It derives from no OSS upstream; the bus is reached over the
`nats.go` client (Apache 2.0).

## Rationale

Consumer-only dispatch, rather than publish-and-deliver, keeps two subsystems
from configuring one subject space apart until neither delivers. The dispatcher
reads the planes their owners declare and adds the two things those owners
should not each reimplement: the org-scoped match and the signed POST. No
dead-letter queue for the same reason — that is a second store with its own
retention, tenancy question and stale-item alarm, and the attempt log already
answers what happened.

## Security Considerations

The endpoint secret is what a customer's receiver trusts, so its custody is the
surface's core: minted server-side, revealed twice, redacted everywhere else,
rotated in one call. A secret echoed on an ordinary read is a credential in
every log and proxy between here and the customer.

Org resolution is the other boundary. An attacker who registers an endpoint
receives only events whose envelope names their own org, because the match is a
lookup in their org's store rather than a filter over everyone's — and a filter
is one wrong predicate from fan-out to every tenant. The POST carries the event
and its signature and nothing of the platform's own: no operator credential, no
cross-tenant identifier, no replayable bearer.

## References

- HIP-0026 — Identity and Access Management
- HIP-0061 — Notification & Messaging Service Standard
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1060 — Pubsub — The Tenant Door on the Bus

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
