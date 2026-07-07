---
hip: 0120
title: ZAP-Native Transport & gRPC Elimination
author: Hanzo AI
type: Standards Track
category: Core
status: Draft
created: 2026-07-07
requires: HIP-0106, HIP-0112, HIP-0114
---

# HIP-0120: ZAP-Native Transport & gRPC Elimination

## Abstract

Hanzo has exactly one inter-service transport: **ZAP**, the Hanzo-native
binary wire (`github.com/zap-proto/*`). This HIP makes the corollary a
platform-wide standard:

> **A Hanzo service speaks ZAP, HTTP, or WS. It never speaks gRPC.**

The three permitted protocols are complete for every wire Hanzo needs — ZAP
for inter-service and inter-VM traffic (HIP-0106, HIP-0114), HTTP for the
external request/response edge and HTTP-semantics-over-ZAP internally, and WS
for long-lived bidirectional client streams. gRPC is a fourth transport with
its own HTTP/2 framing, its own code-generated stub layer, and its own
mutable-message data model; admitting it would violate "one and only one way
to do everything" and drag `google.golang.org/grpc` — a large dependency and
attack surface — into the graph.

This HIP specifies: the rule and its RFC 2119 force; the three permitted
protocols; **OTLP-over-ZAP** (the shipped exemplar — OpenTelemetry spans ride
the ZAP wire to the o11y collector, standard OTLP protobuf payload, ZAP
transport, never OTLP-HTTP `:4318` or OTLP-gRPC `:4317`); the **pb2zap**
source-migration path; the design decision that there is **no transparent
runtime gRPC-over-ZAP shim**; and the **canonical conformance gate** — zero
first-party `google.golang.org/grpc` imports, enforced by grep over
`.go` source, not by `go.mod`.

The standard is already shipped across four repositories — `cloud`,
`gateway`, `visor`, `ai` — in four commits (see Reference Implementation).
First-party gRPC imports across all four are **zero**. What remains is
never-dialed transitive library code, honestly accounted for in
**Residual & Conformance**.

## Motivation

### One transport, not two

HIP-0106 fixed ZAP as the inter-subsystem contract of the unified `cloud`
binary: every subsystem ships a `.zap` schema, `zapc` generates the bindings,
and calls resolve to direct Go method dispatch when co-resident or ZAP RPC
when split. HIP-0114 fixed ZAP as the inter-VM cognitive transport for
Thinking Chains. Both rest on the same premise: **ZAP is the one Hanzo wire.**
A second RPC transport — gRPC — is not a convenience, it is a fork in the road,
and "if there are two ways to do something, one is wrong." gRPC is the wrong one:
Hanzo already has a native, versioned, schema-driven transport that spans
in-process, node-local, and cross-node hops with one set of generated types.

### ZAP is zero-copy; gRPC's message model is not

ZAP splits a message into three values with distinct lifetimes: an **Input**
(built once, write-only), a `[]byte` (the transport frame), and a **View**
(read many times, zero-copy over the frame's backing bytes). Protobuf/gRPC
collapses these into a single **mutable message struct** that is built, read,
and mutated in place. The mutable model forces allocation and copy at every
boundary and is precisely the model ZAP rejects. Bolting gRPC onto a ZAP stack
re-imports the cost ZAP was built to remove.

### The edge is JWT→ZAP; gRPC would need a parallel identity path

Per HIP-0112, external traffic terminates at `ingress → gateway`: TLS ends at
ingress, the gateway validates the IAM JWT, strips client-supplied identity
headers, and mints trusted ones. Every hop *after* the gateway rides ZAP with
the minted identity already attached. A gRPC service would need its own HTTP/2
metadata-based auth plumbing and its own interceptor chain kept in lockstep
with the gateway's header contract — a second identity path to drift out of
sync. One transport means one identity path.

### Supply-chain surface

`google.golang.org/grpc` pulls an HTTP/2 framing stack, connection/balancer
machinery, and the protoc-gen-go-grpc stub layer; the OpenTelemetry gRPC
exporters (`otlptracegrpc`, `otlpmetricgrpc`) and `otelgrpc` pull it further
into telemetry. Each import is transitive CVE exposure and dependency weight
for a wire Hanzo does not use. Eliminating first-party gRPC shrinks the graph
to what Hanzo actually dials.

## Specification

The keywords MUST, MUST NOT, SHALL, SHOULD, MAY are used per RFC 2119.

### 1. The rule

- A Hanzo service **MUST NOT** import `google.golang.org/grpc` (or a generated
  `*_grpc.pb.go` stub) in first-party source.
- A Hanzo service **MUST NOT** expose a gRPC server or dial a gRPC client for
  traffic between Hanzo services.
- A Hanzo service **MUST** carry inter-service and inter-VM traffic over ZAP,
  and **MAY** additionally terminate HTTP and WS at the external edge (§2).
- Where an external dependency is only reachable over a gRPC SDK, the service
  **MUST** prefer the provider's REST/HTTP surface and hand-roll a
  `net/http` client when a maintained REST client is unavailable (§Rationale;
  the `visor`/`ai` GCP compute adapters are the reference). This keeps the
  gRPC transport out of Hanzo's first-party graph.

### 2. The three permitted protocols

| Protocol | Where it applies | Canonical implementation |
|----------|------------------|--------------------------|
| **ZAP** | The one internal wire: inter-subsystem (HIP-0106), inter-VM (HIP-0114), service-to-service RPC. Native binary frames with an X-Wing PQ-KEM handshake; carries build-once `Input` → `[]byte` → read-many zero-copy `View`. | `github.com/zap-proto/go` (codec/runtime, v1.3.0), `github.com/zap-proto/zip` (web framework, v1.2.1), `github.com/zap-proto/http` (HTTP semantics over the ZAP wire, v0.2.0) |
| **HTTP** | The external request/response edge (JSON in/out, terminated by `ingress → gateway` per HIP-0112). Internally, HTTP *semantics* ride the ZAP wire via `zap-proto/http` — the same request/response shape, ZAP frames underneath. | `zap-proto/http`, `hanzoai/zip` handlers; stdlib `encoding/json`(/v2) at the edge |
| **WS** | Long-lived bidirectional client streams at the external edge; the ZAP-carried variant for internal streaming. | `zap-proto/ws`, `zap-proto/web` |

The rest of the ZAP family (`zap-proto/zapd` router, `zap-proto/zap-spec`) are
part of the same ecosystem. **Note the namespace:** the ZAP *transport and
framework* live under `github.com/zap-proto/*`; this is distinct from
`hanzoai/zap`, the Hanzo SQL/KV/Datastore sidecar, which keeps the `hanzoai`
namespace and is not a transport.

gRPC appears in none of these rows. There is no fourth row.

### 3. OTLP-over-ZAP (shipped exemplar)

Telemetry is the canonical demonstration that a protocol conventionally bound
to gRPC can ride ZAP with no semantic change. OpenTelemetry ships an
`otlptrace.Client` interface whose default wires are OTLP-over-gRPC (`:4317`)
and OTLP-over-HTTP (`:4318`). Hanzo implements a **third** client whose wire is
ZAP.

`cloud/zaptrace/zaptrace.go` is an `otlptrace.Client` (compile-time asserted:
`var _ otlptrace.Client = (*Client)(nil)`) whose transport is
`github.com/zap-proto/http`:

- **Payload is unchanged.** Spans are marshaled as standard OTLP protobuf. Only
  the transport differs — the collector receives a byte-identical
  `ExportTraceServiceRequest`.
- **Wire is ZAP.** `UploadTraces` builds a `fasthttp` `POST http://zap/v1/traces`
  with `Content-Type: application/x-protobuf` and sends it through a pooled
  `zaphttp.Transport`. The collector's ZAP receiver (`zapreceiver`) terminates
  the frame at **`:4319`** and writes to `hanzoai/datastore`. Spans travel
  OTLP-over-**ZAP** — **never** OTLP-HTTP `:4318`, **never** OTLP-gRPC `:4317`.
- **The envelope is hand-encoded to stay gRPC-free.** The request is a single
  `repeated ResourceSpans resource_spans = 1`, so `UploadTraces` appends each
  `ResourceSpans` under field 1 with `protowire` directly from the grpc-free
  `go.opentelemetry.io/proto/otlp/trace/v1` messages. This deliberately avoids
  the generated `collector/trace/v1.ExportTraceServiceRequest` type, whose
  sibling `trace_service_grpc.pb.go` (shipped with **no build tag**) would drag
  `google.golang.org/grpc` back into the module graph. The hand-encoding is
  byte-identical to the generated marshaler — proven by
  `zaptrace_test.go`, which stands up a real `zaphttp.Server` and decodes the
  received body with the canonical `collector/trace/v1` type.
- **Selection is by environment; no code branches per deploy.**
  `cloud/cmd/cloud/telemetry.go` installs exactly one tracer provider:
  - `OTEL_EXPORTER_ZAP_ENDPOINT` set (or unset with a ZAP default of
    `otel-collector.hanzo.svc:4319`) → spans ride ZAP.
  - Only a legacy `OTEL_EXPORTER_OTLP_*` endpoint set → spans ride OTLP-HTTP
    (the interop/loopback fallback used while the standalone collector is
    folded in). This fallback is HTTP, never gRPC.
- **Composition-root ownership.** After installing the ZAP provider, `cloud`
  unsets `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` / `OTEL_EXPORTER_OTLP_ENDPOINT`
  so an embedded subsystem (notably `hanzoai/ai`'s `object.InitTelemetry`)
  cannot install a second, competing OTLP provider that would strand later
  spans on `:4318`. Exactly one provider, one wire, deterministically.

Scope note (honest): **traces** ride ZAP today. A ZAP-native metrics/logs
exporter is roadmap (§Residual & Conformance); the OTLP metrics/logs exporters
are the current transitive-grpc source, never a dialed gRPC channel.

### 4. The pb2zap migration path

Porting a protobuf/gRPC call site to ZAP is a **source-level** transformation,
accelerated by `github.com/zap-proto/pb2zap` — a syntactic `go/ast` codemod
(a one-time migration tool, **not** a runtime bridge). For each construction
site it:

1. Rewrites protobuf construction `&x_pb.Req{F: v}` into the ZAP build-once
   form `xwire.NewReq(xwire.ReqInput{F: v})`.
2. Adds the generated `xwire` import and drops the now-unused `x_pb` import.
3. **Reports — never guesses —** the read and mutate selectors it cannot
   mechanically transform (a field *read* becomes a `View` accessor; an
   in-place *mutate* has no ZAP equivalent and must be restructured by hand).

pb2zap moves the mechanical 80%; the reported read/mutate sites are finished by
hand against the ZAP `View`/`Input` types. There is no automatic path for a
mutate-in-place site because ZAP has no mutable message (§Rationale).

### 5. Conformance gate

The **canonical, CI-enforceable gate** is: **zero first-party
`google.golang.org/grpc` imports.**

```sh
# MUST return no rows for a conforming repo:
grep -rl '"google.golang.org/grpc' --include='*.go' . | grep -v /vendor/
```

Verified empty for `cloud`, `gateway`, `visor`, and `ai`.

The gate is deliberately **not** `grep google.golang.org/grpc go.mod`. That
command is non-empty and **cannot** be driven to zero while Hanzo depends on
the upstream OpenTelemetry OTLP-HTTP exporter and the Gemini SDK, both of which
list gRPC as an indirect requirement they never dial (§Residual & Conformance).
A go.mod gate would be permanently red for reasons unrelated to whether any
Hanzo code speaks gRPC. The import gate measures the real invariant: **does
first-party Hanzo code dial or serve gRPC? No.**

## Rationale

### Why migration is a data-flow split, not a 1:1 rewrite

A protobuf message is one type that is **built, read, and mutated** in place.
ZAP deliberately has no such type. It splits that one role into three:

```
   *pb.Msg  (build + read + mutate, mutable, allocating)
                        │  pb2zap + hand finish
                        ▼
   Input  ──marshal──▶  []byte  ──▶  View
 (build once)        (transport)   (read many, zero-copy)
```

Because the split is by *data-flow role*, it cannot be performed purely
mechanically: pb2zap rewrites the build sites (`Input`) and the import graph,
and it **reports** the read sites (which become `View` accessors) and the
mutate sites (which have no ZAP analog and must be restructured). "Easy" would
be a blind textual swap; "simple" is separating the three roles the mutable
message had braided together.

### Why there is no transparent runtime gRPC-over-ZAP shim

A tempting shortcut is a drop-in `grpc.ClientConnInterface` implementation that
"keeps speaking protobuf" but sends bytes over ZAP — no source changes, gRPC
call sites untouched. This is rejected by design. Such a shim must accept and
return mutable `*pb.Msg` values, which **re-introduces the exact mutable-message
model ZAP exists to eliminate**: every call would allocate and copy a protobuf
struct at the boundary, defeating `Input`/`View` zero-copy, and the `grpc`
import (with its HTTP/2 stack) would remain first-party. A runtime shim would
make the go.mod gate pass while making the *real* invariant — no mutable-message
RPC, no grpc dependency — fail. Migration is therefore source-level (pb2zap +
hand-written ZAP handlers), not a runtime translation layer. Transport
elimination that leaves the data model intact is not elimination.

### Why hand-rolled REST for external gRPC-only SDKs

The GCP compute SDK (`cloud.google.com/go/compute/apiv1`, and the transport-
level `google.golang.org/api`) is gRPC-native. Rather than admit that gRPC into
the first-party graph, `visor` and `ai` replaced it with a plain `net/http`
client against `https://compute.googleapis.com/compute/v1`, authenticated by an
OAuth2 bearer token minted from the service-account JSON via
`golang.org/x/oauth2/google` (`JWTConfigFromJSON` → `TokenSource`, a pure-HTTP
token exchange), with Application Default Credentials fallback for in-cluster
workload identity. The provider's REST surface is complete for the adapter's
needs (`instances` GET list+get, POST `start`/`stop`), so no capability is lost
and no gRPC is dialed.

### Why the gate is import-level, not go.mod-level

The invariant Hanzo cares about is behavioral: no first-party code stands up or
dials a gRPC channel. An indirect `require google.golang.org/grpc // indirect`
that is never linked into a dial path is inert library code, not a gRPC
conversation. Gating on first-party imports measures the behavior; gating on
go.mod measures the transitive closure of upstream libraries Hanzo does not
control. The former is achievable and meaningful; the latter is neither.

## Backwards Compatibility

- **External clients are unaffected.** HTTP/JSON and WS at the edge are
  permitted and unchanged. No external caller is asked to speak ZAP; the
  gateway continues to terminate HTTP/WS and translate at the boundary.
- **No internal caller breaks.** Nothing in the Hanzo first-party graph speaks
  gRPC today (verified), so there is no inter-service gRPC contract to migrate
  and no call site to cut over.
- **OTLP interop is preserved.** The o11y collector still *exposes* standard
  OTLP receivers for third-party emitters that only speak OTLP; the ZAP
  receiver (`:4319`) is additive. Hanzo services simply do not *use* the OTLP
  gRPC/HTTP client paths for their own spans.
- **The gateway legacy (KrakenD) build is preserved.** Only its gRPC telemetry
  was removed — `krakend-otel` (OTLP-gRPC) and the `ocagent`/`stackdriver`
  OpenCensus gRPC exporters. Its remaining OpenCensus exporters
  (`prometheus`, `datadog`, `influxdb`, `xray`, `zipkin`) are retained; the
  default (`!legacy`) ZAP-relay build was already gRPC-free.

## Reference Implementation

Shipped across four repositories; first-party gRPC imports = zero in all four.

| Repo | Commit | Change | Key files |
|------|--------|--------|-----------|
| `cloud` | `a4a1eb8` | `zaptrace` ships OTLP over ZAP with no gRPC dep — `protowire` hand-encodes the `ExportTraceServiceRequest` envelope from grpc-free trace messages, avoiding the generated collector type whose `*_grpc.pb.go` sibling would pull `grpc`. `go list -deps ./zaptrace` is grpc-free. | `cloud/zaptrace/zaptrace.go`, `cloud/zaptrace/zaptrace_test.go`, `cloud/cmd/cloud/telemetry.go` |
| `gateway` | `4585583` | Drop `krakend-otel` OTLP (`otlptracegrpc`/`otlpmetricgrpc`) and the `ocagent` + `stackdriver` OpenCensus gRPC exporters; legacy telemetry rides OpenCensus (prometheus/datadog/influx/xray/zipkin) + ZAP. `go mod tidy` drops the three gRPC OTLP modules. | `gateway/executor.go`, `gateway/backend_factory.go` |
| `visor` | `db974c8` | Hand-rolled GCP compute REST client (`net/http` + `golang.org/x/oauth2/google`); drop `google.golang.org/api` gRPC SDK from the compute path. | `visor/service/gcp.go`, `visor/service/util.go` |
| `ai` | `f71162df` | Same hand-rolled GCP compute REST client for the `pkgmachine` adapter; drop `google.golang.org/api` from the compute path. | `ai/pkgmachine/gcp.go`, `ai/pkgmachine/util.go` |

The `cloud/zaptrace/zaptrace_test.go` round-trip is the load-bearing proof: a
real `zaphttp.Server` terminates the ZAP frame and the received body decodes
back to the canonical `collector/trace/v1.ExportTraceServiceRequest` — the
payload is standard OTLP; only the transport is ZAP.

## Security Considerations

### Reduced attack and dependency surface

Removing first-party gRPC removes the HTTP/2 framing stack, the balancer/
connection machinery, and the protoc-gen-go-grpc stub layer from the linked
first-party graph, along with the `otlptracegrpc`/`otlpmetricgrpc`/`otelgrpc`
and `ocagent`/`stackdriver` exporters. Fewer linked transports means fewer
parsers exposed to hostile bytes and fewer transitive CVEs in the dial path.

### No rogue outbound gRPC dial

Because the telemetry exporter is ZAP (with an HTTP fallback), an operator who
mis-sets an OTEL endpoint cannot cause a Hanzo daemon to open an outbound gRPC
channel — the exporter has no gRPC dial path to select. The composition-root
`OTEL_EXPORTER_OTLP_*` unset (§3) further guarantees a single tracer provider,
closing the split-provider hole that would otherwise strand spans on a second,
unmonitored wire.

### One authenticated wire, one identity path

ZAP carries an X-Wing PQ-KEM handshake at the transport layer, and the
post-gateway identity is the single set of minted headers (HIP-0112). A bolt-on
gRPC channel would introduce a parallel HTTP/2 metadata auth path to keep in
lockstep — a drift surface and a second place for an identity bug to hide.
Eliminating gRPC keeps authentication uniform and post-quantum by construction
on the internal wire.

### The gate is machine-checkable

The conformance gate is a grep over source, suitable for CI. A regression — a
new dependency that imports `google.golang.org/grpc` first-party, or a
"convenient" gRPC client added to a service — fails the gate deterministically,
where a human reviewer might miss it in a large diff.

## Residual & Conformance

**Enforceable gate: PASS.** First-party `google.golang.org/grpc` imports across
`cloud`, `gateway`, `visor`, `ai` = **zero** (verified by the §5 grep). No
Hanzo first-party code serves or dials gRPC.

**Residual go.mod grpc is never-dialed transitive/indirect,** and is *not* a
conformance signal. Per repo:

| Repo | `grpc` in go.mod | Source (never dialed by first-party code) |
|------|------------------|-------------------------------------------|
| `cloud` | `v1.81.1 // indirect` (+ `otelgrpc v0.67.0 // indirect`) | Embedded siblings: `hanzoai/ai`, `hanzoai/o11y` (SigNoz — intrinsically an OTLP/gRPC *collector*, so its gRPC is definitional to the receiver, not a Hanzo client dial), `hanzoai/base` (GCS gRPC transport). `zaptrace` itself is grpc-free. |
| `gateway` | `v1.80.0 // indirect` (+ `otelgrpc v0.67.0 // indirect`) | `krakend-pubsub`'s hardcoded `gocloud.dev/pubsub/gcppubsub` blank import (a GCP Pub/Sub driver Hanzo does not use), legacy build only. |
| `visor` | `v1.80.0 // indirect` | OTLP-HTTP telemetry exporter: `telemetry → otlpmetrichttp → internal/oconf → grpc`. HTTP transport; no channel dialed. |
| `ai` | `v1.81.1 // indirect` | OTLP-HTTP exporter (`object → otlptracehttp → internal/otlpconfig → grpc`) and the Gemini SDK `google.golang.org/genai` (a *direct* dep at `v1.10.0` whose HTTP backend transitively requires grpc). Neither dials a gRPC channel. |

**Gate blind spot, stated honestly.** The import grep catches direct first-party
gRPC use; it does **not** catch a first-party import of a *third-party* SDK that
internally dials gRPC to an **external** provider. The mandate governs Hanzo's
own inter-service wire — a third-party cloud provider's control-plane SDK is
interop, not a Hanzo transport. The governing rule: where a REST/HTTP surface
exists, the gRPC SDK MUST be replaced (done for GCP compute in `visor`/`ai`);
where none exists, the dependency is a documented exception that never targets a
Hanzo service. No such exception exists in-tree today (verified: `visor` carries
no external gRPC-dialing SDK).

**Path to literal-zero go.mod (future work).** Reaching an empty
`grep grpc go.mod` requires eliminating the *upstream* transitive pulls, none of
which is a Hanzo gRPC conversation:

1. **ZAP-native metrics/logs exporter.** Extend the `zaptrace` pattern
   (protowire hand-encode over `zap-proto/http`) to a metrics and logs
   exporter, retiring `otlpmetrichttp`/`otlptracehttp` — the OTLP-HTTP internal
   config that carries the indirect grpc in `visor` and `ai`.
2. **Raw-HTTP Gemini client (`ai`).** Replace `google.golang.org/genai` with a
   `net/http` client against the `generativelanguage` REST surface, removing the
   last direct dependency that transitively requires grpc.
3. **Embedded SigNoz/GCS (`cloud`).** The `o11y` collector is an OTLP/gRPC
   *receiver* by definition; its grpc is not a client dial and is out of scope
   for the client-side mandate. `hanzoai/base` GCS transport is a separate GCS-
   over-REST question tracked with the compute work.

Until then, the standard's conformance is measured where it is real and
enforceable: **zero first-party gRPC imports.**

## References

- [HIP-0106: Cloud — Unified Hanzo Binary](./hip-0106-unified-hanzo-cloud-binary.md) — ZAP as the inter-subsystem contract; the canonical Hanzo Go stack; the "no `.capnp` in Hanzo-authored source" policy.
- [HIP-0112: Cloud Topology](./hip-0112-cloud-infrastructure-topology-standard.md) — `ingress → gateway → services`; the external edge where HTTP/WS terminate and identity headers are minted.
- [HIP-0114: ZAP — Inter-VM Cognitive Transport for Thinking Chains](./hip-0114-zap-inter-vm-cognitive-transport.md) — ZAP as the inter-VM transport; "ZAP transports; proofs commit; receipts settle; VMs execute."
- `github.com/zap-proto/{go,zip,http,ws,web,zapd,zap-spec}` — the ZAP transport and framework ecosystem.
- `github.com/zap-proto/pb2zap` — the syntactic `go/ast` protobuf→ZAP migration codemod.
- OpenTelemetry OTLP specification — the span payload format ZAP carries unchanged (transport-substituted, not payload-modified).

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
