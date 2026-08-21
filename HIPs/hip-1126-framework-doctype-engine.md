---
hip: 1126
title: Framework — The DocType Engine
author: Hanzo AI
type: Standards Track
category: Core
capability: framework
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1126: Framework — The DocType Engine

## Abstract

`/v1/framework` is document types an org defines: describe a record once — its
fields, naming rule, lifecycle, and which role may do what — then create, list,
submit and cancel documents against it. The engine is
`github.com/hanzoai/framework`, built on the metadata model
`github.com/hanzoai/doctype`; neither knows what HTTP is, and the cloud
subsystem at `apps/framework` is the adapter — the "place" in the engine's
layering (`apps/framework/framework.go:6-14`). This HIP states the store the
place opens, how a request becomes an engine caller, and the one surface that
cannot carry a schema.

## Motivation

Several application lanes — cms, erp, help, knowledge, content, guide — each
need "a record type with permissions and a lifecycle". Building that per lane
is the same engine five times, drifting. The adapter re-exports the engine
vocabulary so every lane keeps one import and compiles unchanged
(`apps/framework/framework.go:22-24`), and the engine enforces permissions
itself, so there is no authorization logic here — a second copy would be a
second answer (`apps/framework/framework.go:29-31`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store

framework owns one store: the engine's single database, opened by cloud's
storage policy — `sqlpool.Open("framework", DataDir)`, encrypted at rest under
a KMS-held master key (`apps/framework/framework.go:73-85`). Cloud names the
file rather than accepting a path from the library, because a name is what
keys an encrypted file and a handed-down path cannot be. The rows inside are
per-org — every DocType and document belongs to the caller's org — with
isolation enforced by the engine's own permission calculus.

### §2 The addresses

Every route is under `/v1/framework` (`manifest/apps.go:173`). DocType
definition, roles, modules, the summary, document reads, submit and cancel are
typed operations; the DELETEs answer no body and carry no response schema. The
two document writes — `POST /v1/framework/{doctype}` and
`PUT /v1/framework/{doctype}/{name}` — are raw handlers and MUST stay raw until
the registry can carry them honestly: their request body is the document's own
field data, a flat object whose properties the DocType defines at run time, and
no Go struct both accepts that body verbatim and describes it. A reflected
schema would name the two path segments and nothing else — an SDK method that
cannot send a document. The three registry properties required to convert them
are enumerated at the registration, and a test holds the refusal until all
three exist (`apps/framework/framework.go:130-147`).

### §3 Tenancy

The bridge parks the validated identity facts on the subtree before any route
runs (`apps/framework/framework.go:107`), and each operation turns the
validated principal's org into an engine Caller
(`apps/framework/framework.go:249`, HIP-0026); what the identity boundary
refuses, this surface refuses. On a fresh org the first caller to administer
DocTypes is seeded as its System Manager, after which only a System Manager or
a platform admin may define (`apps/framework/framework.go:395-399`) — the
engine's calculus, not the adapter's.

### §4 Money, events, telemetry

framework is free, in those words (`plugin/framework/main.go:21`, `cloud.Free`;
not in `spend.go:275`). It publishes no events on the bus, and emits nothing to
observability beyond the request span every route gets.

### §5 Stage

framework is `ga`: the data core the application lanes stand on, part of the
agentic OS rather than a vertical application.

### §6 Upstream

framework derives from no third-party code. Its engine and metadata model are
the Hanzo modules `hanzoai/framework` v0.1.0 and `hanzoai/doctype` v0.1.0,
which this package adapts and re-exports.

## Rationale

Value / engine / place, rather than one HTTP-aware engine, is what keeps the
permission calculus testable without a server and reusable by lanes that are
not HTTP at all. The cost is an adapter whose whole job is translation —
principal to Caller, engine Code to HTTP status — and that cost is paid once
here instead of once per lane.

## Security Considerations

The wrong implementation answers with another org's records or lets a
non-manager redefine a type out from under its documents. Both gates are the
engine's: the adapter contributes only the validated org, never a
client-supplied one, and deliberately holds no authorization logic that could
disagree with the engine's answer. The store is encrypted at rest, so a copy
of the deployment's data directory does not yield the documents without the
key service.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
