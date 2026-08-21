---
hip: 1211
title: AI — The Model API
author: Hanzo AI
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-08-20
requires: HIP-0139, HIP-0026, HIP-0106
capability: ai
---

# HIP-1211: AI — The Model API

## Abstract

`ai` is the model API: the OpenAI- and Anthropic-compatible wire and the routing,
memory, retrieval and fine-tuning surfaces behind it. The implementation is the
`hanzoai/ai` module, mounted into a cloud binary by `hanzoai/cloud` `apps/ai`
with the money, ingest and telemetry callbacks cloud builds but cannot install
(`apps/ai/ai.go:1-17`). This HIP states the target address surface: the wire
family at the root, everything else under `/v1/ai`.

## Motivation

The module registers one greedy `/v1/*` door and the manifest hands it the `/v1`
remainder (`manifest/apps.go:444`), which is how a dozen satellite roots —
router, memory, rag and their compatibility twins — came to answer beside the
wire under names nobody would call a product. The document now comes from the
module's own router (`apps/ai/ai.go:75-90`), so the surface is honest about what
it is; this HIP settles which of those roots are the capability's and which are
gone.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### The wire family stays at the root

The vendor-compatible wire — `/v1/chat/completions`, `/v1/completions`,
`/v1/embeddings`, `/v1/messages`, `/v1/models`, `/v1/images/*`, `/v1/audio/*`,
`/v1/videos/*`, `/v1/responses`, `/v1/rerank` — is fixed by the protocol every
vendor SDK hard-codes, is exempt by HIP-0139 §3.2, and belongs to `ai` and to no
other capability. It MUST NOT move.

### Everything else answers under /v1/ai

Six satellite roots fold under the capability's own name, each an HTTP binding
of the module's handlers with no store of its own in cloud: the routing
policy/stats/rewards surface (`/v1/ai/router`), the org's routing settings
(`/v1/ai/org/settings`), fine-tuning jobs — the module's TrainJob broker —
(`/v1/ai/finetune`), per-user memories (`/v1/ai/memory`), the RAG surface
(`/v1/ai/rag`: embed, query, delete, context, and ingest — `/v1/docs/ingest`
writes the same index the query reads, so it folds to `/v1/ai/rag/ingest`
rather than minting a second root), the per-request routing reward
(`/v1/ai/feedback`), and the public geo aggregate of request traffic
(`/v1/ai/traffic`).

Six roots are deleted, not moved: `/v1/documents` and `/v1/query` and
`/v1/query_multiple` are compatibility spellings of routes that already exist
under rag; `/v1/dev-bridge` is desktop tooling that spawns a local child
process; `/v1/install-patch` is a device-management remnant; `/v1/wecom-bot` is
a bot channel that belongs to `bots` if it is ever productized. There is no
alias for any of them. Today's router still serves each satellite at its old
root out of the `/v1` remainder; every such pair is a line in `hanzoai/cloud`
`openapi/misfiled.txt` until the fold lands. The route moves land in the
`hanzoai/ai` module, where the router lives (`routers/wired_gen.go`).

The document is the module's own, read out of the pinned module at describe
time (`apps/ai/ai.go:39-71`); operations answer the module's envelope, whose
`data` stays untyped here because per-operation bodies are typing work in the
module that owns the handlers.

### Tenancy, money and the count

The capability owns no store in cloud; all state lives behind the `hanzoai/ai`
module. A request's tenant is the validated principal's org, and every debit and
count is keyed by that namespace and never by a body field. Metering is per
served call, self-reported by the module's one usage hook: a priced call debits
its dollar cost over the internal plane to the commerce ledger, with the
idempotency ref minted server-side per debit so a caller-supplied id can never
dedupe a second answer into a first (`apps/ai/ai.go:195-215`); a free call
counts once against its subject's plan allowance, and both halves always run
(`apps/ai/ai.go:229-256`). The plugin declares `Price: cloud.Metered`
(`plugin/ai/main.go:43`).

### Events and observability

It publishes no events on the tenant bus, so a customer's webhooks receive
nothing from this capability. It emits the `gen_ai` span family for every
completion, through the host's one tracer provider — adopted at mount so the
module cannot fork a second, dark provider (`apps/ai/ai.go:271-287`).

### Stage

`ga`, and the row is marked `Vital` (`manifest/apps.go:444`).

### Upstreams

The capability embeds `github.com/hanzoai/ai` v1.833.106 (Apache-2.0), which is
the whole implementation — router, wire, memory, rag, finetune. The OpenAI and
Anthropic wire shapes are implemented formats, not embedded code. Nothing else
here derives from an OSS upstream.

## Rationale

The alternative for the satellites was to keep them where SDK compatibility put
them and describe the exceptions. But the exemption in HIP-0139 §3.2 is exactly
as wide as the protocol: the wire paths are hard-coded in vendor SDKs and the
satellites are not — LangChain-era twins and device-management remnants have no
SDK pinning them, so they take the ordinary rule. Folding rather than splitting
follows from the store: there is none in cloud, so §7.1's default applies to
every pair.

## Security Considerations

The wrong implementation here is free inference and mis-billed inference. The
debit path is the guard on both: the charge is keyed to the validated
namespace, the ref is server-minted (a client-controlled ref let one pinned
owner/name pair dedupe every later completion into the first one's entry —
`apps/ai/ai.go:184-193`), and the free-call count runs even when the debit
fails, so neither leg's failure opens the other. Deleting the compatibility
roots is also a security act: each was an unowned door into the same index the
canonical routes guard.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
