---
hip: 0471
title: otel-collector
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-471: otel-collector

## Abstract

OpenTelemetry Collector — the cluster's OTLP gateway. Routes traces to o11y, metrics to vmsingle, logs to Vector. HIP-031.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Fork of `open-telemetry/opentelemetry-collector-contrib` (Apache 2.0).

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/otel-collector:main`)
- Image: `ghcr.io/hanzoai/otel-collector:main`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: internal only
- Internal: `otel-collector.hanzo.svc.cluster.local`

## Dependencies

o11y, vmsingle, vector.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
