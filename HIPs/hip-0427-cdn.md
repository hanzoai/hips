---
hip: 0427
title: cdn
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-427: cdn

## Abstract

Hanzo CDN serves static assets — images, fonts, JS bundles — for the public marketing sites. Backed by the `hanzoai/static` server with edge-cache-friendly headers.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/static:v0.3.0`)
- Image: `ghcr.io/hanzoai/static:v0.3.0`
- Current replicas in `do-sfo3-hanzo-k8s`: 2

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: `cdn.hanzo.ai`
- Internal: `cdn.hanzo.svc.cluster.local`

## Dependencies

S3 (asset bucket) read-through.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=2 as of 2026-05-18 snapshot.
