---
hip: 1107
title: Bot — A Run on a Surface
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: bot
status: Final
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0135, HIP-0139
---

# HIP-1107: Bot — A Run on a Surface

## Abstract

`/v1/bot` is a bot doing your work on a surface this platform operates — a task
executing on a desktop or terminal sandbox, with a live session a person can
open to watch or take over — together with the endpoint onto the service that executes
it. It is implemented in `hanzoai/cloud` at `apps/bot` (HIP-0106).

A bot is not a machine. The org's own connected machines are `node`
(HIP-1325): a node dials in and holds a socket, and what runs on it is a
command it declared it can run. A bot MACHINE is a third thing again — a box you
RENT, at `/v1/visor/compute/bots` (HIP-1172). Three values, three names, three
addresses.

## Motivation

A run has one home, and it is not here. The executor holds the sandbox,
so it is the only truthful answer to "what is running". A control plane that
kept a second copy of that state would own a second id space agreeing with
nothing: listing runs that do not exist, and stopping runs that were never
started. So this capability is the shape a control plane is — hold who you are,
which org you are, and whether you may, and ask the thing that actually holds
the state.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store

No store at all.

The run registry is the executor's, keyed under the tenant that started the run,
and the id space is the executor's too: cloud does not mint a run id, does not
persist one, and could not resolve one it invented. That is exactly why the list
and the stop agree — both speak the only id space that has ever held a real run
(`apps/bot/wire.go`).

The one value derived here is the session address. It is built from the run id
against a browser-facing gateway base, so the executor never has to know its own
public origin, and that base is a separate knob from the in-cluster address the
control plane calls: a session a browser embeds must be publicly reachable, and
a pod-internal name is not (`apps/bot/run.go`).

### §2 The addresses

Two route families under one prefix, which is what makes one router safe here.

**The run plane.** `GET /v1/bot/runs` answers `{bots:[{runId, task, surface,
status, sessionUrl, startedAt}]}`. The array is always present, so an org with
no runs serializes as `{"bots":[]}` and never as null; `status` is the
executor's word, and `running` when it names none. `POST /v1/bot/runs/{runId}/stop`
answers `{runId, status}` with the run's terminal state, and the run id is
URL-borne only — it has never been accepted in a body. Both are typed.

`POST /v1/bot/runs` is declared with prose beside the route and answers 501 to
every call. It cannot be a value because it has no success to publish: a typed
operation declares a 200 body, and typing this one would declare a body it can
never send, then mint a tool in the agent list and a command in the CLI for an
operation that cannot succeed — which a model reading the tool list will call.
It is also body-tolerant, which a typed operation cannot express: the handler
never reads the body, so any bytes at all, malformed JSON included, get the same
501, where a typed operation refuses an unparseable body before the handler
runs. The launch is a POST to the collection rather than a `run` literal beside
`{runId}`, so the method says the verb (HIP-0128 §1) and there is no literal to
out-rank its parameter sibling.

A launch operation, when it exists, MUST NOT mint a run id the executor has not
acknowledged, MUST NOT hand back a session address for a session that does not
exist, and MUST NOT charge for either. It gets typed in the change that can
prove a bot boots, and not before.

**The executor's ops face.** `/v1/bot/runtime/*` relays `@hanzo/bot`'s own
operational paths verbatim, the prefix stripped on the way out
(`apps/bot/relay.go`). A liveness probe is not a tenant-scoped resource, so it
stays a relay rather than being reimplemented in Go, and it is not a public
address: the public rule drops a relay endpoint (HIP-0135), so it reaches no
generated client and no tool list. The segment is load-bearing. The relay was
once `All("/v1/bot/*")` in a second app, a greedy wildcard over the whole of a
sibling's subtree held apart only by two manifest rows and specificity; from
`/v1/bot/runtime` it cannot reach a sibling at all, and since the machine plane
left for its own binary (HIP-1325) there is no sibling here for it to reach.

### §3 The boundary

**nodes** (HIP-1325) owns the machine an org already owns and connects.
**visor** (HIP-1172) owns the bot MACHINE — a box you rent, at
`/v1/visor/compute/bots`. This capability owns the bot RUN. Three values, three
names, and the schema namespace is flat, which is why the row type here is
qualified rather than called `bot`.

**coding** dispatches its own tasks to the same executor over the same
transport. That is a shared road, not a shared surface: each caller owns its own
wire contract, and the transport is forbidden to learn what a run is. The moment
it does, it has stopped being a transport (`apps/bot/transport.go`).

### §4 Tenancy

Every route takes its org from the gateway's verdict — injected after IAM
validation, after stripping any client copy (HIP-0026) — never from a body,
query or path, because a caller that could name an org could attach a machine
into someone else's tenant, or halt their work. Without a validated principal
the request is refused rather than defaulted. A foreign run id resolves under the
CALLER's org, where it does not exist, and answers absent — so the surface is not
an existence oracle. A run id is bounded before it is sent onward; an oversize id
is not a run this org owns.

The org is also what cloud sends the executor, which keys every run under the
tenant it names, so the boundary is enforced twice by two parties and takes no
caller input at either.

Failure is reported honestly in both directions, because the two answers are
different claims. An executor that cannot list is 502, never `[]`: an empty
array says "your org has no runs", and "we could not ask" is a different fact.
Absence is honoured on a stop only when the executor ANSWERS absent; an executor
that does not serve the operation at all has reported nothing about the run, and
reporting `stopped` on that basis would be a stop that cannot fail
(`apps/bot/transport.go`).

### §5 Money

Free, and said in those words: the surface declares `cloud.Free`
(`plugin/bot/main.go`). Nothing on it debits any plane, and no per-run fee is
taken anywhere. A price belongs in the same change that can prove a bot boots.

### §6 Events and observability

It publishes nothing on the bus; a customer's webhooks receive no `bot.*` event.
Beyond the request span every route gets, it emits structured log lines only.

### §7 Stage

`ga`. The manifest row declares no stage, and absent is `ga` (HIP-0139 §8).

### §8 Upstream

It derives from no third-party OSS project. The executor is a separate
Hanzo service reached over one transport, which resolves the base address, mints
the server-originated identity for a call cloud makes, frames the stream, bounds
a call, and decides whether a cleartext hop is allowed. Today those bytes move
over HTTP; moving them to ZAP (HIP-0106) is a change to that one file plus each
caller's stub.

## Rationale

The alternative to asking the executor is mirroring its registry here, which
buys a faster list and pays for it with a second id space, a reconciliation
loop, and a stop that can address a run the sandbox never had. The alternative
to 501 is a plausible launch — an id, a session address, a receipt — for a bot
that never booted. A refusal a caller can act on is worth more than a success it
cannot.

## Security Considerations

This capability is destructive rather than merely readable. If the org came from a
request field or a client header, one tenant enumerates another's runs and then
halts them: a stop is not a disclosure, it is the loss of somebody's work in
progress. And if a launch minted an id the executor had not acknowledged, the
caller would hold a session address pointing at a node that does not exist, and
any price attached to that call would be money taken for nothing. §2 forbids
both.

The relay is the other edge. It refuses before forwarding, because the executor
trusts the identity headers it receives as gateway-minted — an unauthenticated
call allowed through would hand it a victim tenant. It forwards the caller's own
headers and mints nothing, bounds the body it reads back, and returns the
executor's status and content type unchanged.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0128 — Resource Surface Standard — Generated REST over ZAP
- HIP-0135 — What Is Public
- HIP-0139 — Capability
- HIP-1172 — visor — Compute You Rent
- HIP-1325 — Nodes — Your Machines on a Socket

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
