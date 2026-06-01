---
hip: 0475
title: registry
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-475: registry

## Abstract

Hanzo Container Registry (HIP-033) — Docker registry v2 wired to IAM token auth via `iam.hanzo.ai/api/registry/token`. Backs `registry.hanzo.ai`.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Fork of `distribution/distribution` (Apache 2.0), IAM-token-auth patch.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/registry:latest`)
- Image: `ghcr.io/hanzoai/registry:latest`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/registry.yaml`

## Ingress

- Public hosts: `registry.hanzo.ai`
- Internal: `registry.hanzo.svc.cluster.local`

## Dependencies

IAM (token signing), S3 (blobs).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
