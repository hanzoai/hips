---
hip: 1240
title: O11y — The Observability Plane
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: o11y
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0135, HIP-0139
---

# HIP-1240: O11y — The Observability Plane

## Abstract

`/v1/o11y` is your logs, metrics, traces and errors: ship them in, query them,
chart them (`apps/o11y/o11y.go:1`). One subsystem owns the cloud's whole
observability plane — the tenant-scoped reads, the query engine, the dashboards
and alerts, the Sentry-compatible error face, and the public platform status
document. The implementation is `hanzoai/cloud` `apps/o11y` over the embedded
`hanzoai/o11y` runtime. `o11y` is a sanctioned abbreviation (HIP-0139 §2.5).

## Motivation

This plane was five separately registered subsystems whose names leaked five
public concepts; they collapsed to one registration of the name `o11y`
(`apps/o11y/o11y.go:23-31`). The addresses have not finished following: the
manifest row still carries three roots outside the capability's own
(`manifest/apps.go:84`). This HIP states the surface the name rule settles.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### The addresses, and the three that fold

Every route this capability serves MUST be under `/v1/o11y`. Three families
still answer at other roots — `/v1/sentinel`, `/v1/summary` and
`/ws/query_progress` (`manifest/apps.go:84`); each pair is ledgered in cloud's
`openapi/misfiled.txt` and closes by fold, never by alias:

- The Sentry-compatible face — projects, issues, stats, traces, the reads a
  signed-in person makes — moves to `/v1/o11y/sentinel/*`. It is the SAME
  runtime under a second path family with no rewrite (`apps/o11y/o11y.go:535`),
  so it is one capability's second face, not a second capability.
- The public status document moves to `/v1/o11y/summary`
  (`apps/o11y/summary.go:156`). It stays unauthenticated — a status read must
  work when IAM is down and carries no tenant data — and unauthenticated is
  not un-prefixed.
- The websocket progress read moves onto its own HTTP twin: `/ws/query_progress`
  is the same read as `/v1/o11y/query_progress` delivered over an Upgrade
  (`apps/o11y/o11y.go:132,141`), so the fold is one address, two protocols.

The beacon endpoint is NOT this capability's address: `/v1/event` belongs to
`event` (HIP-1190), which forwards the Sentry wire through
the plane ops to this capability's sink (`apps/o11y/o11y.go:651`,
`apps/o11y/obs_rpc.go`). A minted DSN keeps addressing `/v1/event` unchanged.

The runtime names every route, and the typed ones carry their prose in their
own doc comments. The ones that cannot be values are declared with prose
beside the wire fact (`apps/o11y/o11y.go` init): the live tail and the
progress read are a stream and a long poll, with no single value to answer;
the raw export answers a file, not JSON; the sign-in callbacks answer a
Location header and no body; the DSN ingest paths carry a foreign wire the
SDKs own the spelling of; and the sentinel wildcard is a relay whose routes
the runtime carries.

### The store

The capability owns the `event.*` plane on the shared warehouse — `event.event`,
`event.log`, `event.span`, `event.metric`, `event.error`, one shared envelope
(`apps/o11y/LLM.md:437-438`) whose DDL the `hanzoai/o11y` module owns — plus
the runtime's control-plane metadata in SQLite under cloud's data dir
(`apps/o11y/embed.go:80-96`).

### The tenant

Telemetry is a tenant's OWN data, so org membership is the whole admission
test (`apps/o11y/o11y.go:367`): no validated principal is 403; a validated but
org-less principal is refused rather than served unscoped; the org is the
identity boundary's minted claim (HIP-0026), never a header the caller sends.
Platform sudo buys the cross-tenant fleet view one level in — it MUST NOT be
the product gate, because that would make the only way to see your own errors
a scope that shows you everyone's. Which operations are exempt is the module's
own answer (`module.Anonymous`); the DSN ingest authenticates by publishable
key, in constant time, failing closed, and derives the org from the key.

### Price, events, emission, stage

It is free, in those words: telemetry ingest charges nothing and declares
`cloud.Free` (`spend.go:196`). It publishes no events on the bus, so a
customer's webhooks receive nothing from it; alert delivery leaves through the
module's own alert egress, which reports delivery as delivery, never arrival
(`apps/o11y/alerts.go`). Its own emission is the plane itself: cloud's spans
land in `event.span` (`apps/o11y/LLM.md:494`) and the fleet probes write
`hanzo_service_up` into `event.metric` every 30 seconds (`apps/o11y/probes.go`)
— the signal `/v1/o11y/availability` and the summary project. The stage is
`ga`, and the row is Eager (`manifest/apps.go:84`): a status document read
during an outage must not pay a cold start.

### Upstream

The runtime is `hanzoai/o11y` v1.5.66 (`go.mod:694`), forked from SigNoz
(MIT Expat, copyright 2020–present SigNoz Inc.), synced to upstream `main` at
`3e6339019`. What survives in HEAD is the query service, dashboards, alerts,
rule manager and sqlstore, constructed in-process by the one builder the
standalone binary uses (`apps/o11y/embed.go`). The Sentry face implements
that wire (`hanzoai/o11y` `pkg/modules/sentry/implsentry`); it takes no code
from Sentry.

## Rationale

The alternative to the sentinel fold is a split — errors as their own
capability. It is refused on the store: both faces read the same runtime over
the same `event.*` plane, and HIP-0139 §7.2 permits a split only along a store
boundary. The alternative for the websocket was keeping a transport-named
root; folding the Upgrade onto its HTTP twin leaves one address for one read.

## Security Considerations

The dangerous case is the absent org, not the forged one: the gate reads only
server-minted identity headers, and an org-less request is refused rather than
served unscoped. The ingest exemption is matched by method plus prefix plus
suffix, never a bare prefix, so no read is reachable through it. The status
document never answers "operational" from an absence of data — when the
availability source cannot be read it answers 503, because a green status page
over a blind probe is the one output worse than none (`apps/o11y/summary.go`).

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0135 — What Is Public
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
