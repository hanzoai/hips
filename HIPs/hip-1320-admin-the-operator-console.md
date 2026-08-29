---
hip: 1320
title: Admin — The Operator Console
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: admin
status: Final
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0118, HIP-0135, HIP-0139
---

# HIP-1320: Admin — The Operator Console

## Abstract

`/v1/admin` is the operator's view of the fleet: the tenant directory, what each
org is spending and owes, the credit an operator grants, the flags and caps it
sets, the infrastructure it watches, and what each host is running. It is
`hanzoai/cloud` `apps/admin`, and it is the one capability whose audience is not
a customer.

It owns no store. Every panel is a read fanned into IAM, commerce, the ledger,
o11y and the cluster; every mutation is somebody else's write, recorded first in
the tamper-evident trail. What admin owns is the ADMISSION and the AGGREGATION —
one predicate at the endpoint, and the fold that turns a hundred upstream reads into
one board.

This HIP states that surface, the two-tier gate it admits through, and why a
capability nobody outside the reserved org can call is nonetheless `ga`.

## Motivation

Every other capability in the fleet answers to a customer, and the shape of a
capability HIP assumes one: the store it owns, the tenant a request becomes, the
unit it meters. Admin answers to the operator and inverts each of those — no
store, a caller who is deliberately NOT pinned to one tenant, and nothing
metered at all. A specification that only describes the customer-facing shape
leaves the one surface that can grant credit, set a cap and reload a binary as
the only surface with no spec.

The address family is already specified: HIP-0139 §3.2 fixes `/v1/admin/<name>`
as the operator's view of `<name>`, served by `<name>`, dropped from the public
document by address. What was never written down is the capability at the ROOT
of that family — the console itself, which serves `/v1/admin` and is not the
operator view of anything.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 One root, two kinds of address under it

Every route admin serves MUST be under `/v1/admin` (`manifest/apps.go`:
`{Name: "admin", Prefixes: []string{"/v1/admin"}}`). The surface is 55 paths and
60 operations, in 33 groups (`plugin/admin/openapi.json`, measured
`python3 -c "import json; d=json.load(open('plugin/admin/openapi.json'))"`,
2026-08-20).

Two kinds of address share that root and MUST NOT be confused:

1. **Admin's own nouns** — the console. `me`, `overview`, `orgs`, `users`,
   `customers`, `usage`, `analytics`, `revenue`, `money`, `finance`, `invoices`,
   `subscriptions`, `grants`, `promos`, `caps`, `flags`, `roles`,
   `applications`, `products`, `providers`, `services`, `subsystems`, `infra`,
   `volumes`, `compute`, `bases`, `metrics`, `aimetrics`, `o11y`, `audit`,
   `sync`, `waitlist`, `plugins`. The second segment names a thing the OPERATOR
   works with, and admin is the capability that answers for it.
2. **Another capability's operator view** — `/v1/admin/<name>/*`, served by
   `<name>` and not by admin (HIP-0139 §3.2). `referral` is the worked example:
   `/v1/admin/referrals/bonuses` is the referrals capability's row in the
   manifest, not admin's.

A reader tells them apart by the manifest, which is the only place that decides:
the app whose row carries the prefix is the app that serves it. Admin MUST NOT
claim `/v1/admin/<name>` for a `<name>` that is itself a capability, and a
capability MUST NOT serve `/v1/admin/<noun>` for a noun that is admin's.

`/v1/admin/plugins` is the case that looks like the second and is the first.
What it changes is not a capability's state but the BINARY a host is running,
and a binary belongs to the fleet rather than to any one capability, so the
console that watches every capability is the capability it belongs to (§7).

### §2 The gate: one predicate, two tiers

Admission is decided at the top of every handler by one of two functions, and by
nothing else (`apps/admin/core/typed.go`).

**`core.Admit` — platform tier.** Admits if and only if `principal.IsSuperAdmin`
holds, which is HIP-0118's predicate and no second term. Everything that reads
across tenants or changes fleet state goes through it.

**`core.AdmitScoped` — org tier.** Admits a SuperAdmin unconditionally, or a
caller for whom THREE facts all hold: the caller administers their own org
(`principal.IsOrgAdmin`), the caller is a validated principal pinned to that org
(`principal.Org`), and that org is an enabled white-label tenant
(`State.IsWhiteLabelTenant`). The allowlist is seeded from
`ADMIN_WL_TENANT_ORGS` and is fail-closed: unset means SuperAdmins only.
Passing the gate is not the end of the scoping — the handler then folds every
read through `ResolveScope`/`ScopedOrgs`, which hard-limits a non-super caller to
their own org subtree whatever the request says.

Three rules follow, and each is a refusal:

1. The predicate is EVALUATED ONCE, at the identity boundary, and thereafter
   READ. `SanitizeIdentity` deletes every authority header a client sent, then
   mints `X-User-IsAdmin` only from a validated credential whose signed `orgs`
   set contains the reserved org (`middleware_identity.go`). It is never
   restored from client input on any path, including the anonymous one. A
   capability MUST NOT re-derive the predicate from a claim it reads itself.
2. Membership is the predicate, at ANY position in the signed set. Reading it
   positionally — `Orgs[0]`, the home org — refuses every operator who holds
   admin-org membership without their user row living there, which is the
   defect `middleware_identity.go` records against its own earlier form.
3. The gate is CALLED, not wrapped. Each handler calls `Admit` or `AdmitScoped`
   on its first line, so the tier is read where the handler is read and applies
   to the MCP and CLI projections too, which never touch the router
   (`apps/admin/admin.go`, `routes`). A middleware gate protects one projection
   of four.

The reserved org's slug is `IAM_ADMIN_ORG`, default `admin`
(`apps/admin/admin.go`, `adminOrgOf`).

### §3 Refusal is 403, and that is deliberate

A refused caller gets `403` with `SuperAdmin required` or `admin required`, not
`404`. This is the opposite of the stage rule (HIP-0139 §8.2), where a
capability a customer has not been let into answers 404 so the refusal is not an
existence oracle — and the difference is the point. `/v1/admin` is documented,
addressed and known to exist; there is nothing for a probe to learn. Hiding it
would buy no secrecy and would cost the operator a diagnosable error.

### §4 The store it owns: none

Admin opens no store. There is no `cek.Open` under `apps/admin`, and there is no
`admin` datastore anywhere in the fleet. Every board is a fan-in over planes that
own their own data:

| upstream | what admin reads |
|---|---|
| IAM (`apps/admin/iam`) | the org and user directory, on the management surface, replaying the caller's own credential |
| commerce (`apps/admin/commerce`) | balances, spend, credits, invoices, subscriptions |
| the AI ledger (`apps/admin/ledger.go`) | what was served: 30-day AI spend and tokens |
| o11y / health (`apps/admin/health`) | service health and the incident board |
| the cluster (`apps/admin/infra`) | nodes, pods, volumes, services — read through the k8s API |
| DigitalOcean (`apps/admin/digitalocean`) | the droplets and volumes behind the fleet |
| the audit trail (`deps.Audit`) | the grant history, projected — never a second copy |

This is a REQUIREMENT and not an accident. A console that kept its own copy of a
number would be a second source of truth for that number, and the operator would
have no way to tell which one was wrong. Every figure a board shows MUST be
attributable to the plane that owns it, and a plane that fails MUST degrade its
own row honestly rather than let a fleet total read healthy — the overview
answers 200 always and reports each upstream in `sources[]` as ok, degraded or
not-configured.

### §5 Mutations, and the trail they are written to first

Admin's writes land in other planes: a credit grant in commerce's ledger, a cap
or promo in the usage plane, a flag in `flags`, a suspend in IAM, a reload in the
host. Every one of them MUST be recorded in the tamper-evident, hash-chained
audit trail (HIP-1103) BEFORE it is reported as done, and a deployment with no
durable audit store MUST refuse to mutate rather than mutate unrecorded:

> refused: no durable audit store is configured on this deployment; a plugin
> lifecycle change must be recorded before it is made
> — `apps/admin/plugins/fleet.go:155`

Recording FIRST is what makes the trail complete: a write recorded afterwards
loses exactly the attempts that crashed between the act and the record, which
are the ones worth having. Failed attempts are recorded too, which is why the
grant history is a projection of the trail rather than a table of successes —
`GET /v1/admin/grants` reads back `admin.customer.credit` entries, so the view
cannot drift from what happened.

### §6 Tenant, price, events, telemetry

**Tenant.** Admin is the one capability whose caller is deliberately NOT pinned
to a tenant. A SuperAdmin's window is the fleet; a white-label admin's window is
their own org subtree, computed by `ResolveScope` from the validated principal
and never from a request field.

**Price.** Free, in those words: `Price: cloud.Free`
(`plugin/admin/main.go`), and `admin` is absent from `meteredApps` (`spend.go`).
It meters nothing and charges nobody, because the operator is not a customer.
A capability whose audience is the operator MUST NOT be metered — a meter on
this surface would bill the house for looking at its own books.

**Events.** Admin publishes no `admin.<noun>.<verb>` events on the platform bus,
so a customer's webhooks (HIP-1310) receive nothing from it. That is correct and
MUST stay so: an operator's action is not a customer's event, and a fan-out that
delivered one would tell a tenant what the operator is doing. The audit trail is
where an operator action is durably visible, and its audience is the operator.

**Telemetry.** Beyond the request span every route already gets, admin emits
logs and no metrics of its own. The one publication it makes is in-process — the
per-provider funding split, handed to the `ai` module's funding state
(`apps/admin/finance/finance.go`) — and reaches no bus and no tenant.

### §7 The reload endpoint

`/v1/admin/plugins` is four operations: the fleet's per-host account of what it
is running, and reload, enable and disable for one plugin. Each is `core.Admit`
(platform tier) and each mutation is audited under §5. They are the most
dangerous routes in the fleet — any of them can take production down — and they
are specified here rather than anywhere else because they change a BINARY, which
is the fleet's and not a capability's.

The identity of what is running is the artifact's SHA-256 and MUST NOT be a
version string, because the digest is the only identifier that cannot drift from
the bits actually serving.

Three rules bind the endpoint:

1. **The version-to-digest mapping has one author.** A version resolves through
   `CLOUD_PLUGIN_ORIGIN` to `<origin>/<version>/binaries.json` — the index CI
   already writes. Admin MUST NOT compute a digest and MUST NOT accept one from
   the caller alone.
2. **Verification precedes execution.** The digest is handed to `zip`, which
   verifies the download against it BEFORE the file is made executable or given
   its final name, and uses it as the cache key, so a version this host has
   already run needs no network.
3. **Hosts are reported, never merged.** The listing answers per host. During a
   rollout the hosts disagree BY DESIGN, and a merged view hides exactly the
   state an operator is watching for. A peer that could not be reached reports
   its error and an empty plugin set, which is NOT the same as none, and nothing
   downstream may conclude drift from it.

A pin rolls back as readily as it rolls forward: the same route with an older
version is the rollback, so there is one mechanism and not two.

### §8 Withheld, not hidden

Admin is `ga` — its manifest row declares no stage, and absent is `ga`
(HIP-0139 §8). It is core: the fleet cannot be operated without it. It is simply
not customer-facing, and those are different properties that a single "is it
finished" axis cannot carry.

The whole capability is dropped from the public document BY ADDRESS, in one
place: `openapi/public.go` reserves the product `admin` for the operator
(`const Operator = "admin"`) and refuses any path whose first segment after
`/v1` is that word. Everything downstream follows without a second decision —
no generated client class, no MCP tool, no CLI command group, no public page.

This MUST remain an address rule and MUST NOT become a per-route annotation. A
list of operations to withhold is a list somebody maintains, and the operation
added next week is the one that is not on it. The address is a property of the
route itself and cannot be forgotten.

The consequence is deliberate and stated so it is not mistaken for an omission:
admin is a `ga` capability with no SDK method, no tool and no public page, and
the operator reaches it through the console at `admin.hanzo.ai` (HIP-0118 §6)
and through the internal document.

### §9 Upstream

Admin derives from no OSS project: it forks, embeds and mirrors nothing. It is
cloud's own aggregation over planes that have their own upstreams — IAM
(HIP-0026), commerce (HIP-1220), the audit trail (HIP-1103). The infrastructure
board reads the cluster through `k8s.io/client-go` (Apache-2.0), which is a
client library for an API and not a project this capability derives from.

## Rationale

The alternative considered was for each plane to serve its own operator surface
and for the console to be a client that calls thirty of them. It was rejected
for the reason §4 gives: the fold is the product. An operator asking "what is
this org costing us" needs IAM, commerce and the ledger reconciled onto one row
with an honest freshness flag per source, and a client that calls three services
and renders three spinners has moved that reconciliation into a browser where it
cannot be tested and each failure reads as a blank.

The second alternative was to gate admin at the edge alone — a proxy in front of
`admin.hanzo.ai` — and to leave the handlers ungated. That is one projection of
four. The MCP endpoint and the CLI reach the same typed operations without passing
any edge, so a gate that lives at the edge is a gate two callers walk around;
this is why §2.3 puts the call in the handler.

## Security Considerations

This is the capability an attacker wants. It reads every tenant, grants money,
sets caps, suspends users and replaces running binaries. The whole design is one
predicate, evaluated once, plus a trail that is written before the act.

**Escalation by claim confusion.** Trusting a per-org `isAdmin` for
platform-level gating is HIP-0118's named privilege-escalation bug, and it is
the one this surface would suffer first: a customer administering their own org
is one boolean away from the fleet. `AdmitScoped` admits that caller only with
the white-label allowlist ALSO satisfied, and even then narrows every read to
their own subtree. `Admit` does not admit them at all.

**Escalation by header.** `X-User-IsAdmin` is an ordinary header on the wire.
Every authority header is deleted on ingress before anything reads one, and the
admin bit is re-minted only from a validated credential — never restored from
client input, on any path, including the one where the data plane still passes
a client `X-Org-Id` through. If the validator cannot verify a token, the request
resolves anonymous and admin fails closed.

**Escalation by position.** Reading membership positionally silently refuses
legitimate operators, and the fix for that class of bug is where the danger is:
a "make it work" patch that widens the test to any org in the set, or to the
isAdmin bit, converts a refusal bug into an escalation. Membership of the
reserved org, at any position, is the predicate; nothing else is.

**The reload endpoint as the shortest path to code execution.** An attacker who
reaches it does not need a vulnerability in any handler — they need a URL. This
is why the origin is deployment config and not a request field, why the digest
comes from the index CI writes rather than from the caller, and why zip verifies
before the artifact is executable. An unset origin refuses the request rather
than falling back to anything.

**The trail as the last line.** Everything above can fail and still leave the
operator able to say what happened, provided the record precedes the act and the
chain is hash-linked. A deployment with no durable audit store therefore refuses
to mutate at all — an unrecorded grant is worse than a refused one.

**Tenant isolation on a surface built to cross it.** Admin exists to read across
orgs, so the isolation cannot come from the address; it comes from the scope
resolved on the caller. Every non-super read folds through `ResolveScope`, and a
request field that names an org is not a scope — it is a filter within one.

## References

- HIP-0026 — Identity & Access Management Standard
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0118 — SuperAdmin & Tenant Isolation Model
- HIP-0135 — What Is Public
- HIP-0139 — Capability
- HIP-1103 — Audit — The Tamper-Evident Trail
- HIP-1220 — Commerce — The Merchant Half
- HIP-1310 — Webhooks — Outbound Delivery

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
