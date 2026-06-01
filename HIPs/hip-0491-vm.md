---
hip: 0491
title: vm
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-491: vm

## Abstract

Hanzo VM is the VM provisioning API — creates per-tenant compute on DigitalOcean / GKE / EKS targets. Parked at replicas=0; superseded by direct K8s deploys for most use cases.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/vm:latest`)
- Image: `ghcr.io/hanzoai/vm:latest`
- Current replicas in `do-sfo3-hanzo-k8s`: 0

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: `vm.hanzo.ai`
- Internal: `vm.hanzo.svc.cluster.local`

## Dependencies

DO API, Visor, KMS (cloud creds).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=0 as of 2026-05-18 snapshot.
