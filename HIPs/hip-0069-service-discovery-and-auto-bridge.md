---
hip: 0069
title: Service Discovery & Auto-Bridge
type: Standards Track
category: Infrastructure
status: Draft
author: Hanzo AI
created: 2026-05-08
requires: HIP-007 (ZAP), HIP-0010 (MCP Integration), HIP-0068 (Ingress)
---

## Abstract

Every Hanzo-domain service on the local network advertises itself via
multicast DNS (RFC 6762) under one canonical service type. `hanzo-mcp`
auto-discovers neighbours, fetches their tool manifests, and exposes
each as a namespaced tool family on its own MCP surface. New service
joining the LAN → its tools light up in Claude automatically. Service
leaves → tools drop on the next refresh.

This HIP closes the gap between HIP-007 (ZAP transport), HIP-0010 (MCP
integration) and HIP-0068 (Ingress), removing every hard-coded URL,
port range, lockfile registry and service-name env-var from the Hanzo
stack.

## Motivation

Pre-HIP-0069 the system used three distinct mechanisms to find services:

1. Hard-coded ports — `[9999..9995]` for ZAP, `9224` for the legacy
   browser bridge, `:80` / `:443` for ingress.
2. Lockfile registry — `~/.hanzo/extension/config.json` for the
   browser-extension ↔ MCP pairing.
3. Environment variables — `HANZO_KMS_URL`, `HANZO_IAM_URL`,
   `HANZO_BASE_URL`, … duplicated across every consumer.

All three break under at least one of:
- Multiple parallel agents competing for the same fixed port.
- A service moving to a different host on the LAN.
- Lockfile races (`finally`-clause cleanup deleting another
  connection's registration; see hanzo-tools-browser 0.5.0 fix).

The mDNS path is collision-free, host-agnostic, and standard.

## Specification

### Service type

```
_hanzo._tcp.local.
```

ONE type for the entire mesh. Roles differentiate via TXT, not by
service-type. A consumer that wants e.g. only `role=kms` browses once
and filters.

### TXT record

| key            | required | example                                |
|----------------|----------|----------------------------------------|
| `role`         | ✓        | `mcp` / `iam` / `kms` / `mpc` / `base` / `engine` / `browser` / `node` / `desktop` / `gateway` / `static` |
| `server_id`    | ✓        | `kms-laptop.local-12345`               |
| `org`          | default `hanzo` | `hanzo` / `lux` / `zoo` / `osage` / `liquidity` |
| `version`      | ✓        | `0.5.1`                                |
| `proto`        | ✓        | `zap/1` / `http/1.1` / `grpc/1`        |
| `capabilities` | ✓        | `sign,verify,encrypt`                  |
| `agent_label`  |          | `kms-prod`                             |
| `auth`         | default `none` | `none` / `iam` / `mtls`           |

### Per-role contracts

Each role MUST accept the listed methods over its declared `proto`.

#### `role=mcp`
- `tools/list`, `tools/call`, `prompts/list`, `prompts/get`,
  `resources/list`, `resources/read`

#### `role=iam`  (Hanzo IAM — Casdoor-derived)
- `iam.login`, `iam.token.exchange`, `iam.user.get`, `iam.user.list`,
  `iam.session.refresh`, `iam.session.revoke`
- HTTP equivalents under `/v1/iam/*`

#### `role=kms`  (key store + sign)
- `kms.kv.get/put/list/delete`, `kms.sign`, `kms.verify`,
  `kms.encrypt`, `kms.decrypt`, `kms.key.generate/list/delete`
- `auth=iam` or `auth=mtls` REQUIRED

#### `role=mpc`  (threshold signing)
- `mpc.session.start/join/contribute/finalize/status`
- `capabilities` lists supported curves (`secp256k1,ed25519,bls12-381`)

#### `role=base`  (record store, IAM-native)
- `base.collection.list/get`, `base.record.list/get/create/update/delete`,
  `base.subscribe`

#### `role=engine`  (LLM serving)
- `engine.completion`, `engine.chat`, `engine.embed`,
  `engine.tokenize`, `engine.models.list`

#### `role=browser`  (extension or browser endpoint)
- CDP-flavoured: `Page.navigate`, `Runtime.evaluate`, `hanzo.listTabs`,
  `hanzo.screenshot`

#### `role=node`  (Hanzo Node)
- `node.status`, `node.peers.list`, `node.task.submit/status`

#### `role=desktop`  (Electron host)
- `desktop.window.list/focus`, `desktop.notify`, `desktop.shell.open`

#### `role=gateway`  (api.hanzo.ai-style ingress, see HIP-0068)
- `proto=http/1.1`; mDNS used only for LAN-local discovery.
  Routes follow the platform's `/v1/<role>/*` convention.

#### `role=static`  (CDN-style asset serving)
- `proto=http/1.1`; capabilities: `etag,range,gzip,brotli`

### `hanzo-mcp` auto-bridge

`hanzo-mcp` MUST:

1. On startup, after registering its built-in tools, browse
   `_hanzo._tcp.local.` for ≥ 2 s.
2. For every peer service whose role appears in the role enum (and
   whose `org` matches the local org or is unspecified), open a ZAP
   handshake, read the tool manifest from `MSG_HANDSHAKE_OK`, and
   register every tool under the namespace `{role}.{toolName}`
   (e.g. `iam.login`, `kms.sign`).
3. Re-poll every 30 s. Register new peers; deregister vanished peers.
4. NOT register tools from the local server (skip on `server_id` match).

For `role=mcp` peers, tools merge in unprefixed (deduplicated by name)
so multiple cooperating MCPs appear as one surface.

### Single source of truth

Every binding (Python, TypeScript, Go, Rust, Swift) MUST own:

- The constant `_hanzo._tcp.local.`
- The TXT key list above
- The role enum

…in ONE module per language. No hand-rolled mDNS records anywhere in
the tree.

| language     | package                                                     |
|--------------|-------------------------------------------------------------|
| Python       | `hanzo-zap-mdns`     (`pip install`)                        |
| TypeScript   | `@hanzo/zap-mdns`    (npm)                                  |
| Go           | `github.com/hanzoai/zap-mdns-go`                            |
| Rust         | `hanzo-zap-mdns`     (crates.io)                            |
| Swift        | `HanzoZapMDNS`       (SwiftPM)                              |

### Backwards compatibility

Through 2026-Q3 a service MAY also advertise `_hanzo-zap._tcp.local.`
(legacy ZAP-only sub-type). After 2026-Q4 the canonical
`_hanzo._tcp.local.` is the only required record.

The hard-coded port ranges and lockfile registries SHOULD be removed
once every consumer ships a binding update. The `[9999..9995]`
port-probe in `@hanzo/extension` MAY remain as a fallback for offline
hosts (no mDNS responder running).

## Reference implementation

- Python: `~/work/zap/mdns/` — `hanzo_zap_mdns` package, including
  `expand_mcp_with_neighbors` for the auto-bridge.
- Spec doc lives alongside the implementation at
  `~/work/zap/mdns/SPEC.md`.

## Security considerations

- mDNS announcements are visible to anyone on the same broadcast domain.
  Roles that handle secrets (`kms`, `iam`, `base`) MUST set `auth=iam`
  or `auth=mtls`; consumers MUST honour the auth field and refuse
  unauthenticated requests.
- TXT capability advertisements are NOT a substitute for capability
  negotiation; consumers MUST verify each call against the peer's
  actual auth-checked tool list.
- `org` SHOULD be honoured: an `org=lux` consumer SHOULD NOT auto-bridge
  `org=osage` services without explicit operator opt-in.

## Adoption order

1. Python: `hanzo-mcp`, `hanzo-tools-browser` ✓ (shipped)
2. TypeScript / Node: `hanzo-iam`, `hanzo-desktop`, `@hanzo/extension`
3. Go: `hanzo-kms`, `hanzo-base`, `hanzo-mpc`, `hanzo-ingress`,
   `hanzo-gateway`, `hanzo-static`
4. Rust: `hanzo-engine`, `hanzo-node`
5. Swift: future iOS / macOS native clients

Each adoption lands as a 5-line change in the service's startup path —
import the binding, call `publish(port, role, server_id, …)`. The
canonical example for each language ships in the binding repo's
`examples/` directory.
