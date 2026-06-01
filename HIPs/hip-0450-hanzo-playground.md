---
hip: 0450
title: hanzo-playground
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-450: hanzo-playground

## Abstract

Hanzo Playground is the interactive LLM playground — try-before-you-buy model comparison + API key issuance UI at `playground.hanzo.ai`.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/playground:0.1.42`)
- Image: `ghcr.io/hanzoai/playground:0.1.42`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: `playground.hanzo.ai`
- Internal: `hanzo-playground.hanzo.svc.cluster.local`

## Dependencies

Cloud-API, IAM.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
