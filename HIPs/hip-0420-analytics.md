---
hip: 0420
title: analytics
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-420: analytics

## Abstract

Hanzo Analytics is the web/product analytics service: events, pageviews, sessions, funnels. PostHog-style ingest with the Hanzo brand and IAM SSO. Powers `analytics.hanzo.ai`.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Fork of `posthog/posthog` (MIT).

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/analytics:3.0.4`)
- Image: `ghcr.io/hanzoai/analytics:3.0.4`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/analytics.yaml`

## Ingress

- Public hosts: `analytics.hanzo.ai`
- Internal: `analytics.hanzo.svc.cluster.local`

## Dependencies

SQL (events store), KV (cache), IAM app `app-analytics`, KMS for posthog secrets, S3 for plugin artifacts.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
