---
hip: 0464
title: neon-compute
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-464: neon-compute

## Abstract

Neon Postgres compute proxy — disposable per-tenant Postgres compute layer for Hanzo PaaS DB feature. Parked at replicas=0.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Upstream `neondatabase/neon` (Apache 2.0).

## Source

- Repo: derived from the image (`python:3.12-alpine`)
- Image: `python:3.12-alpine`
- Current replicas in `do-sfo3-hanzo-k8s`: 0

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: internal only
- Internal: `neon-compute.hanzo.svc.cluster.local`

## Dependencies

Neon-Pageserver, Neon-Safekeeper, S3.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=0 as of 2026-05-18 snapshot.
