---
hip: 0419
title: Explorer CRD
author: Hanzo Platform Team
type: Standards Track
category: Operator
status: Final
created: 2026-05-19
---

# HIP-419: Explorer CRD

## Abstract

The `Explorer` CRD is a Service facade for `luxfi/explorer`, the block explorer UI + API. It reads indexed chain data from a backing `Indexer` and presents a web UI for blocks, transactions, accounts, and contracts.

## Specification

### Group + version

`hanzo.ai/v1`, plural `explorers`, shortname `exp`.

### Spec fields

Same shape as `Service` (HIP-400). Conventionally:

- `image.repository`: `ghcr.io/luxfi/explorer`
- two containers in some deployments: API + frontend, or one image serving both
- env: `INDEXER_URL`, `RPC_URL`

### Example CR

```yaml
apiVersion: hanzo.ai/v1
kind: Explorer
metadata:
  name: hanzo-explorer
  namespace: hanzo
spec:
  image:
    repository: ghcr.io/luxfi/explorer
    tag: 1.2.2
  replicas: 2
  env:
    - name: INDEXER_URL
      value: http://hanzo-indexer.hanzo.svc:80
    - name: RPC_URL
      value: https://api.lux.network/mainnet/ext/bc/hanzo/rpc
  ingress:
    enabled: true
    hosts:
      - explore-hanzo.lux.network
```

### Generated K8s resources

Deployment, Service, optional Ingress.

### Operator reconciler

`~/work/hanzo/operator/src/controllers/service.rs` (via `Explorer` facade).

### Related services

- HIP-418 (Indexer CRD)
- HIP-414 (Network CRD)

## Status

Implemented in `hanzoai/operator` v0.3.0+. Primarily deployed on `lux-k8s`.
