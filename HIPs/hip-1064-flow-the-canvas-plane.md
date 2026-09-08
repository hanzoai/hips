---
hip: 1064
title: Flow — The Canvas Plane
author: Hanzo AI
type: Standards Track
category: Interface
capability: flow
status: Final
implementation-go: shipped
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0119, HIP-0139
---

# HIP-1064: Flow — The Canvas Plane

## Abstract

Hanzo Flow is the visual agent-workflow product — a canvas, a graph engine and a
component library — and it lives in its own repository, `hanzoai/flow`, written in
Python. `/v1/flow` is the cloud's endpoint onto it.

This HIP specifies what the endpoint adds and, more importantly, what it refuses to
add. The cloud contributes exactly three things: identity, the tenant boundary,
and the unified surface. It contributes no data model, because a plane that
remodels a product's shapes can drift from them. The implementation is
`hanzoai/cloud` `apps/flow`.

## Motivation

Two failure modes bracket this kind of endpoint.

The first is reimplementation: cloud grows its own workflow model beside the
product's, and the two diverge until a graph saved through one cannot be read
through the other. The second is the honest-looking document: an address list is
authored for the product's full intent, published, and answers nothing —
measured, an authored spec for this product carried paths that returned a
route-level 404 everywhere they were probed. A client cannot tell an unimplemented
operation from a broken one.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### The product owns its shapes

Every operation is a typed passthrough. Responses relay the product's own payloads
verbatim — a workflow is the product's workflow object, a page is its own
pagination envelope, a run is its own run response. This plane MUST NOT remodel
them, and therefore cannot drift from them.

Typing here describes the envelope and the address, not the product's interior.
That is the whole point of the relay: the schema this plane publishes is a
promise it can keep.

### The tenant boundary is the product's own project

The product runs as a single shared deployment reached with one platform
credential, so the org boundary MUST be enforced in the cloud, on a primitive the
product already has: each org's workflows live in a project named by the org id,
resolved server-side per request.

Consequently:

- The org comes from the validated principal (HIP-0026) and is never an input
  field.
- A create pins the project server-side. A caller cannot name one.
- Every per-workflow read or mutation verifies the workflow is in the caller's
  project and answers 404 otherwise. **A foreign id and an unknown id MUST be
  indistinguishable**, so existence never leaks.
- The project primitive itself gets no route. Exposing it would hand a caller the
  address of another org's project, which is the one thing the boundary rests on.

### Failure is attributed correctly

- No validated principal: refused before any upstream byte.
- The upstream refusing the platform credential: **503**. That is a deployment
  fault, and reporting it as an authorization failure would send the caller to
  debug their own credentials for a problem they cannot see.
- Upstream 5xx: 502. Unreachable upstream: 503.

An empty platform credential is a valid posture for a development deployment and
MUST NOT be treated as an error at mount.

### The honest slice

What is mounted is the subset the product's server genuinely answers, each
operation proven against a live backend before it shipped. Everything else gets
**no route at all** — a smaller true surface rather than a larger fake one — and
the refused families are a closed ledger with a reason each
(`apps/flow/typed_wire_test.go:46`), measured against the live router: 404 there,
absent from the document.

The reasons fall in two groups, and the distinction is normative because the
remedies differ:

1. **Primitives this product does not have.** The authored intent carried a
   component model, connection, trigger-queue and key-value vocabulary from a
   different lineage. Those belong to capabilities that exist elsewhere in the
   fleet — connectors at `/v1/connectors` (HIP-1065), triggers and the piece
   runtime on the automation plane (HIP-1063), keyed storage in its own product.
   Such a family MUST NOT be revived here; it is already served.
2. **Product surface not yet proven against a real backend.** These may ship, and
   shipping one is a deliberate edit to the ledger plus an operation proven
   against a live server. Never a drive-by.

Every route on this surface is a typed operation and the count of untyped routes
is held at zero, so a raw handler added later fails rather than shipping without a
schema.

The addresses are the operations at `/v1/flow` (plugin/flow/openapi.json):
workflows (list, create, get, patch, delete), runs (start, list), and the
`/status` reachability lens.

### What it owns, and what a run costs

The capability owns no store: workflows and runs live in the product's own
database upstream, and the honest slice reads them back verbatim.

It is metered. The plugin declares `Price: cloud.Metered`
(plugin/flow/main.go:23), and the unit is one **run**. Running a workflow
executes its whole component graph upstream, and those components call model
providers, so the meter sits on `POST /v1/flow/runs` and nowhere else —
everything else is bookkeeping against rows already held (apps/flow/billing.go).
The price per run is the deployment's `CLOUD_FLOW_FEE_CENTS_RUN` (then
`CLOUD_FLOW_FEE_CENTS`, then the platform default
`cloud.DefaultResourceFeeCents`, 100 cents). The gate authorizes exactly the
amount the meter debits — one fee read serves both, so the number a caller is
refused for and the number they are charged cannot drift — and the debit lands
through the resource meter after the upstream returned: work that never ran is
work nobody owes for.

It publishes no events on the platform bus, so a customer's webhooks (HIP-1310)
receive nothing from it, and it emits nothing to observability beyond the
request span every route gets.

The stage is `ga` — the manifest row declares none, and absent is `ga`
(HIP-0139 §8).

The product is a fork: `hanzoai/flow` derives from Langflow (MIT), rebranded,
and the canvas, the graph engine and the component library all survive in HEAD.
The cloud side forks none of it — every operation is the typed passthrough this
HIP already requires.

## Rationale

The alternative to a shared deployment with a cloud-side boundary is one
deployment per org. It gives isolation by construction and costs a per-org
lifecycle, a per-org credential, and idle capacity for every org that has drawn
one graph. The project-per-org boundary keeps a single deployment and puts the
isolation in tested code paths on the cloud side, where the identity already is.

## Security Considerations

One shared upstream credential means the upstream cannot distinguish tenants; the
endpoint is the only thing that can. Two properties carry it: the project is pinned
server-side on write, and every per-workflow operation passes an ownership check
whose negative answer is identical to the not-found answer.

The credential itself is delivered from the key store into the process
environment and never appears in a response. An upstream rejection of it is
reported as a deployment fault precisely so that a misconfigured credential can
never be mistaken for a caller-side authorization result.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0119 — Hanzo Service Conventions
- HIP-1063 — Auto — Flows That Run Themselves
- HIP-1065 — Connectors — A User's Own Credentials

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
