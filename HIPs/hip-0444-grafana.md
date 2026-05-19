---
hip: 0444
title: grafana
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-444: grafana

## Abstract

Grafana dashboards instance for ops visibility. Configured against VictoriaMetrics (`vmsingle`) and Prometheus-compatible scrape targets across the cluster.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Upstream `grafana/grafana` (AGPL).

## Source

- Repo: derived from the image (`grafana/grafana:11.5.2`)
- Image: `grafana/grafana:11.5.2`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: `dashboards.hanzo.ai`
- Internal: `grafana.hanzo.svc.cluster.local`

## Dependencies

vmsingle (datasource), IAM (OIDC).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
