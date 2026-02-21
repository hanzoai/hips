---
hip: 0025
title: Bot Agent Wallet & RPC Billing Protocol
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-02-14
requires: HIP-1, HIP-18, HIP-24, HIP-101
---

# HIP-25: Bot Agent Wallet & RPC Billing Protocol

## Abstract

This proposal defines the protocol for provisioning on-chain identities and wallets for AI bot agents on the Hanzo Network (chain ID 36963). Every bot agent gets a W3C Decentralized Identifier (DID) and a Safe smart-contract wallet capable of receiving payments, charging for RPC/API usage, and participating in cross-chain commerce via the Lux Bridge (HIP-101).

## Motivation

AI agents are becoming economic actors. They need:

1. **On-chain identity**: A verifiable, self-sovereign identity (W3C DID) that persists across platforms and contexts
2. **Programmable wallets**: Safe smart-contract wallets that can hold funds, pay for compute, and receive revenue
3. **Metered RPC billing**: An open protocol for agents to charge consumers for API/RPC calls with transparent, on-chain settlement
4. **Cross-chain universality**: Accept payments from any EVM chain via Lux Bridge, settle on Hanzo Network

Current bot platforms treat agents as stateless functions with no financial agency. HIP-25 makes agents first-class economic participants.

## Specification

### 1. Agent DID (Decentralized Identifier)

Every bot agent MUST have a W3C DID anchored to the Hanzo Network.

#### DID Format

```
did:hanzo:<agent-identifier>
```

Where `<agent-identifier>` is derived from the agent's EOA address or a human-readable ID.

#### Supported DID Methods

| Method | Chain | Chain ID | Example |
|--------|-------|----------|---------|
| `did:hanzo` | Hanzo Network | 36963 | `did:hanzo:dev` |
| `did:lux` | Lux Mainnet | 96369 | `did:lux:dev` |
| `did:pars` | Pars Network | 494949 | `did:pars:dev` |
| `did:zoo` | Zoo Network | 200200 | `did:zoo:dev` |
| `did:ai` | Hanzo (alias) | 36963 | `did:ai:dev` |

#### DID Document Structure

```json
{
  "@context": ["https://www.w3.org/ns/did/v1", "https://hanzo.ai/ns/agent/v1"],
  "id": "did:hanzo:dev",
  "controller": "did:hanzo:workspace-owner",
  "verificationMethod": [{
    "id": "did:hanzo:dev#keys-1",
    "type": "EcdsaSecp256k1VerificationKey2019",
    "controller": "did:hanzo:dev",
    "blockchainAccountId": "eip155:36963:0x..."
  }],
  "service": [{
    "id": "did:hanzo:dev#rpc",
    "type": "AgentRPCService",
    "serviceEndpoint": "https://bot.hanzo.ai/rpc/dev"
  }, {
    "id": "did:hanzo:dev#wallet",
    "type": "SafeWallet",
    "serviceEndpoint": "safe:36963:0x..."
  }]
}
```

#### Omnichain Identity

Agents have omnichain identity resolution. A single agent maps across all Hanzo ecosystem chains:

```
did:hanzo:dev  ←→  did:lux:dev  ←→  did:zoo:dev  ←→  did:pars:dev
```

All resolve to the same underlying verification key, enabling cross-chain verification.

### 2. Agent Wallet Architecture

Every bot agent MUST have an on-chain wallet on the Hanzo Network.

#### Wallet Structure

```
Workspace HD Seed (BIP-39 mnemonic)
  └─ m/44'/60'/0'/0/<agent-index>  →  Agent EOA (Externally Owned Account)
       └─ Safe Smart Contract Wallet (multisig-capable)
            ├─ Owner 1: Agent EOA (auto-signer)
            ├─ Owner 2: Workspace owner EOA
            └─ Owner N: Additional signers (optional)
```

#### Derivation

| Component | Specification |
|-----------|--------------|
| Mnemonic | BIP-39, 24 words, per-workspace |
| Derivation | BIP-32/44, path `m/44'/60'/0'/0/<index>` |
| EOA | secp256k1 keypair → Ethereum-compatible address |
| Safe | Gnosis Safe v1.4.1, deployed on Hanzo Network |
| Threshold | Default 1-of-2 (agent + workspace owner) |

#### Wallet Configuration

```typescript
interface AgentWalletConfig {
  /** EOA address derived for this agent (hex) */
  address?: string;
  /** Safe contract address (multisig) on target chain */
  safeAddress?: string;
  /** Chain the Safe is deployed on */
  chain: "lux" | "hanzo" | "zoo" | "pars";
  /** Chain ID */
  chainId: number;
  /** HD derivation path used for the EOA */
  derivationPath: string;
}
```

#### Cross-Chain Payments via Lux Bridge

Bot wallets accept payments from any EVM chain through the Lux Bridge (HIP-101):

```
User on Ethereum  ─→  Lux Bridge (LP-226)  ─→  Bot Safe on Hanzo Network
User on Polygon   ─→  Lux Bridge (LP-226)  ─→  Bot Safe on Hanzo Network
User on Lux       ─→  Direct transfer       ─→  Bot Safe on Hanzo Network
```

Accepted tokens:
- **AI** (native, HIP-1)
- **USDC** (bridged)
- **LUX** (bridged from Lux mainnet)
- Any ERC-20 via bridge

### 3. RPC Billing Protocol

Agents MAY charge for RPC/API calls. This section defines the open protocol for metered billing.

#### Billing Model

```
Consumer  ──RPC Request──→  Agent Gateway  ──Metering──→  Settlement
                                  │
                                  ├─ Rate check (per-method pricing)
                                  ├─ Balance check (prepaid or postpaid)
                                  ├─ Execute request
                                  ├─ Meter usage
                                  └─ Settle (periodic on-chain batch)
```

#### Rate Schedule

Agents publish a rate schedule as part of their DID Document service endpoint:

```json
{
  "id": "did:hanzo:dev#billing",
  "type": "AgentBillingSchedule",
  "serviceEndpoint": "https://bot.hanzo.ai/billing/dev",
  "rates": {
    "chat.send": { "unit": "per_request", "price": "0.001", "currency": "AI" },
    "agent": { "unit": "per_token", "price": "0.00001", "currency": "AI" },
    "agent.wait": { "unit": "per_request", "price": "0.01", "currency": "AI" },
    "browser.request": { "unit": "per_request", "price": "0.005", "currency": "AI" }
  },
  "settlement": {
    "method": "batch",
    "interval": "1h",
    "minAmount": "0.1",
    "chain": "hanzo",
    "chainId": 36963,
    "recipient": "safe:36963:0x..."
  }
}
```

#### Billing API

```yaml
# Check agent billing rates
GET /rpc/:agentId/billing
  Response: AgentBillingSchedule

# Prepay credits to an agent
POST /rpc/:agentId/billing/prepay
  Body: { amount: string, currency: "AI" | "USDC", txHash?: string }
  Response: { balance: string, expiresAt: string }

# Check credit balance
GET /rpc/:agentId/billing/balance
  Headers: { Authorization: "Bearer <consumer-token>" }
  Response: { balance: string, used: string, remaining: string }

# Get usage report
GET /rpc/:agentId/billing/usage
  Query: { from: ISO8601, to: ISO8601 }
  Response: { methods: Record<string, { count: number, cost: string }>, total: string }
```

#### Settlement Flow

1. **Metering**: Gateway tracks per-method usage per consumer
2. **Aggregation**: Usage aggregated per settlement interval (default 1h)
3. **Batch settlement**: Single on-chain transaction settles all pending charges
4. **Receipt**: Settlement receipt emitted as on-chain event

```solidity
event RPCSettlement(
    address indexed agent,
    address indexed consumer,
    uint256 amount,
    uint256 requestCount,
    uint256 periodStart,
    uint256 periodEnd
);
```

#### Free Tier

Agents MAY offer a free tier:

```json
{
  "freeTier": {
    "requestsPerDay": 100,
    "tokensPerDay": 10000,
    "methods": ["health", "agent.identity.get", "agent.did.get"]
  }
}
```

### 4. Gateway Methods

The bot gateway exposes the following methods for DID and wallet management:

#### Read Methods (operator.read scope)

| Method | Description |
|--------|-------------|
| `agent.did.get` | Get DID config for an agent |
| `agent.wallet.get` | Get wallet config for an agent |
| `agent.identity.full` | Get full identity (profile + DID + wallet) |

#### Admin Methods (operator.admin scope)

| Method | Description |
|--------|-------------|
| `agent.did.create` | Provision a DID for an agent |
| `agent.wallet.create` | Provision a Safe wallet for an agent |

### 5. Team Preset Integration

Default team bot presets (Vi, Dev, Des, Opera, Su, Mark, Fin, Art, Three, Fil) are auto-provisioned with:

- DID: `did:hanzo:<preset-id>` (e.g., `did:hanzo:dev`, `did:hanzo:vi`)
- Wallet: Safe on Hanzo Network (chain ID 36963)
- Default billing: Free tier (team-internal usage)

## Implementation

### Phase 1: DID + Wallet Config (Completed)

- [x] `DIDConfig` and `WalletConfig` types in `types.base.ts`
- [x] `IdentityConfig` extended with `did` and `wallet` fields
- [x] `TeamPreset` updated with `didMethod` and `walletChain`
- [x] Chain ID constants from `hanzo-did` Rust crate
- [x] Gateway handlers: `agent.did.get/create`, `agent.wallet.get/create`, `agent.identity.full`
- [x] Console tRPC endpoints for team presets and agent identity

### Phase 2: On-Chain Deployment (Planned)

- [ ] BIP-32/39 HD wallet derivation from workspace seed
- [ ] Safe smart-contract wallet deployment on Hanzo Network
- [ ] DID Document anchoring on-chain
- [ ] EOA address population in agent config
- [ ] Safe address population after deployment

### Phase 3: RPC Billing (Planned)

- [ ] Rate schedule publication via DID Document
- [ ] Metering middleware in bot gateway
- [ ] Prepaid credit system
- [ ] Batch on-chain settlement
- [ ] Usage reporting API
- [ ] Free tier enforcement

### Phase 4: Cross-Chain (Planned)

- [ ] Lux Bridge integration for cross-chain payments
- [ ] Multi-chain Safe deployment (Hanzo + Lux + Zoo)
- [ ] Omnichain DID resolution
- [ ] Universal payment acceptance

## Security Considerations

1. **Key Management**: Workspace HD seeds MUST be stored in KMS (HIP-5), never in plaintext
2. **Safe Threshold**: Production bots SHOULD use 2-of-3 multisig minimum
3. **Rate Limiting**: RPC billing MUST include rate limiting to prevent abuse
4. **DID Rotation**: Support key rotation without changing DID URI
5. **Bridge Security**: Cross-chain payments inherit Lux Bridge security guarantees (LP-226)
6. **Post-Quantum Readiness**: DID verification methods SHOULD support PQC algorithms (HIP-5) alongside classical ECDSA

## References

1. [HIP-1: $AI Token](./hip-0001-ai-coin-hanzos-native-currency.md)
2. [HIP-18: Payment Processing Standard](./hip-0018-payment-processing-standard.md)
3. [HIP-24: Hanzo Sovereign L1 Chain Architecture](./hip-0024-hanzo-sovereign-l1-chain-architecture.md)
4. [HIP-101: Hanzo-Lux Bridge Protocol Integration](./hip-0101-hanzo-lux-bridge-protocol-integration.md)
5. [W3C DID Core Specification](https://www.w3.org/TR/did-core/)
6. [Safe Smart Account](https://docs.safe.global/)
7. [BIP-32: HD Wallets](https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki)
8. [BIP-39: Mnemonic Code](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
