---
hip: 1198
title: Graph — The Assertion Plane
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: graph
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139, HIP-0140
---

# HIP-1198: Graph — The Assertion Plane

## Abstract

`/v1/graph` is one organization's entities and the relations between them, held
as assertions: somebody, at some moment, from some evidence, asserted that this
thing stands in that relation to that other thing. It is implemented in
`hanzoai/cloud` at `apps/graph`.

Five operations answer today. They are served behind the flag named for the
capability and are in no public document — the stage is `alpha`
(`manifest/apps.go`), so no generated client, tool list, command group or public
page carries them. What is proposed here is the boundary that keeps this plane
and knowledge's renderer from both owning nodes and edges (§1), the retention
this capability does not yet have (§7), and the engine `github.com/hanzoai/graph`,
which is forked and not linked into the served binary (§8).

## Motivation

`GET /v1/knowledge/graph` already returns nodes and edges, and it is public. A
second capability that also stores nodes and edges is the expensive mistake
available here: two shapes for one word, two stores a customer has to reconcile,
and an edge that can disagree with itself depending on which address answered.

The two are not the same thing, and the difference is not size. Knowledge's graph
is a projection of documents the tenant already holds — a page's parent field, a
wikilink's target, a source's connector — computed at read and stored nowhere.
What has no owner anywhere in the binary is the other kind of edge: the one
somebody asserted. Who said so, when it became knowable, what disagreed with it,
and what the answer was last Tuesday are four questions a projection cannot be
asked, because the rows that would answer them were never written.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The boundary against knowledge

One test decides which side a responsibility falls on: **is the edge already
written in a record the tenant holds, or did somebody claim it?**

An edge that is a projection of a record its owner already holds MUST be computed
at read by that owner, and MUST NOT be asserted here as a second copy. A page's
parent, a wikilink and a source's connector are all written inside the document
they belong to; storing them again makes a copy free to disagree with the
document, and read-time resolution is what lets a rename or a deletion need no
edge rewrite. That is knowledge's half (HIP-1260), and `apps/knowledge/graph.go`
computes it without a store of its own, degrading to an empty graph rather than a
5xx when the documents cannot be read.

An edge that is a claim cannot be computed from anything, because nothing else in
the binary holds who claimed it. That is this capability's half, with the three
properties a claim carries and a projection does not: provenance, a time axis,
and a conflict that stays visible.

The division that follows:

| responsibility | owner | why |
|---|---|---|
| documents, titles, slugs, wikilink resolution | `knowledge` | the record is the document; the edge is a field of it |
| render shape — force-directed nodes, placeholders for unresolved links | `knowledge` | a view of a document set, recomputed each read |
| who asserted, from what evidence, under which identity | `graph` | not derivable from any record |
| when an assertion became knowable, and reads bounded to an instant | `graph` | a projection has one tense |
| disagreement between two sources about one relation | `graph` | a projection cannot hold two answers |
| identity resolution — `same` asserted and then settled | `graph` | a claim about two keys, not a field of either |

`graph` MUST NOT store documents, resolve titles or slugs, or emit render
coordinates. `knowledge` MUST NOT persist a node or edge table. Neither imports
the other; nothing in `hanzoai/cloud` imports `apps/graph` except
`plugin/graph/main.go`.

### §2 The model

An entity exists because something was asserted about it. There is no node table,
no create and no cascade delete — nothing to keep in step with anything. An
**edge** is an assertion whose value names another entity; a **property** is an
assertion whose value is a scalar. They are one thing, stored once, and `names`
is the one bit that tells them apart, which is why a walk can read only the edges
without guessing at the shape of a value.

A **retraction is an assertion**. There is no UPDATE statement in the package and
no DELETE outside disposal.

That is the primitive because of what a reader can then do: see that something
was retracted, rather than find that it is gone. The distinction is the whole
product. An upsert-by-id graph answers "X has no owner" identically whether
nobody ever said so, somebody said so and withdrew it, or two sources disagreed
and the later write won — and it cannot be asked which afterwards, because the
rows that would tell the difference were never written. Provenance is columns,
point-in-time is the derived instant, and conflict is the shared order. None of
them is a subsystem, and none of them can be added later to a store that
overwrites.

What it costs, plainly:

1. **A read is a resolution, not a lookup.** Answering what is in force about one
   (entity, relation) means selecting every assertion for the pair, ordering it,
   and returning the winner with the losers beside it. There is no single row to
   point at, and there is no index that makes one.
2. **The table only grows.** Redelivering an identical assertion is free — it
   collides on its content address and is counted as a duplicate, not refused —
   but a correction is a row and a re-assert differing in any field is a row.
   §7 is the consequence.
3. **There is no referential integrity**, because entities are not rows. An edge
   may name a key nothing was ever asserted about, and a walk will reach it. That
   is not an error and it is not detectable at write time.
4. **Erasure is not expressible as an assertion.** A retraction withdraws a claim;
   it does not remove what was said. Removal is disposal, which sits outside the
   model with the litigation hold — and the hold is a fact about the record rather
   than about the world, which is why it is outside the content address.

### §3 The address

Every route is under `/v1/graph` and every operation is typed; none is declared
with prose. None of them is in the public document, by §7.

| operation | method and path | answers |
|---|---|---|
| `graphAssert` | `POST /v1/graph` | records a batch of assertions |
| `graphRead` | `GET /v1/graph` | the assertions matching entity, relation, value and an instant |
| `graphResolve` | `POST /v1/graph/resolve` | what is in force about one (entity, relation) at an instant, and what disagreed |
| `graphNeighbors` | `POST /v1/graph/neighbors` | a bounded walk of the edges from a seed set |
| `graphVocabulary` | `GET /v1/graph/vocabulary` | the relations in use and the terms of the order |

Three behaviours are part of the contract rather than of the implementation.

**A batch is judged member by member.** `recorded + duplicate + refused` equals
what was sent, and the refusals come back in the order sent, so a caller
redelivering five assertions does not lose four to one malformed fifth.

**The walk's bound is in the answer.** A traversal is capped at 10,000 nodes and
the response carries both the ceiling and whether it was reached. A caller is told
the walk truncated rather than handed a short answer that looks complete. The
bound is not politeness: the tenant's store holds one connection, so an unbounded
recursion blocks every other write for that organization for as long as it runs.

**The vocabulary is emergent.** The relations a tenant has asserted are the only
ontology there is; nothing declares one in advance and there is no schema store.
The same response publishes the terms of the precedence order, because a reader
who is told a winner without the rule cannot check it.

### §4 The store

One SQLite table, `assertion`, per organization, opened through `cloud.OrgStore`
under the name `graph`, so another organization's assertions are not in the
database being read and no predicate can be forgotten. Two indexes carry the two
directions a walk reads: `(entity, relation)` outward and `(value, relation)`
inward. The store's own sequence is `AUTOINCREMENT` rather than a bare rowid,
because a bare rowid is reused after the top row is deleted and would restart
below a cursor that had already advanced.

A walk is a recursive query over the rows where `names` is set, bounded by
`knowable <= ?`. Point-in-time is therefore not a second code path: the same
seeds at a past instant answer what the graph looked like then.

Bounds are asked once, at the door, on every caller-sized value — 512 bytes
of entity, 128 of relation, 2048 of value (512 when it names an entity) and 512
of evidence. With those asked, `count × max` is the byte bound of everything
below, which a count over caller-sized values would not be.

The algebra is not in this package. The derived instant, the content address, the
skew bound and the total order are `cloud/claim`, shared with the ground-truth
plane (HIP-1261), so the binary holds one answer to "somebody asserted something
about a thing" rather than two that drift. This capability contributes the
vocabulary, the bounds and the store, which is all a caller of that algebra is
meant to contribute.

The order's adjudication weight is constant here, and that is a claim made
deliberately: this plane ranks no source above another, so it asserts no weight
and the order falls through to its remaining terms — later knowable, higher
confidence, lower digest. It stays total and it stays reproducible.

### §5 Tenant

The organization comes from the validated principal and from nothing else. No
route carries an org field, and a request without a principal is refused with
403 before any store is opened. The per-org file makes a cross-tenant read
unspellable rather than merely forbidden.

The filing identity — `owner`, or `owner/user` when the request carries one — is
stamped server-side from the same principal and never taken from the body. It is
part of the content address, so two identities asserting the identical thing are
two rows, not one.

### §6 Money, events, observability

The capability is **free**, in those words (`plugin/graph/main.go`,
`Price: cloud.Free`). It meters nothing and no debit lands anywhere.

It publishes nothing on the bus. No `graph.*` event reaches a customer's
webhooks.

Beyond the request span every route already gets, it registers no metric and
writes no per-request log line. The two structured lines it writes are at mount:
one recording that the plane came up, one recording that the router exposed no
op registry — which is a refusal to serve routes no projection would know about,
not a warning.

### §7 Stage

`alpha`, declared in the manifest row, reached by the flag named `graph`.

Retention is what it is waiting on, and §2's second cost is why. The record
carries a litigation hold column, no operation moves it, and disposal has no
address — so a tenant can put assertions in and cannot take a class of them out.
A plane that only grows and cannot be swept is not a plane a customer should be
let into for good. Promotion to `beta` requires an operation that expresses the
tenant's own disposal decision and a hold that outranks it; promotion to `ga` is
HIP-0140 §4.

### §8 Upstream

The served surface embeds no third-party engine: its store is SQLite through
`cloud.OrgDB`, and `hanzoai/cloud` does not require `hanzoai/graph`.

The capability forks one project. **`github.com/hanzoai/graph`** derives from
Dgraph (`github.com/dgraph-io/dgraph`, Apache-2.0), taken at `64804bd2`, with the
upstream notice preserved.

What survives in HEAD: eighteen packages, 99 Go files outside tests and 44 test
files, 38,815 and 13,791 lines respectively. The posting-list engine (`posting`,
6,588), the DQL parser (`dql`, 5,165), the tokenizer and index system (`tok`,
4,086), the type system (`types`, 2,860), the schema layer (`schema`, 1,902), the
UID set algebra (`algo`, 1,242), the posting codec (`codec`, 684), the lexer
(`lex`, 500) and the build stamp (`buildvars`, 450), over the shared key layout
(`x`, 7,473) and the generated wire types (`protos`, 7,865, of which `pb.pb.go`
is 7,850).

What does not survive: the cluster half and the server. There is no `worker`,
`query`, `edgraph`, `graphql`, `raftwal`, `conn` or `ee` directory, and the two
`package main` files in the tree are a codec benchmark and the build-stamp tool,
so the fork builds no server. One consequence is worth stating rather than
discovering: `dql` parses a query into an AST that nothing reads — no file
outside the package imports it — so what the tree offers today is key-addressed
access, index seeks and set algebra, not traversal, filters or response shaping.
There is no timestamp allocator either; a host opens the store in managed mode
and supplies its own commit timestamps.

Storage is **`github.com/luxfi/zapdb`** (Apache-2.0), a Badger fork, which
`hanzoai/cloud` already requires at v1.10.6.

One measured fact sets the order of work between the fork and any use of it here.
The generated descriptor names three message dependencies from Badger's own
protobuf package (`protos/pb/pb.pb.go:7119`, `:7122`, `:7123`) and binds that
package to `github.com/luxfi/zapdb/pb` (`:19`), whose default build defines `KV`
as a plain struct with no `ProtoReflect` method (`pb/types_zap.go`,
`//go:build !grpc`). The file descriptor cannot resolve, and both paths marshal
through it — the write at `posting/list.go:976`, the read at
`posting/mvcc.go:634`. The three fields belong to Raft proposals and stream
subscription, which the reduced tree does not use, so what the fields describe is
already gone and the descriptor is what still names them.

## Rationale

The alternative to assertions is a mutable node/edge store keyed by id. It is
easier to write, faster to read, and it forecloses the four questions in §2 the
moment the first upsert lands, because the losing row is not kept anywhere. A
plane whose product is provenance cannot be built on a store that overwrites.

The alternative to a separate capability is putting the assertions in knowledge,
beside the documents. That braids two shapes with opposite rules: knowledge's
graph must never be persisted, an assertion must never be recomputed, and one
store cannot enforce both. Keeping them apart is what lets a placeholder for an
unresolved wikilink stay a render artifact instead of becoming a row somebody has
to reconcile.

A recursive query over one indexed table is the right store for reads that are
one-entity resolutions and shallow bounded walks, which is what the five
operations are. The fork exists for the reads that are not — deep traversal with
filters and response shaping — and §8 says what stands between it and being
linked.

## Security Considerations

What an attacker gets from the wrong implementation, in the order the mistakes
are easy to make.

**A tenant resolved from anything but the principal** hands one organization's
whole assertion plane to another. The tenant is a file, not a predicate: the rows
are not in the database being read, so there is no query to forget a clause in.

**A filing identity taken from the body** turns a plane whose product is
provenance into one that certifies whatever the caller typed. An attributable
record whose attribution the caller chose is not attributable.

**An as-of read bounded by the filer's own `seen`** is backdating: file today,
claim it was knowable a year ago, and every horizon in the plane becomes
decorative. The bound must be the derived instant — the later of the filer's
claim and the server clock at the write — because a guard whose only input is a
caller-declared value is exactly as strong as the caller's honesty.

**A missing skew bound** lets one timestamp far ahead of the server clock sit in
the store, never maturing and distorting every read until it does.

**An unbounded walk** is a denial of service against the tenant rather than a
slow request: one connection per file means the recursion holds every other write
for that organization. Publishing the ceiling with the answer is what keeps a
truncated walk visible instead of a short read that looks complete.

**An UPDATE or a DELETE** resolves a contested relation into silence and makes a
retraction indistinguishable from an erasure — the one distinction this
capability exists to keep.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-0140 — Proposing a Capability
- HIP-1260 — Knowledge — Wiki and Agent Memory
- HIP-1261 — Label — Ground Truth

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
