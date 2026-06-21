---
hip: 0305
title: "esign: shared-DB tenancy via team-where, not file-per-tenant"
author: Zach Kelling (zach@hanzo.ai)
type: Standards Track
category: Infrastructure
status: Accepted
created: 2026-06-21
requires: HIP-0302
---

# HIP-305: esign — Shared-DB Tenancy via `team-where`, not File-per-Tenant

## Context

The canonical database architecture (`hanzoai/.github` →
`profile/ARCHITECTURE-DATABASES.md`) mandates one Base SQLite file per
`(org, user, project)` for every internal app — *"the file **is** the tenant
boundary. Do not add a tenant column."* Decision #7 of that document is explicit
that **"Deviation needs a HIP, not a Slack thread."** This is that HIP.

esign (a Documenso fork) is being migrated Postgres → Base SQLite (PR
`hanzoai/esign#7`). Its data shape does not fit file-per-tenant:

1. **Bootstrap paradox.** `validateSessionToken` reads the global `Session`
   table to discover *which user* is calling — this happens **before any org is
   known**. A per-org file cannot be selected at request entry because the org
   is only learned by first reading a global table.
2. **Global identity.** A `User` owns and belongs to *many* organisations
   (`ownedOrganisations[]`, `organisationMember[]`). `Session`, `Account`,
   `Passkey`, `ApiToken` carry **no** `organisationId`. Splitting identity by org
   would shard a single user across files.
3. **Relation-scoped tables.** Only **8 of 47** tables carry an `organisationId`
   column (`EmailDomain`, `OrganisationEmail`, `OrganisationGroup`,
   `OrganisationMember`, `OrganisationMemberInvite`, `RateLimit`, `Subscription`,
   `Team`). The other 39 scope through relations
   (`Envelope → Team → Organisation`) that a per-file split would make
   un-joinable.
4. **No routing-layer escape hatch.** esign has no hostname/subdomain tenant
   resolver, so there is no request-time hook at which a file could be chosen
   the way a multi-tenant edge router would.

## Decision

esign uses **ONE Base SQLite file shared across orgs**. Tenant isolation is
enforced in-query at the `buildTeamWhereQuery({ teamId, userId })` layer — the
single predicate every cross-org read in `packages/lib/server-only/*` funnels
through. A team is reachable only when the **authenticated** user is a member
via `teamGroups → organisationGroup → organisationGroupMembers →
organisationMember.userId`. The predicate is keyed on the server-trusted user
id, never on a client-supplied value. The auth boundary is unchanged: tenancy is
still the IAM OIDC `owner` claim; this HIP changes the *file count*, not the
*scope*. Encryption-at-rest and S3 replication (HIP-0302) apply to the single
file exactly as to a per-tenant one.

## Proof

- **`tenant-isolation.test.ts` (6/6 pass)** — stands up the real `0_init`
  migration, seeds two independent org graphs through the real Prisma client,
  and proves: owner reaches own team (1 row); org B owner reaches org A's team
  (**0 rows**); a forged/non-member userId reaches it (**0 rows**); the same
  predicate filters Envelopes so B sees **0** of A's documents.
- **Defense in depth (the file is not the only guard):**
  - The list-field codec (`json-array.ts`) throws — fails closed — on any
    non-array / corrupt `roles` rather than silently degrading.
  - 68 `BEFORE INSERT/UPDATE` enum/domain triggers reconstruct the Postgres enum
    domains SQLite drops, including a `User.roles` **shape** guard
    (`json_type != 'array'`) + a **domain** guard (every element ∈ Role). A
    fabricated privilege string, or a non-array masquerading as roles, can never
    persist. (`enum-constraints.test.ts`, 14/14 pass.)
- **Full prisma suite: 38/38 pass.** Backfill crash-resume is separately proven
  (`backfill-resume.itest.ts`): kill mid-copy, resume, end with every row exactly
  once, no gaps — for both the integer-PK and composite-PK keyset cases.

## Tradeoffs

File-per-tenant gives stronger isolation: an in-process bug (a handler that
forgets `buildTeamWhereQuery`) can leak across orgs in a shared file, whereas a
per-tenant file makes cross-org reads physically impossible. We accept this
weaker boundary because per-tenant files would have required **re-architecting
global identity** (sessions, accounts, passkeys, the many-orgs-per-user model) —
out of scope for, and orthogonal to, a Postgres→SQLite storage migration. The
codec-throw + trigger layers are the compensating controls that keep a
forgotten predicate from silently corrupting or leaking auth-relevant state.

## Reversibility

File-per-tenant remains future work **iff** global identity is also refactored
to be org-addressable at request entry (a tenant resolver before
`validateSessionToken`, and a sharding story for `User`/`Session`/`Account`).
Until that work is scoped, the shared file + `team-where` boundary is the
settled position for esign. A follow-up HIP supersedes this one if/when global
identity is reworked; this HIP is the authority in the interim.
