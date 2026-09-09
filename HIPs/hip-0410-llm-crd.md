---
hip: "0410"
title: LLM CRD
author: Hanzo Platform Team
type: Standards Track
category: Operator
status: Final
implementation-rust: partial
created: 2026-05-19
---



# HIP-0410: LLM CRD

## Abstract

The `LLM` CRD is the facade Kind for the Hanzo LLM gateway (`hanzoai/gateway`, which historically also lived as `hanzoai/llm`). It proxies 100+ upstream model providers and exposes a unified OpenAI-compatible API. The reconciler delegates to the `Service` controller. See HIP-004 for design.

## Specification

### Group + version

`hanzo.ai/v1`, plural `llms`, shortname `llm`.

### Spec fields

Same shape as `Service` (HIP-400). Conventionally:

- `image.repository`: `oci.hanzo.ai/hanzoai/gateway`
- `ports`: `containerPort: 4000`
- `kmsSecrets` supplies its own machine identity — `IAM_CLIENT_ID` /
  `IAM_CLIENT_SECRET` at `hanzo/gateway/<NAME>@prod` (HIP-0136) — and nothing
  that spends. **It carries no upstream provider key.** An earlier revision of
  this HIP had it consume `gateway-secrets` via `envFrom` with
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and the rest; those keys are in KMS
  custody behind `egress` now, and the gateway asks egress for a call rather than
  holding a credential (HIP-0143).
- depends on `egress`, and on the shared stores per HIP-0144 rather than on
  instances of its own

### Example CR

```yaml
apiVersion: hanzo.ai/v1
kind: LLM
metadata:
  name: gateway
  namespace: hanzo
spec:
  image:
    repository: oci.hanzo.ai/hanzoai/gateway
    tag: 2.14.1
  replicas: 2
  ports:
    - name: http
      containerPort: 4000
      servicePort: 80
  kmsSecrets:
    - name: gateway-env-kms-sync
      secretsPath: /gateway
      keys: [IAM_CLIENT_ID, IAM_CLIENT_SECRET]
      secretName: gateway-env
  resources:
    requests: { cpu: 500m, memory: 1Gi }
    limits:   { cpu: 2,    memory: 4Gi }
```

### Generated K8s resources

Deployment, Service, optional HPA.

### Operator reconciler

`~/work/hanzo/operator/src/controllers/service.rs` (via `LLM` facade).

### Related services

- HIP-0004, HIP-0043 (LLM gateway, inference standards)
- HIP-0143 (egress — where the upstream credentials live)
- HIP-0136 (the path the machine identity is addressed at)
- HIP-0144 (the stores it is a tenant of)

## Status

Implemented in `hanzoai/operator` v0.3.0+. CR `gateway` active in cluster.
