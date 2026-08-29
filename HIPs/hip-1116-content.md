---
hip: 1116
title: Content — The Marketing Loop
author: Hanzo AI
type: Standards Track
category: Interface
capability: content
status: Final
created: 2026-08-20
requires: HIP-0026, HIP-0139
---

# HIP-1116: Content — The Marketing Loop

## Abstract

`/v1/content` is the marketing content loop: draft with the model and the
studio, move an item through one lifecycle, publish it to the brand's connected
channels, and read the queue board across doctypes. It is implemented in
`hanzoai/cloud` `apps/content` as a stateless orchestrator: the framework
module `marketing` holds the documents, this capability adds only what a
generic document engine cannot be — the state machine, the generation edge, the
distribution edge (`apps/content/content.go:21-41`).

## Motivation

CRUD, tenancy, permissions and install are the framework's generic surface;
duplicating them here would be a second document engine to keep honest. What
the generic engine cannot know is that a marketing item has exactly one legal
lifecycle, that a draft can be generated, and that "published" means external
side effects happened — those three are this capability.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 It owns no store

Documents live in the framework module `marketing`; this subsystem opens no
store of its own (`apps/content/content.go:40-41`). Its state is the swappable
edges — generator, distributor, storefront (`apps/content/content.go:47-52`).

### §2 The lifecycle is enforced at the storage boundary

For every publishable doctype, `before_save` hooks enforce two rules no matter
who writes — the `/v1/content` endpoints, a raw framework PUT, the console's
generic renderer, or an automations flow step
(`apps/content/hooks.go:13-26`):

1. status-edge legality — the one state machine in `lifecycle.go`;
2. server-owned fields (`external_ids`, `published_at`) may only be written by
   a trusted in-process op, never by a client.

Both are pure gates: a refused write is 422, and distribution stays in the
orchestrator, never in the engine.

### §3 The addresses, and the one implementation

`GET /v1/content/lifecycle`, `GET /v1/content/board`,
`GET /v1/content/channels`, `POST /v1/content/generate`,
`POST /v1/content/publish`, and
`POST /v1/content/{doctype}/{name}/transition` — all typed
(`apps/content/typed_wire_test.go`). Every exported op is called both by the
handler and by the automations connector, so a human console, a flow, an MCP
tool call and a headless bot drive the same single implementation
(`apps/content/content.go:36-39`). Publish is idempotent per channel and
answers `in_progress` having posted nothing when it loses the per-item lease to
a live publisher (`apps/content/zipdoc_gen.go:71`).

### §4 Tenancy and money

Every handler resolves its tenant through `principal.Org` (HIP-0026) and scopes
strictly to it (`apps/content/content.go:34-35`). The capability is metered
(`plugin/content/main.go:21`), and the meter is split on who can attribute the
work: text drafting rides the platform AI plane — identity travels on the
ChatRequest, so the one inference meter bills the tokens
(`apps/content/generate.go:27-31`) — while studio renders are GPU work the AI
plane never sees, so content is their sole meter: `Bill.Gate` before the render
(fail-closed 402) and the debit recorded after
(`apps/content/studio_render.go:121-123,172`). The metered-apps registry
carries `content` for exactly that render fee.

### §5 Events, telemetry, stage, upstreams

It publishes no events on the platform bus; a publish's external side effects
are posts to the org's own connected channels through the distributor edge. It
emits nothing to observability beyond the request span — inference telemetry
belongs to the AI plane that serves it. Its stage is `beta`: a vertical
application. It derives from no upstream; the document engine is our own
framework module.

## Rationale

Enforcing the lifecycle in `before_save` hooks rather than in the handlers is
the load-bearing choice: the framework surface is generic and open, so a rule
enforced only in this package's handlers is a rule any other writer skips. At
the storage boundary there is no other writer. The cost is that the hooks must
stay pure — side effects in a gate would fire on every writer too — which is
why distribution lives in the orchestrator.

## Security Considerations

The wrong implementation lets a client write `external_ids` or `published_at`
directly — forging the record that something was published, or aiming a
re-publish at someone else's external post ids. The server-owned-fields gate
exists for that. The render meter is the second exposure: GPU work billed to
nobody is free compute, so the gate runs before the render and fails closed on
a frozen or broke org. Tenancy rides the validated principal on every path,
including the connector-driven ones.

## References

- HIP-0026 — Identity and Access Management
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
