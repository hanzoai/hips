---
hip: 0528
title: Mods — The App SDK
author: Hanzo AI
type: Standards Track
category: Interface
status: Draft
implementation-go: none
created: 2026-10-22
requires: HIP-0026, HIP-0105, HIP-0118, HIP-0126, HIP-0139, HIP-0300, HIP-0524, HIP-1041, HIP-1103, HIP-1137, HIP-1146, HIP-1324
---

# HIP-0528: Mods — The App SDK

## Abstract

`@hanzo/app` and `@hanzo/mod`, both built from the repository `hanzoai/app`,
are the SDK Hanzo's web, desktop and mobile apps are built from, and the one way
anything extends them. `@hanzo/mod` is the contract: the manifest, the registry,
the loader and bridge, the layers and the client of `/v1/mod`. `@hanzo/app` is
the one shell and the first-party apps, each a mod on that contract. Everything
in the app is a mod: Chat, Dev, Settings and the other first-party apps, an
extension a third party publishes, and the one a person's own agent wrote for
them a minute ago. All three load through one contract.

A mod is a manifest and code. The manifest names the publisher, what the mod
contributes — apps, views, commands, settings, tokens, agents, skills, MCP
servers, tools — what it may touch, and where its backend runs. The code
registers those contributions, and each one is undone when the mod unloads from
a host or is uninstalled from an org, so loading, unloading and reloading leave
the app exactly as they found it.

Most changes a person wants are not code. Hiding an app, moving a view, renaming
a command, setting a setting or choosing an accent is a patch: data, checked
against what the app can be changed through, written to a versioned layer that
can be read, reverted and watched at `/v1/mod`. An agent drafts and a person
keeps. A person's own agent commits to that person's own layer unasked only
where their HIP-0524 level lets it act unasked, never on a sensitive setting,
and no agent commits the org's.

Code Hanzo did not write never runs in the app's origin, where the person's
session lives. Its frontend runs in an isolated frame and reaches the host only
through a typed, permission-checked bridge; its backend runs only in a hard
sandbox. Every mod is built from source at a pinned commit by the platform's
build door. A private mod is usable in its author's org at once; a public one is
listed only after a SuperAdmin approves it (HIP-1137, amended alongside this).

The packages are today's `@hanzo/rooms` (`hanzoai/rooms`), renamed to
`hanzoai/app` and split in two. This HIP is proposed: the first-party apps ship
as `@hanzo/rooms`, and none of the contract does (§11).

## Motivation

The app cannot be extended today, not even by Hanzo. The apps are a closed
union in the package (`Mode`, `src/Shell.tsx`) and the rail is a fixed list
(`Rail.tsx`), so a new app is a release of the package and of every host that
imports it. A third party has no way in. A person whose agent builds a useful
view in Dev has nowhere to keep it.

Nor can the app be arranged. A person who wants Board off the rail, Drive beside
Chat or Inbox called Mail has nowhere to say so, and an agent asked to do it for
them has one tool: a code change to a package it does not own. Each of those
asks is data — which item, where, what title, which value — and data can be
checked against what exists before it is written, kept with its history, and
undone in one step.

What the platform can extend arrives in pieces, each with its own install: a
skill, an MCP server and an authored plugin are rows in the tool plane
(HIP-1213); an agent is a definition (HIP-1210). An extension that needs a view,
the agent that fills it and the MCP server it calls is three installs with
nothing joining them, and an uninstall that forgets one leaves it running.

An extension point the first party does not use rots. If Chat reaches the host
by a path a mod cannot take, the contract is never exercised by the code that
matters most, and every feature Hanzo adds widens the gap. So the first-party
apps are mods, on the same contract, with no private path.

The hard line is the session. On the web the IAM session sits in the app
origin's storage (today `@hanzo/rooms` `lib/session`), so any script in that
origin can read it and act as that person in every org they belong to. Code the
platform did not write — a third party's, or one an agent wrote from a prompt
that may carry an injection — never runs there.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 Terms

- **Host** — a program that loads mods: hanzo.ai in a browser, Hanzo Desktop,
  Hanzo Mobile. The host owns the window, the session, the router, the bridge,
  and every prompt that asks a person to consent.
- **Mod** — one package with one manifest, named `<publisher>/<id>`; each build
  of it has one digest (§5.6).
- **Contribution** — one thing a mod adds to a host or to its org. Every
  contribution is a registration with a disposer.
- **First-party** — built from `hanzoai/app` itself, at a commit on its default
  branch, by that repository's own CI identity. Nothing else is first-party,
  whatever org it names as publisher: a mod a person, their agent or any other
  org wrote is third-party.
- **App** — a place in the host: a mark on the rail, the sidebar beside it and
  every page under one path prefix. Chat and Dev are apps. An app is not a
  capability (HIP-0139), an IAM application (HIP-0026) or a connected service
  (HIP-0524 §12); each of those keeps its own word.
- **View** — a page at a route inside an app, or a panel mounted in a slot.
- **Slot** — a named place an app offers for views, such as the column beside
  its pane.
- **Shell** — the one frame every host draws: rail, bar, sidebar, panes.
  `@hanzo/app` draws it, and no host draws another.
- **Surface** — everything a host can be changed through, by id: the
  registered contributions and the values each admits (§9.1).
- **Layer** — the patches one party holds over the layers beneath it: `hanzo`,
  `org` or `user` (§3.5, §9.3).
- **Patch** — one data change to the surface (§9.2).
- **Draft** — a layer write held until a person keeps or discards it (§9.4).

HIP-0523's channel is a conversation. An app such as Chat renders channels; the
two words do not meet.

### §2 The manifest

The manifest is the `mod` key of the package's `package.json`. It is data: the
host, the build door and the marketplace read it without running the mod. The
version is the package's `version` and is not repeated.

```json
{
  "name": "weather",
  "version": "1.4.0",
  "mod": {
    "id": "weather",
    "publisher": "acme",
    "title": "Weather",
    "contributes": {
      "apps":     [{ "id": "weather", "title": "Weather", "icon": "cloud", "slots": ["side"] }],
      "views":    [{ "id": "week", "title": "This week", "app": "weather", "route": "/week" },
                   { "id": "forecast", "title": "Forecast", "slot": "hanzo/chat/chat:side" }],
      "commands": [{ "id": "refresh", "title": "Refresh the forecast" }],
      "settings": [{ "id": "units", "title": "Units", "scope": "user", "schema": "settings/units.json" }],
      "tokens":   [{ "id": "sky", "title": "Sky", "values": ["day", "dusk", "night"] }],
      "agents":   [{ "id": "forecaster", "file": "agents/forecaster.md" }],
      "skills":   [{ "id": "forecast", "file": "skills/forecast/SKILL.md" }],
      "mcp":      [{ "id": "weather", "tools": ["forecast"] }],
      "tools":    [{ "id": "forecast", "schema": "tools/forecast.json" }]
    },
    "provides":    [{ "service": "forecast" }],
    "uses":        ["hanzo/chat#composer"],
    "permissions": ["todo:read", "host:notify", "net:api.weather.example"],
    "backend":     { "kind": "wasm", "module": "backend/weather.wasm", "exports": ["forecast"] }
  }
}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | One lowercase word, `[a-z][a-z0-9]{0,31}`, unique within the publisher |
| `publisher` | yes | The IAM org that publishes it (§5.6 rule 4) |
| `title` | yes | What a person reads |
| `contributes` | yes | The kinds below; an empty object is a mod that only provides services |
| `provides`, `uses` | no | Services (§3.4) |
| `permissions` | no | §5.4; absent is none |
| `backend` | no | §5.5; absent is `{"kind": "none"}` |

A contribution's full id is `<publisher>/<mod>/<id>` — `acme/weather/forecast`,
`hanzo/chat/chat` — and the surface, every patch and every slot name a
contribution by it. A slot is `<full id of its app>:<slot>`.

The contribution kinds are a closed set. A host MUST refuse a manifest naming a
kind it does not know rather than skip it; a tenth kind is an amendment to this
HIP.

| Kind | Registers | Where it lands |
|---|---|---|
| `apps` | a mark on the rail, its sidebar, the pages under its prefix, and the `slots` it offers | the host's rail and router; a first-party app at `/<id>`, a third-party app at `/mod/<publisher>/<mod>/<app>` |
| `views` | a page at a `route` inside one of the mod's own apps, or a panel in a named `slot` of any app | that app's router, or that slot |
| `commands` | an action with a title, an optional key chord and an optional `input` schema | the palette's Actions and the key map |
| `settings` | a value with a JSON Schema, a `scope` of `user` or `org`, and a `sensitive` flag | Settings' sections, which draw it |
| `tokens` | a design token the mod's views read, with the closed list of `values` it may take | the theme the host hands every view (§5.1 rule 7) |
| `agents` | an agent definition (HIP-1210) | the org's agents |
| `skills` | a `SKILL.md` | the tool plane's skills (HIP-1213) |
| `mcp` | an MCP server, served by the backend or at a `url` whose host is one of the mod's `net:` grants | the tool plane's MCP servers (HIP-1213) |
| `tools` | a typed tool whose implementation is a backend export | the tool plane (HIP-1213) |

A view names exactly one of `app` with `route`, or `slot`. A view adds a page
only to an app of its own mod; a view placed in another mod's app goes in a slot
that app offers.

A setting is `sensitive` when a wrong value costs more than an arrangement:
authority, money, data leaving the org, or an agent's own limits. Every setting
HIP-0524 §4 rule 2 keeps from the agent — its level, its window, the org's
ceiling — is sensitive. Absent is `false`.

The first five kinds are held by a host and governed by load and unload (§3).
The last four are rows in the cloud and governed by install and uninstall
(§6.2), so an agent the mod contributes still runs when no app is open.

### §3 Lifecycle

#### §3.1 Load

For each mod installed in the org in scope, and in the person's home org for
their own mods (§3.5), the host:

1. reads the install — the tool plane's row with source `mod`, pinning a digest
   and a consented permission set (§6.2);
2. refuses a blocked mod (§6.4), and loads the bundle only under that digest
   (§5.1 rule 3);
3. orders the mods (§3.4, §3.5), places the frontend (§5.1) and calls the mod's
   `activate(ctx)`.

`activate` registers contributions through `ctx`. A registration of a kind or
an id the manifest does not declare MUST be refused with an error naming it: the
manifest is the ceiling, and code fills it but never exceeds it. A backend
starts on its first call, not at load.

#### §3.2 Unload

Every registration the mod made is disposed, in reverse order, on every exit
path: unload, uninstall, hot reload, an `activate` that throws, a block, a
frame that crashes or loads a second document. Then the frame is destroyed and any running backend
instance is closed. A bridge call pending at unload is answered with an error,
never left open.

After unload, the host's registries MUST equal what they were before load. The
SDK's test kit (§8) asserts it for every mod by comparing the registries across
a load–unload cycle.

#### §3.3 Hot reload

Hot reload is unload, then load of the new digest. It is not a second
mechanism. The mod's store (§5.4 rule 4) survives it and an open app is drawn
again at the same address. A new digest loads only under consent (§6.3); one
that needs a new consent waits, disabled, until it has it.

#### §3.4 Services and events

A mod MAY `provide` a named service — a typed object — and MAY `use` another
mod's, addressed `<publisher>/<id>#<service>`. Load order is these needs and
nothing else: a mod activates after every service it uses is provided, ties
broken by name, and a mod whose need is never met does not activate and the host
says which service is missing. When a provider unloads, every mod using it
unloads first.

A service call never carries authority across. Inside a service handler, every
operation the provider dispatches through the SDK runs with the intersection of
the provider's grants and the caller's, so an honest provider cannot be used to
do what its caller was not given. What a provider does outside a handler is its
own authority, which its own installer consented to.

A mod emits events only under its own name (`<publisher>/<id>/<event>`). It
observes its own events, those of the mods it uses, the theme, and navigation
within its own apps; it never sees where else the person goes. Between two mods
that do not share a placement, a service call and an event cross the bridge
(§5.2) as JSON, asynchronously.

#### §3.5 Composition

The app a person sees is the surface (§9.1) composed from three layers, in
order: `hanzo`, the first-party mods the host was built with; `org`, the mods
the org installed and the patches its admins committed; `user`, the person's own
mods and patches. While a draft is open the host shows it over the layer it
would change (§9.4). A layer adds mods and MAY hide, show, move, rename, set,
bind and token the contributions of the layers beneath it (§9.2). It never edits
their code.

A person MUST NOT be able to show what their org hid. A person's own mods load
only in their home org, because their grants are scoped to it (§5.4); in any
other org the person sees Hanzo's layer and that org's, under their own user
layer for that org. Because a customisation is a patch above Hanzo's layer and
never a change inside it, an update to a first-party mod and a person's
arrangement of it cannot conflict: a patch naming an id the update removed is
kept and does nothing (§9.2 rule 5).

### §4 First-party mods

1. Chat, Dev, Studio, Tabs, Home, Inbox, Contacts, Meet, Calendar, Drive, Board,
   Bots, Team, Catalog and Settings are each a mod in `hanzoai/app`, with a
   manifest, published by `hanzo`, built by the build door like any other (§5.6),
   and exported by `@hanzo/app` at a subpath of its own (`@hanzo/app/chat`).
2. A host names the first-party apps it carries once, in `app({ apps })` (§8);
   that list is the `hanzo` layer. The rail, the palette's Go to and Actions,
   Settings' sections and Customize's tabs are read from the registered
   contributions. No host and no first-party mod names another app in code;
   `Mode` stops being a union and becomes the set of registered apps.
3. No member of `ctx` exists for first-party mods only. Every op is open to every
   mod behind the same permissions, checked by the same function. A first-party
   mod declares its permissions like any other.
4. The one difference is placement (§5.1): a first-party frontend MAY run in the
   host's origin. That decides whose code is trusted near the session, not what
   the code may call. The manifest cannot ask for it; the host decides it from
   the build record (§1).
5. Every first-party mod's tests MUST pass with the mod placed in an isolated
   frame. A first-party mod that works only in-origin is using a path a third
   party does not have, and the gate refuses it.

### §5 Isolation

#### §5.1 Placement

1. Third-party and person-authored frontend code MUST NOT execute in the host's
   origin, nor in any origin same-site with it.
2. It runs in an iframe whose `sandbox` attribute is exactly `allow-scripts`.
   Its origin is opaque: it has no cookies and no storage, cannot read its
   parent, cannot navigate the top window, open a window or submit a form. It
   MUST NOT be given `allow-same-origin`: a scripted frame that shares the
   origin of the document serving it can remove its own sandbox.
3. The frame's document is served by a bundle host that serves nothing else and
   is not same-site with any Hanzo app. That host generates the document from the
   pinned digest and loads the bundle with Subresource Integrity equal to it, so
   the bytes that run are the bytes the install pinned. Every response it sends,
   bundle included, carries a content security policy beginning
   `sandbox allow-scripts`, so a bundle opened directly is confined the same way;
   the policy goes on with `default-src 'none'`, scripts and styles from the
   bundle alone, images and fonts from the bundle, `data:` and `blob:`,
   `connect-src 'none'`, and `frame-ancestors` the hosts.
4. The port is handed over once (§5.2). A frame that loads a second document —
   it navigated itself, or was navigated — is destroyed and the mod unloaded.
5. A frame draws only inside the rectangle the host gives it, and the host draws
   the mod's title and publisher beside every third-party app and view, outside
   the frame. Anything drawn over the host — a dialog, a consent prompt, a toast,
   a menu, a draft's Keep and Discard — is drawn by the host, at the mod's
   request where a mod asks, so a mod cannot draw a prompt that passes for the
   host's.
6. On Hanzo Desktop the frame MUST NOT reach the shell's native command
   interface; a native act reaches a mod only as a `host:` op (§5.4).
7. The host passes the design tokens and the theme (HIP-0504), with every
   layer's `token` patches applied, across the bridge, so an isolated mod built on
   `@hanzo/ui` looks like the rest of the app.

The frame confines authority, not knowledge. A mod can leak whatever its grants
let it read — a frame that can render can signal — so what a mod may read is
decided by its grants (§5.4), never by trusting the frame to keep a secret.

#### §5.2 The bridge

1. At load the host creates one `MessageChannel` per frame and transfers one
   port to it. That port is the only channel. The host MUST NOT read `message`
   events on its window from mod frames: every opaque origin serialises as
   `"null"`, so an origin check admits every sandboxed frame on the page.
2. A message is `{id, op, input}`. `op` names one member of the SDK's `ctx`
   surface, and `input` is validated against that op's schema before anything
   acts on it. An unknown op or an invalid input is answered with a typed error.
   Each op names the permission it needs, and the host checks the mod's grants
   before acting.
3. The session token never crosses the bridge, in either direction, in any op.
4. An in-origin first-party mod calls the same ops through the same checker,
   directly instead of over a port. There is no in-origin bypass.

#### §5.3 Calls to the cloud

A mod calls the cloud through the op `fetch`. The host resolves the request to
its operation in the served document (HIP-1030) and refuses one whose capability
and verb the mod's grants do not cover. An operation that dispatches other
operations — the MCP endpoint `/v1/mcp` and the tool plane's dispatch — is never
resolvable for a mod: it reaches each operation at its own address.

The host performs the rest under a token exchanged for the mod (HIP-0111 §7,
RFC 8693): the person is the subject, the host's platform client is the acting
party with the mod named beside it, and the scope is the mod's grants. The cloud
then enforces the same ceiling the host does, and the audit trail names the mod
as well as the person. HIP-0111 §7's exchange does not narrow scope today; this
HIP needs it to (§11).

#### §5.4 Permissions

A permission takes one of three forms, and the set is closed:

| Form | Grants | Example |
|---|---|---|
| `<capability>:read`, `<capability>:write` | that capability's operations (HIP-0139); `write` admits both verbs, and the verb is HIP-1041's one mapping from the method | `todo:read` |
| `host:<act>` | one host act: `notify`, `open` (an `https` URL the host shows the person, opened on their gesture), `clipboard` (write), `files` (a file the person picks) | `host:notify` |
| `net:<host>` | backend egress to exactly that host name, no wildcard, and the host of an `mcp` contribution's `url`. A frontend is never granted `net`. | `net:api.weather.example` |

1. A mod's grants are the permissions it declared and the installer consented
   to, held as HIP-1041 grants in the org it is installed in. At run time the mod
   acts for one person — the one whose app loaded it, or whose run called its
   backend — and its authority is those grants narrowed to that person's own.
   A grant is narrowed, never widened: a mod an org admin installed gives a
   member nothing the member did not already hold.
2. A mod asks only for capabilities on the grantable list `@hanzo/mod`
   publishes. Custody (`kms`, `wallet`), identity (`iam`), the operator's
   surface (`/v1/admin/*`, HIP-0139 §3.2), and the writes that install or
   configure code or arrange the app (`tools`, `marketplace`, `settings`, `mod`)
   are never on it, whoever installs the mod. A SuperAdmin installing a mod gives
   it no platform authority.
3. Everything a mod contributes acts under the mod's authority, not the
   person's. An agent it contributes runs with the mod's grants narrowed to the
   person running it, and names only the mod's own tools and tools those grants
   cover. A skill is text a model reads: it is shown with its mod's name, enters
   a turn only when the person chose it, and confers nothing.
4. A mod's own state needs no permission. `ctx.store` is a bucket of the mod's
   own in its org's KV (HIP-1324), keyed by person, which no other mod's grants
   reach. Larger or shared state belongs in a capability the mod is granted.
5. A credential is never a mod's. A call that needs an upstream credential goes
   through an integration (HIP-1250) or egress (HIP-0143); the mod is granted the
   capability, never the key.

#### §5.5 Backends

`backend.kind` is one of three:

| Kind | Runs in | For |
|---|---|---|
| `none` | nothing | a frontend-only mod; the default |
| `wasm` | wazero, in process, through HIP-0105's runtime; `module` and `exports` are HIP-0105's fields, and the build writes the module's `extension.json` from them | tools, MCP tools, hooks |
| `sandbox` | a HIP-1146 lease: a gVisor-class pod with no ServiceAccount token | an MCP server that needs a process, a language runtime |

1. A backend runs only in a hard sandbox. In-process soft engines (goja, and
   native Go) are for first-party code only: HIP-0126 requires untrusted tenant
   extension code to run in a hard-sandbox engine and limits soft engines to the
   non-adversarial threat model (HIP-0126 §6 and its sandbox gate). A manifest
   naming any other kind is refused at build. First-party server code that needs
   more is a capability (HIP-0106, HIP-0139), not a mod backend.
2. Every `wasm` invoke carries a deadline and runs under a memory cap (HIP-0105).
   A `sandbox` backend is leased on demand and reaped as HIP-1146 reaps any
   lease.
3. HIP-0105's `Invoke` runs host to guest only, and leaves the reverse — its
   host-API contract — open until a concrete consumer needs one. This is that
   consumer. A `wasm` guest imports one host function that takes an op of §5.2
   and its input as JSON and returns the answer as JSON, checked against the same
   grants. A `sandbox` backend is leased with the mod's exchanged token (§5.3),
   never the person's own, and calls the cloud with it.
4. A backend's outbound connections reach only the hosts its `net:` grants
   name. The platform resolves the name and refuses a private, loopback or
   link-local address, so a name that re-resolves cannot reach inside.

#### §5.6 The artefact

1. A mod is built from source — the TypeScript frontend and the backend's source
   — at a pinned commit by the platform's build door (HIP-1230), and only there.
   No route accepts a built bundle from an author. A first-party mod is built the
   same way.
2. The build installs dependencies from the lockfile alone, verifying each
   against its recorded integrity, and has no other network. Its record names
   the repository, the commit (40 hex digits, never a branch or a tag), the
   lockfile's digest and the toolchain image's digest.
3. One digest covers the whole output — the bundle and the backend module or
   image together. That digest is what is reviewed, listed, consented to and
   installed, and the host loads nothing else.
4. The build refuses a manifest whose `publisher` the requesting principal does
   not act for, a backend kind §5.5 does not admit, a contribution kind §2 does
   not define, and a permission off the grantable list (§5.4 rule 2).

### §6 Distribution

#### §6.1 Private

A mod built for an org is installable in that org at once, with no review. A
person's own mods live in their home org: every user id is `<owner>/<name>` and
the owner half is an org (HIP-0026). A person's agent, in Chat or in Dev
(HIP-1330), makes one the way the person would: it commits the source to a
repository (HIP-1232), asks the build door for a build at that commit, and asks
for the install, which waits for the person (§6.3). A private mod is still
third-party to the host and is placed as §5.1 requires, whoever wrote it.

A change that is only data — hiding, moving, renaming, a setting, a token — is
not a mod. The agent writes a patch to the person's layer instead (§9) and
builds nothing.

#### §6.2 Install is activation

An install is the tool plane's activation write (HIP-1137 §1, HIP-1213) of the
mod's row, source `mod`, keyed `(org, project)`, pinning a digest and the
consented permission set. The tool plane writes it only against a consent record
(§6.3) for that digest and that set. The mod's cloud-side contributions (agents,
skills, MCP servers, tools) are active with it and inactive without it.
Uninstall unloads the mod from every host, deactivates them all, and revokes the
mod's exchanged tokens and sandbox leases. Installing into an org is that org's
admin's act; a person installs into their home org.

#### §6.3 Consent

Consent is IAM's. The person approves the mod's permission set, shown in words,
on IAM's own consent page in a session where they are present, and IAM records
it: who, which digest, which permissions. A bearer token — the person's own, or
one their agent holds — cannot produce a consent record, so an agent at any
level of HIP-0524's ladder may ask for an install and may not accept it. This is
about code; when an agent may commit a patch is §9.4's.

Every new digest needs a new consent, with two exceptions, each bounded by the
permissions already consented: a public mod's approved digest whose permissions
are a subset of the installed one's, and a person's own mod in their home org,
rebuilt from the same repository with a subset of its permissions — the loop in
which their agent edits it and the app reloads it (§3.3). Every consent is an
audit record (HIP-1103).

#### §6.4 Public, and blocked

A public mod is a marketplace listing (HIP-1137) naming the mod's row at a
pinned digest. It is discoverable outside its publisher org only after a
SuperAdmin approves it (HIP-1137, Amendment).

A SuperAdmin MAY block a mod, or every mod of a publisher, through the operator's
view of the tool plane (`/v1/admin/tools`, HIP-0139 §3.2). A block covers every
digest, present and future. A host refuses a blocked mod at load and unloads it
wherever it is running when the block is published, every contribution reversed
(§3.2); the tool plane deactivates its rows and revokes its tokens and leases.
Every block is an audit record.

### §7 Review

1. A review is a pluggable step with one interface:

   ```text
   in   stage      "commit" | "submission"
        manifest   the mod key, verbatim
        bundle     sha256 of the build's output
        source     { repo, commit }   the pinned commit it was built from

   out  verdict    "pass" | "hold" | "refuse"
        reasons    [{ text, file?, line? }]
        reviewer   the IAM client that read it
        bundle     the digest it read, echoed
   ```

2. It runs at two points: at commit time as the CI review job (`hanzoai/ci`'s
   `review` job, `.hanzo/review/gate.sh <base> <head>`, which already refuses a
   change by exiting 1), and at submission time, when a listing is submitted, on
   the built bundle and the commit it was built from.
3. It is off by default. With no reviewer configured there is no verdict, and no
   verdict is never a pass: the submission is shown as unreviewed.
4. A verdict binds to the digest it read and says nothing about any other.
5. A verdict is evidence for the SuperAdmin, never the decision. `pass` lists
   nothing. `hold` asks for a person's read. `refuse` keeps the listing
   `submitted` with its reasons shown to the SuperAdmin and the publisher; a
   SuperAdmin approving over it gives a reason, which the trail records.
6. A review names no model and no vendor. A reviewer is any implementation of
   the interface, acting as its own IAM client, which may read the source and the
   bundle and nothing else.
7. Only a SuperAdmin configures the submission-time reviewer. A commit-time
   verdict is configured by the repository's own CI and is evidence for that
   repository alone; it is never shown as evidence for a listing.
8. Every verdict is an audit record (HIP-1103).
9. An org MAY turn review on for its own builds; a `refuse` at commit time then
   fails the build, as the CI review job does today. Otherwise review never holds
   a private install.

### §8 The developer surface

Three ways in: `@hanzo/mod` to write a mod, `@hanzo/app` to build a host, and
the generated API clients to call the platform.

**`@hanzo/mod`, to write a mod.** It exports `define`, the manifest's types —
`Mod`, `Manifest`, `Kind`, `App`, `View`, `Slot`, `Command`, `Setting`, `Token`,
`Permission`, `Layer`, `Patch`, `Surface`, `Context` — and `ctx`: `apps`,
`views`, `commands`, `settings`, `tokens`, `agents`, `skills`, `mcp`, `tools`,
`services`, `events`, `store`, `host` and `fetch`, every registration returning
its disposer. `@hanzo/mod/registry` is what a shell reads (`registry`,
`useRegistry`); `@hanzo/mod/host` is what a host runs (`load`, `unload`, `Frame`,
`bridge`, `check`); `@hanzo/mod/client` is §9's client (`surface`, `layer`,
`patch`, `revert`, `watch`). Its test kit, `@hanzo/mod/test`, loads a mod in an
isolated frame (`mount`), asserts §3.2's equality across load and unload
(`cycle`), and fails on any registration the manifest does not declare. It holds
no view, no shell, no style and no first-party app's name. Interface components
come from `@hanzo/ui` (HIP-0504).

```ts
import { define } from '@hanzo/mod'
import { Forecast } from './Forecast'

export default define({
  activate(ctx) {
    ctx.apps.add({ id: 'weather', render: Forecast })
    ctx.commands.add({ id: 'refresh', run: () => ctx.events.emit('refresh') })
  },
})
```

**`@hanzo/app`, to build a host.** It draws the one `Shell` and carries the
first-party apps, each a mod on the contract above at a subpath of its own. A
host states its config once and draws `App` with its host adapter —
`@hanzo/app/web`, `/next`, `/desktop` or `/mobile`:

```tsx
import { createRoot } from 'react-dom/client'
import { app, App } from '@hanzo/app'
import { chat } from '@hanzo/app/chat'
import { dev } from '@hanzo/app/dev'
import { web } from '@hanzo/app/web'

app({ brand: 'hanzo', apps: [chat, dev] })
createRoot(document.getElementById('root')!).render(<App host={web} />)
```

`app()` validates its config and throws on an unknown key, naming it.
`@hanzo/app` depends on `@hanzo/mod` and never the reverse. Identity, the gateway
client and presentational components stay in the packages that own them
(`@hanzo/iam`, `@hanzo/ai`, `@hanzo/ui`), and `@hanzo/app` re-exports none of
them.

**The generated API clients, to call the platform.** `hanzoai/sdk` is the index
of them, one per language, each generated from the cloud's served document
(HIP-1030) by `hanzoai/openapi`. Inside a mod, the TypeScript client is built
with `ctx.fetch`, so it holds no key and every call is checked (§5.3). Outside
one, the same client takes an API key. One client, two transports.

### §9 Layers and `/v1/mod`

A patch changes what the app shows; a mod changes what it can do. `/v1/mod` is
the capability `mod` (HIP-0139): it serves the surface a patch is checked
against and holds the layers patches are kept in. Its scopes are `mod:read` and
`mod:write`.

#### §9.1 The surface

`GET /v1/mod/surface` answers what the caller's app can be changed through,
computed from the manifests of the mods loaded for them (§3.1), never from a
running host:

| Entry | Carries |
|---|---|
| `apps` | full id, title, icon, the slots it offers |
| `views` | full id, title, and its app and route, or its slot |
| `slots` | id, the app that offers it |
| `commands` | full id, title, key chord, input schema |
| `settings` | full id, title, JSON Schema, `scope`, `sensitive` |
| `tokens` | full id, title, allowed values |
| `mods` | publisher, id, digest |

Each entry carries the layer that contributed it: `hanzo`, `org` or `user`. The
`hanzo` entries are every first-party mod's, because the cloud does not know
which host is asking; a host built with fewer applies a patch only to what it
carries (§9.2 rule 5). The surface is the whole vocabulary of a patch; a patch
can name nothing the surface does not list. An agent is answered a surface without the settings §9.4 rule 4
keeps from it.

#### §9.2 Patches

A patch is one op, `{op, kind, id, …}`, where `kind` is a contribution kind of
§2 and `id` a full id. The ops are a closed set of seven:

| Op | Kinds | Fields | Effect |
|---|---|---|---|
| `hide` | apps, views, commands, settings | — | takes it off the rail, the slot, the palette or Settings |
| `show` | apps, views, commands, settings | — | undoes a `hide` the same layer made |
| `move` | apps, views | `index`, and for a panel `slot` | places an app at `index` on the rail, a page at `index` in its app's sidebar, or a panel at `index` in a slot the surface lists |
| `rename` | apps, views, commands | `title` | shows `title` instead of the manifest's |
| `set` | settings | `value` | sets the value |
| `bind` | commands | `keys` | binds a key chord, or `null` to unbind |
| `token` | tokens | `value` | chooses one of the token's allowed values |

A write carries its ops with the version it was made against:

```json
{ "base": 41, "note": "Drive beside Chat, Board off",
  "ops": [
    { "op": "move",  "kind": "apps",   "id": "hanzo/drive/drive",    "index": 1 },
    { "op": "hide",  "kind": "apps",   "id": "hanzo/board/board" },
    { "op": "token", "kind": "tokens", "id": "hanzo/settings/accent", "value": "slate" }
  ] }
```

1. A write is checked whole against the surface before anything is stored: an id
   the surface does not list, an op its kind does not admit, a value the
   setting's schema refuses, a token value outside its list, a slot the surface
   does not list, or a title that is not 1 to 40 characters of plain text is
   answered 422, naming the op by index and the reason, and nothing is written.
2. A patch is data. It carries no code, no URL, no markup and no style. A title
   is plain text with no control characters and is drawn as text; a token's
   value is a name from its list, never a raw value.
3. A write carries at most 64 ops and a `note` of at most 200 characters of plain
   text.
4. A layer keeps one op per target, the later replacing the earlier. The targets
   of one contribution are its visibility (`hide`, `show`), its place (`move`),
   its title (`rename`), its value (`set`, `token`) and its chord (`bind`), so a
   layer can never grow past the surface it arranges. One layer binding one chord
   to two commands is refused.
5. The host applies `hanzo`, then `org`, then `user`. For each target the
   highest layer that holds an op wins, with one exception: what the org layer
   hides stays hidden. A chord bound in two layers goes to the higher one's
   command. An op whose id has left the surface — its mod updated or uninstalled
   — is kept and does nothing, and applies again if the id returns.

#### §9.3 Layers and versions

1. The `hanzo` layer holds no patches: it is the first-party mods the host's
   `app({ apps })` names, fixed when the host is built.
2. The `org` layer and each person's `user` layer in that org are values on the
   KV plane (HIP-1324), in the org's bucket `mod`, under the keys `org` and
   `user/<sub>`, where `<sub>` is the person's IAM subject. The bucket keeps 64
   revisions per key and no expiry. A person's user layer is per org, because
   what it arranges is that org's surface.
3. The `mod` capability names its buckets on the plane itself, outside the tenant
   prefix every `/v1/kv` bucket is qualified under (HIP-1324 §3). No `kv` grant
   reaches a layer or a draft, so only the rules of §9.4 write one.
4. A layer's value is its ops and the change that produced it: who wrote it, the
   agent that acted (`act`, HIP-0111 §7) where one did, the note, and the ops or
   the version reverted to. A layer's version is its KV revision; version `0` is
   the empty layer.
5. A write names `base`, the version it was made against. The store writes only
   if the key is still at `base`, a compare-and-set on the revision; otherwise it
   answers 409 with the current version, and the writer reads again and decides
   again. Two writers never overwrite each other silently.
6. `GET /v1/mod/layers/{layer}/versions` lists the retained versions, newest
   first, each with its change. A revert names a version and writes a NEW version
   whose ops equal it: history is never rewritten, and a revert can itself be
   reverted. A version older than the 64 retained can no longer be read or
   reverted to.
7. Drafts are values on the same plane, in the org's bucket `mod_draft`, keyed
   by draft id, expiring after 24 hours. They are a bucket of their own because
   a KV bucket's TTL covers every key in it (HIP-1324 §2), and a layer never
   expires.

#### §9.4 Who writes, and drafts

1. **Reading.** A member reads the org layer and their own user layer, with
   `mod:read`. Nobody reads another person's user layer, an org admin included:
   the route has no way to name one. `user` is always the caller's own layer, or,
   for an agent, the layer of the person it acts for.
2. **The user layer.** The person writes and commits it. Their own agent (HIP-0524
   §2) — holding a token exchanged for that person (HIP-0111 §7) with
   `mod:write`, whose `act` names the agent — writes it as a draft, and the draft
   commits without the person's Keep only where HIP-0524 lets that agent act
   unasked:

   | The person's level (HIP-0524 §4, §8) | The agent's write |
   |---|---|
   | `draft` | a draft; it waits for Keep |
   | `confirm` | a draft; it waits for Keep |
   | `send`, with a window | a draft that commits itself when the person's window (HIP-0524 §5) ends with no Discard |
   | `send`, `instant` | committed at once |

   The level is the person's effective level with the org's ceiling applied, read
   at the moment of the write and again when a window ends; a level lowered
   during a window cancels the commit and leaves the draft for Keep (HIP-0524
   §9), and so does a layer that moved since the draft's `base` (rule 8). The window's end is a durable timer on the one task engine, as
   HIP-0524 §5's is. The ladder decides who presses Keep, never what may be
   written: an agent without `mod:write` is refused at every level. No other
   agent writes a person's layer.
3. **Never a sensitive setting.** A draft whose ops set a `sensitive` setting
   waits for the person's Keep at every level, `send` and `instant` included.
4. **Never the agent's own limits.** The settings HIP-0524 §4 rule 2 keeps from
   the agent — its level, its window and the org's ceiling — are not in the
   surface an agent is answered, so an agent's patch naming one is refused as an
   unknown id (§9.2 rule 1). An agent cannot even draft a change to what governs
   it.
5. **The org layer.** An org admin of that org writes and commits it. Every agent
   — an org admin's own, the org's agent (HIP-0523 §10), any other — only drafts
   it, at every level, and an org admin's Keep commits the draft. HIP-0524's
   ladder governs a person's own layer and never the org's. A SuperAdmin has no
   path into an org's layer here.
6. **The org's word holds.** A `show` in a user layer of something the org layer
   hides is refused (422). A setting of scope `org` is set only in the org layer;
   one of scope `user` may be set in the org layer as the members' default and in
   each user layer.
7. **A draft** is a write with `draft: true` — always, for an agent, unless rule 2
   commits it at once. It stores the layer, `base`, the ops, the note, the
   writer and `act`, and the time it commits itself if rule 2 gives it one,
   and answers its id. It writes no version. The host shows it over the layer it
   would change, to whoever can keep it and to the agent that wrote it, under a
   bar the host draws outside every frame: "N changes by <agent> — Keep /
   Discard", with the time left when it commits itself.
8. **Keep** is `POST /v1/mod/drafts/{id}/commit`, by the person on their user
   layer or an org admin on the org layer. It applies the ops at the draft's
   `base` under the same compare-and-set: if the layer moved since, 409, and the
   writer drafts again against the current version. **Discard** is
   `DELETE /v1/mod/drafts/{id}`, by whoever may keep it or by the agent that wrote
   it. An agent never keeps a draft. A draft neither kept nor discarded expires
   after 24 hours. A layer has at most 16 open drafts; a seventeenth is refused
   until one is kept, discarded or expired.
9. **Revert** is the person's on their user layer and an org admin's on the org
   layer. An agent undoes a change by drafting the ops that undo it.

A person MAY draft their own write to see it before they keep it.

#### §9.5 The addresses and the tool

Every operation is typed (HIP-0106), under `/v1/mod`. `{layer}` is `org` or
`user`.

| Operation | Answers |
|---|---|
| `GET /v1/mod/surface` | §9.1 |
| `GET /v1/mod/layers/{layer}` | the current version and its ops |
| `GET /v1/mod/layers/{layer}/versions` | the retained versions and their changes |
| `POST /v1/mod/layers/{layer}` | `{base, ops, note, draft?}`; the new version, or the draft |
| `POST /v1/mod/layers/{layer}/revert` | `{version}`; the new version |
| `POST /v1/mod/drafts/{id}/commit` | the new version |
| `DELETE /v1/mod/drafts/{id}` | 204 |
| `GET /v1/mod/watch` | a stream of changes, declared with prose because a stream is not a value |

`GET /v1/mod/watch` is server-sent events: one `layer` event, `{layer,
version}`, for each new version of the org layer or the caller's user layer, and
one `draft` event, `{layer, id, state}`, for each draft over either that the
caller may see, `state` being `open`, `kept`, `discarded` or `expired`. It reads
the KV plane's own watcher (HIP-1324 §5) and keeps no state. A host re-reads
the layer an event names and composes again; a host with no stream open reads
the layers when it loads.

The MCP endpoint projects the capability as one tool, `mod` (HIP-0300 §1), with
the ops `read_surface`, `read_layer`, `list_versions`, `patch_layer`,
`revert_layer`, `commit_draft` and `discard_draft`. Each is admitted by the same
rules as its route, so an agent's `patch_layer` lands as a draft exactly as
§9.4 says and its `commit_draft` is refused. The stream is not a tool.

#### §9.6 Audit

Every layer write, draft, Keep, Discard, revert, self-commit at a window's end
and expiry is a record on the trail (HIP-1103): the person, the agent (`act`)
where one acted, the org, the layer, the version before and after or the draft
id, and the ops. The record is written before the layer changes; a write that
then loses its compare-and-set is recorded as refused. A change whose record
cannot be written does not happen.

#### §9.7 The capability

- **Store.** The two KV buckets of §9.3, reached through HIP-1324's plane; it
  opens no store of its own.
- **Tenancy.** The org is the gateway-validated principal's (HIP-0026), never a
  request field. `user` resolves to the token's subject. Nothing in a request
  names a person or an org.
- **Money.** Free, said in those words.
- **Events.** It publishes none on the bus, so a customer's webhooks receive no
  `mod.*` event; the stream of §9.5 reads the KV plane directly.
- **Observability.** Nothing beyond the request span; every change is on the
  trail (§9.6).
- **Stage.** `beta` (HIP-0139 §8) until a first-party host composes from it, so
  until then its tool is in no public list.
- **Upstream.** None.

### §10 The repository

`hanzoai/app` holds both packages: `@hanzo/mod` — the contract, the registry,
the host runtime (loader, composer, bridge, placement), the layer client and the
test kit — and `@hanzo/app` — the shell, the first-party mods and the host
adapters. A host imports the runtime and loads the first-party layer by
manifest; it imports a first-party app only through its subpath.

The cloud side is capabilities that exist — build (HIP-1230), install (HIP-1213,
with a new source `mod`), listing (HIP-1137), grants (HIP-1041), consent and
token exchange (HIP-0111), state (HIP-1324), audit (HIP-1103) — and one this HIP
adds, `mod` (§9), which serves the surface and holds the layers. Operator writes
on a mod sit under the operator's view of the capability that owns the row
(HIP-0139 §3.2).

### §11 What is served today

- `@hanzo/rooms` 0.1.94 ships the first-party apps as subpath exports that each
  host imports into its own origin. The set is the `Mode` union.
- The name `hanzoai/app` belongs to the repository of the hanzo.app builder,
  which is renamed and archived before `hanzoai/rooms` takes the name.
- None of the manifest, loader, layers, `/v1/mod`, drafts, the `mod` tool,
  bridge, isolated placement, bundle host, mod build, `mod` source, grantable
  list, consent record, block or review exists.
- The KV plane (HIP-1324) and the trail (HIP-1103) that §9 stores and records
  through are served. HIP-0524's ladder and its one-shot timer are not
  (HIP-0524 §14); until they are, every person is at `draft` (HIP-0524 §4 rule 1)
  and every agent write is a draft that waits for Keep.
- IAM's token exchange (HIP-0111 §7) carries no narrowed scope, so §5.3's cloud
  ceiling needs it to; until then the host would be the only ceiling.
- The tool plane's authored plugins are bundled and run in goja
  (`POST /v1/tools/plugins/build`, HIP-1213). That is a soft engine; it is not a
  mod backend, and §5.5 does not admit it.
- The CI review job runs on every repository that calls `hanzoai/ci`'s build.
  Its output is an exit status, not yet §7's verdict record.

## Rationale

**One contract for the first party.** The alternative — first-party apps
imported directly, third parties on a plugin API beside them — is what every
extension system with a privileged core becomes: the core grows features the API
never gets, and the API is tested only by the people least able to report what
is missing. §4 rule 5 makes the claim checkable instead of aspirational.

**Two packages, one direction.** The contract is what a third party builds
against and what the cloud checks; the shell is one product's frame. Kept in one
package, every change to the frame is a release of the contract. `@hanzo/mod`
holds no view, so a mod depends on nothing it is not allowed to call, and
`@hanzo/app` is the contract's first and largest consumer.

**An opaque-origin frame.** Three ways to run code that is not ours near the
app. A script-level sandbox inside the app's origin is one engine bug or one
reachable prototype from the session; the origin boundary is the one the browser
itself enforces. A subdomain per mod is same-site with the app, so a cookie
scoped to the parent domain reaches it, and every mod needs a name and a
certificate. An opaque origin has no session to leak and nothing to provision.
Its cost is that a mod has no storage of its own, which is why the bridge's
`store` exists.

**The manifest is the ceiling.** Declared contributions are what a listing shows
and a person consents to; registrations at run time are what makes unload
complete. A mod whose code could register beyond its manifest would make the
consent screen a description, not a limit.

**Built from source.** A bundle an author uploads cannot be tied to the source
anyone read. The digest ties the listing to the bytes and the bytes to a commit,
and a reviewer's verdict to that digest alone.

**Review as evidence.** A reviewer reads code written by the party it is judging,
and that code can address the reviewer. A verdict that could approve would make
an injection in the source a path to the public catalogue. A person decides whom
the platform vouches for; the reviewer helps them decide.

**Layers, not edits.** A person's change is a patch above Hanzo's layer, never an
edit inside it, so Hanzo ships updates without merging anyone's customisation.

**Patches, not code.** The alternative for "put Drive beside Chat" is the one an
agent has today: change the code. That needs a build, a consent and a reload,
and the result cannot be checked against anything but itself. A closed set of
ops over a surface computed from manifests can be checked before it is written,
cannot carry an injection anywhere it would run, and is undone by writing an
older version again.

**Versions and drafts.** An agent will get an arrangement wrong. A versioned
layer makes every change one revert away; a draft makes it visible before it
lands; compare-and-set makes two writers meet rather than overwrite. Each costs
one field on a write.

**The ladder, for the person's own layer only.** HIP-0524's ladder is how a
person says what their agent may do unasked, so the same setting decides whether
their agent's arrangement waits for them. Their layer changes only their view,
and every change is a revert away. The org's layer changes what every member
sees, so no agent commits it, at any level. A sensitive setting is the case
where a wrong value costs more than an arrangement, so it waits for the person
always.

**KV for layers.** A layer is a small value per (org, person) that needs
revisions, compare-and-set and a watch — exactly what HIP-1324 serves. A
person's preferences (HIP-1141) are one document per person across every org,
with no history; an org's settings (HIP-1151) are per product, with no history.
Neither could revert a change or tell two writers apart.

## Backwards compatibility

The rename moves `@hanzo/rooms` to `@hanzo/app` and `@hanzo/mod`, and
`hanzoai/rooms` to `hanzoai/app`, in one wave per host: each host switches its
imports in its release, with no alias package and no re-export of the old name.
`@hanzo/rooms` publishes no further version and is deprecated on npm naming
`@hanzo/app`. What `@hanzo/rooms` holds that is not the app — the session, the
gateway client, presentational helpers — moves first to the package that owns it
(`@hanzo/iam`, `@hanzo/ai`, `@hanzo/ui` and the others) and is published there;
`@hanzo/app` re-exports none of it.

The name `hanzoai/app` is free only after the repository holding it today is
renamed and archived (§11).

No layer was ever written under the earlier form of this HIP, which kept them in
org settings and preferences, so nothing migrates. HIP-0523's channel is the
conversation and this HIP's app is a place on the rail. The tool plane's existing
skills, MCP servers and authored plugins are unchanged; a mod's rows are a new
source beside them.

## Security Considerations

**The session.** A mod frontend in the app's origin, or a frame given
`allow-same-origin`, can read the IAM session and act as the person in every org
they belong to. §5.1 keeps third-party code out of that origin and out of any
origin same-site with it, and the token never crosses the bridge (§5.2 rule 3).
A host that listens for window `message` events instead of the transferred port
admits every sandboxed frame on the page, because each reports origin `"null"`.
A bundle opened outside its frame is still sandboxed by its own response header
(§5.1 rule 3).

**Who is first-party.** In-origin placement is decided by the build record —
`hanzoai/app`, its default branch, its own CI identity — and never by a
`publisher` field, so no org, including one a person founds, can name itself
into the app's origin.

**Escalation.** A mod's authority is the intersection of what it declared, what
the installer consented to and what the person it acts for holds (§5.4 rule 1),
drawn from a grantable list that excludes custody, identity, the operator's
surface, code installation and the layers (rule 2). The MCP endpoint and other
dispatching operations are unreachable (§5.3), contributed agents and backends
carry the mod's authority and not the person's (§5.4 rule 3, §5.5 rule 3), and a
service handler runs with its caller's grants intersected (§3.4). A registration
outside the manifest is refused (§3.1). The cloud enforces the same ceiling
through the exchanged token, so a host defect does not lift it (§5.3).

**Consent forgery.** A mod cannot draw outside its rectangle, so it cannot paint
a host prompt or a draft's Keep, and the host labels every third-party app and
view with its publisher (§5.1 rule 5). Consent happens on IAM's page with the
person present, so an agent driven by an injected instruction can ask for an
install and never complete one (§6.3). Outside two exceptions bounded by
permissions already consented, a new digest needs new consent, so approved code
cannot be swapped quietly.

**Patches.** A patch is a closed op over an id the surface lists, checked whole
before it is stored (§9.2). It carries no code, URL, markup or style, so an agent
steered by an injection can rearrange what a person sees and can do nothing a
patch cannot express. What it can express is bounded by who may commit it: an
agent never commits the org's layer, never commits a sensitive setting without
the person, cannot name the settings that govern it (§9.4 rules 3–5), and cannot
show what the org hid (§9.4 rule 6). Every change is a version, every version is
a revert away, and every write is on the trail before it lands (§9.6).

**Layers are private.** No route names another person's user layer, so an org
admin cannot read how a member arranged their app, and a person's layer in one
org says nothing to another org (§9.3 rule 2, §9.4 rule 1). The layers sit on
the KV plane outside every name `/v1/kv` can address (§9.3 rule 3), so a member
holding `kv:write` cannot write a layer around §9.4, its drafts or its audit.

**A credential is a person.** A token with no `act` is the person. A person who
hands an API key to a tool has made that tool the person, here as everywhere; an
agent that acts through the exchange is named by `act`, and only an agent so
named is ever bound by §9.4.

**Backends.** A `wasm` backend shares the process and is held by wazero's memory
isolation, a memory cap and a deadline on every invoke; a `sandbox` backend is
assumed hostile inside its pod and holds only the mod's exchanged token. Neither
holds an upstream credential (§5.4 rule 5), and egress reaches only named public
hosts (§5.5 rule 4).

**Supply chain.** The build runs from a commit hash, the lockfile alone and a
toolchain digest, with no other network, and one digest covers everything it
produced (§5.6). A host loads the bundle under Subresource Integrity equal to the
pinned digest (§5.1 rule 3). A mod found hostile after approval is blocked by
name, every digest, and its tokens and leases revoked (§6.4).

**What isolation does not do.** A mod can disclose anything its grants let it
read. The frame stops it acting as the person; only the grant list and the
person's consent limit what it sees (§5.1).

**Review.** The reviewer reads code its author controls, so the verdict is
evidence and never approval (§7 rule 5), and only a SuperAdmin chooses the
reviewer whose verdict a listing shows (§7 rule 7).

**Audit.** Install, consent, a refused load, a block, a verdict, a review
decision and every layer change each write a record to the tamper-evident trail
(HIP-1103), naming the mod or the agent and the person.

## Open questions

1. **The mobile host.** Hanzo Mobile renders first-party mods natively on the
   HIP-0504 substrate. A third-party frontend there needs a web view with an
   opaque origin and the same port-based bridge. Whether mobile offers
   third-party mods at launch, and how that meets mobile platforms' rules on
   code downloaded at run time, is open.
2. **The bundle host.** §5.1 rule 3 requires a host that is not same-site with
   any Hanzo app; which domain it is has not been chosen.

## References

- HIP-0026 — Identity & Access Management Standard
- HIP-0105 — In-Process Extension Runtime Standard
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0111 — Hanzo IAM Authentication Standard
- HIP-0118 — SuperAdmin & Tenant Isolation Model
- HIP-0126 — Integrations, Connectors & the Extension Runtime
- HIP-0139 — Capability
- HIP-0143 — Egress — The Outbound Trust Boundary
- HIP-0300 — Unified MCP — one endpoint, and local servers that forward to it
- HIP-0504 — Unified Cross-Platform Design System
- HIP-0523 — Channels — One Store, Two Views, Many Bridges
- HIP-0524 — The Personal Agent
- HIP-1030 — OpenAPI — The Served Contract
- HIP-1041 — Authz
- HIP-1062 — Tasks — The Durable Run
- HIP-1103 — Audit — The Tamper-Evident Trail
- HIP-1137 — Marketplace — Listings and Installs
- HIP-1141 — Pref — One Document Per Person
- HIP-1146 — Sandbox — A Lease on Isolated Compute
- HIP-1151 — Settings — Per-Product Org Configuration
- HIP-1210 — Agents — Define, Run, Keep the Run
- HIP-1213 — Tools — The Tool Plane
- HIP-1230 — Platform — The Container Plane
- HIP-1232 — Git — Repository Hosting
- HIP-1250 — Integrations — The Connection Registry
- HIP-1324 — KV — Buckets of Versioned Values
- HIP-1330 — Dev — The Agent Loop
- RFC 8693 — OAuth 2.0 Token Exchange

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
