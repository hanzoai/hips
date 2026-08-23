---
hip: 1250
title: Integrations — The Connection Registry
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: integrations
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0027, HIP-0106, HIP-0139
---

# HIP-1250: Integrations — The Connection Registry

## Abstract

An integration is a connection to a provider the platform does not own — Slack,
GitHub, Google, Stripe — held on behalf of a tenant, with the credential in
custody and the connection state in one registry. `hanzoai/cloud`
`apps/integrations` is that registry, and `/v1/integrations` is its address.

The capability has two audiences over the one store: the org plane, where an
admin connects a provider for the whole org, and the user plane, where a person
links their own accounts. HIP-0126 fixed the vocabulary and HIP-1065 specifies
the user plane's custody rules; this HIP is the capability declaration — the
store, the target address, the operations, and what the surface refuses.

## Motivation

Provider connections were the platform's most duplicated concern: each consumer
that needed a token — automations, channels, marketing — was one bad refactor
away from its own OAuth path and its own secret row. One registry with one
custody exit is what makes "is this org connected to X" a fact askable in one
place, and a token something no peer ever stores.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store

The capability owns one store: the `integrations` SQLite database
(`apps/integrations/store.go:73`, `sqlpool.Open("integrations", dir)`). One row
per (org, provider, owner); tenancy is the org column, which is part of the
primary key. Rows hold non-secret state only. Credentials live solely in the
key store (HIP-0027), sealed under a path built from the tenant — org
connections under the org, user connectors under the (org, user) pair
(`apps/integrations/integrations.go:1564`). A row MUST NOT carry a secret and a
custody failure MUST NOT leave a row behind.

### §2 The address

Every route answers under `/v1/integrations`: the provider lifecycle
(`/{provider}`, `/{provider}/connect`, `/callback`, `/verify`, `/disconnect`),
the provider-specific endpoints (Slack, GitHub, Discord, Teams, Telegram, GitLab,
OpenRouter), and the user plane at `/v1/integrations/connectors`. Today the
user plane is served at a second root, `/v1/connectors`; that pair is carried by
cloud's `openapi/misfiled.txt:34` and closes by fold — one store, so per
HIP-0139 §7.1 there is no boundary to split on. The generated clients re-point
on regeneration; the installed CLI's interactive device and PKCE flows
(`cli/src/commands/product/generated.rs:794`) hard-code the old root and a flow
in flight when the fold lands polls a dead path, so the fold MUST ship in a CLI
release that re-points them.

### §3 Operations, typed and declared

The connectors plane is typed end to end (`apps/integrations/connectors.go:55`):
list, providers, token read, device start/poll, credential intake, refresh,
delete. The org plane's OAuth callbacks, link flows and provider webhooks are
declared with prose beside the route (`openapi.Describe`,
`apps/integrations/integrations.go`) because none can be a value: a callback
answers a redirect the provider dictates, a link flow renders HTML, and a
webhook's authentication is the provider's signature over the raw body — the
signature check IS the authentication and it fails closed
(`apps/integrations/integrations.go:602`).

### §4 Tenancy

A request becomes a tenant through the validated principal's org (HIP-0026,
`principal.Org`); a client-forged org header is refused. Org-plane writes that
change what the whole org is connected to require the caller's own-org admin
bit (`principal.IsOrgAdmin` — never SuperAdmin,
`apps/integrations/integrations.go:1096`). User-plane rows are keyed by the
(org, user) pair per HIP-1065, with no admin gate. Provider webhooks arrive
with no principal and are admitted by signature alone.

### §5 Metering, events, telemetry, stage

The capability is free, said in those words: `plugin/integrations/main.go:29`
declares `Price: cloud.Free` and no spend table names it. It publishes no
events on the bus. Peers do not read its store: whether an org is connected is
asked over the internal plane (`apps/integrations/connection_rpc.go:30`), and
token handoff to in-process consumers goes through the same seam, never the
address. It emits nothing to observability beyond the request span every route
gets. Stage: `ga`.

### §6 Upstream

The capability derives from none. Every provider client is hand-rolled Go over
`net/http` against the provider's public API; no vendor SDK is imported and no
third-party project is forked, embedded or mirrored.

## Rationale

The alternative to one registry with two planes is two capabilities — org
integrations and user connectors — which reads well until the store is drawn:
both would open the same database, the defect HIP-0106 names. The two audiences
differ in key, not in kind, so they are one capability whose address says which
plane a route is on.

## Security Considerations

The wrong implementation hands an attacker credentials. The exposures, each
closed in code: a secret in a row or log (custody is the only holder, one
operation returns a token); a cross-tenant read (org in the primary key, the
(org, user) pair as the user-plane row key); a forged provider webhook
(signature verification, fail closed); a concurrent refresh destroying the
credential it refreshes (single-flight with adoption,
`apps/integrations/refresh.go:20`); and custody-path smuggling (the path is
validated before use).

## References

- HIP-0026 — Identity and Access Management
- HIP-0027 — Secrets Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0126 — Integrations, Connectors and the Extension Runtime
- HIP-0139 — Capability
- HIP-1065 — Connectors — A User's Own Credentials

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
