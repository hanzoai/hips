---
hip: 1122
title: Deploy — The GitOps Plane
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: deploy
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1122: Deploy — The GitOps Plane

## Abstract

`/v1/deploy` is Hanzo CD: see what each app in the fleet is running, sync it,
and roll back a bad release. It is implemented in `hanzoai/cloud` at
`apps/deploy`, observing the operator-managed fleet — applications, resource
tree, per-object health, live diff — and driving reconciliation. Each operator
`hanzo.ai/v1` App CR is a GitOps Application (`apps/deploy/deploy.go:8-11`).
This HIP states that the cluster is the store, which reads are tenant-scoped,
and why the writes are SuperAdmin-only.

## Motivation

The operator reconciles declared state into workloads whether or not anyone is
watching; what was missing was the watch. Without one plane that projects the
fleet — declared version, health, sync, the owned-resource tree — the answer to
"what is running" is a kubectl session, which neither the console nor a tenant
can be handed. This plane is that projection, at the addresses the CD dashboard
that consumes it already speaks (`apps/deploy/deploy.go:13-15`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The cluster is the store

deploy owns no store. Its state is the cluster's: App CRs, their owned objects
(Deployment, Service, Ingress, ReplicaSet, Pod), and the static-plane site CRDs
projected as Application rows so the fleet list covers the whole delivery
surface (`apps/deploy/deploy.go:76-84`). Nothing this plane serves survives the
cluster it reads, and nothing needs to.

### §2 The addresses

Every route is under `/v1/deploy`, enumerated as explicit prefixes in the
manifest row (`manifest/apps.go:175`). The fleet reads — applications, detail,
resource tree, revisions, clusters, projects, settings, gitops, version — are
typed. The raw routes are raw because their answers cannot be values:
`stream/applications` and the streamed resource tree are event streams;
`login`, `callback` and `logout` are the console's OIDC redirect dance against
IAM (`apps/deploy/login.go:128-140`); `sync`, `rollback` and `reconcile` are
imperatives answering acknowledgement, not a resource; `account/can-i/{...}` is
a wildcard permission probe the dashboard issues.

### §3 Tenancy — two scopes, one predicate

Scope is derived from the validated identity in one place
(`resolveScope`, `apps/deploy/scope.go:66-84`): a SuperAdmin — decided by the
`c.IsAdmin()` predicate alone, which already implies a validated principal —
sees and mutates the whole fleet; a validated org member sees only apps carrying
its own `hanzo.ai/org` label, read-only. The writes (sync, rollback, reconcile)
MUST remain SuperAdmin-only: they change what runs. Secret objects are never
surfaced — no tree node, no manifest — so the projection cannot leak
materialized env (`apps/deploy/deploy.go:36-38`). Console sign-in resolves
SuperAdmins through the `admin-console` IAM application, whose organization is
the reserved admin org (`apps/deploy/login.go:101-106`), and validates tokens
with the same validator the identity boundary uses.

### §4 Money, events, telemetry

deploy is free, in those words (`plugin/deploy/main.go:21`, `cloud.Free`; not
in `spend.go:275`). It publishes no events on the bus — the stream routes are
per-request server-sent events, not bus topics — and it emits nothing to
observability beyond the request span every route gets.

### §5 Stage

deploy is `ga`: it is the platform core's delivery lens, part of the
self-service agentic OS rather than a vertical application.

### §6 Upstream

deploy derives from no forked code. Two third-party facts stand: it reads the
cluster through `k8s.io/client-go` (Apache-2.0), and it serves the CD
dashboard's own address shapes so that console consumes it unchanged
(`apps/deploy/deploy.go:13-15`) — a wire dialect implemented, not code
inherited.

## Rationale

The alternative to reading the cluster is keeping a deployment database and
reconciling it against reality — a second copy of state whose one failure mode,
drift, is exactly what a CD plane exists to expose. Reading the CRs directly
means the plane can be wrong only by being stale, never by disagreeing.

## Security Considerations

The wrong implementation is a cluster console handed to tenants. Three
boundaries hold it: writes require the SuperAdmin predicate, org reads are
filtered by the org label resolved from the validated principal (never a
header), and Secrets are excluded from the tree at the GVR list, so no query
shape can reach them. The OIDC flow fails closed — a missing verifier or public
URL disables sign-in rather than weakening it (`apps/deploy/login.go:119-121`).

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
