---
hip: 1144
title: Registry — The Artifact Control Plane
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: registry
status: Final
implementation-go: shipped
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1144: Registry — The Artifact Control Plane

## Abstract

`/v1/registry` is the management plane over the platform's two running artifact
registries — the OCI registry at `oci.hanzo.ai` and the npm registry at
`pkg.hanzo.ai`: list projects, images, tags and packages, and mint scoped pull
tokens. It is implemented in `hanzoai/cloud` at `apps/registry` and
reimplements neither registry: every op is a typed read of what those services
genuinely answer, plus one token mint through the same IAM realm the docker CLI
uses (`apps/registry/registry.go:8-16`).

## Motivation

The registries are shared platform deployments with their own wire protocols
and one platform credential. A tenant needs to answer "what do I store, and who
may pull it" through the unified `/v1` plane — with IAM identity, the org
boundary, and the document/SDK/MCP projections — without cloud becoming a
second registry or a byte relay.

## Specification

The key words MUST, MUST NOT and SHOULD are to be interpreted as in RFC 2119.

### The store, and there is none

This capability owns no store. The registries own all artifact data; the
subsystem holds only the parsed token challenge and a short-lived token cache,
in memory, pruned by expiry (`apps/registry/registry.go:127-142`).

### Control plane only

The OCI wire — manifests, blobs, push, pull — stays on `oci.hanzo.ai` and MUST
NOT be proxied here: a data path through the API host would double-move every
image byte and break the content-addressed client protocol
(`apps/registry/registry.go:18-23`). `/v1/registry` answers the questions
AROUND the wire and hands out the address of the wire itself.

### Addresses

Six operations under `/v1/registry`, all typed ops
(`apps/registry/registry.go:170-184`): `GET /status` (a live probe of both
halves), `GET /projects`, `GET /images`, `GET /tags`, `GET /packages`, and
`POST /token` — a short-lived, pull-only token for exactly one org-owned image,
its scope pinned server-side to `repository:<org>/<image>:pull`.

### Tenancy

The org is the validated principal's (`principal.Org`), NEVER an In field. The
registries are shared, so the boundary is enforced HERE on their own namespace
conventions: an org's images are the catalog entries under `<org>/…` and its
packages are `<org>` and `@<org>/…`. Filtering happens before any response
shape exists — foreign names are dropped, never serialized
(`apps/registry/registry.go:649-652`) — and the npm scope filter runs on the
results, so a caller's query cannot widen it. No validated principal is 403
before any upstream byte.

Every repository segment MUST match the OCI distribution path-component grammar
before it is folded into an upstream URL or a token scope
(`apps/registry/registry.go:107-125`), so a hostile value can never smuggle
path or scope structure into the wire.

### Money, events, telemetry

Free, said in those words: `plugin/registry/main.go` declares `cloud.Free`. It
publishes nothing to the bus, so a customer's webhooks receive nothing from it.
It emits nothing beyond the request span every route gets.

### Failure posture

The platform catalog credential (`REGISTRY_CLIENT_ID`/`REGISTRY_CLIENT_SECRET`,
an IAM application's service credential, KMS-synced) rides only as Basic auth
to the token realm the registry's own 401 challenge advertises. An upstream
that refuses it MUST surface 503 — a deployment fault, never a caller-auth bug
— and an unreachable upstream is 503 (`apps/registry/registry.go:36-39`).

### Stage

`ga`: the registries are developer-tools core of the self-service cloud, and
the manifest row (`manifest/apps.go:421`) declares no stage.

### Upstream

The registries this plane manages are forks the platform runs, not code this
package embeds: `hanzoai/registry` is CNCF Distribution (Apache-2.0), S3-backed
with Hanzo IAM token auth, and `hanzoai/pkg` is Verdaccio (MIT) on S3. The app
imports neither — it speaks the OCI distribution HTTP API (including its token
challenge and RFC 5988 Link paging) and the npm registry search dialect.

## Rationale

The alternative is proxying the registries whole, which buys one hostname and
costs the content-addressed protocol: docker and npm clients already speak the
registries' own wire, with digests verified end to end, and a relay in the
middle is a second copy of every byte plus a place for the two to disagree. The
narrower design — reads plus a pinned token mint — gives the tenant boundary a
single enforcement site without touching the data path. The token being
pull-only and single-repository is the same argument at the credential layer:
the mint's job is to let a workload pull one image, not to delegate the
platform credential.

## Security Considerations

The dangerous object is the platform credential, which can read the whole
shared catalog. The wrong implementation leaks it in either direction: echoed
or logged outright, or laundered through an over-scoped minted token — a token
scope built from an unvalidated name (`repository:a/b:pull,push` smuggled via a
crafted "image") is the concrete case the segment grammar closes. Cross-tenant
listing is the other exposure: filtering on the response shape instead of
before it, or letting the caller's search query bypass the org prefix, turns a
shared catalog into everyone's. And the refusal split is load-bearing — an
upstream refusing the PLATFORM credential must read 503, because reporting it
as the caller's 401 trains callers to retry with more privilege.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability
- OCI Distribution Specification
- RFC 5988 — Web Linking

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
