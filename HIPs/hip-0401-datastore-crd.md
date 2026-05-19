---
hip: 0401
title: Datastore CRD
author: Hanzo Platform Team
type: Standards Track
category: Operator
status: Final
created: 2026-05-19
---

# HIP-401: Datastore CRD

## Abstract

The `Datastore` CRD models a stateful workload with persistent storage. It is the canonical primitive backing ClickHouse (`hanzoai/datastore`). Type-routed siblings — `SQL`, `KV`, `DocDB`, `S3` — are thin facades that delegate to the same reconciler with a `spec.type` discriminator. The operator materializes a `StatefulSet`, headless and ClusterIP `Service`s, `PersistentVolumeClaim` templates, and `KMSSecret` references.

## Specification

### Group + version

`hanzo.ai/v1` (group configurable).

### Spec fields

| Field | Type | Description |
|---|---|---|
| `type` | string | `clickhouse`, `postgresql`, `valkey`, `docdb`, `minio` |
| `image` | ImageSpec | repository, tag, pullPolicy |
| `replicas` | int | StatefulSet replica count |
| `storage` | StorageSpec | storageClassName, size, retentionPolicy |
| `resources` | ResourceRequirements | requests/limits |
| `env`, `envFrom` | []EnvVar / []EnvFromSource | environment |
| `volumes`, `volumeMounts` | array | extra volumes beyond `storage` |
| `credentialsSecret` | string | secret holding root creds |
| `kmsSecrets` | []KMSSecretRef | KMS-managed secrets |
| `backup` | BackupSpec | schedule, s3 target, retention |
| `serviceAliases` | []string | extra DNS aliases for ClusterIP |
| `ports` | []ServicePort | exposed ports |
| `networkPolicy` | NetworkPolicySpec | optional |
| `serviceMonitor` | ServiceMonitorSpec | optional Prometheus scrape |
| `command`, `args` | []string | container entrypoint |

### Example CR

```yaml
apiVersion: hanzo.ai/v1
kind: Datastore
metadata:
  name: datastore
  namespace: hanzo
spec:
  type: clickhouse
  image:
    repository: ghcr.io/hanzoai/datastore
    tag: "26"
  replicas: 1
  storage:
    storageClassName: do-block-storage
    size: 50Gi
    retentionPolicy: Retain
  credentialsSecret: clickhouse-credentials
```

### Generated K8s resources

- `StatefulSet` (one Pod per replica, stable hostnames)
- Headless `Service` (for replica discovery)
- ClusterIP `Service` (for client traffic; aliases via `serviceAliases`)
- `PersistentVolumeClaim` per replica (from `volumeClaimTemplates`)
- `NetworkPolicy` (if requested)
- `KMSSecret` references (if `kmsSecrets`)

### Operator reconciler

- Rust: `~/work/hanzo/operator/src/controllers/datastore.rs`

### Related services

- `Datastore` (ClickHouse): HIP-496 (datastore)
- `SQL` (Postgres): HIP-502 (sql)
- `KV` (Valkey): HIP-498 (kv)
- `S3` (MinIO): HIP-476 (s3), HIP-477 (s3-demo)
- `Insights-KV` (Valkey): HIP-454
- `Insights-SQL` (Postgres): HIP-456

## Status

Implemented in `hanzoai/operator` v0.3.0+. Backs all stateful workloads in `do-sfo3-hanzo-k8s`.
