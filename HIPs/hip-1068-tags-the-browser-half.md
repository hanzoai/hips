---
hip: 1068
title: Tags — The Browser Half
author: Hanzo AI
type: Standards Track
category: Interface
capability: tags
status: Draft
created: 2026-08-20
requires: HIP-0106
---

# HIP-1068: Tags — The Browser Half

## Abstract

`/v1/tags` tells the hosted tag which client-side pixels a site has connected, so
it can inject them first-party. It is one public read, resolved per site, carrying
non-secret identifiers only. The implementation is `hanzoai/cloud`
`apps/projects/tagdoor.go`.

## Motivation

Conversion measurement has two halves. The server forwards conversions from the
event stream (HIP-1067); the browser fires the platform's own pixel. Both are
needed — a platform reconciles them into one conversion using a shared id — and
only the browser half needs a configuration the page can fetch before it has any
identity to present.

Two facts about that configuration decide its whole design: it is fetched by an
anonymous page, and a page must not break when it cannot be answered.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### It is public and carries no secrets

The read is unauthenticated and keyed by a publishable key, exactly like the event
door it accompanies. It MUST return non-secret identifiers only — the measurement
or pixel id a page would carry in its own markup anyway. Any value that could not
appear in page source MUST NOT appear here.

### Resolution is per site, two ways

A site is resolved from the publishable key when that key names a project, and
otherwise from the request host. That second path is what lets two domains under
one org inject different pixels: an org-level key alone cannot name which site is
asking, and the host can.

The key is taken from the bearer header first, then the query. The host is taken
from an explicit parameter, then the origin, then the referrer, reduced to a bare
hostname.

### It fails safe

Without a resolvable site the answer is an **empty set at 200**, never an error
and never a redirect. A page's tag configuration is fetched during page load; an
error there is a broken page, and a broken page is a worse outcome than an
unmeasured visit.

### Only platforms with a client pixel appear

A connected platform is listed only if it has a client-side injector; the rest
forward server-side only. A platform with no id configured is omitted rather than
listed empty. Output order is stable, so the response does not change when nothing
did.

### The door is served by the process that owns the store

This read MUST be served by the process holding the project store, and it lives in
the projects app for that reason: a project is a site and carries its own tag
configuration.

This is not a preference. The door first lived in the forwarding app, which runs
as a different process, so its reach for the store resolved to nothing and the
door answered empty in production — with a 200, which is the answer that carries
no signal at all. The rule the site key resolver already followed is the rule
here: **the door that reads a store is served by the process that holds it.**

## Security Considerations

The surface is deliberately public, so the security property is entirely about
what may cross it: non-secret identifiers, for a site the caller could already
identify by visiting it. Site resolution derives from a publishable key or the
request host, and neither can address another org's project — a key that names no
project falls back to the host, and a host that names no site yields the empty
set rather than a default.

## References

- HIP-0106 — Hanzo Plugin Contract
- HIP-1067 — Destinations — Conversions Forwarded

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
