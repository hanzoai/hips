---
hip: 0416
title: Validator CRD
author: Hanzo Platform Team
type: Standards Track
category: Operator
status: Final
created: 2026-05-19
---

# HIP-416: Validator CRD

## Abstract

The `Validator` CRD declares an individual validator node for a `Network`. It is a NoOp stub: the `Network` controller owns materialization, but operators may use `Validator` CRs to describe per-validator overrides (resources, storage, bootstrap nodes) that the network controller picks up at reconcile time.

## Specification

### Group + version

`hanzo.ai/v1`, plural `validators`, shortname `val`.

### Spec fields

| Field | Type | Description |
|---|---|---|
| `network` | string | parent `Network` CR name |
| `spec` | ValidatorSpec | image, replicas (almost always 1), resources, storage, bootstrapNodes, stakingPort, httpPort |

### Example CR

```yaml
apiVersion: hanzo.ai/v1
kind: Validator
metadata:
  name: lux-mainnet-validator-0
  namespace: hanzo
spec:
  network: lux-mainnet
  spec:
    image:
      repository: ghcr.io/luxfi/node
      tag: v1.23.6
    replicas: 1
    resources:
      requests: { cpu: 2, memory: 8Gi }
      limits:   { cpu: 4, memory: 16Gi }
    storage:
      storageClassName: do-block-storage
      size: 200Gi
```

### Generated K8s resources

None directly. The `Network` reconciler reads `Validator` CRs for ordinal-specific overrides.

### Operator reconciler

`~/work/hanzo/operator/src/controllers/network.rs`.

### Related services

- HIP-414 (Network CRD)

## Status

Implemented in `hanzoai/operator` v0.3.0+ as a NoOp stub Kind.
