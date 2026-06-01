---
hip: 0469
title: openfaas-queue-worker
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-469: openfaas-queue-worker

## Abstract

OpenFaaS queue worker — pulls async-mode invocations off NATS and dispatches them. Parked at replicas=0 awaiting backlog.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Upstream `openfaas/queue-worker` (MIT).

## Source

- Repo: derived from the image (`ghcr.io/openfaas/queue-worker:latest`)
- Image: `ghcr.io/openfaas/queue-worker:latest`
- Current replicas in `do-sfo3-hanzo-k8s`: 0

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: internal only
- Internal: `openfaas-queue-worker.hanzo.svc.cluster.local`

## Dependencies

NATS, OpenFaaS-Gateway.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=0 as of 2026-05-18 snapshot.
