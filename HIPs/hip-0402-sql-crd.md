---
hip: 0402
title: SQL CRD
author: Hanzo Platform Team
type: Standards Track
category: Operator
status: Final
created: 2026-05-19
---

# HIP-402: SQL CRD

## Abstract

The `SQL` CRD is the facade Kind for PostgreSQL workloads (`hanzoai/sql`). It is structurally identical to `Datastore` with `type: postgresql` and exists to give Postgres a first-class API surface — `kubectl get sql` instead of `kubectl get datastore`. The reconciler delegates to the `Datastore` controller. The CR's spec is `DatastoreSpec` verbatim.

## Specification

### Group + version

`hanzo.ai/v1`, plural `sqls`, shortname `sql`.

### Spec fields

Same shape as `Datastore` (HIP-401). Implicitly `type: postgresql`.

### Example CR

```yaml
apiVersion: hanzo.ai/v1
kind: SQL
metadata:
  name: sql
  namespace: hanzo
spec:
  type: postgresql
  image:
    repository: ghcr.io/hanzoai/sql
    tag: "18"
  replicas: 1
  storage:
    storageClassName: do-block-storage
    size: 20Gi
    retentionPolicy: Retain
  env:
    - name: POSTGRES_USER
      value: hanzo
    - name: POSTGRES_DB
      value: hanzo
    - name: POSTGRES_PASSWORD
      valueFrom:
        secretKeyRef:
          name: postgres-credentials
          key: password
  credentialsSecret: postgres-credentials
  serviceAliases: [postgres, hanzo-sql]
```

### Generated K8s resources

Same as `Datastore`: StatefulSet, headless + ClusterIP Services, PVCs.

### Operator reconciler

`~/work/hanzo/operator/src/controllers/datastore.rs` (via `SQL` facade in `crd.rs`).

### Related services

- HIP-502 (sql service)
- HIP-456 (insights-sql)
- Used as the relational store by IAM, Console, Commerce, Cloud, Platform, KMS.

## Status

Implemented in `hanzoai/operator` v0.3.0+. One CR `sql` active in cluster.
