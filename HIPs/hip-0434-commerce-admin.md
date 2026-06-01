---
hip: 0434
title: commerce-admin
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-434: commerce-admin

## Abstract

Commerce Admin UI: operator-facing dashboard to manage products, orders, refunds, coupons. Built on top of the Commerce API.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/commerce-admin:0.0.1`)
- Image: `ghcr.io/hanzoai/commerce-admin:0.0.1`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/commerce-admin.yaml`

## Ingress

- Public hosts: `admin.commerce.hanzo.ai`
- Internal: `commerce-admin.hanzo.svc.cluster.local`

## Dependencies

Commerce, IAM SSO.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
