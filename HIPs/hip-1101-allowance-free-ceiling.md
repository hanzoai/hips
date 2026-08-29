---
hip: 1101
title: Allowance — The Free Lane's Ceiling
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: allowance
status: Final
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1101: Allowance — The Free Lane's Ceiling

## Abstract

`/v1/allowance` is how much a plan lets a caller do without paying, and how much
of it they have left today. Money gates every priced route, but a route priced
at zero leaves the balance gate nothing to refuse — deliberately, so a caller
with no wallet can reach the free pool — and the free pool runs on our own
compute. The allowance is that lane's ceiling: a COUNT of calls, per subject,
per period, taken from the caller's plan. It is implemented in `hanzoai/cloud`
at `apps/allowance`.

## Motivation

Without a ceiling the free lane is unlimited for anyone who can name a free
model, and a route stated at zero can still be served by a vendor who bills us.
The sibling question — how fast a caller may burn their OWN money — is
`rollingcap`'s; this capability bounds how much of OUR compute a caller with no
money may take (`manifest/apps.go:139-142`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 Count and money never stand in for each other

A free call costs nothing, so a balance can neither express it nor refuse it; a
paid call is bounded by the wallet and MUST never reach this store. This is what
lets the free tier be generous without issuing credit we do not owe.

### §2 The store

One system SQLite database, `allowance`, opened through `sqlpool.Open` and so
encrypted under the process key (`apps/allowance/store.go`). One row per
subject; the period is IN the row, which is why nothing resets anything — a
count carries the day it was made on, so yesterday's row reads as zero today and
is overwritten by the first call of the new day. No scheduler, no sweep, no
window during which a job has not run yet.

### §3 Addresses

`GET /v1/allowance` is the one public operation, typed: what the CALLER has left
this period and when it turns over. The subject is resolved from the validated
principal's wallet (`principal.WalletOf`, `apps/allowance/allowance.go:212`) and
can never be named in the request; an unauthenticated caller is refused. Two
further operations live on the internal plane, not at any public address
(`apps/allowance/rpc.go`): `allowance_read` admits and `allowance_take` counts.
Two ops because there are two moments — a call is admitted before it runs and
counted after it answered, and counting the attempt would charge a customer for
an outage of ours. The read-and-increment is one statement in one transaction,
so two served calls arriving together cannot both write the same count.

### §4 Tenancy

On the plane, the org is the caller's own (`cloud.Who(ctx).Org`) and cannot be
named in the input; it selects the TIER whose ceiling applies. The row is
addressed by subject alone, and what keeps one caller out of another's count is
the subject the gate resolved from a verified credential plus the plane's own
boundary — it answers on a socket inside the pod and has no address on the edge.

### §5 The ceiling is a platform switch

The per-tier limit is a flags key, editable live through the admin cockpit
rather than shipped in the plan catalog, because the number is a marketing dial.
A named tier's switch MAY be 0 (unbounded, an admin's decision about a
subscriber commerce identified); a caller nobody can name gets the floor, and no
setting can turn that off — "we could not tell who this is" MUST never mean "as
much as they want".

### §6 Money, events, telemetry, stage, upstream

The capability itself is free (`plugin/allowance/main.go`, `cloud.Free`) — it
gates spend, it does not create it. It publishes nothing to the bus. Beyond the
request span it emits structured log lines only. Stage `ga`: it is the money
plane's free-lane half, part of the self-service core. It derives from no OSS
upstream.

## Rationale

The alternative period model is a reset job. A sweep has a window during which
it has not run, and the turnover is then a fact about the scheduler rather than
about the data. Making the period part of the row makes turnover a property of
reading — already true for every subject at the same instant, including subjects
nobody will ever call again.

## Security Considerations

The wrong implementation is unmetered free compute: a caller who can choose
their own subject spends someone else's allowance, and a caller who can reach
`take` directly inflates a stranger's count to lock them out. Both are closed
the same way — the subject comes from the verified credential, and the counting
op is reachable only over the in-pod plane. The failure most worth naming is the
unnameable caller defaulting open; here it defaults to the floor.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
