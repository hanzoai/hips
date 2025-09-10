# Hanzo AI - Comprehensive Summary

## Overview
Hanzo AI evolved from hanzo.ai (Web2.0) to hanzo.network (Web3), currently operating as an L2 EVM chain on Lux Network (live) with the HMM chain and sovereign L1 upgrade launching next. The HMM (Hanzo Market Maker) is our native DEX for AI compute resources, enabling decentralized trading of GPU time and model inference. Built on this infrastructure are the Hamiltonian Large Language Models (HLLMs) with Active Inference integration, all secured by full quantum safety via Lux Network Q-Chain quantum rollups.

## Key Components

### 1. Architecture (HIP-0)
- **Current Status**: L2 EVM chain on Lux Network (Live)
- **Next Phase**: HMM chain launch → Sovereign L1 upgrade
- **Evolution**: hanzo.ai (Web2.0) → hanzo.network L2 (Live) → Sovereign L1 (Next)
- **Consensus**: Proof of Compute (PoC) - miners provide compute resources
- **Quantum Safety**: Full protection via Lux Q-Chain quantum rollups
- **Block Time**: 2 seconds with instant finality
- **Validators**: Compute providers with GPU resources
- **Native Token**: $AI for governance, compute, and training
- **HMM DEX**: Native decentralized exchange for AI compute resources

### 2. $AI Token (HIP-1)
- **Total Supply**: 1,000,000,000 $AI
- **Consensus**: Proof of Compute mining
- **Utility**: Compute payments, training rewards, governance
- **Exchange**: [lux.exchange/trade/AI](https://lux.exchange/trade/AI)
- **Distribution**: 30% mining, 20% training, 15% ecosystem

### 3. HMM DEX (HIP-8)
- **Hanzo Market Maker**: Native DEX for AI compute resources
- **Trading Pairs**: GPU time, inference slots, training epochs
- **Dynamic Pricing**: Market-based AI resource pricing
- **Instant Settlement**: Sub-second compute allocation
- **Cross-Chain**: Bridge from Lux, Ethereum, other chains

### 4. Hamiltonian LLMs (HIP-2)
- **Architecture**: Unified multimodal transformers
- **Modalities**: Text, vision, audio, 3D
- **Variants**: HLLM-7B, HLLM-32B, HLLM-175B, HLLM-1T
- **Key Feature**: Per-user fine-tuning with personal model forks
- **Research**: Papers on ArXiv, open source on GitHub

### 5. Active Inference Integration (HIP-7)
Based on Active Inference research community and IEEE 2874 standards:

#### Expected Free Energy (EFE) Minimization
$$\text{EFE} = \underbrace{\mathbb{E}[\text{goal loss}]}_{\text{utility}} + \underbrace{\text{epistemic value}}_{\text{curiosity}}$$

#### Key Components
- **Active Inference Planner**: AXIOM-style EFE minimization
- **Renormalizable World Models**: Structure-learning adapters
- **Explainability**: Introspective decision traces
- **IEEE 2874 Compliance**: HSML/HSTP interoperability

### 6. Post-Quantum Security (HIP-5)
- **Algorithms**: ML-KEM-768, ML-DSA-65 (NIST standards)
- **Implementation**: liboqs v0.11 integration
- **Privacy Tiers**: 5 levels from Open to GPU TEE-I/O
- **Key Management**: Hanzo KBS with HSM support

### 7. Per-User Fine-Tuning (HIP-6)
- **Immutable Training Ledger**: On-chain record of all training
- **Personal Model Forks**: Every user owns unique model
- **Privacy**: Encrypted training data with user keys
- **Evolution**: Continuous learning from interactions

### 8. $AI Tokenomics

#### Distribution (1B total)
- Compute Mining: 30% (300M)
- Training Rewards: 20% (200M)
- Ecosystem Fund: 15% (150M)
- Community Treasury: 15% (150M)
- Team & Advisors: 10% (100M, 4-year vest)
- Public Sale: 5% (50M)
- Liquidity: 5% (50M)

#### Utility
- **Training**: 0.01 $AI per interaction
- **Compute**: 0.001-0.1 $AI per 1K tokens
- **Model Access**: 0.001-0.1 $AI per 1K tokens
- **Governance**: Staking for voting power

### 9. Agent Framework
- **Autonomous Agents**: Self-directed task completion
- **Tool Use**: MCP integration
- **Memory Systems**: Long-term and working memory
- **Planning**: Multi-step reasoning with EFE
- **Collaboration**: Multi-agent coordination

### 10. Infrastructure Components

```
hanzo/
├── llm/        # LLM gateway and routing
├── agent/      # Agent SDK and orchestration
├── mcp/        # Model Context Protocol
├── jin/        # Multimodal framework
├── search/     # AI-powered search
├── platform/   # PaaS infrastructure
├── node/       # Hanzo Node with PQC
└── hmm/        # HMM DEX for AI compute marketplace
```

## Technical Implementation

### Hierarchical Control
```python
class HierarchicalController:
    micro = MicroController(horizon=3)   # Token-level
    macro = MacroController(horizon=12)  # Sub-goals
```

### Hamiltonian Market-Maker with EFE
```python
score = α·EFE + β·price + γ·SLO
```

### Training Pipeline
1. World model pretraining on tool logs
2. Planner fine-tuning to minimize EFE
3. Joint adapter+planner tuning with DP noise
4. Validation gates for production

## Roadmap 2025

### Q1 2025
- HMM DEX launch on L2
- $AI token launch on lux.exchange
- HLLM-7B with per-user forking
- Basic training rewards
- Active Inference planner integration

### Q2 2025
- HMM chain → Sovereign L1 upgrade
- Full tokenomics activation
- Model NFT marketplace
- Staking mechanisms
- IEEE 2874 HSML/HSTP support

### Q3 2025
- HLLM-32B and HLLM-175B
- Advanced reward algorithms
- Cross-chain bridges
- Renormalizable world models

### Q4 2025
- HLLM-1T collective intelligence
- DAO governance
- Sustainable economics
- Full Active Inference architecture integration

## Key Innovations

1. **HMM DEX**: Native decentralized exchange for AI compute resources
2. **Hamiltonian Dynamics**: Energy-conserving model architecture
3. **Active Inference**: Principled planning via EFE minimization
4. **Per-User Models**: Every user owns their AI evolution
5. **Post-Quantum Ready**: NIST-compliant cryptography
6. **IEEE 2874 Standards**: Universal interoperability

## Research Citations

### Active Inference Research
- Friston, K., et al. (2024). "AXIOM: Advanced eXplainable Intelligence"
- Fields, C., et al. (2024). "Renormalizable Generative Models"
- Da Costa, L., et al. (2024). "Active Inference for Explainable AI"

### Standards
- IEEE 2874-2025: Spatial Web Protocol
- NIST FIPS 203/204: Post-Quantum Cryptography
- Model Context Protocol (MCP)

## Metrics & KPIs

### Active Inference
- EFE lift: +15-20% routing accuracy
- Exploration efficiency: Goals/queries ratio
- Trace utility: 95% incidents resolved

### Performance
- Latency: <100ms first token (HLLM-32B)
- Throughput: >1000 tokens/second
- Memory: <16GB for HLLM-7B

### Economics
- Training rewards: 0.01 $AI/interaction
- Market stability: <10% daily volatility
- Model NFT value: 10-10,000 $AI

## GitHub Repositories
- **HIPs**: [github.com/hanzoai/HIPs](https://github.com/hanzoai/HIPs)
- **Hanzo Node**: [github.com/hanzoai/hanzo-node](https://github.com/hanzoai/hanzo-node)
- **Agent SDK**: [github.com/hanzoai/agent](https://github.com/hanzoai/agent)
- **MCP Tools**: [github.com/hanzoai/mcp](https://github.com/hanzoai/mcp)

## Community
- **Website**: [hanzo.ai](https://hanzo.ai)
- **Documentation**: [docs.hanzo.ai](https://docs.hanzo.ai)
- **Forum**: [forum.hanzo.ai](https://forum.hanzo.ai)
- **Discord**: [discord.gg/hanzoai](https://discord.gg/hanzoai)

---

*Building the future of AI infrastructure through Hamiltonian dynamics and Active Inference.*