---
hip: 1210
title: Agents — Define, Run, Keep the Run
author: Hanzo AI
type: Standards Track
category: Application
status: Final
created: 2026-08-20
requires: HIP-0139, HIP-0026, HIP-0106
capability: agents
---

# HIP-1210: Agents — Define, Run, Keep the Run

## Abstract

`/v1/agents` is autonomous agents for an org: define one as a model, a system
prompt and a set of tool names; run it through the same in-process AI client the
rest of the console uses; keep every run (`apps/agents/agents.go:1-14`). The
same capability carries the tool-calling conversation surface and the coding
engine — one autonomous run against a repository, from prompt to pushed branch.
It is implemented in `hanzoai/cloud` at `apps/agents`.

## Motivation

An agent that can be defined but whose runs evaporate is a demo. This capability
exists so a run — its input, its steps, its tool calls, its outcome — is a
record the org owns, in the org's own file, attributable to a principal and a
price. The conversation and coding surfaces were once separate apps beside it;
the code has already merged them (`apps/agents/conversation.go:123`), and this
HIP states the one surface that merge settles.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### The surface

Every address is under `/v1/agents`. The definition-and-run collection is typed:
list/create at the root, get/update/delete at `/:ref`, `POST /:ref/run`,
`GET /:ref/runs` (`apps/agents/agents.go:17-27`), beside the typed session
surface (`apps/agents/sessions.go`). The conversation group — one tool-calling
round, its presets, its threads — answers at `/v1/agents/chat`,
`/v1/agents/chat/presets` and `/v1/agents/chat/conversations[/:id]`: UNDER the
collection root, not at it. `POST /v1/agents` is already the typed create, and
one address MUST NOT answer two operations, so the round takes a sub-path and
the collection keeps its root. Its four operations stay untyped until the
upstream seams they name land, and each declares its contract in prose beside
the wire (`apps/agents/conversation.go`, const `chat`). `POST /v1/agents/coding`
starts one autonomous coding run, typed, answering 202 with the run's handle
(`plugin/agents/coding.go:133`).

Both folds have landed and `hanzoai/cloud` `openapi/misfiled.txt` carries no
line for this capability. The coding endpoint moved off `/v1/coding` together with
the chat server's dispatch of it, in one release, because that op's reachability
is the only way a chat turn gets to a sandbox (`plugin/agents/coding.go:128-131`).
The conversation surface moved off `/v1/agent` when the orchestrator stopped
owning its own address (see Upstreams); the manifest row is one prefix again.

### One store, one org, one file

The capability owns the `agents` per-org store: each org's agents, runs,
sessions, events, targets and claim keys live in that org's own SQLite at
`{DataDir}/orgs/{slug}/agents.db`, opened through `cloud.OrgStore`
(`apps/agents/agents.go:353`, `apps/agents/store.go:112`). The file is named
from the gateway-minted org (HIP-0026) and nothing else; every route into
storage begins at the validated principal, and `tenancy.go` is the only file
that resolves a store (`apps/agents/tenancy.go:13-30`). A request without a
non-empty org MUST be refused; the org is never read from a body. The store
holds definitions and run I/O only — tool credentials live in KMS by reference.

### The run is the billed unit

An agent run is metered as a flat per-run fee — $1.00 by default, set by
`CLOUD_AGENT_FEE_CENTS`, zero making runs free — gated before the run and
debited after it through the shared per-org resource meter into the commerce
ledger, attributed under kind `agent` (`apps/agents/agents.go:99-111,971-975,
1025`). The fee is per run and not per token, deliberately: the in-process AI
client returns no token counts, so token pricing here would be fabricated. The
token spend of a run's completions is `ai`'s account, joined to this run by its
id (`types.ChatRequest.RunID`).

### Events and observability

The capability publishes no events on the tenant bus, so a customer's webhooks
receive nothing from it. Live session activity is an in-process stream a client
subscribes to over the session surface (`apps/agents/sessions_stream.go:60`) —
a rendezvous, not a queue; the durable owner of a routed run is the tasks
engine (`apps/agents/mailbox.go:13-20`). Beyond the request span every route
gets, it emits the per-run trace: an `agent.run` root span with nested
`agent.step` and `agent.tool` spans, shipped over ZAP to o11y
(`apps/agents/agents.go:66-68`).

### Stage

`ga`. The manifest row carries no stage field, which is `ga` by HIP-0139 §8.

### Upstreams

The conversation orchestrator embeds `github.com/hanzoai/agent` v1.0.6 (MIT;
its LICENSE carries OpenAI's copyright — the agents-SDK lineage the module
forks), which registers the conversation routes and owns their per-org
history (`apps/agents/conversation.go`). The module composes those four routes
off ONE prefix: `MountAt(app, prefix, ...)` registers under the prefix it is
given and `Mount(app, ...)` is `MountAt` at `DefaultPrefix` — so the standalone
daemon keeps `/v1/agent` and whoever composes the router chooses the address
cloud serves. Nothing in the round reads the prefix. Nothing else here derives
from an OSS upstream.

## Rationale

The alternative the codebase actually had was three apps — `agent`, `agents`,
`coding` — one concept under a pair of names a reader could not tell apart, plus
an endpoint whose app held no store of its own. HIP-0139 §2.4 decides the number
(the collection is plural), and §7.1 decides the folds: a coding run is an agent
run, recorded in the same per-org file, billed by the same meter, so a second
root was a second name for one thing.

## Security Considerations

A wrong tenant resolution here is worse than a data leak: a coding run holds a
sandbox with a push credential, so cross-tenant reach is cross-tenant write
access to repositories. Three properties close it. Isolation is the file — a
mis-resolved store fails closed as an empty read, never a neighbour's rows
(`apps/agents/store.go`). The routed-run mailbox keys every offer by
`(org, target)`, so a claim for one tenant's machine cannot surface another's
run (`apps/agents/mailbox.go:22-25`). And a routed run crosses to the executing
machine carrying no credential at all: the machine authenticates with its own
already-held keys, and the process gives run credentials back at shutdown
(`apps/agents/mailbox.go:27-31`, `plugin/agents/coding.go`).

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1062 — Tasks — The Durable Run

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
