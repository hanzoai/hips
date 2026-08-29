---
hip: 1127
title: Gateway — Live Edge Policy
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: gateway
status: Final
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1127: Gateway — Live Edge Policy

## Abstract

`/v1/gateway` is live control of the policy the API applies to every incoming
request — CORS, rate limits, cache TTL, allowed methods — changed without a
redeploy. The gateway itself is plumbing: the trust boundary that validates the
IAM JWT, strips client-supplied identity and re-mints the org header, compiled
into the cloud binary rather than deployed as a network hop
(`apps/gateway/gateway.go:5-9`). Plumbing earns no prefix; what earns this one
is the thing a customer actually calls, the runtime config plane, implemented
in `hanzoai/cloud` at `apps/gateway`.

## Motivation

The edge knobs used to be baked into an image, so retuning a CORS allowlist or
a flood cap was a rebuild and a rollout — the slowest possible response to the
fastest-moving class of problem. The config plane serves GET/PUT over the same
store the edge middleware reads live (`apps/gateway/gateway.go:11-16`), so a
change is effective on the next request.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store is shared, not owned

The policy store is owned by the composition root (`deps.GatewayPolicy`) and
shared with the enforcement middleware; this subsystem opens nothing and closes
nothing (`apps/gateway/gateway.go:37-40`, `gateway.go:80-82`). One store, one
source of truth: the row an operator writes here is the row the edge evaluates,
with no propagation step to fail. Per-project rate scoping is deliberately not
here — it stays the commerce-configured domain of the scoped limiter.

### §2 The addresses

Three typed operations, the whole surface (`apps/gateway/gateway.go:104-110`,
`manifest/apps.go:365`): `GET /v1/gateway/config`, `PUT /v1/gateway/config`,
and `GET /v1/gateway/traffic`, which reports who is calling the org's API right
now.

### §3 Two scopes, and the one field that crosses them

Policy splits on whether a tenant exists at evaluation time
(`apps/gateway/gateway.go:18-35`):

1. **Platform policy** — CORS origins, the pre-auth per-IP cap and window —
   is evaluated before any tenant is known and MUST be writable only by a
   SuperAdmin. A PUT carrying any platform field routes to the platform row
   explicitly, so it lands correctly even when the SuperAdmin is org-switched.
2. **Per-org policy** — the authenticated rate ceiling, cache TTL and paths,
   the accepted-method allowlist — is a tenant's own self-service row. An org
   admin writes its own, with the org from the validated principal
   (`apps/gateway/gateway.go:122`, HIP-0026), never a raw header; a SuperAdmin
   MAY target any tenant by query.
3. **Mode** — the abuse gate's posture — lives on a tenant's row but is NOT
   self-service: a control's subject may not switch the control off, so
   writing it requires SuperAdmin whichever row it lands on. It is the one
   field whose scope and whose authority are different questions.

### §4 Money, events, telemetry

gateway is free, in those words (`plugin/gateway/main.go:21`, `cloud.Free`; not
in `spend.go:275`). It publishes no events on the bus, and emits nothing to
observability beyond the request span every route gets — the traffic operation
is a read of the edge's live counters, not an emission.

### §5 Stage

gateway is `ga`: the platform core's edge, part of the agentic OS.

### §6 Upstream

gateway derives from none. `hanzoai/gateway` is the Hanzo repository the trust
boundary lives in, and its own routing law — one routing source of truth,
cloud's mount table, never a second map — is why this capability is a config
plane and not a router (`apps/gateway/gateway.go:8-10`).

## Rationale

One shared store read live, rather than a config service the edge polls, means
there is no window in which the operator's view and the enforced policy
disagree — the alternative's failure mode is precisely the one an abuse
response cannot afford. Splitting authority by evaluation time, rather than by
field list alone, gives the rule a reason the next field can be tested against:
if no tenant exists when the knob is evaluated, no tenant may turn it.

## Security Considerations

This surface configures the defenses, so the wrong implementation disarms
them. The three failure shapes are each closed by a scope rule: a tenant
widening platform CORS or the pre-auth flood cap (platform fields are
SuperAdmin-only), a tenant raising another tenant's ceiling (the org comes
from the validated principal, and cross-org targeting requires SuperAdmin),
and an abuser switching off their own abuse gate (mode requires SuperAdmin on
any row). The store being deps-owned also means a compromised subsystem cannot
substitute a second policy source — there is nothing here to swap.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
