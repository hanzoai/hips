---
hip: 1160
title: Todo — The Work Item Board
author: Hanzo AI
type: Standards Track
category: Application
capability: todo
status: Final
implementation-go: shipped
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1160: Todo — The Work Item Board

## Abstract

`/v1/todo` is the one work-item surface: boards, the issues on them, and the
filters that make a board. Its defining fact is that the forge is the store —
a board is a repository on the deployment's forge and an issue is that
repository's issue — so every read is a read of the forge and nothing mirrors
it. The implementation is `hanzoai/cloud` `apps/todo`.

## Motivation

Hanzo has three planes for state that changes over time, and the boundary
between them is law (`apps/todo/contract.go`): the todo Issue is the one
work-item primitive, `framework.DocType` holds schema-defined domain records,
and `hanzoai/tasks` runs async execution. Every work-item surface — a board, a
repo's Issues tab, an agent's queue — is a filter over the one Issue, never a
parallel store. Without that rule each tool grows its own issues table, and two
tables are two answers to what the state of the work is.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The forge is the store

The forge (Forgejo, `git.hanzo.ai`) is the single source of truth for boards
and issues: a todo project is a repository, an issue is its issue, a board
column is a label from the closed status set, a deadline is a milestone's due
date (`apps/todo/source.go`). Nothing here MAY mirror, cache-as-table, or
write through: a second copy would drift the first time anyone touched the
forge directly, which is every day.

What the capability owns locally is only what the forge cannot answer: a
per-(org, project) SQLite index opened through `cloud.OrgStore`
(`apps/todo/todo.go:109`), holding the org-wide index every external source
lands in — which is what makes "is anyone tracking X" a question with an
answer. The store's on-disk name stays `tracker` (`apps/todo/todo.go:137`)
because the name is a key binding: cek derives each file's encryption key from
it, so renaming it re-keys every tenant's database and opens a blank board
beside the old rows. The rows keep the spelling they were written under.

### §2 The address

Every route is under `/v1/todo` (`manifest/apps.go:177`). Twelve operations;
nine are typed. The three that are not — POST, PATCH and DELETE on
`/v1/todo/projects[/{key}]` — answer a bare 405 with prose declared beside the
route (`apps/todo/todo.go`): project lifecycle is named at the forge, and an
operation whose only answer is a refusal has no shape to type.

Two more endpoints carry the same upsert across process boundaries, on the
internal plane rather than `/v1`: the `cloud.IssueSink` a co-resident feeder
calls, and the plane op `/todo/upsert` for the integrations process that holds
the GitHub App webhook (`apps/todo/upsert_plane.go`). Both are idempotent by
`ExtRef`, so a webhook redelivery updates the row it created rather than
duplicating it.

### §3 Tenancy is two independent controls

The org is the validated principal's (`principal.OrgFrom` /
`principal.Acting`) and MUST NOT be read from a path, query or body. That is
control one. Control two is the forge's own ACL: every forge call drops
privilege to the requesting user (`forge.Client.As`), so the deployment's
machine token cannot read an org the user could not read anyway, and a defect
in control one cannot leak a private repository on its own
(`apps/todo/source.go:30`). On the plane upsert the tenant is the caller's
plane identity — `plane.IssueIn` deliberately has no org field.

The claim operation's holder is the caller, never an argument: "assign to
someone else" is a different act with different authority and already exists
as PATCH. A claim on an issue someone else holds is refused, not silently won.

### §4 Money

The surface declares `cloud.Metered` (`plugin/todo/main.go`) and is listed in
the standing gate (`spend.go:318`, "per-project/issue fee"), so a write
requires standing before it runs; reads are never billable. The fee itself
defaults to zero — charging per issue is the wrong product — and an operator
prices it per deployment via `CLOUD_TODO_FEE_CENTS`, debited through the
shared per-org resource meter (`apps/todo/todo.go:100-107`).

### §5 Events and telemetry

It publishes nothing on the bus, so a customer's webhooks receive no
`todo.*` events. Beyond the request span every route gets, it emits only its
own log lines; no additional spans or metrics.

### §6 Upstream

It forks and embeds nothing. It is a client of the deployment's Forgejo forge,
speaking that forge's REST dialect, and the recipient of GitHub issues the
integrations feeder mirrors in through the sink in §2. The per-tenant index
rides `github.com/hanzoai/sqlite` (MIT / Apache-2.0 dual).

### §7 Stage

`beta`: a vertical application (a project board), not part of the self-service
agentic-OS core. The manifest row (`manifest/apps.go:177`) does not yet
declare it, so today the operations serve as `ga` does; the row's
`Stage: Beta` is the one edit that closes the drift (HIP-0139 §8).

## Rationale

The alternative to reading the forge is the usual one: a local issues table
with a sync job. It answers faster and it is how the two-answers defect gets
in — an engineer who relabels in the forge web UI has, on this design, moved
the card, because the column is the label. A status column in a table here
could not have that property, and keeping it true would mean a reconciler that
is itself a third answer.

## Security Considerations

The exposure is a cross-tenant board read, and it is closed twice over (§3):
the org is never caller-supplied, and even a bug there runs into the forge's
own per-user ACL because the request acts as the user, not as the machine
token. The wrong implementation — one credential, org from the request — hands
an attacker every private org's issues on the forge through a single confused
deputy. The claim rule is the other one: a claim that names its holder would
let anyone hand work to anyone by naming them.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
