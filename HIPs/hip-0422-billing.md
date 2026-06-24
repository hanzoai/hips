---
hip: 0422
title: billing
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-422: billing

## Abstract

Hanzo Billing exposes per-customer invoice generation, usage rollups, and payment reconciliation. Sits between Commerce (orders/checkout) and the LLM gateway (usage events) and produces the periodic statements.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/billing:0.0.1`)
- Image: `ghcr.io/hanzoai/billing:0.0.1`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/billing.yaml`

## Ingress

- Public hosts: `billing.hanzo.ai`
- Internal: `billing.hanzo.svc.cluster.local`

## Dependencies

SQL (invoices), Commerce (orders), Console (usage events), Hanzo Pay native PSP.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
