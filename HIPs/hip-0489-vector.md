---
hip: 0489
title: vector
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-489: vector

## Abstract

Hanzo Vector (HIP-042) — vector database service backing Search, RAG-API, and Chat memory. Qdrant-compatible API.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Fork of `qdrant/qdrant` (Apache 2.0).

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/vector:latest`)
- Image: `ghcr.io/hanzoai/vector:latest`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: internal only
- Internal: `vector.hanzo.svc.cluster.local`

## Dependencies

PVC (vector store).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
