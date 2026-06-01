---
hip: 0411
title: Ingress CRD
author: Hanzo Platform Team
type: Standards Track
category: Operator
status: Final
created: 2026-05-19
---

# HIP-411: Ingress CRD

## Abstract

The `Ingress` CRD describes a set of domains + routes that map to in-cluster Services and emits one or more native Kubernetes `Ingress` resources with cert-manager-issued TLS certs. It also optionally provisions a DaemonSet of `hanzoai/ingress` Pods (Cloudflare-tunneled ingress) for edge termination outside the cluster.

## Specification

### Group + version

`hanzo.ai/v1`, plural `ingresses`, shortname `hing`.

### Spec fields

| Field | Type | Description |
|---|---|---|
| `domains` | []DomainConfig | { domain, routes[], tls } |
| `routes` | []IngressRoute | path, pathType, serviceName, servicePort |
| `ingressClassName` | string | which IngressClass to bind to |
| `clusterIssuer` | string | cert-manager ClusterIssuer name |
| `ingressDaemonSet` | IngressDaemonSetSpec | optional `hanzoai/ingress` daemon |

### Example CR

```yaml
apiVersion: hanzo.ai/v1
kind: Ingress
metadata:
  name: hanzo-ingress
  namespace: hanzo
spec:
  ingressClassName: nginx
  clusterIssuer: letsencrypt-prod
  domains:
    - domain: chat.hanzo.ai
      tls: true
      routes:
        - path: /
          pathType: Prefix
          serviceName: chat
          servicePort: 80
    - domain: api.hanzo.ai
      tls: true
      routes:
        - path: /
          pathType: Prefix
          serviceName: gateway
          servicePort: 80
```

### Generated K8s resources

- One native `networking.k8s.io/v1 Ingress` per domain
- `Certificate` (cert-manager) per TLS-enabled domain
- Optional DaemonSet for `hanzoai/ingress`

### Operator reconciler

`~/work/hanzo/operator/src/controllers/ingress.rs`.

### Related services

- HIP-448 (hanzo-ingress service)
- HIP-0068 (Ingress standard)

## Status

Implemented in `hanzoai/operator` v0.3.0+. Used for multi-tenant TLS termination on the cluster's nginx-ingress.
