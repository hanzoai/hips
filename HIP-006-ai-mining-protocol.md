---
hip: 006
title: Hanzo AI Mining Protocol
description: Native AI mining on Hanzo L1 with quantum-safe wallets and Teleport bridge integration
author: Hanzo AI (@hanzoai)
status: Draft
type: Standards Track
category: Core
created: 2024-11-30
requires: LP-2000, LP-0004, LP-0005
---

# HIP-006: Hanzo AI Mining Protocol

## Abstract

This HIP defines the Hanzo AI Mining Protocol, enabling native AI compute mining on Hanzo Networks L1 with quantum-safe ML-DSA wallets. Mining rewards can be teleported to Hanzo EVM (Chain ID: 36963), Zoo EVM (Chain ID: 200200), or Lux C-Chain (Chain ID: 96369) for DeFi integration.

## Motivation

Hanzo Networks serves as the foundational L1 for AI mining in the Lux ecosystem. This protocol provides:

1. **Native AI Token**: AI rewards mined directly on L1, not wrapped ERC-20s
2. **Quantum-Safe Mining**: ML-DSA signatures protect long-term mining rewards
3. **Consensus Finality**: Lux BFT provides instant finality for mining operations
4. **Cross-Chain Liquidity**: Teleport enables seamless L2 integration

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                     Hanzo Networks L1                          │
│                                                                │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐     │
│  │   AI Work    │───▶│   Mining     │───▶│   Reward     │     │
│  │   Proof      │    │   Validator  │    │   Ledger     │     │
│  └──────────────┘    └──────────────┘    └──────────────┘     │
│         ▲                   │                   │              │
│         │                   │                   ▼              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐     │
│  │   ML-DSA     │    │     Lux      │    │   Teleport   │     │
│  │   Wallet     │◀───│   Consensus  │───▶│   Bridge     │     │
│  └──────────────┘    └──────────────┘    └──────────────┘     │
│                                                │               │
└────────────────────────────────────────────────┼───────────────┘
                                                 │
                    ┌────────────────────────────┼────────────────┐
                    │                            │                │
             ┌──────┴──────┐             ┌──────┴──────┐   ┌─────┴─────┐
             │ Hanzo EVM   │             │  Zoo EVM    │   │ Lux C-Chain│
             │   36963     │             │   200200    │   │   43114   │
             └─────────────┘             └─────────────┘   └───────────┘
```

## Specification

### 1. Mining Wallet (ML-DSA)

Hanzo mining wallets use FIPS 204 ML-DSA for quantum safety:

```rust
pub struct MiningWallet {
    pub security_level: SecurityLevel,  // Level2, Level3, Level5
    pub public_key: Vec<u8>,            // ML-DSA public key
    pub secret_key: SecretKey,          // Zeroized on drop
    pub address: String,                // 0x-prefixed hex address
    pub label: String,                  // Human-readable label
}
```

**Key Operations:**

| Operation | Description |
|-----------|-------------|
| `generate()` | Create new ML-DSA keypair |
| `sign(message)` | Sign with ML-DSA |
| `verify(message, sig)` | Verify ML-DSA signature |
| `export_encrypted()` | ChaCha20Poly1305 export |
| `import_encrypted()` | Import from encrypted bytes |

**Source:** [`hanzo-mining/src/wallet.rs`](https://github.com/hanzoai/node/blob/main/hanzo-libs/hanzo-mining/src/wallet.rs)

### 2. AI Work Proof

Miners submit AI compute proofs consisting of:

```rust
pub struct AIWorkProof {
    pub miner: Vec<u8>,         // ML-DSA public key
    pub model_hash: [u8; 32],   // BLAKE3 of model used
    pub input_hash: [u8; 32],   // BLAKE3 of input data
    pub output_hash: [u8; 32],  // BLAKE3 of output data
    pub compute_units: u64,     // Standardized compute metric
    pub timestamp: u64,         // Work completion time
    pub signature: Vec<u8>,     // ML-DSA signature
}
```

### 3. NVTrust Chain-Binding (Double-Spend Prevention)

The core mechanism preventing AI work from being claimed on multiple chains.

#### Design Principle

We avoid double-spend by **binding each unit of AI work to a specific chain BEFORE the compute runs**, and having the GPU's NVTrust enclave sign an attested receipt including that chain ID.

#### Work Context (Pre-Compute Commitment)

```rust
/// Miner commits to target chain before GPU execution
pub struct WorkContext {
    pub chain_id: ChainId,       // HANZO (36963) / ZOO (200200) / LUX (96369)
    pub job_id: [u8; 32],        // Workload or block height
    pub model_hash: [u8; 32],    // Model identity
    pub input_hash: [u8; 32],    // Prompt/data identity
    pub device_id: [u8; 32],     // GPU hardware ID
    pub nonce: [u8; 32],         // Unique per job (replay protection)
    pub timestamp: u64,          // Unix timestamp
}

impl WorkContext {
    /// Create context for Hanzo mining
    pub fn for_hanzo(job_id: [u8; 32], model: &[u8], input: &[u8]) -> Self {
        Self {
            chain_id: ChainId::HanzoEVM,  // 36963
            job_id,
            model_hash: blake3::hash(model).into(),
            input_hash: blake3::hash(input).into(),
            device_id: get_gpu_device_id(),
            nonce: generate_nonce(),
            timestamp: unix_timestamp(),
        }
    }
}
```

#### GPU TEE Receipt (NVTrust Signed)

```rust
/// Receipt signed by GPU's NVTrust enclave
pub struct AttestedReceipt {
    pub context: WorkContext,         // Pre-committed context
    pub result_hash: [u8; 32],        // Hash of AI output
    pub work_metrics: WorkMetrics,    // FLOPs, tokens, time
    pub nvtrust_signature: Vec<u8>,   // NVIDIA hardware attestation
    pub spdm_evidence: SPDMEvidence,  // SPDM measurement response
}

pub struct WorkMetrics {
    pub flops: u64,              // Floating point operations
    pub tokens_processed: u64,   // LLM inference tokens
    pub compute_time_ms: u64,    // Execution time
    pub memory_used_mb: u64,     // Peak VRAM
}

/// SPDM evidence from GPU firmware
pub struct SPDMEvidence {
    pub version: u8,
    pub measurement_hash: [u8; 48],   // GPU firmware/config
    pub nonce: [u8; 32],              // Replay protection
    pub signature: Vec<u8>,           // GPU signature
    pub certificate_chain: Vec<u8>,   // Chain to NVIDIA root
}
```

#### Chain Verification and Minting

```rust
impl MiningLedger {
    /// Verify receipt and mint reward (double-spend protected)
    pub async fn verify_and_mint(
        &self,
        receipt: &AttestedReceipt,
    ) -> Result<u64, MiningError> {
        // Step 1: Verify NVTrust signature
        self.verify_nvtrust_signature(receipt)?;

        // Step 2: Verify chain_id matches THIS chain (Hanzo)
        if receipt.context.chain_id != ChainId::HanzoEVM {
            return Err(MiningError::WrongChain {
                expected: ChainId::HanzoEVM,
                got: receipt.context.chain_id,
            });
        }

        // Step 3: Compute unique spent key
        let spent_key = blake3::hash(&[
            &receipt.context.device_id[..],
            &receipt.context.nonce[..],
            &(receipt.context.chain_id as u32).to_le_bytes()[..],
        ]);

        // Step 4: Check spent set (DOUBLE-SPEND PREVENTION)
        let mut spent = self.spent_set.write().await;
        if spent.contains(&spent_key.into()) {
            return Err(MiningError::AlreadyMinted);
        }

        // Step 5: Mark as spent and mint
        spent.insert(spent_key.into());
        let reward = self.calculate_reward(&receipt.work_metrics);
        self.mint_to_miner(&receipt.context.device_id, reward).await?;

        Ok(reward)
    }
}
```

#### Multi-Chain Mining (Same GPU)

The same GPU can mine for Hanzo, Lux, Zoo simultaneously, but:
- Each chain requires a **separate job** with a **different chain_id**
- Each job produces a **unique attested receipt**
- No "copy-paste" mining - you can't cash in one workload on three chains

| GPU | Hanzo Job | Zoo Job | Lux Job |
|-----|-----------|---------|---------|
| H100-001 | chain_id: 36963 | chain_id: 200200 | chain_id: 96369 |
| H100-001 | nonce: 0x1a... | nonce: 0x2b... | nonce: 0x3c... |
| H100-001 | Receipt A | Receipt B | Receipt C |

**Key Invariant:** The same AI work can't be minted on Hanzo, Lux, AND Zoo - only on the chain specified in the pre-committed `WorkContext.chain_id`.

#### Supported GPUs for NVTrust

| GPU Model | CC Support | Trust Score |
|-----------|------------|-------------|
| H100 | Full NVTrust | 95 |
| H200 | Full NVTrust | 95 |
| B100 | Full NVTrust + TEE-I/O | 100 |
| B200 | Full NVTrust + TEE-I/O | 100 |
| GB200 | Full NVTrust + TEE-I/O | 100 |
| RTX PRO 6000 | NVTrust | 85 |
| RTX 5090 | No CC | Software only (60) |
| RTX 4090 | No CC | Software only (60) |

**Source:** [`hanzo-mining/src/ledger.rs`](https://github.com/hanzoai/node/blob/main/hanzo-libs/hanzo-mining/src/ledger.rs)
**Source:** [`hanzo-node/src/security/tee_attestation.rs`](https://github.com/hanzoai/node/blob/main/hanzo-bin/hanzo-node/src/security/tee_attestation.rs)

### 4. Reward Distribution

Mining rewards follow this formula:

```
reward = base_reward * compute_units * difficulty_adjustment
```

Where:
- `base_reward`: Network-configured base rate
- `compute_units`: Verified AI compute performed
- `difficulty_adjustment`: Dynamic based on network hash rate

### 5. Teleport Integration

The Mining Bridge connects wallets to Teleport:

```rust
pub struct MiningBridge {
    wallet: RwLock<Option<MiningWallet>>,
    ledger: MiningLedger,
    teleport: TeleportConfig,
}

impl MiningBridge {
    /// Teleport rewards to EVM chain
    pub async fn teleport_to_evm(
        &self,
        destination: ChainId,
        to_address: &str,
        amount: u64,
    ) -> Result<String, BridgeError>;
}
```

**Supported Destinations:**

| Chain | Chain ID | Token |
|-------|----------|-------|
| Hanzo EVM | 36963 | AI, ZOO |
| Zoo EVM | 200200 | AI, ZOO |
| Lux C-Chain | 96369 | AI, ZOO, LUX |

**Source:** [`hanzo-mining/src/bridge.rs`](https://github.com/hanzoai/node/blob/main/hanzo-libs/hanzo-mining/src/bridge.rs)

### 6. EVM Precompile

The AI Mining precompile at `0x0300` enables EVM integration:

```solidity
interface IAIMining {
    function miningBalance(address miner) external view returns (uint256);
    function verifyMLDSA(bytes calldata pk, bytes calldata msg, bytes calldata sig) external view returns (bool);
    function claimTeleport(bytes32 teleportId) external returns (uint256);
    function pendingTeleports(address recipient) external view returns (bytes32[] memory);
}
```

**Source:** [`lux/standard/src/precompiles/AIMining.sol`](https://github.com/luxfi/standard/blob/main/src/precompiles/AIMining.sol)

## Rationale

### Why Hanzo L1 for Mining?

1. **Direct Consensus**: Mining rewards finalized by BFT, not smart contracts
2. **Lower Latency**: No EVM execution overhead for mining operations
3. **Native Security**: Quantum-safe from genesis, not retrofitted
4. **Economic Alignment**: Mining rewards tied to network security

### Why Teleport over ERC-20 Wrapping?

1. **True Cross-Chain**: Assets exist natively on destination chain
2. **No Bridge Risk**: Teleport uses L1 consensus, not external validators
3. **Gas Efficiency**: Single Teleport vs multiple approve/transfer calls

## Security Considerations

### Quantum Safety Timeline

| Year | Threat Level | Mitigation |
|------|-------------|------------|
| 2024 | Low | ML-DSA optional |
| 2026 | Medium | ML-DSA default |
| 2030 | High | ECDSA deprecated |

### Key Zeroization

All secret keys are zeroized on drop:

```rust
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct SecretKey(Vec<u8>);
```

### Work Proof Validation

- Validators verify AI work independently
- Invalid proofs result in stake slashing
- Replay protection via timestamp + nonce

## Test Cases

```bash
# Run full test suite
cd hanzo-libs/hanzo-mining
cargo test

# Key tests:
# - test_wallet_creation
# - test_wallet_signing
# - test_wallet_export_import
# - test_bridge_creation
# - test_teleport_transfer
```

## Reference Implementation

| Component | Repository | Path |
|-----------|------------|------|
| Mining Wallet | hanzoai/node | `hanzo-libs/hanzo-mining/src/wallet.rs` |
| Global Ledger | hanzoai/node | `hanzo-libs/hanzo-mining/src/ledger.rs` |
| EVM Bridge | hanzoai/node | `hanzo-libs/hanzo-mining/src/evm.rs` |
| Teleport Bridge | hanzoai/node | `hanzo-libs/hanzo-mining/src/bridge.rs` |
| Solidity Interface | luxfi/standard | `src/precompiles/AIMining.sol` |

## Related Proposals

- **LP-2000**: AI Mining Standard (Lux ecosystem-wide)
- **LP-0004**: Quantum Resistant Cryptography
- **LP-0005**: Quantum Safe Wallets
- **ZIP-005**: Zoo AI Mining Integration

## Copyright

Copyright 2024 Hanzo AI. Released under MIT License.
