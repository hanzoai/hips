---
hip: 0443
title: gateway
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-443: gateway

## Abstract

Hanzo LLM Gateway (HIP-004/044): unified proxy for 100+ LLM providers (Anthropic, OpenAI, Together, etc.). Speaks the OpenAI API, exposes Hanzo virtual model names, records observability traces to Console, enforces per-user rate limits.

## CRD Kind

Managed by `kind: LLM` ([HIP-410](hip-0410-llm-crd.md)).

## Upstream

Fork of LiteLLM (MIT), Hanzo-branded and tightly integrated with IAM/Console.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/gateway:2.14.1`)
- Image: `ghcr.io/hanzoai/gateway:2.14.1`
- Current replicas in `do-sfo3-hanzo-k8s`: 2

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/gateway.yaml`

## Ingress

- Public hosts: `api.hanzo.ai`, `llm.hanzo.ai`
- Internal: `gateway.hanzo.svc.cluster.local`

## Dependencies

SQL (vkeys), KV (cache), Console (callbacks), IAM (auth), upstream providers.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=2 as of 2026-05-18 snapshot.
