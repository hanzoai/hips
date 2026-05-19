---
hip: 0503
title: vmsingle-victoria-metrics-single-server
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-503: vmsingle-victoria-metrics-single-server

## Abstract

Single-instance VictoriaMetrics — Prometheus-compatible TSDB. Scrape targets for the cluster.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Fork of `VictoriaMetrics/VictoriaMetrics` (Apache 2.0).

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/metrics:latest`)
- Image: `ghcr.io/hanzoai/metrics:latest`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: internal only
- Internal: `vmsingle-victoria-metrics-single-server.hanzo.svc.cluster.local`

## Dependencies

PVC (TSDB), Grafana (datasource).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
