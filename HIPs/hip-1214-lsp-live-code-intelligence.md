---
hip: 1214
title: LSP — Live Code Intelligence
author: Hanzo AI
type: Standards Track
category: Application
status: Draft
created: 2026-08-20
requires: HIP-0139, HIP-0026
capability: lsp
---

# HIP-1214: LSP — Live Code Intelligence

## Abstract

`/v1/lsp` is live semantic code intelligence — definitions, references, types,
hover, outline, diagnostics, completion — over a repository and its resolved
dependencies, with no toolchain on the caller's machine. The cloud side,
`hanzoai/cloud` `apps/lsp`, is a proxy: the language servers run in the
`hanzoai/lsp` daemon, jailed on its own deployment, and this side owns the
three things the daemon must never hold — the tenant, the repository and the
ledger (`apps/lsp/lsp.go:14-31`).

## Motivation

Answering a cross-dependency question means running a third-party toolchain
over untrusted bytes, and a git credential that can fetch any repository is
exactly what must not exist next to an unjailed compiler. Splitting the
capability at that line — identity and money here, compilers there — is the
design; this HIP also settles its address, which today nests inside another
capability's root.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### The surface

Every address is under `/v1/lsp`, and every operation is typed: `POST /hover`,
`/locate`, `/symbols`, `/diagnostics` and `/complete`
(`apps/lsp/mount.go:67-76`), each taking one `Query` — one position in one file
of one repository at one revision (`apps/lsp/lsp.go:60-84`). `lsp` is on
HIP-0139 §2.5's list, so the name needs no argument. Positions are the LSP's
own — 0-based lines, UTF-16 character units — passed through untouched, because
the callers are agents and editors that already speak the protocol and a
silent re-basing corrupts every multi-byte line (`apps/lsp/lsp.go:33-41`).

Today's router serves this surface at `/v1/code/lsp` (`manifest/apps.go:318`),
under the code capability's root; that pair is a line in `hanzoai/cloud`
`openapi/misfiled.txt` until the fold lands. `code` and `lsp` are two reads of
one repository — lexical search and a live language server — and stay
cross-referenced siblings, each at its own root, per §3.1.

### What this side owns

No store. The tenant is resolved from the validated principal on every request
and is the daemon's isolation key; a caller supplies a repository slug, never
an owner and never a URL, so there is no input from which one tenant could name
another's repository (`apps/lsp/lsp.go:21-25,60-66`). The revision and tree
come from the forge, read as the caller, so the forge's own ACL decides which
repositories answer; the daemon holds no git credential — the tree is pushed to
it, never pulled by it (`apps/lsp/lsp.go:26-30`).

### Money

Preparing a revision is what costs — a tree write, a dependency fetch, a
language server indexing for seconds to minutes — so the prepare carries the
fee: a flat 2¢, flat because the caller chooses the repository, not the cost of
indexing it (`apps/lsp/meter.go:38-44`). A query against a prepared revision is
a JSON-RPC round trip costing microseconds; it is recorded for attribution and
costs nothing, so callers are taught to reuse revisions rather than re-key
them. The ledger kind is `lsp` with models `prepare` and `query`, which one it
was being the daemon's answer, never a guess (`apps/lsp/meter.go:35-52`). The
gate runs before the work — an out-of-funds caller gets a clean 402 instead of
a dependency fetch nobody can bill — gating the worst case and charging the
real one (`apps/lsp/meter.go:70-77`). The payer is the selected billing org
from the request, never a body field (`apps/lsp/meter.go:54-67`). The plugin
declares `Price: cloud.Metered` (`plugin/lsp/main.go:31`).

### Events, observability, stage

It publishes no events on the bus, so a customer's webhooks receive nothing
from it, and it emits nothing to observability beyond the request span every
route gets; attribution lives on the ledger rows. The stage is `ga` — the
manifest row declares none — and `ga` here rests on the `hanzoai/lsp` daemon
deployment actually serving; a deployment without the daemon MUST declare the
capability `beta` rather than 503 behind a `ga` door.

### Upstreams

This package derives from none: it implements the Language Server Protocol's
position semantics as a wire fact and proxies its own daemon. The third-party
language servers themselves run inside `hanzoai/lsp`, jailed, and are that
repository's account.

## Rationale

The alternative argued in the package's own doc was one home — lsp under
`/v1/code`, because an agent searches with code and is certain with lsp
(`apps/lsp/lsp.go:7-12`). The cross-reference survives; the address does not:
HIP-0139 §3.1 makes a second capability under another's root a misfiled route,
and lsp is its own app, its own plugin and its own deployment with its own
meter — everything a capability is except the address. The fold under its own
name costs one route move and removes the mount-order subtlety of a nested
prefix entirely.

## Security Considerations

What an attacker gets from the wrong implementation is a compiler running over
their bytes next to another tenant's code. The design splits the two: the
daemon that runs toolchains holds no tenant mapping, no git credential and no
ledger, and the side that holds those runs no toolchain. Tenancy has no
caller-writable input — org from the principal, repository by slug within that
org, tree by the forge's ACL as the caller — so the cross-tenant read has no
parameter to arrive through. The billing subject is read from the request's
validated identity, never from the body, so a caller cannot bill somebody else
(`apps/lsp/meter.go:60-63`).

## References

- HIP-0026 — Identity and Access Management
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
