---
hip: 0108
title: On-Demand Subsystem Supervisor + Warm Pool
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-05-18
requires: HIP-0105, HIP-0106, HIP-0107, HIP-0302
---

# HIP-108: On-Demand Subsystem Supervisor + Warm Pool

## Abstract

This HIP defines how the unified `cloud` binary (HIP-0106) supervises
two things at runtime:

1. **Out-of-process subsystems** that cannot fold into the Go binary —
   Rust, Python, C++, and TypeScript services with native deps, native
   sandboxes, or licence/scope constraints that exclude them from the
   single-binary mount path.
2. **Per-tenant in-process state** that should not be permanently
   resident — extension modules, sub-interpreters, per-tenant SQLite
   handles that activate on first request and idle out when traffic
   stops.

The contract is **on-demand activation + warm pools + idle eviction**.
A realistic Hanzo deployment fits in **1-2 GB RAM at idle** and scales
by tenant load rather than by service count.

This HIP sits on top of HIP-0105 (the in-process runtime substrate),
HIP-0106 (the unified binary), HIP-0107 (the replication substrate),
and HIP-0302 (per-tenant SQLite + encryption). It introduces one new
package — `cloud.Supervisor` — and one new operator concept:
**tiered activation**.

## Motivation

Per the HIP-0106 audit, the unified Go binary itself is ~150 MB
resident at idle. But the full Hanzo ecosystem has 13+ out-of-process
services that intentionally stay out of the unified binary:

| Reason out-of-process | Services |
|---|---|
| Native deps (torch, faiss, sentence-transformers) | flow, llm |
| PCI scope isolation (HIP-0106 §Solo-vault CDE) | vault, payments |
| Heavy column store with its own replication | datastore |
| Free-threading blockers per the 2026-05-19 FT audit | cli, erp, insights, sentry, studio |
| Independent frontend / studio process | platform, chat |
| Polyglot agent runtimes | brain, agents, bot |

If all 13 ran "always on, production-sized," the deployment would
consume 64-256 GB RAM regardless of actual tenant traffic. Most
tenants never touch most services.

**Real workload profile** (Hanzo flagship target):

| Quantity | What |
|---:|---|
| 1000 | Total tenants |
| ~10 | Concurrently active on ML inference (flow, llm) |
| ~50 | Concurrently active on JS extensions (per-tenant goja modules) |
| ~100 | Concurrently active on CRUD (per-tenant Base) |
| ~840 | Idle in any given minute |

The "always-on" architecture over-provisions by roughly an order of
magnitude. This HIP closes that gap with a supervisor pattern that
co-exists with the always-on path for the workloads that warrant it.

## Specification

### Three activation tiers

Every workload in a Hanzo deployment falls into exactly one tier. The
tier dictates how memory is amortised and how cold-start cost is paid.

| Tier | What runs there | RSS per active tenant | Cold-start cost |
|---:|---|---:|---:|
| 0 — in-process | wazero modules, goja runtimes, starlark threads, native Go handlers | 9 KB (goja) – 200 KB (wazero) | sub-millisecond |
| 1 — sub-interpreter | per-tenant CPython sub-interp (pyvm), per-tenant Node `worker_thread` | 2–20 MB | low-millisecond |
| 2 — subprocess (warm pool) | per-(tenant, service) supervised OS process; idle-evictable; CRIU-snapshottable on Linux | 50–500 MB active; 0 idle | ~50–100 ms snapshot restore; ~2–10 s cold spawn |

Tier 0 is the HIP-0105 substrate. Tier 1 sub-interpreters share a
process with the unified binary (pyvm pool, Node `worker_threads`).
Tier 2 is what HIP-0108 introduces: **supervised, idle-evictable OS
processes scoped per (orgID, service)**.

### `cloud.Supervisor` API

```go
package cloud

// Supervisor manages tier-2 warm-pool workers. Workers are OS
// processes scoped per (orgID, service). The supervisor handles spawn,
// affinity, idle eviction, optional CRIU snapshots, and resource
// isolation. Callers receive opaque WorkerHandles.
type Supervisor interface {
    // Acquire returns a handle to a warm worker for (orgID, service).
    // Blocks until a worker is available (warm from pool or freshly
    // spawned). Caller MUST Release the handle when done.
    Acquire(ctx context.Context, orgID, service string) (WorkerHandle, error)

    // Stats returns current pool stats for o11y / debugging.
    Stats() SupervisorStats
}

type WorkerHandle interface {
    // Invoke sends a request to the worker over its IPC channel
    // (unix socket / shared memory / ZAP RPC).
    Invoke(ctx context.Context, method string, payload []byte) ([]byte, error)

    // Release returns the worker to the warm pool (if pool has slack)
    // or schedules it for idle reaping.
    Release()
}

type SupervisorStats struct {
    PerService map[string]ServiceStats
    TotalRSS   uint64
}

type ServiceStats struct {
    WarmWorkers     int
    ActiveInvokes   int
    SnapshotsOnDisk int
    LastEvictionAt  time.Time
}
```

The interface is intentionally narrow. Three calls — `Acquire`,
`Invoke`, `Release` — cover the lifecycle. The supervisor is the only
component that knows whether a request was served by a warm worker, a
freshly spawned worker, or a CRIU-restored worker. Callers see a
uniform `WorkerHandle`.

### Worker lifecycle

1. **Cold spawn**. `fork`+`exec` the target binary with
   `--worker --tenant=<orgID>` and the ZAP socket fd inherited. The
   worker performs language-specific initialisation and signals
   `READY` over the socket.
2. **Warm pool**. When `Release` is called, the worker stays resident
   for `idle_timeout` seconds (default 60s, configurable per service).
   Subsequent `Acquire` calls for the same `(orgID, service)` return
   the same worker via consistent hashing.
3. **CRIU snapshot** (Linux only, opt-in). On idle eviction the
   supervisor may freeze the worker to disk under
   `{data-dir}/snapshots/{org}/{service}.crium`. Next `Acquire`
   restores in ~50–100 ms instead of a full 2–10 s spawn.
4. **Idle eviction**. Idle longer than the configured timeout →
   `SIGTERM` → 5 s grace → `SIGKILL`. Worker MUST honour `SIGTERM`
   gracefully: flush state, release WAL, close fds. The supervisor's
   ZAP healthcheck verifies the worker handed back its WAL handle
   before reaping.
5. **Affinity**. Same tenant routes to the same warm worker via
   consistent hashing on `orgID`. This is what makes per-tenant
   in-process state caching effective at tier 2 — the worker's heap
   already has that tenant's hot rows in memory.

### Resource isolation

Each tier-2 worker runs under explicit limits:

- **cgroups v2** per worker process: `memory.max`, `cpu.max`,
  `pids.max`. Limits are per-service defaults overridable per-tenant
  via supervisor config.
- **Namespaces** per worker where the service warrants it: PID,
  network, mount. Network namespace is the common case (the worker
  reaches outbound services only through the supervisor-provided
  socket).
- **File-descriptor limits** per worker via `RLIMIT_NOFILE`.
- **Graceful shutdown contract**. Worker MUST honour `SIGTERM`:
  flush in-flight writes, release WAL, close fds, exit within 5 s.
  Workers that miss the deadline take `SIGKILL`; their per-tenant
  SQLite WAL is recovered on next acquire (the SQLite WAL recovery
  protocol is idempotent — see HIP-0302).

### Per-tenant WAL handoff (per HIP-0302)

When the supervisor activates a warm worker for tenant `T` against
service `S`:

1. The worker receives the file descriptor for
   `{data-dir}/orgs/{T}/{S}.db`.
2. The per-org DEK is fetched from KMS (HKDF-derived from the
   per-service master key per HIP-0302).
3. The worker opens SQLite in WAL mode.
4. On `Release` the worker `fsync`s the WAL and returns control to
   the supervisor.
5. HIP-0107 `replicate` continues streaming WAL changes to
   `vfs`/S3 regardless of which worker currently holds the handle.

The consequence: **per-tenant state is shared between the cloud
binary AND the warm worker** via the same SQLite file. The cloud
binary can read from the same DB while the worker is active — no
IPC round-trip for reads from the supervised path. The worker owns
WAL writes for the duration of its acquire; the cloud binary defers
WAL writes to the worker via the same Supervisor.

### Service classification

For each Hanzo service, the canonical tier and pool size:

| Service | Activation tier | Pool size | Idle timeout |
|---|---|---:|---:|
| Most extensions (wazero / goja) | 0 in-process | per-runtime defaults (HIP-0105) | n/a |
| `pyvm` (single-tenant CPython) | 0 in-process | 4 sub-interps | n/a |
| `flow` (visual ML pipeline) | 2 subprocess | 0–2 warm | 120 s |
| `llm` (Python LLM gateway) | 2 subprocess | 1–4 warm | 300 s |
| `insights` | 2 subprocess | 0–1 warm | 60 s |
| `brain`, `agents` (TS runtimes) | 2 subprocess | 0–2 warm | 60 s |
| `platform` (Next.js UI) | always-on | 1–3 replicas | n/a |
| `chat` (TS UI) | always-on | 1–2 replicas | n/a |
| `datastore` (OLAP column store) | always-on (server) | single | n/a |
| `vault`, `payments` (PCI scope) | always-on | 2 replicas | n/a |

The cloud binary's `Supervisor` manages tier-2 workers only. Tier 0
lives in the HIP-0105 substrate. Always-on services are out of
HIP-0108 scope — they remain traditional K8s deployments because
either (a) PCI scope dictates isolation, (b) the workload is itself
the always-on serving plane (UIs, OLAP), or (c) the service has its
own internal idle-management.

### CRIU integration

CRIU lets the supervisor freeze a worker process to disk on idle
eviction and restore it on next acquire. The trade-off:

- **Snapshot size**: ~100 MB per `(orgID, service)` snapshot,
  evictable on an LRU policy.
- **Restore latency**: ~50–100 ms vs ~2–10 s for a full spawn.
- **Platform**: Linux only. macOS dev environments take the
  spawn-only path (no snapshot, no resource limits — see Open
  Questions).
- **Storage**: `{data-dir}/snapshots/{org}/{service}.crium`. The
  supervisor reuses HIP-0107 `vfs` semantics for off-host snapshot
  storage when configured, so snapshots survive node loss.
- **WAL replay**: on restore, the worker reopens its per-tenant
  SQLite handle and the HIP-0107 replicate frame stream replays any
  missed WAL frames before the worker accepts new requests.

CRIU snapshotting is opt-in per service. The default is spawn-only;
operators turn snapshotting on for services where the cold-spawn
cost dominates the request budget.

### Memory budget

For the Hanzo flagship profile (1000 tenants; 10 concurrent ML; 50
active JS; 100 concurrent CRUD):

| Component | RSS |
|---|---:|
| Cloud baseline (unified binary, all subsystems compiled in) | 150 MB |
| Tier 0: in-process extensions (50 active JS × ~9 KB + idle pool overhead) | ~5 MB |
| Tier 1: sub-interpreters (4 × ~4.6 MB, shared across tenants via affinity) | ~20 MB |
| Tier 2: warm ML workers (10 × ~1 GB) | ~10 GB |
| Per-tenant SQLite handles (100 × ~5 MB) | ~500 MB |
| Headroom (50%) | ~5 GB |
| **Total** | **~16 GB** |

Compare to ~64–128 GB for an always-on equivalent. The supervisor
pattern delivers a **5–10× memory reduction** at the cost of
~50–100 ms restore latency on the cold path (per snapshot) or
2–10 s on a full cold spawn.

## Implementation phases

### Phase 1 — Supervisor MVP (~1 week)

- `cloud.Supervisor` interface in `~/work/hanzo/cloud/` alongside
  the existing `Deps` (HIP-0106 §`deps.go`).
- Spawn/reap with unix socket IPC.
- LRU warm pool keyed by `(orgID, service)`. No CRIU yet.
- Per-tenant consistent-hash affinity.
- O11y `/v1/supervisor/stats` endpoint emitting `SupervisorStats`.

### Phase 2 — cgroups + namespaces (~1 week)

- libcontainer wrapper per-worker for `memory.max`, `cpu.max`,
  `pids.max`.
- Memory accounting per `(orgID, service)` surfaced through o11y.
- Per-tenant kill switch (`POST /v1/supervisor/evict?org=...&service=...`).

### Phase 3 — CRIU snapshots (~2 weeks)

- Snapshot on idle eviction (Linux only).
- Restore on next request.
- WAL replay coordination with HIP-0107 `replicate`.
- Snapshot LRU + disk quota under `{data-dir}/snapshots/`.
- Optional off-host snapshot storage via `vfs`.

### Phase 4 — per-service adapters (~1 week each)

- **ML services**: Python via `pyvm` in supervisor mode (re-using the
  HIP-0105 CPython embed when the workload is single-tenant; spawning
  full Python subprocess workers otherwise).
- **LLM services**: subprocess workers with model weights pre-loaded
  on first acquire and held warm for `idle_timeout`.
- **TS services**: Node `worker_threads` for lightweight cases; full
  Node subprocess spawn for heavyweight (brain, agents).

## Non-goals

- **Cluster-level scheduling.** K8s does this. The supervisor is
  in-process to the cloud binary; cross-pod scheduling is not in
  scope.
- **Multi-cluster failover.** HIP scope is per-deployment. The
  supervisor coordinates with HIP-0107 replicate for state durability;
  multi-cluster failover is a separate concern.
- **Hot reload of subsystem code.** Phase 4 may add it for specific
  services, but it is not required by this HIP.
- **Folding always-on services into the supervisor.** UIs, OLAP
  stores, and PCI-scoped services stay always-on by design.

## Open questions

1. **macOS dev story.** No CRIU, no cgroups, no namespaces. The
   supervisor MUST work without these on darwin — just no snapshot
   path and no resource limits. Accept the per-worker memory cost in
   dev. Linux remains the canonical production target.
2. **Restart storms.** If a worker crashes mid-request, what is the
   retry semantic? Suggested default: exponential-backoff retry with
   a circuit breaker — 3 failures in 30 s marks the
   `(orgID, service)` unhealthy and short-circuits subsequent
   acquires for a 60 s cooldown. Surfaced to o11y.
3. **Tenant migration across clusters.** When tenant `T` moves
   clusters, what happens to its warm workers and CRIU snapshots?
   Suggested protocol: "drain on migration signal" — supervisor
   stops accepting `Acquire` for `T`, drains in-flight invokes,
   reaps the warm worker, leaves snapshot on disk. State on the
   destination cluster is rebuilt from the HIP-0107 replicate stream
   on first acquire. CRIU snapshots do NOT migrate; only the
   replicated SQLite WAL does.
4. **Backpressure on `Acquire`.** When the pool is at its max and no
   warm worker is available, `Acquire` blocks on `ctx`. Should the
   supervisor expose a queue depth metric and a per-service
   `max_queue` config? Suggest yes — wire under
   `SupervisorStats.PerService[svc].QueueDepth` in Phase 1.

## References

- HIP-0105 — In-Process Extension Runtime Standard (the substrate
  for tier 0)
- HIP-0106 — Unified Hanzo Cloud Binary (the binary the Supervisor
  lives in)
- HIP-0107 — Streaming Replication over VFS (per-tenant WAL replay
  on worker activation)
- HIP-0302 — Encrypted SQLite + ZapDB Durability (per-tenant SQLite
  + encryption contract the Supervisor honours)
- `~/work/hanzo/base/docs/EXTENSIONS_BENCHMARK.md` — runtime
  perf data underpinning the tier-0/1 numbers
- AWS Lambda warm-starts pattern (architectural inspiration)
- Fly.io `fly machines` model (single-process supervisor + idle
  suspend)
- Linux CRIU — https://criu.org
- cgroups v2 — kernel docs `Documentation/admin-guide/cgroup-v2.rst`
