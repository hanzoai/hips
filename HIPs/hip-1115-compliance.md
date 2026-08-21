---
hip: 1115
title: Compliance — Verification of Record
author: Hanzo AI
type: Standards Track
category: Interface
capability: compliance
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0139
---

# HIP-1115: Compliance — Verification of Record

## Abstract

`/v1/compliance` is an org's verification records: subjects (the people and
entities being verified), verification checks and their decisions,
accreditation, and the org-scoped record and audit reads that prove what was
decided and when. It is implemented in `hanzoai/cloud` `apps/compliance`. This
HIP states what the capability owns — a sealed store of subject PII and
decisions — and the two fail-closed seams that keep a verification honest: the
provider and its webhook.

## Motivation

A verification that cannot be replayed is not a compliance record; it is a
checkbox. The record has to survive the provider that produced it, carry the
decision beside the evidence reference, and be readable only by the org it
belongs to — which makes it a store of its own, not a relay to a vendor
dashboard.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store

One SQLite file — the system namespace's `compliance` — born encrypted, so
subject PII (name, email) is encrypted at rest (`apps/compliance/store.go:19-22`).
Tenant isolation is physical in the schema: `org` is a column on every table
and every read and write filters by it; a record belonging to another tenant is
indistinguishable from one that does not exist, so there is no cross-tenant
probe (`apps/compliance/store.go:14-16`).

### §2 The provider seam, fail-closed

Verification runs through the `idv.Provider` seam: Manual by default, a real
provider when configured — and a named-but-misconfigured provider MUST fail the
mount rather than silently downgrade to Manual
(`apps/compliance/compliance.go:50-64`). The optional provider webhook receiver
is authenticated by signature rather than by a principal, and it follows the
same rule: a named-but-unresolvable secret fails the mount rather than serving
an unauthenticated endpoint; nil means no webhook path is served at all
(`apps/compliance/compliance.go:66-70`).

### §3 The addresses

Everything is under `/v1/compliance`: `subjects` (create, list, detail),
`verifications` (create, list, detail, `decision`, `refresh`, and the
signature-authenticated `webhook`), `accreditation` (create, list, detail,
`decision`), plus the reads `records`, `status`, `audit` and `health`. The
prefix is written once and composed onto every op
(`apps/compliance/compliance.go:25-29`). Operations are typed
(`apps/compliance/typed_wire_test.go`); the webhook is declared for what it is
— a provider-signed callback, not a principal-authenticated method.

### §4 Tenancy, money, events, telemetry, stage, upstreams

Every handler resolves the org through `principal.Acting` (HIP-0026)
(`apps/compliance/compliance.go:281`); no principal, no answer. The capability
is METERED (`plugin/compliance/main.go:28`, `Price: cloud.Metered`), and the
billed act is exactly one: starting a verification opens an inquiry at the
provider on the deployment's own key, so the caller's ledger is charged the
inquiry fee — `CLOUD_COMPLIANCE_FEE_CENTS[_INQUIRY]`, resolved through the
fleet's ordinary provision default, authorized BEFORE the provider is asked
and debited only after an inquiry actually opened
(`apps/compliance/meter.go:29-55`). Everything else on the surface reads the
org's own rows and is free. It publishes no events
on the bus. Beyond the request span, compliance-relevant actions are recorded
on the shared audit plane under the `compliance.` action prefix
(`apps/compliance/compliance.go:31-32`), which is how `/v1/compliance/audit`
can answer. Its stage is `beta`: a vertical application. It derives from no
upstream; the provider integration is a configuration of the `idv` seam, and
storage is the `hanzoai/sqlite` facade.

## Rationale

Fail-closed at mount, rather than at first use, is the deliberate choice in
both seams. A provider that silently degrades to Manual passes every health
check and quietly stops verifying — the operator finds out during an audit,
which is the most expensive possible moment. Failing the mount converts a
misconfiguration into a deploy failure, which is cheap and immediate.

The alternative to owning a store is relaying to the provider's records. That
couples the org's compliance history to a vendor contract: cancel the vendor,
lose the history. The store keeps the decision and its reference; the provider
keeps the evidence it is contractually the custodian of.

## Security Considerations

This store is PII plus regulatory decisions — the two things with the highest
disclosure cost per row. The wrong implementation leaks a tenant's customer
list with names and emails attached, or lets a forged webhook flip a
verification to approved. The defenses are stated above because they are the
design: encryption at rest, org on every row with not-found aliasing, and a
webhook that either verifies a signature or does not exist. The decision
endpoints are the residual surface: they accept a human judgment, and the
audit trail under the `compliance.` prefix is what makes such a judgment
attributable after the fact.

## References

- HIP-0026 — Identity and Access Management
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
