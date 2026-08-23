---
hip: 1190
title: Event — The Product Analytics Plane
author: Hanzo AI
type: Standards Track
category: Core
capability: event
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0135, HIP-0139
---

# HIP-1190: Event — The Product Analytics Plane

## Abstract

`/v1/event` is product analytics: send an event, read back who did what. It is
both halves on purpose — one write core behind every ingest endpoint, and the read
lenses over the same warehouse — so a fact is admitted, stamped with the
server-resolved tenant, and read back through one vocabulary. It is implemented
in `hanzoai/cloud` at `apps/event`.

## Motivation

A product event is a claim about somebody's customers, arriving from a browser
that nobody controls. Two things decide whether the claim is worth anything: who
it gets filed under, and whether the caller is told the truth about what landed.
Both are properties of the endpoint, not of the warehouse behind it. Putting the
endpoints and the lenses in one capability is what makes the answer to "what did we
store" and the answer to "what can you read" the same sentence.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store

It owns none, and the discipline that follows from that is the point. The event
plane's schema belongs to `hanzoai/o11y` and this capability MUST NOT create or
migrate it: it is a writer and a reader there, no more
(`apps/event/capture.go:88-97`). A lens over a table it does not own answers
honest-empty when that table is absent rather than erroring
(`apps/event/mount.go:524-531`). The one table it touches with a
statement of shape is the model surface's usage ledger, ensured idempotently so
that a fresh warehouse yields honest zeros instead of an error. It holds no
connection either — one datastore client serves the whole binary, opened from
KMS-injected credentials on first use.

What it DOES own is the grammar of the plane: the subject a fact travels on, the
durable a consumer binds, and the envelope both vocabularies are read out of.
Those are one decision, and a consumer that also published would be a second
owner of all three (`apps/event/bus.go:478-487`).

### §2 The addresses

**Typed.** `GET /v1/event/overview` (the caller org's KPIs for one window),
`GET /v1/event/timeseries` (usage over time as an evenly-spaced series),
`GET /v1/event/top` (five ranked lenses at once), `GET /v1/event/errors` (the
org's most recently captured errors, newest first),
`GET /v1/event/insights/events` (its most recent product events, newest first),
`GET /v1/event/insights/health`, and `GET /v1/event/health` — which declares
BOTH statuses it answers with, so a degraded probe carries the degraded report
as its body instead of an empty error.

These read under `/v1/event` because a lens over the plane this capability
writes is not a second capability: it owns no store of its own to be one with
(§1). Five stems — `/v1/analytics`, `/v1/errors`, `/v1/insights`, `/v1/replay`
and `/v1/event.js` — folded here (HIP-0139 §7.1), and two of those folds cost
real callers rather than being aliased, because §7 has no fourth way. The tag is
embedded as a script `src` in customer HTML, so a page nobody re-embeds stops
reporting; the replay path is compiled into deployed bundles, so they ship no
replays until they rebuild. Both are stated because a spec that omits the cost
of its own fold is a spec somebody pays for by surprise.

**Declared with prose, and why each cannot be a value.**

`POST /v1/event` is the one endpoint for every wire a surface emits, dispatched by
the SHAPE of the body and never by a second path: a bare event object, a bare
array of them, the `{batch:[…]}` and `{events:[…]}` envelopes, and the wire
spelled `distinct_id`/`api_key`. Batch is a body, not a path — there is no
`/v1/event/batch`, because an array already is one. It cannot be a typed
operation for two independent reasons. A bare JSON array decodes into no struct,
and a typed operation refuses a body it cannot unmarshal before the handler
runs. And admission is decided from facts that live only on the raw request:
which of three carriers presented the credential, the client address and the
socket peer the caps key on, the do-not-track and global-privacy-control
headers, and the body whose LENGTH is the reduced lane's 64 KiB bound and whose
first non-space byte selects the wire.

`GET /v1/event/tag.js` answers JavaScript. The hosted tag is the whole install for a
surface with no bundler, and it is served here, beside the endpoint, because a tag
that drifts from its wire is a tag that 400s: the two ship in one binary and
version together. A script is not a value.

`POST /v1/event/{project}/envelope` and `POST /v1/event/{project}/store` carry
the error-SDK wires, whose spelling those SDKs own. The DSN key authenticates
itself, so there is no Hanzo principal on this path by design; the whole request
travels — path, query, headers and body — and the answer is relayed VERBATIM,
because a 401 is the SDK's signal to stop retrying and must not be reshaped into
this API's error envelope.

`POST /v1/event/replay` takes a session-recorder snapshot batch. It is opaque, bound
for a different consumer on a different transport, and lands no warehouse row at
all — so it is not one of the endpoints and cannot be, since every endpoint is a wire
that decodes to events and flows through the one write core. What it shares is
the half that matters: admission, resolved by the same resolver and refused in
the same words. A produce failure is a 503, never a 200: the produce is the
commit point, and a fire-and-forget would turn the receipt into a maybe.

**The receipt is the same everywhere.** Every endpoint and every lane answers
`{accepted, dropped}`, and the two always total what was sent — a beacon is
never silently discarded. The status says whether anything landed, so a green
answer can never mean an empty warehouse: 200 means at least one event was
stored, or that nothing was sent; a nonzero `dropped` beside a nonzero
`accepted` is a PARTIAL batch, never a failed one, because a batch is not
refused whole for its worst element. If nothing was stored the answer MUST be an
error naming the one thing that fixes it.

### §3 The boundary

Three capabilities touch telemetry, and a reader will confuse them. The split is
by whose data it is and who owns the schema.

**metrics** is the rail for a deployment's own logs, metrics and traces at
`/v1/logs`, `/v1/metrics` and `/v1/traces`: append a record, read the series
back over a range. Ingest and query, no product vocabulary.

**o11y** (HIP-1240) is the observability plane: the query engine, the dashboards
and alerts, the error-tracking face, and — the fact that decides this boundary —
the OWNER of the `event.*` schema. Anything that creates or migrates a table on
that plane is o11y's, and this capability MUST NOT issue DDL against it.

**event** is the product event: what a person or a surface DID, admitted at the
beacon endpoint under a publishable key, and the per-org lenses read back over it.
The beacon endpoint is this capability's name as well as its address — `/v1/event`
is what `@hanzo/event`, the hosted tag and HIP-0132's telemetry ingest all
hard-code — and it MUST NOT be re-served under another: a minted DSN keeps addressing `/v1/event` unchanged, and the
error wires it carries are forwarded to o11y over the internal plane rather than
reimplemented here. In the other direction, an error a customer sends to
`/v1/event` reaches the same surface a native SDK reaches, because the accepted
batch is handed to o11y's own sink.

One more line, because money is nearby: **usage** (HIP-1313) is the metered
record a customer is billed on. The LLM lens READS that ledger and asserts
nothing about it. A lens is not a source of billing truth.

### §4 The tenant

Two kinds of caller, one rule: the org is server-resolved, never a field on the
wire and never a client header.

**Reads** resolve `principal.Acting` — the org minted from the validated
bearer's owner claim (HIP-0026) — and refuse 403 without it, which also closes
the direct-to-pod path where an identity header is restored but no user is.
Every warehouse query binds the org POSITIONALLY, so even a token with wide
scope cannot read another org's rows.

**Writes** go through one resolver in a strict trust order
(`apps/event/event.go:167`): a validated bearer or an org API key; then a
publishable `pk-` key on `Authorization`, on `x-hanzo-ingest-key`, or in an
`ingest_key` query parameter for `navigator.sendBeacon`, which cannot set
headers; then, last, a signed workspace session, which is the only credential
that can resolve at REDUCED capability because it is the only one issued to a
principal weaker than "holds an API key". Last because it is narrowest: a
request holding both is attributed to the deliberate API credential and never to
whatever tab it came from.

A `pk-` resolves WHICH tenant a beacon belongs to and nothing more. It never
authenticates and can read nothing — not the org's errors, not a lens, not any
other route on this API. So a leaked one lets a stranger write into a stream and
never lets one read out of it, and reading rows back always takes a real bearer.

**No credential is refused into a shared tenant.** There is no reserved
anonymous tenant (`apps/event/public.go:115`). A write the server cannot
attribute to a project is 401 `ingest_key_required`, and a credential that is
presented but resolves to no project is 403 `ingest_key_unknown`. Events nobody
can read are worse than events nobody sent, because the caller was told it
succeeded.

**The reduced lane writes through a projection**, not a filter. It is narrowed
to what the SERVER can name, and each name resolves through a server-owned table
and is stored as that table's value, so the name on the wire is never the name
in the row — one spelling and its variants are one name, not two. It is a fresh
value built from the fields the projection names, so a field it does not name
cannot reach a row at all, and an exception is carried on the error kind and
nowhere else, so an interaction cannot ship a stack trace into its attributes.
It does not name the person: the signed account is the identity, so a
`distinctId` in the body cannot pin events on a colleague. The browser ids it
does supply are stored under a reserved prefix no identified subject can carry,
so an unattested row can never join, in any lens, to a person the org actually
knows. Everything refused is counted in `dropped`.

The tenant is stamped where the row is BUILT, once, so a caller can only ever
write into its own partition.

### §5 Money

Free, and said in those words: the surface declares `cloud.Free`
(`plugin/event/main.go`). Neither ingest nor a read debits any plane.

### §6 The events it publishes

It publishes, and what it publishes is deliberately not named in our vocabulary.

An accepted batch is committed as FACTS under `event.<signal>`, where signal is
a closed set naming the sort of occurrence. That is the internal hand-off the
warehouse drains. Separately, one ENVELOPE per event is published under
`event.<folded event name>` — the grammar an org subscribes to through
`/v1/webhook`, so `signup_completed` reaches a customer as
`event.signup_completed`. A name is folded to a subject token and bounded, so a
hostile name cannot mint unbounded subject cardinality; the fold is a PUBLISHED
contract and MAY gain cases but MUST NOT change an existing mapping.

The name is the customer's, which is why this capability publishes no
`<name>.<noun>.<verb>` event of its own — the `event.*` subjects above carry the
tenant's names, not ours. Restating a tenant's own event under our vocabulary
would assert a name over theirs and deliver every subscriber one subject instead
of the one they asked for.

Two vocabularies therefore share one stream, and the discriminator is the BODY,
not the subject: a fact names its signal and an envelope does not. Each consumer
MUST take the vocabulary it speaks and leave the other alone — the warehouse
lands facts and ignores envelopes, the webhook delivery does the reverse — and a
payload that names no signal is not a lost fact.

Two orderings are normative. The fact publish is the COMMIT POINT and is
synchronous: the endpoint answers `accepted` only once the broker holds the message.
The drain then commits before it acknowledges, in that order always, because
acking first loses the fact while the bus believes it delivered; redelivery is
safe because the fact table collapses a redelivered row on merge, which makes
idempotency structural rather than something each consumer remembers. The
envelope publish is fail-soft and detached, because the durable copy is already
committed by the time it runs — a bus that is down for the second vocabulary
costs deliveries, never data.

### §7 Observability

Beyond the request span every route gets, one counter and one log line, on
purpose. `hanzo_ingest_dropped_total` counts events an endpoint received and did not
land, labelled by tenant, endpoint origin and reason. It is per REASON rather than
one total, because "a fleet of clients writing with no usable credential" and
"one client sending bodies nothing can store" are different incidents and an
alert that cannot tell them apart wakes the wrong person. The log line names the
same three, so whoever the alert wakes knows which tenant and which endpoint.
Cardinality is bounded on all three labels: the tenant is server-resolved, the
origin comes from the finite set of endpoints, and the reason is two values.

### §8 Stage

`ga`. The manifest row declares no stage, and absent is `ga` (HIP-0139 §8).

### §9 Upstream

It derives from none: it forks, embeds and mirrors no OSS project. It ACCEPTS
foreign wires at its own endpoints as interoperation — the product-analytics wire
spelled `distinct_id`/`api_key`, and the error-SDK envelope and store wires,
relayed unchanged — which is a fact about what an unmodified client may send,
not a dependency. The hosted tag carries one file copied verbatim from
`@hanzo/event`, the anonymous-identity chain, because a tag with no bundler
cannot import anything: one implementation, two distributions, so a browser is
one person on every Hanzo surface whichever client a page loaded.

## Rationale

The alternative to one endpoint is a path per wire. Five endpoints is five admissions,
five receipts and five places for the meaning of `accepted` to drift, and a
caller learns which one it hit by reading a changelog. Shape dispatch costs one
byte of lookahead and keeps the contract single.

The alternative to a server-stamped tenant is a tenant field on the wire, which
works until one client sets it — and by then the rows are already filed and the
lens is already wrong. The alternative to refusing an unattributable write is
filing it somewhere shared, which returns 200 to a caller whose data nobody will
ever read.

## Security Considerations

An ingest endpoint is a write into somebody else's dataset, so the wrong
implementation hands an attacker three distinct prizes.

If the tenant came off the wire, any caller could file rows into any org's
warehouse, and that org's dashboards would report a stranger's traffic as their
own — a corruption that reads as data, not as an attack. The tenant is resolved
from the presented credential and stamped where the row is built.

If an unattributable write were filed under a shared tenant, the caller is told
it succeeded and the owner can never read it. A silence that looks like success
is worse than a refusal, which is why the only two answers are the org a
credential named, or an error.

If a publishable key authenticated as well as attributed, every browser bundle
on the internet would be carrying a read credential for its org's errors and
lenses. It does not: a read never accepts a write-only key.

The reduced lane is where a signed-in person's tab meets an open vocabulary, so
it is bounded on both the request and the value: refused over 64 KiB, refused
over fifty events, capped independently per client address and per socket peer —
two buckets, because the address is a header a direct caller can rotate and the
socket peer at the edge is shared by all public traffic — and a do-not-track or
global-privacy-control request stores nothing and says so in the receipt. Both
bounds REFUSE rather than truncate, since a silent truncation would make the
receipt a lie. Two stored values carry their own bounds on top, because bounding
a request does not bound one value inside it.

The consumer seam has a matching rule. A consumer that FORWARDS sees the batch
before the warehouse scrub, because a server-side forwarder must hash the match
keys the warehouse deliberately drops, and it hashes them before they leave the
process. A consumer that STORES sees the scrubbed copy, because a projection
that stored more than the plane stores would be a second copy of the batch under
a weaker rule. Every sink runs detached and fail-soft, so a slow or broken
consumer can never block, fail or crash an ingest.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0135 — What Is Public
- HIP-0139 — Capability
- HIP-1240 — O11y — The Observability Plane
- HIP-1313 — Usage — The Metered Record

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
