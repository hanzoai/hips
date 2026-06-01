---
hip: 0417
title: Subnet CRD
author: Hanzo Platform Team
type: Standards Track
category: Operator
status: Final
created: 2026-05-19
---

# HIP-417: Subnet CRD

## Abstract

The `Subnet` CRD declares a Lux subnet — a set of `Chain`s that share a validator subset. It is a NoOp stub; the `Network` controller is the materialization point.

## Specification

### Group + version

`hanzo.ai/v1`, plural `subnets`, shortname `subnet`.

### Spec fields

| Field | Type | Description |
|---|---|---|
| `network` | string | parent `Network` CR name |
| `subnetId` | string | on-chain Subnet ID |
| `chains` | []ChainSpec | chains belonging to this subnet |

### Example CR

```yaml
apiVersion: hanzo.ai/v1
kind: Subnet
metadata:
  name: hanzo-subnet
  namespace: hanzo
spec:
  network: lux-mainnet
  subnetId: 2j7zaMjBfoy7tT7vYBM4iLg7uCBHk6dEUC8z8Z2eYCK5sUv7Jq
  chains:
    - name: hanzo
      vmID: srEXiWaHuhNyGwPUi444Tu47ZEDwxTWrbQiuD7FmgSAQEkXQT
      genesis: "..."
```

### Generated K8s resources

None directly.

### Operator reconciler

`~/work/hanzo/operator/src/controllers/network.rs`.

### Related services

- HIP-414 (Network CRD)
- HIP-0024 (Hanzo sovereign L1 chain architecture)

## Status

Implemented in `hanzoai/operator` v0.3.0+ as a NoOp stub Kind.
