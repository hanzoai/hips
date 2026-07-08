---
hip: 0126
title: Integrations, Connectors & the Extension Runtime — One Registry, One Way
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2026-07-07
requires: HIP-0004, HIP-0010, HIP-0034, HIP-0052, HIP-0105, HIP-0116
---

# HIP-0126: Integrations, Connectors & the Extension Runtime — One Registry, One Way

## Abstract

Hanzo plugs external capability into the platform in three shapes — third-party
**services** (Slack, GitHub, Stripe), AI **providers** (OpenAI, Anthropic, a BYO
GPU fleet), and agent **tools** (MCP). Each grew its own vocabulary, its own
config surface, and its own credential path, and the automation engine still
carried the ActivePieces word **"pieces"** for what the rest of the codebase
already calls **connectors**.

This HIP fixes the vocabulary and the shape. It defines **one umbrella concept —
the Integration** — with exactly three kinds (**Connector**, **Provider**,
**Tool**), surfaced through **one Integrations registry** per org/project, behind
**one IAM-scoped config/auth surface**. It defines **Flows** (the IFTTT-style
trigger→action builder on the `@xyflow` canvas) as the consumer that wires
Connectors together, and it names the **Extension Runtime** (HIP-0105) as the ONE
way custom logic *runs* — four engines (native Go, goja, wazero, v8go) behind a
single `Runtime` interface — with a **Plugin** (HIP-0116) being a code extension
that runs inside it.

It is deliberately **orthogonal and reference-not-duplicate**: it aligns the
existing standards (HIP-0004 providers, HIP-0010 MCP tools, HIP-0034 automation
platform, HIP-0105 extension runtime, HIP-0116 plugin model) into one taxonomy
rather than restating them, and it normatively **retires "pieces" in favour of
"connectors."**

## Motivation

### The scatter

An integration means "an external capability plugged into the platform." Today
that capability arrives through three unrelated doors:

1. **Connectors** — the automation-flow building block. `clients/automations`
   ships a native-Go connector framework (`connector.go` / `connector_core.go`,
   "ONE registry, N connectors; a connector self-registers from its `init()`"),
   but the *catalogue* surface still spoke the ActivePieces dialect: a `/pieces`
   route, a `PieceMetadata`/`PieceCount` schema, `pieces` JSON fields. Two names
   for one thing in one package.

2. **Providers** — AI model / compute providers, defined by HIP-0004 (unified
   provider interface at the gateway) and HIP-0113 (provider runtime), with BYO
   providers added by HIP-0124. Their config lives at the gateway.

3. **Tools** — MCP / agent tools, defined by HIP-0010. Their config lives with
   the MCP surface (`/v1/automations/mcp` and the agent stack).

Three registries, three credential paths, three admin surfaces, three words for
"the thing you connect." A customer who has "connected Slack, connected OpenAI,
and connected an MCP tool server" has done the same *kind* of thing three times
and seen three different UIs to do it.

### Two axes, repeatedly conflated

There are **two independent questions** about any plugged-in capability, and the
codebase kept braiding them:

- **WHAT is plugged in** (an external service / a model provider / a tool) — the
  *Integration* axis.
- **HOW custom logic runs** (in-process, sandboxed, per-tenant) — the *Extension
  Runtime* axis (HIP-0105).

A Connector is a *what*. The goja/wazero engine that executes a custom connector
transform is a *how*. Naming them with one word ("plugin" for everything, or
"piece" for both the catalogue entry and the JS runner) is the conflation this
HIP removes. Decomplecting the two axes is the whole point.

## Taxonomy

The single decision this HIP encodes:

```
Integration  (umbrella: an external capability plugged in; ONE registry per org/project)
├── Connector   external-service integration      Slack · GitHub · Stripe   (HIP-0034 Flows building block)
├── Provider    AI model / compute provider       OpenAI · Anthropic · BYO  (HIP-0004, HIP-0113, HIP-0124)
└── Tool        MCP / agent tool                  MCP servers · agent tools (HIP-0010)

Flows  (IFTTT trigger→action on the @xyflow canvas)  — consumes Connectors as nodes  (HIP-0034)

Extension Runtime  (HOW custom logic runs; ONE Runtime interface, 4 engines)  (HIP-0105)
├── native (Go)     default; zero-cost, no sandbox
├── goja  (JS/TS)   soft sandbox; multi-tenant SaaS default for user JS
├── wazero (WASM)   hard sandbox; the Rust/TinyGo/AssemblyScript/Python path
└── v8go  (V8)      hard sandbox; cgo; not recommended at high concurrency

Plugin  (a code extension that adds platform capability; runs IN the Extension Runtime)  (HIP-0116)
```

**Definitions (normative):**

- **Integration** — an external capability made available to an org/project. It is
  the umbrella; it is never a fourth kind alongside its own kinds.
- **Connector** — an Integration of kind *external service*, and the unit a Flow
  step invokes. **This is the ONE Hanzo term; "piece" is retired.**
- **Provider** — an Integration of kind *AI model / compute provider*, governed by
  HIP-0004.
- **Tool** — an Integration of kind *MCP / agent tool*, governed by HIP-0010.
- **Flow** — an IFTTT-style trigger→action automation authored on the `@xyflow`
  graph canvas (HIP-0034); its nodes are Connectors.
- **Extension** — a unit of custom logic plus its `extension.json` manifest, run by
  the Extension Runtime (HIP-0105). Answers *how code runs*, never *what is
  connected*.
- **Plugin** — a code Extension that adds platform capability (the VM/subsystem
  model, HIP-0116). A Plugin runs in the Extension Runtime.

## Specification

### 1. One Integrations registry per org/project

Every org/project has **exactly one** logical Integrations registry. It is
**IAM-scoped**: identity and the tenant boundary come from the JWT `owner` claim
(HIP-0026 / HIP-0111), and every registry entry is physically keyed by org, per
the tenant-isolation model (HIP-0118). The registry is the ONE place that answers
"what is connected here, of every kind, and with what credentials."

- **One config/auth surface.** Connecting a Connector, a Provider, or a Tool is
  the same *act*: authorize (OAuth2 / secret / BYO endpoint), store the credential
  **KMS-sealed** (never plaintext), and register the entry. Credentials are
  custodied by `clients/integrations` (KMS-sealed, per-org); a connector reaches a
  token ONLY through `integrations.TokenFor`, never KMS directly.
- **One list, kind-badged.** The registry lists all three kinds through one
  surface; a `kind` field (`connector` | `provider` | `tool`) is for display and
  filtering only — the connect / authorize / revoke lifecycle is identical across
  kinds.
- **Not a service mesh.** The Integrations registry is the *external-capability*
  registry. It is distinct from HIP-0052 Nexus, whose "registry" is the
  *internal service* registry (K8s Services, circuit-breaking, routing). Different
  axis, different registry; see "Relationship to existing HIPs."

### 2. Kind: Connector

A Connector is an external-service integration and the Flow building block. It
carries a name, a display name, a logo, an auth descriptor, and its actions and
triggers — the catalogue schema served at **`GET /v1/automations/connectors`**.

Normative rules for the connector surface:

- The catalogue is `Catalog{ connectorCount, connectors[] }` of
  `ConnectorMetadata`. The pre-rename schema (`pieceCount`, `pieces`,
  `PieceMetadata`, `PieceAuth`, `PieceAction`, `PieceTrigger`) is **retired**.
- **`GET /v1/automations/pieces` is kept as a byte-identical back-compat alias**
  of `/connectors` so live clients do not break. It is `deprecated`; new clients
  MUST use `/connectors`.
- A Connector's registry name **equals** its `clients/integrations` provider id
  wherever it needs credentials — one identity for the connector and its
  credential.

### 3. Kind: Provider

A Provider is an AI model / compute provider. Its interface, config, and routing
are defined by **HIP-0004** (unified provider interface), its in-process runtime
by **HIP-0113**, and bring-your-own providers by **HIP-0124**. This HIP does not
redefine providers; it places them as the second kind in the one registry so a
Provider is connected, authorized, and revoked through the same surface as a
Connector.

### 4. Kind: Tool

A Tool is an MCP / agent tool. Its manifest, discovery, and invocation contract
are defined by **HIP-0010**. Hanzo Cloud already exposes an org's flows as MCP
tools at `POST /v1/automations/mcp`. This HIP places Tools as the third kind in
the one registry; it does not redefine MCP.

### 5. Flows consume Connectors

**Flows** are the IFTTT-style automation builder (trigger → action) on the
`@xyflow` graph canvas, specified by **HIP-0034** and executed by the durable
engine in `clients/automations` (running on the ONE shared in-process
`hanzoai/tasks` engine). A Flow's nodes are **Connectors**: a trigger node starts
the flow, action nodes invoke connector actions. Flows are the primary consumer of
the Connector kind.

The persisted flow-graph wire schema (the node discriminants `PIECE` /
`PIECE_TRIGGER` and the step fields `pieceName` / `pieceVersion`) is the
contract authored by the reused builder canvas and stored in flow-version JSON.
Because renaming it would break live builder clients and every stored flow, it is
**retained as-is** at this stage; aligning the flow-step schema to the connector
vocabulary is a **staged** migration coordinated with the builder (see Backwards
Compatibility).

### 6. The Extension Runtime — HOW custom logic runs

When an Integration needs *custom logic* — a connector transform, a validator, a
provider adapter, a per-record hook — that logic runs in the **In-Process
Extension Runtime (HIP-0105)**. There is ONE execution model:

- **One `Runtime` interface**, four backing engines:

  | Engine | Language | Sandbox | Use |
  |---|---|---|---|
  | `native` | Go | none | **default** — Hanzo-authored, zero abstraction cost |
  | `goja` | JS/TS | soft | multi-tenant SaaS default for user JS (~9 KB/module) |
  | `wazero` | WASM | **hard** | user code needing a hard sandbox; the Rust/TinyGo/AssemblyScript/**Python** path |
  | `v8go` | V8 | hard (cgo) | JS needing hard isolation; not recommended at high concurrency |

- **One manifest.** Every extension carries a sibling `extension.json`
  (`name`, `version`, `runtime` ∈ {native, goja, wazero, v8go}, `module`,
  `exports`). JSON is the wire format across all engines.
- **One contract, two mount points** (HIP-0105 / HIP-0106): in-process hooks and
  `hanzoai/zip` web routes mount the same runtime the same way.
- **Multi-tenant gate.** Operators MUST restrict `AllowedRuntimes` to
  hard-sandbox engines (wazero) for untrusted tenant code; soft-sandbox engines
  (goja, v8go-experimental) are for the "ordinary customers, not adversaries"
  threat model only.

### 7. Plugin — a code extension in the runtime

A **Plugin** is a code Extension that adds platform capability (a subsystem / VM),
specified by **HIP-0116**. A Plugin *runs in* the Extension Runtime; "plugin" is
therefore a specialization of "extension," never a synonym for "integration" or
"connector." The reference impl lives at
`~/work/hanzo/base/plugins/{extruntime,gojavm,wasmvm,v8vm}` (base#3).

### 8. Normative rules (the "one way")

1. **"Pieces" is banned.** The external-service kind is a **Connector**
   everywhere: identifiers, routes, JSON fields, comments, docs, UI. The only
   surviving `/pieces` token is the explicit deprecated back-compat alias.
2. **One registry, not per-product scatter.** An org/project has exactly one
   Integrations registry spanning all three kinds. New integration kinds are new
   entries in it, never new parallel registries.
3. **One config/auth surface.** Connect / authorize / store (KMS-sealed) / revoke
   is one lifecycle for every kind; `kind` is display metadata only.
4. **Two axes stay separate.** *Integration* (what is plugged in) and *Extension
   Runtime* (how custom logic runs) are orthogonal. Never name one with the
   other's word.
5. **Four engines, one interface.** The Extension Runtime is the ONE execution
   model; no service invents a fifth in-process code host.
6. **Reference, don't duplicate.** Provider (HIP-0004), Tool (HIP-0010), Flows
   (HIP-0034), Runtime (HIP-0105), Plugin (HIP-0116) remain the authoritative
   specs; this HIP aligns them into the taxonomy and does not restate their
   internals.

## Relationship to existing HIPs

Reference-don't-duplicate. This HIP is the umbrella; each row below stays the
authority for its slice.

| HIP | Owns | This HIP's relationship |
|---|---|---|
| HIP-0004 | Unified AI provider interface | Places **Provider** as a registry kind; does not redefine |
| HIP-0010 | MCP integration standards | Places **Tool** as a registry kind; does not redefine |
| HIP-0034 | Automation platform | Owns **Flows**; this HIP names Connectors as Flow nodes |
| HIP-0052 | Nexus integration hub | **Disambiguation:** Nexus is the INTERNAL *service* mesh/registry (K8s Services, routing, circuit-breaking). It is NOT the external Integrations registry. Orthogonal — different axis, no overlap |
| HIP-0105 | In-process extension runtime | Owns the **4-engine Runtime**; this HIP names it the ONE execution model for integration/plugin logic |
| HIP-0113 | Provider runtime | Provider-kind execution; referenced by the Provider kind |
| HIP-0116 | Plugin & VM model | Owns **Plugin**; this HIP positions Plugin as an Extension in the runtime |
| HIP-0124 | BYO provider & AI | BYO Providers; a registry Provider-kind onboarding path |

**Note on HIP-0052.** Its title ("Integration Hub") reads adjacent, but its
content is a Go service-mesh control/data plane for the 33+ internal services. Its
"Service Registry" registers *Hanzo services*; the Integrations registry here
registers *external capabilities* (connectors/providers/tools) for a tenant. The
two never collide; this HIP does not modify HIP-0052.

## Status: shipped vs staged

| Piece of the taxonomy | Status | Evidence |
|---|---|---|
| Connector framework (native-Go, self-registering) | **Shipped** | `clients/automations/connector.go`, `connector_core.go` |
| Connector catalogue renamed pieces→connectors + `/pieces` alias | **Shipped** | `GET /v1/automations/connectors` (this HIP's companion cloud PR) |
| Per-org connector credentials, KMS-sealed | **Shipped** | `clients/integrations` (`integrations.TokenFor`) |
| Flows (durable trigger→action, `@xyflow`) | **Shipped** | `clients/automations` engine on `hanzoai/tasks` (HIP-0034) |
| Providers (unified interface, gateway, BYO) | **Shipped** | HIP-0004 gateway, HIP-0113, HIP-0124 |
| Tools (MCP) | **Shipped** | HIP-0010; `POST /v1/automations/mcp` |
| Extension Runtime (4 engines, manifest) | **Shipped** | base#3 `plugins/{extruntime,gojavm,wasmvm,v8vm}`; cloud `clients/gojahost`, `clients/plugin`, `clients/framework/hook.go` (HIP-0105) |
| Plugin / VM model | **Shipped (spec)** | HIP-0116 |
| **Unified cross-kind registry surface** (one API listing Connector+Provider+Tool under one config/auth surface) | **Staged** | today: connectors in automations, providers at gateway, tools in MCP — same lifecycle, not yet one endpoint |
| Flow-step schema aligned to connector vocabulary (`PIECE`→…, `pieceName`→…) | **Staged** | retained for builder + stored-flow back-compat; needs builder-coordinated migration |

## Reference implementation

- **Connectors:** `github.com/hanzoai/cloud` `clients/automations`
  (`connector.go`, `connector_core.go`, catalogue at `/v1/automations/connectors`).
- **Integration credentials:** `clients/integrations` (KMS-sealed, per-org).
- **Extension Runtime:** `github.com/hanzoai/base` `plugins/{extruntime,gojavm,wasmvm,v8vm}`;
  cloud seams `clients/gojahost`, `clients/plugin` (the `CLOUD_PLUGINS` manifest),
  `clients/framework/hook.go`.

## Security considerations

- **Tenant isolation is physical.** Every registry entry and every stored
  credential is keyed by the validated org (`principal.Tenant` from the JWT
  `owner` claim); a caller can never read or author another tenant's integrations
  (HIP-0118).
- **Credentials are KMS-sealed, never plaintext.** All three kinds store secrets
  through KMS via `clients/integrations`; code reaches tokens only through the
  custody API.
- **Sandbox gate.** Untrusted tenant Extension code MUST run in a hard-sandbox
  engine (wazero); soft-sandbox engines (goja, v8go-experimental) are limited to
  the non-adversarial threat model. The `AllowedRuntimes` gate is enforced at the
  host boundary (HIP-0105).
- **One auth surface, one audit trail.** Because connect/authorize/revoke is one
  lifecycle, every kind's privileged action is audited uniformly (AU-2/AU-12).

## Backwards compatibility

- **`/pieces` alias.** `GET /v1/automations/pieces` returns the identical body as
  `/connectors` and is retained indefinitely as a `deprecated` alias. No live
  client breaks.
- **Flow-step wire protocol retained.** The persisted flow-graph schema
  (`PIECE` / `PIECE_TRIGGER`, `pieceName` / `pieceVersion`) is unchanged, so
  stored flows and the existing builder keep working. Aligning it to the connector
  vocabulary is a staged, builder-coordinated migration; it is out of scope here.
- **No parallel registries removed yet.** Providers (gateway) and Tools (MCP)
  keep their current endpoints; the unified cross-kind registry surface is
  additive when it lands.

## References

- HIP-0004 — LLM Gateway: Unified AI Provider Interface
- HIP-0010 — Model Context Protocol (MCP) Integration Standards
- HIP-0026 — Identity & Access Management Standard
- HIP-0034 — Automation Platform Standard
- HIP-0052 — Nexus Integration Hub Standard (internal service mesh — disambiguation)
- HIP-0105 — In-Process Extension Runtime Standard
- HIP-0106 — Unified Hanzo Cloud Binary
- HIP-0111 — Hanzo IAM Authentication Standard
- HIP-0113 — Cognitive Sidecar & Hanzo Engine Provider Runtime
- HIP-0116 — Hanzo Plugin & VM Model
- HIP-0118 — SuperAdmin & Tenant Isolation Model
- HIP-0124 — Bring-Your-Own Provider & AI

## Copyright

This document is placed in the public domain.
