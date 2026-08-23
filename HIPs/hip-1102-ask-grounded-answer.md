---
hip: 1102
title: Ask — The Grounded Answer
author: Hanzo AI
type: Standards Track
category: Interface
capability: ask
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1102: Ask — The Grounded Answer

## Abstract

`POST /v1/ask` answers a plain-language question with real numbers. A question
about the caller's own business is classified to a grounded domain — books (the
ledger), projects, git (the forge inventory), or the live web — that domain's
read runs in-process under the caller's own credentials, and the model narrates
the figures it is handed, never sourcing one. It is implemented in
`hanzoai/cloud` at `apps/ask`, over the answer engine in `apps/answer`.

## Motivation

Raw completions live at the model wire and the tool-calling orchestrator at
`/v1/agent`; neither promises that a figure in the answer is a value something
actually read. A founder asking "what's my MRR" needs the number to be the
ledger's, and a wrong answer to be a wrong query rather than an invention. One
endpoint, one contract: figures are computed before any model call and returned
unaltered (`apps/ask/ask.go`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store

It owns none. The contributor registry is built at mount; every domain is a peer
asked over the internal plane, because this app ships as its own process and the
data it grounds in does not live in it.

### §2 Addresses

`POST /v1/ask` is declared with prose beside the route, not typed, and each
blocker is a wire fact measured by `apps/ask/typed_wire_test.go`: one route
answers two success shapes (the advisor's five-key answer and the web engine's
different eight-key one); the web branch streams server-sent events when asked
to, which no typed Out can mean; and the out-of-funds refusal is a domain body
at 402/503, not the flat typed error. The request IS declared so generated SDKs
have somewhere to put the question; the response deliberately is not, because a
single declared shape would be false for the other branch
(`apps/ask/ask.go:102-132`). `POST /v1/ask/web` is the same engine as a typed
op — the endpoint a model can call, added because an untyped route reaches REST and
nothing else, leaving the fleet's research loop invisible to every agent in it
(`apps/ask/web.go`).

### §3 Tenancy

A validated principal is required — 401 without one — and the gather runs AS THE
CALLER: `cloud.As(c, "")` carries this request's principal onto the peer call
with no widening, so a question is only ever asked about the asker
(`apps/ask/ask.go:180,223`). The git domain reads the forge inventory as the
caller too, because a machine read would count private repositories the member
may not open (`apps/ask/git.go`).

### §4 Money

The capability is metered (`plugin/ask/main.go`, `cloud.Metered`; the
`meteredApps` row reads "the answer engine's per-question fee",
`spend.go:291`). The web modes debit a flat per-answer fee in cents through the
per-org ResourceMeter — `Bill.Gate` before the loop, `MeterUsage` after
(`apps/answer/answer.go:135,365-372`) — at the mode's default (search and news
2¢, research 25¢, `apps/answer/mode.go:56-68`), overridable per deployment via
`CLOUD_ASK_FEE_CENTS[_<MODE>]`; a negative or invalid override is ignored so a
typo can never make a paid mode free. The figure-advisor branch's one narration
completion is billed to the caller's ledger through the ai plane
(`apps/ask/ask.go:277`).

### §5 The grounding contract

Every figure in the answer MUST be a real domain read. The Figures array is the
contributor's, computed before any model call and returned unaltered; the model
rewrites prose only, and with the model absent or down the deterministic
template states the same figures. A gather error degrades to an honest fallback,
never a guessed number. If no domain can ground the question, the advisor says
so.

### §6 Events, telemetry, stage, upstream

It publishes nothing to the bus. Beyond the request span it emits structured log
lines only. Stage `ga`: the manifest row (`manifest/apps.go:436`) declares no
stage, and absent means `ga`. It derives from no OSS upstream.

## Rationale

The alternative is to let the model answer from its own memory and cite
afterwards. That reads better on the day it is wrong, which is the failure this
exists to make impossible: the narration seam is strictly read-only, so handing
a language model the ability to answer questions about a ledger costs nothing in
integrity — the same posture `apps/books` takes with its own ask surface.

## Security Considerations

The wrong implementation is a cross-tenant oracle: an advisor that gathered with
a machine credential instead of the caller's would answer any org's revenue to
anyone signed in. The in-process replay under the caller's own principal is the
whole boundary — there is no widening parameter, so there is no place to pass a
different org. The second exposure is economic: a streaming, model-driven loop
must be admitted through the money gate before it runs, which `Bill.Gate` does
at the mode's fee.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
