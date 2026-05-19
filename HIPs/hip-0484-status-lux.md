---
hip: 0484
title: status-lux
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-484: status-lux

## Abstract

Status surface for Lux Network — same image, different brand config, served at `status.lux.network`.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Same as status.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/status:main`)
- Image: `ghcr.io/hanzoai/status:main`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: `status.lux.network`
- Internal: `status-lux.hanzo.svc.cluster.local`

## Dependencies

Mirror of status with lux-k8s targets.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
