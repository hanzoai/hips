---
hip: 1045
title: Orgs
author: Hanzo AI
type: Standards Track
category: Security
status: Draft
created: 2026-08-20
requires: HIP-0118, HIP-0519, HIP-0521
---

# HIP-1045: Orgs

## Abstract

`/v1/account/orgs` is where a tenant is born. One call creates the caller's
organization, and — on a first run — moves them into it as its admin and mints
its first credential. It is a facet of the `account` capability (HIP-1200),
served by `apps/account` in `hanzoai/cloud` (`apps/account/account.go:716`,
`apps/account/onboarding.go`); the router still serves it at the bare
`/v1/orgs` today, a pair `hanzoai/cloud` `openapi/misfiled.txt` carries.

The org is the tenancy boundary the whole estate is isolated on (HIP-0118), so
this is the one call that creates a boundary rather than acting inside one. Two
things make it correct: the naming policy that decides which names may become a
tenant, and the FIRST-RUN/ADDITIONAL distinction that decides whether the caller
is moved.

## Motivation

Creating an org is privileged identity work — it writes a new tenant and changes a
user's membership — and no browser surface may hold the credential that does it. A
static console, a chat client and a separate identity frontend each growing their
own path to it would be three implementations of tenant creation, which is three
places to get a reserved name or a membership move wrong.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### 1. Naming is a pure function, and it is one

Turning a human name into a tenant slug — lowercase, `[a-z0-9-]`, collapsed,
trimmed, bounded — is a pure decision with no transport and no identity in it
(`apps/account/onboarding.go:55`). It MUST live apart from the handler so the
rules are one testable thing.

A name that normalizes to fewer than two usable characters is refused. A personal
org derives from the caller's username, with an email-like username collapsing to
its local part so the org reads as the person and not their address
(`apps/account/onboarding.go:77`).

### 2. Reserved names

A closed set of slugs MUST NOT become a customer org
(`apps/account/onboarding.go:19`): the identity system's own owners, the brand
and staff orgs that route to the platform's admin surface, and the namespaces the
estate's own code lives under on the forge and in registries.

The last group is the one that was missing, and the reason is worth stating: the
first two read as "our brands", the third reads as somebody's username. An org
holding one of those names is a claim on the estate's own namespace everywhere an
org name addresses a namespace.

### 3. Standing beats the landing

Whether the caller already HAS an organization decides everything below, and
carrying an org identifier is NOT that fact (`apps/account/account.go:687`).

Federated sign-up files a brand-new user under the sign-up application's own
organization, so the very first request a new customer makes already carries an
owner. Read as a home, it sends them down the ADDITIONAL branch, which creates an
org and leaves them outside it.

The rule:

- No org at all — unambiguously a first run.
- An org that is not reserved — a real tenant, theirs, and never to be moved out
  of, whatever standing they hold in it. An invited member creating a second org
  MUST NOT be yanked out of the team that invited them.
- A reserved landing org — read the AUTHORITATIVE identity row: an admin there
  counts as owning it. A SuperAdmin IS a member of the reserved `admin` org, so
  treating that as a landing and moving them out would strip the privilege
  (HIP-0118).

Only the identity service may attest to that standing; a request header would let
a caller elect their own move. An unresolvable standing MUST fail closed, because
the permissive answer is the one that MOVES the user.

### 4. First run and additional

FIRST RUN creates the org, moves the caller in as its admin, and mints the org's
first credential. It SHOULD be one atomic provision rather than a create-then-move
pair, so a retry mid-flight converges on the founder's own org instead of orphaning
it (`apps/account/account.go:801`).

ADDITIONAL creates the org and does NOT move the caller. A move rewrites their
membership — stripping a SuperAdmin's standing and orphaning their current org —
so reaching a second org is a scope switch, never a membership change.

A personal-org request from someone who already has an org is meaningless and is
refused as a conflict.

### 5. The credential is revealed once

The credential minted with a first-run org travels back on THAT response and
nowhere else. The identity service stores only its digest and blanks the
plaintext, so the secret exists in readable form exactly once: in the answer to the
call that minted it. Dropping it there leaves a customer holding an account whose
credential has been issued and can never be obtained. A replay mints nothing and
therefore reveals nothing.

The org starts at a zero balance. Usage is prepaid, so there is no signup grant.

### 6. Slug collisions

A personal org auto-suffixes to stay unique. An explicitly requested name that is
taken is an HONEST conflict the person resolves by choosing another; it MUST NOT
be silently suffixed, because the name they typed is the one they will look for.

### 7. What else lives under this address

Nothing. Creation is the only operation this facet owns; a sub-resource about
an org — its entitlements, for instance — is served by the capability that owns
it, under that capability's own address (`/v1/entitlements/orgs/{org}`,
HIP-1202), authorized against the org in the path being the caller's own.

## Rationale

The alternative to server-side naming policy is client-side validation, which is
how a reserved name eventually gets through: there are several clients and only
one of them is checked. The policy is a pure function on the server, and every
client's check is advisory.

The atomic provision replaced a create-then-move pair for one measured reason: the
pair has a window in which an org exists with no admin, and a retry in that window
creates a second one.

## Security Considerations

This call creates a tenancy boundary, so its failure modes are boundary failures.
A reserved-name escape puts a customer on a slug that addresses staff surfaces or
the estate's own namespaces. A membership move applied to someone who already has
standing removes that standing — including platform standing, which is exactly the
SuperAdmin/org-admin conflation HIP-0118 refuses.

Standing is therefore read from the authoritative identity row and never from a
request, and an unresolvable read refuses. The permissive branch here is the
destructive one, which is the case where fail-closed is not a preference.

The first-run credential is a bearer value in a response body: it MUST be revealed
once, never persisted in the clear, and never re-derivable from a replay.

## References

- HIP-0118 — SuperAdmin & Tenant Isolation Model
- HIP-0519 — One Identity Boundary
- HIP-0521 — Org Hierarchy
- HIP-0026 — Identity & Access Management Standard
- HIP-1200 — Account — The Caller's Own Surface
- HIP-1202 — Entitlements — What an Org May Run

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
