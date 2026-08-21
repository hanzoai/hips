---
hip: 1031
title: Commands — The Callable Projection
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2026-08-20
requires: HIP-0122, HIP-1030
---

# HIP-1031: Commands — The Callable Projection

## Abstract

`/v1/commands` serves every operation the API answers reduced to what running it
BY NAME needs: a service and command token, a method and path, the prose lifted
from the handler, path parameters as positional arguments and the rest as typed
flags.

It derives nothing. It hands the rendered OpenAPI document (HIP-1030) to the same
function the `hanzo` CLI's command tree is built from, over the same bytes every
published SDK is generated from, and serves what comes back
(`openapi/command.go`). A route registered this morning is a palette entry, a CLI
command and a chat command this afternoon, with nothing written down twice.

## Motivation

Surfaces that let a person run an operation by name — a `⌘K` palette, a CLI, a
chat command — each need the same list, and each historically built its own.
A hand-kept list is wrong the week after it is written, and wrong in the
direction that hides working functionality.

The document already holds the answer, so this address is not a new source. It
exists for ONE measured reason: the fleet document is megabytes and a browser
palette cannot load it to find a single command. The measurement, and the honest
size of the win, are recorded beside the code that makes it
(`openapi/command.go`) — **measure it before quoting it**, because the figure the
design was originally justified with came from a different artifact entirely.

## Specification

The key words MUST, MUST NOT, SHOULD and MAY are to be interpreted as in
RFC 2119.

### §1 One artifact, read twice

The projection MUST be taken from the document's OWN renderer, so whichever of
the two addresses is asked for first renders the document and the other is a
projection of exactly those bytes (`openapi/command.go:152`). A second build that
could differ is the whole defect this avoids.

The address is `/v1/commands` (`openapi/command.go:81`) — `/v1/` only, no `/api/`
prefix, never a `v2`. Like the document, it is unauthenticated and for the same
reason: a client has to read the contract before it holds a credential, and a
list of operation names grants nothing.

Both the document and this projection are operations with no owning subsystem, so
each declares itself (`openapi/command.go:96`). A door the prose calls
unauthenticated and the contract calls credentialed is one of the two lying to a
generated client, so the declaration carries both facts.

### §2 The wire shape is the registry's own type

The payload MUST be the registry's `Command` value, unedited. A hand-picked
subset of its fields would be the second shape this design exists to avoid, and
the first surface needing a dropped field would have to add it back somewhere.

If the weight has to come down, it comes down in the registry or in compression —
NOT by forking the type. Most of the payload is prose, and the prose is the
search corpus a command bar actually wants.

### §3 The list is TOTAL and MUST NOT be filtered by caller

Nothing is filtered — not by method, not by product, and above all not by who is
asking.

    The registry states what exists.
    The authorizer states what you may do.
    The surface renders the refusal honestly.

Permission is decided per request on the DECODED INPUT, over REST and MCP alike.
A filtered list would be a second, static claim about permission that the
authorizer is free to contradict — wrong on the day it is written and wronger
afterwards. The accepted cost is that a surface may show a command its caller
cannot run and get a refusal when they run it. That is strictly better than a
command that silently does not exist.

Method rides along because it is already in the registry and it is what lets a
bar be safe without a second list: `GET` is safe to browse fuzzily, everything
else must be named exactly. That is a RENDERING rule owned by the surface, stated
here only so no surface invents the data it needs.

### §4 The payload is a function of the document

The list MUST be put in a TOTAL order before it is serialised: service, name,
then method and path (`openapi/command.go:132`). Service and name alone leave
ties — how many, and the one command several services each claim, are measured
beside that code — and a tie falls back to whatever order a map walk produced. So
two replicas weaving the SAME document answer with different bytes under
different tags, and every conditional request that lands on a different replica
becomes a full re-download, which is exactly what the tag was for.

The response MUST carry a strong `ETag` over the rendered bytes and MUST answer
`304` to a matching `If-None-Match`. The route table is fixed after boot, so a
matching tag is proof the caller already holds the whole list.

An empty result MUST serialize as `[]`, never `null`: a client maps over it.

### §5 Refused

- Deriving a command from anything but the document.
- A second command shape, or a trimmed one, on this address.
- Any per-caller filtering, including "hide what would 403".
- Rendering the list eagerly at boot. It is lazy, which keeps the weave off the
  host's start path and is what lets the document contain the route being
  registered.

## Rationale

The alternative is a field on the document — one address, one fetch. It is
refused for weight alone, and this HIP says so plainly rather than inventing a
second justification. The win is real and it is modest — both sizes are measured
beside the code — and the whole difference is the schema material a palette does
not need.

The other alternative is a curated command catalogue, hand-listing what is worth
offering. That is the list that goes stale, and staleness here means a person is
told the product cannot do something it does.

## Security Considerations

Publishing operation names grants nothing; every named route stays individually
authorized, and no route may depend on absence from this list for protection.

The refusal to filter is the security-relevant choice, and it is deliberate: a
filtered list is a permission claim computed in a second place, on different
inputs, from the one that actually decides. Two answers to "may I" is how a
surface comes to show something it should not, or hide something a caller is
entitled to.

## References

- HIP-0122 — zip/zap Native Application Server
- HIP-1030 — OpenAPI — The Served Contract

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
