---
hip: 0442
title: flow-site
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-442: flow-site

## Abstract

Hanzo Flow marketing site at `flow.hanzo.ai/site`. Next.js static.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/flow-site`)
- Image: `ghcr.io/hanzoai/flow-site`
- Current replicas in `do-sfo3-hanzo-k8s`: 2

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: internal only
- Internal: `flow-site.hanzo.svc.cluster.local`

## Dependencies

No runtime deps.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=2 as of 2026-05-18 snapshot.
