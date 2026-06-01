---
hip: 0406
title: DNS CRD
author: Hanzo Platform Team
type: Standards Track
category: Operator
status: Final
created: 2026-05-19
---

# HIP-406: DNS CRD

## Abstract

The `DNS` CRD models DNS zone serving and management. It deploys CoreDNS as the authoritative + cluster nameserver, optionally syncs zones to Cloudflare, and reads/writes zone records from a backing database (`SQL` CR). The CRD encapsulates a complete DNS stack rather than individual records.

## Specification

### Group + version

`hanzo.ai/v1`, plural `dns`, shortname `hdns`.

### Spec fields

| Field | Type | Description |
|---|---|---|
| `zones` | []DNSZoneSpec | name + optional Cloudflare zone ID |
| `coredns` | CoreDNSSpec | image, replicas, api/dns ports, resources |
| `cloudflare` | CloudflareSyncSpec | enabled, credentials ref |
| `database` | DatabaseSpec | enabled, credentials ref, syncInterval |
| `oidc` | OIDCSpec | enabled, issuer, audience |
| `ingress` | IngressSpec | management API ingress |

### Example CR

```yaml
apiVersion: hanzo.ai/v1
kind: DNS
metadata:
  name: dns
  namespace: hanzo
spec:
  zones:
    - name: hanzo.ai
    - name: hanzo.id
  coredns:
    image: ghcr.io/hanzoai/dns:0.10.0
    replicas: 2
    apiPort: 8053
    dnsPort: 53
  cloudflare:
    enabled: true
    credentialsRef:
      name: cloudflare-credentials
  database:
    enabled: true
    credentialsRef:
      name: dns-db
    syncInterval: 30s
  oidc:
    enabled: true
    issuer: https://hanzo.id
    audience: app-dns
```

### Generated K8s resources

- Deployment (CoreDNS, multi-replica)
- ClusterIP Service (port 53 UDP/TCP + management API)
- Optional Ingress for the management API
- Optional CronJob for Cloudflare reconciliation

### Operator reconciler

`~/work/hanzo/operator/src/controllers/dns.rs`.

### Related services

- HIP-440 (dns service)
- HIP-0049 (DNS Service Standard) — overarching design doc.

## Status

Implemented in `hanzoai/operator` v0.3.0+. CR `dns` active in cluster.
