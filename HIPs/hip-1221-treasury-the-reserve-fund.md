---
hip: 1221
title: Treasury — The Reserve Fund
author: Hanzo AI
type: Standards Track
category: Application
capability: treasury
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0027, HIP-0139
---

# HIP-1221: Treasury — The Reserve Fund

## Abstract

`/v1/treasury` is the reserve fund behind every payout: real capital, held and
accounted for. Where finance tracks what each customer holds and spends,
treasury tracks what the platform holds, so a growth-loop payout — referrals,
affiliates, OSS authors — is a debit against funded capital and never unbounded
minting (`apps/treasury/treasury.go:1-8`). It is `hanzoai/cloud`
`apps/treasury`: the HTTP adapter, tenant scoping, audit and the L1 anchor
around a ledger-of-record port whose backend owns the double-entry.

## Motivation

The app answers on two prefixes today and owns neither whole
(`manifest/apps.go:406`): its front door lives under `/v1/finance`, an address
that belongs to no capability. The reads come home to the app that serves them.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 Addresses

Every route is typed (`apps/treasury/treasury.go:177-186`), and the target
surface is:

- `GET /v1/treasury` — reserve health and policy, the pool backing the caller's
  payouts (from `/v1/finance/treasury`).
- `GET /v1/treasury/accounts` — the caller's own ledger accounts (from
  `/v1/finance/accounts`; admin may widen with `?scope=house` / `?org=`).
- `/v1/admin/treasury{,/policy,/sweep,/seed,/anchor,/anchor/signer}` — the
  operator's view, served by treasury, already at HIP-0139 §3.2's exempt depth.
  It keeps.

Where the router still serves the `/v1/finance` spellings, the pairs are the
`treasury` lines in cloud's `openapi/misfiled.txt`, closed by fold.

### §2 The store it owns

Its own double-entry ledger, behind one port (`ledger.Backend`). The default
and offline backend is the native engine — per-tenant Base/SQLite files opened
through `cek` so the namespace keys the file
(`apps/treasury/ledger/sqlstore/sqlstore.go:69`,
`apps/treasury/storage.go:29-34`) — with reserve, revenue and house accounts on
the house tenant. The opt-in backend is a Formance Ledger service, selected by
`FORMANCE_LEDGER_URL` and driven over its v2 HTTP API; the double-entry and the
overdraw guard are Formance's own, never reimplemented here
(`apps/treasury/formance/formance.go:1-14`). Selecting one is a config flip.

The shared datastore OLAP projection is NEVER the ledger of record: single-
tenant drill-down reads the authoritative ledger, cross-tenant aggregates read
the projection (`apps/treasury/treasury.go:22-29`).

### §3 Tenant

One scope-aware engine, three surfaces projected by IAM scope
(`apps/treasury/treasury.go:31-34`): the tenant is derived from the validated
identity (HIP-0026), house and reserve are locked to SuperAdmin, and a per-org
caller only ever sees its own tenant. The org is never an input.

### §4 A payout is backed or it is refused

Every payout sink is named once, by program (`apps/treasury/treasury.go:81-84`),
and lands as a debit against the funded reserve through the single-writer,
overdraw-guarded ledger. A transaction the reserve cannot cover MUST be refused
as "not backed" — the native engine and the Formance backend both answer that
way — rather than plugged by minting.

### §5 The anchor

The books live off-chain, so a deterministic root of the whole journal is
committed to the Hanzo L1 EVM (chain 36963), making any change to a historical
posting visible against an immutable witness (`apps/treasury/anchor.go:15-19`).
The signing key is a KMS reference and MUST NOT be a plaintext key
(`apps/treasury/anchor.go:21-23`; HIP-0027); the signer wallet is set by the
operator at `PUT /v1/admin/treasury/anchor/signer`.

### §6 Price, events, observability

It is free, in those words: `Price: cloud.Free` (`plugin/treasury/main.go:26`);
reads and SuperAdmin mutations, no meter behind any route.

It publishes no events on the platform bus, so a customer's webhooks (HIP-1310)
receive nothing from it. Every money action lands a best-effort audit record
(`apps/treasury/treasury.go:96`, `:572-578`) that mirrors to the shared
datastore projection on the same event stream o11y already emits — one
pipeline, no second metering path. Beyond that and the request span, nothing.

### §7 Stage and upstream

The stage is `ga` — the manifest row declares none, and absent is `ga`
(HIP-0139 §8).

It derives from none: no OSS project is forked, embedded or mirrored in HEAD.
The optional Formance backend is a network client onto a separately deployed
service, stated as the dependency it is; none of its code survives here.

## Rationale

The alternative to its own capability is folding the reads into billing, since
both talk about money. They do not share a store: billing projects the
customer's wallet, treasury keeps the platform's book, and HIP-0139 §7.2 only
permits a boundary where the stores divide — which is exactly where this one
sits. The port-and-two-backends shape exists so the reserve works offline today
and the production ledger of record is an upgrade, not a rewrite.

## Security Considerations

The wrong implementation mints. A payout path that skips the ledger creates
unbacked liabilities the reserve cannot cover; the overdraw guard is the
control, and it must fail closed. A tenant taken from the caller instead of the
validated identity reads the house books — revenue, reserve, every program's
payouts — across orgs. A plaintext anchor key lets an attacker sign a false
witness for doctored books, which is why the signer is a KMS reference and the
mutation SuperAdmin-only.

## References

- HIP-0026 — Identity and Access Management
- HIP-0027 — Secrets Management Standard
- HIP-1001 — Books — The Double-Entry Ledger

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
