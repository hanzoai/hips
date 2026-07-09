---
hip: 0107
title: Streaming Replication over VFS
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-05-18
requires: HIP-0026, HIP-0027, HIP-0032, HIP-0302
---

# HIP-107: Streaming Replication over VFS

## Abstract

This proposal defines the **unified streaming replication contract** for
every durable state in Hanzo. All sources of incremental updates —
SQLite WAL, ZapDB log, blockchain state, generic append-only logs —
ship frames through a **single pipeline** built from three orthogonal
pieces:

1. **One source-adapter interface** (`replicate.Source`) — pulls
   frames from a backing engine.
2. **One sink interface** (`hanzo/vfs.Backend`) — the only object-store
   abstraction in Hanzo. All sink-side bytes are `vfs.Write` calls.
3. **One encryption layer** (`luxfi/age`) — frames are age-encrypted at
   the boundary; the master key lives in KMS per HIP-0027.

The standalone `hanzoai/zapdb-replicator` sidecar is deprecated and
folded into `hanzoai/replicate` as a source adapter. The per-backend
sink code in `replicate/s3`, `replicate/gs`, `replicate/abs`,
`replicate/nats`, `replicate/oss`, `replicate/sftp`, `replicate/webdav`
collapses into `hanzo/vfs`. **One way to do everything.**

This HIP **does not supersede** HIP-0302; HIP-0302 stays Final as the
spec for the SQLite-WAL and ZapDB substrate (encryption keys,
recovery objectives, K8s sidecar pattern, PQ-safe age v1.3.0+
recipients). HIP-0107 sits on top: it unifies the transport so the
SQLite backend, the ZapDB backend, and any future backend route bytes
through the same pipeline.

**Two mechanisms, one substrate (the reconciliation).** Hanzo grew TWO
SQLite-HA implementations: `hanzoai/replicate` (a Litestream fork —
continuous streaming WAL → object store, files stored as age-encrypted
`.zap.age`) and `hanzoai/vfs/replica` (whole-object `VACUUM INTO`
snapshots plus the piece Litestream lacks: a coordinator-free single-writer
election). That overlap is a one-and-one-way violation. This HIP resolves
it, and names the winners — one home per concern: **streaming replication
(`hanzoai/replicate`) is the canonical durability/replication transport; HRW
single-writer election is `hanzoai/ha` (extracted from `vfs/replica`, which
had kept storage-agnostic election inside a SQLite library — its own
one-and-one-way violation); the `VACUUM INTO` snapshot / hydrate / adopt
primitives stay in `hanzoai/vfs/replica`.** `ha` decides WHO writes;
`vfs/replica` decides HOW state ships. The whole-object snapshot path is
superseded by streaming for the replication path; election (now `ha`) and
the hydrate/adopt primitives stay. See
"HA-SQLite substrate" and "Relationship to HIP-0302 and hanzoai/replicate"
below.

## Motivation

Today Hanzo has **two parallel "where bytes live" abstractions**
inside the same codebase:

- `~/work/hanzo/replicate` carries seven sink backends (`s3`, `gs`,
  `abs`, `nats`, `oss`, `sftp`, `webdav`). Each is a separately-typed
  client and credential surface.
- `~/work/hanzo/vfs` carries a similar but **distinct** set of
  object-store backends, plus a Go-native `vfs.Backend` interface that
  every other Hanzo service has been migrating onto.

Meanwhile:

- `~/work/hanzo/zapdb-replicator` is a **separate sidecar image**
  (`ghcr.io/hanzoai/zapdb-replicator`) that re-implements the
  age-encryption + frame-pump loop for ZapDB instead of plugging into
  `replicate` as a source.
- Blockchain state replication is **ad-hoc per chain** — Lux primary
  network ships its own snapshot pump, regulated EVM L1 ships its own,
  Z-Chain ships its own. Each invented its own age-recipient scheme,
  its own bucket layout, its own restore tool.

Three "almost-the-same" pipelines, three on-call burdens, three
audit surfaces. This HIP unifies them.

## Specification

### Architecture

```
                ┌───────────────────────────────────────────┐
                │              hanzoai/replicate            │
                │                                           │
   ┌─────────┐  │  ┌──────────────┐    ┌─────────────────┐  │  ┌────────────┐
   │ Source  │──┼─▶│ frame-pump   │───▶│ age-encrypt     │──┼─▶│ vfs.Backend│
   │ adapter │  │  │ (one impl)   │    │ (luxfi/age)     │  │  │   (sink)   │
   └─────────┘  │  └──────────────┘    └─────────────────┘  │  └────────────┘
                └───────────────────────────────────────────┘
```

Four canonical source adapters ship with `hanzoai/replicate`:

| Source | Engine | Frame definition |
|---|---|---|
| `source/sqlite-wal` | SQLite WAL (the original Litestream surface) | WAL frames, header per Litestream protocol |
| `source/zapdb-log` | ZapDB incremental backup | ZAP frame format (magic `0x5A415001`, defined in HIP-0302 §"ZapDB Streaming Replication") |
| `source/chain-state` | Lux primary network, regulated EVM L1, Z-Chain, Hanzo's L1 | per-block state delta + snapshot frames |
| `source/generic-log` | Any append-only log file or Unix socket | length-prefixed records |

All four implement:

```go
package replicate

type Source interface {
    Name() string
    // PullFrames yields frames as the source produces them.
    // The returned channel closes when the source quiesces.
    PullFrames(ctx context.Context) (<-chan Frame, error)
    // Restore reads frames in order and applies them to the destination.
    Restore(ctx context.Context, frames <-chan Frame, dst string) error
}

type Frame struct {
    ID        uint64    // monotonic per-source
    Kind      FrameKind // snapshot | delta | tombstone
    Payload   []byte    // engine-specific (WAL bytes, ZAP frame, block delta, log record)
    Checksum  uint32    // CRC-32 over Payload
    Timestamp time.Time
}
```

### Sink: hanzo/vfs is the only object store

The per-backend code currently in `hanzoai/replicate/{s3,gs,abs,nats,
oss,sftp,webdav}` **moves to `hanzo/vfs`** as standard
`vfs.Backend` implementations. After this HIP lands:

- `hanzoai/replicate` has **zero direct cloud-SDK imports**. The only
  storage interaction is `vfs.Open(uri)` + `vfs.Backend.Write(...)`.
- Adding a new sink backend is **one PR to `hanzo/vfs`**. The
  replication pipeline picks it up for free.
- A deployment configures replication via a single `vfs://` URI:
  `vfs://gs/hanzo-replicate-mainnet/iam/<instance>/...`.

### Encryption boundary

Age encryption happens **once, at the frame boundary**, before the
sink call. The recipient set per HIP-0302:

- ML-KEM-768 + X25519 hybrid (`age1pq` prefix), age v1.3.0+
- Per-service keypair derived from a KMS-stored master key via HKDF
  with `hanzo:replicate:` domain separator
- HIP-0302 recovery objectives apply unchanged (RPO 1s SQLite / 500ms
  ZapDB; RTO 30s / 15s)

The sink layer sees opaque ciphertext. The sink layer **must not**
inspect frame contents.

### Frame format (canonical)

The on-disk frame format is the ZAP frame already defined in HIP-0302
§"ZapDB Streaming Replication":

```
Frame header (16 bytes):
  [0:4]   magic    = 0x5A415001 ("ZAP\x01")
  [4:8]   frame_id = monotonic uint32
  [8:12]  length   = payload length in bytes
  [12:14] checksum = CRC-16 of payload
  [14:15] flags    = 0x01=snapshot, 0x02=delta, 0x04=compressed
  [15:16] reserved = 0x00
```

The SQLite-WAL source wraps WAL frames in this envelope. The chain-state
source wraps block deltas. The generic-log source wraps records. **One
on-disk format across all sources.**

### Multi-tenant bucket layout

The KMS-derived master key is per-deployment. Each tenant org gets a
distinct key path:

```
vfs://<backend>/<bucket>/replicate/<org>/<service>/<source>/
├── snapshots/<frame_id>.snap.zap.age
├── deltas/<start>_<end>.delta.zap.age
└── latest
```

- `<org>` comes from JWT `owner` claim (HIP-0026 unified identity).
- `<service>` is the subsystem name (`iam`, `base`, `kms`, ...).
- `<source>` is one of `sqlite-wal`, `zapdb-log`, `chain-state`,
  `generic-log`.
- `latest` is a small pointer object naming the most recent frame.

### Restore protocol

On pod startup, the K8s init container per HIP-0302 invokes:

```bash
hanzo-replicate restore \
  --source=sqlite-wal \
  --vfs=vfs://gs/hanzo-replicate-mainnet \
  --org=hanzo \
  --service=iam \
  --dst=/data/iam.db \
  --age-key-ref=kms://hanzo/superbase/master
```

The same binary handles all four source types via the `--source` flag.
Restore drains the latest snapshot frame, then applies delta frames in
monotonic order, then resumes streaming.

## HA-SQLite substrate: single-writer election + adoption contract (shipped)

The streaming pipeline above answers "how do bytes get durable." It does
NOT answer "which replica may write." Litestream — and therefore
`hanzoai/replicate` — assumes a single writer and does not elect one.
`hanzoai/ha` supplies exactly that missing half — coordinator-free
single-writer election — and `hanzoai/vfs/replica` supplies the primitives a
service needs to adopt HA without changing its own storage library. Together
they are the shared substrate every Hanzo service imports instead of
re-inventing durability: `ha` decides WHO writes, `vfs/replica` decides HOW
state ships.

### Single-writer election (Rendezvous / HRW), no coordinator — `hanzoai/ha`

`hanzoai/ha` answers, identically on every replica and with no network
round-trip, "who is the single writer for key K?" via Highest-Random-Weight
hashing over the live membership set (K is any ownership unit — an org id, a
shard, a singleton job name):

- `Owner(key, members)` — deterministic winner; `weight =
  SHA-256(key ‖ 0x00 ‖ memberID)[:8]` as a big-endian uint64, tie-broken
  on member ID so the result is order-independent.
- `IsOwner(key, selfID, members)` — the per-write hot-path gate.
- `Replicas(key, members, n)` — owner first, then ordered failover
  successors, so a reader can pre-warm the key it is next in line to own.
- `Membership` (seam) + `Static` — the live-set source: a cluster impl
  (`ha/k8s`, roadmap) or single-process `Static` for dev and tests.
- **Fail-closed:** empty membership yields `ok=false` — never a wrong
  writer. No election protocol, no lock service, no service discovery,
  **no Postgres, no Redis.** Pure Go, stdlib only.

Ownership is PER-ORG: the owning replica writes ALL of an org's DBs (root +
every per-project + per-user file) so an org's data has locality and moves
as one unit on failover. Reads are served from any replica's vfs-synced
copy.

### Adoption contract

Every adopter wires the same three lines at its per-org store seam:

1. **hydrate-on-open** — `Pull()` (or `RestoreFile`) the latest durable
   copy before first use of an org DB, so a fresh or replaced pod starts
   from committed state.
2. **single-writer** — `IsOwner(org, self, members)` gates writes; a
   non-owner serves stale-tolerant reads (Pull-then-read) and forwards
   writes to the owner.
3. **post-commit ship/stream** — the owner ships after a write burst (the
   shipped `Replicator.PushLoop`), superseded on the streaming path by
   `replicate` continuous WAL shipping.

### Shipped primitives (`hanzoai/vfs/replica`)

- `SQLiteDB` (`sqlite.go`) — the real per-org handle: `Snapshot` = `VACUUM
  INTO` a temp (forces a WAL checkpoint, one transaction-consistent copy,
  no torn pages, no `-wal`/`-shm` to ship); `Restore` = write-temp → close
  → drop `-wal`/`-shm` → atomic rename → reopen (a crash mid-restore leaves
  the old DB intact). CGO-free (`modernc.org/sqlite`), same durability
  pragmas (WAL / NORMAL / foreign_keys / busy_timeout) as base and visor.
- `SnapshotFile` / `RestoreFile` — handle-less adoption primitives so an
  xorm / GORM service adopts HA without a handle conflict (restore runs
  BEFORE the service opens its own engine).
- `BackendStore` (`store.go`) — adapts any `vfs` backend (`file://` dev,
  `s3://` SeaweedFS prod) to the `Store`, with a cheap `<key>.ver`
  content-version sidecar so a reader skips redundant pulls; `Get`
  recomputes the version authoritatively, so a stale sidecar degrades to a
  redundant pull, never a wrong restore.
- Per-org envelope encryption — `WithEncryption(Cipher, org)` seals every
  pushed snapshot with the org's KMS-derived key, orgID bound as AAD so a
  blob cannot be replayed under another org (HIP-0302 recipients).
- `DBPath(org, scope, service)` — the canonical HIP-0302 object layout
  (`orgs/<org>/[scope/]<service>.db`), computed identically on every
  replica; `Version(data)` — the one content hash (SHA-256) both the
  `Replicator` and any `Store` use.

### Live adoption

**visor is the reference adopter and it is LIVE.** `object/store_replica.go`
opts in via `REPLICA_STORE` (`s3://…` SeaweedFS in prod, `file://` in test;
unset = local-only, nil replicator, today's behavior with zero regression).
It hydrates-on-open before xorm opens each org DB and runs a per-org ship
loop; the success path logs, verbatim (`store_replica.go:128`):

```
visor HA: org "_global" shipping to object store (durable)
```

with explicit push-FAILED / push-recovered logs so a durability feature can
never fail invisibly. `hanzoai/cloud` consolidated its own former
`internal/org` replicator + election onto this same package (#11a3ae6 —
re-exported as thin aliases in `internal/org/shared.go`), so cloud and
visor now run ONE implementation; election has since been extracted again
into `hanzoai/ha` (aliases repointed there; `vfs/replica` is now
replication-only). Rolling the same adoption to iam / commerce / base is the
remaining work.

## Relationship to HIP-0302 and hanzoai/replicate

HIP-0302 stays Final: it owns the encryption recipients, recovery
objectives, and the sidecar / emptyDir pattern. HIP-0107 owns the transport
and the write-coordination on top. The two SQLite-HA mechanisms reconcile
as follows — **this is the decision, stated plainly:**

| Concern | Winner | Why |
|---|---|---|
| Durability / replication transport | **`hanzoai/replicate`** (Litestream fork) | Continuous streaming WAL → object store (converted to immutable LTX, shipped as age-encrypted `.zap.age`) is strictly better than whole-object snapshots: lower RPO, incremental bytes, no periodic full-DB rewrite. CGO-free (`modernc.org/sqlite`). Canonical replication path. |
| Single-writer coordination | **`hanzoai/ha`** | Litestream / `replicate` do NOT elect a writer. HRW / Rendezvous election is the genuinely-novel piece — coordinator-free, fail-closed, no Postgres/Redis. Extracted from `vfs/replica` so a non-SQLite singleton (cron, queue drain) elects without importing a storage library. |
| Adoption / hydrate / restore | **`hanzoai/vfs/replica`** (`SnapshotFile` / `RestoreFile`) | Handle-less primitives let any service hydrate-on-open and adopt HA regardless of its own DB library. |
| Whole-object `VACUUM INTO` snapshot | **superseded for replication** | Kept as the consistent-copy primitive behind `SnapshotFile` and as the currently-shipped ship path; replaced by streaming as the durability transport as services migrate. |

**Honest status.** The election, the adoption primitives, and the visor
live path are shipped. The convergence — every adopter shipping via
`replicate` streaming rather than the `Replicator` whole-object push, and
folding `zapdb-replicator` + the per-backend sinks into the one
`source-adapter → age → vfs.Backend` pipeline (the four-source design
above) — is the reconciliation roadmap this HIP ratifies, not a claim that
it is already uniform. The one-and-one-way violation (two overlapping
SQLite-HA libraries) is closed by DECISION here; the code convergence
follows the phases below.

## Implementation phases

| Phase | Work | Effort |
|---|---|---|
| 1 | Move `replicate/{s3,gs,abs,nats,oss,sftp,webdav}` per-backend code into `hanzo/vfs`. Existing `replicate.Sink` interface deletes; callers switch to `vfs.Backend`. | 3–4 days |
| 2 | Fold `hanzoai/zapdb-replicator` into `hanzoai/replicate` as `source/zapdb-log`. Deprecate `ghcr.io/hanzoai/zapdb-replicator` (publish a final `vN+1.0.0-deprecated` tag pointing deployers at `ghcr.io/hanzoai/replicate`). | 2 days |
| 3 | Implement `source/chain-state` for Lux primary network. Reuse for regulated EVM L1 and any other Lux-derived L1. | 3–5 days for Lux primary; ~1–2 days per derived L1. |
| 4 | Implement `source/generic-log` for arbitrary append-only logs (Unix socket or file). | 1 day |
| 5 | Update K8s manifests across `~/work/hanzo/universe/infra/k8s/` to swap `zapdb-replicator` sidecars for `replicate --source=zapdb-log`. Bump `hanzoai/replicate` to the version that ships all four sources. | 1 day per service touched |

## Non-goals

- **`hanzoai/datastore` (ClickHouse fork).** ClickHouse already uses
  ReplicatedMergeTree + S3-disk for its own replication. HIP-0107 does
  not touch it. The two systems share an S3 bucket via `vfs` prefix
  separation: `s3://bucket/datastore/...` is ClickHouse-owned;
  `s3://bucket/replicate/...` is HIP-0107-owned. No collision.
- **Cross-region replication patterns.** Active-active, geo-failover,
  read replicas across regions — separate concern. HIP-0107 ships
  frames to one `vfs.Backend`; what the operator chooses for the
  region/zone topology of that backend is outside scope.
- **Real-time CDC for non-WAL sources.** Hanzo Base's per-record
  hooks (HIP-0105) carry their own change-data-capture stream. That
  is a logical-event pipeline; HIP-0107 is a byte-level frame
  pipeline. They do not converge.
- **Snapshot retention / GC policy.** HIP-0302 already defines RPO,
  RTO, and retention windows. HIP-0107 inherits them unchanged.
- **Replacing HIP-0302's encryption + recovery contract.** HIP-0302
  stays Final. HIP-0107 adds the unified transport on top.

## Open questions

1. **vfs URI scheme for non-S3 backends.** `vfs://gs/...`,
   `vfs://abs/...`, `vfs://sftp/...` — confirm the URI prefix
   matches the existing `hanzo/vfs` convention before Phase 1.
2. **Chain-state delta granularity.** Per-block is the obvious
   default. Some Lux-derived L1s have 200ms block times — frames at
   5 Hz per chain may stress the sink. Suggest configurable
   batching, default = 1 frame per N blocks where N is tuned per
   chain.
3. **Generic-log fan-in.** A single replicate process pumping N
   generic logs sharing one `Source` — likely fine; benchmark before
   committing to a goroutine-per-source model.
4. **Backpressure when vfs.Backend is slow.** Today
   `zapdb-replicator` drops oldest unsent frame on bounded-queue
   overflow. Confirm this is the policy we want across all four
   sources, or whether `chain-state` (consensus-critical) needs
   block-on-full instead.

## References

- HIP-0027 — Secrets Management Standard (the KMS that holds the
  age master key per service/per org)
- HIP-0032 — Object Storage Standard (the `vfs.Backend` interface
  contract this HIP standardizes on)
- HIP-0302 — Hanzo Replicate: Encrypted SQLite + ZapDB Durability
  for Base Services (the predecessor for the SQLite/ZapDB substrate;
  HIP-0107 adds the unified pipeline on top — HIP-0302 stays Final)
- Reference implementations:
  - `~/work/hanzo/ha` (SHIPPED) — `github.com/hanzoai/ha`, HRW single-writer
    election (`Owner`/`IsOwner`/`Replicas`/`Member`) + the `Membership` seam
    and `Static`. Pure Go, stdlib only; election with no storage dependency.
  - `~/work/hanzo/vfs/replica` (SHIPPED) — the `Replicator` (`replica.go`),
    the real `SQLiteDB` snapshot/restore + `SnapshotFile`/`RestoreFile`
    adoption primitives (`sqlite.go`), and `BackendStore` over a `vfs`
    backend (`store.go`). Replication only; election lives in `hanzoai/ha`.
  - `~/work/hanzo/replicate` — `github.com/hanzoai/replicate`, the
    Litestream fork: streaming WAL → immutable LTX → object store, files
    stored as age-encrypted `.zap.age`; the canonical replication
    transport.
  - `~/work/hanzo/vfs` — the sink backends (`vfs.Backend`).
- Litestream protocol (SQLite WAL framing): https://litestream.io
- age v1.3.0+ PQ-hybrid recipients: https://age-encryption.org
