---
hip: 0119
title: Hanzo Service Conventions
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Active
created: 2026-06-25
requires: HIP-0027, HIP-0031, HIP-0044, HIP-0068, HIP-0111, HIP-0112, HIP-0400
---

# HIP-119: Hanzo Service Conventions

## Abstract

This is the one and only shape of a Hanzo backend service. Every first-party
service — across Hanzo, **and across Lux (LPs) and Zoo (ZIPs), which run on the
same substrate** — exposes the same listeners on the same ports, serves its API
under the same prefix, answers health on the same paths, ships metrics the same
way, is configured by the same environment variables, and is deployed by the same
operator through the same CRD. Read this one document and you can build, deploy,
probe, observe, and call any service in the estate without guessing.

It exists because the shape had drifted. The same service's liveness path was
written three different ways in three places — `/api/health` in the committed
manifest, `/v1/health` in the live cluster, `/health` in the binary — and a deploy
that should have been a version bump became an outage. That is the cost of an
unstated contract. This HIP states it.

The governing principle is **decomplection** (Hickey) expressed with **one obvious
way** (Pike): product traffic and operational traffic are different concerns, so
they live on different listeners; health is not an API call, so it is not
versioned; readiness and liveness are different questions, so they have different
paths. Nothing here is novel. It is the absence of choice that is the feature.

HIP-0400 defines the `Service`/`LLM` CRD (the deployment *mechanism*). HIP-0112
defines the request path through the estate (the *topology*). This HIP defines the
*service itself* — the contract a process MUST satisfy to be a citizen of the
platform. Where they touch, this HIP is authoritative on the service's own surface.

## Motivation

An LLM (or a human) building against this stack should never have to read a
service's source to learn where its health check is, which port serves metrics,
whether the API is under `/api` or `/v1`, or how it gets a database password. Every
one of those questions has exactly one answer, and it is the same answer for every
service. Predictability is the product: it is what lets tooling, the operator,
gateways, dashboards, and code generators treat every service identically.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as
in RFC 2119.

### §1 Two listeners, orthogonal

A service MUST bind exactly two HTTP listeners, and they MUST NOT share a port:

| Listener | Port (default) | Env override | Serves | Auth |
|----------|----------------|--------------|--------|------|
| **app**  | `8000`         | `PORT`       | the product API, under `/v1/*` only | per HIP-0111 |
| **ops**  | `9090`         | `OPS_PORT`   | `/healthz`, `/readyz`, `/metrics`   | none (cluster-internal) |

The split is the contract, not an optimization. Operational traffic (probes,
scrapes, drains) MUST NOT traverse the app listener, and the app listener MUST NOT
serve operational endpoints. This is what makes a readiness flap independent of API
load, lets `NetworkPolicy` expose `:9090` only to the cluster, and means a probe
never carries a JWT. A service MAY bind additional protocol listeners (e.g. a ZAP
transport per HIP-0114, gRPC); those are declared the same way, on their own ports,
and are out of scope here.

### §2 API surface — `/v1/` and only `/v1/`

Every product endpoint MUST live under `/v1/`. A service MUST NOT serve a product
endpoint at the root, under `/api/`, or under any other version prefix. The API
evolves **forward only**: changes are additive, and `/v2` MUST NOT be introduced —
breaking changes are made by adding fields/endpoints under `/v1`, never by
versioning the namespace. (`api.<brand>` is already the host; an `/api/` path
prefix on top of it is redundant and is forbidden.)

### §3 Health and readiness — on the ops listener, unversioned

Health is infrastructure, not API, so it is not versioned and it is not on the app
listener.

- **`GET /healthz`** (liveness) — MUST return `200` while the process is running
  and not wedged. It MUST NOT check downstream dependencies. A failing `/healthz`
  means "restart me."
- **`GET /readyz`** (readiness) — MUST return `200` only when the service can serve
  product traffic (migrations applied, required deps reachable, caches warm). It
  MUST return `503` otherwise. A failing `/readyz` means "take me out of rotation,"
  not "restart me."

Both MUST be on the **ops** listener (`:9090`), unauthenticated, and respond in
under one second. Per-subsystem detail (e.g. `/v1/<sub>/health` inside a composed
binary per HIP-0106) MAY exist on the app listener for diagnostics, but MUST NOT be
what Kubernetes probes; probes target the ops listener.

### §4 Observability — `/metrics` on the ops listener

A service MUST expose Prometheus metrics at **`GET /metrics`** on the ops listener,
per HIP-0031. It MUST NOT expose `/metrics` on the app listener.

### §5 Configuration — environment, deterministic names

Configuration is by environment variable. Names are stable and shared:
`PORT`, `OPS_PORT`, `LOG_LEVEL`, `BRAND`, `DOMAIN`. Identity, datastore, and secret
material follow the referenced HIPs (`IAM_*` per HIP-0111, `KMS_*` per HIP-0027). A
service MUST start with zero required flags — every input has a documented env var
and a working default for local single-node dev. Secrets MUST come from KMS
(HIP-0027) and MUST NOT be baked into the image or committed in plaintext.

### §6 Identity & secrets

Authentication and token validation MUST be done exactly as HIP-0111 specifies
(`@hanzo/iam`, `/v1/iam/oauth/*`, `<org>-<app>` client IDs). Secrets MUST be sourced
from KMS per HIP-0027. Neither is redefined here.

### §7 Deployment — the operator, through the CRD, and nothing else

A first-party service MUST be deployed by the **hanzo-operator** reconciling a
`Service` or `LLM` custom resource (HIP-0400). The CR is the single source of truth
for image, ports, probes, env, and ingress; its committed form lives in
`universe/infra/k8s/operator/crs/<svc>-v1.yaml`. Rolling a new version is one edit
to `spec.image.tag` (the operator regenerates and rolls the Deployment). The CR's
probe defaults MUST target the ops listener per §3; a service that follows this HIP
does not specify probes per-deployment.

Out-of-band deploy paths — hand-run `kubectl`, bespoke GitHub Actions that
`doctl`+`kubectl apply`, or the Dokploy PaaS (which is for *user* applications) —
MUST NOT be the deploy mechanism for first-party platform services. There is one
path; drift between a committed manifest and the live cluster is a defect, not a
state.

### §8 Image & naming

- Images are `ghcr.io/<org>/<svc>:vX.Y.Z` — **v-prefixed semver**. Floating tags
  (`:latest`, `:main`, branch names) MUST NOT be deployed (per HIP-0036).
- IAM client IDs are `<org>-<app>` (HIP-0111).
- One service, one repo, one image, one CR. A binary that composes subsystems
  (HIP-0106) is still one service with one app listener and one ops listener.

### §9 Forbidden — the anti-patterns this HIP exists to kill

- An `/api/` path prefix on any endpoint.
- A versioned health path (`/v1/health`, `/v2/healthz`).
- Health, readiness, or metrics on the **app** listener.
- Kubernetes probes pointed at the app listener or at a product/API path.
- A single listener serving both product and operational traffic.
- Per-service bespoke ports for the same role (everyone's app is `:8000`, ops is
  `:9090`).
- Floating image tags in a CR; hand-deployed drift; a second deploy mechanism.

### §10 One contract across Hanzo, Lux, and Zoo

Lux and Zoo run on this same substrate (shared IAM, KMS, operator, gateway,
ingress) under white-label branding. **LPs and ZIPs adopt this HIP by reference and
MUST NOT restate or fork the service contract.** What differs between ecosystems is
*values* — brand, domain, theme, the org segment of `<org>-<app>` and
`ghcr.io/<org>/…` — never *shape*. An LP or ZIP that needs a backend service points
at HIP-0119; the contract is identical up, down, left, right, in, and out. That
identity is the whole point: it is what makes the platform one way.

## Reference implementation

`hanzo/cloud` (HIP-0106) is the reference: it binds the app listener (`CLOUD_LISTEN`,
`:8000`) for `/v1/*` and the ops listener (`CLOUD_HEALTH_LISTEN`, `:9090`) for
`/healthz`, `/readyz`, `/metrics`; the `cloud-api` `Service` CR probes the ops
listener. iam and gateway follow the same split.

## Conformance checklist (build a service against this in one pass)

1. App listener on `:8000` (`PORT`); every product route under `/v1/`. No `/api/`.
2. Ops listener on `:9090` (`OPS_PORT`): `/healthz` (liveness, no deps), `/readyz`
   (readiness, deps), `/metrics` (Prometheus). Unauthenticated.
3. Probes (in the CR) target `:9090/healthz` and `:9090/readyz`.
4. Starts with zero required flags; secrets from KMS (HIP-0027); auth via
   `@hanzo/iam` (HIP-0111).
5. Image `ghcr.io/<org>/<svc>:vX.Y.Z`; deployed by one `Service`/`LLM` CR
   (HIP-0400) reconciled by the operator.
6. Nothing from §9.

## References

- HIP-0027 Secrets Management · HIP-0031 Observability/Metrics · HIP-0044 API Gateway
- HIP-0068 Ingress · HIP-0106 Unified Cloud Binary · HIP-0111 IAM Authentication
- HIP-0112 Cloud Infrastructure Topology · HIP-0400 Service CRD
