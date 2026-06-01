---
hip: 0410
title: LLM CRD
author: Hanzo Platform Team
type: Standards Track
category: Operator
status: Final
created: 2026-05-19
---

# HIP-410: LLM CRD

## Abstract

The `LLM` CRD is the facade Kind for the Hanzo LLM gateway (`hanzoai/gateway`, which historically also lived as `hanzoai/llm`). It proxies 100+ upstream model providers and exposes a unified OpenAI-compatible API. The reconciler delegates to the `Service` controller. See HIP-004 and HIP-044 for design.

## Specification

### Group + version

`hanzo.ai/v1`, plural `llms`, shortname `llm`.

### Spec fields

Same shape as `Service` (HIP-400). Conventionally:

- `image.repository`: `ghcr.io/hanzoai/gateway`
- `ports`: `containerPort: 4000`
- consumes `gateway-secrets` via `envFrom` (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
- has dependencies on `SQL`, `KV`, and `console`

### Example CR

```yaml
apiVersion: hanzo.ai/v1
kind: LLM
metadata:
  name: gateway
  namespace: hanzo
spec:
  image:
    repository: ghcr.io/hanzoai/gateway
    tag: 2.14.1
  replicas: 2
  ports:
    - name: http
      containerPort: 4000
      servicePort: 80
  envFrom:
    - secretRef:
        name: gateway-secrets
  resources:
    requests: { cpu: 500m, memory: 1Gi }
    limits:   { cpu: 2,    memory: 4Gi }
```

### Generated K8s resources

Deployment, Service, optional HPA.

### Operator reconciler

`~/work/hanzo/operator/src/controllers/service.rs` (via `LLM` facade).

### Related services

- HIP-443 (gateway service)
- HIP-0004, HIP-0043, HIP-0044 (LLM gateway, inference, API gateway standards)

## Status

Implemented in `hanzoai/operator` v0.3.0+. CR `gateway` active in cluster.
