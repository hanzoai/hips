---
hip: 0485
title: stream
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-485: stream

## Abstract

Hanzo Stream is the event streaming backbone (HIP-030) — Kafka-protocol-compatible broker used by Insights, Console, Analytics, and Auto.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native (Kafka-compatible), no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/stream:latest`)
- Image: `ghcr.io/hanzoai/stream:latest`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/stream.yaml`

## Ingress

- Public hosts: internal only
- Internal: `stream.hanzo.svc.cluster.local`

## Dependencies

PVC (log dirs).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
