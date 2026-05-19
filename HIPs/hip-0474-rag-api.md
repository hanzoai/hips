---
hip: 0474
title: rag-api
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-474: rag-api

## Abstract

Hanzo RAG-API is the retrieval-augmented-generation backend used by Chat — accepts file uploads, chunks, embeds, indexes, and serves /retrieve queries.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Fork of `danny-avila/rag_api` (MIT).

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/chat-rag-api:0.7.8-hanzo`)
- Image: `ghcr.io/hanzoai/chat-rag-api:0.7.8-hanzo`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/rag-api.yaml`

## Ingress

- Public hosts: internal only
- Internal: `rag-api.hanzo.svc.cluster.local`

## Dependencies

Embeddings (HIP-046), KV (vector store config), S3 (files), SQL (chunks).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
