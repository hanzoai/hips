---
hip: 0511
title: Account Pool — Budget-Aware Rotation Over Linked AI Accounts, One Login and One Meter
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-07-21
requires: HIP-0001, HIP-0111, HIP-0510
---

# HIP-511: Account Pool

## Abstract

This proposal specifies the **Account Pool**: the layer that selects, for every
request, which linked upstream credential serves it, chosen by **remaining
budget** in the credential's current reset window. A user signs in once at
hanzo.ai (HIP-0111), links any number of upstream AI accounts — their own
Anthropic keys and subscriptions, OpenAI, others, and Hanzo's own prepaid
`enso` — and the gateway rotates across the accounts that still have budget,
pauses an account the moment its upstream reports a limit, and restores it
automatically when that limit's window resets. All spend, across every account,
is metered in one place.

The Account Pool is the **credential-layer twin of Enso** (HIP-0510) and is
**orthogonal** to it. Enso answers *which model* best serves a request
(`quality − λ·cost − μ·latency`). The Account Pool answers *which credential*
pays for the model Enso chose (most remaining budget). Enso is about
**capability**; the Pool is about **capacity and entitlement**. They compose in
one line at the credential-resolution seam and neither knows the other's policy.

`enso` is the default model on every surface — hanzo.app, hanzo.chat,
cloud.hanzo.ai, and the CLI — and the Pool sits beneath it so that default costs
the user's own linked capacity first and never hard-blocks while any account, or
Hanzo prepaid, has budget.

## Motivation

A single AI account is a single budget with a single reset clock. A Claude
subscription has rolling window limits; a metered API key has a monthly cap; a
prepaid Hanzo balance has a dollar figure. Pinning one account means a request
fails the instant that one clock runs out, even when the same person (or team)
holds three other accounts with budget to spare. The waste is symmetric with the
model-pinning waste Enso removes — only along the *capacity* axis instead of the
*capability* axis.

Three properties make this a distinct layer, not a wrapper:

1. **Selection is effectively free and state-local.** Choosing an account is a
   filter (drop paused) plus an `argmax` over remaining budget — microseconds,
   no network. Budget and reset time live on the account record; no upstream is
   polled to know an account is spent.
2. **Depletion and reset are observed, not guessed.** An upstream's own
   rate-limit response carries the reset time; the Pool records it and flips the
   account back to available when it passes. Metered caps reset on their calendar
   window. "When they reset, more comes back" is a timestamp comparison.
3. **One login, one meter.** Linking rides the existing identity and credential
   plumbing (HIP-0111 login; the `connector` secret seam). Every dispatch meters
   against both the chosen account's budget and the single Hanzo usage ledger, so
   one dashboard covers every account without a second accounting path.

Today Hanzo already runs the degenerate case: billing is org-pooled, so the
subject `account.Payer(...).Subject()` names one shared wallet and the gateway's
`GlobalBalanceLedger` reserves against it. The Account Pool generalizes that one
Hanzo-prepaid wallet into **N accounts of any provider**, with Hanzo prepaid as
one member of the pool.

## Specification

### 1. Primitives (values, not places)

- **Account** — one linked credential a principal can spend through:
  `{ id, owner, provider, capabilities, credentialRef, budget, state }`.
  `owner` is the IAM org or person that linked it (scope). `provider` is
  `anthropic | openai | hanzo | …`. `credentialRef` is a KMS handle; the secret
  itself never leaves KMS and never appears in argv, logs, or a response.
  `capabilities` is the served set (e.g. `chat`, `code`, `vision`) so the Pool
  only offers an account for work it can do.

- **Budget** — remaining spendable capacity in the current reset window. Two
  shapes, one type:
  - *Metered* (API key, pay-per-token): `remaining = cap − spendThisWindow`,
    `resetAt = window boundary`. `cap` may be unbounded (then `remaining = ∞`
    and the account only pauses on an upstream error).
  - *Windowed* (subscription, e.g. rolling limits): `remaining` is a boolean
    "not currently limited"; `resetAt` is learned from the upstream's limit
    response. Depletion is observed, not metered per token.

- **State** — `available | paused(reason, until) | needs-relink | disabled`.
  `reason ∈ { budget-exhausted, rate-limited, auth-error }`. `until` is the
  earliest time the account may be retried. `disabled` is a user toggle;
  `needs-relink` requires a fresh credential (expired/revoked upstream auth).

- **Pool** — the set of a principal's accounts, filtered by `capability` and
  `provider`, that a request may draw on. A pool is **org-scoped** (a team shares
  it) or **person-scoped** (private), following the same owner boundary as
  billing and IAM. Never cross-tenant.

- **Selector** — a pure function `select(pool, need) → Account?`:
  1. Drop accounts that are `disabled`, `needs-relink`, lack `need.capability`,
     or are `paused` with `now < until`. A `paused` account with `now ≥ until`
     is treated as available (lazy reset — no scheduler required for
     correctness; a background sweep is an optimization, not a dependency).
  2. Among survivors, pick **max remaining budget**; break ties by
     **longest-idle** (spreads load, honors windowed resets). Round-robin is the
     tie-break degenerate case.
  3. If none survive, return the account with the soonest `until` as the
     *reason* (so the surface can say "resets in N minutes") and fall through to
     the pool's designated fallback — Hanzo prepaid `enso` — so a user with any
     Hanzo balance is never hard-blocked.

### 2. Composition with Enso (orthogonality)

One request resolves in two independent steps at the existing gateway seam:

```
request → Enso.route(model=auto|enso)          → concrete model + provider   (HIP-0510)
        → Pool.select(pool(owner), {provider, capability}) → Account          (this HIP)
        → dispatch(model, Account.credentialRef)                              (gateway)
        → meter(Account.budget) ∧ meter(Hanzo usage ledger)                   (§4)
```

Enso is unchanged: it still optimizes `quality − λ·cost − μ·latency` over the
model pool and emits `X-Routed-Model`. The Pool is inserted exactly where the
gateway today resolves a single provider credential; it now resolves the
best-budget account of the routed provider. Neither layer reads the other's
policy. (A later revision may feed *account-budget pressure* into Enso's cost
axis; v1 keeps them orthogonal and revisits with data — Enso's own flywheel is
the place that learning belongs.)

### 3. Linking (one login)

Linking is an IAM operation (HIP-0111), not a new auth surface. "Link account"
opens an OAuth connection to the upstream (or accepts a Console API key), seals
the resulting credential in KMS, and creates an **Account** record with its
provider, capabilities, and budget policy. Linking rides the existing
**connector** primitive (the CLI `connector` command and platform connectors
already "move secrets and billing" with no `--org` special-casing); an
AI-upstream connector is simply a connector whose secret is an inference
credential and whose metadata is a budget policy. One way in: connectors are how
external credentials enter; the Account Pool is the routing view over connectors
of kind `ai-upstream`.

Org-scoped linking is what makes "we can all use it": a team links a set of
accounts at org scope and every member's `model=enso` traffic rotates across
them by remaining budget. Person-scoped linking keeps an account private to the
individual.

### 4. Metering and budget accounting (one meter)

Every dispatch records exactly one usage event, reusing the existing
`object.UsageEvent` / `UsageRecorderFunc` seam, tagged with the serving
`Account.id`. From that single ledger:

- the **Hanzo usage view** (per user / project / org) is one dashboard across all
  accounts — hanzo.ai is the usage manager;
- the **account budget** is derived: metered `remaining = cap − Σ spend in
  window`; windowed accounts carry no per-token meter and update `state` only on
  observed limits.

Rotation must never become a metering bypass: the event is recorded regardless
of which account served, and the fallback to Hanzo prepaid meters against the
same subject the gateway already gates today.

### 5. Depletion and reset

- **Depletion.** On dispatch, a hard upstream limit signal (HTTP 429 or a
  provider `usage-limit` error) sets `state = paused(rate-limited, until =
  reset-from-response)`. A metered account whose window spend reaches `cap` sets
  `state = paused(budget-exhausted, until = window boundary)`. An auth failure
  (401/invalid credential) sets `needs-relink` (never silently retried).
- **Reset.** The Selector treats `paused` with `now ≥ until` as available
  (§1.1), so recovery needs no polling — the account re-enters rotation on the
  first request after its window turns over. A background sweep that pre-flips
  `until`-elapsed accounts is an optional latency optimization.
- **No upstream probing for windowed limits.** The reset time comes from the
  upstream's own limit response; the Pool stores it and waits it out.

### 6. Security

- **Credential custody.** Secrets live only in KMS, referenced by
  `credentialRef`. The chosen credential is injected on the upstream side only
  (request header/env at dispatch), the same custody the coding-agent path
  already uses — never in argv, never logged, never in a client-visible field.
- **Tenant isolation.** `pool(owner)` is resolved from the request's IAM owner;
  the Selector can only see that owner's accounts. Org-shared pools require org
  membership. A person-scoped account is invisible to the org.
- **No plaintext state leak.** Budget and reset state carry no secret material.
- **Fail-closed metering.** A dispatch that cannot be attributed to a metered
  subject is refused, not served free (consistent with the existing spend gate's
  no-exempt invariant).

## Rationale

- **Decomplected.** Model choice (Enso) and credential choice (Pool) are two
  functions at two seams; neither is threaded through the other. A change to
  rotation policy cannot regress routing quality and vice versa.
- **Values, not places.** An Account is a value (`{provider, budget, state}`);
  the "pool" is a filtered set, the "selector" a pure `argmax`. The reset clock
  is a timestamp on the value, not a daemon that owns the account.
- **One way.** Linking is a connector; login is IAM (HIP-0111); metering is the
  one usage ledger; the default model is `enso` on every surface. No second path
  for any of them.
- **Composition over inheritance.** The Pool wraps the existing
  credential-resolution seam and the existing `UsageEvent` recorder; it defines
  no new billing service and no new auth endpoint.

## Backwards Compatibility

Forward-only. A principal with zero linked accounts is a pool of one — Hanzo
prepaid `enso` — which is exactly today's behavior, so the layer is inert until
an account is linked. No existing endpoint, credential, or billing subject
changes shape. The CLI continues to authenticate as it does today; `enso`
resolves through the pool with the same request contract, so a linked account
adds capacity without a client change.

## Open Questions

1. **Subscription terms.** Pooling *consumer subscription* seats (e.g. per-person
   Max/Pro) across a team may conflict with a provider's terms; Console **API
   keys** are the terms-clean path for pooling. The spec supports both budget
   shapes, but org-pooling of subscription seats is a compliance decision, not
   only an engineering one, and must be gated on the provider's terms — flagged
   here deliberately rather than buried.
2. **Team fairness.** Should an org pool enforce per-member sub-budgets, or is a
   shared free-for-all with per-user metering (visible in the one dashboard)
   sufficient? Start with metered-and-visible; add sub-budgets if a team asks.
3. **Enso coupling.** Whether account-budget pressure should enter Enso's cost
   axis (route away from a nearly-exhausted provider) or stay a pure Pool concern.
   Keep orthogonal in v1; let Enso's flywheel decide with data.
4. **Reset granularity.** Windowed providers with multiple simultaneous windows
   (e.g. a short rolling limit *and* a long one) need the Pool to track the
   binding `until = max(active windows)`; confirm the provider surfaces both.

## Reference Implementation (staging)

1. `Account` + `Pool` + pure `select()` as a leaf package (no gateway imports),
   unit-tested on the selection algebra alone.
2. Gateway seam: resolve `Pool.select` where a single provider credential is
   resolved today; dispatch with `credentialRef`; record the tagged `UsageEvent`.
3. Linking: an `ai-upstream` connector kind (KMS-sealed credential + budget
   policy) surfaced in the hanzo.ai account UI and the CLI `connector` command.
4. Depletion/reset: map each provider's limit response to `paused(reason, until)`
   at the dispatch error seam; lazy reset in `select`.
5. Default `enso` on hanzo.app / hanzo.chat / cloud.hanzo.ai / CLI, pool beneath.

Each stage ships and is reviewed independently (blue builds, red reviews) before
the next; stage 1's `select()` is provable in isolation.
