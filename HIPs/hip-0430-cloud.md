---
hip: 0430
title: cloud
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-430: cloud

## Abstract

Hanzo Cloud marketing site at `cloud.hanzo.ai`. Next.js static + ISR. Showcases the AI cloud product (HIP-037).

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/cloud-site`)
- Image: `ghcr.io/hanzoai/cloud-site`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: `cloud.hanzo.ai`
- Internal: `cloud.hanzo.svc.cluster.local`

## Dependencies

No runtime deps.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
