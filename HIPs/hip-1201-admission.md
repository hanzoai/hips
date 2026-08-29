---
hip: 1201
title: Admission — Launch Control
author: Hanzo AI
type: Standards Track
category: Platform
capability: admission
status: Final
created: 2026-08-20
requires: HIP-0063, HIP-0106, HIP-0139
---

# HIP-1201: Admission — Launch Control

## Abstract

`admission` is the launch-control gate for the deployment's hosted services:
it decides, per request host, whether the service answering that host is in
waitlist mode, and, per user, whether the caller has been admitted. It is
`apps/admission` in `hanzoai/cloud`, and it is the complete waitlist feature
composed one-way over the one flag engine — admission imports `apps/flags`;
flags never imports admission (`apps/admission/waitlist.go:19-20`).

Its wire surface is one operation: the public mode read a guard or client
resolves before anything else, answering "is this host gated, and which
service governs it".

## Motivation

Launch gating used to be a mode column beside the thing it gated. Decomplected,
it is two orthogonal axes with a single decision plane: per-service mode is
the platform switch `waitlist.<svc>`, evaluated through the flag engine — there
is no second mode store — and per-user approval is IAM's, reused
(`apps/admission/waitlist.go:1-17`, `apps/admission/middleware.go:16-36`).
The engine stays a pure predicate; this package is its first composed tenant.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 Address

The capability answers one typed operation:

    GET /v1/admission/waitlist  →  { host, service, waitlistMode, known }

`?host=` defaults to the host the request itself was addressed to; an
unregistered host answers `known: false` (`apps/admission/waitlist.go:311-323`).
Today's router serves this route at `/v1/flags/waitlist`, under a root owned by
the flags capability; that pair is carried by `hanzoai/cloud`
`openapi/misfiled.txt` and closes by fold. The stores are distinct files, so
this is a misfiled route, never a split question.

The waitlist join API (`/v1/waitlist`) is served by `base`
(`manifest/apps.go:75`) and is not this capability's.

### §2 Store

The capability owns the launch registry: `waitlist.db`, a `cloud.OrgStore`
named `waitlist` opened in the reserved `platform/platform` tenant — one file
for the deployment, riding the same per-(org, project) machinery as the flag
definitions, encrypted at rest (`apps/admission/waitlist.go:37-47`,
`apps/admission/registry.go:10-12`). The registry is deliberately mode-free:
it answers only which service owns a host and its display metadata; the mode
itself is the flag engine's switch.

### §3 The rule, and who may read

The mode read is anonymous by design and MUST remain so: an unadmitted visitor
cannot hold a flag, so HIP-0139 §8.2's flag-gated 404 cannot apply to the endpoint
that implements launch gating. The read carries no tenant data.

Enforcement applies the rule at one native middleware (`Enforce`,
`apps/admission/middleware.go`): on a governed host in waitlist mode, a caller
with a Hanzo API key is allowed (possession-gated), an approved user is
allowed, a pending user is bounced to the waitlist, an unauthenticated one to
login. Approval is fail-open — only the exact IAM value `pending` gates; absent,
`approved` and `rejected` all read admitted (`apps/admission/approval.go:28-35`)
— and the literal lives with the gate that acts on it, so two places can never
disagree about who is waitlisted. A registry failure degrades to the in-memory
brand seed and the decide fail-opens (`apps/admission/waitlist.go:329-333`);
health, auth and the join API are never gated
(`apps/admission/middleware.go:106,120-124`).

### §4 Metering, events, observability, stage

The capability is free (`plugin/admission/main.go:26`, `cloud.Free`). It
publishes no events on the bus and delivers nothing to customer webhooks.
Beyond the request span, it emits its readiness line and warn-level
degradation logs (`apps/admission/waitlist.go:244-248,354`). Its stage is
whatever its manifest row says, and this text does not restate it: per
HIP-0139 §8 the stage is declared once, in `manifest.App.Stage`, and a second
copy here can only drift from it. It did — this section read `ga` while the row
had been staged `alpha`, which is this capability's own case for the rule.

That the stage is not `ga` is a fact about who is shown the capability, never
about whether this specification is settled; `status:` above answers that.
Admission is this deployment's own launch control, so an org that is not the
operator has nothing to configure through it.

### §5 Upstream

The capability derives from no forked, embedded or mirrored OSS project.

## Rationale

The alternative is a mode column in the registry — one store answering both
"who owns this host" and "is it gated". That braids configuration into
decision: every mode edit becomes a registry migration, and the flag engine's
existing evaluation, audit and admin plane get a parallel twin. Composing the
engine one-way keeps exactly one switch store and makes the arrow of
dependency a checkable fact.

## Security Considerations

The wrong implementation is measured by which way it fails. Enforcement that
fails closed on a registry error locks every user out of login and out of the
waitlist itself — which is why the decide fail-opens and the exempt prefixes
exist. Enforcement that reads approval from a request value instead of IAM
lets a caller admit themselves; the predicate MUST resolve from the identity
plane or the minted header, never client input. The anonymous mode read
discloses only what the gated landing page already shows: that a host is
gated. It MUST NOT grow tenant data, or its openness becomes a leak.

## References

- HIP-0063 — Feature Flags Standard
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
