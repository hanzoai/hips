---
hip: 0023
title: Decentralized AI Compute Swarm Protocol
description: Protocol for distributing AI inference and training across a decentralized GPU network with model-aware scheduling, pipeline parallelism, and Proof of AI verification
author: Hanzo AI Team
status: Draft
type: Standards Track
category: Core
created: 2024-11-30
updated: 2026-02-23
requires: 0001, 0005, 0008
---

# HIP-0023: Decentralized AI Compute Swarm Protocol

## Abstract

This HIP specifies a protocol for distributing AI compute tasks -- inference, training, and embedding generation -- across a decentralized peer-to-peer network of heterogeneous GPU providers. The protocol uses libp2p for networking, model-aware scheduling for task placement, pipeline parallelism for large model distribution, and Proof of AI (PoAI) consensus for result verification. Economic settlement occurs via the $AI token through the Hamiltonian Market Maker (HIP-0008). The swarm aggregates idle GPUs globally -- university clusters, consumer gaming hardware, retired mining rigs, and enterprise surplus -- into a unified elastic compute layer that scales beyond any single cloud provider.

## Motivation

### The GPU Scarcity Problem

AI inference and training demand is growing faster than centralized GPU supply. As of 2025:

- NVIDIA H100 clusters have 6-12 month lead times from major cloud providers
- AWS, GCP, and Azure GPU instance availability is frequently constrained in peak regions
- Lambda Labs, CoreWeave, and similar GPU clouds face the same upstream supply bottleneck
- Spot/preemptible GPU pricing fluctuates 3-10x depending on demand cycles
- Small teams and researchers are priced out of frontier model training entirely

Meanwhile, millions of capable GPUs sit idle worldwide:

- University HPC clusters average 40-60% utilization outside academic cycles
- Consumer RTX 4090 / 5090 cards (24-32 GB VRAM) idle 90%+ of the time
- Former cryptocurrency mining farms hold thousands of GPUs with no profitable workload
- Enterprise data centers overprovision GPU capacity for peak loads

A decentralized swarm protocol bridges this gap by creating a permissionless marketplace where any GPU owner can contribute compute and earn $AI tokens, while any consumer can submit AI workloads at competitive prices set by open market dynamics.

### Why Existing Solutions Fall Short

1. **Akash Network**: General-purpose container orchestration. No model-aware scheduling, no VRAM-based placement, no pipeline parallelism for large models. Deploying a 70B parameter model across multiple Akash containers requires manual sharding.

2. **Render Network**: Optimized for GPU rendering (3D, video). The scheduling model assumes independent, embarrassingly parallel frames -- not sequential transformer layers with inter-node communication.

3. **Golem Network**: Low-level WASM task distribution. No native understanding of AI model formats (safetensors, GGUF), no tensor-parallel or pipeline-parallel primitives, no AI-specific verification.

4. **io.net**: Aggregates GPU clusters but relies on centralized orchestration. No on-chain verification of compute correctness. Trust model depends on provider reputation alone.

5. **Together AI / Petals**: Closer to the right model (distributed inference), but centrally coordinated. Petals uses volunteer nodes with no economic incentive layer or Byzantine fault tolerance.

The Hanzo Swarm Protocol is purpose-built for AI: it understands model architectures, optimizes placement based on VRAM and interconnect bandwidth, distributes transformer layers across nodes via pipeline parallelism, and verifies results through PoAI consensus -- all settled economically through the $AI token and HMM.

### Core Design Goals

1. **Permissionless participation**: Any node with a supported GPU can join and earn
2. **Model-aware scheduling**: Tasks are placed on nodes with sufficient VRAM, bandwidth, and model compatibility
3. **Pipeline parallelism**: Large models are split across multiple nodes by transformer layer
4. **Verified computation**: PoAI ensures providers actually performed the work correctly
5. **Fair economics**: $AI token payments via HMM with slashing for dishonest providers
6. **Fault tolerance**: Automatic failover, redundant computation, Byzantine resistance
7. **Multi-GPU support**: NVIDIA (CUDA), AMD (ROCm), Apple Silicon (Metal)

## Design Philosophy

### Why Decentralized Compute

Centralized GPU clouds (AWS, GCP, Lambda Labs) operate on a capacity-planning model: they purchase hardware based on demand projections, charge margins sufficient to cover capital expenditure, and allocate resources through reservation systems. This model has three structural problems:

1. **Capacity ceilings**: A single provider can only deploy as many GPUs as they can purchase and house. During supply crunches (e.g., the H100 shortage of 2024-2025), no amount of money buys more capacity.

2. **Geographic concentration**: Major GPU clouds concentrate in a handful of regions (us-east-1, us-west-2, europe-west1). Latency-sensitive inference from other geographies suffers.

3. **Pricing inefficiency**: Fixed hourly rates do not reflect real-time supply and demand. A GPU idle at 3 AM costs the same as one at peak load.

A decentralized swarm inverts all three constraints. Capacity scales with the global population of idle GPUs -- there is no single procurement bottleneck. Geographic distribution is inherent: nodes exist wherever GPU owners are. And pricing is set by open market dynamics through HMM, naturally reflecting real-time supply and demand.

### Why libp2p Networking

libp2p is the peer-to-peer networking stack used by IPFS, Filecoin, Ethereum's consensus layer, and Polkadot. It provides:

- **Kademlia DHT** for decentralized node discovery without a central registry
- **NAT traversal** (hole punching, relay circuits) so nodes behind home routers can participate
- **Multiplexed streams** over a single connection for parallel task communication
- **Noise protocol** encryption for all peer-to-peer traffic
- **PeerID** cryptographic identity tied to Ed25519 keypairs
- **GossipSub** for efficient pub/sub message propagation across the swarm

We do not need to build networking primitives. libp2p has been battle-tested at scale by networks with millions of nodes. The Rust implementation (`rust-libp2p`) is mature and integrates directly with Tokio async runtime.

### Why Proof of AI (PoAI) Consensus

Traditional blockchain consensus mechanisms validate that nodes followed protocol rules (PoW: found a hash, PoS: attested to a block). They do not verify that useful computation occurred. PoAI extends consensus to validate AI inference and training results:

1. A compute provider executes an AI task and submits the result with a cryptographic commitment
2. A randomly selected subset of verifier nodes re-executes the same task independently
3. Results are compared: if the provider's output matches verifier consensus (within floating-point tolerance for non-deterministic operations), the result is accepted
4. Providers who submit incorrect results are slashed ($AI stake forfeited); honest providers are rewarded

This creates a trustless compute layer where consumers do not need to trust individual providers -- the protocol guarantees correctness through economic incentives and redundant verification.

For deterministic operations (embeddings, quantized inference with fixed seeds), verification is exact hash comparison. For non-deterministic operations (sampling-based generation), verification uses semantic similarity thresholds and statistical consistency checks.

### How It Connects to HMM (HIP-0008)

The Hamiltonian Market Maker (HMM) provides the economic settlement layer for the swarm:

- **Compute resource pools**: HMM maintains liquidity pools for GPU-hours, priced in $AI
- **Dynamic pricing**: Supply (available GPUs) and demand (queued tasks) set real-time prices via the automated market maker curve
- **Instant settlement**: Task completion triggers automatic $AI transfer from consumer to provider
- **Quality tiers**: Different pools for different GPU classes (H100, A100, RTX 4090, etc.) with distinct pricing curves
- **Slashing integration**: PoAI verification failures trigger automatic stake slashing through HMM's penalty mechanism

The swarm protocol handles compute orchestration; HMM handles economics. They are complementary layers.

## Specification

### Node Types

The network consists of three node roles. A single physical node may serve multiple roles simultaneously.

#### Compute Provider

Contributes GPU resources to the swarm. Requirements:

| Field | Minimum | Recommended |
|-------|---------|-------------|
| GPU VRAM | 8 GB | 24+ GB |
| System RAM | 16 GB | 64+ GB |
| Storage | 100 GB SSD | 1 TB NVMe |
| Bandwidth | 100 Mbps | 1 Gbps |
| $AI Stake | 1,000 $AI | 10,000 $AI |

Supported GPU backends:
- **NVIDIA**: CUDA 11.8+ (Ampere, Ada Lovelace, Hopper, Blackwell)
- **AMD**: ROCm 5.7+ (RDNA 3, CDNA 2/3)
- **Apple Silicon**: Metal 3 (M1 Pro/Max/Ultra, M2, M3, M4)

#### Validator

Verifies compute results via PoAI. Validators re-execute a random subset of tasks and compare results. Requirements:

- Must run at least one supported GPU for re-computation
- Minimum 5,000 $AI stake (higher than providers to prevent Sybil attacks on verification)
- Reputation score >= 0.8 (earned through consistent honest validation)

Validators are selected per-task via verifiable random function (VRF) seeded by the task hash and current block, preventing providers from predicting which validator will check their work.

#### Coordinator

Manages task scheduling and piece distribution. In Phase 1, coordinators are semi-centralized (operated by Hanzo). In Phase 2, coordinator logic moves on-chain to the Hanzo L1 (HIP-0024), making scheduling fully decentralized.

Coordinator responsibilities:
- Accept task submissions from consumers
- Decompose tasks into pieces
- Match pieces to providers based on capability and reputation
- Track piece state and trigger verification
- Aggregate verified results and return to consumers

### Networking Layer

All nodes communicate via libp2p with the following protocol stack:

```
Application:  /hanzo/swarm/1.0.0 (custom protocol)
PubSub:       GossipSub v1.1 (task announcements, heartbeats)
Discovery:    Kademlia DHT (peer discovery, provider capability ads)
Transport:    QUIC (primary), TCP+Noise (fallback)
Identity:     Ed25519 PeerID (linked to $AI wallet address via DID)
```

**Protocol Messages:**

| Message | Direction | Description |
|---------|-----------|-------------|
| `Announce` | Provider -> DHT | Advertise GPU capabilities and available capacity |
| `TaskSubmit` | Consumer -> Coordinator | Submit a compute task |
| `PieceAssign` | Coordinator -> Provider | Assign a piece to a provider |
| `PieceResult` | Provider -> Coordinator | Return computed result with proof |
| `VerifyRequest` | Coordinator -> Validator | Request PoAI verification |
| `VerifyResult` | Validator -> Coordinator | Verification outcome |
| `Heartbeat` | All -> GossipSub | Liveness signal (every 30s) |
| `TaskComplete` | Coordinator -> Consumer | Aggregated verified results |

### Task Model

```rust
pub struct ComputeTask {
    pub id: TaskId,                      // Blake3 hash of (submitter, nonce, timestamp)
    pub task_type: TaskType,
    pub priority: u32,                   // 0 (lowest) - 1000 (highest)
    pub deadline: Option<u64>,           // Unix timestamp, optional
    pub budget: u64,                     // Max $AI willing to spend
    pub redundancy: usize,              // Verification redundancy (default: 3)
    pub submitter: WalletAddress,
    pub created_at: u64,
}

pub enum TaskType {
    /// LLM text generation
    Inference {
        model: ModelSpec,
        prompt: Vec<Message>,
        params: SamplingParams,
    },
    /// Vector embedding generation
    Embedding {
        model: ModelSpec,
        texts: Vec<String>,
        dimensions: Option<usize>,
    },
    /// Model fine-tuning (LoRA or full)
    Training {
        base_model: ModelSpec,
        dataset: DatasetRef,             // IPFS CID or swarm storage hash
        method: TrainingMethod,          // LoRA, QLoRA, Full
        hyperparams: TrainingHyperparams,
    },
    /// Batch inference (multiple prompts)
    Batch {
        model: ModelSpec,
        requests: Vec<InferenceRequest>,
    },
}

pub struct ModelSpec {
    pub name: String,                    // e.g., "zen-72b"
    pub format: ModelFormat,             // Safetensors, GGUF, ONNX
    pub size_bytes: u64,
    pub vram_required_mb: u32,          // Minimum VRAM for single-GPU
    pub quantization: Option<Quantization>, // Q4_K_M, Q8_0, FP16, etc.
    pub hash: String,                    // Blake3 hash of model weights
}

pub enum ModelFormat {
    Safetensors,                         // HuggingFace standard
    GGUF,                               // llama.cpp / whisper.cpp
    ONNX,                               // Cross-platform inference
}
```

### Piece Decomposition

Tasks are decomposed into independently schedulable pieces. The decomposition strategy depends on task type:

**Inference tasks**: If the model fits on a single node, the task is a single piece. If the model requires pipeline parallelism, it is split into N pieces corresponding to N pipeline stages (groups of transformer layers).

**Embedding tasks**: Each batch of texts becomes a separate piece. Pieces are embarrassingly parallel.

**Training tasks**: Data-parallel decomposition. Each piece processes a shard of the training dataset on a separate node. Gradient aggregation occurs at the coordinator.

**Batch inference**: Each request (or group of requests) becomes a separate piece.

```rust
pub struct Piece {
    pub task_id: TaskId,
    pub index: usize,
    pub state: PieceState,
    pub input: PieceInput,              // Serialized input data
    pub input_hash: String,              // Blake3 hash for verification
    pub assigned_providers: Vec<PeerId>,
    pub results: HashMap<PeerId, PieceResult>,
    pub verified_result: Option<Vec<u8>>,
    pub pipeline_stage: Option<PipelineStage>, // For pipeline parallelism
    pub redundancy: usize,
    pub deadline: Option<u64>,
    pub priority: u32,
    pub retry_count: usize,
    pub max_retries: usize,             // Default: 3
}

pub enum PieceState {
    Pending,      // Awaiting provider assignment
    Assigned,     // Provider(s) assigned, not yet started
    InProgress,   // Active computation underway
    Computed,     // Result(s) received, awaiting verification
    Verified,     // PoAI consensus reached
    Failed,       // Exhausted retries
}
```

### Model-Aware Scheduling

The scheduler places pieces on providers based on hardware capabilities, not just availability. This is the critical differentiation from general-purpose compute networks.

**Capability Matching:**

```rust
pub struct ProviderCapabilities {
    pub peer_id: PeerId,
    pub gpus: Vec<GpuInfo>,
    pub total_vram_mb: u32,
    pub system_ram_mb: u64,
    pub storage_available_gb: u32,
    pub bandwidth_mbps: u32,
    pub cached_models: Vec<ModelHash>,   // Models already loaded in VRAM/disk
    pub supported_formats: Vec<ModelFormat>,
    pub compute_backend: ComputeBackend, // CUDA, ROCm, Metal
    pub max_concurrent_pieces: usize,
    pub current_load: f64,               // 0.0 - 1.0
}

pub struct GpuInfo {
    pub name: String,                    // e.g., "NVIDIA RTX 4090"
    pub vram_mb: u32,                    // e.g., 24576
    pub compute_capability: String,      // e.g., "8.9"
    pub backend: ComputeBackend,
}
```

**Scheduling Algorithm:**

The scheduler scores each candidate provider for a given piece:

```
score = model_fit_score * 0.35
      + cache_bonus * 0.25
      + reputation * 0.20
      + latency_score * 0.10
      + load_score * 0.10
```

Where:
- `model_fit_score`: 1.0 if model fits in provider's VRAM, 0.0 otherwise (hard constraint)
- `cache_bonus`: 1.0 if model is already cached on provider, 0.0 otherwise (avoids transfer time)
- `reputation`: Provider's rolling reputation score (0.0 - 1.0)
- `latency_score`: Inverse of network latency between coordinator and provider
- `load_score`: Inverse of current provider load (prefer idle nodes)

Providers that do not meet the hard VRAM constraint are excluded entirely. Among qualifying providers, the highest-scoring node is selected.

### Pipeline Parallelism

For models too large to fit on a single node's VRAM, the swarm distributes transformer layers across multiple nodes in a pipeline:

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Node A     │    │   Node B     │    │   Node C     │    │   Node D     │
│ Layers 0-15  │───>│ Layers 16-31 │───>│ Layers 32-47 │───>│ Layers 48-63 │
│ (16 GB VRAM) │    │ (16 GB VRAM) │    │ (16 GB VRAM) │    │ (16 GB VRAM) │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
     Stage 0             Stage 1             Stage 2             Stage 3
```

**Pipeline Protocol:**

1. Coordinator determines the number of pipeline stages based on model size and available provider VRAM
2. Model layers are assigned to stages. Each stage is a piece.
3. Coordinator selects providers for each stage, preferring providers with low mutual latency
4. Inference flows sequentially: Stage 0 processes input, sends hidden states to Stage 1, etc.
5. Inter-stage communication uses direct libp2p streams between providers (not routed through coordinator)
6. Micro-batching: multiple requests are pipelined to keep all stages busy

```rust
pub struct PipelineStage {
    pub stage_index: usize,
    pub total_stages: usize,
    pub layer_range: (usize, usize),    // Start and end layer indices
    pub upstream_peer: Option<PeerId>,   // Previous stage provider
    pub downstream_peer: Option<PeerId>, // Next stage provider
    pub activation_size_bytes: u64,      // Size of inter-stage tensor transfer
}
```

**Latency Considerations:**

Pipeline parallelism introduces inter-node communication overhead. The protocol optimizes for this:
- Providers in the same geographic region are preferred for pipeline stages
- Activation tensors are compressed (FP16 or quantized) before transfer
- Micro-batch size is tuned to amortize communication latency
- Minimum bandwidth requirement for pipeline nodes: 1 Gbps

### Proof of AI (PoAI) Verification

PoAI is the consensus mechanism that ensures compute results are correct without trusting individual providers. It builds on the AI Mining Protocol concepts from HIP-0006 and adapts them for swarm verification.

**Verification Flow:**

```
1. Provider submits result R with commitment C = Blake3(R)
2. Coordinator selects K verifiers via VRF (default K = 3)
3. Each verifier independently re-computes the task
4. Verifiers submit their results V_i with commitments
5. Coordinator reveals all commitments simultaneously (commit-reveal scheme)
6. Consensus check:
   - Deterministic tasks: all hashes must match exactly
   - Non-deterministic tasks: semantic similarity >= threshold (default 0.95)
7. If consensus reached:
   - Provider rewarded with $AI from task budget
   - Verifiers rewarded with verification fee (5% of task cost)
8. If consensus fails:
   - Provider slashed (10% of stake)
   - Minority verifiers slashed (potential collusion)
   - Task re-assigned to new provider
```

**Verification Methods:**

| Method | Use Case | Threshold | Cost |
|--------|----------|-----------|------|
| `ExactHash` | Embeddings, quantized inference (fixed seed) | 100% match | Low |
| `FloatingPointTolerance` | FP16/FP32 inference (hardware differences) | L2 distance < epsilon | Low |
| `SemanticSimilarity` | Text generation (sampling-based) | Cosine similarity >= 0.95 | Medium |
| `StatisticalConsistency` | Training loss curves | Kolmogorov-Smirnov test p > 0.05 | Medium |
| `TEEAttestation` | Sensitive/private inference | SGX/TDX attestation | High |
| `Supermajority` | General-purpose fallback | >= 67% agreement | Medium |

**Non-Determinism Handling:**

LLM text generation with temperature > 0 is inherently non-deterministic. The protocol handles this:

1. For verification purposes, tasks include a `verification_seed` that forces deterministic sampling during the verification pass
2. The consumer receives the original (non-deterministic) result; the verification pass uses the seed only to confirm the provider ran the correct model with the correct input
3. Verifiers check that the output is a plausible generation from the specified model, not that it is character-identical

### Payment and Settlement

All payments flow through the $AI token and HMM (HIP-0008):

```
Task Budget Flow:
  Consumer deposits $AI into escrow ──> Task executes
    ├── 90% to Compute Provider (on verified completion)
    ├── 5% to Verifiers (split among K verifiers)
    ├── 3% to Coordinator (scheduling fee)
    └── 2% to Protocol Treasury (network maintenance)

Slashing Flow:
  Provider stake (locked $AI)
    ├── Correct computation: stake returned + reward
    └── Failed verification: 10% of stake burned, remainder returned
```

**Pricing via HMM:**

The cost of a compute task is determined by the HMM liquidity pools:

- Each GPU class has a pool (e.g., $AI/H100-hour, $AI/RTX4090-hour)
- Pool reserves set the instantaneous price via the constant-product formula
- High demand (many queued tasks) increases price; high supply (many idle GPUs) decreases price
- Consumers can set a `max_budget` and tasks queue until price falls within budget

### Peer Reputation System

Every node maintains a reputation score that affects scheduling priority, verification selection, and staking requirements.

```rust
pub struct NodeReputation {
    pub peer_id: PeerId,
    pub score: f64,                      // 0.0 - 1.0
    pub total_tasks: u64,
    pub successful_tasks: u64,
    pub failed_tasks: u64,
    pub slashed_count: u32,
    pub uptime_ratio: f64,               // Rolling 30-day uptime
    pub avg_latency_ms: u64,
    pub joined_at: u64,
}
```

**Reputation Update Rules:**

| Event | Score Change |
|-------|-------------|
| Verified computation (correct) | +0.01 (capped at 1.0) |
| Failed verification (incorrect) | -0.10 |
| Slashed (malicious) | -0.25 |
| Task timeout (no result) | -0.05 |
| Heartbeat missed | -0.02 |
| Consistent uptime (30 days) | +0.05 bonus |

**Minimum Reputation Thresholds:**

| Action | Minimum Score |
|--------|--------------|
| Accept compute tasks | 0.3 |
| Accept high-priority tasks | 0.7 |
| Serve as validator | 0.8 |
| Serve as coordinator candidate | 0.9 |

New nodes start at 0.5 and must build reputation through honest participation.

### Protocol State Machine

```
Task Lifecycle:
  Submitted -> Decomposed -> Scheduling -> InProgress -> Verification -> Complete
       │            │             │             │              │
       └─ Rejected  └─ Failed     └─ NoNodes    └─ Timeout     └─ Slashed
                      (budget)     (queue)       (retry)        (re-assign)
```

**Piece State Transitions:**

```
Pending ──assign──> Assigned ──start──> InProgress ──result──> Computed ──verify──> Verified
   │                    │                    │                      │
   │                    └──timeout──> Pending (retry)               └──fail──> Pending (retry)
   │                                                                            or Failed (max retries)
   └──cancel──> Cancelled
```

### Configuration

```rust
pub struct SwarmConfig {
    /// libp2p identity keypair
    pub keypair: Keypair,
    /// Listen addresses (e.g., /ip4/0.0.0.0/udp/9000/quic-v1)
    pub listen_addrs: Vec<Multiaddr>,
    /// Bootstrap peers for initial DHT discovery
    pub bootstrap_peers: Vec<Multiaddr>,
    /// Scheduling weights
    pub scheduling_weights: SchedulingWeights,
    /// Default verification method
    pub verification_method: VerificationMethod,
    /// Default redundancy for verification
    pub default_redundancy: usize,          // Default: 3
    /// Maximum retries per piece
    pub max_retries: usize,                 // Default: 3
    /// Piece computation timeout
    pub piece_timeout: Duration,            // Default: 300s
    /// Minimum provider reputation for task assignment
    pub min_provider_reputation: f64,       // Default: 0.3
    /// Heartbeat interval
    pub heartbeat_interval: Duration,       // Default: 30s
    /// Maximum concurrent pieces per node
    pub max_concurrent_pieces: usize,       // Default: 4
    /// Pipeline parallelism minimum bandwidth (Mbps)
    pub pipeline_min_bandwidth_mbps: u32,   // Default: 1000
}
```

### Events

```rust
pub enum SwarmEvent {
    // Peer events
    PeerDiscovered(PeerId, ProviderCapabilities),
    PeerConnected(PeerId),
    PeerDisconnected(PeerId),
    PeerReputationUpdated(PeerId, f64),

    // Task events
    TaskSubmitted(TaskId, TaskType),
    TaskDecomposed(TaskId, usize),          // task_id, num_pieces
    TaskCompleted(TaskId, Vec<u8>),
    TaskFailed(TaskId, TaskError),

    // Piece events
    PieceAssigned { task_id: TaskId, piece_index: usize, provider: PeerId },
    PieceComputed { task_id: TaskId, piece_index: usize, provider: PeerId },
    PieceVerified { task_id: TaskId, piece_index: usize },
    PieceFailed { task_id: TaskId, piece_index: usize, reason: String },
    PieceRetried { task_id: TaskId, piece_index: usize, attempt: usize },

    // Pipeline events
    PipelineStageReady { task_id: TaskId, stage: usize },
    PipelineActivationTransfer { from: PeerId, to: PeerId, bytes: u64 },

    // Economic events
    PaymentEscrowed { task_id: TaskId, amount: u64 },
    ProviderRewarded { peer_id: PeerId, amount: u64 },
    ProviderSlashed { peer_id: PeerId, amount: u64, reason: String },
}
```

## Implementation

### Reference Implementation

The reference implementation lives in the Hanzo node repository:

| Component | Repository | Language | Status |
|-----------|-----------|----------|--------|
| Node runtime | `github.com/hanzoai/node` | Rust | Active development |
| Swarm protocol | `hanzo-node/hanzo-libs/hanzo-compute/` | Rust | Alpha |
| libp2p networking | `hanzo-node/hanzo-libs/hanzo-p2p/` | Rust | Alpha |
| Coordinator | `github.com/hanzoai/coordinator` | Rust | Centralized (Phase 1) |
| CLI | `hanzo-node/hanzo-cli/` | Rust | Alpha |
| Provider dashboard | `github.com/hanzoai/swarm-ui` | TypeScript | Planned |

### Dependencies

```toml
[dependencies]
libp2p = { version = "0.54", features = ["quic", "noise", "kad", "gossipsub", "identify"] }
tokio = { version = "1", features = ["full"] }
blake3 = "1.5"
serde = { version = "1", features = ["derive"] }
safetensors = "0.4"
candle-core = { git = "https://github.com/hanzoai/candle" }
candle-transformers = { git = "https://github.com/hanzoai/candle" }
```

### Usage Example

```rust
use hanzo_compute::{SwarmConfig, ComputeSwarm, TaskType, ModelSpec, ModelFormat};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize swarm node
    let config = SwarmConfig::default()
        .with_listen_addr("/ip4/0.0.0.0/udp/9000/quic-v1".parse()?)
        .with_bootstrap_peers(vec![
            "/dns4/bootstrap.hanzo.ai/udp/9000/quic-v1".parse()?,
        ]);

    let swarm = ComputeSwarm::new(config).await?;

    // Submit an inference task
    let task_id = swarm.submit_task(TaskType::Inference {
        model: ModelSpec {
            name: "zen-72b".into(),
            format: ModelFormat::Safetensors,
            size_bytes: 145_000_000_000,
            vram_required_mb: 48_000,
            quantization: None,
            hash: "abc123...".into(),
        },
        prompt: vec![Message::user("Explain quantum computing in simple terms.")],
        params: SamplingParams {
            max_tokens: 1024,
            temperature: 0.7,
            top_p: 0.9,
            ..Default::default()
        },
    })
    .with_budget(100)      // 100 $AI max
    .with_redundancy(3)    // 3x verification
    .send()
    .await?;

    // Wait for verified result
    let result = swarm.await_result(task_id).await?;
    println!("Result: {}", String::from_utf8_lossy(&result));

    Ok(())
}
```

### Provider Setup

```bash
# Install Hanzo node
cargo install hanzo-node

# Initialize provider configuration
hanzo-node init --role provider

# Register GPU capabilities (auto-detected)
hanzo-node gpu detect
# Output: Found NVIDIA RTX 4090 (24576 MB VRAM, CUDA 12.4)

# Stake $AI tokens
hanzo-node stake deposit --amount 1000

# Start provider node
hanzo-node start --provider
# Listening on /ip4/0.0.0.0/udp/9000/quic-v1
# Connected to 47 peers via DHT
# Registered capabilities: RTX 4090, 24 GB VRAM, CUDA
# Ready for compute tasks
```

### Rollout Phases

| Phase | Timeline | Coordinator | Verification | Settlement |
|-------|----------|------------|--------------|------------|
| Phase 1 | Q1 2026 | Centralized (Hanzo-operated) | PoAI via centralized verifiers | $AI on Lux testnet |
| Phase 2 | Q3 2026 | Semi-decentralized (elected coordinators) | PoAI via staked validators | $AI on Lux mainnet |
| Phase 3 | Q1 2027 | Fully on-chain (Hanzo L1, HIP-0024) | PoAI on-chain consensus | Native Hanzo L1 settlement |

## Security Considerations

### Sybil Attacks

An attacker creates many fake nodes to dominate task assignment or verification.

**Mitigations:**
1. $AI stake requirement for all roles (minimum 1,000 $AI for providers, 5,000 for validators)
2. Reputation system requires history of honest participation -- new nodes start at 0.5 and cannot access high-value tasks
3. DID-based identity (`hanzo-did` crate) links PeerIDs to verifiable credentials
4. VRF-based validator selection prevents an attacker from predicting which nodes will verify their work

### Result Manipulation

A provider returns incorrect results to save compute resources (e.g., returns random bytes instead of running inference).

**Mitigations:**
1. Redundant computation: default 3 providers compute the same piece
2. PoAI verification: validators independently re-compute and compare
3. Commit-reveal scheme: results are committed before reveal, preventing providers from copying others
4. Slashing: 10% stake loss per failed verification, making cheating economically irrational

### Model Weight Theft

An attacker joins as a provider to steal proprietary model weights.

**Mitigations:**
1. Model weights encrypted in transit (TLS via libp2p Noise protocol)
2. TEE (Trusted Execution Environment) support: models can be loaded inside SGX/TDX enclaves where the provider cannot read the weights
3. For public models (open weights), this is not a concern
4. For proprietary models, only TEE-attested providers are eligible

### Eclipse Attacks

An attacker surrounds a target node with malicious peers to control its view of the network.

**Mitigations:**
1. Kademlia DHT with configurable replication factor (default K=20)
2. Persistent connections to Hanzo bootstrap nodes
3. Peer diversity requirements: scheduler prefers providers from distinct AS numbers / IP ranges
4. GossipSub mesh maintenance resists partitioning

### Denial of Service

An attacker floods the network with tasks or spams heartbeats.

**Mitigations:**
1. Task submission requires $AI escrow (economic cost to submit)
2. Rate limiting per PeerId at the libp2p protocol level
3. Priority scheduling ensures legitimate high-priority tasks are served first
4. Heartbeat protocol uses GossipSub with configurable message rate limits

### Encrypted Inference

For sensitive workloads (medical, financial, personal data):

1. Input data encrypted with consumer's public key
2. Decryption only inside provider's TEE enclave
3. Result encrypted with consumer's key before leaving the enclave
4. Provider never sees plaintext input or output
5. Attestation proof confirms correct TEE execution

## Backwards Compatibility

This is a new protocol. No backwards compatibility concerns exist for the initial deployment.

Future versions of the protocol will maintain backwards compatibility by:
- Semantic versioning of the libp2p protocol ID (`/hanzo/swarm/1.0.0`, `/hanzo/swarm/2.0.0`)
- Negotiation during connection handshake to determine supported protocol version
- Graceful degradation: newer nodes support older protocol versions for a deprecation period

## Test Vectors

### Piece Decomposition

```
Input: Embedding task with 100 texts, batch_size = 25
Expected: 4 pieces, each containing 25 texts
Piece hashes:
  piece[0] = Blake3("task_id:0:" + serialize(texts[0..25]))
  piece[1] = Blake3("task_id:1:" + serialize(texts[25..50]))
  piece[2] = Blake3("task_id:2:" + serialize(texts[50..75]))
  piece[3] = Blake3("task_id:3:" + serialize(texts[75..100]))
```

### Reputation Scoring

```
Initial score: 0.5
After 10 successful tasks: min(1.0, 0.5 + 10 * 0.01) = 0.6
After 1 failed verification: max(0.0, 0.6 - 0.10) = 0.5
After 1 slash: max(0.0, 0.5 - 0.25) = 0.25
Status: Below compute threshold (0.3), node must rebuild reputation
```

### Scheduling Score

```
Provider A: model fits (1.0), cached (1.0), reputation 0.8, latency 20ms (0.9), load 0.2 (0.8)
Score = 1.0 * 0.35 + 1.0 * 0.25 + 0.8 * 0.20 + 0.9 * 0.10 + 0.8 * 0.10
     = 0.35 + 0.25 + 0.16 + 0.09 + 0.08 = 0.93

Provider B: model fits (1.0), not cached (0.0), reputation 0.9, latency 50ms (0.7), load 0.5 (0.5)
Score = 1.0 * 0.35 + 0.0 * 0.25 + 0.9 * 0.20 + 0.7 * 0.10 + 0.5 * 0.10
     = 0.35 + 0.00 + 0.18 + 0.07 + 0.05 = 0.65

Result: Provider A selected (0.93 > 0.65), cache hit avoids model transfer
```

### PoAI Verification (Exact Hash)

```
Task: Embedding generation for "Hello world" with model zen-embed-v1
Provider result hash:  Blake3("0.123,0.456,...,0.789") = "a1b2c3..."
Verifier 1 result hash: Blake3("0.123,0.456,...,0.789") = "a1b2c3..."
Verifier 2 result hash: Blake3("0.123,0.456,...,0.789") = "a1b2c3..."
Consensus: 3/3 match = 100% -> Verified (ExactHash method)
```

## Related HIPs

| HIP | Title | Relationship |
|-----|-------|-------------|
| HIP-0001 | $AI Token | Native currency for compute payments and staking |
| HIP-0005 | Post-Quantum Security | Cryptographic primitives for peer identity and proofs |
| HIP-0006 | Per-User Fine-Tuning | PoAI verification concepts adapted for swarm |
| HIP-0008 | Hamiltonian Market Maker | Economic settlement layer for compute pricing |
| HIP-0009 | Agent SDK | Higher-level task orchestration that submits to the swarm |
| HIP-0020 | Blockchain Node Standard | Node runtime that hosts the swarm protocol |
| HIP-0024 | Hanzo Sovereign L1 | On-chain settlement and decentralized coordinator (Phase 3) |
| HIP-0025 | Bot/Agent Wallet Protocol | Agent wallets that interact with the swarm programmatically |

## Open Questions

1. **Pipeline parallelism latency**: What is the maximum acceptable inter-node latency for pipeline stages before throughput degrades below single-node quantized inference? Benchmarking needed.

2. **Non-deterministic verification thresholds**: The semantic similarity threshold (0.95) for text generation verification needs empirical tuning across model families and task types.

3. **Coordinator decentralization timeline**: Moving from centralized to on-chain coordinator requires the Hanzo L1 (HIP-0024) to be production-ready. Timeline is coupled.

4. **Cross-chain settlement**: Should the swarm support payment in tokens other than $AI (e.g., ETH, USDC) via cross-chain bridges? This adds complexity but may improve adoption.

5. **Privacy-preserving verification**: Can PoAI verification be done without re-executing the full task? Zero-knowledge proofs for AI inference are an active research area.

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
