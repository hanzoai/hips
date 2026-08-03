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

The `S3` CRD is the facade Kind for the Hanzo object storage workload
(`hanzoai/s3` — SeaweedFS-derived, Apache-2.0). It exposes the S3 API and is
used as the universal blob storage layer. The reconciler delegates to the
`Datastore` controller with the `minio` engine discriminator.

`minio` here is a **retained identity string**, not a product: it is the
`app.kubernetes.io/component` label and the default service-port name, held
byte-identical so an adopted StatefulSet does not roll. Hanzo S3 has never been
a MinIO fork. Renaming the discriminator is an `hanzoai/operator` change with a
fleet rollout attached, tracked separately from this spec.

## Specification

### Group + version

`hanzo.ai/v1`, plural `s3s`, shortname `s3`.

### Spec fields

Same shape as `Datastore` (HIP-401).

### Example CR

```yaml
apiVersion: hanzo.ai/v1
kind: S3
metadata:
  name: s3
  namespace: hanzo
spec:
  image:
    repository: ghcr.io/hanzoai/s3
    tag: 1.0.1
  replicas: 1
  storage:
    storageClassName: do-block-storage
    size: 100Gi
    retentionPolicy: Retain
  env:
    - name: AWS_ACCESS_KEY_ID
      valueFrom:
        secretKeyRef:
          name: s3-credentials
          key: accessKey
    - name: AWS_SECRET_ACCESS_KEY
      valueFrom:
        secretKeyRef:
          name: s3-credentials
          key: secretKey
  ports:
    - name: api
      containerPort: 9000
      servicePort: 9000
```

The Kind is the discriminator — there is no `spec.type` field. `hanzoai/s3`
reads `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` and registers a static admin
identity from them; the standard AWS names are what every S3 client already
understands, so one pair of variables serves both server and client. There is no
web console, so nothing listens on 9001 — 9000 is the S3 API and the only port a
consumer needs. Internally the workload also serves 8888 (filer), 9333 (master)
and 8080 (volume); none are exposed by this CR.

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
