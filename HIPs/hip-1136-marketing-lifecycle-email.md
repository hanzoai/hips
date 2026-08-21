---
hip: 1136
title: Marketing — Lifecycle Email
author: Hanzo AI
type: Standards Track
category: Interface
capability: marketing
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1136: Marketing — Lifecycle Email

## Abstract

`/v1/marketing` is lifecycle email: drip sequences that reach the right people.
Audiences resolve from the IAM roster, promo codes record redemptions an admin
grants against, and every send passes through the per-org suppression list. It
is implemented in `hanzoai/cloud` at `apps/marketing` (HIP-0106). The two
invariants this HIP states: there is exactly one send seam, and this capability
can no longer mint money.

## Motivation

A marketing surface accumulates senders — a campaign blast here, a drip step
there, a calendar hook — and every sender that bypasses the opt-out list is a
compliance violation waiting on a query. The design forces every delivery
through one function so the suppression check cannot be skipped by
construction (`apps/marketing/suppress.go:26-32`). The second lesson was paid
for: an earlier promo redemption deposited real spendable wallet credit on any
validated principal's say-so — plan and seat count from the request body,
nothing collecting the charge the discount was against — a self-service money
mint worth about $1.79M at the cap. The deposit is gone
(`apps/marketing/promos.go:30-48`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store, and the engine underneath

One encrypted SQLite file, the deployment's own `marketing`
(`apps/marketing/store.go:42`); every query filters `WHERE org=?`. Drip steps
are durable tasks on the embedded `hanzoai/tasks` engine: each enrollment's
next-run time lives in SQLite, a per-minute schedule sweeps due steps, and
every step is claimed once, so a redeploy neither loses nor duplicates a send
(`apps/marketing/marketing.go:15-20`).

### §2 One send seam

Every marketing delivery — campaign, drip step, calendar email — calls the one
deliver function, which consults the per-org suppression list and then hands
off to the platform notify rail; marketing never constructs a provider and has
no second door out (`apps/marketing/suppress.go:138-148`). A suppressed
recipient is refused at the seam, and a signed public one-click unsubscribe
writes the same list. A product announcement is not a feature beside this: it
is a one-step sequence with an audience enrolled, inheriting claimed-once
delivery, the suppression gate and the unsubscribe footer
(`apps/marketing/marketing.go:42-45`).

### §3 Audiences are honest

An audience resolves to real mailboxes through the IAM roster; one with an
event filter narrows that roster to the cohort the analytics warehouse
selected. When the roster or warehouse cannot be read the answer is honestly
empty — never a fabricated count, never a send to nobody reported as success
(`apps/marketing/marketing.go:18-23`).

### §4 A redemption is evidence, not money

What a promo redemption produces is a ROW — the org, the server-derived plan,
the discount claimed, and when — which an admin grants against through the
admin surface and the auditable ledger. The plan is derived from the org's live
paid subscription and never accepted from the caller (the input carries no plan
and no seats, so there is no field to inflate); an unreadable plan authority
refuses, inverting the spend gate's fail-open, because failing open here would
let an outage manufacture the evidence money is granted against; the payment
instrument is required as the anti-farming key
(`apps/marketing/promos.go:39-60`).

### §5 The address, tenancy, money, events, observability

Thirty-five operations under `/v1/marketing`, every one a typed op — one
registry entry projecting REST, the document, the MCP tool and the CLI
(`apps/marketing/marketing.go:47-52`). The tenant is the org minted from the
validated bearer (HIP-0026), carried to the typed seam by the bridge and read
back server-side — never a header, never an In field. Free (`cloud.Free`,
`plugin/marketing/main.go`); the send rail and any granted credit are other
planes' ledgers. It publishes nothing on the bus and emits nothing beyond the
request span every route gets.

### §6 Stage and upstream

`beta`: a vertical application. It derives from no third-party upstream; the
durable engine it composes is `hanzoai/tasks` (HIP-1062), embedded, not
mirrored here.

## Rationale

The alternative to one send seam is a suppression check in every handler,
which is the same check N times until one path forgets it. The alternative to
deleting the promo deposit was gating it harder — but an automatic path that
creates money is not a feature to fix, it is a mechanism to remove, because a
money mint left switched off is one flag away from switched on.

## Security Considerations

The wrong implementation here is a spam cannon with a ledger attached. Send
authority: any path around the deliver seam bypasses opt-out, so the seam is
the only door and tests assert exactly which recipients reach the rail. Money:
the removed deposit is the standing lesson — a redemption input that named its
own plan converted open signup into self-served credit; the current shape has
no field to inflate and fails closed on an unreadable authority. Tenancy: the
suppression list, audiences and enrollments are all org-column scoped on the
validated principal, so one tenant can neither read another's roster nor
unsubscribe another's customers.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1062 — Tasks — The Durable Run

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
