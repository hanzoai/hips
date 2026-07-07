---
hip: 0118
title: SuperAdmin & Tenant Isolation Model
author: Hanzo AI Team
type: Standards Track
category: Security
status: Draft
created: 2026-07-07
requires: HIP-0026, HIP-0044, HIP-0068, HIP-0111
---

# HIP-118: SuperAdmin & Tenant Isolation Model

## Abstract

This is the one and only authorization model for the Hanzo platform. It defines a
single primitive — the **Org** (tenant) — and exactly two admin scopes over it,
which MUST NEVER be conflated:

- **Org admin** (`isAdmin`, org-scoped) — a customer administering *their own* org
  on Hanzo IAM. Self-service. Not platform-privileged. The 99% path.
- **SuperAdmin** (`owner == "admin"`, membership of the reserved `admin` org) — the
  Hanzo *platform* sudo scope. The only cross-tenant identity, and the only one
  admitted to `admin.hanzo.ai` and every raw admin surface.

There is **one predicate, one source of truth**: an identity is a SuperAdmin *if
and only if* its IAM `owner` claim equals the reserved admin org slug (`admin`).
The edge gate, the console, and every subsystem evaluate the same predicate against
the same claim. Trusting a per-org `isAdmin` flag for platform-level gating is a
privilege-escalation bug, not an alternative implementation.

Adding a SuperAdmin is **provision, never promote**: an existing SuperAdmin creates
a *new named user in the `admin` org*. A tenant user is never moved or promoted into
`admin`. Together these rules make tenant isolation a property of the `owner`
boundary and make platform privilege an auditable, individually attributable,
separately-provisioned account.

HIP-0026 defines the IAM server (the Org, the `owner` field, the `isAdmin` flag).
HIP-0111 defines how a client obtains and reads the `owner` claim. This HIP defines
what those two values *authorize*. Where they touch, this HIP is authoritative on
the authorization decision.

**Reference implementation**: `~/work/hanzo/gateway/cmd/admin-guard/main.go`
**The predicate**: `owner == adminOrg` (`adminOrg` default `"admin"`, env `IAM_ADMIN_ORG`)

## Motivation

The estate is multi-tenant IAM-as-a-service: one IAM (Auth0/WorkOS-class) serves
every brand and every customer. Customers do not fork or run their own IAM; they get
an org and administer it themselves. In that world the dangerous question is not "is
this user an admin?" but "an admin *of what?*". Every serious multi-tenant breach is
a confusion of those two words. This HIP exists to make the answer unambiguous and
mechanical, and it is written against the specific privilege-escalation classes it
prevents:

1. **Flag-for-scope confusion.** A per-org `isAdmin` flag means "admin of my own
   org." If any platform surface gates on `isAdmin` alone, then *any* customer who is
   admin of *their own* org — which every self-service customer is — is admitted to
   the platform's cross-tenant surfaces. This is the highest-severity escalation:
   tenant admin → platform admin, reachable by design rather than by exploit. The
   fix is a *different claim*, not a stronger check on the same one: platform scope
   reads `owner`, never `isAdmin`.

2. **Self-promotion.** If becoming a platform admin is a mutation on an existing
   tenant user (set a bit, add a role, join a group), then whoever can perform that
   mutation — or replay it, or find it under-guarded on one of N subsystems — escalates
   themselves. Provision-not-promote removes the mutation entirely: there is no bit to
   flip; SuperAdmin is a distinct account in a distinct org, created only by an existing
   SuperAdmin.

3. **Ambient dual-membership.** A single human legitimately holds *both* a brand-org
   identity (their day-to-day org-admin account) and, separately, a platform
   SuperAdmin account. If a login silently resolves to whichever org is convenient, a
   routine session can acquire platform scope by accident. The model forces the admin
   org to be *explicitly* selected at authentication time and refuses to mint a
   platform session for any other resolved org.

4. **Silent tenant fallback.** A consumer that fails to read `owner` and then defaults
   to a `"default"`/`"personal"`/empty org has just merged every unscoped request into
   one tenant — a cross-tenant read/write. Isolation on the `owner` boundary MUST fail
   closed (HIP-0111 §5), never fall back.

All four vanish under one primitive, two non-conflatable scopes, one predicate, and
provision-not-promote. That is this standard.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as in
RFC 2119.

### 1. The one primitive — the Org

The **Org** (tenant) is the only isolation primitive. Every user, application,
credential, and datum belongs to exactly one Org, named by the IAM `owner` field
(HIP-0026 schema: `organization`, `user`, `application` are all keyed on
`owner + name`). Customer hierarchies (a customer's own sub-customers, B2B2C) are
modeled as **Orgs owned by Orgs**, not as a second privilege axis. There is no tenant
concept above or beside the Org. "Scope every query to `owner`" (HIP-0111 §5) is the
concrete meaning of tenant isolation, and it is the same sentence at every layer.

### 2. The two scopes — never conflated

| Scope | Predicate | Means | Surface | Who |
|-------|-----------|-------|---------|-----|
| **Org admin** | `isAdmin == true` (per-user, in that user's own org) | "admin OF YOUR OWN org" — manage your org's users, apps, and sub-orgs | `console.hanzo.ai` (self-service) | Every self-service customer. The 99% path. |
| **SuperAdmin** | `owner == "admin"` (membership of the reserved admin org) | Hanzo **platform** sudo — the only cross-tenant scope | `admin.hanzo.ai` + every raw admin surface | A small, named, separately-provisioned set. |

The two are **orthogonal**, and conflating them is a defect:

- Org admin is **not** a subset-or-superset of SuperAdmin; it is a *different axis*.
  A user can be an org admin of `acme` and hold no platform scope; a SuperAdmin is a
  member of `admin` and needs no `isAdmin` bit anywhere to exercise platform scope.
- `isAdmin` MUST be used **only** for decisions *within a single org* (can this user
  edit their org's users/apps). It MUST NOT be read by any platform-level or
  cross-tenant gate.
- `owner == "admin"` MUST be the **only** basis for admitting an identity to a
  cross-tenant or raw-admin surface.

### 3. The one predicate — one source of truth

An identity is a SuperAdmin if and only if:

```
owner == AdminOrg          // AdminOrg is the reserved org slug, default "admin"
```

`owner` is the IAM org claim carried, per HIP-0111 §5, identically in the JWT and the
OIDC userinfo response, in every token format, scope-independent. The predicate is
evaluated from that claim and nothing else. Concretely:

- The **edge gate** (admin-guard, §7) evaluates it in `decide()`.
- The **gateway** propagates the resolved org as `X-Org-Id` (HIP-0044); downstream
  subsystems read `X-Org-Id` and apply the *same* predicate for any platform action,
  and scope every tenant query to it.
- The **console** shows platform-admin affordances under the *same* predicate.

There MUST be exactly one predicate, spelled the same way everywhere. A subsystem that
invents its own platform-admin test (a bespoke role name, a hardcoded email allowlist,
a `groups` claim, a per-org `isAdmin`) is non-conformant even if it "works," because it
drifts from the single source of truth and becomes an independent escalation surface.

Standard nomenclature is **SuperAdmin**. The terms "GlobalAdmin" / "global admin" MUST
NOT be used in new code, config, or docs; existing occurrences (including IAM
`IsGlobalAdmin` and the admin-guard docstrings, §7) are the legacy spelling of this
exact predicate and are to be renamed to SuperAdmin — a nomenclature migration, not a
logic change.

### 4. The reserved `admin` org

`admin` is a reserved org slug. It is not a customer tenant and MUST NOT be issued to
one. Its sole purpose is to be the set whose membership *is* platform privilege. Its
name is configurable at the edge (`IAM_ADMIN_ORG`) for white-label parity, but the
deployed value is fixed per network and known to every gate; the default is `admin`.
Because SuperAdmin ⟺ membership of this org, the org's member list is the platform's
complete, single-surface roster of privileged accounts — the object of periodic access
review (§Security, AC-2(3)).

### 5. Provision, not promote

Adding platform privilege is a *creation*, never a *mutation*:

- **SuperAdmin** — an existing SuperAdmin creates a **new named user in the `admin`
  org**: `iam user create --owner admin`. The account is individually named and
  attributable. A brand-org user is **never** moved, copied, or promoted into `admin`;
  doing so duplicates an identity across orgs and destroys separation of duties.
- **Org admin** — the org's *own* admin sets `isAdmin` on a member of *their* org.
  This never crosses the org boundary and never touches platform scope.

A human who needs both scopes holds **two accounts by design**: their brand-org
identity (e.g. the seeded `z@hanzo.ai`, an org admin) and a separate SuperAdmin account
in `admin`. This dual identity is a feature — routine work carries only tenant scope;
platform scope is a deliberate, separate login.

### 6. Surfaces — `admin.hanzo.ai` vs `console.hanzo.ai`

Two surfaces, one predicate deciding between them:

- **`admin.hanzo.ai` and every raw admin surface** — the platform-operator surfaces:
  `platform.hanzo.ai`, studio, commerce-admin, the raw KMS admin UI, the IAM management
  UI. These are admitted to **SuperAdmin only**, gated by the admin-guard ForwardAuth
  middleware (§7) in front of `hanzoai/ingress` (HIP-0068). No raw admin surface is
  ever exposed without the gate.
- **`console.hanzo.ai`** — the unified client surface for *everyone*: org admins and
  ordinary members alike, each scoped to their own org. This is where self-service
  lives.

The routing rule is total and dead-end-free: an authenticated identity that is **not**
a SuperAdmin is sent to `console.hanzo.ai`, never shown a `403` wall on a raw admin
surface (browser clients). Only a non-browser API caller receives a status code
(`403`/`401`) instead of a redirect, so automation gets a clean signal. An anonymous
browser is sent to interactive IAM PKCE login (HIP-0111), not to a dead end.

### 7. Authentication into the admin scope

Entry to the SuperAdmin scope is standard OAuth2 Authorization-Code + PKCE `S256`
against IAM (HIP-0111), with the reserved admin org **pinned** on the authorization
request (`organization=admin`). Pinning is mandatory and load-bearing: a human who is a
member of *both* a tenant org and `admin` MUST resolve to their `admin` identity for the
platform login, otherwise the login defaults to their home org and is correctly denied.
The callback MUST refuse to mint a platform session for any resolved `owner != admin`
(it redirects such an authenticated identity to `console.hanzo.ai`); it mints the
SuperAdmin session only when the validated token's `owner` equals the admin org.

Identity MAY be resolved from more than one transport (a signed edge session cookie, a
Bearer/Basic JWT, an IAM SSO session), but all transports MUST collapse to the single
§3 predicate. No transport may widen the scope.

## Rationale

**Why `owner == admin`, not `isAdmin`.** `isAdmin` answers "admin of my own org" — and
in a self-service platform *every customer is that*. Gating platform scope on `isAdmin`
therefore grants platform scope to the whole customer base. `owner` answers "which
tenant is this identity," and the reserved `admin` tenant is, by construction, the only
one that is not a customer. Reading `owner` makes the platform-privileged set a small,
explicit, enumerable org rather than an emergent property of a boolean that means
something else. The two claims are different questions; the model refuses to answer the
platform question with the tenant answer.

**Why provision, not promote.** Promotion is a mutation, and every mutation is an
escalation surface: it can be replayed, under-guarded on one of N subsystems, or
performed by anyone who can edit a user. Provisioning has no such surface — there is no
"make me admin" operation to attack, because platform privilege is *membership of an
org you must be separately created in*. It also preserves separation of duties (AC-5):
the tenant-facing identity and the platform-facing identity are distinct accounts with
distinct credentials and distinct audit trails, so a compromise of a customer's
day-to-day admin account yields no platform scope.

**Why one predicate, spelled once.** N independent "is this an admin?" tests are N
places to drift and N independent escalation surfaces. Collapsing every gate — edge,
gateway, console, subsystem — onto the identical claim comparison means there is exactly
one thing to reason about and audit, and adding a subsystem adds no new authorization
logic, only the same predicate over the same header.

## Security Considerations

This model is the control that implements the following NIST SP 800-53 Rev. 5
requirements; the mapping is the compliance contract (SOC 2 / FedRAMP):

| Control | Requirement | How this HIP satisfies it |
|---------|-------------|---------------------------|
| **AC-6(5)** | Privileged accounts restricted to designated personnel | SuperAdmin is *membership of the reserved `admin` org* (§4), a distinct account set — not a flag on a tenant user. The privileged population is exactly the admin-org roster. |
| **AC-5** | Separation of duties | Provision-not-promote (§5): platform identity and tenant identity are separate accounts. No single account holds both scopes; the two admin scopes are orthogonal and never conflated (§2). |
| **AC-2 / IA-2** | Account management; unique identification & authentication (incl. MFA) | SuperAdmins are individually named users created in `admin` (§5), each attributable; authentication is OIDC + PKCE with WebAuthn/MFA available per HIP-0026. No shared or anonymous platform account. |
| **AC-6(2) / AC-6** | Least privilege; non-privileged access for non-security functions; JIT / break-glass | Dual identity (§5) means routine work uses the org-admin account (tenant scope only); the SuperAdmin account is used only to operate the platform — least privilege by default, break-glass by deliberate separate login. |
| **AU-2 / AU-12** | Auditable events; audit record generation | The edge gate emits the resolved org downstream (`X-Org-Id`) for app-side auditing of every privileged action (§7, reference impl); because privilege is a single predicate over a single claim, every privileged decision is uniform and loggable. |
| **AC-2(3)** | Disable / review accounts | The `admin` org membership (§4) is the single review surface — one list enumerates every platform-privileged identity for periodic access review; deprovisioning is removal from that org. |
| **SC-2 / AC-4** | Application partitioning; information-flow enforcement | Tenant isolation is the `owner` boundary (§1): every query is scoped to `owner`, the gateway propagates it as `X-Org-Id`, and cross-tenant flow exists only under the single SuperAdmin scope. Reading `owner` MUST fail closed, never fall back to a default org (HIP-0111 §5). |

Additional considerations:

- **Fail closed on the boundary.** Any consumer that cannot resolve `owner` MUST reject
  the request. Falling back to a `"default"`, `"personal"`, or empty org silently merges
  tenants and is a reportable isolation defect (SC-2/AC-4).
- **API vs browser asymmetry is intentional.** Non-browser callers fail closed with a
  status code; browsers are redirected to the correct surface. Neither path ever widens
  scope; the asymmetry is only in *how* denial is delivered.
- **The admin org name is not a secret.** Security rests on IAM authentication and org
  membership, not on the obscurity of the slug. `IAM_ADMIN_ORG` is configuration for
  white-label parity, not a credential.
- **No customer runs IAM.** Customers are tenants of one multi-tenant IAM; they cannot
  mint their own `admin`-org membership because they do not operate the issuer.

## Reference Implementation

`~/work/hanzo/gateway/cmd/admin-guard/main.go` is the canonical enforcement point: a
single ForwardAuth gate consumed by `hanzoai/ingress` (HIP-0068) at
`GET /__guard/verify`, in front of every raw admin surface. It is the concrete,
production form of §3, §6, and §7.

- **The predicate (§3).** `decide()` admits the caller only when
  `owner != "" && owner == c.adminOrg`; on match it sets `X-Org-Id` and
  `X-Admin-Guard: allow` and returns `204`. `adminOrg` is loaded from `IAM_ADMIN_ORG`,
  default `"admin"`. This is the one source of truth; the docstring states it verbatim:
  *"ONE predicate, one source of truth."*
- **Dead-end-free routing (§6).** An authenticated non-SuperAdmin browser is redirected
  to `console.hanzo.ai` (`302`); a non-browser caller gets `403 "global admin required"`;
  an anonymous browser is sent to IAM PKCE login. No raw admin `403` wall for browsers.
- **Org pinning + callback refusal (§7).** `startLogin()` sets `organization=adminOrg`
  on the authorize request so a dual-member resolves to their admin identity;
  `handleCallback()` refuses to set a session when `owner != adminOrg` and redirects to
  the console instead.
- **Transports collapse to one predicate (§7).** Identity is resolved from three
  orthogonal sources — the guard's signed session cookie, a Bearer/Basic JWT validated
  through `iamauth` (the JWT already carries `owner`, so no IAM round-trip), and an IAM
  session cookie resolved via `get-account` — all funneling into the same
  `owner == adminOrg` test. No source widens scope.

**Nomenclature migration (§3).** The file currently uses the legacy spelling — the
docstring says "GLOBAL ADMINS ONLY" and refers to IAM `IsGlobalAdmin`. The *logic* is
already this standard exactly (`owner == c.adminOrg`); the *identifiers and prose* are
to be renamed to SuperAdmin (IAM `IsGlobalAdmin` → `IsSuperAdmin`, console
`useIsGlobalAdmin` → `useIsSuperAdmin`). This is a rename, and it changes no decision.

## References

1. [HIP-0026: Identity & Access Management Standard](./hip-0026-identity-access-management-standard.md) — the IAM server: the Org primitive, the `owner` field, the `isAdmin` flag.
2. [HIP-0111: Hanzo IAM Authentication Standard](./hip-0111-iam-authentication-standard.md) — how a client obtains and reads the `owner` claim; the fail-closed tenant rule (§5).
3. [HIP-0044: Hanzo Gateway Standard](./hip-0044-api-gateway-standard.md) — JWT validation and `X-Org-Id` propagation to subsystems.
4. [HIP-0068: Ingress Standard](./hip-0068-ingress-standard.md) — the ForwardAuth mechanism the admin-guard plugs into.
5. [HIP-0027: Secrets Management Standard](./hip-0027-secrets-management-standard.md) — KMS-managed secrets for privileged surfaces.
6. `~/work/hanzo/gateway/cmd/admin-guard/main.go` — the reference implementation of the predicate and the two surfaces.
7. [NIST SP 800-53 Rev. 5](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final) — AC-2, AC-4, AC-5, AC-6, IA-2, SC-2, AU-2, AU-12 (the control families mapped above).
8. [FedRAMP](https://www.fedramp.gov/) and SOC 2 — the compliance regimes the NIST mapping serves.

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
