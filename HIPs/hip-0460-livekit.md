---
hip: 0460
title: livekit
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-460: livekit

## Abstract

Hanzo Livekit — WebRTC SFU for real-time audio/video used by the agent-voice surface. Parked at replicas=0 awaiting GHCR build.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Fork of `livekit/livekit` (Apache 2.0).

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/livekit:latest`)
- Image: `ghcr.io/hanzoai/livekit:latest`
- Current replicas in `do-sfo3-hanzo-k8s`: 0

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: `livekit.hanzo.ai`
- Internal: `livekit.hanzo.svc.cluster.local`

## Dependencies

S3 (recordings), IAM (room-token issuance).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=0 as of 2026-05-18 snapshot.
