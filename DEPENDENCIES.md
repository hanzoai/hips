# HIP Dependency Graph

## Composable Architecture

Each HIP does exactly ONE thing. They compose orthogonally:

```
Foundation Layer (Blockchain & Token)
├── HIP-0: Architecture (Meta)
├── HIP-1: $AI Token
├── HIP-8: HMM DEX
└── HIP-20: Blockchain Node

External Dependencies (Lux Network)
├── Multi-Sig Wallet → github.com/luxfi/safe
├── Exchange Trading → lux.exchange
├── Cross-Chain Bridge → github.com/luxfi/bridge
├── Identity/SSO → github.com/luxfi/id
└── Consensus → github.com/luxfi/consensus
    
AI Models Layer
├── HIP-2: HLLMs (Hamiltonian Models)
├── HIP-3: Jin (Multimodal Models)
├── HIP-6: Per-User Fine-Tuning
└── HIP-7: Active Inference

Infrastructure Layer  
├── HIP-4: LLM Gateway (routes to all models)
├── HIP-5: Post-Quantum Security
├── HIP-19: Tensor Operations (Rust ML)
└── HIP-14: Application Deployment

Agent Layer
├── HIP-9: Agent SDK
├── HIP-10: MCP Tool Protocol
├── HIP-13: Workflow Execution
└── HIP-15: Computer Control

Interface Layer
├── HIP-11: Chat Interface
├── HIP-12: Search Interface
├── HIP-16: Document Processing
├── HIP-17: Analytics Events
└── HIP-18: Payment Processing
```

## Dependency Rules

### Core Dependencies
```
HIP-4 (LLM Gateway) ← Used by ALL AI interfaces
HIP-1 ($AI Token) ← Required for ALL payments
HIP-9 (Agent SDK) ← Required for ALL agent features
```

### Composition Examples

#### Chat with AI
```
User → HIP-11 (Chat) → HIP-4 (Gateway) → Model
```

#### Agent Workflow
```
User → HIP-13 (Workflow) → HIP-9 (Agent) → HIP-10 (MCP Tools)
```

#### AI Compute Trading
```
$AI (HIP-1) → HMM DEX (HIP-8) → Node (HIP-20) → Compute
```

#### Document Processing
```
Document → HIP-16 (Process) → HIP-4 (Gateway) → AI Model
```

## Orthogonality Principles

1. **Single Responsibility**: Each HIP does ONE thing
2. **No Duplication**: Only ONE way to do each thing
3. **Clean Interfaces**: HIPs connect via simple APIs
4. **Explicit Dependencies**: Each HIP lists what it requires
5. **Composable**: HIPs combine to create complex systems

## Interface Standards

### All HTTP APIs use:
- REST with JSON
- OpenAPI 3.0 spec
- Standard error codes

### All Streaming uses:
- Server-Sent Events (SSE)
- WebSocket for bidirectional

### All Blockchain uses:
- Ethereum-compatible RPC
- EIP standards where applicable

### All AI Models use:
- OpenAI-compatible format via HIP-4
- Never direct provider access

## Adding New HIPs

New HIPs MUST:
1. Do exactly ONE thing
2. Not duplicate existing functionality
3. Explicitly list dependencies
4. Follow interface standards
5. Be composable with existing HIPs

## Example: Building a Complete Application

To build an AI chat application with payments:

```
Required HIPs:
- HIP-11: Chat Interface (UI)
- HIP-4: LLM Gateway (Model access)
- HIP-18: Payment Processing (Subscriptions)
- HIP-1: $AI Token (Payment currency)
- HIP-17: Analytics (Usage tracking)

Composition:
Chat UI (11) → Gateway (4) → Models
     ↓
Analytics (17)
     ↓
Payments (18) → $AI (1)
```

Each component does ONE thing, combines cleanly.