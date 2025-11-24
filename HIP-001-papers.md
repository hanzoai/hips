# HIP-001: Hanzo Research Papers Repository

**Status**: Active
**Type**: Informational
**Created**: 2025-10-28
**Updated**: 2025-10-28
**Authors**: Hanzo Industries Inc

## Abstract

This HIP documents the official Hanzo research papers repository at `github.com/hanzoai/papers`. The repository contains research on Active Semantic Optimization (ASO), Decentralized Semantic Optimization (DSO), Hamiltonian Market Maker (HMM), Jin multimodal architecture, and the Hanzo network whitepaper.

**Note**: Zoo network papers are maintained separately at `github.com/zooai/papers`. This separation allows each project to maintain independent research directions while collaborating where appropriate.

## Hanzo Research Papers

### 1. Hanzo ASO (Active Semantic Optimization) 🎯 **PRIMARY**
- **HIP**: [HIP-002](HIP-002-aso.md)
- **File**: `hanzo-aso.pdf` | [LaTeX](https://github.com/hanzoai/papers/blob/main/hanzo-aso.tex)
- **Status**: ✅ Published October 2025
- **Title**: "Training-Free Adaptation via Active Semantic Optimization and Product-of-Experts Decoding"
- **Key Results**: 18.2% resolved rate on SWE-bench Verified
- **Contributions**:
  - Training-Free GRPO (TF-GRPO) with epistemic utility
  - Product-of-Experts (PoE) decoding at token level
  - 1-bit semantic compression (BitDelta) - 29.5× savings
  - Hanzo Dev CLI agent with SWE-bench integration

### 2. Hanzo DSO (Decentralized Semantic Optimization)
- **HIP**: [HIP-003](HIP-003-dso.md)
- **File**: `hanzo-dso.pdf` | [LaTeX](https://github.com/hanzoai/papers/blob/main/hanzo-dso.tex)
- **Status**: ✅ Published October 2025
- **Title**: "Decentralized Semantic Optimization with Byzantine-Robust Prior Aggregation"
- **Key Results**: 15.2% improvement in multi-agent tasks vs isolated operation
- **Contributions**:
  - Byzantine-robust median voting with stake weighting
  - ExperienceRegistry smart contract (IPFS/Arweave storage)
  - P2P gossip protocol for prior synchronization
  - Quality scoring and slashing mechanism

### 3. Hanzo HMM (Hamiltonian Market Maker)
- **HIP**: [HIP-004](HIP-004-hmm.md)
- **File**: `hanzo-hmm.pdf` | [LaTeX](https://github.com/hanzoai/papers/blob/main/hanzo-hmm.tex)
- **Status**: ✅ Published October 2025
- **Title**: "Hamiltonian Market Maker for Decentralized AI Compute Exchange"
- **Key Results**: < 200ms quote latency, 98.7% price stability (vs 89.2% oracle-based)
- **Contributions**:
  - Hamiltonian invariant H(Ψ,Θ) = κ for oracle-free pricing
  - Multi-asset routing with SLA-aware path solver
  - Risk-adjusted fee structure for inventory management
  - PoAI integration for verifiable job settlement

### 4. Hanzo Network Whitepaper
- **File**: `hanzo-network-whitepaper.pdf` | [LaTeX](https://github.com/hanzoai/papers/blob/main/hanzo-network-whitepaper.tex)
- **Status**: ✅ Published
- **Title**: "Hanzo Network: Decentralized AI Infrastructure"
- **Description**: Architecture overview, consensus mechanism, economic model

### 5. Jin Architecture Papers
- **Directory**: `jin/` | [GitHub](https://github.com/hanzoai/papers/tree/main/jin)
- **Papers**:
  - JIN-TAC: Joint Intelligence Network for Tactical Autonomous Command
  - Jin Hypermodal: Multi-modal AI architecture (text/vision/audio/3D)
  - AAL A2V2: Army Application Laboratory whitepaper
- **Status**: Technical whitepapers and research documentation

## Hanzo Architecture in PoAI

### Layer Responsibilities

```
┌─────────────────────────────────────────────┐
│  Zoo Network (L2 - Semantic Learning)       │
│  - Experience libraries                      │
│  - Semantic advantage extraction             │
│  - Context injection                         │
│  - Training-Free GRPO                        │
└─────────────────────┬───────────────────────┘
                      │ uses attestations from
                      ▼
┌─────────────────────────────────────────────┐
│  Hanzo Network (L1 - Compute + Consensus)   │
│  - PoAI consensus protocol                   │
│  - Attestation verification                  │
│  - HMM price dynamics                        │
│  - $AI token emissions                       │
│  - Job execution (train, eval, compress)     │
└─────────────────────────────────────────────┘
```

### Key Hanzo Components

1. **PoAI Consensus Engine**
   - Validates attestations with ΔI and ΔU metrics
   - Aggregates Byzantine-robust posteriors
   - Triggers slashing for malicious nodes

2. **Job Executor**
   - Runs training/evaluation/compression tasks
   - Meters resource usage (compute, bandwidth, energy)
   - Generates TEE attestations

3. **HMM Price Oracle**
   - Computes Hamiltonian H = λ_risk·E[risk] + λ_amb·E[amb] - β·E[ΔU] - γ·E[ΔI]
   - Updates prices via dΘ/dt = -∂H/∂Ψ dynamics
   - Routes liquidity to high-EFE policies

4. **Smart Contracts**
   - `submit_attestation()`: On-chain verification
   - `request_liquidity()`: Job routing
   - `stake_and_challenge()`: Optimistic verification

## Implementation Status

### Hanzo Codebase
- **Location**: `~/work/hanzo/node/`
- **Language**: Rust
- **Relevant Crates**:
  - `hanzo-consensus`: PoAI implementation
  - `hanzo-mining`: Job execution and attestations
  - `hanzo-http-api`: REST/WebSocket for attestations
  - `hanzo-tools-primitives`: Shared utilities

### Integration Points

```rust
// PoAI attestation structure (conceptual)
struct Attestation {
    job_id: JobID,
    delta_I: f64,        // Information gain
    delta_U: f64,        // Utility improvement
    cost: ResourceMetrics,
    proof: TEEQuote,
    signature: Signature,
}

// Emission formula
fn compute_emissions(attestation: &Attestation) -> TokenAmount {
    let gamma = 1.0;  // Information gain weight
    let beta = 0.5;   // Utility weight
    let lambda_c = 0.1;  // Cost penalty

    gamma * attestation.delta_I
        + beta * attestation.delta_U
        - lambda_c * attestation.cost.total()
}
```

## Timeline

### Q2 2025 - PoAI Focus
- **April**: Finalize PoAI paper
- **May**: Submit to IEEE Blockchain
- **June**: Implement PoAI consensus in Hanzo node

### Q3 2025 - Deployment
- **July**: Testnet launch with PoAI
- **August**: Byzantine robustness testing
- **September**: Mainnet preparation

### Q4 2025 - Production
- **October**: Mainnet launch
- **November**: Monitor attestation quality
- **December**: HMM paper (if standalone)

## Local Development

Hanzo papers repository:
- **Local**: `~/work/hanzo/papers/`
- **Remote**: `github.com/hanzoai/papers`

To build papers:
```bash
cd ~/work/hanzo/papers
make              # Build all PDFs (ASO, DSO, HMM)
make view         # Open PDFs (macOS)
make clean        # Clean intermediate files
```

## References

- **Hanzo Papers Repository**: https://github.com/hanzoai/papers
- **Hanzo GitHub Organization**: https://github.com/hanzoai
- **Hanzo Website**: https://hanzo.ai
- **HIPs (Hanzo Improvement Proposals)**: `~/work/hanzo/hips/`

## Copyright

Papers: CC BY 4.0 (Creative Commons Attribution)
Code: Apache 2.0
Organization: Zoo Labs Foundation Inc (501(c)(3) non-profit)

---

*HIP-001 Created: October 28, 2025*
*Status: Active*
*Contact: research@zoo.ngo*
