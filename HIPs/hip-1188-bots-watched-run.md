---
hip: 1188
title: Bots — The Watched Run
author: Hanzo AI
type: Standards Track
category: Core
capability: bots
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0135, HIP-0139
---

# HIP-1188: Bots — The Watched Run

## Abstract

Bots is a bot doing your work on a real desktop, live, while you watch. It is
the control plane for a bot run — a task executing on a surface the bot drives,
a desktop or terminal sandbox, with a live session a person can open to watch
or take over. The run itself lives in the executor that owns the sandbox; this
capability decides who may ask, asks on the caller's behalf, and derives the
session address. It is implemented in `hanzoai/cloud` at `apps/bots`.

## Motivation

A run has one home, and it is not here. The executor holds the sandbox, so it
is the only truthful answer to the question "what is running". A control plane
that kept a second copy of that state would own a second id space agreeing with
nothing: listing runs that do not exist, and stopping runs that were never
started. So this capability holds what a control plane holds — who you are,
which org you are, and whether you may — and asks the executor for the rest.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store

It owns none. The run registry is the executor's, keyed under the tenant that
started the run, and the id space is the executor's too: cloud does not mint a
run id, does not persist one, and could not resolve one it invented. That is
exactly why the list and the stop agree — both speak the only id space that has
ever held a real run (`apps/bots/wire.go`).

The one value derived here is the session address. It is built from the run id
against a browser-facing gateway base, so the executor never has to know its own
public origin, and that base is a separate knob from the in-cluster address the
control plane calls: a session a browser embeds must be publicly reachable, and
a pod-internal name is not (`apps/bots/bots.go:80-88`).

### §2 The addresses

Two typed operations and one declared.

`GET /v1/bots` answers `{bots:[{runId, task, surface, status, sessionUrl,
startedAt}]}`. The array is always present, so an org with no runs serializes as
`{"bots":[]}` and never as null. `status` is the executor's word, and `running`
when it names none.

`POST /v1/bots/{runId}/stop` answers `{runId, status}` with the run's terminal
state. The run id is URL-borne only; it has never been accepted in a body.

`POST /v1/bots/run` is declared with prose beside the route and answers 501 to
every call (`apps/bots/bots.go` init). It cannot be a value because it has no
success to publish: a typed operation declares a 200 body, and typing this one
would declare a body it can never send, then mint a tool in the agent list and a
command in the CLI for an operation that cannot succeed — which a model reading
the tool list will call. It is also body-tolerant, which a typed operation cannot
express: the handler never reads the body, so any bytes at all, malformed JSON
included, get the same 501, where a typed operation refuses an unparseable body
before the handler runs. The address is published rather than dropped because it
is reserved: routes resolve by specificity, so the `run` literal can never bind
as a run id against its neighbour.

A launch operation, when it exists, MUST NOT mint a run id the executor has not
acknowledged, MUST NOT hand back a session address for a session that does not
exist, and MUST NOT charge for either. It gets typed in the change that can
prove a bot boots, and not before.

### §3 The boundary

Three neighbours, and each responsibility falls on one side.

**bot** (HIP-1107) is an org's own machines, connected and ready to take a
command: a node on someone's laptop dials in and holds a socket. That is a
different noun from a run in a sandbox this platform operates, and `/v1/bot` is
that capability's root by HIP-0139 §3.1. This capability also routes the bare
`/v1/bot` prefix, where it relays the executor's own operational paths verbatim
— a liveness probe is not a tenant-scoped resource, so it stays a relay rather
than being reimplemented in Go. The pair is ledgered in cloud's
`openapi/misfiled.txt` and MUST close by fold under `/v1/bots`, never by alias
(HIP-0139 §7): the root belongs to the capability that shares its name. The
relay is not a public address in either place — the public rule drops a relay
door (HIP-0135), so it reaches no generated client and no tool list.

**visor** (HIP-1172) owns the bot MACHINE — a box you rent, at
`/v1/compute/bots`. This
capability owns the bot RUN. Two values, two names, and the schema namespace is
flat, which is why the row type here is qualified rather than called `bot`.

**coding** dispatches its own tasks to the same executor over the same
transport. That is a shared road, not a shared surface: each caller owns its own
wire contract, and the transport is forbidden to learn what a run is. The moment
it does, it has stopped being a transport (`apps/bots/transport.go:1-18`).

### §4 The tenant

The org is `principal.Acting` — minted from the validated bearer's owner claim
(HIP-0026) — and never a request field. A caller that presents no validated
principal is refused 403, which closes the direct-to-pod path where a forged
identity header is restored but no user is. The org is what cloud sends the
executor, which keys every run under the tenant it names, so a caller cannot
read or halt another tenant's runs.

A foreign run id resolves under the CALLER's org, where it does not exist, and
answers absent — the same answer a nonexistent id gets, so the surface is not an
existence oracle. A run id is bounded before it is sent onward; an oversize id is
not a run this org owns.

Failure is reported honestly in both directions, because the two answers are
different claims. An executor that cannot list is 502, never `[]`: an empty array
says "your org has no runs", and "we could not ask" is a different fact. Absence
is honoured on a stop only when the executor ANSWERS absent; an executor that
does not serve the operation at all has reported nothing about the run, and
reporting `stopped` on that basis would be a stop that cannot fail
(`apps/bots/transport.go:70-80`).

### §5 Money

Free, and said in those words: the surface declares `cloud.Free`
(`plugin/bots/main.go`). Nothing on it debits any plane, and no per-run fee is
taken anywhere. A price belongs in the same change that can prove a bot boots.

### §6 Events and observability

It publishes nothing on the bus; a customer's webhooks receive no `bots.*`
event. Beyond the request span every route gets, it emits structured log lines
only.

### §7 Stage

`ga`. The manifest row declares no stage, and absent is `ga` (HIP-0139 §8).

### §8 Upstream

It derives from none: it forks, embeds and mirrors no OSS project. The executor
is a separate Hanzo service reached over one transport, which resolves the base
address, mints the server-originated identity for a call cloud makes, frames the
stream, bounds a call, and decides whether a cleartext hop is allowed. Today
those bytes move over HTTP; moving them to ZAP (HIP-0106) is a change to that one
file plus each caller's stub.

## Rationale

The alternative to asking the executor is mirroring its registry here, which
buys a faster list and pays for it with a second id space, a reconciliation
loop, and a stop that can address a run the sandbox never had. The alternative
to 501 is a plausible launch — an id, a session address, a receipt — for a bot
that never booted. A refusal a caller can act on is worth more than a success it
cannot.

## Security Considerations

Two things an attacker gets from the wrong implementation, and both are worse
than a read leak because the surface is destructive.

If the org came from a request field or a client header, one tenant enumerates
another's runs and then halts them: a stop is not a disclosure, it is the loss
of somebody's work in progress. The org is resolved from the validated principal
and passed to the executor as the tenant key, so the boundary is enforced twice
by two parties and takes no caller input at either.

If a launch minted an id the executor had not acknowledged, the caller would
hold a session address pointing at a node that does not exist, and any price
attached to that call would be money taken for nothing. §2 forbids both.

The relay is the third edge. It refuses before forwarding, because the executor
trusts the identity headers it receives as gateway-minted — an unauthenticated
call allowed through would hand it a victim tenant. It forwards the caller's own
headers and mints nothing, bounds the body it reads back, and returns the
executor's status and content type unchanged.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0135 — What Is Public
- HIP-0139 — Capability
- HIP-1107 — Bot — Your Machines, Connected
- HIP-1172 — visor — Compute You Rent

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
