---
hip: 0500
title: neon-pageserver
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-500: neon-pageserver

## Abstract

Neon Postgres pageserver — handles page reads for the Neon multitenant Postgres layer.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Upstream `neondatabase/neon` (Apache 2.0).

## Source

- Repo: derived from the image (`ghcr.io/neondatabase/neon:latest`)
- Image: `ghcr.io/neondatabase/neon:latest`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: internal only
- Internal: `neon-pageserver.hanzo.svc.cluster.local`

## Dependencies

S3 (cold storage), Neon-Safekeeper.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
