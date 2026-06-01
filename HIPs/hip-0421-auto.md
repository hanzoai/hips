---
hip: 0421
title: auto
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-421: auto

## Abstract

Hanzo Auto is the workflow automation service: triggers, schedules, and event-driven flows that connect Hanzo services to third-party apps (Gmail, Slack, GitHub, etc.). Sister UI to Flow (visual builder) but specialised for cron + webhook automation.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Upstream `activepieces/activepieces` (MIT).

## Source

- Repo: derived from the image (`activepieces/activepieces:0.78.1`)
- Image: `activepieces/activepieces:0.78.1`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/auto.yaml`

## Ingress

- Public hosts: `auto.hanzo.ai`
- Internal: `auto.hanzo.svc.cluster.local`

## Dependencies

SQL (workflows), KV (queue), IAM SSO.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
