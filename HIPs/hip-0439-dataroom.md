---
hip: 0439
title: dataroom
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-439: dataroom

## Abstract

Hanzo Dataroom is the secure document-sharing surface — virtual data room with view tracking, watermarking, access expiry. Parked at replicas=0.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/dataroom:main`)
- Image: `ghcr.io/hanzoai/dataroom:main`
- Current replicas in `do-sfo3-hanzo-k8s`: 0

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: `dataroom.hanzo.ai`
- Internal: `dataroom.hanzo.svc.cluster.local`

## Dependencies

SQL (rooms/permissions), S3 (documents), IAM SSO.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=0 as of 2026-05-18 snapshot.
