---
hip: 0468
title: openfaas-gateway
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-468: openfaas-gateway

## Abstract

OpenFaaS gateway is the request entry point for function invocations.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Upstream `openfaas/gateway` (MIT).

## Source

- Repo: derived from the image (`ghcr.io/openfaas/gateway:latest`)
- Image: `ghcr.io/openfaas/gateway:latest`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: `faas.hanzo.ai`
- Internal: `openfaas-gateway.hanzo.svc.cluster.local`

## Dependencies

OpenFaaS-Controller, NATS (queue).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
