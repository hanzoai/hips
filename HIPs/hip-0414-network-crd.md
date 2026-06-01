---
hip: 0414
title: Network CRD
author: Hanzo Platform Team
type: Standards Track
category: Operator
status: Final
created: 2026-05-19
---

# HIP-414: Network CRD

## Abstract

The `Network` CRD describes a complete blockchain network: validators, chains, optional indexer, explorer, bridge, and bootnode services. It is the top-level Kind that wraps `luxfi/node` operation. The reconciler emits a StatefulSet for validators plus optional sub-services. Sibling Kinds (`Chain`, `Validator`, `Subnet`) are no-op stubs that exist only for `kubectl` ergonomics — the `Network` reconciler owns materialization.

## Specification

### Group + version

`hanzo.ai/v1`, plural `networks`, shortname `hnet`.

### Spec fields

| Field | Type | Description |
|---|---|---|
| `networkID` | string | "1" (mainnet), "2" (testnet), "3" (local), "1337" (dev) |
| `validators` | ValidatorSpec | image, replicas, resources, storage, bootstrapNodes, ports |
| `chains` | []ChainSpec | name, vmID, genesis, optional subnetID |
| `indexer` | SubServiceSpec | optional luxfi/indexer |
| `explorer` | ExplorerSpec | optional luxfi/explorer |
| `bridge` | SubServiceSpec | optional bridge |
| `bootnode` | SubServiceSpec | optional bootnode |

### Example CR

```yaml
apiVersion: hanzo.ai/v1
kind: Network
metadata:
  name: lux-mainnet
  namespace: hanzo
spec:
  networkID: "1"
  validators:
    image:
      repository: ghcr.io/luxfi/node
      tag: v1.23.6
    replicas: 5
    bootstrapNodes:
      - bootnode-0.bootnode.hanzo.svc:9651
    httpPort: 9650
    stakingPort: 9651
    storage:
      storageClassName: do-block-storage
      size: 100Gi
  chains:
    - name: c-chain
      vmID: jvYyfQTxGMJLuGWa55kdP2p2zSUYsQ5Raupu4TW34ZAUBAbtq
      genesis: "..."
  explorer:
    enabled: true
    backendImage: ghcr.io/luxfi/explorer:1.2.2
    frontendImage: ghcr.io/luxfi/explorer:1.2.2
```

### Generated K8s resources

- StatefulSet for validators
- Headless + ClusterIP Services
- PVCs per validator
- Sub-Deployments for indexer/explorer/bridge/bootnode

### Operator reconciler

`~/work/hanzo/operator/src/controllers/network.rs`.

### Related services

- HIP-0020 (Blockchain node standard)
- HIP-0024 (Hanzo sovereign L1 chain architecture)
- No `Network` CR currently runs in `do-sfo3-hanzo-k8s` — primary deployments are on `lux-k8s`.

## Status

Implemented in `hanzoai/operator` v0.3.0+. Used primarily on `lux-k8s` cluster for the Lux network.
