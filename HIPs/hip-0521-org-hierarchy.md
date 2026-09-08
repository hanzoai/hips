---
hip: "0521"
title: Org Hierarchy
author: Hanzo AI Team
type: Standards Track
category: Security
status: Final
created: 2026-07-30
requires: HIP-0026, HIP-0118, HIP-0519
---


# HIP-0521: Org Hierarchy

## Abstract

An Org MAY name one other Org as its **parent**. The edge is the whole feature:
it makes a customer able to sell to their own customers on Hanzo, and it makes a
holding company able to hold several brands under one login and one invoice.

The edge carries authority in exactly one direction. An admin of an org MAY act
on that org's descendants. Nothing flows the other way: a descendant's admin
reaches neither its parent, nor its siblings, nor anything above it. SuperAdmin
is not on this edge at all — it remains membership of the reserved `admin` org
(HIP-0118), and descent from `admin` confers nothing.

Tenant isolation stays exactly where HIP-0118 put it: on the org boundary. A
parent's reach is an authorization decision evaluated per request. It is not a
storage merge, and two orgs never share a store because one owns the other.

## Specification

### 1. The edge

An Org gains one optional field:

    parent  string   // slug of the owning org; empty for a root

The parent relation MUST form a **forest**: every org has at most one parent, and
no org is its own ancestor. An org with no parent is a **root**.

`admin` is a root and MUST NOT be given a parent.

### 2. Ancestry

`ancestors(o)` is the walk from `o.parent` upward, terminating at a root.

Implementations MUST bound the walk at **`MaxDepth = 8`** ancestors and MUST fail
closed — refuse the request — when the bound is reached or a repeat is seen.
Reaching either means the store holds a cycle or a chain deeper than this HIP
permits, and neither is a state in which an authorization answer is meaningful.

`descendants(o)` is never materialized for an authorization decision. Every check
walks upward from the *resource's* org, which is bounded; walking down is
unbounded in the number of tenants and is only for listing.

### 3. The predicate

For an actor A and a resource owned by org R:

    OrgAdmin(A, R)  ⟺  A is an admin member of R
                       ∨  ∃ P ∈ ancestors(R) : A is an admin member of P

`PlatformSudo(A)` is **unchanged and not part of this edge**: membership of the
reserved `admin` org, per HIP-0118 and HIP-0519. It is never inherited, never
conferred by ancestry, and never reached by being `admin`'s descendant.

Admin membership is read from the signed membership set (`orgs`), never from the
`owner` claim — HIP-0519 rule 1. The org slug is compared VERBATIM.

### 4. Creation, not attachment

A sub-org is **born owned**. `parent` is set at creation, by an actor who is an
admin of the parent, and is thereafter **immutable** through every self-service
surface.

Attaching an *existing* org to a parent is a **tenancy transfer**: it hands an
existing tenant's data to a new authority. It MUST NOT be a self-service edit. It
requires SuperAdmin, and it MUST be audited as a privileged action (AU-2/AU-12).

This is the same shape as HIP-0118's "provision, not promote", for the same
reason: the dangerous operation is the one that moves an existing principal into
a scope, so that operation gets the privileged path and the ordinary one does not
exist.

### 5. Isolation

Isolation is unchanged. Every store stays keyed by the org that owns it, and a
parent's access is resolved per request against the predicate in §3. Two orgs
MUST NOT share a store, a key, or a namespace because one owns the other.

A parent reading a descendant's data is a cross-tenant read, and it MUST be
audited as one.

### 6. Billing

A **billing account** MAY be held by an ancestor. The payer for org R is the
account of the nearest ancestor holding one, R itself first; absent any, R has no
payer and metered calls refuse.

The resolved payer MUST be minted into `X-Billing-Account-Id` from signed claims,
with any client copy deleted on ingress — HIP-0519 rule 4. **Who pays is an
identity field**, and this HIP does not change that; it only defines how the
value is found.

Because the payer is resolved by ancestry, setting a parent CAN move who pays.
That is the feature (one invoice), and it is why §4 makes attachment privileged.

## Security Considerations

**Re-parenting is capture.** Attaching an existing org to a parent gives that
parent authority over a tenant's existing data. This is the escalation this HIP
most has to prevent, and §4 is the mitigation: creation only, immutable
thereafter, transfer is SuperAdmin-only and audited.

**Descent from `admin` is not sudo.** A descendant of the reserved org is
administered by it and is otherwise an ordinary tenant. An implementation that
derives SuperAdmin from ancestry converts every sub-org of `admin` into a
platform admin.

**Cycles are a denial of service and an authorization failure.** An unbounded
walk on a cyclic store hangs the request path. §2 requires a bound and a closed
failure; an implementation that treats "depth exceeded" as "not an admin" is
also acceptable, but it MUST NOT treat it as "is an admin".

**Ancestry changes the payer.** A parent edge silently moves the invoice.
Metering MUST record the resolved payer at the time of the call, so a later
re-parent cannot rewrite what was already billed.

**Audit.** Creating a sub-org, transferring one, and any cross-tenant read a
parent performs are each privileged actions and MUST be audited individually
(AU-2/AU-12, AC-6(2)).

## Reference Implementation

Not yet implemented. The predicate belongs in `hanzoai/authz` beside
`OrgAdmin`/`PlatformSudo`, as the one place the estate already asks:

    func (c *Claims) OrgAdminOf(org string, ancestors func(string) ([]string, error)) (bool, error)

`ancestors` is injected because authz is a stateless decision leaf with one
non-stdlib dependency and MUST NOT acquire a store. IAM owns the edge and
supplies the walk.

## References

- HIP-0026 — IAM server: the Org, `owner`, `isAdmin`
- HIP-0118 — SuperAdmin & tenant isolation: the one primitive, the two scopes
- HIP-0519 — One identity boundary: the tenant is `orgs[0]`, not `owner`; who
  pays is an identity field

## Copyright

Copyright and related rights waived via CC0.
