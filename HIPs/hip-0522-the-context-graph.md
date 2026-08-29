---
hip: 0522
title: The Context Graph — Edges, Decisions and Derivation as One Noun
author: Hanzo AI Team
type: Standards Track
category: Core
status: Final
created: 2026-08-20
requires: HIP-0106
---


# HIP-0522: The Context Graph — Edges, Decisions and Derivation as One Noun

## Abstract

An agent that decides things has to be able to answer *why* months later. Cloud
records enough to answer it and cannot: the facts are there, the relationships
between them are not.

Three of the pieces already exist and are load-bearing:

```
  audit/          who did what to what, hash-chained, tamper-evident
  apps/o11y       what happened: event.fact, gen_ai spans, trace/session ids
  knowledge+search  what is similar to this: KB pages, embeddings, vectors
```

What no app holds is an **edge**. Measured across 144 apps: nothing stores
entities-and-relations. `apps/knowledge` is pages plus embeddings — similarity
without traversal. So every question of the form "what did this come from",
"what did it lead to", "has this been decided before" is re-derived per query,
by a model, from prose.

This HIP adds ONE noun — the graph — and expresses provenance, decisions and
explanation as **views over it** rather than as three more subsystems. It adds
no store that duplicates a fact another app already owns.

## Motivation

The question a regulated customer asks is not "what did the model output" but
"why did this happen, and what else did it touch". Cloud can answer the first
today and cannot answer the second, because the second is a traversal and there
is nothing to traverse.

The cost of the absence is paid three ways. A decision's causes are reconstructed
by a model reading prose, which is the least reliable way to answer a question the
system already has the facts for. The same decision is recorded in four different
shapes by four apps, so nothing can ask about decisions as a class. And a
derivation — this figure came from that document, which came from that ingest —
exists only as separate rows nobody joined.

Adding a graph is the smallest change that turns those into reads. It is worth
doing as ONE noun rather than as provenance, decisions and explanation
separately, because those three are the same walk over the same edges wearing
different names — and building them apart is how an estate ends up with three
stores that disagree about one history.

## Specification

### The primitive: entities and edges, per tenant

```
  entity(id, kind, key, attrs, valid_from, valid_to)
  edge(src, rel, dst, attrs, observed_at, valid_from, valid_to)
```

Two tables in the org's own SQLite, the default store every other app uses
(HIP-0106). An edge is a row; a traversal is a recursive CTE. Nothing here needs
a graph database, and adding one before the tables are the bottleneck would be a
second storage engine for a workload that has not yet measured itself.

`valid_from` / `valid_to` carry validity separately from `observed_at`, so
"what did we believe on the 3rd" and "what was true on the 3rd" are different
questions with different answers. That is the whole of temporality; there is no
snapshot mechanism beside it.

### Decisions are a node kind, not a subsystem

Cloud already records decisions in at least four shapes — the risk verdict
(`{ID, Action, Score, Cause}`, whose refusal quotes the id so support can fetch
the judgement), the abuse gate's hold, `Standing`, and the spend gate. Each is
correct and none can answer "what else did this decision cause".

A decision is an entity of kind `decision`. Causation is edges:

```
  triggers   enables   causes   precedes
```

Three operations, and they are the whole surface:

```
  POST /v1/graph/decisions            record one, get its id
  POST /v1/graph/edges                link two
  GET  /v1/graph/decisions/{id}/why   the chain that produced it
```

`why` is a walk. Impact is the same walk outward. Precedent search is the
EXISTING vector index over decision nodes — retrieval cloud already has, pointed
at a new node kind rather than reimplemented.

The four existing decision shapes are not migrated by this HIP. They emit a
decision node beside the answer they already give; the shapes stay where they
are until something needs them unified, and that is a separate change with its
own reason.

### Provenance is a PROJECTION, never a second store

`audit.Record` is already a PROV-O activity and nobody noticed:

```
  Actor    → prov:Agent        wasAssociatedWith
  Action   → prov:Activity     startedAtTime / endedAtTime
  Resource → prov:Entity       used / wasGeneratedBy
  Before/After                 wasRevisionOf
```

It is hash-chained, so it can prove it was not edited after the fact — which is
the property a regulator asks for and the one a rebuilt provenance store would
lose. Therefore provenance is an **export**, computed from audit plus the graph:

```
  GET /v1/graph/provenance?resource=…&format=prov-o|json-ld|csv
```

A second store holding the same facts would be a second answer to one question,
free to drift from the chain that can prove itself. This HIP forbids it.

### Explanation is the path, not a feature

A rule engine over the graph returns the edges it walked. That IS the
explanation — there is no separate rationale to generate, and nothing a model
has to narrate after the fact. A result a caller cannot trace is a result this
plane does not return.

Deterministic evaluation only: forward chaining over the edge table. Anything
that cannot be answered by a walk is not a graph question and belongs to `ai`.

### Why this reaches every SDK for free

`GET /v1/openapi.json` is a projection of the live router and the single source
for every generated SDK (HIP-0106). Typed ops in one app therefore arrive in
Python, TypeScript, Rust, Go, the MCP tool list and the CLI from the document,
with no per-language work and no possibility of one language lagging another.

This is the whole reason the capability is an APP and not a library: a library
would have to be ported N times and would drift N ways.

### What this deliberately does not do

- **No ontology engine.** Entity kinds are typed by the schema the app declares.
  OWL/SHACL/SKOS is a separate decision with its own HIP if a customer needs W3C
  validation rather than a typed schema.
- **No extraction pipeline.** Turning documents into entities is `ai`'s job —
  NER, relation and event extraction are model work, and this plane stores what
  that work produces rather than reimplementing it.
- **No graph analytics.** Centrality and community detection are read-side
  analysis over the same tables, addable when something needs them. Shipping
  them first would be a feature nobody asked for on a store with no data in it.

## Security Considerations

The graph is per-org, in the org's own store, reached through the identity the
edge already minted (HIP-0519). There is no cross-tenant read: an edge whose
`src` and `dst` are in one org cannot name a node in another, because the store
is the boundary rather than a filter on a shared table.

**Provenance export is a disclosure surface.** It renders audit facts — actors,
resources, before/after — so it takes the SAME admission as the audit read it
projects, never a weaker one. An export that is easier to reach than the records
it exports is a way around the audit gate.

The chain stays the authority. If the graph and the audit chain disagree about
what happened, the chain is right: it is the copy that can prove it was not
edited. The graph is an index over facts, never their origin.

## References

- HIP-0106 — one binary, apps as plugins, the document as the SDK source
- HIP-0519 — the one identity boundary
- W3C PROV-O — the provenance vocabulary the export renders

## Copyright

Copyright and related rights waived via CC0.
