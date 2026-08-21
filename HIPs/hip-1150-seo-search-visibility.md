---
hip: 1150
title: SEO — Search Visibility as Data
author: Hanzo AI
type: Standards Track
category: Interface
capability: seo
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1150: SEO — Search Visibility as Data

## Abstract

`/v1/seo` is search visibility as data: what a phrase is worth, what a site
already places for, who places beside it, who links to it, and what one page gets
wrong. Six questions, six typed operations, plus a seventh that prices the other
six. It is implemented in `hanzoai/cloud` at `apps/seo`, and it is a resale: the
measurements come from a commercial upstream, and the price a caller pays is the
upstream's own number, read live, never copied into a table here.

## Motivation

The measurement — a crawl of the web's link graph and a log of what is searched —
is not a thing this platform should rebuild to answer six questions. What is
worth owning is the shape of the questions: each operation is one small typed
request and one small typed answer, so each is a findable MCP tool and a real SDK
method, where a single passthrough of the vendor's sixty-field row would be one
tool no model can call and one method whose argument is `any` (`apps/seo/seo.go`,
"Why six typed ops and not one passthrough").

The failure mode of a reseller is a copy of the vendor's price going stale in a
table somebody has to remember to edit. So no table is kept.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### It owns no store

Every operation is one live upstream call answered in the same request — no task
ids, no polling, no per-tenant state. The full site audit (a crawl with a job
lifecycle) is deliberately absent: it is a job, jobs need a plane, and `seoAudit`
answers the same questions about the one page a caller is looking at.

### The address

Everything is under `/v1/seo`, and every operation is typed: `seoKeyword`,
`seoIdea`, `seoRank`, `seoCompetitor`, `seoBacklink` and `seoAudit` as POSTs, and
`seoRate` as a GET. The rate card MUST be free: asking what a call costs must not
require the balance that would pay for it, and if the upstream cannot be reached
the card comes back empty rather than stale — a price nobody can confirm is not a
price (`apps/seo/rate.go`).

### Tenancy

Every operation serves a validated principal and nobody else. The preamble
(`who`, `apps/seo/typed.go`) distinguishes "a request exists" from "the identity
middleware minted this caller from a verified credential" — a surface that checks
only the first admits a forged header, and this one spends money at a vendor per
call. It fails closed off the HTTP path too, where the CLI projection invokes an
op with no request at all.

### Money

The surface declares `cloud.Metered` (`plugin/seo/main.go`), so the edge charges
nothing and the app owns the whole debit, in four ordered steps: refuse without a
validated principal; authorize the caller's balance against the vendor's
published QUOTE before the call (`Bill.Gate`, `apps/seo/typed.go:139`); make the
call; debit exactly what the vendor CHARGED, off their answer, never a
recomputation (`Bill.MeterUsage`, `apps/seo/typed.go:159`). The quote is their
price list, served free and cached for an hour; the charge is the `cost` field on
the answer itself, exact to 18 decimals — their cheapest call is $0.00012, which
cents cannot hold. A failed call the vendor billed for is still debited, because
that money has already left; a refusal that cost nothing debits nothing. A margin
MUST NOT be added here — margin belongs in the plan a customer buys, not in the
proxy that spends. `seo` is in the standing list the balance gate reads
(`spend.go:314`).

### Events, observability, stage

It publishes nothing on the bus. It emits nothing beyond the request span every
route gets; the meter rows the debit writes are the durable record of spend. The
stage is `beta`: a vertical marketing measurement, not part of the self-service
agentic-OS core.

### Upstream

It derives from no OSS. The upstream is the DataForSEO REST API v3
(`apps/seo/dataforseo.go:29`), a commercial service reached over HTTPS; no vendor
SDK is linked, and the client is this package's own. One vendor account serves
every tenant, so the credential is the deployment's own, sealed in KMS
(`apps/seo/seo.go:104-105`) and resolved through the KMS interface at call time —
never an environment variable, never logged; every error names the ref and never
the value.

## Rationale

The alternative to reading the vendor's two numbers at run time is a price table,
and a price table is the drift: their price moves, ours does not, and the
deployment either eats the difference or overcharges until someone notices.
Reading the quote before and the charge after keeps the two ledgers equal with no
redeploy on a vendor price change.

## Security Considerations

Two assets sit behind this surface: the deployment's vendor account and the
caller's balance. The wrong implementation of the preamble — accepting an org
from a header rather than a validated principal — lets an unauthenticated caller
spend the vendor account with no ledger to debit, which is theft of service that
looks like traffic. The wrong implementation of credential custody — an env var,
a literal, a logged value — turns one debug log into the vendor account. Both are
closed the same way: the principal must be minted from a verified credential
(HIP-0026), and the credential exists only as a KMS ref that is read, never held.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
