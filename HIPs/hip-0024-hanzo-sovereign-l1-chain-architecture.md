# HIP-0024: Hanzo Sovereign L1 Chain Architecture

| Field | Value |
|-------|-------|
| HIP | 0024 |
| Title | Hanzo Sovereign L1 Chain Architecture |
| Author | Hanzo AI |
| Status | Final |
| Type | Standards Track (Core) |
| Created | 2025-12-27 |
| Requires | LP-0011 |

---

## Abstract

Hanzo operates as a sovereign L1 chain on the Lux Network, meaning it maintains its own independent validator set rather than relying on primary network validation. This architecture provides Hanzo with full sovereignty over consensus parameters, validator economics, and network governance - essential for AI compute workloads requiring specialized infrastructure.

## Motivation

Hanzo AI chose the L1 (sovereign) model for several strategic reasons:

1. **AI compute requirements**: Validators need GPU infrastructure for AI attestation
2. **Full sovereignty**: Control over consensus, upgrades, and economics
3. **Custom validator requirements**: TEE/SGX attestation for AI model integrity
4. **Independent economics**: AI-COIN staking separate from LUX
5. **Specialized consensus**: Tuned for AI inference workloads

## Specification

### Chain Configuration

```yaml
chain:
  name: Hanzo
  type: L1
  chainId: 36963
  ticker: AI
  
validation:
  type: independent
  minValidators: 5
  stakingToken: AI
  
consensus:
  engine: snowman
  parameters:
    k: 20
    alpha: 15
    betaVirtuous: 15
    betaRogue: 20
```

### Genesis Configuration

```json
{
  "config": {
    "chainId": 36963,
    "chainType": "L1",
    "validatorSet": {
      "type": "independent",
      "minValidators": 5,
      "stakingToken": "AI",
      "minStake": "2000000000000000000000"
    },
    "consensus": {
      "engine": "snowman",
      "parameters": {
        "k": 20,
        "alpha": 15,
        "betaVirtuous": 15,
        "betaRogue": 20
      }
    }
  },
  "timestamp": "0x0",
  "gasLimit": "0xe4e1c0",
  "alloc": {}
}
```

### Network Endpoints

| Network | Chain ID | RPC Endpoint |
|---------|----------|--------------|
| Mainnet | 36963 | `https://api.hanzo.ai/ext/bc/hanzo/rpc` |
| Testnet | 36962 | `https://testnet.hanzo.ai/ext/bc/hanzotest/rpc` |

### Validator Requirements

Hanzo validators have specialized requirements beyond standard Lux validators:

```yaml
validator:
  hardware:
    cpu: 32+ cores
    ram: 128GB+
    gpu: NVIDIA A100/H100 (for AI attestation)
    storage: 2TB+ NVMe
    
  software:
    tee: SGX/TDX enabled
    attestation: NVTrust compatible
    
  staking:
    minStake: 2000 AI
    lockPeriod: 14 days
    
  capabilities:
    - AI model inference
    - TEE attestation
    - FHE key share management
```

### Validation Model

As an L1, Hanzo transactions are validated by its own validator set:

```
User Transaction → Hanzo Chain → Hanzo Validators → Consensus → Finality
```

**Benefits:**
- Full control over validator requirements
- Custom consensus tuning for AI workloads
- Independent upgrade schedule
- Specialized validator economics

**Tradeoffs:**
- Must bootstrap and maintain validator set
- Higher operational complexity
- Independent security (not inherited)
- Validator coordination for upgrades

### AI Compute Integration

Hanzo validators perform AI-specific operations:

```go
// AI Mining precompile (0x0300)
type AIMiningConfig struct {
    // ML-DSA signatures for quantum-safe attestation
    SignatureScheme string `json:"signatureScheme"` // "ML-DSA-65"
    
    // NVTrust verification for GPU compute
    AttestationType string `json:"attestationType"` // "NVTrust"
    
    // Reward calculation
    PrivacyLevels   []int  `json:"privacyLevels"`   // [1, 2, 3]
}

// Validator performs AI inference with attestation
func (v *Validator) ProcessAIRequest(req *AIRequest) (*AIResponse, error) {
    // 1. Verify TEE attestation
    if err := v.verifyTEE(req.Attestation); err != nil {
        return nil, err
    }
    
    // 2. Execute AI inference in enclave
    result := v.executeInEnclave(req.Model, req.Input)
    
    // 3. Sign with ML-DSA (post-quantum)
    signature := v.signMLDSA(result)
    
    return &AIResponse{Result: result, Signature: signature}, nil
}
```

### Cross-Chain Communication

Hanzo uses Warp messaging for cross-chain operations:

```solidity
// Send AI attestation to Zoo (L2)
IWarpMessenger(WARP_ADDRESS).sendMessage(
    ZOO_CHAIN_ID,
    abi.encode(modelHash, attestation)
);

// Receive compute request from C-Chain
function receiveComputeRequest(bytes calldata message) external {
    require(msg.sender == WARP_ADDRESS);
    // Queue AI compute job
}
```

### Staking Economics

Hanzo has independent staking economics:

```yaml
staking:
  token: AI
  minValidatorStake: 2000 AI
  minDelegatorStake: 25 AI
  rewardRate: 8% APY (base)
  aiMiningBonus: +2-5% (based on compute contribution)
  
slashing:
  downtime: 0.1% per hour (after 4 hour grace)
  doubleSigning: 5%
  invalidAttestation: 10%
```

## Rationale

### Why L1 over L2?

| Factor | L2 (Primary Network) | L1 (Hanzo's Choice) |
|--------|---------------------|---------------------|
| Validator control | Limited | Full |
| Custom requirements | Not possible | GPU/TEE required |
| Consensus tuning | Inherited | Customizable |
| Economics | LUX-based | AI-COIN based |
| AI integration | Limited | Native |

### Comparison with Zoo

Hanzo and Zoo represent the two chain models:

| Chain | Type | Validators | Use Case |
|-------|------|------------|----------|
| **Zoo** | L2 | Primary network | Conservation, community AI |
| **Hanzo** | L1 | Own set (GPU/TEE) | AI compute, sovereignty |

This allows the ecosystem to demonstrate and optimize both approaches.

## Security Considerations

### Validator Security

Hanzo validators must maintain:
- TEE attestation (SGX/TDX)
- NVTrust GPU verification
- ML-DSA key management
- Secure enclave operations

### Network Security

With 5+ validators and proper stake distribution:
- Byzantine fault tolerance: 80%+
- Economic security from AI staking
- Slashing for malicious behavior

### AI-Specific Security

- Model integrity verification via attestation
- Encrypted inference in TEE
- Post-quantum signatures (ML-DSA)

## Implementation

### Deployment

```bash
# Create Hanzo chain (L1 mode)
lux chain create hanzo --type l1 --validators 5 --vm evm

# Configure validator requirements
lux chain config hanzo --validator-requirements gpu,tee

# Deploy to mainnet
lux chain deploy hanzo --mainnet
```

### Validator Onboarding

```bash
# Register as Hanzo validator
lux validator join hanzo \
  --stake 2000 \
  --node-id NodeID-xxx \
  --tee-attestation attestation.json \
  --gpu-proof nvtrust.json
```

### Integration with LP-0011

Hanzo follows the L1 specification defined in LP-0011:
- Independent validator set
- Custom genesis configuration
- Sovereign consensus parameters
- Cross-chain Warp messaging

## References

- [LP-0011: Chain Types Specification](https://lps.lux.network/lp-0011)
- [HIP-0000: Hanzo AI Architecture](./hip-0000-hanzo-ai-architecture-framework.md)
- [HIP-0006: AI Mining Protocol](./HIP-006-ai-mining-protocol.md)
- [ZIP-0015: Zoo L2 Architecture](https://zips.zoo.ngo/zip-0015)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
