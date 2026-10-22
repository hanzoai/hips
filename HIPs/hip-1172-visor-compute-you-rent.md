---
hip: 1172
title: Compute — Machines You Rent or Link
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: compute
status: Final
implementation-go: partial
created: 2026-08-20
updated: 2026-10-22
requires: HIP-0026, HIP-0106, HIP-0139, HIP-1173, HIP-1211
---

# HIP-1172: Compute — Machines You Rent or Link

## Abstract

`compute` is what an org computes on: machines, GPUs and clusters it rents from
Hanzo — launch one, resize it, tear it down — and machines it owns and links. It
is the tenant's own view of that compute on the public API, covering both what
Hanzo provisions and what the customer attached, and it fabricates nothing: a
GPU row is a real machine's accelerator, a cluster is real node pools, and a
field the source does not carry is omitted rather than invented. It is the
`compute` app of the cloud binary (HIP-0106).

A linked machine runs nothing until the cloud asks, and then only a typed,
allow-listed workload its owner's local policy admits. That is proposed by the
Amendment below and is not served yet; the node side is `hanzo link` in
`hanzoai/cli`.

## Amendment: linked nodes run nothing until the cloud asks (proposed)

Proposed. Nothing in this section is served today; §1–§9 describe what is. The
presence and claim routes, the node credential, the policy file, the three
workload kinds, the per-workload overlay service, the org route (HIP-1211,
Amendment) and the events below are still to be built. A1 replaces every flag
`hanzo link` takes today.

compute owns the lifecycle of a workload on a linked machine and not what the
workload does: the model API is ai's (HIP-1211), the render is Studio's
(HIP-0506), the script is its requester's. As §1 requires, compute keeps no
store of its own: presence and activities are records in the durable engine
(HIP-1062), where linked presence lives today.

### A1 What linking does

`hanzo link` MUST take no flags and no arguments. It:

1. signs in with Hanzo IAM when the machine holds no valid session (HIP-0026),
   then exchanges that session at IAM for a node credential (A2); the agent
   holds the node credential and nothing else;
2. writes the policy file (A3) when it is absent, admitting no kind;
3. enrols the machine's identity on the org's overlay (HIP-1173) — a credential
   on disk, not a process;
4. registers the presence record (A2) and leaves one agent process holding the
   claim loop (A4), under the user's own service manager so it survives logout
   and restarts at boot.

It MUST NOT start an inference engine, a render backend, a shell or terminal
server, an overlay tunnel or daemon, a script runner, or anything that listens
on an address other than loopback. It MUST NOT register a run target or hold a
HIP-1325 node socket: those are other things a person may run on the same
machine, by their own commands.

`hanzo unlink` MUST stop every workload and wait for each to exit (A8), then
`DELETE /v1/compute/fleet/workers/{id}`, which revokes the node credential at
IAM and the overlay identity at the controller, and remove the agent's service.
It keeps the policy file, the audit log and the model store, which are the
owner's files. An org admin's `DELETE` of the node has the same effect at the
node's next claim (410).

### A2 The presence record and the node credential

The node credential is minted by IAM for one node: it can call only the routes
under `/v1/compute/fleet/workers/{id}` for that node, carries the linking user
as `linkedBy`, and is revoked by the node's `DELETE`. A user's own session,
however privileged, never reaches the agent. Every node route answers 403 to any
other credential.

`PUT /v1/compute/fleet/workers/{id}` registers or refreshes a node. `{id}` is the
hostname folded to `[a-z0-9-]{1,63}`; when another install holds it, the agent
appends `-` and the first four hex digits of its `key` and registers again.

```json
{
  "key": "9b1c0e6f2a4d4e0b8c7f3a5d1e2b6c90",
  "hostname": "evo",
  "os": "linux",
  "arch": "x86_64",
  "cpus": 32,
  "cpuModel": "AMD RYZEN AI MAX+ PRO 395",
  "memory": 137438953472,
  "disk": 1099511627776,
  "gpus": [{"name": "AMD Radeon 8060S", "memoryTotal": "98304 MiB", "arch": "gfx1151", "unified": true}],
  "rocm": "6.4.1",
  "version": "1.12.0",
  "lanes": [],
  "offers": ["engine.serve"],
  "policy": {"kinds": ["engine.serve"], "orgs": ["acme"], "...": "A3, verbatim"},
  "policySha256": "<64 hex: SHA-256 of the policy file's bytes>"
}
```

- `key` is 128 random bits the agent generates once. The cloud binds
  `(org, id)` to the first key it sees and answers 409 to a registration or
  claim carrying another. It names an install and authorizes nothing.
- `offers` is the subset of the policy's `kinds` this host can run now: a kind
  only where A9's sandbox exists, `studio.render` only with a lane. `disk` is the
  free bytes on the store's filesystem. `cuda`, `driver`, `rocm` and `hip` are
  reported where the host has them.
- The cloud MUST take the policy only from this call and MUST NOT send a policy
  to a node. Its copy is a mirror.

`GET /v1/compute/fleet/workers` answers these fields, without `key`, plus
`status` (`online` when a claim landed within 90 s, else `offline`), `linkedBy`,
`firstSeen`, `lastClaim` and `workloads: [{activity, kind, state, model}]`.
`capabilities` becomes `offers`. The engine is a workload now, not a property of
the node, so `engine` and `jobQueue` leave the record.

### A3 The policy file

Consent lives on the node, in `~/.hanzo/link/policy.json` under the linking
user's home, mode 0600. The schema is closed: a field the agent does not know
makes it offer nothing and log why. As written by `hanzo link`:

```json
{
  "kinds": [],
  "orgs": ["acme"],
  "sources": [{"prefix": "huggingface.co/zenlm/", "hosts": ["huggingface.co", "*.hf.co"]}],
  "models": [],
  "caps": {"vram": 0, "memory": 0, "cpus": 0, "disk": 0},
  "concurrency": 1,
  "idleSec": 600,
  "maxSec": 86400
}
```

| Field | Meaning | Default |
|:--|:--|:--|
| `kinds` | Kinds the node runs: `engine.serve`, `studio.render`, `fn.run` | none |
| `orgs` | Orgs whose activities it takes | the linking org |
| `sources` | Model sources: a host and path prefix, and the hosts a download may be redirected to | the Zen weights of HIP-0904 |
| `models` | A repository path, `huggingface.co/owner/name`, or one pinned as `…@<40-hex commit>`; empty admits every model under a source | empty |
| `caps` | Bytes of accelerator memory, memory and store; logical cores. 0 means the host's total, less a tenth of the filesystem for the store | 0 |
| `concurrency` | Workloads at once, every kind together | 1 |
| `idleSec` | Ceiling on any workload's idle seconds | 600 |
| `maxSec` | Ceiling on any workload's life, idle or not | 86400 |

- The agent reads the file and nothing writes it but `hanzo link` creating it.
  No cloud message, API call or activity changes it, and no workload can read
  or write it (A9).
- On change the agent re-registers within 5 s and stops, with reason `policy`,
  every workload the new file no longer admits.
- Enforcement is at claim, twice: the cloud hands a node only what its mirror
  admits, and the agent checks every envelope against the file and fails what
  the file does not admit with `denied`. The file wins.
- An unreadable file offers nothing. The agent never falls back to a default.
- This amendment gives no other org a way to address a node, so an `orgs` entry
  beyond the linking org admits nothing yet; the field is the node's own refusal
  of an activity stamped with any other org.

### A4 The claim stream

The only channel from the cloud to a node is an outbound HTTPS long-poll:

```
POST /v1/compute/fleet/workers/{id}/claim
{"key": "9b1c…", "wait": 25, "running": [{"activity": "act_01JB7Q8Z…", "state": "idle"}]}
```

- 200 `{"start": [<envelope>…], "stop": [{"activity": "act_…", "reason": "cancel"}]}`
- 204 when `wait` elapsed with nothing to do; 409 on a key mismatch; 410 when
  the node was removed, after which the agent does what `hanzo unlink` does.

`wait` is 1–30 s. Any replica answers a claim; the replica holding one learns of
a new activity or a cancel from the bus (HIP-1060) and MUST answer within 2 s of
it. A claim is the heartbeat. `start` holds at most `concurrency` minus the
running count, and only what the mirror admits. An envelope stays `requested`
and is offered again until the node reports a state for it, and the agent
ignores an envelope for an activity it already runs, so a lost answer neither
loses nor doubles a start. `running` is the node's account of itself: the cloud
answers `stop` for a running activity it does not hold as live, and fails with
`lost` one past `requested` that the node does not list.

The envelope:

```json
{
  "activity": "act_01JB7Q8ZK3M2N4P5R6S7T8V9W0",
  "kind": "engine.serve",
  "org": "acme",
  "project": "default",
  "requester": "acme/alice",
  "issued": "2026-10-22T17:04:05Z",
  "deadline": "2026-10-22T17:24:05Z",
  "input": {}
}
```

`activity` is minted by the cloud and never reused. `deadline` is when the
workload must be `ready`; past it the agent stops it (`deadline`). `input` is
checked against its kind's closed schema (A5) by the cloud at enqueue and by
the agent at claim; an unknown field, a wrong type or a value out of range fails
it (`schema`), and an unknown kind fails it (`unsupported`).

The node reports each transition on its own address:

```
POST /v1/compute/fleet/workers/{id}/activities/{activity}/state
{"key": "9b1c…", "state": "pulling", "progress": {"done": 1073741824, "total": 7206168928}}
```

The cloud accepts a report only from the credential of node `{id}`, for an
activity assigned to `{id}`. A terminal report carries `output` or
`error: {code, message}`. The answer is 204, 409 for an illegal transition, or
410 when the activity was cancelled.

Callers enqueue, read and cancel:

- `POST /v1/compute/fleet/activities` with `{node, kind, input}` answers 201 in
  `requested`, or 403 `denied` naming the rule the mirror refused (`kind`,
  `org`, `model`, `caps`, `concurrency`), 404 for an unknown node, and 409 for
  a node that is offline or already serving that model.
- `GET /v1/compute/fleet/activities`, filterable by `node` and `state`;
  `GET /v1/compute/fleet/activities/{activity}`; and `DELETE` on it, which
  reaches the node as `stop` at its next claim. Each answers only when the
  activity's org is the caller's, and 404 otherwise.
- `engine.serve` publishes a model to the whole org (A7), so it needs an admin
  of the org (HIP-0118). `fn.run` needs an admin or the node's `linkedBy`. Any
  member MAY enqueue `studio.render`. Enqueues are rate-limited per requester.
- This collection replaces `/v1/compute/fleet/jobs` and its cancel: one queue,
  every kind.

### A5 The three kinds

Every activity moves through one lifecycle. Forward only, except that `ready`
and `idle` alternate; any live state may end in `stopped` or `failed`; a state
with nothing to do is skipped.

| State | engine.serve | studio.render | fn.run |
|:--|:--|:--|:--|
| `requested` | enqueued, unclaimed | same | same |
| `pulling` | weights fetched and verified (A6) | — | wheels fetched and verified |
| `starting` | engine loading | render backend booting, when cold | — |
| `ready` | a request in flight | rendering | running |
| `idle` | nothing in flight | — | — |
| `stopped` | `reason`: `idle`, `cancel`, `unlink`, `policy`, `deadline`, `max`, `done` | same | same |
| `failed` | `error.code` | same | same |

Error codes are a closed set: `denied`, `schema`, `unsupported`, `capacity`,
`source`, `custom_code`, `integrity`, `pull`, `start`, `crash`, `deadline`,
`lost`.

**`engine.serve`** loads a model and serves it with the Hanzo engine (HIP-0043),
callable through `api.hanzo.ai` (A7).

```json
{
  "model": "huggingface.co/zenlm/zen6-flash",
  "revision": "<40 hex: a commit>",
  "files": [{"path": "Ternary-Bonsai-2-27B-PQ2_0.gguf", "sha256": "<64 hex>", "size": 7206168928}],
  "ctx": 65536,
  "vram": 17179869184,
  "idleSec": 600,
  "service": "evo-1"
}
```

`files` is every file the engine loads. `vram` is the requester's declared
need: the agent fails it with `capacity` when it exceeds `caps.vram` less what
running workloads hold, or the accelerator's free memory; it passes it to the
engine as its memory ceiling, and stops a workload that holds more (`capacity`).
`idleSec` is 30 to the policy's `idleSec`. `service` is the overlay label the
cloud created for this workload (A7). The `ready` report carries `token` (A7)
and `models`, the ids the engine's `/v1/models` lists; the token never appears
in a read.

**`studio.render`** runs one render on the Studio render backend (HIP-0506).

```json
{
  "lane": "image.zen",
  "graph": {"nodes": []},
  "inputs": [{"name": "init.png", "url": "https://api.hanzo.ai/v1/compute/fleet/activities/act_…/files/…", "sha256": "<64 hex>", "size": 2097152}],
  "upload": "https://api.hanzo.ai/v1/compute/fleet/activities/act_…/files",
  "timeoutSec": 14400,
  "idleSec": 600
}
```

- `lane` MUST be one the node lists, and every node type in `graph` MUST be in
  that lane's published set; anything else fails `unsupported`. The agent never
  installs a package, extension or weight a graph names.
- File paths in a graph are the agent's, not the requester's: inputs land in the
  workload's directory under names the agent chooses, and outputs are the
  regular files the backend leaves in its output directory, opened without
  following links.
- `inputs` and `upload` are single-use grants for this activity on the API
  origin the agent signed in to. The agent sends no credential of its own to
  them; another host, a redirect or a private address fails `source`, and each
  input is checked against its `sha256`.
- `timeoutSec` is at most the policy's `maxSec`. The output is
  `{"files": [{"name", "sha256", "size"}]}` once uploaded.
- The backend starts on the first job, reachable only by the agent (A7's rules
  for the engine apply), and stops after `idleSec` with no job. A warm backend
  takes jobs of one org only, and its working directories are emptied between
  jobs.

**`fn.run`** runs a Python script. It is off unless the owner writes `fn.run`
into `kinds`.

```json
{
  "source": "print(1)",
  "sha256": "<64 hex>",
  "wheels": [{"name": "numpy", "version": "2.1.3", "sha256": "<64 hex>"}],
  "args": [],
  "timeoutSec": 300
}
```

`wheels` is every distribution the script imports beyond the standard library,
dependencies included: nothing is resolved. The agent fetches each wheel from
the public Python package index under A6's transport rules and checks its
SHA-256; source distributions are refused, so installing runs no code. The
wheels are installed offline, with no dependency resolution and no user or
site configuration, inside the same sandbox the script then runs in: it reads
system runtime paths and its own directory, writes its own directory, and
reaches no network, loopback included. `timeoutSec` is at most `maxSec`. The
output is `{"exit", "stdout", "stderr", "truncated"}`, each stream at most
1 MiB.

### A6 Pulling a model

- `revision` MUST be a 40-hex commit; a branch or tag fails `schema`. Each
  segment of `model` and of every `files[].path` MUST match `[A-Za-z0-9._-]+`
  and be neither `.` nor `..`, and a path MUST NOT begin with `/`; otherwise
  `schema`. URLs are built from the parsed parts, never by joining strings.
- `model` MUST start with a `sources` prefix, and a non-empty `models` MUST hold
  `model` or `model@revision`; otherwise `denied`.
- Before any weight byte moves, the agent reads the repository's full,
  recursive file listing at `revision` and fails `custom_code` when the
  repository carries any `.py` file, a `config.json` with `auto_map`, or the
  `custom_code` tag.
- A `files` entry MUST be data in an admitted format: safetensors or GGUF,
  checked by its header, or JSON, plain text or a tokenizer model. Anything
  else fails `custom_code`; a pickle in any spelling runs code when it loads.
- Only `files` are fetched, over https. A redirect is followed only to a host in
  the matching source's `hosts`, at most five times. A hop elsewhere, to plain
  http, or to an address that resolves into loopback, private, link-local,
  shared or multicast space fails `source`.
- Each file is written beneath the store, never through a link, to a
  temporary name, and renamed to `~/.hanzo/link/store/sha256/<hex>` only after
  its SHA-256 and size match; a mismatch fails `integrity` and removes it. A
  model is a read-only tree, `store/models/<model>/<revision>/`, of links to
  blobs. A blob already present is not fetched again. No workload can write the
  store (A9), so a verified blob stays verified.
- When the store would pass `caps.disk`, trees no live workload uses go
  least-recently-used first, and blobs no tree references go with them.
- The engine loads the tree and fetches nothing.

### A7 The engine and the data path

The agent MUST start the engine:

- listening on a Unix socket in the workload's directory, or, for an engine
  without one, on `127.0.0.1` at a port the engine itself picks and reports, so
  no other local process can take the address first;
- with mDNS and DNS-SD advertising off;
- refusing every request that lacks `Authorization: Bearer <token>`, where the
  token is 32 bytes from the OS's CSPRNG, made per start, handed to the engine on
  stdin or in a 0600 file and never in argv, reported to the cloud once in the
  `ready` report and gone when the process exits;
- refusing a request that names media by URL, so a request cannot make the node
  fetch from its network;
- stopping generation when its client connection closes.

The gateway cannot dial a machine behind NAT, so the data path is the org's
overlay (HIP-1173). At claim the cloud creates, through the overlay controller,
the service `<service>.<org>.zt`, bindable only by this node's identity and
dialable only by the cloud's gateway identity. Between `ready` and stop, and at
no other time, the agent hosts that service and relays each connection to the
engine. Hosting is an outbound connection to the overlay's routers, so nothing
on the node listens. The relay is the one place that sees every request, which
is what `idle` measures: a request is in flight until it completes, or until
60 s pass with no byte relayed in either direction. At stop the agent stops
hosting, and the cloud deletes the service.

On `ready`, compute registers the org route `local/<node>/<last segment of
model>` — for the example, `local/evo/zen6-flash` — with endpoint
`http://evo-1.acme.zt/v1` and the token, through HIP-1211's route operation, and
deletes it at stop or when the node goes offline. HTTP crosses the overlay
unchanged: a streamed answer is the engine's own server-sent events relayed as
they arrive, and a client that goes away closes the overlay connection, which
closes the engine's, which stops generation.

### A8 Idle and stopping

A workload is `stopped` with reason `idle` after `idleSec` with nothing in
flight, and with reason `max` after `maxSec` however busy. Stopping sends
SIGTERM to the workload's process tree, then SIGKILL after 10 s, and the agent
reports `stopped` only after the tree has exited, which is what frees the
accelerator. Every workload runs in the agent's process group or control group,
so an agent that exits for any reason takes its workloads with it. A node
offline for 90 s has its routes and services reaped and its live activities
failed with `lost`; on return it is told to stop them.

### A9 What a workload is given

Every workload runs in an OS sandbox that shows it the system's runtime paths,
its own directory `~/.hanzo/link/run/<activity>/` (mode 0700, deleted at stop)
and, read-only, the model tree it loads, and nothing else of the linking user's
home: not the policy file, the store's other trees, the node credential or the
overlay identity. A host that cannot build that sandbox for a kind MUST NOT
offer the kind. Where the OS has quotas (control groups on Linux), the agent
applies `caps.memory` and `caps.cpus` to the workload.

A workload's environment is exactly `PATH` (a fixed system path), `HOME` and
`TMPDIR` (its directory) and `LANG=C.UTF-8`, plus what its kind names. Nothing is
inherited. The agent MUST NOT pass a workload any IAM credential, its overlay
identity, its `key`, a KMS credential, an SSH agent socket, a cloud or
model-host credential, or any variable of its own environment. A per-start
token is the only secret a workload receives, and only its own.

### A10 Audit and events

The agent appends one JSON line per link, unlink, policy change, start, stop,
deny and failure to `~/.hanzo/link/audit.jsonl`:
`{time, event, activity, kind, org, requester, model, revision, reason}`. It
carries no token and no input; a `fn.run` line carries the source's SHA-256.

The cloud publishes `compute.workload.started` (on `ready`),
`compute.workload.stopped`, `compute.workload.denied` and
`compute.workload.failed` on the platform bus (HIP-1060), with
`{org, node, activity, kind, requester, model, state, reason, time}` and the
activity's org as tenant. A refusal at enqueue is a `denied` event too. §6's
"publishes nothing" does not hold for these four.

### A11 Money

A call to a linked model is metered once, by the route (HIP-1211, Amendment).
`studio.render` and `fn.run` are recorded on the requester's usage with their
duration at price zero. Nothing a linked node does is priced as hosted compute;
the per-device fee of HIP-0121, where a deployment charges one, is the only
charge for the node itself.

### A12 Acceptance

1. `hanzo link` with any argument but `--help` exits non-zero. On a host with
   no policy file it writes A3's default, and the node's record shows
   `offers: []`.
2. After `hanzo link`, the host's listening sockets show nothing new on an
   address other than loopback, no process but the agent has started, and the
   agent holds no credential but the node credential.
3. With `kinds: []`, an enqueue of each kind answers 403 `denied`; an envelope
   for it handed to the agent anyway fails `denied`, with an audit line and a
   `compute.workload.denied` event.
4. Removing a running workload's kind from the file stops it within 5 s with
   reason `policy`, and the mirror changes with it.
5. `engine.serve` of `huggingface.co/zenlm/zen6-flash` at a commit, with correct
   hashes, reaches `ready`. The engine is reachable only from the node, a
   request without the token answers 401, and nothing on the LAN sees an engine
   advert.
6. One wrong `sha256` fails `integrity`; nothing from that pull is loaded or
   left outside the store's temporary area.
7. A branch as `revision`, or a `..` segment in `model` or a path, fails
   `schema`; a repository with a `.py` file or `auto_map`, or a pickle in
   `files`, fails `custom_code` before any weight byte is fetched; a redirect
   off `hosts` or into private space fails `source`.
8. A streamed chat completion naming `local/evo/zen6-flash` through
   `api.hanzo.ai` arrives as server-sent events; closing the client ends
   generation on the node within 2 s.
9. After `idleSec` with no request the workload is `stopped` with reason `idle`,
   the engine process is gone, accelerator memory returns to its pre-start
   level, and the model, route and overlay service are gone.
10. A node cut off for 120 s reads `offline`, its route is gone, and its
    workload stops within one claim of its return.
11. `hanzo unlink` stops every workload, removes the node from
    `/v1/compute/fleet/workers`, revokes its credential and overlay identity,
    and removes the agent's service; the policy, audit log and store remain.
12. A workload sees only A9's paths and variables and its own token: no IAM
    credential, overlay identity, `key` or policy file.
13. A member who is not an admin gets 403 enqueuing `engine.serve`, and another
    org's caller gets 404 reading or cancelling an activity.
14. Every start, stop, deny and failure appears once in the audit log and once
    on the bus.

### A13 Threat model

- **A compromised cloud** can start allow-listed kinds for allow-listed orgs, of
  allow-listed models at pinned commits, within the caps, the concurrency and
  `maxSec`, and call what it started. It cannot change the policy, pick a source
  or a redirect host, open a listener, point the relay anywhere but a workload
  the agent started, reach the owner's files, or run code: with `fn.run` off
  there is no code path, and with it on the code is sandboxed and offline. It
  holds the node credential, which reaches only this node's routes, and no other
  credential of the machine. The owner's answer is `kinds: []` or
  `hanzo unlink`, and both take effect without the cloud.
- **A malicious org member** is bounded by role (A4), by the node's policy, by
  per-requester rate limits and by attribution: every enqueue names its
  requester in the audit log and on the bus. Publishing a model to the org takes
  an admin, a published route lives under `local/` where no hosted id or router
  choice can land on it (HIP-1211), and a member cannot address another org's
  node or activity.
- **A poisoned model repository** is defeated by the pin. A commit and the
  SHA-256 of every file make a later push irrelevant, and admitting only data
  formats leaves nothing that runs on load. Naming a poisoned commit with
  matching hashes yields data from an allowed source; `models` can pin exact
  commits. What remains is a parser defect in the engine, and A9's sandbox is
  what such a defect finds itself in.
- **A LAN pivot** has no port to forward and no fetch to ride. Nothing listens
  off loopback. The relay's only target is a workload the agent started, never a
  host or port the cloud names. Downloads refuse private space and off-list
  redirects, render files are single-use grants on the API origin, the engine
  refuses media URLs, and `fn.run` has no network.
- **Leakage into a workload** is closed by A9: one token per start, scoped to one
  process, dead with it. Route tokens are sealed in the org's KMS (HIP-1134).
- **Cross-tenant dialing.** The cloud's overlay identity can dial every org's
  names, so the `.<org>.zt` suffix is the tenant boundary. `<org>` is the org's
  name as IAM holds it, compared byte for byte with nothing folded, and the
  controller binds a name under `.<org>.zt` only to an identity of that org. A
  route endpoint (HIP-1211) and an attached cluster's apiserver (§Security) that
  name an overlay host MUST carry the caller's own org as that suffix.

### A14 Why

A flag that starts a service when the machine is linked holds a GPU and a port
for a request that may never come. When the cloud starts work only on demand,
an idle machine stays idle.

The data path rides the overlay rather than the claim stream. The overlay is
already the org-scoped, outbound-only network every linked machine joins, and
HTTP crosses it unchanged, so streaming, cancellation and back-pressure are the
engine's own. Tunnelling requests through the claim stream would mean a framing
protocol, a replica that holds each node's stream, and a peer hop to reach it
(HIP-1325 needs exactly that). Control stays a long-poll with no replica
affinity.

Consent belongs on the node because the policy constrains the cloud, and a
policy the cloud could edit would constrain nothing.

## Motivation

Renting a machine is the one operation where the price must be knowable before
the money moves, so every launch here carries a quote at the same address as the
launch. And a fleet is the one inventory a tenant needs answered in a single
question rather than four, so the board unions every source the org has — the
machines Hanzo runs for it, the boxes it dialled in, its clusters, its agent run
targets at `/v1/agents/targets` — under "what compute do I have, and how hot is
it?". Both are properties an addressed face can have and a scatter of provider
calls cannot.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 It owns no store

Every row compute answers with is read from something that owns it, and compute
persists none of it.

Provisioned compute is the compute service's: machines, node pools, the managed
cluster lifecycle. Attached compute is the per-org registry of bring-your-own
clusters, whose kubeconfigs are sealed in the org's KMS (HIP-1134) under a
per-org, per-project ref — one registry with two readers, compute and model
serving (HIP-1140), and therefore neither one's store. Utilization is the shared
compute time series, one table in the datastore with `org` as its only tenant
key, bound and never interpolated.

A capability that keeps a private copy of any of the three has two answers to
one question. compute keeps none.

### §2 The boundary: the machine, not what runs on it

compute answers for hardware. Everything a customer puts on it belongs somewhere
else, and the split is clean at every neighbour:

- **platform** (HIP-1230) is the container plane: builds, releases,
  environments, domains, logs. "Give me a GPU box" is compute; "run this image"
  is platform. Neither provisions the other's noun.
- **sandboxes** (HIP-1146) is the compute primitive for somebody else's code —
  a pod whose lifetime is a request, on capacity that already exists. compute
  never executes a customer's code on a machine it rents; it hands back a
  machine and stops.
- **bot** owns `/v1/bot/runs`, which is a bot doing work on a desktop, live: a
  session. `/v1/compute/machines?kind=bot` is a machine of kind bot plus its
  agent binding — rented hardware bootstrapped with a runtime. Two nouns share a
  word and do not share an address.
- **agents** (HIP-1210) owns the agent. compute owns the binding that says a
  given machine hosts one, because the binding is a property of the machine.

Inside compute, `/v1/compute/clusters` is the fleet's answer to "what clusters do
I have", provisioned and attached together, while `/v1/compute/k8s` is the
provider lifecycle that creates and destroys them. Both are compute's, which is
exactly why they fold under one name rather than being called two capabilities.

### §3 The addresses

compute answers under `/v1/compute`, the one root HIP-0139 §3 gives a
capability, and every noun of the compute plane is one segment down. The roots
those nouns used to sit at — `/v1/machines`, `/v1/gpus`, `/v1/clusters`,
`/v1/k8s` and `/v1/fleet` — were lines of the misfiled ratchet (HIP-0139 §5.1),
and all closed by fold (HIP-0139 §7.1), never by split: there is one owner and
§1 leaves no second store to split along. No alias was left behind, and nothing
answers at `/v1/visor`, so an address that begins anywhere else is not
compute's.

- `/v1/compute/machines` — the org's machines, rented and linked (a linked one
  carries `provider: "byo"`), one machine, launch and delete; a machine's agent
  binding at `/v1/compute/machines/{id}/agent` (put, get, delete), and every
  binding in the fleet at `/v1/compute/machines/agents`.
- `/v1/compute/gpus` — the accelerators on those machines, and
  `/v1/compute/gpus/alerts`.
- `/v1/compute/clusters` — the cluster list, attach and detach, and node-pool
  create, scale and delete.
- `/v1/compute/k8s` — cluster list, one cluster with its pools and worker
  nodes, create, delete, and the fleet-wide worker nodes at
  `/v1/compute/k8s/nodes`.
- `/v1/compute/fleet` — the board, the linked machines at
  `/v1/compute/fleet/workers`, the utilization series at
  `/v1/compute/fleet/samples`, and the GPU job queue at
  `/v1/compute/fleet/jobs` with a cancel.
- `/v1/compute/regions` and `/v1/compute/sizes` — the launch catalog, typed as
  any JSON because the body is the compute service's, stated as it states it.

Every route with a shape to state is typed. Two are declared with prose beside
the route, and each names why it cannot be a value:

1. `POST /v1/compute/machines` — the response shape is chosen by the request:
   `dryRun` answers 200 with a price quote, a real launch answers 201 with the
   created resource. A launch with `kind: "bot"` creates the agent and binds it
   in the same call. A typed op declares one `Out`, so typing it would have to
   change one of the two bodies.
2. `POST /v1/compute/machines/{id}/{action}` — a verb dispatch, not a
   resource. The `message` action streams the bound agent's answer back
   untouched: the upstream body, its content type and its status. There is no
   `Out`, and declaring one would buffer the stream.

The launch spends real money, so its prose MUST state where the quote is; a
caller reading only the document has no other place to learn it.

The address compute serves is not the address it dials. The compute service
keeps its own spelling one segment apart — `/v1/machines`, `/v1/k8s/clusters`,
`/v1/k8s/nodes` and their siblings on the compute service — and those literals
are the wire, so they did not move with the fold. In the app, an upstream call's
path is upstream's and a registered route's path is ours; the two are read apart
by which one holds them, never by resemblance.

### §4 Tenancy

The tenant is `principal.Org`, minted from the validated IAM owner claim
(HIP-0026). It is forwarded to the compute service as `owner=<org>`, beside the
gateway's own identity headers, which the edge has already sanitized of any
client copy. It is never read from a body: a launch always lands in the caller's
own tenant, and the ownership field a request might carry is ignored, not
honoured. Absent a validated principal the answer is 403.

A machine is addressed upstream as owner plus name, so another tenant's id is
not reachable rather than refused — the surface is not an existence oracle.
Reads are open to any validated member of the org. The two mutations on
`/v1/compute/k8s/clusters`, create and delete, additionally require a platform
SuperAdmin or an admin of the caller's own org (`requireClusterAdmin`,
HIP-0118), because provisioning spends on the house account rather than the
customer's.

### §5 Money

The plugin declares `cloud.Metered`.

A launch is not metered here. It fronts the compute service's resell endpoint,
which owns the balance gate and the per-hour meter; compute forwards the tenant
and returns what came back, and a `dryRun` quote is that service's price
verbatim. Putting a second meter on this plane would be a second number for one
machine.

compute meters exactly one unit of its own: attaching a bring-your-own cluster,
kind `byo-cluster`, priced from the shared compute fee (`CLOUD_COMPUTE_FEE_CENTS`,
whose source is the price list, HIP-1222). The customer brings the compute and
the management plane is what is charged. The debit lands through the org's
resource meter under the provider label `compute` — the commerce attribution and
spend-cap scope key — and is gated before the register and metered after it, on
the same key, so the amount authorized and the amount charged cannot drift. A
deployment that prices the attach at zero is ungated exactly as it is unbilled.
Every other route is free.

### §6 Events and observability

compute publishes nothing on the bus: no `compute.*` event reaches a customer's
webhooks. Beyond the request span every route already gets, it writes no audit
record and exports no metric of its own.

What it does emit is the tenant's own data, on request.
`POST /v1/compute/fleet/samples` is how an attached worker self-reports
utilization; the sample is validated against the closed source and unit
vocabularies, stamped with the caller's org, and appended to the shared series
off the request path, so a slow or absent warehouse never fails an ingest.
`GET /v1/compute/fleet/samples` reads that series back and
`GET /v1/compute/fleet` folds the latest sample onto each unit.

### §7 A partial answer says it is partial

Several reads here fold two independent sources, and a fold that loses one MUST
still answer with the source that replied. An outage in a provider a tenant does
not use must not take away the box the tenant does own.

The fold therefore carries the failure rather than swallowing it: a `degraded`
list names the source that did not answer and gives a terse, log-safe reason —
never the upstream's body, which for an unknown path is a page of markup. The
field is additive and omitted when everything answered, so a healthy response is
unchanged and a consumer that wants to tell an outage from an empty estate can.
Without it, "the provider is down" and "you own nothing" are the same three
bytes on the wire.

### §8 Stage

`ga`. The manifest row declares no stage, and absent is `ga` (HIP-0139 §8).

### §9 Upstream

The capability derives from no upstream code: the app embeds nothing and holds
one HTTP client. The compute service it fronts is `hanzoai/visor`, Apache-2.0,
which derives from Casbin's Casibase with that notice preserved in its LICENSE.

That client speaks two wires and every call site says which, because they cannot
be told apart by looking. The enveloped wire answers HTTP 200 with
`{status, msg, data}`, so a logical failure is `status: "error"` at 200 and a
bare status check reads it as success. The typed wire answers the value: the
status is the outcome, 204 for a void result and 404 for a miss, with no
envelope. Converting a noun from one to the other is a wire break and lands with
its caller in the same change.

## Rationale

The alternative to one face over a compute service is the console and the CLI
each calling that service directly. It costs a second copy of the tenant rule in
every client, and the tenant rule is the whole security model here. The
alternative to folding attached compute into the same lists is a second cluster
surface for bring-your-own, which answers "what clusters do I have" twice and
eventually differently.

## Security Considerations

The wrong implementation hands one tenant another tenant's compute. Three facts
prevent it and none of them takes an input the caller controls: the owner is the
validated claim, so a launch cannot be addressed elsewhere; a machine is
identified upstream as owner plus name, so another tenant's id resolves to
not-found rather than to a refusal that confirms it exists; and the identity
headers forwarded are the gateway's own, the client's having been dropped at the
edge.

The attach is the sharpest edge, because a kubeconfig is both a credential for a
cluster and an instruction to dial a host. It is validated before it is sealed,
at the one check that discovery folds and hand-pasted attaches both pass
through: an `exec` or auth-provider credential plugin is refused, because
honouring one runs a binary in the serving process's environment, and the
apiserver must be a routable https endpoint, because a private address is a
request to dial inside the cluster. What is stored is sealed in the org's KMS,
so the custody nodes hold ciphertext, and it is never echoed back.

The admin gate on cluster create and delete protects Hanzo's own money rather
than the tenant's data, which is why it is the only mutation here that asks for
more than membership.

## References

- HIP-0026 — Identity and Access Management
- HIP-0043 — Hanzo Engine
- HIP-0106 — Hanzo Plugin Contract
- HIP-0118 — SuperAdmin and Tenant Isolation
- HIP-0121 — BYO Compute Fleet and Metered Billing
- HIP-0139 — Capability
- HIP-0506 — Hanzo Studio
- HIP-0904 — Zen6 checkpoints
- HIP-1060 — Pubsub — The Tenant Door on the Bus
- HIP-1062 — Workflow — The Durable Run
- HIP-1134 — KMS — Secret Custody
- HIP-1140 — ML — Model Serving
- HIP-1146 — Sandboxes — The Compute Primitive
- HIP-1173 — Network — An Org-Scoped Overlay
- HIP-1210 — Agents — Define, Run, Keep the Run
- HIP-1211 — AI — The Model API
- HIP-1222 — Pricing — The Price List and Who May See It
- HIP-1230 — Platform — The Container Plane
- HIP-1325 — Node — A Machine an Org Owns

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
