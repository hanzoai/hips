---
hip: 0302
title: "Hanzo Replicate: Encrypted SQLite Durability for Base Services"
author: Zach Kelling (zach@hanzo.ai)
type: Standards Track
category: Infrastructure
status: Draft
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
