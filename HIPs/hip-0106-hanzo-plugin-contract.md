---
hip: 0106
title: The Hanzo Plugin Contract
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Active
created: 2026-05-19
updated: 2026-07-29
requires: HIP-0026, HIP-0027, HIP-0036, HIP-0105, HIP-0111, HIP-0119, HIP-0132, HIP-0134, HIP-0302, HIP-0400
---

# HIP-106: The Hanzo Plugin Contract

## Abstract

This is the contract a git repository satisfies in order to build and run as a
Hanzo plugin: what it may import, what its `main` does, how it declares the paths
it answers, what documents it must project, and what gates prove all of it. Any
repository that satisfies it composes into any host — `hanzoai/cloud` is the
reference host — and also runs standalone as an ordinary HIP-0119 service, with
no second code path and no build matrix.

**A plugin imports `zip` and nothing of the host's.** Its binary is composed at
run time, not linked at build time, so the host's build does not grow when a
plugin does, plugins build in parallel, and one changing rebuilds only itself.
Capabilities expand strictly opt-in: a language runtime, a store, telemetry, the
call plane — each is an import the plugin chooses or a value that arrives at run
time, and a plugin needing none pays for none. The smallest host binary runs just
the smallest set.

**A plugin DECLARES the paths it answers; the host DISCOVERS them.** A host that
hand-maintains a routing row for a repository it does not build will get that row
wrong, and a wrong row is an outage, not a documentation defect (§3.1 records the
one that happened). The declaration is projected from the plugin's own live
router, travels as an artifact verified by the same digest as the binary, and is
gated by asking the composed ROUTER where each declared path actually goes —
never by consulting a committed document.

**Supersedes this HIP's own earlier process model.** The fused binary this
document originally specified — one link that imported every subsystem as a Go
package, driven by `cloud.Register` + `apps.Wire()` — is deleted. `cmd/cloud` is
now a light host that links `zip`, a manifest and a console embed (402 packages)
and composes ~116 per-plugin binaries as child processes. The
subsystem-boundary, extension-surface, multi-language, inter-subsystem-call,
single-process and migration sections that described the old model are replaced
by the Specification below. Sections on Commerce's PCI scope, the solo-vault CDE
and PSP optionality are retained unchanged; they are about commerce, not about
the binary, and are filed here only by history.

**This document does not restate HIP-0119.** HIP-0119 is the one and only shape
of a Hanzo backend service — listeners, ports, health paths, environment names,
image naming, deployment. A plugin conforms to it in full and this document adds
only what it does not cover. Restating it here would create the second copy
HIP-0119 §10 forbids.

**Wire.** Every inter-plugin call is ZAP: typed ops over a unix socket, JSON only
at the system edge. No gRPC and no protobuf in Hanzo-authored code; where an
external standard must be spoken at an interop boundary (OTLP, OpAMP), the
conversion lives in the `zap` tooling and never in a service.

## Motivation

Two forces, pulling the same way.

**The build.** Measured 2026-07-29: `hanzoai/cloud`'s root package is 574
packages, and `plugin/crm` — whose own code is about two packages — is 576,
because it imports that root to reach `cloud.Serve`. A conforming plugin built
against `zip` alone is 260. The 316-package difference is not crm's code; it is
the host's composition root, arriving as a library. Multiply by 116 plugins and
that is the whole cost of the fleet's build. It cannot be fixed inside cloud,
because the coupling *is* the import.

**The repository boundary.** A capability that belongs to another team, another
licence, or another release cadence has to live in another repository. Today it
cannot: to be mountable it must implement a `MountFunc` from cloud's root
package, so every plugin is inside cloud by construction, and the OSS/private
split, per-capability release cadence and third-party extension are all blocked
on the same import.

Both are removed by the same move: state the contract in terms of `zip`, make the
plugin declare its own routing, and let the host discover instead of transcribe.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119. "Plugin" below means *a git repository whose build produces a
binary a host composes at run time*. "Host" means the process that composes it —
`hanzoai/cloud`'s `cmd/cloud` is the reference host, and there is nothing
cloud-specific in this contract.

**This document does not restate HIP-0119.** HIP-0119 is the one and only shape
of a Hanzo backend *service*: two listeners, `/v1/` only, `/healthz` + `/readyz`
+ `/metrics` on the ops port, environment configuration, `<org>-<app>` client
IDs, one CR per service, and the §9 forbidden list. A plugin binary run
standalone IS a service and MUST conform to HIP-0119 unchanged. What follows is
only what HIP-0119 does not say: what a plugin repository may *import*, what its
`main` *does*, how it *declares* the paths it answers, what *projections* it
must produce, and what *gates* prove it. Where the two touch, HIP-0119 is
authoritative and this document cites it.

Every number below was measured on 2026-07-29 against `hanzoai/cloud` at
`e5874218` and `github.com/zap-proto/zip@v1.18.7`. Re-measure before quoting
one; the command is given each time.

### §1 The module contract

#### §1.1 What a plugin imports

A plugin's non-test import graph MUST contain, from first-party code, exactly:

| Import | Role | Status |
|---|---|---|
| `github.com/zap-proto/zip` | the framework: router, typed ops, transports, caller, call plane | required |
| `github.com/zap-proto/zip/middleware` | `Recover`, `RequestID`, `Logger`, `Telemetry`, `RateLimit`, … | optional |
| `github.com/hanzoai/plane` | the internal call contract: op-name constants and their In/Out types | only if it calls or answers a peer |
| `github.com/hanzoai/money` | exact decimal amounts | only if it handles money |
| one `zip/<lang>` adaptor | a non-Go handler runtime (§5) | only if it mounts one |

It MUST NOT import `github.com/hanzoai/cloud`, any `hanzoai/cloud/...`
subpackage, or any other host package. That is the entire rule, and it is
checked by a gate, not by review (§8.1).

Everything else a plugin needs — a store driver, an HTTP client, a PDF
library — is the plugin's own dependency, chosen by the plugin, paid for by the
plugin, and invisible to every other plugin and to the host.

#### §1.2 The measured floor

    $ go list -deps . | wc -l

| Binary | Packages | Of which |
|---|---|---|
| `zip` alone, clean module, v1.18.7 | **258** | 0 goja, 0 esbuild |
| `zip` alone, clean module, v1.18.6 | 315 | 33 goja + esbuild |
| a conforming plugin: zip + money + 2 typed ops + tenancy refusal | **260** | — |
| `cmd/cloud` (the host, zero app imports) | 402 | — |
| `hanzoai/cloud` root package | 574 | still imports 10 `apps/*` packages |
| `plugin/crm` (today's shape — imports `cloud`) | **576** | its own code is ~2 packages |
| `hanzoai/cloud/plane` (already a leaf) | 74 | stdlib + `hanzoai/money` |

The 316-package difference between a conforming plugin (260) and today's
`plugin/crm` (576) is the whole of what §1.3 removes. `zip` v1.18.7 cutting
`zip/runtime` out of the root package is what makes 258 the floor rather than
315; a plugin MUST require `zip >= v1.18.7` so that a JavaScript interpreter and
a bundler are not linked into a binary that has no JavaScript.

#### §1.3 The six gaps, and where each one goes

`plane/` is the model. It is a LEAF: op-name constants plus the In/Out types
those ops carry, importing nothing of the host's, which is precisely what lets
an aggregator call the ledger without linking it. Every gap below is resolved by
one of three placements, in this order of preference:

1. **In `zip`** — when it is a property of *any* typed op on *any* transport.
2. **In one tiny published contract module** — when it is a name both ends must
   spell identically and neither owns.
3. **At run time** — when it is a credential, a key, a sink or a policy. A value
   that arrives at run time cannot be a compile-time dependency, and a plugin
   that receives it holds no code to keep in sync.

Nothing is resolved by a fourth placement. In particular nothing is resolved by
a build tag, and nothing is resolved by a stub: where a capability may be absent,
the constructor MUST exist either way and MUST be nil-safe, so no caller ever
branches on availability (`middleware.Telemetry(nil)` returning a pass-through
handler is the shape).

**(a) The plane contract — a contract module, and one function in zip.**

`github.com/hanzoai/plane` is `hanzoai/cloud/plane` extracted verbatim to its
own module: 74 packages, no host imports, already correct. The extraction is a
module-path change and nothing else.

The *client and server halves* are already zip and MUST NOT be duplicated. Every
helper the host currently wraps them in is deleted in the change that names its
survivor:

| Deleted | Survivor |
|---|---|
| `cloud.Plane()` | `zip.New(zip.Config{AppName: name})` — a second app, listening only on `zip.SocketPath(name)`, never mounted on the edge |
| `cloud.ServePlane(name, log)` | `app.Listen(zip.SocketPath(name))` |
| `cloud.Peer(app)` | `zip.DialApp(name)` |
| `cloud.Who(ctx)` | `zip.CallerOf(ctx)` |
| `cloud.For(ctx, org)` | `zip.WithCaller(ctx, zip.Caller{Org: org})` |
| `cloud.As(c, org)` | `zip.Delegate(c *Ctx, org string) context.Context` — MOVE to zip; it reads only `Ctx` accessors |
| `cloud.bindRuntimeDir` | the host sets `ZIP_RUNTIME_DIR` on its children; `zip.RuntimeDir()` already resolves `$ZIP_RUNTIME_DIR` → `$XDG_RUNTIME_DIR/zip` → `/run/zip` |
| `cloud.Ask[In,Out]` | `zip.Ask[In,Out](ctx, name, op, in)` — ADD to zip: dial, call, close |

`zip.Ask` is the only genuinely missing piece. `zip` has `DialApp` and `Call`;
it does not have the one-shot, so every caller writes the same six lines. One
function, in zip, because "dial a peer by name and invoke one op" is a property
of the call plane and not of any deployment.

**(b) Identity and the tenant read — in zip, and the naive rule is WRONG.**

`zip.CallerOf(ctx).Org != ""` is NOT a sufficient tenancy check, and the host's
own code already knows why. `apps/principal.OrgOf` refuses on three conditions,
not one:

```go
func OrgOf(user, org string) (string, bool) {
    if strings.TrimSpace(user) == "" { return "", false } // no validated principal
    org = strings.TrimSpace(org)
    if org == "" || len(org) > MaxOrgLen { return "", false }
    return strings.Clone(org), true
}
```

`X-Org-Id` on its own is a client-settable header. Without the validated `user`
claim beside it, "the org is non-empty" is a statement the caller made about
itself. And an unbounded org is retained past the request as a store key and a
ledger key, so a length bound is not hygiene.

So `zip` MUST carry that decision, once, as

```go
// Tenant is the tenant a call may act for, or ("", false).
func Tenant(ctx context.Context) (string, bool)
```

reading `CallerOf(ctx)` and applying exactly `OrgOf`'s rule. `apps/principal`'s
copy is deleted in the same change. A plugin MUST use `zip.Tenant` and MUST
refuse on `!ok`; a plugin MUST NOT re-derive the rule.

Where the principal COMES FROM is HIP-0134 and is not restated here: IAM
establishes it once, nothing re-derives it, and a call carries it as delegation
rather than assertion because the socket already bounds who may speak. Two
obligations follow for the parties this contract does cover:

- **The host** MUST delete every header in `zip`'s `identityHeaders` set from an
  inbound external request before proxying it to a child, and attach the
  principal IAM established. Deleting a forgery is not minting an identity, and
  a host that skips it hands a client's own `X-Org-Id` straight to a plugin.
- **The plugin** MUST NOT validate a token and MUST NOT re-derive a principal. It
  reads the one that arrived, checks it is PRESENT and well-formed with
  `zip.Tenant`, and then authorizes — its own rules, in its own process, on the
  decoded input, which is what HIP-0134 §3 keeps in the plugin and what process
  isolation actually buys. 116 JWKS clients would be 116 places to get an issuer
  wrong, and cloud's current per-child validator (`cloud.SanitizeIdentity`) is a
  host package no external repo can import.

Checking that a delegated principal is present and bounded is not a second
implementation of IAM. It is the precondition for using the value as a store key,
and skipping it is how an empty string becomes a tenant.

**(c) A store — at run time.**

The plugin chooses its own store library and pays for it. The *key* arrives at
run time: the plugin asks the KMS peer for its data-plane key over the plane
(`plane.KMSGet`), and the launch token it presents is an environment variable
the host stamped on that one child. Both the token's variable name and the
broker exchange are op-name constants in `hanzoai/plane`; no credential library
is imported. A plugin that cannot obtain a key MUST fail closed at its first
store open and MUST NOT write plaintext.

**(d) Config — nothing is missing.**

HIP-0119 §5 already names the shared environment (`PORT`, `OPS_PORT`,
`LOG_LEVEL`, `BRAND`, `DOMAIN`); `zip` names `ZIP_ADDR` and `ZIP_RUNTIME_DIR`. A
plugin reads its own variables with `os.Getenv` under a `<NAME>_` prefix and
MUST start with zero required flags. There is no config package to import and
none is to be written: a shared config struct is how ~100 host variables became
a dependency of every subsystem.

**(e) Telemetry — at run time, through a nil-safe seam that already exists.**

`middleware.Telemetry(sink O11ySink)` is the seam, and `Telemetry(nil)` is a
pass-through. A plugin MUST install it and MUST NOT link an OTLP SDK: the
collector lives in the o11y binary alone, and spans leave a plugin as ordinary
plane calls to o11y's op. This is the direction the OTLZ work is taking
fleet-wide; a plugin that links OTLP today adds 43 packages to its floor for a
capability the host already provides.

**(f) The host's own facilities — not available, by construction.**

A plugin does not serve the console, does not thread operator flags, does not
scope credentials for other processes, and does not own the ops listener when it
runs as a child (`zip.Addr("") != ""` means a host handed it a socket; the ops
port is the host's — HIP-0119 §1 applies to the *deployment's* listeners, and a
child's socket is not one). These are front-door concerns and stay in one
process.

### §2 The entry point

A plugin `main` does four things, in this order: construct, register, describe if
asked, serve. This is the generalisation of what works today —
`plugin/o11y/main.go` is the only existing main written against `zip` alone, and
the other 115 are `cloud.Serve` calls, which is exactly the import this contract
removes.

```go
// Command billing is the billing service. It builds as its own binary; a host
// composes it at run time.
package main

//go:generate go run github.com/zap-proto/zip/cmd/zipdoc

import (
	"fmt"
	"os"

	"github.com/zap-proto/zip"
	"github.com/zap-proto/zip/middleware"
)

const name = "billing"

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "%s: %v\n", name, err)
		os.Exit(1)
	}
}

func run() error {
	app := zip.New(zip.Config{AppName: name})
	app.Use(middleware.Recover(), middleware.RequestID(), middleware.Logger(app.Logger()))

	svc := newService()          // this plugin's own dependencies, built here
	svc.ops(app)                 // typed ops — the ONE registry (§4)
	svc.plane(planeApp(name))    // peer ops, on the second app (§1.3a)

	// Describe instead of serve. Before anything opens a store: a projection is
	// a function of the code, and a describe run must not touch a real store.
	if mode, dest, ok := zip.Described(); ok {
		return zip.Describe(app, mode, dest)
	}

	// zip.Addr: the socket a host handed us, or our own port run directly.
	// This is the whole plugin side of the transport contract.
	return app.Listen(zip.Addr(":9653"))
}
```

Requirements:

1. `zip.Config.AppName` MUST equal the plugin's name, and the name MUST be the
   binary's name, the socket's stem (`zip.SocketPath(name)`), the
   `Declaration.Name` (§3) and the `<org>-<app>` IAM app segment. One name, no
   mapping table.
2. The last line MUST be `app.Listen(zip.Addr(fallback))`. Reading `ZIP_ADDR`
   any other way, or binding a fixed port when a host handed one over, is the
   failure where every child but the first dies on "address already in use".
3. Peer ops MUST be registered on a SECOND `*zip.App` that listens only on
   `zip.SocketPath(name)`. A typed op rides every transport its app listens on,
   so an internal op registered on the edge-facing app is an internal op served
   on `:8000`. The separation is structural, not a check.
4. `main` MUST NOT read configuration, open a store, or dial a peer before the
   describe check.
5. `zip.Config.Eager` MUST be set true if and only if the plugin's work is not
   request-driven — it owns a listener, a consumer or a background loop. This is
   the one fact about a plugin that its router cannot show (§3.2).

`zip.Described()` and `zip.Describe(app, mode, dest)` replace the host's
`cloud.SpecRequested` / `cloud.WriteSpec` pair and are the only new API §2
requires. `mode` is `openapi` or `declare` (§3, §4). Both MUST write to a
**file**, never stdout: a plugin's own dependencies write to stdout at
construction — `zip.New` itself logs a line, GORM logs queries, sqlite-vec
prints a warning — and `> file` splices those into the front of the document.

### §3 The declaration — the manifest problem, inverted

#### §3.1 Why a host-authored row cannot survive another repo

`manifest.Apps` in `hanzoai/cloud` is a hand-authored table of
`{Name, Prefixes, Eager}` and it **is the router**: `cmd/cloud` mounts each row's
prefixes through `zip.Load` and the first match wins. A prefix nobody wrote down
is not a documentation gap; it is a 404 or a 405 on live traffic.

The proof is on the record. The `analytics` row listed the read endpoints and
omitted the four ingestion doors `apps/analytics/event.go` actually serves
(`/v1/event`, `/v1/insights/e`, `/v1/analytics`, `/v1/analytics/batch`). Every
product beacon in the fleet therefore fell past every prefix onto the row
holding the bare `/v1` remainder, which does not serve them, and answered 405 —
starting eighteen seconds after the ReplicaSet running the first image in which
`manifest.Apps` *was* the router. The row had been harmless for as long as each
app called its own `routes()`; the mega-build's death made it load-bearing, and a
list that had been documentation became a routing table overnight.

A cross-repo plugin makes that failure permanent rather than occasional. Cloud
cannot hand-maintain a prefix row for a repository it does not build: the row and
the routes are then edited by different people, in different repos, on different
schedules, with no compiler and no test between them.

So the direction MUST invert. **The plugin declares; the host discovers.**

#### §3.2 What the binary emits

The binary already describes itself — it emits its own OpenAPI subset from its
own live router. It can therefore describe its *routing* the same way, from the
same source. `zip` gains one type and one method:

```go
// Declaration is what a plugin tells a host: who it is, whether it must be
// running before the first request arrives, every route pattern its router
// holds, and every op name it answers on the call plane.
type Declaration struct {
	Name   string   `json:"name"`
	Eager  bool     `json:"eager,omitempty"`
	Routes []Route  `json:"routes"`
	Ops    []string `json:"ops,omitempty"`
}

// Route is one pattern in the ROUTER's own spelling — ":id", not "{id}".
type Route struct {
	Method  string `json:"method"`
	Pattern string `json:"pattern"`
}

// Declaration projects the live router. Nothing is inferred from the AST, from
// a golden, or from the OpenAPI document.
func (a *App) Declaration() Declaration
```

Rules:

1. `Routes` MUST come from the router (`a.Fiber().GetRoutes(true)`), sorted by
   `(pattern, method)`, deduplicated. It is therefore complete by construction:
   a route the plugin serves and does not publish is still declared, which is
   precisely the analytics-ingestion case.
2. `Routes` MUST exclude `/.well-known/*`. Those are zip's own control plane,
   per process; the host serves its own.
3. `Ops` MUST be every registered `OperationID`. The op token is the operation's
   one identity: the OpenAPI `operationId`, the MCP tool name, the CLI command
   and the plane op are the same string (§4).
4. `Eager` is `Config.Eager`. It is the only field not derived from the router.
5. There is no `Prefixes` field and no `Remainder` flag. A plugin that owns a
   version remainder declares the catch-all route it actually registered
   (`/v1/*`); the host's rule about remainders reads the routes, so the fact
   lives in one place.

This is implementable today with no change to zip beyond exporting it. Measured:

    $ ./demo-plugin declare
    {"name":"demo","routes":[
      {"method":"POST","pattern":"/v1/demo/quote"},
      {"method":"GET","pattern":"/v1/demo/quotes/:id"}]}

#### §3.3 How the declaration travels

A host mounts a plugin's routes **before** starting it — that is what makes lazy
composition possible — so the host MUST NOT have to execute the plugin to learn
its routes. The declaration therefore travels as a verified artifact beside the
binary:

- `hanzoai/ci` runs `<binary> declare <name>.plugin.json` in the same job that
  built the binary, and publishes it beside the binary with its own SHA-256 in
  `binaries.json`. The declaration is a function of the bits by construction:
  same job, same binary, no second source.
- A host that ships plugins in its image writes `<name>.plugin.json` next to
  `<name>` at image-build time, from the same rule.
- A host that installs a plugin from a release reads the declaration from the
  verified index and MUST refuse a plugin whose declaration digest does not
  verify, exactly as it refuses an unverified binary.

A host repository MAY commit the declarations it composed — cloud does, as it
commits `plugin/<app>/openapi.json` — but only because a gate CI actually runs
regenerates them from source and fails on any diff (§8.4). A committed artifact
that nothing forces back to source is a golden, and §3.5 exists because a golden
was consulted instead of a router.

Updating a plugin is then ONE commit in the host repo that moves
`{URL, Sum, declaration}` together, and the routing change is *visible in the
diff*: the six analytics doors appear or disappear as lines, reviewed, instead of
being absent from a table nobody diffed against reality.

#### §3.4 How the host validates a declaration it did not write

The host MUST reject a declaration that fails any of:

1. **Digest.** The declaration verifies against the digest in the index that also
   authorized the binary.
2. **Shape.** Every `Pattern` is absolute, contains no `..`, and begins with a
   literal segment. A pattern beginning with a parameter (`/:org/:repo`) matches
   every request of that arity in the fleet; in one binary its handler could
   inspect the Host and fall through, but a request proxied to a child never
   falls through.
3. **Namespace.** Every `Pattern` is under `/v1/` (HIP-0119 §2), or under a root
   the host reserves and lists by name (`/login/oauth`, `/.well-known/...`,
   `/healthz`). No `/api/`. No `/v2`.
4. **Remainder.** At most one plugin in the composition declares a
   version-remainder catch-all (`/v1/*`), and which plugin that is MUST be host
   configuration rather than a first-come-first-served race. A bare version root
   claims paths other plugins own *and paths that do not exist yet*.
5. **Name.** `Declaration.Name` equals the name the host installed it under, and
   is unique in the composition.
6. **Liveness agreement.** On a child's first start, the host reads the child's
   live declaration from `/.well-known/zip/plugin.json` and compares it to the
   one it routed. A mismatch means the mounted routes are not the served routes;
   the host MUST log it by name and MUST leave that plugin's prefixes answering
   503 rather than 404-ing them forever, and MUST keep serving every other
   plugin. That is the same degrade-not-abort policy a failed start already
   gets: being first in a list is not a claim on everyone else's availability.

#### §3.5 The gate: the ROUTER ORACLE over the union, at build time

`zip.Load` accepts a duplicate claim **silently** — measured: a second
`Load` of `/v1/x` by a different plugin returns `nil` and the first registration
keeps answering. So the conflict gate is the host's, and it MUST run at build
time.

There is exactly one gate, and it asks the ROUTER:

```go
// For every route every plugin declared, compose the fleet's real router
// through the real zip.Load, send a concrete request, and require the answer to
// be the plugin that declared it.
func TestEveryDeclaredRouteReachesItsPlugin(t *testing.T) { … }
```

- The transport is an oracle: a mounted plugin is whatever answers at its
  address, so an address that answers with its own NAME turns "where does this
  request go" into a value the test reads. Only the WIRE is replaced. `Load`,
  `Mount`, the patterns and the first-match are the fleet's own.
- Parameters are substituted with a value no route spells literally, so a
  substitution can never land on a sibling's static segment and report the wrong
  owner.
- The gate MUST refuse a vacuous run: `if probed == 0 { t.Fatal("this gate
  proved nothing") }`. Every way it could examine zero routes — an empty
  composition, declarations that decoded to nothing — is a defect elsewhere that
  would otherwise arrive as a green tick.
- Known defects are a LEDGER that may only SHRINK. A new entry fails; a stale
  entry fails just as loudly, because a fix nobody records is a fix nobody can
  see, and a ledger padded with fixed entries hides the next real one behind a
  number nobody trusts.
- The gate MUST NOT exempt a route because it appears in any document.
  `openapi/weave_test.go` looked for this exact defect and could not find it: it
  exempted any path already present in `openapi.yaml` — the artifact it was
  protecting — and reported survivors with `t.Logf`. So it printed nothing and
  passed while the fleet misrouted 58 published paths. **One side of a
  comparison has to be SOURCE.** Here both sides are: the declaration is
  projected from the plugin's router, and the destination is read from the
  composed router.

`zip.Load` SHOULD additionally return an error when a second plugin claims a
pattern already claimed. That catches exact duplicates at compose time with a
clear message; it cannot catch shadowing (a parameter sibling swallowing another
plugin's static path is sometimes legitimate and sometimes an outage), which is
why the oracle remains the gate. Two checks, two failures, not two ways to do
one thing.

**Order stops mattering.** Measured: with exact declared patterns, mounting a
parameter sibling (`/v1/demo/quotes/:id`, plugin A) before a deeper static
sibling (`/v1/demo/quotes/special`, plugin B) routes each to its owner, and so
does the reverse order — the router's specificity decides, not the mount
sequence. `manifest/order_test.go`'s frozen order exists because prefixes were
widened ancestors; with declarations it is deleted. Cross-repo composition cannot
depend on a total order that no single repo owns.

#### §3.6 What a declaration cannot express

A capability that must run as MIDDLEWARE on another plugin's router is not a
plugin. `apps/zen` inspects every `/v1` request, claims the ones whose model is a
zen SKU and calls `Next()` for the rest; it dispatches on a BODY field, so it can
enumerate no paths, and a proxied request never falls through to a next
candidate. Such a capability MUST be part of the binary whose router it filters,
or MUST become a route that binary forwards to. It MUST NOT be given a
declaration, and the `bareVersionExempt` set that currently carries it is deleted
with the prefix table.

### §4 The projections — one registry, four documents

A typed op is ONE registry entry:

```go
zip.Post(app, "/v1/billing/invoices", o.create, zip.WithOperationID("billing_invoice_create"))
```

and it MUST produce all four projections, from that one entry:

| Projection | Producer | Consumer |
|---|---|---|
| OpenAPI subset | `app.OpenAPISpec()` → `<binary> openapi <file>` | the woven fleet spec, every generated SDK |
| MCP tool | `app.MCPTools()` | agents |
| CLI command | `zip.CommandsFromSpec(spec)` | `hanzo <service> <command>` |
| Plane op | the `OperationID` | peers, via `zip.Ask` |

The `OperationID` is the same string in all four. An untyped route
(`app.Get(path, handler)`) is a route and NOTHING else: no schema, no tool, no
command, no op. Measured in `hanzoai/cloud`: 414 typed op registrations against
725 untyped route registrations, and 1,427 operations across 1,011 paths in the
woven spec — so the majority of the published surface is invisible to three of
the four projections. A plugin MUST register every op typed. `zip.Ctx` handlers
are permitted only where the response cannot be a value: a redirect, a stream, a
non-JSON body, a second legitimate success code.

#### §4.1 `//go:generate zipdoc` is not optional

Go drops doc comments at compile time. Reflection sees types and struct tags,
never comments. So a build-time AST pass is the ONLY way an op's prose reaches a
document, and a package without the directive can NEVER get prose into the spec,
however correct everything else is.

Every package registering a typed op MUST carry, verbatim:

```go
//go:generate go run github.com/zap-proto/zip/cmd/zipdoc
```

and MUST commit the resulting `zipdoc_gen.go` (a bare `go build` does not run
generate, so an untracked file is a binary whose document has no descriptions).
`make test` MUST run `zipdoc -check` so a lift that drifts from its source turns
CI red instead of shipping stale prose.

**The doc comment is a product surface, not a comment.** Measured on a two-op
plugin, before and after adding the directive:

    before:  MCP tool demo_quote  description ''      OpenAPI description None
    after:   MCP tool demo_quote  description 'quote prices one reference.'
             OpenAPI POST /v1/demo/quote description 'quote prices one reference.'

The same sentence reaches the published API document a customer reads and the
tool description an agent reads *when choosing whether to call it*. `Example:`
and `Response:` lines in the comment become the spec's examples, because a spec
nobody can try is most of an interactive document wasted.

Measured gap in `hanzoai/cloud`: six packages register typed ops and carry no
directive — `apps/admin/core`, `apps/commerce`, `apps/iam`, `apps/kms`,
`apps/platform`, `apps/treasury`. Two of them are plane surfaces. Their ops carry
`WithSummary("…")` strings sitting directly under a doc comment that says the
same thing: two places to change, one to forget. §8.5 turns that into a failure.

#### §4.2 Composition, never carving

A plugin's OpenAPI subset MUST be generated from the plugin's OWN live router.
It MUST NOT be sliced out of a fleet document by prefix — that makes the fleet
the source and the plugin a derivative, which is backwards, and is exactly how a
catch-all silently swallows a neighbour's routes. The fleet document is woven
upward from the subsets, refusing when two plugins claim one path+method or mean
different things by one schema name.

`plugin/ingress` lost eight paths from every published SDK in every language
because the only gate compared two DERIVED artifacts, which agreed with each
other while both were wrong.

### §5 Language runtimes — opt-in adaptors, in zip

Go is native and built in. Every other language is an ADAPTOR, each in its own
package inside the `zip` module, each owning its own dependencies. A plugin that
needs none pays for none.

| Package | Engine | Sandbox | Status |
|---|---|---|---|
| `zip/js` | goja + esbuild | soft | exists as `zip/runtime`; RENAME |
| `zip/wasm` | wazero | hard | MOVE from `hanzoai/base/plugins/wasmvm` |
| `zip/py` | CPython sub-interpreters | none — single tenant only | MOVE from `base/plugins/pyvm` |
| `zip/star` | starlark | hard, deterministic, no I/O | MOVE from `base/plugins` |
| `zip/v8` | v8go (cgo) | soft | add only when a consumer asks |

The seam is already right and MUST NOT be duplicated: `zip.Loader` and
`zip.Module` are interfaces declared in root `zip`, which imports no
implementation. A plugin declares the runtime it needs by **importing that
adaptor and passing its loader**:

```go
import "github.com/zap-proto/zip/js"

app := zip.New(zip.Config{AppName: "webhooks", Loader: js.Loader()})
app.Module("POST /v1/webhooks/transform", "goja", "./ext/transform")
```

The import IS the declaration. There is no runtime flag, no manifest field and no
build tag, and Go's module graph pruning makes it free: measured, `zip`'s
`go.mod` still requires goja and esbuild for `zip/js`, and a plugin that does not
import `zip/js` builds 258 packages with zero goja packages in its graph. One
repo, N opt-in packages, each cost borne only by the binary that asks.

`hanzoai/base` MUST reuse these adaptors and delete
`base/plugins/{extruntime,gojavm,wasmvm,v8vm}`. Base is an application; mounting
a foreign-language handler is a framework concern, and today a plugin that wants
one route in JavaScript must depend on a whole application framework to get it.
`app.Module` stays the ONE mount verb — there is no `ModuleWasm`, `ModuleGoja` or
`ModulePython`, on purpose.

A module route registers a route and no op, so it is in no document, is no MCP
tool and is reachable by no peer. That hole closes when an extension DECLARES its
contract in its manifest and `zip.Module` surfaces the schema; until then a route
whose contract IS known belongs in a typed op with the module as an
implementation detail behind it.

### §6 Identity and tenancy — non-negotiable

1. A plugin MUST NOT read a tenant from caller-supplied input. There MUST be no
   `Org` field in any `In` type, on any op, on any transport. An org in the
   argument is an org the caller chose, and a caller that can name the org can
   bill or read another tenant.
2. The tenant rides the CALLER: forwarded from the gateway's assertion with
   `zip.Ctx.Forward` (a typed handler's ctx already carries it), or stated once
   and explicitly by a background job with `zip.WithCaller`. An inbound request
   always wins over a stated caller, so a background job can supply an identity
   where there is none and can never launder one.
3. The callee reads `zip.Tenant(ctx)` and MUST refuse `!ok` — which is stricter
   than "refuse empty" for the reason in §1.3(b): a non-empty `X-Org-Id` with no
   validated user claim beside it is a client's own assertion. Establishing the
   principal is IAM's (HIP-0134); checking that one arrived and is bounded before
   using it as a key is the callee's.
4. `Caller.Admin`, `Caller.OrgAdmin` and `Caller.Owner` are three distinct
   authorities and reading one for another is a privilege escalation. `OrgAdmin`
   says a person administers THEIR OWN org; `Owner` says which org that is; a
   deployment reserving one org for platform operators gates cross-tenant
   surfaces on `Owner` alone.
5. An org is used VERBATIM — trimmed, never lower-cased, never truncated.
   Folding collapses distinct owners ("acme", "ACME", a 32-char prefix) into one
   bucket, which is itself a cross-tenant break.
6. Money is an exact decimal with its currency beside it (`plane.Money`), never a
   count of minor units. HUSD carries 18 decimals, so "cents" is not the smallest
   unit; a per-token charge is routinely finer than one. A malformed amount is an
   ERROR, never a zero — a gate that read an unparseable charge as "nothing to
   authorize" would let the work through free.
7. The wire is ZAP. `json` tags are the DOCUMENT's vocabulary only. A field IS
   its offset, so compatibility is STRUCTURAL: **append fields at the end, and
   only at the end.** Reordering, inserting or retyping one changes what every
   existing peer reads.
8. A peer socket is `0600` and SO_PEERCRED-authenticated, so a caller on it is
   one of our own processes; `zip.PeerOf(ctx)` is available as a coarse
   infrastructure gate under the per-user authorization. That is not a trust
   boundary between our own plugins, and a check that pretends otherwise should
   say what it is.

### §7 CI and release

A plugin repo carries exactly two CI files and no build logic of its own.

`hanzo.yml` at the root:

```yaml
binaries:
  - name: billing
    main: .
    platforms: [linux/amd64, linux/arm64]
test:
  - name: go-test
    run: |
      set -e
      export GOPRIVATE='github.com/hanzoai/*' GOWORK=off
      make test
```

`.github/workflows/cicd.yml`, unchanged from repo to repo:

```yaml
name: CI/CD
on:
  push: { branches: [main], tags: ["v*"] }
  pull_request:
  workflow_dispatch:
jobs:
  cicd:
    uses: hanzoai/ci/.github/workflows/build.yml@v1
    secrets: inherit
```

- Images push to **`registry.hanzo.ai`**, org-namespaced `<host>/<org>/<app>`.
  Registries never mix. `ghcr.io/<org>` remains only for already-published OSS
  deps external users pull.
- The only GitHub secrets are `KMS_CLIENT_ID` / `KMS_CLIENT_SECRET` plus the
  `KMS_WORKSPACE` variable. Registry, IAM and cluster credentials come from KMS
  at run time.
- Binaries build on every push (an arm64 cross-compile that breaks fails the PR
  that broke it) and publish on a tag, after the `test:` gate. `binaries.json`
  ships beside them with `{name, os, arch, url, sha256}` for every artifact, plus
  each artifact's `<name>.plugin.json` declaration (§3.3).
- Builds are `CGO_ENABLED=0 -trimpath`: the digest must be a function of the
  source, not of the checkout path.

#### §7.1 A tag is a RECEIPT

In `hanzoai/cloud` a `v*` tag is minted only AFTER build + smoke + image push
succeed: `main push → compute version → build → smoke → push image → tag →
notify`. Any failure fails BEFORE the tag and leaves no receipt. The inverted,
tag-triggers-build order left phantom tags with no image behind them, which is
`ImagePullBackOff` on a version that never existed. **Hand-tagging forges a
receipt for an image that was never built.**

The equivalent rule for a plugin repo:

> **A `v*` tag on a plugin repo asserts: this commit's `test:` gate passed, its
> binaries built for every declared platform, its declaration was projected from
> those exact binaries, and all of it was published with digests. A tag MUST be
> minted by the pipeline that proved those things, never by a person and never
> before them.**

Concretely: the release job publishes artifacts + `binaries.json` +
declarations, and only then creates the tag. A host installs unattended by
digest, so a tag that does not correspond to published, verified bits is a
supply-chain lie — and it is a worse lie for a plugin than for an image, because
the host will *execute* the bits the tag pointed at.

Patch bumps only, from the actual latest tag +1, and never above `v1.x.x`.

### §8 The gates a conforming repo MUST run

Each gate names the failure it catches. All of them run from `make test`, and
`hanzo.yml`'s `test:` block MUST invoke `make test` — not a bare `go test`.

**§8.1 `plugin-is-a-leaf`.** `go list -deps ./... | grep -E
'^github.com/hanzoai/(cloud|base)($|/)'` MUST be empty.
*Catches:* one stray import of a host package dragging 316 packages back into
the plugin, whose only symptom is a slow build. A grep over source is NOT this
gate: the dangerous break is the one that still compiles, so the check is over
the import graph a build actually produces.

**§8.2 `builds-and-mounts-alone`.** The binary links and, run with no host,
mounts its whole surface and reaches `listening`.
*Catches:* a plugin that only works because something else in a fused binary
initialised it first.

**§8.3 `declaration-current`.** Regenerate `<name>.plugin.json` from the built
binary; fail on any diff. Additionally assert `openapi ⊆ declaration`: every path
in the OpenAPI subset MUST appear in the declaration.
*Catches:* the analytics-ingestion outage class — a published path the host will
not route. The subset relation is one-way: a served-but-unpublished route (a
webhook door) MUST still be declared, or it 405s.

**§8.4 `openapi-current`.** Regenerate the OpenAPI subset from the binary and
fail on any porcelain change.
*Catches:* routes moving without the document moving — eight `plugin/ingress`
paths silently absent from every generated SDK.

**§8.5 `zipdoc-current`.** For every directory carrying the directive, run
`zipdoc -check`. Additionally: every directory that registers a typed op MUST
carry the directive.
*Catches:* prose that can never reach the spec (six packages in cloud today,
§4.1), and prose that has drifted from the comment it was lifted from.

**§8.6 `router-oracle`** (host-side, §3.5). Every declared route reaches its
declaring plugin.
*Catches:* two plugins claiming one path — at build time, not at first request,
because `zip.Load` accepts the duplicate silently.

**§8.7 `tenancy`.** No `In` type on any op has an `Org`/`Tenant`/`OrgID` field;
every op that touches per-tenant state refuses when `zip.Tenant` returns
`!ok`.
*Catches:* cross-tenant read or bill via a caller-chosen org.

**§8.8 `the-suite-is-not-empty`.** `go test ./... -json` MUST report a NON-ZERO
number of executed tests, and every package MUST contribute at least one.
*Catches:* a build tag excluding an entire suite while the command exits 0.
`hanzoai/gateway` reported `build constraints exclude all Go files` on every
tree, healthy or broken, for years — every file under `tests/` sat behind
`//go:build legacy`, so the suite had NEVER executed and hid 12 real failures. A
repo whose files carry build tags MUST run `./...` once per tag set (`make test`
in gateway now runs a tagged and an untagged pass) and MUST assert both passes
executed tests.

**§8.9 `ci-invokes-the-gate`.** A test MUST assert that `hanzo.yml`'s `test:`
block invokes `make test`.
*Catches:* the failure that makes every gate above worthless. `hanzoai/cloud`'s
CI never called `make test` at all, so gates added to the Makefile protected
nobody; `hanzoai/gateway` had no workflow, so its `make test` was a gate in no
pipeline. A gate that CI does not invoke is a comment.

Two properties every gate MUST hold, from §3.5 and repeated because they are the
two ways a green tick lies:

- **Non-vacuity.** A gate that examined nothing MUST fail, and MUST say how much
  it examined. Every route to zero examinations is a defect elsewhere that would
  otherwise arrive as a pass.
- **A source on one side.** Never compare two derived artifacts. `weave_test.go`
  compared a document to the document it protected, agreed with itself, and
  passed through 58 misroutes.

### Conformance checklist

Build a conforming plugin repo in one pass:

1. `go.mod` requires `github.com/zap-proto/zip >= v1.18.7`, plus
   `hanzoai/plane` if it calls a peer and `hanzoai/money` if it handles money.
   Nothing from `hanzoai/cloud`. §8.1 proves it.
2. One `main` per §2: construct, register typed ops, register peer ops on the
   second app, `zip.Described()` check, `app.Listen(zip.Addr(fallback))`.
3. `//go:generate go run github.com/zap-proto/zip/cmd/zipdoc` in every package
   registering a typed op; `zipdoc_gen.go` committed.
4. Every op typed, with an explicit `WithOperationID`; untyped handlers only
   where the response cannot be a value.
5. `<binary> openapi <file>` and `<binary> declare <file>` both work and both
   write files. Both artifacts committed and regenerated by `make test`.
6. No `Org` field in any `In`; `zip.Tenant(ctx)` with refusal on `!ok`.
7. HIP-0119 in full: app listener `:8000`/`PORT`, `/v1/` only, ops listener
   `:9090`/`OPS_PORT` with `/healthz` + `/readyz` + `/metrics`, zero required
   flags, secrets from KMS, nothing from HIP-0119 §9.
8. Root `hanzo.yml` with `binaries:` and a `test:` block that runs `make test`;
   a seven-line `.github/workflows/cicd.yml` importing `hanzoai/ci`.
9. Every gate in §8, all reachable from `make test`, and §8.9 proving CI calls
   it.
10. Tags minted by the pipeline after publish (§7.1). Patch bumps only.

### Migration

Ordered so that no step depends on a later one. Each step deletes the thing it
replaces in the same change; there is no interval in which both exist.

1. **`zip`**: add `Ask`, `Tenant`, `Delegate`, `Declaration`/`Route`/
   `(*App).Declaration`, `Described`/`Describe`, the
   `/.well-known/zip/plugin.json` route, and the duplicate-claim error in
   `Load`. Rename `zip/runtime` → `zip/js`. Patch release.
2. **`hanzoai/plane`**: extract `cloud/plane` to its own module, verbatim.
   Cloud imports the module and deletes the directory.
3. **`hanzoai/cloud`**: delete `Plane`, `ServePlane`, `Peer`, `Ask`, `For`,
   `Who`, `As`, `bindRuntimeDir`, `SpecRequested`, `WriteSpec`,
   `principal.OrgOf`/`WithOrg`/`OrgFrom` in favour of the zip survivors.
4. **`hanzoai/cloud`**: emit `plugin/<app>/plugin.json` from the per-app
   `openapi` target; land §8.3 and §8.6 against the declarations; delete
   `manifest.App.Prefixes`, `manifest/order_test.go`,
   `manifest/bare_version_test.go`'s exemption set, and the prefix walk in
   `plugin/gen-app-cmds`. `manifest.Apps` keeps `{Name}` and the binary-resolution
   ladder — it is the INSTALL list, not the router.
5. **`hanzoai/cloud`**: reduce `SanitizeIdentity` to the strip-and-delegate the
   host owes per HIP-0134 (it currently also mints); each
   `plugin/<app>/main.go` becomes the §2 shape and stops importing `cloud`,
   one app at a time, each landing under §8.1.
6. **`zip` + `hanzoai/base`**: move `wasmvm`/`pyvm`/`starlark` into
   `zip/{wasm,py,star}`; Base imports them and deletes
   `base/plugins/{extruntime,gojavm,wasmvm,v8vm}`.
7. **`hanzoai/ci`**: publish `<name>.plugin.json` beside each binary, with its
   digest in `binaries.json`.

Every step is independently measurable with `go list -deps | wc -l`. Step 5 is
where the 576 → ~260 drop lands, per app.

## The API surface a composition serves

These sections describe the API a composition presents to callers — the
credential, the meter and the OpenAI-compatible door — not the plugin
contract above. They are filed here because the HIPs that owned them were
merged into this document; they constrain what a plugin serving those
surfaces must do, and they are unchanged by the composition model.

### API keys

The credential for programmatic access is an API key. IAM mints and
verifies it, `gateway` resolves it to a principal at the edge, and no
subsystem downstream reads it again. There are two types, and the
prefix is what every consumer switches on:

| Type | Prefix | Where it belongs |
|---|---|---|
| publishable | `pk-` | browser and client code; identifies an org, authorizes nothing that spends |
| secret | `sk-` | server side only; carries the caller's full scope |

`hk-` is the older name for a secret key. Verification still accepts
one; nothing has minted one since `iam` v1.33.9.

```
GET    /v1/keys    # the caller's keys: { type, prefix, createdAt }
POST   /v1/keys    # mint or rotate the key of { type }
DELETE /v1/keys    # revoke the key of that type
```

**The secret is returned exactly once, at mint.** Every later read
returns type, prefix and creation time. What is stored is a hash of
the key, never the key — a plaintext credential at rest is a defect,
not a configuration choice. The subject a key is minted for is derived
from the validated identity headers and never from the request body,
so a caller can mint and revoke only their own.

A key carries a scope, and the scope is enforced at the gateway edge
before any subsystem sees the request:

| Field | Meaning |
|---|---|
| `models` | which models the key may address; `*` for all |
| `services` | which subsystems it may invoke — `llm`, `agents`, `mcp`, `embeddings`, `images`, `audio` |
| `rateLimit` | requests per minute; default 60 |
| `spendLimit` | ceiling in USD cents per billing period; unset means the org balance is the only ceiling |
| `allowedIPs` | CIDR allowlist; unset means any address |
| `expiresAt` | expiry; unset means the key lives until revoked |

### Credit metering

Spend is prepaid. An org buys credits and every priced request draws
the balance down, so spend cannot exceed what was bought and there is
no surprise bill. One credit is one US cent — the arithmetic and the
display are the same unit. One balance covers every subsystem:
inference, agent runs, MCP tool calls, storage.

`commerce` owns the balance. The metering client is the one place this
binary asks about money, and it wraps every priced request in two
calls:

1. **Authorize**, before the handler runs. Sufficient balance passes.
   Insufficient balance is `402 insufficient_balance` and the handler
   never runs. An unreachable `commerce` is `503 balance_unavailable`.
2. **Record**, after the handler returns, with the units the request
   actually consumed.

**Fail-closed is the default**: when `commerce` cannot be reached the
request is denied rather than served unpriced. Fail-open is a
deliberate per-deployment choice, never the consequence of an outage.
Free routes declare a price of zero and skip both calls.

A usage event says who spent, what served it, what it consumed and how
it went. It carries no prompt content and no PII.

```go
type UsageEvent struct {
    ID        string
    Timestamp time.Time

    // Who spent
    OrgID     string
    ProjectID string
    UserID    string
    KeyID     string

    // What served it
    Service  ServiceScope
    Model    string
    Provider string // the upstream that actually answered

    // What it consumed
    PromptTokens     int
    CompletionTokens int
    TotalTokens      int
    Cost             int64 // USD cents

    // How it went
    LatencyMs int64
    TTFTMs    int64 // time to first token, streaming
    Status    UsageStatus

    // Agent runs attribute each tool call separately
    AgentID    string
    AgentRunID string
    ToolCalls  []ToolCall

    Metadata map[string]string
}

type ToolCall struct {
    Name       string // tool
    Provider   string // MCP server that served it
    DurationMs int64
    Status     UsageStatus
}
```

Events are written to the calling tenant's own store, so a usage read
is org-scoped by construction rather than by a `WHERE` clause, and
`commerce` aggregates them for invoicing and reseller revenue share.

```
GET /v1/usage/summary       # current billing period
GET /v1/usage/timeseries    # hourly, daily or monthly buckets
GET /v1/usage/by-model
GET /v1/usage/by-user
GET /v1/usage/by-key
GET /v1/usage/events        # paginated raw events
```

All six accept `start`, `end`, `granularity` and `filter`. An alert is
the same data read against a threshold — spend, request count or error
count, over a daily, weekly or monthly period — delivered to a
webhook, an email address or a Slack hook when it is crossed.

### OpenAI-compatible surface

The inference surface is OpenAI's, so an existing application moves by
changing two strings:

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-...",
    base_url="https://api.hanzo.ai/v1",
)

response = client.chat.completions.create(
    model="zen-8b-instruct",
    messages=[{"role": "user", "content": "Hello"}],
)
```

```
POST /v1/chat/completions      # streaming and non-streaming
POST /v1/completions           # legacy
POST /v1/embeddings
POST /v1/images/generations
POST /v1/audio/transcriptions
POST /v1/audio/translations
GET  /v1/models
```

The `ai` subsystem holds the model catalog and the routing policy;
`gateway` speaks the OpenAI shape at the edge and absorbs
provider-specific differences. Both are subsystems of this binary, so
a request arriving at `/v1/chat/completions` is authenticated,
authorized against the balance, routed, served and recorded without
leaving the process.

### Deployment surfaces this enables

| Deployment | Brand | Enabled subsystems | Domain |
|---|---|---|---|
| Hanzo flagship | hanzo | all | api.hanzo.ai |
| Osage Cloud | osage | iam, base, kms, commerce, ai, gateway, o11y, vfs | api.osage.cloud |
| Lux Cloud | lux | iam, base, kms, gateway, chain | api.lux.cloud |
| Zoo Cloud | zoo | iam, base, kms, ai, gateway, vfs | api.zoo.cloud |
| Customer X (reseller) | custom | iam, base, kms, commerce, gateway | api.x.com |

Same image. Different startup configuration. The `osage.cloud`
marketing site that shipped 2026-05-19 gets a real backend when this
HIP lands.


## Commerce — light router, NOT in PCI-DSS scope

**Commerce is a thin orchestrator.** It owns the customer-facing checkout
flow, tenant config, billing logic, pricing logic, invoicing, and
webhook intake. It explicitly does NOT:

- Touch a Primary Account Number (PAN)
- Process card data
- Implement processor connector logic (native PSP SDK /
  Adyen SDK)
- Store encrypted PAN

Commerce only handles **tokens** (vault tokens) and **intents**
(payments-orchestrator references). When commerce needs to charge, it
calls `payments` (Rust) via ZAP RPC with a token + amount + processor
hint. Payments calls `vault` (Go) via ZAP RPC with a "Charge this token"
request; vault pulls the PAN from its encrypted store, makes the
outbound HTTPS to the processor, and returns the response. **PAN never
leaves vault.**

This makes commerce **CDE-connected**, not **CDE**. Lighter controls
apply (network segmentation, access control, change management) but
commerce is NOT subject to PCI-DSS L1 audit.

## Solo-vault CDE

**Vault is the only system in PCI-CDE.** Per the corrected scope:

| System | PCI scope |
|---|---|
| `vault` | **CDE** — the only system that touches PAN. Full L1 audit. Quarterly ASV. HSM-backed key store. Own deployment, own k8s namespace, own NetworkPolicy boundary. |
| `payments` | **CDE-connected** (NOT CDE). Sees only tokens. Payments service operated in tokens-only mode. Calls `vault.Charge(token, processor, amount)` for the actual processor call. |
| `commerce` | **CDE-connected** (NOT CDE). Light router. Only ever handles tokens + intent IDs. Mounts inside cloud like any other subsystem. |
| Everything else in cloud | **Not CDE-connected.** Standard SOC2-grade controls. |

For this architecture to be sound, two requirements must hold:

1. **Browser-side card collection runs directly against vault** (vault
   ships a `vault-collect.js` iframe; PAN posts directly to vault from
   the browser, never via commerce or any Hanzo app server).
2. **Payments runs in tokens-only mode** — verified by
   audit of payments data flow that no code path exposes raw PAN to
   the surrounding Go process.

Both are tracked under the implementation TODO list at
`~/work/hanzo/vault/docs/` (to be created).

## PSP optionality

The same architecture supports four deployment modes:

1. **Default (Hanzo as merchant)**: Hanzo operates vault + payments +
   commerce. Hanzo bears the PCI-DSS L1 audit. PCI scope = vault only.

2. **Hanzo as PSP for a white-label customer**: customer's brand
   (`lux.cloud`, `zoo.cloud`, `osage.cloud`) runs commerce inside their
   cloud deployment; commerce's `payments_client` and `vault_client`
   ZAP endpoints point at Hanzo's payments + vault. Customer carries no
   PCI obligation. Hanzo's vault has multi-tenant token namespacing per
   org.

3. **Customer brings their own PSP backend**: customer deploys their own
   vault + payments. Their cloud's commerce subsystem points its
   ZAP-RPC endpoints at THEIR vault + payments deployment. **Hanzo
   carries no PCI obligation for that customer's flows.** The customer
   holds their own PCI scope. Commerce is a swappable thin router.

4. **Single-tenant Hanzo Payments-as-a-product**: customer's ENTIRE
   commercial unit is payment-processing. Deploy payments + vault + a
   trimmed cloud as a unit. Commerce still operates as light router
   — no design change, only deployment shape.

Modes 1-3 share the same binary. Configuration determines which
endpoints commerce talks to. The "swappable thin router" property is
load-bearing: commerce never grows code that depends on a specific
vault or payments operator.

## Non-goals

- **TS service rewrite as part of this HIP.** Platform (Next.js /
  Dokploy fork), brain (where still TS), bot, billing, pricing
  (separate Go rewrites slated under commerce subsumption). They can
  be ported to Go later if performance or operations require it; this
  HIP does not block on them.
- **`vault` and `payments` are explicitly NOT folded.** Both stay as
  their own deployments with their own PCI scope boundaries per the
  "Solo-vault CDE" section above. Vault is CDE. Payments is
  CDE-connected. Commerce talks to both via ZAP RPC. **Hard rule, no
  exceptions** — even single-tenant deployments use the three-process
  architecture.
- **`~/work/hanzo/flow` (Hanzo Flow — visual ML pipeline / agent-building) is NOT folded.** Visual ML
  pipeline / agent-building tool. Heavy native deps (torch, faiss,
  sentence-transformers). Runs as a separate process behind the
  gateway subsystem. Per the FT audit (2026-05-19), classified RED
  — defer to GIL-Python until torch ships cp313t (>=2.6).
- **`~/work/hanzo/datastore` (ClickHouse fork) is NOT folded.** OLAP
  column store. Uses ClickHouse-native ReplicatedMergeTree + S3 disk.
  Out of scope. Shares S3 bucket with HIP-0107 streaming via vfs
  prefix (`s3://bucket/datastore/...` vs `s3://bucket/replicate/...`).
- **`~/work/hanzo/insights` (Hanzo Insights — AI observability + eval + prompt management) is NOT
  folded.** Runs as a separate process — the canonical AI console
  for cloud-hosted LLM operations. Integrates with cloud via
  HTTP + (forthcoming) ZAP-typed endpoints; consumed by the `cloud`
  subsystem (LLM control plane) and surfaced to operators as part of
  the AI console.
- **Other Python services flagged RED by the 2026-05-19 free-threading
  audit** (`cli`, `erp`, `insights`, `sentry`, `studio`) — all stay
  separate processes until their upstream FT-blockers clear
  (xmlsec, confluent-kafka, chdb, single-threaded Django/Celery
  assumptions, torch <2.6). Run under regular `python3.13`
  (GIL-enabled) until then.
- **Cross-deployment service mesh.** The unified binary collapses
  in-deployment service calls; cross-deployment (Hanzo ↔ Lux ↔ Zoo)
  stays on the existing service-discovery + bridge layer.
- **Auto-scaling per-subsystem.** All subsystems in one binary scale
  together. If a subsystem becomes a hot bottleneck, fall back to
  running it as its own binary alongside the unified one — the Mount
  contract supports both.


## Open questions

1. **Cold start of a lazy composition.** An eager host pays 116 processes at
   boot; a lazy one pays the first request. The cost of the first request to a
   cold plugin is unmeasured per plugin, and `CLOUD_PLUGIN_START` (90s default,
   raised from zip's 10s because a plugin that opens stores and runs migrations
   on a cold volume misses it) is a blunt instrument. Needs a per-plugin
   measurement before a latency-critical prefix is left lazy.

2. **Finer plugins make the build WORSE until the floor drops.** Each plugin
   binary is ~40 MB of which ~35 MB is the core every other plugin also links.
   Splitting one capability into two plugins duplicates that core again. The
   sequencing rule is therefore: drop the floor first (§1.3), split second.

3. **Extension schemas.** A `Module` route registers a route and no op, so it is
   in no document, is no MCP tool and is reachable by no peer (§5). Closing it
   requires an extension that DECLARES its contract in its `extension.json`, and
   `zip.Module` surfacing that schema so the projections follow. Until an
   extension declares one there is nothing to project.

4. **Remote ZAP.** The call plane is unix sockets today. A plugin composed
   across hosts needs ZAP over TCP with session crypto and a non-Go client;
   both are open work in `zap-proto`. `CLOUD_<NAME>_ADDR` works over a trusted
   network in the meantime, which is a deployment constraint, not a contract.

5. **Third-party plugins.** Every rule here is enforced by a gate the host runs
   over an artifact the host verified, which is sufficient for first-party
   repos. An untrusted plugin additionally needs a resource bound and a
   capability restriction on the child process; neither is specified here.

## References

- HIP-0119 — Hanzo Service Conventions — **the service shape a plugin conforms
  to in full; this HIP adds only what HIP-0119 does not cover**
- HIP-0116 — Plugin & VM Model — **SUPERSEDED by this HIP.** Its surviving
  truths are absorbed here: no build tags (a capability is a plugin, compiled
  once, loaded when asked); a plugin is a supervised child with crash isolation
  and per-prefix 503 degradation; ZAP is only a transport, and reachability
  confers no authority. Its lpm distribution, its `.zap`/`zapc` plugin IDL and
  its "embedded subsystem" shape did not ship and are replaced by §3 (the
  declaration), §7 (`hanzoai/ci` + `binaries.json` + digest-verified install)
  and §1.3(a) (`hanzoai/plane`, a Go leaf of op names and types)
- HIP-0105 — In-Process Extension Runtime — the engines §5 makes opt-in
- HIP-0134 — One Process, One Socket, One Identity — **where the principal comes
  from, and the rule that nothing re-derives it.** §1.3(b) and §6 cite it and
  add only the plugin's own read; they do not restate it
- HIP-0026 / HIP-0111 — IAM: the authority §1.3(b) forbids a plugin from
  duplicating
- HIP-0027 — KMS: where §1.3(c)'s key comes from
- HIP-0132 — One Telemetry Plane: what §1.3(e)'s sink reports to
- HIP-0036 — CI/CD: the `hanzo.yml` + `hanzoai/ci` lanes §7 uses
- HIP-0114 — ZAP: envelope, framing and authentication of the call plane
- HIP-0122 — zip: the application server core every shape mounts on
- HIP-0130 / HIP-0135 — the OSS/private line, and what is public: consumers of
  this contract, not restatements of it
- HIP-0117 — Cloud-in-a-Box: the deployment topologies a composition serves
- HIP-0302 / HIP-0107 — per-tenant encrypted storage and its replication
- HIP-0400 — Service CRD: how a composition is deployed
- `hanzoai/cloud` `LLM.md` — the reference host's own tree: `manifest/`,
  `plugin/<app>/`, `mk/plugin.mk`, `openapi/weave.go`. It states how cloud
  implements this contract and MUST NOT restate the contract itself
- `github.com/zap-proto/zip` `LLM.md` — the framework's own surface
