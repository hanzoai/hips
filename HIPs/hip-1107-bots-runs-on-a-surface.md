---
hip: 1107
title: Bots — Your Machines and the Runs on Them
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: bots
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0135, HIP-0139
---

# HIP-1107: Bots — Your Machines and the Runs on Them

## Abstract

`/v1/bots` is an org's own machines and the runs on them. A bot node on someone's
machine dials in and holds a socket; the org lists its connected nodes and
invokes commands on one, authorized once at the socket. A bot run is the other
half: a task executing on a surface this platform operates — a desktop or
terminal sandbox — with a live session a person can open to watch or take over.
It is implemented in `hanzoai/cloud` at `apps/bot` (HIP-0106).

The two halves were two apps under one prefix, which HIP-0139 §1 refuses: one
capability is one package and one plugin, and §2.4 keeps the singular of a pair
that differs only in number. They are one app now, and this is the one HIP.

## Motivation

A node runs on someone's machine and dials in; the socket it holds is the only
way to reach it. An HTTP invoke lands on any replica while the socket lives on
one, so without a shared rendezvous a fleet of N replicas would answer 1/N of
its own invocations — and the registry this replaces kept no tenant dimension in
its node map at all, making isolation a property of deployment rather than of
the data structure (`apps/bot/registry.go`).

A run has one home, and it is not here either. The executor holds the sandbox,
so it is the only truthful answer to "what is running". A control plane that
kept a second copy of that state would own a second id space agreeing with
nothing: listing runs that do not exist, and stopping runs that were never
started. Both halves are therefore the same shape — hold who you are, which org
you are, and whether you may, and ask the thing that actually holds the state.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store

No durable store, on either half.

A node is addressed by `(org, nodeID)` in an in-memory registry on the replica
holding its socket — a lookup without an org cannot compile — and which replica
holds which node is written to a shared presence map in Hanzo KV
(`CLOUD_KV_URL`), because with more than one replica the socket lands on one pod
and the invocations land on any (`apps/bot/node.go`, `apps/bot/registry.go`).

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

Three route families under one prefix, which is what makes one router safe here.

**The node plane.** `GET /v1/bots/nodes` is typed. Three routes are declared with
prose beside their wire facts (`apps/bot/node.go`, held closed by
`apps/bot/typed_wire_test.go`): `GET /v1/bots/connect` is a WebSocket upgrade —
101 and then a duplex frame stream for the life of the node, which no typed
operation can declare; `POST /v1/bots/nodes/{id}/invoke` refuses with a domain
body a client switches on, identical for a pre-flight refusal and the node's own
denial, and needs the caller's device header no `In` field may carry;
`POST /v1/bots/peer/invoke` is the replica-to-replica forward, plain-text
refusals and a body bound a typed op cannot see.

**The run plane.** `GET /v1/bots/runs` answers `{bots:[{runId, task, surface,
status, sessionUrl, startedAt}]}`. The array is always present, so an org with
no runs serializes as `{"bots":[]}` and never as null; `status` is the
executor's word, and `running` when it names none. `POST /v1/bots/runs/{runId}/stop`
answers `{runId, status}` with the run's terminal state, and the run id is
URL-borne only — it has never been accepted in a body. Both are typed.

`POST /v1/bots/runs` is declared with prose beside the route and answers 501 to
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

**The executor's ops face.** `/v1/bots/runtime/*` relays `@hanzo/bot`'s own
operational paths verbatim, the prefix stripped on the way out
(`apps/bot/relay.go`). A liveness probe is not a tenant-scoped resource, so it
stays a relay rather than being reimplemented in Go, and it is not a public
address: the public rule drops a relay door (HIP-0135), so it reaches no
generated client and no tool list. The segment is load-bearing. The relay was
once `All("/v1/bots/*")` in a second app, a greedy wildcard over the whole of a
sibling's subtree held apart only by two manifest rows and specificity; from
`/v1/bots/runtime` it cannot reach a sibling at all.

### §3 The boundary

**visor** (HIP-1172) owns the bot MACHINE — a box you rent, at
`/v1/visor/compute/bots`. This capability owns the bot RUN. Two values, two
names, and the schema namespace is flat, which is why the row type here is
qualified rather than called `bots`.

**coding** dispatches its own tasks to the same executor over the same
transport. That is a shared road, not a shared surface: each caller owns its own
wire contract, and the transport is forbidden to learn what a run is. The moment
it does, it has stopped being a transport (`apps/bot/transport.go`).

### §4 Tenancy

Every route takes its org from the gateway's verdict — injected after IAM
validation, after stripping any client copy (HIP-0026) — never from a body,
query or path, because a caller that could name an org could attach a machine
into someone else's tenant, or halt their work. Without a validated principal
the request is refused rather than defaulted. A node id belonging to another org
answers exactly like one that does not exist, and a foreign run id resolves
under the CALLER's org, where it does not exist, and answers absent — so neither
surface is an existence oracle. A run id is bounded before it is sent onward; an
oversize id is not a run this org owns.

The org is also what cloud sends the executor, which keys every run under the
tenant it names, so the boundary is enforced twice by two parties and takes no
caller input at either.

The one exception is the peer hop, whose org does arrive in a body: it is a
machine call from another replica that derived the org from a validated header,
and it authenticates with a shared token (`CLOUD_BOT_PEER_TOKEN`); without that
token the peer endpoint serves nothing at all.

Failure is reported honestly in both directions, because the two answers are
different claims. An executor that cannot list is 502, never `[]`: an empty
array says "your org has no runs", and "we could not ask" is a different fact.
Absence is honoured on a stop only when the executor ANSWERS absent; an executor
that does not serve the operation at all has reported nothing about the run, and
reporting `stopped` on that basis would be a stop that cannot fail
(`apps/bot/transport.go`).

### §5 Authorization happens once, at the socket

The registry runs the policy gate on the replica holding the node — the only one
that knows what the node declared — so a locally-held node and one reached
through a forward are authorized by the same code with the same session in hand.
Everything a node self-reports (capabilities, commands, platform) is shown,
never load-bearing: what it may actually be asked to run is decided against the
deployment's allowlist, where a dangerous command is reachable only through an
explicit allow and deny wins over both (`apps/bot/policy.go`). A connect
carrying an Origin header is refused outright — a node is a daemon, and removing
the browser category entirely is the gate.

### §6 Money

Free, and said in those words: the surface declares `cloud.Free`
(`plugin/bot/main.go`). Nothing on it debits any plane, and no per-run fee is
taken anywhere. A price belongs in the same change that can prove a bot boots.

### §7 Events and observability

It publishes nothing on the bus; a customer's webhooks receive no `bot.*` event.
Beyond the request span every route gets, it emits structured log lines only.

### §8 Stage

`ga`. The manifest row declares no stage, and absent is `ga` (HIP-0139 §8).

### §9 Upstream

It derives from no third-party OSS project. The socket wire is protocol version
3 of the `@hanzo/bot` TypeScript gateway, which Hanzo also maintains,
implemented here frame-for-frame (`apps/bot/ws.go`); the executor is a separate
Hanzo service reached over one transport, which resolves the base address, mints
the server-originated identity for a call cloud makes, frames the stream, bounds
a call, and decides whether a cleartext hop is allowed. Today those bytes move
over HTTP; moving them to ZAP (HIP-0106) is a change to that one file plus each
caller's stub.

## Rationale

The alternative rendezvous is the KV's own pub/sub, publishing invokes to the
holding pod's channel. It was rejected for its failure mode: a replica that died
between the lookup and the publish costs the caller the whole timeout, where a
direct peer forward fails fast and visibly. The alternative to socket-time
authorization is a check at invoke time, and a second check in a place that
sometimes has the session and sometimes does not is how two answers drift apart.

The alternative to asking the executor is mirroring its registry here, which
buys a faster list and pays for it with a second id space, a reconciliation
loop, and a stop that can address a run the sandbox never had. The alternative
to 501 is a plausible launch — an id, a session address, a receipt — for a bot
that never booted. A refusal a caller can act on is worth more than a success it
cannot.

## Security Considerations

This capability's wrong implementation is remote code execution on a customer's
machine — the commands include running processes and reading devices — so every
control above is about who can reach a node and with what. The org from the
gateway's verdict closes cross-tenant attach and invoke; the Origin refusal
closes a page riding a signed-in viewer's session into registering a node; the
allowlist closes a compromised cloud asking for a command the deployment never
enabled; and the correlation ids minted under the connection id mean a node can
only ever answer calls placed on its own socket. The peer token is the remaining
credential, and an unauthenticated peer endpoint that takes an org from a body
would be a cross-tenant invoke primitive — which is why, absent the token, it
serves nothing.

The run half is destructive rather than merely readable. If the org came from a
request field or a client header, one tenant enumerates another's runs and then
halts them: a stop is not a disclosure, it is the loss of somebody's work in
progress. And if a launch minted an id the executor had not acknowledged, the
caller would hold a session address pointing at a node that does not exist, and
any price attached to that call would be money taken for nothing. §2 forbids
both.

The relay is the third edge. It refuses before forwarding, because the executor
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

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
