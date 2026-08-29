---
hip: 0516
title: Translate — One Endpoint, Two Tiers, Permissive Weights
author: Hanzo AI
type: Standards Track
category: Core
capability: translate
status: Final
created: 2026-07-26
requires: HIP-0026, HIP-0139
---


# HIP-0516: Translate — One Endpoint, Two Tiers, Permissive Weights

## Abstract

`POST /v1/translate` is the one translation surface: a quality tier served by
the model plane and a bulk tier served by MADLAD-400. Both sit behind one
endpoint, so callers choose cost and latency, never a vendor. The translation
memory beside it is normative, not a cache — it is what makes a locale rebuild
idempotent under a non-deterministic model. The implementation is
`hanzoai/cloud` `apps/translate`.

## Motivation

LLM output is non-deterministic, so a naive rebuild rewrites every string in
every locale file. That churn is the main thing a hosted translation
management product was actually providing, and it must be replaced rather than
dropped. The second forcing fact is licensing: the most cited open translation
weights are non-commercial and unusable in a paid service, so which model
serves the bulk tier is decided by license before quality gets a vote.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The address

Every route is under `/v1/translate` (`manifest/apps.go:437`): three
operations. `GET` and `PUT /v1/translate/memory` — the review lane — are
typed. `POST /v1/translate` itself is a raw handler with prose declared beside
the route (`apps/translate/translate.go:59`): its input is a union (`text` or
`batch`, never both) that a single typed `In` cannot state honestly, so the
capability's only product route carries a full declared description instead of
an operationId and nothing else.

### §2 Two tiers, no fallback

`tier` selects the engine and defaults to `quality`:

- **quality** routes to the model plane (`deps.AI` — zen through the gateway),
  which carries context, terminology and tone. Our own S2ST measurements found
  the LLM path beat a joint translation model on fluency, so this default is
  evidence rather than fashion.
- **bulk** routes to MADLAD-400 under CTranslate2, reached over a small JSON
  contract so the weights are served independently of this binary
  (`apps/translate/engine.go`). A deployment with no bulk backend answers 503
  for that tier. Bulk MUST NOT fall back to quality: a caller is never quietly
  served — or charged — at a tier it did not ask for.

The license decides the bulk model before quality does. MADLAD-400 3B/10B and
Opus-MT/Marian are permissively licensed (apache-2.0, MIT); NLLB-200,
SeamlessM4T v2 and TowerInstruct are cc-by-nc-4.0 and unusable in a paid
service — verified against the Hugging Face model API, not from memory, after
an audit found NC weights shipping inside our repos. LibreTranslate is
excluded as a component: AGPL-3.0 reaches through a hosted service.

### §3 The memory is normative

Every string keys on `(source_text, target, glossary_version, tier)`; a hit
returns the stored value verbatim and never re-translates, so only new or
changed source strings reach an engine — locale rebuilds are idempotent and
the bill is proportional to what changed. Editing a glossary term changes the
key, so a stale rendering can never be served.

The review lane rides the same memory: an entry carries a state on the ladder
machine → suggested → approved → published, and a machine write may create a
row or refresh one still at `machine`, nothing else
(`apps/translate/memory.go`). A rebuild can never silently revert a string a
human approved.

The store is one SQLite memory per org, opened through `cloud.OrgStore` under
the name `translate` (`apps/translate/translate.go:181`) — a distinct org
resolves to a distinct file, so a query in one org cannot reach another's
rows. Submitted text is customer content: it lands only in that org's own
memory, is not training data, and is not retained anywhere else.

### §4 Tenancy

The org is the validated principal's (HIP-0026); a request without one is
401/403, and the memory read back at `/v1/translate/memory` is always the
caller's own org's.

### §5 Money

The surface declares `cloud.Metered` (`plugin/translate/main.go`) and is
listed in the standing gate (`spend.go:319`, "per-character fee"). The two
tiers bill through two planes, deliberately: quality is debited by the model
plane's own token meter — a second charge here would double-bill — while bulk
carries its own per-org gate and meter on the source characters that actually
reached the engine (`apps/translate/translate.go:340,361`), priced by
`TRANSLATE_PRICE_UUSD_PER_1K_CHARS` (default 20 micro-USD per 1000
characters, `apps/translate/engine.go:234`). A fully-cached rebuild reports
zero characters and costs zero.

### §6 Events and telemetry

It publishes nothing on the bus; a customer's webhooks receive no
`translate.*` events. Beyond the request span it emits only its own log lines.

### §7 Upstream

MADLAD-400 3B/10B weights (apache-2.0) served under CTranslate2 (MIT) are the
bulk engine — spoken to over the JSON contract in §2, not linked into the
binary. The memory rides `github.com/hanzoai/sqlite` (MIT / Apache-2.0 dual).
Nothing is forked.

### §8 Stage

`beta`: the manifest row declares `Stage: Beta` (`manifest/apps.go:437`), so
per HIP-0139 §8 the capability is dropped from the public projection and its
prefix answers 404 unless the caller's org holds the `translate` flag.

### §9 Dogfooding

The locale sync that replaced the hosted translation vendor calls
`/v1/translate` like any other client. Our own product translation is the
reference deployment, which keeps us honest: a regression shows up in our own
surfaces first.

## Rationale

The alternative to one endpoint with a tier field is two products — an LLM
translator and a bulk MT service — each with its own auth, meter and memory.
That doubles every projection and, worse, splits the memory: the same source
string translated on both products would have two histories and the review
lane would have to reconcile them. One endpoint, one memory keyed by tier,
keeps a string's history in one place.

## Security Considerations

Submitted text is customer content and the memory is the disclosure surface:
tenancy is a separate database file per org (§3), so a cross-tenant read
requires opening the wrong file rather than forgetting a predicate. The wrong
billing implementation charges twice (an edge fee on top of the model plane's
tokens) or silently serves bulk work on the quality tier at quality's cost —
both are refused structurally: the edge declares `Metered` and adds nothing,
and there is no cross-tier fallback (§2). The review ladder is an integrity
boundary: a machine write that could touch an approved string would let a
rebuild rewrite reviewed legal or safety copy without a human in the loop.

## References

- HIP-0026 — Identity and Access Management
- HIP-0111 — IAM authentication
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
