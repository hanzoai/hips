---
hip: 1107
title: Bot — Your Machines, Connected
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: bot
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1107: Bot — Your Machines, Connected

## Abstract

`/v1/bot` is an org's own machines, connected and ready to take a command: bot
nodes on user machines dial in and hold a socket, and the org lists its
connected nodes and invokes commands on one, authorized once at the socket. It
is implemented in `hanzoai/cloud` at `apps/bot`. Its manifest row is three
leaves — connect, nodes, peer/invoke — beneath a parent prefix another app still
routes; that sharing is a ledgered defect the sibling app closes by vacating,
never by alias (`manifest/apps.go:387` and the `bots` row's comment).

## Motivation

A node runs on someone's machine and dials in; the socket it holds is the only
way to reach it. An HTTP invoke lands on any replica while the socket lives on
one, so without a shared rendezvous a fleet of N replicas would answer 1/N of
its own invocations — and the registry this replaces kept no tenant dimension in
its node map at all, making isolation a property of deployment rather than of
the data structure (`apps/bot/registry.go`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store

No durable store. A node is addressed by `(org, nodeID)` in an in-memory
registry on the replica holding its socket — a lookup without an org cannot
compile — and which replica holds which node is written to a shared presence map
in Hanzo KV (`CLOUD_KV_URL`), because with more than one replica the socket
lands on one pod and the invocations land on any (`apps/bot/subsystem.go:72-77`).

### §2 Addresses

`GET /v1/bot/nodes` is typed. Three routes are declared with prose beside their
wire facts (`apps/bot/subsystem.go:210-248`, held closed by
`apps/bot/typed_wire_test.go`): `GET /v1/bot/connect` is a WebSocket upgrade —
101 and then a duplex frame stream for the life of the node, which no typed
operation can declare; `POST /v1/bot/nodes/{id}/invoke` refuses with a domain
body a client switches on, identical for a pre-flight refusal and the node's
own denial, and needs the caller's device header no In field may carry;
`POST /v1/bot/peer/invoke` is the replica-to-replica forward, plain-text
refusals and a body bound a typed op cannot see.

### §3 Tenancy

Every route takes its org from the gateway's verdict — injected after IAM
validation, after stripping any client copy — never from a body, query or path,
because a caller that could name an org could attach a machine into someone
else's tenant. Without a validated principal the request is refused rather than
defaulted. The one exception is the peer hop, whose org does arrive in a body:
it is a machine call from another replica that derived the org from a validated
header, and it authenticates with a shared token (`CLOUD_BOT_PEER_TOKEN`);
without that token the peer endpoint serves nothing at all. A node id belonging
to another org answers exactly like one that does not exist.

### §4 Authorization happens once, at the socket

The registry runs the policy gate on the replica holding the node — the only
one that knows what the node declared — so a locally-held node and one reached
through a forward are authorized by the same code with the same session in
hand. Everything a node self-reports (capabilities, commands, platform) is
shown, never load-bearing: what it may actually be asked to run is decided
against the deployment's allowlist, where a dangerous command is reachable only
through an explicit allow and deny wins over both (`apps/bot/policy.go`). A
connect carrying an Origin header is refused outright — a node is a daemon, and
removing the browser category entirely is the gate.

### §5 Money, events, telemetry, stage, upstream

Free (`plugin/bot/main.go`, `cloud.Free`). It publishes nothing to the bus.
Beyond the request span it emits structured log lines only. Stage `beta`
(`manifest/apps.go:387`, `Stage: Beta`): an edge-device vertical rather than
the self-service core, reached by flag while the command-policy surface
settles. It derives from no third-party OSS upstream; the socket wire is
protocol version 3 of the `@hanzo/bot` TypeScript gateway, which Hanzo also
maintains, implemented here frame-for-frame (`apps/bot/ws.go`).

## Rationale

The alternative rendezvous is the KV's own pub/sub, publishing invokes to the
holding pod's channel. It was rejected for its failure mode: a replica that died
between the lookup and the publish costs the caller the whole timeout, where a
direct peer forward fails fast and visibly. The alternative to socket-time
authorization is a check at invoke time, and a second check in a place that
sometimes has the session and sometimes does not is how two answers drift apart.

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

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
