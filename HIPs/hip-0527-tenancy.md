---
hip: "0527"
title: Tenancy
author: Hanzo AI Team
type: Standards Track
category: Security
status: Draft
implementation-go: partial
created: 2026-09-29
requires: HIP-0026, HIP-0118, HIP-0519
---

# HIP-0527: Tenancy

## Abstract

Four questions decide every request: is this person a SuperAdmin, may they act in
this org, which org are they acting in, and who pays. Today IAM, cloud, ai,
commerce, the gateway and seven sites each answer some of them, from different
inputs, and disagree. This HIP defines each answer once, as a total function of an
append-only log of facts IAM holds — founded, invited, accepted, assigned,
revoked, switched, assumed — computes all four in IAM, signs them into the token,
and makes every other component a reader.

Four things that were braided come apart. The directory `id` is where a person's
login lives and grants nothing. The `admin` org is where SuperAdmins live and
nothing else. An org is a tenant, and access to one comes only from founding it or
accepting an invitation to it. Every person has an org of one that is their
wallet; `hanzo` is Hanzo Inc's own org, joined by membership like any other.

`implementation-go: partial`: IAM already decides SuperAdmin on the account row,
records assume and invitation acceptance on its platform-written trail, and mints
the `orgs`, `billing_account` and `type` claims. §4 lists what goes, §5 is the
migration, and §8 is what an implementation must satisfy before it merges.

## Motivation

Measured across the code that serves production today (§4 names every site):

- **SuperAdmin** is tested four ways: the account's own org (IAM), the first entry
  of `orgs` (cloud, authz), `admin` anywhere in `orgs` (the JS SDK, gateway's authz
  pin), and the `owner` claim — which names the application's org, not the
  person's (console, commerce, the gateway guards, ai's fallback). Two sites count
  every member of eight "paid" orgs as a SuperAdmin.
- **Membership** is three different sets inside IAM alone — the token's, the
  principal's and the memberships list — and sites read whichever they found.
  Access is granted three ways: founding, accepting, and a direct write any org
  admin (or a plane op, or hanzo.team's sign-in) can make. Of 421 live membership
  rows none carries an invitation.
- **The acting org** is a client header that five components resolve against the
  signed set with different fallbacks, and three of them let a SuperAdmin enter any
  org by header, off IAM's audited assume.
- **The payer** is resolved in more than a dozen places. The rule that decides it
  turns on the org's name: in `hanzo` a member pays from a personal wallet inside
  Hanzo Inc's own ledger, anywhere else from the org's pool. Customers who signed up
  through Hanzo's application act inside Hanzo Inc's workspace.
- **Where a login lives** is the org it founded: onboarding moves the account and
  re-keys it, stranding tokens, memberships and keys filed under the old address.

Every one of these is the same defect: a question with more than one answer.

## Specification

### 1. Formal core

**Types.**

    Account   an identity that signs in, keyed by `sub` (opaque, immutable)
    Org       a tenant, keyed by its slug (immutable)
    Dir     = {id, admin}                where an account lives
    Reserved= {admin, id, org, app, iam} namespaces no one is a member of
    Role    = owner > admin > member
    kind    : Account → {person, program}
    owner   : Account → Dir              set at creation, never changed (I12)
    personal: Org → Bool                 set at creation
    ns      : Record → Reserved ∪ Org    the namespace a record is filed under

`id` is the directory: every account that is not a SuperAdmin — every person,
whichever way they signed in, and every program (service account) — lives there,
and living there confers nothing. `admin` holds the SuperAdmin accounts and
nothing else — no org, application, key, token, certificate or audit row — so an
id that begins `admin/` names a SuperAdmin and nothing else can. An org with its
own identity provider is still an ordinary org: it admits people through that
provider, it does not own them.

Every record has exactly one namespace:

    ns(x) = admin    x is a SuperAdmin account
          = id       x is any other account, person or program
          = o        x belongs to org o: its memberships and roles, invitations,
                     projects, workspaces, teams, keys, its own applications and
                     identity providers
          = org      x is an organization record          (id org/<slug>)
          = app      x is a platform application          (id app/<name>)
          = iam      everything else IAM keeps: platform certificates and
                     providers, sign-in challenges, federation states, audit
                     rows no org owns, and every per-account record (tokens,
                     sessions, codes, factors, passkeys, chain wallets),
                     keyed by the account's `sub`

**Facts.** IAM holds one append-only log `F`. Tenancy has no other state: every
membership, role, acting org and payer IAM serves is a fold over `F`.

    founded(a, o, by, t)        a holds new org o; by ∈ {a} ∪ SuperAdmins
    invited(n, o, m, r, by, t)  invitation n into o for mailbox m with role r
    accepted(a, n, t)           a, proving mailbox m (or o's own IdP), took n
    assigned(a, o, r, by, t)    role change for an existing member
    revoked(a, o, by, t)        a's access to o ends; by = a is leaving
    assumed(a, o, t)            SuperAdmin a enters o for support
    released(a, t)              a leaves the org it assumed
    switched(a, o, t)           a picks o as the org it acts in, on every surface
    appointed(a, p, by, t)      SuperAdmin account a created for person p by `by`
    dismissed(a, by, t)         SuperAdmin account a disabled
    moved(a, from, id, t)       the one migration that sets owner(a) := id (§5)

**Predicates.** Each is a total function of `F`, computed in IAM and nowhere else.

    superadmin(a)  ⇔ owner(a) = admin ∧ kind(a) = person ∧ ¬dismissed(a)

    role(a, o)     = the last fact about (a, o) among founded, accepted, assigned,
                     revoked, read as: founded ↦ owner, accepted(n) ↦ r(n),
                     assigned(r) ↦ r, revoked ↦ ⊥;  ⊥ when there is none
    member(a, o)   ⇔ role(a, o) ≠ ⊥
                   ⇔ (founded(a,o) ∨ ∃n. accepted(a,n) ∧ org(n) = o)
                      ∧ no revoked(a,o) after the last of them        (a person)

`assigned` has two uses and one rule: for a person it changes the role of an
existing member; for a program it is the only way in, written by an owner or
admin of `o` when they create the program. Nothing else writes a role.

`role(a, o)` is a fact about the pair and nothing else. It is filed in `o`'s
namespace with the rest of `o`'s data; no attribute of the account — no
`isAdmin`, type, tag or group — enters it, and nothing about one org enters
another. "Org admin" means `role(a, o) ∈ {owner, admin}` for that one `o`.

    home(a)        = ιo. founded(a,o) ∧ personal(o)   if kind(a) = person ∧ owner(a) = id
                   = ιo. member(a, o)                  if kind(a) = program
                   = ⊥                                 if owner(a) = admin
    orgs(a)        = [home(a)] ⧺ sort{ o | member(a,o), o ≠ home(a) }     (⊥ omitted)

    acting(s)      = assumed(s)              if assumed(s) ≠ ⊥
                   = switched(a(s))          if member(a(s), switched(a(s)))
                   = home(a(s))              otherwise
    payer(s)       = hanzo                   if assumed(s) ≠ ⊥
                   = acting(s)               otherwise

    ledger(o)      = the commerce account org:o
    platform       = Σ o∉Reserved (paid(o), spent(o), owed(o) = paid(o) − spent(o))

`s` is a token family of account `a(s)`. `switched(a)` is the account's latest
switch and follows the person across every surface; `assumed(s)` belongs to the
one token family that assumed. `payer(s) = ⊥` (a SuperAdmin outside assume)
refuses every metered call. `hanzo` is Hanzo Inc's own org: support work is
Hanzo's cost, never the customer's. `platform` is a view Hanzo's books compute —
`owed` is the liability Hanzo carries for customer prepaid — and never an account.

**Invariants.** Each is checked on every write and nightly on live data (§7).

    I1  superadmin(a) ⇔ owner(a) = admin ∧ person ∧ ¬dismissed(a) nothing else confers it
    I2  superadmin(a) ⇒ ∀o. role(a, o) = ⊥, so orgs(a) = []       SuperAdmins hold no org role
    I3  member(a, o) ⇒ o ∉ Reserved                               the directory confers nothing
    I4  person ∧ owner(a) = id ⇒ ∃! o. founded(a, o) ∧ personal(o) one org of one per person
    I5  personal(o) ⇒ |{a | member(a, o)}| = 1                    no one is invited into it
    I6  o ∉ Reserved ⇒ ∃! a. founded(a, o)                        every org has one founder
    I7  o ∉ Reserved ⇒ ∃a. role(a, o) = owner                     no org without an owner
    I8  owner(a) ∈ {id, admin};  owner(a) = admin ⇒ person        no org owns an account
    I9  payer(s) = ⊥ ∨ member(a(s), payer(s))
          ∨ payer(s) = hanzo ∧ assumed(a(s), acting(s)) ∈ F       payer is a membership or audited support
    I10 every ledger account is org:o;  a deposit into org:o by b
          ⇒ member(b, o) ∨ superadmin(b)                          no customer money in hanzo's ledger
    I11 subscription x ⇒ org(x) ∈ Org \ Reserved                  a plan attaches to a real org
    I12 owner(a) is written once                                  accounts never move (except §5)
    I13 readers read claims, never predicates                     one computation site (§2)
    I14 ns(x) = admin ⇒ x is an account ∧ superadmin(x)           nothing else lives under admin/
    I15 role(a, o) is a function of the facts about (a, o) alone  org admin is scoped to its org
    I16 superadmin(a) reads owner(a), kind(a), dismissed(a) only  no role makes a SuperAdmin
    I17 no account carries an admin flag                          isAdmin is not an attribute
    I18 owner(a) = admin ⇒ ∃ appointed(a, p, by, t) ∈ F
          ∧ (superadmin(by) at t ∨ by = genesis ∧ admin = ∅ at t) only an appointment makes one
    I19 creating a writes only founded(a, home(a)) (person)
          or nothing (program)                                    creation grants nothing
    I20 kind(p) = program ⇒ |orgs(p)| ≤ 1                          a program acts in one org

I15 and I16 are the non-implications, stated as independence: adding any fact
about `(a, o)` leaves `role(a, o′)` unchanged for every `o′ ≠ o`, and leaves
`superadmin(a)` unchanged. So `role(a, o) = admin` implies neither
`superadmin(a)` nor `role(a, o′) = admin`. `assumed` is not a role fact: it enters
neither `role` nor `orgs`, and it is the only way a SuperAdmin acts in an org.

A person becomes a member in exactly two ways, founding and accepting; a program
in one, being assigned by the admin who creates it. There is no other: no grant,
no backfill, no row a script writes. Sign-in through an org's identity provider
is accepting — the provider binding is a standing invitation the org's owner
wrote, and the provider's assertion is its proof — and SCIM deprovisioning is
`revoked`.

### 2. Where each answer lives

IAM computes the four predicates once, at mint, and signs them. Everyone else
reads.

| question | IAM computes | carried as | reader asks (`hanzoai/authz` `Claims`) |
|---|---|---|---|
| SuperAdmin? | `superadmin(a)` from the account row | `owner` = owner(a), `type` | `Sudo() = Owner == "admin" && Type != "application"` |
| member of o? | `member(a, o)`, `role(a, o)` from `F` | `orgs` = orgs(a), `[{org, role}]` | `Role(o)`, `Member(o)` = o ∈ `orgs`; `OrgAdmin(o)` = `Role(o)` ∈ {owner, admin} |
| acting org? | `acting(s)` | `org`; `assumed` when support | `Org()` |
| payer? | `payer(s)` | `billing_account` = `org:<payer>` | `Payer()` |

- `owner` states where the account lives — `id` or `admin`. It never names the
  application's org.
- `orgs` never contains a reserved org and never contains an assumed org.
- The edge's `X-User-IsOrgAdmin` is `OrgAdmin(org)` for the acting org only. No
  token and no userinfo answer carries an account-level `isAdmin`.
- `org` is the only acting org. The edge mints `X-Org-Id` from it and deletes any
  client copy (HIP-0519). No surface sends an org selection in a header.
- `billing_account` is the only payer. `X-Billing-Account-Id` is minted from it.
- Revocation takes effect at the next mint. Every first-party application's
  access-token lifetime is at most one hour, so `revoked` bites within one hour
  everywhere, with no check outside IAM.
- **The one check.** Every authorization decision anywhere is one of two
  shapes, and nothing else:

      allow(s, platform)     = superadmin(a(s))
      allow(s, o, need)      = role(a(s), o) ⊇ need
                             ∨ superadmin(a(s)) ∧ assumed(s) = o

  A resource declares which shape it takes. No check reads an account's `owner`,
  namespace, admin flag or founder, an org's `founder`, or a list position;
  `superadmin` is the one function that reads `owner`. A SuperAdmin holds no role,
  so outside an assume a SuperAdmin passes no org check (I2). The edge mints an
  acting org for a SuperAdmin only from `assumed`, so a gate written as
  `IsSuperAdmin(c) || IsOrgAdmin(c)` (HIP-0519) computes exactly this.
- API keys: a key is minted for one (account, org) pair. IAM re-evaluates
  `member(a, o)` on every resolution (`GET /v1/iam/keys/principal`) and names `org:o` as
  payer; a revoked member's key stops resolving at once.

### 3. One way per flow

**Signup.** `POST /v1/iam/signup` creates account `a` in `id` and, in the same
transaction, org `p` with `personal(p)` and `founded(a, p, a)`. Where the account
signs up — which host, which brand, which application — changes the page, never
the account. With an invitation code it also records `accepted(a, n)`.

**Sign-in.** An identifier resolves in exactly one directory: `admin` for the
admin console's application, `id` for everything else. An email whose domain an
org has claimed signs in through that org's identity provider. The token's `org`
is `home(a)` until the person switches.

**Create an org.** `POST /v1/iam/organizations {name, displayName}` by a signed-in
person records `founded(caller, o, caller)` and writes `o` with `personal = false`.
`founder` and `isPersonal` are never read from a request. A SuperAdmin provisioning
an org for a customer names the customer: `founded(customer, o, superadmin)`, on
the privileged trail. Nobody founds an org into `admin`, and a SuperAdmin never
founds one for themself (I2).

**Invite.** `POST /v1/iam/invitations {org, email, role}` by an owner or admin of
`o`, with `role` no higher than the inviter's, records `invited(n, o, m, r, by)`
and mails a single-use code IAM mints. One invitation names one mailbox and admits
one account. Personal orgs refuse invitations (I5).

**Accept.** `POST /v1/iam/invitations/accept {owner, code, emailCode}` by the
signed-in account whose verified mailbox is `m` records `accepted(a, n)`. The row
and the fact are one write.

**Revoke / leave.** `POST /v1/iam/delete-membership {user, org}` by an owner or
admin of `o`, or by the member themself, records `revoked(a, o, by)`. The last
owner cannot be revoked (I7). A personal org is never revoked; it ends with its
account.

**Role.** `POST /v1/iam/memberships {user, org, role}` by an owner or admin
records `assigned(a, o, r, by)` for an account that is already a member, and is
refused for anyone who is not. It never creates access.

**Switch.** `POST /v1/iam/switch {org}` records `switched(a, o)` and re-mints the
caller's token with `org = o` and `billing_account = org:o` when `member(a, o)`,
and answers 403 otherwise. `{org: ""}` returns to `home(a)`. Every other surface
picks the switch up at its next mint. The switcher lists `orgs` from the token it
holds.

**Support entry / exit.** `POST /v1/iam/assume {org}` by a SuperAdmin re-mints
their token with `org = assumed = o` and `billing_account = org:hanzo`, and
records `assumed(a, o)` on the privileged trail, filed under `o` so the tenant
reads who was in it. `orgs` is unchanged. `POST /v1/iam/release` re-mints with
`org = ⊥`. Assume is the only way a SuperAdmin reaches an org.

**Pay.** Every metered request debits `billing_account`. A top-up credits the
acting org's ledger. There is one ledger kind, `org:<slug>`; no person ledger, no
signup-org rule. Hanzo's books (`/v1/books`) derive the platform ledger — paid,
owed, spent per org, and customer prepaid as a liability — from every org's
transactions; it is a view, never an org's wallet.

**Enterprise SSO.** An org owner binds an identity provider to `o` (the provider
row is `o`'s) and claims email domains; the binding is a standing invitation with
a role mapping, default `member`. First sign-in through it creates `a` in `id`
with its personal org, like any signup, and records `accepted(a, n_p)`. SCIM
delete records `revoked(a, o)`. The org controls access to itself and how its
domain signs in; it does not own the account.

**Appoint a SuperAdmin.** `grantSuperAdmin(actor, target)` — the one operation
that creates an account in `admin` — requires `superadmin(actor)`, names the
person `target` (their `id` account) and records `appointed(a, target, actor)`
on the privileged trail. It creates a new account; it never moves or promotes
one. `revokeSuperAdmin(actor, a)` records `dismissed(a, actor)`. The first
SuperAdmin comes from the seed's declared roster, by the same operation with
`actor = genesis`, only while `admin` is empty (I18).

**Create a program.** `POST /v1/iam/service-accounts {org, name, role}` by an
owner or admin of `o` creates `p` in `id` and records `assigned(p, o, r, actor)`
with `r` no higher than the actor's role. A program acts in that one org (I20).

**SuperAdmin visibility.** The admin console lists every org and every account
(`GET /v1/iam/organizations`, `GET /v1/iam/users`), each org's roster
(`GET /v1/iam/memberships?org=`) and ledger, and the platform ledger. Every such
request is on the SuperAdmin trail. Reading is listing; acting inside an org is
`assume`, which grants no role — the tenant's roster never shows a SuperAdmin.

### 4. Delete list

Read at: IAM `v1.34.120` (the version cloud embeds); `hanzoai/authz` `v1.10.42` (gateway and commerce
standalone still pin `v1.10.29`); `hanzoai/account` `v0.3.3`; cloud main
`e1fd16bfd7`; ai `v1.833.256`; commerce `v1.50.133`; gateway main `4bac62d2`;
`@hanzo/iam` main `c64df2d8`; chat `2898607b`; id `5755e9c9`; team `bb72a186`;
ai app `fdb4d419`; ide `52a7e493`; console `a042daa3`; cli `380c43c6`.
Tags: **[IAM]** changes IAM, **[edge]** changes the identity boundary,
**[bug]** is a live defect today and should not wait for the rest.

**4.1 IAM — the one computation site, made to compute each thing once**

| where | what goes | replaced by |
|---|---|---|
| `internal/oidc/jwt.go:332`, `:389` | `owner` and `organization` claims = the application's org | `owner` = owner(a); `organization` deleted **[IAM]** |
| `internal/oidc/userinfo.go:78`, `:81`, `:93` | userinfo `owner` = app org; `organization`; `isAdmin` | `owner` = owner(a); the other two deleted **[IAM]** |
| `pkg/store/membership.go:366-384` | `MemberOrgRefs`: implicit home ref from the user row, then every raw row | `orgs(a)`, the fold over `F` **[IAM]** |
| `pkg/store/membership.go:413-418` | `HomeRole`: role from `User.IsAdmin` | `role(a, o)` **[IAM]** |
| `pkg/schema/user.go:116` | `User.IsAdmin` as an authority (org admin by account flag) | `role(a, o)`; the field deletes after §5 **[IAM]** |
| `pkg/store/membership.go:311-330` | `BackfillMemberships` (nothing calls it) | — **[IAM]** |
| `pkg/store/membership.go:405-408`, `internal/memberships/memberships.go:206-208`, `:233` | `IsHomeOrg` and "home org is not revocable": access implied by where the account lives | home is a founded org; I3 **[IAM]** |
| `pkg/store/membership.go:220-271` | `MemberByIdentifier`: sign-in at an org's app reaches people homed elsewhere | sign-in resolves in one directory (§3) **[IAM]** |
| `internal/memberships/memberships.go:141-170` | `ensure`: `POST /v1/iam/memberships` creates access for a person | `assigned` for existing members only **[IAM]** |
| `internal/memberships/memberships.go:131` | `GET ?user=` answers raw rows, a second org set | answers `orgs(a)` **[IAM]** |
| `internal/authz/authz.go:798`, `:839-854` | principal's `Admin` from `User.IsAdmin`; `membershipRoles`: raw rows, a third org set | `role`, `orgs(a)` **[IAM]** |
| `internal/oidc/provision.go:139-141`, `:177-189`, `:266-270` | first-run gate; moving the caller into the org (re-keys the account); dropping the old row | found, never move (I12) **[IAM]** |
| `internal/oidc/onboard.go` (whole) | `POST /v1/iam/onboard`, the second way to create an org | `POST /v1/iam/organizations` **[IAM]** |
| `internal/oidc/onboard.go:113` | `POST /v1/iam/admin/provision`: a service token moves a named person into an org | — **[IAM]** |
| `internal/bootstrap/bootstrap.go:67`, `:514` | `POST /v1/iam/admin/users/upsert` creates accounts in any org, `admin` included, and sets `isAdmin` | deleted; `admin` accounts come only from `grantSuperAdmin` (§8) **[IAM]** |
| `internal/oidc/signup.go:328`, `:378-391`, `:398-450`; `internal/oidc/invite.go:31-36` | signup lands in the application's org; `charter`/`Charter` move it; `Registers`; `orgChoiceMode` | signup lands in `id` and founds `home(a)` **[IAM]** |
| `pkg/schema/application.go:160` | `OrgChoiceMode` | — **[IAM]** |
| `internal/oidc/federation.go:471`, `:592` | federated accounts land in the application's org | `id`; an org's own provider adds `accepted` for that org **[IAM]** |
| `internal/organizations/organizations.go:149`, `:198` | create/update copy `founder` and `isPersonal` from the request body | server-set from the verified caller **[IAM] [bug]** |
| `internal/oidc/masquerade.go:158-160` | assume appends the org to `orgs` as `admin` | `org` = `assumed`; `orgs` unchanged (I2) **[IAM]** |
| `internal/oidc/invite.go:171` | every accepted invitation grants `member` | the invitation's role **[IAM]** |
| `pkg/schema/invitation.go:33-46` | `IsRegexp`, `Quota`, `UsedCount`, `Application`, `Username`, `Phone`, `SignupGroup`, `DefaultCode` | one mailbox, one role, one use **[IAM]** |
| `pkg/store/billing.go:37-63` | `BillingAccount`: shape rule, personal wallet inside the signup org — and a plain member of any other brand org (a self-signup through `lux-app`) spends that brand's pool | `billing_account` = `org:payer(s)` **[IAM] [bug]** |
| `internal/oidc/token.go:362-374` | `granted`: programs acting in orgs other than their own | a program acts in the org that owns it **[IAM]** |
| `pkg/schema/organization.go:111-114` | `OrgBalance`, `UserBalance`, `BalanceCredit`, `BalanceCurrency` mirrors | money lives in commerce **[IAM]** |
| `pkg/store/membership.go:29` and org rows filed under `admin` | the registry namespace shares the SuperAdmin org's spelling, so an org id prints as `admin/<slug>` and reads as a SuperAdmin account | §4.6 **[IAM]** |
| branch `orgs` (`c9a9a3d18`) | `Joined` + roster rows that confer nothing: one table, two meanings | not merged; this HIP supersedes it |

**4.2 Reader libraries — read, never compute**

| where | what goes | replaced by |
|---|---|---|
| authz `claims.go:185-190` | `Home()` = `orgs[0]`: payer and authority braided with list order | `Org()` reads `org` |
| authz `claims.go:220-225` | `Machine()` = empty `orgs`; a SuperAdmin with `orgs = []` would read as a machine | `Program()` reads `type` only |
| authz `claims.go:277-279` | `Sudo()` via `Home()` | `Owner == AdminOrg && !Program()` |
| authz `claims.go:285-287`, `:299-316` | `opens`; `OrgAdmin` via `IsAdmin && Home()` | `Role(o)` from `orgs` |
| authz `claims.go:320-343` | `EffectiveOrg`, including `:329-331`: a SuperAdmin enters any org by header, off the audited trail | `Org()`; entry is `assume` only **[bug]** |
| authz `claims.go:352-361`, `:370` | `LedgerOrg`; `Location` through `EffectiveOrg` | `Payer()`; `Location` through `Org()` |
| authz `claims.go:491` | reserved set lacks `id` | add `id` |
| authz `edge/edge.go` `Strip` | captures client `X-Org-Id` as a selection | delete it; `Render` mints from `Org()` **[edge]** |
| authz `v1.10.29` `claims.go:210-230`, `:263-280` (gateway, commerce pin) | `PlatformSudo` = an `admin` membership at any position; any member may select `admin` | the one `Sudo()` **[bug]** |
| account `account.go:56`, `:79`, `:285-328` | `SignupOrg`, `Person` accounts, the `Payer` shape rule | `Parse(billing_account)` |
| account `org.go:81-133` | `EffectiveOrg`, `LedgerOrg` (a third copy) | claims |
| account `account.go:240` | `IsMachine` over `User.Type` strings | `type` claim |

**4.3 Cloud — the edge mints from claims; nothing behind it decides**

| where | what goes | replaced by |
|---|---|---|
| `middleware_identity.go:231-238` | `cliOrg`: the client's org selection | — **[edge]** |
| `middleware_identity.go:252`; `auth_identity.go:326-338` | `homeOrg()`; a machine JWT's home read from the `owner` claim | `owner`, `org` claims **[edge]** |
| `middleware_identity.go:340-344`; `auth_identity.go:490-501` | `Acts`: a SuperAdmin may act anywhere by header | `org` claim **[edge] [bug]** |
| `auth_identity.go:475-477` | sudo = `Home() == "admin"` | authz `Sudo()` **[edge]** |
| `apps/principal/principal.go:705-723` | `BillingOrg` recomputed | `billing_account` |
| `apps/principal/wallet.go:201-204` | `PayerFrom` drops `billing_account` | `billing_account` **[bug]** |
| `apps/account/billing_coresident.go:56-95` | `PinBillingSubject` through the `Payer` shape rule | `billing_account` |
| `apps/gateway/gateway.go:143-150` | a SuperAdmin targets `?org=` | `assume` |
| `apps/platform/apps.go:660-690` | `resolveOrg`: a SuperAdmin names another org | `assume` |
| `token_validator.go:34-37`, `:69-72`, `:118-199` | `VerifiedIdentity.Owner` and `Home()` recomputed beside the boundary | claims |
| `metered_ai.go:103`, `:134`, `:190`, `:211`, `:264-269` | internal AI calls build a payer from a bare org (the pool; `hanzo` for signup-org callers) | `billing_account` |
| `apps/agents/conversation.go:207`, `:395-406` | agent turns bill `X-User-Owner`, not the acting org | `billing_account` **[bug]** |
| `apps/billing/typed.go:45-67`; `billing.go:357`, `:428-440`; `balance.go:46` | balance and usage read the acting org while a support debit lands elsewhere | `billing_account` |
| `apps/team/account.go:519-522`, `:581-637`; `account_store.go:293`, `:319-414`, `:478-489`; `backfill.go:30-59` | hanzo.team adds the `owner`-claim org to the session as `admin`, writes IAM owner grants on sign-in, and keeps its own membership model | token `orgs`; no writes on sign-in **[bug]** |
| `apps/team/invite.go:120-163`, `:253-270` | invites are direct `POST /v1/iam/memberships` grants to people already in the org | IAM invitations |
| `apps/iam/members_rpc.go:166-186`; `roles_rpc.go:53-125` | the `grant` plane op (`EnsureMembershipIn`, unbounded role); standing recomputed from the store | — ; `orgs` **[bug]** |
| `apps/account/account.go:804-1016`; `onboarding.go:19-52`; `iam.go:85-123`, `:455-462` | `POST /v1/account/orgs`: first run moves the person via `admin/provision`; an additional org gets no member; the personal slug derives from the UUID | `POST /v1/iam/organizations` **[bug]** |
| `apps/account/embed.go:139` | acting org = brand org entitles every self-serve signup to the shared CMS, ERP and helpdesk | entitlement from subscriptions **[bug]** |
| `reader.go:45-53`; `apps/commerce/catalog_rpc.go:39`; `sale_rpc.go:285` | in-process commerce calls stamped `X-User-Owner = admin`; plane ops admit `Org == admin` rather than SuperAdmin | the plane's stated caller; `Super` |
| `apps/plan/plan.go:144`, `:184` | entitlements always read tenant `hanzo` | the acting org |
| `cli/auth.go:121-124`; `cli/cli.go:255-261`; `cli/gpu.go:1585-1590`; `internal/iam/exchange.go:127-155` | stored org and `studio_active_org` from the `owner` claim; an unverified `Session.Owner` | `org` claim |

**4.4 ai, commerce, gateway — behind the edge, reading headers**

| where | what goes | replaced by |
|---|---|---|
| ai `internal/iam/jwt.go:91-93`, `:111-118` | `homeOrg` overwrites `User.Owner` from `orgs[0]`, else the `owner` claim | edge headers |
| ai `util/permission.go:83-88`, `:99-101` | org admin by `IsAdmin`, a user type or a tag; SuperAdmin = `Owner == "admin"` with no machine check | `X-User-IsOrgAdmin`, `X-User-IsAdmin` |
| ai `controllers/org_resolver.go:152-266`; `routers/org_resolver.go:38-68` | two acting-org resolvers that disagree, a billing resolver, and `IAM_ORG` fallback | `X-Org-Id`, `X-Billing-Account-Id` |
| ai `controllers/openai_api.go:142-160`, `:193`, `:229-233`, `:297-305`; `internal/iam/payer.go:30-53`; `routers/filter_balance.go:538-637`, `:841-851`; `controllers/finetune.go:457` | payer computed five ways, one of them billing `hanzo` for an agent key | `X-Billing-Account-Id` |
| ai `controllers/zap_native.go:386-412` | a `user` field in the body replaces the caller's billing subject: any signed-in caller reads any org's balance | the caller's own payer **[bug]** |
| ai `controllers/zap_application-deploy.go:121`; `zap_chat-graph-crud.go:920`; `controllers/base.go:168-173`; `conf/app.conf:22` | inline `Owner == "admin"` then a client owner honoured; raw `X-Org-Id`; `IAM_ORG = "hanzo"` | edge headers; no principal refuses |
| commerce `auth/iam.go:205-276`, `:488`, `:524` | its own JWT validation (skips an empty `iss`), SuperAdmin from the `owner` claim | edge headers (HIP-0519) **[bug]** |
| commerce `middleware/edgeauth.go` (whole) | `X-User-Owner` = `X-Org-Id` = the `owner` claim | the edge **[bug]** |
| commerce `pkg/auth/middleware.go:81-84`; `middleware/accesstoken.go:105-123`, `:148-157` | `iam_authenticated = true` when `X-Org-Id` is merely present | edge headers **[bug]** |
| commerce `middleware/iammiddleware/iammiddleware.go:68-71`, `:252-258` | `X-User-IsAdmin` counted as org admin; `X-User-Owner == "admin"` grants the Admin bit | the two headers, kept apart |
| commerce `api/billing/resolve.go:49-59`; `balance.go:22-99`; `metering/middleware.go:159-166` | payer from `account.Payer`, `?user=` from the caller, raw headers | `X-Billing-Account-Id` |
| commerce `api/billing/tier.go:26-35`; `webhooks.go:142-145`; `checkout/org_resolver.go:302-311`; `metering/env.go:61` | `PaidEcosystemOrgs`; `"hanzo"` as the default org | tier from subscriptions; no default org |
| gateway `cmd/admin-guard/authz.go:64`, `:77-104`; `main.go:299` | SuperAdmin from the `owner` claim with case-fold and trim; `X-Org-Id` = `owner` | authz `Sudo()`, verbatim; `org` claim |
| gateway `cmd/admin-api/handlers.go:49`; `sources.go:172`, `:273`; `cmd/waitlist-guard/main.go:229`, `:285` | the same, three more times, plus `IsAdmin \|\| owner == admin` | authz `Sudo()` |
| gateway `middleware/auth.go:55-58`; `authpolicy.go:261-265`; `router_kms.go:82-85` | a present `X-Org-Id` trusted; a per-user `<org>/<sub>` billing key; `GATEWAY_KMS_ORG = "hanzo"` | edge headers; `billing_account`; acting org |

**4.5 Sites — one switcher, reading the token**

| where | what goes | replaced by |
|---|---|---|
| `@hanzo/iam` `src/auth.ts:196` | SuperAdmin = `orgs` includes `admin` (breaks at §5 step 9) | `owner == "admin"` and not a program |
| `@hanzo/iam` `src/react.ts:186-187`, `:501-530` | current org in `localStorage`; `switchOrg` without a check | `POST /v1/iam/switch`; the token's `org` is current |
| `@hanzo/iam` `src/types.ts:114-115`; `src/react.ts:1510` | unread `isAdmin`/`isGlobalAdmin`; top-up link with no org | —; top-up names the acting org |
| chat `src/data/session.tsx:132-149`; `src/brand.ts:136` | the account response's `owner` as the org; brand org as a default org | token `org`; brand is presentation |
| id `pages/Account.tsx:73-76`, `:97-103`, `:116`; `account/Organizations.tsx:7-12` | org list from `GET /v1/iam/memberships?user=` with an `owner` fallback; an unchecked stored org | token `orgs`, `org`; `POST /v1/iam/switch` |
| id `pkgs/onboarding/src/service/onboarding.ts:109-130`, `:200`; `pages/Account.tsx:76` | `POST /v1/iam/onboard`; role from `isAdmin` | `POST /v1/iam/organizations`; role from `orgs` |
| id `apps/account/src/worker.js:823`; `pkgs/shared/src/org.ts:55`; `account/Apps.tsx:17`; `pages/Portal.tsx:102`, `:142` | `owner \|\| 'hanzo'`; billing for the brand org | acting org |
| id `pages/Signup.tsx:12-19` | `/signup` ignores `invite` | reads it, or links go to `/join` **[bug]** |
| team `hooks/useTiers.ts:48-57`, `:103-104` (same in ai app) | "superAdmin" = any member of eight paid orgs | `Sudo`; tier from subscriptions **[bug]** |
| team `lib/auth/session.ts:172-212`, `:233-240` (ai app `:365-464`) | a second `orgs` decoder, `X-Org-Id` scope, `pick()` | token `org`; `POST /v1/iam/switch` |
| team `lib/hanzo/team.ts:66-78`; `Contacts.tsx:586-587`; `Orgs.tsx:423-424` | browser-made invite code; `/signup?invite=` links hanzo.id drops | IAM-minted code; `/join` **[bug]** |
| team `Orgs.tsx:369-373` (ai app `:352-356`); `Account.tsx:307` | `POST /v1/account/orgs`, a third way to create an org; a link to `/orgs/new`, which does not exist | `POST /v1/iam/organizations` |
| team `Shell.tsx:2021-2022`, `:2206`; `lib/plans.ts:95-97` (ai app `plans.ts:102-104`, `Orgs.tsx:42-45`, `:386`) | acting org = display name, fallback `hanzo`; checkout names no org | token `org` |
| ai app `components/account/AccountLayout.tsx:140`; `OrgSwitcher.tsx:163-165`, `:319-320` | a switch the AI client never hears; a `hanzo` fallback | one switch through IAM **[bug]** |
| ide `src/hanzo/iam.ts:55-81`; `src/hanzo/account.ts:39`, `:81-95`, `:164-181` | org list from userinfo `owner` + memberships; a picker nothing listens to | token `orgs`, `org`; `POST /v1/iam/switch` |
| console `lib/api/account.ts:73-82`, `:191` | `owner` from the JWT claim, then `organization`, then the `sub` prefix, then the brand org — on an admin host a UUID `sub` makes the UI SuperAdmin | `owner` claim alone **[bug]** |
| console `lib/org-scope.ts:27-29`, `:57-60`, `:119-173`; `lib/api/client.ts:92`; `base-data/api.ts:228`; `csrf.ts:208` | its own org state (brand org default) and `X-Org-Id` on every call | token `org`; `switch` / `assume` |
| console `OrgPicker.tsx:145-179`; `ContextSwitcher.tsx:121-129` | org list from the memberships API; a switcher that shows only the current org | token `orgs` |
| console `components/products/TeamModule.tsx:169-184`; `lib/api/team.ts:133-141` | "invite" creates an account owned by the org (an I8 violation); "remove" deletes the account | IAM invitations; `delete-membership` **[bug]** |
| console `OrgOnboarding.tsx:60-70`; `lib/api/billing.ts:387-388`, `:545-550` | `POST /v1/iam/onboard`; balance and top-up for the brand org by default | `POST /v1/iam/organizations`; acting org |
| cli `crates/client/src/http.rs:25`, `:98` | `--as` sent as `X-Org-Id` | `POST /v1/iam/switch`, one cached token per org |

**4.6 Records filed under `admin`**

IAM inherited one owner for every platform record, so today `admin/` prefixes
org ids, membership ids, platform applications and more. Each moves to its
namespace in §1 (I14); every lookup that names `admin` for a non-person record
goes with it.

| where | filed under `admin` today | moves to |
|---|---|---|
| `internal/oidc/provision.go:152`, `:158`; `pkg/store/store.go:864`; `internal/organizations/organizations.go:135-136`; `internal/organizations/list.go:177`, `:206`; `pkg/store/store.go:837-846` | every organization record, `admin/<slug>` | `org/<slug>` |
| `pkg/store/membership.go:29`, `:86` | every membership row, `admin/<user>\|<org>` | `<org>/<sub>`, the org's own data |
| `internal/bootstrap/bootstrap.go:261`, `:307`, `:331`, `:345`; `internal/seed/seed.go:99`, `:189`, `:212`, `:370`; `internal/oidc/mint.go:118`; `internal/featurestore/featurestore.go:87`; `pkg/store/store.go:686`; `server/server.go:261` | platform applications, and "platform" decided as owner = `admin` | `app/<name>`; platform = owner `app` |
| authz `claims.go:460` (`signingOwners`); seed `certs` | the seven platform signing certificates | `iam`; `signingOwners` = {`iam`} |
| `pkg/store/store.go:816-820`; `internal/oidc/federation.go:658-663` | platform identity providers, and the default provider owner | `iam` |
| `internal/oidc/challenge.go:57` | sign-in challenges | `iam` |
| `pkg/schema/federation.go:31` | federation states for platform providers | `iam` |
| `internal/oidc/token.go:338` (`machineToken` row), `internal/oidc/masquerade.go:168-177` | token rows of platform programs and of SuperAdmins | `iam`, keyed by `sub` |
| `internal/authz/authz.go:569-600`; `internal/oidc/masquerade.go:225-235` | the SuperAdmin trail and tenantless audit rows | the org acted on, else `iam` |
| sessions, verification codes, factors, passkeys, chain wallets of SuperAdmins | per-account records keyed `<owner>/<name>` | `iam`, keyed by `sub` (all accounts, §5 step 10) |
| authz `entity.go:172-173`, `:196-197` | `MemberOf(admin)` and `AdminOf(admin)` answer `Sudo`: a SuperAdmin reads as a member of an org | reserved namespaces have no members (I3) |
| authz `claims.go:491` | reserved set {`admin`, `built-in`, `app`} | {`admin`, `id`, `org`, `app`, `iam`}; `built-in` leaves once empty |
| console `lib/api/team.ts:93-105`, `lib/api/admin.ts:164-190`, `OrgPicker.tsx:131`, `:165`, `lib/account/org-state.ts:31`; ai app `organization/page.tsx:135`, `:260`; id `pkgs/auth/src/client.ts:940`; gateway `cmd/admin-api/sources.go:356-357` | org and application records addressed as `admin/<name>` | the slug: `/v1/iam/organizations/<slug>` |
| cloud `reader.go:45-53`; `cron/workflows.go:135`; `apps/commerce/catalog_rpc.go:39`; `sale_rpc.go:285` | `admin` stated as the platform's own tenant on internal calls | an explicit SuperAdmin caller; never an org named `admin` |

**4.7 Account-level admin flags**

Org admin is `role(a, o)` and nothing else (I15, I17). Every place that reads an
admin bit off the account, or infers org admin from where the account lives,
goes. Rows already in §4.1–4.5 are listed there: `pkg/schema/user.go:116`,
`pkg/store/membership.go:413-418`, `internal/authz/authz.go:798`,
`internal/oidc/userinfo.go:93`, ai `util/permission.go:83-88`, id
`pages/Account.tsx:76`, `onboarding.ts:200`, `@hanzo/iam` `src/types.ts:114-115`.

| where | reads or writes | replaced by |
|---|---|---|
| `internal/oidc/whoami.go:43` | `isAdmin` in the whoami answer | — |
| `internal/oidc/issuetoken.go:432` | refuses acting for a user whose account flag is set | refuses when `role(target, org)` ∈ {owner, admin} |
| `internal/resolve/resolve.go:168-178` | a key holder's `IsAdmin` from the account flag at home | `role(holder, key org)` |
| `internal/registry/registry.go:446`, `:455` | registry push for any account-flag admin in `admin` or `hanzo` | `superadmin(a) ∨ role(a, hanzo) ∈ {owner, admin}` — owner-confirmed |
| `internal/scim/users.go:112`, `:197`, `:325`, `:364`, `:422`, `:437` | SCIM's Hanzo extension reads and writes the account flag | the IdP's group mapping writes `assigned(a, o, r)` |
| `internal/users/users.go:280`, `:490-492` | users create and update take `Admin` | — |
| `internal/bootstrap/bootstrap.go:452`, `:484-486`, `:517` | the upsert sets the flag (used to seed SuperAdmins, where it means nothing) | — |
| `internal/provision/provision.go:121-142`, `:693`, `:710` | declared accounts provisioned with the flag by account type | declared accounts get `assigned` facts in their org |
| authz `claims.go:113-120`, `:303`; `entity.go:175-176`, `:199-200`, `:446` | `Claims.IsAdmin`, a claim IAM's token never mints; `OrgAdmin` and `AdminOf` through it and through `org == p.Org` | `Role(o)` from `orgs` |
| cloud `apps/account/account.go:804-818`; `apps/iam/roles_rpc.go:53-125` | the account row's flag and "home ∧ isAdmin" decide standing | `orgs` |
| commerce `middleware/edgeauth.go:123-125`; `iammiddleware.go:68-71` | `X-User-IsAdmin` written from the org-level bit; either header counts as org admin | `X-User-IsOrgAdmin` alone |
| gateway `identity.go:146-158`; `cmd/admin-guard/authz.go:77-95`; `cmd/waitlist-guard/main.go:229` | the Live bit from `claims.IsAdmin`; `isAdmin && owner == org`; `IsAdmin \|\| owner == admin` | `Role(o)`; `Sudo()` |
| chat `src/presence/InviteModal.tsx:162`; `src/projects/ProjectModal.tsx:337` | the directory's per-person `admin` flag shown as authority | the roster's role in this org |
| console `lib/api/account.ts:105` | `isAdmin` off the account | `Role(org)` from the token |

**4.8 Specs**

- HIP-0519 rules 1 and 3 and the meanings of `X-Org-Id`, `X-User-Owner` and
  `X-User-IsAdmin`: amended by §2 (tenant from `org`, machine from `type`, owner is
  where the account lives).
- HIP-0118 "membership of the reserved `admin` org": the predicate stays
  `owner == admin`; membership never confers it (I1, I2).
- HIP-1045 (Orgs): its onboarding move and org creation are replaced by §3.
- HIP-0521 (Org Hierarchy): unimplemented; its SuperAdmin wording contradicts IAM
  and its ancestor billing is a second payer rule. Deleted with this HIP's Final.

### 5. Migration

**Live state it starts from** (SuperAdmin read of IAM through its admin API, and a
read of the `hanzo` roster, both on the day this HIP was written):

| what | count |
|---|---|
| orgs | 475 |
| orgs carrying a `founder` | 395 (394 distinct values; one value is shared by two orgs) |
| orgs with no founder | 80 — the brand orgs, every org a SuperAdmin created, and 5 personal orgs made by direct grant |
| membership rows | 421 |
| — the account's own org (implicit today) | 401, of which 6 are programs |
| — direct grants: no invitation, no founder match | 11 |
| — founder-backed, in an org the account does not live in | 1 |
| — keyed by a UUID or by a key that names no account (read by nothing) | 8 |
| rows carrying an invitation | 0 |
| accounts owned by `hanzo` | 16: 2 staff, 1 staff review account, 6 staff-made fixture persons, 4 customers, 3 programs |
| persons living in an org they founded | ~387 |
| first-party applications declaring a 168 h access token | most of the 105 in universe `infra/k8s/iam/init_data.json` |
| records filed under `admin` that are not SuperAdmin accounts | at least 896 live: 475 organization records and all 421 membership rows; the seed also declares 103 of 105 applications, all 7 signing certificates and all 6 identity providers there. Tokens, challenges, federation states and SuperAdmin-trail audit rows under `admin` are counted by the census |
| accounts carrying the account-level `isAdmin` flag | every founder moved into its org (~387), the 2 staff accounts in `hanzo`, every SuperAdmin, and each account the provision document declares by type |

Per-account and per-row detail is private data and lives in the private record
the census writes, never in this document.

**Classes.** Every row the census reads lands in exactly one class, and each class
has one action with one inverse.

| class | today | action | inverse |
|---|---|---|---|
| A | a person owned by `admin` outside the owner-approved SuperAdmin set | `moved(a, admin, id)` + found `home(a)` | move back |
| B | a person owned by `hanzo`, `lux`, `zoo`, `pars` or any org they did not found | found `home(a)`; `moved(a, o, id)` | move back; the founded org stays empty |
| C | a person owned by the personal org they founded | `founded(a, p)` from the founder stamp; `moved(a, p, id)` | move back |
| D | a person owned by a named org they founded | `founded(a, o)`; found `home(a)`; `switched(a, o)`; `moved(a, o, id)` | move back |
| E | a program owned by an org | `moved(p, o, id)` + `assigned(p, o, r, owner)`, `r` the role its keys exercise (default `member`), each owner-vouched from the dry run | move back |
| F | a direct-grant row | dropped, or — only where the owner attests the person was asked — `invited` + `accepted` with provenance `owner-attested` | re-insert the row |
| G | a dead-key or UUID-keyed row | dropped | re-insert the row |
| H | an org with no founder | the owner names its founder → `founded(a, o, owner)`; until then the nightly check lists it | delete the fact |
| I | a person ledger `person:<org>/<name>` | double-entry transfer to `org:home(a)` | the reverse transfer |
| J | a subscription on an org the paying account is not a member of | re-point to the org that pays for it | re-point back |
| K | a username or email that collides inside `id` | username: the later account takes a suffixed name; email: the owner decides merge or keep, never automatic | rename back |
| L | a record filed under `admin` that is not a SuperAdmin account | re-filed under `ns(x)` (§1); name and content unchanged | re-file back |
| M | an account carrying `isAdmin` | never translated. The owner classifies each: needs platform authority → an explicit `grantSuperAdmin`; meant org admin → an owner-vouched role (`founded` for founders, `assigned` for staff and declared accounts); neither → nothing. Then the flag is deleted | set the flag |

**Steps.** Each step is a dry run first (the plan, one line per change, with its
evidence and its inverse), then the owner confirms, then it runs through IAM's
audited admin API or an IAM migration that writes one fact per change. Every
change is a fact, so every change is readable and reversible.

0. **Mail.** IAM's email provider is configured from KMS (the private record
   names the KMS path, never the value). Invitations are the only normal route to
   an org role, and each proves a mailbox by a code IAM mails, so nothing below
   step 4 may run before a Playwright run delivers an invitation to a test mailbox
   and accepts it. *[data; KMS, owner only]*
1. **Census.** A read-only SuperAdmin run lists accounts by owner and by
   `isAdmin`, orgs with founder and `isPersonal`, membership rows with invitation,
   invitations, every record filed under `admin` by kind, applications with
   `expireInHours` and `orgChoiceMode`, commerce ledgers
   (every `person:` account with its balance), subscriptions by org, and
   evaluates `orgs`, `acting` and `payer` for every account under this HIP next to
   today's values. Output: the plan above, classed A–M. *[data, read-only]*
2. **Token lifetime.** Every first-party application's `expireInHours` becomes
   `1` in universe `charts/app/values/hanzo/iam-provision.yaml`, and universe
   `infra/k8s/iam/init_data.json` drops its 168 h values. Revocation now bites
   within an hour. *[data; affects sessions — owner approval]*
3. **Facts.** Backfill `founded` from every founder stamp (classes C, D; the
   stamp is a storage id, the fact names `sub`),
   `invited`+`accepted` for owner-attested rows (F), `founded` for owner-named
   founders (H). Additive; no row and no claim changes. *[IAM]*
4. **Close the write paths.** `founder` and `isPersonal` become server-set;
   `POST /v1/iam/memberships` refuses a non-member; invitations name one mailbox
   and one role; onboarding stops moving the caller. From here nothing can create
   access except founding and accepting. *[IAM]*
5. **Personal orgs.** Found `home(a)` for every person in classes A, B and D.
   Seed `switched(a, o)` for class D and for staff who today act in `hanzo`, so
   their acting org does not change. Class E programs get their owner-vouched
   `assigned` facts. *[IAM]*
6. **Claims.** IAM signs `owner` = owner(a), `org` = acting, `billing_account` =
   `org:payer`, adds `POST /v1/iam/switch`, and stops appending the assumed org to
   `orgs`. `orgs` itself is unchanged in this step, so `orgs[0]` still equals the
   account's own org and every current reader keeps working. At the same instant
   class-I balances transfer, and the refresh families of exactly those accounts
   are revoked so they re-sign in onto the new payer. *[IAM + data]*
7. **Readers.** `hanzoai/authz` reads `Sudo` from `owner` and `type`, `Org` from
   `org`, `Payer` from `billing_account`, `OrgAdmin` from the role in `orgs`, and
   drops `Home`, `EffectiveOrg`, `LedgerOrg`, `IsAdmin` and machine-by-empty-`orgs`.
   Cloud's edge mints `X-Org-Id` and `X-Billing-Account-Id` from the claims and
   deletes the client's. Sites switch through `POST /v1/iam/switch` and delete
   their own org state (§4). Nothing reads `admin/` as a prefix any more: IAM
   resolves each kind through its one namespace, `signingOwners` holds `admin`
   and `iam` together, the capability pin admits owner `app` beside `admin`, the
   reserved-owner branch keys on the reserved set, sites address orgs by slug
   (`/v1/iam/organizations/<slug>`), and cloud's internal calls stop naming
   `admin` as the platform's tenant (§4.6). Nothing reads an account-level admin
   flag (§4.7). *[edge, sites, IAM]*
8. **Namespaces.** One IAM migration re-files class L, one transaction per kind,
   writing one fact per kind with its count and a digest of the rows' content
   before and after, the owner half excluded. Signing certificates move last,
   after IAM has verified a token under each key from its new owner. Then
   `signingOwners` and the capability pin drop `admin`, the `/:owner/:name`
   organization routes go, and I14 holds. *[IAM]*
9. **Membership from facts.** `orgs` becomes `[home(a)] ⧺ members`, never a
   reserved org. SuperAdmin tokens carry `orgs = []`, which step 7 made safe.
   Class M flags clear. *[IAM]*
10. **Directory.** `id` joins the reserved set. Classes A–E move, in batches:
    `owner(a) := id`, references keyed `<owner>/<name>` rewritten to `sub`, every
    per-account record re-filed under `iam` by `sub`, `moved(a, from, id)`
    recorded. Collisions (K) resolve first. Each moved account signs in once
    more. *[IAM]*
11. **Ledgers and plans.** Class J re-points; the `person:` ledger kind and the
    signup-org payer rule delete. *[data + commerce]*
12. **Delete.** Everything in §4 that steps 3–11 left unread is removed —
    `User.IsAdmin` last — and the nightly check (§7) runs. *[all]*

**What the migration preserves, and where it does not.** Let `before` and `after`
name a predicate evaluated on the old rows and on the new facts.

- *L1 (moving is invisible).* `moved(a, from, id)` changes `owner(a)` and nothing
  else: `home`, `orgs`, `acting` and `payer` read `owner(a)` only to tell `admin`,
  and programs apart, and a move of class B, C, D or E neither enters nor leaves
  any of them. So step 10 preserves all four for those classes. Class A leaves
  `admin` and loses SuperAdmin, which is the point.
- *L2 (payer is preserved except for B and I).* Class C paid `org:p` before
  (owner of its own org) and pays `org:home(a) = org:p` after. Class D paid
  `org:o` and, with `switched(a, o)` seeded, acts in and pays `org:o` after. Staff
  in `hanzo` keep acting in and paying `hanzo` the same way. Class B paid from the brand
  org they were filed under — a person ledger inside `hanzo`'s ledger, or, in
  `lux`, `zoo` and `pars`, the brand's own pool, because the signup-org rule exempts
  only `hanzo` — and after pays from its own org; step 6 moves the money in the same
  instant. This is the one intended change of payer.
- *L3 (acting changes for B only).* Class B acted in the brand org they were filed
  under — the four customers in `hanzo` acted in Hanzo Inc's own workspace. After,
  they act in their own org. Intended.
- *L4 (access shrinks for F and G only).* `member` after ⊆ `member` before, and
  the difference is exactly the class F rows the owner did not attest and the dead
  rows of class G.
- *L5 (re-filing is invisible to authority).* Step 8 is a map `f` on records
  that changes `ns(x)` and nothing else — not the name, not the content — and
  fixes every SuperAdmin account. Every predicate reads one of three things:
  `owner` of an account (`superadmin`), which `f` fixes for SuperAdmins and never
  held `admin` for anyone else; `(sub, slug)` tuples (`member`, `role`, `acting`,
  `payer`), which `f` preserves because a membership row keeps its account, org
  and role and only changes the namespace it is filed in; and platform-ness of an
  application or certificate, which step 7 made readable from the new owner
  before `f` runs. So for every predicate `P`, `P(f(x)) = P(x)`. Token `orgs`
  claims and `org:<slug>` ledgers carry slugs, not ids, and do not change. The one
  intended difference: a reader that granted authority to a program because its
  owner was `admin` (the commerce and cloud rows of §4.4 and §4.6) stops doing so,
  since platform programs now live in `app`.
- *L6 (org admin survives the flag).* For every class M account whose flag meant
  "administers o", step 3 or step 5 has recorded `founded(a, o)` or an attested
  `assigned(a, o, admin)`, so `role(a, o) ∈ {owner, admin}` before the flag
  clears in step 9. A flag with no attested role behind it ends — the only place
  L6 does not preserve access, and the census lists each such account.
- *Not preserved.* Tokens minted before step 6 lack `org` and `billing_account`;
  after step 7 a reader refuses them, and they last at most one hour (step 2).
  Every moved account signs in once. Usage history keyed `<org>/<name>` is not
  rewritten: past facts stay as they were, and books read them through `moved`.

### 6. What needs the owner's approval

The owner's standing rule: no change to auth, IAM login or gate logic without an
explicit ask. Every **[IAM]** and **[edge]** item below needs that ask. **[data]**
runs through IAM's existing audited admin API, dry run first, owner confirms each
batch. **[sites]** changes no authority, only which claim a page reads.

| # | change | step | kind |
|---|---|---|---|
| 1 | IAM email provider from KMS | 0 | data (KMS, owner only) |
| 2 | `owner` claim = owner(a); delete `organization`; userinfo drops `isAdmin` | 6 | **IAM** |
| 3 | `org` and `billing_account` from the facts; `POST /v1/iam/switch` | 6 | **IAM** |
| 4 | assume sets `org`, bills `hanzo`, leaves `orgs` alone | 6 | **IAM** |
| 5 | the fact log: `organization-found`, `membership-assign`, `membership-revoke`, `organization-switch`, `account-move` join the platform-written actions; membership rows become its fold | 3 | **IAM** |
| 6 | server-set `founder`/`isPersonal`; role-only `POST /v1/iam/memberships`; one-mailbox invitations with a role; delete `/v1/iam/onboard` and `/v1/iam/admin/provision`; restrict `/v1/iam/admin/users/upsert` | 4 | **IAM** |
| 7 | signup and federation land in `id` and found `home(a)`; `orgChoiceMode` deleted; sign-in resolves in one directory | 4–5 | **IAM** |
| 8 | `orgs` = the fold; the principal's set and `GET ?user=` answer the same set | 9 | **IAM** |
| 9 | `id` reserved; accounts move; `<owner>/<name>` references rewritten to `sub`; per-account records under `iam` | 10 | **IAM** |
| 10 | `BillingAccount` shape rule and `SignupOrg` deleted | 11 | **IAM** |
| 11 | `GET /v1/iam/check`, read-only, SuperAdmin only | 12 | **IAM** |
| 12 | nothing but SuperAdmin accounts under `admin`: organization records to `org`, memberships into their org, platform applications to `app`, certificates, providers, challenges, federation states, tokens and tenantless audit rows to `iam`; `/v1/iam/organizations/<slug>` addressing; the `/:owner/:name` organization routes and every `admin` registry literal deleted | 7, 8 | **IAM** |
| 13 | org admin is `role(a, o)` only: `User.IsAdmin` stops being read (userinfo, whoami, principal, keys, token exchange, registry push, SCIM, provisioning, upsert) and is deleted; `assume` grants no role | 7, 9, 12 | **IAM** |
| 14 | access-token lifetime at most 1 h for every first-party application | 2 | data (auth-affecting: **approve**) |
| 15 | authz and account libraries read claims only (`IsAdmin` and `org == p.Org` leave `OrgAdmin`/`AdminOf`; `signingOwners` gains `iam`; the capability pin admits `app`; the reserved set becomes {`admin`, `id`, `org`, `app`, `iam`}); cloud's edge mints from claims and drops `cliOrg`; cloud's internal calls stop naming `admin` as a tenant; commerce drops its own JWT validation and EdgeAuth; gateway guards read `Sudo()` and roles | 7 | **edge** |
| 16 | census, attestations (founders, staff roles, declared accounts' roles), row drops (`POST /v1/iam/delete-membership`), ledger transfers, plan re-pointing | 1, 3, 6, 11 | data |
| 17 | every §4.5 site row; §4.6 and §4.7 site rows (slug addressing, no account-level admin flag) | 7 | sites |
| 18 | `grantSuperAdmin` / `revokeSuperAdmin` as the only writers of `admin` accounts; genesis only while `admin` is empty; every other create path refuses `admin` (R2) | 4 | **IAM** |
| 19 | every creation path in §8.1 yields `id/<account>` + personal org and nothing else; programs move to `id` with an explicit `assigned` (R1) | 4, 5, 10 | **IAM** |
| 20 | `ADMIN_NAMESPACE_INVARIANTS` required for merge in IAM, and its static half in authz, account, cloud, ai, commerce, gateway, `@hanzo/iam` and the sites (R7) | 3 | **IAM**, CI |
| 21 | registry push = `superadmin(a) ∨ role(a, hanzo) ∈ {owner, admin}` (R8) | 7 | **IAM** (owner-confirmed) |

The rows marked **[bug]** in §4 are live defects that stand on their own; each can
ship ahead of this sequence, and each still needs the same approval when it is
tagged IAM or edge.

The account's identity does not change in step 10: `sub` stays, and only its
`<owner>/<name>` address does. References keyed by `sub` need nothing. References
keyed `<owner>/<name>` are rewritten: IAM membership rows, IAM chain-wallet
bindings (`pkg/schema/wallet.go`), commerce `person:` ledgers (class I), and any
cloud store the census finds keyed that way. Audit and usage history are read
through `moved`, never rewritten.

### 7. Verification

**Property tests** (IAM `pkg/store`, `testing/quick`, no new dependency; they
are part of `ADMIN_NAMESPACE_INVARIANTS`, §8 R7). Generate
random fact logs of every kind; after each append, assert I1–I9, I12 and
I14–I17 on the fold, the last three as independence: appending any fact about
`(a, o)` leaves `role(a, o′)` for `o′ ≠ o` and `superadmin(a)` unchanged, and
appending `assumed` leaves every `role` unchanged; assert the fold is deterministic and order-independent within a timestamp;
assert L1 (a `moved` fact leaves `home`, `orgs`, `acting`, `payer` unchanged); and
assert the refusals: a non-member `switch`, an invitation into a personal org, a
revoke of the last owner, a `founded` into a reserved org, a SuperAdmin `founded`
for themself.

**Nightly check.** A CronJob the operator declares calls two read-only,
SuperAdmin-only reports and files every non-empty answer on the platform audit
trail and the status board:

| report | invariant | answers |
|---|---|---|
| `GET /v1/iam/check` | I1 | every account in `admin`, against the owner-approved SuperAdmin roster kept in the private record |
| | rows = fold | every membership row with no `founded` or `accepted` fact behind it |
| | I3 | every account whose `orgs` names a reserved org, or an org no fact grants — authority from where an account lives |
| | I2, I4, I5 | a SuperAdmin with an org; a person in `id` without exactly one personal org; a personal org with a second member |
| | I6, I7 | every org with no founder, or no owner |
| | I8 | every account filed anywhere but `id` or `admin` |
| | I14 | any record under `admin` that is not a SuperAdmin account — every kind, not just accounts |
| | I17 | any account with an account-level admin flag set |
| | I2 | any org role held by a SuperAdmin; any roster listing one |
| `GET /v1/billing/check` | I10 | every ledger account not of the form `org:<slug>`; every deposit into `org:hanzo` paid by a non-member of `hanzo` — customer money in Hanzo's wallet |
| | I11, J | every subscription on an org that does not exist, is reserved, or is not an org its paying account belongs to |
| | I9 | every debit whose org is neither in its account's `orgs` nor `hanzo` under an `assumed` fact |

**Each step, live.** A step is done when its check reads true at the running pod,
not when its pipeline is green.

| step | verified by |
|---|---|
| 0 | a Playwright run sends an invitation to a test mailbox, reads the code from it and accepts; the org appears in the invitee's switcher |
| 1 | census totals equal `GET /v1/iam/organizations` and `GET /v1/iam/users` totals |
| 2 | every application reads `expireInHours ≤ 1`; a fresh token's `exp − iat ≤ 3600` |
| 3 | `GET /v1/iam/check` rows-vs-fold differs by exactly the class F and G rows; tokens for a sampled customer, staff member and SuperAdmin decode byte-identical in `orgs` before and after |
| 4 | a non-member `POST /v1/iam/memberships` → 403; a `founder` in a create body is ignored; a multi-use invitation is refused; Playwright drives invite → mail → `/join` → the org appears in the switcher |
| 5 | I4 violations = 0 |
| 6 | the three sampled tokens carry the expected `owner`, `org`, `billing_account`; a non-member switch → 403; an assume leaves `orgs` unchanged and writes its row under the tenant; class I ledger totals are equal before and after |
| 7 | `curl api.hanzo.ai` with a forged `X-Org-Id` answers for the token's `org`; Playwright on console, id, team, ai, chat and ide: switch org in one, and every surface shows that org and its balance; admin.hanzo.ai lists every org and enters one only through assume |
| 8 | per kind: count moved = count read, content digests equal (L5); `GET /v1/iam/check` I14 empty; tokens minted before and after verify under every key; the census evaluation of every predicate for every account is unchanged; Playwright: sign-in to console, admin console, id and chat, and an org page reached by slug |
| 9 | a SuperAdmin token carries `orgs = []` and the admin console still admits it; I17 empty; every class M account with an attested role still administers its org (L6) |
| 10 | per batch: `sub` unchanged, census evaluation of `acting` and `payer` unchanged (L1), a sampled account signs in through Playwright |
| 11 | no `person:` ledger remains; the sum of all balances is unchanged |
| 12 | both reports empty for seven consecutive nights; then §4 deletes |

### 8. Hard requirements

A change that implements any part of this HIP is refused if it breaks one of
these.

- **R1 — Deny by default.** Every way an account comes into being yields exactly
  `id/<account>`, its per-account records under `iam`, and for a person its
  personal org with `founded(a, home(a))`. Nothing else: no role in any other org,
  no record under `admin`, no flag. No account-level `admin`, `isAdmin`, role or
  group field exists at all (I17, I19). §8.1 lists every path.
- **R2 — One way into `admin`.** `grantSuperAdmin(actor, target)` with
  `superadmin(actor)` — or `actor = genesis` while `admin` is empty — audited, is
  the only code that creates `admin/<account>` (I18). In IAM the constructor of an
  `admin` account is unexported, lives in one package and has one caller;
  `users.Create`, the only other writer of an account, refuses the `admin`
  namespace. R7 enforces both.
- **R3 — No translation.** A legacy account-level admin flag never becomes an
  `admin` account. The owner classifies each (§5 class M): platform authority is an
  explicit `grantSuperAdmin`; org-admin intent is an owner-vouched `role(a, o)`;
  anything else is dropped. Then the flag is deleted.
- **R4 — One check.** Every authorization check is `allow` (§2):
  `superadmin(a)` for a platform resource, `role(a, o) ⊇ need` — or
  `superadmin(a) ∧ assumed(s) = o` — for an org resource. No check reads an
  account's `owner`, namespace, admin flag or founder, an org's `founder`, an
  application's `organization`, or `orgs[0]`. A SuperAdmin is not an org admin
  and holds no implicit role.
- **R5 — Provisioning guard.** For every path in §8.1 a test asserts, after the
  path runs: `¬∃ admin/<new>`, `¬adminFlag(new)`, and `orgs(new) = [home(new)]`
  for a person (plus exactly the org whose invitation it redeemed, where the path
  redeems one) or `orgs(new) = [o]` for a program assigned into `o`. One more test
  drives an ordinary account through every onboarding path in turn — signup,
  invitation, OAuth, an org's provider, wallet, password reset, key mint, org
  creation, switch, and an assume attempt — and asserts it ends with
  `superadmin = false` and no role outside the orgs it founded or whose
  invitations it accepted.
- **R6 — Invitations are the route.** A person gains a role in an org they did not
  found only by accepting an invitation (an org's provider binding is one).
  Mail comes first: §5 step 0.
- **R7 — `ADMIN_NAMESPACE_INVARIANTS`.** A named suite in IAM's CI (the root
  `hanzo.yml`), required for merge, fails when any of these breaks — including when
  a schema, model or migration brings back an account-level admin field:

  | # | invariant | how it is checked |
  |---|---|---|
  | 1 | `admin/<a>` ⇒ `superadmin(a)` (I14) | every write path against a store, then a scan of every kind for a record under `admin` that is not a SuperAdmin account |
  | 2 | `superadmin(a)` ⇒ no org role (I2) | property test over random fact logs; `assume` leaves every role unchanged |
  | 3 | no account-level admin field (I17) | reflection over every type reachable from `schema.User` and over every migration: a field, tag or column matching `admin`, `isAdmin`, `superAdmin`, `globalAdmin`, `role` or `groups` on an account fails |
  | 4 | creation ⇒ no admin record, no role outside its own org (I19) | the R5 tests, one per §8.1 path |
  | 5 | a role is scoped to (account, org) (I15) | property test: a fact about `(a, o)` leaves `role(a, o′)` unchanged |
  | 6 | a role never makes a SuperAdmin (I16) | property test: no role fact changes `superadmin(a)` |
  | 7 | only `grantSuperAdmin` creates `admin/<a>` (I18, R2) | static: a `go/ast` walk of the module finds exactly one statement that sets an account's owner to the `admin` namespace or keys one `admin/…`, inside `grantSuperAdmin`; dynamic: every other create path refuses `admin` |

  The static half of 3 and 7 — no read of an account-level admin bit, no
  `owner == "admin"` outside the one `Sudo()` reader — runs in `hanzoai/authz`,
  `hanzoai/account`, cloud, ai, commerce, gateway, `@hanzo/iam`, and every site in
  §4.5.
- **R8 — Registry push** is `superadmin(a) ∨ role(a, hanzo) ∈ {owner, admin}`
  (owner-confirmed).
- **R9 — Done means deleted.** Before any implementing change merges, blue
  builds it and red audits every call site in §8.2 against R4, and the change
  names which sites it deletes. The migration is done when every §8.2 site is gone
  or reduced to `allow` — not when records have moved.

**8.1 Every way an account is created**

| path | today (IAM `v1.34.120`) | after |
|---|---|---|
| email signup | `internal/oidc/signup.go:320-391`: the application's org, then `charter` moves it | `id` + personal org |
| signup with an invitation | `signup.go:149-160`, `:303-313` | `id` + personal org + `accepted(a, n)` |
| invitation, existing account | `internal/oidc/accept.go:83-190`; `invite.go:160-205` | `accepted` only; no account created |
| OAuth / social | `internal/oidc/federation.go:591-622` | `id` + personal org |
| an org's identity provider | `federation.go:591-622` | `id` + personal org + `accepted(a, n_p)` |
| wallet sign-in | `internal/wallet/verify.go:258-288`: the application's org, a direct store write | `id` + personal org, through `users.Create` |
| API user create | `internal/users/users.go:56`, `:239-285`: takes `Admin`; a SuperAdmin may create in `admin` | `id`, no `Admin` input; refuses `admin` |
| SCIM | `internal/scim/users.go:319-325`: `isAdmin` from the Hanzo extension | `id` + `accepted` through the org's provider binding |
| enterprise modules | `internal/featurestore/featurestore.go:64-67` | through `users.Create` |
| service-token upsert | `internal/bootstrap/bootstrap.go:67`, `:514`: any org, `isAdmin` settable | deleted |
| declared accounts | `internal/provision/provision.go:693-745`: `isAdmin` by account type | `id` + owner-vouched facts |
| service account | `internal/serviceaccounts/serviceaccounts.go:157`, `:340`: filed in the org; `admin` open to a SuperAdmin | `id` + `assigned(p, o, r, actor)`; refuses `admin` |
| onboarding credential | `internal/oidc/provision.go:210` (`<slug>-default`) | deleted with onboarding; the service-account path makes programs |
| password reset / recovery | `internal/oidc/password.go:128-240` | creates nothing; the guard asserts roles and namespace unchanged |
| migration | §5 steps 3, 5, 10 | facts only; class M never produces an `admin` account |
| SuperAdmin | the upsert above; the users API as a SuperAdmin | `grantSuperAdmin` only |

**8.2 Every place that reads authority from something other than `allow`**

The audit list for R9, read at the commits in §4. Each is deleted or reduced to
`allow`.

*`owner` or namespace = `admin`, read as authority outside `superadmin`*
- IAM: `internal/registry/registry.go:446`, `:455`; `internal/seed/seed.go:212`;
  `internal/bootstrap/bootstrap.go:261`, `:331`; `internal/oidc/mint.go:118`;
  `internal/featurestore/featurestore.go:87`; `pkg/store/store.go:686`;
  `server/server.go:261`; `internal/serviceaccounts/serviceaccounts.go:340`;
  `internal/organizations/organizations.go:135`, `:294`; authz `claims.go:460`,
  `entity.go:172-173`, `:196-197`.
- cloud: `auth_identity.go:475-477`; `apps/admin/admin.go:208-211`, `:368`;
  `apps/commerce/catalog_rpc.go:39`; `sale_rpc.go:285`;
  `apps/marketplace/listings.go:387-389`; `apps/ci/ci.go:204-209`; `reader.go:52`;
  `apps/gateway/edge/policy.go:213-230`.
- ai: `util/permission.go:53-60`, `:99-101`; `controllers/zap_application-deploy.go:121`;
  `zap_chat-graph-crud.go:920`; `controllers/cloud_usage.go:138`.
- commerce: `auth/iam.go:274-276`; `middleware/iammiddleware/iammiddleware.go:252-258`;
  `middleware/edgeauth.go:193-205`; `middleware/platformonly.go:104-105`;
  `api/billing/authz.go:31-39`; `api/billing/tier.go:26-35`.
- gateway: `cmd/admin-guard/authz.go:101-104`; `cmd/admin-api/handlers.go:49`,
  `:68`, `:107`; `sources.go:172`; `cmd/waitlist-guard/main.go:229`, `:479`, `:644`;
  authz `v1.10.29` `claims.go:210-230`.
- sites: console `config/index.ts:322-324`, `lib/auth/admin.ts:29-38`;
  `@hanzo/iam` `src/auth.ts:196`; team and ai app `hooks/useTiers.ts:48-57`,
  `:103-104`.

*an account-level admin flag*
- IAM: `pkg/schema/user.go:116`; `pkg/store/membership.go:413-418`;
  `internal/authz/authz.go:798`; `internal/oidc/userinfo.go:93`;
  `internal/oidc/whoami.go:43`; `internal/oidc/issuetoken.go:432`;
  `internal/resolve/resolve.go:168-178`; `internal/scim/users.go:112`, `:197`,
  `:325`, `:364`, `:422`, `:437`; `internal/users/users.go:280`, `:490-492`;
  `internal/bootstrap/bootstrap.go:452-517`; `internal/provision/provision.go:121-142`,
  `:693`, `:710`; `internal/oidc/provision.go:139`, `:173`, `:181-183`; authz
  `claims.go:113-120`, `:303`, `entity.go:199-200`, `:446`.
- cloud: `apps/account/account.go:804-818`; `apps/iam/roles_rpc.go:53-125`.
- ai: `util/permission.go:83-88`.
- commerce: `middleware/edgeauth.go:123-125`; `iammiddleware.go:68-71`.
- gateway: `identity.go:146-158`; `cmd/admin-guard/authz.go:77-95`.
- sites: id `pages/Account.tsx:76`, `pkgs/onboarding/src/service/onboarding.ts:200`;
  chat `src/presence/InviteModal.tsx:162`, `src/projects/ProjectModal.tsx:337`;
  console `lib/api/account.ts:105`; `@hanzo/iam` `src/types.ts:114-115`.

*founder*
- IAM: `internal/oidc/provision.go:173`; `internal/organizations/organizations.go:149`,
  `:198`; branch `orgs` `store.Joined` (not merged).

*where the account lives, read as membership or admin of that org*
- IAM: `pkg/store/membership.go:220-271`, `:366-384`, `:405-408`;
  `internal/memberships/memberships.go:206-208`; `pkg/store/billing.go:37-63`;
  authz `claims.go:185-190`, `entity.go:175-176`.
- cloud: `auth_identity.go:326-338`; `apps/team/account.go:519-522`, `:604-606`;
  `apps/agents/conversation.go:207`; `apps/account/embed.go:139`.
- ai: `internal/iam/jwt.go:91-93`, `:111-118`; `routers/org_resolver.go:43`.
- commerce: `iammiddleware.go:89-96`.

*the `owner` claim, which names the application's org*
- IAM: `internal/oidc/jwt.go:332`, `:389`; `internal/oidc/userinfo.go:78`.
- cloud: `token_validator.go:34-37`, `:118`; `cli/auth.go:121-124`;
  `internal/iam/exchange.go:127-155`.
- commerce: `middleware/edgeauth.go:113-114`; `auth/iam.go:253-261`.
- gateway: `cmd/admin-guard/authz.go:64`, `main.go:299`; `cmd/waitlist-guard/main.go:285`.
- sites: console `lib/api/account.ts:73-82`, `:191`; chat `src/data/session.tsx:132-145`;
  ide `src/hanzo/account.ts:39`, `src/hanzo/iam.ts:57-58`; id
  `apps/account/src/worker.js:823`.

*a SuperAdmin entering an org without `assume`, or `assume` granting a role*
- IAM: `internal/oidc/masquerade.go:158-160`; authz `claims.go:329-331`.
- cloud: `auth_identity.go:490-501`; `middleware_identity.go:340-344`;
  `apps/gateway/gateway.go:143-150`; `apps/platform/apps.go:660-690`.
- ai: `controllers/org_resolver.go:165-166`.
- commerce: `middleware/edgeauth.go:134-141`.
- gateway: authz `v1.10.29` `claims.go:263-280`.

## Rationale

**The trade-off.** This design gives up per-request org selection by header and
instant revocation of a live token. A switch costs one round trip to IAM and a new
token; the acting org is one per account, not one per tab; a revoked membership
stops at the next mint, at most an hour later (keys stop at once). In return the
four answers exist in one place and travel signed, so no reader can compute a
different one, and the whole class of defects in §4 — a header trusted, a claim
misread, a fallback to the wrong org, a list order read as authority — has nowhere
left to live. It also gives up silent adds: a teammate joins by accepting, which
needs mail to work. SuperAdmins keep two accounts, one to administer and one to
work in. Each moved account signs in once. All of these are one-time or bounded
costs; the defects they remove recur.

**Why an org's identity provider does not own accounts.** Every account lives in
`id`, so an org with its own provider admits people through it and removes them
through SCIM, and can require its domain to sign in through it, but cannot delete
a person's account or their own org. The alternative — accounts owned by an org —
is a second kind of directory, a second `home` rule and a second deprovisioning
path, and it made "who can delete this login" depend on how the person first
signed in. One directory keeps R1 true for every creation path.

**Why a directory and not the personal org as home.** Today onboarding moves an
account into the org it founds. That braids three things — where a login lives,
what it may act in, and what it pays from — into one field, `owner`, so founding
an org re-keys the account and strands its tokens, memberships and keys. With `id`
the account never moves (I12), the personal org is just the org it founded, and
paying follows acting (L1, L2).

**Why facts.** Access is a history — founded, invited, accepted, revoked — and a
row that is overwritten cannot say how it came to be. With the log, a membership
row is a cache of the fold and the nightly check can recompute it. The parked
`orgs` branch kept rows that exist but confer nothing; this design has no such row.

## Security Considerations

- **Order is load-bearing.** `Machine()` reads an empty `orgs` as a machine; step 9
  gives SuperAdmins `orgs = []`, so step 7 (`Program()` from `type`, `Sudo()` from
  `owner`) must be live first or every SuperAdmin loses authority. Likewise the SDK's
  SuperAdmin test reads `admin` in `orgs` and must move before step 9. Step 8 must
  follow step 7 for the same reason: a reader still resolving an org as
  `admin/<slug>`, a JWKS walk without `iam` in `signingOwners`, or a capability pin
  that admits only owner `admin` would read the re-filed records as absent.
- **The owner-claim fix closes an escalation.** Today a person signing in through
  an application owned by `admin` carries `owner = admin`, and every reader that
  trusts `owner` (commerce EdgeAuth, the gateway guards, ai's fallback) treats them
  as SuperAdmin. Step 6 makes `owner` the account's own directory; until then those
  readers are live defects (§4 **[bug]**).
- **Header masquerade.** authz `EffectiveOrg` and cloud `Acts` let a SuperAdmin
  enter any org by sending `X-Org-Id`, which never reaches IAM's assume trail. It is
  deleted, not narrowed: assume is the only entry (I9).
- **Mail is a hard dependency.** Invitations prove a mailbox by a code IAM mails.
  IAM has no live email provider; until one is configured from KMS, step 4 leaves
  no way to join an org. Configure it before step 4.
- **Money moves once, with conservation.** Class I transfers are double-entry and
  checked by total. Tokens minted before step 6 still debit the old person ledger
  for at most an hour; revoking exactly those accounts' refresh families makes them
  re-sign in onto the new payer.
- **Creation is the escalation surface.** §8.1 lists sixteen paths that create or
  touch an account; six of them today can file one under `admin` or set an admin
  flag.
  R1, R2 and R5 close them by construction and by test, and R7 fails the build if
  one comes back.
- **Support is Hanzo's cost.** Under assume the debit lands on `org:hanzo` and the
  tenant's own audit trail shows who was inside and when.
- **Replacement, never deletion (HIP-0519).** `cliOrg` and every recomputation in
  §4.3 go in the same change that reads the claim, so the boundary never stops for
  a request.
- **One email, two accounts.** A person with accounts in two brand orgs collides in
  `id`. Merging moves memberships and money and is never automatic.
- **`admin/` means SuperAdmin.** Today every org and membership row, most
  applications and every signing certificate are filed under `admin`, so an org
  id prints like a SuperAdmin account and a reader that trusts the prefix trusts
  the wrong thing. Step 8 empties the namespace of everything but SuperAdmin
  accounts, and I14 keeps it that way.
- **No cross-contamination of admin.** An org's admins are rows in that org's own
  namespace. An account-level flag cannot say which org it means, so every reader
  of one either widened it to every org the account touches or narrowed it to the
  org the account lives in — both wrong once a person belongs to two orgs. I15–I17
  make the flag unrepresentable.

## References

- HIP-0026 — Identity & Access Management Standard
- HIP-0111 — IAM Authentication Standard
- HIP-0118 — SuperAdmin & Tenant Isolation Model
- HIP-0519 — One Identity Boundary
- HIP-0521 — Org Hierarchy
- HIP-1045 — Orgs

## Copyright

Released under the MIT License.
