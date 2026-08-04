---
hip: 0128
title: Resource Surface Standard — Generated REST over ZAP
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-07-27
requires: HIP-0106, HIP-0127
---


# HIP-0128: Resource Surface Standard — Generated REST over ZAP

## Abstract

Every Hanzo service exposes the same shape, because there is one shape. A caller
who has learned one service has learned all of them, an SDK generator sees one
grammar, and a reviewer can tell a correct route from an incorrect one without
reading the handler.

This document is that grammar, the generator that emits it, and the failure
modes that produced it. It exists because the grammar was rediscovered three
times — in `ai`, in `iam`, and in `cloud` — and each rediscovery cost a
different security hole.

## Motivation

A hand-registered route surface drifts in the direction that hurts. The
published spec is what every customer, SDK and docs page believes, so it goes
stale silently while the routes move underneath it. Two live proofs:

- `ai` shipped a `swagger.json` describing `/api/<verb>-<noun>` — a base path
  the service has never served. Nothing failed when that became untrue.
- `iam` published 201 OpenAPI paths of which **66 were served and 135 were
  not**, including `/v1/iam/applications/{id}` — a spelling that could not
  work, because a composite key URL-encoded into one segment is decoded back to
  a separator before routing and matches nothing. 221 generated CLI operations
  compiled from that fiction.

The correction is not "write the spec more carefully." It is to make the spec a
*derivation* of the thing that serves traffic, so the two cannot disagree.

## Specification

### 1. Route grammar

```
/v1/<service>/<resource>                      collection
/v1/<service>/<resource>/{owner}/{name}       member
/v1/<service>/<resource>/<action>             collection action
/v1/<service>/<resource>/{owner}/{name}/<action>   member action
```

- `<service>` is the owning subsystem: `iam`, `ai`, `commerce`, `kms`.
- `<resource>` is a **plural noun**. Never a verb. Never singular.
- Methods carry the verb: `GET` list, `POST` create, `GET` read,
  `PATCH`/`PUT` update, `DELETE` delete. Actions are `POST`.
- There is no `v2`, ever. A breaking change ships as a new resource.
- There is no `/api/` path segment. The hostname is `api.hanzo.ai`; the path
  starts at `/v1/`. `/api/`, `/iam/api/` and `/org/iam/` are all violations.

MUST NOT: `/v1/iam/get-users`, `/v1/iam/user`, `/v1/iam/users/get`,
`/api/get-users`.
MUST: `GET /v1/iam/users`, `GET /v1/iam/users/{owner}/{name}`.

### 2. Identity is two path segments

An object's identity is the pair `(owner, name)`. It MUST appear as two
segments.

It is not a stylistic choice. Go decodes `%2F` back to `/` before routing, so a
composite key packed into a single `{id}` segment matches no route. Any spec
declaring `/{id}` for an `(owner, name)` resource describes an endpoint that
cannot be called.

A resource whose key is a triple has no compliant spelling in this grammar yet
and MUST NOT be forced into one by widening a security-relevant path rule to
absorb it. Leave it non-compliant, name it in the service's `LLM.md`, and
extend this HIP first. (`iam`'s `sessions`, keyed by
`(owner, name, application)`, is the standing example.)

### 3. Declare once, generate everything

A service declares its resources in ONE table. Routes and the OpenAPI document
are both derived from it. Neither is hand-written.

```go
// routers/resources.go — the ONE table
var resources = []resource{
    {ns: "ai", path: "stores", one: "Store", many: "Stores"},
    {ns: "ai", path: "chats",  one: "Chat",  many: "Chats",
     actions: []action{{name: "messages", verb: "GET"}}},
}

func registerResources(app *App) { /* the only registration path */ }
func OpenAPIPaths() map[string]any { /* the only spec accessor */ }
```

Adding a resource to the table publishes it. There is nothing else to remember,
and no second place to forget.

### 4. Generation runs on ZAP, natively

`zap-proto/zip` is the substrate. Two capabilities make the grammar expressible;
both are required, both landed in `zip v1.10.2`/`v1.10.3`:

- **`bindPath`** (`typed.go:86`) binds URL path params onto the decoded typed
  input, applied *after* the body so **the URL wins**. Before this, zip's typed
  ops decoded only the JSON body — a route physically could not carry its target
  in the URL, which is why services degraded into `POST /<resource>/get` with the
  key in the body. The dialect was a framework limitation, not a design choice.
  Fixing it in zip fixed it for every service at once.

  `bindPath` walks only the top level. A nested field is not a path target: the
  URL addresses one resource, and an input that nests its record declares its
  target explicitly rather than having it guessed out of a sub-struct the caller
  also controls.

- **`App.OpenAPISpec()`** (`openapi.go:310`) renders the served surface, so the
  contract is emitted by the router rather than transcribed beside it.

A service MUST NOT hand-roll a second router, a second spec builder, or a
second path-binding convention.

### 5. The spec is generated and drift-tested

The published contract lives in `hanzoai/openapi` under `<service>/openapi.yaml`.
The generated region sits between markers; hand-authored parts (inference bodies
in OpenAI wire format, shared components) live outside them and survive
regeneration byte-for-byte.

A test MUST re-render and fail on any difference. Rendering MUST be
deterministic — Go randomizes map iteration, and a generator whose output
reorders between runs produces a drift test that fails at random, gets labelled
flaky, and is switched off. That is how a drift guard dies.

Operation IDs MUST be unique. `PATCH` and `PUT` reach one handler, so they are
two operations sharing an implementation; a duplicate `operationId` makes a code
generator emit one method name twice and most keep only the last, silently.

## Authorization: gate structurally, not by string

This is the load-bearing section. Renaming routes has broken authorization twice,
and both failures were silent.

**MUST**: derive the gate from *position*, not from the path's spelling. In
`iam`, routes registered before `app.Use(authz.Guard)` are public and everything
after is guarded. Its own comment states the principle:

> a position in a slice is not a security boundary. A path prefix is.

**MUST NOT**: infer the verb, or the object, from a route string. Concretely,
what goes wrong:

- A filter that recognizes mutations by prefix (`add-`, `update-`, `delete-`)
  stops matching when `add-application` becomes `POST /applications`. Where the
  fallback rule is allow-by-default, every confidential client silently regains
  blanket admin over user, cert, key and org mutations.
- A list guard written as `HasPrefix(path, "/v1/iam/get-") && HasSuffix(path, "s")`
  stops matching under `GET /v1/iam/users`, so an attacker-supplied `?id=`
  becomes the authorization object. Combined with a Casbin matcher clause of
  `r.subOwner == r.objOwner && r.subName == r.objName`, a request can
  self-match and be unconditionally allowed.
- Rate limiters and validators keyed on exact legacy paths become **no-ops with
  no error and no log line** — killing, in one observed case, the login
  brute-force limit.

Path params are invisible to group middleware, which has matched the group and
not yet the final route. A guard needing the target MUST parse the path string
itself. Running both readings — guard on the path, handler seam on the decoded
input, through the same policy function — is two independent checks and is the
recommended shape.

**MUST**: ship a test that probes every registered route with no credentials and
asserts the answering set equals a frozen list, reporting newly-exposed and
newly-withdrawn separately. **MUST**: prove that test fails, by moving a guarded
route above the Guard and observing it flag the route. A guard test never seen
to fail is not evidence.

**MUST**: check whether action strings are stored as data. Where customer-defined
permission rows reference action names, renaming an action is a data migration,
not a code change.

## Migration

1. Add the resource table; generate routes and spec from it.
2. Keep the legacy spellings alive in an explicit `compat` package — a thin
   routing and envelope layer over the SAME store and the SAME redaction, so no
   CRUD and no masking is reimplemented. Document why each alias exists.
3. Migrate callers. Fix the **prefix** first (`/api/x` → `/v1/<service>/x`),
   then the **spelling** — one variable at a time, verifying each repointed path
   answers rather than 404s.
4. Delete `compat` only when the caller sweep proves it has no consumers.

Prefer a correct, proven partial over a broad change that cannot be verified.
Authentication surfaces have no safe rollback: a false green locks every user
out of every product.

### Fix the seam, not the call sites

A dialect is almost never N independent mistakes; it is one URL builder reflected
N times. Find the builder. Measured on the `/api/` removal: one line in
`iamsdk/util.go` corrected 66 action constants across 95 call sites; one
`_url.api_path` corrected 78; one `IAM_ROUTE_PREFIX` corrected 32. Editing call
sites instead would have been ~400 edits and would have left the builder free to
mint the dialect again.

### A live probe cannot tell you a route exists

`GET /v1/iam/totally-bogus-route` returns **401**, because a guard sits in front
of a catch-all. Any "the route answers" check built on curl is therefore
worthless on a guarded surface — and an SPA fallback will happily return
`200 text/html` for a path the API does not serve. Build the oracle from the
**deployed image's source**, and assert `content-type: application/json` so a
hollow pass fails honestly.

The same trap has an operational edge: pointing a Kubernetes **liveness** probe
at a guarded prefix returns 401 and crashloops the pod. Health endpoints belong
in the public group (`/healthz`), not under the guarded `/v1/<service>/` tree.

### Enforce at the narrowest gate

The strongest guard is the one every artifact must pass. For the published
surface that is `hanzoai/openapi`'s `merge.py`: every service spec passes through
it to reach `hanzo.yaml`, from which every SDK is generated. A rule enforced
there cannot be bypassed by a repo that forgets to add its own check.

Guards MUST parse code, not lines. A grep-based guard flags its own explanatory
comment, which teaches contributors to word around the guard rather than obey it.
Use `go/ast` and Python `ast`: only a string literal can *be* a route. And every
guard MUST be proven to fire by injecting a violation, then restored green — an
enforcement that has never failed is not known to work.

## Conformance

A service conforms when all hold:

- No route literal matches `/v1/<service>/<verb>-<noun>` outside `compat`.
- No route literal contains an `/api/` path segment.
- Every resource is a plural noun; every member is `{owner}/{name}`.
- Routes and spec are generated from one table; the drift test passes.
- The public-route guard test exists and has been observed to fail.
- Health/liveness endpoints are public (`/healthz`), never under the guarded
  `/v1/<service>/` tree.

Current status (measured 2026-07-27; verb-noun literals outside `compat`):

| service  | verb-noun | `/api/` | native surface |
|----------|-----------|---------|----------------|
| `llm`    | 0         | 0       | conforming |
| `bot`    | 0         | 0       | conforming |
| `dev`    | 0         | 0       | conforming |
| `commerce` | 2       | 1       | near |
| `gateway`  | 3       | 3       | near |
| `ai`     | 5         | 4       | generated; residue |
| `cloud`  | 17        | 26      | partial |
| `iam`    | 0 in `internal/routes`; 61 in `compat`; ~18 elsewhere | 1 | generated; `sessions` non-compliant |

`iam`'s native registration is clean. Its remaining violations are
half-migrated modules that register a compliant route *and* a legacy one side by
side — `memberships` (`/v1/iam/memberships` beside `get-memberships`,
`add-membership`, `delete-membership`), `mfa` (`/v1/iam/mfa/setup/*` beside
`delete-mfa`, `set-preferred-mfa`), `get-account`, `update-preferences`.

## Rationale

**Why plural nouns and HTTP verbs.** The method already carries the verb.
Encoding it again in the path means two sources for one fact, and they disagree
the moment one is edited — which is exactly how `get-users` outlived the
handler's semantics.

**Why generate.** A spec beside a router is two descriptions of one surface. The
spec is the one customers believe, so it is the one that rots quietly. Deriving
it removes the possibility rather than the likelihood.

**Why structural authorization.** String-derived policy is a coupling between
naming and security that no reviewer can see. Renaming is a routine refactor;
silently disabling a brute-force limiter is not a routine outcome. Position-based
gating makes the coupling explicit and reviewable.

**Why fix zip rather than each service.** The POST-sub-verb dialect was not
seven bad decisions; it was one missing capability reflected seven times.
Primitives belong at the layer that owns them (HIP-0127).

## Security Considerations

Renaming a route is a security change until proven otherwise. Before merging any
change to a route surface:

1. Enumerate public routes before and after; diff the sets.
2. Confirm every filter keyed on a path prefix still matches — especially
   rate limiters, brute-force limits, and field validators, which fail **open
   and silent**.
3. Confirm the authorization object still derives from the intended segment,
   not from caller-supplied query or body.
4. Confirm no stored permission data references the old action strings.

## References

- HIP-0106 — Unified Hanzo Cloud Binary
- HIP-0127 — V8 Architecture: Distribution & Language Seam
- `hanzoai/openapi` `README.md` — the canonical routing rule;
  `merge.py` — the gate every spec passes before SDK generation
- `zap-proto/zip` `typed.go` (`bindPath`), `openapi.go` (`OpenAPISpec`)
- `hanzoai/ai` `routers/resources.go` — reference table + generator
- `hanzoai/iam` `internal/rest/rest.go`, `internal/routes/public_test.go`
