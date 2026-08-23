---
hip: 1261
title: Label — Ground Truth
author: Hanzo AI
type: Standards Track
category: Application
capability: label
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1261: Label — Ground Truth

## Abstract

`/v1/label` is the ground-truth plane of the risk product: what actually turned
out to be fraud, who said so, and when they could first have said it. It closes
the loop the decision plane cannot close for itself — `/v1/risk` decides, and
the answer key arrives late, from several places, sometimes in disagreement:
a charge-off, an adjudicated dispute, a closed compliance case, a fraud-reason
refund, an analyst's review, a judged sample (`apps/label/label.go:1-13`). It is
implemented in `hanzoai/cloud` at `apps/label`. This HIP is where HIP-1046 §6's
subtree now lives; HIP-1046 keeps the invariants that hold across the planes.

## Motivation

A label that fed an adverse action is a compliance record. Its writers are
mostly not the decision plane — commerce adjudicates the dispute, the
compliance face closes the case, an analyst files the review — its readers are
the dataset materialiser and the evaluator, and its retention clock is its own:
the label's life is not the life of the decision that cited it
(`apps/label/label.go:55-63`). Own writers, own readers, own clock is why this
is its own capability rather than a subtree of `risk`.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### The store

The record is the tenant's own encrypted SQLite file, opened per organization
through `cloud.OrgStore` under the name `label` (`apps/label/label.go:158`).
`hanzo.risk_label` in the shared warehouse is a DERIVED mirror for joining at
training scale (`apps/label/mirror.go:85`, `:213`): the record is written
first, and the mirror's failure is reported rather than fatal. Nothing here
rides the best-effort event path.

Every writing operation ships the tenant's file to its durable object before it
answers, and an unacked ship fails the request (`apps/label/label.go:259`).
This is not optional: the deployment recreates the process on every rollout and
the successor hydrates the durable snapshot OVER the local file, so a write
acknowledged but not shipped would be overwritten by an older copy of the same
tenant's history on the ordinary path (`apps/label/label.go:48-54`).

### The address

The capability answers under `/v1/label`: filing and listing assertions at the
root, `resolve`, `coverage`, `vocabulary`, `hold` and `dispose`
(`apps/label/typed.go:165-189`). Every operation is typed. The name is
singular by HIP-0139 §2.2 — there is no `/{id}` member route, so this is a
faculty; if a per-assertion read is ever proposed, the name question MUST be
settled before that route ships, because a later flip to `labels` is a second
wire break. Today's router still serves this surface under `/v1/risk/labels`;
that pair is carried by `hanzoai/cloud` `openapi/misfiled.txt` and closes by
fold.

### The record's three properties

- **Latency.** Every assertion carries when the event happened, when the filer
  says it became knowable, and the DERIVED instant — the later of the filer's
  claim and the server clock at the write, never supplied
  (`apps/label/label.go:17-27`). Resolution takes an observation instant and
  shows only what was knowable then; the guard MUST read the derived instant,
  because a guard whose only input is a caller-chosen value is exactly as
  strong as the caller's honesty.
- **Conflict.** Assertions that disagree BOTH stay; a total order over
  adjudication weight picks the one in force and returns the losers beside it
  (`apps/label/resolve.go:146`). There is no UPDATE statement in the package.
- **Provenance.** Every assertion names its source, its evidence, and the
  identity that filed it, the last stamped server-side from the validated
  principal; a label with no evidence is refused at the endpoint
  (`apps/label/label.go:35-41`).

`hold` places the record behind an answer under litigation hold by its content
digest (`apps/label/typed.go:189`, `apps/label/zipdoc_gen.go:151`); `dispose`
is the tenant's own retention decision. A held record MUST NOT be disposable
while the hold stands.

### Tenant, meter, events, observability, stage

The organization comes from the validated principal
(`apps/label/label.go:196`) and a request without one is refused with 403
(`apps/label/label.go:194-198`); the per-org file makes the cross-tenant read
unspellable rather than merely forbidden. The capability is free, in those
words (`plugin/label/main.go:29`, `Price: cloud.Free`). It publishes no events
on the bus. Beyond the request span it registers nothing; the mirror's failure
is reported in the answer rather than counted in a private metric. Its stage
is `beta`.

### Upstream

It derives from none: no OSS project is forked, embedded or mirrored.

## Rationale

The alternative is a `labels` table inside the decision plane's store. It is
one fewer process and it braids two lifetimes: retention policy written for
decisions would silently govern compliance records, and the decision plane's
single-writer store would gain a second class of writer. A separate per-tenant
file keeps one owner per file and lets the record outlive the decisions it
judges.

The mirror exists because training-scale joins over thousands of per-tenant
files are not a query; it is derived and second so that losing it loses
nothing.

## Security Considerations

This plane feeds adverse decisions about people, so its integrity is the
attack surface. A forged or back-dated label poisons every training set built
after it — which is why the knowable instant is server-derived and the filing
identity is stamped from the principal, never taken from the body. A deleted
contested label would resolve a dispute into silence — which is why conflicting
assertions both stay and there is no UPDATE. A cross-tenant read is one
organization's fraud history handed to another — which is why the tenant is a
file, not a predicate. And a record that vanished before litigation ended is
spoliation — which is why hold outranks dispose.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1046 — Risk

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
