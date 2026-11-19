---
hip: 1400
title: Hanzo OS Conformance & Specification Manifest
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-11-19
requires: HIP-0000, HIP-0119, HIP-0135, HIP-0139
---

# HIP-1400: Hanzo OS Conformance & Specification Manifest

## Abstract

This HIP defines the **Hanzo OS Conformance Protocol** and the machine-readable specification manifest (`standard.json`) hosted in `hanzoai/hips`. It establishes how the Hanzo OS specification layer declares its normative HIP set, how each runtime component (Harness, Agent Engine, Sandbox, Model Router, Evidence) advertises its implemented interfaces and versions, and how automated conformance suites gate promotion across layers.

## Motivation

Hanzo OS spans multiple decoupled repositories—Harness (`hanzoai/kata`), Agent Engine (`hanzoai/gen`), Coding Agent (`hanzoai/dev`), Sandbox (`hanzoai/visor`), Model Router (`hanzoai/enso`), and Evidence/Research (`hanzoai/audit`, `hanzoai/research`). Without a machine-readable specification manifest and enforceable conformance contract:

- Components drift silently on schema versions, wire formats, and capability semantics.
- Automated evolutionary pipelines (HIP-1401) cannot verify whether a mutated candidate still satisfies cross-layer invariants before running expensive evaluations.
- Operators lack a single deterministic artifact that maps a Hanzo OS release version to the exact set of normative HIPs and conformance suites governing it.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as in RFC 2119.

### 1. Root Specification Manifest (`standard.json`)

The `hanzoai/hips` repository MUST maintain a machine-readable manifest at its repository root named `standard.json`.

#### 1.1 Required Fields

`standard.json` MUST be a valid UTF-8 JSON object containing the following top-level fields:

```json
{
  "schema_version": "1.0.0",
  "name": "Hanzo OS Specification",
  "version": "1.0.0",
  "hips": ["0000", "1400", "1401", "1402", "1403"],
  "layers": {
    "specification": {
      "repository": "hanzoai/hips",
      "hips": ["0000", "1400"]
    },
    "harness": {
      "repository": "hanzoai/kata",
      "hips": ["1400", "1401"]
    },
    "engine": {
      "repository": "hanzoai/gen",
      "hips": ["1330", "1400"]
    },
    "sandbox": {
      "repository": "hanzoai/visor",
      "hips": ["0053", "0123", "1172"]
    },
    "evidence": {
      "repository": "hanzoai/audit",
      "hips": ["1103", "1334", "1402"]
    },
    "research": {
      "repository": "hanzoai/research",
      "hips": ["1145", "1334", "1401", "1403"]
    }
  }
}
```

- `schema_version` (string): SemVer version of the manifest schema itself.
- `name` (string): Canonical specification name (`"Hanzo OS Specification"`).
- `version` (string): SemVer version of the Hanzo OS specification release.
- `hips` (array of strings): Zero-padded 4-digit HIP identifiers belonging to this specification release. Every entry MUST resolve to an existing file in `HIPs/`.
- `layers` (object): Map of canonical Hanzo OS architectural layers to their public repository (`hanzoai/*` per HIP-0135) and governing HIP identifiers.

### 2. Component Conformance Manifest

Every Hanzo OS runtime component conforming to this specification MUST expose a component manifest (`hanzo-standard.json` at its repository root and/or served at `/.well-known/hanzo-standard.json` for networked services) containing:

- `spec_version`: The target `standard.json` SemVer version.
- `component`: Canonical layer and component name (e.g., `harness/kata`, `engine/gen`, `sandbox/visor`).
- `version`: Component SemVer release version.
- `implemented_hips`: Array of `{ "hip": "NNNN", "version": "X.Y.Z", "status": "conformant" | "partial" }` entries.
- `capabilities`: Optional list of capability identifiers registered under HIP-0139.

### 3. Semantic Versioning & Compatibility

All Hanzo OS interfaces and manifests MUST follow Semantic Versioning 2.0.0:

- **MAJOR** increments indicate breaking changes to wire formats, required fields, or normative invariants.
- **MINOR** increments indicate backward-compatible additions (new optional fields, new endpoints, new conformance checks).
- **PATCH** increments indicate clarifications or bug fixes that do not alter normative behavior.

A component claiming conformance to specification version `MAJOR.MINOR.PATCH` MUST pass all normative conformance tests defined for `MAJOR.MINOR.*`.

### 4. Conformance Verification & Promotion Gates

1. Conformance suites MUST be deterministic, reproducible, and executable inside an isolated Sandbox (`hanzoai/visor`) without external network access.
2. Any candidate artifact (human-authored or produced by an evolutionary loop under HIP-1401) MUST pass its layer's normative conformance suite before entering qualification or production promotion.
3. Conformance results MUST be emitted as structured Evidence records (HIP-1103) referencing the exact commit digest of `standard.json`, the component artifact digest, and the test suite digest.

## Rationale

Centralizing the specification manifest as `standard.json` in `hanzoai/hips` preserves the single-source-of-truth invariant established across the HIP corpus (`vocabulary.json`, `HIPs/*.md`) while giving automated Harness, Engine, and Evolution tooling a stable, parseable contract. Separating the root specification manifest from per-component conformance manifests avoids coupling the specification repository to individual component release cadences.

## Security Considerations

- **Manifest Integrity**: Tooling consuming `standard.json` or component manifests SHOULD verify cryptographic commit signatures or content digests so an attacker cannot silently downgrade conformance requirements or disable mandatory checks.
- **Public Boundary**: All schemas and conformance suites referenced by `standard.json` MUST be public (HIP-0135). Private holdout evaluation datasets used for Level 1/Level 2 fitness scoring (HIP-1401) are kept separate from public interface conformance suites to prevent overfitting or benchmark contamination.

## References

- HIP-0000 — Hanzo AI Architecture & Framework
- HIP-0119 — Hanzo Service Conventions
- HIP-0135 — What Is Public
- HIP-0139 — Capability
- HIP-1103 — Audit Tamper-Evident Trail
- HIP-1401 — Evolutionary Candidate & Population Protocol

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
