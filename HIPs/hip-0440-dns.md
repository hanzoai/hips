---
hip: 0440
title: dns
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-440: dns

## Abstract

Hanzo DNS service (HIP-049): authoritative DNS for hanzo-operated zones + CoreDNS-style cluster nameserver, with optional Cloudflare zone-sync.

## CRD Kind

Managed by `kind: DNS` ([HIP-406](hip-0406-dns-crd.md)).

## Upstream

Hanzo-native (CoreDNS-based), no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/dns:0.10.0`)
- Image: `ghcr.io/hanzoai/dns:0.10.0`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: `dns.hanzo.ai`
- Internal: `dns.hanzo.svc.cluster.local`

## Dependencies

SQL (records), KMS (Cloudflare token), IAM (OIDC).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
