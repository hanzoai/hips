---
hip: 1131
title: Help — The Support Desk
author: Hanzo AI
type: Standards Track
category: Interface
capability: help
status: Draft
created: 2026-08-20
requires: HIP-0106, HIP-0139
---

# HIP-1131: Help — The Support Desk

## Abstract

`/v1/help` is the public face of a support desk: an anonymous knowledge base and
a ticket intake. The desk itself — tickets, agents, teams, SLAs, canned
responses, the conversation thread — is a set of framework DocTypes (`hd-*`)
served by the generic role-gated framework surface; this capability adds only
the one plane that surface deliberately cannot serve, the unauthenticated help
center. It is implemented in `hanzoai/cloud` at `apps/help` (HIP-0106).

## Motivation

The framework engine is secure by default: every read and write needs a
validated principal and a role, so there is no anonymous "read the public
knowledge base" or "a customer files a ticket" path. Building a second CRUD
stack for the public center would duplicate the store; adding an anonymous hole
to the generic engine would widen every module. The thin public plane is the
remaining shape (`apps/help/help.go:1-40`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 It owns no store

A ticket IS a framework document in module `help`; so are articles, categories,
agents, teams, SLAs and conversation messages. Every read and write on this
surface delegates to the framework in-process API, so there is one storage
engine and no duplicated CRUD (`apps/help/help.go:20-26`). The agent plane —
triage, authoring, threads — is the framework's generic surface at
`/v1/framework/hd-*` and needs no code here beyond the DocType fixtures
(`apps/help/help.go:52-82`).

### §2 The address

Four operations, all typed: list the public articles, fetch one by slug, list
the categories, and file a ticket. Reads are gated to `status=Published AND
is_public=1`, re-checked on a direct fetch, so a draft or an internal
(agent-only) article never leaks; a category fronting no public article is
invisible (`apps/help/subsystem.go:6-18`). The intake is bounded — 64 KiB body,
capped subject, message and sender fields — because it is the one anonymous
write (`apps/help/subsystem.go:45-52`).

### §3 Tenancy is inverted: one org, server-fixed

This is an anonymous surface, so the tenant is not the caller's — it is the
deployment's. Every public endpoint serves exactly ONE org, resolved server-side
at mount: an explicit operator override, else the deployment brand. A request's
`X-Org-Id` is ignored here, so a caller can never read or write another tenant's
help center. With no brand and no override the plane fails closed: every
endpoint answers 404 until the operator names the org
(`apps/help/subsystem.go:11-19`).

Per-client rate limiting is left to the edge, which knows the client; behind the
ingress this app sees only the edge as socket peer, so an app-level per-IP
limiter would throttle every customer against one shared bucket
(`apps/help/subsystem.go:20-24`).

### §4 Money, events, observability

Free (`cloud.Free`, `plugin/help/main.go`). It publishes nothing on the bus and
emits nothing beyond the request span every route gets.

### §5 Stage

`beta`: a vertical application — a support product an org runs, not a core
plane.

### §6 Upstream

No upstream code is embedded. The DocType model is a native rebuild of the
Frappe Helpdesk shape — the model moved onto the native engine; no Frappe code,
Python, or frontend survives (`apps/help/help.go:28-33`).

## Rationale

The alternative was a standalone helpdesk process with its own store and its own
auth. Making the desk a framework module means the agent plane, its roles and
its renderer already exist, and the only new code is the anonymous plane —
which is also the only code that needed a different security posture.

## Security Considerations

The wrong implementation leaks in two directions. Outward: a visibility filter
applied on the list but not on the direct fetch serves drafts and internal
articles by slug — which is why the Published/public predicate is server-set and
re-checked per document. Across tenants: an org read from the request would let
any caller browse any deployment's centers; the org is fixed at mount and no
request field can move it. The intake is the abuse surface that remains, and it
is bounded rather than authenticated, because requiring an account to file a
ticket defeats a support desk.

## References

- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
