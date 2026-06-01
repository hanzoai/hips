---
hip: 0458
title: insights-worker
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-458: insights-worker

## Abstract

Insights Worker is the async job tier — handles cohort calculation, scheduled exports, plugin executions. Parked at replicas=0.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Same as insights-web.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/insights:0.0.1`)
- Image: `ghcr.io/hanzoai/insights:0.0.1`
- Current replicas in `do-sfo3-hanzo-k8s`: 0

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: internal only
- Internal: `insights-worker.hanzo.svc.cluster.local`

## Dependencies

Insights-SQL, Insights-Kafka.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=0 as of 2026-05-18 snapshot.
