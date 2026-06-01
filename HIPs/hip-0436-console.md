---
hip: 0436
title: console
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-436: console

## Abstract

Hanzo Console is the observability & admin surface (HIP-038): LLM traces, scores, datasets, prompt management, evaluations. Sister UI to Langfuse but Hanzo-branded and IAM SSO-only.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Fork of `langfuse/langfuse` (MIT), Hanzo brand and IAM patches.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/console:3.156.7`)
- Image: `ghcr.io/hanzoai/console:3.156.7`
- Current replicas in `do-sfo3-hanzo-k8s`: 2

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/console.yaml`

## Ingress

- Public hosts: `console.hanzo.ai`
- Internal: `console.hanzo.svc.cluster.local`

## Dependencies

SQL (traces/observations), ClickHouse (events), KV (queue), IAM SSO (app-console).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=2 as of 2026-05-18 snapshot.
