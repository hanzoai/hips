---
hip: "0101"
title: Hanzo-Lux Bridge Protocol Integration
description: Lock-and-mint bridge between Hanzo's AI-optimized L1 and Lux Network's settlement layer
author: Hanzo AI Team
type: Standards Track
category: Bridge
status: Final
created: 2025-01-15
updated: 2026-02-23
requires: HIP-0001, HIP-0005, HIP-0008, HIP-0024
---


# HIP-0101: Hanzo-Lux Bridge Protocol Integration

## Abstract

This proposal specifies a lock-and-mint bridge between Hanzo's sovereign L1 chain
(HIP-0024, chain ID 36963) and the Lux Network. The bridge enables bidirectional
asset transfer ($AI, wrapped LUX, stablecoins, NFT model certificates) secured by
a 7-of-11 multi-signature validator set drawn from both networks. It serves as the
economic backbone of the AI compute marketplace, connecting Hanzo's AI execution
environment to Lux's settlement and DeFi infrastructure.

The protocol defines three layers: a **transport layer** (cross-chain message
passing with Merkle proof verification), a **consensus layer** (shared validator
set coordination using ML-DSA-65 threshold signatures), and a **settlement layer**
(lock-mint-burn-unlock state machine with HMM invoice integration). Together these
layers provide sub-10-second bridge finality, post-quantum security from day one,
and native integration with Lux's multi-consensus architecture.

## Design Philosophy

This section explains the reasoning behind each major design decision. A bridge
is critical infrastructure. Every choice must be justified from first principles,
not by convention or convenience.

### Why Not Use Existing Bridges (Wormhole, LayerZero)

Third-party bridges like Wormhole and LayerZero introduce trust assumptions that
do not match the Hanzo-Lux security model:

- **External guardian sets.** Wormhole relies on a set of 19 Guardians operated
  by third-party entities. LayerZero relies on independent oracle and relayer
  separation. In both cases, Hanzo and Lux must trust external parties with no
  stake in either network. The Hanzo-Lux bridge uses validators drawn directly
  from both chains, with staking requirements that align economic incentives.

- **No native state verification.** Third-party bridges treat all chains as
  opaque message buses. The Hanzo-Lux bridge has direct access to chain state on
  both sides: it can verify Merkle proofs against both Hanzo's state trie and
  Lux's C-Chain state trie without relying on external attestation.

- **Incompatible cryptography.** Third-party bridges use ECDSA. Hanzo and Lux
  use ML-DSA-65 (post-quantum). Adapting third-party bridges to PQC would
  require forking their guardian/oracle software and maintaining a custom build
  indefinitely. Building natively avoids this maintenance burden.

- **Latency overhead.** Third-party bridges add confirmation delays for their
  own consensus (Wormhole: ~15-20s for guardian consensus; LayerZero: variable
  based on oracle confirmation). The native bridge achieves 5-9 seconds
  end-to-end because validators are co-located with chain nodes.

- **No HMM integration.** The bridge carries structured compute invoice payloads
  (HIP-0008) that third-party bridges have no awareness of. Building natively
  allows the bridge to validate invoice structure, enforce settlement rules, and
  trigger Lux-side payment flows without external adapter contracts.

### Why Post-Quantum From Day One

Quantum computing threatens all current bridge cryptography. ECDSA, the signature
scheme used by every major bridge today, is broken by Shor's algorithm on a
sufficiently large quantum computer. The question is not whether ECDSA will be
broken, but when.

Bridges are especially vulnerable because they hold locked assets. A "harvest now,
decrypt later" attack --- recording bridge messages today and forging signatures
once quantum hardware matures --- could drain bridge vaults retroactively. Starting
with ML-DSA-65 (CRYSTALS-Dilithium, FIPS 204) eliminates this attack vector
entirely.

The cost of starting with PQC is larger signature sizes (~2.4 KB for ML-DSA-65 vs
~64 bytes for ECDSA) and slightly higher verification cost. Both Hanzo and Lux
have ML-DSA-65 verification as a native precompile, so the on-chain cost is
manageable. The off-chain cost (bandwidth for relaying signatures) is negligible
given modern network speeds.

Starting post-quantum avoids the complexity of a future migration. Hybrid schemes
(ECDSA + PQC) are transitional by design and add implementation surface area. Since
the bridge is new infrastructure with no backward-compatibility requirement, there
is no reason to support legacy cryptography.

## Specification

### Bridge Architecture

The bridge consists of three components: on-chain vaults (one per chain), an
off-chain relayer service, and the shared validator set.

```
Hanzo L1 (chain 36963)           Bridge Validators              Lux Network
┌──────────────────┐            ┌───────────────────┐          ┌──────────────────┐
│                  │ Lock event │                   │ Mint tx  │                  │
│   Lock Vault     │───────────>│  Relayer Service  │─────────>│   Mint Vault     │
│   (Solidity)     │            │  (off-chain)      │          │   (C-Chain EVM)  │
│                  │<───────────│                   │<─────────│                  │
│                  │ Unlock tx  │  7-of-11 ML-DSA   │ Burn evt │                  │
└──────────────────┘            │  threshold sigs   │          └──────────────────┘
                                └───────────────────┘
                                       │
                           ┌───────────┼───────────┐
                           │           │           │
                      ┌────┴────┐ ┌────┴────┐ ┌────┴────┐
                      │Relayer 1│ │Relayer 2│ │Relayer 3│
                      │(leader) │ │(follower│ │(follower│
                      └─────────┘ └─────────┘ └─────────┘
                         Raft consensus for leader election
```

#### Transfer Flow (Hanzo to Lux)

```
User                    Hanzo L1          Relayer          Validators        Lux C-Chain
 │                         │                │                  │                 │
 │── lock(AI, 1000) ──────>│                │                  │                 │
 │                         │── Lock event ─>│                  │                 │
 │                         │                │── verify proof ─>│                 │
 │                         │                │                  │── sign msg ────>│
 │                         │                │<── 7 sigs ───────│                 │
 │                         │                │── mint(wAI) ─────────────────────>│
 │                         │                │                  │                 │── wAI to user
 │<──────────── receipt ───│                │                  │                 │
 │                         │                │                  │                 │
 │  Total time: 5-9 seconds                                                     │
```

#### Transfer Flow (Lux to Hanzo)

```
User                    Lux C-Chain       Relayer          Validators        Hanzo L1
 │                         │                │                  │                 │
 │── burn(wAI, 1000) ─────>│                │                  │                 │
 │                         │── Burn event ─>│                  │                 │
 │                         │                │── verify proof ─>│                 │
 │                         │                │                  │── sign msg ────>│
 │                         │                │<── 7 sigs ───────│                 │
 │                         │                │── unlock(AI) ────────────────────>│
 │                         │                │                  │                 │── AI to user
 │<──────────── receipt ───│                │                  │                 │
```

### Supported Assets

| Asset | Hanzo Representation | Lux Representation | Direction | Notes |
|-------|---------------------|-------------------|-----------|-------|
| $AI | Native token | wAI (ERC-20 on C-Chain) | Hanzo -> Lux | Core bridge asset |
| LUX | wLUX (ERC-20 on Hanzo) | Native token | Lux -> Hanzo | For staking rewards |
| USDC | wUSDC (bridged) | USDC (native C-Chain) | Bidirectional | Stablecoin settlement |
| USDT | wUSDT (bridged) | USDT (native C-Chain) | Bidirectional | Stablecoin settlement |
| Model NFTs | ERC-721 (native) | wModel (ERC-721 C-Chain) | Hanzo -> Lux | Model certificates |
| Compute Credits | ERC-1155 (native) | wCredits (ERC-1155) | Bidirectional | HMM credit tokens |

### Message Format

Bridge messages use canonical ABI encoding for cross-chain communication:

```solidity
struct BridgeMessage {
    uint256 nonce;           // Monotonically increasing per-chain
    uint32  sourceChainId;   // 36963 (Hanzo) or Lux chain ID
    uint32  destChainId;     // Target chain ID
    address sender;          // Sender on source chain
    address recipient;       // Recipient on destination chain
    address token;           // Token address on source chain (0x0 for native)
    uint256 amount;          // Amount in wei (18 decimals)
    bytes   payload;         // Optional: HMM invoice data, stake proof, etc.
    uint64  timestamp;       // Block timestamp of lock/burn event
    bytes32 txHash;          // Source transaction hash
    bytes32 stateRoot;       // State root of source chain at lock/burn block
}
```

Messages are serialized as ABI-encoded bytes and signed by each validator using
ML-DSA-65 (HIP-0005). The destination contract verifies that at least 7 of 11
signatures are valid before executing. The `stateRoot` field enables Merkle proof
verification: the destination contract can verify that the lock/burn event is
included in the source chain's state at the claimed block.

### State Proof Verification

The bridge uses Merkle proof verification to confirm that events on the source
chain actually occurred. This is stronger than simply trusting validator
attestations --- it provides cryptographic proof anchored to chain state.

```
                    Source Chain State Root
                           │
                    ┌──────┴──────┐
                    │             │
               ┌────┴────┐  ┌────┴────┐
               │         │  │         │
            ┌──┴──┐   ┌──┴──┐     ...
            │     │   │     │
           ...   Lock Event
                 Receipt
```

The verification flow:

1. User locks assets on source chain. The lock emits an event with a receipt.
2. Relayer constructs a Merkle proof from the source chain's receipt trie,
   proving the lock event is included in the block's state.
3. Relayer presents the proof, block header, and validator signatures to the
   destination chain contract.
4. Destination contract verifies: (a) block header is signed by source chain
   validators, (b) Merkle proof is valid against the block's receipts root,
   (c) at least 7-of-11 bridge validators have signed the bridge message.

This triple verification (chain consensus + Merkle proof + bridge multi-sig)
provides defense in depth. An attacker must compromise source chain consensus,
forge a valid Merkle proof, AND compromise 7 bridge validators simultaneously.

### Validator Set

The bridge validator set consists of 11 members: 6 drawn from Hanzo's L1
validator set and 5 from Lux's primary network validators. This ensures neither
chain has unilateral control.

```yaml
validator_set:
  total: 11
  threshold: 7  # 7-of-11 required for any bridge operation
  composition:
    hanzo_validators: 6    # Top 6 by stake from Hanzo L1
    lux_validators: 5      # Top 5 by stake from Lux primary network
  rotation:
    epoch_length: 7 days
    max_rotation_per_epoch: 2  # At most 2 validators rotate per epoch
    cooldown_after_rotation: 14 days  # New validators cannot be rotated for 2 epochs
  requirements:
    min_stake_hanzo: 5000 AI   # Higher than base validation (2000 AI)
    min_stake_lux: 10000 LUX   # Higher than base Lux validation
    uptime: 99.5%
    signature_scheme: ML-DSA-65
    key_encapsulation: ML-KEM-768  # For validator-to-validator communication
```

Validator selection is determined by stake weight within each chain's validator
set. Rotation occurs every 7 days, with at most 2 validators replaced per epoch
to prevent sudden set changes that could compromise the bridge.

### Lux Network Integration

The bridge integrates with all three Lux chains, each serving a different purpose.

#### P-Chain Integration (Validator Management)

Hanzo operates as a sovereign L1 on the Lux Network (HIP-0024). The P-Chain
manages validator registration, staking, and delegation for both the Lux primary
network and all L1s including Hanzo.

The bridge reads P-Chain state to:
- Verify that bridge validators are active and properly staked on their
  respective chains.
- Track delegation changes that affect validator eligibility.
- Coordinate validator rotation by reading stake rankings from both networks.

```go
// Bridge validator eligibility check (uses luxfi packages, NOT go-ethereum)
import (
    "github.com/luxfi/node/vms/platformvm"
    "github.com/luxfi/node/ids"
)

func IsEligibleBridgeValidator(nodeID ids.NodeID, chainID ids.ID) (bool, error) {
    validators, err := platformvm.GetCurrentValidators(chainID)
    if err != nil {
        return false, fmt.Errorf("fetch validators: %w", err)
    }
    for _, v := range validators {
        if v.NodeID == nodeID && v.StakeAmount >= MinBridgeStake {
            return true, nil
        }
    }
    return false, nil
}
```

#### X-Chain Integration (Fast Asset Transfers)

The Lux X-Chain runs the XVM (UTXO virtual machine) for asset operations under
Quasar 3.0 Nova-mode consensus. After $AI arrives on the C-Chain as wAI
(ERC-20), users can export it to the X-Chain for fast UTXO-based transfers.

X-Chain integration enables:
- Sub-second asset transfers between Lux users (Quasar Nova consensus).
- Atomic swaps between wAI and other X-Chain assets.
- Cross-chain exports to the P-Chain for staking operations.

The bridge does not interact with the X-Chain directly. It bridges to the C-Chain
only. Users move assets between Lux chains using Lux's native cross-chain
transfer mechanism (export/import transactions).

#### C-Chain Integration (DeFi and Smart Contracts)

The C-Chain is the primary bridge endpoint on Lux. It runs the EVM and hosts:
- The Mint Vault contract (wAI minting and burning).
- DeFi protocols (DEXes, lending, liquidity pools) where wAI can be traded.
- The settlement contract for HMM compute invoices.
- Wrapped model NFT contracts for secondary market trading.

#### Custom VM for AI Compute Verification

Lux's multi-VM architecture supports custom virtual machines. The bridge
leverages a lightweight AI Verification VM deployed as a Lux L1:

```yaml
ai_verification_vm:
  purpose: Verify AI compute proofs relayed from Hanzo
  consensus: nova
  chain_type: L1
  capabilities:
    - TEE attestation verification
    - Compute invoice validation
    - Model hash verification
    - GPU benchmark proof checking
  integration:
    - Reads proofs from bridge messages (payload field)
    - Writes verification results to C-Chain via cross-chain call
    - Enables Lux DeFi contracts to trust Hanzo compute claims
```

This VM allows Lux-side contracts to verify that compute work claimed in HMM
invoices actually occurred, without trusting the bridge validators' word alone.
The VM replays the TEE attestation proof and confirms the claimed GPU-hours
against known hardware benchmarks.

### Finality Requirements

A bridge transfer is considered final when all three conditions are met:

| Step | Chain | Expected Time | Description |
|------|-------|---------------|-------------|
| 1 | Source | ~1-2s | Transaction finality on source chain (Nova) |
| 2 | Validators | ~3-5s | 7-of-11 validators sign the bridge message |
| 3 | Destination | ~1-2s | Mint/unlock transaction finality on destination chain |

**Total expected bridge time: 5-9 seconds.**

The relayer waits for source chain finality (Hanzo Nova: ~2s, Lux Quasar: ~1s)
before presenting the lock/burn event to the validator set. Validators
independently verify the event against their own chain state before signing.

For large transfers (>100,000 AI), the elevated 9-of-11 threshold adds ~2-3
seconds to signature collection, bringing total time to 7-12 seconds.

### Fee Structure

```yaml
fees:
  bridge_fee: 0.1%              # Of transferred amount
  min_fee: 1 AI                 # Minimum fee regardless of amount
  max_fee: 10000 AI             # Cap for very large transfers
  destination_gas: paid_by_user # User pays gas on destination chain
  fee_distribution:
    validators: 70%             # Split among signing validators
    protocol_treasury: 20%      # Hanzo DAO treasury
    insurance_fund: 10%         # Emergency fund for bridge incidents
  validator_rewards:
    bridge_fees: denominated in $AI  # Validators earn $AI for signing
    lux_staking: denominated in $LUX # Lux validators also earn LUX staking rewards
```

### Rate Limiting

To prevent exploits, the bridge enforces rate limits:

```yaml
rate_limits:
  per_user:
    max_per_tx: 1000000 AI       # 1M AI per transaction
    max_per_hour: 5000000 AI     # 5M AI per hour
    max_per_day: 20000000 AI     # 20M AI per day
  global:
    max_per_hour: 50000000 AI    # 50M AI per hour across all users
    max_per_day: 200000000 AI    # 200M AI per day across all users
  cooldown:
    after_large_tx: 60s          # 60-second cooldown after >100k AI transfer
  elevated_threshold:
    amount: 1000000 AI           # Transfers >1M AI require 9-of-11 sigs
    threshold: 9
```

Rate limits are configurable via governance (see Emergency Controls).

### API Specification

The bridge exposes a REST API for client interaction:

```yaml
bridge_api:
  base_url: /v1/bridge

  endpoints:
    POST /v1/bridge/transfer:
      description: Initiate a bridge transfer
      request:
        sourceChain: string     # "hanzo" or "lux"
        destChain: string       # "hanzo" or "lux"
        token: string           # Token address or "native"
        amount: string          # Amount in wei
        recipient: string       # Destination address
        payload: bytes          # Optional HMM invoice data
      response:
        transferId: string      # Unique transfer identifier
        nonce: uint256          # Bridge nonce
        estimatedTime: uint64   # Estimated completion in seconds
        status: string          # "pending_finality"

    GET /v1/bridge/status/{transferId}:
      description: Query transfer status
      response:
        transferId: string
        status: string          # pending_finality | pending_signatures |
                                # pending_destination | completed | failed
        sourceChain: string
        destChain: string
        amount: string
        signatures: uint8       # Number of validator signatures collected
        sourceTxHash: string
        destTxHash: string      # Populated on completion
        timestamp: uint64
        completedAt: uint64     # Populated on completion

    POST /v1/bridge/verify:
      description: Verify a bridge message and its Merkle proof
      request:
        message: bytes          # ABI-encoded BridgeMessage
        proof: bytes            # Merkle proof against source state root
        signatures: bytes[]     # ML-DSA-65 validator signatures
      response:
        valid: bool
        validSignatures: uint8
        proofValid: bool
        stateRootMatch: bool

    GET /v1/bridge/validators:
      description: Current bridge validator set
      response:
        validators: array
          - nodeId: string
          - chain: string       # "hanzo" or "lux"
          - stake: string
          - publicKey: string   # ML-DSA-65 public key
          - uptime: float
        threshold: uint8
        epoch: uint64
        nextRotation: uint64

    GET /v1/bridge/stats:
      description: Bridge statistics
      response:
        totalLocked: string     # Total AI locked on Hanzo side
        totalMinted: string     # Total wAI minted on Lux side
        volume24h: string       # 24-hour transfer volume
        transferCount24h: uint64
        avgBridgeTime: float    # Average bridge time in seconds
        rateLimitStatus: object # Current rate limit utilization
```

### Emergency Controls

The bridge can be paused under the following conditions:

1. **Governance pause.** A governance vote on either chain can pause the bridge.
   Requires simple majority of bridge validators (6 of 11).
2. **Anomaly pause.** The relayer automatically pauses if transfer volume exceeds
   3x the 7-day moving average within a 1-hour window.
3. **Validator pause.** Any 3 validators can trigger an emergency pause lasting
   24 hours, during which governance must vote to resume or extend.
4. **Balance divergence pause.** If `total_locked_hanzo` diverges from
   `total_minted_lux` by more than 0.01% (accounting for in-flight transfers),
   the bridge pauses for manual audit.

During a pause, no new locks or burns are processed. Pending transfers that have
already been signed by validators but not yet executed on the destination chain
are held in a queue and processed when the bridge resumes.

## Implementation

### Hanzo Side: Lock Vault Contract

The Lock Vault is deployed on Hanzo's L1 (chain ID 36963):

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IMLDSA} from "./interfaces/IMLDSA.sol";

contract HanzoLockVault {
    uint256 public nonce;
    mapping(bytes32 => bool) public processedMessages;
    mapping(address => bool) public supportedTokens;
    bool public paused;

    address[] public validators;
    uint8 public constant THRESHOLD = 7;
    uint8 public constant ELEVATED_THRESHOLD = 9;
    uint256 public constant ELEVATED_AMOUNT = 1_000_000 ether;

    event Locked(
        uint256 indexed nonce,
        address indexed sender,
        address indexed token,
        uint256 amount,
        uint32 destChainId,
        address recipient,
        bytes payload
    );

    event Unlocked(
        bytes32 indexed messageHash,
        address indexed recipient,
        address indexed token,
        uint256 amount
    );

    event Paused(address indexed triggeredBy, string reason);
    event Unpaused(address indexed triggeredBy);

    modifier whenNotPaused() {
        require(!paused, "bridge paused");
        _;
    }

    /// @notice Lock tokens for bridging to Lux
    function lock(
        address token,
        uint256 amount,
        uint32 destChainId,
        address recipient,
        bytes calldata payload
    ) external payable whenNotPaused {
        require(amount > 0, "zero amount");
        require(recipient != address(0), "zero recipient");

        if (token == address(0)) {
            require(msg.value == amount, "incorrect native amount");
        } else {
            require(supportedTokens[token], "unsupported token");
            IERC20(token).transferFrom(msg.sender, address(this), amount);
        }

        uint256 currentNonce = nonce++;
        emit Locked(currentNonce, msg.sender, token, amount, destChainId, recipient, payload);
    }

    /// @notice Unlock tokens returning from Lux (called by relayer with validator sigs)
    function unlock(
        bytes calldata message,
        bytes[] calldata signatures
    ) external whenNotPaused {
        bytes32 msgHash = keccak256(message);
        require(!processedMessages[msgHash], "already processed");

        BridgeMessage memory bm = abi.decode(message, (BridgeMessage));
        uint8 required = bm.amount >= ELEVATED_AMOUNT ? ELEVATED_THRESHOLD : THRESHOLD;
        require(
            _verifySignatures(msgHash, signatures) >= required,
            "insufficient signatures"
        );

        processedMessages[msgHash] = true;

        if (bm.token == address(0)) {
            payable(bm.recipient).transfer(bm.amount);
        } else {
            IERC20(bm.token).transfer(bm.recipient, bm.amount);
        }

        emit Unlocked(msgHash, bm.recipient, bm.token, bm.amount);
    }

    function _verifySignatures(
        bytes32 msgHash,
        bytes[] calldata signatures
    ) internal view returns (uint8 validCount) {
        for (uint i = 0; i < signatures.length; i++) {
            // ML-DSA-65 verification via precompile (HIP-0005)
            if (IMLDSA(ML_DSA_PRECOMPILE).verify(
                validators[i], msgHash, signatures[i]
            )) {
                validCount++;
            }
        }
    }
}
```

### Lux Side: Mint Vault Contract

The Mint Vault is deployed on Lux C-Chain. It mints wrapped tokens when assets
are locked on Hanzo, and burns them when assets are returned:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

contract LuxMintVault {
    mapping(bytes32 => bool) public processedMessages;
    mapping(address => address) public wrappedTokens;
    bool public paused;

    address[] public validators;
    uint8 public constant THRESHOLD = 7;

    event Minted(bytes32 indexed messageHash, address indexed recipient,
                 address indexed wrappedToken, uint256 amount);
    event Burned(uint256 indexed nonce, address indexed sender,
                 address indexed wrappedToken, uint256 amount,
                 uint32 destChainId, address recipient);

    /// @notice Mint wrapped tokens (called by relayer with validator sigs)
    function mint(bytes calldata message, bytes[] calldata signatures) external {
        require(!paused, "bridge paused");
        bytes32 msgHash = keccak256(message);
        require(!processedMessages[msgHash], "already processed");
        require(_verifySignatures(msgHash, signatures) >= THRESHOLD, "insufficient sigs");

        processedMessages[msgHash] = true;
        BridgeMessage memory bm = abi.decode(message, (BridgeMessage));
        address wrappedToken = wrappedTokens[bm.token];
        require(wrappedToken != address(0), "no wrapped token");

        uint256 fee = _calculateFee(bm.amount);
        uint256 netAmount = bm.amount - fee;

        WrappedToken(wrappedToken).mint(bm.recipient, netAmount);
        WrappedToken(wrappedToken).mint(feeCollector, fee);
        emit Minted(msgHash, bm.recipient, wrappedToken, netAmount);
    }

    /// @notice Burn wrapped tokens to unlock on Hanzo
    function burn(address wrappedToken, uint256 amount,
                  uint32 destChainId, address recipient) external {
        require(!paused, "bridge paused");
        require(amount > 0, "zero amount");
        ERC20Burnable(wrappedToken).burnFrom(msg.sender, amount);
        emit Burned(nonce++, msg.sender, wrappedToken, amount, destChainId, recipient);
    }

    function _calculateFee(uint256 amount) internal pure returns (uint256) {
        uint256 fee = (amount * 10) / 10000; // 0.1%
        if (fee < 1 ether) return 1 ether;          // min 1 AI
        if (fee > 10000 ether) return 10000 ether;   // max 10k AI
        return fee;
    }
}
```

### Relayer Service

The relayer is an off-chain service that monitors both chains and coordinates
the validator set:

```yaml
relayer:
  architecture: event-driven, stateless with respect to bridge balances
  redundancy:
    instances: 3       # Active-active with Raft leader election
    failover: < 10s    # Automatic leader promotion

  components:
    chain_monitor:
      - watches Hanzo L1 for Lock events via WebSocket subscription
      - watches Lux C-Chain for Burn events via WebSocket subscription
      - confirms finality (waits for Nova acceptance) before relaying
      - constructs Merkle proofs from source chain receipt tries

    validator_coordinator:
      - presents events + Merkle proofs to validator set
      - collects ML-DSA-65 signatures via encrypted channels (ML-KEM-768)
      - submits signed messages to destination chain
      - retries failed submissions with exponential backoff

    anomaly_detector:
      - tracks transfer volume (1h, 24h, 7d rolling windows)
      - triggers pause if volume exceeds 3x 7-day moving average
      - monitors balance divergence between locked and minted totals
      - flags suspicious validator signing patterns
      - alerts operators via webhook (PagerDuty, Slack)

    rate_limiter:
      - enforces per-user and global rate limits
      - maintains cooldown timers per address
      - escalates threshold for large transfers
```

The relayer is stateless with respect to bridge balances. All state lives in the
on-chain contracts. If all relayer instances fail, the bridge pauses. No funds
are at risk because the lock vault holds all assets and only releases them upon
valid multi-sig authorization.

### HMM Settlement Integration

The bridge carries compute invoice settlement messages from HMM (HIP-0008).
When a compute job completes on Hanzo:

1. HMM generates an invoice on Hanzo L1 with job details.
2. If the user's $AI balance is on Lux, the invoice is encoded in the bridge
   message `payload` field.
3. The bridge relays the invoice to the Lux-side settlement contract.
4. The settlement contract debits the user's wAI or triggers unstake-and-pay.

```solidity
struct ComputeInvoice {
    bytes32 jobId;            // Unique job identifier
    address provider;         // Compute provider address
    address consumer;         // Consumer address
    uint256 cost;             // Cost in $AI (18 decimals)
    uint64  gpuHours;         // GPU-hours consumed
    uint64  tokensProcessed;  // Tokens processed (inference)
    bytes32 modelHash;        // Hash of model used
    bytes   attestation;      // TEE attestation proof
}
```

### How the Bridge Enables the Compute Marketplace

The compute marketplace operates as a cycle:

1. **Stake.** Users stake $AI on Lux P-Chain (economic security, yield).
2. **Verify.** The bridge reads Lux staking positions and relays them to Hanzo.
3. **Allocate.** Hanzo allocates compute proportional to verified stake.
4. **Execute.** Providers run AI workloads on Hanzo (inference, training).
5. **Invoice.** The HMM (HIP-0008) generates compute invoices on Hanzo.
6. **Settle.** Invoices are settled via the bridge, debiting $AI on the user's
   Lux-side balance or relaying payment to Hanzo.

The bridge is not an accessory to the compute marketplace. It is the economic
backbone that connects staking (Lux) to compute allocation (Hanzo) to settlement
(Lux).

## Security

### Multi-Sig Validator Rotation

Validator rotation follows a controlled schedule:

- **Epoch length**: 7 days. At each epoch boundary, eligible validators are
  recalculated based on stake weight.
- **Maximum rotation**: 2 validators per epoch. Even if stake rankings change
  significantly, only 2 slots rotate. At least 9 of 11 validators persist across
  any single epoch.
- **Cooldown**: A newly rotated validator cannot be rotated out for 14 days.
- **Key handoff**: Outgoing validators co-sign a key rotation message with
  incoming validators. Destination contracts update their validator registries
  only upon receiving a valid rotation message signed by the current 7-of-11 set.

### Challenge Period for Disputed Transfers

Any bridge validator or staked observer can challenge a transfer within 30
minutes of the mint/unlock transaction on the destination chain. A challenge
asserts that the source-chain event is invalid (e.g., a forged Merkle proof or
a reorged source block).

```yaml
challenge_period:
  duration: 30 minutes
  bond: 100 AI              # Challenger must post bond
  resolution:
    - If challenge succeeds: transfer is reversed, challenger receives bond back
      plus a reward from the insurance fund.
    - If challenge fails: bond is forfeited to the insurance fund.
  dispute_resolution:
    - Re-verify Merkle proof against source chain state.
    - Check source chain for block reorgs since the original verification.
    - 9-of-11 validator vote on dispute outcome.
```

In practice, challenges are expected to be extremely rare because the triple
verification (chain consensus + Merkle proof + multi-sig) makes forgery
prohibitively expensive.

### Rate Limiting on Large Transfers

Large transfers receive additional scrutiny:

- Transfers >100,000 AI trigger a 60-second cooldown.
- Transfers >1,000,000 AI require 9-of-11 validator signatures.
- The global hourly limit (50M AI) is a hard cap. If reached, all transfers
  queue until the next hour window.

### Anomaly Detection

The relayer maintains rolling volume statistics:

```
if volume_1h > 3 * avg_volume_7d:
    trigger emergency_pause
    alert operators
    require governance_vote to resume
```

Additional anomaly signals:
- Rapid succession of maximum-size transfers from new addresses.
- Balance divergence: if total locked on Hanzo diverges from total minted on
  Lux by more than 0.01%, the bridge pauses for manual audit.
- Validator timing anomaly: if a validator consistently signs faster than
  physically possible given network latency, flag for investigation.

### Post-Quantum Cryptography

All bridge signatures use ML-DSA-65 (CRYSTALS-Dilithium, FIPS 204) as specified
in HIP-0005. This applies to:

- Validator signatures on bridge messages.
- Key rotation messages.
- Emergency pause authorizations.
- Governance vote signatures.
- Challenge/dispute submissions.

The bridge does not support legacy ECDSA signatures. This is deliberate: the
bridge is new infrastructure with no backward-compatibility requirement. Starting
with ML-DSA-65 avoids the complexity of a hybrid transition.

Key encapsulation for validator-to-validator communication (during signature
coordination) uses ML-KEM-768, also per HIP-0005. Key sizes:

| Algorithm | Public Key | Signature/Ciphertext | Security Level |
|-----------|-----------|---------------------|----------------|
| ML-DSA-65 | 1,952 bytes | 3,293 bytes | NIST Level 3 (AES-192 equivalent) |
| ML-KEM-768 | 1,184 bytes | 1,088 bytes | NIST Level 3 (AES-192 equivalent) |

### Audit and Verification

Before mainnet deployment, the bridge contracts must undergo:

1. **Formal verification** of lock/mint/burn/unlock invariants. The core
   invariant: `total_locked_hanzo == total_minted_lux` at all times (within
   0.01% tolerance for in-flight transactions).
2. **Third-party security audit** by at least two independent firms.
3. **Economic audit** of fee structure and rate limits to ensure they do not
   create arbitrage opportunities or denial-of-service vectors.
4. **Testnet operation** for a minimum of 90 days with adversarial testing
   (simulated validator failures, network partitions, volume spikes).

## Testing Strategy

### Unit Tests

- Lock vault: lock, unlock, replay protection, fee calculation, rate limiting,
  pause/unpause, elevated threshold for large transfers.
- Mint vault: mint, burn, wrapped token accounting, fee distribution.
- Signature verification: valid ML-DSA-65 signatures, threshold enforcement,
  invalid signature rejection, mixed valid/invalid sets.
- Message encoding: canonical serialization, nonce ordering, cross-chain ID
  validation, state root inclusion.
- Merkle proofs: valid proof acceptance, invalid proof rejection, proof against
  wrong state root.

### Integration Tests

- End-to-end bridge transfer (Hanzo testnet to Lux Fuji testnet).
- Validator rotation during active transfers.
- Relayer failover (kill primary, verify secondary takes over within 10s).
- HMM invoice settlement via bridge payload.
- Challenge period exercise (submit and resolve a dispute).
- Rate limiting under sustained load.

### Adversarial Tests

- Double-spend attempts (replay same lock event with same nonce).
- Validator collusion (6 malicious validators, verify bridge holds with 5
  honest: 6 < 7 threshold).
- Volume spike (10x normal volume in 10 minutes, verify rate limiting and
  anomaly detection trigger pause).
- Network partition (Hanzo and Lux cannot communicate for 1 hour, verify
  graceful pause and recovery).
- Forged Merkle proof (invalid proof against valid state root).

### Performance Benchmarks

| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| Bridge latency (lock to mint) | < 10s | End-to-end timer |
| Throughput | > 100 transfers/min | Sustained load test |
| Validator signature collection | < 5s for 7-of-11 | Coordination timer |
| Relayer failover | < 10s | Kill primary, measure recovery |
| Merkle proof verification | < 50ms on-chain | Gas profiling |
| ML-DSA-65 verification | < 10ms per sig | Precompile benchmark |

## Implementation Plan

## Dependencies

| Dependency | HIP/LP | Status | Required For |
|-----------|--------|--------|-------------|
| $AI Token | HIP-0001 | Draft | Native asset bridging |
| Post-Quantum Security | HIP-0005 | Final | ML-DSA-65 signatures |
| HMM Market Maker | HIP-0008 | Draft | Compute invoice settlement |
| Hanzo Sovereign L1 | HIP-0024 | Final | Lock Vault deployment, chain ID 36963 |
| Lux PQC | LP-100 | Final | ML-DSA-65 on Lux side |
| Lux Cross-Chain Messaging | LP-226 | Draft | Warp message compatibility |

## Rationale

### Why 0.1% Fee

The fee must be:
- **Low enough** that it does not deter legitimate usage, especially for compute
  settlement where margins are thin.
- **High enough** to compensate validators for operational costs (monitoring,
  signing, key management, infrastructure).
- **Comparable** to other bridge protocols (Wormhole: 0% subsidized; LayerZero:
  variable; most bridges: 0.05-0.3%).

The 10% allocation to the insurance fund creates a growing reserve to cover
potential bridge incidents without relying on external insurance.

## References

- [HIP-0001: $AI Token](./hip-0001-ai-coin-hanzos-native-currency.md)
- [HIP-0005: Post-Quantum Security](./hip-0005-post-quantum-security-for-ai-infrastructure.md)
- [HIP-0008: HMM Market Maker](./hip-0008-hmm-hanzo-market-maker-native-dex-for-ai-compute-resources.md)
- [HIP-0024: Hanzo Sovereign L1](./hip-0024-hanzo-sovereign-l1-chain-architecture.md)
- [LP-100: Lux Post-Quantum Cryptography](https://lps.lux.network/lp-100)
- [LP-226: Enhanced Cross-Chain Communication](https://lps.lux.network/lp-226)
- [FIPS 204: ML-DSA (CRYSTALS-Dilithium)](https://csrc.nist.gov/pubs/fips/204/final)
- [FIPS 203: ML-KEM (CRYSTALS-Kyber)](https://csrc.nist.gov/pubs/fips/203/final)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
