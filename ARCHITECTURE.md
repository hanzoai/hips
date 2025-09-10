# Hanzo AI - Comprehensive Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         HANZO AI ECOSYSTEM                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   HMM DEX    │  │  $AI Token   │  │   Q-Chain    │          │
│  │  (HIP-8)     │  │   (HIP-1)    │  │   Rollups    │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│         │                 │                   │                  │
│  ┌──────────────────────────────────────────────────────┐       │
│  │              BLOCKCHAIN LAYER (L2 → L1)               │       │
│  │                                                       │       │
│  │  Current: L2 EVM on Lux Network (Live)               │       │
│  │  Next: HMM Chain + Sovereign L1 Upgrade              │       │
│  │  Consensus: Proof of Compute + Quasar (HIP-25)       │       │
│  └──────────────────────────────────────────────────────┘       │
│                             │                                    │
│  ┌──────────────────────────────────────────────────────┐       │
│  │              LUX INFRASTRUCTURE LAYER                 │       │
│  ├──────────────────────────────────────────────────────┤       │
│  │                                                       │       │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │       │
│  │  │  Lux Safe   │  │Lux Exchange │  │ Lux Bridge  │ │       │
│  │  │  (HIP-21)   │  │  (HIP-22)   │  │  (HIP-23)   │ │       │
│  │  │             │  │             │  │             │ │       │
│  │  │  Multi-Sig  │  │ $AI Trading │  │Cross-Chain  │ │       │
│  │  └─────────────┘  └─────────────┘  └─────────────┘ │       │
│  │                                                       │       │
│  │  ┌─────────────┐  ┌─────────────┐                   │       │
│  │  │   Lux ID    │  │Lux Consensus│                   │       │
│  │  │  (HIP-24)   │  │  (HIP-25)   │                   │       │
│  │  │             │  │             │                   │       │
│  │  │Identity/SSO │  │   Quasar    │                   │       │
│  │  └─────────────┘  └─────────────┘                   │       │
│  └──────────────────────────────────────────────────────┘       │
│                             │                                    │
│  ┌──────────────────────────────────────────────────────┐       │
│  │                  AI INFRASTRUCTURE                    │       │
│  ├──────────────────────────────────────────────────────┤       │
│  │                                                       │       │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │       │
│  │  │ LLM Gateway │  │     Jin     │  │    HLLMs    │ │       │
│  │  │   (HIP-4)   │  │   (HIP-3)   │  │   (HIP-2)   │ │       │
│  │  │             │  │             │  │             │ │       │
│  │  │ 100+ Models │  │ Multimodal  │  │ Hamiltonian │ │       │
│  │  │   :4000     │  │  1B - 1T+   │  │   Dynamics  │ │       │
│  │  └─────────────┘  └─────────────┘  └─────────────┘ │       │
│  │                                                       │       │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │       │
│  │  │  Agent SDK  │  │     MCP     │  │   Active    │ │       │
│  │  │   (HIP-9)   │  │  (HIP-10)   │  │  Inference  │ │       │
│  │  │             │  │             │  │   (HIP-7)   │ │       │
│  │  │Multi-Agent  │  │Tool Protocol│  │     EFE     │ │       │
│  │  └─────────────┘  └─────────────┘  └─────────────┘ │       │
│  └──────────────────────────────────────────────────────┘       │
│                             │                                    │
│  ┌──────────────────────────────────────────────────────┐       │
│  │                   APPLICATIONS                        │       │
│  ├──────────────────────────────────────────────────────┤       │
│  │                                                       │       │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐│       │
│  │  │  Chat   │  │ Search  │  │  Flow   │  │Platform ││       │
│  │  │  :3081  │  │  :3000  │  │Workflow │  │  PaaS   ││       │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘│       │
│  │                                                       │       │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐│       │
│  │  │   Az2   │  │Operative│  │Analytics│  │  Pay    ││       │
│  │  │ Finance │  │Computer │  │ Metrics │  │  :4242  ││       │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘│       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Layer Architecture

### 1. Blockchain Layer (Foundation)

**Current Status**: L2 EVM chain on Lux Network (Live)  
**Next Phase**: HMM chain launch → Sovereign L1 upgrade

#### Components:
- **Consensus**: Proof of Compute (PoC) - miners provide GPU/TPU resources
- **Token**: $AI native currency for compute, training, governance
- **DEX**: HMM (Hanzo Market Maker) for AI compute resource trading
- **Security**: Q-Chain quantum rollups via Lux Network

#### Key Features:
```yaml
Block Time: 2 seconds
Finality: Instant (single-slot)
Validators: Compute providers with GPU resources
Native Token: $AI
Total Supply: 1,000,000,000 $AI
Exchange: lux.exchange/trade/AI
```

### 2. AI Infrastructure Layer (Core)

#### Foundational Models

##### Jin (HIP-3)
- **Purpose**: Unified multimodal AI (text/vision/audio/3D)
- **Architecture**: Joint embedding spaces with MoE
- **Variants**: nano (1B) → ultra (1T+)
- **Repository**: [github.com/hanzoai/jin](https://github.com/hanzoai/jin)

##### HLLMs (HIP-2)
- **Purpose**: Hamiltonian Large Language Models
- **Architecture**: Energy-conserving dynamics
- **Feature**: Per-user fine-tuning with personal forks
- **Variants**: 7B, 32B, 175B, 1T

##### LLM Gateway (HIP-4)
- **Purpose**: Unified proxy for 100+ AI providers
- **Port**: 4000
- **Features**: Cost optimization, routing, caching
- **Repository**: [github.com/hanzoai/llm](https://github.com/hanzoai/llm)

#### Orchestration & Tools

##### Agent SDK (HIP-9)
- **Purpose**: Multi-agent orchestration framework
- **Features**: P2P networking, shared state, tool use
- **Repository**: [github.com/hanzoai/agent](https://github.com/hanzoai/agent)

##### MCP (HIP-10)
- **Purpose**: Model Context Protocol for tool integration
- **Features**: Standardized tool interface, sandboxing
- **Repository**: [github.com/hanzoai/mcp](https://github.com/hanzoai/mcp)

##### Active Inference (HIP-7)
- **Purpose**: Principled decision-making via EFE
- **Features**: Explainable AI, IEEE 2874 compliance

### 3. Application Layer (User-Facing)

#### Core Applications

##### Chat Platform
- **Port**: 3081
- **Base**: LibreChat fork
- **Features**: 100+ models, MCP integration
- **Repository**: [github.com/hanzoai/chat](https://github.com/hanzoai/chat)

##### Search Engine
- **Port**: 3000
- **Tech**: Next.js, Supabase
- **Features**: AI-powered search, generative UI
- **Repository**: [github.com/hanzoai/search](https://github.com/hanzoai/search)

##### Flow
- **Purpose**: Visual workflow builder
- **Features**: Multi-agent orchestration
- **Repository**: [github.com/hanzoai/flow](https://github.com/hanzoai/flow)

##### Platform
- **Purpose**: PaaS alternative to Vercel/Heroku
- **Features**: App deployment, scaling
- **Repository**: [github.com/hanzoai/platform](https://github.com/hanzoai/platform)

#### Specialized Applications

##### Az2
- **Purpose**: Financial document processing
- **Tech**: FastAPI, React
- **Ports**: 8000 (API), 5173 (UI)

##### Operative
- **Purpose**: Computer use for Claude
- **Features**: Screen control, automation

##### Analytics
- **Purpose**: Metrics and monitoring
- **Features**: Event tracking, insights

##### Pay
- **Port**: 4242
- **Purpose**: Payment processing

## Technology Stack

### Programming Languages
```yaml
Primary:
  - Python: AI/ML models, backends (FastAPI)
  - TypeScript: Web apps, SDKs
  - Go: Blockchain, infrastructure
  - Rust: High-performance AI (Jin, Candle)

Secondary:
  - Solidity: Smart contracts
  - JavaScript: Frontend apps
```

### Frameworks & Libraries
```yaml
AI/ML:
  - PyTorch: Model training
  - Transformers: NLP models
  - LangChain: Agent orchestration
  - Candle: Rust ML framework

Web:
  - Next.js 14+: Web applications
  - React 18+: UI components
  - Tailwind CSS: Styling
  - Radix UI: Component library

Backend:
  - FastAPI: Python APIs
  - Express: Node.js APIs
  - Gin: Go APIs

Blockchain:
  - ethers.js: Ethereum interaction
  - wagmi: React hooks for Ethereum
  - viem: TypeScript Ethereum library
```

### Infrastructure
```yaml
Containers:
  - Docker: Containerization
  - Kubernetes: Orchestration
  - Docker Compose: Local development

Databases:
  - PostgreSQL: Primary database
  - Redis: Caching, queues
  - MongoDB: Document storage
  - MinIO: S3-compatible storage

Monitoring:
  - Prometheus: Metrics
  - Grafana: Visualization
  - OpenTelemetry: Tracing
```

## Deployment Architecture

### Development Environment
```bash
# Local development with Docker Compose
docker compose -f compose.dev.yml up

# Services available at:
- http://localhost:3000  # Search
- http://localhost:3081  # Chat
- http://localhost:4000  # LLM Gateway
- http://localhost:8000  # API
```

### Production Environment
```yaml
Cloud Providers:
  - AWS: Primary infrastructure
  - GCP: AI/ML workloads
  - Cloudflare: CDN, edge compute

Scaling:
  - Horizontal: Kubernetes auto-scaling
  - Vertical: GPU instance scaling
  - Edge: Cloudflare Workers

Security:
  - TLS: All connections encrypted
  - KMS: Key management
  - WAF: Web application firewall
  - DDoS: Cloudflare protection
```

## Data Flow

### AI Request Flow
```
User Request → Application Layer
     ↓
Chat/Search/Agent Interface
     ↓
LLM Gateway (routing, caching)
     ↓
Provider Selection (cost/performance)
     ↓
Model Execution (Jin/HLLM/External)
     ↓
Response Processing
     ↓
User Response
```

### Blockchain Transaction Flow
```
User Transaction → $AI Token Contract
     ↓
HMM DEX (if compute trading)
     ↓
Proof of Compute Validation
     ↓
Block Production (2s)
     ↓
Instant Finality
     ↓
State Update
```

## Security Architecture

### Post-Quantum Security (HIP-5)
- **Algorithms**: ML-KEM-768, ML-DSA-65
- **Implementation**: liboqs v0.11
- **Coverage**: All layers via Q-Chain

### Access Control
```yaml
Authentication:
  - API Keys: Service authentication
  - JWT: User sessions
  - OAuth2: Third-party integration

Authorization:
  - RBAC: Role-based access
  - Permissions: Fine-grained control
  - Audit: Complete logging
```

## Integration Points

### External Services
```yaml
AI Providers:
  - OpenAI: GPT-4, DALL-E
  - Anthropic: Claude 3.5
  - Google: Gemini
  - Together AI: Open models
  - Replicate: Model hosting

Blockchain:
  - Lux Network: L2 hosting
  - Ethereum: Bridge connections
  - IPFS: Decentralized storage
```

### SDKs and APIs
```yaml
SDKs:
  - Python: hanzoai, hanzoai-agent
  - TypeScript: @hanzoai/sdk, @hanzoai/agent
  - Go: github.com/hanzoai/go-sdk

APIs:
  - REST: OpenAPI 3.0 spec
  - GraphQL: For complex queries
  - WebSocket: Real-time updates
  - JSON-RPC: MCP protocol
```

## Performance Specifications

### AI Performance
```yaml
Inference:
  - Latency: <100ms first token
  - Throughput: >1000 tokens/sec
  - Concurrency: 10,000+ users

Training:
  - Batch Size: Up to 4096
  - Learning Rate: AdamW with cosine schedule
  - Distributed: Up to 1024 GPUs
```

### Blockchain Performance
```yaml
Consensus:
  - Block Time: 2 seconds
  - TPS: 10,000+
  - Finality: Instant

Network:
  - Nodes: 100+ validators
  - Uptime: 99.99% SLA
  - Latency: <500ms global
```

## Roadmap Integration

### Q1 2025
- HMM DEX launch
- $AI token on lux.exchange
- Jin-nano release
- Core MCP tools

### Q2 2025
- Sovereign L1 upgrade
- Jin-base (32B)
- Agent marketplace
- Full MCP integration

### Q3 2025
- Jin-large (175B)
- Advanced orchestration
- Cross-chain bridges
- Enterprise features

### Q4 2025
- Jin-ultra (1T+)
- Full DAO governance
- Global compute marketplace
- AGI research initiatives

## Repository Structure

```
hanzoai/
├── HIPs/           # Hanzo Improvement Proposals
├── llm/            # LLM Gateway
├── jin/            # Multimodal AI models
├── agent/          # Agent SDK
├── mcp/            # Model Context Protocol
├── chat/           # Chat platform
├── search/         # Search engine
├── flow/           # Workflow builder
├── platform/       # PaaS infrastructure
├── node/           # Blockchain node
├── contracts/      # Smart contracts
└── docs/           # Documentation
```

## Contact & Resources

- **Website**: [hanzo.ai](https://hanzo.ai) / [hanzo.network](https://hanzo.network)
- **GitHub**: [github.com/hanzoai](https://github.com/hanzoai)
- **Documentation**: [docs.hanzo.ai](https://docs.hanzo.ai)
- **Discord**: [discord.gg/hanzoai](https://discord.gg/hanzoai)
- **$AI Trading**: [lux.exchange/trade/AI](https://lux.exchange/trade/AI)

---

*Building the future of AI infrastructure through decentralized compute and multimodal intelligence.*