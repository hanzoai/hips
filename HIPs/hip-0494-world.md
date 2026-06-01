---
hip: 0494
title: world
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-494: world

## Abstract

Hanzo World is the geospatial/event-firehose service — global event index used by news/feed surfaces and the Hanzo bot for context grounding.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/world:<sha>`)
- Image: `ghcr.io/hanzoai/world:<sha>`
- Current replicas in `do-sfo3-hanzo-k8s`: 2

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: `world.hanzo.ai`
- Internal: `world.hanzo.svc.cluster.local`

## Dependencies

Stream, Vector (geo embeddings), SQL.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=2 as of 2026-05-18 snapshot.
