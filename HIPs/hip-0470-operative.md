---
hip: 0470
title: operative
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-470: operative

## Abstract

Hanzo Operative (HIP-015) is the computer-use surface — desktop agents driven by Claude via the operative SDK. Parked at replicas=0 due to migration to per-tenant VMs.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/operative:main-amd64`)
- Image: `ghcr.io/hanzoai/operative:main-amd64`
- Current replicas in `do-sfo3-hanzo-k8s`: 0

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: `operative.hanzo.ai`
- Internal: `operative.hanzo.svc.cluster.local`

## Dependencies

VMD (display), Cloud-API (LLM), KV (session).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=0 as of 2026-05-18 snapshot.
