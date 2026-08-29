---
hip: 1041
title: Authz
author: Hanzo AI
type: Standards Track
category: Security
status: Final
created: 2026-08-20
capability: authz
requires: HIP-0026, HIP-0139, HIP-0519
---

# HIP-1041: Authz

## Abstract

`/v1/authz` is the access decision as a service: one question — may this subject
take this action at this path — answered yes or no. The decision itself is
`github.com/hanzoai/authz`, a pure library every Hanzo Go service links; the HTTP
surface is that library's `serve` package, mounted by `hanzoai/cloud`.

The surface is STATELESS. It holds no policy store, and a check carries the grants
it is to be decided against. IAM signs the grant set, so IAM owns it, and a second
writable copy behind this endpoint would be a second source of truth for who may do
what (`serve/mount.go:23-28`).

## Motivation

Two services that each decide access their own way disagree eventually, and the
disagreement is silent until it is a breach. The decision is therefore one
function in one library, and this capability exists for the callers that cannot
link it — a service in another language, or a caller that wants the answer without
the grants leaving the process that already holds them.

Making it a service is the small part. Keeping it from accumulating a policy
store is the whole design.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### 1. The calculus

A **Path** locates a resource as ordered segments, the first of which is the org.
A **Grant** is one access fact: a subject holds a role everywhere at or below a
scope path, until an expiry. A **Verb** is `read` or `write`, derived from the
HTTP method by one mapping so no caller can disagree with IAM about whether a
method writes (`grant.go:106`).

Roles are exactly three — `member`, `admin`, `owner` — because IAM's membership
vocabulary is exactly three. `member` admits `read`; `admin` and `owner` admit
both, folded because IAM assigns `owner` to whoever creates an org and a table
matching only `admin` would refuse every founder their own org
(`grant.go:128-129`). An unknown role admits nothing.

The predicate: subject may act iff some grant it holds has a scope covering the
target and a role admitting the verb, evaluated at the current instant
(`grant.go:177`). It FAILS CLOSED — no subject, no target, or an empty grant set
is a denial.

Narrower authority is expressed as a NARROWER GRANT, never a new role. A
delegation to an agent and a credential that expires are this same value with a
smaller scope and a set expiry; neither is a separate mechanism (`grant.go:149`).

### 2. The org is the frame, and it is verbatim

A check MUST carry the gateway-minted org. A request with no org MUST be REFUSED
rather than decided against an empty or default scope: collapsing tenants together
is the one failure a decision service must not have.

Both the target path and EVERY grant scope MUST have that org as their first
segment, and the comparison is verbatim (`serve/mount.go`). An org is a
tenant-chosen identifier, so it is never case-folded — unlike a role, which is a
closed vocabulary IAM controls.

### 3. What this surface does not do

It MUST NOT store policy, mint grants, or read a grant set of its own. Everything
it decides against arrives in the request, which is what makes the answer a pure
function of its inputs and the service safe to run anywhere.

Two artifacts around the endpoint disagree with that today, and both are the endpoint's
problem rather than the library's. The fleet manifest routes a `policies` prefix
here that nothing registers — a name resolving to no handler. And the prose
published for the check describes a stored per-org policy set and a three-field
body, where the mounted handler takes the grants in the request
(`serve/mount.go:49-58`, `hanzoai/authz` v1.10.31). A description of state this
surface does not hold is worse than no description: it tells an integrator to look
for a policy API that was deliberately not built.

### 4. Liveness reads no tenant

The liveness and readiness reads are unauthenticated and never org-scoped. They
report a property of THIS PROCESS, and a probe that needed a tenant would fail for
reasons that have nothing to do with the process being alive
(`plugin/authz/main.go`, the `Describe` prose).

### 5. The surface, whole

Three routes, and no others: `POST /v1/authz/check`, `GET /v1/authz/health`,
`GET /v1/authz/readyz` (`serve/mount.go:31-44`). None is a typed operation, and
none can be: authz is a leaf module that must never import cloud, so both seams
a subsystem normally types through are closed to it, and each operation is
instead DECLARED — prose registered beside the route
(`plugin/authz/main.go:28-49`). §3 records that the check's declared prose is
currently wrong; the defect is in the prose, not the contract.

The capability owns no store (§3 is why). It is FREE — no meter, no debit
through any plane (`plugin/authz/main.go`, `Price: cloud.Free`). It publishes
no event, so a customer's webhooks receive nothing from it. It emits nothing to
observability beyond the request span every route already gets. Its stage is
`ga`. It derives from no outside project: `github.com/hanzoai/authz` is our own
leaf, and nothing in it forks, embeds or mirrors an upstream.

### 6. The registry predicate is a different question

Authority over IAM's own identity rows — who may mint a credential, who may
administer a user — is a SECOND predicate over entities addressed by
`(owner, name)`, with a reserved-owner gate and a per-client capability allowlist
(`entity.go`). It is not expressible as a location and MUST NOT be folded into
the grant calculus. Two questions, two predicates, no overlap.

## Rationale

The alternative is the ordinary one: a policy engine with stored policies per
tenant, and a CRUD surface to edit them. It puts the authority to grant authority
behind this endpoint, which means this endpoint is now identity infrastructure and must be
protected as such — while IAM, which signs the memberships, still holds its own
copy. Keeping the store in one place and passing the grants costs a slightly
larger request body and removes the whole class.

The pure decision stays in a leaf module that links no HTTP stack and no driver,
so adding a caller costs nothing (`serve/mount.go:1-6`). Speaking HTTP is I/O and
lives in its own package.

## Security Considerations

The caller supplies the grants, so the ONLY thing standing between a caller and a
forged authority is the org frame: every scope is verified to be at or below the
caller's own validated org before it can admit anything. A decision service that
accepted grants scoped anywhere would be a "may I?" oracle that answers whatever
the asker prefers.

Failing closed matters more here than usual. An empty grant set, an expired grant
and a malformed path all deny, so a caller cannot produce an allow by sending
less.

Liveness answering while every tenant's state is cold is deliberate and is not an
authorization surface: it discloses that a process is running and nothing about
who may do what.

## References

- HIP-0026 — Identity & Access Management Standard
- HIP-0519 — One Identity Boundary
- HIP-0106 — The Hanzo Plugin Contract

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
