---
hip: 0412
title: Gateway CRD
author: Hanzo Platform Team
type: Standards Track
category: Operator
status: Final
created: 2026-05-19
---

# HIP-412: Gateway CRD

## Abstract

The `Gateway` CRD describes a KrakenD-style API gateway (`hanzoai/gateway`): a set of declarative routes that compose multiple backend services into a single public API surface (`api.hanzo.ai`). Each route declares prefix, backend Service, methods, optional rate limits, and an auth policy. Unlike `Ingress`, which terminates TLS and routes by hostname, `Gateway` does API composition: header injection (X-User-Id, X-Org-Id from validated JWT), rate limiting, and protocol translation.

## Specification

### Group + version

`hanzo.ai/v1`, plural `gateways`, shortname `hgw`.

### Spec fields

| Field | Type | Description |
|---|---|---|
| `image` | ImageSpec | `hanzoai/gateway` |
| `replicas` | int | replica count |
| `routes` | []GatewayRoute | prefix, backend, methods, stripPrefix, rateLimit, authPolicy |
| `rateLimits` | []RateLimit | named rate limit policies |
| `authPolicies` | []AuthPolicy | named auth policies (IAM JWT validation) |
| `ingress` | IngressSpec | optional Ingress (api.hanzo.ai) |
| `resources` | ResourceRequirements | requests/limits |

### Example CR

```yaml
apiVersion: hanzo.ai/v1
kind: Gateway
metadata:
  name: gateway
  namespace: hanzo
spec:
  image:
    repository: ghcr.io/hanzoai/gateway
    tag: 2.14.1
  replicas: 2
  routes:
    - prefix: /v1/chat
      backend: http://chat.hanzo.svc:80
      methods: [POST]
      authPolicy: iam-jwt
      rateLimit: per-user
    - prefix: /v1/models
      backend: http://cloud-api.hanzo.svc:80
      methods: [GET]
  rateLimits:
    - name: per-user
      maxRate: 100
      every: 1m
  authPolicies:
    - name: iam-jwt
      type: jwt
      iamEndpoint: https://hanzo.id
      jwksUrl: https://hanzo.id/.well-known/jwks
```

### Generated K8s resources

- Deployment (KrakenD gateway)
- ConfigMap (`krakend.json` rendered from routes)
- ClusterIP Service
- Optional Ingress (api.hanzo.ai)

### Operator reconciler

`~/work/hanzo/operator/src/controllers/gateway.rs`.

### Related services

- HIP-443 (gateway service)
- HIP-0044 (API gateway standard)

## Status

Implemented in `hanzoai/operator` v0.3.0+. Backs `api.hanzo.ai`.
