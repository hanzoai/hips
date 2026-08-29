---
hip: 1044
title: Org Settings
author: Hanzo AI
type: Standards Track
category: Security
status: Final
created: 2026-08-20
requires: HIP-0118, HIP-0519
---

# HIP-1044: Org Settings

## Abstract

`/v1/org` is the platform's own control over ANOTHER organization's settings: the
per-org row that decides how that org's inference is routed, what it may cost,
which models are eligible, and whether it contributes to shared training. It is
SuperAdmin-only, cross-tenant by construction, and it is the only capability in
the identity domain whose subject is deliberately not the caller.

It is served by the router in `hanzoai/ai`, reached through the unified API host
(`controllers/zap_verticals-and-misc.go:847`).

## Motivation

Routing policy has to be adjustable while the fleet is running: a model is
withdrawn, an org's cost ceiling is wrong, a learned strategy misbehaves for one
tenant. Restarting a process to change a number is not an operation, and an
environment variable is not a per-tenant value.

The settings row is also where PLATFORM-GLOBAL knobs live, under a reserved owner
rather than a second mechanism — so there is one table, one gate and one cache for
"how routing is configured", instead of a per-org store plus a config file plus an
env.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### 1. The gate is SuperAdmin, and it is checked once

Every operation on this capability requires SuperAdmin — membership of the
reserved `admin` org — evaluated as the ONE predicate `owner == "admin"`
(`util/permission.go:76`, HIP-0118 §SuperAdmin). No caller reaches a handler
without it: the check is at the top of the noun, before the method dispatch
(`controllers/zap_verticals-and-misc.go:848`).

An org's OWN admin MUST NOT be able to write these values. They are platform
policy about a tenant, not the tenant's self-service configuration; treating org
admin as sufficient here is the privilege escalation HIP-0118 names.

### 2. The subject is a parameter, and it is never an identity

The target org is read from the request — the `owner` query value, falling back to
the body's own owner field — and MUST NOT be derived from the caller's identity
(`controllers/zap_verticals-and-misc.go:926`). That is the opposite of every
other identity capability, and it is correct precisely because the gate above
already establishes cross-tenant authority. A request naming no owner is refused
rather than defaulted to the caller's org.

### 3. A write is a merge, never a replace

A write MUST be applied ONTO the existing row, so a field absent from the body
keeps its current value; clearing a field requires stating it explicitly
(`controllers/zap_verticals-and-misc.go:894`).

This is not a convenience. The storage layer writes ALL columns, so a replace
semantics turns a partial write — an operator toggling one flag — into a wipe of
every other setting that org had. That is a defect this codebase has already
paid for once, and the merge is what closes it.

A write for an org with no row upserts one keyed on the owner, so a
never-configured org takes effect immediately.

### 4. Three-state fields, and the fallback order

Every flag-shaped setting is THREE-STATE: unset, enabled, disabled. Unset is not
"disabled" — it means "fall through", and resolution walks: the org's own row, the
reserved global-default row, then the compiled default
(`object/org_settings.go:26-33`).

Two states cannot express this. With a boolean, a platform default cannot be
changed without rewriting every org that never expressed an opinion, and an org
that deliberately opted out is indistinguishable from one that never chose.

### 5. The reserved global owner

`*` is the reserved owner of the platform-wide default row
(`object/org_settings.go:41`). It is read as the fallback between a real org's row
and the compiled default, and its writes take the SAME gate as any other org's.

It MUST NOT be resolvable from a request's identity: a real request derives its
org from the verified principal, so no tenant can ever be `*`. Some knobs are
declared platform-global and are read ONLY from this row.

### 6. No secret lives in this row

Settings are policy values — flags, model ids, ceilings, endpoints. A credential
MUST NOT be stored here; the components these settings configure present the
platform's own service credential from the secrets plane
(`object/org_settings.go:116`). A settings table that can hold a secret becomes a
secret store with an admin UI in front of it.

### 7. Verbs the surface does not own

The route is registered for any method because the handler is method-aware, and it
answers 405 for a verb it does not implement. A generated document therefore lists
verbs on this address that the handler refuses. The METHOD SET IS THE HANDLER'S,
not the route table's, and a client MUST NOT infer capability from the document
here.

## Rationale

The alternative shape is per-org settings under each org's own subtree, authorized
by org admin. It reads better and is wrong: these values are how the PLATFORM
serves a tenant, not what the tenant may choose about itself, and once a tenant
can write its own cost ceiling the ceiling is not a control.

Keeping the platform defaults in the same table under a reserved owner rather than
in a config file means one read path, one cache, and one place an operator looks —
at the cost of a reserved identifier that must never collide with a tenant, which
the principal resolution guarantees.

## Security Considerations

This is a cross-tenant write surface. Its entire safety is one predicate, so the
predicate MUST be the same one every other subsystem uses (HIP-0519). A local
re-derivation of "is this caller privileged" — an `isAdmin` field, a role string,
a trusted header — is how tenant isolation is lost here.

The values are not inert. A routing allowlist decides which models an org's
traffic reaches; a cost ceiling decides what it may spend; the training-contribution
flag decides whether an org's events join a cross-org fit, and its unset state MUST
be treated as opted OUT (`object/org_settings.go:85-93`). Each is a decision an
auditor may ask about, so every write on this capability is a privileged action and
MUST be audited as one (AU-2/AU-12).

The merge semantics are also a safety property: a replace on this table would let
one careless partial write silently return an organization to platform defaults it
had deliberately left.

## References

- HIP-0118 — SuperAdmin & Tenant Isolation Model
- HIP-0519 — One Identity Boundary
- HIP-0521 — Org Hierarchy
- HIP-0027 — Secrets Management Standard

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
