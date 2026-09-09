---
hip: "0409"
title: KMS CRD
author: Hanzo Platform Team
type: Standards Track
category: Operator
status: Final
implementation-rust: partial
created: 2026-05-19
---



# HIP-0409: KMS CRD

## Abstract

The `KMS` CRD is the facade Kind for the Hanzo secrets manager (`luxfi/kms`; `hanzoai/kms` is archived). It is a Service facade with a thicker reconciler: it also produces `KMSSecret` cross-references and Universal-Auth credentials. See HIP-027 for the KMS design.

## Specification

### Group + version

`hanzo.ai/v1`, plural `kmsapps`, shortname `kms`.

### Spec fields

Same shape as `Service` (HIP-400). Conventionally:

- `image.repository`: `ghcr.io/luxfi/kms`
- `ports`: `containerPort: 8080` (HTTP), `containerPort: 9000` (metrics)
- mounts `kms-encryption-key` for at-rest encryption — the bootstrap set, and
  deliberately not a database connection string: the store keeps per-org
  encrypted files (HIP-1134), so there is no separate database to bootstrap
  (HIP-0027 §KMS's Own Secrets, HIP-0144)

### Example CR

```yaml
apiVersion: hanzo.ai/v1
kind: KMS
metadata:
  name: kms
  namespace: hanzo
spec:
  image:
    repository: ghcr.io/luxfi/kms
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
    path: /healthz
    port: 8080
```

### Generated K8s resources

Deployment, Service. KMS itself exposes a CRD (`KMSSecret`) that any other Service can reference via `spec.kmsSecrets`.

### Operator reconciler

`~/work/hanzo/operator/src/controllers/service.rs` (via `KMS` facade).

### Related services

- HIP-0027 (KMS standard)
- All services depend on KMS for secret resolution.

## Status

Implemented in `hanzoai/operator` v0.3.0+. CR `kms` active in cluster.
