---
hip: 1321
title: DNS — Zones and Records
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: dns
status: Final
implementation-go: shipped
created: 2026-08-21
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1321: DNS — Zones and Records

## Abstract

`/v1/dns` is the zones and records behind every name an org points at Hanzo. It
is implemented in `hanzoai/cloud` at `apps/dns` (HIP-0106) as a head over the
Hanzo DNS control plane (`dns/plugin/hanzodns`), which owns the authoritative
zone and record store.

This HIP states the boundary between `dns` and `domain` (§1), the relay's
identity rule (§2), and why the surface is five untyped operations rather than a
typed CRUD (§3).

## Motivation

`dns` and `domain` are one word apart in English and two different questions in
practice, and the estate has folded pairs like this before. The fold is wrong
here. Buying a name and operating the zone under it are separate acts with
separate lifetimes: an org can hold a name it serves nowhere, and can serve a
zone for a name bought somewhere else. Folding either into the other would put a
registrar's billing and a nameserver's records behind one address, and a caller
who wanted one would be handed both.

Both are also heads over the same upstream plane, which is what makes the
temptation to merge them look reasonable from the router's side. Sharing an
upstream is not sharing a store, and HIP-0139 §7 decides capability boundaries by
the store, not by the hop behind them.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The boundary: the name, and the zone under it

- **domain** (HIP-1123) is the name as property: searching for one, buying it,
  renewing it, and who holds it.
- **dns** is the zone under a name: the records that decide what resolves, and
  what each answer is.

An org MAY hold a domain with no zone and MAY serve a zone for a name this
platform did not sell it. Neither capability MUST assume the other has a row.

### §2 It owns no store, and it substitutes no credential

Every row belongs to the DNS plane. This head holds no DNS state and caches
nothing across requests.

The plane is OIDC-gated and keys every zone per-org. The head therefore relays
the caller's OWN validated bearer (`cloud.CallerBearer`) together with the
server-derived `X-Org-Id`, and MUST NOT substitute a standing service
credential — a shared credential collapses tenants, because the plane would then
see one caller for every org. A request with no validated principal is refused
403 before any byte leaves cloud.

The head MUST build a fresh upstream request and set only the headers it means
to send. No inbound header is relayed blindly: a stray cookie, a forged `X-*` or
a second `Authorization` never crosses the hop.

### §3 Five operations, and why none is typed

The whole surface is one greedy-wildcard registration at `/v1/dns/*` carrying
every verb, so the document publishes five operations — one per method the
generator knows — and none of them can be a typed op. The wire facts that make
that so are re-verified against the pinned `zip` in `apps/dns/typed_wire_test.go`
rather than asserted here.

Prose is consequently the only thing this head can state about itself, and it
states it per method. A caller who needs the record-level shape reads it from
the DNS plane's own contract. When the module named at the registration in
`Mount` lands, the operations become typed and this section is what changes.

### §4 The name

The capability is `dns` — the initialism everyone says, in the address, the
package, the tag and this HIP, per HIP-0139 §2. It is not spelled out, and it is
not pluralized.

## Rationale

The alternative considered was folding `/v1/dns` under `/v1/domain` as a
sub-resource. It reads tidy and it is wrong twice: it asserts a registrar
relationship this platform does not require, and it puts two stores behind one
capability's name, which is the defect HIP-0106 exists to refuse.

## Security Considerations

A zone is an attack surface, not a preference. Whoever can write a record can
redirect a name, and whoever can read one learns an org's internal topology.
Because the caller's own bearer is relayed unchanged, an org reaches only the
zones the DNS plane already grants it, and this head cannot widen that — it has
no credential with which to.

Fail-closed is the default at both hops: no validated principal is a 403 here,
and an unauthorized bearer is the plane's own refusal, not this head's silence.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1123 — Domain — Registration

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
