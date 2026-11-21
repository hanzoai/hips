---
hip: 1330
title: Dev — The Agent Loop
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: dev
status: Draft
implementation-go: partial
updated: 2026-11-21
created: 2026-09-18
requires: HIP-0026, HIP-0106, HIP-0114, HIP-0139, HIP-1146
---

# HIP-1330: Dev — The Agent Loop

## Abstract

`/v1/dev` is the canonical capability for running a coding agent in cloud. It owns
the loop — session state, model calls, tool choice, plan — and owns no execution.
Every effect on an operating system is leased from sandbox (HIP-1146), which runs
it under visor with a kernel of its own. The implementation is `hanzoai/cloud`
`apps/dev` plus `plugin/dev`, the reasoning core is `hanzoai/dev`, and the two meet
over one protocol of events and actions encoded in ZAP (HIP-0114).

## Motivation

A coding agent is two different programs wearing one name. One of them reasons:
it holds a conversation, picks tools, plans an edit, and never touches a file. The
other one runs `cargo test`: real processes, real signals, real pty, arbitrary
native code. Run both inside the isolation boundary and every model token, every
context operation and every cloud call pays to cross it. Run both outside and
there is no boundary.

Split at the actual seam and each half gets the environment it needs. The loop
runs in-process, at in-process latency. The effects run in a cell that can be
killed, and a turn enters that cell two or three times rather than living in it.

## Specification

### The boundary

    THINK                            DO

    /v1/dev + dev core               sandbox → visor
    ──────────────────               ───────────────
    reason                Action     exec
    ask a model           ─────▶     shell
    choose tools                     compiler
    hold context                     git
    plan edits            ◀─────     pty
                       Observation   files

- **dev core (`hanzoai/dev`, Rust)** holds conversation and reasoning state, picks
  tools, plans patches, compacts context, schedules sub-agents. It reads nothing
  from a disk and opens no socket.
- **`/v1/dev` (Go)** is identity, model routing, quota, streaming, the session
  record, the action ledger, and the capability policy that decides which actions
  are allowed to happen at all.
- **sandbox (HIP-1146)** is untrusted Linux: processes, signals, pipes, ptys,
  shells, compilers, package managers, git. It is leased per session and its
  runtime class is visor.
- **Workspace** is served to the cell; the cell holds no storage credential, and
  the bytes live in s3. A compiler takes its files from the host (HIP-0114).

### The protocol

One protocol, three deployments: `hanzo dev` on a laptop, `/v1/dev` in cloud, and
a remote session over ZAP all speak it. Events go in, actions come out.

    Event                 Action
    ─────                 ──────
    Turn                  Model
    Model                 Read
    Exec                  Write
    File                  Patch
    Git                   Exec
    Browse                Git
    Timer                 Browse
    Cancel                Emit
                          Save
                          Done

The payload is a ZAP message, not a C struct and not JSON: the buffer is the
message, so a turn that ships thousands of file reads pays for no parse and no
copy. Count the messages before calling serialization cheap.

### Hosting the core

The core is one Rust library with one C ABI — open a session, step it with an
event, snapshot it, restore it, drop it — and that ABI is the export list of a
wasm module unchanged (`make wasm` in `hanzoai/dev`). Two hosts, one loop:

    native   `libdev.a` behind the C header, for a host that shares its memory
    wasm     `dev.wasm` under wazero, for cloud

Cloud takes the wasm build. It needs no cgo and no Rust toolchain in cloud's own
build, a session is an instance with memory of its own, and a panic in the core
is a trap the host survives rather than something that must be caught before it
crosses a C boundary. A host that shares no memory with the module borrows some
(`dev_alloc`, `dev_release`) to pass an event in and receive the actions out.

**The import list is the proof that the core touches nothing.** The module asks
its host for `environ_get`, `environ_sizes_get`, `fd_write` and `proc_exit` — and
for no file, no socket, no clock and no source of randomness. "The core reads
nothing from a disk and opens no socket" is therefore a property a build can
check, not one a review has to notice; a change that grows the list has given the
loop an effect of its own.

Measured from a wazero host: compile 85 ms once per process, instantiate 46 µs,
a step 86 µs, a snapshot 21 µs, about 1 MiB a session. The loop's cost is the
model's latency and the cell's; the boundary between host and core is not where
the time goes.

### Actions carry identity

Every action the core emits carries an id. The ledger records dispatch and
completion under that id, and an observation names the id it answers.

    Exec{id: 7821, argv: ["cargo", "test"]}

    7821 dispatched
    7821 completed

If the service dies after `cargo test` ran and before the core saw the result, the
**result** is replayed; the command is not run twice. The same rule covers
`git commit`, `rm`, a publish, a write, a browser POST. So: decisions are
replayable, effects are deduplicated, and at-least-once delivery of an event does
not mean at-least-once execution of an effect.

### A session is three facts, persisted apart

    state       the core's own snapshot
    workspace   a content-addressed snapshot id
    journal     the action ledger, at a sequence number

Suspend is: snapshot the core, checkpoint the workspace, end the lease. Resume is:
lease a cell, mount the snapshot, restore the core, continue from the sequence
number. A cell is never the session — a lease can be lost at any moment, and the
three facts above are always enough to rebuild. Sandbox checkpoints stay an
optimization for a warm environment, never the record.

Durability is `hanzoai/tasks` and nothing else (HIP-1300 family): a session is a
workflow, a step is a step, and a pipeline resumes at the step it died on. There
is no second async system.

### The surface

    POST   /v1/dev              start a session
    GET    /v1/dev              list sessions
    GET    /v1/dev/:id          one session: state, lease, sequence
    POST   /v1/dev/:id          a turn, or an answer to a question
    DELETE /v1/dev/:id          stop, and release the lease
    POST   /v1/dev/:id/suspend  snapshot and release
    POST   /v1/dev/:id/resume   lease, restore, continue
    GET    /v1/dev/:id/stream   deltas as they happen

CLI, MCP and Slack are projections of this surface, not three implementations of
it: one typed op becomes REST, the document, a tool and a command.

## Amendment: one session surface, three runtimes (2026-11-21)

`/v1/dev` is the cloud backend for Hanzo Dev on web, desktop and mobile. A client
of any of them does the same two things: lease a session, then open a ZAP session
to it. Nothing about the surface depends on where the loop runs.

    POST   /v1/dev/sessions        {runtime, thread?, source?} -> {id, label, zap, sandbox?}
    GET    /v1/dev/sessions        the caller's open sessions, in the same shape
    DELETE /v1/dev/sessions/:id    release it; the disk is kept
    POST   /v1/dev/sessions/:id/{suspend,resume,interrupt}
    GET    /v1/dev/health

The task-shaped surface above (`POST /v1/dev/:id` for a turn, `GET /v1/dev/:id/stream`)
is retired: a turn and its deltas are frames on the ZAP session, not routes, so there
is one transport and no second place a turn can enter. `zap` is
`https://zap.hanzo.ai/v1/dev/zap/<id>`; the first envelope's cap is the caller's IAM
bearer and it is verified before anything is leased or attached. A session is one
bidirectional stream of ZAP router envelopes (u32 LE length, then the envelope; method
0 Frame, payload one frame of the Dev environment protocol), full duplex: replies and
events are pushed as they happen.

`runtime` picks who answers those frames. The client cannot tell them apart.

| runtime | who answers | needs a cell | when |
|---------|-------------|--------------|------|
| `sandbox` | the real Dev server (`hanzo-dev serve`) in a visor cell, on its own ZAP socket, reached by the sandbox plane's `sandbox_stream` op | yes, at lease | a thread that needs the whole of Dev: shell, browser, checkout, the dock |
| `wasm` | this document's loop: the Rust core as wasm (`hanzo-inc/dev`, wazero or wasm2go) hosted in cloud, behind a frame adapter | no; one is leased the first time an action needs it | chat, planning and quick agent turns |
| `source` | a linked desktop (HIP-1350), reached through its Connect relay | no | the person's own machine |
| `auto` | `wasm`, until a turn emits an action that needs a shell, a browser or a checkout | | the default for a new web thread |

`sandbox` is an implementation of the session, not a fork of the surface: the lease is
the sandbox's, its quota, idle clock and reaper are the sandbox's, and `/v1/dev` holds
no clock of its own. The reply's `sandbox` is the id the dock leases terminal and
screen tickets against, and is absent for a session that holds no cell.

**The wasm runtime speaks the Dev environment protocol through an adapter at its host
boundary.** The core's own alphabet (eight events in, ten actions out) is not the
environment protocol, and the client is not asked to learn it. A frame adapter in the
Go host maps each environment frame to a core event and each core action, or its
observation, to frames; the core, the client and the Dev server are unchanged. The
adapter is the one place the two vocabularies meet.

### Chat-mode subset

Recorded from the real Dev server (0.1.10) in chat mode, a thread with no workspace: connect,
launch, send, reply, rename, settle. Schemas are in `packages/contracts` of `hanzoai/dev`
(`rpc.ts`, `orchestrationV2.ts`, `server.ts`). The frames are Effect RPC JSON; a client that
opens with `frameParts=1` is sent a frame over 48 KiB as parts, each but the last led by U+001E.

Answered by the adapter (`hanzoai/dev` `go/frame`):

| method | answer |
|--------|--------|
| `subscribeServerConfig` | stream: `snapshot`, `usageLimitSourcesUpdated`, `environmentThemesUpdated` (`ServerConfigStreamEvent`) |
| `subscribeServerLifecycle` | stream: `welcome` |
| `orchestration.subscribeShell` | stream: `snapshot`, `synchronized`, then `thread.updated` per change (`OrchestrationV2ShellStreamItem`) |
| `orchestration.subscribeThread` | stream: `snapshot`, `synchronized`, then `event` (`OrchestrationV2ThreadStreamItem`) |
| `orchestration.launchThread` | `OrchestrationV2ThreadLaunchResult` |
| `orchestration.dispatchCommand` | `thread.visit`, `thread.metadata.update` (rename), `thread.settle`, `message.dispatch`; result `{sequence}` |
| `orchestration.getArchivedShellSnapshot`, `server.refreshProviders`, `server.reportClientActivity`, `peerLinks.list` | as the server answers them |
| read side of an empty workspace: `vcs.listRefs`, `projects.readFile` (`allowMissing`), `preview.list`, `preview.reportProfiles`, `subscribeVcsStatus`, `subscribeVcsBranch`, `subscribeTerminalMetadata`, `subscribeWorktreeSetup`, `subscribeDiscoveredLocalServers`, `subscribeProjectClones`, `scheduledTasks.subscribe`, `subscribePreviewEvents` | what the server says of a thread with no workspace: not a repository, no files, terminals, previews or servers |

A turn writes `run.created`, `run-attempt.created`, `node.updated`, `message.updated`,
`turn-item.updated`, `provider-thread.updated`, then `run.updated`/`run-attempt.updated`/`node.updated`
(running), `provider-turn.updated`, a `node.updated`/`message.updated`/`turn-item.updated` per
assistant message (`streaming: true` while text arrives), and the run's closing events. The
adapter writes no `provider-session.*` or `checkpoint*` events: there is no provider session
and no workspace to checkpoint.

A method that acts on a workspace (terminals, file writes, checkout and worktrees, previews,
browser, devices) is not answered. The adapter returns a typed `NeedsSandbox` to the session
layer, which leases a cell and carries the request there, or refuses it with
`EnvironmentAuthorizationError {requiredScope, requiredPermission: "sandbox"}`, a failure every
method's error union already holds.

**Upgrade in place.** A wasm session whose loop emits an Exec, Git or Browse action
leases a cell then, from the sandbox, and the action runs there: the loop's THINK/DO
split already says the cell is leased per effect, so nothing is migrated. A session that
needs the full Dev server instead is restarted as `sandbox` under the same id: the
thread is replayed into the server by the environment protocol, the client reconnects
to the same `zap` URL, and the session announces the change with a pushed event that
carries the `sandbox` id.

**One session record.** A session is the three facts above, persisted apart: the
core's snapshot, a workspace id, and the action ledger (dispatch and completion under
one id, so a replay answers the recorded result and never re-runs the command). A
`sandbox` session's record is its lease. Durability is hanzoai/tasks.

**Where the ledger and tasks split.** The ledger (per-org SQLite beside the session) keeps
every fact about what happened: which action ids were dispatched and what each answered,
the core's snapshot, the work the core has asked for and not yet had done, and what the
person was shown. It is what makes an effect happen once, and what a resume reads. Tasks
keeps the one thing the ledger cannot, that somebody must come back: a turn is submitted
into the ledger first, and a workflow whose one activity drives the session's pending
work is started over it. If the process dies, the gateway is down or a lease is refused,
the engine runs the activity again with backoff, here or in a successor, and the ledger
answers every id already done from its row. The workflow decides nothing and the ledger
runs nothing. A session can be suspended (its cell given back, its disk and work kept; it
takes no turn until resumed) and interrupted (the commands it is running stop; the cell
and the session stay), and both are the same two routes for a `sandbox` session, where
they park and stop the cell.

The implementation is `hanzoai/cloud` `apps/dev`, mounted by the sandbox app, with
`zap.hanzo.ai` as the browser edge (UDP, DNS-only, because the proxy in front of the
API host cannot carry WebTransport).

## Amendment: one daemon per machine, one engine everywhere (2026-11-21)

Status: proposed. Nothing below is built.

Every Hanzo desktop install becomes a node: one Rust process per machine, `hanzod`,
that holds the identity, owns the one local ZAP socket, serves the local cloud, runs
the Dev backend and can join the chain. The Dev orchestration engine moves out of
the TypeScript server into the same Rust core that cloud runs as wasm, one module at
a time. The TypeScript server keeps running behind `hanzod` as a worker until the
last module has moved, and is then deleted.

### What is on a machine today

"hanzod" names three programs, and none of them is the daemon this amendment needs.

| program | repo | what it is | where it listens |
|---|---|---|---|
| `hanzod` 0.2.0 | `hanzoai/node` | L1 validator, ~950 lines over `lux-rs/node` (a private dependency fetched with a credential) | `:9630` RPC, `:9631` mesh, `~/.hanzod` |
| `hanzo-node` (its crate also builds a binary named `hanzod`) | `hanzoai/node-v1` (its forge remote is still `hanzoai/node`) | the old agent node: ~334k lines in 40 crates, a sidecar of `Hanzo.app` (`ai.hanzo.desktop`) | `127.0.0.1:3690`, 27 MiB RSS |
| `hanzo-cloud` host | `hanzoai/cloud` (Go) | the local cloud: a router that starts each subsystem as a process on the first request to its prefix (cold ~15 ms, warm ~0.5 ms) | ZAP on `<data>/hanzo/host/host.zap.sock`, HTTP on loopback |

Identity (`~/.hanzo/identities.json`, `{active, identities}`) belongs to the CLI
(`hanzoai/cli` `src/iam/store.rs`), not to any of them. `hanzo up` also puts the
cloud API on `127.0.0.1:3690`, and `hanzo serve` takes whatever answers on `:3690`
to be the local cloud. On a machine that runs `Hanzo.app`, `:3690` is the old agent
node, so the CLI is pointed at a program that does not serve the Cloud API.

The Dev backend is a fifth process. `apps/server` is about 306k lines of non-test
TypeScript (`orchestration-v2` 111k, of which `Orchestrator.ts` is 16.7k), plus 31k
in `packages/contracts` and about 75k in the `provider-*` packages. In the shipped
`Hanzo Dev.app` it uses 512 MiB RSS, and it runs on whatever Node it finds on the
machine (`backend.rs` `resolve_node_executable` tries `/opt/homebrew/bin/node` and
then version-manager shims). The app does not bundle Node, so a machine without
Node cannot run Dev desktop.

Five local servers on four ports, in three languages, and two of them claim one
port. That is the problem this amendment solves.

### Decision

**Strangler (option B).** `hanzod` becomes the one local daemon first, and the
engine then moves into it piece by piece.

- **Not a full rewrite (A).** Rewriting about 410k lines while 500k users ship on
  them stops feature work for months and puts everything at risk at once. The
  provider adapters are the code that changes most often (upstream CLIs change
  every week), and a rewrite would freeze them at their worst moment.
- **Not keeping TypeScript (C).** It leaves 512 MiB resident per install, a Node
  dependency the app does not own, and five daemons. It cannot make an install a
  node, because the engine could never be linked into the process that is the
  node.
- **The daemon is Rust, not the Go host.** Everything that has to be in-process
  with it is already Rust: the Dev core, the CLI's ZAP codec and identity store,
  and both Tauri hosts. The validator is Rust as well, but it runs as a child
  process (see below). The Go cloud host is server-shaped, it is the same program
  the cluster runs, and it already starts lazily as a child process, so `hanzod`
  starts it the way the CLI does today. Porting the cloud to Rust is explicitly out
  of scope.

### The daemon

    hanzod (Rust, hanzoai/node, user-level, one per machine)
      socket     <data>/hanzo/hanzod.zap.sock (0600) + loopback HTTP view on :3690
      identity   the CLI's store as a shared crate; tokens stay IAM's (HIP-0026)
      subsystems  started on first frame to their prefix, stopped when idle
        /v1/dev     the Dev engine: in-process (Rust) + the TS worker for what has not moved
        /v1/*       hanzo-cloud host, spawned lazily (moved from cli host.rs)
        /v1/chain   `hanzo-chain`, a child fetched on opt-in; OFF until then
        sources     linked-source registration for runtime `source` (HIP-1350)

- **One socket, one way in.** The CLI, Dev desktop, `Hanzo.app` and mobile (through
  Connect) all reach the machine through `hanzod`. Tauri stops supervising Node, and
  `hanzo host` becomes a client of `hanzod`. Windows gets the loopback HTTP view, as
  the CLI already does there.
- **Children hold no credential.** A worker gets one end of a socketpair as a
  descriptor, the same THINK/DO rule as the cell. The first envelope on every
  external session carries the caller's IAM bearer, as `apps/server/src/zap/ZapAuth.ts`
  already requires, and `hanzod` verifies it before routing.
- **Idle means idle.** No subsystem runs until a frame needs it. Idle subsystems
  are stopped and their state is persisted (Dev is event-sourced, so nothing is
  lost). This is the `hanzo host` laziness applied one level up.
- **`hanzo-node` v1 is replaced.** It leaves `Hanzo.app` and gives up `:3690` and the
  name `hanzod`. Each piece of its tool and agent surface is either served by the
  Dev engine and cloud, or gets a HIP of its own. None of it is carried forward
  silently.

### Chain participation is opt-in

A desktop install is a node by default in identity, ZAP and the local cloud. It is
**not a validator** by default. A seat needs stake, two keys kept at `0600`
(ML-DSA-65 identity, BLS votes), uptime that laptops do not have, an open mesh port
(which triggers firewall prompts) and disk that grows with the chain. A user turns it
on in Settings or with `hanzo chain up`. Until then `/v1/chain` is a route entry and
nothing else: no port, no peers, no state.

The validator is a separate binary, `hanzo-chain` (today's `hanzoai/node` code,
moved into `chain/` in the same repo). It is **fetched on opt-in** with a pinned
digest and runs as a child of `hanzod`, the same way the cloud host does. There are
three reasons. A default install has to build from open source ("open at the core"),
and `lux-rs/node` is private. A consensus crash must not take Dev down with it. And
users who never opt in should not carry its disk cost. Whether `lux-rs/node` is
public or private, the validator stays a child process, so there is only one way
it runs.

### Security and update model

- `hanzod` runs as the user: a launchd user agent, `systemd --user` unit or per-user
  Windows task, never root. It binds only the user's socket and loopback. The only
  non-loopback listener is the chain mesh, and only after opt-in.
- **One binary on the machine**, at `~/.hanzo/bin/hanzod`. Each app bundles a pinned
  `hanzod` and installs it only if it is newer than the one there; an app never
  downgrades it. Releases are semver, signed and notarized, and the sha256 digests
  are compiled into each bundle (the CLI's `link/zt.rs` pattern). Floating tags are
  never fetched. The previous binary is kept for rollback.
- **The ZAP surface is `/v1` and additive-only,** so an older app keeps working
  against a newer `hanzod`.
- The chain subsystem starts only when its `lux-node` tag is the tag the network
  currently runs (two nodes on different tags are two networks), so it upgrades on
  the network's schedule, not the app's.
- Every privileged action, whether a chain key operation, an exec, or adding a
  linked source, goes to the action ledger under its id (above).

### One engine: the convergence point

`hanzo-inc/dev` is the right shape and the wrong size and place. It has no I/O,
exposes a C ABI, is a wasm export list, and its import list proves the core touches
nothing. But it is about 2.5k lines and only one layer: an agent loop that speaks
eight events in and ten actions out. Dev's orchestrator is the layer above that.
It handles threads, turns, many providers, projections and checkpoints, and its
decide step is already I/O-free (`Orchestrator.ts` decides events without doing any
I/O). They converge as one Rust workspace. Three of its crates are pure and are
built both natively and for `wasm32-wasip1`:

    protocol      the Dev environment protocol as ZAP frames: the one alphabet
                  (the Go frame adapter in cloud is deleted when this lands)
    core          today's hanzo-inc/dev core: Session.step / snapshot / restore
    orchestrator  pure decide: (state, command) -> (events, outbox effects)

`ffi` exports the pure crates through one C ABI, which builds to `libdev.a` and to
`dev.wasm`. Three crates do I/O and are native only, linked by `hanzod`: `store`
(the event sink and projections, over SQLite), `checkpoint` (hidden git refs) and
`provider` (adapters). Every package is named `dev-<dir>`, as the existing ones
are.

`hanzod` links them natively. Cloud `/v1/dev` hosts the same build as wasm under
wazero, so the `wasm` runtime and the desktop are **literally one engine**, and the
upgrade from `wasm` to `sandbox` stops being a change of program. Mobile can link
the same static library (iOS, Android NDK) for offline use. That is possible, not
planned: mobile stays a remote control until a use case needs it, and the
import-list property is what keeps the option free.

The crates move to an **open source home, `hanzoai/dev` `crates/`**, because
`hanzoai/dev` and `hanzoai/node` are open and cannot link a private repo.
The move keeps history (`git subtree` from `hanzo-inc/dev` `crates/` into
`hanzoai/dev` `crates/`) and keeps the 0.x version line. The Go host moves to
`hanzoai/dev` `go/` in the same way. `hanzo-inc/dev` is deleted when cloud imports
the host from the open repo.

### What stays TypeScript, and for how long

Effects stay at the adapter boundary, as they do now. The **external provider
adapters** (Codex, Claude, Cursor, Grok, OpenCode, Antigravity, Kiro, Pi, Muse, fx)
are protocol translators for subprocesses that change every week, and moving them
costs the most velocity. They stay in TypeScript in a worker that `hanzod` starts on
the first turn that needs one and stops when it goes idle. The order they move in:
the native Hanzo and Hanzo Gen drivers first (both are already Rust binaries), then
one Rust ACP adapter (which covers every provider that speaks ACP), then the rest by
usage. When the last adapter has moved, Node is no longer shipped, `apps/server` is
deleted, and Effect leaves the backend. Web and mobile clients stay TypeScript, and
their contract types are generated from `protocol`.

### Phases and their exit tests

The phases run in parallel as four workstreams (below). Each phase ships on its
own and is reverted on its own. A phase is done when its test passes in CI and on a
release build, not when its code merges.

| # | phase | exit test |
|---|---|---|
| 0 | **Names and ports.** One `hanzod` (`hanzoai/node`). `node-v1` stops building a binary named `hanzod`. `Hanzo.app` stops claiming `:3690`. Dev desktop bundles its own Node until phase 5 removes it. | On a machine with `Hanzo.app`, `Hanzo Dev.app` and the CLI, `lsof -iTCP:3690` shows only `hanzod` or the cloud host. `hanzo authz health` reaches the cloud host. Dev desktop starts on a machine with no Node on `PATH`. |
| 1 | **`hanzod` is the daemon.** One socket, identity crate shared with the CLI, a lazy subsystem table. The cloud host and the TS server become children over socketpairs. Tauri and `hanzo host` become clients. | A Playwright turn in Dev desktop goes app → `hanzod` → worker → provider and back. `kill -9` of the worker in the middle of a turn: the next frame restarts it, and every committed event and outbox effect completes exactly once (ledger ids). `hanzod` idle with nothing started uses ≤ 25 MiB RSS and 0% CPU over 10 min. A trace of the CLI and the desktop shows only `AF_UNIX` connects. |
| 2 | **One engine crate set** in `hanzoai/dev` `crates/` (`protocol`, `loop` moved from `hanzo-inc/dev`), and cloud imports it. | Cloud `/v1/dev` `wasm` sessions pass on the open-source build. The wasm import list is still exactly `environ_get`, `environ_sizes_get`, `fd_write`, `proc_exit`. The Go frame adapter is deleted. |
| 3 | **Pure decide in Rust.** The `orchestrator` crate. The TS server loads the same `dev.wasm` with Node's built-in WebAssembly (no native addon, no per-platform build) in place of `Orchestrator.ts`. | Replaying every recorded command stream from the V2 test corpus and a snapshot of real `statev2.sqlite` data gives byte-identical events and outbox rows from the Rust and TS decide functions. `Orchestrator.ts` is deleted. |
| 4 | **Sink, projections and checkpoints in `hanzod`.** Same `statev2.sqlite` schema; checkpoints stay hidden git refs. | An existing user's `statev2.sqlite` opens unchanged, and every projection query returns what TS returned. A checkpoint diff and a restore are identical to the TS ones on the checkpoint test corpus. The TS persistence layer and checkpointing are deleted. |
| 5 | **Adapters move.** Native drivers in-process, one Rust ACP adapter, then the rest by usage. Each adapter is cut over only when its V2 testkit passes against Rust. | For each provider, its testkit passes against the Rust adapter, and then the TS adapter is deleted. At the end, a machine that runs only Hanzo and ACP providers runs no Node process. When the last one moves, `apps/server` is deleted. |
| 6 | **Chain opt-in.** Measure first. Then `hanzo-chain` is fetched on opt-in with a pinned digest and runs as a child of `hanzod`. | With chain off, there is no `:9630`/`:9631` listener and no `~/.hanzod` state. After opt-in on devnet the node takes a seat and votes, and turning it off releases the ports. Cost per network (RSS, CPU, disk growth per day) is measured and published before the Settings toggle ships. |

### Workstreams

Four workstreams run at once. Each one owns its paths outright. They meet only at
the interfaces named here, and an interface changes only with its owner's commit.

| stream | phases | owns | publishes |
|---|---|---|---|
| a, daemon | 0–1 | `hanzoai/node` root and `daemon/`; `hanzoai/dev` `apps/server/src/zap/`, the server entry point and `apps/desktop/src-tauri/src/backend.rs`; `hanzoai/cli` `src/commands/host.rs` and the identity crate split from `src/iam/store.rs`; in `hanzoai/desktop`, the `hanzo-node` sidecar and `:3690`; the binary name in `node-v1` | the `Subsystem` trait, the socket path, the `/v1` prefix table, the digest table, the worker's socketpair descriptor |
| b, engine | 2–4 | `hanzoai/dev` root `Cargo.toml` and the `crates/{protocol,core,ffi,orchestrator,store,checkpoint}` crates; `apps/server/src/orchestration-v2/{Orchestrator,EventSink,ProjectionStore,EffectWorker}.ts`, `persistence/` and `checkpointing/`; `hanzo-inc/dev`; cloud's import of the host | the event and command types in `dev-protocol`, `dev.wasm`, the replay corpus |
| c, adapters | 5 | `hanzoai/dev` `crates/provider`, `packages/provider-*`, `apps/server/src/provider/` and `orchestration-v2/Adapters/` | the language-neutral fixtures in `crates/provider/fixtures/` |
| d, chain | 6 | `hanzoai/node` `chain/` (`hanzo-chain`), the chain implementation behind `/v1/chain`, and `hanzoai/cli` `src/commands/chain.rs` | the measurements, and the `hanzo-chain` release and its digests |

The first commit to `hanzoai/node` belongs to stream a. It makes the repo a
workspace, moves today's `src/` and `genesis/` unchanged into `chain/` (binary
`hanzo-chain`), and adds `daemon/` (binary `hanzod`). Until that commit lands, no
other stream writes to `hanzoai/node`. The first commit to the `hanzoai/dev` root
`Cargo.toml` belongs to stream b, and stream c adds `crates/provider` only after it.

`statev2.sqlite` has **one writer**, the TS worker, until stream b's phase 4 exit
test passes and the store cuts over in a single commit. Before that, the Rust store
runs only against copies. `packages/contracts` stays the source of truth for client
RPC until the same cutover, and then becomes generated from `dev-protocol`.

### Costs, stated

- **Velocity.** Phases 3 to 5 port about 17k lines of decide logic, the persistence
  layer, and the adapters, each one gated on byte-identical replay. Feature work
  continues on TS through all of them, and every phase deletes its TS counterpart,
  so there is never a second implementation in production.
- **Effect.** The service and layer structure carries over as Rust modules. Effect
  itself (spans, `TestClock`, schema) does not. The tests carry over as replay
  corpora and testkits, which is why the exit tests are written against recorded
  data and not against code.
- **Memory.** Measured today: 512 MiB for the TS server, 88 MiB for the Dev desktop
  shell, and 120–190 MiB per native `dev serve` agent. The provider CLIs that run
  during a turn are the user's own cost and are not changed by this. What changes is
  the cost when nothing is running, which goes from more than 600 MiB across the
  daemons to the phase 1 target. Chain cost with no traffic is measured below. Cost under
  traffic is not, and the Settings toggle waits for it.

### Chain cost, measured (phase 6)

`hanzo-chain` is `hanzoai/node` `src/` at `e6f75ba8c` (source identical to
v0.2.5, whose `darwin-arm64` tarball matched its published sha256
`08e65e33…ccd01`). Five validators, one committee, devnet (network id 3, chain
id 36964), all on one Apple M1 Max, macOS 27.0.1, at `nice -n19`, measured
over 7 minutes of uptime. Per node, no transactions:

| metric | measured |
|---|---|
| RSS | 1.7 MiB (`ps`); 3.7 MiB physical footprint (`vmmap`) |
| CPU | 1.0–1.1% of one core, steady; 4.6 s CPU in 7 min |
| context switches | about 890/s (38,342 in 43 s); 21 threads |
| BSD syscalls | about 940/s |
| disk | 8 KiB (two 32-byte keys, four empty journals); growth 0 B |
| bandwidth | 26 KiB in, 26 KiB out at connect, then 0 B for the rest of the run |
| listeners | RPC and mesh only; 4 established peers |

Findings:

- **An idle devnet builds no blocks.** `eth_blockNumber` stayed `0x0`, and the
  `votes` journal stayed at 0 bytes. The mempool does not gossip (see the
  chain-traffic note: it writes each transaction to every node), so blocks, votes,
  disk growth and bandwidth all exist only under traffic. The mainnet sender
  beats about every 3.9 s.
- **The idle cost is wakeups, not memory.** About 890 context switches a second
  per node with nothing to do is a polling loop, and on a laptop on battery that
  is the cost that matters. It is a defect in `lux-node` 0.2.2 to report
  upstream, not something the opt-in plumbing can hide.
- `--genesis` refuses any block zero that is not the network's own, so a local
  devnet cannot fund a throwaway sender. Driving traffic needs the devnet
  traffic sender's key (`hanzod-faucet`, in KMS).

Not measured, and required before the Settings toggle ships:

- disk growth and bandwidth per day under the mainnet-rate traffic model;
- whether a validator misses votes across sleep and resume (there are no votes
  without traffic, so an idle run cannot show it);
- Linux amd64. `halo`'s SSH host key no longer matches the pinned one, so it
  was not used; a cloud sandbox or a re-verified host is needed.

## Rationale

**Why not put the whole agent in the cell.** Every model token, state transition
and cloud call would cross an isolation boundary that exists to contain `rm -rf`.
The boundary's job is the untrusted half.

**Why not wasm for the effect half.** A coding agent's tools are ordinary Linux
executables. wasm needs each one ported; visor runs the ELF that already exists,
with process, signal, pipe and filesystem semantics. wasm keeps the lanes it
already wins — deterministic typecheck and bundle, per-session isolation at
millisecond latency (`/v1/typecheck`, `/v1/bundle`).

**Why the cell gets a connected socket and not a socket namespace.** A pair is
created, one end is handed in as a descriptor, and there is no listen, no connect,
no path in a filesystem and no host namespace exposed. Sequenced packets map onto
ZAP frames as they are.

**Why the workspace is a mount and not credentials.** The cell issues ordinary
`openat`, `rename`, `readdir`; the host answers, caches locally, and persists to
s3. Reads of a hot tree hit local cache, so `git status` does not become thirty
thousand object gets, and no storage credential is ever inside the boundary.

## Security Considerations

The cell holds no credential: not the storage key, not the model key, not the
caller's token. Actions are policy-checked in `/v1/dev` before dispatch, so
"which effects may happen" is answered outside the thing being contained. IAM is
the only identity (HIP-0026); a machine identity gets the authority of a machine.
The ledger is the audit record of every effect attempted, with its id, its
dispatch and its answer.

## References

- HIP-0026 — IAM
- HIP-0106 — one binary, host and plugins
- HIP-0114 — ZAP transport
- HIP-0139 — one capability, one prefix, one plugin
- HIP-1146 — Sandbox: a lease on isolated compute
- HIP-1212 — Exec: the code interpreter

## Copyright

Copyright and related rights waived via CC0.
