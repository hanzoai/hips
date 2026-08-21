---
hip: 1251
title: Websearch — The Live Web
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: websearch
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1251: Websearch — The Live Web

## Abstract

Websearch is a web search and a page fetch an agent can call: a meta-search
over public engines — keyless by default, with paid vendor engines joining the
blend only where the operator holds their keys — and a fetch-and-extract that
returns a page as markdown, both in-process Go with no search SaaS and no
crawler pod. `hanzoai/cloud` `apps/websearch` is the implementation and
`/v1/websearch` is its address.

This HIP declares the capability: what it stores (nothing), the target surface,
which operations are typed and why two cannot be, and the two gates that keep
it from being an open proxy.

## Motivation

This surface is the fleet's only path to the live internet, and it exists twice
over in compatibility: the chat server's search pipeline accepts only two
self-hostable provider contracts — a SearXNG-shaped search and a
Firecrawl-shaped scrape — so the capability serves both wire shapes natively
rather than deploying either upstream. The predecessor design proxied to
services that were down or never existed and answered 200 anyway; in-process is
the shape with no pod to be down.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store

The capability owns none. Its only state is an in-process bounded cache
(`apps/websearch/cache.go:31`). A scraped page that persists does so under the
caller's crawl scope, in crawl's storage — never here.

### §2 The address

The target surface is `/v1/websearch`: the typed native door at the root, the
SearXNG-shaped search at `/v1/websearch/search`, and the Firecrawl-shaped
scrape at `/v1/websearch/scrape`. Today scrape answers at a second root,
`/v1/scrape`; the pair is carried by cloud's `openapi/misfiled.txt:93` and
closes by fold — no store, so no boundary to split on, and Firecrawl is not in
HIP-0139 §3.2's closed exemption list. The fold is a compat-wire break, not a
client edit: Firecrawl clients compose `{base}/v1/scrape`
(`apps/websearch/websearch.go:13`), so no base-URL setting reaches the folded
address, and the chat server's scraper provider MUST be re-pointed in the same
release or lose scraping. A survival of the `/v1/scrape` spelling would be a
HIP-0139 amendment argued here; this HIP does not argue it.

### §3 Operations

`POST /v1/websearch` is the one typed operation (`search_web`,
`apps/websearch/websearch.go:338`) — the tool, client method and command every
projection carries. The two compat doors are declared with prose beside the
route and cannot be values, each for a measured reason
(`apps/websearch/typed_wire_test.go`): the search door answers every method the
router knows and its write arms read the query string while ignoring the body,
which a typed operation refuses; the scrape door deliberately answers
`200 {"success":false}` to a malformed body and caps the read at 1 MiB, because
Firecrawl clients read `data.success`, not the status line. Both run the same
search and the same fetch as the typed door — the adapter's frozen contract
binds the adapter, never the capability.

### §4 Tenancy and the two gates

Search admits either a validated principal (HIP-0026) or the shared service
key `WEBSEARCH_API_KEY` as `X-API-Key` — the chat server's service-to-service
path. Scrape requires the key as a Bearer. An unset key MUST answer 503 and a
missing or mismatched key 401; a request with a validated principal never needs
the key. Neither door is ever an open proxy.

### §5 Metering, events, telemetry, stage

Metered, and the unit is one search answered by a paid engine
(`plugin/websearch/main.go`, `cloud.Metered`): most engines scrape public
result pages and cost nothing, but Brave and Mojeek spend a vendor's money per
query, so a search that reaches them carries a fee —
`WEBSEARCH_FEE_CENTS_BRAVE` / `_MOJEEK` over `WEBSEARCH_FEE_CENTS`, defaulting
to one cent (`apps/websearch/meter.go`). A credential is what makes an engine
paid: a keyless deployment is byte-for-byte the free tier, and an org out of
funds loses the paid engines from the blend rather than the search — the
failure closes on spend, never on answer. It publishes no events on the bus.
Beyond the request span, it logs each engine's outcome as one of three states — answered, blind,
down (`apps/websearch/outcome.go`) — because a metasearch whose engine fails
soft is indistinguishable from calm, and blindness must be a fact an operator
can read. Stage: `ga`.

### §6 Upstream

The capability derives from none. It implements two wire shapes it does not
own — SearXNG's `/search?format=json` envelope and Firecrawl's scrape
envelope — as compatibility contracts, forking neither project. The engines it
queries are public search engines over native Go HTTP
(`apps/websearch/search.go`), keyless by default; a Brave or Mojeek credential
the operator holds adds that vendor's API to the blend
(`apps/websearch/brave.go`, `apps/websearch/mojeek_api.go`). No search SaaS is
embedded or forked.

## Rationale

The alternative was the one already tried: proxy to a SearXNG pod and a crawler
service. It cost a deployment per contract and failed silently — the crawler's
DNS name did not resolve while the surface answered 200 with `success:false`
inside. In-process serving keeps one binary answerable for the whole path, and
the three-state outcome log is what makes its failures visible instead of soft.

## Security Considerations

The wrong implementation is an open proxy: an unauthenticated scrape door is
server-side request forgery against anything the cluster egress can reach, paid
for by us. The two gates close it — principal or key for search, key alone for
scrape, 503 when the key is unset rather than open-when-unconfigured. The
remaining exposures are the shared key itself, which is KMS-sourced and never
logged, and silent engine blindness, which the outcome states exist to surface.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
