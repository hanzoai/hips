---
hip: 0502
title: sql
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-502: sql

## Abstract

Primary cluster Postgres (HIP-029) — backs IAM, Commerce, Console, Cloud, Platform, KMS. The single source of truth for relational data in `do-sfo3-hanzo-k8s`.

## CRD Kind

Managed by `kind: SQL` ([HIP-402](hip-0402-sql-crd.md)).

## Upstream

Fork of `postgres/postgres` (PostgreSQL License), Hanzo brand + replication patches.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/sql:18`)
- Image: `ghcr.io/hanzoai/sql:18`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/sql.yaml`

## Ingress

- Public hosts: internal only
- Internal: `sql.hanzo.svc.cluster.local`

## Dependencies

PVC, KMS for root creds.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
