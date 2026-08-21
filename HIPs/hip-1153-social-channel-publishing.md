---
hip: 1153
title: Social — Publishing to Connected Channels
author: Hanzo AI
type: Standards Track
category: Interface
capability: social
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1153: Social — Publishing to Connected Channels

## Abstract

`/v1/social` is posting to every social account an org owns, now or on a
schedule. Two entities: an Account is a connected channel (X, Facebook,
Instagram, LinkedIn, TikTok, YouTube, Threads) and a Post is content published or
scheduled to one — scheduling is not a third entity, it is a Post with a future
`scheduleAt`. It is implemented in `hanzoai/cloud` at `apps/social`, the
in-process fold of the standalone social stack, and its defining honesty is that
the publish edge fails closed: it reports exactly which provider credentials are
missing and never fakes success.

## Motivation

Social publishing had three homes: the standalone pods, a second path in the
content app reaching the same upstream over HTTP, and a third scheduled-post
store in marketing with no publisher wired at all. This fold — which owns the
accounts, the scheduler and the publish edge — is the one
(`apps/social/social.go`). Ground truth for the fail-closed default: no
deployment carries the per-provider OAuth-app credentials the live orchestrator
needs and no account access tokens exist, so there was no publishing capability
to preserve, only one to enable (`apps/social/publish.go`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### The store

One SQLite file through the fleet's one opener (`sqlpool.Open("social", dir)`,
`apps/social/store.go:34`) holds every org's accounts and posts; tenant isolation
is the `org` column, enforced on every query. Post lifecycle is four
user-settable states (draft, scheduled, published, failed) plus a transient
`publishing` claim state that is NEVER user-settable: `ClaimForPublish` is the
guard that stops two publishers double-posting the same row, and stuck claims are
recovered at mount.

### The address

Thirteen operations under `/v1/social`: the account collection and item, the post
collection and item, `POST /v1/social/posts/{id}/publish`, a per-org summary and
a `providers` read reporting publish-readiness per network with the exact
credential names still missing. Every operation is declared with prose beside the
route (`openapi.Describe`, `apps/social/social.go:170` ff.) rather than typed:
the fold mirrors the classic handler pattern, and nothing about these shapes
prevents typing — they are values, and moving them into the typed registry is
this capability's known debt, stated here rather than hidden.

### Publishing

One path pushes a post out (`publish.go`): on explicit publish, on create when
scheduled for now-or-earlier, and on the scheduler tick when a scheduled time
arrives. A post fans out to its channel's connected accounts through the
Publisher edge, selected once at mount. The default Publisher MUST fail closed —
a publish with missing provider credentials answers 503 naming what is absent,
and MUST NOT mark the post published. The provider vocabulary is one ordered
list from which validation, ordering and credential-checking all derive.

### Tenancy

The org is `principal.Org` — minted from the validated bearer owner (HIP-0026) —
never a client-supplied header, and it is the mandatory predicate on every store
query.

### Money, events, observability, stage

It is free — the surface declares `cloud.Free` (`plugin/social/main.go`). It
publishes nothing on the bus; the scheduler delivers posts to networks, not
events to webhooks. It emits nothing beyond the request span every route gets.
The stage is `beta`: a vertical application whose per-account OAuth connect flow
and native provider push are the declared remaining gap.

### Upstream

It derives from the standalone hanzoai/social stack — its own lineage, not a
third-party fork. What survives in HEAD is the model (integration → Account,
post-now-or-schedule → Post), the provider vocabulary, and the orchestrator's
exact credential names; the pods' HTTP surface is replaced by this in-process
fold. No third-party OSS is embedded; the networks are reached as remote APIs.

## Rationale

The alternative to a fail-closed publisher is a stub that returns success, which
is the worst possible product: a customer schedules a campaign and nothing is
delivered anywhere, silently. Reporting the missing credentials by name makes
the 503 an installation instruction. The claim state exists because the same
post is reachable from three triggers; without a claim, the scheduler and an
explicit publish racing is a double post on a customer's public channel.

## Security Considerations

The stored account rows will carry per-account OAuth tokens once the connect flow
lands, which makes the org predicate the boundary between one tenant's audience
and another's: the wrong implementation posts one org's content through another
org's accounts — public, attributable damage. The other wrong implementation is
accepting `publishing` from a request, which lets a caller wedge or replay the
claim guard; the state vocabulary therefore excludes it from every write path.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
