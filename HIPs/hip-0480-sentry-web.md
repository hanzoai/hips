---
hip: 0480
title: sentry-web
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-480: sentry-web

## Abstract

Sentry web UI — error tracking for legacy apps. Parked.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Upstream `getsentry/sentry` (FSL).

## Source

- Repo: derived from the image (`getsentry/sentry:24.2.0`)
- Image: `getsentry/sentry:24.2.0`
- Current replicas in `do-sfo3-hanzo-k8s`: 0

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: `sentry.hanzo.ai`
- Internal: `sentry-web.hanzo.svc.cluster.local`

## Dependencies

SQL, KV, ClickHouse via Datastore.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=0 as of 2026-05-18 snapshot.
