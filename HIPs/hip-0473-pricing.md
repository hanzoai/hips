---
hip: 0473
title: pricing
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-473: pricing

## Abstract

Hanzo Pricing exposes the canonical model + service price list — consumed by Cloud-API, Commerce, Gateway, and the public docs. Single source of truth for $/1K-tokens.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/pricing:latest`)
- Image: `ghcr.io/hanzoai/pricing:latest`
- Current replicas in `do-sfo3-hanzo-k8s`: 2

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/pricing.yaml`

## Ingress

- Public hosts: `pricing.hanzo.ai`
- Internal: `pricing.hanzo.svc.cluster.local`

## Dependencies

SQL (price rows), IAM (admin write).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=2 as of 2026-05-18 snapshot.
