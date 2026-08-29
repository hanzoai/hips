---
hip: 1213
title: Tools — The Tool Plane
author: Hanzo AI
type: Standards Track
category: Infrastructure
status: Final
created: 2026-08-20
requires: HIP-0139, HIP-0106, HIP-0300
capability: tools
---

# HIP-1213: Tools — The Tool Plane

## Abstract

`/v1/tools` is the one registry of everything an org can call: each entry is a
`Tool` with a `Source`, a JSON-Schema, a per-`(org, project)` activation state
and an optional price. Cloud's own typed operations are not here — they are
code, projected onto the fleet's MCP endpoint (HIP-0300); what lives here is rows
(`apps/tools/LLM.md:1-9`). It is implemented in `hanzoai/cloud` at `apps/tools`,
and this HIP states the surface under which its skills, plugins and
external-MCP-server views answer.

## Motivation

The plane's views grew their own roots — `/v1/skills`, `/v1/plugins`,
`/v1/mcp/servers` — and the last of these left the `/v1/mcp` root answered by
two apps, the host's MCP endpoint and this one's server collection. The store
decides all three (HIP-0139 §7): every row behind those roots is tools' own, so
each view folds home rather than splitting into an app that would share this
one's store.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### The surface

Every address is under `/v1/tools`: the registry reads and dispatch at the
root, then three views that are the same rows narrowed. `/v1/tools/skills` is
the registry narrowed to one source, not a second store
(`apps/tools/zipdoc_gen.go:70`), and skill activation is a tools row.
`/v1/tools/plugins` lists this deployment's mounted subsystems and the org's
authored plugins, and `POST /v1/tools/plugins/build` builds one
(`apps/tools/tools.go:43`); the build route is the plane's one untyped
operation, declared with its bodies and its prose because its 422 carries
diagnostics outside the declared success shape (`apps/tools/tools.go:44-71`).
`/v1/tools/mcp/servers` is the org's registered external MCP servers — the one
way an org gains a server, by `url` or by picked `listing`, both writing the
same row (`apps/tools/external_mcp.go`). Every other operation is typed.

Today's router serves the three views at `/v1/skills`, `/v1/plugins` and
`/v1/mcp/servers` (`manifest/apps.go:429`); each pair is a line in
`hanzoai/cloud` `openapi/misfiled.txt` until the fold lands, and the last fold
vacates `/v1/mcp` entirely to the host's MCP endpoint. The `skills` app keeps
only `/.well-known/agent-skills` discovery and the `plugins` app only
`/v1/admin/plugins`, both exempt by HIP-0139 §3.2.

### The store

The capability owns the `tools-*` system SQLite set — catalog, activation,
plugins, skills, mcp — each opened only by this package
(`apps/tools/catalog.go:171`, `activation.go:41`, `pluginstore.go:50`,
`skillstore.go:57`, `external_mcp.go:87`). Sources register their own
`Provider` from their own Mount (`apps/tools/registry.go:75`), so this package
never learns how another source lists or runs its tools; what it owns is the
rows and the endpoint.

### Tenancy

Every write and dispatch resolves the caller's org from the validated
principal; activation is keyed `(org, project)`, and an authored plugin is
stored under the authoring principal's org. External-server credentials live in
KMS under the org's custody, never in the row.

### Money

A tools-plane dispatch is metered per call: `CLOUD_TOOLS_FEE_CENTS` prices the
unit per deployment, zero making it free, attributed under kind `call`
(`apps/tools/tools.go:83-84`, `plugin/tools/main.go:22`). A marketplace-priced
call is offered — free ones included, so the gate and the settlement read one
table — to the x402 rail over the internal plane; what a call costs, who is
paid and whether a signature verifies stay entirely on the rail's side
(`apps/tools/charge_peer.go:16-33`).

### Events and observability

It publishes no events on the tenant bus, so a customer's webhooks receive
nothing from it. Beyond the request span, every dispatch appends an audit
record — actor, resource, auth context, outcome — through the shared recorder
(`apps/tools/http.go:704-715`).

### Stage

`ga`. The manifest row carries no stage field, which is `ga` by HIP-0139 §8.

### Upstreams

Two OSS libraries are embedded on the authored-plugin build path:
`evanw/esbuild` (MIT) bundles the source to one CommonJS program and
`dop251/goja` (MIT) is the runtime that compiles — and later executes — it
(`apps/tools/pluginbuild.go:24-26`). The catalog mirrors the public MCP
registry's listings (`registry.modelcontextprotocol.io`) as data, replaced
wholesale on sync with local curation held in columns the sync cannot touch
(`apps/tools/LLM.md:11-32`). Nothing else derives from an OSS upstream.

## Rationale

The tempting resolution was a split: a skills app for `/v1/skills`, this one
for the rest. But skill activation lives in `tools-activation`, so the split
puts two apps on one store — the defect HIP-0139 §7.2 refuses — and buys a
name for a view that is one `WHERE` clause. The store decides, and it decides
fold, three times.

## Security Considerations

A tool dispatch is credentialed execution on a caller's behalf, so the wrong
implementation hands one org's credentials or activations to another. The
guards: credentials are KMS refs read at run time, never fields of a plugin or
a row; source that contains something shaped like a key is refused rather than
scrubbed; and a plugin in the store is one this deployment has already
compiled and loaded once — the build pipeline is the gate, so a model's claim
that code is fine never substitutes for the runtime accepting it
(`apps/tools/tools.go:53-60`). Deregistering a server destroys its credential
material even though the KMS interface lacks delete: the ref is overwritten
empty, which is the half that matters for rotation
(`apps/tools/LLM.md:48-58`).

## References

- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-0300 — Unified MCP

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
