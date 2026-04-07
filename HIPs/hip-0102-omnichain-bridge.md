---
hip: 0102
title: Omnichain Bridge Integration
description: Cross-chain AI inference payments and model deployment via Lux Teleport omnichain bridge
author: Hanzo AI
type: Standards Track
category: Bridge
status: Final
created: 2023-09-01
requires: HIP-0001, HIP-0008, HIP-0024, HIP-0101
references: LPS-016, LPS-017, LPS-018, LPS-019
---

# HIP-0102: Omnichain Bridge Integration

## Abstract

This proposal specifies how Hanzo AI integrates with the Lux Teleport omnichain
bridge to enable cross-chain AI inference payments and model deployment across
270 supported chains. HIP-0101 defines the bilateral Hanzo-Lux bridge. This
proposal extends that foundation to arbitrary destination chains by leveraging
Lux Teleport as the routing layer.

The protocol defines three capabilities: **omnichain inference payments** (pay
for AI compute from any chain), **cross-chain model deployment** (deploy trained
models to execution environments on remote chains), and **yield-bearing bridge
tokens** (compute deposits that earn yield while awaiting inference). MPC
threshold signatures secure all cross-chain operations: FROST for Ed25519 chains
and CGGMP21 for ECDSA chains.

## Motivation

HIP-0101 connects Hanzo (chain ID 36963) to Lux Network. This is sufficient for
users who operate within the Hanzo-Lux ecosystem. It is not sufficient for users
whose assets, identities, or applications live on other chains.

AI inference is chain-agnostic. A user on Ethereum, Solana, or any L2 should be
able to submit an inference request and pay for it without first bridging assets
to Hanzo manually. The omnichain bridge eliminates this friction by routing
payments through Lux Teleport, which maintains liquidity pools and relay
infrastructure across 270 chains.

Specific problems this proposal addresses:

1. **Multi-chain payment fragmentation.** AI consumers exist on many chains.
   Without omnichain support, each chain requires a separate integration. Lux
   Teleport provides a single routing layer that normalizes payment across all
   supported chains.

2. **Idle compute deposits.** Users deposit funds for inference but may not
   consume compute immediately. Yield-bearing bridge tokens allow deposits to
   earn yield in Lux DeFi pools while remaining instantly redeemable for compute
   credits.

3. **Model distribution.** Trained models on Hanzo need deployment to execution
   environments on chains where inference demand exists. The omnichain bridge
   carries model certificate NFTs and deployment manifests to any destination
   chain.

4. **Settlement complexity.** Cross-chain inference involves payment on a source
   chain, execution on Hanzo, and settlement on Lux. The omnichain bridge
   coordinates this three-party flow using HIP-0101 as the settlement backbone.

## Specification

### Architecture

The omnichain bridge extends HIP-0101 by adding Lux Teleport as a routing layer
between Hanzo and external chains.

```
External Chain (1 of 270)     Lux Teleport          Hanzo-Lux Bridge       Hanzo L1 (36963)
┌───────────────────┐       ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│                   │ Lock  │                  │   │                  │   │                  │
│  Source Vault     │──────>│  Teleport Router │──>│  HIP-0101 Bridge │──>│  Inference Engine │
│  (chain-native)   │       │  (MPC relay)     │   │  (lock-and-mint) │   │  (GPU validators) │
│                   │<──────│                  │<──│                  │<──│                  │
│                   │ Unlock│                  │   │                  │   │                  │
└───────────────────┘       └──────────────────┘   └──────────────────┘   └──────────────────┘
                                    │
                          ┌─────────┴─────────┐
                          │   MPC Signers      │
                          │ FROST (Ed25519)    │
                          │ CGGMP21 (ECDSA)    │
                          └───────────────────┘
```

### Transfer Flow (External Chain to Hanzo Inference)

```
User                  External Chain    Lux Teleport    HIP-0101 Bridge    Hanzo L1
 │                        │                │                │                │
 │── pay(USDC, 100) ─────>│                │                │                │
 │                        │── Lock event ─>│                │                │
 │                        │                │── route ──────>│                │
 │                        │                │                │── mint wAI ───>│
 │                        │                │                │                │── queue inference
 │<─── inference result ──│                │                │                │
 │                        │                │                │                │
 │  Latency: 15-30s (source finality + Teleport routing + HIP-0101 bridge) │
```

### MPC Threshold Signatures

Lux Teleport secures cross-chain messages using MPC threshold signatures. The
signing scheme adapts to the destination chain's native cryptography.

#### FROST for Ed25519 Chains

For chains using Ed25519 (Solana, Near, Aptos, Sui, and others), the bridge
uses FROST (Flexible Round-Optimized Schnorr Threshold signatures) as specified
in RFC 9591.

- **Threshold**: t-of-n where t = ceil(2n/3) + 1
- **Key generation**: Distributed key generation (DKG) produces key shares
  without any single party learning the full signing key
- **Signing rounds**: Two rounds. Round 1: each signer generates a nonce
  commitment. Round 2: each signer produces a signature share using the
  aggregated nonce. The coordinator aggregates shares into a valid Ed25519
  signature.
- **Verification**: Standard Ed25519 verification on the destination chain. No
  special precompile required.

#### CGGMP21 for ECDSA Chains

For chains using ECDSA (Ethereum, BSC, Polygon, Arbitrum, Optimism, and
others), the bridge uses CGGMP21 (Canetti-Gennaro-Goldfeder-Makriyannis-Peled
2021) threshold ECDSA.

- **Threshold**: t-of-n where t = ceil(2n/3) + 1
- **Key generation**: Paillier-based DKG with zk-proofs of correctness
- **Signing rounds**: Pre-signing phase generates presignature triples offline.
  Online signing requires one round using a presignature triple and the message
  hash. This achieves sub-second signing latency.
- **Verification**: Standard `ecrecover` on the destination chain.

#### Signer Set

The MPC signer set consists of validators drawn from both Hanzo and Lux
networks. Each signer runs a threshold signing daemon alongside their validator
node. Signer rotation follows the same schedule as HIP-0101 validator rotation:
epochs of 24 hours with a 1-hour overlap period for key resharing.

### Supported Chains

Lux Teleport maintains relay infrastructure across 270 chains organized by
signature scheme:

| Scheme | Chain Count | Examples |
|--------|-------------|----------|
| ECDSA (secp256k1) | 180+ | Ethereum, BSC, Polygon, Arbitrum, Optimism, Base, all EVM L2s |
| Ed25519 | 40+ | Solana, Near, Aptos, Sui, Cosmos chains |
| Sr25519 | 20+ | Polkadot, Kusama, Substrate chains |
| Other | 30+ | Bitcoin (Schnorr), Tron, Ripple, Stellar |

For chains using Sr25519 or non-standard schemes, the bridge uses chain-specific
MPC protocols derived from the FROST framework with curve adaptation.

### Yield-Bearing Bridge Tokens

Users who bridge assets for AI compute may not consume inference immediately.
Idle deposits represent capital inefficiency. Yield-bearing bridge tokens solve
this by routing deposited assets into Lux DeFi pools while maintaining instant
redeemability.

#### Mechanism

1. User bridges USDC from an external chain to Hanzo for inference.
2. Lux Teleport routes the USDC to Lux C-Chain.
3. Instead of immediately bridging to Hanzo, the USDC enters a Lux DeFi vault
   (lending pool or liquidity provision).
4. The user receives ybUSDC (yield-bearing USDC) on Hanzo as a compute deposit
   token.
5. ybUSDC accrues yield from the underlying Lux DeFi position.
6. When the user submits an inference request, ybUSDC is burned at face value
   (principal + accrued yield) to pay for compute.
7. If the user withdraws without consuming inference, ybUSDC is redeemed for
   USDC plus earned yield, routed back through Teleport to the source chain.

#### Supported Yield-Bearing Tokens

| Token | Underlying | Yield Source | APY Range |
|-------|-----------|--------------|-----------|
| ybUSDC | USDC | Lux lending pool | 3-8% |
| ybUSDT | USDT | Lux lending pool | 3-8% |
| ybAI | $AI | AI compute staking (HIP-0096) | 5-15% |
| ybLUX | LUX | Lux network staking | 4-10% |

### Cross-Chain Inference Payment Protocol

The inference payment protocol coordinates payment on a source chain with
execution on Hanzo and settlement on Lux.

#### Message Format

```solidity
struct OmnichainInferenceRequest {
    uint256 nonce;              // Unique request ID
    uint32  sourceChainId;      // Origin chain (any of 270)
    address payer;              // Payer address on source chain
    bytes   model;              // Model identifier (IPFS CID or Hanzo model ID)
    bytes   input;              // Inference input (encrypted with model's TEE key)
    uint256 maxFee;             // Maximum fee in source chain's native unit
    address feeToken;           // Payment token on source chain
    uint64  deadline;           // Request expiration (source chain block timestamp)
    bytes   callback;           // Optional: callback address + function selector
}
```

#### Settlement

1. Teleport converts the source-chain payment to wAI on Lux C-Chain using HMM
   (HIP-0008) liquidity pools.
2. The wAI crosses the HIP-0101 bridge to Hanzo.
3. Hanzo's inference engine executes the request and generates a compute invoice.
4. The compute invoice settles against the wAI via HIP-0101 settlement flow.
5. If the inference fee is less than `maxFee`, the remainder routes back to the
   source chain through Teleport. If a callback is specified, the inference
   result is relayed to the callback address on the source chain.

### Cross-Chain Model Deployment

Trained models on Hanzo can be deployed to execution environments on remote
chains where inference demand exists. The bridge carries model certificate NFTs
(ERC-721) and deployment manifests.

#### Deployment Flow

1. Model owner initiates deployment on Hanzo, specifying the target chain and
   execution environment.
2. The model certificate NFT crosses the HIP-0101 bridge to Lux.
3. Lux Teleport routes the NFT and deployment manifest to the target chain.
4. The target chain's execution environment verifies the certificate, downloads
   model weights from the decentralized storage layer (referenced in the
   certificate metadata), and initializes the inference endpoint.
5. Inference revenue on the target chain routes back through Teleport to the
   model owner on Hanzo.

### Security

#### MPC Key Security

- Signer key shares are generated in TEE enclaves and never leave the enclave
  in plaintext.
- Key resharing occurs every epoch (24 hours) to limit exposure from
  compromised shares.
- A compromised signer below the threshold cannot produce valid signatures.
- All MPC communication channels use TLS 1.3 with ML-KEM-768 key exchange
  (post-quantum).

#### Rate Limiting

- Per-chain transfer limits: configurable per asset, starting at $10M/day for
  USDC/USDT, $50M/day for $AI.
- Per-user rate limits: $1M/hour default, adjustable via governance.
- Circuit breaker: if net outflow on any chain exceeds 30% of TVL in 1 hour,
  bridge pauses for that chain pending governance review.

#### Audit Requirements

- MPC signing code: formal verification of threshold correctness.
- Bridge contracts on each chain: independent audit before activation.
- Yield vault interactions: audit of vault adapter contracts per DeFi protocol.

## Backward Compatibility

This proposal extends HIP-0101 without modifying it. The bilateral Hanzo-Lux
bridge continues to operate independently. Omnichain routing is additive:
external chains route through Lux Teleport, which connects to the existing
HIP-0101 bridge infrastructure.

Existing HIP-0101 bridge users see no change in behavior, latency, or security
properties. The omnichain layer adds new source and destination chains without
altering the core lock-and-mint mechanism.

## References

- **HIP-0001**: AI Coin --- Hanzo's Native Currency
- **HIP-0008**: HMM --- Hanzo Market Maker
- **HIP-0024**: Hanzo Sovereign L1 Chain Architecture
- **HIP-0101**: Hanzo-Lux Bridge Protocol Integration
- **LPS-016**: Lux Teleport Protocol Specification
- **LPS-017**: Lux Teleport MPC Signer Architecture
- **LPS-018**: Lux Teleport Chain Adapter Interface
- **LPS-019**: Lux Teleport Yield-Bearing Token Standard
- **RFC 9591**: FROST Threshold Schnorr Signature Scheme
- **CGGMP21**: UC Non-Interactive, Proactive, Threshold ECDSA with Identifiable Aborts

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
