---
hip: 0112
title: Cloud Infrastructure Topology Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Active
created: 2026-06-16
requires: HIP-0026, HIP-0027, HIP-0031, HIP-0044, HIP-0068, HIP-0111
---

# HIP-112: Cloud Infrastructure Topology Standard

## Abstract

This HIP describes how the Hanzo cloud estate fits together: the path a request takes from the public internet to a backend, where identity is enforced, where secrets come from, where data lives, and how the same shape is replicated per brand. It is the map. The individual components each have their own HIP; this one wires them into a single coherent topology and states the one canonical arrangement.

The estate runs on DOKS cluster `hanzo-k8s`. Every brand (Hanzo, Lux, Zoo, Bootnode, Pars) runs the same topology with its own identity origin and its own apps.

## Motivation

A correct component in the wrong place still produces an outage. The estate has seen rate-limit annotations silently dropped because they sat at the wrong layer, gateway routes pointed at services that had the upstream feature disabled, and identity headers trusted from the wrong hop. These are not component bugs — they are topology bugs. This HIP fixes the topology so each component sits in exactly one place and does exactly one job.

## Specification

### The request path

```
                          Internet
                             │
                             ▼  (Cloudflare proxy: DNS + TLS edge)
                  ┌──────────────────────┐
                  │  Ingress (HIP-0068)   │  Traefik v3.6 fork
                  │  L7 host routing,     │  ghcr.io/hanzoai/ingress
                  │  TLS termination,     │  ingress.kubernetes.io/* annotations
                  │  health-aware LB      │
                  └──────────┬───────────┘
                             │
              ┌──────────────┼─────────────────────────────┐
              │              │                             │
              ▼              ▼                             ▼
       api.<brand>     <app hosts>                   id.<brand> / iam.<brand>
              │       (hanzo.ai, console, …)               │
              ▼                                             ▼
  ┌────────────────────────┐                     ┌────────────────────┐
  │  Gateway (HIP-0044)     │  KrakenD CE fork    │  IAM (HIP-0026)     │
  │  JWT validation,        │  ghcr.io/hanzoai/   │  OIDC provider,     │
  │  API-key auth,          │  gateway            │  per-brand origin   │
  │  rate limit, CORS,      │                     │  (HIP-0111)         │
  │  X-Org-Id propagation,  │                     └────────────────────┘
  │  observability          │
  └───────────┬────────────┘
              │  (validated identity as X-* headers)
              ▼
  ┌────────────────────────────────────────────────────────────┐
  │  Backend services (LLM, Cloud, Commerce, Console, …)         │
  │  trust gateway-injected identity; per-(org,user) SQLite      │
  └────────────────────────────────────────────────────────────┘
        │                         │                        │
        ▼                         ▼                        ▼
   KMS (HIP-0027)         Observability (HIP-0031)    SQLite per org/user
   kms.hanzo.ai           metrics/logs/traces         (no shared Postgres)
   secrets only           at ingress + gateway
```

### Layer responsibilities (one job each)

1. **Edge — Cloudflare.** DNS and TLS at the network edge, proxy mode. Not a Hanzo component; the public entry.

2. **Ingress — HIP-0068.** The only L7 reverse proxy at the cluster edge. Host-based routing (`api.hanzo.ai` → gateway, `hanzo.ai` → marketing, `iam.hanzo.ai` → IAM, `kms.hanzo.ai` → KMS), in-cluster TLS termination, health-aware load balancing. Configured **only** with `ingress.kubernetes.io/*` annotations — `traefik.*` annotations are silently ignored and MUST NOT be used. We do not use nginx, Caddy, or any other edge proxy.

3. **Gateway — HIP-0044.** The application-layer gateway for `api.<brand>`. It is the single place that validates a caller's identity and applies cross-cutting policy: JWT validation against IAM JWKS, API-key resolution, per-org/per-key rate limiting, CORS, circuit breaking, request/response transformation, and request observability. It **strips all client-supplied identity headers** (`X-Org-Id`, `X-User-Id`, `X-User-Email`) and re-injects them only from validated JWT claims. Backends sit behind it and trust those headers. The LLM Gateway (HIP-0004) is a distinct AI-specific proxy that is one backend among many — not this gateway.

4. **Identity — IAM (HIP-0026) + auth contract (HIP-0111).** One OIDC provider per brand. Clients authenticate only via `@hanzo/iam` against the canonical `/v1/iam/oauth/*` endpoints. The `owner` claim is the tenant key.

5. **Secrets — KMS (HIP-0027).** The only secret store. Services fetch secrets at startup from `kms.hanzo.ai`; manifests carry KMSSecret sync references, never plaintext. No secret lives in Git, env files, or images.

6. **Storage.** SQLite scoped per `(org, user)` is the default — Hanzo Base is the canonical pattern. PostgreSQL is used only where a service genuinely needs shared multi-instance relational state; it is never the local-dev or default choice.

7. **Observability — HIP-0031.** Request logging, metrics, and traces are emitted at **ingress and gateway**, the two points every request crosses. Backends export Prometheus metrics; they do not each reinvent edge logging.

### Where identity is enforced (one hop)

Identity is validated exactly once, at the gateway. The flow:

1. Client sends `Authorization: Bearer <jwt-or-api-key>` to `api.<brand>`.
2. Gateway validates the JWT against IAM JWKS (`/v1/iam/.well-known/jwks`) or resolves the API key against IAM, then **strips** any inbound `X-Org-Id`/`X-User-Id`/`X-User-Email` and re-injects them from the validated claims.
3. Backend reads `X-Org-Id` (the `owner` slug) and scopes every query to it. Backends do not re-parse JWTs and do not trust client-supplied identity headers — only the gateway sets them.

A service that talks to IAM directly (its own login UI, server-side `validateToken`) follows HIP-0111. A service behind the gateway trusts the gateway. These are the only two patterns.

### Header convention

Vendor-free `X-*` headers (no `X-Hanzo-*`, no `X-IAM-*`):

| Header | Source |
|--------|--------|
| `X-Org-Id` | JWT `owner` claim (org slug) |
| `X-User-Id` | JWT `sub` claim |
| `X-User-Email` | JWT `email` claim |

The gateway is the sole writer of these on the trusted path.

### Per-brand replication

Each brand runs the identical topology with its own values:

| Concern | Per-brand value |
|---------|-----------------|
| Identity origin | `iam.hanzo.ai` / `lux.id` / `zoo.id` / `id.bootno.de` / `pars.id` |
| API host | `api.<brand-domain>` |
| Apps | brand-scoped `<org>-<app>` client IDs (HIP-0111) |
| Secrets | KMS project per brand |
| Container registry | `ghcr.io/hanzoai/*` (Hanzo), `ghcr.io/luxfi/*` (Lux), `ghcr.io/zooai/*` (Zoo) |

Nothing in the topology is brand-special-cased. A brand is a set of values plugged into the same shape.

## Implementation

- **Cluster**: DOKS `hanzo-k8s`. amd64.
- **Manifests**: Kustomize. Edge (ingress), gateway, IAM, KMS, and backends are each their own kustomization; secrets are KMSSecret references synced from `kms.hanzo.ai`.
- **PaaS**: `platform.hanzo.ai` for deploy/update/monitoring.
- **Images**: `ghcr.io/hanzoai/<service>`, pinned to `vX.Y.Z` or `sha-<sha7>` — never floating tags.

## Security Considerations

- **Single identity enforcement point** — validating identity at one hop (the gateway) and stripping client-supplied identity headers removes header-spoofing as an attack class for everything behind it.
- **Secrets never at rest in the repo** — KMS-only, synced at runtime.
- **TLS end to end** — Cloudflare edge, ingress termination, in-cluster re-encryption; plaintext rejected.
- **Tenant isolation** — `owner`-scoped queries plus per-(org,user) SQLite keep tenants’ data physically and logically separate.
- **Annotation correctness** — `ingress.kubernetes.io/*` only; a `traefik.*` annotation that is silently ignored can leave a route with no rate limiting.

## References

1. [HIP-0068: Ingress Standard](./hip-0068-ingress-standard.md)
2. [HIP-0044: Hanzo Gateway Standard](./hip-0044-api-gateway-standard.md)
3. [HIP-0026: Identity & Access Management Standard](./hip-0026-identity-access-management-standard.md)
4. [HIP-0111: Hanzo IAM Authentication Standard](./hip-0111-iam-authentication-standard.md)
5. [HIP-0027: Secrets Management Standard](./hip-0027-secrets-management-standard.md)
6. [HIP-0031: Observability & Metrics Standard](./hip-0031-observability-metrics-standard.md)
7. [HIP-0004: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
