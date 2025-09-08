# LLM.md - Hanzo Improvement Proposals (HIPs) Knowledge Base

## Project Overview
This repository contains Hanzo Improvement Proposals (HIPs) - the formal specification and governance framework for Hanzo AI, a sovereign Layer 1 blockchain specializing in AI infrastructure and model ownership.

## Repository Structure
```
hips/
├── HIPs/          # Individual improvement proposals
├── docs/          # Supporting documentation
├── README.md      # Project overview and index
├── SUMMARY.md     # Comprehensive ecosystem summary
└── LLM.md         # This file - AI assistant knowledge base
```

## Active HIPs

### HIP-0: Hanzo L1 Architecture & Sovereignty
- **Status**: Final
- **Type**: Meta
- **Purpose**: Establishes Hanzo as sovereign L1 blockchain via Lux Protocol
- **Key Features**:
  - AI-optimized Proof of Intelligence (PoI) consensus
  - 2-second blocks with instant finality
  - GPU-enabled validators for AI computation
  - Native HANZO token for governance and compute

### HIP-1: Hamiltonian Large Language Models (HLLMs)
- **Status**: Draft
- **Type**: Standards Track (Core)
- **Purpose**: Unified multimodal AI architecture
- **Key Corrections**: Named "Hamiltonian" (not Hanzo) LLMs
- **Variants**:
  - HLLM-7B: Edge deployment
  - HLLM-32B: Standard applications
  - HLLM-175B: Enterprise
  - HLLM-1T: Collective intelligence
- **Modalities**: Text, vision, audio, 3D
- **Training**: 10T tokens, 5B images, 100K hours audio

### HIP-5: Post-Quantum Cryptography
- **Status**: Final
- **Type**: Standards Track (Security)
- **Purpose**: NIST-compliant quantum-resistant security
- **Algorithms**:
  - ML-KEM-768 (FIPS 203) for key encapsulation
  - ML-DSA-65 (FIPS 204) for digital signatures
- **Implementation**: liboqs v0.11 integration
- **Privacy Tiers**: 5 levels from Open to GPU TEE-I/O

### HIP-6: Per-User Fine-Tuning Architecture
- **Status**: Draft
- **Type**: Standards Track (Core)
- **Purpose**: Personal AI model ownership
- **Critical Design**: Per-user models (NOT domain-specific)
- **Features**:
  - Every user owns unique model fork
  - Immutable on-chain training ledger
  - Privacy-preserving encrypted training
  - Continuous learning from interactions

### HIP-7: Active Inference Integration
- **Status**: Draft
- **Type**: Standards Track (Core)
- **Purpose**: VERSES/Active Inference principles
- **Key Components**:
  - Expected Free Energy (EFE) minimization
  - Renormalizable world models
  - IEEE 2874 Spatial Web compliance
  - Explainable AI through introspection

## Related Ecosystems

### Zoo Ecosystem (ZIPs)
- **Repository**: github.com/zooai/ZIPs
- **Architecture**: EVM L2 on Lux Network (not sovereign L1)
- **Model**: Eco-1 with z-JEPA hyper-modal architecture
- **Focus**: DeFi, gaming, NFTs under 501(c)(3) non-profit
- **Genesis**: 100% airdrop to Logan Paul CryptoZoo victims
- **Key Innovation**: z-JEPA performs cross-modal prediction with BitDelta personalization

### Lux Protocol (LPs)
- **LP-25**: Sovereign appchain launching (enables HIP-0)
- **LP-102**: Immutable Training Ledger (referenced by HIP-6)
- **LP-103**: Cross-Chain AI Training Coordination

## Technical Standards

### Post-Quantum Cryptography
```rust
// From hanzo-pqc crate
pub enum PrivacyTier {
    Open,           // No encryption
    Basic,          // PQC only
    Enhanced,       // PQC + OPRF
    Extreme,        // PQC + OPRF + MPC
    GpuTeeIo,       // Full TEE protection
}
```

### Hamiltonian Architecture
```python
class HamiltonianController:
    """Resource-constrained routing with dual variables"""
    def optimize(self):
        return min(E[L_task + λ_c*Compute + λ_ℓ*Latency])
```

### Active Inference Planning
```python
# Expected Free Energy minimization
EFE = E[goal_loss] + epistemic_value
```

## HANZO Tokenomics

### Distribution (1B total)
- Training Rewards: 30% (300M)
- Compute Providers: 20% (200M)
- Model Developers: 15% (150M)
- Community Treasury: 15% (150M)
- Team & Advisors: 10% (100M, 4-year vest)
- Public Sale: 5% (50M)
- Liquidity: 5% (50M)

### Utility
- Training: 0.01 HANZO per interaction
- Compute: 0.001-0.1 HANZO per 1K tokens
- Model NFTs: 10+ HANZO minting cost
- Governance: veHANZO staking

## Development Guidelines

### Proposal Process
1. Draft proposal in HIPs/ directory
2. Follow template structure (see existing HIPs)
3. Submit PR for review
4. Community discussion period
5. Move to Last Call (14 days)
6. Final approval and implementation

### Writing Standards
- Use formal technical language
- Include mathematical specifications where relevant
- Provide implementation examples in Python/Rust/Solidity
- Reference related HIPs, ZIPs, and LPs
- Add academic citations for research-based proposals

### Code Examples
- Python for AI/ML components
- Rust for systems-level implementation
- Solidity for smart contracts
- TypeScript for frontend/SDK

## Key Design Principles

### Per-User Model Philosophy
**CRITICAL**: The system implements per-user fine-tuning where every user owns their unique model evolution. This is NOT domain-specific fine-tuning. Each user's interactions create a personal AI that learns and adapts specifically to them.

### Hamiltonian Dynamics
Models follow energy-conserving principles from physics, ensuring stable long-term behavior and efficient resource usage.

### Active Inference
Planning and decision-making use Expected Free Energy minimization, balancing goal achievement with information gain.

### Immutable Training Ledger
All AI training operations are recorded on-chain, providing transparency and auditability for model evolution.

## Integration Points

### With Lux Network
- Hanzo launches as sovereign L1 via LP-25
- Shared PQC security infrastructure
- Cross-chain bridges for interoperability

### With Zoo Ecosystem
- Shared Hamiltonian LLM architecture
- User model portability between chains
- Unified governance participation

### IEEE 2874 Spatial Web
- HSML for semantic descriptions
- HSTP for agent communication
- Universal Data Graph for shared state

## Research References

### Core Papers
- VERSES/AXIOM: Advanced eXplainable Intelligence
- Friston et al.: Active Inference foundations
- NIST FIPS 203/204: Post-Quantum standards
- BitDelta: Memory-efficient personalization

### Implementation Libraries
- liboqs v0.11: Quantum-safe cryptography
- Model Context Protocol (MCP): Tool connectivity
- FlashAttention-2: Efficient transformer inference

## CI/CD Configuration

### GitHub Actions
- Markdown linting for proposals
- Link checking for references
- Version management
- Auto-deployment to documentation site

### Required Checks
- Proposal formatting validation
- Reference verification
- Status progression rules
- Conflict detection with existing HIPs

## Common Tasks

### Adding a New HIP
```bash
# Create from template
cp docs/templates/hip-template.md HIPs/hip-X.md

# Edit with required sections
vim HIPs/hip-X.md

# Update index
vim README.md

# Submit PR
git add HIPs/hip-X.md README.md
git commit -m "Add HIP-X: [Title]"
git push origin feature/hip-X
```

### Updating HIP Status
- Draft → Review: After initial feedback
- Review → Last Call: Community consensus
- Last Call → Final: After 14-day period
- Any → Withdrawn: Author decision
- Any → Superseded: When replaced

## Security Considerations

### Quantum Resistance
All cryptographic operations use NIST-approved PQC algorithms to ensure long-term security against quantum attacks.

### Privacy Preservation
User training data encrypted with user keys, ensuring only the user can access their model's training history.

### Consensus Security
Proof of Intelligence requires GPU attestation, preventing Sybil attacks while enabling AI computation validation.

## Performance Targets

### Latency
- First token: <100ms (HLLM-32B)
- Streaming: 50+ tokens/second
- Training feedback: <1 second

### Scalability
- 10K+ concurrent users
- 1M+ daily interactions
- 100K+ active models

### Resource Efficiency
- BitDelta: 10x memory savings
- Quantization: 4-bit inference
- Caching: 90% hit rate

## Future Roadmap

### 2025 Q1
- HIP-1 HLLM-7B deployment
- HIP-6 per-user forking launch
- HIP-7 Active Inference v1

### 2025 Q2
- HIP-8: Decentralized training
- HIP-9: Model marketplace
- HLLM-32B release

### 2025 Q3
- HIP-10: Cross-chain models
- HLLM-175B beta
- IEEE 2874 full compliance

### 2025 Q4
- HLLM-1T collective intelligence
- Full DAO governance
- Mainnet stability

## Debugging Notes

### Common Issues
1. **PQC Compilation**: Ensure liboqs v0.11+ installed
2. **Model Loading**: Check VRAM requirements
3. **Consensus Sync**: Verify GPU attestation
4. **Training Ledger**: Confirm on-chain capacity

### Testing Commands
```bash
# Validate proposal format
make validate-hip HIP=hip-X

# Check references
make check-links

# Run CI locally
act -j validate

# Test implementation
cargo test --package hanzo-pqc
```

## Contact & Resources

### Official Channels
- GitHub: github.com/hanzoai/HIPs
- Website: hanzo.ai
- Docs: docs.hanzo.ai
- Discord: discord.gg/hanzoai

### Related Repos
- hanzo-node: Blockchain implementation
- hanzo-pqc: Quantum cryptography
- agent: AI agent SDK
- mcp: Model Context Protocol tools

## Recent Updates

### January 2025
- **ZIP-3 Enhanced**: Comprehensive z-JEPA technical specification added
  - Full academic paper integration with 31 references
  - BitDelta personalization for 10× memory savings
  - Expected Free Energy (EFE) planning formulation
  - Real-time performance targets (150ms audio, 20ms motion-to-photon)
  - CC BY 4.0 licensing from Zoo Labs Foundation Inc. (501(c)(3))

---

*Last Updated: January 2025*
*Maintained for AI assistant continuity across sessions*