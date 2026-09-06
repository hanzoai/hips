---
hip: 1180
title: Link — A Record of Provider Accounts
author: Hanzo AI
type: Standards Track
category: Core
capability: link
status: Final
implementation-go: shipped
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1180: Link — A Record of Provider Accounts

## Abstract

`link` is the unified AI login manager's registry: the org+user-scoped record of
WHICH provider accounts — Claude Max, ChatGPT Plus, a Hanzo API key, a raw
provider key — a developer has signed into, ON WHICH MACHINES, with each
account's latest usage snapshot. It answers at `/v1/link`. It holds no
credential: the secret stays sealed where the connections plane put it, and this
capability holds the binding and the numbers. It is implemented in
`hanzoai/cloud` at `apps/link` (HIP-0106).

## Motivation

A developer signs into Claude on a laptop, into ChatGPT on a desktop, and points
a Hanzo key at both. No machine can answer "which accounts do I have, where, and
how much of each plan is left" — each login knows only itself, and a plan's
remaining percentage is a number no Hanzo request produced, so no gateway ledger
holds it either. One registry makes that a read, and makes failover across those
accounts an ordered list a customer can inspect before a request is dialled.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The atom, and the stores it owns

The atom is a Link: one `(user, device, provider, account)` binding plus its
kind, status, last-seen and latest usage snapshot. A device is the
`(machine, host, os)` projection shared by a machine's Links, not a stored entity
of its own — so there is no device-to-link join and no orphan device to collect
(`apps/link/link.go:1-12`).

The durable store is ONE encrypted SQLite file, the deployment's own `link`,
opened through the one opener so it is born encrypted and comes back with the
single-connection cap already applied (`apps/link/store.go:39-42`). It carries
two tables whose meanings never mix. `link` holds one row per binding under the
natural key `(org, subject, machine, provider, account)`, so a re-registration
UPSERTs the row that already exists and reads back the id it was first given
(`apps/link/store.go:113-135`). `routed_usage` is an additive counter keyed on
`(org, subject, provider, account)` — what this gateway routed through an
account, in exact per-request deltas, transactionally added
(`apps/link/routed.go:1-30`).

Beside them this capability owns one warehouse series: `hanzo.account_usage` and
its daily rollup in the datastore, a `ReplacingMergeTree(ts)` whose order-by IS
the dedup key, because a device collector re-reports the SAME window as it fills
and those reports are one fact observed twice rather than two facts
(`apps/link/datastore.go:38-52`). The series is history; the Link row is the
durable truth. Every read and write against the series MUST degrade — a write to
a no-op, a read to an honest "unavailable" — when the datastore is absent, and
MUST NOT answer a fabricated zero, which reads as truth and is worse than an
outage.

NO SECRET LIVES HERE, and the store's shape is what makes that structural: there
is no column for one. A provider's OAuth token or API key stays where the
connections plane sealed it, and the device collector registers a Link and pushes
its usage with the SAME IAM bearer it already carries — never a provider secret.

### §2 The addresses

Eleven operations under `/v1/link`, every one typed: each is a `zip` typed op
with a named In and Out, so the REST route, the served document, the MCP tool,
the CLI command and every generated client project from one registration
(`apps/link/http.go:125-142`). None is declared-and-untyped — this capability
holds no route whose shape it cannot name.

| operation | what it answers |
|---|---|
| `POST /v1/link` | registers a signed-in provider account on a machine → the Link (201) |
| `GET /v1/link` | the caller's linked accounts and the devices they sit on |
| `GET /v1/link/{id}` | one linked account |
| `DELETE /v1/link/{id}` | logs out one account and stops the sessions it was running |
| `GET /v1/link/devices/{machine}` | one machine: its accounts, usage and live sessions |
| `POST /v1/link/devices/{machine}/revoke` | logs out every account on one machine and stops its sessions |
| `GET /v1/link/route` | the failover order across the caller's accounts (§4) |
| `POST /v1/link/usage` | usage samples from the device collector (202) |
| `GET /v1/link/usage` | one provider account's own usage dashboard |
| `GET /v1/link/usage/accounts` | what the gateway routed through each account |
| `GET /v1/link/usage/summary` | plan consumption and Hanzo spend, side by side |

The summary is the point of the usage plane, and it carries a labelling rule.
"My Claude Max plan" and "what I spend through Hanzo" come from different meters
with different meanings, so every row MUST be labelled by source, by scope and by
confidence, and the two MUST NOT be summed: a plan's percentage is not money, and
a provider's own spend is not a Hanzo charge (`apps/link/usage.go:15-27`). Both
halves of that board resolve their window through ONE resolver over a closed set
of range labels, so the account rows and the Hanzo rows always cover the same
period; an unknown label is an error, never a silent substitution.

Registration order is load-bearing and fixed: the literals `route`, `usage` and
`devices` are declared before `:id`, because the router matches in registration
order and the parameter would otherwise swallow them.

### §3 Tenancy

The tenant is the PAIR `(org, subject)`. The org is the validated IAM owner claim
the identity boundary parked (HIP-0026); the subject is the validated user on the
same request. One gate resolves both, and a caller with no validated principal,
an empty org, or a call arriving off the HTTP path with no attested caller is
refused with 403 — the same answer an anonymous REST call gets, fail-closed, one
gate rather than two (`apps/link/http.go:44-60`).

Every statement in the store leads with `org = ? AND subject = ?` as bound
parameters. Neither half is ever a request field. Within one org a colleague's
accounts are invisible, because the subject is part of the key and not a filter
somebody could widen.

### §4 Route is a policy, not a dial

`GET /v1/link/route` returns the ordered candidate list a caller fails over
along — two subscriptions for redundancy, then the metered API as the
always-available backstop. Each candidate carries provider, account, plan, kind,
billing mode, availability and remaining rate-limit headroom, so a caller knows
how a candidate BILLS before it dials it (`apps/link/route.go:20-45`). The policy
is a total function of the caller's Links and the snapshots already on them,
never a live provider probe, so the plan is reproducible and provable in a unit
test.

Execution — dialling a provider, seeing a 429, advancing to the next candidate —
belongs to the gateway. The resolved credential rides the request context as a
PROCESS-LOCAL value and MUST NOT be serialized: not a header, not a body, not
argv, not an error, not a log line. The provider egress reads it at the instant it
dials and discards it (`apps/link/carrier.go:1-9`). Crossing a process boundary
with it is out of scope by construction, which is what makes "a credential lives
only in memory" mechanical rather than a promise.

Per-request selection carries only `(provider, profile)`. A Selection has no org
field and no subject field, by construction — those come solely from the
validated principal at the router boundary — so the worst a hostile selector
achieves is naming an account the caller does not have, which resolves to
unavailable (`apps/link/select.go:5-11`).

### §5 Money

The surface is free. The plugin declares `cloud.Free` (`plugin/link/main.go`),
and the registry holds no metering client at all, which makes it structurally
incapable of creating a charge (`apps/link/store.go:21-30`).

What bills is the routed call, and the Link's own billing mode decides. A
subscription account's inference is paid by the developer's plan with the
provider directly: it is metered here for VISIBILITY and MUST NOT be charged. An
api-key account's routed call debits the metering spine under the provider label
`ai` — the same label every other inference debit carries, so routed spend sums
into the org's `ai` scope like any other. The retail price is injected rather
than computed here, and the default charges nothing: the customer already paid the
provider on their own key, so absent an operator-set fee the usage is recorded and
no charge is invented (`apps/link/meter.go:29-45`). A routed call is therefore
metered exactly once per meaning and never charged twice. The meter is handed the
account IDENTITY, the kind and the served token counts — never the credential, so
no metering path can observe a secret.

### §6 Events and observability

It publishes nothing on the bus. A customer's webhooks at `/v1/webhook` receive
no `link.*` event.

Beyond the request span every route gets, it emits structured log lines only: one
per served routed call, one warning per failover attempt naming the org, the
account and the reason, and one warning when a revoke's session stop fails. The
last carries a rule: a stop failure MUST NOT fail the revoke, because the row is
already revoked and the row is the durable truth (`apps/link/http.go:590-602`).
It writes no audit record; the evidence a revoke leaves is the row itself, which
is retained with status `revoked` rather than deleted, so the account's usage
history survives a log-out.

### §7 Stage

`beta`. The manifest row declares `Stage: Beta` (`manifest/apps.go:172`), so
the capability is reached by flag (HIP-0139 §8). It is the self-service cloud's
answer to "which AI accounts do I have", which the console renders on first
load, so `ga` is where it is headed; the promotion is the one manifest edit
HIP-0139 §8.4 names.

### §8 Upstream

It derives from no upstream project: nothing here is forked, embedded or
mirrored. Persistence links `github.com/hanzoai/sqlite` (MIT / Apache-2.0 dual),
the one SQLite driver cloud links. Provider identifiers match the ids the Hanzo
usage collector registers, by value — a shared vocabulary, not shared code.

### §9 Boundary

The neighbour to confuse this with is `billing`, and the split is usage versus
money.

- **billing** is the ORG's money endpoint — balance, spend, cards. `link` is the
  PERSON's account endpoint — which providers they signed into and what those
  accounts consumed. `GET /v1/billing/usage/accounts` is billing's address and
  reads this capability's per-account breakdown at the same `(org, subject)`
  pair: the shape is link's, the address is billing's, and the charge of record
  is commerce's ledger and never a counter here. A number under `/v1/link` is
  USAGE; a number under `/v1/billing` is MONEY; they MUST NOT be added.
- **iam** (HIP-0026) is who the caller is at Hanzo, and the only thing that
  authenticates anyone. `link` is who the caller is at somebody ELSE, and it
  authenticates nobody. A row here grants access to nothing, here or upstream.
- **The connections plane** (`/v1/ai/connections/{provider}`) owns a linked
  account's LIFECYCLE: the authorization dance, sealing the secret per org, and
  refreshing a token before it expires. This capability only READS — given an
  account, resolve the current sealed credential for one dial. Storage, sealing
  and refresh belong there; selection, ordering and metering belong here, which is
  why a secret has no home in this store (`apps/link/resolver.go:5-11`).
- **The gateway.** `/v1/link/route` publishes the ORDER; `/v1/chat/completions`
  dials. A capability that both chose and dialled would make the choice
  unobservable, and the choice is the half a customer needs to audit before it
  costs them anything.

## Rationale

The alternative to a registry is asking each machine. That answers only for the
machine that is awake, cannot order a failover across two of them, and turns
"what did I spend where" into a question with as many answers as devices. The
alternative to keeping the credential out is one store holding both the map and
the keys, which upgrades a metadata leak into a provider-account takeover. The
alternative to a policy address is failover buried in the gateway with no address
at all: the order becomes an implementation detail nobody can read back, on a
decision that moves money.

Three ledgers sit in this design and none is allowed to absorb another: the
collector's plan snapshots, the gateway's routed deltas, and commerce's charge of
record. Their engines differ because their shapes differ — a snapshot is a
re-observation to replace, a delta is a quantity to add — and forcing one into the
other's storage loses counts silently.

## Security Considerations

The wrong implementation gives an attacker one of three things.

A cross-tenant read is the largest. The registry names every provider account a
person holds and how much of each plan is left — a map of a developer's whole AI
footprint, and a list of exactly which subscriptions to attack elsewhere. The
`(org, subject)` predicate is bound, in the store, on every statement, and both
halves come only from the validated principal, so a handler cannot widen it and a
request field cannot assert it.

A credential is the one an attacker wants and the one that is not here. No column
stores one, no response carries one, and the resolved value exists only as a
process-local context value that is read at egress and dropped. The blast radius
of a compromised registry is metadata.

A misrouted dial is the subtle one: if a per-request selector could carry a
tenant, a caller could route on somebody else's account and consume somebody
else's plan. A Selection carries `(provider, profile)` and nothing else — closed
by construction rather than by validation, so there is no check to forget.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
