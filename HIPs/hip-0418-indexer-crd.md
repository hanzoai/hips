---
hip: 0418
title: Indexer CRD
author: Hanzo Platform Team
type: Standards Track
category: Operator
status: Final
created: 2026-05-19
---

# HIP-418: Indexer CRD

## Abstract

The `Indexer` CRD is a Service facade for `luxfi/indexer`, the chain-data indexer that builds queryable Postgres tables from raw EVM blocks. Used in combination with `Explorer` (HIP-419) to power block-explorer UIs.

## Specification

### Group + version

`hanzo.ai/v1`, plural `indexers`, shortname `idx`.

### Spec fields

Same shape as `Service` (HIP-400). Conventionally:

- `image.repository`: `ghcr.io/luxfi/indexer`
- env: `RPC_URL`, `DATABASE_URL`, `CHAIN_ID`
- backing store: `SQL` CR

### Example CR

```yaml
apiVersion: hanzo.ai/v1
kind: Indexer
metadata:
  name: hanzo-indexer
  namespace: hanzo
spec:
  image:
    repository: ghcr.io/luxfi/indexer
    tag: v1.2.2
  replicas: 1
  env:
    - name: RPC_URL
      value: https://api.lux.network/mainnet/ext/bc/hanzo/rpc
    - name: DATABASE_URL
      valueFrom:
        secretKeyRef: { name: indexer-db, key: url }
    - name: CHAIN_ID
      value: "36963"
```

### Generated K8s resources

Deployment, Service. Long-running indexer pod processes new blocks into Postgres.

### Operator reconciler

`~/work/hanzo/operator/src/controllers/service.rs` (via `Indexer` facade).

### Related services

- HIP-419 (Explorer CRD)
- HIP-414 (Network CRD)

## Status

Implemented in `hanzoai/operator` v0.3.0+. Primarily deployed on `lux-k8s`.
