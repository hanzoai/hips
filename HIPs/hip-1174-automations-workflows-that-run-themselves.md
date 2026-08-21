---
hip: 1174
title: automations — Workflows That Run Themselves
author: Hanzo AI
type: Standards Track
category: Core
capability: automations
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1174: automations — Workflows That Run Themselves

## Abstract

automations is workflows that run themselves, on a schedule or a webhook. An org
authors a flow — a trigger and a tree of connector actions — and this runs it
durably at `/v1/auto` and keeps its run history. It composes three things it
does not own: per-org connector credentials, the one shared durable engine, and
the one tenant gate. It is implemented in `hanzoai/cloud` at `apps/automations`
(HIP-0106).

## Motivation

The interesting property of an automation platform is not that it fires; it is
that firing is bounded. A surface that turns one event into runs, and lets a run
emit an event, is a loop generator holding the customer's credentials — so the
budget, the concurrency bound and the causation depth are not operational
knobs bolted on afterwards, they are the specification. The second property is
that a run costs the same once no matter which door started it: a manual start,
a tool call and a schedule tick are three entrances to one recorded run, or they
are three different bills for one thing.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 One store, and three things it is not

The store is one SQLite file — the system namespace's `automations`, opened
through the one opener — holding four tables: flows, their versions, their runs,
and the metered claim §5 turns on. Tenant isolation is the `org` column and it is
physical: every uniqueness and lookup index leads with `org`, so the predicate is
the access path rather than a filter applied to a scan. One connection serializes
writes against the single-writer log.

Three things a reader might expect to find in it are deliberately elsewhere:

- **No credential.** A connector reaches a token only through the integrations
  registry (HIP-1250), which holds them sealed in KMS. This capability never
  touches KMS.
- **No engine.** A run is a durable workflow on the one shared in-process
  durable engine (HIP-1062), started in the owner's namespace on this family's
  own queue. Crash recovery, retry and replay are that engine's, not a second
  copy here.
- **No tool registry.** Every connector action registers into the one tool plane
  (HIP-1213) at mount, and that registration is its only projection: discovery
  is `GET /v1/tools`, dispatch is `POST /v1/tools/call`. There is no second tool
  door.

### §2 The boundary: what starts it

The neighbouring capability a reader will confuse this with is **flow**
(HIP-1064), and the distinguishing fact is who presses go.

- **flow** is an agent workflow on a visual canvas: a person composes a graph of
  model calls, runs it, and reads the run. It is authored and started by a human
  in a session.
- **automations** is the trigger→action tree that fires with nobody there: a
  cron tick, an inbound provider event, an internal producer. The word in the
  name is the point.
- **tasks** (HIP-1062) is the durable engine as a product — a customer's own
  workflow, made to survive a crash and replayable. automations is one workflow
  family running on it. Every flow run is a durable run; not every durable run
  is a flow.
- **webhooks** (HIP-1310) is strictly outbound: an app registers an endpoint and
  receives signed deliveries of bus events. `POST /v1/auto/hooks/{source}/{event}`
  is strictly inbound. The two never meet — §6 says nothing here publishes to the
  bus, and nothing on the bus arrives here.
- **integrations** (HIP-1250) holds the org's connected accounts. automations
  holds what to do with them. Connecting an account and using one are separate
  authorities and separate addresses (`/v1/connectors`).

### §3 The address

`/v1/auto`. Three groups of typed operations, plus a catalogue read:

- `/v1/auto/connectors` — the connector catalogue: each external service a step
  can invoke, its auth descriptor, and the input properties of its actions and
  triggers. The catalogue is identical for every tenant, so the gate is a
  validated principal rather than a per-org view. `/v1/auto/pieces` answers the
  same body under the term the upstream flow contract uses, so a client written
  against that vocabulary reads it without translation; `connector` is the Hanzo
  word (HIP-0126).
- `/v1/auto/flows` — list, create, read, update, delete, plus versions at
  `/v1/auto/flows/{id}/versions`, a start at `/v1/auto/flows/{id}/run`, and
  `enable` / `disable`, where enabling a polling trigger creates its schedule and
  disabling deletes it.
- `/v1/auto/runs` — the run list and one run, refreshed from the engine.

Three routes are declared with prose beside them rather than typed, and each
names a wire fact a typed operation cannot carry. Each is also pinned by a test,
so retyping one turns a test red and names what was lost — prose alone is not a
gate.

1. `POST /v1/auto/flows/{id}/operations` — one route, two response shapes: a
   status change answers with the flow, every other operation with the version
   it edited. An operation declares one `Out`, so typing this would have to
   change one of the two bodies.
2. `POST /v1/auto/runs/{id}/resume` — the payload is an arbitrary JSON value
   delivered verbatim into the paused workflow, while the run is addressed by
   the URL. A struct `In` binds the path and rejects every non-object payload; a
   non-struct `In` accepts them all and receives no path parameter. An `In` whose
   unmarshaller swallows the body is not the third way: it preserves REST and
   silently drops the tool and call-plane projections, where the `In` is the whole
   message and an address that lives only in the URL never arrives.
3. `POST /v1/auto/hooks/{source}/{event}` — the body is an open-keyed event
   payload and the key that selects the flows is in the URL. A struct `In` binds
   the path and drops every key it has no field for, which is a 200, a matched
   trigger, and an empty `{{trigger.*}}` — a silent wrong answer, which is worse
   than a loud refusal.

### §4 Tenancy

Every data handler resolves the org from the validated IAM claim (HIP-0026) and
refuses without one. The stored flow's owner is server-derived: a caller cannot
author a flow into another tenant by sending one, because the field a request
might carry is not read.

The durable run carries exactly one credential scope — the owner recorded at
flow start. A step tokenizes against that org and that step's own connector, and
nothing in a step's input can change it. A flow authored by one org can
therefore reach no other org's connection and no other provider's secret.

The inbound path refuses the same way: `Deliver` requires a server-verified org
and starts nothing without one. An unauthenticated producer cannot make a run
happen in anybody's tenant, including their own.

### §5 Money

The surface declares `cloud.Metered` (`plugin/automations/main.go`).

One unit is metered: a run start, kind `automations.run`, priced from the
deployment's fee (`CLOUD_AUTOMATIONS_FEE_CENTS`), zero meaning free. A tool call
dispatched through the tool plane meters the same unit, because it is the same
work. The debit lands through the org's resource meter on the metered record
(HIP-1313) — the same plane inference bills on, not a private side channel.

The gate runs before the run row is written and before the engine is dispatched,
against the same unit and the same fee the debit uses, so the amount authorized
and the amount charged cannot drift; a deployment that prices a run at zero is
ungated exactly as it is unbilled. It is scoped to the org and not to a project,
because the durable path has no request and therefore no claim-bound project,
and a gate must measure what the debit measures.

Exactly once, whatever started it. The durable path is the single owner of run
bookkeeping: a manual start, a tool call and a schedule tick all record through
it, the run row is idempotent by run id, and the meter fires only for the path
that wins the claim. The metered unit, the observability event of §6 and the
audit record of §6 sit behind that one claim, so the three counts are the same
number.

### §6 Events and observability

It publishes nothing on the bus: no `automations.*` event reaches a customer's
webhooks. The `/hooks` route is a sink, not a publisher.

Beyond the request span every route already gets, it emits two things, both
under the exactly-once claim of §5: one counter per run on the observability
plane (HIP-1240), tagged with the org and the brand; and one record on the
tamper-evident trail (HIP-1103) per run, per tool call and per mutating HTTP
action, resource type `automations`, carrying the actor, the outcome and the
request id.

### §7 Bounds

Three ceilings, each on a different amplification, and each MUST hold:

1. **Run starts per rolling minute, per org**, counted from persisted rows so
   the ceiling survives a restart rather than resetting with the process. A
   fan-out or an in-platform loop meets it and stops.
2. **Concurrent run starts and tool executions, per org**, at the front door, so
   one tenant's burst cannot starve another's workers. Per-org and not global:
   a shared counter turns one noisy tenant into everyone's outage.
3. **Causation depth.** An in-platform event carries the number of hops that
   produced it, and one already at the maximum starts nothing. A
   trigger→action→trigger cycle terminates instead of amplifying.

Three sizes bound the store and the wire: a flow tree is capped in step count
and in total serialized bytes at every write, and the resume payload is capped.
An inbound event that carries no idempotency key is given one derived from its
raw body, so a hammer of identical deliveries collapses to one run instead of
minting a fresh run id each time.

### §8 Stage

`ga`. The manifest row declares no stage, and absent is `ga` (HIP-0139 §8).

### §9 Upstream

The flow contract is a port, not an embed. The shared trigger and action types
are plain Go structs whose JSON tags match the upstream field names verbatim,
because the flow builder that authors the tree is the contract's consumer and
both halves must read one shape. The connector catalogue served at
`/v1/auto/connectors` is generated from `hanzoai/auto`.

That contract derives from Activepieces Inc.'s open-source automation platform,
under the MIT Expat licence (2020–2024), and `hanzoai/auto` carries the notice.
What survives in HEAD is the MIT-licensed shared contract, ported to Go —
nothing from that upstream's separately-licensed enterprise tree, and no
upstream code runs: the engine here is Go on the shared durable runtime, and a
connector action executes in the in-process runtime HIP-0126 names. Persistence
is `github.com/hanzoai/sqlite`.

## Rationale

The alternative to composing the durable engine is an execution loop inside this
subsystem, which is a second definition of "a run survived a crash" and a second
place to get retry wrong. The alternative to one metered unit at the durable
boundary is metering at each door, which double-counts the moment a door is
added — and a door was added, in the tool plane, at no cost because the meter
was never there.

## Security Considerations

The wrong implementation lets one org's connected accounts act for somebody
else. The owner recorded at flow start is the only credential scope a step ever
receives, it is the validated claim, and it is neither a field on the flow nor a
field on the event that triggered it. An attacker who can post an event can
start a run and still reach only their own org's tokens.

The second attack is amplification, and it is the one a platform like this
invites: cheap fan-out with the customer's credentials on the far end. The three
ceilings of §7 are the answer, and the run-start ceiling is counted from
persisted rows on purpose — an in-memory counter is reset by the crash the
attacker is causing.

An inbound event body is untrusted and it is threaded into the run as
`{{trigger.*}}`. It is data for a step's input and never a step: the tree that
executes is the published version the org authored, and no payload can add,
reorder or substitute a step. A payload that arrives with keys nobody declared
is carried, not dropped — which is why §3 refuses to type that route, since the
silent version of this is a matched trigger with an empty payload and a 200.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0126 — Integrations, Connectors and the Extension Runtime
- HIP-0139 — Capability
- HIP-1062 — Tasks — The Durable Run
- HIP-1064 — Flow — The Canvas Plane
- HIP-1103 — Audit — The Tamper-Evident Trail
- HIP-1213 — Tools — The Tool Plane
- HIP-1240 — O11y — The Observability Plane
- HIP-1250 — Integrations — The Connection Registry
- HIP-1310 — Webhooks — Outbound Delivery
- HIP-1313 — Usage — The Metered Record

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
