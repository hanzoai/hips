---
hip: 0486
title: studio
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-486: studio

## Abstract

PaaS Studio is the developer-facing dashboard for Hanzo PaaS — repo connect, env editor, deploy logs. Sibling of `paas` (the backend).

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Fork of Dokploy front-end.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/studio:main`)
- Image: `ghcr.io/hanzoai/studio:main`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: `studio.hanzo.ai`
- Internal: `studio.hanzo.svc.cluster.local`

## Dependencies

PaaS API, IAM SSO.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
