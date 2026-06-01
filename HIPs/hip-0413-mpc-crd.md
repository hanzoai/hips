---
hip: 0413
title: MPC CRD
author: Hanzo Platform Team
type: Standards Track
category: Operator
status: Final
created: 2026-05-19
---

# HIP-413: MPC CRD

## Abstract

The `MPC` CRD describes a Multi-Party Computation cluster (`luxfi/mpc`). It runs an n-of-m threshold signing network for cross-chain wallets and operator-controlled keys. The reconciler emits a StatefulSet of `replicas` peers and a headless Service for peer discovery; optionally adds a dashboard Deployment and a cache Deployment.

## Specification

### Group + version

`hanzo.ai/v1`, plural `mpcs`, shortname `hmpc`.

### Spec fields

| Field | Type | Description |
|---|---|---|
| `image` | ImageSpec | `luxfi/mpc` (or hanzo-vendored equivalent) |
| `replicas` | int | total peers (n) |
| `threshold` | int | signing threshold (m, where m ≤ n) |
| `p2pPort` | int | peer-to-peer port |
| `apiPort` | int | API port |
| `resources` | ResourceRequirements | requests/limits |
| `dashboard` | MPCDashboardSpec | optional dashboard Deployment |
| `cache` | MPCCacheSpec | optional cache Deployment |
| `ingress` | IngressSpec | optional Ingress |

### Example CR

```yaml
apiVersion: hanzo.ai/v1
kind: MPC
metadata:
  name: hanzo-mpc
  namespace: hanzo
spec:
  image:
    repository: ghcr.io/hanzoai/mpc
    tag: 1.2.9
  replicas: 5
  threshold: 3
  p2pPort: 7000
  apiPort: 8080
  dashboard:
    enabled: true
    image: ghcr.io/luxfi/mpc-dashboard:1.1.3
```

### Generated K8s resources

- StatefulSet (peer cluster)
- Headless Service (peer discovery)
- ClusterIP Service (API)
- Optional Dashboard Deployment + Service
- Optional Cache Deployment + Service

### Operator reconciler

`~/work/hanzo/operator/src/controllers/mpc.rs`.

### Related services

- HIP-497 (hanzo-mpc service)
- HIP-0084 (Pulsar M-DKG)

## Status

Implemented in `hanzoai/operator` v0.3.0+. CR `hanzo-mpc` active with 5 replicas, threshold 3.
