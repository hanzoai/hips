---
hip: 1252
title: Meet — The Join Decision
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: meet
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1252: Meet — The Join Decision

## Abstract

Meet is the virtual office's one server decision: may this caller join this
room. `hanzoai/cloud` `apps/meet` answers it at `/v1/meet` by minting a
short-lived join token; the media itself — audio, video, screen share — rides a
direct browser-to-LiveKit WebRTC connection and never passes through the API
binary.

This HIP declares the capability: no store, the token wire that must not
change, the SPA address that violates the address rule and how it resolves, and
the stage.

## Motivation

A call needs exactly one thing from a server that owns tenant rows: an answer,
signed with the media plane's key, that a specific person may enter a specific
room. Everything else a "meetings service" might hold — presence, media,
recording — is either the media server's or nobody's. Holding only the decision
means no meet pod, no second copy of membership, and no media proxy to become a
bandwidth product.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store

The capability owns none. Its only material is the LiveKit signing key, read
from the same `keys.yaml` the media server validates against (Secret
`livekit-keys`, mounted read-only; `apps/meet/meet.go`). There MUST be one
representation of that key: a second copy projected into env would mint tokens
refused at the media edge, silently. Membership is not held here either — it is
asked of `team`, which owns the workspace rows, over the internal plane
(`apps/meet/meet.go:144`, `cloud.Ask` of `TeamMember` / `TeamWorkspaces`).

### §2 The address

The surface is `/v1/meet`: `getToken`, `session`, `health`. The embedded call
client — the built Hanzo Meet SPA (`apps/meet/ui`) — is today served at a
second, versionless root, `/meet`, which is a HIP-0139 §3.3 violation carried
by cloud's `openapi/misfiled.txt:15`. It resolves by fold to `/v1/meet/ui`,
with deletion available once a verified console address serves the client; the
destination is decided at implementation, and the client's own source already
assumes independence — the published office client supplies its own address
(`apps/meet/meet.go:103`).

### §3 Operations

`GET /v1/meet/health` is typed (`apps/meet/meet.go:361`). The other two are
declared with prose beside the route and cannot be values:
`POST /v1/meet/getToken` answers the raw token as `text/plain` — one opaque
string, read by the published office client with `res.text()`, and a typed
operation always marshals JSON (`apps/meet/meet.go:262`). That wire MUST NOT
change. `GET /v1/meet/session` answers a shape assembled per caller — who they
would be seated as, where the media plane is, which workspaces they may open a
room in — already narrowed to what the mint would grant, so offer and grant
cannot drift (`apps/meet/meet.go:280`).

### §4 Tenancy

The caller is verified by IAM and by nothing else (HIP-0026): meet holds no
key that verifies a caller, so there is no second bearer authority to disagree
with the first. What the principal MAY do is asked of `team` per request. The
identity stamped into the token is the server's — the caller's team account —
never the request body's: the media server evicts a duplicate identity, so a
caller-chosen one would let anyone eject a colleague. A minted token lives ten
minutes and is spent immediately by the connect that follows. Missing or
ambiguous key material is a 503 that names the file and Secret in the boot log
while the caller gets an unadorned "not configured".

### §5 Metering, events, telemetry, stage

The capability is metered (`plugin/meet/main.go:28`, `Price: cloud.Metered`;
`spend.go:305`), and the one billed act is the seat: minting a join token
admits a participant to the media server, gated before the token exists and
debited per seat at `MEET_FEE_CENTS` (`apps/meet/meter.go`). The unit is the
seat, not the minute, because media rides browser-to-SFU directly and no
duration ever reaches this binary — pricing a minute would invent a number
nobody measured. The lobby, the health probe and the SPA stay free: they are
reads. It publishes no events on the bus and emits nothing to observability
beyond the request span every route gets. Stage: `beta` — a virtual-office
vertical, not part of the agentic-OS `ga` set; the manifest row declares it
(`manifest/apps.go:360`, `Stage: Beta`), so per HIP-0139 §8 the prefix
answers 404 to orgs without the `meet` flag.

### §6 Upstream

The server derives from none: the join token is LiveKit's access-token JWT,
implemented here over the standard library's HMAC, with no LiveKit code
embedded. The embedded SPA ships LiveKit's own client stack —
`@livekit/components-react` over `livekit-client`, Apache-2.0 — inside a
committed Vite build (`apps/meet/ui/dist`), because a hand-rolled WebRTC client
is a second implementation of a protocol whose reference implementation the
media server already ships against.

## Rationale

The alternative is a meetings service with its own store: rooms, membership,
presence. Every row it held would be a copy of something `team` or the media
server already owns, and the copies would disagree. Holding only the signing
key and asking the owner per request keeps one authority per fact, at the cost
of one internal-plane round trip on the mint path.

## Security Considerations

The wrong implementation admits an attacker to a room: a mint that skips the
membership ask, a caller-supplied identity that evicts a colleague, or a token
long-lived enough to be worth stealing. Each is closed above — the ask is per
request, the identity is the server's, the ttl is ten minutes. The remaining
exposure is the signing key itself, which exists in one file shared with the
media server, is never projected into env, and whose absence fails closed with
a reason that does not enumerate secret plumbing to the caller.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
