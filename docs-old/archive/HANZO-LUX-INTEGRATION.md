# Hanzo-Lux Integration Architecture

## Overview

Hanzo AI operates as an L2 on Lux Network (live) with sovereign L1 upgrade path. This document defines the complete integration architecture.

## Integration Points

### 1. Blockchain Infrastructure

**Hanzo runs on Lux Network:**
- **Current**: L2 EVM chain on Lux (Live)
- **Next**: HMM chain + Sovereign L1 upgrade
- **Consensus**: Proof of Compute (PoC) + Quasar photonic selection

### 2. Shared Services

| Service | Lux Component | HIP Standard | Purpose |
|---------|--------------|--------------|---------|
| **Wallet** | lux/safe | HIP-21 | Multi-signature wallet for $AI |
| **Exchange** | lux.exchange | HIP-22 | Trading $AI tokens |
| **Bridge** | lux/bridge | HIP-23 | Cross-chain asset transfers |
| **Identity** | lux/id | HIP-24 | Unified authentication |
| **Consensus** | lux/consensus | HIP-25 | Quasar quantum-safe consensus |

### 3. Token Economy

**$AI Token on Lux:**
- Trading: [lux.exchange/trade/AI](https://lux.exchange/trade/AI)
- Contract: Deployed on Lux Network
- Bridge: Cross-chain via Lux Bridge (HIP-23)

### 4. Network Configuration

```yaml
Lux MainNet:
  ChainID: 6887
  RPC: https://api.lux.network
  WS: wss://ws.lux.network
  Explorer: https://explorer.lux.network

Lux TestNet:
  ChainID: 6888
  RPC: https://testnet.lux.network
  WS: wss://testnet-ws.lux.network
  Explorer: https://testnet-explorer.lux.network
```

## Architecture Layers

```
┌─────────────────────────────────────────┐
│         HANZO AI APPLICATIONS           │
│  Chat, Search, Agents, Flow, Platform   │
└─────────────────────────────────────────┘
                    │
┌─────────────────────────────────────────┐
│      HANZO AI INFRASTRUCTURE            │
│  LLM Gateway, Jin, HLLMs, MCP, Agent SDK│
└─────────────────────────────────────────┘
                    │
┌─────────────────────────────────────────┐
│         HANZO BLOCKCHAIN (L2)           │
│  $AI Token, HMM DEX, PoC Consensus      │
└─────────────────────────────────────────┘
                    │
┌─────────────────────────────────────────┐
│      LUX NETWORK INFRASTRUCTURE         │
│  Node, Bridge, Safe, Exchange, ID       │
│  Quasar Consensus, Post-Quantum Security│
└─────────────────────────────────────────┘
```

## Key Integrations

### 1. Authentication Flow
```
User → Lux ID (HIP-24) → SSO → Hanzo Services
```

### 2. Trading Flow
```
User → lux.exchange (HIP-22) → $AI/USDT → HMM DEX (HIP-8)
```

### 3. Bridge Flow
```
Ethereum → Lux Bridge (HIP-23) → Lux Network → $AI Token
```

### 4. Wallet Flow
```
User → Lux Safe (HIP-21) → Multi-sig → $AI Transactions
```

### 5. Consensus Flow
```
Validators → Quasar (HIP-25) → Photonic Selection → Block Production
```

## Development Setup

### Running Hanzo on Lux

1. **Configure Network:**
```bash
export LUX_RPC_URL=https://api.lux.network
export LUX_CHAIN_ID=6887
export HANZO_L2_ADDRESS=0x... # Hanzo L2 contract
```

2. **Deploy $AI Token:**
```bash
cd /Users/z/work/hanzo/contracts
npm run deploy:lux
```

3. **Start Services:**
```bash
# LLM Gateway
cd /Users/z/work/hanzo/llm
docker compose up

# Chat Interface
cd /Users/z/work/hanzo/chat
npm run dev

# Agent SDK
cd /Users/z/work/hanzo/agent
uv run start
```

### Using Lux Services

1. **Lux Exchange:**
```typescript
import { LuxExchange } from '@luxfi/exchange-sdk';

const exchange = new LuxExchange();
await exchange.trade({
  pair: "AI/USDT",
  side: "buy",
  amount: "1000"
});
```

2. **Lux Safe:**
```typescript
import { LuxSafe } from '@luxfi/safe-sdk';

const safe = new LuxSafe();
await safe.createWallet({
  owners: [address1, address2],
  threshold: 2
});
```

3. **Lux Bridge:**
```typescript
import { LuxBridge } from '@luxfi/bridge-sdk';

const bridge = new LuxBridge();
await bridge.transfer({
  from: "ethereum",
  to: "lux",
  asset: "AI",
  amount: "1000"
});
```

## Security Considerations

### Post-Quantum Security
- All cryptography uses NIST-approved algorithms (HIP-5)
- Quasar consensus provides quantum-safe block production (HIP-25)
- Q-Chain rollups protect transaction privacy

### Multi-Signature Protection
- Treasury managed by Lux Safe (HIP-21)
- Critical operations require multi-sig approval
- Time-locks on large transfers

## Roadmap

### Q1 2025
- ✅ L2 deployment on Lux (Live)
- $AI token launch on lux.exchange
- Lux Safe integration for treasury
- Lux ID SSO deployment

### Q2 2025
- HMM chain launch
- Sovereign L1 upgrade
- Full Quasar consensus activation
- Bridge to Ethereum/BSC

### Q3 2025
- Cross-chain AI compute marketplace
- Unified wallet experience
- Advanced trading features
- Enterprise SSO integration

### Q4 2025
- Full decentralization
- DAO governance via Lux
- Global compute network
- Institutional adoption

## Resources

### Hanzo
- GitHub: [github.com/hanzoai](https://github.com/hanzoai)
- Docs: [docs.hanzo.ai](https://docs.hanzo.ai)
- HIPs: [github.com/hanzoai/HIPs](https://github.com/hanzoai/HIPs)

### Lux
- GitHub: [github.com/luxfi](https://github.com/luxfi)
- Exchange: [lux.exchange](https://lux.exchange)
- Explorer: [explorer.lux.network](https://explorer.lux.network)
- Bridge: [bridge.lux.network](https://bridge.lux.network)

## Contact

- Discord: [discord.gg/hanzoai](https://discord.gg/hanzoai)
- Twitter: [@hanzoai](https://twitter.com/hanzoai)
- Email: dev@hanzo.ai

---

*Building the future of AI on Lux Network's quantum-safe blockchain infrastructure.*