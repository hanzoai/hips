---
hip: 0481
title: sentry-worker
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-481: sentry-worker

## Abstract

Sentry async worker. Parked.

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

- Public hosts: internal only
- Internal: `sentry-worker.hanzo.svc.cluster.local`

## Dependencies

Sentry-Web.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=0 as of 2026-05-18 snapshot.
