---
hip: 1203
title: Affiliate — Commission on Referred Spend
author: Hanzo AI
type: Standards Track
category: Application
capability: affiliate
status: Draft
created: 2026-08-20
requires: HIP-0106, HIP-0118, HIP-0139
---

# HIP-1203: Affiliate — Commission on Referred Spend

## Abstract

`affiliate` is the partner program that pays ongoing commission on what your
referrals spend: an org applies, staff approve it with a rate and a share
link, and every org that signs up through the link accrues commission for the
affiliate against its metered spend, period by period, paid out in credits or
recorded cash (`apps/affiliate/affiliates.go:1-38`). It is `apps/affiliate`
in `hanzoai/cloud`. It records payables; it never moves money.

## Motivation

Three programs in the repo share one shape — apply, approve, attribute, accrue
at-most-once per (party, counterparty, period), pay out against
pending = accrued − paid: `referral` is the one-time two-sided bonus,
`author` the OSS royalty, and this one the ongoing partner commission. Each
keeps its own store and its own HIP; what they share is the commerce ledger
path for a credits payout (`apps/affiliate/affiliates.go:8-15`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 Addresses

The customer surface, all typed, under `/v1/affiliate`: the status read
(`GET /v1/affiliate`), `POST …/apply`, `POST …/attribute`, `POST …/click`,
`GET …/leaderboard`, and the affiliate's own `…/me`, `…/me/earnings`,
`…/me/handle` and `…/me/links` (`plugin/affiliate/openapi.json`).

The operator's view, per HIP-0139 §3.2, under `/v1/admin/affiliates`: the
board (`GET`), `POST …/{id}/approve`, `…/{id}/rate`, `…/{id}/suspend`,
`…/{id}/payout`, `…/sweep`, and the referral-analytics board at
`GET /v1/admin/affiliates/referrals`. Today's router serves that last read at
`/v1/admin/referrals` — a root whose remaining routes the `referral`
capability genuinely serves (`manifest/apps.go:431`) — and the pair is carried
by `hanzoai/cloud` `openapi/misfiled.txt`; it closes by fold into this
capability, because the board reads this capability's own tables
(`apps/affiliate/store.go:863-880`).

### §2 Store

The capability owns one encrypted SQLite database, opened through the one
opener (`sqlpool.Open("affiliates", dir)`, `apps/affiliate/store.go:184`):
affiliate rows, the `affiliate_referrals` attribution spine, and
`affiliate_accruals`. Attribution is first-touch, one row per referred org,
self-attribution refused. An accrual is latched at-most-once per
(affiliate, referred_org, period) — a re-run in the same period converges
instead of double-accruing — and the balance and the accrual rows move in one
transaction (`apps/affiliate/store.go:903-905`). Payouts against the ledger
are recorded per affiliate; a payout MUST NOT exceed pending
(accrued − paid), guarded atomically.

### §3 The money seam is a question

The one thing the commission loop asks of the money plane is a read: what has
this org spent this period. The seam is an interface with exactly that method,
and it MUST NOT grow a write — the deposit method it once carried is how a GET
on this surface came to mint platform credit, and
`TestCommerceSeamIsReadOnly` fails if the shape ever widens
(`apps/affiliate/commerce.go:9-22`). A credits payout is a commerce grant,
tagged `grant:affiliate`, issued through the shared `apps/payout` path; cash
methods are record-only — a human settles them.

### §4 Tenancy

Customer routes resolve the affiliate from the caller's validated org and
never from input. Every `/v1/admin` route is gated on the one SuperAdmin
predicate — `c.IsAdmin()`, minted only for a verified member of the `admin`
org after identity sanitization (`apps/affiliate/typed.go:42-47`,
HIP-0118). The attribute and click writes are reachable to a new org by
design: they record which code referred it, and the code is the only thing
the caller names.

### §5 Metering, events, observability, stage

The capability is free (`plugin/affiliate/main.go:21`, `cloud.Free`) — it
accrues liabilities to partners and meters nothing. It publishes no events on
the bus and delivers nothing to customer webhooks. Beyond the request span it
emits log lines only. Its stage is `beta` — the manifest row
declares it (`manifest/apps.go:401`, `Stage: Beta`; HIP-0139 §8).

### §6 Upstream

The capability derives from no forked, embedded or mirrored OSS project. Its
non-standard-library imports beyond the app framework are
`github.com/hanzoai/cek` v0.2.7 (MIT — the encrypted-at-rest SQLite opener
under `sqlpool`) and `github.com/hanzoai/namespace` v1.2.0 (MIT).

## Rationale

The alternative to three sibling programs is one generalized rewards engine.
It would share the accrual latch and the payout guard, and it would braid
three different counterparties — a partner, a referred pair, an OSS author —
into one schema whose every query needs a program discriminator. Three small
stores with one shared ledger path keep each program's invariants checkable in
its own file.

## Security Considerations

This surface is adjacent to money, and every past defect here was a write
where a read belonged. The read-only commerce seam is the load-bearing shape:
re-adding a write method re-opens credit minting from an affiliate route.
Attribution is the fraud surface — self-attribution is refused, a referred org
attributes once, and the sweep computes commission only from spend commerce
reports, so a forged click or code cannot fabricate accrual. The payout
guard's atomicity is what stops a concurrent double-payout; the admin gate on
the one predicate is what keeps approval, rates and payouts out of tenant
hands.

## References

- HIP-0106 — The Hanzo Plugin Contract
- HIP-0118 — SuperAdmin & Tenant Isolation Model
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
