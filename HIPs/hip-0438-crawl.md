---
hip: 0438
title: crawl
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-438: crawl

## Abstract

Hanzo Crawl is the web-crawling service used by RAG pipelines and search indexers — fetches pages, extracts main content, normalises. Parked at replicas=0 awaiting GHCR semver tag.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Fork of `firecrawl-ai/firecrawl` (MIT).

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/crawl:0.0.1`)
- Image: `ghcr.io/hanzoai/crawl:0.0.1`
- Current replicas in `do-sfo3-hanzo-k8s`: 0

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: `crawl.hanzo.ai`
- Internal: `crawl.hanzo.svc.cluster.local`

## Dependencies

KV (queue), S3 (page snapshots).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=0 as of 2026-05-18 snapshot.
