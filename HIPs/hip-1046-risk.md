---
hip: 1046
title: Risk
author: Hanzo AI
type: Standards Track
category: Application
status: Final
created: 2026-08-20
capability: risk
requires: HIP-0106, HIP-0139, HIP-0519
---

# HIP-1046: Risk

## Abstract

`/v1/risk` is decisioning over an organization's own behaviour: a model per
organization learned from that organization's own events, the regime it decides
under, the ground truth that arrives late and settles what actually happened, the
immutable datasets a model can cite, and the lookup sets a decision needs but
cannot derive.

It is ONE product served by FOUR processes in `hanzoai/cloud` — `apps/risk`
(decide and learn), `apps/label` (ground truth), `apps/dataset` (versioned
snapshots) and `apps/reference` (lookup sets). Ground truth and lookup sets are
capabilities of their own, each with its own store and its own address —
HIP-1261 (`/v1/label`) and HIP-1262 (`/v1/reference`) specify them.

This HIP states the invariants that hold across all four. It is not the model,
the feature list or the rule set.

## Motivation

Two things make an anomaly decision defensible: it was computed from data the
organization actually produced, and it can be re-derived later against the rows
and the policy that produced it. Neither survives a design where a model is a
single mutable cell, ground truth is an UPDATE, and the training set is a query
re-run on demand.

Each of the four planes exists because one of those properties needed an owner
with its own lifetime.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### 1. A read cannot be spelled without a tenant

A read of the feature surface takes a tenant key that has NO exported
constructor and is minted in exactly one place, from the validated principal
(`apps/risk/feature.go:104`, `:177`). There is no path from the package to the
store that does not carry one, so "forgot to scope the query" is not a mistake
that can be made rather than one caught in review.

The tenant MUST be the LEADING BOUND predicate of every statement, bound
positionally; every column and aggregation a caller can name MUST resolve through
a fixed allow-list and MUST NOT be interpolated (`apps/risk/feature.go:374`).

### 2. The key is `<brand>/<org>`, never the bare org

An org name is unique within an issuer and not across issuers, so identically
named organizations under two brands are two unrelated tenants. Keyed on the bare
name they are one (`apps/risk/feature.go:104`).

The per-organization model GEOMETRY is seeded from that key. Two tenants do not
merely hold different counters — they hold different trees, so probing one
reveals nothing about where another's regions lie.

### 3. Cross-organization learning is aggregate-only, and uncomputable otherwise

Exactly one table is shared, and it has NO tenant column at all: three
interpolated quantiles of one dimension over one day, plus how many organizations
and how many buckets contributed (`apps/risk/baseline.go`). There is no subject,
no identifier, no pseudonym and no hash of one. The leak is UNCOMPUTABLE rather
than merely forbidden, because the shape cannot hold a tenant.

Aggregation alone is not anonymity, so a bucket MUST additionally clear a
k-anonymity floor on distinct contributing organizations and on underlying rows,
and the floor MUST be enforced twice — in the statement and again on read — so a
row written before the floor existed is still refused
(`apps/risk/baseline.go:82-93`).

One organization, one vote: contribution is bounded per organization, because
counting contributors is not the same as bounding weight and only the second is
anonymity.

No model reads this table. It is published for a human to compare against and
MUST NOT be folded into a score.

### 4. The regime is a versioned value, separate from the model

What an organization has LEARNED and what it has STATED are two facts with two
lifetimes and MUST NOT share a row (`apps/risk/policy.go`). They did, and the
writer's guard — decline to write while the snapshot holds no learned mass — was a
fact about the state, so an organization that stated a policy before its model had
learned anything had that policy discarded on the next rollout, silently, having
been told it was live.

A regime is a VALUE: two regimes with the same numbers are the same regime, and a
version is minted only when the regime CHANGES. A version therefore means "the Nth
distinct policy this organization adopted", not "the Nth time somebody pressed
save", and a client that restates its configuration on every deploy costs nothing.

An adverse decision is defensible only against the regime that produced its cut,
so the decision MUST name the version.

### 5. Two independent judges

A model over learned mass answers one question: is this where this organization's
behaviour normally lives. It has a named blind spot — a fresh account has no
history, so the model declines, so the event is judged by nothing
(`apps/risk/determine.go`).

A second judge is a RULE over stated facts. It MUST NOT read the score, the cut,
the shape, or whether the model has warmed. The two verdicts fuse by taking the
SEVEREST (`apps/risk/determine.go:382`), so a warming, refusing or never-planted
model contributes an allow and cannot lower anything.

### 6. Ground truth: late, contested, and traceable

The ground-truth plane is its own capability, specified by HIP-1261. What this
HIP keeps is the cross-plane consequence: resolution shows only what was
knowable at the observation instant, so a training set built for an event can
never contain a label that did not exist when a model would have had to act,
and the guard reads the DERIVED instant, never a value the caller chose.

### 7. A dataset is bytes, not a query

Storing a spec and re-running it guarantees irreproducibility: the source's parts
merge, retention drops the tail, and the rollup can be re-run, so the same query
asked twice is two answers (`apps/dataset/dataset.go:19-27`). A dataset here is
declared as a version, materialised once, fingerprinted, and NEVER rewritten.

A published version is `ready`, and the only rank above it is `disposed` — the
tenant's own retention decision, the one write that may outrank a publication. No
other stage may displace it, and that MUST be enforced both in the store and at
the endpoint.

There is no table-level expiry. Disposal is the tenant's own partitioned drop,
which cannot be spelled cross-tenant.

Every scan of the source is admitted through ONE gate: priced at the meter,
bounded per tenant, bounded in the process, each with its own deadline
(`apps/dataset/dataset.go:41-43`).

### 8. Reference sets: a version, and a refusal

The lookup plane is its own capability, specified by HIP-1262. What this HIP
keeps is the cross-plane consequence: a decision names the exact version of
every set it consulted, a set that has never loaded refuses rather than
answering "not listed", and nothing derived from one organization's rows may
enter the shared baseline, ever.

### 9. Failure is closed and loud

A plane that cannot be built MUST still mount, with every operation failing closed
and reporting the real reason (`apps/risk/risk.go:89-97`). A subsystem that
refuses to mount takes the whole binary's health surface with it, and an operator
cannot act on a process that is not there.

Configuration that changes what a decision means MUST be resolved at mount and
announced then, not discovered by the first decision that needed it.

### 10. Addresses, and what each operation is

The decide-and-learn plane answers under the bare prefix: `features`, `health`,
`learn`, `policy` (GET/PUT), `score`, `search` (POST, and GET of a run by id),
`state` and `state/model` (POST/PUT) (`plugin/risk/openapi.json`). Every one is
typed except `GET /v1/risk/health`, declared because its 503 carries the
degraded report as its body — which component failed, and the real error — and
a typed op's error envelope would drop exactly that
(`apps/risk/typed_wire_test.go:37-46`). The nested planes are mounted by their
own processes — today at `/v1/risk/labels`, `/v1/risk/reference` and
`/v1/risk/datasets` (`manifest/apps.go:230`, `:241`, `:270`); the router
resolves nested prefixes by specificity, so the split needs no mount order.
HIP-1261 and HIP-1262 move ground truth and lookup sets to their own
addresses; the code follows those specs, and this HIP's invariants hold across
the move.

### 11. The stores

The decide plane owns the per-tenant model shelf under its own data directory —
observation records, stated regimes, per-tenant rings bounded per tenant
(`apps/risk/ring.go`) — and it is the single writer of that state. The dataset
plane owns its store (§7); ground truth and lookup sets own theirs under their
own HIPs (§6, §8). The feature surface is READ from the analytics warehouse
this product does not own; every such read passes the tenant key of §1.

### 12. The money

THE BILLABLE UNIT IS A SCREEN: one event judged against an organisation's own
model. Scoring one event is one screen, learning from a batch is one per event,
and a search is priced from its measured size, in two halves each gated before
the half it prices — the surface by the stated window, the grid by the measured
history (`apps/risk/typed.go:1282-1293`, `apps/risk/learn.go:1772-1795`). The price of a
screen is an operator-set policy value, `CLOUD_RISK_PRICE_UUSD_PER_SCREEN` in
micro-USD, defaulting to 100 — never a number this subsystem invents — and zero
makes screens free and un-gated (`apps/risk/typed.go:1294-1300`). Every priced
op GATES on the upper bound before the work and METERS what was actually done
after it, on the caller's OWN ledger, through the fleet's one resource meter
(`apps/risk/typed.go:1353-1392`). A caller that is refused pays nothing; a
cancelled run pays for the part that ran.

### 13. Events, observability, stage, upstreams

The capability publishes NOTHING a customer's webhooks receive. Each decision
is also stated as one `risk_decided` row on the analytics event plane the
organisation already reads (`apps/risk/emit.go:64`) — server-minted or bounded
attributes only, the amount as a bracket and never the value, detached so a
telemetry outage cannot fail a decision. That row, plus the request span every
route already gets, is the whole observable surface: no extra spans, no
metrics of its own.

Its stage is `beta` (`manifest/apps.go:244`, `Stage: Beta` — as are the
nested planes'). The decide and dataset planes derive from no outside
project — nothing forked, embedded or mirrored; the label and lookup planes
answer for their own in HIP-1261 and HIP-1262.

## Rationale

The four planes could be one process. They are not, and the reasons are properties
rather than preference: the decision plane holds in-memory mutable model state and
must be the single writer of it, so it is pinned; the dataset plane's every answer
is a function of the store, so it restarts empty and loses nothing; the label plane
has different writers, different readers and a retention clock of its own, since a
label that fed an adverse action is a compliance record whose life is not the life
of the decision that cited it.

They are one PRODUCT because the address is the product, and the composition root
refuses two owners for one prefix, so the split is checked rather than agreed.

`/v1/ml` is the model-SERVING plane and is a different product. Publishing any of
this there would file it under a name whose consumers are different, and nothing in
the fleet would say so — a growth in that product's operation count reads as
growth (`apps/dataset/dataset.go:6-18`).

## Security Considerations

The whole surface is one organization's behavioural data, which is the most
sensitive thing it hands us. The tenancy argument is therefore structural rather
than procedural: the key has no constructor, the shared table has no tenant
column, the per-tenant geometry differs. Each is a property an implementation
cannot forget to apply.

The cross-organization aggregate is the one place a leak would be possible, so it
carries three independent bounds — no tenant dimension, a k-anonymity floor
enforced twice, and a per-organization weight cap — and no model consumes it.

Decisions here can be adverse to a person. That makes provenance a security
property: the regime version, the derived knowable instant, the evidence pointer
and the filing identity are what make a challenged decision answerable, and each
MUST be server-derived where a caller-supplied value would be self-serving.

## References

- HIP-0106 — The Hanzo Plugin Contract
- HIP-0519 — One Identity Boundary
- HIP-0201 — Model Risk Management
- HIP-1261 — Label — Ground Truth
- HIP-1262 — Reference — Lookup Sets

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
