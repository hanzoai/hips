---
hip: 1103
title: Audit — The Tamper-Evident Trail
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: audit
status: Final
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1103: Audit — The Tamper-Evident Trail

## Abstract

`GET /v1/audit` is an org admin's read of their own organization's
security-relevant events, off the tamper-evident trail the cloud binary already
writes: every audited action is a structured record, hash-chained to its
predecessor so any later deletion or modification is detectable, appended INLINE
to a store the application can only insert into. The trail itself lives in
`hanzoai/cloud`'s `audit` package; the customer surface is `apps/auditlog`.

## Motivation

An enterprise buyer's own compliance team must be able to see what happened in
THEIR org — the audit trail is table stakes for SOC 2 and ISO review — without
being a fleet operator. The pre-existing surface was operator-only
(`/v1/admin/audit`, SuperAdmin-guarded), so a normal org owner had no audit
route at all. This capability adds exactly the org-scoped read and nothing else
(`apps/auditlog/auditlog.go`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store — shared, and why

The app opens NO store of its own. Its store is the same `*audit.Recorder` the
request middleware writes and the operator view reads, handed through the
composition's deps (`apps/auditlog/auditlog.go:61` — "this subsystem opens NO
second store"). The chain is only tamper-evident if records are appended in a
strict, gapless total order with each record's PrevHash the preceding record's
Hash, which demands a single serializing writer — so the primary is one embedded
SQLite the application only INSERTs into, opened encrypted under the process
key (`audit/store.go`). An OLAP mirror into the datastore exists for
long-retention query; it is best-effort, asynchronous, and a projection — losing
a mirror row is a query-completeness issue, never an integrity one.

### §2 Append fails the request closed

Append is inline and its error is returned to the middleware, which fails the
audited request rather than acting unlogged — the AU-5 response to audit-logging
failure. A security-relevant action that cannot be recorded MUST NOT silently
succeed.

### §3 Addresses

`GET /v1/audit`, one typed operation. The whole-chain verify walk stays
operator-only because it is a fleet property that would cross tenants, but every
row an org admin reads carries its own hash and prevHash, so the chain linkage
of their events is visible. The Go package is named `auditlog` while the
capability is `audit`: the divergence parks the generic per-app liveness route
at `/v1/auditlog/health` so it can never shadow the trail's own address, and
the mount order binds `/v1/audit` before the model plane's catch-all
(`apps/auditlog/auditlog.go:28-31`).

### §4 Tenancy

The org is `principal.OrgFrom` — the value the identity middleware minted from
the verified bearer (HIP-0026) — and the read's filter is PINNED server-side to
it; the request type carries no org field at all, so a caller can only ever read
their own org's events. Fail-closed: no validated principal → 401, no store →
501. The actor on every record is likewise populated only from the validated
principal, never a raw header, so an actor cannot be forged by the request being
audited (`audit/record.go`).

### §5 Money, events, telemetry, stage, upstream

Free (`plugin/audit/main.go`, `cloud.Free`). It publishes nothing to the bus —
the trail is a store the middleware writes, not an event stream. Beyond the
request span, the capability's writes ARE the telemetry: the append per audited
request, and the best-effort mirror row into the datastore. Stage `ga`: the
compliance trail is observability core, table stakes for the self-service
cloud. It derives from no OSS upstream.

## Rationale

The alternative primary is the OLAP store the mirror uses. It shards and scales,
and that is exactly the problem: a fleet-wide, eventually-consistent sink cannot
give the strict total order the hash chain needs, and a fire-and-forget write
can drop the one record that mattered. The small, serialized, synchronous
primary is the compliance control; the mirror buys the query surface without
weakening it.

## Security Considerations

An audit trail is what an attacker edits second, after the thing they did first.
The chain makes in-place edits and deletions detectable; the INSERT-only surface
means the application offers no verb to do either; and periodic checkpoints of
the head anchor the tail, because a chain walk alone cannot notice that the last
K records were truncated. The customer read adds one exposure of its own — a
cross-tenant read of someone else's security events — and closes it by making
the tenant a server-side constant rather than an input.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
