---
hip: 0463
title: nats-box
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-463: nats-box

## Abstract

NATS-CLI sidecar container used for interactive debugging of the cluster NATS stream broker. Tiny utility pod; not a service in the routing sense.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Upstream `nats-io/nats-box` (Apache 2.0).

## Source

- Repo: derived from the image (`natsio/nats-box:0.19.3`)
- Image: `natsio/nats-box:0.19.3`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: internal only
- Internal: `nats-box.hanzo.svc.cluster.local`

## Dependencies

NATS StatefulSet.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
