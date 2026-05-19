---
hip: 0404
title: DocDB CRD
author: Hanzo Platform Team
type: Standards Track
category: Operator
status: Final
created: 2026-05-19
---

# HIP-404: DocDB CRD

## Abstract

The `DocDB` CRD is the facade Kind for FerretDB workloads (`hanzoai/docdb`). FerretDB exposes the MongoDB wire protocol over PostgreSQL, giving us MongoDB-compatible APIs without a MongoDB server. The reconciler delegates to the `Datastore` controller with `type: docdb`.

## Specification

### Group + version

`hanzo.ai/v1`, plural `docdbs`, shortname `docdb`.

### Spec fields

Same shape as `Datastore` (HIP-401). Implicitly `type: docdb`. Typical deployment runs FerretDB as the wire-protocol front-end with a `SQL` CR as the storage backend.

### Example CR

```yaml
apiVersion: hanzo.ai/v1
kind: DocDB
metadata:
  name: docdb
  namespace: hanzo
spec:
  type: docdb
  image:
    repository: ghcr.io/hanzoai/docdb
    tag: v1
  replicas: 1
  storage:
    storageClassName: do-block-storage
    size: 1Gi
  env:
    - name: FERRETDB_POSTGRESQL_URL
      value: postgres://hanzo@sql.hanzo.svc:5432/docdb
  credentialsSecret: docdb-credentials
```

### Generated K8s resources

StatefulSet, headless + ClusterIP Services, PVC (small — FerretDB itself is stateless on its own backing Postgres).

### Operator reconciler

`~/work/hanzo/operator/src/controllers/datastore.rs`.

### Related services

- No standalone DocDB CR currently runs in `do-sfo3-hanzo-k8s` (FerretDB is invoked via library by services that need a MongoDB-compatible layer).
- Backing store: `SQL` CR (HIP-502).

## Status

Implemented in `hanzoai/operator` v0.3.0+. CR `docdb` active in cluster.
