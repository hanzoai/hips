---
hip: 1241
title: Metrics — One Native Store, Three Signals
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: metrics
status: Final
implementation-go: shipped
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1241: Metrics — One Native Store, Three Signals

## Abstract

`/v1/metrics` is the cloud's native signal store: metrics, logs and traces,
written and queried per tenant against one WAL-durable store under the
deployment's data dir. The routes are registered by the `hanzoai/metrics`
module and mounted by `hanzoai/cloud` (`build.go:1162`, `MountMetrics`); the
capability's row is `manifest/apps.go:59`. This HIP replaces HIP-0064, which
specified a log stack — a collector fleet, a shared warehouse database and a
search service — that this codebase does not run.

## Motivation

One app, one store, three top-level addresses: the module serves
`/v1/metrics/*`, `/v1/logs/*` and `/v1/traces/*` from the same store. That is
HIP-0139 §7.1's exact case — an app with one store is one capability however
many nouns it answers for — and the two foreign roots fold.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### The addresses, and the two that fold

The capability answers eleven operations (`plugin/metrics/openapi.json`):
write, query and health for each signal, plus the metric batch endpoint and the
single-trace read. Every route MUST be under `/v1/metrics`:

- `/v1/logs/{write,query,health}` → `/v1/metrics/logs/{write,query,health}`
- `/v1/traces/{write,query,trace,health}` → `/v1/metrics/traces/{…}`

The two standing pairs are ledgered in cloud's `openapi/misfiled.txt` and
close by this fold, never by alias. A rename to a covering word was considered
and refused: HIP-0139 §7.3 permits taking only an EXISTING address's name, and
neither `logs` nor `traces` names the whole. `o11y` is not the owner — it
serves `/v1/o11y/logs` and `/v1/o11y/traces` against a different store
(HIP-1240).

Every operation is value-shaped, and none is typed in cloud: the module
registers its own routes and imports only `zap-proto/zip` and `luxfi` —
deliberately, it depends on what it uses — so it cannot reach the prose
registry. The prose is therefore declared beside the mount
(`build.go:1197`, `describeMetrics`), keyed to the addresses, registered only
when the routes are.

### The store

The capability owns its own store and nothing else: a per-tenant, WAL-durable
native store under `Deps.DataDir` (`hanzoai/metrics` `mount.go`), ingesting
`luxfi/metric.MetricBatch` — the same shape the ZAP `MsgMetricBatch` transport
carries — behind a deliberately tiny storage API (Append, Query, SeriesCount).
It shares nothing with the `event.*` warehouse plane.

### The tenant

The org is handed down, never read here: `MountMetrics` passes
`Org: principal.Org` — the identity boundary's one tenant decision (HIP-0026)
— into the module's own Deps (`build.go:1167-1169`). The module MUST NOT
resolve its own tenant from a request header. It once did, reading `X-Org-Id`
directly, and a header a caller sends meant an anonymous request could read
and write any org's telemetry (`build.go:1141-1146`); the rule lives once, at
the boundary that authenticates.

### Price, events, emission, stage

It is free, in those words: `Price: cloud.Free`
(`plugin/metrics/main.go:21`). It publishes no events on the bus, so a
customer's webhooks receive nothing from it. It emits nothing to observability
beyond the request span every route gets: it is where signals land, not an
emitter of its own. The stage is `ga` — the manifest row declares none, and
absent is `ga` (HIP-0139 §8).

### Upstream

The module is `hanzoai/metrics` v1.110.6 (`go.mod:693`), MIT, copyright 2026
Hanzo AI. It derives from none: the store is native Go, prometheus-free by
declaration (`store.go` package doc), speaking PromQL-compatible queries as a
wire fact. The v1.110.6 tag also carries the module's own NOTICE declaring the
repository archived and succeeded by `hanzoai/o11y`; `hanzoai/cloud` at HEAD
remains its importer and this surface remains served, so the succession is a
proposal this HIP's amendment process owns, not a fact of the router.

## Rationale

The alternative to the fold is three sibling capabilities, one per signal.
That is refused on the store: one writer, one directory, one registry —
splitting it would put three names on one store, the defect HIP-0106 names.
The alternative to declaring prose in cloud is having the module import the
registry, which would trade its whole dependency discipline for docstrings.

## Security Considerations

The wrong implementation here is the one the module shipped first: a tenant
resolved from a caller-supplied header, which turns every write endpoint into a
cross-tenant write and every query endpoint into a cross-tenant read. The fix is
structural — the org function is injected by the boundary that validated the
principal, and the module has no other way to name a tenant. Ingest endpoints
accept unauthenticated-looking traffic shaped as batches; they still resolve
the same injected org, so a batch without a validated principal lands nowhere.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1240 — O11y — The Observability Plane

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
