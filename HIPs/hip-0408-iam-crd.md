---
hip: 0408
title: IAM CRD
author: Hanzo Platform Team
type: Standards Track
category: Operator
status: Final
created: 2026-05-19
---

# HIP-408: IAM CRD

## Abstract

The `IAM` CRD is the facade Kind for the Hanzo identity service (`hanzoai/iam`). It is structurally a `Service` and delegates to the `Service` reconciler. The Kind exists so `kubectl get iam` yields the canonical identity workload directly rather than searching among generic services. See HIP-026 for the IAM design.

## Specification

### Group + version

`hanzo.ai/v1`, plural `iams`, shortname `iam`.

### Spec fields

Same shape as `Service` (HIP-400). Conventionally:

- `image.repository`: `ghcr.io/hanzoai/iam`
- `ports`: `containerPort: 8000`
- mounts the `registry-signing-key` secret for registry token issuance
- consumes `iam-secrets` via `envFrom`

### Example CR

```yaml
apiVersion: hanzo.ai/v1
kind: IAM
metadata:
  name: iam
  namespace: hanzo
spec:
  image:
    repository: ghcr.io/hanzoai/iam
    tag: 2.381.0
  replicas: 2
  ports:
    - name: http
      containerPort: 8000
      servicePort: 80
  envFrom:
    - secretRef:
        name: iam-secrets
  readinessProbe:
    path: /api/health
    port: 8000
```

### Generated K8s resources

Deployment, Service, optional Ingress (in practice Ingress is managed separately because IAM serves multi-tenant hostnames — `hanzo.id`, `lux.id`, `zoo.id`, `pars.id`, `id.hanzo.ai`, `id.lux.network`, `id.pars.network`, `id.ad.nexus`).

### Operator reconciler

`~/work/hanzo/operator/src/controllers/service.rs` (via `IAM` facade in `crd.rs`).

### Related services

- HIP-451 (iam service)
- HIP-0026 (IAM standard)
- Consumers: every authenticated service in the cluster.

## Status

Implemented in `hanzoai/operator` v0.3.0+. CR `iam` active in cluster.
