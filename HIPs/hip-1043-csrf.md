---
hip: 1043
title: CSRF
author: Hanzo AI
type: Standards Track
category: Security
status: Draft
created: 2026-08-20
requires: HIP-0519
---

# HIP-1043: CSRF

## Abstract

`/v1/account/csrf` mints the token a browser echoes on a state-changing write.
It exists for exactly one caller shape — a request authenticated by an AMBIENT
cookie — and it is inert for every other. A facet of the `account` capability
(HIP-1200), served by `apps/account` in `hanzoai/cloud`
(`apps/account/csrf.go`); the router still serves it at the bare root today, a
pair `hanzoai/cloud` `openapi/misfiled.txt` carries.

The token is a keyed MAC over the caller's validated identity and a timestamp, so
it authorizes writes as that identity and as nobody else, and it expires.

## Motivation

A browser write on our own origin is authenticated from an httpOnly session
cookie, and a cookie is ambient: a page on another site that posts to our origin
carries it too. The negative heuristics available — origin, referer, fetch
metadata — pass VACUOUSLY when a request carries none of them, which is a
request an attacker can construct.

So a state-changing write needs a POSITIVE control: a value obtainable only by
reading a same-origin response, echoed in a header a cross-site simple or form
request cannot set without a preflight this server never grants.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### 1. Scope: only the ambient path

Enforcement applies when, and only when, the request carries NO explicit
`Authorization`/`X-Authorization` AND does carry a `Cookie`
(`apps/account/csrf.go:150`). That is exactly the ambient-cookie browser write.

Every other caller is untouched, and this is not laxity: a bearer-authenticated
request is immune because a cross-site page cannot set the Authorization header,
and a gateway-fronted request carries minted identity headers and no browser
cookie. A gate that also fired on those would be enforcing against a threat that
does not exist there, and machine callers would grow a token dance for nothing.

Within scope, enforcement FAILS SECURE: a missing or invalid token is a refusal.

### 2. The token

    token = base64url( timestamp_be64 || MAC )
    MAC   = keyed-BLAKE3( key, domain ‖ 0 ‖ user ‖ 0 ‖ org ‖ 0 ‖ timestamp )

truncated to 128 bits (`apps/account/csrf.go:100`). The MAC is BOUND to the
validated principal — user and org — so a token minted for one identity MUST NOT
authorize a write as another. It expires after a bounded lifetime, and a small
future tolerance absorbs clock skew (`apps/account/csrf.go:53`).

Verification is against the CURRENT request's validated identity, in constant
time (`apps/account/csrf.go:133`).

The token carries no secret and identifies nothing that is not already known to
its holder; the mint response is answered `no-store` so no shared cache holds it.

### 3. One key per process

The mint and the writes that verify are registered by different subsystems in one
process, so the MAC key MUST be resolved ONCE for the process
(`apps/account/csrf.go:63`). Resolving it per registration gives each its own
random key in the un-configured case, and no minted token ever verifies.

The key comes from the secrets plane. Absent one, a per-process random key is
generated with a warning: tokens then reset on restart and the client re-fetches
on the refusal, which is tolerable at one replica and NOT tolerable across
several. A failure of the random source is fatal — a zero key would be forgeable.

### 4. The gate is a middleware, not a decorator

The enforcement is a single middleware value used by both typed operations and
raw handlers (`apps/account/csrf.go:165`). It has to be, because a decorator
applied around a typed handler is dropped at registration and the operation ships
UNGATED — the failure is silent and looks exactly like success.

A write registered outside the minting package uses the same exported middleware
bound to the same process key (`apps/account/csrf.go:195`), so a token minted at
the door verifies at that write byte-identically. Two implementations of one
check are two answers eventually.

### 5. What it is not

This is not authentication and MUST NOT be read as authority: the gated handler
still resolves the caller and applies its own rules. The token only establishes
that the request was composed by something able to read a same-origin response.

## Rationale

The considered alternative is double-submit with a cookie, which needs no server
key. It also trusts a value the client can write, and any subdomain that can set a
cookie on the parent domain can forge one. A keyed MAC bound to the identity has
no such surface, at the cost of a key the deployment has to hold — and it already
holds one.

Binding to identity rather than to a session id keeps the token verifiable in a
stateless process: nothing has to be looked up to check it.

## Security Considerations

The token's whole strength is the same-origin policy on the READ. It follows that
the mint MUST require a validated caller, MUST answer `no-store`, and MUST NOT be
reachable in a form another origin can read — a permissive cross-origin policy on
this route would silently void the entire control.

Truncating the MAC to 128 bits is sound for a bound, expiring token; extending the
lifetime is what would weaken it, since an exfiltrated token is a bearer value
until it lapses.

Multi-replica deployments MUST configure the key from the secrets plane. With
per-process random keys, a token minted by one replica fails at another, and the
refusal is indistinguishable from an attack — which trains operators to relax the
gate.

## References

- HIP-0519 — One Identity Boundary
- HIP-0027 — Secrets Management Standard
- HIP-0106 — The Hanzo Plugin Contract
- HIP-1200 — Account — The Caller's Own Surface

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
