---
hip: 0441
title: flow
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-441: flow

## Abstract

Hanzo Flow is the visual workflow builder (HIP-013): drag-and-drop nodes for LLM chains, RAG, tools. Currently parked at replicas=0 due to a Postgres alembic-revision mismatch.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Fork of `langflow-ai/langflow` (MIT), renamed package `flow` per CLAUDE.md.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/flow:1.8.0`)
- Image: `ghcr.io/hanzoai/flow:1.8.0`
- Current replicas in `do-sfo3-hanzo-k8s`: 0

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/flow.yaml`

## Ingress

- Public hosts: `flow.hanzo.ai`
- Internal: `flow.hanzo.svc.cluster.local`

## Dependencies

SQL (flows), KV (cache), Gateway (LLM).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=0 as of 2026-05-18 snapshot.
