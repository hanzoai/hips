---
hip: 0498
title: kv
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-498: kv

## Abstract

Primary cluster Valkey instance (HIP-028) — shared cache, queues, ephemeral state.

## CRD Kind

Managed by `kind: KV` ([HIP-403](hip-0403-kv-crd.md)).

## Upstream

Fork of `valkey-io/valkey` (BSD-3), Hanzo brand patches.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/kv:latest`)
- Image: `ghcr.io/hanzoai/kv:latest`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/kv.yaml`

## Ingress

- Public hosts: internal only
- Internal: `kv.hanzo.svc.cluster.local`

## Dependencies

Datastore CR.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
