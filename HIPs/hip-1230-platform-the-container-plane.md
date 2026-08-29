---
hip: 1230
title: Platform — The Container Plane
author: Hanzo AI
type: Standards Track
category: Infrastructure
status: Final
created: 2026-08-20
requires: HIP-0026, HIP-0027, HIP-0106, HIP-0135, HIP-0139
capability: platform
---

# HIP-1230: Platform — The Container Plane

## Abstract

`platform` is the per-org container platform: projects, applications, builds,
deploys, environments, releases, logs and verified custom domains, each
application reconciled as an operator Service CR into the caller's own
`tenant-<org>` Kubernetes namespace (`apps/platform/platform.go:1-27`). It is
implemented in `hanzoai/cloud` at `apps/platform`. This HIP states the target
surface — one address, `/v1/platform` — and carries two pieces previously
specified apart: the forge push endpoint (formerly HIP-1070) and the pipelines
board (formerly HIP-1071), both platform addresses because their
implementation is this package.

## Motivation

The capability's routes grew at eight top-level addresses while its store,
its process and its name were one: a generated client offered a `BuildsApi`,
a `RunnerApi` and a `PlatformApi` for one subsystem, and one root carried a
name the grammar refuses outright (`git-webhook`). One store is one
capability however many nouns it answers for (HIP-0139 §7.1).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be
interpreted as in RFC 2119.

### One store

The capability owns one store: the system-namespace `platform` SQLite
database (`apps/platform/store.go:131`), holding project, application, build,
deployment, environment and release rows. Tenancy is the `org` column on
every table, enforced in every WHERE clause; the store exposes no method that
reads a row without the org (`apps/platform/store.go:22-28`).

### The addresses

Every route is under `/v1/platform`: `apps`, `builds`, `cd`, `ci`,
`environments`, `fleet`, `health`, `hook`, `pipelines`, `projects`,
`releases`, `run` and `runner`. `/v1/platform/ci` answers 501 naming what is
missing — an address the fleet publishes and routes nowhere is the defect the
manifest exists to prevent (`manifest/apps.go:140-145`). The router today
still serves seven of these families at the root (`/v1/builds`,
`/v1/environments`, `/v1/git-webhook`, `/v1/pipelines`, `/v1/releases`,
`/v1/run`, `/v1/runner`); each pair is a line in cloud's
`openapi/misfiled.txt` and folds here, with `git-webhook` — a hyphenated
compound — renamed to `hook` in the same move.

Operations are typed zip operations except the push endpoint, which cannot be:
its authentication is an HMAC over the raw bytes checked before the payload
is parsed, and a typed operation decodes first (`apps/platform/hook.go:19-22`).

### The push endpoint

`POST /v1/platform/hook` is where the forge delivers a push. The receiver
MUST live in this process because the deploy trigger has exactly one
registrant, and it is platform's: the endpoint once lived in git's process, where
that registrant is nil, so every delivery was signed, accepted, answered 204
and built nothing (`apps/platform/hook.go:1-17`).

The forge holds no platform session, so the address is public at the identity
layer and authenticated by the HMAC signature; the bytes verified MUST be the
bytes acted on, and the event kind is taken from the payload, never a header.
Four bounds keep an unauthenticated endpoint from being a lever: an encoded body
is refused 415 before it is touched, a body cap bounds what is hashed, the
verifying secret refreshes on a bounded window from KMS (HIP-0027), and that
key-store read times out below the forge's delivery timeout. An unreadable
secret answers 503, not 401 — the fault is ours. Duplicates are remembered by
fact (namespace, repository, ref, commit) for a bounded window, and a failed
dispatch gives the memory back. The forge half is one forge-wide system
webhook signed with the value at the configured KMS reference; a repository
opts in by having an application that tracks it, not by owning a hook.

### The pipelines board

`GET /v1/platform/pipelines` is a projection, not a record: one application's
build and deploy configuration joined with its latest run
(`apps/platform/console.go:227`). The surface MUST be read-only — a pipeline
comes into existence only through the one existing write path — and where an
application has a latest deployment, that deployment's status replaces the
configuration's. The same rule governs the sibling boards it sits beside:
an environment is a scope derived from the applications that target it, a
build row is a real record or an honest empty, a release is a deployment that
was actually applied.

### Tenancy

The org is the gateway-minted, IAM-validated claim (HIP-0026), read as
`c.Org()`; the deploy namespace is derived from it as `tenant-<org>`, never
taken from the request, and cross-tenant identifiers are structurally not
inputs to any handler (`apps/platform/platform.go:20-26`). Console reads
additionally require the identity to carry a user, refusing the one forgeable
path — a caller reaching a pod directly with an asserted org and no bearer.
Two endpoints differ by audience: `/v1/platform/fleet` is the operator's drift
board, admitted only for a SuperAdmin or an org-confined OrgAdmin
(`apps/platform/fleet.go:31-34`, HIP-0135), and the push endpoint authenticates
by signature as above. `POST /v1/platform/runner` — the privileged build
trigger `hanzo build` and the push hook call — is gated by a constant-time
shared token plus an image-ref allowlist confined to the registries we own
(`apps/platform/runner.go:1-13`).

### Metered

The capability is metered (`plugin/platform/main.go:21`), and every debit
lands in integer cents through the shared `cloud.ResourceMeter` on the
caller's org ledger:

- **build minutes** — wall-clock from build creation to observed Job
  completion, once per completed build, at `CLOUD_BUILD_MINUTE_CENTS`
  (policy default $1.00/min; 0 makes builds free)
  (`apps/platform/buildmeter.go:1-20`);
- **running compute** — each tick charges every live app's org for the span
  since its compare-and-set watermark, at the app's SBOM compute rate, so a
  double-tick or restart never double-charges
  (`apps/platform/computemeter.go:1-30`);
- **the run fee** — a flat gate-then-meter-on-success debit per
  `/v1/platform/run` deploy at `CLOUD_PLATFORM_RUN_FEE_CENTS`
  (`apps/platform/run.go:36`).

### Events, observability, stage

The capability publishes no events on the bus, so a customer's webhooks
receive nothing from it. It emits lifecycle facts — `push.landed`,
`build.started`, `deploy.live`, `deploy.failed` (`build.go:582-585`) — on the
in-process stream (`apps/platform/hook.go:628`, `apps/platform/deploy.go:290`,
`apps/platform/applylive.go:94`), fanned to registered reactors: the deploy
subscriber, mirror-out, and chat notification. Beyond the request span it
emits structured log lines only (`apps/platform/run.go:227`). Its stage is
`ga`: the manifest row carries no stage field, and absent means `ga`
(HIP-0139 §8).

### Upstreams

The capability forks nothing. It links `go-git/go-git` v5 (Apache-2.0) to
read pushed repositories in memory, `k8s.io/apimachinery` (Apache-2.0) to
write operator CRs, and `Masterminds/sprig` v3 (MIT) for template functions.
Builds execute in an in-cluster BuildKit (Apache-2.0) Job launched by image;
nothing of BuildKit is linked into the binary.

## Rationale

The alternative to carrying the hook and the board in this HIP is two more
specification files for two things that are single routes of this package —
one capability sliced into three specs, the inversion of the defect HIP-0139
§6 names.

## Security Considerations

The wrong implementation hands an attacker the build plane. An unsigned or
parse-before-verify hook lets an unauthenticated caller mint builds in the
process that owns deploys; an encoded body accepted at that endpoint buys
megabytes of allocation for kilobytes on the wire. A deploy namespace taken
from the request is a cross-tenant deploy; it is derived from the validated
org instead. A leaked runner token without the image-ref allowlist pushes to
an arbitrary registry; with it, only to ours. The fleet board without its
admin guard is a fleet-wide rollout lever exposed to every tenant.

## References

- HIP-0026 — Identity and Access Management
- HIP-0027 — Secrets Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0135 — What Is Public
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
