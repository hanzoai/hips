---
hip: 0429
title: chat-meilisearch
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-429: chat-meilisearch

## Abstract

Meilisearch instance dedicated to the Chat thread/message search index. Separate from Hanzo Search (HIP-012) which is a different surface.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Upstream `meilisearch/meilisearch` (MIT).

## Source

- Repo: derived from the image (`getmeili/meilisearch:v1.33.0`)
- Image: `getmeili/meilisearch:v1.33.0`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: internal only
- Internal: `chat-meilisearch.hanzo.svc.cluster.local`

## Dependencies

KMS for master key.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
