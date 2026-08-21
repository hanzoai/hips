---
hip: 1113
title: Cloudflare — The Per-Org Asset Plane
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: cloudflare
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0126, HIP-0139
---

# HIP-1113: Cloudflare — The Per-Org Asset Plane

## Abstract

`/v1/cloudflare` is an org's own Cloudflare account, managed from Hanzo: zones
and their analytics, Pages, Workers, Workers AI, R2, KV and D1, all driven
through the API token that org connected. It is implemented in `hanzoai/cloud`
`apps/cloudflare`. This HIP states the two separations that define it — how you
connected is the integrations plane, what you manage is this plane; and every
call rides the org's own token, so the platform never reaches Cloudflare with a
global credential.

## Motivation

Connecting a provider and managing its resources are different concerns with
different lifetimes: a connection is made once and custodied, resources are
driven daily. Braiding them puts credential custody inside every resource
handler. The split gives each one owner: `/v1/integrations/cloudflare/*`
connects (HIP-0126), `/v1/cloudflare/*` manages
(`apps/cloudflare/cloudflare.go:7-13`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The token, and the one door to it

The capability owns no store. Its only state is the per-org API token, sealed
in KMS at `/orgs/{org}/integrations/cloudflare/api_token` and read in-process
through the one custody seam `integrations.TokenFor`
(`apps/cloudflare/cloudflare.go:24-27`) — the same coordinate both the apikey
and OAuth connect paths seal to, and that DNS reads. The token MUST ride only
the Authorization header of the outbound request to
`https://api.cloudflare.com/client/v4` (`apps/cloudflare/cloudflare.go:92`);
it is never logged, echoed in an error, or stored by this subsystem.

Fail-closed: an org that has not connected, an unmounted integrations plane, or
a KMS that is not Ready each answer 503 — never another org's data and never a
silent success (`apps/cloudflare/cloudflare.go:39-41`).

### §2 Tenancy

Every handler resolves the org from the validated principal (`principal.Org`,
HIP-0026), never a body or query field, and that org is the only input to token
custody — so a request can only ever address its own org's Cloudflare account.
No validated principal means 403; a non-SuperAdmin bearer has its org pinned by
the identity boundary, so it cannot name another
(`apps/cloudflare/cloudflare.go:22-34`).

### §3 The addresses

Everything is under `/v1/cloudflare`: `zones` (list, detail, analytics, purge),
`pages/projects` (with deployments and domains), `workers/scripts` (with
subdomain and zone routes), `r2/buckets`, `kv/namespaces` (with values),
`d1/databases` (with query), and `ai/run/{model}`. The resource operations are
typed; `ai/run` is the one relay — the model's body passes through, bounded by
`maxAIBody`, and the wire test (`apps/cloudflare/relay_wire_test.go`) holds it.

### §4 Money

The capability is metered (`plugin/cloudflare/main.go:21`), and Workers AI is
the one operation that debits: an `/ai/run` is inference, so it meters through
the same usage spine as every model call, at the thin BYO fee — the org's own
token already paid Cloudflare for the compute. The gate runs before any
Cloudflare contact, on a floored estimate (`BYOInferenceFeeMicros`, so
`gateCents ≥ 1` even for a modality whose token estimate is 0), and the exact
debit lands after the call on the tokens the model reported
(`apps/cloudflare/ai.go:112-160`). The payer is `principal.Ledger`;
`MeterUsage` records under provider `ai`, service `workers-ai`, so this spend
sums with LLM spend on the same axis. Everything else is passthrough on the
org's own account and costs nothing here.

### §5 Events, telemetry, stage, upstreams

It publishes no events on the bus. Beyond the request span, `/ai/run` emits one
`gen_ai` span on the same plane as every model call, with system `cloudflare`
and per-model attribution (`apps/cloudflare/ai.go:129-131`). Its stage is `ga`:
it is platform infrastructure — the sibling of `/v1/dns` and `/v1/domain` — not
a vertical application. It derives from no upstream; it speaks Cloudflare's
public REST API v4 directly as a wire fact, with no vendored SDK.

## Rationale

The alternative to per-org tokens is a platform-level Cloudflare credential
with tenancy enforced by our own bookkeeping. That is one secret whose
compromise is every org's infrastructure, and it makes the platform the
customer of record for assets that are the org's. Deriving the token path from
the validated org makes cross-org reach structurally impossible rather than
policed — the coordinate for another tenant's token is never constructed.

## Security Considerations

The wrong implementation here hands an attacker another org's Cloudflare
account: DNS, live sites, storage, and edge code — enough to serve malware from
a victim's domain. The org-to-token derivation in §2 is the whole defense, and
the fee gate in §4 is the second: without it, a relay to a paid inference API
is a free-compute primitive billed to nobody. Both fail closed, and a frozen or
over-cap org is refused before Cloudflare is ever contacted — no discovery, no
run (`apps/cloudflare/ai.go:113-120`).

## References

- HIP-0026 — Identity and Access Management
- HIP-0126 — Integrations, Connectors & the Extension Runtime
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
