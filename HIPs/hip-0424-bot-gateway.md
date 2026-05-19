---
hip: 0424
title: bot-gateway
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-424: bot-gateway

## Abstract

Hanzo Bot Gateway is the routing/dispatch tier for the Bot framework (HIP-025): incoming webhook payloads from Discord/Telegram/Slack are normalised and forwarded to the appropriate bot worker.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/bot:2026.3.26`)
- Image: `ghcr.io/hanzoai/bot:2026.3.26`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/bot-gateway.yaml`

## Ingress

- Public hosts: `gateway.hanzo.bot`
- Internal: `bot-gateway.hanzo.svc.cluster.local`

## Dependencies

SQL (bot config), KV (rate limit), IAM, Cloud (LLM calls).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
