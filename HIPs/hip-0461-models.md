---
hip: 0461
title: models
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-461: models

## Abstract

Hanzo Models is the model registry/catalog (HIP-039): the canonical list of Zen models + alias mappings consumed by Cloud-API and Gateway.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/models:latest`)
- Image: `ghcr.io/hanzoai/models:latest`
- Current replicas in `do-sfo3-hanzo-k8s`: 2

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/models.yaml`

## Ingress

- Public hosts: `models.hanzo.ai`
- Internal: `models.hanzo.svc.cluster.local`

## Dependencies

SQL (model rows), S3 (weights / cards).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=2 as of 2026-05-18 snapshot.
