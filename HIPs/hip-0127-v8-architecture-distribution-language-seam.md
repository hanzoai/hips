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

## Abstract

The spine of Hanzo **V8 · Open Edition**: how the whole cloud is composed, split
across languages, and distributed — as one coherent set of decisions so no
consumer ever needs to know or care which part is Go and which is Rust. It ties
together the unified binary (HIP-0106), the ZAP transport (HIP-0114/0120), the
CLI (HIP-0041), and the multi-language SDKs (HIP-0040) under one rule:
**one contract, many bindings, thin clients, and a wire — never FFI — between
languages.**

## Motivation

Hanzo is Go *and* Rust: the cloud is Go (pure, single-binary), the engine, the
`dev` agent, and the ML kernels are Rust. The naive urges are both wrong:
- fuse them in one process over FFI (cgo/uniffi), or
- split the GitHub orgs by language (`hanzo-go`/`hanzo-rs`).

The first *complects* two toolchains — cgo destroys the `CGO_ENABLED=0`
single-static-binary that makes "curl | sh, run the whole cloud anywhere" true.
The second leaks the implementation detail into the org, forcing users to know
which half a capability lives in. V8 rejects both.

## Specification

### 1 — One binary, one contract
The application cloud is **one Go binary** (`cloud`, `CGO_ENABLED=0`, static),
embedding ~54 subsystems mounted from `subsystems.go` (HIP-0106). Its public
surface is **`/v1/<capability>`** over **HTTP + ZAP**, the ONE contract every
consumer speaks. Capabilities are grouped into the eight movements of the
capability manifest (`openapi/capabilities.yaml`): one capability = one name =
one `/v1/<name>` = one self-contained spec.

### 2 — The language seam is the ZAP wire, NEVER FFI
Go and Rust components compose over **ZAP** (network or local socket), each a
clean single-language binary. Go `cloud` ⟷ Rust `engine`/`dev`/`cli` never link
each other's code; they exchange ZAP frames whose schema lives in `zap-spec`.

- Preserves the pure-Go single static binary (no cgo, no cross-toolchain build).
- Language becomes an internal detail of each box; the boxes stay orthogonal and
  composable. Don't fuse — **bridge**.

### 3 — Distribution: one contract → N bindings → thin clients
```
hanzo.yaml            (the ONE contract — /v1 over HTTP + ZAP, from capabilities.yaml)
   │  generate ↓
 go-sdk · rust-sdk · js-sdk        (language bindings — HIP-0040; rust hand-kept)
 zap-spec                          (the ZAP wire types)
   │
 hanzo-client (Rust: ZAP bridge + hanzo.id auth + rust-sdk)
   ├── hanzo   — the control CLI (apps/deploy/login/…)   → @hanzo/cli
   └── dev     — the coding agent (codex fork)            → @hanzo/dev
```
- **The CLI is a client, never the server.** It speaks ZAP (or its SDK) to a
  *live* cloud — prod, a laptop single-binary, or a customer self-host — and
  **never imports `hanzoai/cloud`** (that coupling is the ~600 MB trap).
- **CLI language = Rust**, sharing `hanzo-client` with `dev`: one auth stack, one
  ZAP client, one SDK, two thin frontends. A ~15 MB binary — npm-shippable.
- **Distribution is one harness, many channels:** per-platform prebuilt binaries
  on GitHub Releases → `@hanzo/cli`/`@hanzo/dev` via npm `optionalDependencies`
  (esbuild/turbo pattern) + `hanzo.sh` (curl|sh) + brew + `go install`. One
  binary per tool, N channels (HIP-0041).

### 3a — Schemas are co-located, never a monorepo
A capability's `.zap` wire schema lives **alongside the product that implements
it** — the contract evolves with its code in one PR, versioned as a unit. There
is **no central `hanzoai/zap` schema repo**; centralizing decouples contract from
implementation (drift) and braids every product's contract into one place.
- Shared primitives (auth, errors, the common envelope) → `zap-proto/zap-spec`
  (the analog of `openapi/shared`).
- Discovery for cross-service consumers is a **generated union**, the ZAP analog
  of `hanzo.yaml` — not a monorepo.
- `.zap` and OpenAPI are two transports of the SAME `/v1` contract: both derive
  from the per-service contract (`capabilities.yaml` + spec). Do not hand-maintain
  them separately — one contract → HTTP + ZAP + SDKs, all generated.
- `hanzoai/zap` stays the Hanzo ZAP **runtime/sidecar** (SQL/KV/Datastore bridge),
  never a schema store.

### 4 — Org by capability, not by language
Everything canonical under **`hanzoai/<product>`** (`hanzoai/cloud` Go,
`hanzoai/engine` Rust, `hanzoai/dev` Rust, `hanzoai/cli` Rust). NO
`hanzo-go`/`hanzo-rs` orgs. Users never know or care which language answered —
because the org is product-first and the wire is uniform, **not** because the
languages are fused.

### 5 — Deploy: native PaaS, not ArgoCD
Deploys go through the native PaaS (`hanzoai/platform`, embedded `clients/paas`),
which merge-patches the operator `Service` CR's `.spec.image`; the operator
reconciles the rollout. "No second deployer." Driven by the `hanzo` CLI /
platform UI. ArgoCD is retired (sequenced — it currently bootstraps the PaaS).

### 6 — Decentralized: the network is the cloud
`hanzo.network` is `hanzod` blockchain nodes; they spawn and power the same
unified binary run in production. It is **OSS AI cloud in a single binary** —
anyone runs the whole cloud on their own machine, brings their own GPU or K8s,
mines on any device (confidential via NVIDIA TEE/CC, market-priced), and public +
OSS workloads run free on public nodes (GitHub-for-compute). The 67 capabilities
are one binary; the network is the substrate.

## Rationale

- **Values, not places** (Hickey): a capability is named by its `/v1` route, not
  by which repo/language/pod implements it.
- **Decomplect**: the Go/Rust boundary is a *value boundary* (ZAP frames), not a
  *place boundary* (FFI in one address space). One concern per binary.
- **One and one way**: one contract (`hanzo.yaml`), one client core per stack
  (`hanzo-client`), one distribution harness — every CLI/SDK derives, none is
  hand-forked.
- **Easy ≠ simple**: FFI is *easy* (one repo, one process) but *complects*
  toolchains; the wire seam is *simpler* (independent, composable, language-free
  at the boundary).

## Consequences

- Closes the `cmd/hanzo` question (#10): server-multicall folds into `cloud`; the
  thin control CLI becomes the Rust `hanzo` on `hanzo-client`.
- SDKs (HIP-0040) and CLI (HIP-0041) are now defined as *derivations of
  `hanzo.yaml`*, not independent artifacts.
- Sites (`docs.hanzo.ai`, `hanzo.ai`, `hanzo.app`) present this model verbatim:
  category-first capability surface, the network story, the self-host path.

## References

- HIP-0106 Unified Cloud Binary · HIP-0114/0120 ZAP Transport · HIP-0040 SDKs ·
  HIP-0041 CLI · `openapi/capabilities.yaml` · `hanzoai/platform` · `zap-spec`.
