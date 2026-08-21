---
hip: 1242
title: Leaderboard — Who Uses AI Most
author: Hanzo AI
type: Standards Track
category: Application
capability: leaderboard
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1242: Leaderboard — Who Uses AI Most

## Abstract

`/v1/leaderboard` ranks who uses AI most — inside an org, and globally across
the orgs that opt in — and draws a per-day contribution graph for one subject.
It is a derived, read-only lens over the one usage ledger: it adds no metering
path and double-counts nothing (`apps/leaderboard/leaderboard.go:7-9`). The
implementation is `hanzoai/cloud` `apps/leaderboard`.

## Motivation

The capability today serves under `/v1/usage/*`, a prefix it co-owns with the
`usage` capability — and its own doc calls two packages under one prefix "one
prefix with no owner" (`apps/leaderboard/leaderboard.go:25-26`). The two stay
two capabilities, because a store boundary already exists: leaderboard owns an
opt-in store and usage owns none. Leaderboard therefore vacates the shared
prefix; this HIP states the surface it moves to.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### The addresses, and the prefix it vacates

Every route MUST be under `/v1/leaderboard`, except the operator's one-shot,
which is the operator's view (HIP-0139 §3.2):

- `GET /v1/leaderboard` — ranked top users (personal or org scope) or orgs
  (global), today `GET /v1/usage/leaderboard`
- `GET /v1/leaderboard/activity` — the per-day series for a heatmap and
  timeline, today `GET /v1/usage/activity`
- `GET|PUT /v1/leaderboard/optin` — read both opt-ins; set the caller's own
- `PUT /v1/leaderboard/optin/org` — set the org's public-board opt-in
- `POST /v1/admin/leaderboard/rollup` — seed the rollup from ledger history,
  today `POST /v1/usage/rollup/backfill`. As an admin address it leaves the
  public document by address, which is correct: it is already SuperAdmin-only
  (`apps/leaderboard/backfill.go:53`).

All six operations are typed (`plugin/leaderboard/openapi.json`); none is
declared. The standing `/v1/usage` pair is ledgered in cloud's
`openapi/misfiled.txt` and closes by this move. The `usage` capability keeps
`/v1/usage` untouched (`manifest/apps.go:264`).

### The store, and the rollup that is not one

The capability owns the opt-in store: one cek-encrypted SQLite opened by
`sqlpool.Open("leaderboard", dir)`, single-connection, two tenant-keyed tables
— `user_optin` (user, org, handle, listed) and `org_optin` (org, display,
listed) (`apps/leaderboard/store.go`). No secret lands there.

Ranks are not stored here. They are reads of the shared warehouse through a
derived per-day pre-aggregation of `hanzo.cloud_usage`, kept fresh by an
incremental materialized view attached to the ledger and seeded once by the
admin backfill below a creation watermark that prevents double-counting
(`apps/leaderboard/rollup.go:19-22,75-76`). The rollup MUST remain derived: a
second metering path is the one thing this lens is defined not to be.

### The tenant, and who is shown

The org is the validated IAM owner claim — `principal.Org`, minted by the
identity middleware from the verified bearer (HIP-0026), never a client
header — and a validated principal is required: no principal is 401. Every
warehouse read binds the org positionally, never interpolated
(`apps/leaderboard/board.go:11`, `apps/leaderboard/sql.go:13`). A user board
carries only the caller's own org's rows; the global board carries org-level
aggregates only, so cross-org detail is structurally impossible. With the
warehouse down it answers honest-empty (`available:false`), never fabricated
ranks.

Public listing is opt-in and private by default: a user always sees their own
rank but is named to others only after opting in with a chosen handle; an org
appears on the global board only after an org admin opts it in. The org
opt-in requires an org admin; the backfill requires SuperAdmin.

### Price, events, emission, stage

It is free, in those words: `Price: cloud.Free`
(`plugin/leaderboard/main.go:26`) — a lens over spend must not itself spend.
It publishes no events on the bus, so a customer's webhooks receive nothing
from it, and it emits nothing to observability beyond the request span every
route gets.

The stage is `beta` (HIP-0139 §8): a gamification surface reaches orgs by the
`leaderboard` flag and answers 404 without it. The manifest row does not yet
carry a stage field, so today the operations serve as `ga` does; the
declaration here is what the row inherits when stage lands in `manifest.App`.

### Upstream

It derives from none.

## Rationale

The alternative to vacating the prefix is folding leaderboard into `usage`.
That is refused on the store boundary: usage composes the commerce ledger and
the warehouse and owns no store of its own (`apps/usage/usage.go`), while
leaderboard owns the opt-in store — and HIP-0139 §7.2 makes the store, not the
prefix, the unit of capability. The alternative to the incremental rollup is
ranking straight off the ledger, which prices every page view as a full-table
aggregation of the busiest table the warehouse has.

## Security Considerations

The disclosure surface is social, not financial: the wrong implementation
names a person who never opted in, on a board other tenants read. Privacy is
therefore default-deny in the schema — an absent row IS "not listed" — and the
listing read carries the `listed=1` predicate with the org key on every
statement. The other exposure is rank as an oracle for another org's spend;
the global board carries org-level aggregates for opted-in orgs only, and the
tenant is never an input, so there is no query a caller shapes to read a
neighbour's detail.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
