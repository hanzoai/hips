---
hip: 0448
title: hanzo-ingress
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-448: hanzo-ingress

## Abstract

Hanzo Ingress is the cluster-edge ingress controller (HIP-068) — Cloudflare-tunnel-aware reverse proxy that replaces nginx-ingress where edge tunneling is needed. Parked at replicas=0; nginx-ingress remains primary in `do-sfo3-hanzo-k8s`.

## CRD Kind

Managed by `kind: Ingress` ([HIP-411](hip-0411-ingress-crd.md)).

## Upstream

Hanzo-native (Cloudflared-based), no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/ingress:1.7.41`)
- Image: `ghcr.io/hanzoai/ingress:1.7.41`
- Current replicas in `do-sfo3-hanzo-k8s`: 0

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/hanzo-ingress.yaml`

## Ingress

- Public hosts: internal only
- Internal: `hanzo-ingress.hanzo.svc.cluster.local`

## Dependencies

KMS (Cloudflare credentials).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=0 as of 2026-05-18 snapshot.
