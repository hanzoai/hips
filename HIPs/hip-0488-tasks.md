---
hip: 0488
title: tasks
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-488: tasks

## Abstract

Hanzo Tasks (HIP-062) — scheduled job runner + task UI. AdminJS-style task definitions + a Temporal-ish execution model. Hanzo brand.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Fork of `OpenBookkeeper/openobserve` style tasks, heavily diverged.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/tasks:v1.43.0-amd64`)
- Image: `ghcr.io/hanzoai/tasks:v1.43.0-amd64`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: `tasks.hanzo.ai`
- Internal: `tasks.hanzo.svc.cluster.local`

## Dependencies

SQL (jobs), KV (queue), IAM SSO.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
