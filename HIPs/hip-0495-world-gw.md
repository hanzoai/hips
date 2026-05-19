---
hip: 0495
title: world-gw
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-495: world-gw

## Abstract

Hanzo World gateway — read-only API tier in front of `world`. Parked at replicas=0.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/world-zap:latest`)
- Image: `ghcr.io/hanzoai/world-zap:latest`
- Current replicas in `do-sfo3-hanzo-k8s`: 0

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: internal only
- Internal: `world-gw.hanzo.svc.cluster.local`

## Dependencies

World.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=0 as of 2026-05-18 snapshot.
