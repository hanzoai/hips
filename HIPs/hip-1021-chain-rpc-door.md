---
hip: 1021
title: Chain JSON-RPC Endpoint
author: Hanzo AI
type: Standards Track
category: Interface
status: Final
created: 2026-08-20
requires: HIP-1020
---

# HIP-1021: Chain JSON-RPC Endpoint

## Abstract

`rpc` forwards a JSON-RPC 2.0 call to a chain the deployment has declared, and
returns that chain's answer unchanged. It is an endpoint onto an upstream the
operator holds, not a chain client: it interprets no method, rewrites no result,
and keeps no state. Implementation: `apps/web3` in `hanzoai/cloud`.

The single hardest thing about this capability is what it must NOT become — an
open relay onto somebody else's metered upstream — and most of what follows is
that boundary.

## Motivation

A browser holding a wallet needs to talk to a chain, and the deployment already
holds the upstream credential. Handing that credential to the browser is the
alternative, and it publishes a provider key to every visitor. So the call goes
through us, which means we own the two questions a proxy raises: who may call,
and which chains they may reach.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### 1. Only a declared chain, and only a validated principal

The chain MUST be one the registry declares (HIP-1020); an unknown id is refused
and never dialled elsewhere (`apps/web3/web3.go:174`). The caller MUST carry a
validated principal (`apps/web3/web3.go:167`). Without that second rule this is
an open relay anyone on the internet can point at the deployment's paid
upstream, which `TestUnauthenticatedReadsNothing`
(`apps/web3/web3_test.go:101`) exists to keep true.

### 2. The envelope is modelled, the payload is not

The request is typed as a JSON-RPC 2.0 call rather than forwarded as an opaque
body, so this capability is described like every other one. Two fields stay raw
because JSON-RPC defines them as method-specific and caller-chosen
(`apps/web3/web3.go:249`):

- `params` is passed through unread. The endpoint MUST NOT inspect, reorder or
  re-encode it.
- `id` is echoed back untouched, including on the failure path, because it is
  how a client correlates an answer with its call.

`method` is required, and `jsonrpc` — when present — MUST be `"2.0"`
(`apps/web3/web3.go:289`). Both are refused before the call becomes an upstream
round trip.

A JSON-RPC BATCH is not carried: the input is one call, so an array body is
refused at decode. Batching is a transport optimisation whose only beneficiary
is the upstream's connection count, and this endpoint already reuses one client
(`apps/web3/client.go:15`).

### 3. An upstream failure is a JSON-RPC error, at a success status

When the upstream cannot be reached, the answer is a JSON-RPC error object with
code `-32603` under HTTP 200 (`apps/web3/web3.go:298`), not an HTTP 5xx.

This is the one place the endpoint deliberately does not mirror the transport. Every
standard JSON-RPC client parses the error object; a transport-level failure
breaks those clients before they can read anything, so a 5xx here converts a
legible refusal into a stack trace in somebody's console. `message` distinguishes
the two cases a caller cares about — an error the chain returned is relayed as
the chain wrote it, while one we generated says the upstream was unavailable.

A JSON-RPC error from the chain is a valid answer and MUST be returned as such
(`apps/web3/client.go:30`). It is not a failure of this capability.

### 4. The upstream may not decide this process's cost

Every call is bounded, and the bounds belong here rather than to the upstream:

- ten seconds (`apps/web3/web3.go:375`) — a chain that has not answered by then
  is not going to, and the caller is holding a request open meanwhile;
- eight mebibytes of response (`apps/web3/client.go:25`) — an RPC answer is a
  number, a receipt or a block, and anything larger is a misconfigured upstream
  serving an error page;
- a non-2xx upstream status is a transport failure, not a body to parse
  (`apps/web3/client.go:57`).

### 5. The method set is the upstream's, and that is an operator obligation

This endpoint filters no method. An allowlist here would be a second, always-stale
copy of the chain's own method set, and every chain would need its own.

The consequence is normative and belongs to whoever writes the registry: a
declared upstream MUST expose only methods that are acceptable to EVERY
principal of that deployment. An upstream serving node-administration,
key-management or mempool-inspection namespaces MUST NOT be declared here.

## Rationale

The obvious alternative is an opaque byte proxy — take the body, forward it,
return whatever comes back. It is fewer lines and it costs the description: an
opaque body has no schema, so the capability publishes an address and nothing a
generated client can call. Modelling the envelope while leaving `params` and
`id` raw buys the schema without touching the payload, which is exactly the
part we have no right to interpret.

The alternative to the principal check is per-chain rate limiting, and it
answers a different question. A limit bounds how fast an anonymous caller can
spend the deployment's upstream budget; it does not stop them spending it.

## Security Considerations

**Relay abuse.** The upstream is metered and frequently credential-bearing. The
principal check is the whole boundary, and it runs before the chain is resolved
and before anything is dialled, so an anonymous call costs the deployment
nothing but the refusal.

**Method exposure.** §5 is a real hole if a registry names a node's
administrative endpoint: any validated principal of the deployment reaches every
method that node serves. The fix is the declaration, not a filter in this endpoint.

**Echoing `id`.** The id is returned as received, uninterpreted. It is raw JSON
chosen by the caller and reflected only to that caller, so it grants nothing —
but it MUST stay uninterpreted, because parsing it would make a caller-chosen
value into a value this endpoint acts on.

**No per-org data.** A chain is a public ledger, so this capability holds no
tenant rows and the boundary is presence of a principal rather than an org
scope. Nothing here may be widened into a cross-tenant read, because there is
nothing tenant-scoped to read.

## References

- HIP-1020 — Chain Registry
- HIP-1022 — Native Balance Reads

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
