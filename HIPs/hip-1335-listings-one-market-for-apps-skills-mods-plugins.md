---
hip: 1335
title: Listings — One Market for Apps, Skills, Mods and Plugins
author: Hanzo AI
type: Standards Track
category: Infrastructure
status: Draft
implementation-go: partial
implementation-ts: partial
created: 2026-10-26
requires: HIP-0026, HIP-0118, HIP-0126, HIP-0139
---

# HIP-1335: Listings — One Market for Apps, Skills, Mods and Plugins

## Abstract

`hanzo.market` lists what organizations sell; `/v1/marketplace` in `hanzoai/cloud` is its one
store. This HIP adds two kinds to it, **mod** and **plugin**, gives every listing one manifest, one
install ledger and one permission vocabulary, and makes **install** mean the same thing for every
kind: the artifact is copied into the installer's own store and a ledger row says who installed
which version with which permissions. A member, or an agent the member approves, can change the
app they work in by installing a listing or by writing one.

The noun is **listing** (the market's own). No new word is introduced for the four kinds; each is
a value of `kind`.

## Kinds

| kind | artifact | where it lives once installed | runs |
|---|---|---|---|
| `app` | a project template, or a host that a frame may embed | the installer's projects; the embed registry of `@hanzo/app` | its own origin, in a frame |
| `skill` | one `SKILL.md` (prose) | the org's authored skills (`/v1/tool/skills`) | attached to an agent; never executed |
| `plugin` | TypeScript declaring actions against one HTTP API | the org's authored plugins (`/v1/tool/plugins/authored`) | compiled and run by the tool plane, credential from the installer's own connector |
| `mod` | a theme and layout contract (`@hanzo/mod` `ModTheme`) and nothing else | the user's or org's mods | the client, through CSS custom properties |

`agent`, `persona`, `mcp`, `tool` and `template` keep their meaning and their install semantics.

## One manifest

A listing carries a manifest (`@hanzo/listing`, `Manifest`; JSON Schema generated from it). Names
are flat. Required: `kind`, `name` (one lowercase path segment), `version` (semver), `title`,
`summary`, `publisher` (the org id; IAM's), `permissions`, `artifact`.

`artifact` is `{ hash, size, content? | url? }`: the sha-256 of the bytes, so what the buyer
installs is what was reviewed. A listing whose bytes no longer match its hash is yanked.

## One permission vocabulary

A permission is a grant, exactly as `hanzoai/authz` states them: a **verb** (`read` or `write`) on
an **app** (a capability name, HIP-0139) — plus four closed powers that are not paths: `spend`
(draw on the installer's balance), `sandbox` (run code in a sandbox), `connector:<provider>`
(use the installer's own connection to a provider), and `network:<host>` (reach one host). A
manifest lists what it asks; the install screen shows the list; the ledger records what was
granted. A grant given to an extension is never wider than the installer's own: it is a narrower
grant with an expiry, which is how an agent delegation is already expressed.

Nothing from the market receives a user's token. A plugin runs in the tool plane under the
installer's connector; a mod has no network; an app runs in a frame on its own origin.

## One install

`POST /v1/marketplace/install {listing, version?, grants}` for the caller's org (and user, for a
mod). Per kind:

- `skill`: copy the `SKILL.md` into the org's authored skills (the name made unique), then activate.
- `plugin`: copy the source into the org's authored plugins and build it there; the build is the
  gate (compile or refuse). The plugin's credential is the installer's connector, never the
  publisher's.
- `mcp`: register the server URL in the org's servers.
- `mod`: record the ledger row; the client applies the theme.
- `app`: record the row; the embed registry draws it where the app's runtime exists.

Install never shares a row between tenants: the installer's store holds a copy, so a call runs in
the caller's scope, which is the rule the marketplace already states for tools.

`GET /v1/marketplace/installs` answers the caller's ledger. Update is install of a newer version
by explicit action; remove deactivates and keeps the ledger row (`removed`).

## Review and provenance

States: `draft`, `review`, `listed`, `yanked`. Only `listed` appears in the shop. The publisher is
the IAM org that owns the listing (the marketplace already proves ownership of what it lists).
Publishing a plugin or a mod requires the org admin; a reviewer (SuperAdmin) lists it.

## The agent path

Four tools, over the one tool plane: `market.search`, `market.install` (always asks the member
unless the org's policy names the kind as auto; every call audited), `market.update`, and
`mod.create` (an agent writes a mod from a prompt, validates it against the manifest, offers it to
the member, and on approval publishes it to the org's private listing).

## Out of scope

Pricing and revenue share for paid listings are the existing marketplace's (x402, per listing);
this HIP sets none.
