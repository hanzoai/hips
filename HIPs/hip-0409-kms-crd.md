---
hip: 0409
title: KMS CRD
author: Hanzo Platform Team
type: Standards Track
category: Operator
status: Final
created: 2026-05-19
---

# HIP-409: KMS CRD

## Abstract

The `KMS` CRD is the facade Kind for the Hanzo secrets manager (`hanzoai/kms`). It is a Service facade with a thicker reconciler: it also produces `KMSSecret` cross-references and Universal-Auth credentials. See HIP-027 for the KMS design.

## Specification

### Group + version

`hanzo.ai/v1`, plural `kmsapps`, shortname `kms`.

### Spec fields

Same shape as `Service` (HIP-400). Conventionally:

- `image.repository`: `ghcr.io/hanzoai/kms`
- `ports`: `containerPort: 8080` (HTTP), `containerPort: 9000` (metrics)
- mounts `kms-postgres` secret for backing DB
- mounts `kms-encryption-key` secret for at-rest encryption

### Example CR

```yaml
apiVersion: hanzo.ai/v1
kind: KMS
metadata:
  name: kms
  namespace: hanzo
spec:
  image:
    repository: ghcr.io/hanzoai/kms
    tag: v2.4.1
  replicas: 2
  ports:
    - name: http
      containerPort: 8080
      servicePort: 80
  envFrom:
    - secretRef:
        name: kms-secrets
  readinessProbe:
    path: /api/status
    port: 8080
```

### Generated K8s resources

Deployment, Service. KMS itself exposes a CRD (`KMSSecret`) that any other Service can reference via `spec.kmsSecrets`.

### Operator reconciler

`~/work/hanzo/operator/src/controllers/service.rs` (via `KMS` facade).

### Related services

- HIP-459 (kms service)
- HIP-0027 (KMS standard)
- All services depend on KMS for secret resolution.

## Status

Implemented in `hanzoai/operator` v0.3.0+. CR `kms` active in cluster.
