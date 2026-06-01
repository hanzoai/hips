---
hip: 0407
title: Base CRD
author: Hanzo Platform Team
type: Standards Track
category: Operator
status: Final
created: 2026-05-19
---

# HIP-407: Base CRD

## Abstract

The `Base` CRD (renamed from `BaseApp` in v0.3.0) models a Hanzo Base distribution app: a stateful, writer-elected, single-leader workload backed by `hanzoai/base`. Base is the embedded-SQLite-with-replication runtime that powers the Hanzo Base PaaS (HIP-038). Each `Base` CR runs as a StatefulSet with a Quasar consensus writer election; the gateway proxies writes to the current leader and serves reads from any replica.

## Specification

### Group + version

`hanzo.ai/v1`, plural `bases`, shortname `bapp`.

### Spec fields

| Field | Type | Description |
|---|---|---|
| `image` | ImageSpec | Base distribution image |
| `replicas` | int | StatefulSet replicas (odd, typically 3 or 5) |
| `port` | int | HTTP port |
| `consensus` | string | `quasar` (default) |
| `schema` | string | optional initial schema URL or inline DDL |
| `storage` | StorageSpec | per-replica PVC |
| `env`, `envFrom` | array | environment |
| `gateway` | BaseGatewaySpec | gateway route + leader poll interval + read-your-writes TTL |
| `iamApp` | string | IAM application client_id |
| `kmsSecrets` | []KMSSecretRef | KMS-sourced secrets |
| `networkPolicy` | NetworkPolicySpec | optional |
| `serviceMonitor` | ServiceMonitorSpec | optional |

### Example CR

```yaml
apiVersion: hanzo.ai/v1
kind: Base
metadata:
  name: my-app
  namespace: hanzo
spec:
  image:
    repository: ghcr.io/hanzoai/base
    tag: v1.2.3
  replicas: 3
  port: 8090
  consensus: quasar
  storage:
    storageClassName: do-block-storage
    size: 10Gi
    retentionPolicy: Retain
  gateway:
    route: /v1/my-app
    gatewayName: gateway
    gatewayNamespace: hanzo
    leaderPollInterval: 2s
    readYourWritesTTL: 5s
  iamApp: app-my-app
```

### Generated K8s resources

- StatefulSet (one Pod per replica)
- Headless Service (peer discovery)
- ClusterIP Service (client traffic)
- PVC templates
- Optional Gateway route (auto-injected into the Gateway CR)

### Operator reconciler

`~/work/hanzo/operator/src/controllers/baseapp.rs` (controller file retains historical name).

### Related services

- HIP-0105 (in-process extension runtime standard)
- HIP-0302 (encrypted SQLite replication standard)
- Used by: Hanzo Base PaaS apps.

## Status

Implemented in `hanzoai/operator` v0.3.0+. Kind renamed from `BaseApp` to `Base` in the v0.3.0 schema cleanup.
