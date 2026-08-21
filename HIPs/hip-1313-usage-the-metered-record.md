---
hip: 1313
title: Usage — The Metered Record
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: usage
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1313: Usage — The Metered Record

## Abstract

`/v1/usage` is the categorized read over what an org has spent and consumed, and
the write path for the samples a linked provider account contributes. The
implementation is `hanzoai/cloud` `apps/usage`.

A metered act writes in two places, neither of them here: the money lands on the
org's commerce ledger and the per-request detail lands in the `hanzo.cloud_usage`
warehouse ledger the ai plane writes (HIP-0106). This capability owns one series
of its own — `hanzo.account_usage`, what the collector posts — and everything
else it answers is a read over ledgers other capabilities own.

## Motivation

"What did this cost me" is asked of three different records: the prepaid balance
that was drawn down, the inference detail that explains the draw, and the
provider accounts an org linked itself. Answering it from any one of them is
wrong — the balance knows the money but not the model, the warehouse knows the
model but not the invoice, the linked accounts know neither.

Answering it by copying all three into a fourth store is worse. A copy is a
second number that can disagree with the ledger it came from, in the one place a
customer will notice and dispute. So this capability composes rather than
copies, and the composition is the specification.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The addresses

Every route is under `/v1/usage` (`manifest/apps.go:271`, package doc
`apps/usage/usage.go`), all typed, none declared:

- `POST /v1/usage` — record account-usage samples, the collector's write path
  onto the `hanzo.account_usage` series
- `GET /v1/usage/samples` — one provider account's own lane, as a time series
- `GET /v1/usage/summary` — the org's footprint roll-up, §3
- `GET /v1/usage/analytics` and `GET /v1/usage/analytics/access` — the
  entitlement-gated per-org read, and whether the caller holds the entitlement

Liveness is the host's generic `GET /v1/usage/health`, not one of these: the
plugin does not declare `OwnsHealth`, so the host's route stands on a path none
of the five shadows.

Per-model and time-series detail is NOT served here — that is `/v1/analytics/*`
— and the wallet's own raw drain is billing's `/v1/billing/usage`. Three
addresses answer three questions, and a fourth spelling of any of them would be
a fourth number to reconcile.

### §2 What a metered act records

The recorder's wire type is deliberately narrow: subject, namespace, an EXACT
decimal USD rather than a rounded cent, currency, model and provider
(`hanzoai/cloud` `ai.go:23-30`). It carries no prompt content and no PII, and
the per-request detail — tokens, latency, per-model breakdown — is the
warehouse's, not this record's.

It carries no idempotency ref, and that absence is load-bearing: the ref this
struct once held was derived from client-posted fields, which handed the
ledger's dedup key to the payer. A future ref MUST be minted server-side or not
exist.

The debit itself is not this capability's. It lands through the metering client
HIP-0106 specifies — authorize before the handler, record after — onto the
balance `commerce` owns. This surface reads that ledger; it never writes it.

### §3 The rollup

`GET /v1/usage/summary` composes three sources: spend by category off the
commerce ledger, LLM totals off `hanzo.cloud_usage`, and the linked-account
board off the series in §4.

Each source MUST degrade independently to honest zeros, with a marker saying
which sources answered. A roll-up that hides a dead source behind a plausible
total is the worst failure this surface has, because the number still looks like
money and a customer will act on it. A zero that says it is a zero is a fact; an
unmarked one is a lie with a decimal point.

### §4 Tenant, store, price, emission, stage, upstream

The tenant is the validated principal, fail-closed: no principal is 401
(HIP-0026). The commerce subject is pinned server-side to that org and every
warehouse query binds the org positionally rather than by interpolation, so
there is no request shape that widens the scope of a read.

It owns one store: the `hanzo.account_usage` series
(`apps/usage/datastore.go`), which is what the collector's write path fills.
Everything else it answers is a read over ledgers other capabilities own,
reached over the plane.

Reading it is free, in those words: `Price: cloud.Free`
(`plugin/usage/main.go:21`) — a lens over spend must not itself spend. It
publishes no events on the bus, so a customer's webhooks (HIP-1310) receive
nothing from it, and it emits nothing to observability beyond the request span
every route gets. The stage is `ga` — the manifest row declares none, and absent
is `ga` (HIP-0139 §8). It derives from no OSS upstream.

### §5 The leaderboard boundary

`leaderboard` is its own capability with its own specification (HIP-1242) and
its own store — the opt-in rows. It is not a view this capability serves.

Today its three routes still answer under `/v1/usage/*`, which is the one
`usage` line in cloud's `openapi/misfiled.txt`; it closes by leaderboard moving
to `/v1/leaderboard`, never by alias, and `/v1/usage` is unchanged by the move.
The two stay two because the store boundary already exists: leaderboard owns the
opt-in rows and reads a derived pre-aggregation of `hanzo.cloud_usage`, which is
the warehouse's, not this capability's series.

## Rationale

The alternative is a usage store: materialize every debit and every request row
here and serve reads from it. It makes the reads trivial and introduces the one
defect this surface cannot carry — a number that disagrees with the ledger a
customer is charged against. Composition costs the fan-out in §3 and keeps the
ledgers single-owner.

The alternative to marking degraded sources is a single total. It is friendlier
in the console and unfalsifiable in support, because nothing in the response
distinguishes "you spent nothing" from "the warehouse was unreachable".

## Security Considerations

The wrong implementation hands an attacker another org's spend and activity
profile — which models, how much, when — from a single unbound query. That is
commercially sensitive on its own and an operational map of the tenant besides.

The boundary is therefore not a filter applied to results but a bind applied to
every statement: the org is never an input a caller supplies, the commerce
subject is derived server-side, and each warehouse query carries the org
positionally. A read that composes three sources has three places to get that
wrong, which is exactly why the rule is stated once and applies to all three.

The record's narrowness is the other control. Prompt content never enters this
plane, so no breadth of read here discloses what a customer asked a model.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1242 — Leaderboard — Who Uses AI Most
- HIP-1310 — Webhooks — Outbound Delivery

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
