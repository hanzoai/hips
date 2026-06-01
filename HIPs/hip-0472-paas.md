---
hip: 0472
title: paas
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-472: paas

## Abstract

Hanzo PaaS (HIP-014) at `platform.hanzo.ai` — Dokploy fork that deploys arbitrary Docker apps with IAM SSO, KMS-managed secrets, and DNS provisioning.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Fork of `Dokploy/dokploy` (Apache 2.0).

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/paas:latest`)
- Image: `ghcr.io/hanzoai/paas:latest`
- Current replicas in `do-sfo3-hanzo-k8s`: 2

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/paas.yaml`

## Ingress

- Public hosts: `platform.hanzo.ai`
- Internal: `paas.hanzo.svc.cluster.local`

## Dependencies

SQL (deployments), KV (queue), DNS (record creation), IAM SSO, KMS, Docker socket / K8s API.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=2 as of 2026-05-18 snapshot.
