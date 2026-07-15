---
hip: 0128
title: Multi-Org Membership, Org-Switch & Decomplected Billing Accounts
author: Hanzo AI Team
type: Standards Track
category: Security
status: Draft
created: 2026-07-14
requires: HIP-0026, HIP-0111, HIP-0118, HIP-0422
---

# HIP-128: Multi-Org Membership, Org-Switch & Decomplected Billing Accounts

## Abstract

This proposal defines the tenancy and billing lattice for the Hanzo platform and
the wire contract that carries it. It makes three orthogonal moves:

1. **Multi-org membership.** One user identity may belong to its personal org
   AND team orgs. Membership is a first-class `(User × Org × Role)` relation that
   IAM emits into the JWT as the `orgs` claim.
2. **Stateless org-switch at the edge.** The gateway mints `X-Org-Id` from the
   org the client asks to act in, honored only when it is in the token's `orgs`
   set — so a caller can only ever act in, and spend from, an org IAM granted.
3. **Billing decomplected from tenancy.** `BillingAccount` becomes a top-level,
   org-independent primitive. Holders (user, org, project) BIND to accounts,
   possibly several, ordered — so a charge walks a chain and falls to the next
   account on insufficient funds or a declined instrument.

Tenancy answers *who you are and what scope*; billing answers *what funds pay*.
They are joined by a `Binding`, never braided. Projects are create-on-demand: a
user with no project operates at the org level.

This extends HIP-0118 (SuperAdmin & tenant isolation) from a single-org membership
to a set, reuses the identity-header trust boundary of HIP-0026/HIP-0111, and
supersedes the "one org = one billing account" assumption behind HIP-0422.

## Motivation

Tenancy context — org, project, user, funding account — is DRY, stateless, and
belongs on the validated IAM JWT: an app validates the token against the JWKS at
`hanzo.id` and reads tenancy straight from claims, with no extra round-trip, and
`X-Org-Id`/`X-Project-Id` are enforced against the token's own grant so they can
never be spoofed beyond what IAM issued.

The pre-existing model carried this for a **single** org: a user belonged to
exactly one `Owner` org, `X-Org-Id` was always that org, and each org was its own
billing account. Three gaps followed: (a) one person could not be in both a
personal workspace and a team; (b) there was no runtime org-switch to enforce;
(c) billing could not express "this project draws on that account", multiple
funding sources, or overflow/redundancy. This HIP closes all three without
changing the trust boundary.

## The lattice

```
User            one login (JWT sub); a member of >= 1 Org
Org             a tenant.  solo(personal, auto-created at signup) | shared(team)
Membership      (User x Org x Role)  -- the SET of orgs a user may act in
Project         optional container WITHIN an org.  none => org-level scope
BillingAccount  top-level funding source (card | credit pool | invoice). Org-independent.
Binding         (holder in {User,Org,Project}, BillingAccount, priority)  -- ordered
```

A request is a point in this lattice:

```
Scope = { actor  : User            -- sub
        , org    : Org             -- the EFFECTIVE org, in memberships(actor)
        , proj   : Maybe Project } -- none => org-level
```

Billing resolves a chain from the scope:

```
resolveBilling(scope) : [BillingAccount]          -- ordered; walk until one covers the debit
   = bindings(scope.proj) ++ bindings(scope.org) ++ bindings(scope.actor)
     -- most-specific first; the remainder is overflow / redundancy
```

`pays(scope)` is the first account in the chain that can cover the debit; the rest
provide fallback (declined card, drained pool). **Personal billing** is your solo
org's account; **team billing** is a shared org's account; a **project** attributes
to (and may bind its own) account. Who pays follows the org you are acting in.

## Specification

### 1. Membership (IAM)

IAM stores a `Membership` record — natural key `(owner="admin", name="<userId>|<org>")`,
columns `User`, `Org`, `Role in {owner, admin, member}`. A user's HOME org
(`User.Owner`) is an implicit membership; explicit rows add team orgs. Memberships
are written at every org-birth path (signup records the user as owner of its
personal org) and a boot backfill seeds the home membership for every user. It is
tenancy — *which orgs may I act in, with what coarse role* — orthogonal to the
Role/Permission catalog that governs fine-grained authorization within an org.

### 2. The `orgs` claim (IAM → JWT)

Every access-token format carries a bounded membership set, resolved once at mint:

```json
{
  "owner":   "acme-team",          // HOME org (identity + billing anchor)
  "orgs": [                        // membership SET (home first, deduped)
    { "org": "acme-team",    "role": "member" },
    { "org": "alice",        "role": "owner"  }
  ],
  "project": "",                   // absent/empty => org-level
  "sub":     "acme-team/alice"
}
```

`orgs` entries are slug+role only, so the token stays inside the edge request-header
buffer even for a user in many orgs (mirrors the bounded `roles` claim).

### 3. Org-switch enforcement (edge)

A client requests acting in a specific org via the request header `X-Act-As-Org`.
The edge resolves the effective org through ONE predicate:

```
EffectiveOrg(requested) =
    home                              if requested is empty or == home
    canonical(requested)              if requested is in the orgs[] set   (a SWITCH)
    home                              otherwise                           (fail closed)
```

The gateway (and the ingress path) strip any client-supplied identity headers,
then mint `X-Org-Id` from `EffectiveOrg`, keep `X-User-Owner` = the home org, and
consume `X-Act-As-Org` so it never reaches a backend. Consequences:

- No `X-Act-As-Org` ⟹ `X-Org-Id` = home: every non-switching request is unchanged.
- A switch is honored only within the IAM-granted set: a member acts in — and the
  balance gate charges — a team org it belongs to, never one beyond its membership.
- A forged/out-of-set `X-Act-As-Org` fails closed to home: no cross-tenant reach.
- The canonical membership slug is minted, never the client's casing, so storage
  keys never fork.

This is the HIP-0118 tenant-isolation guarantee generalized from a singleton
`{owner}` to the membership set. SuperAdmin (`owner == "admin"`) remains the only
cross-tenant identity and its masquerade path is unchanged; a SuperAdmin's `orgs`
set is just `{admin}`, so this member-switch mechanism never widens it.

### 4. Projects are create-on-demand

An org has no project until a user creates one. `GetDefaultProject` returns the
project the user marked default, or nil; nil ⟹ the `project` claim is absent ⟹
the caller operates at the org level (cloud's principal keys the absent/"default"
project as the org-wide scope, un-suffixed). A named default rides the claim and
narrows the token to that project. There is no auto-seeded "default" project.

### 5. Billing accounts (commerce)

`BillingAccount` is a first-class record with a stable id distinct from the org
slug. `Binding` records `(holderKind in {user,org,project}, holderId, accountId,
priority)`. The money-of-record stays the append-only transaction ledger — only
its subject key changes from "the org slug" to "the account id"; balance stays
derived (no atomic read-modify-write). One resolver, `resolveBilling(scope) ->
[accountId]`, returns the ordered chain; the usage debit and the balance/card gate
walk it, charging the first account that can cover the debit and falling to the
next on insufficient funds or a declined instrument. Backfill gives every existing
org one account and an `org -> account` binding; a personal-billing org also gets a
higher-priority `user -> personal-account` binding, so the prior personal-vs-pooled
subject rule becomes the degenerate default binding set rather than special-case
code.

## Wire contract

| Claim (JWT)       | Header (minted at edge)  | Meaning                                  |
|-------------------|--------------------------|------------------------------------------|
| `owner`           | `X-User-Owner`           | HOME org — identity + billing anchor     |
| `orgs[]`          | (validated at edge)      | membership set; gates the org-switch     |
| —                 | `X-Org-Id`               | EFFECTIVE org (home, or an in-set switch) |
| `project`         | `X-Project-Id`           | project sub-scope; absent ⟹ org-level    |
| `billing_account` | `X-Billing-Account-Id`   | funding attribution hint (commerce resolves the real chain) |
| —  (request in)   | `X-Act-As-Org`           | client's switch INTENT; validated + consumed at the edge |

All identity headers are stripped on ingress and re-minted from validated claims
only (HIP-0026). `X-Act-As-Org` is a request intent, never trusted: it can only
select an org already in the token's `orgs` set.

## Security considerations

- **No spoof beyond the grant.** `X-Org-Id`/`X-Project-Id` derive from validated
  claims; the org-switch is checked against the token's `orgs` set; an out-of-set
  request fails closed to the home org. Tenant isolation (SC-2/AC-4) holds on the
  org boundary.
- **Billing follows the effective org.** A member spends the pool of the org it
  acts in — legitimate because membership is the authorization to consume. Because
  the switch only ever yields an in-set org, no caller can drain an org it does not
  belong to. SuperAdmin masquerade keeps HIP-0118 semantics (bills the admin org,
  not the tenant).
- **Least privilege / separation of duties.** Membership role is coarse tenancy
  (owner/admin/member); fine-grained authorization stays in the Role/Permission
  catalog. Provisioning a SuperAdmin is still creating a user in the reserved
  `admin` org (HIP-0118), never promoting a tenant user.
- **Bounded tokens.** `orgs` carries slug+role only; the token stays within the
  edge header buffer.

## Backwards compatibility

Forward-only. A token without an `orgs` claim (pre-rollout) yields a membership
set of exactly the home org, so `EffectiveOrg` can only ever return home — every
request behaves exactly as before. Existing auto-seeded "default" projects remain
inert (the edge already treated "default" as org-level). Existing single-account
orgs map to one `BillingAccount` + one `org -> account` binding via backfill.

## Reference implementation

- IAM (`hanzoai/iam`): `object/membership.go` (entity + resolver + backfill), the
  `orgs` claim threaded through all four token formats, signup + boot wiring.
- Gateway (`hanzoai/gateway`): `iamauth.Claims.Orgs` + `EffectiveOrg`; both minters
  (gin middleware + `InjectIdentity`) mint `X-Org-Id` through the one predicate.
- Commerce (`hanzoai/commerce`): `BillingAccount` + `Binding` + `resolveBilling`
  chain; the debit and gate walk the chain.
- Projects: create-on-demand across IAM + cloud's `principal`.
