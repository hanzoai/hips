---
hip: 0423
title: bot-docs
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-423: bot-docs

## Abstract

Documentation site for the Hanzo Bot framework. Static-ish Next.js docs covering bot SDK reference, plugin development, and deployment guides.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/bot-docs:<sha>`)
- Image: `ghcr.io/hanzoai/bot-docs:<sha>`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: `docs.hanzo.bot`
- Internal: `bot-docs.hanzo.svc.cluster.local`

## Dependencies

No runtime deps beyond the container.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
