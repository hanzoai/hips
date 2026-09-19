---
hip: 1330
title: Dev — The Agent Loop
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: dev
status: Draft
implementation-go: partial
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
