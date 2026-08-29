---
hip: 1104
title: Base — The Hosted Backend
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: base
status: Final
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1104: Base — The Hosted Backend

## Abstract

`/v1/base` is managed Hanzo Base: a hosted backend for an app — collections,
records, access rules and sign-in — one engine instance per org, each on its own
SQLite. It also serves the platform's public waitlist at `/v1/waitlist`. It is
implemented in `hanzoai/cloud` at `apps/base`, embedding the
`github.com/hanzoai/base` engine in-process.

## Motivation

The engine used to run as its own pod, whose whole job was constructing a Base
and serving it, and a third prefix forwarded to a separate managed deployment
for the sake of a cross-instance registry that could only ever answer
anonymously — it held zero rows for its whole life, while two engines answered
one question from two disks. The embed collapses that to one engine, in-process,
per org (`apps/base/base.go`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 Two lanes, deliberately not one app

Lane 1 is the waitlist: ONE platform Base instance carrying the waitlist plugin,
public because a signup surface has no principal to scope by, platform-owned
because it is one waitlist per brand rather than customer data. Lane 2 is
hosted Bases: ONE Base instance PER ORG, opened lazily and pooled. The lanes
never overlap — the waitlist plugin binds a fixed `/v1/waitlist` regardless of
the engine's mount prefix.

### §2 The store

Per-org SQLite under `{DataDir}/base/{TenantSegment}/`, the platform waitlist
under a `_platform` segment whose leading underscore is outside the segment
alphabet so it can never collide with an org (`apps/base/base.go:96-100`). The
org→directory encoding is the fleet's one injective, traversal-safe tenant
encoder, so an org maps to exactly one physical identity everywhere in the
binary (`apps/base/pool.go:34-40`). Every store is single-open, single-writer,
on the one RWO volume, single-replica by deployment — the durability the
standalone pod had, without the pod.

### §3 The pool

Instances open on first request, migrate once, and are pooled: LRU-capped at 64,
idle-evicted after 10 minutes, both env-overridable. Only IDLE instances are
ever closed — an acquired instance is pinned for the request, so eviction can
never yank one out from under a live request (`apps/base/pool.go:23-31`).

### §4 Addresses

`GET /v1/base/health` is the one typed operation. Everything else under
`/v1/base/*` is the embedded engine's own REST surface, relayed through the
org's own mux — the engine owns that route table, and typing it in cloud would
put a second copy here, free to drift (the same shape HIP-1062 states for the
durable engine). The engine's API prefix is pinned to `/v1/base` so even its
self-generated URLs live under the capability's address.

### §5 Tenancy and identity

The org is resolved from the validated principal and refused when absent
(`apps/base/base.go:288-290`); the request is then served by that org's own
instance, so cross-tenant reads are closed physically — the other org's rows are
not in the file being queried. Each per-org instance validates bearers against
Hanzo IAM's JWKS as its EXCLUSIVE auth source: the edge selects the org, Base
authorizes the record, both consume ONE IAM and no second auth path exists.

### §6 Activation, money, events, telemetry, stage, upstream

The embed activates only when `CLOUD_BASE_EMBED` is truthy; absent it, Mount is
a health-only no-op, so linking this subsystem everywhere changes nothing until
a single-writer deployment opts in. Free (`plugin/base/main.go`, `cloud.Free`).
It publishes nothing to the bus. Beyond the request span it emits structured
log lines only. Stage `ga`: the hosted backend is the data plane of the
self-service core. Its upstream is `github.com/hanzoai/base` v1.5.65
(`go.mod:691`), MIT-licensed with the original author's notice preserved in its
LICENSE; the engine survives whole — this app adds the pool, the tenancy
resolution and the mount, not a fork of the engine's internals.

## Rationale

The alternative to per-org files is one engine with a tenant column, which
works until one query forgets the predicate. The alternative to the pool is an
instance per org held open forever, which trades a cheap reopen for unbounded
memory. Both alternatives were live in the estate — the forwarding prefix and
the standalone pod — and both are what this design deleted.

## Security Considerations

The engine is a full backend — auth, rules, file storage — so the dangerous
wrong implementation is a tenancy short-circuit around it: a request routed to
the wrong org's instance is a whole-backend disclosure, not a row leak. The
injective segment encoding and the principal-only org resolution are the two
facts that prevent it; neither takes any input a caller controls. The public
waitlist lane holds no principal by design, and therefore holds no customer
data — its knobs and secrets resolve from KMS at boot, never in code.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1062 — Tasks — The Durable Run

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
