---
hip: 1202
title: Entitlement — What an Org May Run
author: Hanzo AI
type: Standards Track
category: Platform
capability: entitlement
status: Draft
created: 2026-08-20
requires: HIP-0106, HIP-0118, HIP-0139
---

# HIP-1202: Entitlement — What an Org May Run

## Abstract

`entitlement` answers what your org may run: which products the plan grants,
and which of those the org has switched on. It is `apps/entitlement` in
`hanzoai/cloud`, and its whole discipline is that those are two authorities,
never braided — ENTITLEMENT is the billing truth, read from commerce at
decision time; ENABLEMENT is the org's intent, the one store this capability
owns (`apps/entitlement/entitlements.go:1-33`).

## Motivation

A paywall whose grant check and toggle store are one table cannot say whether
an org stopped paying or switched something off, and every consumer grows its
own merge of the two. Keeping the billing truth in commerce and only the
intent here means enabling never spends new money — a plan upgrade happens in
commerce, not here — and disabling is never gated.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 Addresses

| operation | what |
|---|---|
| `GET /v1/entitlement` | the caller's plan projection: `{ tier, apps: {…} }`, the per-app booleans the console shell renders (`apps/entitlement/projection.go`) |
| `GET /v1/entitlement/orgs/{org}` | `{ "enabled": [...] }` — the org's toggled-on products |
| `POST /v1/entitlement/orgs/{org}` | `{ "add": [...], "remove": [...] }` → `{ "enabled": [...] }`, bounded at 64 products per batch (`apps/entitlement/entitlements.go:59-61`) |

All three are typed operations. Today's router serves the org pair at
`/v1/orgs/{org}/entitlements`, under a root this capability does not own; that
pair is carried by `hanzoai/cloud` `openapi/misfiled.txt` and closes by fold,
mirroring the `/v1/kms/orgs/{org}` shape the key service already serves.

### §2 Store

One encrypted SQLite database, the deployment's own `entitlement`, opened
through the one opener (`sqlpool.Open("entitlements", dir)`,
`apps/entitlement/store.go:47`) and keyed `(org, product)`. Product ids and
org labels are validated at the edge against the one product-id and org-label
shapes (`apps/entitlement/entitlements.go:63-72`).

### §3 Tenancy

`{org}` MUST equal the caller's validated org (`c.Org()`), unless the caller
is a SuperAdmin — `c.IsAdmin()`, minted only for `owner == "admin"` and never
client-forgeable — who may target any org (HIP-0118). A bearer-less request
with a restored `X-Org-Id` and no verified user fails the `principal.Validated`
gate and is refused 403 (`apps/entitlement/entitlements.go:26-32`). There is
no path by which one org reads or writes another's entitlements.

### §4 The gate, and its two fail directions

A product may only be ENABLED if it is ENTITLED: the write reads
`commerce.CheckEntitlement` and a non-SuperAdmin can only switch on what the
org already pays for; a SuperAdmin bypasses the gate — the operator can comp
any product to any org. With commerce unreachable, a non-SuperAdmin enable
fails closed, 503, never open (`apps/entitlement/entitlements.go:74-77`).
DISABLING is always allowed.

The two read paths fail in deliberately opposite directions
(`apps/entitlement/projection.go:9-17`): the UI projection fails
safe-to-locked — commerce down means an app reports `false` at 200, never a
5xx — while the enforcement leg (`RequireProduct`,
`apps/entitlement/require.go`) fails open, so functionality is preserved
during a billing outage even as the UI conservatively shows locked. The plan →
product policy itself lives once, in the catalog commerce resolves; it is
never restated here.

### §5 Metering, events, observability, stage

The capability is free (`plugin/entitlement/main.go:22`, `cloud.Free`). It
publishes no events on the bus and delivers nothing to customer webhooks.
Beyond the request span, it emits its mount line and one audit-shaped log per
mutation — org, add, remove, whether SuperAdmin, and the actor
(`apps/entitlement/entitlements.go:306`). Its stage is `ga` — the manifest
row (`manifest/apps.go:366`) carries no stage.

### §6 Upstream

The capability derives from no forked, embedded or mirrored OSS project. Its
one non-standard-library import beyond the app framework is
`github.com/hanzoai/account` v0.3.3 (MIT OR Apache-2.0), the billing-account
rule as a library.

## Rationale

The alternative to the opposite fail directions is one posture for both reads.
Failing everything closed turns a commerce outage into a product outage;
failing everything open renders upgrade UI as if every org owned every plan.
Splitting by consequence — enforcement preserves function, projection
preserves honesty — costs one paragraph of doctrine and buys an outage that
degrades instead of cascading.

## Security Considerations

The wrong implementation grants product for free or across tenants. Skipping
the entitlement leg on enable turns the toggle store into a self-serve comp
system; the commerce read at write time is the control, and its fail-closed
posture for non-SuperAdmins is what keeps an outage from becoming a giveaway.
Trusting a per-org `isAdmin` instead of the one SuperAdmin predicate is the
privilege escalation HIP-0118 names. The org label folded into the store key
is validated strictly at the edge, so a crafted `{org}` cannot address another
tenant's rows.

## References

- HIP-0106 — The Hanzo Plugin Contract
- HIP-0118 — SuperAdmin & Tenant Isolation Model
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
