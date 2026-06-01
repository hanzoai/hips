---
hip: 0405
title: S3 CRD
author: Hanzo Platform Team
type: Standards Track
category: Operator
status: Final
created: 2026-05-19
---

# HIP-405: S3 CRD

## Abstract

The `S3` CRD is the facade Kind for the Hanzo object storage workload (`hanzoai/storage`, a MinIO fork). It exposes the S3 API and is used as the universal blob storage layer. The reconciler delegates to the `Datastore` controller with `type: minio`.

## Specification

### Group + version

`hanzo.ai/v1`, plural `s3s`, shortname `s3`.

### Spec fields

Same shape as `Datastore` (HIP-401). Implicitly `type: minio`.

### Example CR

```yaml
apiVersion: hanzo.ai/v1
kind: S3
metadata:
  name: s3
  namespace: hanzo
spec:
  type: minio
  image:
    repository: ghcr.io/hanzoai/s3
    tag: 1.0.1
  replicas: 1
  storage:
    storageClassName: do-block-storage
    size: 100Gi
    retentionPolicy: Retain
  env:
    - name: MINIO_ROOT_USER
      valueFrom:
        secretKeyRef:
          name: s3-credentials
          key: accessKey
    - name: MINIO_ROOT_PASSWORD
      valueFrom:
        secretKeyRef:
          name: s3-credentials
          key: secretKey
  ports:
    - name: api
      containerPort: 9000
      servicePort: 9000
    - name: console
      containerPort: 9001
      servicePort: 9001
```

### Generated K8s resources

StatefulSet, headless + ClusterIP Services, PVC.

### Operator reconciler

`~/work/hanzo/operator/src/controllers/datastore.rs`.

### Related services

- HIP-476 (s3 service)
- HIP-477 (s3-demo)
- Consumers: dataroom, captable, Hanzo storage CDN, backup targets.

## Status

Implemented in `hanzoai/operator` v0.3.0+. CRs `s3` and `s3-demo` active in cluster.
