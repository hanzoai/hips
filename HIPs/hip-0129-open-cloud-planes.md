---
hip: 0129
title: Open Cloud Planes
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-07-17
requires: HIP-0026, HIP-0044, HIP-0106, HIP-0111, HIP-0112, HIP-0118, HIP-0119, HIP-0124, HIP-0126, HIP-0127, HIP-0128
---

# HIP-0129: Open Cloud Planes

## Abstract

One cloud, few planes, one owner per noun. Each durable noun of the agent
platform — credential, channel, sync, workflow, task, GPU, identity, secret —
maps to exactly one route family with exactly one owning package. This HIP is
the canonical map of those planes, the invariants of the `/v1/connectors`
custody plane now in flight and the planned `/v1/channels` transport plane,
the roadmap that
ports the remaining durable nouns out of the Node bot container, and the
permanent boundary of what stays in the container.

Every claim in this document carries a tier:

- **Shipped** — on `main` today; package/route named.
- **In flight** — exists on a named branch; not on `main`.
- **Planned** — does not exist; carries a backlog id (P1–P15) or a named
  branch reservation.

No claim without a tier. In-flight and planned work is never described in the
present tense of the shipped system.

## Motivation

Three forces:

1. **One custody plane.** Users bring their own model accounts — ChatGPT/Codex
   OAuth, Anthropic setup-tokens and api-keys, GitHub Copilot device flow, and
   ~40 plain api-key providers. Today each client, bot, and integration invents
   its own storage and refresh. Custody must be one plane: verified before
   stored, sealed in KMS, refreshed in one place.
2. **One transport plane.** Messages ride Slack, Telegram, Discord, Teams.
   Today each transport reinterprets action strings ad hoc. Transport must be
   one plane: a portable typed envelope the transports map, never parse.
3. **Subsumption of the OpenClaw surface.** The Node bot (OpenClaw-derived)
   owns nouns it should not: schedules, credentials, channels, devices, model
   catalogs. Roughly 15–16k Go LOC of ports (Planned, P1–P15) move every
   durable noun into the cloud, shrinking the container to a stateless verb
   executor. What remains in the container is there for honest technical
   reasons (native modules, host filesystem, loop-state coupling, vendor Node
   clients), named explicitly in the boundary section — never by default.

The alternative — many small services, each with its own auth, storage, and
policy — is the complected state this HIP retires. One noun, one owner, one
route family (per the service conventions of HIP-0119, the gateway of
HIP-0044, and the topology of HIP-0112).

## The planes

| Plane | Route family | Noun | Owner | Tier |
|---|---|---|---|---|
| Custody | `/v1/connectors` | Per-user BYO external accounts | `clients/integrations` (extended) | **In flight** — branch `feat/connectors` |
| Transport | `/v1/channels` | Portable message envelope, DM pairing, send/inbox | `clients/channels` (new) | **Planned** — branch `feat/channels` reserved; no transport code yet |
| Data | `/v1/sync` | Bidirectional sync engine | `clients/sync` | **Shipped** |
| Workflows | `/v1/automations` | Flows/runs + goja piece runtime; native replacement for the standalone ActivePieces pod | `clients/automations` | **Shipped** |
| Hosting | `/v1/compute/bots` | `@hanzo/bot` Node containers for container-bound capabilities | `clients/bots` | **Shipped** |
| Durable engine | `/v1/tasks` | Tasks | `clients/tasks` | **Shipped** |
| GPU presence | `/v1/gpus` + fleet | BYO GPU | `clients/fleet` + `clients/visor` | **Shipped** |
| Identity | IAM (HIP-0026, HIP-0111) | Users, orgs, roles | IAM | **Shipped** |
| Secret custody | KMS | Sealed secrets | `clients/kms` | **Shipped** |

Rules of the table:

- A noun appears in exactly one row. A new noun gets a new row, not a second
  home in an existing one.
- Route families are flat under `/v1` (HIP-0119; no `/api/` prefix, no `/v2`).
- Org-scoped `/v1/integrations` (HIP-0126) stays as-is; user-scoped
  `/v1/connectors` is additive beside it, not a replacement.

## Custody plane: `/v1/connectors`

Tier: **In flight**, branch `feat/connectors`. Extends `clients/integrations`.

### Scope

Per-user bring-your-own external accounts:

- ChatGPT / Codex — OAuth device-code flow.
- Anthropic — setup-token and api-key.
- GitHub Copilot — device flow.
- ~40 api-key providers — key paste with live verification.

### Custody invariants

1. **Verify before store.** A credential is verified against its provider
   live before it is persisted. Unverifiable input is rejected, never parked.
2. **KMS namespace.** Secrets seal in KMS at
   `/orgs/{org}/users/{user}/connectors/{provider}/{label}`. The path is the
   identity; user scope nests under org scope (tenant isolation per HIP-0118).
3. **No secrets in rows.** SQLite rows hold metadata and the KMS reference,
   never secret material.
4. **Single-flight refresh.** One refresh per credential at a time; rotation
   reseals into the same KMS path. Concurrent callers wait on the flight in
   progress; no thundering refresh, no split-brain tokens.

### Acquisition / custody split

`@hanzo/cli` performs local browser PKCE where a browser exists and posts the
resulting credential bundle to `POST /v1/connectors/:provider/credential`.
The cloud owns everything else: device-code flows, live verification, KMS
sealing, refresh. Acquisition is the only client-side act; custody is never
client-side.

## Transport plane: `/v1/channels`

Tier: **Planned** — branch `feat/channels` reserved; no transport code exists
yet. Target: new package `clients/channels`; imports the custody seams of
`clients/integrations`, never the reverse.

### Scope

- **Portable envelope.** Typed actions — `command | url | select | approval`.
  Transports map typed actions to native affordances. No transport ever
  infers meaning from raw strings (no "`/` prefix means command" sniffing).
- **DM pairing / allowlist policy.** 8-character pairing codes, 1-hour TTL,
  max 3 pending per account, owner bootstrap on first approval, reusable
  access groups.
- **Send + inbox** riding native Slack, Telegram, Discord, and Teams
  transports via an additive ingress hook in `clients/integrations`.

### Boundary

Channels are transport only. They render portable presentation, enforce
transport limits, and map native callback envelopes. Product command trees,
provider policy, and feature menus live above the transport plane.

## Roadmap: the port backlog

Tier: **Planned**, all items. ~15–16k Go LOC total, ordered by leverage.
Nothing below exists; ids are stable references for future HIPs and PRs.

| Id | Port | Target |
|---|---|---|
| P1 | Model catalog/registry, org-scoped, provider-id normalization | `clients/models` (extends HIP-0124 routing) |
| P2 | Tenant triggers — user cron + webhooks as trigger kinds on the tasks engine | automations |
| P3 | Credential rotation/cooldown/failover policy, cross-turn only | beside `clients/link/route.go` |
| P4 | Pairing primitive — keypair device identity, approval lifecycle, scoped KMS-hashed tokens, QR/setup-code bootstrap | `clients/device` |
| P5 | `/v1/images` `/v1/videos` `/v1/audio` on the metered plane, async via `/v1/tasks` | `clients/media` |
| P6 | `tool_search`/`describe`, Code Mode goja bindings, remote-MCP source | `clients/tools` extensions |
| P7 | WhatsApp native on whatsmeow | `clients/channels` |
| P8 | Twelve small transports — Signal, Mattermost, IRC, LINE, Google Chat, Nostr, Zalo-bot, Twitch, SMS/Twilio, QQ, Synology, Nextcloud | `clients/channels` |
| P9 | Matrix on mautrix-go | `clients/channels` |
| P10 | Exec-approvals control plane | `clients/agents` |
| P11 | Draft/typing compositor | `clients/channels` |
| P12 | Agent skills org store | skills |
| P13 | Micro-ports — status rollup, session auth binding, subagent caps, sync transcripts provider, KMS secret-ref resolvers | various |
| P14 | Cloud-vendor model adapters — gated on upstream-router audit | `clients/models` |
| P15 | Feishu — demand-gated | `clients/channels` |

Ordering is leverage, not chronology. An item ships when its owning plane is
ready to hold the noun, never before.

## Non-goals: the container boundary

Permanent, honest. These stay in the Node bot container because each is bound
by native modules, host filesystem, loop-state coupling, or vendor Node
clients — not by inertia:

- Agent loop core; tool pipeline enforcement; exec/PTY host.
- Per-turn provider transports; harnesses (codex, claude-cli, copilot).
- Browser; realtime voice/meetings; voice codecs.
- Node-bound channels: Zalo-user, WeChat, Tlon, Reef, Raft.
- Local model servers; local media; the memory family.
- Plugin SDK/loader; gateway plane internals; loop-process internals.
- Local diagnostics emitters; bot product features.
- stdio MCP/LSP/worktrees; exec-approval enforcement (the control plane is
  P10; enforcement stays at the loop).

Rejected alternative, recorded: goja hosting of the bot was evaluated and
rejected — native modules (Baileys, sqlite-vec, sharp) and real sockets
cannot live in an interpreter. The Node plugin SDK is never ported to Go;
cloud extensibility is connectors, automations, and tools.

## Endgame

The cloud owns every durable noun: identity, credentials, devices, models,
channels, schedules, sessions/runs/approvals, tools, media, skills,
metering/pricing/o11y. The bot container shrinks to a stateless verb executor
reading prepared facts from cloud APIs. A tenant gets messaging, cron,
credentials, devices, media, and tool calling with zero Node processes unless
a workspace, shell, browser, codec, or vendor Node client is genuinely
involved.

## Security considerations

- Secrets exist in exactly one custody: KMS, under the
  `/orgs/{org}/users/{user}/connectors/{provider}/{label}` namespace.
  Database rows carry references only. A leaked database leaks no credentials.
- Verify-before-store keeps unverified attacker-supplied credentials out of
  custody entirely.
- Single-flight refresh with resealing prevents token divergence between
  concurrent consumers — the class of bug that silently extends the life of a
  revoked token.
- Tenant isolation rides the org boundary (HIP-0118); user-scoped connector
  paths nest under the org, so cross-tenant reads are structurally
  unrepresentable in the KMS namespace.
- Typed channel actions eliminate string-sniffing on inbound callback data —
  transports never parse product strings, so a hostile payload cannot forge a
  command by resembling one.
- Pairing policy (short-TTL codes, pending caps, owner bootstrap) bounds DM
  enrollment abuse on the transport plane.

## Backwards compatibility

- `/v1/integrations` (org-scoped, HIP-0126) is unchanged. `/v1/connectors`
  (user-scoped) is additive.
- Shipped planes (`/v1/sync`, `/v1/automations`, `/v1/compute/bots`,
  `/v1/tasks`, `/v1/gpus`, IAM, KMS) keep their contracts; this HIP names
  their ownership, it does not alter their routes.
- The channels ingress hook in `clients/integrations` is additive; existing
  integration consumers see no change.
- Ports P1–P15 replace container-owned nouns as they land; each port names
  its own migration in its own PR/HIP. This document promises no timeline.

## Reference implementation

- Shipped: `clients/sync` (`/v1/sync`), `clients/automations`
  (`/v1/automations`), `clients/bots` (`/v1/compute/bots`), `clients/tasks`
  (`/v1/tasks`), `clients/fleet` + `clients/visor` (`/v1/gpus`),
  IAM, `clients/kms`.
- In flight: branch `feat/connectors` (custody plane, extending
  `clients/integrations`).
- Planned: the transport plane (branch `feat/channels` reserved; no
  transport code yet) and P1–P15 have no implementation.
