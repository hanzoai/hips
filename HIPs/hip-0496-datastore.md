---
hip: 0496
title: datastore
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-496: datastore

## Abstract

Primary ClickHouse cluster (HIP-047). Backing store for Console traces, Insights events, O11y metrics/logs.

## CRD Kind

Managed by `kind: Datastore` ([HIP-401](hip-0401-datastore-crd.md)).

## Upstream

Fork of `ClickHouse/ClickHouse` (Apache 2.0).

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/datastore:latest`)
- Image: `ghcr.io/hanzoai/datastore:latest`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/datastore.yaml`

## Ingress

- Public hosts: internal only
- Internal: `datastore.hanzo.svc.cluster.local`

## Dependencies

PVC, KMS for credentials.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
