---
hip: 1135
title: Legal — Documents Drafted, Signed and Filed
author: Hanzo AI
type: Standards Track
category: Interface
capability: legal
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1135: Legal — Documents Drafted, Signed and Filed

## Abstract

`/v1/legal` is the paperwork an org needs, drafted, signed and filed: a
versioned, org-overridable library of standardized templates, a pure
merge-field engine that renders them from the org's own data, a sealed store
for the generated documents, and the e-signature and filing seams that carry a
document to execution. It is implemented in `hanzoai/cloud` at `apps/legal`
(HIP-0106).

## Motivation

Formation and securities paperwork is templated work over data the platform
already holds — the company record, the cap table. What must never be templated
away is the boundary: the platform manages documents; it does not give legal
advice and does not determine that a document is valid or sufficient. That
boundary is a design invariant enforced in the engine and the data model, not a
disclaimer pasted on a page (`apps/legal/model.go:10-18`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store and the renderer

One encrypted SQLite file, the deployment's own `legal`, opened through the one
opener so it is born encrypted (`apps/legal/store.go:30`) — a rendered contract
carries names and terms and is sealed on disk. The renderer is `text/template`
and pure: deterministic, no clock, no I/O, so the same inputs yield identical
bytes and a rendered contract is reproducible (`apps/legal/model.go:20-24`).

### §2 The boundary in the model

There is no `legally_valid` state: a document is draft, out_for_signature,
signed or voided, nothing more. Formation and securities templates carry a
mandatory counsel-review notice the engine prepends to every rendered document —
the platform can never emit such a document without it
(`apps/legal/model.go:13-18`). A disclaimer rides on every generation and
template response.

### §3 The address

Eleven operations under `/v1/legal`, all typed except one. The exception is
`POST /v1/legal/documents/{id}/sign/complete`, untyped by design: it discards
its decode error so a provider-reported completion still lands when the
callback body is unparseable — the typed layer refuses such a body before the
handler runs, so typing it would turn today's 200 into a 400
(`apps/legal/legal.go:87-91`). The provider's own status is checked first; an
explicit body signal exists for the stub (`apps/legal/legal.go:170-182`). A
1 MiB body cap sits in front of every route, registered before the typed ops
because a size check inside one would run after the parse it exists to precede
(`apps/legal/legal.go:66-77`).

### §4 The seams fabricate nothing

E-signature and filing are provider-agnostic seams with honest stub defaults: a
seam with no real backend records an honest state and never fakes a completed
signature or a filed record (`apps/legal/providers.go:10-16`). Every generate,
sign and file action is recorded on the shared tamper-evident audit plane,
referencing opaque document ids (`apps/legal/model.go:26-28`).

### §5 Tenancy, money, events, observability, stage, upstream

The tenant is `principal.Org` off the validated principal (HIP-0026), read back
from what the composer's bridge parked — never a header, never an In field
(`apps/legal/legal.go:156`). Free (`cloud.Free`, `plugin/legal/main.go`). It
publishes nothing on the bus and emits nothing beyond the request span; the
audit records above are the audit plane's, not telemetry. Stage `beta`: a
vertical application. It derives from no upstream — the renderer is the Go
standard library's `text/template` and the templates are authored here.

## Rationale

The alternative to a pure renderer is one that reaches for live data at render
time, which makes a contract unreproducible: the same request on two days
yields two different documents and no record of why. Determinism is what makes
the sealed store an archive rather than a cache. The alternative to honest
stubs is refusing to mount without providers, which would couple a template
library to two vendor contracts nobody needs on day one.

## Security Considerations

A legal store is a disclosure surface — names, terms, equity — so documents are
sealed at rest and the tenant is never an input. The execution path is where a
wrong implementation does real-world harm: a seam that fabricated a "signed" or
"filed" state would manufacture legal evidence, which is why the stubs are
honest and completion consults the provider before any caller-supplied signal.
The completion endpoint is org-scoped and moves only the document's status; it
mints no provider record.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
