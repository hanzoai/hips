---
hip: 1232
title: Git — Repository Hosting
author: Hanzo AI
type: Standards Track
category: Infrastructure
status: Final
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
capability: git
---

# HIP-1232: Git — Repository Hosting

## Abstract

`git` is Git hosting for an org: create repos, clone, push, browse, and see
what they cost. It mounts the `/v1/git` surface of the cloud binary — bare
repositories on disk, the smart-HTTP and SSH transports git clients speak
natively, imports, pulls, mirroring and the browse pages
(`apps/git/git.go:1-45`). It is implemented in `hanzoai/cloud` at `apps/git`.
This HIP states the target surface: everything under `/v1/git`, with the
host-gated root spellings leaving the binary for the standalone forge that
serves that host in production.

## Motivation

The capability claimed four top-level prefixes for one product: its own
`/v1/git`, an un-host-gated browse tree at `/git`, and root routes — `/`,
`/explore`, `/:org/:repo` — answered only when the request's Host is the
dedicated git host. That host is served in production by the standalone
forge, a separate process, so the root claims published addresses this
binary never deliverably answers; the manifest walk already refuses a
parameter-first prefix.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be
interpreted as in RFC 2119.

### The stores

The capability owns per-org stores, not one shared file: each org's repo
metadata is its own `git.db` opened through the org-store seam
(`apps/git/git.go:222`), beside the repositories themselves — bare git
repos under `{DataDir}/git`, with an S3-backed storage seam
(`apps/git/storage.go`) — and one system `ssh_keys` registry
(`apps/git/keystore.go:68`), global because an SSH connection presents a
key before any org is known, so auth is a single fingerprint lookup.

### The addresses

Every route is under `/v1/git`: repos CRUD and `usage`; the smart-HTTP
protocol at `/v1/git/:org/:repo/...` and, for project-scoped repos,
`/v1/git/:org/:project/:repo/...` — the path is the only channel a git
client can carry a project in, since it sends no headers; and the browse
pages, folded from `/git` to `/v1/git/explore` and
`/v1/git/:org/:repo{,/tree,/blob,/commits}`, where literal segments outrank
the `:org` parameter so nothing collides. The router today still carries the
`/git` tree and the three host-gated root spellings; each pair is a line in
cloud's `openapi/misfiled.txt`. The browse tree closes by fold; the root
spellings close by deletion — `git.hanzo.ai` is served in production by the
standalone forge, so removing them changes nothing live and only retires
the single-binary dev forge origin, whose clone address remains
`/v1/git/:org/:repo`.

Repos, usage, pulls and control operations are typed. The smart-HTTP
operations are declared prose, and cannot be otherwise: their wire is git's
own protocol — pkt-line framing, side-band multiplexing, gzip request
bodies — not JSON, and the document says so where it matters, telling the
consumer this is not an API call to make by hand
(`apps/git/smart_http.go:38-45`). The browse pages answer server-rendered
HTML and are declared the same way.

### Tenancy

The org is the gateway-minted, IAM-validated claim (HIP-0026), with an
optional project sub-scope; every query is scoped by it, so one org can
never read, clone, push to or delete another's repos. On the pack routes the
path also names an org, and it MUST equal the authenticated one
(`apps/git/smart_http.go:284`). A push is never anonymous. The one read
concession is a repository marked public: fetch-side operations answer
without an authenticated org, push-side never
(`apps/git/smart_http.go:292`). Over SSH, the presented public key's
fingerprint resolves through the global registry to the org whose scope the
pack machinery then runs under — the same boundary the HTTP path derives
from the header (`apps/git/ssh.go:27-33`).

### Free, in those words

The capability is free: the plugin declares `Price: cloud.Free`
(`plugin/git/main.go:21`), and no handler gates or meters spend. Usage is
measured, not charged: every repo's size is re-measured on create and after
each push, exposed per-repo and in total at `/v1/git/usage`, and each
measurement emits a `git.usage` log line a metering consumer can bill on
(`apps/git/git.go:696`).

### Events, observability, stage

The capability publishes no events on the bus, so a customer's webhooks
receive nothing from it. A landed receive-pack emits `push.landed` on the
in-process lifecycle stream, and the notification reactor delivers
`push.landed`, `deploy.live` and `deploy.failed` to the channels an org has
subscribed, durably, deduplicated per event (`apps/git/notify.go:48-88`).
Beyond the request span it emits the `git.usage` line and structured logs
only. Its stage is `ga`: the manifest row carries no stage field, and
absent means `ga` (HIP-0139 §8).

The push-to-build endpoint is not here. The deploy trigger's one registrant is
the platform process, so the forge delivers pushes to platform's hook
(HIP-1230); a receiver in this process signed, accepted, answered 204 and
built nothing, which is why the address moved.

### Upstreams

- `go-git/go-git` v5 (Apache-2.0) — repository init and the read path,
  confined to one file so nothing go-git-shaped escapes it
  (`apps/git/gitbackend.go:3-12`).
- `go-git/go-billy` v5 (Apache-2.0) — the filesystem abstraction under it.
- `golang.org/x/crypto/ssh` (BSD-3-Clause) — the SSH transport.
- the system `git` binary (GPL-2.0) — executed as a subprocess for
  stateless-RPC pack streaming (`apps/git/gitexec.go`), so multi-GB packs
  stream through stdin/stdout and never land in this process's memory;
  invoked, never linked.
- the smart-HTTP framing patterns are ported from the upstream forge's
  `routers/web/repo/githttp.go` (MIT) (`apps/git/smart_http.go:30`).

## Rationale

The alternative to deleting the root spellings is keeping a second clone
address alive in a binary that does not serve the host it is gated on — an
address the manifest walk refuses and production traffic never reaches.
The alternative to declaring the pack operations is typing them, which
would publish JSON schemas for a wire that is not JSON and hand every
generated SDK twelve methods that corrupt a clone when called.

## Security Considerations

The wrong implementation leaks source code. A pack route that trusts the
path org instead of comparing it to the authenticated one serves another
tenant's repository to anyone who can spell its name; the path-vs-identity
guard is the boundary. The SSH key registry is the authentication for the
SSH transport, so writing to it is minting access: key registration is
org-scoped and the fingerprint lookup is global only because it must run
before identity exists. Pack streaming through the CLI is also the memory
bound — buffering a push in-process would let one crafted pack exhaust the
binary serving every org.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1230 — Platform — The Container Plane

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
