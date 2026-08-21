---
hip: 1167
title: Dataset — An Immutable Snapshot
author: Hanzo AI
type: Standards Track
category: Core
capability: dataset
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139, HIP-1046
---

# HIP-1167: Dataset — An Immutable Snapshot

## Abstract

`/v1/risk/datasets` is the per-org dataset plane of `/v1/risk`: a dataset is a
versioned, immutable snapshot of one tenant's own event surface, and this is
where it is declared, materialised, described, exported and disposed of. It is
implemented in `hanzoai/cloud` at `apps/dataset` (HIP-0106). HIP-1046 states the
invariants that hold across the four planes of the risk product; this HIP states
this one.

## Motivation

Storing a query and re-running it guarantees irreproducibility. The source is a
merging table, its retention drops the tail, and the rollup behind it can be
re-run — so the same question asked twice is two answers, and a model that cites
"the query" has cited nothing. A dataset here is bytes: declared as a version,
materialised once, and never rewritten. A model can name the exact rows it was
fitted on, forever, which is the only form in which an audit can be answered.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store

Two tables in the shared warehouse, owned outright and created idempotently: the
register, `hanzo.risk_dataset`, and the rows, `hanzo.risk_row`
(`apps/dataset/plane.go:85`). The tenant leads the sort key AND the partition
expression of both.

It only READS its source, `hanzo.risk_feature` — the per-org feature surface,
one row per kind, subject and bucket — and never creates it. One writer and one
DDL owner per table: a reader that finds the source absent MUST report an honest
gap, not conjure a second definition that would drift from the first. The source
is also the ONLY admitted source, and that is correctness rather than
convenience: a dataset row's coordinates must be the coordinates the scorer
sees, and two reductions of one stream diverge silently, which trains a model on
coordinates production never produces.

Neither owned table carries a TTL. A table TTL is a fleet-wide clock no tenant
can lengthen and none can shorten, which is the opposite of per-tenant
retention. Disposal is the tenant's own partition drop on `(org, dataset)`,
whose expression leads with the tenant, so a disposal cannot be spelled across
one.

### §2 The address

Seven typed operations under `/v1/risk/datasets`: declare the next version of a
dataset, list the org's datasets, describe every version of one, dispose of one
and every version of it, materialise a declared version into immutable rows,
show a version's lineage, and read a version's rows back one bounded page at a
time. Every one is a typed op — there is no declared-untyped operation on this
surface, and no route here answers anything but a value.

The ops register at ABSOLUTE paths on the typed registry rather than through a
group root, because a group root composes to a trailing slash and a trailing
slash in the document is a trailing slash in every generated client.

### §3 One prefix, four capabilities

`/v1/risk` carries operations from four apps: `risk` at the root, and `dataset`,
`label` and `reference` at their own leaves. What MUST hold:

1. The four MUST partition `/v1/risk` by DISJOINT sub-prefix. No two may claim
   one prefix; the composer refuses two owners for one prefix, so this is
   checked and not agreed. The router resolves by specificity, so mount order
   decides nothing.
2. The root belongs to `risk` (HIP-1046). A capability with a leaf MUST group
   its own middleware on its own leaf and never on the stem: middleware at
   `/v1/risk` for a shorter route would land on a subtree this app does not
   own, which is the escape the scoping refuses.
3. Each of the four MUST own its own store. Two apps sharing one store is the
   defect HIP-0106 names, and HIP-0139 §7.2 refuses a split that creates it.
   This one owns the two tables in §1 and shares no state with a scorer.
4. The tag on an operation is the app that serves it, not the address's first
   segment (HIP-0139 §4.1). A generated client therefore offers a class holding
   exactly these seven operations even though the address reads `risk`.
5. These operations MUST stay under `/v1/risk`. The published product membership
   is read off the FIRST `/v1` segment of a path and off nothing else, so an
   address is a product declaration: filed anywhere else, these rows are filed
   into another product, and the operation-count ratchet reads the arrival as
   growth because it refuses a shrink and only a shrink; `address_test.go` in
   this package holds that as a check rather than a recollection. The pair
   `/v1/risk dataset` in cloud's `openapi/misfiled.txt` therefore closes by the
   decision this section makes — one product, four capabilities, disjoint leaves
   — and MUST NOT close by moving these seven operations to a second top-level
   address.

### §4 Tenancy

The tenant is a `tenant.Key`, and the key is `<brand>/<org>`, not `<org>`: an
org name is unique within an issuer and not across issuers, so two brands'
identically-named orgs would otherwise be one set of rows and one dataset. The
org half comes from the validated bearer owner claim (HIP-0026); the brand half
is the deployment's own and NEVER a field, because a caller that can choose its
brand has chosen which tenant space its org lands in.

The key has no exported field. It cannot be written as a literal outside its own
package and cannot be decoded from a request body, and every function that can
reach the store takes one — so there is no path from this package to the store
that does not carry a tenant. Off the HTTP path there is no request and no
principal, and the answer is a refusal. The mint's shape is re-asserted at the
boundary and a key that is not qualified is 403, because that one value is the
register index, the row index and a partition component at once.

The data key and the billing identity are deliberately different values: the key
indexes the rows, the ledger names the org that is debited. Conflating them
would either bill the wrong account or key the wrong tenant.

### §5 Money

Metered, and the unit is the ACT that reads the source, never the row.

- Declaring a version is free: it is a register write (`declareCost`, zero).
- Materialising is ten cents (`materializeCost`), a flat fee for ADMISSION to a
  bounded job. The bound is the product, so the price is for the bound and not
  for the rows.
- Lineage is two cents (`lineageCost`) — below a materialisation because it
  re-runs the same census over the same window of the same table for the same
  tenant and then stops, writing nothing; above zero because a free re-run of
  the plane's most expensive statement is a free warehouse scan with a verb in
  front of it.
- Listing, describing, exporting and disposing are free.

The gate runs before the act and the debit lands after it, both through the one
shared `cloud.ResourceMeter` under the product label `dataset`. A gate refusal
is rendered as the money wire's own bytes by `cloud.DenyEnvelope`, so this plane
answers the fleet's one denial contract rather than a private spelling of it;
any error that is not a denial passes through untouched. Every scan of the
source goes through ONE gate, which is what makes "gated, metered and bounded" a
property of the admission type rather than a rule each new operation has to
remember.

### §6 Events

It publishes nothing on the bus; a customer's webhooks receive no `dataset.*`
events.

### §7 Observability

Beyond the request span every route gets, structured log lines only: the mount
line naming the brand and whether billing enforces, a boot warning when the
register is unreachable, and one line per gate refusal carrying the tenant and
the cents. It emits no metric of its own and imports no trace transport of its
own — tracing is the composer's, installed once at the root of every program.

The register-unreachable line is the one that matters. A plane whose store
cannot be read answers an honest GAP rather than an empty list, and the log line
is what lets an operator tell a tenant who holds nothing from a warehouse that
could not be asked.

### §8 Stage

`beta`. The manifest row declares it (`manifest/apps.go:270`, `Stage: Beta`),
so the plane is reached by flag until promoted (HIP-0139 §8).

### §9 Upstream

It derives from none: it forks nothing, embeds nothing and mirrors nothing. It
reaches the warehouse through cloud's one connection to it and mints its key
through the tenant package. No modelling, training or serving code is linked
into this app.

### §10 One writer, said plainly

Every read, every declaration and every disposal is a pure function of the
store and answers identically from any process. ADMISSION is not: the
one-scan-per-tenant slot and the in-process ceiling are this process's own map,
so N replicas are N ceilings, and two processes could admit one version's
materialisation between them — both would write rows under one number and the
register would keep whichever completion landed last.

This plane is therefore deployed as a SINGLE WRITER, and that is a deployment
fact stated here rather than a property claimed and not held. A durable lease is
the only thing that would make it a property, and a plane that runs at one
replica does not need one.

### §11 The boundary

Within the risk product, each plane owns one thing and the four do not overlap:
`risk` decides and learns, `label` is the answer key that arrives late,
`reference` is the lookup data a decision cannot derive, and this capability is
the record of what a model was fitted on. Ground truth and lookup sets are
capabilities of their own with their own stores (HIP-1046).

Against `/v1/ml`: that is the model-SERVING plane, with its own consumers. The
rows here feed a model that learns in-process from the org's own events and is
not served there, so these operations do not belong to it. The pull towards that
address is real enough that a test holds this one, rather than a convention.

## Rationale

The alternative to storing bytes is storing a spec and re-running it, which is
cheaper by one table and wrong by construction for the one question a dataset
exists to answer. The alternative to a per-tenant partition is a retention
policy on the table, which takes the retention decision away from the tenant it
belongs to.

The plane is its own app because it shares no state with a scorer: no model in
memory, no ring, no single-writer file. Every answer it gives is a function of
the store, so it restarts empty and a restart loses nothing but the jobs in
flight — which is exactly what a plane holding the record of what a model
trained on must do, and exactly what a process pinned to one replica for its
in-memory state cannot promise.

## Security Considerations

Four things a wrong implementation would give an attacker, and where each is
refused.

**Another tenant's training data.** The defence is that the wrong statement is
not expressible: every statement opens with a bound tenant predicate, the
predicate LEADS both tables' sort key and partition expression, and the value it
binds cannot be written as a literal or decoded from a body. A predicate that
opens with a time bound would filter across every tenant's rows — slower, and,
the half that matters, correct only by a term that is not first.

**An identifier of the caller's choosing.** Nothing caller-derived ever becomes
one. Table names are package constants, columns resolve through a fixed
allowlist, the kind is a closed set, and the tenant key, the dataset name, the
window, the seed and the caps all bind. Normalisation is total and is the only
way to obtain a spec, so every statement takes a normalised value.

**A rewritten citation.** A published version is `ready`, and the only rank
above it is `disposed` — the tenant's own retention decision, the one write that
may outrank a publication. No other stage can displace it, at the door or in the
engine. Version numbers are monotone and never reused, including across
disposal, because a citation that is ambiguous across time is not a citation.

**The warehouse itself.** The window, the maturity horizon, the row cap, the
number of names and the number of versions are all bounded at the door, and
every source scan is admitted through one priced gate — one per tenant, a fixed
ceiling in the process, each with its own deadline. The per-tenant limit alone
is not enough: a thousand tenants each holding their own single slot is still a
thousand concurrent scans of one stateful store, which is a fleet resource no
tenant owns. An unbounded, unpriced read wearing a GET is what both halves of
that gate exist to refuse.

The record itself is a compliance artefact: a dataset a model cited may have to
be produced years later against an adverse decision. That is why disposal marks
the register instead of deleting it, and why a disposed name continues its
version sequence rather than restarting it.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1046 — Risk

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
