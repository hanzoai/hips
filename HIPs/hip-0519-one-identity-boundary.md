---
hip: 0519
title: One Identity Boundary
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Active
created: 2026-07-29
requires: HIP-0026
---

# HIP-0519: One Identity Boundary

## Abstract

Identity is verified **exactly once**, at the edge, by the gateway, against IAM.
Everything behind that boundary READS the assertion and forwards it unchanged.
No service re-validates a token. No service mints an identity header. No service
carries its own copy of the rule.

This HIP names the one blessed path and forbids the others.

## Motivation

HIP-0026 says who issues identity: Hanzo IAM. It does not say who ENFORCES it,
and in the absence of that sentence every service answered for itself. Cloud
grew a full second implementation — a JWKS client, a trusted-issuer set, an
audience allowlist, a claims cache, and a middleware that stripped the very
headers the gateway had just minted so it could mint them again from the same
token.

Two implementations of one rule is one too many, and the second is the one that
drifts. It drifted: for a period, an internal call carried five of the nine
identity headers the gateway asserts, and the four it dropped — project, minted
name, owner, org-admin — are precisely the ones a callee DECIDES on. A billing
subject prefers the minted name over the opaque id. Platform sudo is read off
`owner`, never off `isOrgAdmin`. The same handler therefore reached one
conclusion over REST and a different one over a service call, silently, in the
direction that bills or admits the wrong principal.

That class of bug is not fixed by making the second implementation better. It is
fixed by there being no second implementation.

## Specification

### The boundary

```
  client ──► gateway ──────────────────► service ──► service ──► service
             │  VERIFY (once)             read       forward     forward
             │  · strip everything the client sent
             │  · validate the IAM token (JWKS / API key)
             │  · mint the headers below from the verified claims
```

**The gateway MUST**, for every request entering the estate:

1. Delete every identity header the client supplied, before anything reads one.
2. Validate the caller's credential against IAM — a signed JWT verified against
   IAM's JWKS, or an IAM API key resolved through IAM.
3. Mint the header set below from the VERIFIED claims, and only from those.

**A service behind the gateway MUST NOT**:

- validate a token, fetch a JWKS, or hold an issuer or audience list;
- mint, rewrite, or default any header in the set below;
- accept an identity from anywhere other than the request it was given.

**A service MAY** read the set, forward it unchanged to the next hop, and apply
its own AUTHORIZATION to it. Authorization is a service's own business.
Authentication is not.

### The header set

Nine headers, named once, forwarded whole. A partial set is a defect: the
missing field is the one a callee decides on.

| header | meaning |
|---|---|
| `X-Org-Id` | the org being ACTED ON (the effective org) |
| `X-Project-Id` | the project narrowing that org; absent means the default |
| `X-User-Id` | the opaque user id |
| `X-User-Name` | the minted name; a billing subject prefers this over the id |
| `X-User-Email` | the verified email |
| `X-User-Owner` | the org the principal BELONGS TO (the home org) |
| `X-User-IsAdmin` | platform sudo: member of the reserved admin org |
| `X-User-IsOrgAdmin` | administers their OWN org — NOT platform authority |
| `X-Request-Id` | ties the hops together in the logs |

`X-User-Owner` and `X-User-IsOrgAdmin` are DIFFERENT authorities and reading one
for the other is a privilege escalation. Platform sudo is `owner == admin-org`
and nothing else.

### Behind the gateway: the trust domain

Services co-located on a host reach each other over ZAP on a unix socket. That
socket is the boundary of the trust domain:

- it is `0600` in a `0700` directory, so the filesystem decides who may connect;
- `SO_PEERCRED` attests the peer process to the kernel, which the peer cannot
  forge because the peer never sends it.

Inside the domain a caller forwards the gateway's assertion (`Ctx.Forward()`), or
— for background work with no request behind it — states the tenant it acts for
explicitly (`zip.WithCaller`). **An inbound request always wins over a stated
one**, so a job can supply an identity where there is none and can never launder
one.

The socket is NOT a boundary between our own services. A peer is already one of
ours and could name any org it liked; never read a caller-supplied org as an
authorization decision on its own.

### The one predicate set

Every authorization check reads the SAME three predicates. A service that spells
its own is a second rule:

```
principal.Validated(c)     a principal is present at all
principal.IsSuperAdmin(c)  platform sudo   (owner == admin org)
principal.IsOrgAdmin(c)    admin of their OWN org
```

A gate admitting either writes `IsSuperAdmin(c) || IsOrgAdmin(c)` — explicit, so
the superset is visible AT the gate rather than hidden inside a predicate.

### Ingress that is not identity

Two things look like authentication and are not. Both are permitted, and neither
may grant a principal:

- **Key-shape predicates** (`isAPIKey`, publishable-key detection) — used to
  redact a credential from an audit record, and to refuse to treat a publishable
  key as authentication. They classify a string; they do not authenticate.
- **Tenant attribution** (`OrgForKey`) — resolves a key to the org whose beacon
  it is, so an ingest door can attribute analytics. Resolvable is not
  authenticated, and a publishable key MUST NOT resolve to a principal.

### Conformance

A repository conforms when all of these hold:

1. No JWKS client, issuer set, or audience allowlist outside the gateway and IAM.
2. No middleware that writes any header in the set above.
3. Every authorization check reads the three predicates, and no other.
4. Service-to-service calls forward the whole set — a projection that carries a
   subset is a defect, and is testable by asserting all nine cross.

## Security Considerations

**Direct reachability.** The model rests on the gateway being the only ingress.
A service listener reachable without traversing it accepts whatever headers a
caller sends. Deployments MUST keep service ports off the public network and
reachable only from the gateway; this is a network-policy obligation, and it is
the single assumption the whole boundary stands on.

**Why verifying twice is not defence in depth.** A second verifier does not add a
check; it adds a second answer. When the two disagree the effective rule is
whichever ran last, and nobody wrote that rule down. The failure above was
exactly this shape, and it was silent in both directions.

**Blast radius of the trust domain.** Any process inside it can act for any
tenant. That is a deliberate consequence of verifying once, and it is why the
socket's mode and peer credential are load-bearing, and why a service must never
read a peer's stated org as authorization.

## References

- HIP-0026 — Identity & Access Management Standard (who issues identity)
- HIP-0106 — Wire protocol stack (JSON is the boundary format; ZAP behind it)

## Copyright

Released under the MIT License.
