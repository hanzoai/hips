---
hip: 1156
title: Template — A Deploy Cut From a Catalog
author: Hanzo AI
type: Standards Track
category: Interface
capability: template
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1156: Template — A Deploy Cut From a Catalog

## Abstract

`/v1/template` is a gallery of starter kits you can deploy as they come, in two
layers that never mix: the public catalog of deployable scaffolds, vendored from
`hanzoai/gallery` and shipped embedded in the binary, and a customer org's own
templates, private to that org. It is implemented in `hanzoai/cloud` at
`apps/template`. One template is one entry; the shapes it ships in — format,
page, theme — are Variants inside that entry, chosen at fork time.

## Motivation

Variants exist because the alternative already happened: one portfolio design
read as 26 templates and one dashboard as 2, because every format and page was a
catalog row of its own. A variant is an option resolved at fork time, never a row.
The value is named StarterKit rather than Template because the fleet's schema
namespace is flat and another app already publishes a `Template` with a different
shape — one name with two shapes would make every generated SDK bind whichever it
read last, so the name not yet published is the one that yields
(`apps/template/templates.go`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### The store, and the layer that is not in it

The store holds ONLY private templates: one encrypted SQLite file
(`cek.Open(namespace.System(), "templates", dir)`,
`apps/template/store.go:39`), each row keyed by the gateway-minted org, the
whole StarterKit as one JSON document so a row can never drift from the shape
the API serves, with `(org, slug)` — the only things ever queried on — as real
columns.

The public catalog is deliberately NOT in that table. It is the embedded
`catalog.json` — reference content, immutable, with NO write route, so nothing a
customer does can add to it. Two containers rather than one visibility flag is
the whole safety argument: a private template cannot surface in the public
catalog by CONSTRUCTION, not by a filter every future reader has to remember.

### The address

Five operations under `/v1/template`: list (public catalog plus, for a validated
caller, that org's own), get one by slug (the caller org's own, else public),
publish (201, private to the caller's org), replace, and delete. All are typed
except the delete, which answers 204 with no body — there is no value to type.
An anonymous GET never touches the store at all.

### The slug is single-valued

A slug names exactly one template across both layers: publishing over a public
slug MUST be refused (409), so no org can shadow the gallery. The slug shape is
the same DNS-ish label a project uses, so a template slug can always become the
forked project's slug.

### Curation is not writable

`Tier` and `Rating` are public-gallery curation carried verbatim from the
embedded catalog. No request can set them — neither write body has the fields
and neither write path builds a kit carrying one — so they are absent on every
customer-published kit, and the console's "yours" badge keys on the server-
stamped owner, never on a request field.

### Tenancy

The org is `principal.Org`, minted from the validated bearer (HIP-0026), never a
request field; every read of the private table binds it.

### Money, events, observability, stage

It is free — the surface declares `cloud.Free` (`plugin/template/main.go`). It
publishes nothing on the bus and emits nothing beyond the request span every
route gets. The stage is `ga`: the gallery is the entry point of the deploy path,
part of the self-service platform core.

### Upstream

The public catalog's source of truth is `hanzoai/gallery` — the fleet's own
repository — vendored as the embedded catalog so the unified binary ships it
with no external dependency. No third-party OSS is forked or embedded.

## Rationale

The alternative to two containers is one table with a `public` flag, which makes
every future query one missing predicate away from leaking a customer's private
template into the catalog every visitor browses. Embedding the catalog trades
freshness for immutability — updating it is a release — and that is the right
trade for reference content whose integrity is the product.

## Security Considerations

The exposures are impersonation-shaped rather than data-theft-shaped. A private
template surfacing publicly leaks a customer's product scaffolding; the
container split closes it structurally. An org shadowing a public slug would let
an attacker serve their own kit under a name the gallery made trustworthy — the
409 closes it. Writable curation fields would let anyone mint a top-tier rating
for their own kit; keeping Tier and Rating catalog-only closes it. The remaining
boundary is the org bind on every private read, from the validated principal
only.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
