---
hip: 1143
title: Referral — An Edge From Referrer to Referee
author: Hanzo AI
type: Standards Track
category: Interface
capability: referral
status: Final
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1143: Referral — An Edge From Referrer to Referee

## Abstract

`/v1/referral` is referral ATTRIBUTION: who referred whom, and whether that
referee ever became a real customer. Every org has a stable code and share
link, a new org claims it at signup, and an admin sweep advances signup →
qualified once the referee makes metered spend. That attribution record is the
whole product — the capability, implemented in `hanzoai/cloud` at
`apps/referral`, MOVES NO MONEY, and this HIP states why that absence is the
design.

## Motivation

A referral program needs two facts nobody else records: the edge (referrer ↔
referee, first-touch, once ever) and whether the referee genuinely used the
product. Signup alone is a vanity signal; metered spend is the honest one
(`apps/referral/referrals.go:23-26`). What is owed for a qualified referral is
an affiliate PAYABLE, tracked in `hanzoai/commerce` and settled by wire or to a
connected wallet — never minted as platform credit.

## Specification

The key words MUST, MUST NOT and SHOULD are to be interpreted as in RFC 2119.

### The store

One system-namespace SQLite file, `referrals.db` (`sqlpool.Open`,
cek-encrypted, single-connection): the referral edges plus a code directory.
The code itself is a deterministic base32 hash of the org id
(`apps/referral/referrals.go:17-18`), so it never changes and never has to be
stored to be reproduced; the directory row only materializes the O(1) reverse
lookup.

### Addresses

Four operations, all typed ops, across two audiences
(`apps/referral/referrals.go:117-146`):

- `GET /v1/referral` — the caller's code, share link and referrals. A pure
  read: it advances nothing.
- `POST /v1/referral/claim` — record a referral from a `?ref` code. Idempotent
  and first-touch: 201 on the first claim, 200 with `created:false` on replay.
- `GET /v1/admin/referrals/bonuses` — SuperAdmin: every edge plus a summary.
- `POST /v1/admin/referrals/sweep` — SuperAdmin: the cron path, and the ONLY
  path that advances a referral; one pass is bounded at 500 so a backlog drains
  over runs instead of wedging one request.

The two admin leaves sit under a prefix another app also serves —
`GET /v1/admin/referrals` is the affiliates analytics board — so the plugin
declares its prefixes from the manifest row (`plugin/referral/main.go`) rather
than the `/v1/<name>` default, and each gate is bound to the exact path it
covers, never a subtree (`apps/referral/referrals.go:121-135`).

### Tenancy

The REFEREE is the validated caller's org, never a client field, and the
referrer is resolved from the code — so a caller can only ever attach
THEMSELVES to someone else's code. Self-referral is 400, an unknown code 404.
Writes with no validated principal are refused ahead of the body decode
(`requireOrgOnWrite`); the two admin leaves require SuperAdmin, fail-closed.

### Money

Free, said in those words: `plugin/referral/main.go` declares `cloud.Free`,
and nothing here meters, gates or debits. The one money-plane touch is a READ —
"has this referee spent?" — asked through the payout plane client
(`apps/referral/commerce.go`), and the seam is deliberately read-only:
`TestCommerceSeamIsReadOnly` fails if it ever grows a write method, because a
`deposit` on this interface is exactly how a GET once came to mint platform
credit.

### Events and telemetry

It publishes nothing to the bus, so a customer's webhooks receive nothing from
it. Beyond the request span, a qualification appends one `referral.qualified`
record to cloud's tamper-evident audit trail, best-effort
(`apps/referral/referrals.go:531-548`) — an attestation that a referee became
a customer, carrying no amount because this package issues none.

### Stage

`beta`: the manifest row declares it (`manifest/apps.go:431`, `Stage: Beta`;
HIP-0139 §8).

### Upstream

Derives from none.

## Rationale

The alternative — the referral system granting credit directly — is the shape
every referral program starts with and the one this package was cut back from:
once the capability to deposit exists on this surface, a caller eventually
reaches it. Splitting attribution (here) from reward (an affiliate payable in
commerce) means the worst a compromised referral path can do is mislabel an
edge, not print money. Qualification living only on the admin sweep, never on a
GET, is the same rule one layer down: reads report state, one bounded
idempotent write advances it, and the `qualified_at` latch makes the transition
at-most-once under concurrent sweeps.

## Security Considerations

Attribution is an incentive system, so the attacker is a fraudulent referrer.
The closures, each specific: the referee comes only from the validated
principal, so an attacker cannot claim on a victim's behalf or attach a victim
to their code; first-touch-once-ever makes claim replay inert; self-referral is
refused on the resolved orgs, not on the code string; and qualification keys on
metered spend read from the ledger — a signal that costs real money to forge —
never on signup volume. Because no path here mints credit, the residual prize
for defeating all of that is a mislabeled attribution row, which the audit
trail records with both orgs named.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
