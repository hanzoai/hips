---
hip: 0462
title: monitor
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-462: monitor

## Abstract

PaaS Studio gitops monitor — watches deployment status across Hanzo PaaS (Dokploy fork). Parked at replicas=0.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/gitops-monitor:0.0.1`)
- Image: `ghcr.io/hanzoai/gitops-monitor:0.0.1`
- Current replicas in `do-sfo3-hanzo-k8s`: 0

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: internal only
- Internal: `monitor.hanzo.svc.cluster.local`

## Dependencies

PaaS API.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=0 as of 2026-05-18 snapshot.
