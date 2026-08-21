---
hip: 1133
title: Ingress — The Embedded Edge
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: ingress
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1133: Ingress — The Embedded Edge

## Abstract

`/v1/ingress` is the front door as a capability: automatic TLS certificates and
hostname routing to any backend, changed live over an API with no config file
and no restart. It is cloud's embedded, runtime-configurable edge, implemented
in `hanzoai/cloud` at `apps/ingress` (HIP-0106) — a control plane every
deployment mounts, and a data plane only the instance in edge role binds.

## Motivation

A single-binary deployment that needs TLS and host routing should not need a
second proxy process in front of it. The standalone cluster edge (HIP-0068)
remains the fleet's Kubernetes-native proxy; this capability makes the ONE
cloud binary able to BE the edge for deployments where a separate proxy is pure
overhead — point DNS at the instance, POST the routes, and the proxy pod is
gone (`apps/ingress/ingress.go:1-46`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 Two planes, one role flag

The CONTROL plane is `/v1/ingress/*` — routes, services, middlewares, TLS,
status — mounted in every role so config can be authored and inspected. The
DATA plane binds listeners only in edge role (`CLOUD_INGRESS_EDGE_ENABLED`):
:80 for ACME HTTP-01 and the HTTP router, :443 for SNI TLS termination. In app
role the listeners never bind and cloud stays a pure application
(`apps/ingress/ingress.go:12-24`). Every mutation hot-reloads the engine: the
compiled host table is an atomic snapshot, recompiled whole and swapped
pointer-for-pointer, so a change takes effect with no restart and no
per-request lock (`apps/ingress/engine.go:17-26`).

### §2 The store, and the host as a global claim

One encrypted SQLite file — the deployment's own `ingress`
(`apps/ingress/store.go:46`) — holds every org's edge config as opaque JSON
documents keyed by (org, kind, id). CRUD tenancy is the org column on every
query; a route's HOST, however, is a globally unique DNS claim, enforced unique
ACROSS orgs by a partial unique index, so no org can hijack another's hostname.
The edge compile reads the union across orgs, unambiguous precisely because
hosts are unique (`apps/ingress/store.go:21-45`).

### §3 The address

Eighteen operations under `/v1/ingress`, all typed; the three deletes answer no
body, which is their shape rather than a gap. Middleware is four orthogonal
edge transforms — scheme redirect, strip-prefix, add-prefix, headers — and an
unknown type is refused at compile (`apps/ingress/middleware.go:9-25`).

### §4 Tenancy is SuperAdmin

The edge is platform infrastructure, so every operation requires SuperAdmin —
the same predicate the admin surfaces enforce — and storage is scoped to that
validated admin org. A non-admin, a forged principal, or a call arriving off
the HTTP path (a CLI local invoke carries no request) is refused 403, fail
closed, with no second gate to keep in sync
(`apps/ingress/ingress.go:214-238`).

### §5 Money, events, observability, stage

Free (`cloud.Free`, `plugin/ingress/main.go`). It publishes nothing on the bus
and emits nothing beyond the request span every route gets. Stage `ga`: the
platform core's front door.

### §6 Upstream

Two, both embedded as libraries: `github.com/vulcand/oxy/v2` v2.2.0
(Apache-2.0) — its `forward` and `roundrobin` survive as the proxy primitives
of the engine (`apps/ingress/engine.go:13-14`) — and
`golang.org/x/crypto/acme/autocert` (BSD-3-Clause), which is the whole ACME
lifecycle: cert issuance against Let's Encrypt, the cache directory, and the
HostPolicy fed from the engine's TLS host set (`apps/ingress/edge.go:10-30`).

## Rationale

The alternative is what HIP-0068 already provides: a separate proxy watching
cluster resources. That is right for the multi-service cluster and wrong for
the one-binary deployment, where it doubles the processes to run something the
binary can carry. Ingress and gateway stay orthogonal on purpose — ingress owns
routing and TLS, gateway owns auth and rate limit — so neither grows the
other's concern (`apps/ingress/ingress.go:48-53`).

## Security Considerations

The control plane is a routing authority: whoever writes it decides where every
served hostname's traffic goes, which is interception, not misconfiguration.
That is why the gate is SuperAdmin rather than org admin, why it fails closed
off the HTTP path, and why the host claim is globally unique — without that
index, tenant A posts tenant B's hostname and the edge compile happily routes
B's traffic to A's backend. The ACME account and cert cache are
deployment-level state; the wrong implementation that let a tenant name extra
TLS hosts would mint certificates for domains the deployment does not own the
routes to.

## References

- HIP-0026 — Identity and Access Management
- HIP-0068 — Ingress Standard (the standalone cluster edge)
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
