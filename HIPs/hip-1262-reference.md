---
hip: 1262
title: Reference — Lookup Sets
author: Hanzo AI
type: Standards Track
category: Application
capability: reference
status: Final
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1262: Reference — Lookup Sets

## Abstract

`/v1/reference` is the lookup data a risk decision needs but cannot derive:
which email domains hand out throwaway inboxes, which addresses belong to a
datacentre or a Tor exit, which card scheme an issuer prefix belongs to, which
browsers the fleet sees everywhere, and how current the designation lists the
screening engine holds actually are (`apps/reference/reference.go:15-19`). It is
implemented in `hanzoai/cloud` at `apps/reference`. This HIP is where HIP-1046
§8's subtree now lives; HIP-1046 keeps the cross-plane invariants.

## Motivation

Every one of these facts could be hard-coded where it is consulted, and each
copy would go stale on its own schedule with nobody noticing — a designation
list that answers "not listed" because it was never loaded is indistinguishable
from a clean world. Making the lookup a capability puts freshness on the wire
and makes staleness a reported condition rather than a silent one.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### Two stores, one precedence

The Hanzo-maintained BASELINE lives in the shared warehouse —
`hanzo.reference_source` and `hanzo.reference_entry`, tables with NO tenant
column at all, so a cross-tenant write is unrepresentable rather than merely
forbidden (`apps/reference/store.go:47-49`). A tenant's OWN allow and deny
entries live in that organization's own SQLite file, opened per organization
through `cloud.OrgStore` under the name `reference`
(`apps/reference/override.go`, `apps/reference/reference.go:34-40`).
Resolution MUST be override first, then baseline; first hit wins.

Nothing derived from one organization's rows may enter the baseline, ever. The
only fleet-derived set is an aggregate published above a k-anonymity floor no
single organization can reach alone (`apps/reference/set.go:297-299`).

### The address

The capability answers under `/v1/reference`: the set list at the root, one set
read, written and cleared at `/{set}` — a SET, which is why the name is singular
— `resolve`, and `refresh` (`apps/reference/reference.go:507-525`). Every
operation is typed. `refresh` writes the shared baseline every organization
reads and is therefore SuperAdmin only (`apps/reference/reference.go:1328-1329`);
it MUST stay one operation under this prefix, never an address family of its own. Today's router still serves
this surface under `/v1/risk/reference`; that pair is carried by
`hanzoai/cloud` `openapi/misfiled.txt` and closes by fold.

### A version, a refusal, and freshness on the wire

Every set is a VERSION — the content digest of what was taken, so the same
data is the same version whoever fetched it, and a decision records one string
an auditor resolves back to a publisher, a licence and a date. A set that has
never loaded MUST REFUSE rather than answer "not listed"
(`apps/reference/resolve.go:157`), and a set whose source needs a licence we do
not hold is declared as a seam that refuses (`apps/reference/set.go:93-95`).

Freshness rides every answer: the version, when its oldest contributing
publisher was current — the oldest, because a set is exactly as fresh as its
weakest source (`apps/reference/resolve.go:71-73`) — how old that is, and
whether it is past bound. A stale set still answers, and says that it did.

### Tenant, meter, events, observability, stage

Reads and override writes resolve the organization from the validated
principal (`apps/reference/reference.go:549`) and a request without one is
refused; the baseline is readable by every validated org and writable by none
of them. The capability is free, in those words
(`plugin/reference/main.go:21`, `Price: cloud.Free`). It publishes no events on
the bus. Beyond the request span it registers nothing; staleness and refusal —
the two ways this plane can be quietly wrong — are reported on the wire rather
than in a private metric. Its stage is whatever its manifest row declares —
HIP-0139 §8 keeps that in one place, and the `beta` this line used to assert had
already drifted from it.

### Upstreams

It forks no code; the refusal discipline generalises what `luxfi/aml`
`pkg/reference` states (`apps/reference/reference.go:25-28`). What it MIRRORS
is published data, and the catalog declares each source's licence as a fact
beside its origin (`apps/reference/set.go`):

- `disposable-email-domains` — CC0-1.0 (`set.go:221-223`);
- `crawler-user-agents` — MIT (`set.go:255-257`);
- the Tor bulk exit list — CC BY 3.0 US (`set.go:242`);
- the IANA special-purpose address and AS-number registries — the registries of
  record (`set.go:243-244`, `:269-271`);
- cloud and CDN operators' self-published IP feeds — machine-readable by intent,
  no licence stated and none claimed (`set.go:234-241`);
- issuer prefixes — computed here from ISO/IEC 7812 structural facts; no issuer
  database is licensed or held (`set.go:283-285`);
- sanctions designations — receipt only; they stay with the engine that screens
  (`set.go:310-313`).

A new source MUST enter through this catalog with its licence basis declared, or
as a seam that refuses.

## Rationale

The alternative was to file these operations under the model-serving plane, and
an earlier cut did exactly that (`manifest/apps.go:231-238`): lookup data in a
live product with different customers, where its growth reads as that product's
growth. The other alternative — folding into `risk` — fails on the store rule:
this capability owns two stores of its own, and the baseline's no-tenant-column
shape is a property `risk`'s per-tenant planes cannot host.

## Security Considerations

The baseline is consulted by every organization's decisions, so poisoning it is
the high-value attack: `refresh` is held to the platform's own identity, a
version is a content digest so a tampered take is a different version by
construction, and nothing an organization sends can reach the baseline tables —
their shape has nowhere for it to go. The override plane is the tenant-side
exposure: a per-org file reached only through the validated principal, so one
organization's allow-list cannot bleed into another's decisions. The remaining
risk is absence — an unloaded, unlicensed or stale set silently passing for a
clean answer — closed by refusing the first two and reporting the third.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1046 — Risk

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
