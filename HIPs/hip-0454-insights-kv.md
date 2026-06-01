---
hip: 0454
title: insights-kv
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-454: insights-kv

## Abstract

Per-Insights Valkey instance — distinct from the cluster's primary `kv` to keep PostHog-style hot keys off the shared cache.

## CRD Kind

Managed by `kind: KV` ([HIP-403](hip-0403-kv-crd.md)).

## Upstream

Hanzo-native (Valkey-compatible), no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/kv:main`)
- Image: `ghcr.io/hanzoai/kv:main`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: internal only
- Internal: `insights-kv.hanzo.svc.cluster.local`

## Dependencies

Datastore CR backing.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
