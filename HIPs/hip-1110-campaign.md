---
hip: 1110
title: Campaign — One Push Across Channels
author: Hanzo AI
type: Standards Track
category: Interface
capability: campaign
status: Final
implementation-go: shipped
created: 2026-08-20
requires: HIP-0026, HIP-0126, HIP-0139
---

# HIP-1110: Campaign — One Push Across Channels

## Abstract

A campaign is one go-to-market push across paid, organic and email at once: a
value — {name, audience, content[], schedule, budget, channels[], status} — that
launches to every channel and reads back as one funnel with each channel's
spend. `/v1/campaign` is that value's surface, implemented in `hanzoai/cloud`
`apps/campaign`. This HIP states what the capability owns (the campaign record,
nothing else), what it composes (the connector plane, the channel executors, the
analytics plane), and what it refuses to be (a second credential path, a second
metrics store).

## Motivation

"Campaign" used to be braided across three packages — an ad campaign in
`apps/ad`, an email campaign in `apps/marketing`, social posts in `apps/social`
(`apps/campaign/campaign.go:16-19`). Three packages meant three campaign shapes
that could not be launched together or read back as one funnel. This plane lifts
the campaign to the one value it is and makes the channels orthogonal executors
it fans out to.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store

The capability owns one store: the system namespace's `campaign` SQLite file,
opened once for every org (`apps/campaign/store.go:151`). Tenant isolation is
the `org` column, enforced on every query, and the table leads its lookup
indexes with `org` so isolation is a physical property of the index, not only a
WHERE clause (`apps/campaign/store.go:167`). A campaign round-trips as one row —
content and channels are JSON columns — so launch and pause rewrite the whole
row atomically.

### §2 The addresses

Every route is under `/v1/campaign`: the collection (list, create), the record
(get, update, delete), `summary`, and the verbs `launch`, `pause`, `metrics`,
and channel add/remove (`apps/campaign/campaign.go:45-57`). All operations are
typed through the registry (`apps/campaign/typed.go`); the wire test
(`apps/campaign/typed_wire_test.go`) holds the surface to it.

### §3 Tenancy

The org is `principal.Org` — the value the identity boundary minted from the
validated bearer owner claim (HIP-0026) — and never a client-supplied header
(`apps/campaign/campaign.go:173`). That org is the value passed to every channel
executor, so a campaign can only ever resolve its own org's connector token. A
request with no validated principal is refused.

### §4 What it composes, and never owns

- **Credentials.** The campaign object never touches one. Each channel executor
  resolves the org's connector token itself through `integrations.TokenFor`
  (HIP-0126); this plane is a consumer of connectors, never a second custody
  path.
- **Executors.** paid → `apps/ad` (registered), organic → `apps/social`, email
  → `apps/marketing`. Only the paid executor is wired today
  (`plugin/campaign/seams.go`); a campaign carrying an unwired channel launches
  its paid channels and records the others "unavailable" — honest, never a
  faked launch (`apps/campaign/campaign.go:26-30`).
- **Metrics.** Not stored here. Results are read at query time from the one
  analytics plane — `analytics.CampaignMetrics` over the `utm_campaign`-tagged
  events — plus each channel connector's reported spend
  (`apps/campaign/metrics.go`). A creative A/B composes the experiment seam
  (`apps/campaign/experiment.go`), never a second evidence store.

### §5 Money, events, telemetry, stage

The surface is free (`plugin/campaign/main.go:21`, `cloud.Free`); ad spend is
the org's own, on the org's own connector accounts. It publishes no events on
the bus. It emits nothing to observability beyond the request span every route
gets. Its stage is `beta`: it is a vertical application, not the agentic-OS
core, and its organic and email executors are not yet wired.

## Rationale

The alternative is the one the cloud had: three channel packages, each with its
own campaign shape. It launches one channel well and cannot answer "what did
this push cost across all of them" without a join nobody owns. One value fanned
out to orthogonal executors keeps each channel independently shippable and the
funnel readable in one place — and recording an unwired channel "unavailable"
was chosen over refusing the launch because a partial launch the caller is told
about is more honest than an all-or-nothing that blocks paid on email.

## Security Considerations

The dangerous authority here is not the campaign row — it is the connector
tokens the executors resolve. A wrong implementation that accepted an org from
the request body would let a caller launch a campaign that spends another
tenant's ad budget on the caller's creatives. The org therefore comes only from
the validated principal, and it is the single key to token custody. Field caps
(`maxField`, `maxContent`, `maxChannels`, `apps/campaign/campaign.go:70-77`)
bound what one write can amplify into the shared file.

## References

- HIP-0026 — Identity and Access Management
- HIP-0126 — Integrations, Connectors & the Extension Runtime
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
