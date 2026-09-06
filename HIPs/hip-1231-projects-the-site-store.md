---
hip: 1231
title: Projects — The Site Store
author: Hanzo AI
type: Standards Track
category: Application
status: Final
implementation-go: shipped
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
capability: projects
---

# HIP-1231: Projects — The Site Store

## Abstract

`projects` is where an org's sites live: create a project, deploy a build,
promote a release, roll back to any earlier one. It is the one org-scoped
store of buildable, deployable sites, shared by every surface that shows a
user's projects — the builder and the console render the same rows because
both call this one surface (`apps/projects/projects.go:1-13`). It is
implemented in `hanzoai/cloud` at `apps/projects`. This HIP states the target
surface — one address, `/v1/projects` — and carries the browser tag endpoint,
formerly HIP-1068, which is a projects address because the project store is.

## Motivation

The capability answered at five top-level addresses for one store, including
a fourteen-path mirror of the sites surface under another capability's name.
A reader met `SitesApi`, `ProjectsApi`, `EdgeApi`, `TagsApi` and half a
`PlatformApi` for one subsystem, and two spellings of every release
operation. One store is one capability (HIP-0139 §7.1); the mirror is an
alias, and there is no alias.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be
interpreted as in RFC 2119.

### One store

The capability owns one store: the system-namespace `projects` SQLite
database (`apps/projects/store.go:211`) — project rows, deployment rows,
release state, and the global `site_hosts` table
(`apps/projects/store.go:267`), which binds a globally-unique public
hostname to exactly one `(org, slug)`, first-come, with `status` separating
holding a name from serving it. Site bytes live in our S3 under
`<org>/<slug>/`; the store holds the pointer that makes one release live.

### The addresses

Every route is under `/v1/projects`:

- the collection and per-slug lifecycle — create, list, get, update, delete,
  deploy, deployments, purge, domains;
- the site collection ops at `/v1/projects/sites` — generate from a brief,
  deploy a raw file manifest, fork, list the org's live sites;
- releases per slug — publish, promote, list, activate (the rollback);
- `/v1/projects/edge` — the CDN state endpoint: provider, reach, cache policy
  for the org's published sites (`apps/projects/edge.go`);
- `/v1/projects/tags` — the browser tag endpoint below.

The router today still serves four stray roots — `/v1/sites`, `/v1/edge`,
`/v1/tags`, and the `/v1/platform/sites` mirror; each pair is a line in
cloud's `openapi/misfiled.txt`. The first three fold here; the mirror is
deleted, not folded — an alias is not one of the ways a misfiled pair closes
(HIP-0139 §7). Per-slug operations that already carry the `/v1/projects`
spelling keep it; the second spelling goes.

Operations are typed except the two archive uploads, and the reason is the
wire, not effort: their request body is bytes — a zip or tar, raw or as a
multipart part — and a typed body is JSON-decoded before the handler runs,
so typing them would answer a real archive with 400. Each declares its byte
request through the registry instead (`apps/projects/projects.go:424-449`).

### The tag endpoint

`GET /v1/projects/tags` tells the hosted analytics tag which client-side
pixels a site has connected, so it can inject them first-party. It is one
public read, resolved per site — from the publishable key when it names a
project, otherwise from the request host — and it MUST return non-secret
identifiers only: the pixel ids a page would carry in its own markup anyway.
Without a resolvable site it answers an empty set at 200, never an error —
a page's tag configuration is fetched during load, and a broken page is
worse than an unmeasured visit. It MUST be served by the process that holds
the project store: served anywhere else it reads nothing and answers empty
with a 200, the answer that carries no signal (`apps/projects/tagdoor.go`).

### Tenancy

The org is minted by the gateway from the validated IAM JWT (HIP-0026) and
is not an input to any handler; a deploy debit and every cap are keyed on
the resolved caller org, hardened against a masquerading admin, with the
validated project sub-scope threaded so a forged `X-Project-Id` can neither
hard-stop nor evade a cap (`apps/projects/billing.go:30-45`). The tag endpoint
is deliberately public and can address no other org's project: a key that
names no project falls back to the host, and a host that names no site
yields the empty set rather than a default.

### Metered

The capability is metered (`plugin/projects/main.go:22`): one flat per-deploy
hosting debit — gate, then work, then meter once on success — at
`CLOUD_HOSTING_FEE_CENTS` ($1.00 default; 0 makes deploys free and
therefore un-gated), attributed to provider `hosting`, kind `deploy`,
through the shared `cloud.ResourceMeter` (`apps/projects/billing.go:22-27`).
A failed deploy is never billed; a redeploy is a distinct billable event
that returns the same URL.

### Events, observability, stage

The capability publishes no events on the bus, so a customer's webhooks
receive nothing from it. It emits `build.started`, `deploy.live` and
`deploy.failed` on the in-process lifecycle stream
(`apps/projects/deploy.go:311,179,162`), best-effort and detached, so the
chat notifiers can post about a site going live. Beyond the request span it
emits structured log lines only. Its stage is `ga`: the manifest row carries
no stage field, and absent means `ga` (HIP-0139 §8).

### Upstreams

The capability forks nothing. It links the Hanzo S3 client (`hanzos3/go`)
to upload site bytes; serving is the static plugin's, and the edge endpoint
reports on it rather than implementing it.

## Rationale

The alternative to the fold is the mirror: every release operation published
twice, under two capabilities, with generated clients disagreeing about
which one is real. The alternative to keeping sites inside projects is a
split — but the site rows, the release pointer and the hostname table all
live in projects' one store, and two apps on one store is the defect
HIP-0106 names, so the split is refused by the store rule.

## Security Considerations

The wrong implementation leaks through three endpoints. A tag endpoint that returns
anything beyond publishable identifiers turns a public unauthenticated read
into a secret oracle for any site on the platform. A hostname binding
without the first-come `site_hosts` table lets one org serve under another's
name — the table is the authoritative binding the site server keys on, and
`status` is what stops a claimed-but-unproven custom domain from serving. A
deploy path that read the org from the request rather than the validated
principal would deploy into, purge, or bill another tenant's site.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
