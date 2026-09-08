---
hip: 1222
title: Pricing — The Price List and Who May See It
author: Hanzo AI
type: Standards Track
category: Platform
capability: pricing
status: Final
implementation-go: shipped
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1222: Pricing — The Price List and Who May See It

## Abstract

`/v1/pricing` is the price list — what every model, provider, GPU tier, tool and
hosting plan costs — and the enablement registry that decides which of those
entries a caller may even see. It is `hanzoai/cloud` `apps/pricing`
(`apps/pricing/pricing.go:1-6`). This HIP absorbs HIP-1003 (Enablement):
enablement is served by pricing over pricing's one overlay store, so a
standalone enablement capability would be two apps on one store — the split
HIP-0139 §7.2 refuses — and it is specified here as an address instead.

## Motivation

Which models an org may see is a question every plane asks; answered separately
it becomes registries that disagree, visible to customers as a feature present
in one surface and absent from another. One registry, one resolver
(`apps/pricing/enablement.go:3-7`). The registry's own address and the two
admin roots sit outside the app's prefix today (`manifest/apps.go:126`); they
come home.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 Addresses

- `/v1/pricing/*` — the catalog: the gated model plane and the fifteen fixed
  sections (plan, infrastructure, tool, GPU, policy) that carry no model
  identity and so pass ungated (`apps/pricing/sections.go:3-10`). Keeps.
- `/v1/pricing/enablement{,/optin,/optout}` — the registry and self-service
  opt-in (from `/v1/enablement`).
- `/v1/admin/pricing/{catalog,enablement}` — the SuperAdmin overlay editor and
  enablement mutations (from `/v1/admin/{catalog,enablement}`). HIP-0139 §3.2
  fixes the depth: the capability segment must read `pricing` — `catalog` names
  a different app entirely.

Where the router still serves the old spellings, the pairs are the `pricing`
lines in cloud's `openapi/misfiled.txt`. Every operation is typed except one,
held raw by a measured document fact — a greedy-wildcard model id the document
and the router cannot key the same way — on the closed list
`apps/pricing/typed_wire_test.go:44-58` re-verifies against the live router.

### §2 The store it owns

The enablement overlay: its own SQLite/Base store laying per-entry
`{enabled, betaOrgs, overrides}` over the static bundle
(`apps/pricing/catalog.go:3-15`). The bundle stays authoritative for catalog
content and shape; Go only hides entries and merges an admin override patch, so
an empty overlay leaves the catalog exactly as shipped. The overlay is a
security control, so a persistent data dir is a boot requirement — a
non-persistent overlay would re-expose admin-hidden models on restart, a
fail-open the mount refuses (`apps/pricing/pricing.go:117-125`).

### §3 Three states, and `off` is absolute

An entry resolves to exactly one of `ga`, `beta`, `off`
(`apps/pricing/catalog.go:94-103`): `ga` visible to everyone, `beta` only to
orgs on its grant list, `off` to no one — a grant list MUST NOT re-open it
(`apps/pricing/catalog.go:113-123`). An untouched entry is absent from the
registry and generally available; absence is not a denial, and the candidate
list comes from the live catalog, never from the registry.

### §4 Two scopes, one of them global

Global state — setting `off`/`beta`/`ga`, replacing a grant list — is admitted
only by the SuperAdmin claim the identity boundary mints
(`apps/pricing/ops.go:120-132`). Self-service opt-in is org-scoped and
beta-only: a caller may add or remove its own org from a beta entry's list and
nothing else — a `ga` entry needs no opt-in, an `off` entry is a kill switch
(`apps/pricing/catalog.go:566-570`, `:601-614`). The self-service path can
never bypass `off`.

### §5 The subject is the validated tenant

Opt-in and opt-out key on the org the identity boundary validated (HIP-0026),
never a raw header (`apps/pricing/enablement.go:243-249`); a caller with no
validated principal is refused on write and shown the public view on read
(`apps/pricing/enablement.go:178-182`). Enforced, not asserted:
`apps/pricing/enablement_attack_test.go` drives an off-gateway request with a
forged tenant header at both paths and fails if the grant lands. The item
namespace is closed to `model`, `provider`, `feature`
(`apps/pricing/enablement.go:36`), and the catalog gate, the admin surface and
the caller's own view MUST all resolve through the one resolver.

### §6 The prices are the module's

Handlers are the `@hanzo/pricing` bundle's pure transforms, run in-process via
goja; the markup math runs in the same bundle, and the only Go part is the live
network fetch the JS engine cannot perform, fed raw into `applyMarkup`
(`apps/pricing/pricing.go:12-22`). No pricing data or markup math is
reimplemented in Go. Eight sections share the `@hanzo/plans` catalog with the
plans capability and answer the same data (`apps/pricing/pricing.go:8-10`).

### §7 Price, events, observability

It is free, in those words: `Price: cloud.Free` (`plugin/pricing/main.go:22`).
Reads are open to any authenticated caller — it is the public price list. It
publishes no events on the platform bus, so a customer's webhooks (HIP-1310)
receive nothing from it, and it emits nothing to observability beyond the
request span every route gets.

### §8 Stage and upstream

The stage is `ga` — the manifest row declares none, and absent is `ga`
(HIP-0139 §8).

It derives from `hanzoai/pricing` (pinned v1.4.10 in cloud's `go.mod:29`),
dual-licensed MIT / Apache-2.0 — the bundle and its markup logic survive whole
as the goja payload — executed by `dop251/goja` (MIT, `go.mod:13`), the ES
engine it runs in. The Express transport upstream ships is dropped; native zip
routes replace it.

## Rationale

A boolean flag plus an allow-list was the obvious enablement shape and has a
hole: nothing states which wins, so "off but granted" is a race between two
readers. Three ordered states make `off` unambiguous. Letting an org admin flip
global state would make rollout self-service — until an org turns on a model
the platform has withdrawn; the split in §4 is the smallest division that gives
each party what it needs. And enablement lives in this HIP rather than its own
because the store decides: one overlay, one capability.

## Security Considerations

An enablement grant is a cross-tenant write if the subject can be forged: an
off-gateway caller who could name a tenant could opt a stranger into a beta or
deny them one they were granted — §5 closes both directions, and the attack
tests exist because the read and write paths once resolved their tenant
differently. The SuperAdmin claim is a header only the identity boundary can
mint; a deployment that lets a client set it hands over the global kill switch
for every model and provider. The third exposure is the overlay itself: run
without persistence it silently re-exposes what an admin hid, which is why §2
makes that a refusal to boot.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0135 — What Is Public

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
