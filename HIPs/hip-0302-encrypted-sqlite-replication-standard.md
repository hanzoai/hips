---
hip: 0302
title: "Hanzo Replicate: Encrypted SQLite Durability for Base Services"
author: Zach Kelling (zach@hanzo.ai)
type: Standards Track
category: Infrastructure
status: Final
created: 2026-04-09
requires: HIP-0027, HIP-0032, HIP-0065
---

# HIP-302: Hanzo Replicate --- Encrypted SQLite + ZapDB Durability for Base Services

**Full specification**: See `~/work/hanzo/papers/hip-0302-replicate.tex` (LaTeX) and the compiled PDF `hip-0302-replicate.pdf`.

## Abstract

Specifies how all Hanzo Base-powered services achieve durable state persistence through continuous encrypted streaming replication to S3-compatible storage using `hanzoai/replicate` and `hanzoai/age`. Covers two storage engines:

1. **SQLite** (WAL-based) — used by Base services (IAM, KMS, ATS, BD, TA, Tasks)
2. **ZapDB** (incremental backup) — used by high-throughput KV workloads (Gateway session cache, PubSub durable queues, Insights event buffer)

## Components

| Component | Image | Purpose |
|-----------|-------|---------|
| `hanzoai/replicate` | `ghcr.io/hanzoai/replicate` | Litestream fork with age encryption (SQLite WAL) |
| `hanzoai/zapdb-replicator` | `ghcr.io/hanzoai/zapdb-replicator` | ZapDB frame replication sidecar (ZAP binary format) |
| `hanzoai/age` | `ghcr.io/hanzoai/age` | X25519 + ML-KEM-768 hybrid key generation |
| `hanzoai/s3` | `ghcr.io/hanzoai/s3` | S3-compatible object storage (HIP-0032) |

## Recovery Objectives

| Engine | RPO | RTO | WAL/Delta Retention | Snapshot Retention |
|--------|-----|-----|---------------------|-------------------|
| SQLite | 1 second | 30 seconds | 72 hours | 30 days |
| ZapDB | 500 milliseconds | 15 seconds | 24 hours | 7 days |

## Affected Services

**SQLite replication**: IAM, KMS, ATS, BD, TA, Tasks, and all future Base services.

**ZapDB replication**: Gateway (session cache), PubSub (durable queue state), Insights (event buffer), and any service using `hanzoai/kv` in embedded mode.

## Key Design Decisions

1. **Three encryption layers**: sqlcipher (disk), age (S3), TLS (transport). Independent. Compromise of one does not compromise others.
2. **emptyDir replaces PVC**: Pods restore from S3 on startup. No PVC scheduling constraints.
3. **Per-service age keypairs**: Derived from master key via HKDF with `hanzo:replicate:` domain separator. Cross-service access requires master key.
4. **K8s sidecar pattern**: Init container restores; sidecar replicates continuously.
5. **ZAP binary format**: ZapDB replication uses the ZAP frame format (magic `0x5A415001`) for incremental backup. Frames are age-encrypted and streamed to S3 in 500ms batches.
6. **Post-quantum hybrid**: All age encryption uses ML-KEM-768 + X25519 hybrid mode (age v1.3.0+, `age1pq` key prefix). NIST FIPS 203 compliant.
7. **Cloud HSM**: Master keys stored in Cloud HSM (FIPS 140-2 Level 3). Key material never leaves HSM boundary.
8. **ML-DSA-65 JWT**: IAM issues JWT tokens signed with ML-DSA-65 (FIPS 204). JWKS validation uses PQ-safe signatures.
9. **PQ TLS**: X25519MLKEM768 as first curve in TLS 1.3 supported groups.

## NIST Standards Adopted

| Standard | Algorithm | Deployed Use Cases |
|----------|-----------|-------------------|
| FIPS 203 (ML-KEM-768) | Module-Lattice KEM | age backup encryption, TLS X25519MLKEM768, on-chain precompile |
| FIPS 204 (ML-DSA-65) | Module-Lattice DSA | JWT signing, validator identity, on-chain precompile, SafeMLDSASigner |
| FIPS 205 (SLH-DSA) | Stateless Hash DSA | On-chain precompile (stateless fallback) |

## Complete PQ Scorecard

All 13 cryptographic layers are deployed on devnet, testnet, and mainnet.

| # | Layer | Algorithm | PQ Status | NIST/FIPS | Status |
|---|-------|-----------|-----------|-----------|--------|
| 1 | Disk encryption | AES-256 sqlcipher, per-principal CEK via HKDF-SHA-256 | Safe (128-bit PQ via Grover bound) | SP 800-57 | Deployed |
| 2 | Field encryption | AES-256-GCM per sensitive field | Safe (128-bit PQ) | SP 800-38D | Deployed |
| 3 | S3 backup | age ML-KEM-768+X25519 (`age1pq` recipients) | Safe (FIPS 203) | FIPS 203 | Deployed |
| 4 | TLS | X25519MLKEM768 first curve (ingress + MPC inter-node) | Safe (hybrid PQ) | FIPS 203 | Deployed |
| 5 | JWT signing | ML-DSA-65 signing + validation via JWKS | Safe (Module-LWE+SIS) | FIPS 204 | Deployed |
| 6 | Consensus (Quasar) | BLS + Ringtail + ML-DSA -- three hardness assumptions | Safe (triple hybrid) | FIPS 204 | Deployed |
| 7 | EVM tx (Smart Account) | SafeMLDSASigner via ML-DSA precompile (ERC-1271 + ERC-4337) | Safe (FIPS 204) | FIPS 204 | Deployed |
| 8 | EVM tx (EOA) | secp256k1 ECDSA (wallet compat, PQ finality via Quasar) | Not PQ-safe (mitigated) | -- | EVM constraint |
| 9 | MPC transport | PQ TLS (X25519MLKEM768) | Safe (hybrid PQ) | FIPS 203 | Deployed |
| 10 | MPC custody | PQ KEM encrypted key shares + Cloud HSM (FIPS 140-2 L3) | Safe (hardware isolation) | FIPS 203, FIPS 140-2 | Deployed |
| 11 | Threshold signing | CGGMP21 (ECDSA), FROST (EdDSA), BLS, Ringtail (PQ lattice) | Safe (Ringtail PQ) | -- | Deployed |
| 12 | On-chain precompiles | ML-DSA, ML-KEM, SLH-DSA, Ringtail, PQCrypto unified | Safe (all three FIPS) | FIPS 203/204/205 | Deployed |
| 13 | Smart contracts | SafeMLDSASigner, SafeRingtailSigner, QuantumSafe base | Safe (precompile-backed) | FIPS 204 | Deployed |

**EOA mitigation**: EOA transactions use secp256k1 ECDSA for wallet compatibility. PQ finality is achieved because Quasar consensus validators sign blocks with BLS + Ringtail + ML-DSA. A quantum adversary who forges an EOA signature still cannot finalize a block without compromising all three consensus assumptions.

## Quasar Consensus

Quasar is a triple-hybrid consensus protocol using three independent hardness assumptions:

| Component | Assumption | PQ Safety |
|-----------|------------|-----------|
| BLS (BN254) | Discrete log on elliptic curves | Classical only |
| Ringtail | Module-LWE (lattice) | PQ-safe |
| ML-DSA-65 | Module-LWE + Module-SIS | PQ-safe (FIPS 204) |

Block finality requires valid signatures from all three schemes. An adversary must break discrete log AND Module-LWE AND Module-SIS simultaneously.

## Smart Account PQ Signing

Smart Accounts (ERC-4337 compliant) bypass the secp256k1 constraint via signature verification precompiles:

- **SafeMLDSASigner**: Validates ML-DSA-65 signatures via precompile at `0x0130`/`0x0131`. Implements ERC-1271.
- **SafeRingtailSigner**: Validates Ringtail lattice signatures via precompile at `0x0150`/`0x0151`.
- **QuantumSafe**: Base contract for Smart Accounts. Routes verification to the appropriate PQ precompile.

## On-Chain Precompiles

All activated at genesis on all networks.

| Address | Primitive | Gas (verify) | Gas (sign/encap) |
|---------|-----------|-------------|-----------------|
| 0x0120 | ML-KEM Encapsulate | -- | 15,000 |
| 0x0121 | ML-KEM Decapsulate | -- | 20,000 |
| 0x0130 | ML-DSA Sign | -- | 25,000 |
| 0x0131 | ML-DSA Verify | 10,000 | -- |
| 0x0140 | SLH-DSA Sign | -- | 50,000 |
| 0x0141 | SLH-DSA Verify | 15,000 | -- |
| 0x0150 | Ringtail Sign | -- | 30,000 |
| 0x0151 | Ringtail Verify | 12,000 | -- |
| 0x0160 | PQCrypto Unified | varies | varies |

## Cloud HSM for Master Keys

Master encryption keys are stored in Cloud HSM (GCP Cloud KMS, FIPS 140-2 Level 3 certified Cavium HSMs). The master key never leaves the HSM boundary. Wrap, unwrap, and sign operations execute inside the HSM. Three keyrings per ecosystem (devnet, testnet, mainnet), 12 keys total. Mainnet keys use HSM protection level.

## Threshold Signing

Four threshold protocols deployed:

| Protocol | Curve | Use Case |
|----------|-------|----------|
| CGGMP21 | secp256k1 (ECDSA) | EVM transaction signing |
| FROST | Ed25519 (EdDSA) | SOL/TON signing |
| BLS | BN254 | Consensus aggregation |
| Ringtail | Module-LWE (lattice) | PQ-safe threshold signing |

## Harvest-Now-Decrypt-Later: Closed

The full PQ stack -- ML-KEM-768 hybrid encryption (S3 backups), X25519MLKEM768 TLS (transit), ML-DSA-65 JWT signing (auth), PQ KEM for MPC transport and key shares, Cloud HSM for master keys, and Quasar triple-hybrid consensus -- closes the HNDL attack vector. An adversary who captures data today cannot decrypt it with a future quantum computer.

## Regulatory Compliance

| Regulation | Requirement | How Satisfied |
|------------|-------------|---------------|
| NIST SP 800-57 | Key management lifecycle | HKDF-derived per-principal keys, 90-day rotation, Cloud HSM master |
| NIST SP 800-131A | Cryptographic algorithm transition | All three FIPS PQ standards (203/204/205) deployed |
| FIPS 140-2 Level 3 | Hardware key isolation | Cloud HSM (GCP, Cavium) for master key material |
| GDPR Article 32 | Appropriate technical measures | AES-256 disk + field encryption, PQ backup encryption, HSM key isolation |

## ZapDB Streaming Replication

ZapDB is a high-throughput KV store that does not use WAL. Instead, it produces incremental backup frames in ZAP binary format:

```
Frame header (16 bytes):
  [0:4]   magic    = 0x5A415001 ("ZAP\x01")
  [4:8]   frame_id = monotonic uint32
  [8:12]  length   = payload length in bytes
  [12:14] checksum = CRC-16 of payload
  [14:15] flags    = 0x01=snapshot, 0x02=delta, 0x04=compressed
  [15:16] reserved = 0x00
```

The `hanzoai/zapdb-replicator` sidecar reads ZAP frames from a Unix socket, encrypts each frame with age, and streams to S3. On restore, the init container downloads the latest snapshot frame and applies delta frames in order.

**S3 path convention**:

```
s3://hanzo-replicate-{env}/{service}/{instance_id}/zapdb/
├── snapshots/{frame_id}.snap.zap.age
├── deltas/{start_frame}_{end_frame}.delta.zap.age
└── latest
```

## Cross-Ecosystem Compatibility

This standard is adopted by LP-102 (Lux) and ZIP-0803 (Zoo) with ecosystem-specific HKDF prefixes:

| Ecosystem | HKDF Prefix | S3 Bucket | Sidecar Image |
|-----------|-------------|-----------|---------------|
| Hanzo | `hanzo:replicate:` | `hanzo-replicate-{env}` | `ghcr.io/hanzoai/replicate` |
| Lux | `lux:replicate:` | `lux-replicate-{env}` | `ghcr.io/luxfi/replicate` |
| Zoo | `zoo:replicate:` | `zoo-replicate-{env}` | `ghcr.io/zoolabs/replicate` |

## References

- Litestream: https://litestream.io
- age: https://age-encryption.org
- LP-102: Lux Encrypted Streaming Replication
- ZIP-0803: Zoo Encrypted Streaming Replication
- HIP-0027: Secrets Management Standard
- HIP-0032: Object Storage Standard
- HIP-0065: Backup & Disaster Recovery Standard
