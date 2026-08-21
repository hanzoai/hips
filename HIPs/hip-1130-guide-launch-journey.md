---
hip: 1130
title: Guide — The Launch Journey
author: Hanzo AI
type: Standards Track
category: Interface
capability: guide
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1130: Guide — The Launch Journey

## Abstract

`/v1/guide` is the Business AI Guide: an interactive launch checklist every org
completes on-site — a checklist engine over a machine-readable curriculum, a
Business AI agent that can execute a step through the caller's own tool plane,
and a versioned brand blueprint the whole journey is projected from. It is
implemented in `hanzoai/cloud` at `apps/guide` (HIP-0106).

## Motivation

Onboarding advice that lives in prose goes stale and cannot be acted on. A
journey that is data — steps with dependencies, done-criteria mapped to real
signals, tools bound to steps — can be auto-marked when the org has demonstrably
done the work, and executed by an agent when the org asks. The three concerns
are kept orthogonal on purpose: the engine is pure functions over plain data,
the agent acts only through the caller's own authority, and the blueprint is
content a SuperAdmin authors live (`apps/guide/curriculum.go:6-31`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 Two stores, two tiers

Per-org progress and the org's own curriculum override live in that org's own
database, opened through `cloud.OrgStore` — one file per org, resolved through
the one namespace door (`apps/guide/guide.go:47-63`). The shared brand blueprint
is a second, deployment-wide store (`apps/guide/blueprint_store.go:45`), seeded
idempotently from embedded fixtures — the base journey plus one YAML file per
brand (`apps/guide/brands.go`) — after which the database is authoritative and
the fixture is only the fail-safe fallback. A redeploy MUST NOT clobber a live
edit; seeding is if-absent (`apps/guide/guide.go:78-88`).

### §2 The address

Nineteen operations under `/v1/guide`. All are typed except six, each declared
with prose beside its route (`apps/guide/guide.go:262-360`) because its body has
no declarable shape: the curriculum and blueprint writes accept YAML **or** JSON
as a raw body (the canonical parsed form is what is stored); the blueprint PATCH
is a shallow merge whose keys are the patched item's, not the route's; and
`steps/{id}/do` answers either JSON or a Server-Sent-Event stream of the agent's
actions. Every declared description renders only while the router serves the
route, so the prose can never invent a path.

A step transition is dependency-gated: a blocked start or done is 409 carrying
`blockedBy` naming the exact steps in the way. A write that does not parse or
does not validate (unique ids, acyclic dependencies) is 422 and the journey in
force is untouched.

### §3 Tenancy, and the gate that differs by tier

The tenant is `principal.Org` — the org minted from the validated bearer
(HIP-0026), never a header (`apps/guide/guide.go:382-385`). The per-org
curriculum override is any validated member's surface. The brand blueprint is
platform content: authoring it requires SuperAdmin (`apps/guide/admin.go:39`),
a per-org admin is 403, and every write is audited and versioned with the prior
versions kept as a recovery trail.

### §4 Money

Guide is free (`cloud.Free`, `plugin/guide/main.go`). The one executing path —
"do it for me" — runs the step's tool through the calling principal's own MCP
plane (`automations.InvokeTool`), so the work is metered and audited by the
plane that owns it, against the caller's ledger (`apps/guide/agent.go:61`).
Guide itself debits nothing and MUST NOT acquire an authority the caller does
not hold.

### §5 Events and observability

It publishes nothing on the bus. It emits nothing beyond the request span every
route gets; the audit trail for blueprint authoring is the shared audit plane,
not a telemetry stream.

### §6 Stage

`beta`: a vertical application — a guided launch product over the core planes,
not one of them.

### §7 Upstream

It derives from none. The curriculum fixtures are embedded YAML authored here;
the growth signals are injected read seams bound at the composition root, so
guide imports none of the subsystems it observes (`apps/guide/signals.go`).

## Rationale

The alternative to a data blueprint is a hard-coded journey, which makes every
white-label brand and every content edit a code change. The alternative to
executing through the caller's own tool plane is a service identity that acts
for orgs — which is an escalation surface, and the reason the agent runs AS the
caller instead.

## Security Considerations

The two tiers are the exposure. If the per-org gate could reach the shared
blueprint, one tenant would edit every org's journey — including which MCP tools
the Business AI runs for a step, which is a lever over agents in every org; the
SuperAdmin gate and the audit trail on that tier exist for exactly this. On the
executing path, the wrong implementation runs tools under an authority wider
than the caller's; here the invocation is per-principal, so a step can never do
what its asker could not.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
