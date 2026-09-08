---
hip: 0300
title: Unified MCP — one endpoint, and local servers that forward to it
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Final
implementation-rust: partial
implementation-go: shipped
created: 2025-01-21
updated: 2026-08-20
requires: HIP-0010, HIP-0106, HIP-0111, HIP-0128
---

# HIP-0300: Unified MCP — one endpoint, and local servers that forward to it

## Abstract

Hanzo has one tool surface for models, and it is the cloud's: `POST /v1/mcp` on
the deployment's API host, projected from the same typed-op registry that yields
the REST routes and the OpenAPI document. Every local MCP server Hanzo ships —
`@hanzo/mcp` (TypeScript), `hanzo-mcp` (Python), `hanzo-mcp` (Rust) — carries
the tools that need the machine it runs on, and reaches the cloud by forwarding
`tools/list` and `tools/call` to that endpoint. Nothing about the cloud is written
down in a local server, in any language, ever again.

This document replaces the one deleted on 2026-07-28, which mandated a tool set
its own status section contradicted. Every number here was measured against the
named artifact on 2026-08-20; re-measure before quoting one.

## Motivation

Three things went wrong in the same direction, and all three are one mistake:

- The endpoint projected every typed operation as its own tool: 1,189 tools in
  977 KB, which no model holds and every client truncates (Slack keeps 128).
- The local servers each hand-rolled their own cloud tools against the REST
  API: 1,051 lines in TypeScript, 1,017 in Rust, a runtime-fetched OpenAPI
  catalogue in Python — three clients of one API, each at its own version of
  it, one of them still calling an `/api/` prefix the API has not served in months.
- A fourth approach was in flight: generate a per-language catalogue of 2,279
  flat tools from the document and ship it inside each package — a static copy
  of what the endpoint computes live and curates.

The mistake is a second description of the cloud's tool surface anywhere but
the cloud. The cloud already knows what it serves; a local server asks it.

## Specification

The key words MUST, MUST NOT, SHOULD and MAY are as in RFC 2119.

### §1 The endpoint

1. The endpoint is `POST /v1/mcp` on the deployment's API host (`api.hanzo.ai`,
   `api.lux.cloud`, …). It speaks JSON-RPC 2.0, one POST per message, stateless;
   protocol revision `2026-07-28`. The framework default `/mcp` answers 308 to it.
   The address is stated once (`manifest/door.Path`) and read by the host that
   serves it, the document that describes it and the console that refuses to
   answer it with HTML.
2. The endpoint MUST be described in the API document as an operation
   (`POST /v1/mcp`, with the JSON-RPC envelope as its bodies), so every
   projection of the document — SDKs, CLI, docs — names it.
3. `tools/list` MUST answer without a credential. It answers **one tool per
   subsystem** plus `describe`. A subsystem tool is named for the subsystem
   (`agents`, `billing`, `git`) and takes `{"op": <operation>, "input": {}}`,
   where `op` is an enum of the operations that subsystem publishes, spelled as
   verb phrases (`deploy_project`, not `post_v1_projects_by_slug_deploy`).
   `describe` takes `{"op"}` and returns that operation's input schema; it is
   listed first so a truncating client keeps it. Measured: 1,671 public paths
   project as 110 tools in 81 KB.
4. The tool surface IS the public contract. An operation is offered when it is
   typed (dispatchable by its subsystem, `x-tool`) AND public (`x-public` — every
   `/v1` operation except the operator's `admin` product, relay endpoints and legacy
   spellings). An operation whose name discloses a bearer secret at any verb, or
   mutates an identity or authority object, is withheld; `result._meta` carries
   the count and the rule (`hanzo.ai/refused`), and the subsystems that did not
   answer (`hanzo.ai/unavailable`). A shortened list MUST say so.
5. A subsystem tool whose every offered operation is a read carries
   `annotations.readOnlyHint: true`; one that mixes reads and writes carries no
   hint. `describe` is read-only.
6. `tools/call` takes the same bearer the REST API does. The endpoint validates
   nothing: the request is forwarded to the owning subsystem, whose identity
   boundary derives the principal and refuses on its own terms. A `tools/call`
   that reaches the public endpoint with no credential (no `Authorization`, no
   `X-Authorization`, no cookie) MUST be answered **HTTP 401** with
   `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource"`
   (RFC 9728 §5.1). The plane-side endpoint the fleet's own subsystems reach is never
   challenged: a sibling's identity is the headers the socket vouches for.
7. The host MUST serve `GET /.well-known/oauth-protected-resource` (and the
   `/v1/mcp`-suffixed form) naming the deployment's IAM issuer as the
   authorization server, so an MCP client can obtain a bearer through the
   standard OAuth flow against `hanzo.id` (HIP-0111). The resource is the origin
   the client reached.

### §2 Local servers

1. A local server ships the tools that need the machine: `fs`, `exec`, `git`,
   `code`, `fetch`, `workspace`, `ui`, and the optional `think`, `memory`,
   `plan`, `tasks`, `mode`. These need no account.
2. A local server MUST NOT implement a cloud operation itself, generate a
   catalogue of them, or describe them in any form. It reaches the cloud by
   forwarding:
   - the endpoint address is `HANZO_MCP_DOOR`, else `<HANZO_API_BASE or
     https://api.hanzo.ai>/v1/mcp`;
   - the bearer is `HANZO_API_KEY` (and the server's existing fallbacks), else
     `hanzo auth token`;
   - `tools/list` = the local tools, then the endpoint's tools whose names are not
     already local — **a local name wins** (`git` collides, and the local `git`
     is the one the machine has);
   - `tools/call` = a local tool by name, else the caller's call forwarded to the
     endpoint verbatim, the endpoint's `result` returned verbatim, `isError` included;
   - a 401 from the endpoint becomes an `isError` result telling the caller to sign
     in (`hanzo auth login`) and naming the resource metadata URL;
   - the endpoint's list is cached briefly (order of minutes) and an endpoint that does
     not answer costs one line on stderr and a local-only list — never a failed
     start. `hanzo-mcp` is spawned by `dev`; a hang is a dead agent.
3. A local server's own protocol revision is what it implements; it MUST NOT
   advertise the endpoint's.
4. The three servers are peers, not ports: each is native to its language and
   they share the contract above, not code. The `go/` REST shim that once mounted
   `/v1/mcp/tools/:name` is retired; the cloud's endpoint owns `/v1/mcp`.

First versions carrying this: `@hanzo/mcp` 2.4.8, `hanzo-mcp` (PyPI) 0.15.16,
`hanzo-mcp` (crates) 1.1.24.

### §3 Clients

An MCP client (Claude Code, Cursor, Claude Desktop, Codex, `dev`) connects in
one of two shapes, and both are one server name:

```jsonc
// the local server, which forwards — works for every client, stdio
{ "mcpServers": { "hanzo": { "command": "npx", "args": ["-y", "--package=@hanzo/mcp", "hanzo-mcp", "serve"] } } }

// the endpoint directly — for clients that speak streamable HTTP
{ "mcpServers": { "hanzo": { "type": "http", "url": "https://api.hanzo.ai/v1/mcp" } } }
```

`dev` ships `@hanzo/mcp` and launches the first; it MAY add the second.

### §4 Conformance

- `cloud`: `fleet/grouped_test.go` (one tool per subsystem, under the client
  cap), `fleet/challenge_test.go` (401 at the edge, never on the plane),
  `fleet/catalog_test.go` (the catalogue equals the documents),
  `cmd/cloud/oauth_test.go` (the metadata names the issuer),
  `openapi/public_test.go` (the endpoint is in the document and public),
  `e2e/mcp-door.sh` (zero wakes on list, one on call, no empty description).
- each local server: a test against a fake endpoint — list merge with local
  winning, call forwarded verbatim, 401 → sign-in error, endpoint down → local-only.
- the release: the `reach` car fails when any subsystem is in
  `_meta["hanzo.ai/unavailable"]`.

## Rationale

**One description.** The endpoint is a projection of the registry that already
describes every operation; a second description in a local server is the drift
this document's predecessor died of. Forwarding makes the local servers
correct by construction and current at the instant of the call.

**One tool per subsystem.** A model pays context for every tool it is shown. A
subsystem is the grain a person reasons at ("ask billing"), and `describe` makes
the enum usable without carrying every schema.

**Local wins.** The machine's own `git` is the one the user means when the
server runs beside a checkout; the cloud's is one `describe` away.

**Challenge, do not validate.** The endpoint stays a router: it knows absence, not
validity. Validity is the owning subsystem's, where the identity boundary
already is.

## Security Considerations

The endpoint offers the public contract and nothing beside it; the operator's
surface is neither an SDK method nor a tool a model is shown. Names that would
disclose a secret or mutate an identity are withheld before the routing table is
written, so a client that cached such a name gets the same answer as for a tool
that never existed. Bearers travel only in `Authorization`; a local server never
writes one to disk and never echoes one in a result.

## References

- HIP-0010 MCP Integration · HIP-0106 Plugin Contract · HIP-0111 IAM
  Authentication · HIP-0128 Resource Surface
- `hanzoai/cloud` `fleet/`, `manifest/door`, `cmd/cloud/oauth.go`,
  `openapi/mcp.go`, `openapi/public.go`
- `hanzoai/mcp` `src/door.ts`, `rust/src/door.rs`;
  `hanzoai/python-sdk` `pkg/hanzo-mcp/hanzo_mcp/door.py`
- RFC 9728 OAuth 2.0 Protected Resource Metadata
