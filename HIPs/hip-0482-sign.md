---
hip: 0482
title: sign
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-482: sign

## Abstract

Hanzo Sign is the document signing service — generates signing envelopes, captures e-signatures, produces audit trails. Used by Commerce for contracts and Captable for share issuance.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Hanzo-native, no upstream.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/sign:<sha>`)
- Image: `ghcr.io/hanzoai/sign:<sha>`
- Current replicas in `do-sfo3-hanzo-k8s`: 1

## CR location

no CR yet (managed directly via `infra/k8s/<svc>/deployment.yaml`)

## Ingress

- Public hosts: `sign.hanzo.ai`
- Internal: `sign.hanzo.svc.cluster.local`

## Dependencies

SQL (envelopes), S3 (PDFs), IAM SSO.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=1 as of 2026-05-18 snapshot.
