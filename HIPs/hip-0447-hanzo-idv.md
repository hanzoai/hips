---
hip: 0447
title: hanzo-idv
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-447: hanzo-idv

## Abstract

Hanzo IDV is the identity verification service: KYC/AML document upload, OCR, face match, sanctions screening. Used by Commerce and Hanzo Cloud for verified-account tiers.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/idv:1.0.2`)
- Image: `ghcr.io/hanzoai/idv:1.0.2`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: `idv.hanzo.ai`
- Internal: `hanzo-idv.hanzo.svc.cluster.local`

## Dependencies

S3 (documents), SQL (verifications), upstream KYC providers.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
