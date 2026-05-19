---
hip: 0435
title: commerce-site
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-435: commerce-site

## Abstract

Public-facing storefront UI for Hanzo Commerce. Next.js, ISR, talks to Commerce API.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/commerce-site:0.0.1`)
- Image: `ghcr.io/hanzoai/commerce-site:0.0.1`
- Current replicas in `do-sfo3-hanzo-k8s`: 2

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: `shop.hanzo.ai`
- Internal: `commerce-site.hanzo.svc.cluster.local`

## Dependencies

Commerce API.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=2 as of 2026-05-18 snapshot.
