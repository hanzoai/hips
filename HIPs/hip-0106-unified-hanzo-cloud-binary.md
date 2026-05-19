---
hip: 0106
title: Unified Hanzo Cloud Binary
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-05-19
requires: HIP-0014, HIP-0026, HIP-0027, HIP-0037, HIP-0105
---

# HIP-106: Unified Hanzo Cloud Binary

## Abstract

This proposal defines `hanzo-cloud` — a single Go binary that imports every
Hanzo-native subsystem as a package and dispatches requests to them
by HTTP path, subsystem flag, or per-deployment configuration. The same
binary powers `api.hanzo.ai`, `api.osage.cloud`, `api.lux.cloud`,
`api.zoo.cloud`, and every other white-label resold cloud surface. Brand,
enabled subsystems, and tenant scope are deployment configuration; the
binary is the same artifact across all.

The substrate this HIP depends on landed in HIP-0105 (in-process extension
runtime). HIP-0106 is what you build *on top of* HIP-0105 to fold the
existing Hanzo Go services into a single multi-tenant supervised process.

## Motivation

Today Hanzo ships ~11 Go-native services as independent binaries: IAM,
Base, KMS, Gateway, Ingress, AMQP, MCP, DNS, Analytics, Authz, Agents.
Each gets its own Dockerfile, Helm chart, deploy lane, CI workflow,
release cadence, and observability spine. For Hanzo this is acceptable —
we operate the cluster. For **white-label resell** (`lux.cloud`,
`zoo.cloud`, `osage.cloud`, and others) it's not: every customer needs the
same constellation of services, isolated per-tenant, billed per-tenant,
auth'd against unified IAM. Shipping 11 binaries × N customers × 3
environments multiplies operational surface beyond what a small team
should run.

The unified binary collapses this:

1. **One artifact**, `ghcr.io/hanzoai/cloud:vX.Y.Z`, that contains every
   Hanzo Go subsystem as compiled code.
2. **Deployment configuration** at startup enables a subset of subsystems
   for that deployment (`hanzo-cloud --enable=iam,base,kms,gateway`).
3. **Per-tenant routing** at request time: `X-Org-Id` from JWT picks the
   tenant's Base instance, KMS namespace, IAM application, and brand
   surface.
4. **Multi-tenant Base** at the storage layer: each tenant org gets its
   own SQLite file under `data/{orgSlug}.db` with a per-org HKDF-derived
   DEK from a master key in KMS. Already the pattern in `~/work/hanzo/iam`
   and `~/work/hanzo/base`; this HIP makes it the universal contract.
5. **Unified IAM auth** at the boundary: every subsystem trusts JWTs from
   one shared `iam.hanzo.id` JWKS endpoint. Gateway strips client-supplied
   identity headers, mints validated ones from the JWT, and forwards to
   the in-process subsystem. Same flow whether the caller hits
   `api.hanzo.ai`, `api.lux.cloud`, or `api.zoo.cloud`.

## Specification

### Process model

`hanzo-cloud` is a single process exposing:

- One HTTP listener (default `:8080`) that fans out to subsystem handlers
  by URL prefix
- One ZAP RPC listener for service-to-service auth
- One health/metrics endpoint at `:9090`
- One admin endpoint at `:8081` (gated by IAM admin role)

Subsystem activation:

```bash
hanzo-cloud \
  --enable=iam,base,kms,gateway,brain \
  --brand=osage \
  --domain=osage.cloud \
  --iam-issuer=https://iam.hanzo.id \
  --kms-master-key-ref=kms://hanzo/cloud/osage/master \
  --data-dir=/var/lib/hanzo-cloud
```

Each subsystem flag enables that subsystem's routes, ZAP services, and
background workers. Disabled subsystems contribute zero runtime cost
beyond the compiled code in the binary.

### Subsystem boundaries

Each Hanzo Go service exposes a single `Mount(r chi.Router, deps Deps) error`
function. `hanzo-cloud`'s `main.go` is essentially:

```go
mux := chi.NewMux()
deps := buildDeps(cfg)        // IAM client, KMS client, telemetry, etc.
if cfg.Enabled("iam")     { iam.Mount(mux,     deps) }
if cfg.Enabled("base")    { base.Mount(mux,    deps) }
if cfg.Enabled("kms")     { kms.Mount(mux,     deps) }
if cfg.Enabled("gateway") { gateway.Mount(mux, deps) }
// ...
http.ListenAndServe(":8080", mux)
```

This means **every existing Go service must expose a `Mount` function** in
addition to its current `cmd/<service>/main.go`. The `main.go` becomes a
thin shim that calls `Mount` on its own; the unified binary calls the same
`Mount` from its own main. No business logic moves.

### Tenant isolation

| Layer | Today | Under HIP-106 |
|---|---|---|
| **Auth** | Per-domain IAM (multi-tenant) | Unchanged. IAM resolves `(app, org)` from origin; subsystems see JWT claims via X-Org-Id. |
| **Storage** | Per-service postgres or per-tenant SQLite (varies) | Always per-tenant SQLite (`{data-dir}/orgs/{org}/{service}.db`) with per-org DEK. No postgres in the unified path. |
| **KMS** | Per-org master keys today | Unchanged. KMS in-process serves `kms://<deployment>/<org>/<purpose>` references. |
| **Cache** | Per-service Redis (varies) | Process-local LRU or per-org sub-buckets in shared in-memory cache. No Redis. |
| **Brand** | Per-domain detection in app code | `cfg.Brand` at startup; subsystems read brand from deps; UI templates resolved from embedded assets. |

### Subsystem-to-subsystem calls

In the unified binary, IAM, KMS, Base, etc. live in the **same process
address space**. Inter-subsystem calls are **direct Go function calls**,
not HTTP. The `Deps` struct passed to `Mount` carries Go-native client
interfaces:

```go
type Deps struct {
    IAM        iam.Client      // direct in-process client when iam is enabled, HTTP otherwise
    KMS        kms.Client
    Base       base.Client
    Telemetry  *telem.Client
    BrandCfg   brand.Config
}
```

Each subsystem's `Client` interface has two implementations: an
**in-process** implementation (direct method calls) and an **HTTP**
implementation (when the subsystem runs in a separate process). The
unified binary wires in-process; legacy split deploys wire HTTP. Same
business code in either mode.

### Extension surface

User-supplied code inside the unified binary uses the in-process extension
runtime from HIP-0105:

- Per-record hooks in Base → goja or wazero
- Per-request policy rules in Gateway → wazero (untrusted) or native (Hanzo-authored)
- Custom prompt transforms for LLM Gateway → wazero
- Custom tool functions for Agents → wazero

The extension runtime IS the user-code boundary inside the unified
process. Don't shell out, don't spawn sidecars, don't run Knative pods
for per-request hooks. HIP-0060 (Functions) handles the workloads where
those overheads are justified.

### Deployment surfaces this enables

| Deployment | Brand | Enabled subsystems | Domain |
|---|---|---|---|
| Hanzo flagship | hanzo | all | api.hanzo.ai |
| Osage Cloud | osage | iam, base, kms, brain, gateway, storage, compute | api.osage.cloud |
| Lux Cloud | lux | iam, base, kms, gateway, chain | api.lux.cloud |
| Zoo Cloud | zoo | iam, base, kms, brain, gateway, storage | api.zoo.cloud |
| Customer X (reseller) | custom | iam, base, kms, gateway | api.x.com |

Same image. Different startup configuration. The `osage.cloud` marketing
site that already shipped today (per the agent report 2026-05-19) gets a
real backend when this HIP lands.

## Migration plan

This is multi-week real engineering. It decomposes:

### Phase 1 — Mount contract (1 week)

For each Hanzo Go service, refactor `cmd/<svc>/main.go` to call
`svc.Mount(mux, deps)` instead of inlining handler registration. No
behavior change; just makes the package importable. Order by complexity:

1. **kms** — smallest, cleanest deps
2. **dns** — small, no auth dep
3. **amqp** — small, no auth dep
4. **authz** — depends on iam
5. **iam** — has its own SPA; mount handlers without changing SPA
6. **base** — has plugin/jsvm/extruntime — make sure these stay isolated per-org
7. **gateway** — depends on iam JWKS
8. **ingress** — depends on gateway routes
9. **brain** — depends on base, kms, iam
10. **mcp** — depends on iam
11. **analytics** — depends on base

### Phase 2 — Build the unified binary (1 week)

`~/work/hanzo/cloud/cmd/hanzo-cloud/main.go` — imports every subsystem
package, wires Deps, dispatches by subsystem flag. Ship as
`ghcr.io/hanzoai/cloud:vX.Y.Z`.

### Phase 3 — Tenant routing layer (1 week)

Universal X-Org-Id gating at the unified mux entry. Per-tenant data
isolation enforced by Base. KMS reference resolution scoped to the
calling org. Telemetry tagged with org.

### Phase 4 — Reseller provisioning (1 week)

Operator CRD `ResellerCloud` that creates the IAM app + KMS namespace +
Base storage allocation + Gateway routes atomically. Documented at
`~/work/hanzo/cloud/RESELLER.md`. Self-serve resell becomes possible.

### Phase 5 — Billing wiring (separate HIP, follow-up)

Hanzo Billing reads per-tenant usage from Base + ClickHouse, applies the
reseller revenue-share contract. Out of scope here; will get its own HIP.

## Non-goals

- **TS service rewrite as part of this HIP.** Platform (Next.js / Dokploy
  fork), Brain (if still TS), Bot, Billing remain separate. They can be
  ported to Go later if performance or operations require it; this HIP
  does not block on them.
- **Folding Python services.** LLM Gateway, AI inference paths, ML
  pipelines remain separate. They communicate with the unified binary
  via HTTP.
- **Cross-deployment service mesh.** The unified binary collapses
  in-deployment service calls; cross-deployment (Hanzo ↔ Lux ↔ Zoo) stays
  on the existing service-discovery + bridge layer.
- **Auto-scaling per-subsystem.** All subsystems in one binary scale
  together. If a subsystem becomes a hot bottleneck, fall back to running
  it as its own binary alongside the unified one — the Mount contract
  supports both.

## Open questions

1. **Cold start under load** — single binary with all subsystems boots
   slower than a focused service. Acceptable for long-lived deployments;
   needs measurement for fast-restart scenarios. Suggest benchmarking on
   Phase 2.

2. **Per-subsystem memory budgets** — one OOM kills every subsystem in
   the deployment. Acceptable trade-off for resell where blast radius is
   per-customer anyway, but Hanzo flagship may want to keep some
   subsystems split.

3. **Routes that conflict** — IAM, Base, KMS, Gateway all have `/v1/...`
   prefixes today. Either we enforce per-subsystem prefix
   (`/v1/iam/...`, `/v1/base/...`) — already mostly the case — or we
   compile a route table at startup and refuse to start on collision.

4. **Build-time flags vs runtime flags** — for production we want every
   subsystem compiled in. For developer builds we might want to disable
   some at build time to shrink the binary. Suggest both: Go build tags
   for compile-time, CLI flags for runtime.

## References

- Reference: Discord (single binary serving all microservices), Tailscale
  (one tailscaled), GitLab (omnibus)
- HIP-0014 — Application Deployment Standard (per-service binaries today)
- HIP-0026 — IAM (unified auth across the deployment)
- HIP-0027 — KMS (unified secrets store)
- HIP-0037 — AI Cloud Platform (the product surface this binary powers)
- HIP-0105 — In-Process Extension Runtime (the user-code substrate inside
  the unified binary)
- HIP-0300 — Unified MCP Tools Architecture (the MCP subsystem inside the
  binary will expose its 8 core tools through the unified handler mux)
- HIP-0301 — Agent Runtime Protocols & Cross-Platform Parity (agents
  subsystem in the unified binary must satisfy)
- HIP-0302 — Hanzo Replicate: Encrypted SQLite Durability for Base Services
  (the per-tenant SQLite isolation model this HIP relies on)
