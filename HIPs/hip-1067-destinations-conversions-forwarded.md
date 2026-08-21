---
hip: 1067
title: Destinations — Conversions Forwarded
author: Hanzo AI
type: Standards Track
category: Interface
capability: destinations
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0027, HIP-0106, HIP-0139
---

# HIP-1067: Destinations — Conversions Forwarded

## Abstract

An org connects the analytics and advertising platforms it uses, and every event
the platform already captures is translated into each destination's own conversion
schema and delivered from the server. `/v1/destinations` is the registry for those
connections and the one place their credentials are held.

This HIP specifies the interlingua that makes one translation serve every
destination, the delivery guarantees of the fan-out, and the custody rules. The
implementation is `hanzoai/cloud` `apps/destinations`.

## Motivation

Server-side forwarding is N platforms times M event names. Written directly, that
is N×M mappings, each maintained by whoever added a platform, and no two agreeing
on what a checkout is. It is also N places where a credential could be read and
N places where a burst of ingest could turn into unbounded outbound work.

The plane exists to make all three linear: one translation, one custody path, one
bounded consumer.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### A consumer, never a second collector

This plane is installed as a **sink on the canonical event stream**. It MUST NOT
have an ingest door of its own. There is one collector; this reads what it
accepted.

### One interlingua, translated once

The canonical event vocabulary maps onto a normalized conversion taxonomy exactly
once (`apps/destinations/translate.go`). Each adapter renders the normalized value
into its own platform's name.

- The map is **pure** — no input or output — so it is driven directly by tests.
- A canonical name with no normalized meaning translates to the custom value and
  is forwarded under its raw name. Absence is a defined outcome, not a dropped
  event.
- Where a site may emit either the canonical name or an ecommerce vocabulary's
  name for the same act, both collapse onto the same normalized value, so the
  destination sees one conversion regardless of which vocabulary the page spoke.

An adapter MUST NOT re-derive the canonical mapping. A new platform is a new file
that registers itself and renders from the normalized value; it is never a change
to the fan-out.

### Deduplication with the browser

A conversion carries a deduplication id, taken from the browser tag's own id when
one was stamped and falling back to the event's message id
(`apps/destinations/translate.go:55`). That is what lets a platform reconcile the
browser-side pixel and the server-side delivery of one act as one conversion
rather than two. The browser half is HIP-1068.

### The fan-out

For each of an org's enabled destinations the accepted batch is translated once
and delivered. The consumer is:

- **Bounded.** A semaphore caps concurrent fan-out work. A saturated system
  **drops** the batch with a warning rather than growing unbounded outbound
  requests.
- **Fail-soft.** The sink has no caller to return an error to. A store failure, a
  missing credential or one destination's delivery failure is logged and MUST NOT
  propagate, block another destination, or block a later batch. A panic is
  recovered.

Both properties are deliberate and both are lossy under pressure. This plane
carries marketing attribution, not billing or audit: a dropped batch costs
reporting fidelity, while an unbounded fan-out costs the process. Any capability
where that trade is wrong MUST NOT be built on this sink.

### Custody and tenancy

A destination's API secret lives only in the key store, sealed, under a per-org
path. The row holds non-secret configuration — a measurement or pixel id — and
nothing else. A destination MAY instead ride an existing connection's token rather
than holding a second copy of one.

The org is the validated principal's (HIP-0026), never a header and never an input
field. Every row is keyed by (org, platform). Mutations require an org admin;
reads do not.

Personally identifying match fields are hashed before they leave
(`apps/destinations/destination.go:95`). The platform receives match keys, not
identities.

### The inbound half shares the outbound half's custody

Reporting — what a platform charged for the conversions it was sent — is keyed by
the **same** platform slug, reads the **same** org row, and opens the **same**
sealed credential. It invents no second secret, no second store, and no second
definition of who an org is. Without it a campaign's conversions sit in the
warehouse with no cost beside them.

It has no route of its own: a reporter self-registers per platform
(apps/destinations/report.go) and its rows land in the warehouse cloud already
owns, as `hanzo.ad_report`, one row per (org, platform, campaign, day).

### One route is not a typed operation

Connecting a destination stays untyped, with the wire fact stated
(`apps/destinations/typed_wire_test.go:27`): the request body's property **names**
are chosen at request time by the addressed platform's own specification, and no
static type describes an object whose keys the URL picks. It also accepts a
configuration value as a string, a number or a boolean and coerces it to text,
precisely so a console may send a numeric pixel id — a typed string field would
turn a currently accepted request into a rejection.

It declares both bodies explicitly instead, so the cost of staying untyped is
prose and a generated client method, not a document claiming the route takes no
body. The ledger has exactly one entry, and a second route added untyped fails.

### Names entering the published schema

The fleet's schema namespace is flat and single-valued: one name, one shape,
wherever two apps meet. Publishing a type puts it in that namespace, so a type
whose obvious name is already taken by another app MUST be qualified before it is
published. That qualification is part of publishing, not cosmetics — a generated
client would otherwise bind whichever shape it read last.

### What it owns, charges and emits

The store is one SQL database (`sqlpool.Open("destinations", …)`,
apps/destinations/store.go:30) holding the (org, platform) rows and their
non-secret configuration; the secret half lives in the key store under the
per-org path, as specified above. The closed adapter registry is ga4,
googleads, linkedin, meta, pinterest, posthog, reddit, tiktok, umami and x,
each a file that registers itself from init()
(apps/destinations/destination.go:170).

The addresses are the operations at `/v1/destinations`
(plugin/destinations/openapi.json): the listing, and per platform the connect,
read, disconnect and test — the connect being the one declared route, per the
section above.

It is free, in those words: the plugin declares `Price: cloud.Free`
(plugin/destinations/main.go:21); what a platform charges for the conversions
it is sent is that platform's bill, read back through the reporting half.

It publishes no events on the platform bus — it is a sink, and the one-way rule
above is why — so a customer's webhooks (HIP-1310) receive nothing from it. It
emits nothing to observability beyond the request span every route gets; a
saturated fan-out logs the drop with a warning (apps/destinations/fanout.go:41),
which is the visibility the lossy trade above promises.

The stage is `ga` — the manifest row declares none, and absent is `ga`
(HIP-0139 §8). The capability derives from no OSS upstream: each adapter speaks
its platform's public conversion API directly over HTTP.

## Rationale

The alternative to the normalized taxonomy is per-platform mapping tables. It is
simpler to add the first platform and worse at every platform after: the same
canonical event acquires N independent opinions, and a correction has to be made N
times. One interlingua costs a translation step that is occasionally lossy for a
platform with an unusual vocabulary, and that loss is visible in one file rather
than spread across adapters.

## Security Considerations

Secrets are per-org and sealed; a row never holds one and a response never returns
one. Path construction is per-org, so one org's configuration cannot address
another's credential.

The outbound direction is the exposure worth naming: this plane sends a tenant's
event data to a third party the tenant chose. Match fields are hashed before send,
so the platform receives what it needs to match and not the underlying identity.
Only destinations the org has explicitly enabled receive anything.

## References

- HIP-0026 — Identity and Access Management
- HIP-0027 — Secrets Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-1068 — Tags — The Browser Half

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
