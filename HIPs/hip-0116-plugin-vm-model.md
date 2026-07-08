---
hip: 0116
title: Hanzo Plugin & VM Model — Standalone-plus-Plugin Services on Lux Consensus + ZapDB
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-07-07
requires: HIP-0105, HIP-0106, HIP-0114, HIP-0122
depends-on-external: luxfi/lpm (Lux Plugin Manager), luxfi/node (VM plugin-host model), luxfi/consensus (Quasar), luxfi/zapdb
---

# HIP-0116: Hanzo Plugin & VM Model — Standalone-plus-Plugin Services on Lux Consensus + ZapDB

## Abstract

This proposal defines how Hanzo services compose into the unified
`cloud` binary (HIP-0106) **without build tags and without a second
RPC stack**: every `hanzoai/<repo>` service builds as BOTH a
standalone binary AND a **plugin VM** for the cloud host, reusing the
Lux VM/plugin architecture — `luxfi/lpm` for install/enable-on-demand
distribution, and the `luxfi/node` VM-host model in which a VM is an
independently-built binary the host supervises and dials. The
host↔plugin transport is **ZAP** (HIP-0114) and nothing else:
in-process ZAP-typed Go interfaces when co-resident, ZAP RPC over the
wire when split — exactly the dual-resolution contract HIP-0106
already specifies for subsystems. A plugin VM is simply a subsystem
that lives in another process.

Every VM tracks its own replication/consensus state on the shared
substrate of **Lux consensus (Quasar) + ZapDB** — in-memory for a
single node, durable HA when clustered — the way a Lux chain tracks
chain state. There is **no gRPC, no etcd, no ZooKeeper, no raft**
anywhere in this model.

This HIP answers HIP-0106 Open Question 4 (build-time vs runtime
composition): the answer is **neither build tags nor bigger binaries**
— it is plugins.

## Motivation

The realized HIP-0106 binary compiles every subsystem in: 318,308,514
bytes (~303.6 MiB) with the console embedded. For the SaaS fat build
this is correct — one artifact, everything on. Two pressures argue for
a second composition mechanism:

1. **Small deployments should not carry what they never mount.** A
   reseller running `iam,kms,gateway` gets a 300 MiB image where a
   fraction would do. Disabled subsystems cost zero runtime, but they
   still cost image pull, attack-surface review, and rebuilds.
2. **A new service should join a running deployment without
   recompiling the world.** Today adding a subsystem is a compile-time
   event: a blank import in `cmd/cloud` and a release of the whole
   binary.

Two easy answers were considered and **rejected**:

- **Go build tags** (`//go:build with_iam`). Compile-time, not
  dynamic: every enable/disable is a rebuild; the image matrix goes
  combinatorial (2^n variants); "one artifact" — the property HIP-0106
  exists to create — dies; ergonomics are poor (the operator's knob
  becomes a CI parameter). Build tags select code, they do not compose
  systems.
- **Go `plugin` (dlopen).** Requires exact toolchain and
  dependency-version match between host and plugin, cannot unload,
  offers no crash isolation, drags cgo in, and is effectively
  Linux-only. A crashing plugin takes the host with it — the opposite
  of the blast-radius isolation the embeds were built around.

The chosen answer reuses what Lux already proved: a **VM is a
standalone binary that plugs into a host process**, installed and
version-managed by a plugin manager. `luxfi/node` runs every chain VM
this way; `luxfi/lpm` already installs VM binaries from third-party
repositories. Hanzo adopts the model and swaps in Hanzo's one
transport: ZAP.

## Specification

### One service, three shapes

Every `hanzoai/<repo>` service produces three artifacts from **one
codebase and one contract** — the `Mount(app, deps)` + `.zap` schema
contract of HIP-0106, where `app` is the **zip** application server
core (HIP-0122): the same `zip.App` surface hosts all three shapes,
and `app.Mount` preserving the full path is what keeps a subsystem's
routes identical across them. The shape is a packaging decision, never
a code fork:

| Shape | Artifact | Dispatch | When used |
|---|---|---|---|
| **Standalone** | `cmd/<svc>` binary, own image | own HTTP + ZAP listeners | its own Deployment (HIP-0113 conventions) |
| **Embedded subsystem** | Go package; `cloud.Register(name, order, mount)` + blank import in `cmd/cloud` | in-process ZAP-typed Go interfaces | the SaaS fat build (HIP-0106 realized state) |
| **Plugin VM** | `<svc>` binary installed by `lpm`, launched and supervised by the `cloud` host | ZAP RPC (HIP-0114) over the plugin's local endpoint | small host + on-demand composition |

Subsystem business code is identical across all three. The Deps
wiring table in HIP-0106 ("Inter-subsystem client wiring") gains
exactly one row:

| Subsystem state | Resolves to |
|---|---|
| Installed as plugin VM | ZAP RPC client targeting the VM's endpoint, registered at plugin start |

The caller still writes `deps.<Name>.<Method>(...)` and never
branches on the mode. One contract, one transport, three shapes.

### The VM contract

A service-as-VM follows the `luxfi/node` host model:

1. **The host launches the VM.** `cloud` starts each installed plugin
   binary as a supervised child process: crash isolation (a dying VM
   returns errors on its ZAP endpoint and gets restarted; co-resident
   subsystems never notice), independent versioning, independent
   memory space. This preserves — strengthens — the fail-closed
   blast-radius rule of the HIP-0106 embeds: a broken subsystem
   degrades to 503 on its own prefix, whether it broke in-process or
   out.
2. **The host dials the VM over ZAP.** Envelope, framing, and
   authentication are exactly HIP-0114. ZAP remains *only a
   transport* (HIP-0114's Bridge Law): being reachable over the plugin
   socket confers no authority. Identity and authorization stay at the
   IAM boundary (HIP-0026); the gateway-minted org context crosses the
   plugin boundary inside the ZAP envelope the same way it crosses the
   in-process Deps boundary.
3. **The VM answers the same `.zap` schema** it serves in-process.
   `zapc`-generated servers and clients are shared between the
   embedded and plugin shapes; there is no plugin-only interface
   definition language, because that would be a second way.

**Rejected transport explicitly:** there is no gRPC anywhere in this
model — not for the handshake, not for health, not for dispatch.
Every Hanzo-authored transport is ZAP. Health and lifecycle ride the
same ZAP procedure set, per HIP-0114's cognitive procedure framing.

### Distribution — lpm

Plugin install/enable is `luxfi/lpm` (the Lux Plugin Manager), not a
Hanzo-invented package manager:

```bash
lpm add-repository hanzoai/<repo>     # register a plugin source
lpm install-github hanzoai/<repo>     # fetch + install a pinned release
```

- Plugins install **on demand** into the host's plugin directory;
  `cloud` enables them at startup (and, once the supervisor lands,
  at runtime) without a rebuild.
- Versions are pinned by lpm; upgrading a plugin never requires
  releasing the host binary.
- CI for every `hanzoai/<repo>` service builds all three shapes from
  the same commit (HIP-0036 lanes) — the standalone image, the
  embeddable package, and the lpm-installable plugin artifact.

### The state substrate — Lux consensus (Quasar) + ZapDB

Each VM tracks **its own** replication/consensus state, the way a Lux
chain tracks chain state:

- **Single node:** in-memory consensus — instant finality, no quorum,
  zero configuration. This is the laptop / edge / `cloud serve`
  (HIP-0117) shape.
- **HA cluster:** durable Quasar rounds over a replicated ZapDB log.
  The same VM, the same state machine, now fault-tolerant.

Concretely, the VMs on this substrate include: **datastore** (the
columnar store), **each Base instance** (per-tenant SQLite file per
HIP-0029/HIP-0302), and **pubsub** (JetStream stream state). This is
why the embedded pubsub in HIP-0106's realized state ships with **no
ZooKeeper, no raft, no etcd** — the coordination stack is ZAP +
Quasar + ZapDB, complete and closed. A VM that needs replicated state
gets it from the substrate; it does not import a consensus library of
its own.

### Deployment shapes

| Deployment | Composition | Dispatch |
|---|---|---|
| SaaS (`console.hanzo.ai`, `api.hanzo.ai`) | **100% enabled, co-located/embedded** — the fat build, all subsystems compiled in | in-process ZAP-typed Go |
| Custom / distributed instance | small host + only the plugins the deployment needs, installed via lpm | ZAP RPC to plugin VMs |
| Hybrid | fat host with hot subsystems split out as standalone services | ZAP RPC over the wire (HIP-0106 split mode) |

Same contract everywhere. The SaaS shape is what shipped; it is also
the degenerate case of the plugin model in which every plugin is
co-resident and dispatch collapses to a Go method call.

Because a plugin VM is independently packaged, it is independently
**schedulable**: horizontal scaling of a plugin VM's nodes —
per-service, per-org, per-project, across providers — is **visor**'s
concern (HIP-0123), which treats the plugin VM as its scalable unit.
This HIP defines the unit; HIP-0123 defines its elasticity.

### Decided vs shipped

Honesty section. As of this writing:

- **Shipped:** the registry contract (`cloud.Register` + blank-import
  activation), the in-process embeds, the dual-resolution Deps wiring
  (in-process / ZAP RPC / fail-closed stub) — see HIP-0106 realized
  state.
- **Decided, staged behind the SaaS-first cutover:** the plugin-VM
  loader (host-supervised child processes), the lpm integration, and
  the Quasar-durable HA mode of the state substrate (single-node
  in-memory is the shipped default; embedded pubsub documents the
  Quasar control plane as its follow-up).

The staging is safe because the contract is already shape-agnostic:
no subsystem code changes when the loader lands — the only new code
is the host's supervisor and one new resolution row in `BuildDeps`.

## Rationale

**Why not build tags.** Build tags answer "what code is in the
binary", not "what services compose at runtime". They multiply
artifacts, push operational decisions into CI, and cannot express
install-on-demand. The one-artifact invariant is worth more than the
megabytes.

**Why not dlopen.** Go's `plugin` package couples host and plugin at
the ABI level (same toolchain, same dep graph), cannot unload, and
shares a fate domain — one bad plugin kills the process. The
supervised-child model gives crash isolation and independent releases
for the cost of a local ZAP hop.

**Why ZAP and not a second RPC layer.** HIP-0106 already made ZAP the
one inter-subsystem contract; HIP-0114 already specifies the inter-VM
envelope, framing, and authentication. A plugin is a subsystem in
another process — giving it a different protocol would braid packaging
shape into transport choice. One and one way: every boundary a Hanzo
service crosses is ZAP-typed, whether that boundary is a function
call, a plugin socket, or the network.

**Why the Lux VM model.** It is proven at consensus-grade stakes
(`luxfi/node` runs every chain VM as a supervised plugin binary), the
tooling exists (`lpm` installs from `hanzoai/<repo>` sources today),
and the state substrate exists (Quasar, ZapDB). Composition over
invention: Hanzo adopts the architecture and contributes the ZAP
dispatch; it does not build a parallel plugin ecosystem.

**Orthogonality.** Each concern has exactly one HIP:

- HIP-0105 — user-supplied code **inside** a service process
  (extension runtimes). Extensions are not plugins; they are tenant
  code under a sandbox.
- HIP-0106 — the host binary itself: subsystems, Deps, fail-closed
  embeds.
- HIP-0114 — the transport: ZAP envelope, framing, Bridge Law.
- **HIP-0116 (this)** — how services take shape: standalone, embedded,
  or plugin VM, and the state substrate under them.
- HIP-0117 — where the result runs: single process, self-bootstrapped
  cluster, or BYO Kubernetes.
- HIP-0122 — the server core (zip) every shape mounts on: `zip.App`,
  transport-as-value Listen, the Mount surface.
- HIP-0123 — how the plugin-VM unit scales: visor's per-tenant
  per-service node pools across providers.

## References

- HIP-0105 — In-Process Extension Runtime Standard (user code inside
  the process; the boundary this HIP deliberately does not cover)
- HIP-0106 — Cloud — Unified Hanzo Binary (the host; realized state
  documents the shipped embeds this model generalizes)
- HIP-0114 — ZAP — Inter-VM Cognitive Transport (the one transport;
  envelope, framing, authentication, Bridge Law)
- HIP-0117 — Cloud-in-a-Box — One Binary, Three Modes (deployment
  topology built on this model)
- HIP-0122 — zip — The ZAP-Native Application Server Core (the
  `zip.App` mount surface shared by all three shapes)
- HIP-0123 — Visor — Fleet & Fabric Autoscaling Across Any Provider
  (scales the plugin-VM unit this HIP defines)
- HIP-0029 / HIP-0302 — per-tenant SQLite storage carried by Base VMs
- `luxfi/lpm` — Lux Plugin Manager (`add-repository`,
  `install-github`)
- `luxfi/node` — the VM plugin-host model this HIP adopts
- `luxfi/consensus` (`protocol/quasar`) — Quasar consensus
- `luxfi/zapdb` — the ZAP-native durable log/store under VM state
