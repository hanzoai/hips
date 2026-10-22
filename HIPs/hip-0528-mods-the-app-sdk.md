---
hip: 0528
title: Mods — The App SDK
author: Hanzo AI
type: Standards Track
category: Interface
status: Draft
implementation-go: none
created: 2026-10-22
requires: HIP-0026, HIP-0105, HIP-0118, HIP-0126, HIP-1041, HIP-1137, HIP-1146
---

# HIP-0528: Mods — The App SDK

## Abstract

`@hanzo/mods` (repository `hanzoai/mods`) is the SDK Hanzo's web, desktop and
mobile apps are built from, and the one way anything extends them. Everything in
the app is a mod: Chat, Dev, Settings and the other first-party rooms, an
extension a third party publishes, and the one a person's own agent wrote for
them a minute ago. All three load through one contract.

A mod is a manifest and code. The manifest names the publisher, what the mod
contributes — rooms, panes, commands, settings pages, agents, skills, MCP
servers, tools — what it may touch, and where its backend runs. The code
registers those contributions, and each one is undone when the mod unloads from
a host or is uninstalled from an org, so loading, unloading and reloading leave
the app exactly as they found it.

Code Hanzo did not write never runs in the app's origin, where the person's
session lives. Its frontend runs in an isolated frame and reaches the host only
through a typed, permission-checked bridge; its backend runs only in a hard
sandbox. Every mod is built from source at a pinned commit by the platform's
build door. A private mod is usable in its author's org at once; a public one is
listed only after a SuperAdmin approves it (HIP-1137, amended alongside this).

The package is today's `@hanzo/rooms` (`hanzoai/rooms`), renamed and given this
contract. This HIP is proposed: the rooms ship, and none of the contract does
(§10).

## Motivation

The app cannot be extended today, not even by Hanzo. The rooms are a closed
union in the package (`Mode`, `src/Shell.tsx`) and the rail is a fixed list
(`Rail.tsx`), so a new room is a release of the package and of every host that
imports it. A third party has no way in. A person whose agent builds a useful
view in Dev has nowhere to keep it.

What the platform can extend arrives in pieces, each with its own install: a
skill, an MCP server and an authored plugin are rows in the tool plane
(HIP-1213); an agent is a definition (HIP-1210). An extension that needs a pane,
the agent that fills it and the MCP server it calls is three installs with
nothing joining them, and an uninstall that forgets one leaves it running.

An extension point the first party does not use rots. If Chat reaches the host
by a path a mod cannot take, the contract is never exercised by the code that
matters most, and every feature Hanzo adds widens the gap. So the first-party
rooms are mods, on the same contract, with no private path.

The hard line is the session. On the web the IAM session sits in the app
origin's storage (`@hanzo/rooms` `lib/session`), so any script in that origin
can read it and act as that person in every org they belong to. Code the
platform did not write — a third party's, or one an agent wrote from a prompt
that may carry an injection — never runs there.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 Terms

- **Host** — an app that loads mods: hanzo.ai in a browser, Hanzo Desktop, Hanzo
  Mobile. The host owns the window, the session, the router, the bridge, and
  every prompt that asks a person to consent.
- **Mod** — one package with one manifest, named `<publisher>/<id>`; each build
  of it has one digest (§5.6).
- **Contribution** — one thing a mod adds to a host or to its org. Every
  contribution is a registration with a disposer.
- **First-party** — built from `hanzoai/mods` itself, at a commit on its
  default branch, by that repository's own CI identity. Nothing else is
  first-party, whatever org it names as publisher: a mod a person, their agent or
  any other org wrote is third-party.
- **Room** — a place in the app: a mark on the rail and the page behind it, as
  `@hanzo/rooms` uses the word. It is not HIP-0523's room, which is a
  conversation; a room may render those (Chat does). See Open questions 3.

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
      "rooms":    [{ "id": "weather", "title": "Weather", "icon": "cloud" }],
      "panes":    [{ "id": "forecast", "title": "Forecast", "in": ["hanzo/chat"] }],
      "commands": [{ "id": "refresh", "title": "Refresh the forecast" }],
      "settings": [{ "id": "units", "title": "Units" }],
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

The contribution kinds are a closed set. A host MUST refuse a manifest naming a
kind it does not know rather than skip it; a ninth kind is an amendment to this
HIP.

| Kind | Registers | Where it lands |
|---|---|---|
| `rooms` | a place on the rail and its page | the host's rail and router; a third-party room is addressed `/mods/<publisher>/<mod>/<room>` |
| `panes` | a panel inside the rooms of the mods named in `in` | those rooms' side panel |
| `commands` | an action with a title and an optional key chord | the palette's Actions and the key map |
| `settings` | a page | Settings' sections |
| `agents` | an agent definition (HIP-1210) | the org's agents |
| `skills` | a `SKILL.md` | the tool plane's skills (HIP-1213) |
| `mcp` | an MCP server, served by the backend or at a `url` whose host is one of the mod's `net:` grants | the tool plane's MCP servers (HIP-1213) |
| `tools` | a typed tool whose implementation is a backend export | the tool plane (HIP-1213) |

The first four are held by a host and governed by load and unload (§3). The last
four are rows in the cloud and governed by install and uninstall (§6.2), so an
agent the mod contributes still runs when no app is open.

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
mechanism. The mod's store (§5.4 rule 4) survives it and an open room is drawn
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
within its own rooms; it never sees where else the person goes. Between two mods
that do not share a placement, a service call and an event cross the bridge
(§5.2) as JSON, asynchronously.

#### §3.5 Composition

The app a person sees is three layers, composed in order: Hanzo's first-party
mods, the org's installs, the person's own. A layer adds mods and MAY hide,
reorder or rename the contributions of the layers beneath it. It never edits
their code.

The org's layer is kept in org settings (HIP-1151, product `mods`) and written by
an org admin. The person's layer is their preferences (HIP-1141, key `mods`). A
person MUST NOT be able to show what their org hid. A person's own mods load
only in their home org, because their grants are scoped to it (§5.4); in any
other org the person sees Hanzo's layer and that org's, arranged as they like.
Because a customisation is a row above Hanzo's layer and never a change inside
it, an update to a first-party mod and a person's arrangement of it cannot
conflict.

### §4 First-party mods

1. Home, Chat, Dev, Inbox, Contacts, Meet, Cal, Drive, Board, Work, Bots and
   Settings are each a mod in `hanzoai/mods`, with a manifest, published by
   `hanzo` and built by the build door like any other (§5.6).
2. The rail, the palette's Go to and Actions, Settings' sections and Customize's
   tabs are read from the registered contributions. No host and no first-party
   mod names another room in code; `Mode` stops being a union and becomes the set
   of registered rooms.
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
   the mod's title and publisher beside every third-party room and pane, outside
   the frame. Anything drawn over the host — a dialog, a consent prompt, a toast,
   a menu — is drawn by the host at the mod's request, so a mod cannot draw a
   prompt that passes for the host's.
6. On Hanzo Desktop the frame MUST NOT reach the shell's native command
   interface; a native act reaches a mod only as a `host:` op (§5.4).
7. The host passes the design tokens and the theme (HIP-0504) across the bridge,
   so an isolated mod built on `@hanzo/ui` looks like the rest of the app.

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
HIP needs it to (§10).

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
2. A mod asks only for capabilities on the grantable list `@hanzo/mods`
   publishes. Custody (`kms`, `wallet`), identity (`iam`), the operator's
   surface (`/v1/admin/*`, HIP-0139 §3.2), and the writes that install or
   configure code (`tools`, `marketplace`, `settings`) are never on it, whoever
   installs the mod. A SuperAdmin installing a mod gives it no platform
   authority.
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
level of HIP-0524's ladder may ask for an install and may not accept it.

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

### §7 The review seam

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
6. The seam names no model and no vendor. A reviewer is any implementation of
   the interface, acting as its own IAM client, which may read the source and the
   bundle and nothing else.
7. Only a SuperAdmin configures the submission-time reviewer. A commit-time
   verdict is configured by the repository's own CI and is evidence for that
   repository alone; it is never shown as evidence for a listing.
8. Every verdict is an audit record (HIP-1103).
9. An org MAY turn the seam on for its own builds; a `refuse` at commit time then
   fails the build, as the CI review job does today. Otherwise the seam never
   holds a private install.

### §8 The developer surface

Two packages, one for each way of reaching the platform.

**`@hanzo/mods`, to write a mod.** It exports `defineMod`, the manifest's type,
and `ctx`: `rooms`, `panes`, `commands`, `settings`, `agents`, `skills`, `mcp`,
`tools`, `services`, `events`, `store`, `host` and `fetch`, every registration
returning its disposer. Its test kit, `@hanzo/mods/test`, loads a mod in an
isolated frame, asserts §3.2's equality across load and unload, and fails on any
registration the manifest does not declare. Interface components come from
`@hanzo/ui` (HIP-0504).

```ts
import { defineMod } from '@hanzo/mods'
import { Forecast } from './Forecast'

export default defineMod({
  activate(ctx) {
    ctx.rooms.add({ id: 'weather', render: Forecast })
    ctx.commands.add({ id: 'refresh', run: () => ctx.events.emit('refresh') })
  },
})
```

**The generated API clients, to call the platform.** `hanzoai/sdk` is the index
of them, one per language, each generated from the cloud's served document
(HIP-1030) by `hanzoai/openapi`. Inside a mod, the TypeScript client is built
with `ctx.fetch`, so it holds no key and every call is checked (§5.3). Outside
one, the same client takes an API key. One client, two transports.

### §9 The repository

`hanzoai/mods` holds the SDK, the host runtime (loader, composer, bridge,
placement), the test kit and the first-party mods. A host imports the runtime and
loads the first-party layer by manifest; it imports no room.

The cloud side is capabilities that exist: build (HIP-1230), install (HIP-1213,
with a new source `mod`), listing (HIP-1137), grants (HIP-1041), consent and
token exchange (HIP-0111), state (HIP-1324), audit (HIP-1103). This HIP adds no
capability and no top-level address; its operator writes sit under the
operator's view of the capability that owns the row (HIP-0139 §3.2).

### §10 What is served today

- `@hanzo/rooms` 0.1.94 ships the rooms as subpath exports that each host
  imports into its own origin. The set is the `Mode` union.
- None of the manifest, loader, layers, bridge, isolated placement, bundle
  host, mod build, `mod` source, grantable list, consent record, block or review
  seam exists.
- IAM's token exchange (HIP-0111 §7) carries no narrowed scope, so §5.3's cloud
  ceiling needs it to; until then the host would be the only ceiling.
- The tool plane's authored plugins are bundled and run in goja
  (`POST /v1/tools/plugins/build`, HIP-1213). That is a soft engine; it is not a
  mod backend, and §5.5 does not admit it.
- The CI review job runs on every repository that calls `hanzoai/ci`'s build.
  Its output is an exit status, not yet §7's verdict record.

## Rationale

**One contract for the first party.** The alternative — first-party rooms
imported directly, third parties on a plugin API beside them — is what every
extension system with a privileged core becomes: the core grows features the API
never gets, and the API is tested only by the people least able to report what
is missing. §4 rule 5 makes the claim checkable instead of aspirational.

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

**Layers, not edits.** A person's change is a row above Hanzo's layer, never a
patch inside it, so Hanzo ships updates without merging anyone's customisation.

## Backwards compatibility

The rename moves `@hanzo/rooms` to `@hanzo/mods` and `hanzoai/rooms` to
`hanzoai/mods` in one wave: every host switches its imports in the same release,
with no alias package and no re-export of the old name. `@hanzo/rooms`
publishes no further version and is deprecated on npm naming `@hanzo/mods`.
Subpaths keep their names under the new prefix (`@hanzo/rooms/lib/session`
becomes `@hanzo/mods/lib/session`) until each room becomes a mod and leaves the
host's imports.

HIP-0523's room is unchanged. The tool plane's existing skills, MCP servers and
authored plugins are unchanged; a mod's rows are a new source beside them.

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
`hanzoai/mods`, its default branch, its own CI identity — and never by a
`publisher` field, so no org, including one a person founds, can name itself
into the app's origin.

**Escalation.** A mod's authority is the intersection of what it declared, what
the installer consented to and what the person it acts for holds (§5.4 rule 1),
drawn from a grantable list that excludes custody, identity, the operator's
surface and code installation (rule 2). The MCP endpoint and other dispatching
operations are unreachable (§5.3), contributed agents and backends carry the
mod's authority and not the person's (§5.4 rule 3, §5.5 rule 3), and a service
handler runs with its caller's grants intersected (§3.4). A registration outside
the manifest is refused (§3.1). The cloud enforces the same ceiling through the
exchanged token, so a host defect does not lift it (§5.3).

**Consent forgery.** A mod cannot draw outside its rectangle, so it cannot paint
a host prompt, and the host labels every third-party room and pane with its
publisher (§5.1 rule 5). Consent happens on IAM's page with the person present,
so an agent driven by an injected instruction can ask for an install and never
complete one (§6.3). Outside two exceptions bounded by permissions already
consented, a new digest needs new consent, so approved code cannot be swapped
quietly.

**Supply chain.** The build runs from a commit hash, the lockfile alone and a
toolchain digest, with no other network, and one digest covers everything it
produced (§5.6). A host loads the bundle under Subresource Integrity equal to the
pinned digest (§5.1 rule 3). A mod found hostile after approval is blocked by
name, every digest, and its tokens and leases revoked (§6.4).

**Backends.** A `wasm` backend shares the process and is held by wazero's memory
isolation, a memory cap and a deadline on every invoke; a `sandbox` backend is
assumed hostile inside its pod and holds only the mod's exchanged token. Neither
holds an upstream credential (§5.4 rule 5), and egress reaches only named public
hosts (§5.5 rule 4).

**What isolation does not do.** A mod can disclose anything its grants let it
read. The frame stops it acting as the person; only the grant list and the
person's consent limit what it sees (§5.1).

**Review.** The reviewer reads code its author controls, so the verdict is
evidence and never approval (§7 rule 5), and only a SuperAdmin chooses the
reviewer whose verdict a listing shows (§7 rule 7).

**Audit.** Install, consent, a refused load, a block, a verdict and a review
decision each write a record to the tamper-evident trail (HIP-1103), naming the
mod and the person.

## Open questions

1. **The name.** `@hanzo/mods` and `hanzoai/mods` await the owner's
   confirmation; `@hanzo/rooms`' own notes anticipated `@hanzo/apps`. The name
   appears only as `mods`, `mod` and the file name of this HIP, so a rename is a
   whole-word replace.
2. **The mobile host.** Hanzo Mobile renders first-party mods natively on the
   HIP-0504 substrate. A third-party frontend there needs a web view with an
   opaque origin and the same port-based bridge. Whether mobile offers
   third-party mods at launch, and how that meets mobile platforms' rules on
   code downloaded at run time, is open.
3. **The word room.** The contribution kind `rooms` keeps the package's word and
   collides with HIP-0523's room. `places` is the candidate if the owner wants
   one word per object.
4. **The bundle host.** §5.1 rule 3 requires a host that is not same-site with
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
- HIP-0504 — Unified Cross-Platform Design System
- HIP-0523 — Channels — One Store, Two Views, Many Bridges
- HIP-0524 — The Personal Agent
- HIP-1030 — OpenAPI — The Served Contract
- HIP-1041 — Authz
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
