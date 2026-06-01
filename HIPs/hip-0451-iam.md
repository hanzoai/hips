---
hip: 0451
title: iam
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-451: iam

## Abstract

Hanzo IAM (HIP-026): RFC 6749/OIDC-compliant identity provider, multi-tenant (hanzo.id, lux.id, zoo.id, pars.id, id.ad.nexus, id.hanzo.ai, id.lux.network, id.pars.network), OAuth2/SAML/CAS, Web3 login, MFA. Also tracks per-user credit balance.

## CRD Kind

Managed by `kind: IAM` ([HIP-408](hip-0408-iam-crd.md)).

## Upstream

Fork of `casdoor/casdoor` (Apache 2.0), heavy Hanzo branding/feature patches.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/iam:<sha>`)
- Image: `ghcr.io/hanzoai/iam:<sha>`
- Current replicas in `do-sfo3-hanzo-k8s`: 2

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/iam.yaml`

## Ingress

- Public hosts: `hanzo.id`, `id.hanzo.ai`, `lux.id`, `id.lux.network`, `zoo.id`, `pars.id`, `id.pars.network`, `id.ad.nexus`
- Internal: `iam.hanzo.svc.cluster.local`

## Dependencies

SQL (users/orgs/apps), KMS (signing keys), S3 (avatars), Stripe via Commerce (recharge).

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=2 as of 2026-05-18 snapshot.
