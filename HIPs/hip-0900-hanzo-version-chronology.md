---
hip: 900
title: Hanzo Version Chronology --- 1.0 / 2.0 / 3.0 / 4.0
description: Canonical version timeline for the Hanzo Network from initial AI compute infrastructure through the GPU-native 4.0 activation on 2026-02-14.
author: Zach Kelling, Antje Worring
status: Final
type: Informational
category: Meta
created: 2026-02-14
tags: [chronology, version-history, meta, gpu-native, ai-coin, hmm, triumvirate]
---

## Abstract

This HIP is the canonical chronology of the Hanzo network: the four
locked version milestones, their activation dates, the AI compute
infrastructure at each step, and what the triumvirate (DEX + EVM + FHE)
came to mean for the network. Hanzo AI Inc. (Techstars '17) shipped
1.0 as a centralised AI compute network and graduated through PQ and
GPU-native to a sovereign Lux-family L1 at 4.0. This document is the
single source of truth for that arc.

## Motivation

Hanzo's version history spans five years and four quite different
infrastructure designs. Without a canonical chronology, partners and
integrators are forced to reconstruct the timeline from papers,
HIPs, and changelogs. This HIP fixes the timeline.

## Chronology Table

| Version | Active from | Theme | Defining changes | Reference paper |
|---|---|---|---|---|
| 1.0 | 2018--2023 | Initial AI compute network | Centralised inference and training infrastructure with off-chain billing. | `hanzo-network-whitepaper` (historical) |
| 2.0 | 2024 | Hamiltonian LLMs + AI Coin | On-chain accounting for inference; AI Coin native asset; first version of HMM (Hanzo Market Maker, HIP-8); ASO routing protocol (HIP-2). | `hanzo-ai-chain`, `hanzo-tokenomics`, `lightspeed-dex` |
| 3.0 | 2025 | Full PQ | ML-DSA mandatory for validators; Hanzo settles under Lux Quasar 3.0 (LP-105) cert lanes; FHE inference research preview. | `hanzo-pq-crypto`, `hanzo-fhe-inference` |
| 4.0 | 2026-02-14 | GPU-native + native DEX with Liquidity Protocol | Sovereign L1 on the Lux-family primary chain template (LP-134); AIVM GPU-resident with 8 precompiles (0x0a01--0x0a08); HMM cross-listed via Liquidity Protocol; FHE inference promoted to production; Proof-of-AI mining. | `hanzo-4-0-launch` |

## 4.0 Triumvirate

A Lux-family L1 is triumvirate-complete when it carries three first-class
subsystems. Hanzo 4.0 specialises each one for AI compute:

1. **DEX --- HMM (Hanzo Market Maker).** The native AI-compute
   exchange. Five compute primitives traded: inference seconds,
   training slots, GPU leases, embedding throughput, and active-inference
   budgets. Capacity-decay AMM curve. Cross-listed with Lux D-Chain
   and Zoo DEX via Liquidity Protocol (LP-310). Registered at
   `h_0 + 12`.
2. **EVM --- AIVM.** A Cancun-compatible EVM with eight AI-specific
   precompiles in the `0x0a01`--`0x0a08` range:
   `HMM_LOOKUP`, `INFER_REQUEST`, `INFER_VERIFY`, `TRAIN_BOUNTY`,
   `GPU_LEASE`, `AGENT_AUTH`, `F_CALL`, `M_CUSTODY`. All
   GPU-resident at the 4.0 boundary.
3. **FHE --- Confidential AI inference.** Encrypted prompt inference,
   encrypted decision-tree inference, encrypted federated aggregation.
   Reached through the AIVM `F_CALL` precompile; threshold decryption
   delegated to Lux F-Chain when the client prefers Lux-rooted
   custody.

## Tokenomics Continuity

The AI Coin (`AI`) supply schedule from 2.0 is preserved at 4.0. The
4.0 boundary added two emission streams entirely from the
previously-allocated ecosystem-incentives bucket:

- HMM fee routing: 0.30% of swap volume (50/30/15/5 split).
- FHE relay rewards: capped at 0.5% annualised; paid to validators
  performing FHE bootstrapping and ciphertext maintenance.

No new emission was added.

## Activation Receipts (4.0)

- Activation block: `h_0 = 36,963,000`.
- Activation timestamp: 2026-02-14T00:00:00Z.
- Active validators at `h_0 + 24h`: 312.
- Aggregate GPU FLOPs (FP16): 4.2 EF.
- Sustained inference TPS: 2.1M.
- Median LLM-7B inference latency: 42 ms.
- Median HMM swap latency: 0.91 ms.

## References

- HIP-2 ASO (Active Semantic Optimization) protocol
- HIP-7 Active Inference Integration for Hamiltonian LLMs
- HIP-8 HMM (Hanzo Market Maker) --- Native DEX for AI Compute Resources
- LP-009 GPU-Native EVM
- LP-010 v4 QuasarSTM 4.0
- LP-013 v2 F-Chain FHE Service
- LP-105 Quasar 3.0 Consensus
- LP-134 Canonical 9-Chain Topology and Primary Chain Templates
- LP-137 GPU-Residency Invariant for Lux-Family L1s
- LP-310 Liquidity Protocol Common Settlement API
- `hanzo-4-0-launch` (papers repo)
- `hanzo-ai-chain` (papers repo)
- `hanzo-fhe-inference` (papers repo)
- `lightspeed-dex` (papers repo)
- `hanzo-tokenomics` (papers repo)

## Status

**Final** --- as of 2026-02-14, this chronology is locked. Any future
major version (5.0, etc.) will require its own chronology proposal.
