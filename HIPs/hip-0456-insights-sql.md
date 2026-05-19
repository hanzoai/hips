---
hip: 0456
title: insights-sql
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-456: insights-sql

## Abstract

Per-Insights Postgres instance — analytics-app-private SQL backing for the Insights web UI, plugins, and team/project metadata.

## CRD Kind

Managed by `kind: SQL` ([HIP-402](hip-0402-sql-crd.md)).

## Upstream

Hanzo-native (Postgres fork), no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/sql:main`)
- Image: `ghcr.io/hanzoai/sql:main`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: internal only
- Internal: `insights-sql.hanzo.svc.cluster.local`

## Dependencies

Datastore CR backing.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
