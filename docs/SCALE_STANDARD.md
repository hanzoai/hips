# Hanzo Scale Standard

Status: Draft (2026-05-19)
Owners: Hanzo CTO + platform team
Cites: HIP-0106, HIP-0110

This is the canonical scaling discipline for every Hanzo service that
accepts connections from clients or sibling services. It applies across
the Hanzo AI estate (`hanzo.ai` cloud, `hanzo.network` compute, `lux`,
`zoo`). One way to do everything.

## TL;DR

| Rule | Value |
|---|---|
| Wire stack at the client edge | JSON, no other shape |
| Wire stack between Hanzo services | ZAP, no other shape |
| JSON impl in every Go production build | `GOEXPERIMENT=jsonv2` |
| Per-conn heap budget (Go zip/fasthttp) | ≤ 8 KiB |
| Per-conn goroutine ratio (Go zip/fasthttp) | 1.00 : 1 |
| Per-task heap budget (Rust tokio) | ≤ 4 KiB |
| Pod ceiling | 1 GiB → ~100k concurrent conns |
| Cloud-side worker model | bounded pool, not goroutine-per-request |
| CI gate | every service repo runs a conn-memory test |

## 1. Wire stack rule

### 1.1 At the client edge: JSON only

The gateway terminates JSON for human-readable browser/CLI/SDK clients.
Anything that ingresses from outside the cluster is JSON. No
client-facing endpoint speaks Protobuf, no client-facing endpoint speaks
MessagePack, no client-facing endpoint speaks ZAP. JSON keeps the public
contract debuggable in a browser DevTools panel.

### 1.2 Between services: ZAP only

Every Hanzo-authored service-to-service call uses [ZAP](https://github.com/luxfi/zap)
binary envelopes. No JSON between subsystems, no gRPC between
subsystems, no Cap'n Proto anywhere. ZAP is zero-copy on parse, has
typed in-process and over-wire dispatch from the same generated code,
and is what HIP-0106 mandates for the unified `cloud` binary.

The boundary between (1.1) and (1.2) is the gateway. JSON marshal/unmarshal
runs **at most once per request**: at the gateway-to-cloud handoff.

### 1.3 Why this saves work

Profile-gating wire formats by direction is the single decision; nobody
designing a new service has to decide what protocol to use for the
internal call. The decision is already made. This is the same
"one obvious way" principle that picks `zip` for the framework, `orm`
for the persistence layer, and `luxfi/log` for logging.

## 2. JSON impl rule

`GOEXPERIMENT=jsonv2` is **mandatory** in every production Dockerfile
that compiles Go code at the gateway edge or any subsystem that returns
JSON to a client.

### 2.1 Verified numbers (Apple M1 Max, Go 1.26, zip on Fiber v3 v3.2.0)

Benches at `hanzoai/zip` (`json_bench_test.go`):

| Bench | json/v1 | json/v2 | Δ |
|---|---|---|---|
| Edge POST roundtrip | 19,782 ns / 73 allocs | 17,406 ns / 56 allocs | **−12% time, −23% allocs** |
| Marshal-only | 12,860 ns / 34 allocs | 10,092 ns / 34 allocs | **−22% time** |
| Unmarshal-only | 17,122 ns / 67 allocs | 13,785 ns / 50 allocs | **−19% time, −25% allocs** |

Reproduce locally:

```bash
cd ~/work/hanzo/zip
go test -bench=BenchmarkJSON -benchmem -run=^$ .
GOEXPERIMENT=jsonv2 go test -bench=BenchmarkJSON -benchmem -run=^$ .
```

### 2.2 How to wire it

In every Go service Dockerfile, set `GOEXPERIMENT=jsonv2` before
`go build`. The shared reusable workflow at
`hanzoai/.github/.github/workflows/docker-build.yml` exposes
`go-experiment` as a build-arg input (default `jsonv2`) so callers
inherit the right value for free. Dockerfiles must consume it via:

```dockerfile
ARG GO_EXPERIMENT=jsonv2
ENV GOEXPERIMENT=${GO_EXPERIMENT}
RUN go build -mod=mod -trimpath -ldflags="-s -w" -o /<binary> ./cmd/<binary>
```

Setting `GOEXPERIMENT=jsonv2` at build time changes the
`encoding/json` package selected by `internal/jsonenc` in `hanzoai/zip`
(via `goexperiment.jsonv2` build tag). The constant `zip.JSONVariant`
reports the active impl in process logs at startup:

```
zip new json_variant=encoding/json/v2
```

If you see `encoding/json` instead of `encoding/json/v2` in your
service's startup logs, the Dockerfile is wrong.

### 2.3 jsonv2 status

`encoding/json/v2` is a GOEXPERIMENT-gated stdlib package landing for
Go 1.26+. It is the official successor to `encoding/json` and has a
deliberately equivalent surface area. We treat the experiment as
stable for our workloads — the benches above prove it on edge JSON,
and the binary it produces ships to production. When jsonv2 drops the
experiment tag (Go 1.27+), the `GOEXPERIMENT=jsonv2` env line in our
Dockerfiles becomes a no-op and is removed in a follow-up sweep.

## 3. Per-connection budget

A Hanzo Go service that accepts inbound HTTP/1.1 or WebSocket
connections must hold steady at:

- **Heap allocation per conn ≤ 8 KiB** (fasthttp goroutine-per-conn + zip
  framework overhead).
- **Goroutine count per conn = 1.00** (fasthttp's reader goroutine; no
  per-conn writer goroutine, no per-conn read-pump-write-pump fan-out).

### 3.1 Verified numbers (gateway on zip + fasthttp via Fiber v3 v3.2.0)

Test source: `~/work/hanzo/gateway/conn_memory_test.go`.

| Conns | Heap delta | Per-conn heap | Goroutines |
|---|---:|---:|---:|
| 1,000 | 7.84 MiB | **8.02 KiB** | **1.00 / conn** |
| 8,454 | 67 MiB | **8.02 KiB** | **1.00 / conn** |

Reproduce locally:

```bash
cd ~/work/hanzo/gateway
go test -mod=mod -run=TestConnMemory -v -conn-count=10000
```

### 3.2 Why these numbers

fasthttp's `Server` uses one goroutine per accepted connection with a
pooled `*RequestCtx` and pooled read/write buffers. The 8 KiB per-conn
figure is the steady-state memory pinned by that goroutine plus zip's
per-Ctx overhead plus the per-conn entry in fasthttp's accept-side
slice. No other framework choice in Go today gets this number this
low; net/http with HTTP/1.1 keep-alives costs about 2x at idle, with
the read/write goroutine pair compounding under load.

### 3.3 Replica capacity math

Linear scale-out math falls out of the per-conn budget:

| Concurrent conns | Heap | Pod RAM (with headroom) |
|---:|---:|---:|
| 10,000 | 80 MiB | 256 MiB |
| 100,000 | 800 MiB | 1 GiB |
| 1,000,000 | 8 GiB | 10 replicas × 1 GiB |

The 1 GiB pod ceiling targets the production K8s pod size we standardise
on; **100k concurrent client connections per replica** is the operational
target. Ten replicas → one million concurrent client connections, with
all conns terminating JSON, validating JWTs, and forwarding to cloud
over ZAP.

### 3.4 Anti-patterns

- net/http `http.Server` with `httputil.ReverseProxy` (3 goroutines per
  request, ~25 KiB per conn). Cancels the whole budget.
- gorilla/websocket with explicit reader+writer goroutines per conn
  (2 goroutines per conn, ~12 KiB). Use `wsx` over `fasthttp/websocket`
  instead (one goroutine per conn, message-driven).
- Per-conn slow-buffer allocations sized above `Server.ReadBufferSize`
  / `Server.WriteBufferSize`. Tune the buffer sizes once at startup;
  do not allocate per request.

## 4. Replica-capacity math (recap)

| Tier | Target |
|---|---|
| Idle replica | < 150 MiB RSS, all 13 cloud subsystems mounted |
| 10k conns | < 256 MiB RSS, 1 vCPU at ~10% |
| 100k conns | < 1 GiB RSS, 1 vCPU at ~60% |
| 1M conns total | 10 replicas, 1 GiB each, linear horizontal scale |

The cliff above 100k/replica is OS-side (fasthttp's listener queue,
ulimit, kernel ephemeral port range), not Go-side. Production replicas
should be sized at 1 GiB and `Concurrency` capped at 100k via the new
`zip.Config.Concurrency` knob (see §6).

## 5. Cloud-side discipline

When the cloud subsystem services ZAP-typed inbound requests forwarded
from the gateway, it does **not** spawn one goroutine per request.

### 5.1 Bounded worker pool

The HIP-0106 cloud binary services its ZAP listener via a fixed-size
worker pool sized to `GOMAXPROCS * cloud_worker_factor` (default factor
8). Each worker pulls envelopes from a bounded channel queue. The queue
depth is `Concurrency * 2`.

Rationale:
- ZAP envelopes carry typed, finite-size requests. There is no
  long-poll scenario where holding a goroutine open is useful.
- Goroutine-per-request on the cloud side compounds the gateway's
  goroutine-per-conn budget — 1M client conns × 1 goroutine/request
  would crater the cloud replica.
- A bounded queue gives the cloud replica a clean backpressure signal
  (`429 Too Many Requests` if queue full).

### 5.2 Direction reminder

Direction is **gateway → cloud over ZAP** for every request. The cloud
side accepts envelopes, dispatches synchronously to the in-process
subsystem, and returns. Reverse-push (cloud → gateway for SSE / WS
frames) uses the `Push` envelope per HIP-0110 §wire and is also
queue-bounded.

## 6. zip framework tuning knobs

`hanzoai/zip` exposes the fasthttp-side knobs that ops needs to cap
per-replica capacity:

```go
zip.New(zip.Config{
    Logger:          luxlog.NewLogger("cloud"),
    Concurrency:     100_000, // hard cap on concurrent conns
    ReadBufferSize:  4 << 10, // 4 KiB per conn (fasthttp default)
    WriteBufferSize: 4 << 10, // 4 KiB per conn (fasthttp default)
    BodyLimit:       4 << 20, // 4 MiB request body
})
```

| Knob | Default | Production guidance |
|---|---|---|
| `Concurrency` | 256 × 1024 (fasthttp default) | Cap at 100k below kernel ulimit |
| `ReadBufferSize` | 4 KiB (fasthttp default) | Increase only for header-heavy upstreams |
| `WriteBufferSize` | 4 KiB (fasthttp default) | Increase only for streaming responses |
| `BodyLimit` | 4 MiB (zip default) | Increase only for upload-shaped routes |

Defaults are deliberately conservative — they hit the 8 KiB/conn budget
out of the box. Raising buffer sizes inflates the per-conn budget; if
you raise them, re-run `TestConnMemory` and update your service's CI
gate.

## 7. Rust nodes (hanzo.network)

The equivalent rule for Rust nodes (the Hanzo compute mesh at
`~/work/hanzo/node-go/` and downstream luxfi/luxd builds):

- **One `tokio::task` per accepted connection**.
- **Per-task heap budget ≤ 4 KiB.**

tokio's per-task overhead is ~64 bytes for the task wrapper plus a small
boxed future plus whatever the read buffer allocates. With a 1 KiB
initial buffer the steady-state per-task footprint hits ~4 KiB.

The Rust pattern is `tokio::net::TcpListener::accept` + `tokio::spawn`,
not `select!` with a manual fan-out; the latter loses the 1:1
task-to-conn property and double-counts in our budget.

### 7.1 Bench harness

`~/work/hanzo/node-go/bench/conn_memory.rs` provides the equivalent
test for Rust services. It samples RSS via `procfs` rather than
`jemalloc::stats` (procfs is dependency-free and the number matches what
K8s sees for the pod). Run:

```bash
cd ~/work/hanzo/node-go
cargo bench --bench conn_memory -- --conn-count 10000
```

CI for every Rust node service must include this bench with the same
4 KiB / task budget assertion.

## 8. Verification gate

Every Go service-repo PR that exposes an HTTP listener must include a
conn-memory test. CI runs it and fails the merge if either:

- `per_conn_heap` > 12 KiB
- `goroutines_per_conn` outside `[0.95, 1.05]`

The canonical test source is `~/work/hanzo/gateway/conn_memory_test.go`.
Copy it, adapt the `app := zip.New(...)` and route registration to your
service shape, and check it into your repo as `conn_memory_test.go` at
package root.

### 8.1 Skipping in short-mode

The test holds N concurrent connections and reads RSS — it takes about
1.5s for 10k conns. Mark it `t.Skip` in `-short` mode (default for
`go test -short` smoke runs); make it mandatory in regular CI:

```go
if testing.Short() {
    t.Skip("skipping memory profile in -short mode")
}
```

### 8.2 What "fails the merge" means

The reusable workflow at `hanzoai/.github/.github/workflows/docker-build.yml`
runs `go test ./...` before the image build. A failing `TestConnMemory`
short-circuits the build. No image gets published, no deploy happens.

## 9. Adoption playbook for service owners

When you ship a new Hanzo Go service (or refit an existing one):

1. **Pick zip.** `hanzoai/zip` is the only Go web framework in Hanzo.
   Don't reach for chi, gin, echo, beego, or net/http.
2. **Set the Dockerfile build.** `GOEXPERIMENT=jsonv2` ENV before
   `go build`. The shared workflow's `go-experiment` build-arg defaults
   to `jsonv2` so most services need no per-repo change beyond the ENV.
3. **Add the conn-memory test.** Copy
   `~/work/hanzo/gateway/conn_memory_test.go`, swap the service-specific
   route setup, commit. CI now gates you on per-conn heap and goroutine
   ratio.
4. **Tune the knobs.** Set `Concurrency`, `ReadBufferSize`,
   `WriteBufferSize` to match your service's per-pod RAM ceiling.
   Default to the conservative values in §6.
5. **Pick the wire.** JSON if the route is client-facing (`/v1/*`
   over the gateway). ZAP if the route is service-to-service (no
   gateway hop, called by another Hanzo subsystem). Never mix.
6. **Ship.** Health probe, readiness probe, structured logging,
   `Mount(*zip.App, cloud.Deps)` for the unified-binary path per
   HIP-0106. Done.

## 10. Repository owners

The scale standard is enforced in:

- `hanzoai/zip` — framework knobs, `JSONVariant` constant,
  `json_bench_test.go`.
- `hanzoai/gateway` — reference `conn_memory_test.go`, reference
  Dockerfile with `GOEXPERIMENT=jsonv2`.
- `hanzoai/.github/.github/workflows/docker-build.yml` — reusable
  workflow exposes `go-experiment` build-arg (default `jsonv2`).
- `hanzoai/hips/HIPs/hip-0106-unified-hanzo-cloud-binary.md` — cites
  per-replica capacity budget §3.3.
- `hanzoai/hips/HIPs/hip-0110-gateway-edge-process.md` — cites memory
  profile §3.1.

Service repos consume the standard by:

- Inheriting the `go-experiment` build-arg via the shared workflow.
- Adding a `conn_memory_test.go` at their package root.
- Tuning `zip.Config.Concurrency` to their per-pod ceiling.

## 11. Open questions

1. **WebSocket conn budget.** The 8 KiB figure is HTTP/1.1
   long-poll-style holds. WebSocket adds a `wsx` upgrader; expected
   delta is small but unmeasured. Add a `TestConnMemory_WS` in
   `hanzoai/zip` once `wsx` ships its production interface.
2. **TLS termination cost.** When zip terminates TLS in-process (vs
   behind ingress TLS-passthrough), per-conn budget grows by the
   `crypto/tls` connState size. Measure and document the TLS-terminate
   number alongside the plaintext number.
3. **HTTP/2 multiplexing.** fasthttp does not support h2. When a
   Hanzo subsystem terminates h2 (e.g. for `:authority`-aware routing),
   it must use Caddy's h2 in front of fasthttp; document the conn-count
   semantics (streams vs conns).

## 12. References

- HIP-0106 §3.3 (per-replica capacity)
- HIP-0110 §memory profile
- `~/work/hanzo/gateway/conn_memory_test.go` (canonical Go bench)
- `~/work/hanzo/zip/json_bench_test.go` (canonical JSON bench)
- `~/work/hanzo/node-go/bench/conn_memory.rs` (canonical Rust bench)
- `~/work/hanzo/.github/.github/workflows/docker-build.yml` (build-arg
  surface)
