---
hip: 1325
title: Node — A Machine an Org Owns
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: node
status: Final
created: 2026-08-21
requires: HIP-0026, HIP-0106, HIP-0135, HIP-0139, HIP-1107
---

# HIP-1325: Node — A Machine an Org Owns

## Abstract

`/v1/node` is an org's own machines. An agent on someone's machine dials in and
holds a socket; the org lists what is connected and asks one of them to run a
command, authorized once at the socket against the deployment's own allowlist.
It is implemented in `hanzoai/cloud` at `apps/node` (HIP-0106).

A node is not a bot. A bot is an agent bound to a machine and a bot RUN is a task
the executor drives on a surface this platform operates (HIP-1107); a bot MACHINE
is a box you RENT (HIP-1172). This is the machine you already own, connected.
Three values, three names, three addresses.

## Motivation

The machine half answered under the bot's name. It was `/v1/bot/nodes` while one
package served both planes, then `/v1/node` while the package was still called
`bot` — an address not named for the app that answered it, which is the one line
cloud's `openapi/misfiled.txt` carried for it (HIP-0139 §5.1). The name has
followed the address, and the two planes are two capabilities.

They were never one. HIP-0139 §7.2 permits a split along a store boundary and
only there, and the boundary here was already drawn in the file layout: the node
plane holds a presence map keyed by machine, and the run plane holds nothing at
all because the executor holds it. Neither reads the other's, neither has a
symbol the other uses, and neither ever did. What kept them in one package was
the shared word `bot`, which is exactly the coincidence HIP-0139 exists to
refuse.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store

No durable store.

A node is addressed by `(org, nodeID)` in an in-memory registry on the replica
holding its socket — a lookup without an org cannot compile — and which replica
holds which node is written to a shared presence map in Hanzo KV
(`CLOUD_KV_URL`), because with more than one replica the socket lands on one pod
and the invocations land on any.

The presence map is this capability's alone. The run plane it split from opens
no store, so there is nothing shared to divide and no reconciliation between
them; that is the store boundary HIP-0139 §7.2 requires, and it predates the
split.

### §2 The addresses

Four route families under `/v1/node`. `GET /v1/node` is typed. Three are
declared with prose beside their wire facts, held closed by this capability's own
projection gate — one gate per capability, because a ledger that spans two cannot
say which of them a route belongs to:

`GET /v1/node/connect` is a WebSocket upgrade — 101 and then a duplex frame
stream for the life of the node, which no typed operation can declare.
`POST /v1/node/{id}/invoke` refuses with a domain body a client switches on,
identical for a pre-flight refusal and for the node's own denial, and reads the
caller's device header, which no `In` field may carry: a caller that could name
its own device could pre-approve its own privileged command.
`POST /v1/node/peer/invoke` is the replica-to-replica forward — plain-text
refusals, and a body bound a typed operation cannot see.

The peer hop is a machine call and not a public address: the public rule drops
it (HIP-0135), so it reaches no generated client and no tool list.

### §3 Tenancy

Every route takes its org from the gateway's verdict — injected after IAM
validation, after stripping any client copy (HIP-0026) — never from a body,
query or path, because a caller that could name an org could attach a machine
into someone else's tenant, or run a command on one. Without a validated
principal the request is refused rather than defaulted.

A node id belonging to another org MUST answer exactly like one that does not
exist, so the surface is not an existence oracle, and an id is bounded before it
is looked up — an oversize id is not a node this org has.

The one exception is the peer hop, whose org does arrive in a body: it is a
machine call from another replica that derived the org from a validated header,
and it authenticates with a shared token (`CLOUD_BOT_PEER_TOKEN`). Without that
token the peer endpoint MUST serve nothing at all.

### §4 Authorization happens once, at the socket

The registry runs the policy gate on the replica holding the node — the only one
that knows what the node declared — so a locally-held node and one reached
through a forward are authorized by the same code with the same session in hand.
There MUST NOT be a second check at invoke time: a check in a place that
sometimes has the session and sometimes does not is how two answers drift apart.

Everything a node self-reports — its capabilities, its commands, its platform —
is shown and never load-bearing. What it may actually be asked to run is decided
against the deployment's allowlist, where a dangerous command is reachable only
through an explicit allow and a deny wins over both. A connect carrying an
Origin header is refused outright: a node is a daemon, and removing the browser
category entirely is the gate.

### §5 Money

Free, and said in those words: the plugin declares `Price: cloud.Free`. Nothing
on this surface debits any plane.

### §6 Events and observability

It publishes nothing on the bus, so a customer's webhooks (HIP-1310) receive no
`nodes.*` event. Beyond the request span every route gets, it emits structured
log lines only.

### §7 Shutdown

The presence-renew loop ends on graceful shutdown, which releases this replica's
claims on the way out so peers stop forwarding into a pod that is draining. The
hook belongs to this capability's binary and to no other: the run plane it split
from has no loop and now declares none.

### §8 Stage

`ga`. The manifest row declares no stage, and absent is `ga` (HIP-0139 §8).

### §9 The name owes the singular sweep

The row is `node`, and under the rule that now governs (HIP-0139) the canonical
name is the singular: this capability's row, package, plugin, floor key and tag
become `node`. It is written plural here because that is what the manifest
carries at the moment of writing, and a HIP whose `capability:` disagrees with
the row describes a fleet nobody runs.

It is deliberately NOT renamed ahead of the sweep. Four siblings — `bot`,
`campaign`, `link`, `network` — are in the identical state, and moving one of
five leaves a mixed estate plus a collision with the slice that moves the rest.
Nothing is broken while it waits: the derivation accepts `/v1/node` already, so
both spellings answer and only the published spelling is pending.

### §10 Upstream

It derives from no third-party OSS project. The socket wire is protocol version
3 of the `@hanzo/bot` TypeScript gateway, which Hanzo also maintains,
implemented here frame-for-frame.

## Rationale

The alternative rendezvous is the presence store's own pub/sub, publishing
invokes to the holding pod's channel. It was rejected for its failure mode: a
replica that died between the lookup and the publish costs the caller the whole
timeout, where a direct peer forward fails fast and visibly.

The alternative to the split is the arrangement it replaces — one package, two
planes, one address not named for its app and a line in the ratchet explaining
it. Folding the other way, to `/v1/bot/nodes`, was the cheaper edit and the
wrong one: it would file a machine under an agent's name permanently, in nine
projections, on the argument that they once shipped in the same binary.

## Security Considerations

This capability's wrong implementation is remote code execution on a customer's
machine — the commands include running processes and reading devices — so every
control in §3 and §4 is about who can reach a node and with what.

The org from the gateway's verdict closes cross-tenant attach and invoke. The
Origin refusal closes a page riding a signed-in viewer's session into
registering a node. The allowlist closes a compromised cloud asking for a
command the deployment never enabled. Correlation ids minted under the
connection id mean a node can only ever answer calls placed on its own socket.

The peer token is the remaining credential, and an unauthenticated peer endpoint
that took an org from a body would be a cross-tenant invoke primitive — which is
why, absent the token, it serves nothing.

The split itself removes one hazard and creates none. The run plane's relay is a
greedy wildcard over `/v1/bot/runtime/*`; while both planes registered on one
router, that wildcard and this capability's static leaves were held apart by
specificity alone. They are now in different binaries behind different prefixes,
where neither can reach the other at all.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0135 — What Is Public
- HIP-0139 — Capability
- HIP-1107 — Bots — Runs on a Surface
- HIP-1172 — visor — Compute You Rent
- HIP-1310 — Webhooks — Outbound Delivery

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
