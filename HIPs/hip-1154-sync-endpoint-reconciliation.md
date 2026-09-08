---
hip: 1154
title: Sync — Two Endpoints Kept in Step
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: sync
status: Final
implementation-go: shipped
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1154: Sync — Two Endpoints Kept in Step

## Abstract

`/v1/sync` is data sync: a Sync names two endpoints and the engine keeps them in
step, on a webhook, on a schedule, or on demand. Git — GitHub/GitLab in either
direction with native Hanzo Git — is the one provider registered today; another
kind is another Provider, with nothing in the engine to change. It is implemented
in `hanzoai/cloud` at `apps/sync`, and its safety property is a single rule: the
forge is canonical and an inbound sync may only fast-forward it.

## Motivation

Customers arrive with their code on a host they are not leaving on day one, and
the forge is only useful if it holds the same history without anyone pushing
twice. Before this capability the pieces were scattered: triggers synced
directly, the git hardening lived beside a retired object store, and no record
existed of what an advance had done. Routing every trigger through one engine
makes "why did this ref move" a question with one answer in one store.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### The store

Per-org SQLite files through the org-store registry: `storeFor` is the one way
the package reaches a store, naming the database through the single entry point a
validated org walks through (`apps/sync/sync.go`, storeFor). The store holds the
sync intent, the engine's cursor, and the two facts the forge cannot hold — what
an advance did, and where a repo replicates to. A sync is org-scoped, not
project-scoped: a link binds two endpoints within one org.

### The address

Six operations under `/v1/sync`: list, create, get, patch, delete, and
`POST /v1/sync/{id}/run` for a manual reconcile. All are typed except the
delete, which answers 204 with no body — there is no value to type. Triggers
(the GitHub App webhook, the forge push webhook) resolve to Syncs and call the
registered reconcile — they never sync directly, so the engine is the single
seam. The same reconcile and the git object seams are offered on the internal
plane to the processes the triggers actually land in
(`apps/sync/run_plane.go`, `apps/sync/import_plane.go`).

### The engine

One place a sync happens: resolve → loop-guard → cursor dedupe →
`provider.Apply` → chain, hop-bounded, kind-agnostic (`apps/sync/engine.go`). A
trigger is `webhook`, `poll` or `manual`; poll freshness is a periodic reconcile
sweep that stays dormant until `CLOUD_SYNC_RECONCILE_INTERVAL` is set on the
deployment (`apps/sync/scheduler.go`).

### Fast-forward only

An advance moves one ref from one git host to another and MUST refuse to move it
any way but forward: if the upstream's tip is not a descendant of what the forge
holds, the two have diverged and the answer is a CONFLICT with the forge
untouched — never an overwrite (`apps/sync/advance.go`). Getting this wrong is
silent — a force-push that eats a colleague's commits leaves a repository that
looks fine — so the rule is enforced by the transfer itself, a non-forcing
refspec, not by a check beside it.

### Tenancy

The org is `principal.Acting` from the validated principal
(`apps/sync/sync_api.go:110`); `storeFor` accepts only an already-validated org,
so which file a request touches has one answer from one input.

### Money, events, observability, stage

It is free — the surface declares `cloud.Free` (`plugin/sync/main.go`). It
publishes nothing on the bus: webhooks are its inputs, not its outputs. It emits
nothing beyond the request span every route gets; the advance record in the
store is the durable account of what a reconcile did. The stage is `ga`: it is
developer-tools core, the mechanism that keeps the forge in step with the hosts
customers already use.

### Upstream

The one external program is the `git` client (GPL-2.0), resolved once via
`LookPath` and run as a subprocess — never linked (`apps/sync/gitexec.go`).
GitHub and GitLab are remote protocols spoken, not code embedded. Everything
else is the fleet's own.

## Rationale

The alternative to one kind-agnostic engine is a git-sync feature, and then a
second engine when the second kind arrives. The Provider seam costs one
indirection and buys the loop-guard, cursor dedupe and hop bound being written
once. The alternative to fast-forward-only is conflict resolution, which for a
source of truth is a euphemism for choosing whose commits to destroy; refusing
with the forge untouched leaves the decision to a person holding both histories.

## Security Considerations

The dangerous shape is fixed: the upstream URL is tenant-influenced, the
credential is ours, and the process runs in our pod. Every rule the hardened
subprocess seam enforces exists for one attack — an arg slice, never a shell
string, so a URL is never interpreted; a minimal environment inheriting none of
the server's secrets; the credential carried only by env-injected
`http.extraHeader`, never argv (world-readable in /proc) and never the URL
(written to logs and reflogs); http/https only with redirects refused, so a
source cannot smuggle a `file://`/`ext::` transport or bounce a fetch onto an
internal address; an SSRF guard on every tenant-supplied host; pack subprocesses
bounded in count and memory; stderr capped and redacted (`apps/sync/gitexec.go`).
The wrong implementation of any one of these hands a tenant our git credential or
a request forger inside the cluster network.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
