---
hip: 0459
title: kms
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-459: kms

## Abstract

Hanzo KMS (HIP-027): secrets manager, encryption envelope service, audit log. Exposes `KMSSecret` CRDs that any Hanzo Service CR can reference, plus an HTTP API + CLI for non-K8s consumers.

## CRD Kind

Managed by `kind: KMS` ([HIP-409](hip-0409-kms-crd.md)).

## Upstream

Fork of `Infisical/infisical` (MIT), Hanzo brand + IAM integration patches.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/kms:latest`)
- Image: `ghcr.io/hanzoai/kms:latest`
- Current replicas in `do-sfo3-hanzo-k8s`: 2

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/kms.yaml`

## Ingress

- Public hosts: `kms.hanzo.ai`
- Internal: `kms.hanzo.svc.cluster.local`

## Dependencies

SQL (secrets store), IAM (org-scoped access), KMS encryption key (root).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=2 as of 2026-05-18 snapshot.
