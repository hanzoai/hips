---
hip: 0105
title: In-Process Extension Runtime Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-05-19
requires: HIP-0026
---

# HIP-105: In-Process Extension Runtime Standard

## Abstract

This proposal defines how user-supplied code is loaded and executed **inside a
running Hanzo Go service** — distinct from the K8s-scale FaaS surface in
HIP-0060. The same service binary can host extensions in four engines —
**native Go**, **goja** (pure-Go JS interpreter), **wazero** (pure-Go WASM
runtime), and **v8go** (V8 via cgo) — and pick the right one per extension via
an `extension.json` manifest. The Runtime interface is one type with four
implementations; switching engines is a one-line manifest change.

**Reference implementation**: `~/work/hanzo/base/plugins/{extruntime,gojavm,wasmvm,v8vm}`
([hanzoai/base#3](https://github.com/hanzoai/base/pull/3), landed
2026-05-19). Full benchmark write-up at
`~/work/hanzo/base/docs/EXTENSIONS_BENCHMARK.md`.

## Motivation

Hanzo services regularly need to run **user-supplied code** without spinning
up a Knative pod or shelling out to a sidecar:

- Per-record validators and computed fields in Hanzo Base
- Per-org policy / authz rules in Hanzo IAM and Gateway
- Custom prompt transformers in the LLM Gateway
- Tool implementations for agents (MCP-side tool functions)
- Webhook body transformations
- Custom CRDT merge resolvers
- Per-tenant feature flags evaluated against context

The naïve options are all bad:

1. **Run user code in the host Go process directly** — no sandbox, one panic
   kills the service for every tenant.
2. **Shell out to a Node.js / Python subprocess** — process spawn cost is
   milliseconds, pipes are bytes, memory floor is tens of megabytes per
   tenant.
3. **Knative FaaS** (HIP-0060) — right answer for bursty inference workloads
   with seconds of work; wrong answer for a hot-path validator that runs
   1000 times per request.

The right answer is **in-process** with a **sandbox boundary that scales to
microseconds of overhead**. WebAssembly provides this; modern JS engines
provide it for JS specifically; pure-Go interpreters give a softer sandbox
with zero binary cost. **Each is correct for a different workload.** This
HIP codifies which is which.

## Specification

### Runtime interface

Every backing engine implements the same Go interface:

```go
package extruntime

type Runtime interface {
    Name() string
    Capabilities() Capabilities
    Load(ctx context.Context, dir string) (Module, error)
    Close() error
}

type Module interface {
    Name() string
    Runtime() string
    Exports() []string
    Invoke(ctx context.Context, fn string, payload []byte) ([]byte, error)
    Close() error
}

type Capabilities struct {
    AcceptsLanguages []string // ["go"] | ["js"] | ["wasm"]
    HardSandbox      bool     // wazero, v8go: true; goja, native: false
    Cgo              bool     // v8go: true; others: false
    SupportsAbort    bool     // wazero, v8go: hard; goja: cooperative; native: false
}
```

`payload` and the Invoke result are **JSON bytes**. JSON is the wire format
because (a) every backing engine can marshal it natively, (b) it's
language-agnostic so AssemblyScript / Rust / Go / JS guests all see the same
payload, and (c) the marshal cost is comparable across runtimes.

### Manifest

Every extension carries a sibling `extension.json`:

```json
{
  "name":    "validate-email",
  "version": "0.1.0",
  "runtime": "wazero",
  "module":  "validate.wasm",
  "exports": ["validate", "onUpdate"]
}
```

Fields:

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Unique within a host (e.g. `<org>-<purpose>`) |
| `version` | yes | SemVer per global policy (HIP-0xxx semver-only) |
| `runtime` | yes | One of `native`, `goja`, `wazero`, `v8go` |
| `module` | conditional | Path to compiled artifact (`*.wasm` for wazero, `*.js` for goja/v8go). Not required for `native` runtime. |
| `exports` | yes | List of function names callable via `Invoke` |

### Calling conventions

#### Go-native

A native extension is a Go file that imports
`github.com/hanzoai/base/plugins/extruntime` and registers itself at
`init()`:

```go
extruntime.RegisterNative("validate-email", "validate", func(ctx context.Context, payload []byte) ([]byte, error) {
    // ... return JSON bytes
})
```

Compile-time linked. Zero abstraction cost beyond function pointer.

#### Goja and V8go (JavaScript)

The guest defines `globalThis.<fn>` for each export:

```javascript
globalThis.validate = function(payload) {
    return { ok: true, normalized: payload.email.toLowerCase() };
};
```

Host unmarshals the JSON payload to a JS value, calls the function, and
`JSON.stringify`s the result. No memory dance — JS engines own their
heaps.

#### Wazero (WebAssembly)

The guest exports three functions in addition to its named exports:

```
(func $__base_alloc (param i32) (result i32))           // ptr = alloc(len)
(func $__base_free  (param i32 i32))                    // free(ptr, len)
(func $<fn>         (param i32 i32) (result i64))       // ret = fn(ptr, len)
```

`<fn>(ptr, len)` returns an `i64` where the **high 32 bits are the result
pointer** and the **low 32 bits are the result length** in the module's
linear memory. The host calls `__base_free` on both the input buffer and the
result buffer.

This convention is **language-agnostic** — AssemblyScript, Rust, Go (via
TinyGo), Zig, and C can all target it. The
`~/work/hanzo/base/plugins/extbench/fixtures/wazero-as/` sample shows the
AssemblyScript implementation.

### Default behavior when ctx is cancelled

| Runtime | Cancellation semantics |
|---|---|
| native | Cooperative — user code MUST check `ctx.Err()` |
| goja | Cooperative — `vm.Interrupt()` fires only at function-call opcodes; tight numeric loops without yield points can resist abort |
| wazero | Hard — `module.Close()` destroys the instance immediately; the runtime replenishes its pool from a background context |
| v8go | Hard — `Isolate.TerminateExecution()` aborts within ~ms |

### Pool sizing

Every runtime maintains a per-module pool of pre-warmed instances /
contexts so per-invocation cost stays microsecond-scale. Each runtime
exposes an env override. **Defaults were revised after the scale study
(see below): wazero default reduced to 4** because pool=8 produced 256K
wasm instances at T=1000 with zero latency benefit.

| Runtime | Env | Default | Notes |
|---|---|---|---|
| goja | `BASE_GOJAVM_POOL_SIZE` | 8 | Cheap per-pool-item (~9 KB Go heap); 8 is safe. |
| wazero | `BASE_WASMVM_POOL_SIZE` | **4** | Each instance is ~80 KB linear memory; larger pools waste RAM with no throughput gain. |
| v8go | `BASE_V8VM_POOL_SIZE` | 8 | Sized for context pool, but see scale findings — v8go is **NOT recommended for production** at meaningful concurrency. |
| pyvm | `BASE_PYVM_POOL_SIZE` | 4 | Each Python sub-interpreter is ~4.6 MB. Pool of 4 = ~18 MB baseline. Default tuned to balance per-module memory vs cold-start cost. |

Native doesn't pool — functions are stateless Go calls.

## Benchmark data

Run on Apple M1 Max, Go 1.26.3, median of 3 runs at `-benchtime=2s`. Workload:
`validate(email, age)` — JSON in, JSON out, ~20 lines of logic.

### Throughput (lower ns/op is faster)

| Runtime | Serial ns/op | Parallel ns/op | Ratio vs native (serial) | Ratio vs native (parallel) |
|---|---:|---:|---:|---:|
| **native** | **1,197** | **694** | 1.0× | 1.0× |
| pyvm (CPython 3.13) | 4,089 | 2,765 | 3.4× | 4.0× |
| goja | 4,513 | 1,652 | 3.8× | 2.4× |
| wazero (AssemblyScript) | 9,956 | 3,271 | 8.3× | 4.7× |
| v8go | 11,895 | 12,667 | 9.9× | **18.3× (degrades)** |

### Cold start (per `Load()`)

| Runtime | ns/op | Ratio vs native |
|---|---:|---:|
| native | 16,847 | 1.0× |
| goja | 78,282 | 4.6× |
| v8go | 906,033 | 53.8× |
| **wazero (AS)** | **3,936,863** | **233.7× (JIT compile)** |

### Per-invocation memory

| Runtime | B/invoke | allocs/invoke |
|---|---:|---:|
| **pyvm (CPython 3.13)** | **496** | **10** (LOWEST allocs of any non-native) |
| v8go | 673 | low |
| native | 1,450 | minimal |
| goja | 3,433 | JS → Go marshalling |
| wazero (AS) | 44,425 | JSON ptr/len + linear-memory copy |

### Binary size delta

| Runtime added | Binary growth |
|---|---:|
| native (registry only) | +89 KB |
| wazero | +620 KB |
| goja | +10.7 MB |
| v8go | +36.3 MB (cgo + V8 statics) |

### Scale findings (added 2026-05-19 after the second benchmark pass)

The throughput benchmark above measured a single hot module. The scale
benchmark measured fan-out — many modules, many tenants, many concurrent
invocations — and **materially changes the recommendation for two runtimes**.

**Per-loaded-module Go-heap cost (steady state, 1000 modules loaded):**

| Runtime | Per-module heap | Total at N=1000 | Total at N=10000 |
|---|---:|---:|---:|
| native | ~16 B | <1 MB | ~1 MB |
| goja | ~9 KB | ~9 MB | ~90 MB |
| wazero (pool=8) | ~635 KB | ~635 MB | (extrapolated 6.4 GB) |
| wazero (pool=4) | ~320 KB | ~320 MB | (extrapolated 3.2 GB) |
| v8go | crashed before reaching N=500 (SIGSEGV in libv8) |

**Sustained concurrent invocations on one module (throughput at M concurrent):**

| Runtime | M=10 ops/s | M=100 ops/s | M=1000 ops/s | M=10000 ops/s |
|---|---:|---:|---:|---:|
| native | scales linearly with M | linear | linear | linear |
| goja | scales | scales | **188,000** | scales |
| wazero (pool=4) | scales | scales | pool exhaustion above pool size; queueing | queueing |
| v8go | OK at M=10 | **SIGSEGV in libv8** | (process crash) | (process crash) |

**Pool-size sweep (1000 tenants, wazero):**

| Pool size | Latency | Memory |
|---:|---:|---:|
| 1 | high (queueing) | ~80 MB |
| 4 | **good** | **~320 MB** |
| 16 | same as 4 | ~1.3 GB |
| 64 | same as 4 | ~5.1 GB |
| 256 | same as 4 | **10.8 GB** |

No latency improvement beyond pool=4. Anything higher is pure waste.

**Concrete corrections this forces:**

1. **v8go is removed from the production decision tree.** v8go v0.9 on
   darwin/arm64 SIGSEGVs inside libv8 at ~100 concurrent invocations on
   a shared isolate. This is not "slow" — it is **process death**.
   Production-disqualifier for any service expecting real concurrency.
   `plugins/v8vm` ships but is for benchmarking and experimental use
   only. Tracked upstream — revisit if v8go ships per-context isolation
   and resolves the crash.

2. **goja is the production winner for multi-tenant JS at scale.**
   ~9 KB per loaded module, 188K ops/s on a single module at M=1000
   concurrent, no cgo, no crash modes. For a SaaS deployment hosting
   thousands of tenants each with a few JS extensions, goja is the
   right call. The cooperative-interrupt caveat remains, but the
   stability-at-scale story dwarfs it.

3. **wazero default pool is 4, not 8.** No throughput gain beyond that
   for the workloads measured; halving the pool halves the per-module
   memory floor.

4. **wazero scales to ~10K modules at pool=4 (~3.2 GB).** Beyond that,
   compile-cache miss + linear-memory floor compounds; see Open
   Questions below for a future test.

5. **native scales to any reasonable N.** ~16 B per loaded function
   pointer; the goroutine cost (~8 KB) dominates only at >100K
   concurrent invocations of any single module.

Full numbers and methodology in `~/work/hanzo/base/docs/EXTENSIONS_BENCHMARK.md`
under "## Scale Study".

## The new standard

**Go-native is the default.** Every metric in the benchmark — serial perf,
parallel scaling, cold start, memory, binary size — favors native by a
factor of 2-50×. There is **no scenario in this benchmark where any other
runtime beats native on raw performance.** If the code is Hanzo-authored
and the language constraint allows Go, write it in Go.

**Pick another runtime only when one of these four exceptional conditions
holds:**

### Mount points where extensions run

Per HIP-0106, the `superbase` binary mounts extension runtimes in two
places:

1. **In-process Base hooks** (the original HIP-0105 scope): per-record
   onCreate/onUpdate/onDelete hooks, scheduled jobs, custom validators.
   Read from `<base-data-dir>/hz_hooks/<name>/extension.json`.

2. **Web routes via `hanzoai/zip`**: ANY HIP-0105 runtime is also
   mountable as an HTTP route via `app.Module(method+path, runtime,
   modulePath)`. Read from `<service-dir>/hz_routes/<name>/extension.json`
   OR registered programmatically.

The runtime contract is identical in both surfaces. Same `.zap` schemas
generate the same I/O types. Same crash isolation. Same scale
characteristics. **One abstraction, two mount points.**

Multi-tenant operators MUST set `AllowedRuntimes` (or equivalent gate)
at the zip / Base config level to exclude runtimes lacking hard sandbox
(pyvm, v8go-experimental).

### Decision tree

1. **Is the code Hanzo-authored and Go-permissible?** → **native**.
   Default; no further questions.

2. **Is the code user-supplied AND threat model requires HARD sandbox
   (e.g. tenants could be actively malicious)?**
   - **Language flexibility matters?** (Rust / TinyGo / Zig / AssemblyScript /
     C plugin authors) → **wazero**. Pool default 4.
   - **JS authoring only?** → wazero with Javy (once the WASI-stdio shim
     lands — see Open Questions). Until then, accept the soft sandbox
     and use goja (see next item).

3. **Is the code user-supplied JS where the threat model is "ordinary
   customers, not adversaries"?** → **goja**. Per the scale findings, this
   is the right answer for multi-tenant SaaS hosting thousands of JS
   extensions — ~9 KB per loaded module, 188K ops/s at high concurrency,
   no crash modes, no cgo. The cooperative-interrupt caveat applies; pair
   with a `ctx` deadline and resource limits at the host boundary.

4. **Is the code an existing `.base.js` hook from the legacy `plugins/jsvm`
   path?** → **goja** (back-compat).

5. **Are you tempted to use v8go for "modern JS perf"?** → **Don't, for
   production.** v8go v0.9 SIGSEGVs inside libv8 at modest concurrency
   (~100 invokers). The `plugins/v8vm` runtime ships but is for
   benchmarking and experimental use only until upstream ships
   per-context isolation that resolves the crash.

6. **Do you need REAL CPython (with the full ecosystem including
   numpy, pandas, cryptography) inside the Go binary, and is your
   deployment SINGLE-TENANT?** → **pyvm**. CPython 3.13 embedded via
   a small direct cgo bridge (`plugins/pyvm/pyvm_bridge.{c,h}`, ~150
   lines). The canonical Hanzo Go binding for embedded CPython is
   [`github.com/hanzoai/cpy3`](https://github.com/hanzoai/cpy3) — a
   fork of `go-python/cpy3` with Python 3.12+ removed-API polyfills,
   a `SubInterpreter` wrapper, `IsGILDisabled()` detection, a
   `LoadSource`+`CallJSONFunctionByName` JSON hot-path helper, and a
   3.13t build script. pyvm chooses the inline bridge because the
   consolidated `pyvm_invoke` (1 cgo call per Invoke) is ~30% faster
   than routing through the cpy3 wrappers for the JSON-pipe
   embedding contract.

   Beats wazero AS by ~2× serial and has the lowest per-invocation
   memory (496 B/op) of any sandboxed runtime measured. Sub-interpreter
   pool gives per-tenant-style isolation within the single-process
   deployment.

   **DO NOT use pyvm in multi-tenant builds.** A C extension segfault
   in any tenant's code kills the entire host process and every other
   tenant. Multi-tenant operators must policy-reject `runtime: pyvm`
   in extension manifests. Gate with `-tags pyvm` at build time;
   default off.

   Python 3.13 free-threading (PEP 703, `python3.13t`) is detected at
   runtime via `pyvm.GilDisabled()`; when present, the GIL is a no-op
   and OWN_GIL sub-interpreters become unnecessary for parallelism.
   **Measured 2026-05-18 on Apple M1 Max, default `BASE_PYVM_POOL_SIZE=4`:
   free-threading is a non-event for pyvm's embedding workload.**

   | Build | Serial ns/op | Parallel ns/op |
   |---|---:|---:|
   | 3.13 default-GIL | 4,073 | 5,733 |
   | 3.13t free-threaded | 4,478 | 5,805 |

   PEP 684 OWN_GIL sub-interpreters already deliver per-OS-thread
   parallelism on default-GIL; PEP 703 doesn't add headroom unless
   you abandon the sub-interp pool and run many threads against one
   interpreter — which we don't. The pool size is the lever, not the
   GIL mode. Revisit when CPython 3.14+ ships free-threading as
   default with closed serial-perf gap. Full measurement:
   `~/work/hanzo/base/docs/EXTENSIONS_BENCHMARK.md`.

7. **Are you serving a workload where seconds of cold start is fine and
   GPU is needed?** → That's HIP-0060 Functions, not this. Wrong HIP.

### What we are NOT recommending

- **Don't use v8go for hot-path parallel workloads.** The single-isolate
  mutex in v8go v0.9 serializes everything; parallel scaling is worse than
  serial. We hit this in the benchmark and have no workaround until v8go
  ships per-context isolation (upstream issue tracked).

- **Don't use wazero for latency-sensitive code that is loaded per-request.**
  234× native coldstart eats your tail latency budget. Pre-load at boot and
  reuse modules.

- **Don't rewrite working Go code to wasm under the assumption that
  "wasm is faster".** It is 4-10× slower in this benchmark for equivalent
  CPU-bound work. Wasm wins on **sandbox**, not speed.

- **Don't put Hanzo-internal service logic behind any non-native runtime.**
  Per HIP-0014 every Hanzo service ships as a single Go binary. Service
  logic is native code; extension points are where user code lives.

### Honest caveats baked into the recommendation

- The goja interrupt is **cooperative**. A malicious extension author can
  write a tight numeric loop with no function-call opcodes and resist
  `ctx.Done()`. If your threat model requires hard abort, use wazero or
  v8go. (`SupportsAbort: true` for goja is honest in the common case;
  caveated against adversarial guests.)

- Wazero `module.Close()` for hard-abort **destroys the instance permanently**.
  The Hanzo wazero runtime auto-refills the pool from a background ctx to
  keep pool size stable. Memory pressure from refills under sustained
  cancellation is something to watch in observability.

- V8go's `TerminateExecution` is **isolate-wide**. Because Hanzo serializes
  on the isolate today, the cancellation target is unambiguous. If/when
  v8go grows per-context isolation, the cancellation story has to be
  re-examined.

## Migration path for existing services

| Service | Today | Action |
|---|---|---|
| `hanzoai/base` plugins/jsvm | goja hooks via `.base.js` files | Keep as-is. New extensions land in `plugins/extruntime` via manifest. |
| `hanzoai/iam` policy rules | Hardcoded Go | No action. |
| `hanzoai/gateway` route transforms | Hardcoded Go | Open: convert to extension surface if customer authoring becomes a requirement. Until then, native Go in-repo. |
| `hanzoai/llm` prompt filters | Hardcoded Python | Recommend native Go reimplementation; if customer-authored transforms become a feature, wazero. |
| `hanzoai/mcp` tool functions | Per-tool Go + Rust | Already varied. New tools should land as wasm via wazero. |
| `hanzoai/agents` custom tools | Per-tool Go | Same. |
| Hanzo Functions (HIP-0060) | Knative pods, Python/Go/Rust/TS | Out of scope — different workload class. |

## Reference implementation

- **Branch**: `hanzoai/base#3` — `feat/wasmvm-and-v8vm`
- **Packages**:
  - `plugins/extruntime/` — interface, manifest, native impl, loader
  - `plugins/gojavm/` — goja adapter
  - `plugins/wasmvm/` — wazero (pure Go)
  - `plugins/v8vm/` — v8go (cgo, `-tags v8vm`, stub for default build)
  - `plugins/extbench/` — fixtures + benchmark harness across 5 variants
- **Tests**: extruntime 7/7 + gojavm 14/14 + wasmvm 6/6 + v8vm 9/9
- **Verification**: `go build ./...` clean, `go build -tags v8vm` clean,
  `go test -race ./plugins/...` clean

## Backwards compatibility

The existing `plugins/jsvm` API (goja-based hooks for `.base.js` files) is
**untouched**. Old hooks continue to work via the old path. The new
extension runtime is **additive** — opt in by writing an `extension.json`.

## Security considerations

- **Sandbox boundary** is the runtime's responsibility. wazero and v8go
  enforce memory isolation; goja and native share the host heap.
- **Resource limits**: wazero supports stack limits and memory caps;
  v8go v0.9 lacks a per-isolate heap-limit API (V8 default ~768MB-1.5GB
  applies). Host code MUST set a `ctx` deadline on every Invoke to
  protect against runaway CPU.
- **Path traversal**: the loader resolves `module` relative to the
  manifest directory and refuses paths containing `..`.
- **Manifest validation**: `name` must be alphanumeric + dash/underscore;
  `runtime` must be one of the four known values; an unknown runtime
  causes the extension to be skipped with a logged warning, not loaded
  against the wrong engine.

## Open questions

1. **Javy support** — Shopify's Javy (raw JS → wasm via QuickJS-in-wasm)
   emits a WASI command module (`_start` reads stdin, writes stdout). Our
   wazero convention is pointer-based. The two ABIs don't compose without
   a stdio shim. Either we ship the shim (a small wazero adapter that
   forwards stdio buffers as the pointer-based payload) or we publish a
   Javy plugin that emits our convention directly. Tracked in
   `plugins/extbench/fixtures/wazero-javy/TODO.md`.

2. **Component Model / WIT** — wazero's component-model branch is
   experimental. Once stable, we should reconsider whether the hand-rolled
   pointer/len ABI is worth the simplicity or if we should adopt WIT
   interfaces. Likely revisit Q3 2026.

3. **Hot reload** — `plugins/jsvm` has filesystem watching; the new
   extension loader does not. Add only if a real consumer asks for it.

4. **Host API surface** — what can extension code call back into? DB
   access, HTTP fetch, KMS reads, log emission? Each runtime needs
   plumbing. Suggest a separate HIP for the host-API contract once we have
   a concrete extension that exercises it.

## References

- Reference implementation PR: [hanzoai/base#3](https://github.com/hanzoai/base/pull/3)
- Benchmark writeup: `~/work/hanzo/base/docs/EXTENSIONS_BENCHMARK.md`
- wazero: https://github.com/tetratelabs/wazero
- goja: https://github.com/dop251/goja
- v8go: https://github.com/rogchap/v8go
- AssemblyScript: https://www.assemblyscript.org/
- HIP-0014 (Application Deployment Standard) — service-level binaries
- HIP-0026 (Identity and Access Management Standard) — per-org isolation
- HIP-0060 (Serverless Functions Standard) — K8s-scale FaaS, complementary
