---
hip: 0452
title: insights-capture
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-452: insights-capture

## Abstract

Insights Capture is the event-ingestion front for Hanzo Insights — receives PostHog-compatible /capture and /batch payloads, validates, and writes to the Kafka stream.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/insights/capture:latest`)
- Image: `ghcr.io/hanzoai/insights/capture:latest`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: `capture.insights.hanzo.ai`
- Internal: `insights-capture.hanzo.svc.cluster.local`

## Dependencies

Insights-Kafka (Stream), IAM.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
