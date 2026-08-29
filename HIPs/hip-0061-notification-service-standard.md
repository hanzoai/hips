---
hip: 0061
title: Notification & Messaging Service Standard
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Final
created: 2026-02-23
requires: HIP-0026, HIP-0027, HIP-0106, HIP-0139
capability: notify
---


# HIP-0061: Notification & Messaging Service Standard

## Abstract

**notify** (`/v1/notify`) is transactional email and SMS, sent through the
caller org's own provider credential. The implementation is `hanzoai/cloud`
`apps/notify`.

Outbound delivery to a customer's own endpoint is the separate `webhook`
capability — HIP-1310.

## Motivation

Notifications are everywhere in the platform — IAM sends OTP codes and login
alerts, commerce sends receipts, the cloud sends deployment and billing facts.
Without one send rail, each subsystem integrates a provider independently:
provider sprawl, N credential custody paths, and no single place to answer "did
it go out".

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

### The addresses

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

### Providers and custody

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

### What "sent" means

`status: "sent"` means the provider accepted the request. This surface confirms
nothing further — there is no bounce handling, no delivery event, no open
tracking — and a consumer MUST NOT read `sent` as delivered. The one live
consumer (IAM) treats it as submission success, which is what it is.

### Tenancy, store, price, emissions

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

## Rationale

The fold over a rewrite: `notifyd`'s provider packages are imported, not
reimplemented, so the delivery code has one home and the cloud carries only the
trust boundary and the glue its module boundary forces. The alternative — keep
the standalone Deployment and relay to it — preserves a second process, a
second credential path and a cluster-internal trust model that the public
gateway had already invalidated.

## Security Considerations

The dangerous request is the unscoped one: a send billed to another org's
provider credential, or an OTP-shaped message sent as someone else's brand.
Both close at the same boundary — the org is the validated principal's,
and the KMS ref is derived from it server-side, so there is no request shape
that names another tenant's credential. Secrets never appear in logs or
responses; message bodies are never logged.

## References

- HIP-0026 — Identity & Access Management Standard
- HIP-0027 — Secrets Management Standard
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1310 — Webhooks — Outbound Delivery
- [hanzoai/notify](https://github.com/hanzoai/notify) — the provider library the fold imports

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
