---
hip: 0426
title: captable
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-426: captable

## Abstract

Hanzo CapTable is the equity/captable management surface — issued shares, option grants, vesting, and SAFE notes. Currently parked at replicas=0 awaiting data migration.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/captable:<sha>`)
- Image: `ghcr.io/hanzoai/captable:<sha>`
- Current replicas in `do-sfo3-hanzo-k8s`: 0

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: `captable.hanzo.ai`
- Internal: `captable.hanzo.svc.cluster.local`

## Dependencies

SQL (cap-table records), IAM, S3 (signed PDFs).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=0 as of 2026-05-18 snapshot.
