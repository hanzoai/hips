---
hip: 0115
title: Hanzo Frontend Delivery
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Active
created: 2026-06-25
requires: HIP-0036, HIP-0068, HIP-0112, HIP-0119, HIP-0504
---

# HIP-115: Hanzo Frontend Delivery

## Abstract

This is the one and only way a frontend — a site, a docs surface, a dashboard —
is organized, built, and shipped across Hanzo, Lux, and Zoo. Every frontend is
one repo in its org's apps organization, is one application on the PaaS, builds
the same way, and is served the same way. There is exactly one project per site;
there are no second implementations and no second homes.

It is the frontend peer of HIP-0119. HIP-0119 governs backend *services* — they
serve `/v1/*` and `:9090` to machines, live in per-service repos, and are deployed
by the operator. This HIP governs *apps* — they serve `/` to humans, live in the
per-org apps organization, and are deployed by the PaaS. The split is the
decomplection: machine surface vs human surface, operator vs PaaS, never braided.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, MAY are per RFC 2119.

### §1 One repo per site, in the org's apps organization

- Every frontend is its **own repository** in the `<org>-apps` GitHub organization
  (`hanzo-apps`, `lux-apps`, `zoo-apps`), cloned locally to `~/work/<org>/apps/<name>`.
- **One project per site.** A site MUST have exactly one repository. Multiple
  implementations of the same site (e.g. `docs`, `app-docs`, `platform-docs`) MUST
  be collapsed to one; the others are retired (archived), not left to rot.
- A frontend MUST NOT live in the platform/service org (`hanzoai`, `luxfi`,
  `zooai`). Those orgs hold backend services and libraries. Static content and
  sites that currently sit there MUST be migrated into the apps org. One home.
- Repos are separate (not a monorepo) precisely so each app is an independent
  PaaS application with an independent deploy. Sharing is by **published package**
  (the design system), never by workspace coupling.

### §2 The design system is shared, not copied

A frontend MUST consume the design system as a dependency — `@hanzo/ui`, themed
per brand to `@luxfi/ui` / `@zooai/ui` (HIP-0504: brand UIs are *theme values*, not
forks). A frontend MUST NOT vendor or re-implement shared components. Brand differs
in values (tokens, logo, domain); shape is identical.

### §3 Build — the PaaS, one of two targets

Every app builds on the PaaS (`platform.hanzo.ai`). An app declares exactly one
build target:

- **`static`** — the default for sites and docs. The PaaS builds the app and
  publishes the static export (Next `output: export`, Vite `dist`, etc.) as an
  immutable artifact. This is the common case; prefer it.
- **`container`** — only when the app genuinely needs a server at request time
  (SSR, server actions, auth callbacks that can't be edge/static). Runs as a PaaS
  container app.

An app MUST NOT be built or deployed by a hand-run pipeline, a bespoke per-repo
GitHub Action that pushes to a host, or a second PaaS. One control plane.

### §4 Serve — static to s3 + ingress, no nginx

- A `static` app's artifact MUST be published to **`hanzoai/s3`** (the object
  store) and served by **`hanzoai/ingress` + the static plugin**. nginx, caddy, and
  per-site web servers MUST NOT be used (per the platform rule).
- A `container` app is served through `hanzoai/ingress` → the app, per HIP-0112.
- DNS is Cloudflare; TLS is cert-manager/ingress. The host is `<site>.<brand-domain>`.
- Adding a site is: new repo in `<org>-apps` → register the PaaS app (`static`,
  host) → deploy. No cluster YAML hand-editing, no new web server.

### §5 One uniform shape across Hanzo, Lux, Zoo

`hanzo-apps`, `lux-apps`, and `zoo-apps` are the same organization in three brands.
An app in any of them follows this HIP identically; only *values* differ — the org
segment (`<org>-apps`), the brand domain, the theme package. LPs and ZIPs adopt
this HIP by reference and MUST NOT restate or fork it.

### §6 Forbidden

- A site implemented in more than one repo; a site living in the service org.
- A frontend that vendors the design system instead of depending on it.
- A bespoke deploy pipeline; a second PaaS; nginx/caddy/per-site servers.
- Static artifacts served from anywhere but `hanzoai/s3` via ingress+static.

## Migration

Existing scattered frontends are migrated into the apps org one site at a time:

1. Pick the canonical repo for the site (the live, current one — e.g. `hanzoai/docs`
   for `docs.hanzo.ai`); confirm the alternates carry no unique content.
2. Move it to `<org>-apps/<name>` (transfer or re-home), clone to
   `~/work/<org>/apps/<name>`.
3. Register the PaaS app (`static`, host) → deploy → cut DNS.
4. Archive the retired alternates. One project per site, achieved.

## Conformance checklist

1. The site is exactly one repo in `<org>-apps`; no alternate implementations.
2. It depends on the design system; it vendors nothing shared.
3. It builds on the PaaS as `static` (or `container` only if it must).
4. `static` artifacts go to `hanzoai/s3`, served by ingress+static — no nginx.
5. One host, Cloudflare DNS, ingress TLS.
6. Nothing from §6.

## References

- HIP-0036 CI/CD Build System · HIP-0068 Ingress · HIP-0112 Cloud Topology
- HIP-0119 Service Conventions (the backend peer) · HIP-0504 Design System
