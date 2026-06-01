---
hip: 0455
title: insights-plugin
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-455: insights-plugin

## Abstract

Insights Plugin Server hosts user-supplied event-transformation plugins (TypeScript). Parked at replicas=0.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/insights-plugin:latest`)
- Image: `ghcr.io/hanzoai/insights-plugin:latest`
- Current replicas in `do-sfo3-hanzo-k8s`: 0

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: internal only
- Internal: `insights-plugin.hanzo.svc.cluster.local`

## Dependencies

Insights-Kafka, Insights-SQL.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=0 as of 2026-05-18 snapshot.
