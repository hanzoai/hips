---
hip: 0433
title: commerce
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-433: commerce

## Abstract

Hanzo Commerce is the billing + commerce backend (HIP-018): checkout, payments, invoices, orders, subscriptions, products, coupons, pricing. Single source of truth for credits and usage across all Hanzo services.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Fork of `mattermost/focalboard`-style commerce stack, heavily diverged. Go/Gin.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/commerce:<sha>`)
- Image: `ghcr.io/hanzoai/commerce:<sha>`
- Current replicas in `do-sfo3-hanzo-k8s`: 2

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/commerce.yaml`

## Ingress

- Public hosts: `commerce.hanzo.ai`, `api.commerce.hanzo.ai`
- Internal: `commerce.hanzo.svc.cluster.local`

## Dependencies

SQL (orders/products), KV (cart), Hanzo Pay native PSP (payments), IAM SSO, S3 (product images).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=2 as of 2026-05-18 snapshot.
