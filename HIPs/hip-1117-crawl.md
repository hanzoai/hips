---
hip: 1117
title: Crawl — A Page as Markdown
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: crawl
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0139
---

# HIP-1117: Crawl — A Page as Markdown

## Abstract

`/v1/crawl` turns any web page into clean markdown a model can read: fetch one
URL, extract the readable subtree, render it. It is implemented in
`hanzoai/cloud` `apps/crawl`, in-process Go — the same move already made for
the search half in `apps/websearch` — with escalation to a headless browser for
pages that render client-side. This HIP states the surface (one operation), the
security boundary (the fetcher is an SSRF primitive by construction), and where
fetched pages are kept.

## Motivation

The fetch used to be a dial to a separate service: one more non-Go dependency,
one more thing that can be down, and a network hop for work that is a fetch and
a parse (`apps/crawl/crawl.go:6-10`). Folding it in removes all three — and
moves the network-policy protection the separate pod had for free into this
package, which is the part of the fold that must never be lost.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 One operation, and success is a field

`POST /v1/crawl`, operation `read_page`: `{url}` in, `{success, data, error}`
out. "The page could not be fetched" is a normal outcome of asking about a URL,
not a fault of the request, so it is 200 with `success:false`; the one declared
non-2xx is 400 for a missing url, answered in this surface's own body
(`apps/crawl/mount.go:31-60`). The name is `read_page`, not the derived
`create_crawl`, because a model picking from an `op` enum chooses by name and
this op reads one addressed page — it starts no job
(`apps/crawl/mount.go:186-192`).

### §2 The guard is in the dialer

The caller supplies the URL and the fetch runs inside the cluster, beside
in-namespace service DNS and a metadata endpoint that hands out credentials to
anyone who asks. So: only http/https, and every address actually dialed MUST be
a public unicast address, checked in the dialer — not on the hostname, because
a hostname checked up front and resolved again by the transport is a
time-of-check/time-of-use gap DNS rebinding walks through. Redirects re-enter
the same dialer, so a public URL that 302s to 169.254.169.254 is refused at the
hop that matters (`apps/crawl/crawl.go:23-39`).

### §3 Static first, then a real browser

A single-page app answers a near-empty shell; a crawl that returns nothing and
says it succeeded is worse than one that fails. If the static fetch is too thin
to be the page, the fetch escalates to Hanzo Crawl — headless Chromium,
`ghcr.io/hanzoai/crawl`, at `crawl.hanzo.svc:11235` — one-way and best-effort:
a slow or unhappy browser never turns a page already fetched into an error
(`apps/crawl/browser.go:3-19`).

### §4 The corpus, and what this capability owns

It owns no store. Every fetched page is kept best-effort on the one object seam
the binary already has (`deps.VFS` over the shared S3 gateway), keyed under an
org/project prefix taken from the verified principal — never the request body,
because the prefix selects whose corpus is read
(`apps/crawl/archive.go:3-21,36-40`). A deployment with no object store keeps
crawling and keeps nothing.

### §5 Tenancy, money, events, telemetry, stage, upstreams

A request is admitted with a validated principal (HIP-0026), or with the
service key compared in constant time — refusals are this surface's own body
(`apps/crawl/mount.go:166-176,245-260`). Metered, and the unit is one
rendered page (`plugin/crawl/main.go`, `cloud.Metered`): the escalation to the
headless browser holds a pod for up to forty-five seconds, dedicated compute
of the class the fleet already meters, so the fee — `CRAWL_FEE_CENTS_RENDER`
over `CRAWL_FEE_CENTS`, defaulting to one cent — is gated before the browser
is asked and debited after it answers (`apps/crawl/meter.go`). The static
fetch is one http.Get and stays free. It publishes no events on the bus and
emits nothing to
observability beyond the request span. Its stage is `ga`: it is a primitive of
the intelligence plane, beside `search_web` and `research_web`. Upstreams:
parsing is `golang.org/x/net/html` (BSD-3-Clause); the escalation browser is
our own `crawl` service image; nothing else is forked or embedded.

## Rationale

One URL per call, rather than a batch, because a batch response is a
partial-failure envelope every caller then has to unpack, and no caller has
asked for more than one (`apps/crawl/mount.go:19-21`). Markdown rather than
plain text because the consumer is a language model and structure — headings,
lists, links — is signal. Keeping fetch, extract and render as three orthogonal
steps keeps the hard part (deciding which subtree is the article) testable from
a string with no network.

## Security Considerations

This surface is a server-side request forgery primitive by construction; a
naive implementation is a credential-exfiltration hole against the cloud
metadata endpoint and every in-cluster service, not a bug. The dialer guard in
§2 is the defense, and its placement is the point — any check earlier than the
dial re-opens the rebinding gap. The archive is the second boundary: the
org/project key prefix comes only from the verified principal, so no caller can
read (or seed) another tenant's corpus.

## References

- HIP-0026 — Identity and Access Management
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
