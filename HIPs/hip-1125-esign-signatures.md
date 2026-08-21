---
hip: 1125
title: Esign — Documents Out for Signature
author: Hanzo AI
type: Standards Track
category: Interface
capability: esign
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1125: Esign — Documents Out for Signature

## Abstract

`/v1/esign` is a document out for signature: upload a PDF, place recipients and
fields, send it, and file the signed result with an audit trail — a real
cryptographically sealed PDF comes out. It is implemented in `hanzoai/cloud` at
`apps/esign`, running the ported Documenso-lineage domain logic in-process.
This HIP states the two doors — the sender's and the recipient's — the store
each opens, and where the cryptography lives.

## Motivation

The upstream product was a Next.js pod with Prisma and Postgres; the fold
retires it, and the standalone pod held no tenant data — zero documents,
recipients or users — so cloud's per-tenant store is authoritative from the
first write with nothing to migrate (`apps/esign/esign.go:36-41`). What
remains worth specifying is the part that moves legally binding documents: who
may open which store, and what seals the PDF.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store

Rows — documents, recipients, fields, the signing state machine, the audit
trail — live in one SQLite file per tenant, opened by the shared goja host with
one transaction per request (`apps/esign/esign.go:12-16`). Beside the tenant
files sits one system-namespace index, `token_index`
(`apps/esign/index.go:34`) — the signing-token → tenant routing table, the
single deliberately cross-tenant piece.

### §2 The two doors

Owner routes (`/v1/esign/documents/*`) require a validated principal and
resolve the tenant from it (`apps/esign/esign.go:328-330`, HIP-0026). Recipient
routes (`/v1/esign/o/{org}/sign/{token}/*`) are unauthenticated capability
links: the crypto-random token is the whole credential, and it — resolved
through the token index before any per-tenant store opens — is what selects the
tenant DB. The `{org}` segment is only the caller's claim, checked against that
answer (`apps/esign/esign.go:25-34`). The host pre-routes the bundle's database
to the resolved tenant, so isolation is a host property, not bundle discipline.

### §3 Why nothing here is typed

Every route is a raw handler and none can be typed: each is built by a handler
factory closing over a bundle route name, because the domain lives in the
ported JS bundle and this leaf is only the door to it — and a closure has no
doc comment for the registry to lift (`apps/esign/esign.go:148-157`). Each
operation instead declares prose beside the wire fact, rendered only while the
router serves the route, stating which of the two doors it is behind.

### §4 The seal

PDF and PKI are the one capability the bundle cannot provide, so they are Go
host functions injected as `__pdf = { stamp, sign }`
(`apps/esign/esign.go:18-23`): page stamping through pdfcpu and an x509/PKCS#7
seal through digitorus/pdfsign. The signing logic and seal orchestration stay
in the bundle; only the crypto/PDF primitive is Go.

### §5 Money, events, telemetry

esign is free, in those words (`plugin/esign/main.go:21`, `cloud.Free`; not in
`spend.go:275`). It publishes no events on the bus — the audit trail is rows in
the tenant DB, read back through `/v1/esign/documents/{id}/audit` — and it
emits nothing to observability beyond the request span every route gets.

### §6 Stage

esign is `beta`: a vertical application, not the agentic-OS core. Its manifest
row predates the stage field and reads `ga` by default (HIP-0139 §8); this HIP
declares the stage the row MUST carry.

### §7 Upstream

esign embeds `github.com/hanzoai/sign` v1.0.0 — the Documenso-lineage domain
logic ported to a self-contained goja bundle, AGPL-3.0 (the module's LICENSE).
What survives in HEAD is the signing domain: documents, recipients, fields,
flow, audit, completion. The Go leaf adds the two host primitives:
`github.com/pdfcpu/pdfcpu` v0.11.0 (Apache-2.0) for rendering and
`github.com/digitorus/pdfsign` (BSD-2-Clause) for the PKCS#7 seal.

## Rationale

A capability link, rather than recipient accounts, is what makes the product
usable: the counterparty signing an NDA has no reason to hold an identity here.
The cost is that the token is a bearer credential, which is why it is
crypto-random, why it selects the tenant rather than trusting the URL's org
claim, and why the index resolves before any store opens — the link can be
leaked, but it can only ever open the one signing session it names.

## Security Considerations

The wrong implementation forges signatures or leaks documents across tenants.
The seal is Go-side PKI the bundle cannot reach around — a bundle defect can
mis-order a flow but cannot mint a seal. Cross-tenant reach is confined to the
token index, whose answer is a tenant name, never rows; the org segment in the
URL is checked against it, so a crafted URL naming another org resolves to
nothing. A boot that cannot carry the pre-rename data directory forward aborts
rather than serving an empty store over signed documents
(`apps/esign/esign.go:84-90`).

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
