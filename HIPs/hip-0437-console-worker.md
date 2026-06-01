---
hip: 0437
title: console-worker
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-437: console-worker

## Abstract

Async worker tier for Console: consumes the trace ingestion queue, runs LLM-as-judge evaluators, rolls up usage records.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Same as console.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/console-worker:3.156.7`)
- Image: `ghcr.io/hanzoai/console-worker:3.156.7`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: internal only
- Internal: `console-worker.hanzo.svc.cluster.local`

## Dependencies

Console main + KV queue.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
