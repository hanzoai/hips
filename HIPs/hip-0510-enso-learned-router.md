---
hip: 0510
title: Enso — Learned Per-Request Model Routing and the Recursive Router–Model Flywheel
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-07-17
requires: HIP-0001
---

# HIP-510: Enso — Learned Per-Request Model Routing

## Abstract

This proposal specifies **Enso**, Hanzo's learned router: a layer that selects the
best model for every request across any enabled provider and any hosted model,
then improves itself from feedback. Enso makes model choice **per-request** and
makes **cost a first-class, transparent axis** — it optimizes
`quality − λ·cost − μ·latency` over the whole pool. The routing decision costs
**microseconds on a CPU** (measured 300 ns heuristic → 12 µs learned), never a
GPU. Enso tiers cleanly from a transparent rule router (cold start) to a learned
policy (`xᵀWp`, closed-form ridge fit + online per-user LinUCB) that takes over
once eval data exists and falls back to the rules whenever it is unsure. Every
routed request produces a content-free training tuple that trains both the router
and — recursively — the next model. This HIP defines the routing contract, the
per-org and global training loops, the reward sources (in-app feedback + an
LLM-as-judge quality signal), the metering, and the economics.

## Motivation

Frontier models trade the lead benchmark-to-benchmark: the best coder is not the
best reasoner is not the cheapest capable chat model. Pinning one model for all
traffic leaves both quality and money on the table, and it couples a product to a
single vendor's availability, pricing, and policy. A router that picks per-request
recovers the leading capability on each task **and** makes the cost of that
capability explicit and controllable — without changing the caller's integration
(`model=auto` over an OpenAI-compatible API).

Three properties make this a distinct layer rather than a wrapper:

1. **Routing is effectively free.** The decision is keyword-classify plus a small
   learned matrix–vector product — six orders of magnitude below the model call it
   precedes. No GPU is needed to route; only the selected model needs one.
2. **It has no cold-start cliff.** A transparent rule router serves from request
   one; a learned policy takes over per-task as eval data accrues and defers to the
   rules under uncertainty.
3. **It learns from ordinary traffic.** In-app feedback and an automatic LLM-judge
   quality score become rewards; a content-free ledger (features + score, never
   prompt text) trains the policy online.

## Specification

### 1. Routing contract

A request for the virtual model id `auto` (alias `zen-router`) is resolved to a
concrete servable model **before** provider, pricing, and billing resolution, so
the entire existing path bills and reports the model that actually served. The
gateway sets `X-Routed-Model` on the response for transparency; the response
`model` field echoes the same id.

- **Task classification.** A request is mapped to a coarse task bucket
  (`code`, `math`, `reasoning`, `creative`, `vision`, `long_context`, `cheap_chat`,
  `default`) by media flag, approximate length, and keyword signal.
- **Policy.** Per task, an ordered preference of servable model ids is resolved with
  precedence **org/project > org > `*` (shared base) > conf**; the first servable
  model wins. The `known` predicate restricts every level to models the caller can
  actually serve, so a narrower scope can only narrow, never escalate. Access-gated
  SKUs additionally require an explicit grant.
- **SLO.** Optional per-request ceilings (`X-Max-Cost` per 1k tokens,
  `X-Max-Latency-Ms`) gate the choice; a policy cost ceiling fills an unset budget.

The learned policy replaces the ordered preference with a bilinear utility
`xᵀW p_m` over a feature vector `x` (task one-hot, hashed n-grams, length, media)
and a per-model profile `p_m`, argmax subject to the SLO and access gates. It
falls back to the rule policy when confidence is low or `W` is unfit.

### 2. Reward sources

A routing decision is recorded as a **content-free** `RoutingEvent`
(task, requested→routed model, confidence, source, feature vector, tokens, cost,
latency — never prompt text). A reward in `[0,1]` is attached, keyed by the
response/usage request id, from either:

- **In-app feedback** — an explicit signal a product surfaces (thumbs, accept,
  regenerate) posted to `POST /v1/add-routing-reward`.
- **LLM-as-judge** — an automatic quality score: a judge model rates the served
  response against a task rubric; only the numeric score is stored.

### 3. Training loops

Enso trains **both** a shared base and every org's own policy from one ledger read:

- **Global base (`*`).** Fit from the rewards of orgs that **opted in**
  (`TrainingContribution = enabled`) plus reserved internal traffic. Consent-gated:
  a customer contributes to the shared base only by choice.
- **Per-org.** Every org with sufficient rewarded rows fits **its own** policy from
  **its own** data, gated against **its own** incumbent, deployed to **its own**
  policy row. An org needs no consent to train on its own data; the fold ensures its
  learned policy wins for that org while the base serves everyone else.

Each cycle is **fit → gate → deploy → publish**:

1. **Fit.** Per-(task, model) empirical statistics over the rewarded ledger
   (offline closed-form ridge for `W`; online LinUCB per user for adaptation).
2. **Gate.** A candidate is deployed **only** if it beats the incumbent by a margin
   on a held-out reward measure (or a benchmark eval). Otherwise the incumbent is
   kept and training continues on more data — **promote-or-keep**.
3. **Deploy.** The gated table is written to the scope's policy row; the router
   prefers it on the next request with no reload (a sub-microsecond swap).
4. **Publish.** The retrain verdict (version, event count, gate pass/value/base) is
   recorded and surfaced for observability.

### 4. The recursive router–model flywheel

Every routed request yields a labeled tuple `(features, winning model, quality
score)`. Beyond training the router, this is a preference/distillation dataset for
**model** training: the winning responses are supervised-fine-tuning targets, the
judge scores are a reward-model signal, and the discovered task boundaries inform
pretraining. A better model becomes a better routing target, attracts more traffic,
and generates more preference data — the router is the **data flywheel** for the
next model. Model training remains GPU work; the router and its data collection do
not.

### 5. Serving family

For callers who prefer not to manage a pool, Enso is also offered as a managed
family (`enso`, `enso-flash`, `enso-ultra`) over the same OpenAI-compatible API.
`enso-ultra` is an **adaptive fan-out**: it probes one task-appropriate arm and
escalates to a small panel with verify-then-select **only** when the probe is
low-confidence, so a confident request bills one arm, not the panel.

### 6. Metering and pricing

Every routed request is metered on **one plane**, so per-request cost is a real,
auditable number (not a model-card estimate). Two models:

- **Enso Router** (route across your own pool): a runtime fee of **1% of the routed
  LLM spend**. It is bounded above by the value it creates — routing away from
  over-provisioned models typically saves a large fraction of spend — and above what
  it costs to run (a microsecond CPU decision plus a sampled judge call). The fee is
  incentive-aligned: it grows only as the customer's routed spend grows, and the
  customer nets the savings minus the fee.
- **Enso family** (managed SKUs): fixed `$/MTok` per SKU, each rung billed strictly
  above its upstream cost, at the rung that served.

### 7. Availability, control, and self-service

- **Self-service.** An org enables Enso Router, selects the providers and models in
  its pool, sets a cost ceiling, and sends `model=auto` over `api.hanzo.ai/v1` —
  usable from any OpenAI-compatible client (CLIs, IDE assistants, agent harnesses).
- **Provider control.** An org may opt specific providers or models out of its pool
  for data, privacy, compliance, or organizational reasons.
- **Data ownership.** The ledger is content-free; an org can export or delete its own
  routing data, and training on the shared base is opt-in.
- **Feature gating.** Any capability not yet generally available is gated behind the
  native flag engine (`/v1/flags`), org-scoped, so the surface ships dark and enables
  per-org without a release.

## Rationale

The learned policy is deliberately a small feature vector and a bilinear form rather
than an embedding classifier: it avoids an embedding call (which would dominate the
decision at milliseconds) while still capturing task and domain signal, keeping the
whole decision on CPU in microseconds. Gating before promotion — rather than
continuously overwriting weights — is what makes the loop safe to run autonomously:
a regression cannot ship, and the system keeps training until it has a real
improvement. Per-org policies over one shared table (via the precedence fold) give
every org a router tuned to its own workloads without a per-org serving stack.

## Backwards Compatibility

`auto` is additive: a deployment without a router configuration treats it as any
other unknown id, and every other model id resolves unchanged. Callers integrate
once (OpenAI-compatible) and opt into routing by requesting `auto`.

## Security Considerations

The routing ledger is content-free by construction (features and reward only).
Reward attachment and the training exports are gated (org-admin for an org's own
data; super-admin or a service token for the platform-wide base). Cross-org
isolation is enforced by the precedence fold and the `known` predicate: a scope can
only narrow to models it can serve, never escalate to another tenant's.

## Reference Implementation

- Router mechanism and learned policy: `hanzoai/engine` (`hanzo-router`, `enso`).
- Gateway routing, per-org/global training, reward ledger, metering: `hanzoai/ai`.
- Managed family (catalog + identity): `hanzoai/enso`.
- Evaluation harness: `hanzoai/enso-bench`.
- Measurements and economics: the Enso paper (`hanzoai/papers/enso`).

## Copyright

This document is placed in the public domain.
