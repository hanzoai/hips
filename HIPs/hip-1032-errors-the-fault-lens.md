---
hip: 1032
title: Errors — The Fault Lens
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Active
created: 2026-08-20
requires: HIP-0026, HIP-0119, HIP-0128
---

# HIP-1032: Errors — The Fault Lens

## Abstract

`/v1/errors` reads back the faults a tenant's own clients reported: the most
recent captured errors, newest first, each with its exception surfaced as a
first-class field rather than buried in a property bag.

It is a READ over the event plane that `hanzoai/cloud`'s `analytics` app already
writes — one write core behind many ingest doors, one warehouse, one vocabulary
to read it with. This HIP states the tenancy invariant that makes the read safe,
the redaction invariant that makes the stored fault safe to read at all, and what
the capability deliberately is not.

## Motivation

An error reported by a browser is the one telemetry a customer cannot get any
other way: it happened on someone else's machine, in code we shipped, and the
only record is the one the beacon sent. If it is not readable per tenant it is
useless; if it is readable across tenants it is a breach; and if it was stored
with the token that was in the stack trace, reading it is the breach.

So the capability is small on purpose and its invariants are not.

## Specification

The key words MUST, MUST NOT, SHOULD and MAY are to be interpreted as in
RFC 2119.

### §1 The tenant is resolved, never accepted

The org MUST be the validated principal's, derived server-side from the verified
bearer's owner claim (HIP-0026). It MUST NOT be a parameter, a body field or a
header. A request without a validated principal is refused
(`apps/analytics/publishable.go:231`).

Every warehouse read MUST bind the tenant POSITIONALLY as part of a mandatory
leading predicate `org = ? AND signal = ?` (`apps/analytics/query.go:76`). Both
halves are one decision — whose rows, and which kind — and they are stated
together because a predicate you can forget is a lens that silently reads the
wrong signal. No token, however privileged, may read another tenant's faults.

### §2 A publishable key MAY attribute a write and MUST NOT perform a read

Browser beacons carry a publishable key (`pk-`), which exists so a request with
no bearer can still be attributed to the tenant that minted it. It is
RESOLVABLE, not authenticating: the identity path refuses it outright, at the
boundary, so publishable means publishable whichever door it arrives at.

This read therefore MUST require a real bearer. Minting is a different concern
and lives on the key resource, not here.

### §3 Redaction is an ingest invariant

The lens can only surface what was stored, so the fault is scrubbed where it
enters the record and nowhere else: message and stack are redacted of
credential- and PII-shaped substrings at the fold point, on a COPY, before the
row is written AND before the accepted batch is handed to any sink
(`apps/analytics/capture.go:389`). One scrubber, one path. The property that
must hold is stated as a test, not as prose:
`apps/analytics/exception_scrub_test.go` plants an address, a bearer, a secret
key and a token in a query string and requires none of them to survive.

A frame's `file` MUST be treated as a URL and scrubbed for the same reason — a
bundler emits one with a query string, and a query string carries tokens.

### §4 What a row says

A structured stack and the raw stack text are BOTH carried and neither is
derived from the other: a client may send either or both. The structured form is
what lets a fault be grouped and rendered by function, file and line, and is the
only form that can be scrubbed field by field or marked as ours.

The property bag is returned verbatim as stored. Because the plane stores
attribute values as strings, a non-scalar the caller sent comes back as a
JSON-encoded string — the one honest shape the storage holds, and this document
does not pretend otherwise.

`data` MUST be present and empty rather than absent when there are no rows.

### §5 Bounds and honest failure

The row cap is clamped to a fixed maximum with a default applied to an absent,
zero, negative or unparseable value (`apps/analytics/analytics.go:397`). The
clamp is shared with the other recent-event read, because both bound the same
thing the same way and a second pair of constants is a second place for them to
disagree.

An unreachable warehouse MUST answer `503`. It MUST NOT fabricate an empty page:
"no errors" and "cannot tell" are different answers and only one of them is safe
to act on.

### §6 Refused

- Any tenant selector on the wire.
- A read on a publishable key.
- A second ingest door on this address. Faults arrive through the plane's one
  write core; this capability only reads.
- Issue lifecycle. There is no assignment, no resolution state and no ownership
  here — the capability is a read. Structured frames exist so a consumer can
  group; grouping is not stored as a verdict this surface hands back.

## Rationale

The alternative is a separate error-tracking store with its own ingest, its own
tenancy and its own retention. It was refused because the fault is already an
event the plane admits, and a second store means a second tenancy enforcement to
get right and a second redaction path to keep honest — two things that must never
disagree and eventually will.

Faults carry their own signal on the shared plane rather than mixing into the
behavioural stream. One table means the kind is a PREDICATE rather than a table
name — and a predicate you can forget is a lens that silently reads one signal as
another, which is why §1 states it in the same breath as the tenant.

## Security Considerations

Cross-tenant read is the whole risk, and it is closed twice: the org is minted
from the validated bearer rather than read off the request, and it is bound into
every query as a parameter, so neither a forged header nor a crafted filter
reaches another tenant's rows.

The second risk is that the record itself is the leak. A stack trace is
free-text written by someone else's runtime and routinely contains an address, a
session token or a key. Because scrubbing happens once at the fold, every
consumer of that batch — the warehouse row and any forwarding sink — sees the
same clean copy; a read-time filter would leave the raw copy at rest and in
whatever else already consumed it.

## References

- HIP-0026 — Identity and Access Management Standard
- HIP-0119 — Hanzo Service Conventions
- HIP-0128 — Resource Surface Standard

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
