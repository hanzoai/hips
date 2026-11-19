---
hip: 1347
title: Event-Driven Agent Reliability
author: Zach Kelling, Hanzo AI Research
type: Standards Track
category: Application
status: Draft
implementation-go: partial
created: 2026-11-16
requires: HIP-0119, HIP-1210, HIP-1213, HIP-1330, HIP-1343
---

# HIP-1347: Event-Driven Agent Reliability

## Abstract

This specification defines the execution isolation, event-driven lifecycle, reactivation observability, idempotent durable recovery, and evaluation harnesses for Research Bounties #31 through #40 across `hanzoai/agents`, `hanzoai/mcp`, `hanzoai/cloud`, `hanzoai/ml`, and `hanzoai/visor`.

## Motivation

Event-driven autonomous agents must launch sandboxes, invoke MCP tools, recover from interrupts, defend against adversarial tool payloads, and turn trajectories into measurable improvements — without requiring permanently resident bot processes or leaking tenant credentials inside sandboxes. Benchmarking end-to-end reliability requires clean separation between sandbox reactivation latency and model inference TTFT alongside reproducible anti-leakage task suites.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as in RFC 2119.

### 1. Event-Driven Contract & Credential Separation

1. **Disjoint Credentials**: Workload/control-plane actors, per-run `ai:inference` keys (blocked from knowledge/KMS paths), per-run MCP run tickets, sandbox lease tokens (without admin-mint), and per-environment worker secrets MUST remain cryptographically separate and scoped per trust boundary.
2. **Non-Permanent Bot Execution**: Bots and durable sessions MUST wake on cron/webhook/channel/user events, park disks cleanly at idle, and MUST NOT mandate permanently running agent daemon processes.
3. **Reactivation vs TTFT Telemetry**: Traces MUST record session activation state (`cold`, `relocated`, `warm`) and `reactivation_ms` independently from `gen_ai.latency.ttft_ms`.
4. **Idempotent Durable Tools**: Retried or relocated durable activities and MCP tool calls MUST carry deterministic per-attempt `idempotency_key` identifiers preventing duplicate external side effects.

### 2. Evaluation, Security & Lifecycle Bounties (Bounties #31–#40)

1. **Long-Horizon Coding-Agent Evaluation (Bounty #31 — Wave 1 #2, `hanzoai/agents`)**: Run a reproducible subset of SWE-bench Pro V2 (September 2026 anti-leakage revision) on `hanzoai/visor`, comparing task resolution, wall time, model spend, and filesystem IO against plain NVMe.
2. **Prompt-Injection Resistance (Bounty #32, `hanzoai/agents` / `hanzoai/mcp`)**: Port AgentDojo-style tool-result and retrieved-content injection tests into `hanzoai/mcp` with explicit authorization policies and measured attack-success rates.
3. **Risky-Tool Simulation (Bounty #33, `hanzoai/agents` / `hanzoai/mcp`)**: Simulate destructive or privacy-sensitive MCP tool invocations prior to live execution, reporting unsafe-action detection and false-block rates.
4. **Unified Agent Execution Tracing (Bounty #34 — Wave 1 #5, `hanzoai/cloud`)**: Correlate model calls, retrieval, MCP tools, `vfs` IO, sandbox reactivation, and billing under a unified task ID per OpenTelemetry GenAI semantic conventions, measuring tracing overhead and attribute completeness.
5. **Durable Event-Driven Agent Workflow Replay (Bounty #35, `hanzoai/agents`)**: Validate persisted checkpoints, idempotent activities, and crash recovery inside Hanzo's event-triggered lifecycle using `hanzoai/tasks` semantics without introducing always-on worker daemons.
6. **Learning from Agent Execution Traces (Bounty #36, `hanzoai/agents` / `hanzoai/ml`)**: Convert succeeded and failed agent trajectories into RL/post-training datasets for eligible Zen checkpoints, reporting pass rate, reward-hacking checks, and training cost.
7. **Automatic Prompt & Workflow Optimization (Bounty #37, `hanzoai/agents`)**: Optimize selected programmatic workflows against executable held-out checks, reporting accuracy, token cost, and latency.
8. **Agent-Computer Interface Optimization (Bounty #38, `hanzoai/mcp`)**: Benchmark compact structured edit APIs and bounded shell outputs on tool-call count, patch validity, and completion rate.
9. **Dual-Control Business-Agent Benchmark (Bounty #39, `hanzoai/agents` / `hanzoai/cloud`)**: Verify human+agent concurrent state edits under randomized permissions and tool outcomes.
10. **Computer-Workflow Benchmark on Visor (Bounty #40, `hanzoai/visor` / `hanzoai/agents`)**: Evaluate reproducible OS/desktop task subsets inside supported sandboxes, measuring completion rate, cold-start time, CPU/RAM footprint, and teardown hygiene.

## Rationale

Establishing deterministic idempotency keys, reactivation-split telemetry, and credential boundaries inside the core platform lets every agent benchmark run against production invariants rather than idealized single-tenant mocks.

## Security Considerations

Hostile repository content or retrieved documents can attempt prompt injection, reference-solution leakage (`#31`), or sandbox credential harvesting. Disjoint credentials (§1.1), read-restricted `ai:inference` keys, and pre-execution risky-tool simulation (`#33`) confine blast radius to the sandboxed workspace.

## References

- HIP-0119 — Hanzo Service Conventions
- HIP-1210 — Agents — Define, Run, Keep
- HIP-1213 — Tools — The Tool Plane
- HIP-1330 — Dev — The Agent Loop
- HIP-1343 — Visor — The Sandbox Runtime
- `hanzoai/agents`, `hanzoai/mcp`, `hanzoai/cloud`, `hanzoai/visor`, `hanzoai/ml`

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
