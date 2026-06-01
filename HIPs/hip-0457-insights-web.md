---
hip: 0457
title: insights-web
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-457: insights-web

## Abstract

Insights Web is the analytics UI at `insights.hanzo.ai`: dashboards, funnels, retention, session recording playback. PostHog-style but Hanzo-branded.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Fork of `PostHog/posthog` (MIT).

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/insights:0.0.1`)
- Image: `ghcr.io/hanzoai/insights:0.0.1`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: `insights.hanzo.ai`
- Internal: `insights-web.hanzo.svc.cluster.local`

## Dependencies

Insights-SQL, Insights-KV, Datastore (ClickHouse via shared `clickhouse-events`), Insights-Kafka, IAM SSO.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
