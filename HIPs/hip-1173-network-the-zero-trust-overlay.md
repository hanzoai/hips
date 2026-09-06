---
hip: 1173
title: Network — An Org-Scoped Overlay
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: network
status: Final
implementation-go: shipped
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1173: Network — An Org-Scoped Overlay

## Abstract

`/v1/network` is the tenant's Hanzo Zero Trust footprint: the overlay, its
routers and its mesh services, org-scoped, off the unified cloud binary. It fronts the Hanzo
Zero Trust controller (`hanzoai/zt`, an OpenZiti-based fabric) and translates it
into the shape a tenant reads. It is implemented in `hanzoai/cloud` at
`apps/network` (HIP-0106).

## Motivation

A private fabric is only useful if its operator can see it. Everything the
controller knows — which routers are online, which services are dialable, where
they are — is admin data behind a service credential, and a tenant holds no such
credential and must never be handed one. The one thing a tenant may have is
their own slice of it, selected server-side and read-only. That is what this
capability is: a filter with an address, and no second control plane.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 It owns no store

Every row is the controller's. Nothing here is written and nothing is cached
across requests except the management session token, which is held only until
its expiry and re-minted transparently.

The overlay network is not even a stored object anywhere. An org has at most
one, and it is projected from the edge-routers carrying that org's role
attribute: its id is derived from the org, its node count is the real router
count, and its status is `connected` once at least one router has dialled home
and `provisioning` while none has. An org with no routers has no network, and
the answer is an empty list. A fabricated network would be worse than no
network, because a tenant would build on it.

### §2 The boundary: east–west, not the edge

Three capabilities touch a packet and only one of them is this.

- **ingress** (HIP-1133) is the edge: TLS and hostname routing for traffic
  arriving from the public internet.
- **gateway** (HIP-1127) is the policy applied to a request that has already
  arrived: CORS, rate ceiling, cache TTL, allowed methods.
- **network** is neither. It is the private fabric between the things a tenant
  runs, where a service is reachable because an identity was granted it and not
  because a name resolves. Nothing it lists has a public address at all.

**share** (HIP-1152) is the useful contrast: it gives one local service a public
URL. network gives a set of services no public URL, and reachability is the
grant.

Within the fabric, enrolment, policy and identity remain the controller's own
surface. This capability reads; it does not admit. A surface that could enrol an
identity would be a second control plane over one fabric, which is the shape
HIP-0139 §7 refuses.

### §3 The addresses

One prefix, and every operation on it is typed: `GET /v1/network`,
`GET /v1/network/routers`, `GET /v1/network/{id}` and
`GET /v1/network/services`. No route here is declared with prose, because every
answer is a value.

It was two — `/v1/network` and `/v1/mesh` — and both were lines in the misfiled
ratchet (HIP-0139 §5.1). They closed together by fold (HIP-0139 §7.1), which §1
permits because there is no store to split along: a mesh service is an edge
service OF the overlay exactly as an edge-router is one of its nodes.

The routers hang off the network they belong to and MUST stay there. An
edge-router is a node of an overlay, so it is addressed as one at
`/v1/network/routers` and is never a top-level noun. `routers` is a literal
beside `{id}` on one subtree; the router registers first by convention, and this
router resolves the static segment over its parameter sibling in either order,
so nothing has to be frozen to keep the address reachable.

### §4 Tenancy

The tenant is the org from the validated IAM owner claim (HIP-0026), resolved by
`principal.Acting` so a SuperAdmin acting for another org reads that org and no
one reads by asking. It selects the `org-<org>` role attribute; the client lists
the controller's resources and this capability filters to that role.

The org is never a parameter. There is no query on this surface in which an org
appears, so there is no query that can be written with somebody else's. A
service or router tagged for another org, or tagged for none, is invisible.

The single network's id is derived from the org, so `GET /v1/network/{id}` for
any other id is 404 — including one that exists for another tenant. An
id-guessing loop learns nothing it did not already know.

### §5 Fail closed to write, honest to read

The credential to the controller (`ZT_CLIENT_ID` / `ZT_CLIENT_SECRET`,
KMS-injected) may be absent on a deployment. The full route space still mounts
and one gate answers 503 before any handler touches the controller. The
customer-facing body names no internal configuration; what is missing is
recorded in the mount's own log, for the operator who can act on it.

The two projections of the router inventory — `/v1/network` and
`/v1/network/routers` — degrade instead: an unconfigured deployment and an
unreachable controller both answer 200 with an empty list, and the failure is a
log line. This is deliberate and it is bounded to those two reads, because the
network they project does not exist until a router is on it, so "none yet" is
the same true statement either way.

`/v1/network/services` MUST NOT degrade. A configured service exists whether or not
the controller can be reached, so an empty list there would assert something
false: that the tenant has no services. It answers 503 when unconfigured and
surfaces the upstream's status when unreachable.

### §6 Money

Free (`plugin/network/main.go`, `cloud.Free`). Reading your own fabric is not a
metered act, and there is no unit here to meter — the capability provisions
nothing.

### §7 Observability

It publishes nothing on the bus: no `network.*` event reaches a customer's
webhooks.
Beyond the request span every route already gets, it emits structured log lines
only: the mount posture, including whether the credential is present, and a
warning when a read degraded under §5.

### §8 Stage

`ga`. The manifest row declares no stage, and absent is `ga` (HIP-0139 §8).

### §9 Upstream

The capability derives from no upstream code. It embeds no generated client: it
speaks the OpenZiti Edge Management REST API (`/edge/management/v1`) as a thin
`net/http` client. Password authentication returns a session token carried in
the `zt-session` header; success is `{data, meta}` with pagination in the meta,
failure is `{error: {code, message}}` at a non-2xx.

The controller it fronts is `hanzoai/zt`, Apache-2.0, which derives from
OpenZiti (`openziti/ziti`, NetFoundry) with that Apache-2.0 notice preserved in
its own NOTICE. What survives in HEAD there is the fabric; what survives here is
the wire.

## Rationale

The alternative to a filtered read is handing the console a controller
credential, which makes every browser session an administrator of the whole
fabric. The alternative to projecting the network from its routers is storing a
network object, which then has to be kept true against a fabric that changes
without asking — and a stale network row is exactly the fabrication §1 refuses.

## Security Considerations

The wrong implementation shows one tenant another tenant's fabric, and a fabric
listing is a map: what a tenant runs, where it is reachable, and which of it is
up. The role attribute derived from the claim is the only filter, and a handler
cannot omit it, because it never receives an org it could substitute.

The management credential never appears in a customer-facing body; the 503 says
the deployment is not configured and nothing more. The controller fronts its own
CA, so `ZT_CA_PEM` pins its root when set and the system pool is used otherwise;
`ZT_INSECURE_SKIP_VERIFY` disables verification and exists for local
development, where there is no fabric to protect. Full verification is the
default.

An upstream is also an input. Every list is paged with a per-page size, a hard
page cap and a response-size cap, so a controller that answers pathologically —
or one that has been taken — can neither exhaust memory nor spin the process
forever.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1127 — Gateway — Live Edge Policy
- HIP-1133 — Ingress — The Embedded Edge
- HIP-1152 — Share — A Public URL for a Local Service

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
