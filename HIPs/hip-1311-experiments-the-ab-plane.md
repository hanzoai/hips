---
hip: 1311
title: Experiments — The A/B Plane
author: Hanzo AI
type: Standards Track
category: Interface
capability: experiments
status: Draft
created: 2026-08-20
requires: HIP-0017, HIP-0026, HIP-0106, HIP-0139
---

# HIP-1311: Experiments — The A/B Plane

## Abstract

`/v1/experiments` is where a comparison is registered, run and settled: two or
more arms, a deterministic assignment, an outcome measured against the control,
a decision that locks the winner. The implementation is `hanzoai/cloud`
`apps/experiments`.

It is a **composition, not a fourth engine**. It owns the experiment registry
and nothing else — assignment comes from `flags`, outcomes from the analytics
warehouse (HIP-0017), evidence from the research record (HIP-1145). Each of
those already has an owner, and none is copied here.

## Motivation

This capability shared HIP-0063 with `flags` — two specifications in one file,
which HIP-0139 §6 allows only for a merge in flight. The store boundary is where
the two separate: flags owns definitions in a per-(org, project) file and
evaluates them as a pure function; experiments owns a per-org registry of
comparisons and composes that evaluation.

The boundary is load-bearing rather than tidy. Flags is the primitive every
other plane composes — admission, stage gating (HIP-0139 §8.2), traffic splits
in subsystems that never touch this surface. An experiment is one caller of it,
and filing the caller's specification inside the primitive's makes the primitive
read as though it existed to serve A/B tests, which is the wrong way round.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The addresses

Seven operations, every one under `/v1/experiments` (`manifest/apps.go:411`,
`plugin/experiments/openapi.json`), all typed, none declared:

- `GET|POST /v1/experiments` — list; create, which writes the multivariate flag
  definition the arms are served from
- `GET /v1/experiments/{id}` — read, with results
- `GET /v1/experiments/{id}/assign` — the arm for a subject
- `POST /v1/experiments/{id}/analyze` — run the analysis over the evidence
- `POST /v1/experiments/{id}/decide` — stop, and lock the winner by rewriting
  the flag definition's weights to 100%
- `GET /v1/experiments/health`

Create and decide both write a flag definition, deliberately: the arm a request
is actually served comes from the flag, so an experiment holding its own copy of
the split would be a second answer to one question, free to disagree with the
answer serving traffic.

### §2 Assignment is the flags hash

Assignment MUST be the same deterministic rollout hash the flags surface
evaluates — `flags.Assign`, in process, no network hop — so a subject's arm is
one value whether read here, evaluated at the flags door, or composed by another
subsystem in the binary (`apps/campaign` splits traffic the same way).

Because the hash is a pure function of subject, key and seed, there is no
assignment store: stickiness is a property of the arithmetic rather than of a
row somebody has to keep. Changing the seed reshuffles the arms on purpose;
nothing else does.

### §3 The outcome, and the analysis that ships

Outcomes MUST be read from the one analytics plane rather than a second exposure
topic: the analyze fold reads each subject's outcome from the org-scoped event
query and joins it to the arm by subject id (`apps/experiments/analyze.go`). A
serving surface that records an exposure records an ordinary analytics event
through the same capture door as every other event (HIP-0017) — no separate
stream, no emitter in the request path.

The analysis is one method: a two-proportion z-test against the control arm over
the append-only evidence rows, computed with stdlib `math.Erfc` and no
dependency (`apps/experiments/analyze.go:83,152-166`). Degenerate input — an arm
with no subjects, a control with no conversions — MUST be answered as degenerate
rather than scored, because a p-value printed over an empty arm is the one
output of this surface a reader would act on and should not. Richer methods are
open design; any that lands MUST evaluate through §2 rather than a second
bucketing.

### §4 Tenant, store, price, emission, stage, upstream

The org is the validated principal's — `principal.Org`, and `principal.Project`
where the flag definition is scoped (HIP-0026) — never a client-supplied header.
The credential is the org's ordinary bearer, there is no key family specific to
this surface, and an unauthenticated caller is refused.

It owns one store: the experiment registry, a per-org SQLite file
(`{DataDir}/orgs/{slug}/experiments.db`, `apps/experiments/store.go:3-9`).
Isolation is physical, so a cross-tenant read is not a predicate that can be
wrong. It owns no assignment store (§2), no definition store (flags'), no event
store (analytics') and no evidence store (research's).

It is free, in those words: `Price: cloud.Free`
(`plugin/experiments/main.go:22`). It publishes no events on the bus, so a
customer's webhooks (HIP-1310) receive nothing from it — exposure reaches the
warehouse from the surfaces that serve the traffic. It emits nothing to
observability beyond the request span every route gets.

The stage is `beta` (HIP-0139 §8): the manifest row declares it, so an org
reaches the surface by the `experiments` flag and it is in no generated client,
tool list or public page. `flags` itself stays `ga` — it is the mechanism
stage-gating rides, so it cannot sit behind a flag. It derives from no OSS
upstream: the significance test is stdlib arithmetic and the evaluator it
composes is `flags`.

## Rationale

The alternative is an engine of its own — its own bucketing, its own exposure
topic, its own metric store. Each is a second copy of something that has an
owner, and the copies fail in one direction: the arm a dashboard reports is not
the arm the request was served, because two hashes drifted or two topics were
configured apart. Composition costs a function call and removes the class.

The other alternative — no registry, experiments expressed purely as
multivariate flags — loses what makes a comparison settleable: which arm is the
control, what the primary outcome is, and when it was decided. That is what the
registry holds, and why §4's store boundary exists at all.

## Security Considerations

The wrong implementation writes another tenant's traffic split. Decide rewrites
a flag definition to 100% of one arm, so a cross-tenant write here is a stranger
choosing which model, price or copy another org's customers are served — and it
would read as an ordinary experiment concluding. The per-org file in §4 is what
makes that unreachable rather than merely refused.

The read side is a roadmap: an org's experiment roster names what it is about to
ship and to whom. The exposure record carries the subject identifier and the arm
and MUST NOT carry request or response content — outcome values are aggregates,
so no prompt, completion or document reaches this plane.

## References

- HIP-0017 — Analytics Event Standard
- HIP-0026 — Identity and Access Management
- HIP-0063 — Feature Flags Standard
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1145 — Research — The Experiment Record

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
