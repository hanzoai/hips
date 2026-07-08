---
hip: 0124
title: Bring-Your-Own Provider & AI — Unified Dashboard and Usage
author: Hanzo AI Team
type: Standards Track
category: Platform
status: Final
created: 2026-07-07
updated: 2026-07-08
requires: HIP-0004, HIP-0018, HIP-0038, HIP-0121, HIP-0123
---

# HIP-0124: Bring-Your-Own Provider & AI — Unified Dashboard and Usage

## Abstract

This HIP specifies the customer-facing composition of the Hanzo cloud:
a customer **brings their own cloud provider**, **brings their own AI
models and keys**, and sees **one dashboard with one metered usage
ledger** at `console.hanzo.ai`. It defines no new machinery — each leg
is an existing HIP, referenced not duplicated:

1. **BYO provider** — attach compute (HIP-0121), scale it elastically
   on the customer's own credentials (HIP-0123).
2. **BYO AI** — connect any model provider and key through the ONE
   unified AI provider interface, the gateway (HIP-0004).
3. **One console** — per-model and per-product metered usage, credit
   drawdown, and balance-floor gating in `console.hanzo.ai`
   (HIP-0018 / HIP-0422 billing; HIP-0038 for the SuperAdmin
   cross-tenant board).

Composed, this is the resell-ready OSS AI cloud: the customer supplies
the two expensive inputs — compute and model access — and the platform
supplies identity, scheduling, metering, and a single pane of glass.

## Motivation

Every leg exists and ships independently, which is exactly the risk:
without a composition spec, product surfaces re-derive the story —
one dashboard for AI spend, another for compute, a third for the BYO
cluster — and the customer gets three ledgers that disagree. The
product requirement is one sentence: **bring your provider, bring
your AI, see one usage view, pay one invoice.** This HIP pins that
sentence to the HIPs that implement it, and to nothing else.

It also fixes the product narrative for resellers (HIP-0106
white-label surfaces): what a `lux.cloud` or `osage.cloud` customer is
promised is precisely this composition — under their brand, with their
tenants' own providers and keys.

## Specification

### Leg 1 — Bring your own provider

The org connects compute through the ONE fleet surface
(`/v1/clusters`, HIP-0121): a managed cluster, a pasted kubeconfig, a
GPU box, or their own AWS/Azure/GCP/DO/Hetzner/Nebius account with
credentials sealed per-org in KMS. Visor (HIP-0123) provisions and
autoscales on that fleet — for BYOC, in the *customer's* account, so
their cloud bills them for nodes and Hanzo meters only the management
plane (HIP-0121's 1% / $1 / validator-free tiers). Nothing in this
leg is new here; conformance means **no second attach surface and no
second scaler** ever appears in a product UI.

### Leg 2 — Connect your AI

The gateway (HIP-0004) is the unified AI provider interface: OpenAI,
Anthropic, Google, self-hosted engines, and every other backend are
providers behind one API, one model-routing table, and one credential
store. **BYO AI** means the org registers its own provider keys (or
points at its own hosted models) and every downstream product — chat,
agents, ML pipelines — consumes them through the same gateway surface
with the org's identity attached (HIP-0026). Platform keys and
customer keys ride the same interface; whose key served a request is
an attribute of the usage record, never a separate code path.

### Leg 3 — One dashboard, one usage ledger

`console.hanzo.ai` is the single self-service pane (per-org); its
admin sibling is the SuperAdmin-gated cross-tenant board (HIP-0038,
HIP-0118). Verified live this cycle:

- **AI usage metering is real**: per-model usage records (501 records
  on the reference org at verification), rendered with credit
  **drawdown** against the org's balance.
- **Per-product usage** is a server-side axis
  (`?product=` / `?groupBy=product`, `hanzoai/cloud` #159) — AI,
  compute, storage, and every metered product report into one ledger,
  one drawdown.
- **Billing is gated, not advisory**: the balance floor returns
  **HTTP 402** at the platform edge (HIP-0106 realized state;
  HIP-0018 / HIP-0422 semantics). Usage views and enforcement read
  the same ledger.

The conformance rule is the DRY rule: **one metering path**
(`commerce/metering`, per HIP-0121), one ledger per org, one invoice —
whatever mix of BYO provider, BYO AI, and platform-native usage
produced the charges. A product that meters outside that path, or a
dashboard that aggregates from anywhere but that ledger, is
nonconformant.

### Decided vs shipped

- **Shipped:** the gateway provider interface (HIP-0004, live as the
  `api.hanzo.ai` surface), the fleet attach surface and nominal-fee
  metering (HIP-0121), console per-model usage with drawdown and the
  per-product axis, and 402 balance-floor gating.
- **Staged (owned by the underlying HIPs, tracked there):** the daily
  BYOC 1% and monthly device billing loops (HIP-0121 roadmap),
  cross-provider per-tenant scale execution (HIP-0123), and the
  unified cross-tenant fleet+revenue admin board (HIP-0121 roadmap,
  HIP-0038 surface).

## Rationale

**Why a composition HIP.** Rich Hickey's test: is this thing one thing?
The customer promise is one thing — even though its implementation is
three orthogonal planes. Capturing it as references keeps each plane
independently evolvable while making the composition itself a
reviewable, versioned artifact. The alternative is tribal knowledge —
the most expensive storage tier.

**Why thin is correct.** Every substantive rule here (org boundary,
sealed credentials, exactly-once metering, scaling primitives, provider
abstraction) already has exactly one home. Restating any of it would
create the second copy this repo's orthogonality rule exists to
prevent. This HIP's only normative additions are composition
invariants: no second attach surface, no second AI interface, no
second ledger.

**Why it matters commercially.** BYO inverts the cost structure of
running an AI cloud: the customer's cloud bill and model bill stay
theirs (audited against their own provider statements, per HIP-0121's
honesty contract), and the platform charges for what it uniquely does
— identity, orchestration, elasticity, and the unified ledger. That is
the wedge for resellers and enterprises alike, and it only works if
the three legs stay composed, not braided.

## References

- HIP-0004 — LLM Gateway — Unified AI Provider Interface (BYO
  models/providers/keys)
- HIP-0018 — Payment Processing Standard (billing semantics; 402
  gating)
- HIP-0026 — Identity & Access Management Standard (the org identity
  on every usage record)
- HIP-0038 — Admin Console Standard (the cross-tenant board)
- HIP-0106 — Cloud — Unified Hanzo Binary (white-label surfaces; the
  realized metering + balance-floor edge)
- HIP-0118 — SuperAdmin & Tenant Isolation Model (who may see the
  cross-tenant view)
- HIP-0121 — BYO Compute Fleet & Metered Billing (attach surface,
  sealed credentials, billing tiers, one metering path)
- HIP-0123 — Visor — Fleet & Fabric Autoscaling Across Any Provider
  (elasticity on the customer's provider)
- HIP-0422 — billing (service catalog entry)
- `hanzoai/cloud` #159 — per-product usage axis
  (`?product=` / `?groupBy=product`)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
