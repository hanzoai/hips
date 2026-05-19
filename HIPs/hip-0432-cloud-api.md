---
hip: 0432
title: cloud-api
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-432: cloud-api

## Abstract

Hanzo Cloud-API is the AI model backend that serves `api.cloud.hanzo.ai`: 86 models across 5 providers (do-ai, zen, fireworks, openai-direct, anthropic). Three auth paths: IAM keys (hk-*), hanzo.id JWT, provider keys (sk-*). Records usage to IAM, hits Commerce for balance pre-flight.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/cloud:1.784.2`)
- Image: `ghcr.io/hanzoai/cloud:1.784.2`
- Current replicas in `do-sfo3-hanzo-k8s`: 2

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/cloud-api.yaml`

## Ingress

- Public hosts: `api.cloud.hanzo.ai`, `cloud.hanzo.ai/v1`
- Internal: `cloud-api.hanzo.svc.cluster.local`

## Dependencies

IAM (auth + usage), Commerce (balance), upstream providers (Zen, Fireworks, OpenAI, Anthropic, DigitalOcean AI), SQL (`hanzo_cloud` DB).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=2 as of 2026-05-18 snapshot.
