---
hip: 0403
title: KV CRD
author: Hanzo Platform Team
type: Standards Track
category: Operator
status: Final
created: 2026-05-19
---

# HIP-403: KV CRD

## Abstract

The `KV` CRD is the facade Kind for Valkey/Redis-compatible workloads (`hanzoai/kv`). It delegates to the `Datastore` reconciler with `type: valkey`. Used as the cache/queue substrate by the LLM gateway, console, chat, and analytics. The CR's spec is `DatastoreSpec` verbatim.

## Specification

### Group + version

`hanzo.ai/v1`, plural `kvs`, shortname `kv`.

### Spec fields

Same shape as `Datastore` (HIP-401). Implicitly `type: valkey`.

### Example CR

```yaml
apiVersion: hanzo.ai/v1
kind: KV
metadata:
  name: kv
  namespace: hanzo
spec:
  type: valkey
  image:
    repository: ghcr.io/hanzoai/kv
    tag: "9"
  replicas: 1
  storage:
    storageClassName: do-block-storage
    size: 5Gi
    retentionPolicy: Retain
  credentialsSecret: redis-credentials
  serviceAliases: [redis, valkey]
```

### Generated K8s resources

StatefulSet, headless + ClusterIP Services, PVC.

### Operator reconciler

`~/work/hanzo/operator/src/controllers/datastore.rs`.

### Related services

- HIP-498 (kv service)
- HIP-454 (insights-kv)
- Consumers: LLM gateway response cache, console queue, chat rate limiter.

## Status

Implemented in `hanzoai/operator` v0.3.0+. CRs `kv` and `insights-kv` active in cluster.
