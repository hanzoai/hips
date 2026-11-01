---
hip: 1335
title: Listings — One Market for Apps, Skills, Mods, Plugins, Automations and Packs
author: Hanzo AI
type: Standards Track
category: Infrastructure
status: Draft
implementation-go: partial
implementation-ts: partial
created: 2026-10-26
requires: HIP-0026, HIP-0118, HIP-0126, HIP-0139
---

# HIP-1335: Listings — One Market for Apps, Skills, Mods, Plugins, Automations and Packs

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

Six kinds carry a manifest: `app`, `skill`, `mod`, `plugin`, and two more that earn their place:
`automation` (a scheduled or triggered workflow, the `/v1/auto` object, installed as a copy the org
owns: the most-asked-for thing a business installs that is neither prose nor a connector) and `pack`
(a named bundle of listings, §Packs: the unit a person actually chooses). `agent` already is a kind;
`theme` is a mod with only theme keys, so it is not a seventh.


| kind | artifact | where it lives once installed | runs |
|---|---|---|---|
| `app` | a project template, or a host that a frame may embed | the installer's projects; the embed registry of `@hanzo/app` | its own origin, in a frame |
| `skill` | one `SKILL.md` (prose) | the org's authored skills (`/v1/tool/skills`) | attached to an agent; never executed |
| `plugin` | TypeScript declaring actions against one HTTP API | the org's authored plugins (`/v1/tool/plugins/authored`) | compiled and run by the tool plane, credential from the installer's own connector |
| `mod` | a theme and layout contract (`@hanzo/mod` `ModTheme`) and nothing else | the user's or org's mods | the client, through CSS custom properties |

`agent`, `persona`, `mcp`, `tool` and `template` keep their meaning and their install semantics.

## A plugin is MCP, or a Hanzo plugin

`plugin` has two forms, and both are reachable the same way by an agent, as MCP tools:

1. an **MCP server**: a remote URL, or a package/command the sandbox launches; its credential is the
   installer's own, through the connection plane (`/v1/connection`, `/v1/provider`).
2. a **Hanzo plugin**: a manifest and a backend module that runs isolated with declared
   permissions and no ambient network or filesystem. It may expose MCP tools itself and may carry
   skills and a mod.

Isolation, one runtime per kind, from what already runs (measured in `hanzo-inc/cloud`):

| kind of code | runtime | evidence |
|---|---|---|
| TypeScript/JavaScript actions | the tool plane's embedded interpreter (goja) | `script/`: its only impure primitive is a Go HTTP doer, the credential arrives already resolved; the one JS dependency in `go.mod`; 448 connectors run on it today |
| a compiled backend (Rust, Go, C) | WebAssembly (WASI) under wazero | no runtime today (`go.mod` has none); pure Go, no cgo (cloud gates cgo hard, see the Dockerfile's sqlite gate); deny-by-default: no preopened files, no sockets, host functions only for declared permissions. Specified, not built |
| anything else (a package, a binary, a language server) | the sandbox microVM (`apps/sandbox`: `runc`, `visor`, `kata-clh`, `kata-fc`) | already serves exec, dev and desktop leases and bills them |

A V8 isolate is not chosen: it needs cgo and a second JS engine beside the one that already runs.
The doer enforces `network:<host>`: a plugin reaches only the hosts it declared.

## The catalog is curated; the rest is the long tail

Measured on 2026-10-26: the MCP shelf (`/v1/tool/catalog`) holds **50,589** servers; the connector
catalog 754 (448 run in-process, 734 have actions, 383 triggers); the skills catalogue 722 `SKILL.md`
under 116 products; the market's shop 9 public listings. The default view is a **curated set of about
1,000**, the plugins page's `All` is the rest with an `unverified` marker, and both install through
the same ledger and permission screen. One registry, one ranking field (`rank`, 0-100, higher first);
the rules are data in the registry (`rank.rules`), never code: official (a domain-attested
namespace: necessary, not sufficient, since 94% of the first 6,000 qualify), a working remote or
runnable install path (required), installs in our ledger, our own tool-call volume, and the upstream
repository's public star count fetched with an authenticated, cached, rate-limited read. The curated
set is the top 1,000 by `rank` with no category above 12%, and every entry in it must pass an install
smoke. Today's 448 runnable connectors are the floor of the set.

## Mods change the running app

A mod declares the surfaces it touches from a closed list: `theme` (the CSS custom properties of
`@hanzo/mod`), `layout` (density, radius, sidebar order), `pane` (one pane beside the chat),
`band` (a status band), `command` (a slash command), `hook` (a handler on a tool call). It loads
without a reload through the one `apply` call that already reapplies a theme; the previous state is
kept and **Revert** restores it in one action; a mod's CSS cannot import, fetch or leave its sheet
(the validator refuses it). An agent authors a mod with `mod.create`, validates it, previews it for
the member, and offers it; it applies only on approval.

## Packs, and Personal or Business

A pack is a listing whose manifest lists listings (`contents`) and defaults (permissions granted,
models, spend limit). Applying a pack is **one confirmable ledger transaction**: the screen shows
exactly what it installs and permits, the ledger records each row under one `pack` id, and Remove
reverses them together. platform.hanzo.ai opens a Customize flow at first run and from Settings:
choose **Personal** or **Business**, then a starter pack, for example Personal assistant (calendar,
mail and documents through the member's own Google connection), Developer (GitHub, Dev, MCP
tools), Business (CRM, commerce, CMS, analytics, insights, Slack agent).

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

## Share, list and sell: one action

Whatever a member creates on the platform is a listing's `kind`: agent, persona, skill, plugin,
mod, app, automation, pack, prompt, template. One **Share** action everywhere in the platform moves
a thing up one ladder: **Private** (the creator), **Org** (their org's members), **Public link**
(anyone with the link, not searchable), **Listed** (in the market, after review). Each step is a
ledger-visible change, reversible, and `Listed` is the only one that needs a reviewer.

A listing carries: a **price** (`free`, `one-time`, `subscription`, `usage`; in the publisher's
currency), a **license** (an SPDX id), the publisher's verified IAM identity, and a **yank and
refund policy** (a yanked listing leaves the shop and stops installing; refunds follow the plan's
terms, decided in commerce). **Buying** is one transaction: an install-ledger row and a Hanzo
Commerce charge to the **buyer's org**; the publisher sees sales and installs. The platform's
cut is **one field in the registry's configuration, set by the owner, default 0**; this HIP sets
no revenue share.

| part | state |
|---|---|
| Private and Listed (public flag, review), manifest, artifact hash, install by copy, ledger, remove | built (`apps/marketplace`) |
| Org and Public-link rungs; a Share action in each platform surface | designed |
| Price on a listing with a manifest | refused at publish and at install (402) until the charge below exists, so nothing priced installs for free |
| Settlement through commerce: charge the buyer's org, pay the publisher's payout wallet (`/v1/marketplace/seller/payout` already binds a proved wallet; `x402` settles per call and per job today), the registry-config cut | designed; to be built behind the owner-set cut and tested against commerce's sandbox before any money moves |
| Subscription and usage-based prices | designed (commerce plans) |

## Out of scope

Pricing and revenue share for paid listings are the existing marketplace's (x402, per listing);
this HIP sets none.
