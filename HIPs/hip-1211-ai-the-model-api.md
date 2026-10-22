---
hip: 1211
title: AI — The Model API
author: Hanzo AI
type: Standards Track
category: Infrastructure
status: Final
implementation-go: partial
created: 2026-08-20
updated: 2026-10-22
requires: HIP-0139, HIP-0026, HIP-0106, HIP-1173
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

An org can also route a model id of its own to an engine on its own overlay.
That is proposed by the Amendment below and is not served yet.

## Amendment: routes to an org's own machines (proposed)

Proposed with HIP-1172's amendment, which starts the engines these routes reach.
Nothing in this section is served today; the org route below is still to be
built in `hanzoai/ai`. It retires one way of reaching an org's engine that
exists today: a provider row added by a SuperAdmin at `POST /v1/ai/providers`
(the `add-provider` endpoint), which is global rather than the org's and whose
URL nothing checks, and the Go control binary's `--register-provider`, which
calls it.

### R1 The address

`/v1/ai/routes` is the org's own model routes: a model id the org owns that
resolves to an engine on the org's overlay (HIP-1173).

- `GET /v1/ai/routes` — any member of the org.
- `POST /v1/ai/routes` — an admin of the caller's own org (HIP-0118); no
  SuperAdmin needed. HIP-1172's compute registers a workload's route through the
  same operation, acting for the activity's org.
- `DELETE /v1/ai/routes/local/{label}/{name}` — an admin of the org, or compute.

```json
{
  "model": "local/evo/zen6-flash",
  "upstream": "zen6-flash",
  "endpoint": "http://evo-1.acme.zt/v1",
  "token": "<bearer the endpoint requires>",
  "price": {"input": 0, "output": 0},
  "fallback": "",
  "bodies": false
}
```

- A route is keyed by `(org, model)`, and a request resolves a route only within
  its own validated org. Two orgs MAY hold the same `model`; neither ever
  reaches the other's.
- `model` is `local/<label>/<name>`, each part lowercase `[a-z0-9._-]`, at most
  128 bytes in all. `local/` is reserved for routes: no hosted id begins with
  it, and neither `auto` nor the Enso router (HIP-0510) ever resolves to a
  route, so only a request that names a route's id exactly reaches it. A second
  route with the same key is 409. compute names a workload's route
  `local/<node>/<model>`, from the last segment of the repository path.
- `upstream` is the id the endpoint's `/models` lists.
- `token` is write-only and sealed in the platform's KMS (HIP-1134), not the
  org's, so no org admin can read it back; no read answers it.
- `price` is USD per thousand input and output tokens, zero unless the admin
  sets it, never negative, and at most the deployment's ceiling from the price
  list (HIP-1222).
- `fallback` is a hosted model id, or empty, which is the default.
- `bodies` records prompt and completion bodies; it is off by default.
- `node` and `workload` are set by compute alone; a route carrying them is
  deleted with its workload. A route without them is probed every 60 s and
  deleted after three failures in a row.
- An org holds at most 64 routes.

### R2 What an endpoint may be

- It MUST be `http://<label>.<org>.zt[:<port>]/<path>`: `<label>` one DNS
  label, `<org>` the caller's org name as IAM holds it, compared byte for byte
  with nothing folded, and no userinfo, query or fragment. Anything else is 422
  and nothing is dialled.
- It is dialled only through the overlay's SDK under the gateway's identity,
  never through system DNS and never to an address, so it cannot reach the
  cluster, a metadata service or the internet. That identity can dial every
  org's names, so the suffix check is the tenant boundary.
- At create, `GET <endpoint>/models` with the token MUST answer 200 within 10 s,
  as JSON, in at most 1 MiB, without a redirect, listing `upstream` in
  `data[].id`; otherwise 422 with the reason.
- Plain http is correct here: the overlay authenticates both ends and encrypts
  the connection.

### R3 Serving

A request naming a route's `model` is sent to the endpoint with `upstream` as
its model.

- **Headers in.** The gateway sends the body, `Content-Type`, `Accept` and
  `Authorization: Bearer <token>`, and no other header of the caller's: no key,
  cookie or identity header reaches the machine.
- **Answers out.** The gateway relays an answer only as `application/json` or
  `text/event-stream`; any other type is 502. It relays the status,
  `Content-Type` and the body and no other header of the machine's, and it
  overwrites `model` in every JSON body and every event with the route's
  `model`, so a machine cannot claim to be another model.
- A streamed answer is relayed as it arrives, and a client that goes away
  closes the overlay connection. A request that names media by URL is refused
  with 400: send media inline.
- If the endpoint fails before a response begins (no connection, or a 401 or
  5xx status), the request goes to `fallback` when the route names one, and
  otherwise answers 503 `route_unavailable`. Once a response has begun there is
  no fallback; a stream ends with an error event, and a non-streamed request
  answers 502.
- **A fallback is a hosted request.** It passes the same plan, allowance and
  balance gates a request naming the hosted model directly would, and when a
  gate refuses, the caller gets that refusal. A machine that always fails buys
  its org nothing it could not already buy.
- A fallback is never implicit: an org that routes to its own machine chose where
  its prompts go, and a silent hosted fallback would send them elsewhere.

### R4 Usage, logs, money

- Every request is one usage record through the module's one usage hook, keyed
  to the validated org: provider `node`, model the route's, tokens as the engine
  reports them, cost `price` times tokens. A count that is negative or missing
  is zero, so a machine can lower a bill to nothing and never below it.
- At price zero nothing is debited and no hosted allowance is drawn. A nonzero
  price is debited like any priced call.
- A request served by `fallback` is recorded as the hosted model's, at the
  hosted price, with `fallbackFrom` naming the route. The route records nothing
  for it. One request, one record, one debit.
- A stream cut before the engine reports usage is recorded with the tokens the
  gateway relayed, marked partial, and billed no more than that.
- The generation is the same `gen_ai` span a hosted call emits, with
  `gen_ai.hanzo.node_id` and `gen_ai.hanzo.workload_id` beside the org the
  server stamps. The generation read (HIP-1240) shows them as `node` and
  `workload`. No body is recorded unless the route's `bodies` is on.

### R5 Acceptance

1. An org admin creates `local/evo/zen6-flash` to `http://evo-1.acme.zt/v1`. The
   same call with `.other.zt`, an IP, `localhost`, a public https URL or a URL
   with userinfo answers 422 and dials nothing. A member who is not an admin
   gets 403.
2. Org B creating `local/evo/zen6-flash` gets its own route; a request from org
   A naming that id reaches org A's route, and one from an org with no such
   route gets the unknown-model answer.
3. No read returns `token`, and no org KMS path holds it.
4. With `fallback` set and the endpoint unreachable, a request is served by the
   hosted model and leaves exactly one usage record, the hosted one, with
   `fallbackFrom`. Without `fallback` it answers 503 and debits nothing. An org
   whose plan or balance refuses the hosted model gets that refusal, not an
   answer.
5. A linked-model call at price zero leaves a usage record with cost 0, the node
   and workload attributes, and no body.
6. A caller's `x-api-key`, cookies and identity headers never reach the
   endpoint, and a `Set-Cookie` from the endpoint never reaches the caller.
7. An endpoint answering `text/html` yields 502; one answering
   `"model": "zen6"` reaches the caller as `"model": "local/evo/zen6-flash"`.
8. `auto`, an Enso id or a hosted id never resolves to a route.

## Motivation

The module registers one greedy `/v1/*` endpoint and the manifest hands it the `/v1`
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

Which model a request names is HIP-0511's map: Zen ids generate, `auto` and the
`enso*` ids are resolved by the Enso router (HIP-0510) before provider and
billing resolution, and decisions go to Kai at `/v1/decisions` (HIP-1332), not to
this wire.

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
a bot channel that belongs to `bot` if it is ever productized. There is no
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
roots is also a security act: each was an unowned endpoint into the same index the
canonical routes guard.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0118 — SuperAdmin and Tenant Isolation
- HIP-0139 — Capability
- HIP-0510 — Enso, the router family
- HIP-0511 — Model families
- HIP-1134 — KMS — Secret Custody
- HIP-1172 — Compute — Machines You Rent or Link
- HIP-1222 — Pricing — The Price List and Who May See It
- HIP-1173 — Network — An Org-Scoped Overlay
- HIP-1240 — O11y — The Observability Plane
- HIP-1332 — Kai, the decision model

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
