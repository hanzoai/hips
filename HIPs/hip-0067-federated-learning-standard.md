---
hip: 0067
title: Federated Learning Standard
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-02-23
requires: HIP-0024, HIP-0048, HIP-0054, HIP-0057
---

# HIP-67: Federated Learning Standard

## Abstract

This proposal defines the Federated Learning standard for privacy-preserving distributed model training in the Hanzo ecosystem. Hanzo FL enables multiple participants --- enterprises, hospitals, mobile devices, edge nodes --- to collaboratively train machine learning models without centralizing their raw data. Each participant trains locally on its own data and shares only model updates (gradients or weight deltas) with a central aggregation server that combines them into a global model.

The system supports two deployment modes: **cross-silo** federated learning for enterprise and institutional participants (tens to hundreds of reliable nodes with large datasets), and **cross-device** federated learning for mobile and IoT participants (millions of unreliable nodes with small datasets). It implements multiple aggregation strategies (FedAvg, FedSGD, FedProx, SCAFFOLD), differential privacy via per-client gradient clipping and calibrated noise injection (DP-SGD), secure aggregation using multi-party computation so the server never observes individual gradients, and an optional homomorphic encryption pathway for gradient-level confidentiality during aggregation.

Hanzo FL integrates with the ML Pipeline (HIP-0057) for training orchestration, Zero Trust (HIP-0054) for authenticated participant enrollment, Decentralized Identity (HIP-0048) for pseudonymous participant identity, and the Hanzo L1 chain (HIP-0024) for on-chain training round attestation and provenance.

**Repository**: [github.com/hanzoai/federated](https://github.com/hanzoai/federated)
**Port**: 8067 (API)
**Binary**: `hanzo-fl`
**Container**: `hanzoai/fl:latest`

## Motivation

### Data Cannot Always Move

The default approach to training a machine learning model is simple: collect all the data in one place and train on it. This works when the data is already centralized or when it can be freely copied. In practice, much of the world's most valuable training data cannot be moved:

1. **Healthcare data is legally immovable.** HIPAA in the United States, GDPR Article 9 in the EU, and PIPEDA in Canada impose strict restrictions on transferring patient health records. A hospital cannot upload its radiology images to a cloud training cluster without extensive legal agreements, de-identification pipelines, and audit trails --- and even then, the de-identification may be insufficient (research has shown that anonymized medical images can be re-identified through anatomical features). Federated learning lets the model come to the data, not the data to the model.

2. **Financial data is regulated across jurisdictions.** A multinational bank with operations in the US, EU, and Singapore faces three different data localization regimes. Customer transaction data generated in Singapore must, under MAS regulations, remain in Singapore. Transferring it to a US training cluster violates local law. Federated learning allows each regional branch to train locally and contribute gradient updates that contain no individual transaction records.

3. **Enterprise data is competitively sensitive.** When Hanzo approaches a Fortune 500 customer and proposes fine-tuning a Zen model on their internal documents, the first question is: "Does our data leave our network?" If the answer is yes, the deal is dead. Enterprise customers will not send their proprietary data to a third-party cloud, no matter how many NDAs are signed. Federated learning answers this question definitively: the raw data never leaves the customer's infrastructure.

4. **Edge data is too voluminous to centralize.** A fleet of 10 million mobile devices each generating 100 MB of behavioral data per day produces 1 PB/day. Uploading this to a central cluster is impractical --- the bandwidth cost alone is prohibitive, and the data is stale by the time it arrives. Federated learning trains on the data where it lives, using each device's idle compute.

### Why Not Anonymize and Centralize

The natural objection is: "Just anonymize the data and then centralize it." This fails for three reasons:

1. **Re-identification attacks are practical.** Research consistently demonstrates that anonymized datasets can be re-identified by linking them with auxiliary information. Netflix's anonymized movie ratings were de-anonymized using public IMDb reviews. Anonymized location data from mobile carriers was re-identified using publicly available social media check-ins. Medical imaging data carries anatomical signatures that survive all standard anonymization. The "anonymize then centralize" approach provides a false sense of privacy.

2. **Regulations prohibit it outright.** GDPR's Article 17 (right to erasure) and Article 20 (right to portability) apply to pseudonymized data, not just identified data. If there is any reasonable possibility of re-identification, the data is still personal data under GDPR. Healthcare regulators increasingly treat anonymization as insufficient --- the UK's NHS, for example, requires federated approaches for multi-institution research collaborations.

3. **Anonymization degrades data quality.** Effective anonymization (differential privacy applied to the dataset, k-anonymity, l-diversity) distorts the data. The stronger the privacy guarantee, the more distortion is introduced, and the less useful the data becomes for training. Federated learning avoids this tradeoff: the raw data retains full fidelity for local training, and privacy is enforced at the gradient level, where the distortion has far less impact on model quality.

### Why Hanzo Needs This

Hanzo's growth strategy depends on enterprise adoption. Enterprise customers want to fine-tune Zen models on their proprietary data. Without federated learning, this requires one of two unsatisfactory approaches:

- **Customer uploads data to Hanzo Cloud.** Most enterprises refuse this. The security review alone takes months, and many industries (healthcare, finance, defense) cannot approve it at all.
- **Hanzo deploys training infrastructure inside the customer's network.** This is expensive, operationally complex, and does not scale. Each customer deployment requires custom infrastructure, and the resulting models are isolated --- there is no way to benefit from collaborative training across customers.

Federated learning provides a third path: Hanzo operates the aggregation server and the global model; each customer runs a lightweight FL client inside their network. The customer's data never leaves their infrastructure. The global model improves from every customer's contribution without any single customer's data being exposed. This is the only approach that scales enterprise AI adoption while respecting data sovereignty.

## Design Philosophy

### Why Federated Averaging as the Default Strategy

Federated Averaging (FedAvg), introduced by McMahan et al. (2017), is the workhorse of federated learning. Each client performs multiple local training steps (epochs) on its data, then sends the resulting weight delta to the server, which averages them weighted by dataset size. The alternative --- Federated SGD (FedSGD) --- has each client compute a single gradient batch and send it to the server.

We default to FedAvg because:

1. **Communication efficiency.** FedSGD requires one server round-trip per gradient step. For a model with 7 billion parameters, each gradient is ~28 GB in FP32. Sending this every step is impractical even on fast networks. FedAvg reduces communication by 10-100x: the client trains for E local epochs, then sends one weight delta per round.

2. **Client compute utilization.** Cross-silo participants (enterprise GPU clusters) have significant local compute. FedSGD wastes it by limiting each client to a single gradient computation per round. FedAvg lets each client fully utilize its GPUs during local training.

3. **Tolerance to heterogeneity.** Real federated settings have heterogeneous data distributions (non-IID data). FedAvg, despite its simplicity, performs well on moderately heterogeneous data. For severely non-IID settings, we provide FedProx and SCAFFOLD as alternatives (described in the specification).

The tradeoff: FedAvg can diverge when data heterogeneity is extreme (each client has data from only one or two classes). FedProx addresses this by adding a proximal term that penalizes local model drift. SCAFFOLD goes further by using control variates to correct client drift. The system defaults to FedAvg but allows the operator to switch strategies per training job.

### Cross-Device vs Cross-Silo: Two Different Problems

Federated learning is often discussed as a single paradigm, but the engineering requirements differ dramatically between cross-device and cross-silo deployments:

| Dimension | Cross-Silo | Cross-Device |
|-----------|-----------|--------------|
| Participants | 2-500 organizations | 10,000-10,000,000 devices |
| Availability | Always on, reliable | Intermittent, unreliable |
| Compute per client | Multi-GPU servers | Single mobile CPU/GPU |
| Data per client | Millions of records | Hundreds of records |
| Network | Datacenter links (1-10 Gbps) | Mobile networks (1-100 Mbps) |
| Identity | Named, authenticated | Pseudonymous, enrolled |
| Scheduling | All clients in every round | Random subset per round |
| Failure mode | Rare, handled by retry | Frequent, handled by redundancy |

The system implements both modes with shared core infrastructure (aggregation logic, privacy mechanisms, model management) but different scheduling, communication, and fault-tolerance strategies.

### Why Differential Privacy at the Gradient Level

Federated learning protects raw data by keeping it on-device, but gradient updates can still leak information. Gradient inversion attacks (Zhu et al., 2019) reconstruct training samples from observed gradients with surprising fidelity. For a model fine-tuned on text, an attacker observing gradients can recover individual training sentences.

Differential privacy (DP) provides a mathematically rigorous defense. The mechanism is DP-SGD adapted for the federated setting:

1. **Per-client gradient clipping.** Before a client sends its gradient update, it clips the L2 norm to a maximum value C. This bounds the influence of any single data point on the gradient.
2. **Calibrated noise injection.** The server adds Gaussian noise with standard deviation proportional to C/epsilon to the aggregated gradient, where epsilon is the privacy budget.
3. **Privacy accounting.** The system tracks cumulative privacy spend across training rounds using the Renyi Differential Privacy accountant, providing a tight bound on total privacy loss (epsilon, delta).

The result: even an adversary who observes every aggregated gradient update cannot determine, with confidence exceeding the privacy budget, whether any specific data point was included in any client's training set.

### Why Secure Aggregation via MPC

Differential privacy protects against inference from the aggregated result. Secure aggregation protects individual updates during aggregation --- it ensures the server never sees any single client's gradient in the clear.

The protocol uses additive secret sharing (a form of multi-party computation):

1. Each client splits its gradient update into N random shares that sum to the original.
2. Each share is encrypted and sent to a different subset of peers (or to the server via different channels).
3. The server (or a set of non-colluding aggregation nodes) sums all shares, recovering only the aggregate gradient, never individual contributions.

This is critical for cross-silo deployments where participants are competitors. A hospital contributing to a collaborative cancer detection model does not want the aggregation server (or other hospitals) to learn anything about its individual patient population from its gradient updates. Secure aggregation provides this guarantee cryptographically, not just by policy.

The tradeoff is communication overhead: secure aggregation increases the data transmitted per round by a factor proportional to the number of participants. For cross-silo (tens of participants), this is acceptable. For cross-device (millions), we use a more efficient protocol that tolerates client dropouts.

## Specification

### Architecture Overview

```
                    ┌──────────────────────────────────────────────┐
                    │        Hanzo FL Aggregation Server (8067)     │
                    │                                              │
                    │  ┌───────────┐ ┌───────────┐ ┌────────────┐ │
                    │  │ Round     │ │ Aggregation│ │ Privacy    │ │
                    │  │ Scheduler │ │ Engine     │ │ Accountant │ │
                    │  └─────┬─────┘ └─────┬─────┘ └──────┬─────┘ │
                    │        │             │              │       │
                    │  ┌─────┴─────────────┴──────────────┴────┐  │
                    │  │          Secure Aggregation Layer       │  │
                    │  └─────┬──────────┬──────────┬───────────┘  │
                    └────────┼──────────┼──────────┼──────────────┘
                             │          │          │
                    ┌────────┴──┐ ┌─────┴────┐ ┌──┴──────────┐
                    │  Client A │ │ Client B │ │  Client C   │
                    │  (Hosp 1) │ │ (Hosp 2) │ │  (Bank)     │
                    │  Local    │ │ Local    │ │  Local      │
                    │  Training │ │ Training │ │  Training   │
                    │  ┌──────┐ │ │ ┌──────┐ │ │  ┌──────┐  │
                    │  │ Data │ │ │ │ Data │ │ │  │ Data │  │
                    │  └──────┘ │ │ └──────┘ │ │  └──────┘  │
                    └───────────┘ └──────────┘ └────────────┘
                     Data stays    Data stays    Data stays
                     on-premise    on-premise    on-premise
```

**Aggregation Server** (port 8067) is the control plane. It coordinates training rounds, selects clients, distributes the global model, collects encrypted gradient updates, performs secure aggregation, applies differential privacy, and publishes round attestations to the Hanzo L1 chain.

**FL Clients** run inside each participant's network. They download the global model at the start of each round, perform local training on private data, clip and encrypt gradient updates, and send them to the aggregation server. The client is a lightweight binary (`hanzo-fl-client`) that wraps PyTorch training loops.

### Participant Enrollment

Before participating in federated training, each client must enroll through a two-phase process that integrates Zero Trust (HIP-0054) and Decentralized Identity (HIP-0048):

```
Participant                    FL Server (8067)           IAM / DID
     │                              │                        │
     │  1. POST /v1/enroll          │                        │
     │     { did, credentials }     │                        │
     ├─────────────────────────────►│                        │
     │                              │  2. Resolve DID        │
     │                              ├───────────────────────►│
     │                              │  3. Verify VCs         │
     │                              │◄───────────────────────┤
     │                              │                        │
     │                              │  4. Check ZT policy    │
     │                              │     (mTLS identity)    │
     │                              │                        │
     │  5. { participant_id,        │                        │
     │       client_cert,           │                        │
     │       training_config }      │                        │
     │◄─────────────────────────────┤                        │
     │                              │                        │
     │  6. POST /v1/heartbeat       │                        │
     │     (periodic)               │                        │
     ├─────────────────────────────►│                        │
```

**DID-based identity** (HIP-0048) provides pseudonymous participation. A hospital enrolls with `did:hanzo:hospital-xyz`, not with its legal name. The DID document attests to the participant's capabilities (GPU count, dataset size estimate, network bandwidth) via Verifiable Credentials. The FL server verifies these credentials without learning the participant's real identity.

**Zero Trust authentication** (HIP-0054) ensures that every connection from every client is mTLS-authenticated with SPIFFE identities. The FL server's access policy explicitly enumerates which SPIFFE IDs may participate in each training job.

### Training Round Protocol

A single federated training round proceeds as follows:

```yaml
Round Protocol:
  1_server_broadcasts_global_model:
    action: Server sends current global model weights to selected clients
    format: safetensors (compressed with zstd)
    optimization: Delta compression after round 1 (send only changed weights)

  2_client_performs_local_training:
    action: Each client trains on local data for E local epochs
    output: Weight delta = local_weights - global_weights
    clipping: Clip delta L2 norm to C (per-client gradient clipping)
    encryption: Encrypt clipped delta using secure aggregation shares

  3_client_sends_encrypted_update:
    action: Client sends encrypted weight delta + metadata to server
    metadata:
      dataset_size: integer     # Number of local training samples
      local_loss: float         # Final local training loss (optional, DP noise added)
      compute_time_s: float     # Wall-clock training time
      round_id: string          # Round identifier

  4_server_performs_secure_aggregation:
    action: Server reconstructs aggregate gradient from encrypted shares
    result: Weighted average of all client deltas (weighted by dataset_size)
    guarantee: Server never observes any individual client's delta

  5_server_applies_differential_privacy:
    action: Add calibrated Gaussian noise to aggregate gradient
    noise_scale: sensitivity * sqrt(2 * ln(1.25/delta)) / epsilon
    accounting: Update cumulative (epsilon, delta) via RDP accountant

  6_server_updates_global_model:
    action: global_weights += noisy_aggregate_delta
    checkpoint: Save global model to Object Storage (HIP-0032)

  7_server_publishes_round_attestation:
    action: Publish round metadata to Hanzo L1 (HIP-0024)
    attestation:
      round_id: string
      num_participants: integer
      aggregate_loss: float (DP noise added)
      privacy_budget_spent: { epsilon, delta }
      model_checkpoint_hash: sha256
      timestamp: ISO 8601
```

### Aggregation Strategies

The system implements four aggregation strategies, selectable per training job:

```yaml
Aggregation Strategies:

  fedavg:
    description: >
      Federated Averaging. Each client trains for E local epochs,
      sends weight delta. Server computes weighted average by dataset size.
    when_to_use: Default for most tasks. Works well with moderate data heterogeneity.
    parameters:
      local_epochs: 5           # Number of local training epochs per round
      learning_rate: 0.01       # Client-side learning rate
    reference: McMahan et al., 2017

  fedsgd:
    description: >
      Federated SGD. Each client computes one gradient batch, sends it.
      Server averages gradients and applies a single update.
    when_to_use: When data is highly heterogeneous and local drift is unacceptable.
    parameters:
      batch_size: 64
      learning_rate: 0.1
    reference: McMahan et al., 2017

  fedprox:
    description: >
      FedAvg with a proximal term that penalizes local model divergence
      from the global model. Addresses heterogeneity by preventing clients
      from drifting too far during local training.
    when_to_use: Non-IID data where FedAvg diverges.
    parameters:
      local_epochs: 5
      learning_rate: 0.01
      mu: 0.1                  # Proximal term weight (higher = more regularization)
    reference: Li et al., 2020

  scaffold:
    description: >
      Uses control variates to correct client drift. Each client maintains
      a correction term that estimates the difference between its local
      gradient and the global gradient. More communication-efficient
      convergence than FedProx on severely non-IID data.
    when_to_use: Severely heterogeneous data, when convergence speed matters.
    parameters:
      local_epochs: 5
      learning_rate: 0.01
      # No mu: SCAFFOLD's correction is parameter-free once initialized
    reference: Karimireddy et al., 2020
```

### Differential Privacy Configuration

```yaml
Differential Privacy:
  mechanism: dp_sgd_federated

  per_client_clipping:
    max_grad_norm: 1.0         # L2 norm bound C for each client's update
    clip_strategy: flat        # flat | per_layer | adaptive

  noise_injection:
    noise_multiplier: 1.1      # sigma = noise_multiplier * C / num_clients
    noise_type: gaussian       # Gaussian mechanism for (epsilon, delta)-DP

  privacy_accounting:
    accountant: rdp            # Renyi DP accountant (tightest known bounds)
    target_epsilon: 8.0        # Total privacy budget
    target_delta: 1e-5         # Failure probability (should be < 1/dataset_size)
    auto_stop: true            # Stop training when budget is exhausted

  subsampling:
    client_sampling_rate: 0.1  # Fraction of clients selected per round
    amplification: true        # Apply privacy amplification by subsampling
```

**Privacy amplification by subsampling.** When only a random fraction q of clients participate in each round, the effective privacy cost per round is reduced. For q=0.1 (10% of clients per round), the privacy amplification factor is roughly sqrt(q), reducing the effective noise needed by ~3x for the same privacy guarantee. The privacy accountant tracks this automatically.

### Secure Aggregation Protocol

The secure aggregation protocol ensures the server learns only the sum of client updates, not individual contributions.

```yaml
Secure Aggregation (Cross-Silo):
  protocol: additive_secret_sharing

  setup_phase:
    - Each pair of clients (i, j) establishes a shared secret s_ij via DH key agreement
    - Client i computes mask_i = sum_j(PRG(s_ij)) - sum_j(PRG(s_ji))
    - Note: masks cancel out in the aggregate (sum of all mask_i = 0)

  upload_phase:
    - Client i sends: masked_update_i = update_i + mask_i
    - Server receives masked updates (individual updates are hidden by masks)

  aggregation_phase:
    - Server computes: sum(masked_update_i) = sum(update_i) + sum(mask_i)
    - Since sum(mask_i) = 0: server recovers sum(update_i) exactly
    - Individual update_i values are information-theoretically hidden

  dropout_handling:
    - If client j drops out, clients that share secrets with j reveal s_ij
    - Server reconstructs j's mask to cancel it from the aggregate
    - Threshold: aggregation succeeds if >= 2/3 of selected clients complete

Secure Aggregation (Cross-Device):
  protocol: bonawitz_2017
  description: >
    Optimized for millions of clients with high dropout rates.
    Uses a two-round protocol with pairwise masking and
    threshold secret sharing for dropout recovery.
  dropout_tolerance: 50%       # Aggregation succeeds with 50% dropout
```

### Homomorphic Encryption Option

For participants requiring cryptographic confidentiality beyond secure aggregation, the system supports Partially Homomorphic Encryption (PHE) using the Paillier cryptosystem:

```yaml
Homomorphic Encryption:
  scheme: paillier
  key_size: 2048              # Paillier key size in bits
  enabled: false              # Opt-in per training job

  protocol:
    - Server generates Paillier keypair (pk, sk)
    - Server distributes pk to all clients
    - Client encrypts gradient update: Enc(pk, update_i)
    - Server computes: Enc(pk, sum(update_i)) = product(Enc(pk, update_i))
      # Paillier is additively homomorphic
    - Server decrypts aggregate: Dec(sk, Enc(pk, sum(update_i))) = sum(update_i)

  tradeoffs:
    - Ciphertext expansion: ~64x (FP32 gradient -> 2048-bit ciphertext per element)
    - Computation overhead: ~100x slower than plaintext aggregation
    - Recommended only for small models or when regulatory requirements mandate it
```

The tradeoff is severe: homomorphic encryption introduces 64x communication overhead and 100x computation overhead. For most deployments, secure aggregation via MPC (which has no ciphertext expansion) is sufficient. HE is provided for regulated environments where even masked gradients are considered unacceptable.

### Client Selection and Scheduling

```yaml
Client Selection:

  cross_silo:
    strategy: all              # All enrolled clients participate every round
    min_clients_per_round: 2   # Minimum to proceed (otherwise round is skipped)
    timeout: 600s              # Max wait for client updates before proceeding

  cross_device:
    strategy: random_sample
    clients_per_round: 100     # Select 100 clients from pool
    eligibility_criteria:
      min_battery: 80%         # Device must have >= 80% battery
      charging: preferred      # Prefer devices on charger
      network: wifi_only       # Only select devices on WiFi
      idle: true               # Device must be idle (screen off, no active use)
    oversampling: 1.3          # Select 130 to account for 30% expected dropout
    scheduling_window:
      start: "02:00"           # Schedule rounds during off-peak hours (local time)
      end: "06:00"

Heterogeneous Device Handling:
  stragglers:
    strategy: deadline         # Ignore updates arriving after deadline
    deadline: 2x_median        # Deadline = 2x the median client completion time
    min_updates: 0.7           # Require at least 70% of selected clients
  compute_scaling:
    strategy: adaptive_epochs  # Faster clients do more local epochs
    min_epochs: 1
    max_epochs: 10
    target_time: 120s          # Each client trains for ~120s regardless of speed
```

### Model Poisoning Detection

Byzantine-robust aggregation detects and mitigates malicious or faulty client updates:

```yaml
Byzantine Robustness:

  detection_methods:
    norm_check:
      description: Reject updates with L2 norm > threshold * median_norm
      threshold: 3.0           # 3x the median update norm

    cosine_similarity:
      description: Reject updates with low cosine similarity to the aggregate
      min_similarity: 0.1      # Updates anti-correlated with the aggregate are suspicious

    krum:
      description: >
        Multi-Krum selection. For each update, compute sum of distances
        to its n-f-2 nearest neighbors (f = number of Byzantine clients).
        Select the m updates with smallest scores.
      f: 1                     # Assumed number of Byzantine clients
      m: null                  # Default: num_clients - f (select all but worst)
      reference: Blanchard et al., 2017

    trimmed_mean:
      description: >
        For each model parameter, sort the values across clients,
        trim the top and bottom beta fraction, and average the rest.
      beta: 0.1                # Trim 10% from each tail
      reference: Yin et al., 2018

  response:
    action: exclude_and_flag   # Exclude suspicious update, flag participant
    consecutive_flags: 3       # After 3 flags, quarantine participant
    quarantine_duration: 24h   # Participant excluded for 24 hours
    alert: true                # Notify FL operator of quarantine event
```

### Convergence Monitoring and Early Stopping

```yaml
Convergence Monitoring:
  metrics:
    global_loss:
      description: Loss computed on a held-out validation set at the server
      frequency: every_round
      window: 10               # Smoothed over last 10 rounds

    client_loss_variance:
      description: Variance of local losses across clients (DP noise added)
      frequency: every_round
      alert_threshold: 0.5     # High variance indicates heterogeneity issues

    gradient_norm:
      description: L2 norm of the aggregated gradient
      frequency: every_round
      convergence_signal: <0.01 # Near-zero gradient norm signals convergence

  early_stopping:
    enabled: true
    patience: 20               # Stop if no improvement for 20 rounds
    min_delta: 0.001           # Minimum loss improvement to count as progress
    min_rounds: 50             # Train for at least 50 rounds regardless
    max_rounds: 1000           # Hard stop after 1000 rounds

  checkpointing:
    frequency: every_10_rounds
    storage: "s3://hanzo-fl/checkpoints/{job_id}/"
    keep_best: 3               # Retain top 3 checkpoints by validation loss
```

### On-Chain Training Round Attestation

Each completed training round publishes an attestation to the Hanzo L1 chain (HIP-0024, chain ID 36963), creating an immutable record of the training process:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFederatedTrainingRegistry {
    event RoundCompleted(
        bytes32 indexed jobId,
        uint256 indexed roundNumber,
        uint256 numParticipants,
        bytes32 modelCheckpointHash,
        uint256 cumulativeEpsilon,   // Privacy budget spent (scaled by 1e6)
        uint256 timestamp
    );

    event JobCompleted(
        bytes32 indexed jobId,
        bytes32 finalModelHash,
        uint256 totalRounds,
        uint256 totalParticipants,
        uint256 finalEpsilon
    );

    /// @notice Record a completed training round.
    function attestRound(
        bytes32 jobId,
        uint256 roundNumber,
        uint256 numParticipants,
        bytes32 modelCheckpointHash,
        uint256 cumulativeEpsilon
    ) external;

    /// @notice Finalize a training job.
    function finalizeJob(
        bytes32 jobId,
        bytes32 finalModelHash,
        uint256 totalRounds
    ) external;

    /// @notice Verify training provenance for a model.
    function getProvenance(bytes32 jobId)
        external
        view
        returns (
            uint256 totalRounds,
            uint256 totalParticipants,
            bytes32 finalModelHash,
            uint256 finalEpsilon,
            bool finalized
        );
}
```

This on-chain attestation serves two purposes:

1. **Training provenance.** When a model is deployed, anyone can verify how it was trained: how many rounds, how many participants, what privacy budget was spent, and that the model checkpoint hash matches. This is critical for regulatory compliance (EU AI Act requires AI systems to document training provenance).

2. **Participant accountability.** The round attestation records the number of participants (not their identities). Combined with the enrollment records, an auditor can verify that the training process involved the claimed participants without revealing individual contributions.

### Integration with ML Pipeline (HIP-0057)

Federated training jobs are submitted through the ML Pipeline API (HIP-0057) with a `type: federated` specifier:

```yaml
Job Submission:
  name: "zen-7b-medical-federated"
  type: federated
  image: "hanzoai/fl-pytorch:2.3-cuda12.4"

  model:
    base: "zenlm/zen-7b"
    method: lora
    lora_rank: 32
    lora_alpha: 64

  federated:
    mode: cross_silo
    aggregation: fedavg
    local_epochs: 5
    total_rounds: 200
    min_clients_per_round: 3

    privacy:
      differential_privacy: true
      target_epsilon: 8.0
      target_delta: 1e-5
      max_grad_norm: 1.0

    secure_aggregation: true

    byzantine_robustness:
      method: trimmed_mean
      beta: 0.1

  participants:
    - did: "did:hanzo:hospital-alpha"
      spiffe: "spiffe://hanzo.ai/fl-clients/hospital-alpha"
    - did: "did:hanzo:hospital-beta"
      spiffe: "spiffe://hanzo.ai/fl-clients/hospital-beta"
    - did: "did:hanzo:hospital-gamma"
      spiffe: "spiffe://hanzo.ai/fl-clients/hospital-gamma"
```

When the job completes, the resulting model is registered in the ML Pipeline's Model Registry (HIP-0057) with federated training metadata: participant count, total rounds, privacy budget consumed, and the on-chain attestation transaction hash.

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| **Enrollment** | | |
| `/v1/enroll` | POST | Enroll a participant (DID + VCs + mTLS) |
| `/v1/participants` | GET | List enrolled participants (operator only) |
| `/v1/participants/{id}` | DELETE | Remove a participant |
| **Jobs** | | |
| `/v1/jobs` | POST | Create a federated training job |
| `/v1/jobs/{id}` | GET | Get job status, round progress, privacy budget |
| `/v1/jobs/{id}/cancel` | POST | Cancel a running job |
| `/v1/jobs/{id}/rounds` | GET | List completed rounds with metrics |
| `/v1/jobs/{id}/provenance` | GET | Get on-chain attestation proof |
| **Client Protocol** | | |
| `/v1/rounds/current` | GET | Get current round info and global model URL |
| `/v1/rounds/{id}/update` | POST | Submit encrypted gradient update |
| `/v1/rounds/{id}/status` | GET | Round aggregation status |
| **Monitoring** | | |
| `/v1/jobs/{id}/metrics` | GET | Convergence metrics (loss, gradient norm) |
| `/v1/jobs/{id}/privacy` | GET | Privacy budget consumption over time |
| `/v1/jobs/{id}/participants/health` | GET | Client health and participation rates |
| `/health` | GET | Service health check |
| `/metrics` | GET | Prometheus metrics |

### Configuration

```yaml
# /etc/hanzo-fl/config.yaml

server:
  host: 0.0.0.0
  port: 8067
  workers: 4

database:
  url: "postgresql://hanzo:password@postgres:5432/hanzo_fl"

storage:
  endpoint: "http://minio:9000"
  access_key: "${HANZO_STORAGE_ACCESS_KEY}"
  secret_key: "${HANZO_STORAGE_SECRET_KEY}"
  bucket: "hanzo-fl"

chain:
  rpc_url: "https://api.hanzo.ai/ext/bc/hanzo/rpc"
  chain_id: 36963
  registry_address: "0xFLRegistryContractAddress"
  attestation_key: "${FL_ATTESTATION_KEY}"   # From KMS (HIP-0027)

auth:
  iam_url: "https://hanzo.id"
  verify_tokens: true
  spire_socket: "/run/spire/sockets/agent.sock"

privacy:
  default_epsilon: 8.0
  default_delta: 1e-5
  max_epsilon: 20.0            # Hard cap on privacy budget per job
  accountant: rdp

secure_aggregation:
  enabled: true
  dropout_threshold: 0.67      # Minimum fraction of clients to complete aggregation

metrics:
  enabled: true
  port: 9090
  path: /metrics

logging:
  level: info
  format: json
```

## Implementation

### Client Binary

The FL client is a standalone binary that runs inside the participant's network:

```bash
# Install
curl -fsSL https://get.hanzo.ai/fl | sh

# Enroll
hanzo-fl-client enroll \
  --server https://fl.hanzo.ai:8067 \
  --did "did:hanzo:hospital-alpha" \
  --credential ./safety-eval.vc.json \
  --data-path /data/radiology/ \
  --gpu-count 2

# Join a training job
hanzo-fl-client train \
  --job "zen-7b-medical-federated" \
  --local-epochs 5 \
  --batch-size 16

# Check status
hanzo-fl-client status
```

The client binary:
- Downloads the global model at the start of each round
- Runs local training using PyTorch with the specified configuration
- Clips gradient norms per the job's DP configuration
- Encrypts the update using the secure aggregation protocol
- Uploads the encrypted update to the FL server
- Reports local metrics (with DP noise) for monitoring

### Deployment

#### Docker

```bash
docker run -p 8067:8067 -p 9090:9090 \
  -e HANZO_FL_DATABASE_URL="postgresql://..." \
  -e HANZO_FL_STORAGE_ENDPOINT="http://minio:9000" \
  -e HANZO_FL_CHAIN_RPC_URL="https://api.hanzo.ai/ext/bc/hanzo/rpc" \
  hanzoai/fl:latest
```

#### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hanzo-fl
  namespace: hanzo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: hanzo-fl
  template:
    metadata:
      labels:
        app: hanzo-fl
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9090"
    spec:
      serviceAccountName: hanzo-fl
      containers:
        - name: hanzo-fl
          image: hanzoai/fl:latest
          ports:
            - containerPort: 8067
              name: api
            - containerPort: 9090
              name: metrics
          env:
            - name: HANZO_FL_DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: hanzo-fl-secrets
                  key: database-url
          readinessProbe:
            httpGet:
              path: /health
              port: 8067
          livenessProbe:
            httpGet:
              path: /health
              port: 8067
---
apiVersion: v1
kind: Service
metadata:
  name: hanzo-fl
  namespace: hanzo
spec:
  selector:
    app: hanzo-fl
  ports:
    - name: api
      port: 8067
    - name: metrics
      port: 9090
```

### Prometheus Metrics

```yaml
Metrics:
  Counters:
    hanzo_fl_rounds_total{job_id, status}            # Completed rounds
    hanzo_fl_updates_received_total{job_id}           # Client updates received
    hanzo_fl_updates_rejected_total{job_id, reason}   # Rejected updates (norm, byzantine)
    hanzo_fl_attestations_total{job_id}               # On-chain attestations published

  Histograms:
    hanzo_fl_round_duration_seconds{job_id}           # Round wall-clock time
    hanzo_fl_aggregation_duration_seconds{job_id}     # Secure aggregation compute time
    hanzo_fl_client_update_size_bytes{job_id}          # Update payload size

  Gauges:
    hanzo_fl_active_jobs                              # Currently running FL jobs
    hanzo_fl_enrolled_participants{job_id}             # Enrolled clients per job
    hanzo_fl_privacy_epsilon_remaining{job_id}         # Remaining privacy budget
    hanzo_fl_global_loss{job_id}                       # Current global validation loss
    hanzo_fl_client_participation_rate{job_id}         # Fraction of clients completing rounds
```

### Implementation Roadmap

**Phase 1: Cross-Silo Core (Q2 2026)**
- FedAvg aggregation with weighted averaging
- Participant enrollment with DID and mTLS
- Per-client gradient clipping (DP-SGD clipping component)
- Basic convergence monitoring and early stopping
- CLI client binary for Linux and macOS
- Integration with ML Pipeline for job submission

**Phase 2: Privacy and Security (Q3 2026)**
- Differential privacy with RDP accounting and auto-stop
- Secure aggregation via additive secret sharing
- Byzantine-robust aggregation (Krum, trimmed mean)
- On-chain round attestation on Hanzo L1
- Model poisoning detection and participant quarantine

**Phase 3: Cross-Device Support (Q4 2026)**
- Cross-device client selection and scheduling
- Dropout-tolerant secure aggregation (Bonawitz protocol)
- Adaptive local epochs for heterogeneous devices
- Mobile client SDK (iOS, Android)
- Delta compression for bandwidth efficiency

**Phase 4: Advanced Strategies and HE (Q1 2027)**
- FedProx and SCAFFOLD aggregation strategies
- Homomorphic encryption option (Paillier)
- Federated hyperparameter optimization
- Privacy amplification by subsampling (formal integration)
- Multi-task federated learning (multiple models per job)

## Security Considerations

### Threat Model

| Threat | Mitigation |
|--------|-----------|
| **Gradient inversion** (reconstructing data from gradients) | Differential privacy (DP-SGD) + secure aggregation |
| **Model poisoning** (malicious client sends corrupted updates) | Byzantine-robust aggregation (Krum, trimmed mean, norm checks) |
| **Free-riding** (client claims participation without training) | Minimum update norm check + local loss consistency verification |
| **Sybil attack** (attacker enrolls many fake clients) | DID-based enrollment with Verifiable Credentials + rate limiting |
| **Server compromise** (attacker controls aggregation server) | Secure aggregation ensures server never sees individual updates |
| **Network eavesdropping** (attacker intercepts client-server traffic) | mTLS (HIP-0054) encrypts all communication |
| **Privacy budget exhaustion** (training too many rounds leaks info) | RDP accountant with hard epsilon cap and auto-stop |

### Data at Rest

The FL server stores only aggregated model checkpoints, never individual client updates. Client updates exist in memory only during the secure aggregation computation and are discarded immediately after. The aggregated model checkpoints are encrypted at rest in Object Storage (HIP-0032) using server-side encryption.

### Audit Trail

Every enrollment, round, aggregation, quarantine, and attestation event is logged to the audit system with the participant's DID (not real identity), timestamp, and event type. Audit logs are append-only and retained for the lifetime of the training job plus 365 days.

### Privacy Budget Enforcement

The privacy budget (epsilon, delta) is enforced at the server level. The server refuses to start a new round if the cumulative privacy spend would exceed the job's configured target. This prevents operators from accidentally training beyond the privacy guarantee. The hard cap (`max_epsilon: 20.0` in configuration) is a system-level safety net that cannot be overridden per-job.

## References

1. [McMahan et al., "Communication-Efficient Learning of Deep Networks from Decentralized Data" (2017)](https://arxiv.org/abs/1602.05629) - FedAvg
2. [Li et al., "Federated Optimization in Heterogeneous Networks" (2020)](https://arxiv.org/abs/1812.06127) - FedProx
3. [Karimireddy et al., "SCAFFOLD: Stochastic Controlled Averaging for Federated Learning" (2020)](https://arxiv.org/abs/1910.06378) - SCAFFOLD
4. [Bonawitz et al., "Practical Secure Aggregation for Privacy-Preserving Machine Learning" (2017)](https://dl.acm.org/doi/10.1145/3133956.3133982) - Secure aggregation
5. [Abadi et al., "Deep Learning with Differential Privacy" (2016)](https://arxiv.org/abs/1607.00133) - DP-SGD
6. [Zhu et al., "Deep Leakage from Gradients" (2019)](https://arxiv.org/abs/1906.08935) - Gradient inversion attacks
7. [Blanchard et al., "Machine Learning with Adversaries: Byzantine Tolerant Gradient Descent" (2017)](https://arxiv.org/abs/1703.02757) - Krum
8. [Yin et al., "Byzantine-Robust Distributed Learning" (2018)](https://arxiv.org/abs/1803.10032) - Trimmed mean
9. [Paillier, "Public-Key Cryptosystems Based on Composite Degree Residuosity Classes" (1999)](https://link.springer.com/chapter/10.1007/3-540-48910-X_16) - Paillier HE
10. [HIP-0024: Hanzo Sovereign L1 Chain Architecture](./hip-0024-hanzo-sovereign-l1-chain-architecture.md) - On-chain attestation
11. [HIP-0048: Decentralized Identity Standard](./hip-0048-decentralized-identity-standard.md) - Participant DID identity
12. [HIP-0054: Zero Trust Architecture Standard](./hip-0054-zero-trust-architecture-standard.md) - mTLS and participant enrollment
13. [HIP-0057: ML Pipeline & Training Standard](./hip-0057-ml-pipeline-standard.md) - Training orchestration
14. [HIP-0032: Object Storage Standard](./hip-0032-object-storage-standard.md) - Model checkpoint storage
15. [HIP-0027: Secrets Management Standard](./hip-0027-secrets-management-standard.md) - Attestation key custody

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
