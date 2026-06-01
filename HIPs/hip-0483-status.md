---
hip: 0483
title: status
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-483: status

## Abstract

Hanzo Status is the public status page at `status.hanzo.ai`: rolling incident timeline + component health. Talks to Visor + Console for live data.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/status:main-amd64`)
- Image: `ghcr.io/hanzoai/status:main-amd64`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/status.yaml`

## Ingress

- Public hosts: `status.hanzo.ai`
- Internal: `status.hanzo.svc.cluster.local`

## Dependencies

SQL (incidents), Visor (health probes), Console (LLM-gateway health).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
