---
hip: 0446
title: hanzo-bot-site
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-446: hanzo-bot-site

## Abstract

Marketing site for `hanzo.bot` — the bot framework's public landing.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzobot/site:v1.2.0`)
- Image: `ghcr.io/hanzobot/site:v1.2.0`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: `hanzo.bot`
- Internal: `hanzo-bot-site.hanzo.svc.cluster.local`

## Dependencies

No runtime deps.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
