---
hip: "0000"
title: Hanzo AI Architecture & Framework
author: Hanzo AI Team
type: Meta
status: Living
created: 2024-12-20
---



# HIP-0000: Hanzo AI Architecture & Framework

## Abstract

This document outlines the Hanzo AI architecture, development framework, and the Hanzo Improvement Proposal (HIP) process. It serves as the foundational reference for understanding Hanzo's AI infrastructure, multimodal capabilities, and community governance model.

## Hanzo AI Overview

### Evolution: From Web2.0 to Blockchain AI

Hanzo began as **hanzo.ai** in the Web2.0 era, pioneering AI infrastructure and services. We've now evolved to **hanzo.network**, launching initially as L2 on Lux Network with a clear path to sovereign L1 status, bringing our AI expertise to the blockchain ecosystem.

**Timeline:**
- **Web2.0 Era (hanzo.ai)**: AI infrastructure, enterprise services, and foundational model development
- **Blockchain Launch (hanzo.network)**: Initial L2 deployment on Lux Network
- **Sovereignty Upgrade**: Forthcoming transition to full sovereign L1
- **Current Architecture**: Hybrid web2/web3 with progressive decentralization

### Current Architecture

Hanzo operates as an L2 on Lux Network with a sovereign L1 upgrade path:

**Phase 1 (Live Now)**: 
- L2 EVM chain deployed on Lux Network
- AI infrastructure and $AI tokenomics active
- Integration with Lux infrastructure services

**Phase 2 (Next)**: 
- HMM chain launch with native DEX functionality
- Sovereign L1 upgrade maintaining Lux integration

**Key Components:**
1. **Blockchain**: L2 on Lux Network → Sovereign L1 (next)
2. **HMM DEX**: Native exchange for AI compute resources
3. **AI Models**: Multimodal (text/vision/audio/3D)
4. **Ownership**: Per-user model forks as assets
5. **Security**: Quantum-safe via Lux Q-Chain rollups
6. **Token**: $AI for governance, compute, training

**Lux Infrastructure** (see [Lux LIPs](https://github.com/luxfi/LIPs)):
- **Wallet**: Multi-sig via Lux Safe (LIP-1)
- **Exchange**: $AI trading on lux.exchange (LIP-2)
- **Bridge**: Cross-chain via Lux Bridge (LIP-3)
- **Identity**: SSO via Lux ID (LIP-4)
- **Consensus**: Quasar photonic selection (LIP-5)

### Technical Architecture

```yaml
Current Status: L2 EVM chain on Lux Network (Live)
Next Phase: HMM chain launch with sovereign L1 upgrade
Consensus: Proof of Compute (PoC) - miners provide compute
Block Time: 2 seconds
Finality: Instant (single-slot)
Validators: Compute providers with GPU resources
Native Token: $AI
Quantum Safety: Lux Network Q-Chain quantum rollups
Compute DEX: HMM (Hanzo Market Maker) for AI resources

Upgrade Path:
  Phase 1 (Live): L2 EVM chain on Lux
  Phase 2 (Next): HMM chain + Sovereign L1
```

### Proof of Compute (PoC) Consensus

Hanzo uses Proof of Compute where miners provide AI compute resources to secure the network:

```yaml
PoC Protocol:
  - Compute Mining: Miners provide GPU/TPU resources for AI tasks
  - Work Validation: Cryptographic proof of computation performed
  - Rewards: $AI tokens for validated compute contributions
  - Quality Metrics: Performance-based reward adjustments
  - Resource Types:
    - Model training compute
    - Inference serving
    - Fine-tuning operations
    - Embedding generation
```

### Quantum Safety via Q-Chain

Hanzo achieves full quantum safety through Lux Network's Q-Chain quantum rollups:

```yaml
Q-Chain Integration:
  - Quantum Rollups: All transactions quantum-resistant
  - PQC Algorithms: NIST-approved ML-KEM/ML-DSA
  - Cross-Chain Security: Quantum safety across EVM and HMM chains
  - Future-Proof: Ready for quantum computing era
  - Zero-Knowledge: Optional ZK proofs for privacy
```

### HMM Native DEX

The **HMM (Hanzo Market Maker)** is our native decentralized exchange specifically designed for AI compute resources:

```yaml
HMM Features:
  - Compute Resource Trading: Buy/sell GPU time, model inference, training slots
  - Dynamic Pricing: Market-based pricing for AI compute
  - Resource Pools: Liquidity pools for different compute types
  - Instant Settlement: Sub-second compute allocation
  - Quality Metrics: Performance-based pricing adjustments
  - Cross-Chain Bridge: Access compute from Lux, Ethereum, and other chains
  - Quantum-Safe: All transactions protected by Q-Chain
```

## Architecture Components

### Core Infrastructure

```
hanzo/
├── llm/              # LLM gateway and routing
├── agent/            # Agent SDK and orchestration
├── mcp/              # Model Context Protocol
├── jin/              # Multimodal framework
├── search/           # AI-powered search
├── platform/         # PaaS infrastructure
└── node/             # Hanzo Node with PQC
```

### Hanzo Multimodal Models (HMMs)

Hanzo's proprietary multimodal AI models supporting:
- **Text**: Natural language understanding and generation
- **Vision**: Image understanding and generation
- **Audio**: Speech recognition and synthesis
- **3D**: Spatial understanding and generation
- **Cross-modal**: Unified representations across modalities

### Agent Framework

- **Autonomous Agents**: Self-directed task completion
- **Tool Use**: Integration with external tools and APIs
- **Memory Systems**: Long-term and working memory
- **Planning**: Multi-step reasoning and execution
- **Collaboration**: Multi-agent coordination

### Security Infrastructure

- **Post-Quantum Cryptography**: NIST-compliant ML-KEM/ML-DSA
- **TEE Integration**: Secure enclaves for sensitive operations
- **Privacy Tiers**: Adaptive security levels
- **Key Management**: Hanzo KBS for secure key handling

## HIP Process

### Proposal Lifecycle

1. **Idea**: Community discussion and refinement
2. **Draft**: Formal proposal creation
3. **Review**: Technical and community review
4. **Last Call**: Final review period (14 days)
5. **Final**: Accepted and ready for implementation
6. **Superseded**: Replaced by newer proposal

### Proposal Types

- **Standards Track**: Technical specifications
- **Meta**: Process and governance
- **Informational**: Best practices and guidelines

### Numbering Convention

- **0-99**: Core infrastructure and governance
- **100-199**: AI models and architectures
- **200-299**: Agent frameworks
- **300-399**: Tools and integrations
- **400-499**: Security and privacy
- **500+**: Application standards

## Development Principles

### AI-First Design
- Every component designed for AI workloads
- Optimized for inference and training
- Multimodal by default

### Scalability
- Horizontal scaling for inference
- Distributed training support
- Edge to cloud deployment

### Interoperability
- Open standards (MCP, OpenAI API)
- Multiple model provider support
- Cross-platform compatibility

### Security
- Quantum-resistant by design
- Defense in depth
- Privacy-preserving computation

## Community Governance

### Decision Making
- Rough consensus model
- Technical merit primary consideration
- Community input via forums and discussions

### Roles
- **Authors**: Propose and maintain HIPs
- **Editors**: Review and merge proposals
- **Implementers**: Build HIP specifications
- **Community**: Provide feedback and consensus

### Communication Channels
- GitHub: Code and proposals
- Forum: Long-form discussions
- Discord: Real-time chat
- Twitter: Announcements

## Implementation Requirements

### For HIP Authors
1. Clear problem statement
2. Detailed specification
3. Security considerations
4. Test cases
5. Reference implementation (when applicable)

### For Implementers
1. Follow HIP specifications exactly
2. Include comprehensive tests
3. Document deviations
4. Provide migration guides

## Future Direction

### Short-term (Q1-Q2 2025)
- HMM v1.0 release
- Agent framework standardization
- MCP full integration

### Medium-term (Q3-Q4 2025)
- Distributed inference protocol
- Federated learning support
- Advanced multimodal capabilities

### Long-term (2026+)
- AGI research initiatives
- Neuromorphic computing
- Quantum AI algorithms

## Hanzo OS (Hanzo Dō) Architectural Pillars

Hanzo OS (also referred to as **Hanzo Dō**) organizes the vertically integrated AI operating system into five decoupled, independently evolvable layers governed by open specifications and verifiable evidence:

1. **Specification (`hanzoai/hips`, `standard.json`)**: The curated, versioned AI OS specification (HIP-1400). Acts as the single authority for all interfaces, schemas, wire formats, and conformance requirements across the stack.
2. **Harness (`hanzoai/kata`)**: The reproducible execution form. Owns agent lifecycle management, policy enforcement, resource budgeting, supervision, and evaluation triggering.
3. **Agent Engine (`hanzoai/gen`)**: The core intelligence loop. Owns reasoning, action selection, tool orchestration, context management, and error recovery. Domain-specialized agents such as the coding agent (`hanzoai/dev`, HIP-1330) compose on top of the Engine.
4. **Sandbox (`hanzoai/visor`)**: The isolated execution environment (HIP-0053, HIP-0123, HIP-1172). Provides reproducible, isolated compute, networking, and filesystem access for both production workloads and experimental evaluations.
5. **Evidence & XP (`hanzoai/audit`, `hanzoai/research`)**: Immutable provenance and tamper-evident audit records (HIP-1103, HIP-1334) together with deterministic contribution projections (**Hanzo XP**, HIP-1402). XP is strictly non-transferable and subordinate to Evidence.

## Evolutionary Fitness Protocol

Every layer of Hanzo OS is independently evolvable under an evidence-based recursive improvement loop (HIP-1401, HIP-1403). Progress is governed by two levels of fitness:

### Level 1: Product Fitness

Measures the capability, efficiency, and reliability of a deployed system (Agent, Harness, Router, or Model):

- **Verified Success**: Task completion verified under independent holdout evaluation.
- **Cost Efficiency**: Total compute and token execution cost per verified success.
- **Latency**: Wall-clock time to verified completion (median and tail percentiles).
- **Robustness**: Regression rates across private holdout, edge-case, and adversarial suites.

### Level 2: Evolutionary Fitness

Measures the system's ability to discover, validate, and reproduce improvements to itself:

- **Research Yield ($Y_R$)**: Verified capability gain per unit of total research expenditure, defined as $Y_R = \Delta H_{\text{verified}} / C_{\text{total\_research}}$.
- **Successor Research Lift ($L_R$)**: Relative improvement in research yield of a successor configuration over its predecessor, defined as $L_R = Y_R(\text{successor}) / Y_R(\text{predecessor})$.
- **Discovery Rate**: Count of independently qualified improvements per 100 executed experiments.
- **Transfer Rate**: Generalization of a qualified improvement across unseen tasks, repositories, and environments.
- **Reproducibility**: Fraction of claimed discoveries independently replicated under clean sandboxed runs.

### Evolutionary Requirements

- **Provenance**: Every evolutionary candidate MUST maintain immutable parent lineage recorded in the Evidence ledger (HIP-1103, HIP-1401).
- **Isolation**: Research agents propose mutations within declared mutation surfaces; they MUST NOT modify production security boundaries, evaluation holdouts, or promotion authority.
- **Independent Qualification**: Promotion to production requires independent holdout verification, integrity checks, and a validated rollback path (HIP-1334, HIP-1401).
- **Population-based Search**: The system preserves diverse evolutionary branches along a multi-objective Pareto frontier (Quality, Cost, Latency, Robustness, Safety) to avoid local optima.

## Appendix A: Repository Responsibility Matrix

This matrix maps Hanzo OS layers to public repositories, defining ownership boundaries and decoupling targets:

| Layer | Canonical Repository | Current Audit Focus | Target Responsibility | Boundary & Migration Note |
| :--- | :--- | :--- | :--- | :--- |
| **Specification** | `hanzoai/hips` | HIPs, OpenAPI, schemas | Curated AI OS standards, `standard.json` manifest, conformance suites | Authoritative spec layer (HIP-1400); no runtime code |
| **Harness** | `hanzoai/kata` | Harness logic, execution supervision | Reproducible harness, agent lifecycle, policy enforcement, evaluation triggering | Keep domain-specific coding triage out of Harness (belongs in `hanzoai/dev`) |
| **Agent Engine** | `hanzoai/gen` | Reasoning loop, launching, integrations | Generic agent engine, context management, tool orchestration, recovery | Move process/container launching concerns into Harness (`hanzoai/kata`) |
| **Coding Agent** | `hanzoai/dev` | Agent loop, repo tools, patch workflows | Coding-specialized agent built on the Agent Engine (HIP-1330) | Retain specialized coding intelligence; consume Harness and Sandbox interfaces |
| **Sandbox** | `hanzoai/visor` | Sandboxed execution, compute isolation | Universal isolated execution environment (compute, network, filesystem) | Canonical Sandbox runtime (HIP-0053, HIP-0123, HIP-1172) |
| **Model Router** | `hanzoai/enso` | Model routing and cascades | Learned model orchestration and cost/quality routing (HIP-0510) | Retain as independent routing layer between Engine and inference backends |
| **Model & Kernel Engines** | `hanzoai/ml` | Training, inference, DSL kernels | Model training, inference runtime, and hardware kernel lowering | Keep orthogonal to Harness and Agent Engine loops |
| **Evidence & XP** | `hanzoai/audit`, `hanzoai/research` | Audit trail, research records, evals | Tamper-evident Evidence ledger (HIP-1103), Research runtime (HIP-1334), XP projection (HIP-1402) | XP is a deterministic, non-transferable projection strictly subordinate to Evidence |

## Appendix B: Evolutionary Research Roadmap

The Hanzo OS evolutionary progression is structured into six verifiable stages (**E0** through **E5**):

| Stage | Name | Entry Gate | Exit Criteria |
| :--- | :--- | :--- | :--- |
| **E0** | **Specification & Baseline** | `standard.json` published (HIP-1400) | Conformance suites passing; baseline Level 1 Product Fitness measured on frozen holdouts |
| **E1** | **Controlled Harness Evolution** | Immutable Evidence & Sandbox isolation live | Automated single-surface mutations (prompts, harness policies) passing independent qualification |
| **E2** | **Population Search** | E1 qualification and rollback gates proven | Multi-objective Pareto population archive active (HIP-1401) across Quality, Cost, and Latency |
| **E3** | **Cross-Layer Co-Evolution** | E2 transfer rate verified across domains | Coordinated candidate evaluation across Harness, Engine, and Model Router with zero security regressions |
| **E4** | **Autonomous Scientific Research** | E3 reproducibility threshold met | Agents register falsifiable hypotheses, execute sandboxed experiments, and pass independent replication (HIP-1403) |
| **E5** | **Recursive Improvement ($L_R > 1$)** | E4 replication & retraction workflows proven | Sustained Successor Research Lift ($L_R > 1$) verified across consecutive generations under frozen gates |

## References

1. [Hanzo AI Documentation](https://docs.hanzo.ai)
2. [Hanzo Node Repository](https://github.com/hanzoai/node)
3. [Model Context Protocol](https://modelcontextprotocol.io)
4. [NIST PQC Standards](https://csrc.nist.gov/projects/post-quantum-cryptography)
5. HIP-1103 — Audit Tamper-Evident Trail
6. HIP-1334 — Research: The Unified Research Runtime
7. HIP-1400 — Hanzo OS Conformance & Specification Manifest
8. HIP-1401 — Evolutionary Candidate & Population Protocol
9. HIP-1402 — Hanzo XP — Verified Contribution Protocol
10. HIP-1403 — Autonomous Scientific Research Protocol

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).