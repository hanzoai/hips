---
hip: 0453
title: insights-kafka
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-453: insights-kafka

## Abstract

Kafka-protocol stream broker used by Insights for event buffering before ClickHouse ingest. Powered by `hanzoai/stream` (HIP-030).

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/stream:latest`)
- Image: `ghcr.io/hanzoai/stream:latest`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: internal only
- Internal: `insights-kafka.hanzo.svc.cluster.local`

## Dependencies

PVC (log dirs), KV (coordination).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
