# HIP-001: Universal Compute Confidentiality Standard

**HIP Number**: 001
**Title**: Universal Compute Confidentiality Standard
**Author**: Hanzo Core Team
**Status**: Draft
**Type**: Standards Track
**Created**: 2024-12-19

## Abstract

This HIP defines the confidentiality standards for code execution across all runtime environments in the Hanzo Network, leveraging NVIDIA Blackwell TEE-I/O and other confidential computing technologies.

## Motivation

As Hanzo Network executes arbitrary code from untrusted users, we need strong guarantees about:
1. Code and data confidentiality during execution
2. Attestation of the execution environment
3. Secure key management and cryptographic operations
4. Protection against side-channel attacks

## Specification

### Privacy Tiers

The network defines 5 privacy tiers (0-4):

```rust
enum PrivacyTier {
    AccessOpen = 0,        // No confidentiality
    AccessAtRest = 1,      // Encrypted at rest
    AccessCpuTee = 2,      // CPU TEE (SGX, SEV-SNP, TDX)
    AccessCpuTeeGpuCc = 3, // CPU TEE + GPU Confidential Computing
    AccessGpuTeeIoMax = 4, // Blackwell TEE-I/O (maximum isolation)
}
```

### Attestation Requirements

Each tier requires specific attestation:

#### Tier 0: Open Access
- No attestation required
- Suitable for public computations

#### Tier 1: At-Rest Protection
- Proof of encrypted storage
- Key derivation from node identity

#### Tier 2: CPU TEE
```rust
struct CpuTeeAttestation {
    platform: Platform,     // SGX, SEV-SNP, TDX
    measurements: Vec<u8>,   // PCR/MRTD values
    report: Vec<u8>,        // Signed attestation report
    certificate: Vec<u8>,   // Platform certificate
}
```

#### Tier 3: CPU TEE + GPU CC
```rust
struct GpuCcAttestation {
    cpu_attestation: CpuTeeAttestation,
    gpu_attestation: GpuAttestation,
    binding: BindingProof,  // Proves CPU-GPU secure channel
}
```

#### Tier 4: Blackwell TEE-I/O
```rust
struct BlackwellTeeIoAttestation {
    tee_io_report: Vec<u8>,      // NVIDIA TEE-I/O attestation
    mig_config: MigConfig,        // Multi-Instance GPU config
    nvlink_encryption: bool,      // NVLink encryption enabled
    pcie_encryption: bool,        // PCIe encryption enabled
    memory_encryption: bool,      // HBM encryption enabled
}
```

### Runtime Isolation

#### WASM Isolation
```rust
impl WasmRuntime {
    fn create_sandbox(&self, tier: PrivacyTier) -> Sandbox {
        match tier {
            PrivacyTier::AccessOpen => BasicSandbox::new(),
            PrivacyTier::AccessAtRest => EncryptedSandbox::new(),
            PrivacyTier::AccessCpuTee => TeeSandbox::new(),
            _ => panic!("WASM not supported for GPU tiers")
        }
    }
}
```

#### Docker/Container Isolation
```rust
impl DockerRuntime {
    fn create_container(&self, tier: PrivacyTier) -> Container {
        let config = match tier {
            PrivacyTier::AccessCpuTee => {
                ContainerConfig {
                    runtime: "kata-runtime",  // Kata containers
                    attestation: true,
                    encrypted_layers: true,
                }
            }
            PrivacyTier::AccessGpuTeeIoMax => {
                ContainerConfig {
                    runtime: "nvidia-cc-runtime",
                    gpu_mode: "mig-7g.80gb",
                    attestation: true,
                    tee_io: true,
                }
            }
            _ => ContainerConfig::default()
        };
        Container::new(config)
    }
}
```

### Key Management

Keys are managed through the Key Broker Service (KBS):

```rust
impl KeyBrokerService {
    async fn release_key(
        &self,
        attestation: AttestationType,
        key_id: KeyId,
    ) -> Result<Key> {
        // Verify attestation
        let result = self.verifier.verify(attestation)?;

        // Check policy
        let policy = self.get_policy(key_id)?;
        if !policy.allows(result.privacy_tier) {
            return Err("Insufficient privacy tier");
        }

        // Release key
        self.release_wrapped_key(key_id, result.public_key)
    }
}
```

### Secure Channels

All communication uses post-quantum secure channels:

```rust
impl SecureChannel {
    fn establish(local: Identity, remote: Identity) -> Channel {
        // ML-KEM for key exchange
        let (encap_key, decap_key) = MlKem768::generate_keypair();

        // Exchange keys
        let shared_secret = MlKem768::encapsulate(remote.encap_key);

        // Derive session keys
        let session_keys = Hkdf::derive(shared_secret, "hanzo-session");

        Channel {
            encryption: ChaCha20Poly1305::new(session_keys.enc),
            authentication: MlDsa65::new(session_keys.auth),
        }
    }
}
```

## Implementation

### Phase 1: Foundation (Completed)
- [x] Privacy tier definitions
- [x] Basic attestation types
- [x] KBS/KMS split architecture

### Phase 2: CPU TEE (Q1 2025)
- [ ] SGX production verifier
- [ ] SEV-SNP production verifier
- [ ] TDX production verifier
- [ ] Kata containers integration

### Phase 3: GPU CC (Q2 2025)
- [ ] H100 Confidential Computing
- [ ] A100 MIG isolation
- [ ] GPU-CPU secure binding

### Phase 4: Blackwell TEE-I/O (Q3 2025)
- [ ] Full TEE-I/O attestation
- [ ] NVLink encryption
- [ ] PCIe encryption
- [ ] HBM encryption

## Security Considerations

### Side-Channel Protection
- Constant-time cryptographic operations
- Memory access pattern obfuscation
- Power analysis resistance

### Rollback Protection
- Monotonic counters for state freshness
- Distributed consensus for counter updates

### Recovery
- Secure backup of attestation keys
- Disaster recovery without compromising confidentiality

## Performance Impact

| Operation | Tier 0 | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|-----------|--------|--------|--------|--------|--------|
| Startup | 10ms | 15ms | 100ms | 200ms | 500ms |
| Memory Access | 1x | 1.1x | 1.3x | 1.5x | 2x |
| Compute | 1x | 1x | 1.1x | 1.2x | 1.3x |

## Backwards Compatibility

This HIP is backwards compatible. Nodes can support subset of tiers based on hardware capabilities.

## Test Cases

```rust
#[test]
fn test_tier_escalation() {
    let runtime = Runtime::new();
    let job = Job::new(PrivacyTier::AccessCpuTee);

    // Should fail without attestation
    assert!(runtime.execute(job).is_err());

    // Should succeed with valid attestation
    runtime.attest(CpuTeeAttestation::mock());
    assert!(runtime.execute(job).is_ok());
}
```

## Reference Implementation

See `/hanzo-libs/hanzo-kbs/` for the reference implementation.

## Copyright

This document is licensed under CC0 1.0 Universal.