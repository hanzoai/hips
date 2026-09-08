---
hip: 1120
title: CRM — The Sales Pipeline
author: Hanzo AI
type: Standards Track
category: Interface
capability: crm
status: Final
implementation-go: partial
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1120: CRM — The Sales Pipeline

## Abstract

`/v1/crm` is an org's sales pipeline: companies, contacts and opportunities,
plus the Startup Program intake that lands as a scored application. It is
implemented in `hanzoai/cloud` at `apps/crm`. This HIP states the store, the two
audiences the surface serves — staff behind the identity boundary and an
anonymous applicant on one public form — and why exactly one route is not typed.

## Motivation

A CRM contact is a prospect the org tracks, not a product user: the org's own
users live in IAM, and the marketing subsystem resolves audiences from that
roster, never from this table (`apps/crm/crm.go:9-13`). Without a capability
that owns the prospect universe, prospect rows leak into user stores and the two
contact universes join by accident — which is a privacy defect, not a modelling
choice. This capability is the one place prospects live.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store

crm owns one store: a single SQLite file named `crm` in the deployment's data
directory (`apps/crm/store.go:40`, `sqlpool.Open`). Every org's rows share the
file; isolation is the `org` column, which leads every uniqueness and lookup
index so tenancy is a physical property of the index, not only a WHERE clause
(`apps/crm/store.go:56-59`). The entity model follows Twenty's `company` /
`person` / `opportunity` standard objects, with the composite fields flattened
to scalar columns for SQLite (`apps/crm/crm.go:5-8`); no upstream code is
imported for it.

### §2 The addresses

Every route is under `/v1/crm` (`manifest/apps.go:273`). The CRUD over
companies, contacts and opportunities, `GET /v1/crm/summary`, and the staff
reads of applications are typed operations; each DELETE answers no body and so
carries no response schema. One route is a raw handler and MUST stay one:
`POST /v1/crm/applications`, the public Startup Program intake. Its rate limit
and 64 KiB body cap are HTTP middleware, and the MCP and CLI projections of a
typed op do not run middleware — typing it would publish an unmetered alias of a
deliberately limited public endpoint (`apps/crm/crm.go:200-207`). Its prose is
declared beside the wire fact instead (`apps/crm/applications.go:130`).

### §3 Tenancy

Staff routes resolve the org from the validated principal
(`principal.Acting`, `apps/crm/crm.go:433`), minted by the identity boundary
(HIP-0026); a request the boundary refuses never reaches the store. The intake
POST is the one unauthenticated route: it takes no principal and never reads a
caller org — the application is filed against the deployment's own program org,
so there is no tenant to name and none to leak. Re-submitting the same
(email, company) refreshes the existing application rather than filing a second.

### §4 Money, events, telemetry

crm is free, in those words: its plugin declares `cloud.Free`
(`plugin/crm/main.go:21`) and crm is not in the metered set (`spend.go:275`).
The AI screen a filed application receives runs on the deployment's own gateway
credential, not the applicant's. crm publishes no events on the bus, and emits
nothing to observability beyond the request span every route gets.

### §5 Stage

crm is `beta`: a vertical application, not the agentic-OS core. The manifest
row declares it (`manifest/apps.go:273`, `Stage: Beta`; HIP-0139 §8).

### §6 Upstream

crm derives from no third-party code. The one third-party fact is the schema
lineage stated in §1: the entity model mirrors Twenty's standard objects so a
migration is a column mapping, and nothing of Twenty's implementation is in the
tree.

## Rationale

One shared file with a leading `org` index, rather than a file per org, because
CRM rows are small and the summary read is a cross-table count within one org —
the per-org-file pattern buys physical isolation at the cost of N file handles,
and here the leading index gives the same fail-closed property for one handle.
The intake staying raw, rather than teaching typed ops about middleware, keeps
the typed registry's promise intact: every typed op is safe to project
everywhere.

## Security Considerations

The wrong implementation leaks the pipeline: every prospect, every deal and its
amount, to any tenant that can name another's id. The gate is the org from the
validated principal, never a client-supplied field, and every query filters on
it. The intake is the other exposure — an unauthenticated write — and it is
bounded three ways: IP rate limit, body cap, and upsert-on-resubmit, so an
attacker can neither flood the store nor amplify a row.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
