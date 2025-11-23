# HIP-005: Hanzo KMS Hardware Security Module Integration

**Status**: Active
**Type**: Infrastructure
**Created**: 2025-11-22
**Updated**: 2025-11-22
**Authors**: Hanzo Industries Inc
**References**: [Lux LP-325](https://github.com/luxfi/lps/blob/main/LPs/lp-325.md)

## Abstract

This HIP specifies the Hanzo Key Management System (KMS) architecture with Hardware Security Module (HSM) support for securing AI model weights, inference keys, and compute settlement signatures. Hanzo KMS extends [Lux LP-325](https://github.com/luxfi/lps/blob/main/LPs/lp-325.md) with AI-specific features including model weight encryption, PoAI (Proof of AI) signing, and HMM (Hamiltonian Market Maker) settlement key management.

## Motivation

### AI Infrastructure Security Requirements

Hanzo Network requires secure key management for:

1. **Model Weight Protection**: Proprietary model weights must be encrypted at rest
2. **PoAI Signing**: Cryptographic proofs of AI inference execution (HIP-004)
3. **HMM Settlement**: Secure signing of compute transaction settlements
4. **API Authentication**: HSM-backed API keys for compute marketplace
5. **Data Encryption**: User data and training datasets
6. **Multi-Tenancy**: Isolated keys per customer/model

### Why Hanzo KMS Extends Lux KMS

Hanzo KMS is a **superset** of Lux KMS with AI-specific additions:

**From Lux KMS (LP-325)**:
- ✅ Multi-provider HSM support (8 providers)
- ✅ PKCS#11, REST, gRPC interfaces
- ✅ Enterprise and affordable HSM options
- ✅ High availability and failover
- ✅ Key backup and migration

**Hanzo-Specific Extensions**:
- 🆕 **Model Weight Encryption**: AES-256-GCM for encrypted model storage
- 🆕 **PoAI Signing Keys**: Attestation signatures for inference proofs
- 🆕 **HMM Settlement Keys**: Compute marketplace transaction signing
- 🆕 **Multi-Model Key Isolation**: Separate key namespaces per model
- 🆕 **Inference Rate Limiting**: HSM-enforced API rate limits

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              Hanzo AI Infrastructure                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Jin Model   │  │  Inference   │  │     HMM      │      │
│  │   Serving    │  │   Gateway    │  │ Marketplace  │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                  │                  │              │
│         └──────────────────┴──────────────────┘              │
│                            │                                 │
│                  ┌─────────▼─────────┐                       │
│                  │  Hanzo KMS Client │                       │
│                  │  (extends Lux KMS)│                       │
│                  └─────────┬─────────┘                       │
└────────────────────────────┼─────────────────────────────────┘
                             │
         ┌───────────────────┴───────────────────┐
         │                                       │
    ┌────▼──────────────────┐          ┌────────▼────────┐
    │   Lux KMS (LP-325)    │          │  AI Extensions  │
    │   - PKCS#11 HSMs      │          │  - Model Keys   │
    │   - REST/gRPC APIs    │          │  - PoAI Keys    │
    │   - Multi-provider    │          │  - HMM Keys     │
    └───────────────────────┘          └─────────────────┘
```

## Specification

### Extended KMS API

Hanzo KMS extends Lux KMS Client interface:

```go
package kms

import (
    luxkms "github.com/luxfi/kms/client"
)

// HanzoKMS extends Lux KMS with AI-specific operations
type HanzoKMS struct {
    luxkms.Client  // Embed Lux KMS client

    // AI-specific configuration
    modelKeyPrefix string
    poaiKeyPrefix  string
    hmmKeyPrefix   string
}

// Model weight encryption
func (k *HanzoKMS) EncryptModelWeights(
    ctx context.Context,
    modelID string,
    weights []byte,
) ([]byte, error)

func (k *HanzoKMS) DecryptModelWeights(
    ctx context.Context,
    modelID string,
    encryptedWeights []byte,
) ([]byte, error)

// PoAI (Proof of AI) signing
func (k *HanzoKMS) SignPoAI(
    ctx context.Context,
    attestation *PoAIAttestation,
) (*PoAISignature, error)

func (k *HanzoKMS) VerifyPoAI(
    ctx context.Context,
    attestation *PoAIAttestation,
    signature *PoAISignature,
) (bool, error)

// HMM settlement signing
func (k *HanzoKMS) SignHMMSettlement(
    ctx context.Context,
    settlement *HMMSettlement,
) (*Signature, error)

// Per-model key isolation
func (k *HanzoKMS) CreateModelKeyspace(
    ctx context.Context,
    modelID string,
    algorithm Algorithm,
) error
```

### Configuration

```yaml
# Hanzo KMS Configuration
kms:
  # Use Lux KMS as base
  base: lux-kms

  # Lux KMS configuration (LP-325)
  lux:
    provider: google-cloud-kms  # or aws-cloudhsm, yubihsm2, etc.
    google-cloud-kms:
      project_id: hanzo-ai-prod
      location: global
      key_ring: hanzo-kms-keyring
      credentials: /etc/kms/gcp-service-account.json

  # Hanzo AI extensions
  hanzo:
    # Model weight encryption
    model_encryption:
      algorithm: AES-256-GCM
      key_rotation_days: 90
      key_prefix: "model/"

    # PoAI signing keys
    poai_signing:
      algorithm: ECDSA-secp256k1  # or ML-DSA-65 for post-quantum
      key_prefix: "poai/"
      attestation_ttl: 3600  # 1 hour

    # HMM settlement keys
    hmm_settlement:
      algorithm: ECDSA-secp256k1
      key_prefix: "hmm/"
      settlement_expiry: 86400  # 24 hours

    # Multi-tenancy
    key_isolation:
      per_model: true
      per_customer: true
      namespace_separator: ":"
```

### Use Case 1: Model Weight Protection

```go
// Encrypt model weights before storage
func (s *ModelService) SaveModel(
    ctx context.Context,
    modelID string,
    weights []byte,
) error {
    // Encrypt using HSM
    encrypted, err := s.kms.EncryptModelWeights(ctx, modelID, weights)
    if err != nil {
        return fmt.Errorf("encryption failed: %w", err)
    }

    // Store encrypted weights (IPFS, S3, etc.)
    return s.storage.Put(ctx, modelID, encrypted)
}

// Decrypt for inference
func (s *InferenceService) LoadModel(
    ctx context.Context,
    modelID string,
) (*Model, error) {
    // Retrieve encrypted weights
    encrypted, err := s.storage.Get(ctx, modelID)
    if err != nil {
        return nil, err
    }

    // Decrypt using HSM
    weights, err := s.kms.DecryptModelWeights(ctx, modelID, encrypted)
    if err != nil {
        return nil, fmt.Errorf("decryption failed: %w", err)
    }

    return LoadModelFromWeights(weights)
}
```

### Use Case 2: PoAI (Proof of AI) Attestation Signing

Integrates with HIP-004 (Hamiltonian Market Maker):

```go
// Sign PoAI attestation using HSM
func (i *InferenceEngine) CreateAttestation(
    ctx context.Context,
    request *InferenceRequest,
    output []byte,
) (*PoAIAttestation, error) {
    attestation := &PoAIAttestation{
        ModelID:     request.ModelID,
        InputHash:   HashInput(request.Input),
        OutputHash:  HashOutput(output),
        Timestamp:   time.Now().Unix(),
        ComputeTime: i.metrics.LastInferenceTime,
        NodeID:      i.nodeID,
    }

    // Sign with HSM-protected key
    sig, err := i.kms.SignPoAI(ctx, attestation)
    if err != nil {
        return nil, fmt.Errorf("PoAI signing failed: %w", err)
    }

    attestation.Signature = sig
    return attestation, nil
}

// Verify PoAI on-chain (HMM settlement)
func (h *HMM) VerifyAndSettle(
    ctx context.Context,
    attestation *PoAIAttestation,
) error {
    // Verify HSM signature
    valid, err := h.kms.VerifyPoAI(ctx, attestation, attestation.Signature)
    if err != nil || !valid {
        return fmt.Errorf("invalid PoAI signature")
    }

    // Settle payment using HMM (HIP-004)
    return h.settleCompute(ctx, attestation)
}
```

### Use Case 3: HMM Marketplace Settlement

```go
// Sign HMM settlement transaction
func (h *HMM) CreateSettlement(
    ctx context.Context,
    job *ComputeJob,
    attestation *PoAIAttestation,
) (*HMMSettlement, error) {
    settlement := &HMMSettlement{
        JobID:       job.ID,
        Provider:    job.Provider,
        Consumer:    job.Consumer,
        Amount:      h.calculatePayment(job, attestation),
        Attestation: attestation,
        Timestamp:   time.Now().Unix(),
    }

    // Sign settlement with HSM
    sig, err := h.kms.SignHMMSettlement(ctx, settlement)
    if err != nil {
        return nil, fmt.Errorf("settlement signing failed: %w", err)
    }

    settlement.Signature = sig
    return settlement, nil
}
```

## HSM Provider Recommendations

### Production AI Infrastructure

**Recommended**: Zymbit HSM6 (Edge AI & Raspberry Pi Deployments) ⭐
- **Why**: Optimal for edge AI with Raspberry Pi compatibility, one-time cost, tamper-resistant
- **Cost**: $125-155 one-time (85.6% cost savings over 3 years vs cloud HSMs)
- **Performance**: 100-300 signatures/sec
- **Flexibility**: I2C/SPI interface, works with Pi, NVIDIA Jetson, industrial SBCs
- **Use case**: Edge inference nodes, distributed AI networks, IoT AI deployments

**Alternative 1**: Google Cloud KMS or AWS CloudHSM (Cloud-Native AI)
- **Why**: Pay-per-use pricing scales with inference volume
- **Cost**: $30-3,000/month (10M-100M inferences)
- **Performance**: 200-3,000 signatures/sec
- **Integration**: Native cloud integration
- **Use case**: Centralized cloud AI infrastructure

**Alternative 2**: YubiHSM 2 FIPS (Small/Medium Deployments)
- **Why**: USB-based, FIPS 140-2 Level 3 certified, one-time cost
- **Cost**: $650 one-time
- **Performance**: 100-300 signatures/sec
- **Use case**: < 10M inferences/month, x86 servers

### Development & Testing

**Recommended**: SoftHSM2
- **Why**: Free, fast iteration, no hardware required
- **Cost**: $0
- **Performance**: 5,000+ operations/sec
- **CI/CD**: Perfect for automated testing

## Performance Benchmarks

| Provider | Model Encrypt (1GB) | PoAI Sign (ops/sec) | HMM Settle (ops/sec) |
|----------|-------------------|-------------------|-------------------|
| SoftHSM2 | ~2 sec | 5,000+ | 5,000+ |
| AWS CloudHSM | ~5 sec | 3,000 | 3,000 |
| Google Cloud KMS | ~20 sec | 500 | 500 |
| YubiHSM 2 | ~30 sec | 100-300 | 100-300 |

**Performance Notes**:
- Model encryption is one-time operation, PoAI signing happens per inference
- Encryption throughput: SoftHSM2 ~500 MB/s, AWS ~200 MB/s, Google ~50 MB/s, YubiHSM ~35 MB/s
- Times shown are for AES-256-GCM encryption of 1GB model weights

## Security Considerations

### Model Weight Security

**Encryption at Rest**:
- AES-256-GCM via HSM
- Unique key per model
- 90-day automatic rotation

**Decryption Access Control**:
- Only authorized inference nodes
- HSM audit logs all decryption
- Rate limiting per model/customer

### PoAI Signature Integrity

**Non-Repudiation**:
- ECDSA signatures cannot be forged
- HSM audit trail proves signing time
- On-chain verification prevents disputes

**Replay Protection**:
- Timestamp in attestation
- 1-hour TTL enforced
- Nonce prevents reuse

### Multi-Tenancy Isolation

**Key Namespace Separation**:
```
model:customer1:gpt4  → Separate HSM key
model:customer2:gpt4  → Different HSM key
```

**Access Control**:
- Customer A cannot decrypt Customer B's models
- HSM enforces namespace isolation
- API gateway verifies customer identity

## Cost Analysis (AI Infrastructure)

### Typical AI Deployment (10M inferences/month)

| Component | Provider | Monthly Cost |
|-----------|----------|--------------|
| **Model Storage** | S3/IPFS | $100 |
| **KMS Operations** (10M/mo) | Google Cloud KMS | $30 |
| **PoAI Signing** | Included in KMS | $0 |
| **HMM Settlement** | Included in KMS | $0 |
| **Total KMS Cost** | | **$30** |

**Cost Breakdown** (Google Cloud KMS):
- 10M operations ÷ 10,000 = 1,000 billing units × $0.03 = $30/month
- 5 keys × $0.06 = $0.30/month storage
- **Total: $30.30/month ≈ $30/month**

**Alternative with YubiHSM 2**:
- One-time: $650
- Monthly: $0
- 3-year TCO: **$650** (vs $1,080 for Google KMS)
- Savings: **39.8%**

**Alternative with Zymbit HSM6**:
- One-time: $155
- Monthly: $0
- 3-year TCO: **$155** (vs $1,080 for Google KMS)
- Savings: **85.6%**

## Implementation

### Repository Structure

```
hanzo/
├── kms/                          # Hanzo KMS (extends Lux KMS)
│   ├── client/
│   │   ├── hanzo_kms.go         # Hanzo KMS client (wraps Lux KMS)
│   │   ├── model_encryption.go  # Model weight encryption
│   │   ├── poai_signing.go      # PoAI attestation signing
│   │   └── hmm_settlement.go    # HMM settlement signing
│   ├── config/
│   │   └── config.go            # Hanzo KMS configuration
│   └── docs/
│       └── kms-integration.md   # Integration guide
```

### Installation

```bash
# Install Hanzo KMS (includes Lux KMS)
go get github.com/hanzoai/kms

# Hanzo KMS automatically uses Lux KMS underneath
# Just configure the provider in config.yaml
```

### Example: Complete AI Inference Flow

```go
package main

import (
    "context"
    hanzokms "github.com/hanzoai/kms/client"
)

func main() {
    // Initialize Hanzo KMS (uses Lux KMS underneath)
    kms, err := hanzokms.NewHanzoKMS(ctx, "config.yaml")
    if err != nil {
        panic(err)
    }

    // 1. Load encrypted model weights
    weights, err := kms.DecryptModelWeights(ctx, "gpt4", encryptedWeights)
    if err != nil {
        panic(err)
    }

    // 2. Run inference
    model := LoadModel(weights)
    output := model.Infer(input)

    // 3. Create PoAI attestation (signed by HSM)
    attestation, err := kms.SignPoAI(ctx, &PoAIAttestation{
        ModelID:    "gpt4",
        InputHash:  Hash(input),
        OutputHash: Hash(output),
        Timestamp:  time.Now().Unix(),
    })
    if err != nil {
        panic(err)
    }

    // 4. Submit to HMM for settlement (signed by HSM)
    settlement, err := kms.SignHMMSettlement(ctx, &HMMSettlement{
        Attestation: attestation,
        Amount:      CalculatePayment(attestation),
    })
    if err != nil {
        panic(err)
    }

    // 5. Submit on-chain
    SubmitToChain(settlement)
}
```

## References

### Hanzo Papers & HIPs
- [HIP-004: Hamiltonian Market Maker](HIP-004-hmm.md) - PoAI and compute marketplace
- [HIP-002: Active Semantic Optimization](HIP-002-aso.md) - Model optimization
- [HIP-003: Decentralized Semantic Optimization](HIP-003-dso.md) - Distributed learning

### Lux Infrastructure
- [Lux LP-325: KMS HSM Integration](https://github.com/luxfi/lps/blob/main/LPs/lp-325.md) - Base KMS specification
- [Lux KMS Documentation](https://github.com/luxfi/kms/tree/main/docs)
- [HSM Provider Comparison](https://github.com/luxfi/kms/blob/main/docs/documentation/platform/kms/hsm-providers-comparison.mdx)

### HSM Vendors (Same as Lux LP-325)
- [Google Cloud KMS](https://cloud.google.com/kms) - Recommended for AI workloads
- [AWS CloudHSM](https://aws.amazon.com/cloudhsm/)
- [YubiHSM 2 FIPS](https://www.yubico.com/product/yubihsm-2-fips/) - Best affordable option
- [SoftHSM2](https://github.com/softhsm/SoftHSMv2) - Development/testing

## Copyright

Copyright © 2025 Hanzo Industries Inc. All rights reserved.
