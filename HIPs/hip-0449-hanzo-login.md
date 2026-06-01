---
hip: 0449
title: hanzo-login
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-449: hanzo-login

## Abstract

Hanzo Login (`hanzoai/id`) is the custom login UI that fronts IAM. Multi-tenant: resolves IAM app/org dynamically via `/api/get-app-login` from the request hostname. Forkable for per-org branding.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/login:latest`)
- Image: `ghcr.io/hanzoai/login:latest`
- Current replicas in `do-sfo3-hanzo-k8s`: 2

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/hanzo-login.yaml`

## Ingress

- Public hosts: `hanzo.id`, `lux.id`, `zoo.id`, `pars.id`, `id.ad.nexus`
- Internal: `hanzo-login.hanzo.svc.cluster.local`

## Dependencies

IAM (back-end).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=2 as of 2026-05-18 snapshot.
