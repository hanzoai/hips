---
hip: 0106
title: Cloud — Unified Hanzo Binary
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-05-19
requires: HIP-0014, HIP-0026, HIP-0027, HIP-0037, HIP-0105, HIP-0302
---

# HIP-106: Cloud — Unified Hanzo Binary

## Abstract

This proposal defines `cloud` — a single Go binary that imports every
Hanzo-native subsystem as a package and dispatches requests to them by
HTTP path, subsystem flag, or per-deployment configuration. The same
binary powers `api.hanzo.ai`, `api.osage.cloud`, `api.lux.cloud`,
`api.zoo.cloud`, and every other white-label resold cloud surface.
Brand, enabled subsystems, and tenant scope are deployment
configuration; the binary is the same artifact across all.

**Naming note (2026-05-19 rename)**: the unified binary lives at
`hanzoai/cloud` (this repo); the former LLM-control-plane content
that used to live at `hanzoai/cloud` was renamed to `hanzoai/ai` and
is now mounted as the `ai` subsystem inside this binary. **White-label
fork target is `hanzoai/cloud`** — customers fork this one repo to
launch their own ecosystem.

**Inter-subsystem contract**: ZAP (the Hanzo native binary protocol).
Every subsystem ships its public interface as a `.zap` schema; `zapc`
generates Go/TS/Python/Rust bindings; `cloud` wires the in-process
ZAP-typed Go interfaces when subsystems are co-resident, falls back to
ZAP RPC over the wire when split. **No `.capnp` files anywhere in
Hanzo-authored code.**

The substrate this HIP depends on landed in HIP-0105 (in-process
extension runtime). HIP-0106 is what you build *on top of* HIP-0105 to
fold the existing Hanzo Go services into a single multi-tenant
supervised process.

## Motivation

Today Hanzo ships ~11+ Go-native services as independent binaries: IAM,
Base, KMS, Gateway, Ingress, Commerce, AI (LLM control plane subsystem), o11y,
AMQP, MCP (Go path), DNS, VFS, MQ, Authz, Agents. Each gets its own
Dockerfile, Helm chart, deploy lane, CI workflow, release cadence, and
observability spine. For Hanzo this is acceptable — we operate the
cluster. For **white-label resell** (`lux.cloud`, `zoo.cloud`,
`osage.cloud`, and others) it's not: every customer needs the same
constellation of services, isolated per-tenant, billed per-tenant,
auth'd against unified IAM. Shipping 11+ binaries × N customers × 3
environments multiplies operational surface beyond what a small team
should run.

The audit at `~/work/hanzo/AUDIT_2026_05_19.md` confirms ~35 Go-native
services structurally ready for inclusion, of which **3 already export
`func Mount(r, deps)`** — `commerce`, `gateway`, and `vfs`. These are
the reference implementations.

The unified binary collapses this:

1. **One artifact**, `ghcr.io/hanzoai/cloud:vX.Y.Z`, that contains
   every Hanzo Go subsystem as compiled code.
2. **Deployment configuration** at startup enables a subset of subsystems
   (`cloud --enable=iam,base,kms,commerce,gateway,ai`).
3. **Per-tenant routing** at request time: `X-Org-Id` from JWT picks
   the tenant's Base instance, KMS namespace, IAM application, and brand.
4. **Multi-tenant Base** at the storage layer per HIP-0302: each tenant
   org gets its own per-tenant data file (`data/{orgSlug}.db` for the
   SQLite backend, equivalent path for the ZapDB backend) with a
   per-org HKDF-derived DEK from a master key in KMS. **Replicate
   works for both backends** — SQLite WAL streaming and ZapDB-native
   log shipping use the same age-encrypted GCS bucket sink. Already
   the pattern in `~/work/hanzo/iam` and `~/work/hanzo/base`; this HIP
   makes it the universal contract.
5. **Unified IAM auth** at the boundary per HIP-0026: every subsystem
   trusts JWTs from one shared `iam.hanzo.id` JWKS endpoint. Gateway
   strips client-supplied identity headers, mints validated ones from
   the JWT, forwards in-process.
6. **ZAP-typed interfaces** between subsystems. Same generated Go code
   serves both in-process direct calls and over-wire RPC. Bootnode and
   other subsystems already use this pattern via `zapc` (the Hanzo ZAP
   compiler, Rust impl at `~/work/hanzo/zap/zapc-rs/`) today.

## Specification

### Canonical Hanzo Go stack

The unified binary is opinionated. Every subsystem uses the same Go
substrate. **One way to do everything.** No parallel frameworks, no
parallel ORMs, no parallel loggers, no parallel wire formats.

| Concern | Canonical | Notes |
|---|---|---|
| Web framework | `hanzoai/zip` | The ONE Go web framework. Built on Fiber v3 / fasthttp (implementation detail). Sinatra/Express-style primary API. **No `.Fast` escape hatch — zip is fast.** |
| ORM | `hanzoai/orm` | Backends: SQLite (today), PostgreSQL/MySQL/MSSQL/Oracle via `dbx` (wiring pending), ZapDB via `luxfi/database`, CR-SQLite for client-side distributed (license-permitting). |
| Logger | `luxfi/log` | NEVER `uber-go/zap`, NEVER `log/slog`, NEVER stdlib `log`. |
| Wire protocol | ZAP | Every subsystem ships `<svc>/schema/<name>.zap`. `zapc` generates Go/TS/Py/Rust bindings. No `.capnp` files in Hanzo-authored source. |
| Storage durability | `hanzoai/replicate` over `hanzo/vfs` | Per HIP-0107 (streaming replication over vfs). Covers SQLite WAL, ZapDB log, blockchain state, generic logs through one pipeline. |
| Object store interface | `hanzo/vfs` | The ONLY object-store interface. All sink-side bytes route through vfs. |
| Analytical store | `hanzoai/datastore-go` | Separate from `orm`. NOT an ORM backend — different workload class. |

**Migration adapters (transitional only, not parallel ways to build new
services):** `zip.AdaptNetHTTP(http.Handler)`,
`zip.AdaptNetHTTPFunc(http.HandlerFunc)`,
`zip.AdaptNetHTTPMiddleware(func(http.Handler) http.Handler)`, and
`app.Mount(prefix, http.Handler)` as the path-prefixed mount form.
`chi.Router`, `gin.Engine`, and `beego.App.Handlers` all satisfy
`http.Handler` natively, so the same adapter covers every legacy
framework — no per-framework wrapper needed. These exist so existing
chi/beego/gin code can be wrapped into a zip mount without a same-day
rewrite. **New code must be written natively against zip.** Adapters
cost ~5% per-request perf versus native Fiber dispatch and that cost
compounds at high RPS; replace adapted routes when feasible.

The framework itself is **`hanzoai/zip` v0.1.0+** on `feat/fiber-v3`
(commit train rebuilds upstream zeekay/zip from scratch on Fiber v3;
see `hanzoai/zip` PR #1). zip is the ONE web framework. chi / gin /
beego / echo are MIGRATION-ONLY and never appear in new Hanzo Go code.

### Process model

`cloud` is a single process exposing:

- One HTTP listener (default `:8080`) that fans out to subsystem
  handlers by URL prefix (`/v1/iam/...`, `/v1/base/...`, etc.)
- One ZAP RPC listener (default `:9653`) for service-to-service auth
  and inter-subsystem calls when split across binaries
- One health/metrics endpoint at `:9090`
- One admin endpoint at `:8081` (gated by IAM admin role)

Subsystem activation:

```bash
cloud \
  --enable=iam,base,kms,commerce,gateway,ai,o11y \
  --brand=osage \
  --domain=osage.cloud \
  --iam-issuer=https://iam.hanzo.id \
  --kms-master-key-ref=kms://hanzo/cloud/osage/master \
  --data-dir=/var/lib/cloud
```

Each subsystem flag enables that subsystem's HTTP routes, ZAP services,
and background workers. Disabled subsystems contribute zero runtime
cost beyond the compiled code in the binary.

### Subsystem boundaries

Each Hanzo Go service exposes a single
`Mount(app *zip.App, deps cloud.Deps) error` function (canonical
signature; the old `chi.Router`-based shape is migrated through the
`zip.AdaptChi` adapter). `cloud`'s `main.go` is essentially:

```go
import (
    "github.com/hanzoai/zip"
    "github.com/hanzoai/iam"
    "github.com/hanzoai/base"
    "github.com/hanzoai/kms"
    "github.com/hanzoai/commerce"
    "github.com/hanzoai/ai"      // LLM control plane subsystem (was hanzoai/cloud pre-rename)
    "github.com/hanzoai/gateway"
    "github.com/hanzoai/o11y"
    "github.com/hanzoai/vfs"
    "github.com/hanzoai/mq"
    "github.com/hanzoai/dns"
    "github.com/hanzoai/amqp"
    "github.com/hanzoai/mcp"
    "github.com/hanzoai/cloud"
)

func main() {
    cfg := cloud.LoadConfig()
    deps := cloud.BuildDeps(cfg)
    app := zip.New()

    if cfg.Enabled("iam")      { iam.Mount(app, deps)      }
    if cfg.Enabled("kms")      { kms.Mount(app, deps)      }
    if cfg.Enabled("base")     { base.Mount(app, deps)     }
    if cfg.Enabled("commerce") { commerce.Mount(app, deps) }
    if cfg.Enabled("ai")       { ai.Mount(app, deps)       }
    if cfg.Enabled("gateway")  { gateway.Mount(app, deps)  }
    if cfg.Enabled("o11y")     { o11y.Mount(app, deps)     }
    if cfg.Enabled("vfs")      { vfs.Mount(app, deps)      }
    if cfg.Enabled("mq")       { mq.Mount(app, deps)       }
    if cfg.Enabled("dns")      { dns.Mount(app, deps)      }
    if cfg.Enabled("amqp")     { amqp.Mount(app, deps)     }
    if cfg.Enabled("mcp")      { mcp.Mount(app, deps)      }
    // ...

    cloud.Serve(app, cfg)  // HTTP + ZAP RPC + admin
}
```

This means **every existing Go service must expose a `Mount` function**
in addition to its `cmd/<service>/main.go`. The `main.go` becomes a
thin shim that calls `Mount` on its own; `cloud`'s main calls the
same `Mount` from its own binary. No business logic moves.

Reference implementations already in tree (per `AUDIT_2026_05_19.md`):
**`commerce`, `gateway`, `vfs`** — these export `Mount(...)` today. New
subsystems join by mirroring their shape.

### ZAP schema contract

Every subsystem ships a public `.zap` schema describing its in-process
and over-wire interface. Build pipeline:

```
<subsystem>/
  schema/<name>.zap       # public typed interface
  zap/gen/                # zapc-generated bindings (Go for our use, others optional)
    <name>.go             # generated structs + interfaces
    <name>_server.go      # server-side handlers
    <name>_client.go      # typed client (in-process or RPC)
  Makefile / build.sh     # `zapc generate <schema>.zap --lang go --out ./zap/gen/`
```

`zapc` is the Rust-implemented Hanzo ZAP compiler at `~/work/hanzo/zap/zapc-rs/`.
Multi-language codegen: `zapc generate file.zap --lang {go,ts,py,rust}`.

When `cloud` runs subsystems in-process: each `Mount(...)` registers
its `*_server.go` against the local ZAP dispatcher, and the typed
client interfaces in `deps` resolve to **direct Go function calls
through the ZAP runtime** (no marshalling, no network). When subsystems
are split: same generated client makes ZAP RPC calls over the
wire. Same business code in either mode.

**Existing `.zap` schemas in production** (real, not aspirational):
- `~/work/hanzo/ai/ai.zap` (was `~/work/hanzo/cloud/cloud.zap` pre-rename) — LLM control plane types (ChatMessage, ModelProvider, ChatCompletion)
- `~/work/hanzo/commerce/api/billing/billing.zap` — billing schemas
- `~/work/hanzo/tasks/schema/tasks.zap` — task scheduling
- `~/work/hanzo/zap/rust/schema/zap.zap` — self-describing schema

Subsystems with generated bindings under `<svc>/zap/`:
`python-sdk/proto/zap`, `kv/modules/zap`, `playground/internal/zap`,
`hanzo.ai/components/zap`, `platform/pkg/zap`, `mcp/dist/zap`,
`dev/hanzo-dev/zap`, `docdb/internal/zap`, `vector/src/zap`. At least
10+ subsystems already on the pattern.

**Policy**: no `.capnp` files. No "Cap'n Proto" identifiers in
Hanzo-authored source. ZAP is Hanzo-native and is the only thing the
public surface knows about. (Brand-policy parity with @hanzo/gui / Zen
MoDE — see CLAUDE.md.)

### Tenant isolation

| Layer | Today | Under HIP-106 |
|---|---|---|
| **Auth** | Per-domain IAM (multi-tenant) | Unchanged. IAM resolves `(app, org)` from origin; subsystems see JWT claims via `X-Org-Id`. |
| **Storage** | Per-service postgres or per-tenant SQLite (varies) | Always per-tenant SQLite (`{data-dir}/orgs/{org}/{service}.db`) with per-org DEK per HIP-0302. No postgres in the unified path. |
| **KMS** | Per-org master keys today | Unchanged. KMS in-process serves `kms://<deployment>/<org>/<purpose>` references. |
| **Cache** | Per-service Redis (varies) | Process-local LRU or per-org sub-buckets in shared in-memory cache. No Redis. |
| **Brand** | Per-domain detection in app code | `cfg.Brand` at startup; subsystems read brand from deps; UI templates resolved from embedded assets. |

### Subsystem-to-subsystem calls

In the unified binary, IAM, KMS, Base, Commerce, Cloud, etc. live in
the **same process address space**. Inter-subsystem calls are
**ZAP-typed Go function calls** via the deps:

```go
type Deps struct {
    IAM        iamzap.Client       // generated from iam/schema/iam.zap
    KMS        kmszap.Client       // generated from kms/schema/kms.zap
    Base       basezap.Client      // generated from base/schema/base.zap
    Commerce   commercezap.Client  // generated from commerce/schema/commerce.zap
    Cloud      cloudzap.Client     // generated from cloud/schema/cloud.zap
    O11y       o11yzap.Client      // generated from o11y/schema/o11y.zap
    BrandCfg   brand.Config
}
```

Each generated `Client` has two implementations:

- **in-process** (direct method calls through the local ZAP dispatcher)
- **RPC** (ZAP-typed RPC over the wire)

`cloud` wires in-process. Legacy split deploys wire RPC. Same
business code in either mode. **Every subsystem boundary is typed end
to end** via the `.zap` schema.

### Extension surface

User-supplied code inside the unified binary uses the in-process
extension runtime from HIP-0105:

- Per-record hooks in Base → **goja** (per HIP-0105 scale findings:
  goja wins multi-tenant SaaS at scale)
- Per-request policy rules in Gateway → **wazero** (untrusted) or
  **native** (Hanzo-authored)
- Custom prompt transforms for AI (LLM control plane subsystem) → **wazero**
- Custom tool functions for Agents → **wazero**

The extension runtime IS the user-code boundary inside the unified
process. Don't shell out, don't spawn sidecars, don't run Knative pods
for per-request hooks. HIP-0060 (Functions) handles the workloads where
those overheads are justified.

### Multi-language handlers

HIP-0105 defines two mount points (in-process Base hooks AND web routes
via `hanzoai/zip`). The unified binary uses **mount point #2** to allow
service routes themselves to be authored in any HIP-0105-supported
language:

| Language | Runtime name | Mount path |
|---|---|---|
| Go (Hanzo-authored) | native | direct in-process — default for all service code |
| Rust / C++ / Zig / AssemblyScript | `wasm` (wazero) | compiled to `*.wasm`, loaded under `hz_routes/<name>/` |
| JavaScript / TypeScript | `goja` (production) or `v8go` (experimental) | source files loaded directly |
| Python | `pyvm` (single-tenant only, `-tags pyvm`) | CPython 3.13 sub-interpreter pool |
| DSL / policy | `starlark` | sandboxed, deterministic, no I/O by default |

**Every HIP-0105 runtime is mountable as a route via the SAME entry
point**: `app.Module(method+path, runtimeName, modulePath)`. One method
on the zip.App; one canonical JSON envelope shape (`{method, path,
params, query, headers, body, org, user, userEmail}`) every guest
sees; one response envelope (`{status, headers, body}`) every guest
returns. There is no per-runtime mount API — `app.ModuleWasm` /
`app.ModuleGoja` / `app.ModulePython` do not exist on purpose. One way.

```go
app.Module("POST /v1/policy/eval",  "wasm",     "./ext/policy")    // Rust/AS/Zig/C → wasm via wazero
app.Module("POST /v1/transform",    "pyvm",     "./ext/transform") // single-tenant CPython
app.Module("POST /v1/webhook",      "goja",     "./ext/webhook")   // recommended multi-tenant JS
app.Module("POST /v1/route",        "starlark", "./ext/route")     // config DSL
```

The route author writes their handler in their preferred language; the
same `.zap` schemas generate the same I/O types across all of them.
Crash isolation, cancellation semantics, and scale characteristics are
exactly as described in HIP-0105. The loader is **duck-typed** via
`zip/runtime.Loader` so zip itself stays decoupled from
`hanzoai/base/plugins/extruntime` (the canonical loader implementation);
the unified binary constructs `*extruntime.Loader` once with whichever
runtimes it cares about and threads it into `zip.Config.Loader`.

Multi-tenant deployments MUST gate `AllowedRuntimes` on `zip.Config` to
exclude runtimes lacking hard sandbox (pyvm, v8go). `AllowedRuntimes:
nil` accepts whatever the Loader has registered.

### Deployment surfaces this enables

| Deployment | Brand | Enabled subsystems | Domain |
|---|---|---|---|
| Hanzo flagship | hanzo | all | api.hanzo.ai |
| Osage Cloud | osage | iam, base, kms, commerce, ai, gateway, o11y, vfs | api.osage.cloud |
| Lux Cloud | lux | iam, base, kms, gateway, chain | api.lux.cloud |
| Zoo Cloud | zoo | iam, base, kms, ai, gateway, vfs | api.zoo.cloud |
| Customer X (reseller) | custom | iam, base, kms, commerce, gateway | api.x.com |

Same image. Different startup configuration. The `osage.cloud`
marketing site that shipped 2026-05-19 gets a real backend when this
HIP lands.

## Migration plan

Multi-week real engineering. Order revised from `AUDIT_2026_05_19.md`
findings:

### Phase 1 — Mount contract on reference + smallest services (1 week)

Per `AUDIT_2026_05_19.md`, three subsystems **already export
`Mount(...)`**: **`commerce`, `gateway`, `vfs`**. These are the
reference impls — Phase 1 first reshapes their signatures to the
canonical `(*zip.App, Deps) error` form, then extends the same shape
to the smallest remaining services:

**Reference impls (already Mount-shaped):**

1. **commerce** — production, multi-tenant (37 X-Org-Id call-sites),
   IAM-integrated, `Mount` exists. Reshape `Deps` to the canonical
   interface and use it as the live blueprint.
2. **gateway** — `Mount` exists. Validate that the subsystem can be
   both standalone and embedded.
3. **vfs** — `Mount` exists. Smallest of the three.

**Smallest remaining services to bring to the Mount contract:**

4. **kms** — smallest service still needing `Mount`; clean deps.
5. **dns** — small, no auth dep.
6. **amqp** — small, no auth dep.
7. **authz** — first to consume `deps.IAM`.

**Explicitly excluded from Phase 1 (and from the unified binary
entirely):**

- **`vault`** — PCI-CDE. Folding it into a multi-tenant process
  expands PCI scope to every other tenant. Stays its own deployment.
  See Non-goals.

### Phase 2 — Ship `cloud` (1 week)

`~/work/hanzo/cloud/cmd/cloud/main.go` — new repo
`github.com/hanzoai/cloud`. Imports the seven subsystems from
Phase 1, wires Deps, dispatches by subsystem flag. Ship as
`ghcr.io/hanzoai/cloud:v0.1.0`. Single-tenant smoke deployment at
a dev domain first.

### Phase 3 — Fold the heavy subsystems (2 weeks)

8. **iam** — has its own SPA; mount handlers without changing SPA
9. **base** — `plugins/extruntime`, `plugins/jsvm`, `plugins/wasmvm`
   must remain isolated per-org (per HIP-0105)
10. **o11y** — heaviest multi-tenant footprint (309 X-Org-Id call-sites
    per audit). Get this right and the per-tenant routing pattern is
    proven for everything else.
11. **ai** (LLM control plane per HIP-0037) — mount existing routes
12. **mcp** — depends on iam
13. **mq** — depends on base for durability
14. **ingress** — depends on gateway routes

### Phase 4 — Tenant routing layer (1 week)

Universal `X-Org-Id` gating at the unified mux entry. Per-tenant data
isolation enforced by Base. KMS reference resolution scoped to the
calling org. Telemetry tagged with org.

### Phase 5 — Reseller provisioning + operator convergence (1 week)

Operator CRD `ResellerCloud{name, parentOrg, brand, enabledSubsystems}`
that creates the IAM app + KMS namespace + Base storage allocation +
Gateway routes atomically. Documented at
`~/work/hanzo/cloud/docs/RESELLER.md`. Self-serve resell becomes
possible.

**Operator convergence (BLOCKER for Phase 5).** The audit identified
three parallel operator lineages:

- `~/work/hanzo/operator` (Go)
- `~/work/hanzo/hanzo-operator` (Go, production)
- `~/work/hanzo/operator-core` (Rust)

Phase 5 cannot ship until one is picked and the other two are either
folded in or archived. Recommended path: keep `hanzo-operator` (the
production lineage with the existing ClusterRole), fold the
`ResellerCloud` CRD into it, archive `operator/`, and demote
`operator-core` to a Rust library (`library-no-action` per audit) for
shared CRD types. Decision required before Phase 5 starts.

### Phase 6 — Billing wiring (separate HIP follow-up)

Commerce subsystem reads per-tenant usage from base + o11y/ClickHouse
and applies the reseller revenue-share contract. **`commerce` is the
canonical billing/pricing/subscription home** — the TS `billing` and
`pricing` packages get absorbed into `commerce` via Go rewrites.

**Note on `auto`**: the earlier audit grouped `auto` with billing/pricing
for commerce absorption. **This was wrong.** `~/work/hanzo/auto` is a
plug-n-play IFTT-style trigger framework that sits on top of
`~/work/hanzo/tasks` (durable task queue). It is **NOT** under commerce.
`auto` is its own subsystem and mounts independently. `tasks` is its own
subsystem — the durable-queue primitive used by `auto`, by `commerce`
recurring billing, by `o11y` retention jobs, and by anything else that
needs durable scheduling.

## Commerce — light router, NOT in PCI-DSS scope

**Commerce is a thin orchestrator.** It owns the customer-facing checkout
flow, tenant config, billing logic, pricing logic, invoicing, and
webhook intake. It explicitly does NOT:

- Touch a Primary Account Number (PAN)
- Process card data
- Implement processor connector logic (Stripe SDK /
  Adyen SDK)
- Store encrypted PAN

Commerce only handles **tokens** (vault tokens) and **intents**
(payments-orchestrator references). When commerce needs to charge, it
calls `payments` (Rust) via ZAP RPC with a token + amount + processor
hint. Payments calls `vault` (Go) via ZAP RPC with a "Charge this token"
request; vault pulls the PAN from its encrypted store, makes the
outbound HTTPS to the processor, and returns the response. **PAN never
leaves vault.**

This makes commerce **CDE-connected**, not **CDE**. Lighter controls
apply (network segmentation, access control, change management) but
commerce is NOT subject to PCI-DSS L1 audit.

## Solo-vault CDE

**Vault is the only system in PCI-CDE.** Per the corrected scope:

| System | PCI scope |
|---|---|
| `vault` | **CDE** — the only system that touches PAN. Full L1 audit. Quarterly ASV. HSM-backed key store. Own deployment, own k8s namespace, own NetworkPolicy boundary. |
| `payments` | **CDE-connected** (NOT CDE). Sees only tokens. Payments service operated in tokens-only mode. Calls `vault.Charge(token, processor, amount)` for the actual processor call. |
| `commerce` | **CDE-connected** (NOT CDE). Light router. Only ever handles tokens + intent IDs. Mounts inside cloud like any other subsystem. |
| Everything else in cloud | **Not CDE-connected.** Standard SOC2-grade controls. |

For this architecture to be sound, two requirements must hold:

1. **Browser-side card collection runs directly against vault** (vault
   ships a `vault-collect.js` iframe; PAN posts directly to vault from
   the browser, never via commerce or any Hanzo app server).
2. **Payments runs in tokens-only mode** — verified by
   audit of payments data flow that no code path exposes raw PAN to
   the surrounding Go process.

Both are tracked under the implementation TODO list at
`~/work/hanzo/vault/docs/` (to be created).

## PSP optionality

The same architecture supports four deployment modes:

1. **Default (Hanzo as merchant)**: Hanzo operates vault + payments +
   commerce. Hanzo bears the PCI-DSS L1 audit. PCI scope = vault only.

2. **Hanzo as PSP for a white-label customer**: customer's brand
   (`lux.cloud`, `zoo.cloud`, `osage.cloud`) runs commerce inside their
   cloud deployment; commerce's `payments_client` and `vault_client`
   ZAP endpoints point at Hanzo's payments + vault. Customer carries no
   PCI obligation. Hanzo's vault has multi-tenant token namespacing per
   org.

3. **Customer brings their own PSP backend**: customer deploys their own
   vault + payments. Their cloud's commerce subsystem points its
   ZAP-RPC endpoints at THEIR vault + payments deployment. **Hanzo
   carries no PCI obligation for that customer's flows.** The customer
   holds their own PCI scope. Commerce is a swappable thin router.

4. **Single-tenant Hanzo Payments-as-a-product**: customer's ENTIRE
   commercial unit is payment-processing. Deploy payments + vault + a
   trimmed cloud as a unit. Commerce still operates as light router
   — no design change, only deployment shape.

Modes 1-3 share the same binary. Configuration determines which
endpoints commerce talks to. The "swappable thin router" property is
load-bearing: commerce never grows code that depends on a specific
vault or payments operator.

## Non-goals

- **TS service rewrite as part of this HIP.** Platform (Next.js /
  Dokploy fork), brain (where still TS), bot, billing, pricing
  (separate Go rewrites slated under commerce subsumption). They can
  be ported to Go later if performance or operations require it; this
  HIP does not block on them.
- **`vault` and `payments` are explicitly NOT folded.** Both stay as
  their own deployments with their own PCI scope boundaries per the
  "Solo-vault CDE" section above. Vault is CDE. Payments is
  CDE-connected. Commerce talks to both via ZAP RPC. **Hard rule, no
  exceptions** — even single-tenant deployments use the three-process
  architecture.
- **`~/work/hanzo/flow` (Hanzo Flow — visual ML pipeline / agent-building) is NOT folded.** Visual ML
  pipeline / agent-building tool. Heavy native deps (torch, faiss,
  sentence-transformers). Runs as a separate process behind the
  gateway subsystem. Per the FT audit (2026-05-19), classified RED
  — defer to GIL-Python until torch ships cp313t (>=2.6).
- **`~/work/hanzo/datastore` (ClickHouse fork) is NOT folded.** OLAP
  column store. Uses ClickHouse-native ReplicatedMergeTree + S3 disk.
  Out of scope. Shares S3 bucket with HIP-0107 streaming via vfs
  prefix (`s3://bucket/datastore/...` vs `s3://bucket/replicate/...`).
- **`~/work/hanzo/insights` (Hanzo Insights — AI observability + eval + prompt management) is NOT
  folded.** Runs as a separate process — the canonical AI console
  for cloud-hosted LLM operations. Integrates with cloud via
  HTTP + (forthcoming) ZAP-typed endpoints; consumed by the `cloud`
  subsystem (LLM control plane) and surfaced to operators as part of
  the AI console.
- **Other Python services flagged RED by the 2026-05-19 free-threading
  audit** (`cli`, `erp`, `insights`, `sentry`, `studio`) — all stay
  separate processes until their upstream FT-blockers clear
  (xmlsec, confluent-kafka, chdb, single-threaded Django/Celery
  assumptions, torch <2.6). Run under regular `python3.13`
  (GIL-enabled) until then.
- **Cross-deployment service mesh.** The unified binary collapses
  in-deployment service calls; cross-deployment (Hanzo ↔ Lux ↔ Zoo)
  stays on the existing service-discovery + bridge layer.
- **Auto-scaling per-subsystem.** All subsystems in one binary scale
  together. If a subsystem becomes a hot bottleneck, fall back to
  running it as its own binary alongside the unified one — the Mount
  contract supports both.

## Open questions

1. **Cold start under load** — single binary with all subsystems boots
   slower than a focused service. Acceptable for long-lived
   deployments; needs measurement for fast-restart scenarios. Suggest
   benchmarking on Phase 2.

2. **Per-subsystem memory budgets** — one OOM kills every subsystem.
   Acceptable trade-off for resell where blast radius is per-customer
   anyway, but Hanzo flagship may want to keep some subsystems split.

3. **Routes that conflict** — `/v1/iam/...`, `/v1/base/...`,
   `/v1/commerce/...`, etc. Already mostly per-subsystem-prefixed.
   The unified mux compiles a route table at startup and refuses to
   start on collision.

4. **Build-time flags vs runtime flags** — for production we want
   every subsystem compiled in. For developer builds we might want to
   disable some at build time to shrink the binary. Suggest both: Go
   build tags for compile-time, CLI flags for runtime.

5. **ZAP versioning** — when a subsystem evolves its `.zap` schema,
   how do we manage cross-version compat? Suggest semver on the
   `.zap` file itself (`@version 1.2.0` directive) and `zapc`
   refusing breaking changes without an explicit major bump. Tracked
   for follow-up.

6. **Three competing operator lineages** — `operator/`,
   `hanzo-operator/`, `operator-core/` (Rust). Audit flagged for
   convergence. Phase 5 (reseller provisioning) is blocked on
   picking one. Suggest dedicated session for the operator decision
   before Phase 5 starts.

## References

- Reference: Discord (single binary serving all microservices),
  Tailscale (one tailscaled), GitLab (omnibus)
- `~/work/hanzo/AUDIT_2026_05_19.md` — ecosystem audit driving the
  migration order
- HIP-0014 — Application Deployment Standard (per-service binaries
  today)
- HIP-0026 — IAM (unified auth across the deployment)
- HIP-0027 — KMS (unified secrets store)
- HIP-0037 — AI Cloud Platform (the **subsystem** the existing
  `~/work/hanzo/cloud` provides — NOT the unified binary)
- HIP-0105 — In-Process Extension Runtime (the user-code substrate
  inside the unified binary)
- HIP-0300 — Unified MCP Tools Architecture (the MCP subsystem inside
  the binary)
- HIP-0301 — Agent Runtime Protocols & Cross-Platform Parity (agents
  subsystem must satisfy)
- HIP-0302 — Hanzo Replicate: Encrypted SQLite + ZapDB Durability for
  Base Services (the per-tenant data isolation model — covers both
  Base's SQLite backend AND ZapDB-backed deployments)
- HIP-0107 — Streaming Replication over VFS (the unified streaming
  pipeline; supersedes the per-backend sink code in HIP-0302's reference
  impl — substrate stays, transport unifies)
