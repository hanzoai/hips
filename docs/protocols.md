# Hanzo Protocol Boundaries

ZAP, MCP, A2A, ACP — four protocols, four boundaries. None absorbs the others.

## The decision rule

- **ZAP** is how Hanzo talks to Hanzo (internal RPC + schema + codegen).
- **MCP** is how models/clients call Hanzo tools (Model Context Protocol).
- **A2A** is how agents collaborate with Hanzo agents (Agent2Agent federation).
- **ACP** is compatibility for agent client/connect networks (NOT canonical core — adapter only).

## Protocol matrix

| Protocol | Canonical? | Scope | Used by Hanzo for |
|---|---|---|---|
| MCP | Yes (external) | model/client → tools/resources | Tool exposure, IDE/assistant integration, Flow/Auto/ML tool publication |
| A2A | Yes (external) | agent → agent | Cross-vendor agent federation, task delegation, long-running handoff |
| ACP | Adapter only | varies — see below | Optional IDE/coding-agent client compatibility |
| ZAP | Yes (internal) | service → service | Hanzo internal RPC, generated Go/TS/Py/Rust clients, in-process or over-wire |

## Stack diagram

```
External agent/client ecosystem:
  MCP / A2A / ACP adapters
       │
Hanzo product/control plane:
  cloud / ai / mcp / ml / flow / auto / o11y / insights
       │
Hanzo internal service protocol:
  ZAP
```

## MCP — Model Context Protocol

Use for:

- Tool exposure to external models and IDE clients (Claude Code, Cursor, Zed, JetBrains, ChatGPT desktop, etc.).
- Resource exposure (files, search indices, KB documents) read by external models.
- Publication of Flow workflows, Auto jobs, and ML primitives as named tools callable by any MCP client.
- Prompt and template publication to model clients.

Do NOT use for:

- Internal service RPC between Hanzo subsystems — that is ZAP.
- ML job orchestration on the cluster — that is the operator + ZAP control plane.
- Agent-to-agent negotiation, delegation, or long-running task handoff — that is A2A.
- Persistent product object model (Tool, Agent, Job, Trace records) — that lives in the ZAP schemas and is exposed through MCP as views, not as the system of record.

MCP is request/response and stateless at the protocol layer. Hanzo MCP servers (Go path at `~/work/hanzo/mcp/go/`, Rust path at `~/work/hanzo/mcp/rust/`) translate MCP calls into ZAP-typed calls against the appropriate Hanzo subsystem.

## A2A — Agent2Agent

Use for:

- Cross-vendor agent collaboration where the counterparty is not a Hanzo agent.
- Capability discovery: agents publish their AgentCard, others discover and route.
- Task delegation with long-running, resumable execution.
- White-label federation: customer-deployed Hanzo agent fleets that interoperate with non-Hanzo agents.
- Marketplace agent routing where the broker is external.

Do NOT use for:

- Low-level tool calls — those are MCP.
- Hanzo internal RPC between subsystems — that is ZAP.
- Kubernetes-side ML job reconciliation — that is the operator's job, expressed as CRDs internally and as ZAP/HTTP externally.
- IDE tool integration — that is MCP, or optionally ACP as an Agent Client Protocol adapter.

**A2A sits ABOVE MCP.** A Hanzo A2A agent may internally use MCP tools, but the external contract is agent capability + task collaboration, not raw tool invocation. The MCP boundary handles "give me this tool"; the A2A boundary handles "delegate this goal."

## ACP — Three meanings, Hanzo picks one

ACP is ambiguous in the ecosystem:

- **Agent Connect Protocol** — registry/runs/threads/descriptor style federation aimed at agent marketplaces.
- **Agent Client Protocol** — IDE-to-agent integration popularized by editor and coding-agent vendors.
- **Agent Communication Protocol** — broader generic agent-to-agent communication framing.

**Hanzo treats ACP as adapter compatibility, not canonical core.** The canonical agent federation protocol for Hanzo is A2A; the canonical tool protocol is MCP. ACP exists in Hanzo only as an adapter surface.

Until customers explicitly demand Agent-Connect-style federation, the default ACP-in-Hanzo means **Agent Client Protocol** — for exposing Hanzo coding agents to IDE clients that speak that protocol. The other two senses ship as separate adapter targets only when a real customer asks.

## ZAP — internal

ZAP is Hanzo's typed wire protocol. Schema-first. `.zap` files compile via `zapc` to Go/TS/Py/Rust clients.

Use for:

- Typed service contracts (cloud ↔ ai, cloud ↔ ml, cloud ↔ o11y, ml-controller ↔ ml-types, etc.).
- Generated clients in every supported language from one schema.
- Split deployments: the same subsystem can mount in-process (`func Mount(r, deps)`) or run remotely (ZAP RPC over the wire) without changing call sites.
- Durable internal API surface that outlives any one wire format.
- Schema-first product objects: TrainingJob, Experiment, Model, Trace, Tool, Agent, Run, Thread, etc. live in `.zap` schemas and are exposed externally through MCP/A2A/HTTP — never the reverse.

ZAP is NOT for external clients. External clients use MCP/A2A/ACP/HTTP. The boundary is enforced by the gateway: external traffic terminates at HTTP or one of the external protocols; internal traffic between Hanzo subsystems travels as ZAP.

## Where each Hanzo subsystem fits

| Subsystem | Internal | External |
|---|---|---|
| cloud | ZAP (Deps clients) | HTTP via gateway |
| ai (LLM control plane) | ZAP | HTTP |
| mcp | ZAP internal | **MCP external** |
| ml (Rust primitives) | n/a (library) | n/a |
| operator (k8s reconciler) | ZAP for cloud.Mount | K8s CRDs |
| flow | ZAP | HTTP + **MCP publication** |
| auto | ZAP | HTTP + **MCP publication** |
| o11y | ZAP internal | OTLP external |
| insights | ZAP internal | HTTP + UI |
| agents | ZAP internal | **A2A external** |
| brain | ZAP | n/a |

## Final decision rule

```
ZAP is how Hanzo talks to Hanzo.
MCP is how models/clients call Hanzo tools.
A2A is how agents collaborate with Hanzo agents.
ACP is compatibility for agent clients/connect networks.
ML is the Hanzo-native operator/control plane for ML workloads (hanzoai/operator).
```

## See also

- HIP-0105 In-Process Extension Runtime (substrate)
- HIP-0106 Unified Hanzo Cloud Binary (where subsystems mount)
- HIP-0108 On-Demand Subsystem Supervisor (warm pool / idle eviction)
- HIP-0109 Hanzo ML Cloud Toolkit (operator absorption of Kubeflow estate)
