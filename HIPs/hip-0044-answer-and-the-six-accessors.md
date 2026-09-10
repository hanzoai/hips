---
hip: 0044
title: Answer — Budget, Policy, Audit, Search, KB and Graph in Three SDKs
author: Hanzo AI
type: Standards Track
category: Interface
status: Draft
implementation-go: none
created: 2026-09-10
requires: HIP-0040, HIP-0111, HIP-0139, HIP-0526, HIP-1030, HIP-1041, HIP-1101, HIP-1103, HIP-1126, HIP-1147, HIP-1198, HIP-1202, HIP-1220, HIP-1260
---

# HIP-0044: Answer — Budget, Policy, Audit, Search, KB and Graph in Three SDKs

## Abstract

Six groups of routes on `api.hanzo.ai` answer questions a program asks about
itself: what it may spend, what it may do, what it did, what the org knows, what
the org wrote down, and what the org holds as assertions. Every one is registered
by a router in `hanzoai/cloud` and appears in the served document. None is
reachable through the published SDKs as anything but a generated method over a
raw address.

This HIP specifies a hand-written surface over the generated client in
[`hanzoai/go-sdk`](https://github.com/hanzoai/go-sdk),
[`hanzoai/python-sdk`](https://github.com/hanzoai/python-sdk) and
[`hanzoai/js-sdk`](https://github.com/hanzoai/js-sdk): one credential path, one
answer type, and six accessors named `budget`, `policy`, `audit`, `search`, `kb`
and `graph`.

A method that can be refused returns
`Answer<T>` with three arms — `ok`, `denied`, `held` — and a caller cannot reach
the value without acknowledging which arm it got. A refused budget and a refused
policy are outcomes the caller reads, not exceptions the caller catches. An
exception is reserved for the case where no decision was made at all.

It specifies no address and no server behaviour. The routes are HIP-1198's,
HIP-1260's and their neighbours'; the document that describes them is HIP-1030's;
the credential is HIP-0111's. This is the client half, and only that.

## Motivation

HIP-0040 standardizes the SDKs over the AI surface — model calls, streaming,
retry policy, error classification. That settles serialization, retries and
timeouts, none of which is what is missing here.

The problem is that everything outside that surface arrives as a generated
method over an address, and generated methods carry only what the served document
declares. Where the document declares nothing, the generator emits nothing
usable. Measured against the served document on 2026-09-08 —

```
curl -s https://api.hanzo.ai/v1/openapi.json \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['paths']))"
1641
```

— four of the routes this HIP binds declare no response schema at all
(`GET /v1/billing/balance`, `GET /v1/billing/usage`, `POST /v1/knowledge/import`,
`POST /v1/framework/{doctype}`), and a fifth declares neither a request body nor
a response (`POST /v1/authz/check`). The generators therefore emit a policy
method that takes nothing and returns nothing, and money reads that come back as
`void` in Go and Python and `any` in TypeScript. A caller who needs the balance
writes the HTTP call by hand, in every language, indefinitely.

The second problem is that the three SDKs have already drifted apart on the two
things they both attempt. Measured on the working trees at 2026-09-08:

| Observation | go-sdk | python-sdk | js-sdk |
|---|---|---|---|
| Files under the package not listed in `.generated` | 6 of 2703 | 9 of 2710 | 0 of 2698 |
| Hand-written client object | no — two constructors | `Client(ApiClient)` | none |
| Subject scoping | `As(subject)` | `as_(subject)` | absent |
| Hold type | `Result[T]`, opt-in via `Read()` | `Held` raised by default | absent |
| Default when a call is held | silent 2xx | raises | silent 2xx |
| OAuth2 `client_credentials` exchange | absent | absent | absent |
| RFC 8707 `resource` parameter | absent | absent | absent |
| Accessor named `budget`, `policy` or `kb` | absent | absent | absent |

Two languages disagree on what a hold does by default; the third does not know
holds exist. All three take a bearer token that some other process obtained,
which is a credential nobody rotates and which says nothing about who is calling.
None performs the exchange HIP-0111 specifies.

Divergence between the three is the failure this document exists to prevent, and
it is already present before a line of the new surface is written. A
specification that leaves any of the above to an implementer's judgement will be
implemented three ways again.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 Scope

#### §1.1 The boundary against HIP-0040

HIP-0040 is not amended, extended in place, or re-litigated. It keeps everything
it owns; this HIP adds a layer above it and takes nothing away.

| HIP-0040 owns | This HIP owns |
|---|---|
| Generation of the four SDKs from the served document | The hand-written layer above the generated client |
| The AI/gateway surface: completions, embeddings, images, audio, files, models | Six accessors over budget, policy, audit, search, kb and graph routes |
| Transport: base URL, timeouts, retry policy, exponential backoff | Nothing — transport is inherited unchanged |
| HTTP error classification into typed exceptions | Which HTTP responses stop being exceptions and become `Answer` arms |
| Org and team request headers | Subject scoping, which replaces a caller-asserted org (§4) |
| Package names, registries, release cadence | No new package; the layer ships inside the existing one |
| Python, TypeScript, Go and Rust | Python, TypeScript and Go (§13 states why Rust is out of scope) |

Where the two touch — an HTTP response that HIP-0040 would classify as an
exception and §6 classifies as a `denied` arm — this HIP is authoritative, and
only for the methods §8 defines. Every other method in every SDK keeps HIP-0040's
behaviour exactly.

#### §1.2 An accessor is not a capability

HIP-0139 defines a capability as one thing the cloud does, with one name
projected nine ways, one of which is the class in every generated client. The six
words in this HIP are **accessors**, not capabilities, and the two MUST NOT be
conflated: an accessor is a client-side grouping that may span several
capabilities, and a capability may be reached through more than one accessor.

| Accessor | Capabilities it reaches | Routes |
|---|---|---|
| `budget` | `allowance` (HIP-1101), `commerce` (HIP-1220), `entitlement` (HIP-1202) | `/v1/allowance`, `/v1/billing/balance`, `/v1/billing/usage`, `/v1/entitlement` |
| `policy` | `authz` (HIP-1041) | `/v1/authz/check` |
| `audit` | `audit` (HIP-1103) | `/v1/audit` |
| `search` | `search` (HIP-1147) | `/v1/search` |
| `kb` | `knowledge` (HIP-1260), `framework` (HIP-1126) | `/v1/knowledge/*`, `/v1/framework/kb.{kind}` |
| `graph` | `graph` (HIP-1198) | `/v1/graph`, `/v1/graph/*` |

The generated classes named for the capabilities remain exactly as they are. An
accessor is built over them; it does not replace them and MUST NOT hide them.

#### §1.3 What this does not specify

- **Server behaviour, addresses and wire schemas.** The graph routes are
  HIP-1198's; the knowledge corpus is HIP-1260's; the free-call ceiling is
  HIP-1101's. This HIP binds what they serve and specifies none of it.
- **The substrate under the graph.** How a source becomes a document, a document
  becomes chunks, and a chunk becomes an assertion with the span it was read from
  is specified by HIP-0526 and implemented by
  [`github.com/hanzoai/semantic`](https://github.com/hanzoai/semantic) (MIT). The
  `graph` accessor is a client for the plane above that substrate. It restates
  none of it, and an implementer of this HIP needs none of it.
- **How the served document is produced.** HIP-1030 governs that. §11 depends on
  it in one direction only: a route absent from the document is a route no SDK
  may bind.

### §2 The client

Each SDK MUST expose exactly one client type carrying the six accessors. In
TypeScript this is a new type — the package has no client object today — and it
is the only new type this HIP adds to a language's public entry point; the
types of §5, §8 and §9 are added to all three alike.

| Language | Construction |
|---|---|
| Go | `c := hanzoai.New(hanzoai.Options{ID: id, Secret: secret})` |
| Python | `c = hanzoai.Client(id=id, secret=secret)` |
| TypeScript | `const c = new hanzoai.Client({ id, secret })` |

Five options, the same five names, each language's own casing. Every one falls
back to an environment variable, so the zero-argument constructor is the normal
case and MUST work.

| Option | Environment | Default | Meaning |
|---|---|---|---|
| `id` | `HANZO_CLIENT_ID` | — | IAM client id |
| `secret` | `HANZO_CLIENT_SECRET` | — | IAM client secret |
| `base` | `HANZO_BASE_URL` | `https://api.hanzo.ai` | the one endpoint |
| `issuer` | `HANZO_ISSUER_URL` | `https://hanzo.id` | where IAM answers |
| `resource` | `HANZO_RESOURCE` | the value of `base` | RFC 8707 audience |

Requests MUST go to `base` with paths under `/v1/`. An SDK MUST NOT emit an
`/api/` path segment, a `v2` prefix, or a request to a third host. The issuer is
the only other host any SDK contacts, and only to mint (§3).

Construction MUST NOT fail on a missing `id` or `secret`; the first call does,
when the exchange of §3 is refused. Go's constructor therefore returns one value,
not `(client, error)`. Every TypeScript method returns a `Promise`; the tables in
§8 name the resolved type. Python ships a synchronous client and an asynchronous
one, and both carry all six accessors with the same method names — an accessor
present on one and absent from the other is the divergence this HIP exists to
prevent, inside a single language.

### §3 Identity

The client MUST obtain its own access token by the OAuth 2.0 client-credentials
grant against IAM, as specified in HIP-0111, with the RFC 8707 `resource`
parameter naming the API it will call:

```
POST {issuer}/v1/iam/oauth/token
Authorization: Basic base64(id + ":" + secret)      # client_secret_basic
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&resource={resource}
```

The token MUST be cached until `expires_in` minus 60 seconds. On a `401` from
`base`, the client MUST re-mint once and replay the request; a second `401` is
the server's answer and surfaces as an error, never as a retry loop. This one
re-mint is the only respect in which a request to `base` behaves differently from
HIP-0040's transport, and it applies to every method the client makes rather than
only to §8's: a credential that has expired has expired for all of them. HIP-0040
keeps retry, backoff and timeouts unchanged.

A client MUST NOT accept a pre-existing bearer token, an API key, or a
`HANZO_API_KEY` environment variable, and MUST NOT read one if it is set. There
is no second credential path and no option that introduces one. A token handed to
the SDK is a token nobody rotates and a token that does not say who is calling,
which is the question every gate in the estate exists to answer.

### §4 Acting as a subject

An operator credential may re-scope itself to act as one subject:

| Language | Call |
|---|---|
| Go | `scoped := c.As("usr_7")` |
| Python | `scoped = c.as_("usr_7")` |
| TypeScript | `const scoped = c.as("usr_7")` |

The scoped client is a distinct value; the original is unchanged. The operator
credential MUST leave with the scope — two credentials on one request are two
answers to who is calling, and the request would carry no single principal.

The scoped token MUST be obtained by RFC 8693 token exchange on the same token
endpoint as §3, which is what HIP-0111 §7 specifies for delegation. An SDK MUST
NOT reach a bespoke issue-user-token verb; HIP-0111 §7 forbids one by name, and
both SDKs that implement scoping today use one (§13).

```
POST {issuer}/v1/iam/oauth/token
Authorization: Basic base64(id + ":" + secret)
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:token-exchange
&requested_subject={subject}
&requested_token_type=urn:ietf:params:oauth:token-type:access_token
&resource={resource}
```

The token that comes back carries the target subject and that subject's `owner`,
plus an `act` claim naming the acting client. It is cached and refreshed exactly
as in §3, keyed by subject.

IAM gates this grant: the acting client's owning org must be a platform signing
owner and its `client_id` must be listed for exchange (HIP-0111 §7). An SDK MUST
NOT treat a refusal here as a `denied` arm — it is a `401`/`403` on a credential
operation, so it is an error per §6, and it means the calling application is not
permitted to act for anyone rather than that this call was refused.

No method in §8 takes an org or a tenant, and none takes a subject it will act
as. The tenant is the validated principal, everywhere. A method accepting one
would be a cross-tenant read the caller asserted for itself. `policy.check` takes
a `sub` (§8.2) because it asks a question *about* a subject rather than acting as
one; its answer is scoped to the caller's own tenant like every other read.

Python spells this `as_` because `as` is a keyword and PEP 8 prescribes the
trailing underscore. The word is still `as`. This is the general rule of §10, and
within this HIP it applies three times: here, to `kb.import` in §8.5, and to
`graph.assert` in §8.6.

### §5 Answer

Every method §8 marks as gated MUST return one type with three arms. A caller
MUST NOT be able to reach the value without first narrowing to an arm, to the
extent the language admits: TypeScript and Python make it impossible, and Go
makes it an ignored `error`, which `errcheck` and `golangci-lint` report but the
compiler permits. Go's arm is therefore enforced by convention where the other
two enforce it by type. That is the language's limit, not a licence to weaken the
other two.

```
Answer<T>
  ok      value    T
  denied  code     string      # "insufficient_balance", "spend_cap_exceeded", …
          reason   string      # the problem detail's `detail` member
          product  string?     # present when the gate is product-scoped
          cures    []Cure      # {kind, url} — the ways out, in the order to offer them
  held    id       string      # the approval handle
          clause   string      # the policy clause that stopped the call
          reason   string
  always  request  string      # the response's X-Request-Id, on all three arms
```

The `held` arm is parsed from a body whose members are
`{status: "held", id, clause, reason}` — the shape both `go-sdk`'s `result.go`
and `python-sdk`'s `pkg/hanzoai/result.py` already read. `held.id` is the handle
the approval is known by; no route redeems it today, and §11 records that. An SDK
carries the id and offers no method that resolves it, rather than inventing one.

`Answer<void>` is the arm set with no value. Go spells it `Answer[struct{}]` and
its `Value()` yields the zero struct; Python's `.value` yields `None`;
TypeScript's `ok` arm carries `value: void`. The arms are otherwise identical.

`Cure` is `{kind: string, url: string}`. The SDK field is plural (`cures`)
because it is a list; the wire member is `cure`, and the SDK MUST NOT rename the
wire.

`code` MUST be carried as a string in all three languages and MUST NOT be an
enum, a union of literals, or any closed type. The set is open by construction —
it is decided in `hanzoai/cloud`'s `errmap.go` and `middleware_billing.go`, and a code
added there tomorrow must arrive at a caller as data rather than as a parse
failure. The codes present in that repository today are
`insufficient_balance`, `spend_cap_exceeded`, `payment_required`, `unauthorized`
and `forbidden`. A policy refusal has no distinct code of its own yet; §12
records that, and an SDK MUST NOT invent one.

Each language enforces the same obligation with what it has:

| Language | Shape | What stops a caller ignoring the arm |
|---|---|---|
| Go | `Answer[T]` with a `Status` field (`"ok"`/`"denied"`/`"held"`), `Value() (T, error)`, `Denied() (*Denied, bool)`, `Held() (*Held, bool)` | `Value` returns `*Denied` or `*Held` as its `error`; discarding it yields the zero value and is reported by `errcheck` |
| Python | `Answer` with a `.status` attribute, a `.value` property that raises `Denied` or `Held`, and `.denied` / `.held` returning the same objects those raise | reaching `.value` on a non-`ok` arm raises |
| TypeScript | a union discriminated on `status`: `{status:"ok", value:T, request:string}` \| `{status:"denied", code, reason, product?, cures, request}` \| `{status:"held", id, clause, reason, request}` | `a.value` does not typecheck until the union is narrowed |

`request` MUST be present on all three arms and MUST carry the response's
`X-Request-Id` header verbatim. It is the join to `audit.Event.request` (§8.3),
and it is what makes the six one client rather than six.

There MUST be exactly one way to call a gated method. An SDK MUST NOT offer a
second entry point that returns the bare value, and MUST NOT make the arm
opt-in. Go's `Read()`/`Result[T]` and Python's `result()` are removed, not
deprecated; TypeScript adds nothing equivalent. No compatibility shim is
provided for either.

### §6 Classifying a response

One rule, applied identically by every SDK to every gated method. There is no
per-accessor variation.

Apply the rows in order and take the first that matches.

| # | Response | Arm | Why |
|---|---|---|---|
| 1 | any 2xx whose body is a JSON object with `status` equal to `"held"` | `held` | the body decides |
| 2 | any other 2xx | `ok` | it ran |
| 3 | 402, any code | `denied` | money refused |
| 4 | 403 whose `code` is `insufficient_balance` or `spend_cap_exceeded` | `denied` | authenticated, and refused |
| 5 | everything else — 401, any other 403, other 4xx, all 5xx, transport failure | error | no decision was made, so there is nothing to read |

A hold is recognised by the **body**, never by the status code. Cloud answers a
hold with `202`, but `202` is also the ordinary answer for "accepted, working on
it", so the status code does not separate the two. Testing the body first, at any
2xx, means a hold served at some other 2xx is still read as a hold, and a `202`
that is merely an acknowledgement is still read as `ok`.

Two refusal bodies are served on the routes §8 binds, and both MUST be parsed.
The AI surface emits a third, nested shape; that surface is HIP-0040's and no
method here reaches it. The first is the
RFC 9457 problem detail emitted by `hanzoai/cloud`'s `errmap.go`, carrying `code`.
The second is that repository's `Refusal` (`middleware_spend.go`), which is
`{error, product, reason, message, cure[]}` — its `error` member is always
`payment_required` and it carries no `code`. An SDK MUST map the second onto the
same `denied` arm: `code` from `error`, `reason` from `message`, `product` and
`cures` verbatim. The wire's own `reason` member — `"unpaid"` or `"unresolved"` —
names the admit leg that failed rather than explaining the refusal to a person,
and is dropped; `message` is the sentence a caller shows. §12 records the two
bodies as a defect and states what removes it.

Row 4 is a workaround, not a design. It exists because cloud spells "no validated
principal" as `403 forbidden` rather than `401`, so a bare `403` cannot be read as
a refusal. When that is fixed (§12) the rule collapses to **402 or 403 ⇒
`denied`** and the code list disappears. While the defect stands an SDK MUST
match exactly the two codes named and classify any other `403` as an error. That
closed list is a workaround for one server behaviour; it says nothing about the
code vocabulary of §5, which is open and MUST stay open.

### §7 What is not an Answer

A read that no gate refuses MUST return its value directly. Wrapping it would
make every caller branch on an arm that cannot occur, and the arm would stop
carrying information.

These return their value: `budget.left`, `budget.balance`, `budget.plan`,
`budget.spent`, `audit.list`, `audit.all`, `kb.get`, `kb.list`, `kb.connectors`,
`kb.connect`, `kb.links`, `graph.read`, `graph.find`, `graph.resolve`,
`graph.walk`, `graph.extract`, `graph.vocabulary`.

Every method in §8 is in exactly one of these two sets: the ones listed here and
the ones §8 marks **gated**. An implementer who finds a method in neither has
found a defect in this document, not a choice to make.

`policy.check` returns a `Decision` carrying a boolean, not an `Answer`. Asking
whether you may act is a question with an answer; being stopped part-way through
acting is what produces a `denied` arm. The two are different events and MUST
keep different types.

### §8 The six accessors

One accessor per group, one word, the same word in all three languages. Go
exports it capitalized (`c.Budget`) because that is Go's export rule; the word
does not change. Method names carry no accessor prefix: `c.graph.read`, never
`c.graph.readGraph`.

Every method below is listed with its route. A method marked **gated** returns
`Answer<T>`; the rest return their value per §7.

A type this HIP gives a shape to takes that shape, and the SDK maps the wire onto
it. A type named here without a shape — `Reindex`, `Sync`, `Connector`, `Link`,
`Triple` — takes, field for field, the shape the served document declares for its
route. The shapes given below are given because the document declares none, or
because the SDK's field names differ from the wire's (§8.3), or because a field
carries a constraint a schema cannot state (§8.1's unbounded allowance, §8.4's
`score`).

#### §8.1 budget

What you may spend, what is left, and what it cost. An allowance and a sum of
money are different facts and MUST NOT stand in for each other.

| Method | Returns | Route |
|---|---|---|
| `left()` | `Allowance` | `GET /v1/allowance` |
| `balance()` | `Balance` | `GET /v1/billing/balance` |
| `plan()` | `Plan` | `GET /v1/entitlement` |
| `spent(filter)` | `Page<Charge>` | `GET /v1/billing/usage` |

- `Allowance` is `{plan: string, limit: int, used: int, left: int, spent: Money,
  window: string, resets: instant}`. The counts are calls, not money; `spent` is
  the only money on the type. `window` is `"hour"` or `"day"` — whichever will
  stop the caller next. When `limit == 0` the allowance is unbounded: the SDK
  MUST report `left` and `resets` as absent, never as zero, because there is no
  period to end.
- `Balance` is `{available: Money, reserved: Money, account: string}`. The wire
  member for `reserved` is `held`; the SDK renames it because `held` is an arm of
  `Answer` (§5) and one word for two facts is what §10 exists to prevent.
- `Plan` is `{tier: string, apps: map<string, bool>}`. A key is false both when
  the plan does not grant the app and when the licence authority could not be
  reached; cloud decides which, and the SDK reports what it is given. An SDK MUST
  NOT convert a transport failure into `false` — that would be a read inventing
  an answer.
- `Charge` is `{id: string, at: instant, model: string, amount: Money}`.

`Balance` and `Charge` are modelled by the SDK because the served document
declares no response schema for their routes (§12).

`POST /v1/usage` is deliberately excluded. It ingests a developer's report of
what their own provider accounts consumed of their own plans. Binding it here
would let a caller believe they were reporting Hanzo spend. No accessor wraps it.

#### §8.2 policy

May this subject take this action on this object.

| Method | Returns | Route |
|---|---|---|
| `check(sub, act, obj)` | `Decision` | `POST /v1/authz/check` |

`Decision` is `{allow: bool, sub: string, act: string, obj: string,
reason: string}`. All three arguments are required. The question is echoed beside
the verdict so that a cached or logged decision still says what it answered.
`reason` is empty until cloud fills it (§12); the SDK carries the field as given
and MUST NOT synthesize a sentence for a denial it was given no reason for.

The argument order is `(sub, act, obj)` — subject, verb, object, the order the
sentence reads in. The request body cloud expects orders its members
`{sub, obj, act}`. JSON members are unordered, so nothing on the wire changes;
what changes is the order a person writes the three arguments in, and all three
SDKs MUST take them subject-first. The mismatch with the route's own member order
is spelled here, once, so no implementer re-derives it from the document and
arrives at `(sub, obj, act)`.

`POST /v1/authz/check` declares neither a request body nor responses, so all
three generators emit an unusable method. Policy is the one accessor that cannot
be built over its generated method: implement it against the shape above, which
is the shape the route's own description states.

`POST /v1/o11y/authz/check` is the same question in a second vocabulary. No SDK
binds it (§11).

#### §8.3 audit

The org's own trail, newest first, read-only by construction.

| Method | Returns | Route |
|---|---|---|
| `list(filter)` | `Page<Event>` | `GET /v1/audit` |
| `all(filter)` | iterator of `Event` | `GET /v1/audit`, repeated |

`Filter` is `{actor, action, resource, id, result, request, since, until, size,
page}`, every field optional and every field a narrowing **within** the caller's
own org. `Page<T>` is `{items, total}`, where `total` is the count the filter
matched across all pages.

`all` walks every page by the rule in §9. Go returns `iter.Seq2[Event, error]`,
Python an `Iterator[Event]`, TypeScript an `AsyncIterable<Event>`; in Python and
TypeScript a failure part-way through raises out of the iteration rather than
ending it, so a caller cannot mistake a broken walk for a finished one.

Six wire fields are renamed for what they carry. Nothing else is renamed for that
reason; `pageSize` and `p` also reach the caller as `size` and `page`, which is a
type repair rather than a rename and is recorded in §12.

| Wire | SDK | Why |
|---|---|---|
| `sub` | `actor` | `sub` is token vocabulary; the reader wants who did it |
| `time` | `at` | one word for an instant, shared with `graph.Fact.at` |
| `resourceId` | `id` | it sits beside `resource`; the compound says nothing more |
| `requestId` | `request` | the same word as `Answer.request`, which is what makes the join legible |
| `sourceIp` | `ip` | there is no other address on the row |
| `userAgent` | `agent` | likewise |

Unchanged: `seq`, `org`, `email`, `home`, `action`, `resource`, `method`, `path`,
`result`, `status`, `reason`. `result` is `success`, `deny` or `error` — the
wire's own vocabulary, kept verbatim; a row reading `deny` is the trail's record
of a call that returned a `denied` arm, and the SDK MUST NOT restate it as
`denied` merely to match §5.

There is no write method and MUST NOT be one. The server writes the trail; an
SDK that offered a write would let a caller forge its own evidence.

#### §8.4 search

One ranked result set over everything the org has stored.

| Method | Returns | Route |
|---|---|---|
| `find(query, opts)` — **gated** | `Answer<Hits>` | `POST /v1/search` |

`Opts` is `{mode, project, kinds[], index, limit, offset}`. `mode` is one of
`auto`, `text`, `semantic`, `hybrid`, default `auto`. The modes name kinds of
retrieval, not backends. `mode` constrains which retrieval the server runs, and
the server chooses the subsystem that runs it; the SDK exposes no name from
`Backend.name` as an input, so a caller can ask for semantic retrieval but cannot
route a query to a named subsystem.

```
Hits     status    "ok" | "partial" | "unavailable"
         partial   bool          # status != "ok"
         mode      string        # after `auto` resolved
         items     []Hit
         backends  []Backend
         took      Duration

Hit      id, corpus, kind, title, url, project, score, matched []Match
Match    backend, rank, score
Backend  name, status ("ok" | "degraded" | "disabled" | "skipped"), hits, took, error
```

`score` is a reciprocal-rank fusion sum and is comparable only **within one
response** — never across queries, and never against a backend's own score, which
stays in `matched`. Every SDK MUST document that on the field itself.

A backend that is down produces the surviving backends' results plus a `degraded`
entry carrying the failure. That is not a `denied` arm and not an exception: it
is an `ok` arm whose `partial` is true. An SDK MUST surface `partial` as a
first-class field and MUST NOT report degradation as an empty result set. A
caller that cannot see `partial` reads a truncated corpus as a complete one.

#### §8.5 kb

The corpus the org writes, and the connectors that fill it. Searching it belongs
to `search`.

| Method | Returns | Route |
|---|---|---|
| `put(doc)` — **gated** | `Answer<Doc>` | `POST`/`PUT /v1/framework/kb.{kind}` |
| `get(kind, name)` | `Doc` | `GET /v1/framework/kb.{kind}/{name}` |
| `list(kind, filter)` | `Page<Doc>` | `GET /v1/framework/kb.{kind}` |
| `drop(kind, name)` — **gated** | `Answer<void>` | `DELETE /v1/framework/kb.{kind}/{name}` |
| `import(format, data)` — **gated** (Python: `import_`) | `Answer<Import>` | `POST /v1/knowledge/import` |
| `reindex()` — **gated** | `Answer<Reindex>` | `POST /v1/knowledge/reindex` |
| `connectors()` | `[]Connector` | `GET /v1/knowledge/connectors` |
| `connect(provider)` | `Link` | `GET /v1/knowledge/connectors/{provider}/connect` |
| `sync(provider)` — **gated** | `Answer<Sync>` | `POST /v1/knowledge/connectors/{provider}/sync` |
| `revoke(provider)` — **gated** | `Answer<void>` | `DELETE /v1/knowledge/connectors/{provider}` |
| `links()` | `Links` | `GET /v1/knowledge/graph` |
| `install()` — **gated** | `Answer<void>` | `POST /v1/framework/modules/kb/install` |

`Doc` is `{kind, name, title, body, project, url}` where `kind` is one of `page`,
`memory`, `source`. One method covers three kinds: the SDK maps `kind` to the
doctype `kb.<kind>`. `put` sends `POST /v1/framework/kb.{kind}` when `Doc.name`
is empty and `PUT /v1/framework/kb.{kind}/{name}` when it is set. The caller's
`name` is the decision; the SDK MUST NOT probe with a `GET` first, because a
read between the decision and the write is a race the caller did not ask for.

`import` takes `format` — one of `obsidian`, `notion`, `roam`, `evernote` — and
the export's bytes, sent as the multipart `file` field. It answers
`Import{format, imported, pages[]}` (`cloud/apps/knowledge/import.go`). Neither
this route nor `put`'s declares a response schema, so both shapes are stated here
(§12).

`connect` answers a URL to send a person to. The SDK MUST NOT follow it — an
OAuth consent screen is not a client's to complete.

`links()` is `{nodes[], edges[], partial}`: the corpus's own parent, wikilink and
provenance edges. It is **not** `graph`. It describes documents; `graph`
describes assertions. The two MUST NOT share a type, and an SDK MUST NOT convert
between them.

KB writes are not under `/v1/knowledge` at all — they are generic doctype CRUD at
`/v1/framework/kb.page`, `kb.memory` and `kb.source`, which is why the routes
straddle two capabilities. The accessor presents one `kb` and hides the split.
An SDK MUST NOT expose `/v1/framework/{doctype}` generically: a caller who needs
arbitrary doctypes is not using this accessor.

`install()` is required once per org before the first `put`. It is in the surface
only because cloud requires it, and it leaves the surface when cloud stops
requiring it (§12).

#### §8.6 graph

Assertions with provenance and time. Nothing overwrites anything; a retraction is
itself an assertion.

| Method | Returns | Route |
|---|---|---|
| `assert(facts)` — **gated** (Python: `assert_`) | `Answer<Wrote>` | `POST /v1/graph` |
| `read(filter)` | `[]Fact` | `GET /v1/graph` |
| `find(query, opts)` | `[]Fact` | `GET /v1/graph/search` |
| `resolve(entity, relation, at?)` | `Resolution` | `POST /v1/graph/resolve` |
| `walk(seeds, opts)` | `Walk` | `POST /v1/graph/neighbors` |
| `extract(source)` | `[]Triple` | `POST /v1/graph/extract` |
| `ingest(source)` — **gated** | `Answer<Wrote>` | `POST /v1/graph/ingest` |
| `vocabulary()` | `Vocabulary` | `GET /v1/graph/vocabulary` |

- `Fact` is `{entity, relation, value, names, at, seen, source, evidence,
  confidence}`. `names: true` declares that the value is another entity's key and
  that the assertion is therefore an edge.
- `Wrote` is `{recorded, duplicate, refused, reasons[]}`. Each member of a batch
  is judged on its own: one malformed fact MUST NOT discard the batch. Every SDK
  MUST check the invariant `recorded + duplicate + refused == len(facts)` on
  `assert`, where the caller supplied the facts and can count them; a batch that
  does not add up is a transport fault and surfaces as an error, never as an
  `Answer`. The check does not apply to `ingest`, which extracts its own facts, so
  the SDK has no count to compare against. `reasons[]` explains the refusals but
  does not index them to particular facts; the SDK carries it as given.
- `read` reads by key, `{entity, relation, value, at, limit}`. It resolves
  nothing and withholds nothing — a superseded claim and the claim that
  superseded it both appear.
- `find` reads by text. It is the same word as `search.find` because it is the
  same act on a different corpus.
- `Resolution` is `{entity, relation, at, known, winner?, conflicts[], contested,
  truncated}`. `known: false` is an answer, not an error. `contested` is true
  only when a conflict claims a *different* value than the winner.
- `walk` takes `Opts{relation, direction, depth, at}` and answers
  `{entities[], depth, bound, truncated}`. Only edges are followed.
- `extract` reads what a document states without recording it. `ingest` takes
  `{source, subject, text, at}` and does both, answering the same `Wrote`.
- `Vocabulary` is `{relations[], rules[], bound}` — the relations in use and the
  ordering that decides a conflict. The wire member is `rule`; the SDK pluralizes
  it because it is a list, as with `cures` (§5).

Instants follow §9. `at` is when the thing was so; `seen` is when it became
knowable and defaults to `at`. Cloud refuses an `at` in the future beyond a small
tolerance; the SDK MUST NOT clamp, round, or silently correct one, and a fact
refused on its timestamp comes back in `Wrote.refused` like any other refusal.

Python spells the first method `assert_` because `assert` is a keyword (§10).

### §9 Shared types

These types are declared once per SDK and used by every accessor that needs
them. An SDK that declares a second `Money`, a second `Page`, or a second
instant type has already diverged.

| Type or field | Where it appears |
|---|---|
| `Answer<T>` | the ten gated methods, which fall in `search`, `kb` and `graph` |
| `Denied.code` | whichever gate stopped a gated call — money, policy or entitlement; one string, one branch |
| `Answer.request` | all three arms; the join to `audit.Event.request` |
| `at` | `graph.Fact.at`, `audit.Event.at`, `Charge.at`, `graph.resolve(at)`, `graph.walk` opts |
| `Money` | `budget.balance`, `budget.spent` |
| `kind` | `kb.Doc.kind`, `search.Opts.kinds`, `search.Hit.kind` |
| `Page<T>` | `audit.list`, `budget.spent`, `kb.list` |
| `find` | `search.find`, `graph.find` |

Three rules are stated once here and govern every accessor:

- **Paging.** `Page<T>` is `{items, total}`. A method returning one takes `size`
  (default 100) and `page` in its filter; the caller requests page 1, and stops
  when a page comes back empty or the running count reaches `total`. `all()` is
  defined only on `audit` (§8.3); `budget.spent` and `kb.list` are paged by the
  caller. `search` and `graph.read` bound their results with `limit`/`offset`
  rather than `Page<T>` because their routes do; an SDK MUST NOT convert between
  the two conventions.
- **Instants and durations.** An instant is RFC 3339 on the wire and each
  language's own instant type in the SDK — `time.Time`, `datetime`, `Date`. This
  governs `graph.Fact.at` and `seen`, `audit.Event.at`, `audit.Filter.since` and
  `until`, `Charge.at` and `Allowance.resets`. A duration is milliseconds on the
  wire and `time.Duration`, `timedelta`, and a number of milliseconds in
  TypeScript, which has no duration type; this governs `Hits.took` and
  `Backend.took`.
- **Money.** `Money` is `{minor: int, currency: string}`, where `minor` counts the
  currency's minor units as ISO 4217 defines them — hundredths for USD, whole yen
  for JPY, thousandths for KWD. The field is not named `cents`, because for two of
  those three that would be false, and not `amount`, because `Charge.amount` is
  already a `Money`. Cloud answers USD today. An SDK MUST NOT represent money as
  a float, anywhere.

Two consequences follow, and each is normative:

1. A refusal on money and a refusal on policy are read at the same field. The two
   money codes — `insufficient_balance` (the wallet is empty) and
   `spend_cap_exceeded` (the wallet has money and a cap says no) — are different
   facts with different cures and MUST NOT be collapsed into one.
2. `held.clause`, and whatever names a clause in a policy refusal, MUST use the
   same vocabulary `policy.check` reports in `Decision.reason` for the same
   question. One clause vocabulary across the pre-check, the hold and the denial;
   otherwise a caller cannot tell which of its own checks it should have run.
   Cloud populates neither `Decision.reason` nor a policy-specific refusal code
   today (§12), so this binds the SDKs to carry both fields unchanged, not to
   invent values for them.
3. `Answer.request` and `audit.Event.request` are the same value, so a call and
   the row recording it can be joined without the caller correlating by hand.

### §10 The naming rule

An accessor and a method carry the same word in all three languages. Casing
follows the language: `c.Budget.Left`, `c.budget.left`, `c.budget.left`.

The only permitted escape is a keyword collision, which takes the language's
prescribed form and nothing else. Within this specification that is `as_`,
`import_` and `assert_` in Python — all three because PEP 8 prescribes the
trailing underscore for a name that collides with a keyword. There is no other
escape, and an implementer MUST NOT invent one: if a word collides in a language
not covered here, that is a question for an amendment, not for the implementer.

### §11 Routes no SDK binds

Binding these would give one question two answers in the client.

| Route | Reason |
|---|---|
| `POST /v1/knowledge/search` | the semantic leg of `POST /v1/search` with a second request shape and a second hit shape; reached as `search.find(q, {mode: "semantic"})` |
| `POST /v1/o11y/authz/check` | the policy question in a second vocabulary (`relation`, `object{resource, selector}`) |
| `POST /v1/graph/graphql` | untyped by construction — the caller chooses the output shape; the eight methods of §8.6 are the one way |
| `GET`/`POST /v1/framework/{doctype}` | generic doctype CRUD; `kb` binds three named doctypes and no more |
| `POST /v1/usage` | a report of a developer's own provider spend, not Hanzo spend (§8.1) |

A route absent from the served document MUST NOT be bound at all. Two SDKs
currently document `GET /v1/approvals/{id}` in comments on their hold types
(`python-sdk` `pkg/hanzoai/result.py`, and the equivalent in `go-sdk`); no such
path is served, and those references are removed rather than implemented.

### §12 Known defects, and the workarounds this HIP requires

Each row is a defect in something this HIP does not own. Until it is fixed, every
implementer would otherwise write the same workaround three times, so the
workaround is specified here once. The fix belongs to the owning capability's
HIP, not to this one.

| Defect | Required workaround | What the fix removes |
|---|---|---|
| A missing principal answers `403 forbidden`, not `401` | §6's fourth row: match `403` against a list of refusal codes | the code list; the rule becomes 402 or 403 ⇒ `denied` |
| Two 402 bodies are served: the RFC 9457 problem detail with `code`, and `cloud.Refusal` with `{error, product, reason, message, cure[]}` | parse both, map both onto `denied` (§6) | one parse instead of two |
| `POST /v1/authz/check` declares no request body and no responses | hand-write `policy.check` against §8.2 | policy becomes generatable |
| A policy refusal carries no code of its own, and `Decision.reason` is unpopulated | classify a policy refusal by §6 like any other, and carry `reason` empty | a caller learns which clause refused, and §9's one-clause-vocabulary rule becomes checkable |
| `GET /v1/billing/balance` and `GET /v1/billing/usage` declare no response schema | hand-model `Balance` and `Charge` per §8.1 | budget stops being modelled in three places |
| `POST /v1/knowledge/import` and `POST /v1/framework/{doctype}` declare no response schema | hand-model `Import` and `Doc` per §8.5 | `kb` stops being modelled in three places |
| `GET /v1/audit` accepts no `requestId` filter, though every row carries one | ship `Filter.request`, fall back to `{action, since}` and match `request` client-side | the audit join stops being a client-side scan |
| `GET /v1/audit` declares `pageSize` and `p` as strings | serialize integers as strings at the boundary | nothing else; the SDK types stay integers either way |
| `POST /v1/framework/modules/kb/install` must be called before the first write | expose `kb.install()` (§8.5) | `kb.install` leaves the surface |
| `POST /v1/graph/ingest` validates the body before resolving tenancy — an unauthenticated `POST {}` answers `400`, not `403` | none; the SDK always authenticates | an unauthenticated caller stops learning the validation rules |

Every row above is an observation, not a requirement on cloud. The schema
absences were read from the served document captured on 2026-09-08; the status
codes and the two 402 bodies were read from `cloud/errmap.go`,
`cloud/middleware_spend.go` and `cloud/middleware_billing.go` on 2026-09-10, when
`api.hanzo.ai` was answering `530` at the edge and could not be probed. An
implementer who finds a row no longer true should delete the workaround, not
preserve it.

Per-call cost is not attributable today: no metered response carries the debit,
so a caller wanting to know what a call cost must read `budget.spent` afterwards.
`Answer` therefore carries no `cost` field. A field that is absent is honest; a
field that is present and always empty is not.

### §13 Conformance

An SDK conforms when all of the following hold. Every item is observable from
outside the package.

1. One client type carrying six accessors named `budget`, `policy`, `audit`,
   `search`, `kb`, `graph`, constructed per §2 with the five options and their
   environment fallbacks.
2. Credentials obtained per §3, and no code path that accepts a bearer token or
   reads `HANZO_API_KEY`.
3. `As`/`as_`/`as` per §4, and no method anywhere in §8 taking an org or subject.
4. `Answer<T>` per §5, returned by every method §8 marks gated, with no second
   entry point and no opt-in.
5. Response classification per §6, identical across the three.
6. The methods, types, field names and renames of §8, spelled exactly as written.
7. Shared types declared once per §9.
8. None of the routes in §11 bound.
9. `NewClient(apiKey)`, `HANZO_API_KEY`, `Configuration(access_token=)`, `Read()`
   and `result()` removed. Not deprecated, not aliased, not kept behind an
   option.
10. The hand-written layer sits **over** the generated client, in the same
    package, reading the same served document as the generated code. It is never
    a parallel client and never a second package.

Status per language, as measured on the working trees at 2026-09-08:

| Language | State | What exists that is adjacent |
|---|---|---|
| Go | none of this implemented | `As(subject)` exists, but mints at `POST {issuer}/v1/iam/tokens/issue?id=`, the bespoke verb HIP-0111 §7 forbids, not §4's exchange; `Result[T]` exists but is opt-in, where §5 requires the arm always |
| Python | none of this implemented | `Client` and `as_(subject)`, using the same forbidden verb; `Held` raised by default, which §5 replaces |
| TypeScript | none of this implemented | no hand-written layer of any kind; every file under `src/` is generated |

The three `.spec-lock` files pin the same document digest
(`sha256=2dd32162f86963c080b1139549d593139ba6a3cb30533ef5abaf04881e7ef183`), so
all three generate from identical bytes; the `ref`
recorded beside it differs in `go-sdk`, which is a bookkeeping difference and not
a content one. Conformance requires the digests stay equal.

Rust is out of scope. HIP-0040 covers four languages; this HIP covers the three
whose repositories are public, because §1.3's rule applies to specifications as
well as to dependencies — a conformance claim a reader cannot check is not a
claim. Rust adopts this surface by amendment when its repository is public.

## Rationale

**Why an answer type rather than exceptions.** The obvious alternative is to let
HIP-0040's error classification handle refusals: a 402 becomes a
`PaymentRequiredError`, a 403 a `ForbiddenError`, and the caller catches them.
That is one line shorter at the call site and wrong in two ways. A refusal
carries a cure — an ordered list of ways out — and an exception path is where
callers put the code they wrote once and never look at again. And a refusal is a
normal outcome for a metered call: making the normal outcome an exception inverts
which path gets the attention. The cost of `Answer` is that ten methods return a
type the rest of the SDK does not use. That cost is paid once per SDK, in a layer
of a few hundred lines, and it is the whole reason a caller can act on a denial
instead of logging it.

**Why one word across three languages.** The alternative is to let each language
name things idiomatically — `GetAllowance` in Go, `get_allowance` in Python,
`allowance()` in TypeScript. Idiomatic naming is a real virtue and it is not
worth what it costs here: a team running Python for training, TypeScript for the
front end and Go for the backend then reads three vocabularies for one product,
and every question about behaviour has to be asked three times. Casing is the
language's; the word is the contract's.

**Why a hand-written layer at all, when HIP-0040 exists to avoid one.** HIP-0040's
argument against hand-written SDKs is an argument against hand-writing the
transport, and it holds. This layer writes no transport: it calls the generated
methods and shapes what comes back. It exists because five of the routes it binds
declare too little for a generator to work with (§12), and because the grouping
in §1.2 spans capabilities and therefore spans generated classes, which no
generator can invent. Both of those are conditions of the served document, and
when they change the layer shrinks. It does not become unnecessary: `Answer` is a
client-side decision about how a refusal is presented, and no document could
generate it.

**Why the six, and not five or twelve.** Each of the six is a question a program
asks about its own execution rather than about a user's data — what may I spend,
what may I do, what did I do, what is known, what did we write down, what do we
hold as true. That is what makes them one client. A route that answers a question
about someone else's data belongs to its capability's generated class and is
reached there.

## Security Considerations

**What an out-of-band bearer costs.** §3 is the only place a token enters an
SDK, and it enters as the result of an exchange the SDK performed with
credentials it holds. Accepting a bearer token from the environment — which all
three SDKs do today — moves the decision about who is calling out of the SDK and
into whatever process set the variable. That token is rotated by nobody, scoped
to nothing in particular, and indistinguishable at the server from any other
holder of the same string. The RFC 8707 `resource` parameter is what keeps a
token minted for `api.hanzo.ai` from being replayed against another audience, so
it is not optional and has no default other than the base URL.

**Why a scoped client drops the operator credential.** A scoped client
that kept the operator credential alongside the subject's would present two
answers to who is calling, and which one a server honours becomes a property of
that server's header precedence rather than of the client's intent. The operator
credential leaves with the scope. This is also why no method takes an org: a
tenant argument is a caller asserting its own tenancy, which is the shape of
every cross-tenant read.

**A denial must not become an exception, and an exception must not become a
denial.** §6's last row is the security-relevant one. A `401`, a `5xx` and a
transport failure mean no decision was made. An SDK that reported those as
`denied` would let a caller treat a network partition as a policy answer and
cache it, or show a user a cure for a problem they do not have. The converse
matters as much: an SDK that raised on `402` would push the refusal into a
handler that never reads `cures`.

**Audit is read-only by construction, not by convention.** §8.3 defines no write
method. If one existed, a caller could write rows to the trail that records its
own behaviour. The trail's value rests entirely on its author being the server.

**Why `partial` is a field rather than an inference.** §8.4 requires it as a field a
caller can see. A search that silently returns the surviving backends' results
gives a caller a truncated corpus with the shape of a complete one. Whatever
consumes the result then treats a subsystem outage as a finding that nothing
matched.

**Why enumerating the routes is safe.** The routes this HIP binds are enumerated
in a document HIP-1030 requires to be readable without a credential. That is
safe for the same reason it is safe there: every route named remains individually
authorized, and no route in §8 may rely on a client not knowing its address.

## References

- HIP-0040 — Multi-Language SDK Standard, the generated layer this one sits over
- HIP-0111 — Hanzo IAM Authentication Standard, the credential of §3
- HIP-0139 — Capability, the object §1.2 distinguishes an accessor from
- HIP-0526 — Semantic Memory, the substrate under the graph
- HIP-1030 — OpenAPI, the served contract §11 defers to
- HIP-1041 — Authz, the policy question of §8.2
- HIP-1101 — Allowance, the free lane's ceiling read by `budget.left`
- HIP-1103 — Audit, the tamper-evident trail read by `audit.list`
- HIP-1126 — Framework, the DocType engine `kb` writes through
- HIP-1147 — Search, hybrid retrieval
- HIP-1198 — Graph, the assertion plane at `/v1/graph`
- HIP-1202 — Entitlement, what an org may run, read by `budget.plan`
- HIP-1220 — Commerce, the merchant half that answers the money reads
- HIP-1260 — Knowledge, documents and their vector index
- `github.com/hanzoai/semantic` — the reference implementation of HIP-0526
- RFC 2119 — Key words for use in RFCs
- RFC 3339 — Date and Time on the Internet: Timestamps
- RFC 6749 §4.4 — The OAuth 2.0 client credentials grant
- RFC 8707 — Resource Indicators for OAuth 2.0
- RFC 9457 — Problem Details for HTTP APIs

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
