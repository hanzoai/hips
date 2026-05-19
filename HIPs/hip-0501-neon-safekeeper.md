---
hip: 0501
title: neon-safekeeper
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-501: neon-safekeeper

## Abstract

Neon Postgres safekeepers — 3-replica WAL durability layer for the Neon Postgres feature.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Upstream `neondatabase/neon` (Apache 2.0).

## Source

- Repo: derived from the image (`ghcr.io/neondatabase/neon:latest`)
- Image: `ghcr.io/neondatabase/neon:latest`
- Current replicas in `do-sfo3-hanzo-k8s`: 3

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: internal only
- Internal: `neon-safekeeper.hanzo.svc.cluster.local`

## Dependencies

PVC (WAL), Neon-Pageserver.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=3 as of 2026-05-18 snapshot.
