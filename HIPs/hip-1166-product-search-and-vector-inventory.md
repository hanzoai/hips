---
hip: 1166
title: Product — Search and Vector Inventory
author: Hanzo AI
type: Standards Track
category: Core
capability: product
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0135, HIP-0139
---

# HIP-1166: Product — Search and Vector Inventory

## Abstract

Product is the read-only inventory of the search and vector backends:
`/v1/search/{indexes,stats}` read from Meilisearch and
`/v1/vector/{collections,stats}` from Qdrant, reshaped into the rows the console
renders. It reimplements no search or vector logic, holds no index or collection
state, and resolves no tenant. It is implemented in `hanzoai/cloud` at
`apps/product` (HIP-0106).

## Motivation

A console panel that shows what exists in the two shared retrieval stores needs
one answer with one shape. The alternative is the console reaching two services
directly, which puts two credentials in a browser-facing tier and makes the
panel's shape a function of whichever version each service happens to run.
Translating the shape once, server-side, is the whole job.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store it owns

None, and none is possible: every answer is a fresh read of an upstream service,
reshaped and returned. Nothing is cached, so there is no copy here that can be
stale, and a restart loses nothing.

### §2 The addresses

Four operations, all reads, all typed — there is no declared-untyped operation
on this surface. `GET /v1/search/indexes` lists the indexes with their document
counts and timestamps; `GET /v1/search/stats` totals the documents across them;
`GET /v1/vector/collections` lists the collections with their size and geometry;
`GET /v1/vector/stats` totals the collections, vectors and storage.

The credential is a typed input FIELD on every one of them, not middleware, and
that is deliberate twice over. A header declared on the input appears in the
document, in the command flag and in the tool schema, instead of being smuggled
past every projection. And a key check hung on either subtree would have gated
the neighbouring capabilities that own those roots — the confinement check
refuses that composition, correctly.

This capability answers at two top-level addresses and serves nothing under
`/v1/product`. Both pairs are carried by cloud's `openapi/misfiled.txt`. Because
the routes are deeper than the neighbours' roots, the manifest row MUST
enumerate the four exact prefixes: the `/v1/<name>` default would guard a path
this capability does not serve, which leaves the subsystem's own middleware
installed where no request arrives and every request here attributed to no
subsystem at all. §4 says where the pairs close.

### §3 Tenancy

There is none, and that is the fact this specification exists to state. No
operation here resolves an org, a user or a project. The credential is the
surface's own bearer, compared in constant time against the configured upstream
key: an unset key answers 503, a wrong key 401, and the two keys are never
crossed — the search bearer never admits a vector read.

The consequence is normative. Every answer here is fleet-wide: the index names,
document counts, collection geometry and totals of the two SHARED stores, across
every tenant that holds anything in them. So:

1. No response on this surface MAY carry a datum scoped to one customer. A
   per-customer answer has a tenant, and a surface with no tenant cannot check
   one.
2. A customer asking what THEY hold in those stores is asking a different
   question with a different answer, and it is already served, org-scoped, at
   `GET /v1/instances/search` and `GET /v1/instances/vector` (HIP-1164).

### §4 The audience, and where the pairs close

These four reads are the OPERATOR's view (HIP-0135), not a customer method. They
answer for the fleet, they authenticate with a deployment credential rather than
an IAM claim, and the panel they feed is the operator console's.

HIP-0139 §3.2 fixes where an operator view lives — the `/v1/admin` family,
served by the capability itself, dropped from the public projection by address —
and HIP-0139's own Security Considerations name this exact shape as the concrete
defect: an operator surface offered as a customer method because the address
said the product's name before it said whose view it was. So the two misfiled
pairs MUST close by moving these reads to that depth, never by alias, and until
they do the surface MUST hold the fleet-wide answers behind the deployment
credential and MUST NOT grow a fifth route on the customer side of the line.

### §5 Money

Free. The plugin declares `cloud.Free` (`plugin/product/main.go`). Nothing here
gates on balance and nothing debits a ledger.

### §6 Events

It publishes nothing on the bus; a customer's webhooks receive no `product.*`
events.

### §7 Observability

Beyond the request span every route gets, one warning log line per unreachable
upstream, and the mount line naming the two configured endpoints and whether
each key is set. It emits no metric of its own.

That log line carries real weight, because of the degrade rule these reads
follow: an unreachable upstream answers 200 with an EMPTY list, so a panel shows
an honest empty state instead of an error. The emptiness of the answer therefore
does not distinguish "the store holds nothing" from "the store could not be
read" — the log line is the only thing that does, and it MUST be emitted on
every degraded read for that reason.

### §8 Stage

`ga`. The manifest row declares no stage, and absent is `ga` (HIP-0139 §8).

### §9 Upstream

It derives from none: it forks nothing, embeds nothing and mirrors nothing. It
dials two services over their own HTTP APIs and translates their replies. No
retrieval or ranking code is linked into this app.

### §10 The boundary: four capabilities, four verbs

This is the capability a reader is most likely to confuse with its neighbours,
so the split is stated flatly. Four capabilities touch indexes and collections,
and each owns exactly one verb:

| verb | capability | address |
|---|---|---|
| allocate an index or a collection | `provisioning` (HIP-1164) | `/v1/instances/search`, `/v1/instances/vector` |
| write and query one org's documents | `index` (HIP-1132) | `/v1/index` |
| rank one answer across the retrieval stores | `search` (HIP-1147) | `POST /v1/search` |
| count what exists in the two shared stores | `product` | the four reads in §2 |

Two of those distinctions are easy to lose and are worth spelling out. `index`
is a per-org store INSIDE the cloud binary, tenant-isolated by an org predicate
on every query; the store this capability counts is the separate shared service
that `provisioning` allocates in. And `search` fuses retrieval into a ranked
result set — it owns no store either, but it answers for ONE org, resolved from
a validated claim, which is precisely what this capability does not do.

A capability that cannot say which verb it owns has not earned a prefix. This
one owns "count", and only that.

### §11 What a wrong implementation gives an attacker

The shape of every tenant's corpus from one unauthenticated GET: how many
indexes exist, what they are named, how many documents each holds, how many
vectors and of what geometry. Names on a shared store are derived from an org,
so a listing is also a census of who is on the platform and how much they have
put there.

Two facts prevent it, and both must hold. The compare is constant time, so the
key cannot be recovered a byte at a time. And an unset key fails CLOSED with
503 — a mis-provisioned deployment must never serve this surface open, which is
the failure a "no key configured means no check" reading would produce.

The degrade rule must stay one-directional: an unreachable upstream answers
empty. It must never answer with a cached, partial or substituted body, because
the only thing worse than an empty inventory is one that is somebody else's.

## Rationale

A shape-translating read with no state is a small thing to specify and an easy
thing to file wrong, which is exactly what happened to its address. The honest
description — a fleet-wide operator read behind a deployment credential — is
what settles both questions at once: what it is, and which side of the public
line it belongs on. Writing that down is worth more than the four handlers it
describes.

## Security Considerations

The credential is the entire boundary; there is no second check behind it, and
no tenant scope to fall back on. That is acceptable only for an operator surface
and is the argument in §4 restated from the attacker's side: the same four
handlers, reached by the wrong audience, are a platform census.

Two keys are configured and each admits exactly one upstream. Collapsing them
into one would make a leaked search credential a vector credential, for no gain
beyond one fewer environment variable.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0135 — What Is Public
- HIP-0139 — Capability
- HIP-1132 — Index — Full-Text Search
- HIP-1147 — Search — Hybrid Retrieval
- HIP-1164 — Provisioning — Stores on Demand

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
