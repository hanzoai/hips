---
hip: 1200
title: Account — The Caller's Own Surface
author: Hanzo AI
type: Standards Track
category: Application
capability: account
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1200: Account — The Caller's Own Surface

## Abstract

`account` is the signed-in caller's own self-service surface: the API keys they
mint and revoke, the call that creates their org, their appearance preference,
their profile photo, the anti-CSRF token their browser echoes on money writes,
and the embed-entitlement probe the console's data-product modules ask. It is
`apps/account` in `hanzoai/cloud` — the server work a statically-exported
console cannot do itself, run as the confidential console client against the
caller's own IAM record (`apps/account/account.go:1-8`).

This HIP is the capability; four facets carry their own deep specifications —
appearance (HIP-1040), avatar (HIP-1042), CSRF (HIP-1043) and org creation
(HIP-1045) — and nothing here overrides them.

## Motivation

Every route here exists because several browser surfaces would otherwise each
grow a privileged writer against one IAM row, and because the concept "my API
key" once had four addresses of which the only honest one 404'd
(`apps/account/account.go:180-184`). One subsystem, one registration, every
subject pinned to the validated caller.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 Addresses

The capability answers under `/v1/account` and nowhere else:

| operation | what |
|---|---|
| `GET/POST/DELETE /v1/account/keys` | the caller's keys — one noun; the key type (`publishable` \| `secret`) is a field, and a minted secret returns exactly once |
| `POST /v1/account/orgs` | create the caller's org; first run also moves them in and mints the org's first credential (HIP-1045) |
| `GET/POST /v1/account/appearance` | the caller's appearance preference (HIP-1040) |
| `POST /v1/account/avatar`, `GET /v1/account/avatar/{org}/{user}/{digest}` | profile photo upload and its credential-free content-addressed read (HIP-1042) |
| `GET /v1/account/csrf` | mint the token ambient-cookie writes echo (HIP-1043) |
| `GET /v1/account/embed` | brand-app embed entitlement + reachability probe (`apps/account/embed.go`) |

Today's router still serves each at the bare root (`/v1/keys`, `/v1/orgs`,
`/v1/appearance`, `/v1/avatar`, `/v1/csrf`, `/v1/embed`); those pairs are
carried by `hanzoai/cloud` `openapi/misfiled.txt` and close by fold. The two
`/v1/commerce/topup/*` prefixes on the manifest row
(`manifest/apps.go:54`) name routes the package deleted — the crypto top-up
credited an address no app ever registered
(`apps/account/account.go:216-234`) — and MUST come off the row rather than
be folded anywhere.

Every operation is typed except the two avatar ops — multipart in, raw image
bytes out — which are declared with prose and held as the closed exception
list in `apps/account/typed_wire_test.go`.

### §2 Store

The capability owns no store. Keys, org membership and the appearance
preference are rows in IAM, written through the confidential `hanzo-console`
client (`apps/account/iam.go`); avatar bytes live in the shared `deps.VFS`
blob seam under this subsystem's own `account/avatars/` prefix
(`apps/account/avatar.go:58`); the CSRF token is a stateless keyed MAC.

### §3 Tenancy

The subject is the validated principal and MUST NOT be nameable: org and user
come only from gateway-minted, IAM-verified identity
(`principal.Validated`), and the IAM id targeted is derived from those claims,
never from a body or query (`apps/account/account.go:64-70`). A caller can
only mint, revoke, onboard or decorate themselves. When the confidential
client is unwired the surface answers 501 — honestly not configured, never a
fabricated key or org.

Money writes are additionally gated by the CSRF middleware and a per-IP rate
cap (`apps/account/account.go:172-175`); a decorator-applied gate would drop
at registration, so the gate is composed into the registration pipeline.

### §4 Metering, events, observability, stage

The capability is free (`plugin/account/main.go:22`, `cloud.Free`); no debit
lands through any plane. It publishes no events on the bus and so delivers
nothing to customer webhooks. Beyond the request span every route gets, it
emits only its mount line and warn-level degradation logs
(`apps/account/account.go:136-137`). Its stage is `ga` — the manifest row
carries no stage, which HIP-0139 §8 reads as `ga`.

### §5 Upstream

The capability derives from no forked, embedded or mirrored OSS project. Two
non-standard-library imports are facts worth naming:
`github.com/hanzoai/account` v0.3.3 (MIT OR Apache-2.0 — the billing-account
rule as a dependency-free library) and `github.com/luxfi/crypto` v1.20.5
(Lux Ecosystem License 1.2 — the keyed-BLAKE3 MAC the CSRF token uses,
`apps/account/csrf.go`).

## Rationale

The alternative was the one the console had: BFF proxy routes and a catch-all
forwarder whose admin service token satisfied commerce's mint gate, so
forwarding was authorization (`apps/account/account.go:18-29`). Serving each
route natively on its real domain, subject-pinned, removed the forwarder and
the allowlist that was the only thing between a signed-in member and the mint.

## Security Considerations

The wrong implementation here hands over spend authority: a minted secret key
is money, so the mint MUST require the validated caller, return the plaintext
once, and rate-limit off-gateway reach. The IAM write path is whole-row
read-merge-write and a partial submission blanks credential material — a
write that cannot first read its row MUST refuse (HIP-1040 §2). The CSRF mint
guards every ambient-cookie money write in the process, including co-resident
commerce writes, off one process-wide key (HIP-1043 §3). The avatar read is a
public door whose safety is entirely in what it can address (HIP-1042 §5).
Org creation is a tenancy-boundary write with its own failure modes
(HIP-1045).

## References

- HIP-0026 — Identity & Access Management Standard
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1040 — Appearance · HIP-1042 — Avatar · HIP-1043 — CSRF · HIP-1045 — Orgs

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
