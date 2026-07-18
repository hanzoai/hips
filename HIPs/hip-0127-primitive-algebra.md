---
hip: 0127
title: The Primitive Algebra — Eleven Primitives, Thin Products, One Way
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2026-07-16
requires: HIP-0106, HIP-0111, HIP-0118, HIP-0119, HIP-0122, HIP-0126
---

# HIP-0127: The Primitive Algebra — Eleven Primitives, Thin Products, One Way

## Abstract

Hanzo Cloud grew to roughly a hundred subsystems. Read them as an estate and
they look like a hundred products; read them as an **algebra** and they collapse
to **eleven primitives** — the irreducible questions a tenant-scoped request
answers — plus **products**, which are thin compositions over those primitives
and implement none of their logic.

This HIP names the eleven, states the **naming law** that keeps them singular and
orthogonal, and defines the **composition model** every product obeys: a product
declares Schemas, attaches Policies, writes Ledger facts, and exposes a Gateway
surface, inheriting persistence, tenancy, audit, and metering from the primitives
it composes. Domain logic lives in a primitive **exactly once**; a product is a
name, a surface, and configuration over primitives it never re-implements.

It is the meta-standard the domain "one way" HIPs instantiate. HIP-0126
(Integrations) is one product family expressed in this algebra; every future
domain HIP is another. The proof is already in tree: **iam2** — the entire IAM
subsystem re-expressed as a `Principal` over `hanzoai/orm` served by `zip`, with
identity, org, role, permission, and audit as ordinary Resources — beego-free,
Casdoor-free, mounted into the unified binary like any other product.

## Motivation

The estate accreted the way estates do: each capability arrived as its own repo,
its own vocabulary, its own storage, its own idea of who the caller is and what
they are allowed to do. The result was not a hundred *different* systems. It was
one system's handful of concerns, **complected** — braided together — a hundred
different ways.

Every tenant-scoped request, in every one of those subsystems, answers the same
small set of questions:

1. **Who** is acting? (identity)
2. **In whose boundary?** (tenant)
3. **On what typed record?** (resource)
4. **Are they allowed?** (policy)
5. **What happened?** (fact)
6. **How much?** (measure)
7. **When / on what trigger does work run?** (schedule)
8. **How does a message move?** (transport)
9. **Who brokers the request at the edge?** (gateway)
10. **Where do the bytes live?** (store)
11. **What is the value?** (money)

Those eleven questions **are** the primitives. They are irreducible: no two of
them always co-vary (if they did, they would be one), and none of them ever
splits cleanly into two independent decisions (if one did, it would be two). A
subsystem is not a primitive — it is an *answer stack*, a particular way of
wiring these eleven together and giving the bundle a product name. When a
hundred answer stacks each re-implement "are they allowed?" you get a hundred
authorization bugs, a hundred audit formats, and a hundred places to fix one
CVE.

The compound names are the tell. `auditlog` braids a **Ledger** (append-only
facts) with a **Meter** (a measure over facts). `featuregate` braids the
**Policy** decision with Policy storage. `connectorruntime` braids **Schedule**
(when work runs) with the connector product that schedules it. A compound
identifier is two concepts folded into one word; the fold is the defect.

Decomplecting the estate is not a rewrite. It is **subtraction**: delete each
re-implementation and call the one primitive that already owns the concern. iam2
is the first subtraction carried all the way through — and the substrate it runs
on (`hanzoai/orm`, `zip`, the `framework` DocType engine) is the shared home the
other products subtract *into*.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as in RFC 2119.

### §1 Scope — the application-domain algebra

This HIP governs the **application-domain** algebra: the primitives every
tenant-scoped product composes. Two adjacent layers are explicitly **out of
scope and orthogonal**, referenced but never absorbed:

- **Substrate** — the wire and the server core: ZAP (HIP-0114 / HIP-0120), `zip`
  (HIP-0122), `hanzoai/orm` (HIP-0029), the extension runtime (HIP-0105). The
  primitives *ride* the substrate; they are not members of it.
- **Security primitives** — KMS secrets (HIP-0027), Guard (HIP-0051), PQC
  (HIP-0005). Their own orthogonal, complete set. This algebra consumes them; it
  does not restate them.

### §2 The eleven primitives

A **primitive** is a place where one kind of domain logic lives exactly once. It
is named for what it **is** — an academic noun for the concept, never a compound.

| # | Primitive | What it IS (signature) | Absorbs (the braided names) |
|---|---|---|---|
| 1 | **Principal** | authenticated actor; `Bearer → (Tenant, name, rights)` | iam · account · session · user · login |
| 2 | **Tenant** | isolation boundary; the value every row is keyed by | org · company · team · workspace · namespace |
| 3 | **Resource + Schema** | typed tenant-scoped record + its definition; `Schema: name→shape`, `Resource: (Schema, Tenant, fields)` | framework DocType · model · entity · doc |
| 4 | **Policy** | decision; `(Principal, context) → verdict ∈ {allow, deny}` | featureflags · featuregate · authz · entitlements · permission · RBAC |
| 5 | **Ledger** | append-only facts / value; `append(fact)`, read = ordered facts, never update, never delete | finance-ledger · auditlog · metering-events · eventlog |
| 6 | **Meter** | measure; a **fold** over a Ledger → number \| series | usage · analytics · o11y · metrics · insights |
| 7 | **Schedule** | triggered work; `trigger → Job` (durable, at-least-once) | tasks · cron · automations · connectorruntime · workflow |
| 8 | **Bus** | message transport; `publish(topic, msg) → deliver` | pubsub · kafka-adaptor · mq · amqp · nats |
| 9 | **Gateway** | request broker; `request → (terminate, mint Principal, apply Policy, route)` | gateway · ingress · gatewaypolicy · apigateway · edge |
| 10 | **Store** | durable opaque bytes; `put(key, bytes) / get(key)`, tenant-scoped | storage · s3admin · provisioning · vfs · objectstore |
| 11 | **Money** | immutable value; `(amount:int, currency)`, exact, no float | money · price · balance |

The three persistence primitives are distinct on purpose and MUST NOT be
conflated: **Resource** is a mutable typed record (has a Schema, tenant-keyed),
**Store** is opaque addressed bytes, **Ledger** is append-only ordered facts.
Three shapes, three homes. Folding any two into one is the classic complection.

### §3 The naming law (normative)

1. **Say what it is.** A primitive's name is an academic noun for the concept
   (`Principal`, `Tenant`, `Ledger`, `Meter`, `Bus`). A product's name is a
   concrete noun for what it does (`Commerce`, `Chat`, `Console`, `Login`).
2. **No compound words.** A compound identifier braids two concepts; decompose
   it and give each half to its primitive. `auditlog → Ledger`, `featuregate →
   Policy`, `connectorruntime → Schedule`, `gatewaypolicy → Gateway`,
   `objectstore → Store`. The only surviving compound is a deprecated back-compat
   alias, never a new name.
3. **Academic noun for the primitive, concrete noun for the product.**
   `Principal` (primitive) is surfaced by `Login` (product). `Ledger` (primitive)
   is surfaced by `Finance` (product). The primitive is *what it is*; the product
   is *what it does with it*.
4. **Singular.** `Resource`, not `Resources`. Plurality is not decoration — where
   singular and plural denote genuinely different values they are kept (see §6:
   `agent` the engine vs `agents` the catalog); otherwise the plural is drift and
   MUST be collapsed (`plans → plan`).

### §4 The composition model (normative)

A **product** is defined by what it **composes**, never by what it implements:

> A product **declares Schemas**, **attaches Policies**, **writes Ledger facts**,
> and **exposes a Gateway surface** — and **inherits** persistence, tenancy,
> audit, and metering from the primitives it composes. It implements **no**
> primitive logic of its own.

Formally, `Product = ⟨ Schemas, Policies, Ledger-writes, Gateway-routes ⟩` over
the shared primitives. Every product runs on **one ORM** (`hanzoai/orm`) and
**one protocol** (`zip` on ZAP). A product that ships its own authorization
engine, its own audit format, its own tenant-keying, or its own ORM is
**nonconformant** — it has re-implemented a primitive that already exists.

**Worked example — Chat.** The Chat product is `Schema[Message, Conversation]` +
`Policy`(who may read a Conversation) + `Ledger`(message-sent facts) +
`Meter`(tokens consumed) + `Gateway`(`/v1/chat`) + `Store`(attachments) +
`Money`(per-token debit, via the Commerce product). It writes no persistence
layer, no authz check, no tenant filter — it inherits all three. The
irreducibly-*Chat* part is the `Message` schema and the streaming route; that is
perhaps a tenth of the surface. The other nine-tenths is composition. This is the
HIP-0122 **76:1** core-to-plugin measurement restated at the domain level: the
primitives are the small shared core; products are the thin mounts.

Inheritance is not optional and not per-product configuration:

- **Persistence** — every Resource is an `orm.Model[T]`, one `orm.DB`.
- **Tenancy** — every read is scoped by the caller's `Principal.Tenant`; a
  request parameter can never widen a read beyond the caller's authority.
- **Audit** — every privileged mutation appends a Ledger fact, one format.
- **Metering** — every billable action is a Meter fold over that Ledger.

### §5 Products and the domain HIPs

This HIP is the **meta-standard**; each domain "one way" HIP is an
**instantiation** — it picks a slice of the algebra and states the single shape
for that slice, without re-deriving the primitives.

- **HIP-0126 (Integrations)** instantiates the algebra for external capability:
  one Integrations registry (Connector · Provider · Tool) is a `Resource`
  family, connect/authorize/revoke is a `Policy`-gated lifecycle, credentials are
  a KMS-sealed `Store`, and Flows are a product over `Schedule`. It names no new
  primitive; it composes existing ones.
- A future **Commerce** HIP instantiates `Money` + `Ledger` + `Schedule` +
  `Gateway`; a future **Content** HIP instantiates `Resource` + `Policy` +
  `Store`. Each domain HIP MUST cite this one and MUST NOT restate a primitive.

New primitives are not minted casually. A twelfth primitive is admissible **only**
under the same discipline the platform applies to any abstraction: three proven
concrete cases that share an irreducible concern no existing primitive owns.
Absent that, a "new primitive" is a product, and it composes the eleven.

### §6 The de-duplication ledger

The algebra is not aspirational; these are the concrete first cuts. **Verdict** is
one of: **Merge** (fold into an existing home), **Delete** (subsumed, not its own
thing), **Rename** (naming law), **Reclassify** (belongs to a different concern),
**Keep** (distinct value, not a duplicate).

| From | Verdict | Into / Home | Why |
|---|---|---|---|
| `featuregate` | Merge | `featureflags` → **Policy** | One gate function; a flag is a Policy input, not a second engine |
| `session` | Delete | **Principal** | A session is a Principal materialized from a bearer; not a subsystem |
| `o11y` (double-wired) | Merge | **Meter** | Was wired twice; collapse to one measure path |
| `plans` | Rename | `plan` (Commerce facet) | Singular law |
| `cron` | Merge | `tasks` → **Schedule** | A trigger, not a second scheduler |
| `connectorruntime` | Merge | `automations` → **Schedule** | Runtime is not a thing; automations is the product over Schedule |
| `tracker` | Keep | `/v1/tracker` | Per-org issue tracker (projects/issues, Linear-style) — a distinct product, NOT a Meter |
| `gojabase` | Rename | `goja` (HIP-0105 runtime) | No compound; "base-ness" is not part of the runtime's name |
| `ads` | Rename | `marketing` (product) | Concrete noun for what it does |
| `cms` | Rename | `content` (product) | Say what it is; kill the acronym |
| `referrals`, `affiliates`, `authors` | Merge | `payout` (product; **Ledger** + **Money**, HIP-0075) | Three names for "pay an external contributor" |
| `agent` (engine) + `agents` (OSS catalog) | Keep | — | Engine *executes*; catalog is a `Resource` listing — a real value distinction |
| `commerce` · `finance` · `money` · `treasury` | Keep | **Money** | Different compositions over Money, not duplicates (checkout / books / value / reserves) |
| security primitives (KMS · Guard · PQC) | Keep | — | Orthogonal security layer (§1); complete on their own |
| `billing` | Reclassify | Commerce facet | Not its own subsystem; a facet over Money + Ledger |
| `visor` | Reclassify | `compute` (`vm`) | A machine/compute concern, not a monitoring subsystem |
| `product` | Reclassify | `search` / `vector` | The "product" subsystem is a search/vector concern (**Resource** + **Meter**) |
| `graph` | Reclassify | `indexers` / `oracles` | A graph is an index over facts (**Ledger** + **Meter**) |

The discipline that stops de-duplication from over-merging: **two names are a
duplicate only if they answer the same irreducible question.** `commerce` and
`finance` both touch `Money`, but commerce answers "take a payment" (`Gateway` +
`Money` + `Schedule`) and finance answers "keep the books" (`Ledger` + `Money`) —
different compositions, so they stay distinct. `agent` and `agents` differ by one
letter and by their entire nature. Keep is as principled as Merge.

## Rationale

**Simple is not easy.** Splitting one `auditlog` subsystem into `Ledger`
(append-only facts) and `Meter` (a measure over facts) is *more* to type, not
less. It is not easier. It is **simpler** — Latin *simplex*, one fold — because
each resulting thing has exactly one role. Easy is deleting the file and moving
the problem; simple is giving each concept its own place so the problem stops
recurring. The eleven primitives optimize for simple, permanently, at the cost of
easy, once.

**Complecting is the enemy.** Every compound name in the estate is a braid, and
every braid is a place two concerns move together when they should move
independently. Decomplecting them is the entire program; the naming law (§3) is
just complection made visible in identifiers so it cannot hide.

**Values, not places.** `Money` is a value — `(amount, currency)`, immutable,
exact — not a column in a `balances` table. `Tenant` is a value that scopes, not
a service you call. Dropping the place-qualified, compound names turns places
back into values: `objectstore` (a place) becomes `Store.get(key) → bytes` (a
value returned). Values compose; places entangle.

**Orthogonal and complete.** Each primitive sits at its own slot and is
independently complete. `Ledger` does not know `Meter` exists; `Meter` folds over
`Ledger`. `Store` (opaque bytes) is orthogonal to `Resource` (typed records) is
orthogonal to `Ledger` (append-only facts). `Money` (the value) is orthogonal to
`Ledger` (the movement of that value). You can reason about, test, and replace
any one without touching the others — the definition of orthogonal.

**Composition over inheritance.** A product **wraps** primitives; it never
**extends** them. Chat is not a subclass of anything — it is `Resource[Message]`
+ `Policy` + `Ledger` + `Meter` + `Gateway` + `Store` + `Money`, assembled.
Hammock-driven composition, not a type hierarchy.

**Decide once.** The payoff is a single answer to each of the eleven questions.
"Are they allowed?" is decided in `Policy`, once, by one function; a hundred
products asking it call that function. One place to get authorization right, one
place to fix it, one audit format to reason over. That is why the algebra is
worth the up-front cost of subtraction.

## Backwards Compatibility

**None. Forward-only.** This HIP renames concepts and relocates logic; it
introduces no wire break because **the primitives predate the products** —
`hanzoai/orm`, `zip`, the `framework` DocType engine, and iam2 already exist and
already own their concerns. Migration is therefore **subtraction**: a product
deletes its re-implementation and calls the primitive. There is no compatibility
shim, no parallel path, no `/v2`.

The naming cuts (§3, §6) are applied **at the source** — identifiers, routes,
JSON fields, comments, docs — not aliased. Where a single live wire name is
load-bearing (a persisted schema, a stored flow-graph discriminant), the rename
is **staged exactly as HIP-0126 stages the flow-step schema**: the external byte
name is retained as a deprecated alias for one migration window while the
**primitive is authoritative from day one**. A deprecated alias is the only
compound name permitted to survive, and only until its consumers rebase. One way;
no backward compatibility as a steady state.

## Reference Implementation

**iam2 is the thesis carried all the way through one subsystem.** It is a
clean-room, proprietary rewrite of the Casdoor-fork identity layer on the native
stack — `github.com/zap-proto/zip v1.8.3` (HTTP served on the ZAP-native core,
HIP-0122) over `github.com/hanzoai/orm v0.6.1`. **Zero beego, zero xorm, zero
Casdoor** (`grep -rl beego` over the Go source returns nothing). It resolves the
co-residence blocker directly: the old IAM could not mount inside `cloud` because
beego owns global HTTP state; iam2 on `zip + orm` mounts like any other product.

The algebra, made concrete:

- **Principal** is literally `internal/authz/authz.go`:
  `type Principal struct { Org, User string; Admin, Super bool }`, resolved from a
  verified bearer. It is the primitive, not a bespoke session object.
- **Tenant** is enforced by `authz.Scope(ctx, owner)` — "a request parameter can
  never widen a read beyond the caller's authority; the one value authorized is
  the one value queried." Org is the tenant, taken from the subject, never from
  input.
- **Resource + Schema**: every IAM concept is an `orm.Model[T]` registered once —
  `orm.Register[User]`, `[Organization]`, `[Application]`, `[Provider]`,
  `[Role]`, `[Permission]`, `[Cert]`, `[Key]`, `[WebauthnCredential]`,
  `[Session]`, `[Token]` — over one `orm.DB` that is backend-pluggable across
  SQLite, `hanzoai/sql` (ZAP), and `hanzoai/datastore` (ZAP). Every handler is
  written once against `orm.DB`, never against a driver. The typed-record engine
  is the same `framework` DocType engine (`cloud/clients/framework`:
  `doctype.go`, `naming.go`, `permission.go`, `module.go`) that every other
  product's Resources use.
- **Policy** is `Role`/`Permission` Resources evaluated by the guard — the same
  `(Principal, context) → verdict` shape as `framework`'s
  `access.can(dt *DocType, right string) bool`. One decision function, not a
  featuregate.
- **Ledger** is the `AuditLog` Resource: append-only facts, one format.
- **`session` is Deleted as a primitive** and demonstrated as such: it survives
  only as an ordinary `Session` Resource that *yields* a `Principal` — it is not
  its own subsystem.

iam2 mounts into the unified binary through the HIP-0106 / HIP-0122 contract,
`server.Mount(app *zip.App, db orm.DB)` — the **same** Principal serves
standalone and embedded. Identity stopped being a bespoke subsystem and became
`Resource[identity-kinds] + Policy + Ledger + Principal` on the shared
primitives. That reduction, reproduced product by product, is this HIP.

The primitive homes referenced above are themselves the reference
implementations of their slots:

- **`hanzoai/orm`** — the one ORM; `Model[T]`, `Register[T]`, one `orm.DB` over
  SQLite / `sql` (ZAP) / `datastore` (ZAP). Replaced 112 hand-written model
  packages.
- **`cloud/clients/framework`** — Resource + Schema: a Frappe-faithful DocType
  engine (`DocType{Fields []DocField}`, autoname, per-org fixtures, permission).
- **`zap-proto/zip`** — the one protocol/server core (HIP-0122); the 76:1
  core-to-plugin ratio is the composition model measured.

## References

- HIP-0005 — Post-Quantum Security (security primitive; orthogonal)
- HIP-0027 — Secrets Management / KMS (security primitive; orthogonal)
- HIP-0029 — Relational Database Standard (`hanzoai/orm`, the one ORM)
- HIP-0051 — Guard Security (security primitive; orthogonal)
- HIP-0075 — OSS Contributor Payout (the `payout` product; Ledger + Money)
- HIP-0105 — In-Process Extension Runtime (`goja` runtime; the `gojabase` cut)
- HIP-0106 — Unified Hanzo Cloud Binary (products as mounts; the host)
- HIP-0110 — Gateway as Edge Process (the Gateway primitive)
- HIP-0111 — IAM Authentication Standard (the Principal surface)
- HIP-0114 / HIP-0120 — ZAP transport (substrate; orthogonal)
- HIP-0118 — SuperAdmin & Tenant Isolation (the Tenant primitive)
- HIP-0119 — Hanzo Service Conventions (one service shape)
- HIP-0122 — zip: the ZAP-Native Application Server Core (76:1 composition)
- HIP-0126 — Integrations, Connectors & the Extension Runtime (first instantiation)
- Rich Hickey, *Simple Made Easy* — complect / simple-vs-easy / values-not-places

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
