---
hip: 1100
title: Ad — Paid Placement Under a Campaign
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: ad
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1100: Ad — Paid Placement Under a Campaign

## Abstract

`/v1/ad` is an org's paid ad campaigns, launched and paused from one place. A
campaign carries an objective, a budget and reported spend in integer cents, and
runs on an ad network under the org's own connector token. It is implemented in
`hanzoai/cloud` at `apps/ad`, and it is the paid executor the go-to-market
plane fans out to: `apps/campaign`'s paid channel calls this capability's
LaunchPaid/PaidSpend/PausePaid seam (`apps/ad/provider.go`).

## Motivation

The campaign plane can plan a paid channel but something has to hold the ad
account's token, create the campaign object at the network, and read spend back.
Doing that inside each marketing surface would put a provider token in every one
of them; this capability is the one execution edge, so the token discipline is
written once.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store

One system SQLite database, `ad`, opened through `sqlpool.Open` and therefore
born encrypted under the process key (`apps/ad/store.go:34`). Every org's rows
share the file; isolation is the `org` column, enforced on every query.

### §2 Addresses

Everything is under `/v1/ad`. Six operations are typed: the summary roll-up,
campaign list/create/get/update/delete. `POST /v1/ad/campaigns/{id}/launch` is
declared with prose beside the route instead: its optional `{account}` body is
deliberately tolerant — a malformed body launches on the stored account rather
than being refused — and the typed path unconditionally unmarshals any non-empty
body, which would turn that 200 into a 400 (`apps/ad/ads.go:139-147`). The
closed list of raw routes is held by `apps/ad/typed_wire_test.go`.

### §3 Tenancy

The org is the validated principal's — `principal.Org` / `principal.Acting`,
never a client-supplied field — and a request without one is refused
(`apps/ad/ads.go:478-480`). A campaign id another org owns reads as not found.

### §4 Money

The capability is free: its plugin declares `cloud.Free`
(`plugin/ad/main.go`), and it appears in no metered list. The money at stake is
the org's own ad budget at the network, and this surface is built so a launch
cannot start spend: a launch creates the campaign object only, and delivery does
not begin until the ad-set and ad legs are wired. Spend is READ back from the
provider's insights, never computed here.

### §5 The connector token

Every provider operation resolves the org's token first, at call time, from KMS
through the `integrations.TokenFor` custody seam. Any reason it cannot be
produced — the org never connected the network, the integrations plane is
unmounted, KMS is down — refuses the operation before any provider call is made,
and the token rides the Authorization header only (`apps/ad/provider.go`). The
connector map (`meta_ads`, `google_ads`, `tiktok_ads`, `reddit_ads`,
`linkedin_ads`, `microsoft_ads`) is the one statement of which networks a
deployment can run; a platform with no entry never has its token sought.

### §6 Events, telemetry, stage, upstream

It publishes nothing to the bus. Beyond the request span every route gets, it
emits structured log lines through the process logger and nothing else. Its
stage is `beta`: a vertical marketing application, not part of the self-service
agentic-OS core — the manifest row declares it (`manifest/apps.go:275`,
`Stage: Beta`; HIP-0139 §8).
It derives from no OSS upstream — the provider edge is plain HTTP against each
network's own API.

## Rationale

The alternative is to let each marketing surface hold its own network tokens and
call the networks directly. That multiplies the custody surface by the number of
callers and makes "which networks can this deployment run" a question with
several answers. One execution edge with fail-closed token resolution keeps both
facts in one file.

## Security Considerations

The wrong implementation hands an attacker someone else's ad budget: a forged
org would let them launch, pause or read spend on another tenant's connected ad
account. The org therefore comes only from the validated principal, and the
token is resolved per-operation from KMS rather than ever being held in this
process or its store — a copy of the `ad` database contains no network
credential. The tolerant launch body is bounded the other way: it can only name
an account within the org's own connector, never a different org.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
