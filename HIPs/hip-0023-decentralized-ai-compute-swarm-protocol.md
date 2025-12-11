# HIP-0023: Decentralized AI Compute Swarm Protocol

| HIP | 0023 |
|-----|------|
| Title | Decentralized AI Compute Swarm Protocol |
| Author | Hanzo AI Team |
| Status | Draft |
| Type | Standards Track |
| Category | Core |
| Created | 2024-11-30 |
| Requires | HIP-0001 (AI Coin), HIP-0005 (PQC) |

## Abstract

This HIP specifies a BitTorrent-inspired protocol for distributing AI compute tasks across a decentralized peer network. The protocol enables tasks to be split into independently verifiable "pieces" that can be computed by multiple peers with redundancy for verification, using rarest-first scheduling and consensus-based result verification.

## Motivation

Decentralized AI inference and training faces unique challenges:

1. **Compute Distribution**: Large inference tasks can be parallelized across multiple nodes
2. **Result Verification**: Without a central authority, results must be verified through redundant computation
3. **Resource Efficiency**: Peers have varying capabilities (GPU, memory, supported models)
4. **Economic Incentives**: Work must be fairly compensated via AI Coin (HIP-0001)
5. **Fault Tolerance**: The system must handle peer failures and malicious actors

BitTorrent's proven piece-based distribution model provides an ideal foundation for solving these challenges in AI compute.

## Specification

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        ComputeSwarm                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │   Peer   │  │   Peer   │  │   Peer   │  │  PieceManager    │ │
│  │ Manager  │  │  (GPU)   │  │  (CPU)   │  │  (Task Pieces)   │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘ │
│        │              │              │               │           │
│        └──────────────┴──────────────┴───────────────┘           │
│                              │                                    │
│  ┌───────────────────────────┴───────────────────────────────┐  │
│  │                       Scheduler                            │  │
│  │   (RarestFirst | PriorityFirst | Deadline | Hybrid)       │  │
│  └───────────────────────────┬───────────────────────────────┘  │
│                              │                                    │
│  ┌───────────────────────────┴───────────────────────────────┐  │
│  │                    ResultVerifier                          │  │
│  │   (HashMatch | Majority | Supermajority | BFT | TEE)      │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Core Components

#### 1. Task Types

```rust
pub enum TaskType {
    /// LLM inference task
    Inference {
        model: String,
        prompt: String,
        max_tokens: usize,
    },
    /// Embedding generation
    Embedding {
        model: String,
        texts: Vec<String>,
    },
    /// Model fine-tuning
    FineTuning {
        base_model: String,
        dataset_hash: String,
        hyperparameters: HashMap<String, Value>,
    },
    /// Generic compute (WASM/custom)
    Custom {
        compute_type: String,
        payload: Vec<u8>,
    },
}
```

#### 2. Piece Model

Tasks are decomposed into pieces following BitTorrent conventions:

```rust
pub struct Piece {
    pub task_id: TaskId,
    pub index: usize,
    pub state: PieceState,          // Pending, Assigned, InProgress, Computed, Verified, Failed
    pub input_hash: String,          // Blake3 hash of input
    pub assigned_peers: HashSet<PeerId>,
    pub results: HashMap<PeerId, String>,
    pub verified_result: Option<Vec<u8>>,
    pub redundancy: usize,           // Required parallel computations
    pub deadline: Option<u64>,       // Unix timestamp
    pub priority: u32,               // Higher = more urgent
    pub retry_count: usize,
}
```

**Piece States:**
- `Pending`: Awaiting peer assignment
- `Assigned`: Peer(s) assigned, work not started
- `InProgress`: Active computation
- `Computed`: Results received, awaiting verification
- `Verified`: Consensus reached on result
- `Failed`: Computation failed after max retries

#### 3. Scheduling Strategies

The scheduler supports multiple strategies:

| Strategy | Description | Use Case |
|----------|-------------|----------|
| RarestFirst | Prioritize pieces with lowest peer availability | Default, ensures availability |
| PriorityFirst | Prioritize high-priority pieces | Time-sensitive tasks |
| DeadlineFirst | Prioritize approaching deadlines | SLA compliance |
| RoundRobin | Equal distribution across pieces | Fair resource allocation |
| Random | Random selection | Load balancing |
| Hybrid | Weighted combination of factors | Production workloads |

**Hybrid Scoring Formula:**

```
score = priority
      + (60 / (time_until_deadline + 1)) * 100
      - (retry_count * 10)
```

#### 4. Peer Model

```rust
pub struct Peer {
    pub id: PeerId,
    pub address: String,
    pub state: PeerState,
    pub capabilities: PeerCapabilities,
    pub reputation: f64,             // 0.0 - 1.0
    pub active_tasks: HashSet<TaskId>,
    pub completed_tasks: usize,
    pub failed_tasks: usize,
}

pub struct PeerCapabilities {
    pub gpu_available: bool,
    pub gpu_memory_mb: u32,
    pub cpu_cores: u16,
    pub ram_mb: u32,
    pub max_concurrent_tasks: usize,
    pub supported_models: Vec<String>,
}
```

**Peer Reputation Updates:**
- Success: `reputation = min(1.0, reputation + 0.01)`
- Failure: `reputation = max(0.0, reputation - 0.05)`

**Scheduling Score:**
```
score = reputation * 0.4
      + (capacity_remaining / max_capacity) * 0.3
      + (completed_tasks / (completed_tasks + failed_tasks + 1)) * 0.3
```

#### 5. Verification Methods

| Method | Threshold | Description |
|--------|-----------|-------------|
| None | - | No verification (trusted peers) |
| HashMatch | 100% | All results must hash identically |
| Majority | >50% | Simple majority consensus |
| Supermajority | ≥67% | 2/3 consensus (BFT-tolerant) |
| BFT | ≥67% | Byzantine fault tolerant, requires 3f+1 peers |
| TeeAttestation | - | TEE attestation verification |

**Consensus Algorithm:**
```rust
fn verify_consensus(&self, results: &[ComputeResult], threshold: f64) -> Option<Vec<u8>> {
    let mut hash_counts: HashMap<&str, (usize, &[u8])> = HashMap::new();

    for result in results {
        hash_counts
            .entry(&result.result_hash)
            .or_insert((0, &result.data))
            .0 += 1;
    }

    let total = results.len() as f64;
    for (_, (count, data)) in hash_counts {
        if count as f64 / total >= threshold {
            return Some(data.to_vec());
        }
    }
    None
}
```

### Protocol Flow

```
1. Task Submission
   Client → Swarm: SubmitTask(task_type, pieces, redundancy)

2. Task Decomposition
   Swarm → PieceManager: CreatePieces(task, input_chunks)

3. Piece Scheduling
   Scheduler: SelectPieces(available_peers, strategy)
   For each (piece, peer):
     Swarm → Peer: AssignPiece(piece_id, input_data)

4. Computation
   Peer: Execute(piece_input) → result
   Peer → Swarm: SubmitResult(piece_id, result_hash, data)

5. Verification
   When piece.results.len() >= piece.redundancy:
     Verifier: Verify(results, method)
     If verified:
       PieceManager: MarkVerified(piece_id, result)
       Reputation: UpdateSuccess(peers)
     Else:
       PieceManager: MarkFailed(piece_id)
       Reputation: UpdateFailure(disagreeing_peers)

6. Task Completion
   When all_pieces_verified(task_id):
     Swarm → Client: TaskComplete(aggregated_results)
     Economy: DistributeRewards(participating_peers)
```

### Configuration

```rust
pub struct SwarmConfig {
    pub local_peer_id: PeerId,
    pub scheduling_strategy: SchedulingStrategy,
    pub verification_method: VerificationMethod,
    pub default_redundancy: usize,      // Default: 3
    pub max_retries: usize,             // Default: 3
    pub piece_timeout: Duration,        // Default: 300s
    pub min_peer_reputation: f64,       // Default: 0.5
}
```

### Events

```rust
pub enum SwarmEvent {
    PeerConnected(PeerId),
    PeerDisconnected(PeerId),
    TaskSubmitted(TaskId),
    TaskCompleted(TaskId),
    TaskFailed(TaskId, String),
    PieceAssigned { task_id: TaskId, piece_index: usize, peer_id: PeerId },
    PieceCompleted { task_id: TaskId, piece_index: usize },
    PieceVerified { task_id: TaskId, piece_index: usize },
    PieceFailed { task_id: TaskId, piece_index: usize, reason: String },
}
```

## Rationale

### Why BitTorrent Model?

1. **Proven at Scale**: BitTorrent handles millions of concurrent transfers
2. **Rarest-First**: Ensures rare pieces get computed, preventing bottlenecks
3. **Piece Independence**: Each piece verifiable independently
4. **Fault Tolerance**: Built-in redundancy handling
5. **Economic Model**: Tit-for-tat maps naturally to AI Coin incentives

### Why Multiple Verification Methods?

Different use cases have different trust requirements:

- **HashMatch**: Deterministic operations (embeddings, hashing)
- **Majority**: Low-stakes inference tasks
- **Supermajority**: Financial or safety-critical applications
- **BFT**: Adversarial environments
- **TEE**: Hardware-backed security

### Why Hybrid Scheduling?

Pure rarest-first can ignore deadlines and priorities. Hybrid scoring balances:
- **Availability**: Rarest pieces get priority
- **Priority**: User-defined importance
- **Deadline**: Time-sensitive tasks
- **Reliability**: Avoid repeatedly-failing pieces

## Backwards Compatibility

This is a new protocol with no backwards compatibility concerns.

## Security Considerations

### Sybil Attacks

Mitigated through:
1. Reputation system penalizes failed verifications
2. Minimum reputation threshold for task assignment
3. DID-based identity (hanzo-did crate)
4. Stake requirements via AI Coin

### Result Manipulation

Mitigated through:
1. Redundant computation (default: 3 peers)
2. Consensus verification (supermajority recommended)
3. TEE attestation for high-value tasks
4. Cryptographic result hashes (Blake3)

### DoS Prevention

1. Rate limiting via scheduler capacity
2. Peer load tracking
3. Priority-based scheduling under load
4. Minimum reputation requirements

## Implementation

Reference implementation: `hanzo-compute` crate in `hanzo-node/hanzo-libs/hanzo-compute/`

```rust
// Example usage
let swarm = ComputeSwarm::new(SwarmConfig {
    scheduling_strategy: SchedulingStrategy::Hybrid,
    verification_method: VerificationMethod::SupermajorityConsensus,
    default_redundancy: 3,
    ..Default::default()
}).await?;

// Submit inference task
let task = ComputeTask::new(
    TaskType::Inference {
        model: "hanzo-llm-7b".to_string(),
        prompt: "Explain quantum computing".to_string(),
        max_tokens: 512,
    },
    1.0, // priority
)
.with_pieces(4)
.with_redundancy(3)
.with_deadline(Utc::now() + Duration::minutes(5));

let task_id = swarm.submit_task(task, input_chunks).await?;
```

## Test Vectors

See `/hanzo-libs/hanzo-compute/src/` test modules for comprehensive test cases:

- `peer::tests` - Peer management and reputation
- `piece::tests` - Piece lifecycle and state transitions
- `scheduler::tests` - Scheduling strategy validation
- `verifier::tests` - Consensus verification
- `swarm::tests` - Integration tests

## Related HIPs

- **HIP-0001**: AI Coin - Economic incentives for compute
- **HIP-0005**: Post-Quantum Security - Cryptographic primitives
- **HIP-0008**: Hanzo Market Maker - Compute resource pricing
- **HIP-0009**: Agent SDK - Task orchestration

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
