---
hip: 0020
title: Blockchain Node Standard
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2025-01-09
updated: 2026-02-23
requires: 0000, 0001, 0008, 0019, 0023
---

# HIP-20: Blockchain Node Standard

## Abstract

This proposal defines the standard for Hanzo Node, a Rust-based blockchain node optimized for decentralized AI compute coordination. Hanzo Node uses libp2p for peer-to-peer networking, gossipsub for message propagation, RocksDB for persistent state, Candle (HIP-0019) for on-node tensor operations, and Proof of AI (PoAI) for consensus. It settles periodically to the Lux Network L1 for finality via the luxfi bridge libraries.

All nodes participating in the Hanzo compute network MUST implement this specification. The protocol defines peer discovery, compute job lifecycle, GPU inventory advertisement, block structure, transaction types, RPC interface, and settlement mechanics.

**Repository**: [github.com/hanzoai/node](https://github.com/hanzoai/node)
**Language**: Rust
**Networking**: libp2p (rust-libp2p)
**Consensus**: Proof of AI (PoAI), derived from ZIP-002

## Motivation

Hanzo operates a decentralized compute network that coordinates AI inference and training jobs across heterogeneous GPU providers. This network requires a purpose-built blockchain node -- not a general-purpose chain runtime -- because AI compute coordination has requirements that no existing node software satisfies together.

### 1. Sub-second coordination latency

AI inference requests have latency budgets measured in hundreds of milliseconds. A user asking a question to a chat interface expects a first-token response in under 500ms. The coordination layer that assigns that request to a GPU provider, routes the prompt, and streams the response cannot add seconds of overhead. General-purpose L1 chains finalize blocks in 1-4 seconds at best. Hanzo Node targets 200ms block intervals for compute coordination, with the understanding that final economic settlement happens on Lux L1 at a slower cadence.

### 2. GPU-aware scheduling requires chain-level state

The node must maintain a real-time inventory of GPU resources across the network: which nodes have which GPUs, how much VRAM is free, what models are loaded, and what their current utilization is. This is not application-level state that can sit in a smart contract -- it changes on every block and drives consensus-critical scheduling decisions. The node must natively understand GPU capabilities.

### 3. Compute verification is not EVM-compatible

Proof of AI consensus requires verifying that a node actually performed a specified inference computation and produced the correct output. This verification involves running a subset of tensor operations (via Candle) and comparing results. EVM opcodes cannot express matrix multiplication on 16-bit floating point tensors. The verification logic must be native to the node runtime.

### 4. Settlement separation reduces validator hardware requirements

If every validator must re-execute every AI inference to verify it, the hardware requirements become the same as the compute providers themselves -- defeating the purpose of a decentralized network. By separating fast coordination (Hanzo Node) from final settlement (Lux L1), we allow lightweight validators to participate in ordering and scheduling while only a subset of nodes perform full compute verification.

### 5. Economic settlement needs an established L1

AI compute payments must be settled on a chain with established economic security, not a new chain bootstrapping its validator set. Lux Network provides this settlement layer. Hanzo Node checkpoints state roots and payment summaries to Lux L1 at regular intervals, inheriting its finality guarantees for economic transactions while maintaining independent fast finality for compute coordination.

### 6. Existing node software does not fit

Lux Node (Go, Snow consensus) is designed for general-purpose L1 operation with VM plugins. Ethereum clients are designed for EVM execution. Cosmos SDK nodes are designed for application-specific chains with Tendermint consensus. None of them natively support GPU inventory management, AI inference verification, sub-200ms block production, or tensor operation verification. Building on any of these would require replacing so many components that forking provides no advantage over a purpose-built implementation.

## Design Philosophy

This section explains the reasoning behind every major architectural choice. None of these decisions are arbitrary -- each follows from a specific constraint of the AI compute coordination problem.

### Why Rust

The choice of Rust over Go, C++, or Java is driven by three hard requirements of consensus-critical code.

**Memory safety without garbage collection.** Consensus code must be deterministic. Two validators processing the same block must arrive at the same state. Garbage collection introduces non-deterministic pauses -- a GC cycle during block production can cause a validator to miss its slot, triggering unnecessary view changes and reducing network throughput. Rust eliminates this class of failure through compile-time ownership tracking. Memory is freed deterministically when values go out of scope.

Go (used by Lux Node and most Ethereum clients) has a concurrent garbage collector that is well-tuned for server workloads but still introduces tail latency spikes. For a node producing blocks every 200ms, a 50ms GC pause means missing 25% of a block interval. Rust has zero GC pauses because it has no GC.

**Deterministic execution for validators.** When two validators execute the same transaction, they must produce identical state transitions. C++ allows this but provides no protection against undefined behavior -- a buffer overflow or use-after-free in consensus code means validators silently diverge. Rust's type system prevents undefined behavior at compile time. If it compiles, the execution is deterministic (modulo floating point, which we handle with fixed-point arithmetic in consensus-critical paths).

**Safe concurrency for parallel verification.** Compute verification involves running tensor operations across multiple CPU cores simultaneously. In C++, parallelizing matrix multiplication requires careful manual synchronization to avoid data races. In Go, goroutines with shared state require mutex discipline that the compiler does not enforce. Rust's ownership model makes data races a compile-time error. If you can express the parallelism, it is correct by construction.

The tradeoff is development velocity. Rust's learning curve is steeper than Go's, and compile times are longer. We accept this because node software is infrastructure that changes infrequently once correct. The operational benefits -- zero GC pauses, no segfaults, no data races -- compound across every block produced by every validator for the lifetime of the network.

### Why libp2p Over Custom Networking

Peer-to-peer networking is the most complex and security-sensitive component of any blockchain node. It handles NAT traversal, peer discovery, connection multiplexing, protocol negotiation, encryption, and denial-of-service resistance. Building this from scratch would take years and produce a less battle-tested result.

libp2p is the networking layer used by IPFS, Filecoin, Polkadot, and Ethereum's consensus layer (Prysm, Lighthouse, Teku). It has been running in production across thousands of nodes since 2018. The rust-libp2p implementation specifically is used by Polkadot (Substrate) and Filecoin (Forest), giving us confidence in its Rust correctness and performance.

libp2p provides out of the box:

- **NAT traversal**: Relay protocols, hole punching, and AutoNAT detection so nodes behind firewalls can participate without manual port forwarding
- **Peer discovery**: mDNS for local network discovery, Kademlia DHT for global discovery, and bootstrap node lists for initial connection
- **Connection multiplexing**: Yamux allows multiple protocol streams over a single TCP or QUIC connection, reducing connection overhead
- **Transport encryption**: Noise protocol for authenticated encryption on every connection, preventing MITM attacks
- **Protocol negotiation**: Multistream-select allows nodes to negotiate which protocols they support, enabling graceful upgrades
- **Peer scoring**: Application-level scoring to deprioritize misbehaving peers without disconnecting them

The alternative -- building custom networking on raw TCP or QUIC -- would require reimplementing all of these. Lux Node's custom networking layer, for example, has had multiple CVEs related to connection handling and peer management. By using libp2p, we inherit fixes from a community of hundreds of contributors across multiple production networks.

### Why Not Fork Lux Node

Lux Node is written in Go and implements the Snow consensus family (Snowman, Snowball) for general-purpose L1 blockchain operation. It supports pluggable Virtual Machines (AVM, PlatformVM, EVM) and is designed for multi-chain architectures. Forking it and adding AI compute features would seem like a shortcut, but it is not.

**Different language, different guarantees.** Lux Node is Go. Our compute verification layer uses Candle, which is Rust. Calling Rust from Go via CGo introduces FFI overhead, complicates the build system, and loses Rust's safety guarantees at the boundary. A pure Rust node can call Candle natively with zero overhead.

**Different consensus requirements.** Snow consensus achieves finality through repeated random subsampling, which provides excellent performance for general-purpose transaction ordering. But AI compute coordination needs a different property: task-assignment consensus, where the network must agree not just on transaction order but on which node should execute which compute job. This requires compute-aware leader election that Snow was not designed for.

**Different block intervals.** Lux Node targets 1-2 second block times, appropriate for financial transactions. Compute coordination needs 200ms blocks to keep scheduling latency low. Retrofitting faster block production into Snow consensus would require fundamental changes to the protocol parameters and networking assumptions.

**Different state model.** Lux Node's state is UTXO-based (X-Chain) or account-based (C-Chain). Hanzo Node's state includes GPU inventories, active compute sessions, model registries, and inference result caches. These are fundamentally different data structures that would not benefit from Lux Node's existing state management.

The Lux relationship is at the settlement layer, not the node layer. Hanzo Node checkpoints its state to Lux L1 for economic finality, using the luxfi Rust SDK for bridge operations. This is a clean integration boundary -- Hanzo Node is a client of Lux, not a fork of it.

### Why Gossipsub for Message Propagation

Blockchain nodes need to propagate messages (blocks, transactions, compute assignments) to all peers efficiently. There are three common approaches: flooding, structured overlays, and gossip protocols.

**Flooding** (used by Bitcoin) forwards every message to every connected peer. This is simple but creates O(n * degree) message copies per propagation, wasting bandwidth and enabling amplification attacks.

**Structured overlays** (used by some DHT-based systems) route messages along specific paths. This is bandwidth-efficient but fragile -- if routing nodes fail, messages are delayed or lost.

**Gossipsub** (libp2p's pubsub protocol, used by Ethereum 2.0) combines the reliability of flooding with the efficiency of structured overlays. It maintains a mesh of peers per topic and forwards messages within the mesh, with random grafting and pruning to maintain connectivity. Key properties:

- **Spam resistance**: Peer scoring penalizes nodes that send invalid messages or flood excessively. Misbehaving peers are pruned from the mesh automatically.
- **Message deduplication**: Each message has a unique ID. Nodes track seen IDs and drop duplicates, preventing amplification.
- **Topic-based routing**: Different message types (blocks, transactions, compute assignments) flow through separate topics, preventing interference between high-frequency inventory updates and latency-critical block propagation.
- **Adaptive mesh maintenance**: The mesh self-heals when peers join or leave, maintaining target connectivity without centralized coordination.

Each gossipsub topic maintains an independent mesh with a target degree of 6 peers (D=6), a lower bound of 4 (D_lo=4), and an upper bound of 12 (D_hi=12). These parameters balance propagation speed against bandwidth consumption.

### Why Proof of AI Consensus

Traditional consensus mechanisms waste resources. Proof of Work directs computation toward finding hash preimages -- a problem with no value beyond securing the chain. Proof of Stake replaces computation with capital lockup, which is more efficient but does not produce useful work.

Proof of AI (PoAI), specified in ZIP-002, directs validator computation toward useful AI inference. The core insight is that AI inference is already a computationally expensive operation that produces verifiable outputs. If validators must perform inference to produce blocks, the network simultaneously secures the chain and serves real AI workloads.

The PoAI verification mechanism works as follows:

1. A block producer includes a set of inference results (model input, model identifier, output) in the block
2. Verifying validators re-execute a random subset of these inferences using Candle
3. If the results match within a floating-point tolerance, the block is accepted
4. If results diverge, the block is rejected and the producer is slashed

The random subset verification makes full re-execution unnecessary. If a verifier checks 10% of inferences and they all match, the probability of undetected cheating on the remaining 90% is negligible (assuming the cheater cannot predict which subset will be checked). This allows lightweight validators to participate in consensus without owning the same GPU hardware as compute providers.

### Why Separate from Lux

Hanzo Node and Lux Node serve different roles in the stack, analogous to how an application server and a database serve different roles in web infrastructure.

**Lux provides economic settlement.** When a compute provider completes a job and earns $AI tokens, that payment must be finalized on a chain with strong economic security. Lux L1 has an established validator set, significant stake, and proven consensus. It is the right layer for irreversible value transfer.

**Hanzo provides compute coordination.** Assigning an inference job to a specific GPU, routing the request, streaming the response, and verifying the result must happen in sub-second timeframes. This coordination does not need the same finality guarantees as a token transfer -- if a job assignment is reversed, the worst case is that the job is re-assigned and re-executed, not that funds are lost.

The two-layer design separates concerns:

```
                    Finality
                    Latency     Throughput    Security Model
                    --------    ----------    --------------
Lux L1 (Settlement) 2-4s        4500 TPS      Economic (staked LUX)
Hanzo Node (Coord)   200ms       10000+ TPS    Compute (PoAI)
```

Settlement occurs via periodic checkpoints. Every N Hanzo blocks (configurable, default 100 -- approximately every 20 seconds), the node posts a state root and payment summary to Lux L1 via the luxfi bridge. This gives Lux-level finality to economic outcomes while keeping coordination latency independent.

## Specification

### Node Architecture

A Hanzo Node consists of four major subsystems, each responsible for a distinct concern.

```
+------------------------------------------------------------------+
|                        Hanzo Node                                 |
+------------------------------------------------------------------+
|                                                                    |
|  +-------------------+    +-------------------+                    |
|  |    Networking      |    |    Consensus      |                    |
|  |    (libp2p)        |<-->|    (PoAI)         |                    |
|  |                    |    |                    |                    |
|  | - Gossipsub        |    | - Block production |                    |
|  | - Kademlia DHT     |    | - PoAI verification|                    |
|  | - mDNS             |    | - Leader election  |                    |
|  | - Request/Response |    | - Slashing         |                    |
|  +-------------------+    +-------------------+                    |
|           |                        |                               |
|           v                        v                               |
|  +-------------------+    +-------------------+                    |
|  |    Execution       |    |    Storage         |                    |
|  |    (Candle)        |    |    (RocksDB)       |                    |
|  |                    |    |                    |                    |
|  | - Inference verify |    | - Block store      |                    |
|  | - Tensor ops       |    | - State trie       |                    |
|  | - Model loading    |    | - GPU inventory    |                    |
|  | - Result hashing   |    | - Transaction pool |                    |
|  +-------------------+    +-------------------+                    |
|                                                                    |
+------------------------------------------------------------------+
          |                    |                      |
          v                    v                      v
   JSON-RPC API         Lux Settlement         Metrics/Logs
   (port 8545)          (luxfi bridge)         (Prometheus)
```

#### Networking Subsystem (libp2p)

Handles all peer-to-peer communication. Implemented with rust-libp2p v0.54+.

```rust
use libp2p::{
    gossipsub, identify, kad, mdns, noise, ping,
    swarm::NetworkBehaviour, tcp, yamux, PeerId, Swarm,
};

#[derive(NetworkBehaviour)]
pub struct HanzoNodeBehaviour {
    /// Gossipsub for block/tx/compute propagation
    pub gossipsub: gossipsub::Behaviour,
    /// Kademlia DHT for global peer discovery
    pub kademlia: kad::Behaviour<kad::store::MemoryStore>,
    /// mDNS for local network peer discovery
    pub mdns: mdns::tokio::Behaviour,
    /// Identify protocol for peer metadata exchange
    pub identify: identify::Behaviour,
    /// Ping for liveness detection
    pub ping: ping::Behaviour,
    /// Request/response for direct queries (state sync, block fetch)
    pub request_response: request_response::cbor::Behaviour<NodeRequest, NodeResponse>,
}
```

Transport configuration uses Noise encryption and Yamux multiplexing:

```rust
let transport = tcp::tokio::Transport::new(tcp::Config::default())
    .upgrade(upgrade::Version::V1Lazy)
    .authenticate(noise::Config::new(&local_keypair)?)
    .multiplex(yamux::Config::default())
    .boxed();
```

All connections are encrypted with the Noise protocol (XX handshake pattern). Multiplexing uses Yamux, which supports up to 256 concurrent streams per connection.

#### Consensus Subsystem (PoAI)

Implements Proof of AI consensus. The consensus cycle operates on 200ms block intervals.

```rust
pub struct PoAIConsensus {
    /// Current validator set with staking weights
    validators: ValidatorSet,
    /// Candle runtime for inference verification
    verifier: InferenceVerifier,
    /// Random beacon for subset selection
    vrf: VRFSigner,
    /// Current round state
    round: RoundState,
}

impl PoAIConsensus {
    /// Determine if this node should produce the next block.
    /// Leader election is weighted by stake and compute capacity.
    pub fn is_leader(&self, slot: u64) -> bool {
        let seed = self.vrf.evaluate(slot);
        let threshold = self.validators.leader_threshold(&self.local_id);
        seed < threshold
    }

    /// Verify a block's PoAI proofs by re-executing a random subset.
    pub async fn verify_block(&self, block: &Block) -> Result<bool, ConsensusError> {
        let subset = self.select_verification_subset(block, 0.10); // 10%
        for proof in subset {
            let expected = self.verifier.run_inference(
                &proof.model_id,
                &proof.input,
            ).await?;
            if !proof.output.approx_eq(&expected, TOLERANCE) {
                return Ok(false);
            }
        }
        Ok(true)
    }
}
```

#### Execution Subsystem (Candle)

Provides tensor operations for PoAI verification. Uses Hanzo Candle (HIP-0019) for inference execution. This subsystem does not serve user-facing inference -- it only verifies that compute providers produced correct results.

```rust
pub struct InferenceVerifier {
    /// Loaded model weights (verification-only, may be quantized)
    models: HashMap<ModelId, candle_nn::VarMap>,
    /// Candle device (CPU for verification; GPU optional)
    device: candle_core::Device,
}

impl InferenceVerifier {
    /// Re-execute inference and return output hash for comparison.
    pub async fn run_inference(
        &self,
        model_id: &ModelId,
        input: &InferenceInput,
    ) -> Result<InferenceOutput, VerifyError> {
        let model = self.models.get(model_id)
            .ok_or(VerifyError::ModelNotLoaded(model_id.clone()))?;
        let tensor = candle_core::Tensor::from_slice(
            &input.tokens,
            &[1, input.tokens.len()],
            &self.device,
        )?;
        let output = model.forward(&tensor)?;
        Ok(InferenceOutput::from_tensor(output))
    }
}
```

Verification uses CPU by default. Validators are not required to own GPUs -- they only need enough compute to re-execute 10% of inferences per block. A modern 32-core server can verify blocks in real time without a GPU.

#### Storage Subsystem (RocksDB)

Persistent state storage uses RocksDB with column families for logical separation.

```rust
pub struct NodeStorage {
    db: rocksdb::DB,
}

// Column families
const CF_BLOCKS: &str = "blocks";           // Block headers and bodies
const CF_STATE: &str = "state";             // Current state trie
const CF_TRANSACTIONS: &str = "transactions"; // Transaction index
const CF_INVENTORY: &str = "inventory";     // GPU inventory snapshots
const CF_COMPUTE: &str = "compute";         // Active compute sessions
const CF_CHECKPOINTS: &str = "checkpoints"; // Lux settlement checkpoints
```

State is stored as a Merkle Patricia Trie, enabling efficient state proofs for Lux L1 checkpointing. The state root is included in every block header.

### Peer Discovery

Hanzo Node uses a three-tier discovery mechanism to find and connect to peers.

#### Tier 1: Bootstrap Nodes (Initial Connection)

New nodes connect to a hardcoded list of well-known bootstrap nodes operated by Hanzo and community partners. These nodes are stable, long-running, and have high uptime SLAs.

```rust
const BOOTSTRAP_NODES: &[&str] = &[
    "/dns4/boot1.hanzo.ai/tcp/9000/p2p/12D3KooW...",
    "/dns4/boot2.hanzo.ai/tcp/9000/p2p/12D3KooW...",
    "/dns4/boot3.hanzo.ai/tcp/9000/p2p/12D3KooW...",
    "/dns4/boot-us.hanzo.network/tcp/9000/p2p/12D3KooW...",
    "/dns4/boot-eu.hanzo.network/tcp/9000/p2p/12D3KooW...",
    "/dns4/boot-ap.hanzo.network/tcp/9000/p2p/12D3KooW...",
];
```

Bootstrap nodes serve only for initial peer discovery. Once a node has discovered peers through the DHT, it no longer depends on bootstrap nodes.

#### Tier 2: Kademlia DHT (Global Discovery)

After connecting to bootstrap nodes, the node joins the Kademlia DHT to discover the full peer set. The DHT stores peer multiaddresses keyed by peer ID.

```rust
let mut kademlia_config = kad::Config::default();
kademlia_config.set_query_timeout(Duration::from_secs(30));
kademlia_config.set_record_ttl(Some(Duration::from_secs(3600)));
kademlia_config.set_replication_factor(
    NonZeroUsize::new(20).unwrap()
);

let kademlia = kad::Behaviour::new(
    local_peer_id,
    kad::store::MemoryStore::new(local_peer_id),
);
```

Nodes perform a DHT walk every 5 minutes to discover new peers and refresh routing table entries.

#### Tier 3: mDNS (Local Network)

For development and private deployments, mDNS discovers peers on the local network without any external infrastructure.

```rust
let mdns = mdns::tokio::Behaviour::new(
    mdns::Config {
        ttl: Duration::from_secs(300),
        query_interval: Duration::from_secs(60),
        enable_ipv6: false,
    },
    local_peer_id,
)?;
```

### Network Topology

The gossipsub mesh forms the primary communication fabric.

```
                  Bootstrap Nodes (well-known, DNS-routable)
                  /             |               \
                 v              v                v
          [DHT Discovery via Kademlia across all peers]
                 |              |                |
                 v              v                v
          Gossipsub Mesh (topic-based, self-healing)
          +---------------------------------------------+
          |                                             |
          |  /hanzo/blocks/1.0.0                        |
          |    Block headers + bodies                   |
          |    Propagation target: < 100ms              |
          |                                             |
          |  /hanzo/compute/1.0.0                       |
          |    Job submissions + assignments            |
          |    Propagation target: < 50ms               |
          |                                             |
          |  /hanzo/inference/1.0.0                     |
          |    Inference requests + streaming results   |
          |    Propagation target: < 50ms               |
          |                                             |
          |  /hanzo/state/1.0.0                         |
          |    State sync requests + responses          |
          |    On-demand (new node joining)              |
          |                                             |
          |  /hanzo/inventory/1.0.0                     |
          |    GPU capability advertisements            |
          |    Heartbeat interval: 30s                  |
          |                                             |
          +---------------------------------------------+
                           |
                           v
                 Lux L1 (Settlement Layer)
                 Checkpoint every ~20s
```

### P2P Protocol Identifiers

All Hanzo Node protocols use the following identifiers for multistream-select negotiation.

| Protocol | Identifier | Transport | Description |
|----------|-----------|-----------|-------------|
| Block Gossip | `/hanzo/blocks/1.0.0` | Gossipsub | Block propagation |
| Compute Gossip | `/hanzo/compute/1.0.0` | Gossipsub | Job coordination |
| Inference Gossip | `/hanzo/inference/1.0.0` | Gossipsub | Inference routing |
| State Sync | `/hanzo/state/1.0.0` | Gossipsub | State announcements |
| Inventory | `/hanzo/inventory/1.0.0` | Gossipsub | GPU advertisements |
| Block Fetch | `/hanzo/block-fetch/1.0.0` | Request/Response | Historical block retrieval |
| State Fetch | `/hanzo/state-fetch/1.0.0` | Request/Response | State trie queries |
| Peer Info | `/hanzo/peer-info/1.0.0` | Request/Response | Node capability queries |

### Block Structure

Every block consists of a header and a body. The header is sufficient for consensus validation. The body contains the full transaction and compute result data.

```rust
/// Block header. Fixed-size (approximately 256 bytes serialized).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BlockHeader {
    /// Block number (monotonically increasing)
    pub height: u64,
    /// Timestamp (Unix milliseconds)
    pub timestamp: u64,
    /// SHA-256 hash of the previous block header
    pub prev_hash: [u8; 32],
    /// Merkle root of all transactions in the body
    pub tx_merkle_root: [u8; 32],
    /// Merkle root of all compute results in the body
    pub compute_merkle_root: [u8; 32],
    /// State trie root after applying this block
    pub state_root: [u8; 32],
    /// Block producer's peer ID
    pub producer: PeerId,
    /// VRF proof for leader election
    pub vrf_proof: VRFProof,
    /// PoAI proof: references to verified inferences
    pub ai_proof: AIProof,
    /// Block producer's Ed25519 signature over the header
    pub signature: [u8; 64],
}

/// Block body. Variable size.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BlockBody {
    /// Ordered list of transactions
    pub transactions: Vec<Transaction>,
    /// Compute results included in this block
    pub compute_results: Vec<ComputeResult>,
    /// GPU inventory updates (heartbeats received this block)
    pub inventory_updates: Vec<InventoryUpdate>,
}

/// PoAI proof included in every block header.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AIProof {
    /// Number of inference computations performed by the producer
    pub inference_count: u32,
    /// Hashes of inference inputs used
    pub input_hashes: Vec<[u8; 32]>,
    /// Hashes of inference outputs produced
    pub output_hashes: Vec<[u8; 32]>,
    /// Model identifiers used
    pub model_ids: Vec<ModelId>,
    /// Total FLOPs expended (self-reported, verified by subset check)
    pub total_flops: u64,
}
```

### Transaction Types

Hanzo Node supports six transaction types, each serving a distinct function in the compute coordination lifecycle.

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum TransactionType {
    /// Request AI compute (inference or training)
    ComputeRequest(ComputeRequestData),
    /// Report completed compute with results
    ComputeResult(ComputeResultData),
    /// Lock $AI tokens as validator/provider stake
    Stake(StakeData),
    /// Begin unstaking with cooldown period
    Unstake(UnstakeData),
    /// Transfer $AI tokens between accounts
    Transfer(TransferData),
    /// Update GPU inventory advertisement
    InventoryUpdate(InventoryData),
}
```

#### ComputeRequest

Submitted by clients requesting AI inference or training.

```rust
pub struct ComputeRequestData {
    /// Unique job identifier (client-generated UUID)
    pub job_id: [u8; 16],
    /// Type of compute: Inference, Training, Embedding, FineTune
    pub job_type: JobType,
    /// Model to use (e.g., "zen-72b", "zen-8b-instruct")
    pub model_id: ModelId,
    /// Serialized input (prompt tokens, training data reference, etc.)
    pub input: Vec<u8>,
    /// Maximum $AI tokens the client will pay
    pub max_fee: u64,
    /// Required GPU constraints (min VRAM, min TFLOPS)
    pub gpu_requirements: GpuRequirements,
    /// Maximum acceptable latency in milliseconds
    pub latency_budget_ms: u32,
    /// Client's public key for result encryption
    pub client_pubkey: [u8; 32],
}
```

#### ComputeResult

Submitted by compute providers upon job completion.

```rust
pub struct ComputeResultData {
    /// References the original ComputeRequest job_id
    pub job_id: [u8; 16],
    /// Provider's peer ID
    pub provider: PeerId,
    /// Serialized output (generated tokens, training metrics, etc.)
    pub output: Vec<u8>,
    /// SHA-256 hash of the output for quick verification
    pub output_hash: [u8; 32],
    /// Execution time in milliseconds
    pub execution_time_ms: u64,
    /// GPU used (from inventory)
    pub gpu_id: GpuId,
    /// Actual $AI fee charged (must be <= max_fee from request)
    pub fee: u64,
}
```

### Compute Job State Machine

Every compute job progresses through a deterministic state machine tracked in the chain state.

```
                   ComputeRequest tx
                         |
                         v
                    +---------+
                    | Pending |  (in mempool, awaiting assignment)
                    +---------+
                         |
                    Scheduler assigns to provider
                         |
                         v
                    +----------+
                    | Assigned |  (provider notified via gossipsub)
                    +----------+
                         |
                    Provider begins execution
                         |
                         v
                    +-----------+
                    | Computing |  (provider executing inference/training)
                    +-----------+
                         |
                    ComputeResult tx submitted
                         |
                         v
                    +-----------+
                    | Verifying |  (PoAI subset verification in progress)
                    +-----------+
                        / \
                       /   \
                 pass /     \ fail
                     v       v
              +-----------+  +-----------+
              | Complete  |  | Disputed  |
              +-----------+  +-----------+
                   |               |
              Payment released   Slash + reassign
```

**Timeout rules:**
- Pending to Assigned: 5 seconds. If no provider is assigned, the job is returned to Pending for the next scheduling round.
- Assigned to Computing: 10 seconds. If the provider does not begin, the assignment is revoked and the provider's score is penalized.
- Computing to Verifying: Depends on `latency_budget_ms` from the request. If the provider exceeds the budget, the job is reassigned.
- Verifying to Complete/Disputed: 2 block intervals (400ms). Verification is fast because it checks only a subset.

### GPU Inventory Protocol

Compute providers advertise their GPU capabilities via the `/hanzo/inventory/1.0.0` gossipsub topic. Advertisements are sent every 30 seconds and included in block bodies for state tracking.

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct InventoryUpdate {
    /// Provider's peer ID
    pub provider: PeerId,
    /// List of available GPUs
    pub gpus: Vec<GpuCapability>,
    /// Current overall utilization (0.0 to 1.0)
    pub utilization: f32,
    /// Models currently loaded in VRAM
    pub loaded_models: Vec<ModelId>,
    /// Network bandwidth (Mbps, measured)
    pub bandwidth_mbps: u32,
    /// Geographic region (ISO 3166-1 alpha-2)
    pub region: String,
    /// Timestamp and signature
    pub timestamp: u64,
    pub signature: [u8; 64],
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GpuCapability {
    /// Unique identifier for this GPU on this node
    pub gpu_id: GpuId,
    /// GPU model name (e.g., "NVIDIA H100 SXM5 80GB")
    pub model: String,
    /// Total VRAM in megabytes
    pub vram_total_mb: u32,
    /// Available (free) VRAM in megabytes
    pub vram_free_mb: u32,
    /// Peak TFLOPS (FP16)
    pub tflops_fp16: f32,
    /// Peak TFLOPS (INT8)
    pub tflops_int8: f32,
    /// CUDA compute capability (e.g., 9.0 for H100)
    pub compute_capability: f32,
    /// Backend: CUDA, ROCm, Metal
    pub backend: GpuBackend,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum GpuBackend {
    Cuda,
    Rocm,
    Metal,
}
```

The scheduler uses GPU inventory to make placement decisions. A ComputeRequest specifying `min_vram: 40000` (40 GB) for a 70B parameter model will only be assigned to providers with GPUs reporting `vram_free_mb >= 40000`.

### Scheduling Algorithm

The scheduler runs on every block producer and assigns pending ComputeRequests to available providers. The algorithm optimizes for three objectives in priority order:

1. **Feasibility**: The provider must have sufficient GPU resources (VRAM, compute capability, loaded model)
2. **Latency**: Prefer providers geographically closer to the client and with lower current utilization
3. **Cost**: Among feasible, low-latency providers, prefer the lowest fee

```rust
pub fn schedule_job(
    job: &ComputeRequest,
    inventory: &InventoryState,
) -> Option<PeerId> {
    let mut candidates: Vec<(PeerId, f64)> = inventory
        .providers()
        .filter(|p| p.meets_requirements(&job.gpu_requirements))
        .filter(|p| p.has_model_loaded(&job.model_id)
                  || p.can_load_model(&job.model_id))
        .map(|p| {
            let latency_score = 1.0 / (1.0 + p.estimated_latency_ms as f64);
            let utilization_score = 1.0 - p.utilization as f64;
            let cost_score = 1.0 / (1.0 + p.fee_rate as f64);
            let score = 0.4 * latency_score
                      + 0.3 * utilization_score
                      + 0.3 * cost_score;
            (p.peer_id, score)
        })
        .collect();

    candidates.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    candidates.first().map(|(peer_id, _)| *peer_id)
}
```

Providers that have the requested model already loaded in VRAM receive a significant bonus because they avoid the cold-start latency of model loading (which can take 10-60 seconds for large models).

### RPC API

Hanzo Node exposes a JSON-RPC 2.0 API on port 8545 (configurable). The API is divided into namespaces.

#### hanzo_* Namespace (Compute Operations)

```json
// Submit a compute request
{
    "jsonrpc": "2.0",
    "method": "hanzo_submitCompute",
    "params": [{
        "job_type": "inference",
        "model_id": "zen-72b",
        "input": "base64-encoded-prompt-tokens",
        "max_fee": "1000000",
        "gpu_requirements": {
            "min_vram_mb": 40000,
            "min_tflops_fp16": 100.0
        },
        "latency_budget_ms": 5000
    }],
    "id": 1
}

// Response
{
    "jsonrpc": "2.0",
    "result": {
        "job_id": "550e8400-e29b-41d4-a716-446655440000",
        "status": "pending",
        "estimated_wait_ms": 200
    },
    "id": 1
}

// Query job status
{
    "jsonrpc": "2.0",
    "method": "hanzo_getJobStatus",
    "params": ["550e8400-e29b-41d4-a716-446655440000"],
    "id": 2
}

// Get network GPU inventory
{
    "jsonrpc": "2.0",
    "method": "hanzo_getInventory",
    "params": [{"min_vram_mb": 24000, "backend": "cuda"}],
    "id": 3
}

// Get compute statistics
{
    "jsonrpc": "2.0",
    "method": "hanzo_getStats",
    "params": [],
    "id": 4
}
```

#### chain_* Namespace (Chain State)

```json
// Get latest block
{"jsonrpc": "2.0", "method": "chain_getBlock", "params": ["latest"], "id": 1}

// Get block by height
{"jsonrpc": "2.0", "method": "chain_getBlock", "params": [12345], "id": 2}

// Get transaction by hash
{"jsonrpc": "2.0", "method": "chain_getTransaction", "params": ["0xabc..."], "id": 3}

// Get account balance ($AI tokens)
{"jsonrpc": "2.0", "method": "chain_getBalance", "params": ["0xdef..."], "id": 4}

// Get current validator set
{"jsonrpc": "2.0", "method": "chain_getValidators", "params": [], "id": 5}
```

#### net_* Namespace (Network Information)

```json
// Get connected peer count
{"jsonrpc": "2.0", "method": "net_peerCount", "params": [], "id": 1}

// Get node's peer ID and multiaddresses
{"jsonrpc": "2.0", "method": "net_localInfo", "params": [], "id": 2}

// Get gossipsub mesh health per topic
{"jsonrpc": "2.0", "method": "net_meshHealth", "params": [], "id": 3}
```

### Node Configuration

Nodes are configured via a YAML file. All fields have sensible defaults.

```yaml
# hanzo-node.yaml

# Node identity
identity:
  # Path to Ed25519 keypair (generated on first run if absent)
  keypair: /var/lib/hanzo-node/keypair.json

# Network configuration
network:
  # Listen addresses
  listen:
    - /ip4/0.0.0.0/tcp/9000
    - /ip6/::/tcp/9000
  # Target peer count
  target_peers: 50
  # Maximum peer count
  max_peers: 256
  # Bootstrap nodes (default: Hanzo-operated)
  bootstrap:
    - /dns4/boot1.hanzo.ai/tcp/9000/p2p/12D3KooW...
    - /dns4/boot2.hanzo.ai/tcp/9000/p2p/12D3KooW...
  # Enable mDNS for local discovery
  mdns: true

# Consensus configuration
consensus:
  # Role: validator, provider, or light
  role: validator
  # Minimum stake to produce blocks (in $AI base units)
  min_stake: 2000000000000000000000  # 2000 AI
  # Block interval in milliseconds
  block_interval_ms: 200
  # PoAI verification subset ratio (0.0 to 1.0)
  verification_ratio: 0.10

# Compute configuration (for providers)
compute:
  # Enable compute provider mode
  enabled: false
  # GPU devices to expose
  gpus: auto  # auto-detect, or list specific device indices
  # Models to preload into VRAM
  preload_models:
    - zen-8b-instruct
    - zen-72b
  # Maximum concurrent jobs
  max_concurrent_jobs: 4
  # Fee rate in $AI per TFLOP
  fee_per_tflop: 100

# Storage configuration
storage:
  # RocksDB data directory
  data_dir: /var/lib/hanzo-node/data
  # State pruning (keep last N blocks of full state)
  state_pruning: 10000
  # Block retention (keep last N blocks)
  block_retention: 100000

# RPC configuration
rpc:
  # Enable JSON-RPC API
  enabled: true
  # Listen address
  listen: 127.0.0.1:8545
  # Allowed origins (CORS)
  cors: ["*"]
  # Rate limit (requests per second per IP)
  rate_limit: 100

# Settlement configuration (Lux L1 bridge)
settlement:
  # Lux RPC endpoint
  lux_rpc: https://api.lux.network/ext/bc/C/rpc
  # Checkpoint interval (in Hanzo blocks)
  checkpoint_interval: 100  # ~20 seconds
  # Bridge contract address on Lux
  bridge_contract: "0x..."

# Observability
metrics:
  # Prometheus metrics endpoint
  enabled: true
  listen: 0.0.0.0:9090
```

### Lux L1 Settlement

Hanzo Node settles economic state to Lux L1 via periodic checkpoints. This provides Lux-level finality for $AI token transfers and compute payments.

#### Checkpoint Structure

Every `checkpoint_interval` blocks (default 100, approximately 20 seconds), the block producer constructs a checkpoint.

```rust
#[derive(Serialize, Deserialize)]
pub struct LuxCheckpoint {
    /// Hanzo block height at checkpoint
    pub hanzo_height: u64,
    /// State root at this height
    pub state_root: [u8; 32],
    /// Merkle root of all payments since last checkpoint
    pub payments_root: [u8; 32],
    /// Total $AI transferred in this checkpoint period
    pub total_volume: u64,
    /// Number of compute jobs completed
    pub jobs_completed: u32,
    /// Validator signatures (2/3+ threshold)
    pub signatures: Vec<ValidatorSignature>,
}
```

#### Bridge Contract

The checkpoint is submitted to a bridge contract on Lux C-Chain using the luxfi Rust SDK.

```rust
use luxfi_sdk::bridge::{BridgeClient, CheckpointSubmission};

pub async fn submit_checkpoint(
    checkpoint: &LuxCheckpoint,
    lux_rpc: &str,
    bridge_contract: &str,
) -> Result<TxHash, BridgeError> {
    let client = BridgeClient::new(lux_rpc, bridge_contract)?;
    let submission = CheckpointSubmission {
        hanzo_height: checkpoint.hanzo_height,
        state_root: checkpoint.state_root,
        payments_root: checkpoint.payments_root,
        total_volume: checkpoint.total_volume,
        signatures: &checkpoint.signatures,
    };
    client.submit_checkpoint(submission).await
}
```

The bridge contract on Lux verifies that 2/3+ of Hanzo validators signed the checkpoint before accepting it. Once accepted, the checkpoint is final on Lux L1 and cannot be reverted.

### Integration Points

#### LLM Gateway (HIP-0004)

The LLM Gateway routes inference requests to the Hanzo Node network when decentralized compute is selected as a backend.

```
Client Request
    |
    v
LLM Gateway (port 4000)
    |
    |-- Provider: openai    --> OpenAI API
    |-- Provider: anthropic --> Anthropic API
    |-- Provider: hanzo     --> Hanzo Node RPC (hanzo_submitCompute)
    |                              |
    |                              v
    |                        Gossipsub propagation
    |                              |
    |                              v
    |                        Compute provider executes
    |                              |
    |                              v
    |                        Result returned via gossipsub
    |
    v
Client Response (streaming)
```

#### HMM Market Maker (HIP-0008)

Compute pricing is determined by the Hamiltonian Market Maker. Providers set base fee rates, but actual prices are adjusted by HMM based on real-time supply and demand across the GPU inventory.

```
Provider fee_per_tflop: 100 $AI
Network utilization:     85%
HMM price adjustment:   1.4x
Effective price:         140 $AI per TFLOP
```

When network utilization is low, HMM reduces effective prices to attract demand. When utilization is high, prices increase to incentivize new providers to join.

#### Candle Tensor Engine (HIP-0019)

Candle is used in two contexts within Hanzo Node:

1. **Verification**: Validators re-execute inference subsets to verify PoAI proofs. This uses CPU-only Candle with quantized model weights.
2. **Provider execution**: Compute providers run full inference using GPU-accelerated Candle. This is the actual useful computation that earns $AI tokens.

#### Lux Network (Settlement)

All economic settlement uses luxfi packages. The node never imports go-ethereum or ava-labs libraries.

```toml
# Cargo.toml dependencies for Lux integration
[dependencies]
luxfi-sdk = "1.4"
luxfi-bridge = "1.2"
luxfi-types = "1.1"
```

## Security Considerations

### Sybil Resistance

Staking 2000 $AI to become a validator provides economic Sybil resistance. Creating multiple validator identities requires proportionally more capital.

### Eclipse Attacks

libp2p's Kademlia DHT is susceptible to eclipse attacks where an adversary surrounds a target node with malicious peers. Mitigations:

- Maintain connections to bootstrap nodes at all times (not just at startup)
- Require a minimum of 4 outbound connections to unique /24 subnets
- Peer scoring in gossipsub deprioritizes peers that provide invalid data

### Inference Result Manipulation

A dishonest compute provider could return incorrect inference results. PoAI subset verification detects this with high probability:

- 10% verification rate: 65% chance of detecting a single false result per block
- Across 10 blocks: 99.97% detection probability
- Detection triggers slashing of the provider's stake

The verification ratio can be increased for high-value computations at the cost of higher validator CPU usage.

### Denial of Service

Rate limiting at multiple layers:

- libp2p connection limits: max 256 peers
- Gossipsub message rate: max 100 messages/second per peer per topic
- RPC rate limiting: configurable per IP (default 100 req/s)
- ComputeRequest requires $AI fee commitment (spam costs money)

### Settlement Bridge Security

The Lux bridge contract requires 2/3+ validator signatures on each checkpoint. A compromised minority of validators cannot submit false checkpoints. The bridge contract on Lux L1 validates signature thresholds before accepting state updates.

## Test Vectors

### Block Header Hash (Genesis)

```json
{
    "height": 0,
    "timestamp": 1706140800000,
    "prev_hash": "0000000000000000000000000000000000000000000000000000000000000000",
    "tx_merkle_root": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "compute_merkle_root": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "state_root": "56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
    "ai_proof": {
        "inference_count": 0,
        "input_hashes": [],
        "output_hashes": [],
        "model_ids": [],
        "total_flops": 0
    }
}
```

The SHA-256 hash of the canonical JSON encoding of this genesis block header is the genesis hash for the network. The `tx_merkle_root` and `compute_merkle_root` are the SHA-256 hash of the empty byte string (no transactions or results in genesis). The `state_root` is the hash of an empty Merkle Patricia Trie.

### GPU Inventory Advertisement

```json
{
    "provider": "12D3KooWProviderPeerIdBase58Encoded",
    "gpus": [
        {
            "gpu_id": "gpu-0",
            "model": "NVIDIA H100 SXM5 80GB",
            "vram_total_mb": 81920,
            "vram_free_mb": 65536,
            "tflops_fp16": 989.5,
            "tflops_int8": 1979.0,
            "compute_capability": 9.0,
            "backend": "Cuda"
        }
    ],
    "utilization": 0.20,
    "loaded_models": ["zen-72b"],
    "bandwidth_mbps": 10000,
    "region": "US"
}
```

## Reference Implementation

**Repository**: [github.com/hanzoai/node](https://github.com/hanzoai/node)

**Crate Structure**:
- `hanzo-node` -- Binary entry point and CLI
- `hanzo-consensus` -- PoAI consensus engine
- `hanzo-network` -- libp2p networking layer
- `hanzo-storage` -- RocksDB state management
- `hanzo-rpc` -- JSON-RPC API server
- `hanzo-bridge` -- Lux L1 settlement bridge (luxfi packages)
- `hanzo-types` -- Shared types (blocks, transactions, inventory)

**Build and Run**:
```bash
# Build
cargo build --release

# Start a validator node
./target/release/hanzo-node \
    --config hanzo-node.yaml \
    --role validator

# Start a compute provider node
./target/release/hanzo-node \
    --config hanzo-node.yaml \
    --role provider \
    --gpus auto

# Start a light client (no block production, RPC only)
./target/release/hanzo-node \
    --config hanzo-node.yaml \
    --role light
```

**Default Ports**:
- 9000 -- P2P networking (libp2p)
- 8545 -- JSON-RPC API
- 9090 -- Prometheus metrics

## Backwards Compatibility

This is a new node implementation. There is no backwards compatibility concern with previous Hanzo Node versions.

Hanzo Node is not wire-compatible with Lux Node. They communicate only through the settlement bridge, not through direct P2P connections. Lux Node operators do not need to update their software to support Hanzo Node checkpoints -- the bridge contract on Lux C-Chain handles all interaction.

## References

1. [HIP-0000: Hanzo AI Architecture Framework](./hip-0000-hanzo-ai-architecture-framework.md)
2. [HIP-0001: $AI Token](./hip-0001-ai-coin-hanzos-native-currency.md)
3. [HIP-0004: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md)
4. [HIP-0008: HMM Market Maker](./hip-0008-hmm-hanzo-market-maker-native-dex-for-ai-compute-resources.md)
5. [HIP-0019: Tensor Operations Standard (Candle)](./hip-0019-tensor-operations-standard.md)
6. [HIP-0023: Decentralized AI Compute Swarm Protocol](./hip-0023-decentralized-ai-compute-swarm-protocol.md)
7. [HIP-0024: Hanzo Sovereign L1 Chain Architecture](./hip-0024-hanzo-sovereign-l1-chain-architecture.md)
8. [ZIP-002: Proof of AI Consensus](https://zips.zoo.ngo/zip-002)
9. [libp2p Specification](https://github.com/libp2p/specs)
10. [Gossipsub v1.1 Protocol](https://github.com/libp2p/specs/blob/master/pubsub/gossipsub/gossipsub-v1.1.md)
11. [Kademlia DHT](https://github.com/libp2p/specs/blob/master/kad-dht/README.md)
12. [RocksDB](https://rocksdb.org/)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
