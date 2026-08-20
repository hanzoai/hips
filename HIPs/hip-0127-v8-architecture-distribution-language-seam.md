---
hip: 0127
title: "V8 · Open Edition — Architecture, Distribution & the Language Seam"
author: Hanzo AI Team
type: Standards Track
category: Meta
status: Active
created: 2026-07-08
requires: HIP-0040, HIP-0041, HIP-0106, HIP-0114, HIP-0120
---


# HIP-0127: V8 · Open Edition — Architecture, Distribution & the Language Seam

## Abstract

The spine of Hanzo **V8 · Open Edition**: how the whole cloud is composed, split
across languages, and distributed — as one coherent set of decisions so no
consumer ever needs to know or care which part is Go and which is Rust. It ties
together the plugin contract (HIP-0106), the ZAP transport (HIP-0114/0120), the
CLI (HIP-0041), and the multi-language SDKs (HIP-0040) under one rule:
**one contract, many bindings, thin clients, and a wire — never FFI — between
languages.**

## Motivation

Hanzo is Go *and* Rust: the cloud is Go, the engine, the `dev` agent, and the ML
kernels are Rust. The naive urges are both wrong:
- fuse them in one process over FFI (cgo/uniffi), or
- split the GitHub orgs by language (`hanzo-go`/`hanzo-rs`).

The first *complects* two toolchains: a Go⟷Rust FFI link means one build that
needs both, a cross-compile matrix that is the product of the two, and a crash in
either half landing in the other's process. The second leaks the implementation
detail into the org, forcing users to know which half a capability lives in. V8
rejects both.

Note what this rejects and what it does not. It rejects a **language seam** over
FFI; it is not a blanket ban on cgo. `make` defaults to `CGO_ENABLED=0` — a pure-Go
build that registers exactly one `sqlite` driver — while the shipped image builds
`CGO_ENABLED=1 -tags "libsqlite3 sqlite_fts5"` so stores link the live
libsqlcipher codec (`cloud/Makefile`, which states outright that the shipped
binary is not pure Go). One C library inside one Go binary is a dependency
choice. Linking Rust into that same binary would be an architecture, and that is
the thing refused here.

## Specification

### 1 — One contract, one host, many plugin binaries
The application cloud is a **light Go host** (`cloud`) plus **123 plugin
binaries**, composed at run time and not linked at build time (HIP-0106). The
host holds no subsystem code. `manifest.Apps` — a hand-authored
`var Apps = []App{…}` in `cloud`'s `manifest/apps.go` — is the source of truth
for the set; `cmd/cloud/main.go` walks it and calls `zip.Load(p, a.Prefixes…)`
per row, then `app.Use(leaf)`. Of the 123 rows, 4 are eager, 1 is co-resident
(middleware on another app's router, mounting nothing of its own) and the rest
load on first request. **There is no `subsystems.go` in this path.** Earlier
drafts of this HIP named one; the only file by that name in `cloud` is
`apps/admin/subsystems.go`, which *reports* on the composition and does not
create it.

Its public surface is **`/v1/<capability>`** over **HTTP + ZAP**, the ONE
contract every consumer speaks. One capability = one name = one `/v1/<name>` =
one self-contained spec.

#### 1.1 — Three numbers, three questions, never conflated
Every number below has one authority and answers one question. They are close in
size and were repeatedly quoted for each other; that is the defect this
subsection exists to end.

| Number | Question it answers | Authority |
|---|---|---|
| **191 capabilities** | Which names exist for a reader shown the whole API at once, and which of nine domains each sits under | `capabilities.yaml` in the **`hanzoai/openapi` repository** — `openapi/` is the REPO name, not a directory inside `cloud` |
| **182 products** | Which capability names the served document actually carries today | the top-level `tags:` of `cloud`'s emitted `openapi.yaml` (2,473 operations across the 123 subsets) |
| **123 apps** | How many things get built, shipped and started — the deployment unit | `manifest.Apps` in `cloud/manifest/apps.go`, in exact bijection with the 123 `plugin/<app>/openapi.json` subsets, gated by `plugin/gen-app-cmds` |

The manifest is **curation, not a registry**: it cannot invent a capability,
because `publish.py` refuses in both directions — a served name nobody has
grouped fails the publish, and a grouped name nothing serves fails it too. The
nine domains are `identity` (18) · `intelligence` (51) · `data` (18) ·
`streams` (16) · `observability` (12) · `commerce` (22) · `platform` (26) ·
`applications` (25) · `chain` (3).

**Capability ≠ app.** 27 apps serve more than one `/v1` product (`billing` also
answers `/v1/finance`), and some products are served by the host itself rather
than by any plugin (`GET /v1/commands`, `GET /v1/openapi.json`) — so a sweep of
`plugin/*/openapi.json` alone under-reports the served set, and reading a
capability count as a binary count is always wrong.

A fourth number exists and is not a capability count: operations carrying the
`compat` tag are DROPPED from the published document by `publish.py`, so a
wire-compatibility dialect never mints a product name.

#### 1.2 — Declared-but-unserved names are drift, and are named
At time of writing the manifest declares 13 names `cloud` no longer serves. Each
is a rename or a consolidation with a commit behind it — `sentry`→`sentinel`,
`automations`→`auto`, `kv`/`sql`/`docdb`/`datastore` folded into
`/v1/instances/*`, `balancers`/`vpcs`/`cloud` deleted with their apps, four
speech names folded into `/v1/audio/*`, and `health`, which was never a product
(per-app liveness is auto-mounted). Five served names are ungrouped:
`instances`, `sentinel`, `seo`, `allowance` and `edge`.

`edge` must NOT be grouped. `GET /v1/edge` names a POSITION, not a product; the
correction belongs in `cloud` — move the probe under its owner's prefix — and
until it moves the publish stays blocked, which is the gate working.

### 2 — The language seam is the ZAP wire, NEVER FFI
Go and Rust components compose over **ZAP** (network or local socket), each a
clean single-language binary. Go `cloud` ⟷ Rust `engine`/`dev`/`cli` never link
each other's code; they exchange ZAP frames. The wire format those frames are
in — what a ZAP message *is*, field offsets and all — is defined once, language-
agnostically, in **`zap-proto/zap-spec`**. The runtimes implement it:
`zap-proto/go`, `@zap-proto/zap` for TypeScript, and the `zapwire` crate in
`hanzoai/zap` for Rust, which is cross-checked against Go's bytes.

- No cross-toolchain build: each binary is compiled by one toolchain, and a
  release matrix is the sum of the two rather than their product.
- Language becomes an internal detail of each box; the boxes stay orthogonal and
  composable. Don't fuse — **bridge**.

### 3 — Distribution: one contract → N bindings → thin clients
The direction of generation is one-way and starts in the code. `cloud` emits
`openapi.yaml` from its own live routers (the weave of the 123 per-app subsets);
`publish.py` in `hanzoai/openapi` derives `hanzo.yaml` from that emission at one
pinned release, applying `capabilities.yaml` only as the domain grouping.
**Nothing is authored downstream of the code**: to change the API you change a
route in `cloud`.

```
cloud/openapi.yaml    (emitted from the live routers — 123 subsets, woven)
   │  publish.py, at one pinned release  ↓   (+ capabilities.yaml: grouping only)
hanzo.yaml            (the ONE published contract — /v1 over HTTP + ZAP)
   │  generate ↓
 go-sdk · rust-sdk · js-sdk        (language bindings — HIP-0040; rust hand-kept)
   │
 hanzo   — the control CLI (apps/deploy/login/…)   → @hanzo/cli
 dev     — the coding agent (codex fork)           → @hanzo/dev

 zap-proto/zap-spec    an INPUT, not an output: the ZAP wire format itself,
                       hand-authored and language-agnostic (§2)
```
- **The CLI is a client, never the server.** It speaks HTTP or ZAP to a *live*
  cloud — prod, a laptop host, or a customer self-host — and **never imports
  `hanzoai/cloud`** (that coupling is what makes a control tool carry a fleet).
  The rule holds by construction today: `hanzo` is Rust and links no Go.
- **CLI language = Rust**, one thin binary per tool. `hanzo` and `dev` are two
  Rust binaries sharing an auth model (HIP-0111 OIDC PKCE S256) but, today, not
  yet a crate: there is no shared `hanzo-client`. One client crate under both
  remains the target; nothing about the seam depends on reaching it.
- **Distribution is one harness, many channels:** per-platform prebuilt binaries
  on GitHub Releases, fetched by ONE script. `cli/install.sh` is the single
  implementation of "fetch a Hanzo binary" — it detects the platform, verifies
  the asset's sha256, and refuses loudly on a platform we do not publish. The
  channels drive that one script rather than carrying copies of it: `hanzo.sh`
  (curl|sh) overrides three variables per tool, and `@hanzo/cli`/`@hanzo/dev`
  install it from a postinstall step whose `bin` shim execs the real binary and
  gets out of the way. One binary per tool, N channels (HIP-0041).

### 3a — Schemas are co-located, never a monorepo
A capability's `.zap` wire schema lives **alongside the product that implements
it** — the contract evolves with its code in one PR, versioned as a unit. There
is **no central `hanzoai/zap` schema repo**; centralizing decouples contract from
implementation (drift) and braids every product's contract into one place.
- Shared primitives — the message layout every schema is expressed in — live in
  `zap-proto/zap-spec`, one level below any capability, the same way an OpenAPI
  document depends on JSON Schema rather than on a shared components file. There
  is no `openapi/shared`; an earlier draft cited one, and nothing by that name
  exists.
- Discovery for cross-service consumers is a **generated union**, the ZAP analog
  of `hanzo.yaml` — not a monorepo.
- `.zap` and OpenAPI are two transports of the SAME `/v1` contract, and both
  derive from the implementing code, never from each other and never from the
  manifest (`capabilities.yaml` groups names for a reader and declares no route).
  Do not hand-maintain them separately — one contract → HTTP + ZAP + SDKs, all
  generated.
- `hanzoai/zap` stays the Hanzo ZAP **runtime/sidecar** (SQL/KV/Datastore bridge),
  never a schema store.

### 4 — Org by capability, not by language
Everything canonical under **`hanzoai/<product>`** (`hanzoai/cloud` Go,
`hanzoai/engine` Rust, `hanzoai/dev` Rust, `hanzoai/cli` Rust). NO
`hanzo-go`/`hanzo-rs` orgs. Users never know or care which language answered —
because the org is product-first and the wire is uniform, **not** because the
languages are fused.

### 5 — Deploy: the declared state is the only writer
**One writer, and for a first-party service it is git, not the cluster.** The
image a service runs is declared in the universe repository's operator App CR
(`hanzo.ai/v1`, `infra/k8s/operator/crs/<service>.yaml`) and reconciled by
Hanzo CD with `selfHeal`. A rollout is therefore a COMMIT that moves the tag in
that file; the operator reconciles from it.

This inverts what an earlier draft of this section specified. It said deploys
merge-patch the CR's `.spec.image` from an embedded `clients/paas`. Two things
are wrong with that. `clients/paas` does not exist — the code is
`cloud/apps/platform/rollout.go`. And its `releaseService` **refuses that patch
by name**: under `selfHeal` a patch is reverted on the next sync, so the release
would look applied and then silently roll back. It validates first (DNS-1123
name, strict-semver image, the App exists in the namespace) so the refusal is
specific, and its error names the remedy: commit the tag to that file.

A green pipeline therefore ends at a minted release tag — a receipt for a built,
smoke-passed image — and NOT at a live rollout. That pair is not a broken build;
it is an image with no declared state pointing at it yet. The mechanism this
enforces is exactly "no second deployer": a CR patch plus a git commit are two
writers for one fact, and composing them best-effort hides their disagreement.
The `hanzo` CLI and the platform UI drive the commit; neither writes to a
cluster.

### 6 — Decentralized: the network is the substrate
`hanzo.network` is the Hanzo Node fleet — a Rust peer-to-peer node for
decentralized AI compute coordination (HIP-0020), a different artifact from the
Go host and its plugins. The two meet at compute, not at a shared process: a
box on the network contributes metered capacity that the cloud bills against
(HIP-0121) and that earns its operator rewards (HIP-0096), and a mainnet
validator's own box is native rather than rented.

What makes this OSS AI cloud is that the same 123 apps run anywhere: anyone runs
them on their own machine, brings their own GPU or K8s, and public + OSS
workloads run free on public nodes. **They are not one binary.** The fused build
that once linked every subsystem into `cmd/cloud` was deleted; what a self-hoster
runs is the light host plus whichever plugins they want, which is precisely why
running a subset is cheap — an app you do not mount is a binary you never build.
Read the "single binary" of earlier drafts as "one artifact per app, one command
to run them", never as one link step over the fleet.

## Consequences

- Closes the `cmd/hanzo` question (#10), though not the way it was closed on
  paper. `cmd/hanzo` and the server-multicall rung were **deleted**, not folded:
  a per-app binary is now the only plugin source. The thin control CLI is the
  Rust `hanzo`.
- SDKs (HIP-0040) and CLI (HIP-0041) are now defined as *derivations of
  `hanzo.yaml`*, not independent artifacts.
- Sites (`docs.hanzo.ai`, `hanzo.ai`, `hanzo.app`) present this model verbatim:
  category-first capability surface, the network story, the self-host path. The
  reference is regenerated from the document on every build — one page per
  PRODUCT, not per app, and none of it authored — so a capability's page appears
  when its route does and cannot be written ahead of it.

## References

- HIP-0106 The Hanzo Plugin Contract · HIP-0114/0120 ZAP Transport ·
  HIP-0040 SDKs · HIP-0041 CLI · HIP-0111 IAM Authentication ·
  HIP-0020 Blockchain Node · HIP-0096 Compute Rewards · HIP-0121 BYO Compute.
- `capabilities.yaml`, `publish.py` and `hanzo.yaml` in the **`hanzoai/openapi`**
  repository · `manifest/apps.go` and `cmd/cloud/main.go` in `hanzoai/cloud` ·
  `hanzoai/platform` · `zap-proto/zap-spec` · `hanzoai/zap`.
- HIP-0138 described the fused single-binary predecessor and is **Superseded**
  by HIP-0106. Do not read it as current architecture.
