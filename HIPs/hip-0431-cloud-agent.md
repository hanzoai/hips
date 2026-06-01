---
hip: 0431
title: cloud-agent
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-431: cloud-agent

## Abstract

Cloud-Agent is a long-running worker that drives the Hanzo Cloud's automated provisioning: dispatching VM creation, registry pushes, and webhook delivery. Parked at replicas=0.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/bot:2026.3.26`)
- Image: `ghcr.io/hanzoai/bot:2026.3.26`
- Current replicas in `do-sfo3-hanzo-k8s`: 0

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: internal only
- Internal: `cloud-agent.hanzo.svc.cluster.local`

## Dependencies

SQL, KV, Cloud-API, Visor.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=0 as of 2026-05-18 snapshot.
