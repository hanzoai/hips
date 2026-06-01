---
hip: 0499
title: nats
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-499: nats

## Abstract

NATS JetStream broker (HIP-056) — message queue + pub/sub backbone for OpenFaaS, Auto, Flow.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Fork of `nats-io/nats-server` (Apache 2.0).

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/pubsub:latest`)
- Image: `ghcr.io/hanzoai/pubsub:latest`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: internal only
- Internal: `nats.hanzo.svc.cluster.local`

## Dependencies

PVC (jetstream files).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
