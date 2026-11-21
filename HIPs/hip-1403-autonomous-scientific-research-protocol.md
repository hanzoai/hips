---
hip: 1403
title: Autonomous Scientific Research Protocol
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-11-19
requires: HIP-0000, HIP-1103, HIP-1145, HIP-1172, HIP-1334, HIP-1400, HIP-1401, HIP-1402
---

# HIP-1403: Autonomous Scientific Research Protocol

## Abstract

This HIP specifies the **Autonomous Scientific Research Protocol** for Hanzo OS. It defines how autonomous research agents formulate falsifiable hypotheses, pre-register experimental protocols against frozen evaluation gates, execute experiments inside isolated Visor sandboxes (HIP-1172), submit claims for independent replication, and govern recursive meta-optimization of the research process itself using Research Yield ($Y_R$) and Successor Research Lift ($L_R$).

## Motivation

Autonomous research agents can generate hypotheses and run experiments orders of magnitude faster than manual workflows, but speed without scientific rigor amplifies false discoveries, p-hacking, data leakage, and irreproducible results. Extending the unified research objects of HIP-1334 (`Dataset`, `Artifact`, `Run`, `Evaluation`, `Claim`, `Gate`, `Comparison`) with strict pre-registration, sandboxed execution, independent replication, and retraction workflows ensures that autonomous discovery produces durable, verifiable knowledge.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as in RFC 2119.

### 1. Falsifiable Hypothesis & Pre-Registration

Before executing a confirmatory experiment, a research agent MUST register an immutable `HypothesisRecord` in the Evidence ledger (HIP-1103) and Research runtime (HIP-1334):

```json
{
  "hypothesis_id": "sha256:...",
  "statement": "Structured falsifiable claim",
  "null_hypothesis": "Explicit falsification condition",
  "gate_ref": "gate://...",
  "dataset_refs": ["dataset://..."],
  "budget": {
    "max_compute_seconds": 3600,
    "max_cost_usd": 25.00
  },
  "proposer": "did:hanzo:org:research-agent",
  "registered_at": "2026-11-19T00:00:00Z"
}
```

1. **Falsifiability**: Every `HypothesisRecord` MUST specify an explicit `null_hypothesis` and quantitative pass/fail criteria bound to a prospectively frozen `gate_ref` (HIP-1334).
2. **Pre-Registration Ordering**: The `registered_at` timestamp and Evidence ledger sequence number of `HypothesisRecord` MUST precede the start of any confirmatory `Run` referencing it. Post-hoc selection of passing metrics from exploratory runs MUST be labeled `exploratory` and MUST NOT be promoted as confirmatory claims.

### 2. Sandboxed Experimental Execution

All autonomous research experiments MUST execute under Harness supervision (`hanzoai/kata`) inside isolated Sandbox environments (`hanzoai/visor`, HIP-1172):

- **Determinism & Environment Capture**: Container image digest, dependency lockfile digest, random seeds, hardware profile, and input dataset digests MUST be captured in the `Run` record (HIP-1145, HIP-1334).
- **Network & Data Isolation**: Confirmatory runs MUST NOT have access to private holdout labels, external uncontrolled web endpoints, or production credentials.
- **Resource Budgeting**: The Harness MUST terminate any run that exceeds its declared `budget` and record the termination reason in Evidence.

### 3. Independent Replication & Claim Promotion

A `Claim` produced by an autonomous research run MUST remain in `unreplicated` state until independent replication succeeds:

1. **Clean-Room Replay**: An independent replication agent or verifier MUST re-execute the experiment from the recorded `Artifact` and `Dataset` digests in a fresh Visor sandbox without sharing mutable state with the proposing agent.
2. **Statistical Agreement**: Replicated metrics MUST satisfy the pre-registered `gate_ref` thresholds and remain within the declared confidence interval of the original run.
3. **Qualification & XP**: Only after independent replication succeeds MAY the claim be promoted to `replicated` status and become eligible for `science` domain XP projection under HIP-1402.

### 4. Retraction & Correction Protocol

1. Any principal or verifier MAY submit a `CounterEvidence` record demonstrating a failed replication, data contamination, or methodological defect in a previously promoted claim.
2. Upon verification of `CounterEvidence` against the frozen gate, the claim status MUST transition to `retracted`, referencing the `CounterEvidence` digest.
3. Retraction MUST trigger deterministic reversal of all downstream XP projections (HIP-1402) and flag any `EvolutionCandidate` (HIP-1401) that depended on the retracted claim.

### 5. Recursive Meta-Optimization of Research

When an evolutionary loop modifies `research.protocol` (hypothesis generation, experimental design, or search scheduling under HIP-1401), the modified research agent MUST be evaluated using Level 2 Evolutionary Fitness (HIP-0000):

- **Research Yield ($Y_R$)**: $\Delta H_{\text{verified}} / C_{\text{total\_research}}$, where $\Delta H_{\text{verified}}$ counts only independently replicated gains and $C_{\text{total\_research}}$ includes all failed, exploratory, and replication runs.
- **Successor Research Lift ($L_R$)**: $Y_R(\text{successor}) / Y_R(\text{predecessor})$.
- Promotion of a successor research protocol to Stage E5 (HIP-0000 Appendix B) MUST require sustained $L_R > 1.0$ across independent, prospectively frozen evaluation suites with zero degradation in replication rate.

## Rationale

Separating exploratory runs from pre-registered confirmatory runs prevents silent hypothesis shopping while still allowing agents to explore freely. Requiring full-cost accounting in $C_{\text{total\_research}}$ (including failed experiments and replication overhead) prevents meta-optimizers from inflating apparent yield by hiding search costs.

## Security Considerations

- **Holdout Contamination**: Research agents MUST be strictly isolated from private holdout suites and replication verifiers so they cannot overfit or leak answers into proposed artifacts.
- **Resource Exhaustion**: Unbounded autonomous research loops can consume unbounded compute. Every hypothesis registration MUST carry a hard Harness-enforced budget cap (`max_compute_seconds`, `max_cost_usd`).
- **Dual-Use & Safety Screening**: Research domains involving sensitive code execution, biological, chemical, or security-critical artifacts MUST pass mandatory policy checks in the Harness before Sandbox launch.

## References

- HIP-0000 — Hanzo AI Architecture & Framework
- HIP-1103 — Audit Tamper-Evident Trail
- HIP-1145 — Research Experiment Record
- HIP-1172 — Visor: Compute You Rent
- HIP-1334 — Research: The Unified Research Runtime
- HIP-1400 — Hanzo OS Conformance & Specification Manifest
- HIP-1401 — Evolutionary Candidate & Population Protocol
- HIP-1402 — Hanzo XP — Verified Contribution Protocol

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
