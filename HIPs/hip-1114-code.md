---
hip: 1114
title: Code — Search and Symbols
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: code
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0139, HIP-0302
---

# HIP-1114: Code — Search and Symbols

## Abstract

`/v1/code` is search and symbols across an org's repositories, for people and
for their agents: a per-org code-intelligence engine implemented in
`hanzoai/cloud` `apps/code`. Retrieval is hybrid — lexical, symbolic and
semantic tiers fused with reciprocal-rank fusion — because embeddings alone
under-serve code search (`apps/code/code.go:3-6`). This HIP states the three
tiers, the physical org boundary of the store, and how the one paid dependency
(embeddings) is attributed.

## Motivation

An agent editing code needs three different questions answered well: "where
does this string appear" (exact, including operators and case conventions),
"where is this symbol defined and used" (structural), and "what code means
this" (semantic). Each tier serves one of them and fails at the others; a
single-tier engine forces every question through the wrong index.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The three tiers

- **lexical** — FTS5 trigram over code-tokenized text: camelCase and
  snake_case split, operators kept; substring and regex in the Zoekt model
  (`apps/code/store.go`, `tokenize.go`).
- **symbolic** — `go/parser` for Go, with real def→ref edges; compact lexical
  extractors for TS/JS, Python, Rust and Solidity (`apps/code/parse.go`).
- **semantic** — AST-boundary chunks embedded through the same gateway
  `/embeddings` the knowledge plane uses, ranked by cosine over a float32
  vector table; the schema is kept compatible with a `sqlite-vec` `vec0` KNN
  as a future seam, not a linked dependency today (`apps/code/store.go:561`).

`hybrid` fuses the tiers; a caller may also pin one with `type=`.

### §2 The store

One SQLite file per org at `{DataDir}/orgs/{slug}/code.db` (HIP-0302): the org
boundary is physical, so a query in one org's file can never reach another
org's rows (`apps/code/code.go:17-19`). Stores open lazily through the shared
`cloud.OrgStore` cache, and `storeFor` is the one way the package reaches one
(`apps/code/code.go:91`, `code.go:141-150`). Bounds cap what one request can
amplify into the shared file or the gateway (`apps/code/code.go:47-58`).

### §3 The addresses

Everything is under `/v1/code`: `search`, `context` (a budget-packed context
bundle), `ask` (a cited RAG answer), `index` (incremental, with prune), `file`
and `tree`. All operations are typed
(`apps/code/typed_wire_test.go`). `/v1/code/lsp` is NOT this capability: the
live language server is its own capability routed by prefix specificity
(`manifest/apps.go:308-318`), folded under this address because static index
and live server are two reads of one repository.

### §4 Tenancy and money

Every request resolves its org through `principal.Org` (HIP-0026): no validated
principal, 403; a client `X-Org-Id` is never trusted. The surface itself is
free (`plugin/code/main.go:21`, `cloud.Free`). Its embedding calls are billed
where inference is always billed — on the AI plane — attributed to
`principal.Ledger` and the server-minted project, neither of which may be an
input field (`apps/code/code.go:176-189`). Off the HTTP path both are empty,
which is the unbilled default — and `principal.Acting` has already refused
before any op runs.

### §5 Events, telemetry, stage, upstreams

It publishes no events on the bus and emits nothing to observability beyond the
request span. Its stage is `ga`: code intelligence is developer-tools core of
the self-service platform. It embeds no third-party engine: parsing is the Go
standard library plus this package's own extractors, storage is the
`hanzoai/sqlite` facade, and the lexical design follows the trigram model Zoekt
demonstrated without importing it.

## Rationale

The alternative to per-org files is one index with an org column — cheaper to
operate, and one forgotten predicate away from serving one tenant's source to
another. Source code is the asset tenants trust the platform with least
willingly, so the boundary is physical and the cost (an open file per active
org, amortized by the store cache) is accepted.

The alternative to fusing three tiers is picking one. Embeddings-only misses
exact identifiers; lexical-only cannot answer "what code does this"; fusion is
the measured lesson of code retrieval and each tier stays independently
testable (`apps/code/search.go`).

## Security Considerations

The store is an index of private source. The wrong implementation leaks it two
ways: across tenants (closed physically, §2) or through the paid seam — an
attacker who can set the billing org or project on an embedding call can charge
inference to a victim, which is why payer and project come only from validated,
server-minted values (§4). `ask` answers only from the caller's own org's
index, so the RAG surface cannot become a cross-tenant oracle.

## References

- HIP-0026 — Identity and Access Management
- HIP-0139 — Capability
- HIP-0302 — Encrypted SQLite Replication Standard

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
