---
hip: 1140
title: ML — Model Serving
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: ml
status: Final
implementation-go: shipped
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1140: ML — Model Serving

## Abstract

`/v1/ml` is model serving: deploy a model behind an endpoint and call it. The
implementation, `hanzoai/cloud` `apps/ml`, is a thin tenant-scoped bridge that
turns one KServe CustomResource — `InferenceService`,
`serving.kserve.io/v1beta1` — into a small REST surface plus one inference
proxy. No ML logic is reimplemented: KServe owns reconciliation, and this layer
owns exactly two things, the REST↔Kubernetes translation and the tenant
boundary (`apps/ml/ml.go:1-16`).

## Motivation

Serving a model is cluster work — a CR, a namespace, a data-plane address — and
every customer who had to be handed `kubectl` to do it was handed the cluster.
The capability exists so a tenant deploys and calls a model through the same
identity, billing and document planes as every other `/v1` surface, while the
cluster remains invisible. Training is deliberately NOT here: a `/v1/train/*`
facade over CRDs the cluster never served was deleted rather than shipped
degraded (`apps/ml/ml.go:18-25`); fine-tuning is the `hanzoai/ai` broker's.

## Specification

The key words MUST, MUST NOT, SHOULD and MAY are to be interpreted as in RFC
2119.

### The store, and there is none

This capability owns no store. Its state is the cluster's: every read and write
is a call on a Kubernetes dynamic client, and deleting the subsystem loses
nothing but the endpoint. The client authenticates as the dedicated `cloud-ml`
ServiceAccount when `HANZO_ML_TOKEN_FILE` names a mounted token, failing closed
if the named token is unreadable (`apps/ml/ml.go:659-681`) — the product-API
path never inherits ML's cluster reach.

### Addresses

Seven operations under `/v1/ml`, three typed and four declared with prose
beside the route, each declared one for a wire fact a typed op cannot state
(`apps/ml/ml.go:210-241`):

- `GET /v1/ml/models`, `GET /v1/ml/models/{name}`, `DELETE /v1/ml/models/{name}`
  — typed ops (`apps/ml/typed.go`).
- `POST /v1/ml/models` — declared: the pre-create balance gate answers 402/503
  in band with the fleet's nested `{"error":{code,message}}` body, which zip
  renders only flat.
- `PATCH /v1/ml/models/{name}` — declared: an RFC 7386 merge patch relayed
  verbatim; re-encoding a merge patch changes what it means.
- `POST /v1/ml/models/{name}/predict` — declared: a verbatim proxy of the
  predictor's own status, bytes and Content-Type (KServe v2 inference
  protocol), read up to a 32 MiB ceiling.
- `GET /v1/ml/health` — declared: a real probe that answers 503 CARRYING the
  degraded report — k8s reachability, CRD presence, and the serving-runtime
  count, which is a separate fact because a cluster with the CRD and no runtime
  accepts a deploy and never schedules it (`apps/ml/ml.go:486-543`).

### Tenancy

The tenant is the gateway-minted org narrowed by the validated project, mapped
to a per-tenant Kubernetes namespace: `ml-<org>`, or `ml-<org>-<project>` for a
non-default project. The mapping MUST be injective — org and project are
validated against strict DNS-label patterns with no lossy fold
(`apps/ml/ml.go:564-598`) — and the dynamic client is always pinned to the
caller's namespace, so naming into another tenant's resources is unspellable
rather than refused. An unvalidated principal is 403 before any mapping; an
org-less caller is refused unless SuperAdmin, who lands in the literal
`ml-admin` bucket.

### Money

Metered (`plugin/ml/main.go` declares `cloud.Metered`; `ml` is in the
`meteredApps` standing list, `spend.go:306`). One create is gated and debited
through the shared `cloud.ResourceMeter` under the commerce product label
`compute`, not `ml` (`apps/ml/ml.go:145-171`): the balance gate runs BEFORE the
namespace or CR exists and fails closed, the fee
(`CLOUD_COMPUTE_FEE_CENTS[_INFERENCESERVICE]`, default $1.00) is debited
asynchronously on success against the caller's own ledger. Ongoing GPU-hour
cost reuses the same meter from a runtime usage watcher and is never fabricated
here.

### Events and telemetry

It publishes nothing to the bus, so a customer's webhooks receive nothing from
it. Beyond the request span every route gets, it emits log lines only — the
mount report and per-operation Kubernetes errors with the missing RBAC named
(`apps/ml/ml.go:636-644`).

### Stage

`beta`: the manifest row (`manifest/apps.go:186`) declares `Stage: Beta`, so
per HIP-0139 §8 the capability is dropped from the public projection and its
prefix answers 404 unless the caller's org holds the `ml` flag.

### Upstream

- KServe (Apache-2.0): the reconciler this capability drives. Nothing of it is
  vendored — the app speaks its CR API and its v2 inference wire.
- `k8s.io/client-go` and `k8s.io/apimachinery` (Apache-2.0): the imported
  client through which every cluster call goes.

## Rationale

The alternative to a thin bridge is reimplementing serving — a scheduler, a
rollout loop, a data plane. That buys independence from KServe and costs a
second reconciler that must agree with the cluster about everything. The bridge
keeps one owner per fact: KServe owns the model's lifecycle, this layer owns
who may name it. Verbatim relays (patch, predict) are kept verbatim for the
same reason — a paraphrased predictor error is this layer inventing an answer
the model did not give.

## Security Considerations

The wrong implementation hands out the cluster. Concretely: a lossy org
sanitizer folds two orgs onto one namespace and each reads the other's models
and predictions; a namespace derived from a request field instead of the
validated principal lets any caller deploy into, or predict against, a chosen
tenant; and a client built on the pod's own broad ServiceAccount instead of the
`cloud-ml` token gives every ML bug the product API's full cluster reach. The
strict-regex injective mapping, the principal-only tenant resolution and the
dedicated token are each the closure of one of those, and the balance gate
running before resource creation is what keeps an unfunded org from starting
GPU work it will never pay for.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability
- RFC 7386 — JSON Merge Patch

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
