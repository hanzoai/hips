---
hip: "0065"
title: Backup & Disaster Recovery Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Final
created: 2026-02-23
requires: HIP-0027, HIP-1164, HIP-1104, HIP-1241
---


# HIP-0065: Backup & Disaster Recovery Standard

## Abstract

This proposal defines the unified backup and disaster recovery (DR) standard
for all stateful services in the Hanzo ecosystem. Every data store -- SQL
(HIP-1104), Valkey/KV (HIP-1164), Hanzo Datastore (HIP-1241), MinIO/S3 (HIP-0032),
model artifacts, training checkpoints, datasets, and configuration secrets --
MUST be backed up, verified, and recoverable through the single Hanzo Backup
service defined here.

**Repository**: none yet -- the backup controller described below is proposed, not built.
**Image**: none yet. The `ghcr.io/hanzoai/backup` name is already taken by an
unrelated service, so this controller needs a different one when it ships.
**Port**: 8065 (backup controller API)
**License**: Apache-2.0

## Motivation

Hanzo operates 15+ stateful services across two Kubernetes clusters (hanzo-k8s,
lux-k8s). Each service adopted its own backup approach:

- **PostgreSQL** runs a CronJob with `pg_dump` every 6 hours (HIP-1104).
- **KV** relies on RDB snapshots that only persist to the local PVC.
- **Hanzo Datastore** has no automated backup; operators run manual `BACKUP` commands.
- **MinIO** replicates buckets between clusters but has no off-site copy.
- **Model artifacts** are stored in S3 buckets with no versioning policy.
- **KMS secrets** are backed up only through the KMS built-in export.

This patchwork creates five problems:

1. **No unified Recovery Point Objective (RPO).** Some services can lose 6 hours
   of data (SQL) while others can lose days (Hanzo Datastore). There is no
   organizational agreement on acceptable data loss per service tier.

2. **No tested Recovery Time Objective (RTO).** Nobody has timed a full restore
   of any service from backup. We have backups but no proof they work. Untested
   backups are not backups.

3. **No cross-region copies.** All backups live in the same DigitalOcean region
   as the production clusters. A regional outage (datacenter fire, network
   partition) destroys both production data and backups simultaneously.

4. **No AI-specific DR.** Model weights, training checkpoints, and datasets are
   the most valuable and most expensive-to-reproduce assets in the organization.
   Recreating a fine-tuned model from scratch costs thousands of dollars in GPU
   time. Yet these artifacts have no formal backup or versioning strategy.

5. **No encryption consistency.** Some backups are encrypted; some are not. There
   is no standard for which KMS key encrypts what, or how to rotate backup
   encryption keys.

We need ONE backup and DR system that covers every data store with explicit
RPO/RTO targets, automated verification, cross-region replication, and
AI-aware artifact preservation.

## Design Philosophy

This section explains the reasoning behind each major architectural decision.
Every heading addresses a single decision and why the alternatives were rejected.

### Why Unified Backup Over Per-Service Scripts

The status quo is per-service backup scripts: a CronJob for SQL, a
ConfigMap-driven script for KV, nothing for Hanzo Datastore. This approach has
three fundamental problems:

1. **Inconsistent scheduling.** Each team picks its own cron schedule. There is
   no way to answer "what is the most recent consistent snapshot of the entire
   system?" because backups are taken at different times.

2. **No single recovery plan.** Disaster recovery requires restoring multiple
   services in the correct order (KMS first, then SQL, then application
   services). Per-service scripts have no concept of orchestrated recovery.

3. **Duplicated infrastructure.** Every script independently implements S3
   upload, retention pruning, encryption, and alerting. This code is duplicated
   across 5+ CronJobs and tested nowhere.

A unified backup controller eliminates all three problems. It schedules backups
across all stores, maintains a dependency graph for ordered recovery, and
provides a single codebase for upload, encryption, verification, and alerting.

The trade-off is coupling: a bug in the backup controller affects all stores.
We accept this because backup infrastructure is inherently cross-cutting. A
single well-tested controller is more reliable than five untested scripts.

## Specification

### Service Tiers and RPO/RTO Targets

Every Hanzo service is assigned one of three tiers:

| Tier | RPO | RTO | Backup Frequency | Replication | Examples |
|------|-----|-----|------------------|-------------|----------|
| **Critical** | 1 minute | 5 minutes | Continuous (WAL/AOF streaming) | Synchronous cross-region | SQL (IAM, Cloud), KMS secrets |
| **Standard** | 1 hour | 1 hour | Hourly snapshots | Async cross-region | Valkey/KV, Hanzo Datastore, MinIO buckets |
| **Archival** | 24 hours | 4 hours | Daily snapshots | Async, single copy | Model artifacts, training datasets, logs |

RPO = Recovery Point Objective (maximum acceptable data loss).
RTO = Recovery Time Objective (maximum acceptable downtime during recovery).

### Backup Targets

The backup controller manages the following data stores:

```
Backup Controller (:8065)
  │
  ├── PostgreSQL (HIP-1104)  ── pg_basebackup + WAL archiving
  ├── Valkey/KV  (HIP-1164)  ── RDB snapshot export
  ├── Hanzo Datastore (HIP-1241)  ── BACKUP DATABASE ... TO S3
  ├── MinIO/S3   (HIP-0032)  ── mc mirror (bucket replication)
  ├── Model Weights / Checkpoints / Datasets  ── versioned S3
  └── Config / Secrets  ── Velero + KMS export
          │
    Encryption (KMS HIP-0027)
          │
    S3 Primary Region  ──async──→  S3 Secondary Region
```

### Per-Store Backup Methods

#### SQL (Critical Tier)

Two complementary backup mechanisms run simultaneously:

1. **Continuous WAL archiving.** WAL segments are shipped to the backup S3
   bucket as they are produced. This provides point-in-time recovery (PITR) to
   any second within the WAL retention window (default: 7 days). Configuration:

   ```ini
   # postgresql.conf additions for PITR
   archive_mode = on
   archive_command = 'backup-wal-push %p --endpoint s3://hanzo-backups/wal/%f'
   archive_timeout = 60
   ```

2. **Periodic base backups.** A full `pg_basebackup` runs every 24 hours. This
   establishes a restore baseline. PITR replays WAL on top of the most recent
   base backup.

   To restore to a specific point in time:

   ```bash
   # Restore base backup
   backup-pg-restore --base-backup 20260223_000000 \
     --target-time "2026-02-23 14:30:00 UTC" \
     --endpoint s3://hanzo-backups
   ```

The existing `pg_dump` CronJob (HIP-1104) continues as a logical backup for
selective per-database restore. It supplements but does not replace PITR.

#### Valkey/KV (Standard Tier)

KV supports two persistence formats:

- **RDB snapshots**: Point-in-time binary dumps. Compact and fast to restore.
- **AOF (Append Only File)**: Write-ahead log of every command. Higher fidelity
  but larger and slower to replay.

The backup controller exports an RDB snapshot every hour and uploads it to S3.
For critical deployments that require sub-hour RPO, AOF streaming to S3 can
be enabled per-instance.

```bash
# Trigger RDB snapshot and upload
backup-kv-snapshot --host localhost:6379 \
  --output s3://hanzo-backups/kv/$(date +%Y%m%d_%H%M%S).rdb
```

#### Hanzo Datastore (Standard Tier)

Hanzo Datastore provides native `BACKUP TABLE ... TO S3(...)` syntax. The backup
controller issues backup commands for each database on an hourly schedule.

```sql
BACKUP DATABASE insights TO S3(
  'https://s3.hanzo-backups.svc/datastore/insights/20260223_140000',
  'backup-access-key',
  'backup-secret-key'
) SETTINGS compression_method = 'zstd';
```

Incremental backups are supported via `BACKUP ... SETTINGS base_backup`. Each
hourly backup is incremental against the most recent daily full backup.

#### MinIO/S3 Object Storage (Standard Tier)

MinIO buckets are replicated using `mc mirror` to a secondary S3 endpoint.
This provides both backup and geographic redundancy.

```bash
# Mirror production bucket to backup region
mc mirror --watch --overwrite \
  prod/hanzo-storage s3backup/hanzo-storage
```

For versioned buckets (model weights, datasets), MinIO's built-in versioning
preserves every object revision. The backup controller verifies that versioning
is enabled on all critical buckets.

#### Model Artifacts and Training Checkpoints (Archival Tier)

AI artifacts are the most expensive data to reproduce. A single fine-tuning
run can cost $500-10,000 in GPU compute. The backup strategy must preserve:

1. **Model weights**: Final trained parameters. Stored in MinIO with versioning.
   Each model version is tagged with its training run ID, dataset hash, and
   hyperparameter fingerprint.

2. **Training checkpoints**: Intermediate snapshots taken every N steps during
   training. These allow resuming a failed training run without starting over.
   Retained for 30 days after training completion, then pruned.

3. **Datasets**: Training and evaluation data. Versioned using content-addressed
   hashing (SHA-256 of the dataset manifest). Immutable once published.

All artifacts are stored in dedicated MinIO buckets with lifecycle rules:

| Artifact Type | Bucket | Versioning | Retention |
|---------------|--------|------------|-----------|
| Model weights (released) | `models-release` | Enabled | Permanent |
| Model weights (experimental) | `models-dev` | Enabled | 90 days |
| Training checkpoints | `training-checkpoints` | Disabled | 30 days post-run |
| Datasets (published) | `dataset` | Enabled (content-addressed) | Permanent |
| Datasets (staging) | `datasets-staging` | Disabled | 14 days |

#### Configuration and Secrets (Critical Tier)

Two mechanisms protect cluster configuration:

1. **Velero**: Backs up all Kubernetes API objects (Deployments, StatefulSets,
   ConfigMaps, CRDs, Services) to S3 every hour. Velero also coordinates PVC
   snapshot creation for volume-level backup.

   ```bash
   velero schedule create hanzo-cluster-backup \
     --schedule="0 * * * *" \
     --include-namespaces hanzo \
     --storage-location default \
     --ttl 720h
   ```

2. **KMS export**: KMS secrets are exported nightly as an encrypted JSON bundle.
   This bundle is encrypted with a separate backup-specific KMS key that is
   itself stored in a hardware security module (HSM) or offline cold storage.

### Cross-Region Replication

Every backup is replicated to a secondary geographic region. The primary and
secondary regions MUST be in different data centers with independent failure
domains.

```
Primary (NYC1/SFO3)              Secondary (AMS3/SGP1)
s3://hanzo-backups     ──async──→  s3://hanzo-backups-secondary
  WAL, RDB, CH, Velero              Full replica of all backup data
```

Replication lag for async cross-region copy MUST stay below 15 minutes under
normal operation. The backup controller monitors replication lag and alerts
when it exceeds the threshold.

### Point-in-Time Recovery (PITR)

PITR is available for SQL via WAL archiving. The recovery window is
configurable per cluster:

| Cluster | PITR Window | WAL Retention |
|---------|-------------|---------------|
| hanzo-k8s | 7 days | 7 days of WAL segments |
| lux-k8s | 7 days | 7 days of WAL segments |

To perform PITR:

```bash
# 1. Stop the target SQL instance
kubectl scale statefulset postgres --replicas=0

# 2. Restore base backup + replay WAL to target time
backup-pg-restore \
  --cluster hanzo-k8s \
  --target-time "2026-02-23 14:30:00 UTC" \
  --output /var/lib/postgresql/data

# 3. Start SQL (it will replay WAL to the target time)
kubectl scale statefulset postgres --replicas=1
```

For KV and Hanzo Datastore, PITR is not natively supported. Recovery is to the
most recent snapshot. If sub-hour granularity is needed for KV, enable AOF
streaming.

### Backup Encryption

All backups MUST be encrypted at rest using AES-256-GCM. Encryption keys are
managed by KMS (HIP-0027).

```
Backup data → AES-256-GCM encryption → Encrypted blob → S3 upload
                     ↑
              Data Encryption Key (DEK)
                     ↑
              Key Encryption Key (KEK) from KMS
```

**Key hierarchy**:

1. **KEK (Key Encryption Key)**: Stored in KMS under path `/backup/kek`.
   Rotated every 90 days. Old KEKs are retained (but marked inactive) for
   decrypting historical backups.

2. **DEK (Data Encryption Key)**: Generated per backup operation. Encrypted
   with the current KEK and stored alongside the backup metadata.

3. **Emergency recovery key**: A copy of the KEK is stored offline (printed
   QR code in a physical safe) for scenarios where KMS itself is unavailable.

### Automated Backup Verification

Backups that are never tested are not backups. The backup controller runs
automated restore tests on every backup:

1. **Integrity check**: After upload, download the backup and verify SHA-256
   checksum matches. This catches S3 corruption and upload errors.

2. **Restore test**: Once per day, the backup controller spins up an ephemeral
   environment (a temporary Pod with no production access) and restores the
   most recent backup of each Critical-tier service. If the restore succeeds
   and basic health checks pass, the test passes.

3. **Data consistency check**: For PostgreSQL, run `pg_restore --list` to
   verify the dump TOC is valid. For Hanzo Datastore, run `CHECK TABLE` on
   restored tables. For KV, load the RDB and run `DBSIZE` to verify
   non-zero key count.

Verification runs as a CronJob at 04:00 UTC daily (`backup-verify --all-critical`).
Failures trigger PagerDuty alerts at the same severity as a production outage.

### Retention Policy

| Backup Type | Retention | Pruning |
|-------------|-----------|---------|
| WAL segments | 7 days | Automatic after base backup + WAL coverage |
| SQL base backups | 30 days | Oldest pruned when count exceeds 30 |
| KV RDB snapshots | 30 days | Oldest pruned when count exceeds 720 (hourly) |
| Hanzo Datastore backups | 90 days | Oldest pruned when count exceeds 2160 |
| MinIO bucket mirrors | Current + 1 previous | Continuous mirror, version history in bucket |
| Velero cluster backups | 30 days | TTL-based (720h) |
| KMS secret exports | 90 days | Oldest pruned on schedule |
| Model weights (released) | Permanent | Never pruned |
| Training checkpoints | 30 days post-run | Automatic after run completion + 30d |

## Implementation

### Backup Controller

The backup controller is a Go binary deployed as a single-replica Kubernetes
Deployment in the `hanzo` namespace. It authenticates to all data stores using
credentials from KMS and uploads encrypted backups to S3.

```yaml
# Key environment variables (all sourced from KMS secrets)
BACKUP_S3_ENDPOINT:       # Primary S3 backup endpoint
BACKUP_S3_ACCESS_KEY:     # S3 credentials
BACKUP_S3_SECRET_KEY:     # S3 credentials
BACKUP_KMS_ENDPOINT:      https://kms.hanzo.ai/api
BACKUP_SECONDARY_REGION:  # Secondary S3 endpoint for cross-region copy
```

Resource requests: 256Mi memory, 200m CPU. Limits: 512Mi memory, 1 CPU.
The controller Service exposes port 8065 within the cluster.

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/status` | Backup system health and last backup times |
| `GET` | `/api/v1/backups` | List all backups with metadata |
| `POST` | `/api/v1/backups` | Trigger an ad-hoc backup for a specific store |
| `POST` | `/api/v1/restore` | Initiate a restore operation |
| `GET` | `/api/v1/verify` | Last verification results |
| `POST` | `/api/v1/verify` | Trigger an ad-hoc verification |
| `GET` | `/api/v1/metrics` | Prometheus-compatible metrics |

### Disaster Recovery Runbooks

#### Runbook 1: Single-Service Database Corruption

Scenario: A bad migration corrupts the `iam` database. RTO: 5 minutes.

1. Identify corruption timestamp from application logs.
2. `POST /api/v1/restore` with `store=postgresql`, `database=iam`,
   `target_time=<pre-corruption>`, `method=pitr`.
3. Controller stops IAM pods, restores base backup, replays WAL to target time.
4. Controller restarts IAM and runs health check. Verify login flow manually.

#### Runbook 2: Full Cluster Loss

Scenario: hanzo-k8s is destroyed (provider outage). RTO: 1 hour.

1. Provision new Kubernetes cluster in secondary region.
2. `velero restore create --from-backup hanzo-cluster-backup-latest`
3. `backup-pg-restore --cluster hanzo-k8s --latest`
4. `backup-kv-restore --cluster hanzo-k8s --latest`
5. `backup-ch-restore --cluster hanzo-k8s --latest`
6. Update DNS (hanzo.id, cloud.hanzo.ai, etc.) to new cluster IP.
7. Verify all services via `/healthz` endpoints.

#### Runbook 3: Model Artifact Recovery

Scenario: Production model accidentally deleted. RTO: 15 minutes.

1. Identify model version from inference error logs.
2. `mc cp --version-id <ver> backup/models-release/<model> prod/models-release/`
3. Restart inference pods. Verify via test prompt.

### Monitoring and Alerting

The backup controller exposes Prometheus metrics:

| Metric | Type | Description |
|--------|------|-------------|
| `backup_last_success_timestamp` | Gauge | Unix timestamp of last successful backup per store |
| `backup_last_duration_seconds` | Gauge | Duration of last backup per store |
| `backup_size_bytes` | Gauge | Size of last backup per store |
| `backup_verification_success` | Gauge | 1 if last verification passed, 0 if failed |
| `backup_replication_lag_seconds` | Gauge | Cross-region replication lag |
| `backup_operations_total` | Counter | Total backup operations by store and status |

**Alert rules**:

| Alert | Condition | Severity |
|-------|-----------|----------|
| BackupMissed | No successful backup in 2x the scheduled interval | Critical |
| BackupVerificationFailed | `backup_verification_success == 0` | Critical |
| ReplicationLagHigh | `backup_replication_lag_seconds > 900` | Warning |
| BackupSizeAnomaly | Size differs > 50% from 7-day average | Warning |

## Security

### Encryption at Rest

All backup data MUST be encrypted before leaving the backup controller. The
controller fetches the current KEK from KMS (HIP-0027), generates a per-backup
DEK, encrypts the backup payload with AES-256-GCM, wraps the DEK with the KEK,
and stores both the encrypted payload and wrapped DEK in S3.

### Network Isolation

A NetworkPolicy restricts the backup controller's egress to only the required
ports within the `hanzo` namespace (5432 SQL, 6379 KV, 8123
Hanzo Datastore, 9000 MinIO) and port 443 for external HTTPS (KMS API, secondary
S3 endpoint). All other egress is denied.

### Access Control

Backup and restore operations require the `backup-admin` KMS role. The backup
controller authenticates via Universal Auth. Human operators MUST authenticate
via KMS SSO and have explicit `backup-admin` membership to trigger manual
restores. All backup and restore operations are logged to the audit trail in
KMS.

### Backup Isolation

Backup S3 buckets use separate credentials from production S3 buckets. A
compromised production MinIO key cannot read or delete backups. Backup
buckets have Object Lock enabled (WORM -- write once read many) for
Critical-tier backups to prevent ransomware-style deletion.

## Future Work

### Phase 4: Multi-Cloud DR

Extend cross-region replication to cross-cloud. Secondary backups stored on a
different cloud provider (AWS S3, GCS) ensure recovery even if the primary
cloud provider experiences a global outage.

## References

1. [HIP-0027: Secrets Management Standard](./hip-0027-secrets-management-standard.md)
2. [HIP-1164: Provisioning — Stores on Demand](./hip-1164-provisioning-stores-on-demand.md)
3. [HIP-1104: Base — The Hosted Backend](./hip-1104-base-hosted-backend.md)
4. HIP-0032: Object Storage Standard
5. [HIP-1241: Metrics — One Native Store, Three Signals](./hip-1241-metrics-one-store-three-signals.md)
6. [Velero Documentation](https://velero.io/docs/)
7. [PostgreSQL PITR](https://www.postgresql.org/docs/16/continuous-archiving.html)
8. [ClickHouse BACKUP](https://clickhouse.com/docs/en/operations/backup)
9. [MinIO Replication](https://min.io/docs/minio/linux/administration/bucket-replication.html)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
