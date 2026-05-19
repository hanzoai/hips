---
hip: 0415
title: Chain CRD
author: Hanzo Platform Team
type: Standards Track
category: Operator
status: Final
created: 2026-05-19
---

# HIP-415: Chain CRD

## Abstract

The `Chain` CRD declares an EVM chain configuration that belongs to a `Network`. It is a NoOp stub: the operator's `Network` controller is the actual materialization point; `Chain` exists purely so an operator can `kubectl get chain` and audit per-chain config independently.

## Specification

### Group + version

`hanzo.ai/v1`, plural `chains`, shortname `chain`.

### Spec fields

| Field | Type | Description |
|---|---|---|
| `network` | string | name of the parent `Network` CR |
| `chain` | ChainSpec | name, vmID, genesis, subnetID |

### Example CR

```yaml
apiVersion: hanzo.ai/v1
kind: Chain
metadata:
  name: hanzo-evm
  namespace: hanzo
spec:
  network: lux-mainnet
  chain:
    name: hanzo
    vmID: srEXiWaHuhNyGwPUi444Tu47ZEDwxTWrbQiuD7FmgSAQEkXQT
    genesis: |
      { "chainId": 36963, ... }
    subnetID: 2j7zaMjBfoy7tT7vYBM4iLg7uCBHk6dEUC8z8Z2eYCK5sUv7Jq
```

### Generated K8s resources

None directly. The `Network` reconciler reads `Chain` CRs scoped to its name and bakes them into the validator StatefulSet config.

### Operator reconciler

`~/work/hanzo/operator/src/controllers/network.rs` (no dedicated chain reconciler — the type is a status surface).

### Related services

- HIP-414 (Network CRD)

## Status

Implemented in `hanzoai/operator` v0.3.0+ as a NoOp stub Kind.
