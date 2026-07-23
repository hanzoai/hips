---
hip: 0515
title: The Autonomous Self-Improvement Loop — Signal → Propose → Gate → Review → Land → Measure
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-07-22
requires: HIP-0009, HIP-0013, HIP-0512, HIP-0513
---

# HIP-515: The Autonomous Self-Improvement Loop

## Abstract

This proposal specifies how Hanzo improves its own software under empirical, human-gated
control: a typed loop that turns a **problem signal** into a **proposed change**, proves
the change does not regress via a fail-closed **benchmark + test gate**, routes it to a
**mandatory human review**, lands it, then **measures** the effect and records the whole
attempt as research evidence. The loop is not a new system — it is a **Controller** (a
durable state machine, the same shape as the Enso VOI Controller of HIP-0512) sequencing
primitives that already exist: the coding keystone (HIP-0009 agent orchestration, the
`Propose` stage), the Benchmark Arena (HIP-0512, the `Gate`), the research evidence plane
(HIP-0512 `/v1/research`, the diary that records every attempt), and IAM approval (the
`Review` gate). Its target repository may be Hanzo's own — the system hosted in its own
cloud, improving itself in **human-set directions**, starting with bug/error fixes and
graduating to features authored in human dialogue. Autonomy proposes; humans dispose.

## Motivation

Hanzo already runs this loop by hand every day: a human names an objective, an engineer
(or an AI coding agent) writes a change, tests and benchmarks decide if it is safe, a
human reviews the PR, it merges, and the effect is measured. Each stage is a primitive we
have built. What is missing is the **typed seam** that composes them into one durable,
observable, self-driving loop — and the **invariants** that make self-improvement safe
enough to automate:

- A change that regresses a benchmark or breaks a test must **never** land. Today the
  gate is a CI convention, not a structural invariant of the loop.
- Every attempt — the ones that landed and the ones the gate rejected — must be
  **recorded** as evidence, or the system cannot learn which changes help.
- A machine-proposed change must **never** merge without a human. Observation and
  approval are the price of autonomy, not an optional add-on.

The failure modes of getting this wrong are severe (an autonomous agent silently
regressing production, or picking its own goals), so the loop is defined by its gates, not
its cleverness. The prize is equally concrete: the same loop that lets a human ask "fix
this bug" in chat and get a gated, reviewed PR back is the loop that, pointed at Hanzo's
own repositories under tighter gates, lets the cloud improve itself.

## Specification

### 1. The seven stages (one typed loop)

An `Objective` flows through the loop; the Controller owns the transitions. Each stage is
a thin adapter over an existing primitive — the loop adds sequencing and gates, not new
capability.

```
Signal → Propose → Gate → Review → Land → Measure → (Escalate | Revert)
```

1. **Signal.** A typed `Objective{kind, source, spec, repo, base, constraints}` enters,
   where `kind ∈ bug | error | regression | feature`. Sources: an o11y/Sentry error
   cluster (HIP on observability), a benchmark regression the Gate itself detected, a
   tracker issue, or a human objective authored in dialogue. **A human sets or approves
   every objective** — the system never invents its own goals (controlled directions).
2. **Propose.** The coding keystone (HIP-0009; `clients/coding` Dispatcher) runs an
   AI coding agent in an **isolated git worktree**: it reads the objective and the linked
   research evidence (HIP-0512), writes a change on a branch, runs the repo's own build +
   tests locally, pushes, and opens a native PR (`CreateAgentPR`) with a fail-closed
   `VerifyRef`. The agent's model is an Enso arm; the run is bounded (time, cost, diff).
3. **Gate** *(the safety kernel).* The branch is proved against its base on two axes,
   **fail-closed**: (a) the repository's tests pass; (b) the **full benchmark suite**
   (HIP-0512 `/v1/benchmark`) shows **no regression** on any gated metric and **no new
   errors/faults** versus base. Any regression, new fault, or red test **blocks** — the
   change cannot advance. The verdict — pass/fail, per-metric before/after, the failing
   items — is recorded to `/v1/research` as a run keyed to the PR + git SHA + lib
   versions (HIP-0512 provenance). A rejected attempt is retained evidence, not discarded.
4. **Review** *(the human gate, non-bypassable).* An authorized human reviews the diff,
   the Gate verdict, and the gen-AI report (HIP-0512 diary) and **approves or rejects**.
   No path merges a machine-proposed change without this approval (SOC2 AC-6 least
   privilege; the observation requirement). This gate is the invariant that makes autonomy
   safe; it is enforced in IAM, not in the agent.
5. **Land.** On human approval **and** a green Gate, the change merges to the integration
   branch under proper semver (the house build flow: blue builds, red reviews, CTO
   confirms). Merge is the only writer.
6. **Measure.** The suite re-runs on the merged result; the before/after delta is recorded
   to `/v1/research` (the diary entry: "this change moved metric X by Y, cost Z"). A
   regression discovered post-merge **auto-opens a `regression` Objective** (a revert or
   forward-fix) — the loop closes on itself.
7. **Escalate.** The **rung ladder** widens autonomy only as trust is earned:
   `bug/error` (a concrete failing test or error to turn green — narrow, verifiable, low
   blast-radius) → `regression` (auto-revert a measured regression) → `feature` (a human
   authors the objective in dialogue). A higher rung is enabled per-repo by a human, never
   by the system. The human gate (stage 4) never goes away on any rung.

### 2. Invariants (the decomplected core)

These four properties are enforced structurally, not by convention. A build that violates
any one is not this loop.

- **Human-dispose.** No machine-proposed change merges without a human approval event
  (stage 4). The system may propose and gate autonomously; it may not land autonomously.
- **No-regression.** The Gate (stage 3) is fail-closed: a change that regresses a gated
  benchmark metric, introduces a fault, or breaks a test cannot advance. This is exactly
  "every prod update runs the full benchmark suite to catch regressions and errors,"
  made a property of the loop rather than a hope.
- **Total recall.** Every attempt — landed or rejected, positive or negative — is recorded
  to the `/v1/research` diary with full provenance (patch ref, gate verdict, measurement,
  git SHA, lib versions). The loop is auditable and learnable; nothing is lost.
- **Human-set directions.** Objectives originate from or are approved by a human. The
  system optimizes *within* a direction; it does not choose the direction.

### 3. The Controller (sequencer, not a new engine)

The loop is driven by a durable, observable state machine — an `Objective` moves through
`proposing → gating → review → landing → measuring → {done | reverting}`. It is the same
shape as the Enso VOI Controller (HIP-0512: stop / resample / reroute / verify), reused:
here the actions are `propose / re-propose / gate / request-review / land / revert`, and
the value it maximizes is measured improvement per unit cost/risk, subject to the gates.
It survives restart (durable execution, HIP-0013), emits every transition as an event
(observability), and blocks at `review` for the human. It mounts as a facet of the
research plane, not a separate subsystem — the loop's state *is* research evidence.

### 4. Self-hosting (the target may be Hanzo)

Nothing in the loop is specific to whose repository it improves. Pointed at Hanzo's own
repos (`hanzo.ai`, `cloud`, engine, …) running in Hanzo's own cloud, the loop lets the
system improve itself under the same gates. Bootstrapping is deliberate and staged:

- **Trust ladder by blast radius.** The loop first operates on low-risk repos and
  bug-rung objectives, earns a track record (recorded in the diary), and only then is a
  human enabled to point it at core repos or feature-rung objectives — each with a tighter
  Gate and mandatory Review.
- **No self-modification of the gates.** A change to the Controller, the Gate, the human
  approval path, or IAM is **out of scope for autonomous proposal** — the mechanisms that
  keep autonomy safe are changed by humans only. The loop may improve what it *does*, never
  the rules that *bound* it.

## Rationale

- **Loop over primitives, not a new system.** Propose = keystone, Gate = Benchmark Arena,
  Review = IAM, Measure/diary = `/v1/research`. The Controller only sequences and gates.
  This is composition over invention (HIP house style) and keeps each primitive
  independently testable and owned.
- **Defined by gates, not cleverness.** The dangerous part of self-improvement is landing
  a bad change or choosing a bad goal; both are closed by structural invariants (§2), so
  the agent's fallibility is bounded by construction rather than trusted away.
- **Negative attempts are evidence.** Recording rejected proposals (Total recall) is what
  turns a coding agent into a research subject: over time the diary shows which objectives,
  models, and prompts actually produce landable, non-regressing changes — feeding Enso
  (HIP-0512) the empirical signal it needs.
- **Human-in-the-loop is the feature, not the friction.** "Guided and observed by humans"
  is the design center: the loop's job is to make the human's review *high-leverage* (a
  gated, measured, reported diff), not to remove the human.

## Backwards Compatibility

Forward-only and inert by default. With no `Objective` enabled for a repo, the loop does
nothing; existing coding-keystone, benchmark, and research surfaces are unchanged. Enabling
the loop for a repo adds the Controller over those primitives; no existing contract
changes. The human gate and no-regression gate are strictly *additional* constraints on
landing a change, never a relaxation.

## Open Questions

1. **Gate metric set.** Which benchmark metrics are *gated* (a regression blocks) versus
   *observed* (recorded, non-blocking) per repo — and the regression threshold (exact
   equality, paired-McNemar significance, or a tolerance band).
2. **Objective auto-generation.** How much of stage 1 may be automated (an error cluster
   auto-drafting a bug objective for human approval) versus fully human-authored.
3. **Trust-ladder policy.** The exact criteria (diary track record) that let a human
   promote a repo to a higher autonomy rung.
4. **Revert vs forward-fix.** When a post-merge regression (stage 6) should auto-revert
   immediately versus open a forward-fix objective.
5. **Cost/rate bounds.** Per-repo ceilings on autonomous proposal spend and frequency.

## Reference Implementation (staging)

1. **Gate kernel first** (the safety invariant): a fail-closed verdict function that runs a
   repo's tests + the benchmark suite on a branch vs base, returns `pass/fail` with
   per-metric before/after, and records the verdict to `/v1/research`. Shippable and
   demonstrable in isolation — it is the load-bearing part and is proved before any
   autonomy is enabled. (A runnable proof-of-mechanism accompanies this HIP: a real
   RED→GREEN test-gate transition, each verdict recorded in the research-run schema.)
2. **Controller state machine** over the keystone Dispatcher (Propose) + the Gate + a
   `review` block on IAM approval, durable (HIP-0013), every transition an event.
3. **Signal adapters** — tracker issue + human dialogue objective first; error-cluster and
   benchmark-regression sources next.
4. **Measure + auto-regression-objective** closing the loop; the diary entry per attempt.
5. **Self-host enablement** — the trust ladder, gates-are-human-only, staged from low-risk
   repos.

Each stage ships and is reviewed independently (blue builds, red reviews the fail-closed
gates + the non-bypassable human approval, CTO confirms). The human gate and the
no-regression gate are the two invariants red must try hardest to break.
