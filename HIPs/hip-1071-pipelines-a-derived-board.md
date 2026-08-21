---
hip: 1071
title: Pipelines — A Derived Board
author: Hanzo AI
type: Standards Track
category: Interface
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106
---

# HIP-1071: Pipelines — A Derived Board

## Abstract

A pipeline is an application's build and deploy configuration together with its
latest run. `/v1/pipelines` is the read that renders them for an org.

It is a **projection**, not a record. This HIP specifies that distinction and what
follows from it, because the distinction is the entire contract: there is nothing
here to create, and adding a way to create one would be a second way to do
something the platform already does exactly once. The implementation is
`hanzoai/cloud` `apps/platform/console.go:227`.

## Motivation

A console page wants a board. The cheapest way to give it one is a table, and a
table needs a create, an update and a delete — at which point there are two ways
to make a pipeline, they drift, and neither is authoritative.

Every row this surface returns is derivable from records the platform surface
already owns. So it derives them.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### Derived, and therefore read-only

A pipeline is one application's configuration plus its most recent deployment.
This surface MUST be read-only.

A pipeline comes into existence only through the one existing write path —
creating an application, and triggering a build and deploy — so there is exactly
one way to make one and no duplicate trigger here.

The same rule governs the sibling projections this board sits beside: an
environment is a scope derived from the applications that target it and has no
record of its own; a build row is a real build record or an honest empty, **never
fabricated**; a release is a deployment that was actually applied.

### The status shown is the run's, not the configuration's

Where an application has a latest deployment, that deployment's status, start time
and duration replace the application's own. A board that showed configuration
status for an application whose last deploy failed would be reporting that
nothing had happened.

### Tenancy requires a user, not just an org

The org comes from the validated identity, and this surface additionally requires
that identity to carry a **user**.

The reason is the consequence of the plane rather than of the read: this is a
control plane that mutates cluster state, so trusting an org assertion alone would
let a caller reaching a pod directly assert someone else's org with no bearer at
all. Every legitimate caller arrives through the gateway or the console, both of
which mint a user-bound credential, so this refuses only the forgeable path.

The org string is normalized by the one fleet-wide sanitizer, which is injective,
so a tenant resolved here keys the same namespace boundary as everywhere else and
two distinct owners can never collapse onto one tenant. No handler reads an org
from a body or a path.

### Publishing a type puts it in a shared namespace

The fleet's schema namespace is flat: one name, one shape, wherever two apps meet,
because a generated client binds whichever it read last. A row type whose obvious
name is already published by another app MUST be renamed before it is published,
and the name that was not yet published is the one that yields.

The JSON is untouched by such a rename. The wire is the contract; the Go
identifier is not.

## Rationale

The alternative — a pipeline record of its own — buys a place to hang fields that
do not derive from anything, and costs the guarantee that the board and the
platform agree. Since every field currently shown does derive, the record would be
a cache with no invalidation story.

## Security Considerations

The read is org-scoped through the same validated-principal gate as the rest of
the control plane, and the additional requirement for a user is what closes the
direct-to-pod forgery path. The injective org normalization is the second half:
without it two distinct owners could sanitize onto one tenant string and read each
other's boards.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
