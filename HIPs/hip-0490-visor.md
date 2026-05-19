---
hip: 0490
title: visor
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-490: visor

## Abstract

Hanzo Visor (HIP-053) — infrastructure monitoring service: VM/host health probes, cluster topology, alerting. Backs the public status page (`status` service).

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/visor:latest`)
- Image: `ghcr.io/hanzoai/visor:latest`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/visor.yaml`

## Ingress

- Public hosts: `visor.hanzo.ai`
- Internal: `visor.hanzo.svc.cluster.local`

## Dependencies

SQL (probes/alerts), Stream (event firehose), Visor agents on hosts.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
