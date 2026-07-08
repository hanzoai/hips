---
hip: 0125
title: Consensus-Backed Plugin-Placement Platform
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-07-07
requires: HIP-0026, HIP-0027, HIP-0105, HIP-0106, HIP-0107, HIP-0112, HIP-0114, HIP-0302
---

# HIP-125: Consensus-Backed Plugin-Placement Platform

## Abstract

This proposal turns the unified `cloud` binary (HIP-0106) into a
**planet-scale, consensus-backed, plugin-placement PaaS runtime**. A plugin
author implements one small interface and calls `cloud.Register(name,
order, fn)` (HIP-0105); in return the runtime gives that plugin **placement,
per-tenant scale, streaming replication, per-connection pinning, and
high-availability for free** — the plugin author never writes a lease, a
failover, a proxy hop, or a replication loop.

The mechanism is **two planes, decomplected, where consensus orders
*decisions*, not *bytes***:

- A **control plane** — one small **Quasar** post-quantum BFT replicated
  state machine (RSM) across a fixed seven-voter quorum
  (`luxfi/consensus/protocol/quasar` `NewEngine`; ordered finality,
  strict-PQ from day one) — whose finalized block sequence holds only tiny
  metadata: cluster membership, the placement map `(plugin, shard) →
  {writer, followers}`, and writer leases carrying fencing epochs. This RSM
  **replaces** the interim Kubernetes-Lease writer-fence in
  `hanzoai/kms/lease.go`.
- A **data plane** — the existing `hanzoai/kms/replication.go` async
  S3/ZapDB log-ship (HIP-0107), reused **unchanged**. The *only* edit is the
  write-fence seam: `canPush` (`replication.go:452`) flips its question from
  "do I hold the Kubernetes Lease?" to "does the control plane grant this
  shard's lease at epoch *E*?", backed by an S3 epoch compare-and-swap
  (CAS).

Consensus sits **off the data path**. Losing the control-plane quorum
freezes placement and failover but **does not stop serving**: every current
writer keeps its lease and keeps writing. This is the Chubby/etcd shape — a
small, strongly-consistent coordination kernel steering a large, weakly-
coupled fleet — applied to the Hanzo plugin runtime.

## Motivation

HIP-0106 collapsed ~35 Hanzo Go subsystems into one binary and one artifact.
That solved *packaging*. It did not solve *placement*: which replica owns
the write side of a given subsystem for a given tenant, how a second replica
is prevented from writing the same state, and how a new plugin inherits all
of that without re-implementing it.

Today the answer is partial and per-service:

- **KMS** already ships single-writer durability: `replication.go` log-ships
  ZapDB to an age-encrypted S3 mirror (HIP-0107), and `lease.go` fences the
  writer with a **Kubernetes Lease object**. This works, but the fence lives
  in `hanzoai/kms` alone, is coupled to the Kubernetes API server, and gives
  exactly one writer for the *whole* service — no per-tenant sharding, no
  runtime failover story beyond "kube-controller reassigns the Lease."
- **IAM** carries an explicit `Replicas > 1` guard — it refuses to run more
  than one replica because sessions and JWKS are single-writer with no
  coordinated fence.
- Every **other** stateful subsystem (`tasks`, `pubsub`, the 24 SQLite-
  backed services) reinvents "who writes" ad hoc, or runs
  `Deployment(replicas: 1)` and calls it HA.

Three "almost-the-same" single-writer patterns, three failure stories, and a
hard ceiling at one replica for anything with write state. A new plugin
author inherits none of it — they get a route mount and a data directory,
and must solve placement themselves.

The unifying observation: **placement is a tiny, strongly-consistent
decision problem sitting on top of a large, already-solved, weakly-
consistent byte problem.** The bytes (WAL frames, ZapDB deltas) are already
handled by HIP-0107's one pipeline. What is missing is a single authority
that says, linearizably, *who* may push those bytes for *which* shard at
*which* epoch. That authority is a replicated state machine. This HIP adds
exactly that RSM, wires the existing fence to consult it, and exposes the
whole thing to plugin authors as an inherited property of `cloud.Register`.

## Specification

### Two planes, decomplected

The load-bearing decision is that **consensus orders decisions, not bytes.**
The two planes never braid:

| | Control plane | Data plane |
|---|---|---|
| **What it orders** | Placement decisions (membership, `(plugin,shard)→{writer,followers}`, writer leases + epochs) | Durable bytes (SQLite WAL frames, ZapDB deltas, snapshots) |
| **Substrate** | **Quasar** PQ-BFT RSM (`luxfi/consensus/protocol/quasar`), 7-voter quorum (5-of-7), ordered finality | `hanzoai/replicate` over `hanzo/vfs`, async age-encrypted S3 log-ship (HIP-0107) |
| **Size** | Kilobytes. The whole placement map is small enough to fit in memory on every node. | Terabytes. Per-tenant WAL/delta streams. |
| **Consistency** | Linearizable (the RSM is the single source of truth for who-owns-what) | Eventually consistent to the mirror; strongly consistent at the single writer |
| **On the request path?** | **No** | **Yes** (the writer serves; followers proxy) |
| **Failure if it stops** | Placement frozen; no new failovers or shard moves; **serving continues** | Serving stops for the affected shard until a writer is (re)placed |

Because the control plane is off the request path, a control-plane quorum
loss is a **degradation of agility, not of availability**: existing writers
hold their leases and keep serving reads and writes; only *rebalancing* and
*failover* pause until quorum returns. This is deliberately the Chubby lock-
service / etcd shape — a small consensus kernel that hands out leases and
gets out of the way.

### Control plane: the placement RSM

The control plane is one **Quasar** replicated state machine. Quasar is a
**post-quantum, Byzantine-fault-tolerant** consensus engine with ordered
finality — the correct substrate when the decision being ordered is "who is
allowed to write," because a *wrong* or *equivocating* answer must be
**impossible**, not merely improbable, and because the lease-granting quorum
itself must be quantum-secure on-doctrine. The RSM drives the engine
(`luxfi/consensus/protocol/quasar` `NewEngine(cfg)`) through its
ordered-finality API — `Submit(block)` appends a placement command,
`Finalized() <-chan *Block` yields the finalized block sequence, and
`IsFinalized(id)` checks a specific command — and the **placement map is the
state machine built by deterministically reducing that finalized sequence**.
Each finalized block carries small, idempotent commands:

```
PlacementCommand {
    Kind       // Join | Leave | Assign | Revoke | RenewLease | Rebalance
    Plugin     // plugin name from cloud.Register(name, ...)
    Shard      // shard key (see "Unit and shard key")
    NodeID     // stable StatefulSet NodeID
    Epoch      // monotonically increasing fencing epoch for this shard
}
```

The RSM's deterministic reduction of that log yields the **placement map**:

```
PlacementMap {
    Members  map[NodeID]MemberInfo               // current voter + data-node set
    Owners   map[Shard]Assignment                // Assignment{ Writer NodeID; Followers []NodeID; Epoch uint64 }
}
```

Two invariants the RSM enforces by construction:

1. **One writer per shard per epoch.** An `Assign(shard, node, epoch)` is
   only committed if `epoch` is strictly greater than the shard's current
   epoch. Because the log is linearizable, two nodes can never both hold a
   valid lease for the same shard at the same epoch.
2. **Epochs are monotonic per shard.** A revoked or superseded writer's
   epoch is permanently in the past; it can never be revived. This is the
   fencing token the data plane checks (below).

The RSM log holds *only* this metadata. It never sees a WAL frame, a secret,
or a tenant byte. It is a coordination kernel, not a database.

This RSM **replaces the interim Kubernetes-Lease fence** in
`hanzoai/kms/lease.go`. That file's `writerLease` (a lease object polled
against the Kubernetes API server) was always a placeholder for "a real
distributed lease with fencing." The RSM *is* that lease, with a fencing
epoch the Kubernetes Lease never carried, and with no dependency on the
Kubernetes control plane being reachable on the write path.

**Post-quantum from day one.** The engine runs under a strict-PQ cert
profile from the start — *not* classical-now / PQ-later. The RSM calls
`SetProfile(*config.ChainSecurityProfile)` to bind the strict profile, and
the `Certifier`'s `demandsTriple` gate then requires the post-quantum
triple-mode certificate before a block finalizes. The threshold signer is
**Pulsar RoundSigner** (`protocol/quasar/pulsar/round_signer.go` — a
`PulsarRoundSigner` that adapts `luxfi/pulsar`; `NewPQ` = "BLS + Corona
threshold," Corona being the Ring-LWE production threshold), and it **fails
closed** to the PQ path rather than degrading to a classical signature. The
quorum that grants a writer lease is therefore quantum-secure by
construction, consistent with the platform's strict-PQ doctrine.

**Full Byzantine agreement, N nodes.** The quorum shape is decided: the
control plane runs **true N-node Byzantine agreement**, not crash-fault
replication. Each finalized block is certified by a threshold signature whose
shares are **split across the voter pods** and aggregated through the Pulsar
RoundSigner's `Round1` / `Round2` / `Finalize` protocol carried **over ZAP**
(HIP-0114); every voter then independently **verifies the aggregated
post-quantum certificate before applying the finalized block** to its
placement-map state machine. A block lacking a valid triple-mode PQ cert
never finalizes, so a Byzantine minority of voters can neither forge a
placement decision nor equivocate a lease grant. Byzantine tolerance and the
strict-PQ cert are **orthogonal and both on from day one**: the first is *how
many* faulty voters are survived; the second is *what* signs the result.

### What Quasar provides — and what it does not

Grounded in the actual `github.com/luxfi/consensus/protocol/quasar` package:

**Provides:**

- **Native membership.** The `luxfi/validators` Manager tracks a validator
  set per network ID — the control-plane voter set maps directly onto it.
- **An ordered-finality log.** `NewEngine(cfg)`
  (`protocol/quasar/engine.go:59`) returns an `Engine` whose
  `Submit(block)` / `Finalized() <-chan *Block` / `IsFinalized(id)` API is a
  totally ordered, finalized command stream — exactly the substrate a
  replicated state machine reduces into the placement map.
- **Post-quantum BFT finality.** `SetProfile(*config.ChainSecurityProfile)`
  binds a strict-PQ profile; the `Certifier`/`demandsTriple` triple-mode
  gate requires the PQ certificate before a block finalizes; the **Pulsar
  RoundSigner** (`pulsar/round_signer.go`, adapting `luxfi/pulsar`) is the
  quantum-secure threshold signer. BFT ordered finality suitable for a small
  fixed quorum — quantum-secure from the start.
- **Pure-Go embed.** Builds with `CGO_ENABLED=0`, so the control plane links
  into the same static `cloud` artifact (HIP-0106) with no native toolchain
  and no second process.

**Does not provide (by design):**

- **No pinned-writer primitive.** Quasar is a *leaderless* engine — there is
  deliberately no built-in "this node is the leader for this key" notion.
  **The host builds writer-pinning on top, as RSM leases.** That is the work
  this HIP specifies: the placement map and its epoch-fenced
  `Assign`/`Revoke` commands are the pinned-writer layer the engine
  intentionally omits.

The takeaway: Quasar gives ordered, post-quantum agreement and membership;
the *meaning* of the ordered commands (leases, placement) is the host's, and
this HIP defines it.

**Dependency prerequisite (external, not yet satisfied).** The strict-PQ
path does **not** build from published module tags today, and this HIP does
not pretend otherwise. The RoundSigner primitive the adapter consumes **is**
published — `github.com/luxfi/pulsar/ref/go/pkg/pulsar` in `luxfi/pulsar`
**v1.1.5** (build-proven since v1.1.3). The gap is **consensus-side**: the
cert-profile sub-package `protocol/quasar/pulsar` (the `PulsarRoundSigner`
adapter itself) is **unpublished** — it appears in **0 of 268**
`luxfi/consensus` release tags and lives only on the dev branch
`feat/quasar-pulsar-profile` (@`009ad013`), where it is wired via a `replace
github.com/luxfi/pulsar => ../luxfi/pulsar` that **Go ignores for downstream
consumers**. So a `cloud` importing any published `consensus` tag cannot
import `protocol/quasar/pulsar` at all. The base `protocol/quasar` engine
(`NewEngine`/`Submit`/`Finalized`/…) is already published; only the
cert-profile sub-package needs releasing. The single prerequisite is
therefore a **`luxfi/consensus` release tag that carries
`protocol/quasar/pulsar`, `require`s published `luxfi/pulsar v1.1.5`, and
drops the dev-branch `replace`** — a forward-port that is in progress now.
Until that tag lands, the control plane builds strict-PQ only against local
sibling checkouts. Stating this is the honest status — a HIP is a proposal,
and this is a real, unmet external dependency the proposal is blocked on.

### Data plane: replication reused unchanged

The data plane is HIP-0107's pipeline, reused **verbatim**:
`replicate.Source` → frame-pump → `luxfi/age` encrypt → `hanzo/vfs` sink.
KMS's `replication.go` already runs it against ZapDB with an age-encrypted
S3 mirror. Nothing about the byte path changes — same frames, same
encryption boundary, same bucket layout
(`vfs://<backend>/<bucket>/replicate/<org>/<service>/<source>/`), same
recovery objectives.

### The write-fence seam — the one code edit

The entire coupling between the two planes is a single function. Today
`canPush` (`hanzoai/kms/replication.go:452`) gates the primary's push loop
on the Kubernetes Lease:

```go
// today (interim): push only if we hold the K8s Lease and the store is hydrated
func canPush(hydrated *atomic.Bool, fence *writerLease) bool {
    return hydrated.Load() && fence.Held()
}
```

Under this HIP the seam flips to consult the control plane, and the S3
write is additionally guarded by an epoch CAS:

```go
// proposed: push only if the control plane grants THIS shard's lease at epoch E,
// and the S3 mirror's fencing epoch is not already ahead of us.
func canPush(hydrated *atomic.Bool, grant LeaseGrant) bool {
    return hydrated.Load() && grant.Valid() // grant = placement map's Assignment for our shard
}
// ... and every push CASes the mirror's `latest` fencing epoch:
//   write succeeds iff mirrorEpoch <= grant.Epoch, then bumps mirrorEpoch := grant.Epoch
```

Two fences, defense in depth:

1. **RSM grant** (linearizable, in-memory): a node pushes only for shards
   the placement map says it writes, at the current epoch.
2. **S3 epoch-CAS** (durable, at the sink): even a partitioned node that
   *believes* it still holds the lease is fenced at the mirror — a push
   carrying a stale epoch loses the CAS against a `latest` pointer already
   advanced by the successor writer. A deposed writer physically cannot
   corrupt the shared log.

`lease.go`'s Kubernetes-Lease path stays in the tree **behind a flag** for
one release (stage 2 below), so the cutover is reversible.

### Topology

```
        ┌─────────────────── control plane (fast, fixed) ───────────────────┐
        │  voter-0   voter-1   voter-2   voter-3   voter-4                   │
        │  └── Quasar PQ-BFT RSM · 7-voter quorum (5-of-7) · placement map ───┘
        └───────────────────────────────┬───────────────────────────────────┘
                                         │ watch: read-only placement map
        ┌────────────────────────────────┼──────────────────────────────────┐
        │  data-0   data-1   data-2   …   data-(N-1)   (non-voting, unbounded)│
        │  each: hosts shards · runs replication.go · serves or proxies      │
        └───────────────────────────────────────────────────────────────────┘
                                         │
                    per-tenant ZapDB/SQLite + age-encrypted S3 mirror (HIP-0107)
```

- **7 voter nodes** run the BFT control plane. Seven is the smallest set
  that tolerates two simultaneous **Byzantine** failures (`N ≥ 3f+1`, so
  `f=2`) with a quorum of five (`2f+1`); the count is fixed so consensus
  stays fast (agreement among seven, not among the whole fleet).
- **N non-voting data nodes** each *watch* a read-only replica of the
  placement map (the RSM streams committed updates to them), host the shards
  the map assigns them, run the unchanged `replication.go`, and serve or
  proxy requests. Data nodes carry no consensus weight, so **N scales
  unbounded** without slowing agreement.

A node may be both a voter and a data node in small deployments; at scale
they separate so control-plane latency is independent of data-plane fan-out.

### Unit and shard key

The **unit of placement is the plugin** — precisely the `(name, order, fn)`
registered via `cloud.Register` (`hanzoai/cloud/build.go:351`) — crossed
with a **shard**:

- **Coarse first (ship this):** `shard = the whole plugin`. One global
  writer per plugin, every tenant's data behind it. **Zero storage change** —
  the plugin's existing single data directory is the single shard. This is
  the KMS shape today, generalized to every plugin.
- **Fine later (opt-in, stage 8):** `shard = (plugin, org)`. Per-tenant
  writers, using the HIP-0302 per-org file layout
  `{DataDir}/orgs/{org}/{svc}.db` that already exists. A hot tenant gets its
  own writer on its own node; a cold tenant costs nothing until touched.

Node **specialization** is expressed two ways, both orthogonal to code:

1. **Which shards/writers live where** — the placement map, *dynamic*, moved
   by the RSM at runtime. This is failover and rebalancing.
2. **Which plugins a node-pool may run at all** — the `--enable` subsystem
   set from HIP-0106, *static* per node-pool, for resource isolation (e.g. a
   GPU pool enables only inference plugins).

Specialization is **never** a runtime mount/unmount of plugin code. Every
`cloud` binary contains every compiled plugin (HIP-0106); placement decides
which *shards* are *active* where, not which *code* is *present*. One
artifact, many roles, by data — not by rebuild.

### Per-connection pinning

Pinning is one middleware, mounted immediately after `IdentityMiddleware`
(`hanzoai/cloud/serve.go:97`) so it runs with a validated org already in
context:

```
1. Identity middleware resolves org from the JWT owner claim (HIP-0026).
2. Placement middleware computes shard = (plugin, org)  [coarse: shard = plugin].
3. It looks up Owners[shard] in the watched, read-only placement map (in-memory, no RPC).
4a. This node is the writer            → serve locally.
4b. Read that requires read-your-writes → reverse-proxy to the writer.
4c. Stale-OK read                       → serve from a local follower copy, or proxy to any follower.
4d. This node is neither                → reverse-proxy to the writer.
```

Proxying is **pod-to-pod over the StatefulSet headless service** — a node
dials `cloud-<N>.cloud-headless` directly by stable DNS, no load balancer in
the middle, no extra hop through ingress. Writes and read-your-writes go to
the shard's writer; explicitly stale-OK reads may be served by any follower
(the followers are the HA standbys — see Decided forks). The client sees one
endpoint; the fleet routes the connection to the byte-owner underneath.

### Plugin authoring — the payoff

This is the point of the HIP. A plugin author writes one small interface
implementation and one `cloud.Register` call, and **inherits consensus
placement, per-tenant sharding, shared ZapDB replication, per-connection
pinning, and HA — for free.** They write none of those mechanisms.

The default wire is **ZAP-native** (HIP-0114), high-performance by
construction: `hanzoai/s3` is already ZAP-native (gRPC call-count = 0), and
KMS's `embed.go` runs a ZAP server today. A new plugin gets the same
transport with no extra work.

A complete "hello, sharded, replicated, HA plugin" — about twenty lines:

```go
package hello

import (
    "github.com/hanzoai/cloud"
    "github.com/hanzoai/zip"
)

// Store is the plugin's per-shard state; the runtime opens it at the
// HIP-0302 path for the shard the placement map assigns to this node,
// and log-ships it via HIP-0107 replication. The author does not manage it.
type Store struct{ db cloud.ShardDB }

func mount(app *zip.App, deps cloud.Deps) error {
    s := &Store{db: deps.OpenShard("hello")} // coarse: one shard for the plugin
    app.Get("/v1/hello/:key", func(c zip.Ctx) error {
        return c.JSON(s.db.Get(c.Param("key")))       // pinned to a follower or writer automatically
    })
    app.Put("/v1/hello/:key", func(c zip.Ctx) error {
        return s.db.Put(c.Param("key"), c.Body())     // pinned to the writer automatically
    })
    return nil
}

func init() { cloud.Register("hello", 500, mount) } // that's the whole integration
```

Everything the author did *not* write, but got: the RSM chose which node
writes `hello`; the placement middleware routed each connection to that
node; `replication.go` mirrored the ZapDB to age-encrypted S3; a follower
stands ready to be promoted on writer loss; and the epoch fence guarantees
no split-brain write. The plugin is planet-scale and HA because it was
registered, not because it was engineered to be.

### Deployment: Deployment → StatefulSet

The runtime needs **stable identity** (a node's `NodeID` must survive a
restart so the RSM membership and placement map stay valid) and **stable
storage** (a node must reopen the same shard files). That is a StatefulSet,
not a Deployment.

| Property | Today (HIP-0106) | This HIP |
|---|---|---|
| Workload kind | `Deployment(strategy: Recreate, replicas: 1)` | `StatefulSet(replicas: N)` |
| Identity | Random pod name | Stable `NodeID` = ordinal (`cloud-0 … cloud-(N-1)`) |
| Networking | Service only | **Headless service** for pod-to-pod (`cloud-<N>.cloud-headless`) + existing Services |
| Storage | Shared/ephemeral | `volumeClaimTemplates` → per-pod PVC (each node's shards) |
| Upgrade | Recreate (full stop) | `RollingUpdate{maxUnavailable: 1}`, `OrderedReady` |

Because `NodeID`s are **stable across image upgrades**, a rolling upgrade is
*not* a membership change: the RSM sees the same seven voters and the same
data-node identities before and after, so **no epoch reconfiguration and no
placement churn** happens on a deploy. `maxUnavailable: 1` keeps the voter
quorum (6 of 7, above the 5-of-7 threshold) live throughout the roll.

The existing Service aliases keep resolving: `kms` and `cloud-api` Services
select `app.kubernetes.io/name: cloud`, which the StatefulSet pods still
carry, so nothing downstream re-points. The operator's `hanzo.ai/v1 kind:
Service` CR (HIP-0112) gains a **StatefulSet-emitting mode** — a boolean on
the CR that makes the operator render a StatefulSet + headless service +
volumeClaimTemplates instead of a Deployment. One CR field, one new render
path; the CR contract is otherwise unchanged.

## Migration plan

Nine stages. **Each is independently correct, canary-able, and reversible.**
`[M]` = mechanical (config/plumbing, no behavior flip). `[BR]` = blue→red (a
behavior change that must be adversarially reviewed before it ships).

### Stage 0 — dependencies + inert config `[M]`

Vendor `luxfi/consensus` (Quasar) and `luxfi/pulsar` into `cloud` — pure-Go,
`CGO_ENABLED=0`. **Gated on the external dependency prerequisite** (see "What
Quasar provides"): the strict-PQ cert-profile package `protocol/quasar/pulsar`
is unpublished (dev branch only), so until a `luxfi/consensus` release tag
carries it (requiring published `luxfi/pulsar v1.1.5`, `replace` removed),
this stage builds strict-PQ only against local sibling checkouts — not yet
reproducible from module tags. Add the placement-map types and config knobs
**inert** — compiled in, read nothing, change nothing. Ship. Nothing behaves
differently; the surface exists.

### Stage 1 — control-plane RSM in SHADOW `[BR]`

Mount the placement RSM as a new `cluster` subsystem (its own
`cloud.Register`) running in **shadow**: the seven voters agree on membership
and a placement map, data nodes watch it, but **nothing consults it yet** —
the live fence is still the Kubernetes Lease. Verify in production that the
shadow map matches reality (the RSM's chosen writer == the actual Lease
holder) before trusting it.

### Stage 2 — flip the KMS `canPush` fence seam `[BR]`

Point `canPush` (`replication.go:452`) at the RSM grant instead of
`fence.Held()`, and add the S3 epoch-CAS to the push. Keep `lease.go`'s
Kubernetes-Lease path **behind a flag** for one release so the cutover is a
config toggle, reversible in seconds. This is the single highest-value edit;
it is `[BR]` because it changes who-may-write.

### Stage 3 — operator emits StatefulSet `[M]`

Teach the operator's `Service` CR the StatefulSet-emitting mode (stable
`NodeID`, headless service, `volumeClaimTemplates`, `RollingUpdate
maxUnavailable:1 OrderedReady`). Migrate KMS's own workload to it. Still
`replicas: 1` — this stage only changes the *kind*, not the count.

### Stage 4 — KMS `N > 1`, coarse `[BR]`

Raise KMS to multiple replicas with the whole service as one coarse shard:
one RSM-elected writer, the rest followers/standbys, per-connection pinning
live. First real multi-writer-capable subsystem. Prove failover: kill the
writer, watch the RSM `Assign` a follower at epoch+1, watch the old writer
get fenced by the S3 CAS.

### Stage 5 — Infisical cutover `[BR]`

Retire the external Infisical secret store into KMS-on-this-runtime. Import
and **verify** every secret (count + checksum). Stand up an `/api` compat
shim for legacy Infisical clients — **this shim is the cross-tenant-leak
surface and the primary red-team target of the whole migration** (a shim
that resolves the wrong org's secret is a breach). Merge the `kms` Service
alias into the `cloud` alias. Verify the three `DEPRECATED.md` gates and all
30 machine identities still authenticate. Only then kill Infisical.

### Stage 6 — roll coarse-writer to `tasks`, `pubsub`, the 24 SQLite services `[BR]`

Bring the remaining stateful subsystems under coarse placement. The
**audit subsystem is specifically `[BR]`**: it keeps an in-memory sequence
counter / head pointer that must move to the replicated store *before* it
can have a second replica — otherwise two writers mint colliding sequence
numbers. Do that move first, review it, then raise its replica count.

### Stage 7 — IAM `N > 1` `[BR]`

**Last, because it is the highest blast radius.** Move sessions to the
replicated KV shard, hold a single JWKS in KMS (one signing key, RSM-placed
writer), and **lift the `Replicas > 1` gate** that IAM carries today. Auth
is on every request path, so this ships last and is reviewed hardest.

### Stage 8 — fine `(plugin, org)` sharding `[BR]` (future, opt-in)

Split coarse plugin-shards into per-tenant `(plugin, org)` shards on the
HIP-0302 per-org layout. Opt-in per plugin. A hot tenant gets a dedicated
writer; cold tenants stay free. This is a placement-map refinement — no new
mechanism, just a finer shard key — and it is explicitly future work.

## Decided forks

Where the design chose one path, and why:

| Decision | Chosen | Rationale |
|---|---|---|
| Control-plane consensus | **Quasar PQ-BFT** (`protocol/quasar` `NewEngine`) | Placement decides *who may write*; a wrong/equivocating answer must be **impossible**, not improbable. **Full N-node Byzantine agreement** (decided): threshold shares split across voter pods, aggregated via Pulsar RoundSigner `Round1`/`Round2`/`Finalize` over ZAP, each voter verifying the aggregated PQ cert before applying a finalized block. **Strict-PQ from day one** (`ChainSecurityProfile` triple-mode gate) — orthogonal to and simultaneous with the Byzantine guarantee, *not* classical-now / PQ-later. |
| Quorum shape | **7 voters + N data nodes** | `N ≥ 3f+1` for `f=2`: seven is the smallest voter set with a Byzantine quorum (`2f+1 = 5`) tolerating 2 faults; consensus stays fast among a fixed 7 while data nodes scale unbounded. |
| Shard granularity (v1) | **Coarse, per-plugin** | One global writer per plugin = **zero storage change** (existing data dir is the shard). Fine `(plugin,org)` is a later, opt-in refinement. |
| KMS read path | **Writer serves reads**; followers are HA standbys | Simplest correct default; reads are already fast at the writer. Follower-serves-stale-reads is available per-connection for read-heavy plugins. |
| Replication mode (default) | **Async S3 log-ship** (reuse `replication.go`) | Reuses HIP-0107 unchanged; RPO is small and already characterized. Sync (RPO = 0) is a **per-shard opt-in** for plugins that need it, not the default tax. |
| Default counts | **7 voters / 3 data replicas** | 3 data replicas = one writer + two standbys, tolerating one node loss with a warm successor. |

## Failure modes

| Failure | Behavior | Why it is safe |
|---|---|---|
| **Control-plane quorum loss** (≥3 voters down) | Placement **frozen**: no new failovers, no rebalancing. **Serving continues** — every current writer keeps its lease and keeps writing. | Consensus is off the data path. The placement map is last-known-good and every data node already has it cached. Agility degrades; availability does not. |
| **Split-brain write attempt** (a partitioned old writer thinks it still owns a shard) | The stale writer is fenced. | Two independent fences: (1) the RSM never grants two valid leases for one shard/epoch (linearizable); (2) the S3 epoch-CAS rejects any push whose epoch is behind the mirror's `latest` — the deposed writer physically cannot append. |
| **Writer node loss** | RSM commits `Assign(shard, follower, epoch+1)`; a warm follower is promoted; pinning re-routes new connections to it. | Followers are HA standbys already replicating the shard; promotion is a placement-map update, not a data copy. |
| **Rolling image upgrade** | No membership change, no epoch reconfig, no placement churn. | Stable `NodeID`s make the roll invisible to the RSM; `maxUnavailable:1` keeps 6/7 voters live — above the 5-of-7 quorum — throughout. |
| **Data migration correctness** (coarse→fine, or Infisical import) | Verified by **count + checksum** before the old source is retired. | No cutover trusts the copy; every stage proves equivalence first, then flips. |
| **`/api` compat-shim mis-scoping** (stage 5) | Explicitly called out as **the** cross-tenant-leak surface. | The shim translates legacy paths to org-scoped KMS lookups; a scoping bug leaks another tenant's secret. It is the primary red-team target and ships behind the most review. |

## Non-goals

- **Replacing HIP-0107's byte pipeline.** The data plane is reused
  unchanged. This HIP adds the *decision* layer above it, nothing below.
- **Cross-deployment / cross-region consensus.** The RSM coordinates one
  deployment's fleet. Geo-failover and multi-region topology are an operator
  concern over the `hanzo/vfs` backend (HIP-0107 non-goal), not this RSM.
- **Making consensus a dependency of serving.** Explicitly rejected — the
  whole point is that serving survives quorum loss. Any design that puts the
  RSM on the request path violates this HIP.
- **A general scheduler.** This is placement of *plugin write ownership*,
  not a Kubernetes replacement. Node-pool `--enable` sets (HIP-0106) and the
  operator (HIP-0112) still own coarse scheduling.
- **Folding `vault` / `payments`.** Per HIP-0106's solo-vault CDE rule, the
  PCI systems stay their own deployments and are not placed by this runtime.

## Open questions

1. **Voter/data co-residence threshold.** At what fleet size do voters and
   data nodes separate onto distinct pools? Small deployments co-locate; the
   crossover point wants measurement.
2. **Placement-map watch fan-out.** N data nodes each stream committed
   placement updates from the RSM. Confirm the fan-out is a broadcast from
   voters (cheap) and not N point-to-point subscriptions at scale.
3. **Epoch-CAS backend contract.** The S3 fence needs a CAS on the `latest`
   pointer. Confirm the `hanzo/vfs` backend exposes a conditional-write /
   if-match primitive on every sink (S3 If-Match, GCS generation-match), or
   define the fallback for backends that do not.
4. **Rebalancing policy.** The RSM *can* move a shard's writer for load;
   *when* it should (hysteresis, cost of a writer move = a follower promotion
   + connection re-pin) is a policy this HIP leaves to a follow-up.
5. **Sync replication opt-in shape.** Per-shard RPO-0 (sync log-ship) is a
   decided future option; the exact per-plugin knob (a field on
   `cloud.Register`? a shard annotation?) is unspecified here.

## References

- HIP-0026 — Identity and Access Management (org from JWT `owner` claim;
  the pinning key's tenant component)
- HIP-0027 — Secrets Management (KMS; the first subsystem placed, and the
  holder of the single JWKS in stage 7)
- HIP-0105 — In-Process Extension Runtime (`cloud.Register`, the plugin
  unit this HIP places)
- HIP-0106 — Cloud, Unified Hanzo Binary (the one artifact and `--enable`
  subsystem model this HIP makes stateful and HA)
- HIP-0107 — Streaming Replication over VFS (the data plane, reused
  unchanged)
- HIP-0112 — Cloud Infrastructure Topology Standard (the operator `Service`
  CR that gains a StatefulSet-emitting mode)
- HIP-0114 — ZAP Inter-VM Cognitive Transport (the ZAP-native default wire
  for plugins)
- HIP-0302 — Hanzo Replicate: Encrypted SQLite + ZapDB Durability (the
  per-org `{DataDir}/orgs/{org}/{svc}.db` layout fine sharding uses)
- Reference seams (grounded): `hanzoai/kms/replication.go` (`canPush`, line
  452), `hanzoai/kms/lease.go` (interim `writerLease`), `hanzoai/kms/embed.go`
  (ZAP server), `hanzoai/cloud/build.go` (`Register`, line 351),
  `hanzoai/cloud/serve.go` (`IdentityMiddleware`, line 97),
  `github.com/luxfi/consensus/protocol/quasar`
  (`NewEngine`/`Submit`/`Finalized`/`IsFinalized`/`SetProfile`, `engine.go:59`;
  `Certifier`/`demandsTriple` strict-PQ gate; `pulsar/round_signer.go`
  `PulsarRoundSigner` — `Round1`/`Round2`/`Finalize` — importing
  `github.com/luxfi/pulsar/ref/go/pkg/pulsar` RoundSigner), `luxfi/validators`
  Manager
- Quasar + Pulsar (post-quantum BFT ordering + threshold certification): the
  control plane's consensus engine (`github.com/luxfi/consensus/protocol/quasar`)
  and its strict-PQ threshold signer (`github.com/luxfi/pulsar`, Pulsar
  threshold ML-DSA + Corona Ring-LWE threshold). **Dependency prerequisite
  (unmet):** the RoundSigner primitive is published (`luxfi/pulsar v1.1.5`),
  but the consensus cert-profile package `protocol/quasar/pulsar` is
  unpublished (0/268 tags; dev branch `feat/quasar-pulsar-profile`
  @`009ad013`, behind a `replace` Go ignores downstream). Needs one
  `luxfi/consensus` release tag carrying `protocol/quasar/pulsar`, requiring
  published pulsar v1.1.5, `replace` removed — forward-port in progress
- Prior art: M. Burrows, *The Chubby Lock Service for Loosely-Coupled
  Distributed Systems* (OSDI 2006); *etcd* Raft coordination kernel

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
