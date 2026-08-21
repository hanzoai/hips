---
hip: 1146
title: Sandboxes — The Compute Primitive
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: sandboxes
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1146: Sandboxes — The Compute Primitive

## Abstract

`/v1/sandboxes` is the ONE compute primitive: a sandbox is a gVisor pod that
runs somebody else's code, and every lifetime is the same object — a function
invoke is a sandbox with a seconds-long lease, a code-exec call one with a
session lease, an agentic coding run one with a project volume and a long
lease. Not three subsystems, not three schedulers: one record, one pod spec,
one way in (`apps/sandbox/sandbox.go:1-10`). The implementation is
`hanzoai/cloud` `apps/sandbox` (the manifest and plugin name the capability
`sandboxes`; the package keeps the singular noun).

## Motivation

Running submitted code is one problem however it arrives, and the platform
built it three times before it built it once: exec's predecessor shipped an
in-pod HTTP daemon with eleven endpoints, a shared pool-wide API key and a
pod-IP address book, all deleted because Kubernetes already had the channel
(`apps/sandbox/sandbox.go:32-38`). What differs between a function run and a
coding run is `ttlSec` and whether a volume is attached — a class row, not a
subsystem.

## Specification

The key words MUST, MUST NOT and SHOULD are to be interpreted as in RFC 2119.

### The store

One SQLite file per org, `{DataDir}/orgs/{org}/sandbox.db` via `cloud.OrgDB`:
the org's sandbox registry. Isolation is PHYSICAL — a different org is a
different file — with the org column kept as defence in depth
(`apps/sandbox/store.go:57-61`). The pods themselves are cluster state, bound
by the `Bound` namespace+label pair whose constructor refuses `kube-system`,
`default`, `hanzo` and every `kube-*` namespace before a client even exists
(`apps/sandbox/bound.go`).

### Addresses

Nineteen operations under `/v1/sandboxes`
(`apps/sandbox/sandbox.go:241-296`). Thirteen are raw routes with prose
declared beside each (`openapi.Describe`): the collection and member CRUD,
`POST /{id}/exec`, `GET|POST /{id}/fs`, and the ticketed terminal and screen
trios — the terminal is a WebSocket PTY and the screen a live display, wires no
typed op can answer. Six ARE typed ops, registered from the same handlers the
internal plane serves (`lease`, `run`, `read`, `write`, `stop`, `end`), so an
agent at the fleet door can name them; `stop` ends the WORK and `end` ends the
RESOURCE, two verbs because a run that went wrong is one somebody still wants
to look at.

There MUST be exactly one way into a sandbox — the Kubernetes exec subresource;
fs read/list/write are `cat`, `ls` and `tee` over that channel, never a second
one. Nothing runs in this package: no `os/exec`, ever
(`apps/sandbox/sandbox.go:47-50`).

### Addressing and lifetime

A sandbox is addressed by POD NAME through the apiserver, NEVER by IP: a pod
that dies on its own never runs a release path, and a row holding a stale IP is
served by whichever stranger the CNI handed that address to
(`apps/sandbox/sandbox.go:38-46`). Names are minted per sandbox and never
reused. There is no pool: a sandbox is created for a lease and deleted at its
end; the reaper (every minute) ends expired leases and sleeps sandboxes idle
past an hour, and its orphan sweep deletes by name+UID precondition only what
carries the sandbox label inside the bound namespace, aborting whole when any
store is unreadable.

### Tenancy and credentials

The org is `principal.Org`, refused when absent; it selects the per-org file
and every pod's ownership. No caller credential reaches a sandbox from the pod
spec — a spec value is a value in etcd — and the ONE credential a lease is
handed arrives over the exec channel: a short-lived IAM token EXCHANGED
(RFC 8693) for the token the caller presented, acting as the `hanzo-sandbox`
client which deliberately lacks the admin-mint capability, expiring with the
lease and carrying no refresh token (`apps/sandbox/cred.go:1-28`). The pod
carries no ServiceAccount token at all.

### Money

Metered at a price of zero: `plugin/sandboxes/main.go` declares
`Price: cloud.Metered` and `sandboxes` is in the `meteredApps` standing list
(`spend.go:311`). A lease is gated and debited through the shared
`cloud.ResourceMeter` under kind `sandbox`, but every class fee defaults to 0
(`SANDBOX_FEE_CENTS[_EXEC|_DEV|_DESKTOP]`), deliberately not to the platform's
$1.00 default: shipping the meter must not also ship a price, and turning one
on is a values change (`apps/sandbox/api.go:128-135`). Bursts are bounded independently of price: an
org's live exec-class sandboxes are capped, refused with 429 because the
correct caller response is to wait.

### Events, telemetry, stage, upstream

It publishes nothing to the bus, so a customer's webhooks receive nothing from
it; beyond the request span it emits log lines only. Stage `ga`: the manifest
row (`manifest/apps.go:368`) declares no stage, and absent means `ga`. Upstream: `k8s.io/client-go`
(Apache-2.0) is the imported client; gVisor's `runsc` and the Kata runtimes
(Apache-2.0) are the isolation boundaries the pod spec selects by RuntimeClass,
run by the cluster, embedded by nothing here.

## Rationale

One primitive with a class row, instead of per-product runtimes, is the whole
design: every fact a sandbox must get right — tenant file, pod addressing,
lease, credential ceiling, reaper — is written once and inherited by function
invokes, code exec and coding runs alike, where three subsystems were three
places to get one of them half-right. The closed `classes` table exists because
its predecessor — three tables in two files — let a new class be half-added
silently: missing from the TTL map it was reaped before its caller finished
reading the reply (`apps/sandbox/sandbox.go:92-101`).

## Security Considerations

This capability's job is running hostile code, so the attacker is assumed to be
inside the pod. What the wrong implementation hands them: a platform credential
(closed by the exchange ceiling — the acting client cannot mint for reserved
orgs, so even an operator's lease starts unprivileged); another tenant's pod (a
stale IP in a row — closed by name-only addressing; a recycled name — closed by
UID preconditions on delete); or the cluster itself (a sweep with a hurried
selector once deleted kube-system DaemonSet pods, which is why the
namespace+label bound is a type no call site can construct half of). The
per-org file plus the org column is the read boundary; the missing
ServiceAccount token is what makes the pod's inside worth less than its
outside.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability
- RFC 8693 — OAuth 2.0 Token Exchange

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
