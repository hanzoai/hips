---
hip: 0492
title: vmd
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-492: vmd

## Abstract

Apache Guacamole guacd — remote display proxy used by Operative for VNC/RDP/SSH browser-based desktop sessions.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Upstream Apache Guacamole.

## Source

- Repo: derived from the image (`docker.io/guacamole/guacd:1.5.4`)
- Image: `docker.io/guacamole/guacd:1.5.4`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/vmd.yaml`

## Ingress

- Public hosts: internal only
- Internal: `vmd.hanzo.svc.cluster.local`

## Dependencies

Operative.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
