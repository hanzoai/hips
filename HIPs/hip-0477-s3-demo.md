---
hip: 0477
title: s3-demo
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-477: s3-demo

## Abstract

Secondary S3 used as a demo / scratch bucket. Same image as the primary `s3`, separate `S3` CR for namespace isolation.

## CRD Kind

Managed by `kind: S3` ([HIP-405](hip-0405-s3-crd.md)).

## Upstream

Same as s3.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/s3:main`)
- Image: `ghcr.io/hanzoai/s3:main`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/s3-demo.yaml`

## Ingress

- Public hosts: `s3-demo.hanzo.ai`
- Internal: `s3-demo.hanzo.svc.cluster.local`

## Dependencies

Datastore CR.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
