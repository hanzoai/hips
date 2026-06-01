---
hip: 0425
title: bot-hub
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-425: bot-hub

## Abstract

Hanzo Bot Hub is the bot marketplace/registry: bot operators publish their bots; users discover and install them. The hub also serves OAuth callbacks for bot platforms.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/bot-hub:0.0.1`)
- Image: `ghcr.io/hanzoai/bot-hub:0.0.1`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/bot-hub.yaml`

## Ingress

- Public hosts: `hub.hanzo.bot`
- Internal: `bot-hub.hanzo.svc.cluster.local`

## Dependencies

SQL (bot listings), S3 (bot icons), IAM.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
