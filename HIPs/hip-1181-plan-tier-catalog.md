---
hip: 1181
title: Plan — The Tier Catalog
author: Hanzo AI
type: Standards Track
category: Core
capability: plan
status: Final
implementation-go: partial
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1181: Plan — The Tier Catalog

## Abstract

`plan` is the plan catalog: every tier you can buy, what it costs, and what it
grants. It answers at `/v1/plans` — the cloud, subscription, blockchain, DNS, GPU
and storage tiers, the regions capacity is offered in, the per-use price of every
metered tool, the entitlement vocabulary a tier grants, the JSON Schema that
vocabulary conforms to, and a resolver from one plan id to all of it. It owns no
store: the catalog is embedded data and every operation is a read. It is
implemented in `hanzoai/cloud` at `apps/plan` (HIP-0106).

## Motivation

What a tier GRANTS is asked by the paywall, by licensing, by the console and by
every product that gates a feature on a subscription. Answered separately it
becomes several derivations of one vocabulary, and a customer who paid for a
feature finds it present in one surface and absent in another. The vocabulary and
the transforms that derive a grant from a catalog record live once, in the plans
data package; this capability runs that package's own transforms rather than
restating them in Go, so there is one derivation and one place to change it
(`apps/plan/plan.go:9-24`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 One catalog, no store

This capability owns NO store. The catalog is embedded data — a JSON catalog plus
the entitlement transforms — loaded once at mount into a JavaScript runtime with
the catalog injected as a global (`apps/plan/plan.go:64-88`). Every operation is
a read of that data. There is no table, no file and no write anywhere in the
package. The read-only constructor is the deliberate choice: a storage-bearing
variant of the same runtime host exists for subsystems that persist, and a
catalog does not take it.

The derivation from a catalog record to a namespaced entitlement block, and from
that block to the flat license-feature list a signed license carries, runs as the
JavaScript the data package ships. A Go port would be a second derivation of one
vocabulary, free to drift from the one the catalog's own tests cover, and the
drift would surface as a grant that two subsystems disagree about.

### §2 The addresses

Fifteen operations under `/v1/plans`, every one typed: each is declared once as a
`zip` typed op with a named In and Out, at an absolute path, so the REST route,
the served document, the MCP tool, the CLI command and every generated client
project from that one registration (`apps/plan/plan.go:104-125`).

| operation | what it answers |
|---|---|
| `GET /v1/plans` | the cloud plan catalog — every cloud tier with price, included capacity, limits and features, scoped to the caller's catalog |
| `GET /v1/plans/cloud` | the cloud plan catalog |
| `GET /v1/plans/subscriptions` | the subscription ladder — personal and team tiers, monthly and annual price, seat rules, limits, billing reference |
| `GET /v1/plans/blockchain` | the RPC tiers metered in monthly compute units, with prices, limits and overage terms |
| `GET /v1/plans/dns` | the DNS tiers, priced on zones, records per zone and queries per day |
| `GET /v1/plans/gpu` | the rentable GPU configurations — accelerator count and model, VRAM, vCPUs, host memory, hourly price |
| `GET /v1/plans/storage` | the block-storage price block: price per GB per month, and the volume size bounds a cloud plan may attach |
| `GET /v1/plans/regions` | the regions cloud capacity is offered in, each with display name and physical location |
| `GET /v1/plans/tools` | the per-use price of every metered tool, each with the unit it bills in |
| `GET /v1/plans/policy` | the published pricing policy: whether pricing is transparent, the revenue-sharing terms, and the principles the catalog is priced by |
| `GET /v1/plans/vocab` | the entitlement key vocabulary — every key with namespace, JSON type, nullability, unit, enum and title |
| `GET /v1/plans/schema` | the two JSON Schema documents this surface speaks: the entitlement schema and the plan schema |
| `GET /v1/plans/entitlements/{id}` | what one plan GRANTS and not what it costs: the entitlement block and the flat license-feature list derived from it |
| `GET /v1/plans/resolve/{id}` | one plan resolved to everything a consumer needs at once: entitlements, license features, billing reference, and the catalog it came from |
| `GET /v1/plans/health` | that the subsystem is mounted and serving |

Typed does not mean the catalog record is restated. Inside every envelope the
catalog VALUES are opaque on purpose: the data package owns the shape of a plan,
a tier and a region, and a Go struct restating one would silently drop any field
the catalog adds — on a surface whose whole job is to relay the catalog
(`apps/plan/ops.go:88-93`). The operation, its input and its envelope are named;
only the record inside is passed through. Two operations answer an open object
for the same reason: the policy block and the storage price block are catalog
documents, not shapes this capability defines.

`GET /v1/plans/health` answers from the process itself and consults neither the
catalog nor the runtime, so it stays `ok` while either is degraded. A catalog read
is 503 when the runtime is not mounted and 500 when the runtime itself fails;
otherwise the caller sees the catalog's OWN status and message, so a 404 for an
unknown plan id is a first-class answer rather than machinery noise
(`apps/plan/ops.go:227-241`).

Five further operations sit under this prefix — `GET`/`POST /v1/plans/entries`,
`PUT`/`DELETE /v1/plans/entries/{slug}`, and `POST /v1/plans/seed` — and they are
`commerce`'s, not this capability's. They are declared with prose rather than
typed because they are bound from a module's own route table. This capability MUST
NOT serve them and MUST NOT hold the rows behind them; §9 states why the split is
where it is.

### §3 Tenancy

Every operation requires a bearer, as the document declares for the whole surface
(HIP-0026). The tenant here selects a CATALOG rather than filtering rows: the
validated org the identity boundary asserted arrives on the context and picks a
reseller org's own catalog overrides.

The tenant MUST NOT be an operation input. An input is caller-supplied, so a
tenant key read from one is a cross-tenant read the caller asserted for itself —
on this surface it would hand any caller any reseller's catalog by typing the name
into the URL (`apps/plan/ops.go:202-213`). Where no validated org is parked, the
answer is the canonical public catalog, never another reseller's. That is the
fail-closed direction for a price list: refusing to publish the public catalog
buys nothing, and defaulting to a private one gives everything away.

### §4 Money

Free, said in those words: the plugin declares `cloud.Free`
(`plugin/plan/main.go`). This capability debits nothing, on any plane, at any
price. It publishes what things cost; it never charges for the answer.

### §5 Events and observability

It publishes nothing on the bus — a customer's webhooks at `/v1/webhook` receive
no `plan.*` event. A catalog read has no verb worth delivering.

Beyond the request span every route gets, it emits structured log lines only: one
at mount naming the prefix and the brand, and one error line when a dispatch into
the runtime fails, carrying the route that failed. It writes no audit record and
no metric of its own.

### §6 The in-process seam

Beyond its addresses, this capability is the ONE Go seam other subsystems read a
plan's grants through, so no other package imports the catalog data or restates
the vocabulary (`apps/plan/plan.go:135-210`):

- `Entitlements(ctx, id)` returns the canonical namespaced entitlement block for
  a plan id. It errors when the subsystem is not mounted or the id is unknown, so
  a caller fails closed rather than silently granting a default tier.
- `LicenseEntitlement(ctx, id)` returns that block AND the flat license-feature
  list, from the SAME route `GET /v1/plans/entitlements/{id}` serves. An unknown
  plan id is `found == false` with no error, so a caller scanning several
  subscriptions skips a tier it does not recognise and keeps going; ANY other
  failure is an error. The two answers MUST stay distinguishable — "this tier
  grants nothing" and "the catalog could not be reached" are different facts, and
  collapsing them either strips a paying customer's features or fabricates a
  grant, depending on which way the caller guesses.
- `Paid(Tier)` and `Tokens(Licence)` are pure predicates over a plan record the
  caller passes in. They read no catalog and need no runtime.

One rule binds every consumer of the last pair. A consumer classifying an
EXISTING subscription MUST use the plan record the subscription itself recorded
at subscribe time, and MUST NOT resolve its slug against the current catalog. The
catalog lists what is on sale; a subscription records what was bought. Commerce
archives a retired tier's row rather than deleting it, precisely so renewals and
invoices still price from it, and classifying a subscriber against the for-sale
list strands exactly the subscribers that archiving protects
(`apps/plan/paid.go:3-19`). A tier's licensing facts come off the same row for the
same reason; only the SPELLING of the resulting tokens lives here, and a spelling
is not a policy (`apps/plan/licence.go:3-16`).

### §7 Stage

`ga`. The manifest row declares no stage, and absent is `ga` (HIP-0139 §8). The
catalog is what a customer reads before they buy anything, so it is public by
definition of the product.

### §8 Upstream

The catalog and its transforms are `github.com/hanzoai/plans` v1.4.20
(Apache-2.0, Hanzo AI) — Hanzo's own data package, embedded whole as catalog plus
bundle and not forked; what survives in HEAD is all of it, unmodified, loaded at
mount. The one third-party upstream is the ECMAScript interpreter the bundle runs
in, `github.com/dop251/goja` (MIT), linked as a library with no fork. Nothing else
here derives from an upstream project.

### §9 Boundary

Three neighbours are adjacent, and each split is worth stating exactly.

**pricing** (`/v1/pricing`) is the price list: what a UNIT costs — a model, a
provider, a GPU hour, a tool call, a hosting plan — plus the registry that decides
which entries a caller may see. `plan` is the tier catalog: what a PACKAGE costs
and what it grants. Where both publish a section they are answering different
questions from the same source: a rate versus a bundle. The entitlement half is
this capability's alone and MUST stay here — `resolve`, `entitlement`, `vocab`
and `schema` have no counterpart under `/v1/pricing`, because a price is not a
grant.

**commerce** owns the plan AUTHORITY: the mutable rows a SuperAdmin edits at
`/v1/plans/entries`, seeded from the shipped catalog at `/v1/plans/seed`, living
in commerce's own store, and reconciled to the catalog the binary ships at boot.
Those rows are what a subscription at `/v1/billing/subscriptions` and an invoice
actually price from. `plan` owns the CATALOG: the shipped record of what a tier
costs and grants. So `plan` MUST NOT hold a store, MUST NOT serve the authority
operations, and MUST NOT be the record a charge is computed from; and commerce
MUST NOT restate the entitlement vocabulary — it reads it through §6.

**entitlements** (`/v1/entitlement`, HIP-1202) answers what an ORG may run right
now: the billing truth read from commerce, and the org's own on/off intent.
`plan` answers what a TIER grants, for any tier, with no org in the question. A
grant is a property of the plan; an entitlement is a property of an org. The two
are one lookup apart and must never be one table.

**licensing** (`/v1/licensing/issue`) signs. `plan` supplies the flat feature list
a license carries and holds no key, no fingerprint and no signer. The vocabulary
is here; the signature never is.

## Rationale

The alternative to running the data package's own transforms is porting them, and
a port of an entitlement vocabulary is a second answer to "what does this tier
grant" that nothing forces to agree with the first. The alternative to an opaque
catalog value is a Go struct per record, which turns every catalog addition into a
field the relay drops without saying so. The alternative to no store is a table
here, which would immediately be a second authority beside commerce's rows and
would have to be reconciled with them — the shape HIP-0139 §7.2 refuses, since two
apps on one store is not a split.

## Security Considerations

The wrong implementation gives an attacker one of three things.

Another reseller's catalog is the only cross-tenant read this surface has, and it
is closed by where the tenant comes from rather than by what is checked: the
catalog key is read from the context the identity boundary parked, and is not an
operation input, so there is no field to forge and no validation to bypass.

A grant nobody bought is the money-shaped one. It arrives when an unresolved plan
is quietly treated as a known tier — a default that grants, or a blank that
denies. Neither is permitted: unknown and unavailable are distinct answers, and a
consumer on a money path MUST propagate the failure rather than pick a tier
(§6).

A moved price is not available at all: this surface is read-only, holds no row a
charge is computed from, and has nothing to write. The charge of record is
commerce's, and an attacker who reached this capability reaches published catalog
content — which carries no secret, because the licensing signer and fingerprint
live in the licensing capability and never here.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1202 — Entitlements — What an Org May Run
- HIP-1222 — Pricing — The Price List and Who May See It

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
