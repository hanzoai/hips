---
hip: 1402
title: Hanzo XP — Verified Contribution Protocol
author: Hanzo AI Team
type: Standards Track
category: Governance
status: Draft
created: 2026-11-19
requires: HIP-0000, HIP-0097, HIP-1103, HIP-1334, HIP-1400, HIP-1401
---

# HIP-1402: Hanzo XP — Verified Contribution Protocol

## Abstract

This HIP specifies **Hanzo XP**, a deterministic, evidence-backed contribution and mastery projection protocol for humans and autonomous agents operating within Hanzo OS. XP is computed exclusively from immutable Evidence records (HIP-1103 audit trail and HIP-1334 research evaluations). XP is **strictly non-transferable** and **strictly subordinate to Evidence**: it cannot be bought, sold, traded, or staked, and any XP derived from a retracted or non-reproducible claim is deterministically revoked.

## Motivation

Measuring engineering and research impact with raw activity counters—pull request counts, commit volume, or tokens consumed—incentivizes noise over verified progress. Conversely, attaching transferable financial value directly to reputation metrics invites sybil attacks, wash trading, and gaming.

Hanzo OS requires a clean, auditable signal of demonstrated capability across domains (Harness, Engine, Model, Sandbox, Science) that:

- Rewards only independently verified improvements, bug fixes, and replicated discoveries.
- Remains permanently anchored to immutable Evidence so any observer can recompute the exact score from scratch.
- Automatically retracts credit when underlying claims fail replication or are invalidated.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as in RFC 2119.

### 1. Core Invariants

1. **Subordinate to Evidence**: XP MUST be a pure, deterministic projection over immutable Evidence records (HIP-1103) and qualified Evaluations/Claims (HIP-1334, HIP-1401). XP MUST NEVER be mutated manually or treated as a primary source of truth; recomputing the projection from the Evidence log MUST always yield identical results.
2. **Strictly Non-Transferable**: XP MUST be bound to a single principal identity (`did:hanzo:...`, HIP-0097). XP MUST NOT be transferable, delegatable, tradable, burnable for payment, or convertible into currency or tokens.
3. **Outcome-Based, Not Activity-Based**: XP MUST ONLY be projected from verified outcomes (qualified candidate improvements, resolved conformance failures, independently replicated research claims, or accepted specification contributions). Raw activity metrics (token consumption, run counts, commit counts, PR counts) MUST NOT generate XP.
4. **Reversible on Retraction**: If an Evidence record is superseded by a retraction, invalidation, or failed replication event, all XP projected from that record MUST be deterministically reversed in the next projection pass.

### 2. Skill Domains

XP is partitioned into explicit specialization domains so mastery in one layer does not conflate with another:

| Domain | Scope of Verified Evidence |
| :--- | :--- |
| `harness` | Qualified improvements to `hanzoai/kata` policies, supervision, or resource efficiency |
| `engine` | Qualified improvements to `hanzoai/gen`, `hanzoai/dev`, or tool/context orchestration |
| `model` | Qualified improvements to training, inference, routing (`hanzoai/enso`), or kernels (`hanzoai/ml`) |
| `sandbox` | Verified security hardening, isolation fixes, or performance gains in `hanzoai/visor` |
| `science` | Independently replicated discoveries and pre-registered research claims (HIP-1403) |
| `spec` | Normative specification improvements and conformance suite additions (`hanzoai/hips`) |

### 3. XP Projection Record Schema

Each projection event derived from an Evidence record MUST conform to:

```json
{
  "projection_id": "sha256:...",
  "principal": "did:hanzo:org:principal",
  "domain": "harness",
  "delta": 120,
  "reason": "candidate_qualified",
  "evidence_ref": "audit://...",
  "candidate_ref": "sha256:...",
  "rule_version": "1.0.0",
  "effective_at": "2026-11-19T00:00:00Z",
  "retracted_by": null
}
```

- `projection_id` MUST be deterministically derived from `(evidence_ref, principal, domain, rule_version)`.
- `delta` MUST be a signed integer: positive for verified contribution events, negative for retraction or reversal events.
- `rule_version` MUST identify the exact deterministic scoring function version applied.
- `retracted_by` MUST reference the superseding retraction Evidence record if the award has been revoked.

### 4. Qualification & Attribution Rules

1. **Multi-Contributor Attribution**: When a qualified `EvolutionCandidate` (HIP-1401) or research claim (HIP-1403) builds on parent lineage or multiple contributors, attribution weights MUST be declared in the Evidence record and MUST sum to 1.0 across participating principals.
2. **Replication Prerequisite**: For `science` domain claims, XP MUST NOT be projected until independent replication completes under HIP-1403.
3. **Auditability**: Any participant with read access to the Evidence ledger MUST be able to verify a principal's XP totals per domain by re-running the open projection rules (`rule_version`) over the Evidence log.

### 5. Optional External Verifiable Attestations

A principal's XP summary or individual projection record MAY carry an optional `attestations` field referencing external verifiable credentials or third-party cryptographic attestations. This extension point is reserved for future specification (planned **HIP-1404**) and MUST remain strictly optional: full conformance with HIP-1402 MUST NOT require a blockchain or external settlement layer.

## Rationale

Making XP a read-only projection over HIP-1103 Evidence ensures there is never a split-brain between what happened and what was credited. Enforcing strict non-transferability eliminates financial speculation and preserves XP as an honest engineering signal of verified mastery and agent reliability.

## Security Considerations

- **Sybil & Collusion Resistance**: Because XP is only awarded after independent holdout qualification (HIP-1401) or independent replication (HIP-1403), self-signed claims or colluding proposers cannot mint XP without passing frozen, independent gates.
- **Gaming via Micro-Deltas**: Projection rules (`rule_version`) SHOULD require a minimum statistically significant fitness gain above measurement noise before projecting positive XP, preventing score farming via trivial no-op mutations.
- **Privacy**: Principals MAY publish domain-level XP totals without disclosing proprietary artifacts, provided the underlying qualification Evidence digest is verifiable by authorized auditors.

## References

- HIP-0000 — Hanzo AI Architecture & Framework
- HIP-0097 — Clean Node Identity (`did:hanzo`)
- HIP-1103 — Audit Tamper-Evident Trail
- HIP-1334 — Research: The Unified Research Runtime
- HIP-1400 — Hanzo OS Conformance & Specification Manifest
- HIP-1401 — Evolutionary Candidate & Population Protocol
- HIP-1403 — Autonomous Scientific Research Protocol

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
