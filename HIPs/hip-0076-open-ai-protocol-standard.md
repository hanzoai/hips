---
hip: 0076
title: Open AI Protocol & Decentralized Inference Standard
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-02-23
requires: 0001, 0004, 0008, 0023, 0024, 0048, 0054
---

# HIP-0076: Open AI Protocol & Decentralized Inference Standard

## Abstract

This HIP defines the Open AI Protocol (OAP), a permissionless standard for decentralized AI model serving, discovery, and payment. OAP specifies how AI models are published to an on-chain registry, how inference providers stake $AI tokens to offer GPU compute, how consumers discover and pay for inference on a per-token basis, and how the network cryptographically verifies that inference was performed correctly.

The protocol sits above the Swarm compute layer (HIP-0023) and below application clients like the LLM Gateway (HIP-0004). It is the marketplace layer: the set of rules that turn raw GPU capacity into a functioning, trustless, economically sound AI inference market.

**Repository**: [github.com/hanzoai/protocol](https://github.com/hanzoai/protocol)
**Port**: 8076
**Docker**: `ghcr.io/hanzoai/protocol:latest`
**Production**: https://protocol.hanzo.ai

## Motivation

### The Convergence of Blockchain and AI

Blockchain and AI are often discussed as separate technology waves. In practice, they solve complementary problems that neither can address alone.

AI has a **trust problem**. When you call a centralized API, you trust that the provider ran the model they claim, on the inputs you sent, without modification. You trust their pricing is fair. You trust they will not censor your request based on content. You trust they will not train on your data. You have no way to verify any of this. The relationship is entirely fiduciary.

Blockchain has a **utility problem**. Most blockchain applications are financial instruments trading other financial instruments. The technology provides extraordinary guarantees --- permissionless access, censorship resistance, transparent economics, cryptographic verification --- but these guarantees are applied to use cases (token swaps, NFTs, governance votes) that represent a fraction of the global economy.

Decentralized AI inference is the use case where both problems meet. AI needs the trust guarantees that blockchain provides. Blockchain needs the economic gravity that AI generates. The global AI inference market is projected to exceed $100 billion annually by 2028. Routing even a fraction of that volume through a permissionless, verifiable protocol creates a blockchain application with genuine economic substance.

This is not a speculative thesis. The components already exist within the Hanzo ecosystem:

- **$AI token** (HIP-0001) provides the unit of account and staking asset
- **Hanzo L1** (HIP-0024) provides the settlement and registry layer
- **HMM** (HIP-0008) provides dynamic pricing via Hamiltonian invariants
- **Swarm Protocol** (HIP-0023) provides the GPU compute network
- **DID** (HIP-0048) provides cryptographic identity for providers and consumers

HIP-0076 is the protocol that connects them into a coherent marketplace.

### Why Not Just Use Centralized APIs?

A fair question. OpenAI, Anthropic, Google, and others provide inference APIs that work today, at scale, with low latency. Why build a decentralized alternative?

**1. Single points of failure.** On March 5, 2024, OpenAI experienced a multi-hour outage that took down thousands of applications. On January 15, 2025, Anthropic's API was degraded for six hours. Every centralized provider is a single point of failure. A decentralized network with hundreds of providers has no single point of failure --- individual providers go down; the network persists.

**2. Pricing power.** Centralized providers set prices unilaterally. When OpenAI raised GPT-4 API prices in 2024, consumers had no recourse except to switch providers (often with significant migration cost). In a decentralized marketplace, prices are set by open competition among providers. No single entity has pricing power.

**3. Content filtering.** Every centralized provider applies content policies that determine what requests they will serve. These policies differ across providers, change without notice, and are applied opaquely. A permissionless protocol serves any request that a willing provider accepts. Content policy becomes a provider-level choice, not a network-level constraint.

**4. Geographic restrictions.** Centralized providers comply with export controls and regional regulations by blocking access from certain jurisdictions. A permissionless network has no geographic gatekeeping --- providers and consumers transact directly, with compliance handled at the provider level where applicable.

**5. Data sovereignty.** When you send a prompt to a centralized API, the provider sees your data in plaintext. Their privacy policy governs what they do with it. In the OAP model, providers can operate within Trusted Execution Environments (HIP-0054) where neither the provider nor the protocol can observe the plaintext of the consumer's request.

These are not hypothetical concerns. They are structural properties of centralized architectures. A decentralized protocol does not eliminate all risks --- it trades centralized risks for different ones (latency variability, provider quality variance, protocol complexity). The following sections are explicit about these tradeoffs.

### Honest Tradeoffs

Decentralization is not free. This protocol makes deliberate tradeoffs:

| Property | Centralized API | OAP |
|----------|----------------|-----|
| Latency | Low, predictable | Higher, variable (network hops, provider matching) |
| Consistency | Single model version | Multiple providers may run different quantizations |
| Support | Vendor provides SLA, support | No vendor; reputation system + economic guarantees |
| Simplicity | One SDK, one endpoint | Client must handle discovery, routing, verification |
| Throughput | Provider controls capacity | Aggregate capacity can exceed any single provider |
| Censorship resistance | Low (provider decides) | High (permissionless) |
| Price discovery | Opaque | Transparent, market-driven |
| Verification | Trust-based | Cryptographic (Proof of Inference) |

The LLM Gateway (HIP-0004) mitigates the complexity tradeoff by acting as the client-side abstraction layer. From an application developer's perspective, calling a decentralized provider through the gateway looks identical to calling OpenAI --- the gateway handles discovery, routing, and verification internally.

## Design Philosophy

### Protocol, Not Platform

OAP is a protocol specification, not a platform. It defines message formats, state machine transitions, and economic rules. It does not run servers, host models, or manage infrastructure. Anyone can implement the protocol. The reference implementation at `github.com/hanzoai/protocol` is one implementation among potentially many.

This distinction matters because protocols outlive platforms. HTTP outlived every web hosting company from the 1990s. SMTP outlives every email provider. OAP aims to be the HTTP of AI inference: a standard that providers and consumers adopt because it is open, well-specified, and economically rational.

### Permissionless Participation

Any entity --- individual, company, DAO, autonomous agent --- can participate as a provider or consumer without registration, approval, or identity disclosure. The only requirements are:

- **Providers**: Stake $AI tokens and pass GPU capability attestation
- **Consumers**: Hold $AI tokens to pay for inference

There is no application process, no KYC gate at the protocol level, no allowlist. Providers who want to apply identity requirements to their own nodes may do so --- that is a provider-level policy, not a protocol constraint.

### Economic Security Over Social Trust

The protocol does not rely on providers being honest. It assumes providers are economically rational actors who will cheat if the expected value of cheating exceeds the expected value of honest behavior. The economic design ensures that honest behavior is always more profitable than dishonest behavior, given sufficient stake.

This is the same security model as Proof of Stake blockchains: validators do not need to be trusted; they need to have more to lose from misbehavior than they could gain.

## Specification

### Protocol Overview

The Open AI Protocol defines five subsystems that interact to form a functioning marketplace:

```
                    ┌──────────────────────────────────────┐
                    │         Consumer Application          │
                    │      (or LLM Gateway, HIP-0004)      │
                    └──────────────┬───────────────────────┘
                                   │ OAP Client SDK
                    ┌──────────────▼───────────────────────┐
                    │         Discovery Layer               │
                    │   Model Registry + Provider Index     │
                    └──────────────┬───────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                     │
    ┌─────────▼──────┐  ┌─────────▼──────┐  ┌──────────▼─────┐
    │   Provider A    │  │   Provider B    │  │   Provider C    │
    │  (H100 cluster) │  │  (A100 cluster) │  │  (RTX 4090s)   │
    └─────────┬──────┘  └─────────┬──────┘  └──────────┬─────┘
              │                    │                     │
    ┌─────────▼────────────────────▼─────────────────────▼─────┐
    │                  Verification Layer                        │
    │             Proof of Inference (PoI) Validators            │
    └─────────────────────────┬────────────────────────────────┘
                              │
    ┌─────────────────────────▼────────────────────────────────┐
    │                  Settlement Layer                          │
    │         Hanzo L1 (HIP-0024) + HMM (HIP-0008)            │
    └──────────────────────────────────────────────────────────┘
```

**1. Model Registry** (Section 3.2): On-chain catalog of available models, their capabilities, and pricing bounds.

**2. Provider Network** (Section 3.3): Staked GPU providers that serve inference requests.

**3. Inference Protocol** (Section 3.4): The request/response lifecycle from consumer to provider.

**4. Proof of Inference** (Section 3.5): Cryptographic attestation that inference was performed correctly.

**5. Reputation System** (Section 3.6): Quality scores derived from verified performance metrics.

### Model Registry

The Model Registry is a smart contract deployed on Hanzo L1 (chain ID 36963) that stores metadata about available AI models. It is the on-chain equivalent of a model hub --- but instead of a website, it is a permissionless, immutable catalog that any provider can publish to and any consumer can query.

#### Registry Entry Structure

```solidity
struct ModelEntry {
    bytes32 modelId;            // Keccak256(publisher, modelName, version)
    address publisher;          // DID-linked address of the model publisher
    string  modelName;          // Human-readable name (e.g., "zen-72b-instruct")
    string  version;            // Semantic version (e.g., "1.2.0")

    // Capability descriptors
    ModelType modelType;        // CHAT, COMPLETION, EMBEDDING, IMAGE, AUDIO, MULTIMODAL
    uint256 contextLength;      // Maximum context window in tokens
    uint256 parameterCount;     // Total parameters (for informational purposes)
    string  architecture;       // Architecture family (e.g., "MoDE", "MoE", "Dense")
    string  quantization;       // Quantization format (e.g., "fp16", "int8", "gptq-4bit")

    // Provenance (links to HIP-0074 SBOM if available)
    bytes32 modelHash;          // SHA-256 of model weights file
    string  sbomUri;            // URI to SBOM document (HIP-0074)
    string  licenseId;          // SPDX license identifier

    // Economics
    uint256 minPricePerToken;   // Floor price set by publisher (in $AI wei per output token)
    uint256 suggestedPrice;     // Suggested market price

    // Metadata
    uint256 registeredAt;       // Block timestamp of registration
    uint256 updatedAt;          // Last metadata update
    bool    active;             // Publisher can deactivate
}

enum ModelType {
    CHAT,
    COMPLETION,
    EMBEDDING,
    IMAGE_GENERATION,
    AUDIO_TRANSCRIPTION,
    AUDIO_GENERATION,
    MULTIMODAL
}
```

#### Registry Operations

```solidity
interface IModelRegistry {
    /// Register a new model. Requires publisher to hold a valid DID (HIP-0048).
    function registerModel(ModelEntry calldata entry) external returns (bytes32 modelId);

    /// Update model metadata. Only callable by the original publisher.
    function updateModel(bytes32 modelId, ModelEntry calldata entry) external;

    /// Deactivate a model. Providers should stop serving it.
    function deactivateModel(bytes32 modelId) external;

    /// Query models by type and capability.
    function queryModels(
        ModelType modelType,
        uint256 minContext,
        string calldata architecture
    ) external view returns (bytes32[] memory modelIds);

    /// Get full model entry.
    function getModel(bytes32 modelId) external view returns (ModelEntry memory);

    /// Emitted when a model is registered or updated.
    event ModelRegistered(bytes32 indexed modelId, address indexed publisher, string modelName);
    event ModelUpdated(bytes32 indexed modelId, address indexed publisher);
    event ModelDeactivated(bytes32 indexed modelId, address indexed publisher);
}
```

#### Why On-Chain Registration

Models are registered on-chain (not in a centralized database) for three reasons:

1. **Censorship resistance**: No entity can remove a model from the registry. The publisher can deactivate their own entry, but the historical record persists.

2. **Provenance immutability**: Once a model hash is registered, it cannot be changed without creating a new version. Consumers can verify that a provider is serving the exact model weights that were registered.

3. **Composability**: Other smart contracts (reputation, payment, governance) can reference model entries directly by `modelId`, creating trustless on-chain integrations.

The tradeoff is storage cost: every registration is an on-chain transaction with gas fees. For the Hanzo L1 with its tuned parameters (HIP-0024), registration costs approximately 0.01 $AI --- negligible for serious model publishers but sufficient to deter spam.

### Provider Network

#### Provider Registration

A provider joins the network by staking $AI tokens into the Provider Registry contract:

```solidity
struct Provider {
    address providerAddress;    // Linked to DID (HIP-0048)
    bytes32 didDocument;        // Reference to on-chain DID
    uint256 stakeAmount;        // $AI tokens staked
    uint256 stakedAt;           // Block timestamp

    // Hardware attestation
    GPUCapability[] gpus;       // Attested GPU inventory
    string  region;             // Geographic region (ISO 3166-1 alpha-2)
    string  endpoint;           // HTTPS endpoint for inference API

    // Supported models
    bytes32[] supportedModels;  // modelIds from the registry

    // Performance
    uint256 reputationScore;    // 0-10000 (basis points, i.e., 0.00-100.00%)
    uint256 totalInferences;    // Lifetime inference count
    uint256 totalSlashes;       // Lifetime slash count

    bool    active;             // Currently accepting requests
}

struct GPUCapability {
    string  gpuModel;           // E.g., "NVIDIA H100 SXM"
    uint256 vramMB;             // VRAM in megabytes
    uint256 computeUnits;       // TFLOPS (fp16)
    bytes   attestation;        // TEE attestation blob (HIP-0054)
}
```

#### Staking Requirements

Staking serves two purposes: economic security (providers have something to lose) and Sybil resistance (creating many fake providers is expensive).

```yaml
Staking Tiers:
  Tier 1 (Basic):
    minimum_stake: 5,000 $AI
    max_concurrent_requests: 100
    verification_sampling_rate: 10%   # 1 in 10 inferences verified

  Tier 2 (Professional):
    minimum_stake: 25,000 $AI
    max_concurrent_requests: 1,000
    verification_sampling_rate: 5%    # Higher trust, less verification

  Tier 3 (Enterprise):
    minimum_stake: 100,000 $AI
    max_concurrent_requests: 10,000
    verification_sampling_rate: 2%    # Highest trust tier

Unstaking:
  cooldown_period: 7 days             # Cannot withdraw for 7 days after requesting unstake
  pending_inferences: must_complete   # All in-flight requests must settle
  slashing_window: extends 24 hours   # Slashing possible during cooldown for recent work
```

The tiered structure creates economic incentive for providers to stake more: higher stakes unlock higher concurrency limits and lower verification overhead (less compute wasted on re-execution). The 7-day cooldown prevents providers from front-running slashing events by withdrawing stake.

#### GPU Attestation

Providers must prove they possess the hardware they claim. Without attestation, a provider could register H100-class capabilities while running on inferior hardware, charging premium prices for substandard inference.

GPU attestation uses the Trusted Execution Environment (TEE) framework from HIP-0054:

1. Provider runs the OAP attestation daemon inside an Intel SGX or NVIDIA Confidential Computing enclave
2. The daemon reads GPU hardware identifiers (PCI device ID, VRAM size, compute capability) from within the enclave
3. The enclave signs the hardware report with its attestation key
4. The signed report is submitted on-chain as part of provider registration
5. Validators can verify the attestation signature against Intel/NVIDIA root certificates

This does not guarantee that the provider will *use* the attested GPU for every inference --- it guarantees that the GPU *exists* in the provider's infrastructure. The Proof of Inference mechanism (Section 3.5) provides the runtime guarantee.

### Inference Protocol

The inference lifecycle follows a five-phase state machine:

```
    ┌─────────┐     ┌──────────┐     ┌───────────┐     ┌──────────┐     ┌──────────┐
    │ DISCOVER │────▶│  ESCROW  │────▶│  EXECUTE  │────▶│  VERIFY  │────▶│  SETTLE  │
    └─────────┘     └──────────┘     └───────────┘     └──────────┘     └──────────┘
```

#### Phase 1: Discovery

The consumer (or the LLM Gateway acting on behalf of the consumer) queries the Model Registry and Provider Index to find a suitable provider.

```json
{
  "jsonrpc": "2.0",
  "method": "oap_discover",
  "params": {
    "modelType": "CHAT",
    "modelName": "zen-72b-instruct",
    "requirements": {
      "maxLatencyMs": 500,
      "minReputationScore": 8000,
      "preferredRegions": ["US", "EU"],
      "maxPricePerToken": "1000000000000"
    }
  },
  "id": 1
}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "result": {
    "providers": [
      {
        "providerId": "did:hanzo:0xProviderA",
        "endpoint": "https://a.provider.example/oap",
        "modelId": "0xabc123...",
        "pricePerInputToken": "500000000000",
        "pricePerOutputToken": "1500000000000",
        "estimatedLatencyMs": 200,
        "reputationScore": 9500,
        "region": "US",
        "gpuType": "NVIDIA H100 SXM",
        "stakeTier": 3
      },
      {
        "providerId": "did:hanzo:0xProviderB",
        "endpoint": "https://b.provider.example/oap",
        "modelId": "0xabc123...",
        "pricePerInputToken": "300000000000",
        "pricePerOutputToken": "900000000000",
        "estimatedLatencyMs": 350,
        "reputationScore": 8200,
        "region": "EU",
        "gpuType": "NVIDIA A100 80GB",
        "stakeTier": 2
      }
    ]
  },
  "id": 1
}
```

The LLM Gateway (HIP-0004) integrates this discovery step internally. When the gateway's routing configuration includes `provider: "decentralized"`, it calls `oap_discover` to find providers, then routes the OpenAI-compatible request to the selected provider's OAP endpoint. The application developer sees an OpenAI-compatible API; the decentralized routing is invisible.

#### Phase 2: Escrow

Before inference executes, the consumer locks payment into the HMM escrow contract (HIP-0008). The escrow amount is calculated from the consumer's `maxTokens` parameter and the provider's per-token price.

```solidity
interface IInferenceEscrow {
    /// Lock $AI tokens for an inference request.
    /// Returns an escrow ID used to reference this payment.
    function createEscrow(
        bytes32 requestId,
        address provider,
        uint256 maxInputTokens,
        uint256 maxOutputTokens,
        uint256 pricePerInputToken,
        uint256 pricePerOutputToken
    ) external returns (bytes32 escrowId);

    /// Release payment to provider after verified completion.
    function release(bytes32 escrowId, uint256 actualInputTokens, uint256 actualOutputTokens) external;

    /// Refund consumer if provider fails to respond within deadline.
    function refund(bytes32 escrowId) external;

    /// Slash provider stake and refund consumer for verified misbehavior.
    function slash(bytes32 escrowId, bytes calldata verificationProof) external;
}
```

For low-value requests (under a configurable threshold, default 10 $AI), the protocol supports **payment channels** that batch multiple requests into a single on-chain settlement. This avoids per-request gas costs while maintaining the economic security model.

#### Phase 3: Execution

The consumer sends the inference request to the provider's OAP endpoint. The request format is OpenAI-compatible (the same format the LLM Gateway uses) with additional OAP headers:

```http
POST /v1/chat/completions HTTP/1.1
Host: a.provider.example
Content-Type: application/json
X-OAP-Request-Id: 0xRequestHash
X-OAP-Escrow-Id: 0xEscrowHash
X-OAP-Consumer-DID: did:hanzo:0xConsumer
X-OAP-Signature: <Ed25519 signature of request body by consumer DID key>

{
  "model": "zen-72b-instruct",
  "messages": [
    {"role": "user", "content": "Explain Proof of Inference in one paragraph."}
  ],
  "max_tokens": 256,
  "temperature": 0.7,
  "stream": true
}
```

The provider executes inference and returns the response with attestation metadata:

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
X-OAP-Model-Hash: 0xModelWeightsHash
X-OAP-Input-Hash: 0xBlake3HashOfInput
X-OAP-Output-Hash: 0xBlake3HashOfOutput  (set in final SSE event)
X-OAP-GPU-Attestation: <TEE attestation signature>
X-OAP-Provider-Signature: <Ed25519 signature by provider DID key>

data: {"choices":[{"delta":{"content":"Proof"},...}],...}
data: {"choices":[{"delta":{"content":" of"},...}],...}
...
data: [DONE]
```

The `X-OAP-Output-Hash` is computed over the complete output token sequence and included in the final SSE event. This hash becomes part of the Proof of Inference.

#### Phase 4: Verification (Proof of Inference)

Proof of Inference (PoI) is the mechanism that makes decentralized inference trustless. Without PoI, a provider could return garbage output, collect payment, and the consumer would have no recourse beyond reputation damage.

PoI operates through probabilistic verification: a random subset of inference requests are re-executed by independent validators, and the results are compared against the provider's claimed output.

The PoI attestation contains:

```solidity
struct ProofOfInference {
    bytes32 requestId;          // Unique request identifier
    bytes32 modelHash;          // SHA-256 of model weights used
    bytes32 inputHash;          // Blake3 hash of the full input (messages + parameters)
    bytes32 outputHash;         // Blake3 hash of the complete output token sequence
    bytes   gpuAttestation;     // TEE attestation from provider's GPU enclave
    bytes   providerSignature;  // Provider DID key signature over (modelHash, inputHash, outputHash)
    uint256 inputTokenCount;    // Actual input tokens processed
    uint256 outputTokenCount;   // Actual output tokens generated
    uint256 latencyMs;          // End-to-end latency in milliseconds
    uint256 timestamp;          // Unix timestamp of completion
}
```

**Verification Process:**

1. The PoI attestation is submitted to the Verification contract on Hanzo L1
2. A Verifiable Random Function (VRF), seeded by `keccak256(requestId, blockHash)`, determines whether this request is selected for verification
3. If selected, `k` validator nodes (chosen by VRF from the validator set) receive the original input and re-execute inference with the same model and parameters
4. Validators submit their output hashes to the Verification contract
5. If the provider's `outputHash` matches the validator consensus (majority of `k` validators), the PoI is accepted
6. If the provider's `outputHash` diverges, a slashing event is triggered

**Handling Non-Determinism:**

Language model inference with `temperature > 0` is inherently non-deterministic --- the same input produces different outputs on each run. This poses a challenge for hash-based verification.

OAP handles this through two mechanisms:

1. **Deterministic mode**: For `temperature == 0` requests, output is deterministic. Hash comparison is exact. No tolerance needed.

2. **Statistical consistency**: For `temperature > 0` requests, validators do not compare exact hashes. Instead, they evaluate statistical properties of the output:
   - Log-probability distribution of the output token sequence under the claimed model
   - Perplexity of the output (must fall within the expected range for the model and temperature)
   - Semantic embedding similarity (output embeddings must cluster with validator outputs)

   A provider who returns random tokens will fail these statistical tests even though exact hash matching is impossible.

3. **Committed randomness**: The protocol supports an optional mode where the provider commits to a random seed before execution. Validators use the same seed, making the output deterministic and hash-comparable even at non-zero temperature. This trades output diversity for verifiability.

#### Phase 5: Settlement

After verification (or after the verification window expires without selection), the escrow contract settles payment:

```
Successful inference (verified or unselected):
  Consumer pays: (inputTokens * pricePerInputToken) + (outputTokens * pricePerOutputToken)
  Distribution:
    - 90% to provider
    -  5% to protocol treasury (funds development and validator rewards)
    -  3% to verifier pool (distributed pro-rata to active validators)
    -  2% burned (deflationary pressure on $AI supply)

Failed verification (provider output diverges):
  Provider slashed: min(escrowAmount * 10, providerStake * 0.1)
  Consumer refunded: 100% of escrow
  Slash distribution:
    - 50% to reporting validators
    - 30% burned
    - 20% to protocol treasury

Provider timeout (no response within deadline):
  Consumer refunded: 100% of escrow
  Provider reputation penalty: -100 points (no stake slashing for timeouts)
```

### Proof of Inference: Detailed Mechanism

PoI is the cryptographic heart of the protocol. This section provides the formal construction.

#### Attestation Construction

When a provider completes an inference request, it constructs the PoI attestation:

```
attestation = {
    model_hash:     SHA256(model_weights_file),
    input_hash:     Blake3(canonical_serialize(messages, parameters)),
    output_hash:    Blake3(canonical_serialize(output_tokens)),
    gpu_report:     TEE_Attest(gpu_hardware_id, model_hash, input_hash, output_hash),
    signature:      Ed25519_Sign(provider_did_key, model_hash || input_hash || output_hash)
}
```

The canonical serialization is deterministic: messages are serialized as JSON with sorted keys, no whitespace, and UTF-8 encoding. This ensures that the same logical input always produces the same hash regardless of the client's JSON serialization order.

#### Verification Sampling

Not every inference is verified --- that would double the network's compute cost. Instead, verification is probabilistic, with the sampling rate determined by the provider's stake tier:

```python
def should_verify(request_id: bytes32, block_hash: bytes32, sampling_rate: float) -> bool:
    """
    Deterministic, unpredictable verification selection.
    The provider cannot know in advance whether a request will be verified.
    """
    vrf_output = keccak256(request_id + block_hash)
    threshold = int(sampling_rate * 2**256)
    return int(vrf_output) < threshold
```

Because `block_hash` is not known until after the inference completes, the provider cannot predict which requests will be verified. This forces honest behavior on *all* requests, since any one might be checked.

#### Validator Selection

When a request is selected for verification, validators are chosen via a weighted VRF:

```python
def select_validators(request_id: bytes32, validator_set: list, k: int) -> list:
    """
    Select k validators, weighted by stake and reputation.
    """
    weights = [v.stake * v.reputation_score for v in validator_set]
    seed = keccak256(request_id + b"validator_selection")
    return weighted_sample_without_replacement(validator_set, weights, k, seed)
```

Default `k = 3`. A supermajority (2 of 3) must agree for the result to be accepted or rejected.

#### Long-Term Roadmap: ZK-Proof Verification

Probabilistic verification is practical today but has a fundamental limitation: it only catches cheating statistically, not deterministically. A provider who cheats on 1% of requests and is verified on 5% of requests will eventually be caught --- but not immediately.

The long-term goal is **Zero-Knowledge Proof of Inference**: a cryptographic proof that the provider executed the exact model computation on the exact input, verifiable in constant time without re-executing the inference.

Current ZK-proof systems (Groth16, Plonk, Halo2) are impractical for transformer-scale computation --- proving a single forward pass of a 70B parameter model would take hours and gigabytes of proof data. However, research in this area is advancing rapidly:

- **zkML frameworks** (EZKL, Modulus Labs) have demonstrated proofs for small neural networks
- **Folding schemes** (Nova, SuperNova) reduce proof overhead for repeated computations
- **Hardware acceleration** (GPU-based provers, FPGA provers) may close the performance gap

OAP is designed to be ZK-ready: the attestation structure includes all fields needed for a future ZK proof to replace probabilistic verification. When ZK provers become practical for transformer inference, the protocol can upgrade the verification module without changing the rest of the stack.

### Reputation System

Reputation quantifies a provider's historical performance. It is computed on-chain from verified metrics and influences both consumer routing decisions and protocol parameters (verification sampling rate, maximum concurrency).

#### Reputation Score Computation

```python
def compute_reputation(provider: Provider) -> uint256:
    """
    Score from 0 to 10000 (basis points).
    Updated after each verified inference.
    """
    # Component weights
    W_LATENCY    = 0.25
    W_ACCURACY   = 0.35
    W_UPTIME     = 0.20
    W_VOLUME     = 0.10
    W_LONGEVITY  = 0.10

    # Latency score: percentage of requests within promised latency
    latency_score = provider.requests_within_sla / provider.total_requests

    # Accuracy score: percentage of requests passing PoI verification
    accuracy_score = 1.0 - (provider.total_slashes / max(provider.total_verified, 1))

    # Uptime score: availability over rolling 30-day window
    uptime_score = provider.uptime_seconds / (30 * 24 * 3600)

    # Volume score: logarithmic scaling of total inferences served
    volume_score = min(log10(provider.total_inferences + 1) / 7, 1.0)  # 10M inferences = 1.0

    # Longevity score: time since first registration
    days_active = (now - provider.registered_at) / 86400
    longevity_score = min(days_active / 365, 1.0)  # 1 year = 1.0

    raw_score = (
        W_LATENCY   * latency_score +
        W_ACCURACY  * accuracy_score +
        W_UPTIME    * uptime_score +
        W_VOLUME    * volume_score +
        W_LONGEVITY * longevity_score
    )

    return uint256(raw_score * 10000)
```

Accuracy carries the highest weight (0.35) because correctness is the most important property of an inference provider. A provider that is fast, highly available, and long-tenured but occasionally returns wrong results is worse than one that is slightly slower but always correct.

#### Reputation Decay

Inactive providers experience reputation decay:

```
If no inferences served in 7 days:  reputation *= 0.99 per day
If no inferences served in 30 days: reputation *= 0.95 per day
If no inferences served in 90 days: provider marked inactive
```

This prevents stale high-reputation providers from squatting on favorable queue positions without contributing compute.

### Economic Model

The OAP economic model is designed around one principle: **honest participation must always be more profitable than dishonest participation.**

#### Token Flows

```
Consumer Payment Flow:
  Consumer → Escrow Contract → [After verification] → Distribution:
    ├── 90% → Provider
    ├──  5% → Protocol Treasury
    ├──  3% → Validator Pool
    └──  2% → Burn Address (deflationary)

Provider Staking Flow:
  Provider → Staking Contract → [If slashed] → Slash Distribution:
    ├── 50% → Reporting Validators
    ├── 30% → Burn Address
    └── 20% → Protocol Treasury

Validator Reward Flow:
  Validator Pool → [Per epoch] → Active Validators (pro-rata by stake * uptime)
```

#### Staking Economics

A provider's expected revenue from honest operation:

```
E[honest] = (inference_volume * price_per_token * 0.90)    # 90% of payment
           + (stake * staking_yield)                        # Base yield from protocol
           - (operating_costs)                              # GPU, bandwidth, etc.
```

A provider's expected revenue from cheating (returning garbage):

```
E[cheat]  = (inference_volume * price_per_token * 0.90)    # Payment before detection
           * (1 - verification_rate)                       # Only unverified requests pay out
           - (verification_rate * slash_amount)             # Expected slashing loss
           - (reputation_damage * future_revenue_loss)     # Long-term revenue impact
```

For the protocol parameters defined above (5% verification rate for Tier 2, slash amount = 10x escrow):

```
E[cheat] = volume * price * 0.90 * 0.95 - 0.05 * 10 * volume * price
         = volume * price * (0.855 - 0.50)
         = volume * price * 0.355
```

Since `E[honest] > E[cheat]` for any positive volume (0.90 > 0.355), rational providers always prefer honest operation.

#### Fee Burning

The 2% burn on every inference creates deflationary pressure on $AI supply. As inference volume grows, the burn rate increases, reducing circulating supply and supporting token value. This aligns $AI holders' interests with network usage growth.

### Anti-Sybil Mechanisms

A Sybil attack in the provider network means creating many fake provider identities to manipulate reputation, capture disproportionate routing, or collude on verification.

OAP employs four anti-Sybil mechanisms:

**1. Stake-weighted identity cost.** Each provider identity requires a minimum 5,000 $AI stake. Creating 100 Sybil providers requires 500,000 $AI locked capital --- a significant economic commitment that earns zero return if the Sybil providers are not serving real inference.

**2. GPU attestation uniqueness.** The TEE attestation includes hardware identifiers. The same physical GPU cannot attest for multiple provider identities. A Sybil attacker needs distinct physical GPUs for each identity, not just distinct wallet addresses.

**3. Reputation cold start.** New providers start with a reputation score of 5000 (50%). They must serve verified inferences to build reputation. Sybil identities all start with low reputation and are deprioritized by consumers who filter on `minReputationScore`.

**4. Validator collusion resistance.** Validators are selected per-request via VRF. A Sybil attacker controlling N of M total validators has only an (N/M)^k probability of controlling all k validators for a given request. With k=3 and an attacker controlling 10% of the validator set, the probability of capturing all three validators is 0.1%. The attacker needs to control a supermajority of the entire validator set to reliably manipulate verification --- an astronomically expensive proposition given stake requirements.

## Integration with Existing HIPs

### LLM Gateway (HIP-0004)

The LLM Gateway is the primary consumer-facing integration point. Application developers interact with the gateway's OpenAI-compatible API; the gateway internally uses OAP for decentralized provider discovery and routing.

```yaml
# Gateway routing configuration
model_list:
  - model_name: "zen-72b-instruct"
    litellm_params:
      model: "oap/zen-72b-instruct"            # OAP provider prefix
      api_base: "https://protocol.hanzo.ai"     # OAP discovery endpoint
      api_key: "$AI_WALLET_KEY"                 # Consumer's $AI wallet
    oap_params:
      max_latency_ms: 500
      min_reputation: 8000
      preferred_regions: ["US", "EU"]
      fallback: "openai/gpt-4"                  # Centralized fallback
```

When configured this way, the gateway automatically:
1. Discovers providers via `oap_discover`
2. Creates escrow via HMM
3. Routes the request to the selected provider
4. Verifies the PoI attestation
5. Settles payment
6. Falls back to centralized providers if no decentralized provider meets the requirements

### HMM (HIP-0008)

The Hamiltonian Market Maker provides the economic settlement layer. OAP uses HMM in three ways:

1. **Price discovery**: The HMM compute resource pools set market prices for different model types and GPU classes. OAP providers reference HMM prices as the basis for their per-token pricing.

2. **Escrow settlement**: The `IInferenceEscrow` contract is implemented as an HMM module. Escrow creation corresponds to `ΔΘ` credit minting; settlement corresponds to `ΔΨ` resource consumption. The Hamiltonian invariant ensures conservation.

3. **Staking pools**: Provider stakes are deposited into HMM liquidity pools, earning base yield while providing economic security to the network.

### DID (HIP-0048)

Every provider and consumer in OAP is identified by a `did:hanzo:` identifier. The DID provides:

- **Cryptographic identity**: Request signatures use the DID key, providing non-repudiation
- **Service endpoints**: The provider's inference endpoint is listed in its DID document
- **Credential verification**: Verifiable Credentials (e.g., "passed GPU attestation", "reputation score > 9000") are linked to DIDs

### SBOM (HIP-0074)

The Software Bill of Materials standard (HIP-0074) provides model provenance. When a model is registered in the OAP Model Registry, the publisher optionally links an SBOM URI that documents:

- Training data sources and licenses
- Fine-tuning datasets and procedures
- Model architecture and hyperparameters
- Evaluation benchmarks and scores
- Known limitations and biases

Consumers can use SBOM data to make informed decisions about which models to use, particularly for compliance-sensitive applications.

### Zero Trust (HIP-0054)

The Zero Trust Architecture standard governs secure communication between providers and consumers:

- **mTLS with DID certificates**: All OAP connections use mutual TLS with certificates derived from DID keys
- **TEE enclaves**: Providers can run inference inside TEE enclaves, ensuring that neither the provider operator nor the protocol can observe the consumer's plaintext input
- **Encrypted request routing**: The discovery layer can route requests through encrypted channels where the coordinator sees only encrypted metadata (model type, token budget) but not request content

## API Specification

The OAP API runs on port 8076 and exposes three RPC namespaces:

### `oap_` Namespace: Protocol Operations

| Method | Description |
|--------|-------------|
| `oap_discover` | Find providers matching requirements |
| `oap_requestInference` | Submit an inference request with escrow |
| `oap_getRequestStatus` | Query status of a pending request |
| `oap_cancelRequest` | Cancel a pending request and release escrow |
| `oap_getAttestation` | Retrieve PoI attestation for a completed request |

### `registry_` Namespace: Model Registry

| Method | Description |
|--------|-------------|
| `registry_registerModel` | Publish a model to the on-chain registry |
| `registry_updateModel` | Update model metadata |
| `registry_deactivateModel` | Mark a model as inactive |
| `registry_queryModels` | Search models by capability |
| `registry_getModel` | Get full model entry by ID |
| `registry_getModelsByPublisher` | List all models from a publisher |

### `provider_` Namespace: Provider Operations

| Method | Description |
|--------|-------------|
| `provider_register` | Register as an inference provider (requires staking) |
| `provider_updateCapabilities` | Update GPU inventory and supported models |
| `provider_setActive` | Toggle active/inactive status |
| `provider_getReputation` | Query reputation score and history |
| `provider_getEarnings` | Query earnings and settlement history |
| `provider_requestUnstake` | Initiate unstaking with cooldown |

### Health and Metrics

```
GET /health           → {"status": "ok", "version": "0.1.0", "chain_id": 36963}
GET /metrics          → Prometheus metrics (requests, latency, verification rate)
GET /providers        → Active provider count and aggregate capacity
GET /models           → Registered model count by type
```

## Security Considerations

### Provider Collusion

If multiple providers collude to return the same incorrect output, and a colluding validator confirms the output, the protocol is deceived. Mitigation:

- Validators are selected via VRF, making collusion coordination difficult
- The minimum verification committee size (k=3) requires supermajority agreement
- Long-term, ZK proofs eliminate the need for trusted validators entirely

### Eclipse Attacks

An attacker controlling the consumer's network view could direct all discovery queries to malicious providers. Mitigation:

- Discovery uses the Kademlia DHT from the Swarm layer (HIP-0023), which is resistant to eclipse attacks when the consumer connects to multiple bootstrap nodes
- The LLM Gateway maintains a hardcoded list of known-good bootstrap nodes
- Consumers can independently verify provider registrations on the Hanzo L1

### Model Substitution

A provider could serve a cheaper/smaller model while claiming to run the registered model. Mitigation:

- PoI verification catches model substitution when validators re-execute with the correct model and get different output distributions
- The `modelHash` in the attestation commits the provider to specific model weights
- TEE attestation (where available) proves the model loaded into GPU memory matches the registered hash

### Front-Running

A malicious validator who sees a provider's output before submitting their own verification could simply copy it. Mitigation:

- Validators submit their output hashes in a commit-reveal scheme: first commit a hash of their result, then reveal the actual result after all commits are collected
- This prevents validators from copying each other or copying the provider

## Backwards Compatibility

OAP is a new protocol with no existing deployments to maintain compatibility with. However, it is designed for forward compatibility:

- **Versioned API**: All RPC methods include a version prefix (currently v1). Breaking changes create a new version; old versions remain supported for 12 months.
- **Extensible attestation format**: The `ProofOfInference` struct includes a `version` field. New verification methods (e.g., ZK proofs) are introduced as new attestation versions.
- **Model registry migrations**: The registry contract supports proxy upgrades (EIP-1967) for adding new fields without redeploying.

## Reference Implementation

The reference implementation is structured as a Rust workspace:

```
protocol/
├── crates/
│   ├── oap-core/           # Protocol types, state machine, attestation construction
│   ├── oap-provider/       # Provider daemon (serves inference, submits attestations)
│   ├── oap-validator/      # Validator daemon (re-executes, submits verifications)
│   ├── oap-client/         # Consumer SDK (discovery, escrow, result handling)
│   ├── oap-registry/       # Model registry client and indexer
│   └── oap-gateway/        # LLM Gateway integration plugin
├── contracts/
│   ├── ModelRegistry.sol    # On-chain model catalog
│   ├── ProviderStaking.sol  # Staking and slashing
│   ├── InferenceEscrow.sol  # Payment escrow and settlement
│   └── Verification.sol     # PoI verification and validator selection
├── proto/
│   └── oap.proto           # gRPC service definitions
├── docker/
│   ├── Dockerfile.provider  # Provider node image
│   ├── Dockerfile.validator # Validator node image
│   └── compose.yml         # Local development stack
└── docs/
    ├── quickstart.md        # 5-minute provider setup
    ├── economics.md         # Detailed economic model analysis
    └── api-reference.md     # Full API documentation
```

### Running a Provider Node

```bash
# Clone and build
git clone https://github.com/hanzoai/protocol
cd protocol
cargo build --release

# Configure
export OAP_WALLET_KEY="0x..."           # $AI wallet private key
export OAP_STAKE_AMOUNT="5000"          # $AI to stake
export OAP_GPU_BACKEND="cuda"           # cuda, rocm, or metal
export OAP_MODELS="zen-72b-instruct"    # Comma-separated model names
export OAP_ENDPOINT="https://my-node.example:8076"

# Register and start
./target/release/oap-provider register --stake $OAP_STAKE_AMOUNT
./target/release/oap-provider start --port 8076
```

### Running a Validator Node

```bash
export OAP_VALIDATOR_STAKE="10000"      # Higher stake for validators

./target/release/oap-validator register --stake $OAP_VALIDATOR_STAKE
./target/release/oap-validator start --port 8077
```

## Glossary

| Term | Definition |
|------|-----------|
| **OAP** | Open AI Protocol --- the standard defined by this HIP |
| **PoI** | Proof of Inference --- cryptographic attestation of correct inference execution |
| **Provider** | Entity operating GPU hardware to serve AI inference requests |
| **Consumer** | Entity requesting AI inference and paying $AI tokens |
| **Validator** | Entity that re-executes inference to verify provider correctness |
| **Model Registry** | On-chain smart contract cataloging available AI models |
| **Escrow** | $AI tokens locked in a smart contract pending inference completion |
| **Slashing** | Confiscation of provider stake for verified misbehavior |
| **Attestation** | Signed bundle of hashes proving inference was performed on specific inputs with a specific model |
| **VRF** | Verifiable Random Function --- produces unpredictable but verifiable random outputs |
| **TEE** | Trusted Execution Environment --- hardware enclave for confidential computation |
| **SBOM** | Software Bill of Materials --- provenance documentation for model weights |

## Copyright

Copyright 2026 Hanzo AI Inc. All rights reserved. Licensed under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/).
