---
hip: 0478
title: search
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-478: search

## Abstract

Hanzo Search (HIP-012) — AI-powered generative search at `search.hanzo.ai`. Crawl-API ingests, Embeddings indexes, Gateway answers, results returned with citations.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/search:1.37.0`)
- Image: `ghcr.io/hanzoai/search:1.37.0`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: `search.hanzo.ai`
- Internal: `search.hanzo.svc.cluster.local`

## Dependencies

SQL, Vector (HIP-042), Embeddings, Gateway, IAM SSO.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
