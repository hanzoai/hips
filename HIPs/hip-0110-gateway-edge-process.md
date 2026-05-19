---
hip: 0110
title: Gateway — Standalone Edge Process
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-05-19
requires: HIP-0026, HIP-0044, HIP-0106
---

# HIP-110: Gateway — Standalone Edge Process

## Abstract

This proposal defines `gateway` — a single Go binary, built on
`hanzoai/zip` and `luxfi/zap`, that terminates JSON/HTTP at the
public edge, validates JWTs, mints HIP-0026 identity headers, and
forwards every request to `cloud` (HIP-0106) or `base` over the ZAP
binary wire protocol. The reverse direction — server-initiated SSE and
WebSocket frames — flows back from `cloud`/`base` to the gateway over
ZAP and is delivered to the original client socket.

The gateway is the **only** Hanzo process that JSON-marshals at the
client edge. Every downstream Hanzo service speaks ZAP. There is one
JSON marshal and one JSON unmarshal per request, both at the gateway.

## Motivation

Today's `api.hanzo.ai` runs KrakenD as the public edge: HTTP routing,
JWT validation, rate limiting, request shaping. KrakenD is excellent at
HTTP/HTTP fanout but it is not aware of ZAP, and it does not
understand the HIP-0106 unified `cloud` binary's process model. As we
move every Hanzo subsystem into the unified `cloud` binary, the edge
needs to do exactly four things:

1. Speak JSON to clients (browsers, CLIs, SDKs).
2. Validate JWTs against IAM JWKS, mint typed identity headers.
3. Forward to the right backend over ZAP.
4. Stream reverse-push frames back to the right client socket.

A KrakenD-shaped solution can't do (3) or (4) natively. The replacement
is a small Go binary that owns these four concerns and nothing else.

The gateway is **stateless across replicas**: any replica can serve
any request. Sticky session affinity is an optimization, not a
contract.

## Specification

### Process model

`cmd/gateway/main` runs:

- One public HTTP listener (default `:8080`) terminating client JSON.
- One health/readiness HTTP listener (default `:8081`).
- One ZAP node (default `:9092`) that dials cloud (`:9090`) and base
  (`:9091`) and accepts reverse-push envelopes from both.

Source: `~/work/hanzo/gateway/cmd/gateway/main.go`.

### Wire envelopes

Two ZAP envelopes cover the gateway↔backend boundary:

| Envelope | Direction | Purpose |
|---|---|---|
| `Forward` | gateway → backend | one envelope per inbound HTTP request |
| `Push` | backend → gateway | one envelope per server-initiated push (SSE chunk, WS frame) |
| `Subscribe` | gateway → backend | declares a reverse-push subscription for ConnID |

On-wire bytes match `github.com/luxfi/zap`. Message-type IDs picked in
the 0x80+ range to avoid collision with `base/plugins/zap`'s lower-byte
IDs. Source: `~/work/hanzo/gateway/zap_wire.go`.

### Identity-header trust boundary

The gateway is the **only** authority allowed to mint identity headers
downstream. On every inbound request the middleware strips every header
it can mint, validates the JWT, then re-injects the canonical headers
from the validated claims. The strip-list is a superset of the mint-list
by construction (a unit test enforces it).

Minted headers:

| Header | Claim | Type |
|---|---|---|
| `X-User-Id` | `sub` | string |
| `X-Org-Id` | `owner` | string (org slug) |
| `X-Roles` | `roles` | comma-joined role names |
| `X-User-Email` | `email` | string |
| `X-Phone-Number` | `phone_number` | E.164 string |
| `X-User-IsAdmin` | `isAdmin` | "true" iff platform superadmin |
| `X-User-Permissions` | `permissions` ∪ `isAdmin` | base-10 int64 bit.Field |

Source: `~/work/hanzo/gateway/auth_middleware.go`.

### Backend selection

`pickBackend(path)` routes by path prefix:

- `/v1/base/*` → `base` ZAP peer
- everything else → `cloud` ZAP peer (which routes to the right
  HIP-0106 subsystem in-process)

There is **no** per-route table maintained at the gateway. The cloud
binary's router owns the subsystem dispatch; the gateway only knows
"base vs not-base".

### Reverse-push

Server-Sent Events and WebSocket frames originate inside cloud
subsystems. The flow:

1. Client `GET /v1/ai/chat/stream?session=x` → gateway → cloud (over
   Forward envelope).
2. Cloud subsystem registers itself for `ConnID`, returns 200 + an SSE
   stream.
3. Gateway records the open client socket against `ConnID` in
   `pushRegistry`.
4. Cloud emits a `Push` envelope per chunk, encoded as `sse` or
   `ws-text` / `ws-binary`.
5. Gateway looks up `ConnID` in `pushRegistry`, delivers the frame
   to the client socket.
6. Client disconnect → `UnregisterReversePush` → next Push for that
   ConnID is silently dropped.

Source: `~/work/hanzo/gateway/zap_wire.go` (envelope) + cloud-side
subscription handler.

### Memory profile

The gateway holds steady at **8 KiB heap per concurrent connection
and 1 goroutine per connection** on Apple M1 Max / Go 1.26 / Fiber v3
v3.2.0.

| Conns | Heap delta | Per-conn heap | Goroutines |
|---|---:|---:|---:|
| 1,000 | 7.84 MiB | **8.02 KiB** | **1.00 / conn** |
| 8,454 | 67 MiB | **8.02 KiB** | **1.00 / conn** |

Reproduce locally:

```bash
cd ~/work/hanzo/gateway
go test -mod=mod -run=TestConnMemory -v -conn-count=10000
```

Source: `~/work/hanzo/gateway/conn_memory_test.go`.

#### Replica capacity math

Linear scale-out math from the per-conn budget:

| Concurrent conns | Heap | Pod RAM (with headroom) |
|---:|---:|---:|
| 10,000 | 80 MiB | 256 MiB |
| 100,000 | 800 MiB | 1 GiB |
| 1,000,000 | 8 GiB | 10 replicas × 1 GiB |

The operational target is **100k concurrent client connections per
replica** at a 1 GiB pod ceiling. Ten replicas → one million concurrent
client connections.

The cliff above 100k/replica is OS-side (fasthttp's listener queue,
ulimit, kernel ephemeral port range), not Go-side. Cap
`Concurrency: 100_000` on `zip.Config` to keep replicas inside the
budget.

### Build discipline

The gateway is built with `GOEXPERIMENT=jsonv2` in its production
Dockerfile. This routes every JSON marshal/unmarshal at the edge
through `encoding/json/v2`, yielding the verified −12% time / −23%
allocs win on the edge POST roundtrip (see HIP-0106 §3.3 and
`docs/SCALE_STANDARD.md`).

Source: `~/work/hanzo/gateway/Dockerfile`.

### Tuning knobs

The gateway exposes the fasthttp-side knobs ops needs to cap
per-replica capacity. Surface via `zip.Config`:

```go
zip.New(zip.Config{
    Logger:          luxlog.NewLogger("gateway"),
    Concurrency:     100_000, // hard cap on concurrent conns
    ReadBufferSize:  4 << 10, // 4 KiB per conn
    WriteBufferSize: 4 << 10, // 4 KiB per conn
    BodyLimit:       4 << 20, // 4 MiB body
})
```

Defaults are the fasthttp defaults — they hit the 8 KiB/conn budget
out of the box.

## Non-goals

- **Per-route HTTP routing at the gateway.** The cloud binary's router
  owns per-route dispatch; the gateway only knows base vs cloud.
- **Rate limiting policy.** That belongs in the cloud subsystem next
  to where the cost is paid (e.g. ai subsystem rate-limits tokens, not
  connections).
- **Authorization beyond `X-User-IsAdmin` minting.** Per-route policy
  decisions live in the cloud subsystem (typically in
  `commerce/middleware/iammiddleware` over the gateway-minted
  `X-User-Permissions` bit-field).
- **TLS termination.** The cluster's ingress controller terminates
  TLS. The gateway speaks plaintext HTTP inside the cluster.

## Migration

The gateway repo `~/work/hanzo/gateway/` already houses:

- `cmd/gateway/main.go` — the edge process entrypoint (this HIP).
- `build_app.go` — the `BuildApp(deps)` zip wiring.
- `zap_wire.go` — the Forward / Push envelopes.
- `auth_middleware.go` — JWT validation + identity-header mint.
- `conn_memory_test.go` — the per-conn budget regression test.

Phase 1 (already in flight on `feat/hip-0110-gateway-edge-process`):
ship the cmd/gateway binary alongside the existing KrakenD config.
Route a small percentage of traffic via the new gateway.

Phase 2: route 100% of traffic via the new gateway. Decommission
KrakenD. Retire the KrakenD config in `configs/`.

Phase 3: when HIP-0106's `cloud` binary ships, the gateway subsystem
imports as `hanzoai/gateway` and is mounted in-process. The cmd/gateway
binary stays as a standalone variant for split-deploy scenarios.

## Open questions

1. **h2 termination.** fasthttp does not support h2. When a client
   negotiates h2, the ingress controller must downgrade or we serve h2
   in front of fasthttp via Caddy. Pick one for the production rollout.
2. **WebSocket per-conn budget.** The 8 KiB number is HTTP/1.1
   long-hold. wsx adds a small upgrader; expected delta is small but
   unmeasured. Add a `TestConnMemory_WS` once wsx ships the production
   interface.
3. **TLS-terminated per-conn budget.** When the gateway terminates TLS
   in-process (vs behind ingress TLS-passthrough), per-conn budget
   grows by the `crypto/tls` connState size. Measure and document
   alongside the plaintext number.

## References

- HIP-0026 — IAM (JWT validation, identity headers)
- HIP-0044 — API Gateway Standard
- HIP-0106 — Unified Hanzo Cloud Binary (the gateway forwards to cloud)
- `~/work/hanzo/hips/docs/SCALE_STANDARD.md` — the per-conn and JSON
  build discipline this HIP cites.
- `~/work/hanzo/gateway/` — reference implementation.
