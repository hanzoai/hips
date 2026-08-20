---
hip: 1003
title: Enablement — Off, Beta, GA
author: Hanzo AI
type: Standards Track
category: Platform
status: Active
created: 2026-08-20
capability: enablement
---

# HIP-1003: Enablement — Off, Beta, GA

## Abstract

`/v1/enablement` decides what a caller may even see: every model, provider and
product feature carries one of three states — `off`, `beta`, `ga` — and a beta
carries a list of orgs granted it. It is implemented in `hanzoai/cloud` at
`apps/pricing/enablement.go` over the same overlay store the price catalog gate
reads. This HIP states the three-state model, the two scopes allowed to change it,
and why self-service opt-in can never reach past a kill switch.

## Motivation

Rolling a model, a provider or a feature out to some orgs and not others is a
question every plane asks. Answered separately in each plane it becomes several
registries that disagree, and disagreement here is visible to customers as a
feature that appears in one surface and not another. One registry and one
resolver is the whole point (`apps/pricing/enablement.go:3-7`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### Three states, and `off` is absolute

An item resolves to exactly one state (`apps/pricing/catalog.go:94-103`):

- `ga` — visible to everyone.
- `beta` — visible only to orgs on its grant list.
- `off` — visible to no one. A grant list MUST NOT re-open it
  (`apps/pricing/catalog.go:113-123`).

An item nobody has touched is absent from the registry and is generally available.
Absence is therefore not a denial, and a reader MUST NOT treat the registry as the
list of things that exist — the candidate list comes from the live catalog.

### Two scopes, and only one of them is global

**Global state is SuperAdmin only.** Setting an item to `off`, `beta` or `ga`, and
replacing its grant list, is admitted only by the SuperAdmin claim the identity
boundary mints (`apps/pricing/ops.go:120-132`). An org admin can never flip an
item's global state.

**Self-service opt-in is org-scoped and beta-only.** A signed-in caller may add or
remove *their own* org from a beta item's grant list, and nothing else. The
registry refuses an item that is not in beta: a `ga` item needs no opt-in and an
`off` item is a kill switch (`apps/pricing/catalog.go:566-570`,
`apps/pricing/catalog.go:601-614`). So the self-service path can never bypass
`off` and never touches global state.

### The subject is the validated tenant, never a header

Opt-in and opt-out key on the org the identity boundary validated, not on a raw
tenant header (`apps/pricing/enablement.go:243-249`). A caller with no validated
principal is refused rather than defaulted. The read path resolves the same way
and simply shows the public view to a caller it cannot place
(`apps/pricing/enablement.go:178-182`) — never another org's beta state.

This is enforced, not asserted: `apps/pricing/enablement_attack_test.go` drives an
off-gateway request carrying a tenant header with no credential at both the write
and the read, and fails if the grant lands.

### The item namespace is closed

A kind is `model`, `provider` or `feature` and nothing else
(`apps/pricing/enablement.go:34`). An open namespace lets an arbitrary caller
write rows into the overlay store that no resolver will ever read, which is a
storage-growth surface with no reader.

### One registry, one resolver

The visibility question has exactly one implementation, and the catalog gate, the
admin surface and the caller's own view MUST all resolve through it. A parallel
copy is the defect this capability exists to prevent.

## Rationale

A boolean flag plus a separate allow-list was the obvious shape and it has a hole:
nothing states which of the two wins, so "off but granted" is a race between two
readers. Collapsing to three ordered states makes `off` unambiguous, and the grant
list becomes meaningful only in one of the three.

Letting an org admin flip global state would make rollout self-service, which
sounds like a feature until an org admin turns on a model the platform has
withdrawn. The split — global for the platform, membership for the org — is the
smallest division that gives each party what it actually needs.

## Security Considerations

The write path is the interesting one. An enablement grant is not money, but it is
a cross-tenant write if the subject can be forged: an off-gateway caller who could
name a tenant could opt a stranger into a beta, or remove them from one, which is
denial of a feature they were granted. Keying on the validated principal is what
closes both directions, and the attack tests exist precisely because the read path
and the write path resolved their tenant differently once.

The SuperAdmin claim is a header only the identity boundary can mint. A deployment
that lets a client set it directly hands over the global kill switch for every
model and provider.

## References

- HIP-0135 — What Is Public

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
