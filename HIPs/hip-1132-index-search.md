---
hip: 1132
title: Index — Full-Text Search
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: index
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1132: Index — Full-Text Search

## Abstract

`/v1/index` is fast full-text search over a tenant's own data, typos forgiven: a
native-Go, multi-tenant index that speaks the Meilisearch REST dialect, in the
one cloud binary instead of a standalone search container. It is implemented in
`hanzoai/cloud` at `apps/index` (HIP-0106).

## Motivation

Hanzo Chat drives search through the `meilisearch@0.38` JS client. Speaking that
dialect means chat points `MEILI_HOST` at this surface and changes nothing. A
standalone Meilisearch is one global keyspace behind one master key, its own
process, its own volume; as a subsystem the index inherits per-org tenancy,
encryption at rest, and the platform's auth and observability instead of
running its own (`apps/index/index.go:1-15`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 One store, org column, no DDL

The store is one encrypted SQLite file — the deployment's own `index`, opened
through the one opener so it is born encrypted (`apps/index/store.go:67`). Every
org's indexes and documents share it; tenant isolation is the `org` column,
enforced on EVERY query. An index is a row, never a table: a standalone engine
mints a directory per index, but here `org` and `uid` are ordinary columns, so
an untrusted uid is stored verbatim instead of being sanitized into a table
name (`apps/index/store.go:40-48`).

The inverted index is an ordinary terms table rather than FTS5, because cloud
links the system SQLite for the real SQLCipher codec and that library ships no
fts5 module — an FTS5 dependency would pass its tests on the pure-Go build and
fail to create a table in the shipped binary (`apps/index/store.go:50-60`).

### §2 The address is a dialect

Seventeen operations under `/v1/index`: fourteen are typed ops
(`apps/index/typed.go`) and three carry the wire fact that keeps them out. The
dialect did not move when the fourteen were typed. Each model spells the map its
handler assembled, with its fields in alphabetical json-tag order because
encoding/json writes a map's keys sorted — so a typed answer is byte-identical
to the map it replaced rather than merely equal as JSON
(`TestTypedAnswersAreByteIdenticalToTheMaps`,
`apps/index/typed_wire_test.go:278`).

The errors are the harder half and did not move either. The JS client branches
on Meilisearch's `{message, code, type, link}` — `index_not_found` is how its
auto-create decides to fire (`apps/index/index.go:33-36`,
`apps/index/store.go:26-29`) — while zip renders a returned error as a flat
`{status, code, error}` carrying neither `message` nor a dialect `code`. So an
op returns a `*fault` holding the dialect body and one middleware writes it back
under its own status (`apps/index/typed.go:58-117`,
`TestTheDialectRefusalsSurviveTyping`). That is not an escape from typing: the
op still declares its `In` and its `Out`, so the route reaches the document, an
MCP tool, a CLI command and a generated SDK method — the four an untyped route
is invisible to.

Three stay untyped, and the reason is one fact about zip rather than anything
about search. The two document upserts and the delete-batch each take a
top-level JSON ARRAY as their body — `[doc,…]`, `[id,…]` — on a `:uid` route.
zip binds a path parameter by walking the input's struct fields, so a slice `In`
binds no uid at all, and a struct `In` is decoded with a call that fails on `[`,
turning today's 202 into a 400 on every write the JS client makes. Either half
alone is expressible — zip admits a bare list as a body — the pair is not. The
three declare their bodies through `openapi.Register` + `openapi.OneOf` instead,
so an SDK generated off the document no longer offers a document upload with
nowhere to put the documents (`apps/index/index.go:142-212`). The partition is a
closed ledger, each entry carrying its reason, and its two counts are pinned
(`apps/index/typed_wire_test.go:35-62`, `:172`).

Writes are synchronous — SQLite applies them before the response — so a reported
task is already `succeeded` and a client polling `waitForTask` resolves
immediately (`apps/index/index.go:51-56`).

### §3 Tenancy

The tenant is `principal.Org` — the org minted from the validated bearer owner
claim (HIP-0026), never a client-supplied header (`apps/index/typed.go:333`).
Two orgs MAY both hold an index named `messages` without seeing each other's
documents. Within an org, a caller narrows to an end user with an ordinary
`user = "<id>"` filter, honoured as the dialect defines it.

### §4 The internal plane: asked, not opened

The file has one writer (`MaxOpenConns(1)`), so a second process opening it is
the collision, not the cure. Other apps ask instead: `index/query` and
`index/reconcile` on the internal plane (`apps/index/rpc.go:47-54`), where the
org is the caller's own and never an input. The reconcile op exists because the
silent half of a split fleet broke first: the corpus swap ran in a process whose
store global was nil, logged a warning, and left the catalog honestly empty — a
silent write failure outlives a loud read failure
(`apps/index/rpc.go:6-33`).

### §5 Money, events, observability, stage, upstream

Free (`cloud.Free`, `plugin/index/main.go`). It publishes nothing on the bus and
emits nothing beyond the request span every route gets. Stage `ga`: it is the
data core's search plane. It derives from no upstream code — it implements the
Meilisearch REST dialect as wire compatibility and embeds nothing of
Meilisearch itself.

## Rationale

The alternative to the dialect is a native typed search API, which would be
cleaner in the document and would orphan every existing Meilisearch client on
day one. The alternative to one file with an org column is a file per org, as
kms chose; the index chose the column because an index is queried across many
small collections where per-org files buy little, and the store's every query
already carries the predicate — the tradeoff is stated rather than hidden, and
the security section owns its cost.

## Security Considerations

One file for all tenants means the org predicate is the isolation, and a query
that forgets it reads every tenant's documents; the predicate lives in the store
layer so handlers cannot omit it. The dialect's error fidelity is also a
disclosure rule: `index_not_found` for another org's uid is indistinguishable
from one that never existed, so the surface is not an existence oracle. On the
internal plane the org travels with the call, never the input — a process that
asks can only ask as itself.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
