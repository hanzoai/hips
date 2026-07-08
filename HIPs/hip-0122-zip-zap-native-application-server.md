---
hip: 0122
title: zip — The ZAP-Native Application Server Core
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Final
created: 2026-07-07
updated: 2026-07-08
requires: HIP-0026, HIP-0105, HIP-0114, HIP-0120
---

# HIP-0122: zip — The ZAP-Native Application Server Core

## Abstract

**zip** is the one Hanzo application server core: a high-performance
Go framework (Fiber v3 / fasthttp derived) whose primary transport is
**ZAP** (HIP-0114) and whose secondary transport is HTTP, selected as
a *value* on one verb — `app.Listen(":9653", "http://:8080")`. Every
Hanzo Go service is a thin composition over a `zip.App`; the unified
`cloud` binary (HIP-0106) is itself the proof: its core is a measured
**977 lines** (`serve.go` 260 + `subsystems/subsystems.go` 312 +
`build.go` 405) hosting **74,561 lines** of mounted plugins under
`clients/` — a **76:1 plugin-to-core ratio**. The server is not where
the product lives; the server is what the product mounts on.

This HIP specifies the zip contract — `App`, `Ctx`, transport-as-value
`Listen`, `Mount`, `Module`, typed handlers, identity accessors, and
shutdown lifecycle — so that HIP-0106 (the host binary), HIP-0116 (the
plugin/VM shapes), and every `hanzoai/<repo>` service compose on one
substrate instead of each re-deciding a framework.

## Motivation

HIP-0106 declared zip "the ONE Go web framework" as a stack choice
inside the unified-binary spec. HIP-0120 fixed the permitted wire
protocols (ZAP, HTTP, WS — never gRPC). What neither HIP owns is the
**server core itself**: the thing that terminates those transports,
routes to handlers, carries identity, and gives services their mount
surface. Without one HIP for that layer, three braids form:

1. **Framework choice braided into every service.** Each repo would
   re-answer "chi or gin or fiber?" — and did, historically. The
   migration adapters in HIP-0106 exist precisely because there were
   N answers. The end state must be one.
2. **Transport braided into API shape.** A server that exposes
   `ListenZAP()` and `ListenHTTP()` as separate methods forces every
   caller to encode topology in code. Adding a transport then mutates
   every service's main().
3. **The host/plugin boundary braided into the framework.** HIP-0116's
   plugin VMs and HIP-0106's embedded subsystems only stay
   shape-agnostic if both mount against the *same* app surface.

zip resolves all three: one framework, transport as a value, one mount
contract. It ships today at `github.com/zap-proto/zip` **v1.2.1**
(developed at `~/work/zap/zip`; formerly published as `hanzoai/zip` —
the rename moved it to the ZAP protocol org because the server is
ZAP-native first, Hanzo-branded second). `cloud` consumes v1.2.1 in
production.

## Specification

### One verb, transport as a value

zip serves ONE fiber/fasthttp handler tree on any number of addresses.
The transport is selected by the address **scheme**, never by a method
name (`transport.go`):

```go
app.Listen(":9653")                  // ZAP — bare address = ZAP (the primary)
app.Listen(":9653", "http://:8080")  // ZAP primary + HTTP secondary, one call
app.Listen("http://:8080")           // HTTP only (edge/interop shape)
```

- `DefaultScheme = "zap"`: the path of least resistance is ZAP-native.
  ZAP is the primary wire (TLS 1.3 + post-quantum; the gRPC
  replacement per HIP-0120); HTTP is the interop/edge secondary.
- `RegisterTransport(scheme, fn)` is the ONLY extension point: a
  `TransportFunc` builds a `Server{ListenAndServe, Close}` for an
  address. New protocols never change the `Listen` API — this mirrors
  `net.Listen(network, addr)`: the network is a value, not a
  `ListenTCP`/`ListenUDP` method explosion.
- Same handler tree, same middleware, same auth, same error handling
  over every transport. Routes ARE the surface; there is no
  per-transport wiring. Streaming responses ride ZAP through the same
  framework path (`zap-proto/http` v0.2.0+).

### The app surface — routes, groups, mounts, modules

| Entry point | Contract | Used by |
|---|---|---|
| `app.Get/Post/...(path, fn)` | Sinatra/Express idiom; the primary API | all native Hanzo handlers |
| `zip.Get[In, Out](app, path, fn)` | typed handlers → OpenAPI 3.1 at `/docs` AND a free MCP tool projection at `/mcp` (JSON-RPC 2.0) | typed public surfaces |
| `app.Group(prefix)` | route grouping | `/v1/...` service prefixes |
| `app.Mount(prefix, h http.Handler)` | registers `prefix+"/*"` via `AdaptNetHTTP`; the handler receives the **full original path** (nothing stripped) | migration of chi/gin/beego/net-http code (HIP-0106 adapters); subsystem mounts that own their canonical prefix |
| `app.Module(method+path, runtime, path)` | mounts a HIP-0105 extension (wasm/goja/pyvm/starlark/native) as a route — one mount API for every guest language | user-supplied and multi-language handlers |

`Mount` preserving the full path is load-bearing: a subsystem mounted
at `/v1/iam` still sees `/v1/iam/...` — its routes are identical
standalone, embedded, or as a plugin VM (HIP-0116's "one service,
three shapes" depends on this).

Adapters (`adapt.go`: `AdaptNetHTTP`, `AdaptNetHTTPFunc`,
`AdaptNetHTTPMiddleware`) are migration tools costing ~5% versus
native dispatch, per HIP-0106: new code is written natively against
zip; adapted routes are replaced when feasible.

### Identity and request context

`zip.Ctx` (`ctx.go`) carries the gateway-minted identity of HIP-0026 /
HIP-0110 as first-class accessors — services never parse headers:

```go
c.Org()        // X-Org-Id      (gateway-minted from the JWT owner claim)
c.User()       // X-User-Id
c.UserEmail()  // X-User-Email
c.IsAdmin()    // X-User-IsAdmin == "true" (org-scoped; see HIP-0118)
c.RequestID()  // X-Request-Id
```

Plus the one JSON entry point: `c.Bind` / `c.JSON` route through zip's
internal `jsonenc` — stdlib `encoding/json/v2` under
`GOEXPERIMENT=jsonv2`, stdlib v1 otherwise. No third-party JSON
library exists in the stack (HIP-0106 invariant; the measured json/v2
wins and the per-connection budget — 8.02 KiB and 1.00 goroutine per
connection, 100k conns per 1 GiB replica — are documented in HIP-0106
"Per-replica capacity budget" and are not restated here).

Logging is `luxfi/log` via `c.Log()` — never `slog`, never `uber/zap`.

### Lifecycle

`closers.go`: `Module()` and any resource-owning mount register
closers on the App; `Shutdown()` runs them once, first-error-wins.
This is the same lifecycle the `cloud` host drives through
`RegisterWithShutdown` (below) — one teardown discipline from the
framework up.

### The host shape — cloud as the reference composition

The realized `cloud` binary demonstrates what "thin composition over
zip" means, with measured numbers (non-test Go, `hanzoai/cloud` at
v1.786.x, 2026-07):

| Layer | Files | LOC |
|---|---|---:|
| Core (serve + registry + subsystem table) | `serve.go`, `subsystems/subsystems.go`, `build.go` | **977** |
| Plugins (mounted subsystems) | `clients/*` | **74,561** |

**76:1.** The core does exactly four things: build deps, mount
registered subsystems in order onto one `zip.App`, serve the
transports, and tear down in reverse order. Everything else — IAM,
KMS, commerce, ML, fleet, console BFF, sixty-plus packages — is a
plugin registered through the one registry API (`build.go:351`):

```go
cloud.Register(name string, order int, mount MountFunc)
cloud.RegisterWithShutdown(name string, order int, mount MountFunc, shutdown ShutdownFunc)
```

A subsystem's `init()` calls `Register`; a blank import in `cmd/cloud`
activates it; `MountAll` mounts onto the shared `zip.App`. This is the
substrate HIP-0116's plugin VMs generalize: an embedded plugin is a
mount in-process, a plugin VM is the same mount behind a ZAP hop — the
`zip.App` surface is identical.

**Requirement:** every Hanzo Go service exposes its business surface
as a mount against a `zip.App` (the HIP-0106 `Mount(app, deps)`
contract). A service that spins up its own parallel framework — or
adds a second server core — is nonconformant.

## Rationale

**Why a framework HIP at all.** Because the 76:1 measurement is the
architecture. When the server core is one small, shared, boring layer,
every product decision becomes a plugin decision — independently
mountable, testable, and (per HIP-0116) independently packageable.
The alternative — each service owning its own server — is how the
pre-HIP-0106 estate accumulated N frameworks and N half-consistent
identity parsers.

**Why ZAP-primary rather than HTTP-primary with ZAP bolted on.**
Hanzo's internal traffic is ZAP (HIP-0106, HIP-0114, HIP-0120); HTTP
exists for the external edge and interop. A server core whose default
is the internal wire makes the correct thing the effortless thing —
`app.Listen(":9653")` is conformant by default. The reverse default
would make every service opt in to its own platform's transport.

**Why transport-as-value.** Decomplecting "what the handler does" from
"how bytes arrive" is the same move HIP-0116 makes for packaging
("what the service does" vs "what process it lives in"). Values, not
method explosions: one `Listen`, schemes as data, `RegisterTransport`
as the single seam.

**Why no escape hatches.** zip deliberately has no `.Fast()` raw-mode
bypass and no per-runtime mount APIs (`app.ModuleWasm` does not
exist). Escape hatches are how second ways in; the profiled hot path
(HIP-0106's measured budget) shows the framework does not need one.

**Orthogonality.** One HIP per layer:

- HIP-0114 / HIP-0120 — the **wire**: ZAP envelope, framing, the
  three-protocol rule. zip terminates these; it does not define them.
- **HIP-0122 (this)** — the **server core**: App, Ctx, Listen, Mount,
  Module, lifecycle.
- HIP-0106 — the **host binary**: deps wiring, subsystem registry
  policy, fail-closed embeds (its registry rides this HIP's App).
- HIP-0116 — the **packaging shapes** mounted on this core.
- HIP-0105 — the **guest runtimes** behind `Module`.

## Decided vs shipped

Everything specified here is **shipped**: zip v1.2.1
(`github.com/zap-proto/zip`), one-verb `Listen` with ZAP default,
streaming-over-ZAP, `Mount`/`Module`/typed handlers/MCP projection,
and the 977-line `cloud` host consuming it in production. The one
naming residue is transitional: `hanzoai/zip v0.2.0` still appears as
an indirect dependency in older go.mod graphs (e.g. `gateway`) until
those repos rebase onto `zap-proto/zip` — same code lineage, one
module path forward.

## References

- HIP-0026 — Identity & Access Management Standard (the minted
  identity `Ctx` exposes)
- HIP-0105 — In-Process Extension Runtime Standard (the runtimes
  behind `Module`)
- HIP-0106 — Cloud — Unified Hanzo Binary (the reference host; stack
  table, adapters, measured capacity budget)
- HIP-0110 — Gateway as Edge Process (who mints the X-* headers)
- HIP-0114 — ZAP — Inter-VM Cognitive Transport (the primary wire)
- HIP-0116 — Hanzo Plugin & VM Model (the shapes mounted on this core)
- HIP-0120 — ZAP-Native Transport & gRPC Elimination (the permitted
  protocol set)
- `~/work/zap/zip` — reference implementation (`transport.go`,
  `adapt.go`, `ctx.go`, `closers.go`, `mcp.go`, `typed.go`)
- `hanzoai/cloud` — `serve.go`, `subsystems/subsystems.go`,
  `build.go` (the 977-line host; `Register` at build.go:351)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
