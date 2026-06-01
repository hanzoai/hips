---
hip: 0110
title: Gateway as Edge Process
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
requires: HIP-0026, HIP-0044, HIP-0068, HIP-0106
---

# HIP-0110: Gateway as Edge Process

## Abstract

This proposal separates the gateway from the unified cloud binary
defined in HIP-0106. The gateway becomes a stateless edge process that
terminates client HTTP/TLS, owns the JSON boundary, validates JWTs,
mints the canonical identity-header set (`X-Org-Id`, `X-User-Id`,
`X-User-IsAdmin`, `X-User-Permissions`, `X-User-Email`, `X-Roles`,
`X-Phone-Number`), and forwards the resulting request to the cloud
binary over ZAP. Cloud subsystems trust the gateway-minted headers
unconditionally and never speak HTTP to external clients in production.

The gateway is built on `hanzoai/zip` (Fiber v3 / fasthttp) and the
`luxfi/zap` binary transport. The same ZAP socket carries inverse
push frames from `hanzoai/base` back through the gateway to subscribed
SSE / WebSocket clients without re-marshaling JSON. The gateway holds
no per-tenant state beyond in-flight connections, so horizontal
scaling is a pure replica-count knob with no sticky sessions and no
shared cache.

## Motivation

HIP-0106 collapsed 13 Hanzo Go subsystems into one cloud binary mounted
through `Mount(*zip.App, cloud.Deps) error`. That collapse is correct
for subsystems whose interaction is in-process and ZAP-typed. It is
wrong for the gateway, for four reasons:

1. **Different scaling axis.** Subsystems scale with tenant workload —
   storage I/O, AI inference, billing math. The gateway scales with
   open client connections, TLS handshakes, JWT validations, and
   header rewrites. A subsystem replica with the gateway co-mounted
   wastes RAM on every replica that doesn't actually terminate
   external traffic.

2. **Different trust boundary.** The gateway is the only place that
   has seen a raw client request. Mounting it in the same address
   space as IAM, KMS, and Base couples those subsystems' availability
   to the gateway's parsing and ratelimit logic. A fasthttp parse
   panic in the gateway becomes a Base outage. They must be separated
   at the process level, not just the package level.

3. **JSON is an edge concern.** Every external client speaks JSON.
   Every internal call between Hanzo services is ZAP-typed (HIP-0106).
   The translation from JSON to ZAP-typed Go must happen exactly once,
   at the gateway, on the way in; the reverse happens exactly once,
   at the gateway, on the way out. Co-mounting the gateway forces the
   cloud binary to carry JSON marshal/unmarshal code for every
   request even when no external traffic is on the same replica.

4. **Stateless replica math is cleaner without sticky sessions.** The
   `cloud` binary benefits from `X-Org-Id` consistent hashing to keep
   per-tenant SQLite warm. The gateway benefits from being completely
   stateless — any replica answers any request. Forcing both into the
   same process forces one or the other into a suboptimal scaling
   policy.

The Open Questions section of HIP-0106 (item 2: "one OOM kills every
subsystem") foreshadowed this split. HIP-0110 resolves it.

## Architecture

```
                             ┌───────────────────────┐
                             │  ingress              │
                             │  (hanzoai/ingress)    │
                             │  - TLS terminates here│
                             │  - host routing       │
                             └──────────┬────────────┘
                                        │  HTTP/1.1, HTTP/2, HTTP/3
                                        │  (re-TLS to gateway over
                                        │   internal mTLS if needed)
                                        ▼
                             ┌───────────────────────┐
                             │  gateway              │  ← stateless,
                             │  (cmd/gateway)        │    horizontally
                             │  - JSON parse/encode  │    scales by
                             │  - JWT verify         │    replica count
                             │  - mint X-* headers   │
                             │  - ratelimit / CORS   │
                             │  - request-id         │
                             └──────────┬────────────┘
                                        │  ZAP frames
                                        │  (luxfi/zap)
                                        │  port 9090 → cloud
                                        │  port 9091 → base
                                        ▼
                  ┌─────────────────────┴─────────────────────┐
                  │                                           │
                  ▼                                           ▼
        ┌───────────────────┐                       ┌───────────────────┐
        │  cloud            │                       │  base             │
        │  (HIP-0106)       │                       │  (HIP-0302)       │
        │  - iam, kms, etc. │                       │  - per-tenant DB  │
        │  - ZAP server     │                       │  - ZAP server     │
        │    :9090          │                       │    :9091          │
        └───────────────────┘                       └─────────┬─────────┘
                                                              │
                                                              │  reverse push
                                                              │  (subscription
                                                              │   updates, auth
                                                              │   callbacks)
                                                              ▼
                                                    ┌───────────────────┐
                                                    │  gateway          │
                                                    │  (same process)   │
                                                    │  translates ZAP   │
                                                    │  Push → SSE/WS    │
                                                    │  frame to client  │
                                                    └───────────────────┘
```

External clients see HTTP+JSON. Internal hops are ZAP. Reverse push
travels base → gateway → client without re-marshaling JSON.

## Specification

### Process model

The gateway is a single Go binary at `cmd/gateway/main.go`. It
exposes:

| Listener | Default port | Protocol | Purpose |
|---|---:|---|---|
| Public | `:8080` | HTTP/JSON | Client-facing API. Ingress proxies here. |
| Health | `:8081` | HTTP | k8s `livenessProbe` and `readinessProbe`. |
| Metrics | `:8081` | HTTP | Prometheus scrape at `/metrics` on the health listener. |

The gateway holds no in-process state per tenant. The only mutable
state on a replica is:

- The JWKS cache (TTL'd, refreshed from IAM).
- The set of open client connections (SSE / WebSocket) that are
  subscribed to base push frames.
- The luxfi/zap connection pool to cloud and base.

Replica restart is safe at any time. Active client connections drop
and the client SDK reconnects. No coordinated drain.

Per-replica memory:

| Workload | RAM |
|---|---:|
| Idle, 0 conns | < 64 MiB |
| 10 000 concurrent conns, mixed REST+SSE | < 200 MiB |
| 50 000 concurrent conns, mixed | < 600 MiB |

These targets follow from fasthttp's per-conn buffer pool, the
`luxfi/zap` Conn allocation profile, and the JWKS cache sized at
`(claims size × number of distinct kid)` bytes. There is no per-tenant
storage to amortize, so the gateway scales linearly with conn count.

### Wire protocol

The boundary contract is one of three:

1. **Client ↔ gateway** — JSON over HTTP/1.1, HTTP/2, HTTP/3, or
   WebSocket. This is the only JSON in the path.

2. **Gateway ↔ cloud** — ZAP over TCP on `CLOUD_ZAP_ADDR` (default
   `cloud:9090`). The forward envelope carries the validated identity,
   the request method/path/headers/body, and the connection ID for any
   future reverse push. See `gateway/zap_wire.go` for the schema.

3. **Gateway ↔ base** — ZAP over TCP on `BASE_ZAP_ADDR` (default
   `base:9091`). Forward requests use the same envelope as above;
   reverse Push frames from base (subscription updates, async auth
   callbacks, real-time record changes) carry a `connId` that the
   gateway looks up in its local connection table and forwards as
   SSE / WebSocket frames to the originating client.

Inside `cloud` and `base`, ZAP frames are decoded once and dispatched
to the per-subsystem `Mount` chain as native typed values. JSON
marshal/unmarshal happens at most once per request, at the gateway
edge.

#### Forward envelope

The gateway-to-backend envelope carries everything the backend needs
to serve the request:

```
TenantID    text   // X-Org-Id, JWT 'owner' claim
UserID      text   // X-User-Id, JWT 'sub' claim
IsAdmin     bool   // X-User-IsAdmin, JWT 'isAdmin' claim
Permissions int64  // X-User-Permissions, bit.Field from JWT
Method      text   // HTTP method (GET, POST, ...)
Path        text   // request path (e.g. /v1/iam/users/123)
Headers     bytes  // serialized header map, gateway-canonicalized
Body        bytes  // raw client body (forwarded verbatim)
ConnID      text   // gateway-assigned conn id for reverse push
```

The backend reply is symmetrical:

```
Status  uint32  // HTTP status
Headers bytes   // serialized header map
Body    bytes   // response body
```

#### Reverse push envelope

For server-initiated pushes (base subscriptions, IAM auth callbacks):

```
ConnID   text  // identifies the gateway-held client connection
Frame    bytes // already-encoded SSE event or WebSocket frame payload
Encoding text  // "sse" | "ws-text" | "ws-binary"
```

Base sends this envelope on its ZAP socket; the gateway routes it to
the in-flight conn matching `ConnID`. Unknown `ConnID` (client gone)
is silently dropped — base will eventually time out the subscription.

### Header contract

The gateway is the **sole minter** of the identity-header set
specified in HIP-0026:

| Header              | Source claim         | Type                                 |
|---------------------|----------------------|--------------------------------------|
| `X-User-Id`         | `sub`                | string                               |
| `X-Org-Id`          | `owner`              | string (org slug)                    |
| `X-Roles`           | `roles`              | comma-joined role names              |
| `X-User-Email`      | `email`              | string                               |
| `X-Phone-Number`    | `phone_number`       | E.164                                |
| `X-User-IsAdmin`    | `isAdmin`            | `"true"` only when platform admin    |
| `X-User-Permissions`| `permissions`        | base-10 `int64` bit-field            |

On ingress the gateway unconditionally strips every header in its mint
set (the strip list ⊇ mint list contract enforced in
`StripIdentityHeaders` and tested in
`TestStripList_CoversAllMintedHeaders`). After JWT validation the
gateway re-mints from claims. Cloud subsystems consume these headers
through `zip.Ctx.Org()`, `zip.Ctx.User()`, etc. — see HIP-0106
"Subsystem boundaries" — and trust them unconditionally.

The cloud binary's HTTP listener is bound only to the internal ZAP
socket in production; the public HTTP listener is the gateway. A
spoofed `X-Org-Id` from an external client cannot reach a cloud
subsystem because external traffic never reaches cloud's HTTP path.
Cloud retains a stripped-down HTTP listener on an internal port for
k8s liveness probes (`/v1/<sub>/health`) and nothing else.

### Trust model

| Layer | Boundary | Trust |
|---|---|---|
| Client → ingress | Public TLS (LetsEncrypt or Cloudflare-origin cert) | Untrusted. |
| Ingress → gateway | Cluster-internal HTTPS (re-TLS) or plain HTTP | Authenticated by ingress; gateway treats it as untrusted and re-validates JWT. |
| Gateway → cloud, gateway → base | ZAP over TCP, plaintext within the cluster (cluster mTLS optional) | Trusted: only the gateway speaks here. Cloud/base trust gateway-minted headers verbatim. |
| Cloud subsystem ↔ cloud subsystem | In-process Go method calls through `cloud.Deps` | Trusted; same address space. |

The trust step that matters: **cloud's external listener is OFF in
production**. The HTTP entrypoint is the gateway. NetworkPolicy in
k8s pins this — cloud's `:9090` accepts ingress only from gateway
pods; cloud has no `:8080` Service exposed to the cluster's ingress
controller.

### Reverse push channel

Real-time push (subscription updates, auth-flow callbacks,
`hanzoai/base` collection change events) flows:

```
base subsystem
  │  fires a record change in plugins/zap handler
  ▼
base zap server (:9091)
  │  sends ZAP frame with the reverse-push envelope
  │  { ConnID: <gateway-conn-id>, Frame: <pre-encoded SSE/WS body>,
  │    Encoding: "sse" | "ws-text" | "ws-binary" }
  ▼
gateway zap client (one persistent conn to base)
  │  reads frame, looks up ConnID in local conn table
  ▼
gateway → client (SSE / WS write)
```

The `ConnID` is gateway-assigned at the moment the client subscribes
(e.g. `GET /v1/base/realtime`). The gateway records `(connID, conn)`
in an in-memory `sync.Map`, sends a `Subscribe` ZAP frame to base
carrying `connID` and the subscription parameters, and parks the
client connection on the stream. When base pushes, the gateway looks
up the conn and writes the pre-encoded frame.

Key properties:

- No JSON re-marshaling. Base produces the SSE/WS frame body itself;
  the gateway just writes bytes to the client socket.
- No state in cloud. Reverse push is a direct base ↔ gateway path;
  cloud is uninvolved.
- Stateless gateway replicas: if the gateway pod with the conn dies,
  the client SDK reconnects to whichever replica next opens a conn
  and re-issues the `Subscribe`. Base sees the new `connID` and
  redirects future events. Brief drop window is bounded by client
  reconnect, not by gateway state.

### Scaling math

| Knob | Effect |
|---|---|
| Increase `gateway` replicas | Linear throughput on conns/sec, JWT verifications/sec, requests/sec. |
| Increase `cloud` replicas | Linear throughput on backend RPS. Independent of gateway replica count. |
| Increase `base` replicas | Per-tenant SQLite affinity; affects reverse-push routing only when base shards reverse pushes. |

There is no shared in-memory cache between gateway replicas. JWKS is
fetched per-replica with TTL eviction (cheap; IAM JWKS endpoint is
cached behind the ingress's own static plugin). Rate limit state is
per-replica unless the operator wires a backend (Valkey via
`hanzoai/kv`) — and even then the rate limit is a cross-replica
counter, not a per-tenant state machine.

Horizontal Pod Autoscaler signal: CPU (JWT signature verification is
CPU-bound) and active connection count. No memory-based scaling
needed under the 600 MiB / 50k conns budget.

### Failure modes

| Failure | Effect | Recovery |
|---|---|---|
| Gateway replica crash | Active conns drop; client SDK reconnects. No cloud impact. | k8s restarts pod; load balancer picks a different replica. |
| Cloud crash | Gateway sees ZAP dial / call error, returns `502 Bad Gateway` to client with `X-Request-Id`. | Cloud pod restarts; gateway's ZAP client reconnects on next request. |
| Base crash | Same as cloud — `502` for base-bound paths; reverse-push subscriptions die and reconnect on client retry. | Base pod restarts; gateway reconnects ZAP and clients reissue subscriptions. |
| IAM JWKS unreachable | JWT validation fails for new requests; cached entries continue to validate until kid rotation. Gateway returns `503` after JWKS cache miss exhausts retry. | IAM recovers; gateway refreshes JWKS on next inbound request. |
| Network partition gateway ↔ cloud | All `:8080` requests 502 until partition heals. Health probe on `:8081` remains green (gateway process is alive). | Operator runs through standard k8s service troubleshooting. |

The gateway's ZAP client uses bounded exponential backoff (cap 1s,
max 5 retries within a single request budget). It does NOT retry
across requests — failed requests return immediately so the client
SDK gets a clean signal and decides its own retry policy. No retry
storms on the backend.

### Deployment

Gateway image: `ghcr.io/hanzoai/gateway:vX.Y.Z`, built from
`~/work/hanzo/gateway/cmd/gateway`. Build constraints:

- Static link. `CGO_ENABLED=0`. `linux/amd64` (`linux/arm64`
  re-enabled once DOKS ships arm64 droplets, per the cluster note in
  the hanzo CLAUDE.md).
- No embedded admin SPA. No embedded SQLite. No PostgreSQL driver.
  The gateway is exactly: zip + fasthttp + luxfi/zap + go-jose +
  luxfi/log + Go stdlib.
- No CGo deps. Image size target: < 20 MiB.

K8s `Service`:

```
spec:
  ports:
    - name: http        # client-facing API
      port: 8080
      targetPort: 8080
    - name: health      # liveness + metrics
      port: 8081
      targetPort: 8081
```

`Deployment` envelope:

```
env:
  - name: GATEWAY_LISTEN
    value: ":8080"
  - name: GATEWAY_HEALTH_LISTEN
    value: ":8081"
  - name: CLOUD_ZAP_ADDR
    value: "cloud.hanzo.svc.cluster.local:9090"
  - name: BASE_ZAP_ADDR
    value: "base.hanzo.svc.cluster.local:9091"
  - name: JWT_ISSUER
    value: "https://hanzo.id"
  - name: JWKS_URL
    value: "https://hanzo.id/.well-known/jwks"
  - name: AUTH_REQUIRE
    value: "true"
```

Liveness probe: `GET /healthz` on `:8081`. Readiness probe: same.
Metrics: Prometheus scrape at `:8081/metrics`. No `:8080` probes —
client traffic must not contend with k8s probe traffic.

### Migration plan

The current state is the HIP-0106 mount form: `gateway.Mount(*zip.App,
cloud.Deps) error` is registered in `cloud`'s init() chain. The
gateway binary at `cmd/gateway/main.go` is the legacy KrakenD entry
that has not yet been replaced. HIP-0110 ships the replacement and
phases out the mount form:

**Phase A — Side-by-side (this HIP, week 1):**

1. Ship `ghcr.io/hanzoai/gateway:v3.0.0` from the new
   `cmd/gateway/main.go`. Old KrakenD entry remains compilable
   behind `//go:build legacy` for safety net but is not the default
   `go build` target.
2. Cloud still has the `gateway.Mount` registration in its init() block.
3. Deploy gateway as a new k8s `Deployment` alongside cloud with its
   own `Service` `gateway.hanzo.svc.cluster.local`.

**Phase B — Flip ingress (week 2):**

4. Update `hanzoai/ingress` route `api.hanzo.ai` upstream from
   `cloud:8080` to `gateway:8080`.
5. Soak for one week. Cloud still accepts external HTTP on `:8080`
   as a fallback but the ingress no longer sends traffic there.

**Phase C — Lock cloud internal (week 3):**

6. Cloud's `:8080` listener is removed from the public k8s Service.
   Cloud retains only the internal ZAP listener on `:9090` and the
   `:8081` health/metrics listener. NetworkPolicy: `:9090` accepts
   ingress from gateway pods only.
7. Remove `gateway.Mount` from cloud's init() block. The gateway
   subsystem ceases to exist inside the cloud binary. The unified
   binary still mounts iam, base, kms, commerce, ai, o11y, vfs, mq,
   dns, amqp, mcp, authz — twelve subsystems instead of thirteen.

After Phase C the gateway is the unambiguous edge. Cloud is the
unambiguous backend. No subsystem mounts the gateway.

### Rejected alternatives

**Reverse push through cloud instead of direct base ↔ gateway.**
Considered: route base → cloud → gateway → client. Rejected because
cloud has no role in the push path (no data transformation, no
identity validation — the subscription was already authenticated at
subscribe-time), so adding a hop adds latency, doubles the ZAP
connection count, and creates a needless dependency between base
realtime and cloud availability. The gateway already maintains a ZAP
client to base for forward requests; reusing that conn for reverse
push is free.

**Sticky sessions on the gateway.** Considered for the realtime
push case so that the gateway pod holding the conn is the same one
base pushes to. Rejected because client SDK reconnect handles pod
loss anyway, and sticky sessions force the load balancer into a
stateful config. The reverse-push routing in base shards by `connID`,
and `connID` already encodes the gateway pod identity, so base
routes deterministically without needing the load balancer to.

**Embedding JSON v2 marshaling in cloud.** Considered: have cloud
do JSON itself so the gateway can be a pure proxy. Rejected because
this re-imposes the original problem — every cloud replica then has
to carry JSON parse code, and the trust boundary blurs (cloud
processing a raw client body cannot trust the body until JSON parses
cleanly). JSON-at-edge is load-bearing: parse failures, encoding
attacks, and content-type negotiation stay in the gateway where they
belong.

**ZAP over Unix domain socket within the same pod.** Considered as a
performance optimization for co-located gateway + cloud pods.
Rejected because the gateway is supposed to scale independently from
cloud; pinning them to the same pod re-introduces the OOM blast
radius from HIP-0106 Open Question #2. Cluster-internal TCP is fast
enough (RTT < 0.5ms within a DOKS node pool).

## Open questions

1. **WebSocket auth replay on reconnect.** When a client reconnects
   after a gateway pod restart, must it re-validate its JWT for the
   subscription state to re-attach? Current answer: yes. The
   subscription is bound to `(connID, JWT)` and gateways do not
   share state. The client SDK re-subscribes after reconnect.

2. **mTLS between gateway and cloud / base.** Defaulting to plaintext
   within the cluster relies on NetworkPolicy isolation. Operators
   running a hostile-tenant model (untrusted workloads in adjacent
   namespaces) should turn on cluster mTLS via the existing
   `hanzoai/ingress` PQ-TLS stack. Tracked separately from this HIP.

3. **OpenAPI generation.** The gateway's surface IS the public API
   surface. `zip.App.installOpenAPIRoutes()` generates OpenAPI from
   the gateway's typed routes. The cloud-side routes are no longer
   directly exposed, so the gateway's OpenAPI is the canonical
   public schema. Consolidating to a single `/openapi.json` served
   by the gateway is the follow-up.

4. **Rate limit backing store.** Per-replica counters are correct for
   abusive-client mitigation but not for billing-grade quota
   enforcement. The `hanzoai/kv` (Valkey) backing for the limiter
   already exists; turning it on per-tenant is a deployment-config
   choice, not a HIP-0110 spec point.

## References

- HIP-0026 — IAM Standard (the JWT and identity-header contract).
- HIP-0044 — API Gateway Standard (the public surface contract).
- HIP-0068 — Ingress Standard (TLS termination, host routing).
- HIP-0106 — Unified Hanzo Cloud Binary (the Mount contract that this
  HIP carves the gateway out of).
- `~/work/hanzo/zip` — the canonical Go web framework.
- `~/work/hanzo/zap` (Rust) and `github.com/luxfi/zap` (Go) — the
  binary transport.
- `~/work/hanzo/gateway/auth_middleware.go` — the existing JWT
  validator + header minter; moves to `gateway/middleware/auth.go` on
  branch `feat/own-auth-middleware`.
