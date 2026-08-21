---
hip: 0061
title: Notification & Messaging Service Standard
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2026-02-23
requires: HIP-0026, HIP-0027, HIP-0106, HIP-0139
capability: [notify, webhooks]
---


# HIP-0061: Notification & Messaging Service Standard

## Abstract

Two capabilities carry "the platform tells someone something", and this HIP
specifies both. **notify** (`/v1/notify`) is transactional email and SMS, sent
through the caller org's own provider credential. **webhooks** (`/v1/webhooks`)
is how a customer's app hears about events: register an HTTPS endpoint, pick the
events, get each one delivered and signed. The implementations are
`hanzoai/cloud` `apps/notify` and `apps/webhooks`.

One file declaring two names is the defect HIP-0139 §6 names — two
specifications in one file. The split is owed; until it lands, this file is the
one specification of both, and each half below meets the capability contract on
its own.

## Motivation

Notifications are everywhere in the platform — IAM sends OTP codes and login
alerts, commerce sends receipts, the cloud sends deployment and billing facts.
Without one send rail, each subsystem integrates a provider independently:
provider sprawl, N credential custody paths, and no single place to answer "did
it go out". Without one webhook layer, each subsystem grows its own delivery
loop — commerce had one, billing-scoped, before the platform-global layer
superseded it (`apps/webhooks/webhooks.go`).

The first version of this HIP specified a standalone notification service —
fallback chains across push, in-app, email and SMS; a template database;
preference management; its own Postgres, Redis and WebSocket server. Measured
against what runs, almost none of that exists: the standalone `notifyd`'s only
production consumer is IAM's OTP sender, its template and provider tables are
empty in the live tenant, and the async worker plane has no consumer
(`apps/notify/notify.go` package doc). The cloud fold serves the one live
contract natively and drops the rest. What this file specifies now is what
answers.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### Notify — the addresses

Four typed operations at `/v1/notify` (plugin/notify/openapi.json): `/health`,
`/send`, `/send/email`, `/send/sms`. The per-channel routes pin the channel,
overriding whatever the body names; the generic route reads it from the body.
All typed, none declared.

The wire contract is `notifyd`'s, kept byte-compatible so IAM's OTP decoder
keeps working unchanged: one recipient answers the bare
`{message_id,status}` outcome, several answer the `{items:[…]}` envelope, and a
terminal provider failure is a **200 whose status is `failed`** with the reason
in `error` — never a transport error, so a batch reports every recipient's
outcome instead of dying on the first (`apps/notify/notify.go`).

`sync=true` is REQUIRED. Async dispatch answers 503, exactly as `notifyd` does
without a connected worker, because the queue plane that would run it is owned
elsewhere — a silent sync fallback would mask a misconfiguration.

### Notify — providers and custody

The provider set is the four `notifyd` services the fold constructs: `twilio`
and `plivo` for SMS, `twilio_email` and `mail` (SMTP) for email
(`apps/notify/notify.go` constructProvider). Naming no provider picks the one
whose credentials are actually configured, in that preference order, and fails
closed when none is.

Credentials are KMS only — never env, never plaintext, never logged. Each key is
read at the org-scoped, rotatable ref `orgs/<org>/notify/<service>/<key>`, the
same `/orgs/<org>` namespace integrations uses, so a credential is writable and
rotatable through the KMS surface with a validated org token. A missing key
yields an empty value and provider construction fails closed.

Templates are built-in, in code: the registry ships what the live surface needs
(the IAM OTP template, per channel), because the standalone service's template
store is empty in production and a runtime seeding step would be a second thing
to deploy. A raw `body` wins verbatim; otherwise `template_id` or the `event`
name selects from the registry. Extending the registry is the one way to add a
template; forking the render path is not.

### Notify — what "sent" means

`status: "sent"` means the provider accepted the request. This surface confirms
nothing further — there is no bounce handling, no delivery event, no open
tracking — and a consumer MUST NOT read `sent` as delivered. The one live
consumer (IAM) treats it as submission success, which is what it is.

### Notify — tenancy, store, price, emissions

The org is the validated principal's (HIP-0026), never a client-supplied header
— the standalone service was cluster-internal and trusted a raw org header; the
fold is reachable through the public gateway, so the trust boundary moved into
the code. An unauthenticated caller gets 401; a signed-in caller can only send
as their own tenant.

It owns no store: no database, no queue — the only state it touches is the KMS
credential it reads per send. It is free, in those words: the plugin declares
`Price: cloud.Free` (plugin/notify/main.go:21). It publishes no events on the
platform bus, so a customer's webhooks receive nothing from it, and it emits
nothing to observability beyond the request span every route gets — a failed
send is logged with org, channel and provider, never the message body.

Its stage is `ga` — the manifest row declares none, and absent is `ga`
(HIP-0139 §8). Its upstream is `github.com/hanzoai/notify` (pinned v1.7.2 in
cloud's go.mod), a fork of nikoksr/notify (MIT); what survives in HEAD and is
imported directly is the provider packages
(`service/{twilio,twilioemail,plivo,mail}`) and the wire types (`pkg/types`).
Only the credential-to-constructor glue is mirrored in cloud, because it is
internal to that module.

### Webhooks — two orthogonal halves

**The registry** is CRUD at `/v1/webhooks` (plugin/webhooks/openapi.json): list,
create, get, replace, delete; a delivery listing per endpoint
(`/{id}/deliveries`); secret rotation (`/{id}/secret`); and a test delivery
(`/{id}/test`). All typed, none declared. Endpoint URLs MUST be `https://`
(`apps/webhooks/api.go:490`). Each org's registry is a physically separate
per-org store (`{DataDir}/orgs/{slug}/webhooks.db` via `cloud.OrgStore`), so one
tenant can never read or mutate another's endpoints; the org is the validated
principal's, and an unauthenticated caller gets 401.

**The dispatcher** is a durable consumer on the platform bus (HIP-1060) over the
streams it does not own: the commerce plane (`commerce.>`, owned by
hanzoai/commerce) and the canonical event plane (`event.>`, owned and published
by the analytics subsystem) — `apps/webhooks/dispatch.go`. It resolves each
event's org from the envelope's own tenant field, matches ONLY that org's active
subscriptions with subject-wildcard semantics (`commerce.order.>` works), and
POSTs each match. Isolation is by construction: the store lookup is per-org, so
one org's endpoint can never receive another's event.

This capability is a CONSUMER ONLY. It publishes nothing and owns no stream —
it once held the publish half too, which made two subsystems owners of one
subject space, and the broker answers that by refusing the second owner,
forever. The producer lives with the data.

### Webhooks — the delivery contract

Every delivery is signed fresh: `X-Webhook-Signature: t=<unix>,v1=<hex>` where
`v1` is HMAC-SHA256 of `"<t>.<body>"` under the endpoint's secret, beside
`X-Webhook-Event` (the subject) and `X-Webhook-Delivery` (a UUID stable across
the attempt group) — `apps/webhooks/dispatch.go:415`. Receivers MUST validate
the signature before processing.

Delivery is at-most-once-per-attempt-group with a bounded retry ladder: three
attempts, waiting 1s then 5s between them, each POST bounded by a 10-second
timeout (`apps/webhooks/dispatch.go:68`). A non-2xx answer or a timeout is a
failed attempt. There is no auto-disable and no dead-letter queue; the per
-attempt outcome is recorded as a delivery-log row in the endpoint's own store,
which is what `/{id}/deliveries` reads back.

The signing secret is minted server-side — 256 random bits, `whsec_`-prefixed
so a leaked value is greppable (`apps/webhooks/api.go:559`) — and leaves the
server exactly twice: on create and on rotate. Every other response redacts it.
Rotation is immediate: the old secret stops signing the instant the rotate
returns.

### Webhooks — mount posture, store, price, emissions

The registry always mounts; the dispatcher is best-effort — a down bus means
background reconnect-retry, and a messaging fault never crashes the process or
takes `/v1/webhooks` down with it.

The store it owns is the per-org registry-and-delivery-log SQLite
(`endpoint` and `delivery` tables, `apps/webhooks/store.go:59`). It is free, in
those words: the plugin declares `Price: cloud.Free`
(plugin/webhooks/main.go:21). What a customer's webhooks receive is the point
of the capability — every event on the consumed planes that names their org —
and it publishes none of its own. It emits nothing to observability beyond the
request span every route gets; the delivery record is its own store's rows, not
exported spans.

Its stage is `ga` — the manifest row declares none, and absent is `ga`
(HIP-0139 §8). It derives from no OSS upstream; the bus is reached over the
`nats.go` client (Apache 2.0).

## Rationale

The fold over a rewrite: `notifyd`'s provider packages are imported, not
reimplemented, so the delivery code has one home and the cloud carries only the
trust boundary and the glue its module boundary forces. The alternative — keep
the standalone Deployment and relay to it — preserves a second process, a
second credential path and a cluster-internal trust model that the public
gateway had already invalidated.

Consumer-only dispatch over publish-and-deliver: one owner per stream is what
keeps two subsystems from configuring the same subjects apart until neither
delivers. The dispatcher reads the planes their owners declare and adds only
the org-scoped match and the signed POST.

## Security Considerations

**Notify.** The dangerous request is the unscoped one: a send billed to another
org's provider credential, or an OTP-shaped message sent as someone else's
brand. Both close at the same boundary — the org is the validated principal's,
and the KMS ref is derived from it server-side, so there is no request shape
that names another tenant's credential. Secrets never appear in logs or
responses; message bodies are never logged.

**Webhooks.** The endpoint secret signs everything a customer's receiver
trusts, so its custody rules are the surface's core: minted server-side,
revealed twice, redacted everywhere else, rotated in one call. The dispatcher's
org resolution is the other boundary — an attacker who registers an endpoint
receives only events whose envelope names their own org, because the match is a
lookup in their org's store, not a filter over everyone's. Endpoint URLs are
HTTPS-only, and delivery POSTs carry the event and its signature, nothing of
the platform's own.

## References

- HIP-0026 — Identity & Access Management Standard
- HIP-0027 — Secrets Management Standard
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1060 — Pubsub — The Tenant Door on the Bus
- [hanzoai/notify](https://github.com/hanzoai/notify) — the provider library the fold imports

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
