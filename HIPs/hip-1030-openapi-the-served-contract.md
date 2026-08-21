---
hip: 1030
title: OpenAPI — The Served Contract
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Active
created: 2026-08-20
requires: HIP-0119, HIP-0122, HIP-0128, HIP-0135, HIP-0139
capability: openapi
---

# HIP-1030: OpenAPI — The Served Contract

## Abstract

`/v1/openapi.json` is the API describing itself. It is not an authored file that
someone remembers to update: it is a **projection of the routers that answer**,
emitted by the `openapi` package in `hanzoai/cloud` and served by the host that
owns the front door.

Everything a client touches is downstream of it — the published SDKs, the `hanzo`
CLI, the MCP tool list, the command projection (§7) and the docs site. This
HIP fixes what the document is allowed to claim, who may read it, and which
inconsistencies are refused rather than published.

## Motivation

Two failures, both measured, both invisible while green.

An authored description drifts from the router that serves. `hanzoai/openapi`
used to merge hand-written `<svc>/openapi.yaml` files with the emitted
document. At the release pinned in that repo's `publish.py` header — which
records the measurement and the command that took it — the authored master both
carried operations nothing served and missed operations that were served.
An operation nobody serves is not an inert placeholder — it becomes a method in
every SDK and an instruction to an agent to call a dead address.

An unclaimed address is not unclaimed; it is claimed by the wrong thing. Before
the host registered this path, it fell through to the one prefix that covered it
and was answered by a child reading its OWN router — a few kilobytes describing
that child's health and catch-all routes, `200 OK`, read by every generator
(`cmd/cloud/main.go:741`).

Both say the same thing: **the description must be produced by the thing being
described, and must state its own provenance exactly.**

## Specification

The key words MUST, MUST NOT, SHOULD and MAY are to be interpreted as in
RFC 2119.

### §1 Address and audience

The canonical address is `/v1/openapi.json` (`openapi/openapi.go:75`). House law
applies: `/v1/` only, no `/api/` prefix, and never a `v2` — the document's own
shape is versioned by its `openapi` field, and the API's by `/v1`.

`/.well-known/openapi.json` MUST be an ALIAS answered from the same render
(`openapi/openapi.go:101`), never a second document. A client that has never seen
this API probes the reserved address first; two addresses that could describe
different APIs is the defect.

The document MUST be readable without a credential, and MUST NOT vary by caller.
A client has to be able to read a contract before it holds a token, and a list of
operations grants nothing: every route named stays individually authorized.

### §2 Provenance, and the limits of it

A document MUST be a projection of a router, never a registry of paths kept
beside one. Within one app that is literal — the spec is read from the assembled
router, so a route composed at runtime (`Group(...).Post(...)`) is described and
a path no grep can find is not missed.

**That guarantee ends at the app**, and the document MUST say so. The host mounts
no subsystem: what it serves is woven from the subsets each app binary projected
when it was BUILT. So the published `description` states exactly that each
operation is a route the subsystem publishing it registered, and claims nothing
about the deployed front door delivering that path to that subsystem
(`openapi/fleet.go`, `fleetInfo`). A false provenance is worse than a missing one
because it is READ: downstream tooling has quoted this sentence as its own
correctness argument.

Freshness is therefore a separate obligation, not an inference. The subsets are
committed and regenerated from source by `mk/fleet.mk check`, which fails on any
diff. A missing subset MUST be refused, never skipped — skipping publishes a
document with one app's whole surface silently absent, which has happened: the
routes lost that way, and the run that lost them, are named in
`openapi/floor.go`.

### §3 Every operation says what it does

An operation with an address and no sentence MUST fail emission
(`openapi/prose.go`). The sentence has ONE home — the Go doc comment on the
handler, lifted at build time — because that text becomes the SDK docstring, the
MCP tool description and the CLI help. A route whose wire stays untyped declares
its prose beside the route with `Describe`. Nothing downstream can supply it.

### §4 The customer projection is derived, never curated

The public document is the same document minus what its operations' own
addresses exclude: not under `/v1/`, the operator product `/v1/admin/*`, a relay
wildcard, or a legacy spelling tagged `Compat` (`openapi/public.go:74`). There is
no allowlist, so a product launched next month is public the day it answers.

A whitelist was tried and is refused. A handful of operations were declared
public by hand while most products — commerce, git, observability, the cap table
— stayed out of every generated client, and those clients read the internal
document instead. A whitelist nothing reads is a statement of intent.

The projection MUST refuse to emit an empty document, and MUST refuse a `$ref`
naming a component the document does not define. Both are broken documents; the
difference is whether they break here, naming the operation, or inside whichever
generator meets them first.

### §5 A surface may grow and MUST NOT shrink quietly

Two committed ratchets hold the document against its own past, because every
other check compares two derived artifacts that can agree while both are wrong:

- `openapi/floor.json` — operation counts per product. A regeneration under any
  of them fails and writes nothing. Lowering it is an EDIT in the commit that
  deletes the routes, where the number goes down beside the reason.
- `openapi/unreachable.txt` — addresses the document publishes that the deployed
  API does not route. A new dark address fails; a line that starts answering is
  deleted in the same commit.

Counts per product rather than in total, because totals net out: a run that lost
one product's entire surface added enough elsewhere to keep the total rising.

### §6 What the capability owns, meters and emits

This capability **owns no store**. The document is a render of the routers;
what is committed — `openapi.yaml`, `public.yaml`, each `plugin/<app>/openapi.json`
subset, the two ratchet files of §5 — is artifact, not state, regenerated from
source and verified byte-for-byte. There is nothing to migrate and nothing a
backup could lose that a rebuild does not produce.

A request never becomes a tenant here: the document is served without a
credential and does not vary by caller (§1), so there is no claim to read and
nothing to refuse but a write — and there are no writes.

Reading the document is **free**, said in those words: the serving code is the
`openapi` package linked into the host, and no meter sits on the path. The
capability publishes **no events** on the bus — a regeneration is a commit,
not a runtime fact — and emits nothing to observability beyond the request
span the route already gets.

Stage is **ga**: the document is the mechanism by which every other
capability's stage is projected (HIP-0139 §8.1 — the weave stamps `x-stage`
and the public rule reads it), so it cannot itself be behind a flag.

It derives from **no OSS upstream**: it implements the OpenAPI 3.x
specification, which is a document format, and forks, embeds or mirrors no
project's code.

### §7 Refused

- A second route registry. Bodies and prose are registered; paths never are, and
  a declaration renders only on a route the router carries.
- Hand-authoring an operation into a published subset. One was, by copying a
  neighbouring block, and two paths then claimed one `operationId`.
- Filtering the document by caller. See HIP-1031 §3 — permission is a fact about
  a decoded input, not about an operation.
- A `v2` of this address.

## Rationale

The obvious alternative is a spec repository that OWNS the description and that
services conform to. It was the arrangement here, and it inverts the dependency:
the file is edited by whoever remembers, the router by whoever ships, and the
gap between them is discovered by a customer. Keeping a downstream projection
(`hanzoai/openapi`'s `hanzo.yaml`) is fine and is what happens — but it may only
make the one document generatable: never add an operation, never drop a served
one, never invent prose.

## Security Considerations

Publishing the map is safe only because it is exactly a map. Every operation
remains individually authorized, and no route may rely on its absence from a
document for protection — a document that varies by caller would be that
reliance, written down.

The operator surface stays out of the customer document by ADDRESS
(`/v1/admin/*`), so a new operator route is excluded the day it exists rather
than the day someone remembers the list. It remains served, and remains
described in the internal document, because concealment is not the mechanism —
authorization is.

Overstated provenance is a security problem, not only a hygiene one: a consumer
that believes the document proves a route is mounted will drop operations,
skip probes, or trust an address the front door never delivers.

## References

- HIP-0119 — Hanzo Service Conventions
- HIP-0122 — zip/zap Native Application Server
- HIP-0128 — Resource Surface Standard
- HIP-0135 — What Is Public
- HIP-1031 — Commands — The Callable Projection

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
