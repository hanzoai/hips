---
hip: 0497
title: hanzo-mpc
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-497: hanzo-mpc

## Abstract

Hanzo MPC cluster: 5-of-? threshold signing network for cross-chain wallet operations and operator-controlled keys (HIP-084). Sister of `luxfi/mpc`.

## CRD Kind

Managed by `kind: MPC` ([HIP-413](hip-0413-mpc-crd.md)).

## Upstream

Fork of `luxfi/mpc` (BSD-3).

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/mpc:1.2.9`)
- Image: `ghcr.io/hanzoai/mpc:1.2.9`
- Current replicas in `do-sfo3-hanzo-k8s`: 5

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/hanzo-mpc.yaml`

## Ingress

- Public hosts: internal only
- Internal: `hanzo-mpc.hanzo.svc.cluster.local`

## Dependencies

Peer P2P (port 7000), API (port 8080).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=5 as of 2026-05-18 snapshot.
