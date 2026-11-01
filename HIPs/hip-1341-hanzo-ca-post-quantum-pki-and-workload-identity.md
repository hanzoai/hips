---
hip: 1341
title: Hanzo CA — Post-Quantum PKI and Zero-Trust Workload Identity
author: Hanzo AI Team
type: Standards Track
category: Security
status: Draft
created: 2026-11-01
requires: HIP-0005, HIP-0119, HIP-0122, HIP-0134
---

# HIP-1341: Hanzo CA — Post-Quantum PKI and Zero-Trust Workload Identity

## Abstract

**Hanzo CA** (repository: `hanzoai/ca`, formerly TrustyCA) specifies the canonical
zero-trust certification authority, mutual TLS (mTLS) infrastructure, and workload
identity engine for the Hanzo and Lux cloud ecosystem. Hanzo CA eliminates legacy
branding and manual certificate bootstrapping, replacing them with a modular,
orthogonal architecture: automated certificate issuance with hardware/KMS key
protection, native Post-Quantum Cryptography (NIST FIPS 204 ML-DSA signatures and
FIPS 203 ML-KEM key exchange), zero-copy ZAP wire and `zip` framework integration
(HIP-0122), and seamless dark-network overlay binding with Hanzo ZT (`hanzozt`).
Kubernetes workload identity is managed orthogonally by **Hanzo KubeCA**
(`hanzoai/kubeca`), which automatically injects and rotates 24-hour ephemeral mTLS
credentials without cluster ingress dependencies.

## Motivation

Modern distributed AI clusters and zero-trust networks require strict mutual
authentication, non-repudiation, and encryption in transit. However, existing PKI
solutions suffer from four architectural defects:

1. **Branding and Fragmentation**: Legacy systems carry disjoint naming and
   fragmented repos (e.g. "trusty", "trustyca", "xpki"), complicating platform
   discoverability and deployment.
2. **Post-Quantum Vulnerability**: Most enterprise CAs are locked into classical
   RSA and ECDSA signatures. Adversaries recording ciphertext today can decrypt
   cluster traffic once cryptanalytically relevant quantum computers emerge
   ("harvest now, decrypt later").
3. **Transport Overhead**: Traditional gRPC and HTTP/JSON certificate issuance
   imposes heavy serialization latency and garbage collection pressure under high
   pod-churn conditions (measured: 80,687 ns/op and 201 allocs/op for HTTP/JSON;
   947 ns/op and 19 allocs/op for gRPC).
4. **Perimeter Exposure**: Traditional CAs require exposed inbound ports and IP
   allowlists, creating a critical target on the public internet.

Hanzo CA resolves these issues by unbundling identity, workload lifecycle, network
fabric, wire transport, and AI observability into strictly orthogonal components.

## Specification

### 1. Orthogonal Architecture & Concerns

The system decomposes into six independent, composable layers:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       MODULAR ORTHOGONAL CONCERNS                           │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Identity & Authority (hanzoai/ca + hanzoai/pki)                          │
│    - Root & Sub-CAs, OCSP responders, CRL generation                        │
│    - FIPS 204 ML-DSA digital signatures & KMS/HSM hardware key backing     │
│                                                                             │
│ 2. Workload Identity Lifecycle (hanzoai/kubeca)                             │
│    - K8s Operator: 24h short-lived mTLS Secrets injected into Pods          │
│    - Automated rolling renewal via internal CRD and CSR controllers         │
│                                                                             │
│ 3. Zero-Trust Dark Network Fabric (hanzozt)                                 │
│    - Application-embedded overlay mesh; no inbound open ports (Dark CA)     │
│    - Identity-based routing via Transwarp & Dilithium streaming UDP         │
│                                                                             │
│ 4. Wire Protocol & Service Server (zap-proto/zap + zap-proto/zip)           │
│    - Zero-copy binary RPC between cloud services                            │
│    - Fiber v3 / fasthttp edge REST + native MCP tool door for AI agents     │
│                                                                             │
│ 5. AI Inference & Observability Gateway (hanzoai/ai)                        │
│    - Unified proxy for model routing (Zen qwen3+), audit logs, and metrics  │
│                                                                             │
│ 6. Execution & Coding Loop (hanzoai/dev in Rust)                            │
│    - Sub-millisecond TUI agent loop with WASM sandboxing (codex-rs)         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2. Post-Quantum Cryptography (PQC) Standard

Hanzo CA MUST support NIST Post-Quantum standards:
- **Digital Signatures**: FIPS 204 ML-DSA (`ML-DSA-44`, `ML-DSA-65`, `ML-DSA-87`)
  and FIPS 205 SLH-DSA (SPHINCS+) for Root CA, Intermediate CA, and CSR signing.
- **Key Encapsulation & Transport**: Hybrid `X25519MLKEM768` (FIPS 203) for TLS
  1.3 sessions and internal mesh links.
- **Hardware Integration**: The provider layer MUST interface with PKCS#11 HSMs,
  cloud KMS (AWS/GCP), and Lux Quantum Core silicon attestation roots.

### 3. ZAP Wire & zip Integration

Hanzo CA MUST expose its service interface via `zip.App` (HIP-0122):
- **Primary Transport**: ZAP zero-copy binary RPC over TCP/Unix sockets (`:9653`).
- **Edge Transport**: HTTP/JSON via fasthttp on `:8080`.
- **Agent Door**: Native Model Context Protocol (MCP) tool door at `/mcp` and
  socket door, allowing AI agents to issue certificates, query revocation status,
  and inspect trust bundles programmatically.

Measured benchmarks on Apple M1 Max (November 2026):

| Implementation | Latency (ns/op) | Memory (B/op) | Allocs/op | Speedup |
| :--- | :--- | :--- | :--- | :--- |
| Legacy HTTP / JSON | 80,687 ns | 54,641 B | 201 | 1.0x (baseline) |
| Legacy gRPC / Protobuf | 947 ns | 1,288 B | 19 | 85x faster |
| **ZAP Native Wire** | **84.85 ns** | **48 B** | **1** | **950x faster** |

Command used:
```sh
cd server/service/status && go test -bench=BenchmarkStatus .
```

### 4. Hanzo ZT Dark Endpoint Binding

Hanzo CA MUST support binding directly to a Hanzo ZT network identity:
- The CA service binds no public IP and opens no firewall ports.
- Only authorized clients with enrolled Hanzo ZT certificates can reach the
  controller or intermediate issuing endpoints.
- Hanzo ZT controllers bootstrap their own authority certificates from Hanzo CA.

## Rationale

Unifying all certificate management under **Hanzo CA** (`hanzoai/ca`) and dropping
the legacy "trusty" brand aligns the security infrastructure with the wider Hanzo
product line (`hanzoai/ai`, `hanzoai/dev`, `hanzozt`). 

Using `zip` and zero-copy ZAP rather than gRPC eliminates 95% of serialization
overhead and enables native MCP tool exposure without sidecars. Coupling with
Hanzo ZT guarantees that the Certificate Authority is structurally invisible from
the public internet.

## Security Considerations

1. **Private Key Protection**: Root and issuing CA private keys MUST NOT reside on
   ephemeral cluster storage; they MUST be backed by KMS, HSM, or encrypted vaults.
2. **Short-Lived Workloads**: Workload certificates issued by Hanzo KubeCA MUST
   default to a maximum 24-hour validity period, eliminating the need for complex
   online revocation checks for compromised ephemeral pods.
3. **Quantum Transition**: Hybrid certificates (classical + PQ signatures) MUST be
   supported during transition periods to maintain backward compatibility with
   legacy TLS clients while ensuring quantum resistance.

## Roadmap

```text
Phase 1: Rebranding & ZAP-Native Port (Q4 2026)
├── Rebrand legacy trustyca -> Hanzo CA (hanzoai/ca, ghcr.io/hanzoai/ca)
├── Rebrand kubeca -> Hanzo KubeCA (hanzoai/kubeca)
├── Rebrand xpki -> Hanzo PKI (hanzoai/pki)
├── Land ZAP wire framing and zip adapter (PR #24, PR #625)
└── Standardize compose.yml for "hanzo up" local orchestration

Phase 2: Post-Quantum Cryptography & Hardware Roots (Q1 2027)
├── Upstream ML-DSA FIPS 204 parameters in Hanzo PKI (PR #568)
├── Support X.509 hybrid certificates (ECDSA + ML-DSA)
├── Integrate Lux Quantum Core / Lux Key hardware attestation
└── Deploy TLS 1.3 ML-KEM-768 hybrid key exchange across cluster mTLS

Phase 3: Hanzo ZT Dark Mesh Integration (Q2 2027)
├── Bind Hanzo CA endpoints exclusively to Hanzo ZT overlay fabric
├── Automate Hanzo ZT controller bootstrapping via Hanzo CA APIs
└── Enable zero-open-port deployment across production Kubernetes

Phase 4: Autonomous Agent Security & MCP Tooling (Q3 2027)
├── Expose Hanzo CA management over ZAP-native MCP tools
├── Connect Hanzo Dev coding loop for automated policy verification
└── Enforce cryptographic audit trails via DPoP proofs (RFC 9449)
```

## References

- HIP-0005 — Post-Quantum Security for AI Infrastructure
- HIP-0114 — ZAP Protocol Specification
- HIP-0119 — Hanzo Service Conventions
- HIP-0122 — zip: The ZAP-Native Application Server Core
- HIP-0134 — One Process, One Socket, One Identity
- NIST FIPS 203 — Module-Lattice-Based Key-Encapsulation Mechanism Standard (ML-KEM)
- NIST FIPS 204 — Module-Lattice-Based Digital Signature Standard (ML-DSA)

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
