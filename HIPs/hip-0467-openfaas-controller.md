---
hip: 0467
title: openfaas-controller
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-467: openfaas-controller

## Abstract

OpenFaaS controller — runs serverless functions in the cluster (HIP-060). Hanzo deployment uses OpenFaaS to host short-lived python/node functions invoked by Auto/Flow.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Upstream `openfaas/faas-netes` (MIT).

## Source

- Repo: derived from the image (`ghcr.io/openfaas/faas-netes:latest`)
- Image: `ghcr.io/openfaas/faas-netes:latest`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: internal only
- Internal: `openfaas-controller.hanzo.svc.cluster.local`

## Dependencies

K8s API (Function CRD).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
