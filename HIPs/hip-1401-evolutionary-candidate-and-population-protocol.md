---
hip: 1401
title: Evolutionary Candidate & Population Protocol
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-11-19
requires: HIP-0000, HIP-1103, HIP-1145, HIP-1334, HIP-1400
---

# HIP-1401: Evolutionary Candidate & Population Protocol

## Abstract

This HIP specifies the **Evolutionary Candidate & Population Protocol** for Hanzo OS. It defines the immutable `EvolutionCandidate` artifact format, permitted mutation surfaces, multi-objective population search over a Pareto frontier, Level 1 Product Fitness and Level 2 Evolutionary Fitness scoring, and independent qualification and rollback gates. The protocol governs how Harness (`hanzoai/kata`), Agent Engine (`hanzoai/gen`), Model Router (`hanzoai/enso`), and research workflows (`hanzoai/research`) safely propose, evaluate, and promote improvements.

## Motivation

Iterative improvement of AI systems often collapses into ad-hoc prompt tweaking, unrecorded hyperparameter sweeps, or single-metric hill climbing that regresses cost, latency, or safety. Without a formal candidate lineage and population protocol:

- Improvements cannot be traced to the exact parent configuration, diff, and evaluation gate that justified them.
- Greedy selection on a single score destroys diversity and traps the system in local optima.
- Self-modifying loops risk tampering with their own evaluation harnesses or security boundaries.

HIP-1401 builds directly on the Evidence and Research primitives of HIP-1103, HIP-1145, and HIP-1334 to make evolutionary search auditable, multi-objective, and strictly bounded.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as in RFC 2119.

### 1. EvolutionCandidate Schema

Every proposed mutation in an evolutionary run MUST be represented as an immutable, content-addressed `EvolutionCandidate` record:

```json
{
  "candidate_id": "sha256:...",
  "parent_ids": ["sha256:..."],
  "spec_version": "1.0.0",
  "mutation_surface": "harness.policy",
  "artifact_digest": "sha256:...",
  "diff_ref": "artifact://...",
  "proposer": "did:hanzo:org:agent-or-principal",
  "created_at": "2026-11-19T00:00:00Z",
  "gate_ref": "gate://...",
  "evidence_refs": ["audit://..."],
  "signature": "ml-dsa-65:..."
}
```

- `candidate_id` MUST be the cryptographic hash (SHA-256) of the canonical JSON representation excluding `signature` and `attestations`.
- `parent_ids` MUST list one or more immutable parent `candidate_id` values (or `["root"]` for a baseline seed), forming a directed acyclic lineage graph.
- `mutation_surface` MUST name a declared, permitted surface (see §2).
- `artifact_digest` MUST match the exact content digest of the deployable artifact (code patch, harness configuration, prompt bundle, routing weights, or model checkpoint).
- `gate_ref` MUST reference a prospectively frozen evaluation gate (HIP-1334) created prior to candidate evaluation.
- `signature` MUST be a valid cryptographic signature from the proposing principal or service identity.

### 2. Mutation Surfaces & Immutability Boundaries

Evolutionary proposers MAY mutate only explicitly authorized surfaces:

- `harness.policy` — scheduling, retry, context-budget, and tool-supervision policies in `hanzoai/kata`.
- `engine.strategy` — reasoning templates, planning heuristics, and recovery loops in `hanzoai/gen`.
- `router.cascade` — model selection rules and fallback thresholds in `hanzoai/enso`.
- `model.adapter` — fine-tuned weights, LoRA adapters, or system prompts.
- `research.protocol` — hypothesis-generation and experiment-selection heuristics (subject to HIP-1403).

Evolutionary proposers MUST NOT mutate:

1. Sandbox isolation boundaries and resource enforcement (`hanzoai/visor`).
2. Frozen evaluation gates, private holdout datasets, or grading verifiers (HIP-1334).
3. Evidence ledger write paths, cryptographic signing keys, or promotion authority (`hanzoai/audit`).
4. Conformance rules in `standard.json` (HIP-1400) without human governance review.

### 3. Fitness Evaluation

Every candidate MUST be evaluated against two levels of fitness as defined in HIP-0000:

#### 3.1 Level 1: Product Fitness

Evaluated inside an isolated Sandbox (`hanzoai/visor`) on a prospectively frozen gate:

- **Verified Success**: Fraction of holdout tasks passing independent verification.
- **Cost Efficiency**: Total compute and token cost per verified success.
- **Latency**: Median (p50) and tail (p95) wall-clock time to verified completion.
- **Robustness**: Non-regression rate on private holdout and safety/adversarial suites.

#### 3.2 Level 2: Evolutionary Fitness

For candidates that modify the research or evolution process itself:

- **Research Yield ($Y_R$)**: $\Delta H_{\text{verified}} / C_{\text{total\_research}}$, measuring verified capability gain per unit of total research cost.
- **Successor Research Lift ($L_R$)**: $Y_R(\text{successor}) / Y_R(\text{predecessor})$.
- **Discovery Rate**: Independently qualified improvements per 100 experiments.
- **Transfer Rate**: Fraction of improvements that generalize to unseen benchmark domains.
- **Reproducibility**: Fraction of improvements confirmed under independent clean-room replay.

### 4. Population Search & Selection

1. The population archive MUST retain a diverse set of non-dominated candidates across the multi-objective Pareto frontier: `(Verified Success, Cost Efficiency, Latency, Robustness, Safety)`.
2. Selection MUST NOT discard a candidate solely because it trails on a single scalar objective if it dominates on another objective or occupies an under-explored behavioral niche.
3. Every archive state transition (insertion, dominance pruning, promotion, retirement) MUST be recorded in the Evidence ledger (HIP-1103).

### 5. Independent Qualification & Promotion Gates

Before any `EvolutionCandidate` is promoted to production:

1. **Conformance**: It MUST pass all normative conformance tests for its layer (HIP-1400).
2. **Holdout Verification**: An independent qualification runner MUST evaluate the candidate on private holdout tasks not accessible to the proposing agent.
3. **Integrity & Safety**: Zero regressions on mandatory security, sandbox containment, and safety checks.
4. **Validated Rollback**: A tested rollback artifact pointing to the previous qualified production candidate MUST be staged and verified prior to cutover.

### 6. Optional External Verifiable Attestations

An `EvolutionCandidate` record MAY include an optional `attestations` array containing external, independently verifiable cryptographic attestations (such as transparency-log inclusion proofs or third-party audit receipts). This extension point is reserved for future specification (planned **HIP-1404**) and MUST remain strictly optional: full conformance with HIP-1401 MUST NOT require a blockchain or external ledger.

## Rationale

Separating mutation surfaces from immutable qualification and sandbox boundaries prevents reward hacking and self-certification. Maintaining a Pareto-optimal population rather than a single champion preserves low-cost and low-latency operating points alongside peak-accuracy configurations. Making external attestations an optional extension keeps the core evolutionary protocol lightweight, deterministic, and deployable in any air-gapped or local environment.

## Security Considerations

- **Evaluation Gaming**: If a proposing agent can read or influence the private holdout suite or grading script, Level 1 and Level 2 fitness scores become invalid. Qualification runners MUST execute with separate credentials and read-only access to holdout datasets inside isolated Visor sandboxes.
- **Supply-Chain Integrity**: All candidate artifacts MUST be verified by content digest (`artifact_digest`) before execution to prevent time-of-check-to-time-of-use tampering between qualification and deployment.
- **Runaway Compute**: Harness policies MUST enforce strict per-generation and per-experiment compute budgets so evolutionary loops cannot exhaust cluster resources.

## References

- HIP-0000 — Hanzo AI Architecture & Framework
- HIP-1103 — Audit Tamper-Evident Trail
- HIP-1145 — Research Experiment Record
- HIP-1334 — Research: The Unified Research Runtime
- HIP-1400 — Hanzo OS Conformance & Specification Manifest
- HIP-1402 — Hanzo XP — Verified Contribution Protocol
- HIP-1403 — Autonomous Scientific Research Protocol

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
