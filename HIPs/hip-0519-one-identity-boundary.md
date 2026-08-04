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

Identity is verified **exactly once, at the edge**, against IAM. Everything
behind that boundary READS the assertion and forwards it unchanged. No service
re-validates a token. No service mints an identity header. No service carries its
own copy of the rule.

**The edge is a ROLE, not a component.** This HIP is about the property — one
verification, at the entry point, and nothing behind it re-deciding — never about
which binary holds it. In this estate the role is held by the `cloud` binary's
own edge (`SanitizeIdentity`): the standalone gateway was deliberately retired,
`api.hanzo.ai` resolves through Traefik straight to `cloud`, and Traefik holds no
JWKS client and mints none of the headers below. `cloud`'s middleware is
therefore not a second implementation — **it is the one this HIP requires**, and
deleting it deletes the estate's only identity boundary.

A spec that named the component instead of the property would read as an
instruction to delete the boundary. This one names the property.

## Motivation

HIP-0026 says who ISSUES identity: Hanzo IAM. It never said who ENFORCES it, and
in the absence of that sentence two failures became possible, one of which
happened and one of which nearly did.

**What happened.** The identity a service-to-service call carried drifted from
the identity the edge asserts. For a period an internal call forwarded five of
the nine headers, and the four it dropped — project, minted name, owner,
org-admin — are precisely the ones a callee DECIDES on. A billing subject prefers
the minted name over the opaque id; platform sudo is read off `owner`, never off
`isOrgAdmin`. The same handler therefore reached one conclusion over REST and a
different one over a call, silently, in the direction that bills or admits the
wrong principal.

**What nearly happened.** Reading the edge's own middleware as a *duplicate* of a
gateway that no longer exists, and deleting it. The standalone gateway was
retired and `cloud` inherited the role; a reader who knew the old topology and
not the new one sees two verifiers where there is one. That reading gets as far
as a demonstrated cross-tenant secret read.

Both failures come from the same missing sentence, so this HIP states the
property rather than the topology: **one verification, at whatever holds the
edge, and nothing behind it re-deciding.** A count of implementations is not the
rule; the rule is that exactly one of them is at the entrance.

## Specification

### The boundary

```
  client ──TLS──▶ ingress          TLS TERMINATION ONLY. No identity, no authz.
         ──PQ ZAP/QUIC──▶ gateway  THE EDGE: JWT verify, authz, rate limit.
         ─────────────▶ cloud      Holds NOTHING. Reads the assertion.
         ──ZAP/UDS────▶ plugins    Capabilities, EAFP.
```

One transport family end to end — ZAP over QUIC across hosts, ZAP over a unix
socket on-host — and one identity verification, at the gateway.

Each tier holds exactly one concern. Ingress terminates TLS and decides nothing.
The gateway is the edge: it strips, verifies and mints. Cloud holds nothing and
reads what the gateway asserted. Plugins receive capabilities and use them.

**The edge role moves WHOLE or not at all.** All three steps below live in one
tier, and the headers are minted before the first service reads one. Splitting
them is how a tier ends up trusting a header nobody verified.

**Two things named "gateway" are not the same thing.** `hanzoai/gateway` holds
the edge — the JWT verify, the strip, the mint. `cloud/apps/gateway` is the edge
CONFIG plane (`/v1/gateway/config`: CORS allowlist, rate-limit knobs, cache TTL)
that the edge READS. A deployment carrying the second without the first has the
edge's dials and none of its decision, which is precisely how a service behind
the edge came to grow a boundary of its own.

**The edge MUST**, for every request entering the estate:

1. Delete every identity header the client supplied, before anything reads one.
2. Validate the caller's credential against IAM — a signed JWT verified against
   IAM's JWKS, or an IAM API key resolved through IAM.
3. Mint the header set below from the VERIFIED claims, and only from those.

**A service behind the edge MUST NOT**:

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

### Behind the edge: the trust domain

Services co-located on a host reach each other over ZAP on a unix socket. That
socket is the boundary of the trust domain:

- it is `0600` in a `0700` directory, so the filesystem decides who may connect;
- `SO_PEERCRED` attests the peer process to the kernel, which the peer cannot
  forge because the peer never sends it.

Inside the domain a caller forwards the edge's assertion (`Ctx.Forward()`), or
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

1. No JWKS client, issuer set, or audience allowlist outside the EDGE and IAM.
2. No middleware that writes any header in the set above.
3. Every authorization check reads the three predicates, and no other.
4. Service-to-service calls forward the whole set — a projection that carries a
   subset is a defect, and is testable by asserting all nine cross.

## Security Considerations

**Direct reachability.** The model rests on every request traversing the edge. A
listener reachable without doing so accepts whatever headers a caller sends: a
forged `X-Org-Id` + `X-User-Id` + `X-User-IsAdmin` reads another tenant's secret
VALUE, which the estate's own red-team probe demonstrates.

The obligation is met by the TOPOLOGY — ingress terminates TLS and forwards to
the gateway, which is the only thing that reaches cloud — and a network policy
merely enforces what the topology already says. Two policies that appear to
enforce it today do not:

- `network-policy-cloud-api.yaml` selects `app: cloud`. Operator-rendered pods
  carry `app.kubernetes.io/name` + `app.kubernetes.io/instance`, so the selector
  matches ZERO pods and has never restricted anything.
- `cilium-allow-cluster-ingress.yaml` allows every pod, every port, from the
  whole cluster. Cilium UNIONS allows and has no deny that overrides one, so even
  a correctly-selected policy is re-opened by it.

Both are hand-applied and absent from every kustomization, so git and the cluster
can disagree with nothing to detect it. **A policy that selects nothing is worse
than no policy: it reads as protection.**

**Removing a service's own boundary is a REPLACEMENT, never a deletion.** A
service that grew one because the edge was absent may drop it in the same change
that puts the edge in front, so the boundary never stops running for a single
request. Deleting first and wiring second is the cross-tenant read above.

**Why verifying twice is not defence in depth.** A second verifier does not add a
check; it adds a second answer. When the two disagree the effective rule is
whichever ran last, and nobody wrote that rule down.

**Rules that live inside the boundary.** Four decisions live in the edge and have
production incidents attached; whoever holds the role holds these, and moving the
role without them reintroduces the incident:

1. The tenant is `orgs[0]` of the signed membership set, NOT the `owner` claim —
   IAM stamps the APPLICATION's org into `owner`, which made the tenant
   caller-selectable (a hanzo user authenticating via lux-cloud billed lux).
2. Org-admin is role ∈ {owner, admin}, with the org compared VERBATIM — matching
   only "admin" refused every self-serve founder from their own admin surface.
3. A machine principal never gets SuperAdmin, even carrying `owner == adminOrg`.
   A machine is one with an EMPTY membership set: IAM signs `orgs: nil` on
   exactly one path, client_credentials, and every human path resolves memberships
   through the org store. It is not a principal carrying `type: "application"` —
   IAM's signed claim set has no `type` field, so a reader keying on one admits
   every machine it means to refuse. Authority is membership.
4. `X-Billing-Account-Id` and `X-Project-Id` are minted from signed claims only,
   with the client copy deleted on ingress. **Who pays is an identity field.**

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
