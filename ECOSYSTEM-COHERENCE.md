# Ecosystem Coherence: Hanzo, Lux, Zoo

## Overview

Three interconnected ecosystems with clear separation of concerns:

```
┌──────────────────────────────────────────────┐
│                    ZOO                        │
│         Gaming, NFTs, DeFi, Metaverse         │
│            github.com/zooai/zips              │
└──────────────────────────────────────────────┘
                      ↓
┌──────────────────────────────────────────────┐
│                   HANZO                       │
│      AI Infrastructure & Foundational Models  │
│           github.com/hanzoai/hips             │
└──────────────────────────────────────────────┘
                      ↓
┌──────────────────────────────────────────────┐
│                    LUX                        │
│        Blockchain Infrastructure Layer        │
│            github.com/luxfi/lps               │
└──────────────────────────────────────────────┘
```

## Repository Structure

### 1. Hanzo (HIPs - Hanzo Improvement Proposals)
**Focus**: AI Infrastructure  
**Repository**: [github.com/hanzoai/hips](https://github.com/hanzoai/hips)

**Core Components**:
- HIP-1: $AI Token
- HIP-2: HLLMs (Hamiltonian Large Language Models)
- HIP-3: Jin (Multimodal AI)
- HIP-4: LLM Gateway
- HIP-8: HMM DEX
- HIP-9: Agent SDK
- HIP-10: MCP (Model Context Protocol)

**Key Products**:
- Chat (port 3081)
- Search (port 3000)
- LLM Gateway (port 4000)
- Agent Framework
- Flow (workflow builder)

### 2. Lux (LPs - Lux Proposals)
**Focus**: Blockchain Infrastructure  
**Repository**: [github.com/luxfi/lps](https://github.com/luxfi/lps)

**Core Components**:
- Blockchain Node
- Consensus (Quasar)
- Bridge (MPC cross-chain)
- Safe (Multi-sig wallet)
- Exchange (lux.exchange)
- Identity (SSO/Auth)

**Network Info**:
- MainNet ChainID: 6887
- TestNet ChainID: 6888
- RPC: https://api.lux.network

### 3. Zoo (ZIPs - Zoo Improvement Proposals)
**Focus**: Web3 Gaming & Entertainment  
**Repository**: [github.com/zooai/zips](https://github.com/zooai/zips)

**Core Components**:
- ZIP-1: ZOO Token
- ZIP-2: DEX Integration
- ZIP-3: z-JEPA AI Architecture (Eco-1)
- NFT Marketplace
- Gaming Infrastructure
- DeFi Protocols

## Integration Points

### Hanzo ↔ Lux
```yaml
Blockchain:
  - Hanzo runs as L2 on Lux Network (current)
  - Sovereign L1 upgrade path (next)
  - Shared consensus mechanisms

Token:
  - $AI trades on lux.exchange
  - Cross-chain via Lux Bridge
  - Multi-sig via Lux Safe

Infrastructure:
  - Identity/SSO via Lux ID
  - Node infrastructure shared
  - Quantum security via Q-Chain
```

### Hanzo ↔ Zoo
```yaml
AI Models:
  - Zoo uses Hanzo's HLLMs
  - z-JEPA (ZIP-3) integrates with Jin (HIP-3)
  - Shared Agent SDK (HIP-9)

Gaming:
  - Zoo games use Hanzo AI
  - NFTs integrate with AI generation
  - DeFi uses AI for optimization
```

### Lux ↔ Zoo
```yaml
Blockchain:
  - Zoo can deploy on Lux chains
  - Bridge for asset transfers
  - Shared wallet infrastructure
```

## Token Economy

### Native Tokens
1. **$AI** (Hanzo) - AI compute and services
2. **$LUX** (Lux) - Network gas and staking
3. **$ZOO** (Zoo) - Gaming and NFTs

### Cross-Ecosystem Usage
- $AI for AI services across all platforms
- $LUX for transaction fees
- $ZOO for gaming/NFT purchases
- All tradeable on lux.exchange

## Development Standards

### API Compatibility
All ecosystems use:
- OpenAPI 3.0 for REST APIs
- JSON-RPC for blockchain
- WebSocket for real-time
- SSE for streaming

### Smart Contract Standards
- ERC-20 compatible tokens
- ERC-721/1155 for NFTs
- OpenZeppelin libraries
- Upgradeable proxies

### Infrastructure
- Docker/Kubernetes deployment
- PostgreSQL + Redis standard
- Prometheus/Grafana monitoring
- GitHub Actions CI/CD

## Governance

### Proposal Systems
- **HIPs**: AI and infrastructure changes
- **LPs**: Blockchain protocol changes
- **ZIPs**: Gaming and ecosystem changes

### Decision Making
- Each ecosystem has independent governance
- Cross-ecosystem changes require coordination
- Community voting on major decisions

## Security Standards

### Shared Security
- Post-quantum cryptography (Lux)
- Multi-sig wallets (Lux Safe)
- Audit requirements for contracts
- Bug bounty programs

### Authentication
- Unified SSO via Lux ID
- Wallet-based authentication
- OAuth2/OIDC support

## Development Setup

### Combined Development
```bash
# Clone all repos
git clone https://github.com/hanzoai/hips
git clone https://github.com/luxfi/lps
git clone https://github.com/zooai/zips

# Start Lux node
cd lux/node
make dev

# Start Hanzo services
cd hanzo/llm
docker compose up

# Start Zoo app
cd zoo/app
npm run dev
```

### Environment Variables
```bash
# Shared across ecosystems
LUX_RPC_URL=https://api.lux.network
LUX_CHAIN_ID=6887

# Hanzo specific
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Zoo specific
ZOO_CONTRACT_ADDRESS=0x...
NFT_MARKETPLACE_URL=https://zoo.market
```

## Roadmap Alignment

### Q1 2025
- Hanzo: L2 live on Lux, $AI token launch
- Lux: Mainnet stable, exchange operational
- Zoo: z-JEPA integration, NFT marketplace v2

### Q2 2025
- Hanzo: Sovereign L1 upgrade, HMM DEX
- Lux: Cross-chain bridges live
- Zoo: Gaming platform launch

### Q3 2025
- Hanzo: Jin multimodal release
- Lux: Institutional features
- Zoo: Metaverse alpha

### Q4 2025
- Full ecosystem integration
- DAO governance activation
- Global adoption push

## Resources

### Documentation
- Hanzo: [docs.hanzo.ai](https://docs.hanzo.ai)
- Lux: [docs.lux.network](https://docs.lux.network)
- Zoo: [docs.zoo.game](https://docs.zoo.game)

### GitHub Organizations
- [github.com/hanzoai](https://github.com/hanzoai)
- [github.com/luxfi](https://github.com/luxfi)
- [github.com/zooai](https://github.com/zooai)

### Community
- Discord: Shared community server
- Twitter: @hanzoai, @luxnetwork, @zoogame
- Telegram: Ecosystem-specific channels

## Conclusion

The three ecosystems are:
1. **Orthogonal**: Each does ONE thing well
2. **Composable**: Clean interfaces between systems
3. **Coherent**: Shared standards and infrastructure

This separation allows each ecosystem to evolve independently while maintaining interoperability through well-defined interfaces and standards.