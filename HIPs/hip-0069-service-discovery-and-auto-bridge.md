---
hip: "0069"
title: ZAP Mesh — One Bus for Every Node
type: Standards Track
category: Infrastructure
status: Draft
implementation-rust: partial
author: Hanzo AI
created: 2026-05-08
requires: HIP-0026, HIP-0120, HIP-0134, HIP-1134
---


# HIP-0069: ZAP Mesh — One Bus for Every Node

## Abstract

Every process that speaks ZAP on a machine is a **node** on one bus: an
agent's MCP server, the dev CLI, the desktop app, an IDE, a browser extension,
an inference engine, a model router, a sandbox, a GPU host. A node advertises a
descriptor (id, kind, host, what it serves, what it has), can be found by what
it offers, addressed by id, and — where it allows — dedicated to one task by a
lease.

There is no daemon. The router is a library, `zapd` (github.com/zap-proto/zapd),
embedded in every process that speaks ZAP. Each of a user's processes stands for
election on one kernel lock; the holder is that user's router and binds its two
doors, a unix socket and a loopback WebSocket; when it exits, the next process
in line binds them. Browser extensions connect out to the WebSocket, admitted
by their extension origin and a pairing token they prove they hold. Routers on
one LAN find each other by mDNS and link over IAM-authenticated channels, so a
node on one host addresses a node on another.

The mesh ships in three phases, each tested and live before the next:

| phase | what |
|---|---|
| 1 | the local router: election, the socket and the WebSocket door, pairing, and the browser, agent, dev, IDE and desktop nodes |
| 2 | LAN: mDNS discovery, IAM-authenticated router links, addressing across hosts |
| 3 | resources: engines, model routers, GPUs, sandboxes and hosts with descriptors, `find`, leases, and the router's one MCP endpoint |

## Motivation

The browser was reached through a native-messaging host (`zapd host`) that the
browser launched, speaking to a router daemon (`zapd`) somebody had to start.
Snap Chromium's AppArmor profile refuses to exec a host binary outside the
snap, Flatpak refuses it the same way, and each browser family wants its own
host manifest in its own directory. The daemon was one more thing to install,
supervise and upgrade, and nothing stopped two of them running. None of it is
needed: a WebSocket from the extension to loopback works in every browser, and
a router small enough to embed needs nobody to start it.

The same bus carries everything else that was reached some other way: MCP
servers bridged by polling mDNS, a desktop app on its own socket, IDE
extensions on their own servers. One bus, one directory, one addressing
scheme.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### 1. Nodes

A node is one registered connection to a router. Its id is

    <kind>/<host>/<name>

- `kind` is one of `agent`, `browser`, `cli`, `desktop`, `dev`, `engine`,
  `gpu`, `host`, `ide`, `mcp`, `router`, `sandbox`.
- `host` is the router's host: the first label of the machine's hostname,
  lowercased, every character outside `[a-z0-9-]` replaced by `-`, cut to 16
  characters. The router stamps it; a node never chooses it.
- `name` matches `[a-z0-9][a-z0-9-]{0,15}` and is chosen by the node. It MUST
  be stable across the node's reconnects and distinct between nodes of one
  kind on one host.

| node | kind | name |
|---|---|---|
| a browser extension | `browser` | `<engine>-<4 hex>`: the engine (`chrome`, `edge`, `firefox`, `safari`), then 4 hex of an install id minted once and kept in extension storage |
| an agent session's MCP server (hanzo-mcp) | `agent` | `hanzo-<pid>` |
| a `dev` session | `dev` | `<pid>` |
| the desktop app | `desktop` | `hanzo` |
| the IDE | `ide` | `hanzo-<pid>` |
| a CLI invocation (`zapd ls`) | `cli` | `<pid>` |

A node's **descriptor** is what it says about itself in `HELLO` and what the
directory returns for it:

    role   u8          1 provider, 2 consumer, 3 router
    brand  str
    caps   u16 n, n × str               what it serves: tool or capability names
    attrs  u16 n, n × (str key, str value)   everything else it says about itself

Strings are a `u16` little-endian byte length and UTF-8. `attrs` holds phase 3's
resources and `leasable` (§10); a phase-1 node sends none. A body with bytes
after its last field is refused.

### 2. The frame

The wire is the ZAP router envelope, little-endian:

    u32 len            bytes that follow; len = 11 + from_len + to_len + payload_len exactly
    u8  type
    u16 flags          0
    u16 from_len
    u16 to_len
    u32 payload_len
    bytes from         UTF-8, the sender's node id; the router overwrites it
    bytes to           UTF-8, the address; empty means the router itself
    bytes payload

| type | value | direction | payload |
|---|---|---|---|
| `HELLO` | 1 | node → router | the node's descriptor; `from` is `<kind>/<name>` |
| `WELCOME` | 2 | router → node | empty; `to` is the node's full id |
| `PROVIDERS_LIST` | 3 | node → router | a brand filter (str), or empty for all |
| `PROVIDERS` | 4 | router → node | `u16 n`, then n × (id str, descriptor): every node registered |
| `PEER_CONNECTED` | 5 | router → nodes | the id (str) of a node that joined |
| `PEER_DISCONNECTED` | 6 | router → nodes | the id (str) of a node that left |
| `ERROR` | 7 | router → node | UTF-8 reason: `bad_id:<id>`, `no_route:<id>`, `forbidden:<id>`, `unknown_control` |
| `AUTH` | 8 | door only | the pairing proof (§4.3) |
| `ROUTE` | 16 | node → node | opaque: a request |
| `RESPONSE` | 17 | node → node | opaque: a reply |
| `EVENT` | 18 | node → node | opaque: a notification |

Types 1–8 are the router's own control plane; the router reads their bodies
and nothing else. Types 16–18 it forwards untouched: a request, reply or event
between nodes is whatever the two ends agree on, and MCP traffic rides them as
MCP's own JSON-RPC bytes. A frame over 64 MiB, a length that disagrees with its
parts, or a `HELLO` whose `from` is not an id closes the connection.

On the WebSocket each binary message is exactly one frame, `u32 len` included,
so one codec serves both doors. A text message closes the connection.

### 3. The local router

#### 3.1 Election

A user's router is whichever of the user's ZAP processes holds a write lock on

    <runtime>/zapd.lock

where `<runtime>` is `$XDG_RUNTIME_DIR/zap`, or `~/.zap/run` where
`XDG_RUNTIME_DIR` is unset.

- Every process that embeds the library blocks in `fcntl(F_SETLKW)` on that
  file from a thread of its own. The kernel grants the lock to exactly one.
- The holder removes any file at the socket path — it holds the lock, so any
  socket there is stale — binds `<runtime>/zapd.sock`, sets it `0600`, and
  binds the door (§3.3). It then serves until the process exits.
- Exit of any kind — clean, crash, `SIGKILL` — releases the lock, and the
  kernel wakes exactly one waiter, which does the same.
- The lock is an `fcntl` record lock and not `flock(2)`: record locks belong to
  the process and are not inherited across `fork(2)`, so a child forked
  without exec never pins a dead router's seat.
- There is no consensus, lease or heartbeat in the election. Every lock and
  both doors live in the user's own directories and port, so two users on one
  machine never contend: each has a router of their own.

A node speaks only to the lock holder. Before `HELLO` it compares the socket
peer's pid (`SO_PEERCRED`, `LOCAL_PEERPID`) with the lock's holder
(`F_GETLK`, or itself if its own process holds it), and on a mismatch closes and
retries; a process that bound the socket path without the lock — an older
daemon still running — is never spoken to. Because closing any descriptor of a
file drops every record lock the process holds on it, a process opens the lock
file once and never closes it.

A node that sees its connection drop reconnects to the socket, starting at
50 ms and doubling to 1 s, and says `HELLO` again under the same name. A router
takeover is invisible to its user except as a call that fails while it happens.

#### 3.2 Files

| path | mode | holds |
|---|---|---|
| `<runtime>/` | `0700` | the lock and the socket |
| `<runtime>/zapd.sock` | `0600` | the socket |
| `<state>/zap/` | `0700` | the pairing |
| `<state>/zap/pair` | `0600` | the pairing code (§4.3) and a newline |

`<state>` is `$XDG_STATE_HOME` (default `~/.local/state`) on Linux and
`~/Library/Application Support` on macOS. The pairing is state, not
configuration: it binds this machine's router to this machine's browsers and
means nothing elsewhere, and configuration directories are what people commit
and sync as dotfiles.

The router creates what is missing. Before every read it `lstat`s the pairing
directory and file: a symlink, an owner other than the process's uid, or any
group or other permission bit makes the door refuse every connection (the
socket still serves). A missing file is minted from the OS CSPRNG, written to a
private temporary file and hard-linked into place, so a reader never sees half
a file and of two racing minters exactly one wins. Deleting the file rotates
the token; `zapd pair --reset` replaces it.

#### 3.3 Doors

| door | address | admits |
|---|---|---|
| socket | `<runtime>/zapd.sock` | any process of the user: reaching it is the authentication |
| WebSocket | `127.0.0.1:<port>` | a browser extension that passes §4.2 and §4.3 |

`<port>` is the one in the pairing code, which the router mints as
`20000 + uid mod 10000`: below every operating system's ephemeral range, and
distinct for any two users of one machine. If another program holds the port,
the router keeps serving the socket, logs the holder once, and retries the
port, starting at 50 ms and doubling to 2 s. A user whose default port is taken
edits the port in the pairing file and pairs again.

### 4. Joining

#### 4.1 The socket

A connection's first frame MUST be `HELLO`. The router stamps its host into
the proposed `<kind>/<name>` (a proposed `<kind>/<host>/<name>` has its host
replaced), registers the descriptor, and answers `WELCOME` addressed to the
full id. A `HELLO` that names no known kind or an ill-formed name is answered
`ERROR bad_id:<proposed>` and closed.

A second connection registering an id already held replaces the first, and the
router closes the first: a node that reconnects after a router takeover or a
service-worker restart gets its id back at once, and two connections never
speak as one node.

#### 4.2 The WebSocket door

Before upgrading, the router MUST refuse with `403` a request whose

- `Host` is not `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding), or
- `Origin` is not in the allowlist:

| browser | origin |
|---|---|
| Chrome, Chromium, Edge, Brave and every Chromium browser loading the key-pinned build | `chrome-extension://biingenefmanpecedoafkfajbnlgdmbl` |
| Firefox | `moz-extension://<uuid>`, any uuid |
| Safari | `safari-web-extension://<uuid>`, any uuid |

A web page cannot set its `Origin`, so no page gets a socket. The origin is not
the authentication — a local process can send any header, and Firefox and
Safari give every install its own uuid — the pairing proof is. The upgrade and
the proof together MUST finish within 5 s.

A paired browser node:

- MAY send frames addressed to the router and `RESPONSE`s. Any other frame
  with a `to` is answered `ERROR forbidden:<to>` and not forwarded. The browser
  renders hostile pages; it is driven and never drives.
- sends a registry probe (`PROVIDERS_LIST`) every 20 s, which also keeps an
  MV3 service worker alive; the router closes a WebSocket silent for 60 s;
- reconnects after a drop with a delay starting at 250 ms and doubling to 30 s,
  reset by a `WELCOME`.

#### 4.3 Pairing

The pairing code is

    ws://127.0.0.1:<port>/#<token>

where `<token>` is 32 random bytes as 64 lowercase hex characters. A WebSocket
client never sends a URL fragment, so the code names the door and the key
without the key ever crossing the wire. An extension MUST accept only a code of
exactly this shape and MUST NOT dial any other host.

After the upgrade, with `K` the token's 32 bytes and `‖` concatenation:

    extension → router   AUTH  nc                                   32 random bytes
    router → extension   AUTH  ns ‖ HMAC-SHA256(K, "zap router" ‖ nc ‖ ns)
    extension → router   AUTH  HMAC-SHA256(K, "zap client" ‖ nc ‖ ns)
    extension → router   HELLO

The extension MUST verify the router's MAC before it sends anything else; a
wrong MAC closes the socket and the extension reports a pairing mismatch. The
router verifies the extension's MAC in constant time; a wrong MAC closes the
socket without `WELCOME`. The router reads `K` afresh for every connection, so a
new token takes effect at once.

A human carries the code once per browser: `zapd pair` or `hanzo-mcp pair`
prints it to the terminal of the user who asked, and the extension's popup
takes it and keeps it in `storage.local` (never `storage.sync`). No tool
returns it, so it never reaches a model. An unpaired extension dials nothing.

### 5. Addressing

A frame's `to` is empty (the router) or a node id. The router overwrites `from`
with the sender's registered id on every frame it forwards, so no node can
speak as another. A frame to an id that is not registered is answered
`ERROR no_route:<id>`.

A node that calls another matches the reply by its sender: the envelope carries
no correlation, so the library holds one outstanding call per node at a time.
Correlation that lets calls interleave belongs to the payload's protocol (MCP's
JSON-RPC `id`).

The registry answers `PROVIDERS_LIST` with every node and its descriptor.
`PEER_CONNECTED` and `PEER_DISCONNECTED` announce arrivals and departures to
every other node.

### 6. Embedding

There is one router implementation, the Rust crate `zapd`, and every host
embeds that one:

| host | how |
|---|---|
| Rust (the dev CLI, the desktop app, the IDE shell) | the crate, natively |
| Python (hanzo-mcp) | the crate's PyO3 binding, the `zapd` wheel |
| a browser | cannot embed; connects to the WebSocket door as a node and never stands for router |

The library's surface is two calls:

- `embed()` starts one thread with its own runtime that stands for election
  and serves when elected. It returns at once, is idempotent, and needs nothing
  from its host.
- `Node::join(<kind>/<name>, role, brand, caps)` takes this process's seat on
  whichever process is the router, and keeps it: it reconnects and says
  `HELLO` again by itself. `nodes()` lists the registry; `call(to, payload)`
  sends a `ROUTE` and returns the `RESPONSE`.

A hanzo-mcp stands for router and joins as `agent/<host>/hanzo-<pid>` when its
server starts, so a running agent session is all a browser extension needs.

The `zapd` binary is the operator's tool and never serves: `zapd pair [--reset]`
prints the pairing code, `zapd ls` lists the registry.

### 7. Phase 1 nodes

| node | serves |
|---|---|
| `browser` | the extension's browser commands (`caps` `browser.tabs`, `browser.navigate`, `browser.dom`, `browser.screenshot`, `browser.input`). A command body is `method(str) u16 n × (key str, value u32-length bytes)` and the reply is UTF-8 JSON, or `ERR:` and a message. |
| `agent` | nothing yet; it calls browsers for its MCP server's `browser` and `cdp` tools |
| `dev`, `desktop`, `ide` | nothing yet; each is present, found, and addressable |

### 8. What phase 1 does not do

It does not reach beyond the machine, does not describe resources, does not
lease, and does not serve MCP to outside clients. Phases 2 and 3 add each
without changing anything above: a remote node is a node whose host is not
this one (§9), a resource is an `attrs` entry (§10), and the MCP endpoint is a
door (§11).

### 9. LAN (phase 2)

A router links to the routers of the same user and org on other hosts of its
LAN.

- **Listener.** Each router binds a TLS listener on the LAN, on a port the
  kernel chooses, and advertises it by mDNS (RFC 6762, RFC 6763): service
  `_zap._tcp.local.`, instance `<host>-<uid>`, TXT `v=1`, `host=<host>`,
  `org=<org>`. Losing the election closes it with the rest of the router.
- **Keys.** At each election the router makes a fresh TLS key pair and
  self-signed certificate, keeps the private key in memory only, and publishes
  `{host, port, sha256, since}` — the certificate's SHA-256 fingerprint — to
  its org's KMS (HIP-1134) at `zap/links/<host>`, authorized by the user's IAM
  token (HIP-0026). Writing there requires an IAM identity in that org, so the
  org's KMS is the directory of which key speaks for which host.
- **Links.** TLS 1.3, mutual. Each side requires the peer's certificate
  fingerprint to equal the one its org's KMS holds for the host the peer
  claims, fetched afresh when it does not. Then each side sends its IAM access
  token as an `AUTH` frame, verified against the issuer's JWKS (signature,
  `iss`, `exp`, and `owner` equal to its own org). Nothing else is read from a
  peer that has not completed both. The token is sent only to a peer whose key
  its org vouched for, so an mDNS spoofer learns nothing. When both hosts dial
  at once, the connection dialled by the lexically smaller host survives.
- **Registration.** A link is a node of kind `router` on each side, role 3,
  and may join only over a link. Each router sends its peers its registry on
  link and each join and leave; a peer keeps a remote descriptor for 30 s,
  refreshed every 10 s.
- **Forwarding.** A frame whose `to` names another host goes over the link to
  that host's router and is delivered there; `from` keeps the requester's full
  id, and the receiving router records the peer's IAM principal against the
  link.
- **Reach.** A descriptor's `reach` attr says who on other hosts may send it a
  `ROUTE`: `user` (callers whose IAM principal is the router's own; the
  default), `org`, or `none` (not announced off the machine). `dev` and
  `desktop` default to `none`.

### 10. Resources and leases (phase 3)

- **Descriptors.** A resource node describes what it offers in `attrs`: an
  engine its `model` (repeatable), `throughput` and `load`; a GPU its `gpu`,
  `vram_gb` and `util`; a sandbox its `class`; a host its `cpus`, `mem_gb` and
  `gpus`. A node re-sends `HELLO` on its open connection to update its
  descriptor, at least every 10 s; a remote descriptor not refreshed for 30 s
  is dropped.
- **Find.** `FIND {kind, cap, model, host}` returns the matching nodes, this
  host's first and then the LAN's.
- **Leases.** `LEASE {node, ttl}` gives the caller exclusive use of a node
  until it `RELEASE`s or the lease expires; the node's router is authoritative
  for its leases. While a node is leased its router refuses every other
  caller's `ROUTE` to it. Every lease, renewal, release and refusal is logged
  with the holder's node id and IAM principal.
- **Not leasable.** A node that declares `leasable=false` cannot be leased.
  A node advertised to be seen and never driven declares `leasable=false`,
  `reach=none` for `ROUTE`, and no caps; its router refuses every `ROUTE` and
  `LEASE` to it in code, whoever asks. The owner's private AI on `dgx` and
  `flash_serve` on `evo` are such nodes.

### 11. One MCP endpoint (phase 3)

The router serves every node's caps as one MCP server, on the socket and on a
loopback HTTP door authorized by the pairing token, so any agent that speaks
MCP calls any node's tools through one endpoint. Agent sessions are nodes, so
sessions message each other through the same router.

## Differences from the working-tree draft

An earlier draft of this HIP, written toward the same design, made two choices
this specification does not.

1. **Election by a fixed port for everyone.** The draft elected the router by
   binding `127.0.0.1:9927`. That port is machine-wide, so on a machine two
   users share, the first user's router holds it and the second user has no
   router at all: their agents, IDE and browser cannot join anything, and
   their processes can only retry against a port they will never get. It also
   leaves the router's seat to whatever unrelated program took 9927 first.
   Here the election is a lock in the user's own runtime directory, and the
   door is a per-user port; every user has a router, and a foreign holder of a
   port costs only that user's browser door.
2. **The control plane as JSON-RPC in frames 16/17/18.** The draft retired the
   router's binary control bodies (types 1–7) and made `hello`, `find` and the
   rest JSON-RPC methods inside the pass-through types, with the router parsing
   every reply to route it. That makes the router parse arbitrary JSON from
   every node — including a browser rendering hostile pages — on its hot path,
   and turns the types that were opaque into types the router must read, so
   the forwarding rule "the router never reads a payload" no longer holds.
   Here the router reads only its own small binary bodies (1–8) and forwards
   16–18 untouched; MCP traffic between nodes is still MCP's JSON-RPC, as the
   payload those types carry.

The draft also served the one MCP endpoint in phase 1; here it is phase 3,
after the nodes it would serve exist. The draft's node ids, token handling
(`0600`, read afresh, rotate by deleting) and phase framing are kept.

## Rationale

**Why a lock and not a port.** An election needs something the kernel grants
to exactly one process and takes back the moment that process dies. A record
lock is exactly that, it is per user by construction, and it survives `fork`
without being inherited. A socket file is not one: it outlives its owner, and
two processes that both find it stale both unlink it.

**Why a library and not a daemon.** A daemon has to be installed, started,
supervised and upgraded, and a machine can end up with two. A library embedded
in every process that needs the router cannot be missing when one of them runs,
and the election makes the count one.

**Why one implementation.** The router's correctness is in its election, its
door checks and its proof. Two implementations of those are two places to get
them wrong and a promise to keep them identical forever. Rust hosts link the
crate, Python embeds it through a binding, and a browser, which can embed
neither, is a client.

**Why a token and not only the origin.** The origin stops web pages and nothing
else: any local process of any user can send `Origin: chrome-extension://…`,
and Firefox and Safari origins are per install. The mutual HMAC stops other
users' processes in both directions — as a client posing as the extension, and
as a server squatting on the port — without the token crossing the wire.

**Why the pairing is typed by a human.** Anything that delivers the token
without a human — a file the extension reads, a page the router opens — is a
channel something else can use too. The human who can read the token file is
the principal the router serves, and pasting once per browser is the whole
cost.

## Security Considerations

Threat model, phase 1:

- **Web pages** cannot open the WebSocket (origin, host), cannot learn the
  token (it is on disk and in extension storage), and cannot plant one: a code
  reaches the extension only through its popup, from a human.
- **Other local users** cannot open the socket (`0600` in a `0700`
  directory), cannot authenticate on the door (the token is `0600`, and the
  router refuses a token file anyone else could read or have planted), and
  cannot pose as the router to an extension (the router proves the token
  first). They can hold a user's door port first; that denies the browser
  door and nothing else.
- **Local processes of the same user** are inside the trust boundary: they can
  read the token and reach the socket, as they can read the user's browser
  profile.
- **Other extensions** in the same Chromium are refused by origin; in Firefox
  and Safari, where origins are per install, they lack the token.
- **The browser** is the process most exposed to hostile content, so it may
  answer and may not originate: a compromised page or extension context cannot
  drive an agent, a dev session or the desktop.
- **Spoofing** within the machine: the router stamps every forwarded frame's
  `from` with the registered id and closes a connection whose id is taken over.
- **The token** is never logged, never returned by a tool, and never sent to a
  model; it travels only in the pairing code a human carries.

Phase 2 adds: LAN peers are refused until TLS against the fingerprint the
org's KMS holds for that host and an IAM token of the same org both succeed;
mDNS is a hint, so a spoofed announcement leads only to a failed pin; link keys
live in memory for one election. Phase 3 adds: every lease names the IAM
principal that holds it, and a node declared not leasable is refused in the
router's code, not by convention.

## References

- HIP-0026 — IAM: the identity every LAN link and lease carries.
- HIP-0120 — ZAP as the one transport.
- HIP-0134 — one process, one socket, one identity.
- HIP-1134 — KMS: where each host's link key fingerprint lives.
- github.com/zap-proto/zapd — the router library, its Python binding and the
  operator tool.
- RFC 6455 (WebSocket), RFC 2104 (HMAC), RFC 6762 and RFC 6763 (mDNS, DNS-SD).

## Copyright

Copyright and related rights waived via CC0.
