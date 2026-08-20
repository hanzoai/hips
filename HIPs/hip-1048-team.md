---
hip: 1048
title: Team
author: Hanzo AI
type: Standards Track
category: Application
status: Draft
created: 2026-08-20
capability: team
requires: HIP-0026, HIP-0106
---

# HIP-1048: Team

## Abstract

`/v1/team` is the shared workspace: the login and membership control plane, the
live document plane clients connect to, the workspace file store, and the roster
that includes an organization's agents. It is served by `apps/team` in
`hanzoai/cloud`.

Its identity domain membership is not a filing accident. The thing this capability
actually owns is WHO IS IN A WORKSPACE — the rows that authorize every other plane
under this address — and the org each workspace belongs to.

## Motivation

A workspace surface accretes credentials: it has its own sessions, its own tokens,
its own idea of who a member is. Every one of those is a second identity system,
and a second identity system is a second place a member can be admitted after the
first one revoked them.

So there is ONE identity seam here, one answer to "who is calling and what may they
touch", shared by every surface under the address (`apps/team/account.go:943`). No
surface reads a claim off a credential for itself, and therefore no surface can
disagree with another about who is calling.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### 1. Tenancy is a column, enforced on every query

A workspace belongs to exactly one org, and that org is a column on the row. Every
read and every write MUST be scoped to the caller's VERIFIED org
(`apps/team/account_store.go:32`, `:65`). Composite uniqueness is on
`(org, slug)` and `(workspace, user)`, so two orgs may hold the same workspace name
and neither can address the other's.

The membership rows ARE the authorization. On the identity lane nothing about a
workspace is signed, so what a caller may touch is decided per request against
those rows and never by a claim the caller carries
(`apps/team/account.go:958-962`).

### 2. Two lanes, and one of them carries no credential out

A caller resolves either from a verified identity token — narrowed to this
deployment's own audience — or from a token this service minted itself.

On the identity lane the credential MUST NOT leave the resolution: the session RPC
echoes a token back to page script, and an identity access token is an
estate-wide bearer that reaches every other service. The login flow puts it in an
HttpOnly cookie precisely so script cannot read it; echoing it would hand it back
to the script the flag exists to keep it from. The lane therefore carries no
credential out at all, structurally, so a future echo site cannot reintroduce the
leak by forgetting (`apps/team/account.go:976-992`).

The minted arm exists because one read still answers for "the workspace the
credential pins", and the identity lane pins none. Removing it is a client change:
the client names the workspace and the server authorizes it against the rows, the
way the document and file planes already do.

### 3. No signing secret means health only

When the signing secret is unset or is the public default, the subsystem serves
HEALTH ONLY: every route under the address answers 503 and NO token is ever
decoded or accepted (`apps/team/team.go:293`). A forged token cannot be used
because nothing verifies one.

Mount MUST still SUCCEED. Erroring at mount fails the whole composition and takes
every other subsystem in the binary down with it; refusing at the route is the
same safety with none of the blast radius.

The refusal MUST be applied per route and MUST NOT wrap the liveness probe. A
prefix-wide middleware risks catching it, and a degraded subsystem that also
reports itself dead cannot be diagnosed.

### 4. The file plane repeats the boundary physically

A workspace blob's key embeds org, workspace and blob id
(`apps/team/files.go:289`), so an identifier from another org or another workspace
does not resolve. The caller MUST additionally be asserted a MEMBER of the named
workspace — not merely same-org — before anything is stored or served, and every
denial is a 404, so the plane is neither a membership oracle nor an existence
oracle.

Three independent layers for one property is deliberate: the verified org, the
membership assertion, and the key shape.

### 5. Login's billing check fails open, and says so

The single chokepoint every client passes on its way into a workspace asks whether
the org's plan licenses this product. Two kinds of "no" are distinguished
(`apps/team/entitle.go`):

- Cannot verify — an infrastructure absence — ADMITS. A login gate that fails
  closed during an outage bricks every session mid-rollout.
- A definitive "no entitlement" currently OBSERVES: it logs the denial and
  admits, because self-serve checkout does not exist yet and refusing sends a
  person to a dead end. Enforcement returns when the self-serve path ships.

This is stated in the specification rather than left in a comment because it is a
live posture with a date-stamped reason, and a reader MUST NOT assume the presence
of a gate implies enforcement.

### 6. Agent replies are off unless an operator opts in

The workspace's automated responder is DISABLED by default, and the model seam is
wired only when explicitly enabled (`apps/team/team.go:113-119`). An
unconfigured or misconfigured binary is provably inert: with no responder wired,
no outbound model call can fire.

### 7. The document plane's wire is fixed

The live document transport carries one message per frame in the platform's own
envelope, negotiates a text encoding, and pins the model version it reports. It is
a data plane over an already-resolved caller, and it MUST NOT re-derive identity of
its own.

## Rationale

Membership could be read from a signed claim in the workspace token, which is
faster and needs no store lookup. It is also stale by construction: a member
removed from a workspace keeps their claim until it expires. Rows read per request
cost a query and revoke immediately.

Holding one file per org rather than one per workspace keeps a single writer per
deployment and lets the org column carry isolation. The store is encrypted at rest
by a handle the caller opens, rather than by the object mapper opening its own —
the mapper's own configuration carries no master key, so letting it open the file
would write every workspace, membership and display name as plaintext
(`apps/team/account_store.go:43-49`).

## Security Considerations

The identity lane's no-echo rule is the sharpest edge here: one unauthenticated-
looking RPC that returned the caller's identity token would put an estate-wide
bearer into page script. The property is structural — the lane's credential field
is empty by construction — and MUST stay structural rather than becoming a rule
each new surface remembers.

The degraded posture is a security feature, not an outage behaviour: without a real
secret, accepting a token is accepting a forgery, so the subsystem refuses to
decode one at all.

Tenant isolation rests on the verified org, never on a client-supplied header, and
is repeated in the key shape of the file plane so a single missed predicate is not
a cross-tenant read. Every denial across these planes is the same 404 for the same
reason: a distinguishable refusal is an oracle for what exists and who belongs.

## References

- HIP-0026 — Identity & Access Management Standard
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0519 — One Identity Boundary

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
