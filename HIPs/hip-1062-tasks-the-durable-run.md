---
hip: 1062
title: Tasks — The Durable Run
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: tasks
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0119, HIP-0139
---

# HIP-1062: Tasks — The Durable Run

## Abstract

A durable run is work that survives the process that started it. `hanzoai/tasks`
is the event-sourced engine that provides one — workflows, activities, schedules,
task queues, workers — and `/v1/tasks` is the cloud's door onto it, together with
the studio the run history is read in.

This HIP specifies the door: which engine answers, how a request becomes a
tenant's shard, and why this surface is a relay rather than a typed operation set.
The implementation is `hanzoai/cloud` `apps/tasks`.

## Motivation

The engine is per **process**. Its store has one writer, so two processes sharing
a directory is a collision, and each binary that needs durability embeds its own
over its own data directory. That makes "the engine" a fact about a binary rather
than about the cluster, and it is the fact everything below follows from.

It has already bitten once, silently and completely. A worker registered its
presence through this surface, into this process's engine; a different app
rendered the fleet from its own engine, where nothing had ever been written. The
result was a connected machine that heartbeat every thirty seconds and was
invisible to every read that looked for it. Nothing errored.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### One engine per process, and this door fronts it

This subsystem MUST NOT create an engine. The cloud binary embeds exactly one
(`cloud/durable.go`), shared with the durable ingest path, and this door mounts
that engine's handlers. The Tasks product and the ingest path therefore read the
same durable state.

The engine is wired after mounting, so the surface resolves it lazily per request
and answers 503 until it is live. A door that reported healthy before the engine
existed would be reporting on itself.

### Reads across processes are asked for, not opened

A process that does not own an engine MUST NOT open another process's store. It
asks: the engine's owner publishes an org-scoped read on the internal plane
(`apps/tasks/activities_rpc.go:34`) and the writer stays where it is.

The org on that read is the caller's own and cannot be named in the input, so a
caller can never page another tenant's activities. The namespace is the caller's
to choose, but only inside the shard its identity already pinned. Rows cross as
the engine's own JSON: re-shaping them into a type declared on the plane would put
a second copy of the engine's model in a package that does not own it.

### Identity, and the org that is absent

Requests arrive with the identity boundary's minted org and user (HIP-0026),
resolved through the one place the data plane turns a request into an org. What
that decision refuses, this surface refuses — 403, never the unscoped store.

A principal that is validated but carries **no** org MUST also be refused. That
request would otherwise read the shared unscoped store instead of anyone's shard,
which is the failure mode most worth closing because it looks like success.

Two surfaces are open by decision: the capability flags a client bootstraps from,
and cluster liveness. Neither carries tenant data.

### Why the operations are not typed

A typed operation is one method at one path with one input and one output; it is
also the single registry entry every projection reads, so anything outside it
publishes no schema, no tool and no client method. The engine's surface cannot fit
that shape, and each blocker is measured rather than asserted
(`apps/tasks/typed_wire_test.go`):

- The bare noun answers a redirect to its own subtree on every method, decided by
  the engine's router before any handler runs. A typed operation has no vocabulary
  for a redirect or its location header.
- One wildcard route carries the engine's whole operation set, matched by path
  segment inside the engine's own router. There is no route here to type, no named
  input type to type it with, and no value to answer with: the engine hands cloud
  its surface as a handler.
- That one route serves several content types at once — JSON, plain-text
  refusals, and an event stream — and its errors carry a numeric field where the
  rest of this API carries a status string.

The consequence is stated rather than hidden: a generic client will be surprised
by both facts, so the door **declares prose beside the wire fact**, keyed on
method and path, rendering only while the router serves the route. That is what
stops the document, the generated clients and the spec-derived CLI from offering
calls they cannot explain.

The place these operations can become typed is `hanzoai/tasks`, which owns them.
Typing them in cloud would put a second copy of that module's route table here,
free to drift from the one that actually answers.

### Schedules are a facet, not a subsystem

Platform cron mounts no routes. It registers durable schedules on this same
engine, and is folded in here so there is one tasks subsystem rather than two that
must agree.

### Addresses, and the one that is legacy

The door serves two shapes — the bare noun's redirect and the one wildcard route
that carries the engine's operation set, on every method — under one prefix,
`/v1/tasks`. The bare `/tasks` the studio shipped with is gone.

The studio is not a cloud address. It is its own image (`ghcr.io/hanzoai/admin-tasks`,
built from `hanzoai/admin` `apps/tasks` at base `/`) at the root of
`tasks.hanzo.ai`, like `todo` and `meet` before it. The `/tasks` pair was
ledgered in `openapi/misfiled.txt` and closes by deletion, not by fold.

It is the one of the three that could not simply move, and the reason belongs
here because it decides the ROUTING rather than the code. The studio reads
`/v1/tasks` with same-origin credentials and carries no bearer, so the
arrangement `todo` and `meet` use — a static host and a cross-origin API —
would send no credential at all. So the host is split at the edge instead: the
bundle from its own pods, `/v1/tasks` to cloud, which is the shape
`console.hanzo.ai` already runs. The browser sees one origin, and nothing about
the requests cloud receives changes.

That split carves ONE prefix, measured against the built bundle rather than
assumed. The bundle names three — `/v1/tasks`, `/v1/csrf`, `/v1/iam` — and only
the first is same-origin: `/v1/csrf` is fetched through `@hanzogui/admin`'s
`apiUrl()`, which resolves to the brand's API origin on every `hanzo.ai` host,
and `/v1/iam` belongs to shared IAM-policy screens this app routes nowhere.

### What it owns, charges and emits

The capability owns no store. The durable state is the embedded engine's — one
SQLite with one writer under cloud's data dir (durable.go) — and this door fronts
it; a second store here would be the second copy of the engine's model this HIP
refuses everywhere else.

It is free, in those words: the plugin declares `Price: cloud.Free`
(plugin/tasks/main.go:25), and no meter runs behind any route.

It publishes no events on the platform bus, so a customer's webhooks (HIP-1310)
receive nothing from it. It emits nothing to observability beyond the request
span every route gets: the run history is read through this door from the
engine's own record, not from exported spans.

### Stage and upstream

The stage is `ga` — the manifest row declares none, and absent is `ga`
(HIP-0139 §8).

The engine is `hanzoai/tasks` (pinned v1.52.9 in cloud's go.mod), a fork of
Temporal (MIT). What survives in HEAD is the event-sourced core — workflows,
activities, schedules, task queues, workers — embedded in-process
(`tasksengine.Embed`), with the gRPC surface removed.

## Rationale

The alternative to a relay is to model the engine's surface in cloud and translate.
It buys typed clients and costs a second route table that drifts, plus a reshaped
answer that breaks the moment the engine adds a field. The relay keeps one owner
for the wire; the prose declaration recovers most of what typing would have bought
without claiming ownership the cloud does not have.

## Security Considerations

The gate is the org, and the dangerous case is its absence rather than its
forgery: an unscoped read is a read of every tenant's shard. It fails closed.

The cross-process read is the other exposure and is narrowed the same way — the
org is not an input, so the only shard a caller can address is its own.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0119 — Hanzo Service Conventions

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
