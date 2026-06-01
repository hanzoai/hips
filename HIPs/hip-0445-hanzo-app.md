---
hip: 0445
title: hanzo-app
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-445: hanzo-app

## Abstract

Hanzo App is the flagship product surface at `hanzo.app`: the consumer/dev landing page that fronts onboarding, chat handoff, and the cross-product launcher.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/app:0.0.1`)
- Image: `ghcr.io/hanzoai/app:0.0.1`
- Current replicas in `do-sfo3-hanzo-k8s`: 2

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/hanzo-app.yaml`

## Ingress

- Public hosts: `hanzo.app`, `app.hanzo.ai`
- Internal: `hanzo-app.hanzo.svc.cluster.local`

## Dependencies

IAM SSO, Commerce, Cloud-API.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=2 as of 2026-05-18 snapshot.
