---
hip: 0129
title: Eval — The Judgment Plane
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-07-27
requires: HIP-0031, HIP-0106, HIP-0111, HIP-0114, HIP-0119, HIP-0120, HIP-0122
---

# HIP-129: Eval — The Judgment Plane

## Abstract

`hanzoai/eval` is the third plane of the Hanzo AI surface and its own subsystem
repo. Three planes, orthogonal:

| Plane | Question | Direction | Owns |
|-------|----------|-----------|------|
| **o11y** | what happened | passive, derived from events | spans, logs, metrics — **read only** |
| **ai**   | do the thing  | inference | models, completions, embeddings |
| **eval** | was it good   | judgment | dataset, judge, rubric, experiment, run, score, queue |

eval **consumes** o11y and **calls** ai. Neither depends on eval, and neither may
ever. That single-direction edge is the whole justification: judgment is a
different concern from observation and from inference, so it is a different plane,
with its own repo, its own store, its own routes, and its own name. Repo hygiene is
not the argument — an acyclic dependency graph is.

The plane exists today, dissolved into two others. `cloud/clients/eval` serves
`/v1/evals/*`; o11y serves a **write** endpoint, `POST /api/annotation`, inside a
read plane; `cloud/clients/o11y` serves a *second*, unrelated annotation-queue
entity at `/v1/o11y/annotation-queues` on its own SQLite file. One resource, three
owners, so none of them kept it in sight of the others — which is why the console
calls `/v1/o11y/annotation-queues` against a server that also registers
`/api/annotation`, and neither side is wrong. This HIP does not patch that
mismatch. It moves the resource to the plane that owns it, after which the mismatch
is not expressible.

## Motivation

A score is not an observation. An observation is a fact the system emitted about
itself; a score is a *verdict* a judge — a model or a human — pronounced about that
fact. Storing verdicts in the observation plane forces that plane to accept writes,
and a plane that accepts writes is no longer derivable from events. That is how
o11y grew a `POST`, a mutable `llm_scores` table with a `DELETE`, and a free-text
`queue` column naming a queue entity that lives in a different repo.

Judgment also costs money — a judge run is inference — so the plane that issues
verdicts must be the plane that is billed, on the one payer path, or the cost lands
under the wrong owner. And judgment must be observable *by the plane it observes*:
an eval run that emits no spans is a black box asking to be trusted.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as
in RFC 2119.

### §1 The plane, and the direction of the edge

`hanzoai/eval` MUST depend on o11y and ai only through their public surfaces, and
o11y and ai MUST NOT depend on eval — not by import, not by module requirement, not
by a table one of them reads. A build of either that resolves `hanzoai/eval` in
`go list -deps` is a defect, not a convenience.

Consequences, stated so they are not re-argued:

- Anything eval takes from o11y or ai is a **read**. eval MUST NOT write to a table
  another plane owns — in particular `hanzo.cloud_usage`, which is ai's metering
  warehouse (HIP-0106) and never a second observation store.
- Anything that only *aggregates* what already happened is observability, not
  judgment, and MUST NOT live on this plane. `GET /v1/evals/metrics` — which reads
  `hanzo.cloud_usage` and the o11y span index and writes nothing — is an o11y board
  mis-homed on eval; it moves to o11y and does not reappear under `/v1/eval`.
- eval is the only plane that stores verdicts. There is exactly one score store.

### §2 What eval owns

| Resource | It is | Store |
|----------|-------|-------|
| **dataset** | a named set of inputs, with items | metastore |
| **item** (of a dataset) | one input, identified within its dataset | metastore |
| **judge** | a named evaluation method — `kind: model` (LLM-as-judge) or `kind: code` | metastore |
| **rubric** | the definition a verdict is produced against and validated against: numeric with bounds, categorical with a label set, or boolean | metastore |
| **experiment** | a named comparison that groups runs | metastore |
| **run** | one execution of a judge over a dataset, with its per-item results | metastore (rollup) + OLAP (items) |
| **score** | one verdict — value, rubric, source (`model` \| `code` \| `human`), optional comment | OLAP, append-only |
| **queue** | a queue of items awaiting **human** judgment, with items and assignment | metastore |

Two renames, both from first principles, both narrowing a name to what it is:

- `evaluator` → **judge**. It judges. `ai/object/eval_judge.go` already calls the
  type `JudgeRubric` and the entry point `RunJudge`; the resource takes the name the
  code already uses.
- `score-config` → **rubric**. It is the criteria and the admissible range of a
  verdict, which is what a rubric is, and it is one word rather than two.

One deletion. **There is no `annotation` resource.** What `POST /api/annotation`
wrote was a verdict with an author and no rubric — a score, missing its definition.
A human's output on this plane is a **score with `source: human`**, validated
against the same rubric a model judge is validated against. The queue is what routes
work to the human; the score is what the human produces. Deleting the noun is what
makes the three-way seam unrepresentable rather than merely fixed.

### §3 Route surface — one prefix, `/v1/eval`, singular throughout

Every eval endpoint MUST live under `/v1/eval` and MUST follow the resource-name
grammar (HIP-0119 §2): the resource is named **once**, in the singular, and the HTTP
method carries collection-versus-item. `POST /v1/eval/dataset` creates one;
`GET /v1/eval/dataset` lists them; `GET /v1/eval/dataset/{name}` reads one.

Nesting rule: a child is nested **only when its identifier is scoped by its parent**
(a dataset item's id means nothing without its dataset). A resource with its own
id, unique within the org, is flat and filtered by query parameter. Compound
segments (`dataset-items`, `score-configs`, `annotation-queues`) are the shape this
rule replaces, and MUST NOT appear.

| Method | Path | Notes |
|--------|------|-------|
| POST · GET | `/v1/eval/dataset` | create · list |
| GET · DELETE | `/v1/eval/dataset/{name}` | read (with item count) · delete (with its items, one tx) |
| POST · GET | `/v1/eval/dataset/{name}/item` | create · list |
| GET · PATCH · DELETE | `/v1/eval/dataset/{name}/item/{id}` | an item MUST NOT change dataset |
| POST · GET | `/v1/eval/judge` | create · list |
| GET · PATCH | `/v1/eval/judge/{name}` | |
| POST · GET | `/v1/eval/rubric` | create · list |
| GET · PATCH | `/v1/eval/rubric/{name}` | |
| POST · GET | `/v1/eval/experiment` | create · list |
| GET | `/v1/eval/experiment/{id}` | |
| POST · GET | `/v1/eval/run` | start a run · list, `?experiment=` `?dataset=` |
| GET | `/v1/eval/run/{id}` | rollup |
| GET | `/v1/eval/run/{id}/item` | per-item results |
| POST · GET | `/v1/eval/score` | record a verdict · list, `?run=` `?item=` `?trace=` |
| GET | `/v1/eval/score/{id}` | |
| POST · GET | `/v1/eval/queue` | create · list |
| GET · PATCH · DELETE | `/v1/eval/queue/{id}` | |
| POST · GET | `/v1/eval/queue/{id}/item` | enqueue · list |
| GET · PATCH | `/v1/eval/queue/{id}/item/{itemId}` | |
| PUT · DELETE | `/v1/eval/queue/{id}/item/{itemId}/assignment` | claim · release |
| GET | `/v1/eval/health` | eval's own probe, §5 |

A score MUST NOT be updated or deleted. A verdict is the record of a judgment that
was made; a retraction is a **new score**, not an edit of the old one. The OLAP
engine enforces this by construction, and no route may work around it — which is
precisely why `DELETE /api/score/{id}` does not survive the move.

Static sub-routes MUST be registered before their `{param}` siblings, so a real
dataset name can never shadow a collection route.

### §4 Annotation moves off o11y

The following are **removed**, not aliased:

- o11y: `GET /api/annotation`, `POST /api/annotation`
  (`pkg/apiserver/o11yapiserver/llmobs.go`) and the `llm_annotations` table.
- o11y: `GET`/`POST /api/scores`, `GET`/`DELETE /api/score/{id}` and `llm_scores`.
  Score is a verdict; verdicts live on one plane, and it is not the read plane.
- cloud: `cloud/clients/o11y/annotation_queues.go`, its eight
  `/v1/o11y/annotation-queues*` routes and its `o11y_annotations.db` metastore.

o11y keeps exactly what it is: the passive span, log and metric views
(`/v1/o11y/observations`, `/traces`, `/sessions`, `/users`), which read and never
write. A `POST` in a read plane is the defect; deleting it is the fix. Because the
queue and the verdict now have one owner under one prefix, the console's
`/v1/o11y/annotation-queues` call against a server registering `/api/annotation`
cannot be written at all — there is no second spelling left to disagree with. A
correct boundary does not need two sides kept in sync; it makes the disagreement
unrepresentable.

### §5 The subsystem contract

eval is a Hanzo service (HIP-0119) and a cloud subsystem (HIP-0106). It MUST be:

**ZAP-native.** Routes are registered on `*zip.App` (HIP-0122); transport is HTTP +
ZAP (HIP-0114/0120). No gRPC — not on the wire, not in the module graph. No `/api/`
prefix anywhere, per HIP-0119 §2/§9.

**Mounted as data, with no dependency cycle.** `hanzoai/eval` exports
`Mount(app *zip.App, deps eval.Deps) error` and
`Shutdown(ctx context.Context) error`, where `eval.Deps` is a small set of
**interfaces eval declares itself** — logger, data directory, durability, an
inference seam, a datastore seam, a meter seam. `hanzoai/eval` MUST NOT import
`hanzoai/cloud`. This is deliberate, and it is not how o11y does it: o11y's `Mount`
takes `cloud.Deps`, so `o11y/go.mod` requires `hanzoai/cloud` *and* carries
`replace … => ../cloud`, which makes the pinned version and the CI checkout ref one
fact in two places. A new plane MUST NOT inherit that tax.

Cloud names eval in exactly two places: a thin adapter in `cloud/clients/eval` that
fills `eval.Deps` from `cloud.Deps`, and one line in `apps.Wire()`:

```go
{Name: "eval", Mount: eval.Mount, Shutdown: eval.Shutdown, OwnsHealth: true},
```

Slice position IS mount order (`cloud.MountSpec` has no order field); `MountAll`
registers `Shutdown` via `app.OnShutdown`, which zip drains LIFO after in-flight
requests. Wiring `Shutdown` is REQUIRED: today's `eval.Shutdown` exists and is never
wired, so the metastore handle is not closed on SIGTERM. `OwnsHealth: true`
suppresses the generic always-ok route; `GET /v1/eval/health` MUST return `200` when
the metastore is open and report OLAP availability in its body. It MUST NOT return
`503` merely because the OLAP store is absent — that degradation is per-route (§9).

**Org-keyed and fail-closed.** Org is the only tenant key, on every read and every
write. Every handler MUST resolve the tenant *first*, via `principal.Validated(c)`
then `principal.Org(c)`, and MUST `403` when either fails. A handler MUST NOT read
`X-Org-Id` (or any identity header) directly: `SanitizeIdentity` strips and re-mints
those headers, but it restores a client-supplied `X-Org-Id` on the bearer-less path
for data scoping — so an org without a validated principal is forgeable, and only
the `Validated` gate closes it.

The org string MUST be used **verbatim**: never lowercased, never trimmed, never
folded. Normalizing collapses distinct owners into one storage bucket and puts the
authorization check and the storage key on different values. Metastore tables MUST
carry a NOT NULL `org` column with a composite `(org, id)` primary key — a global id
primary key is a cross-tenant existence oracle. OLAP tables MUST order by `org`
first, so a tenant read is a prefix scan. `principal.ProjectScope(c)` narrows within
an org; it never widens. `principal.IsSuperAdmin(c)` MAY drop the org predicate only
on an explicitly fleet-wide read, and §3 defines none.

**Metered on the one payer path.** Judge inference is inference: it MUST be issued
through the ai seam **carrying the caller's identity**, so ai's own path meters it
into `hanzo.cloud_usage` exactly once. eval MUST NOT write `cloud_usage`, MUST NOT
construct a second `metering.Client`, and MUST NOT re-derive who pays. Data scope
reads `principal.Org`; money reads `principal.HomeOrg` / `principal.WalletOf`, whose
answer comes from `hanzoai/account.Payer` and nowhere else — the gate and the debit
must address the same wallet, a split that has already shipped wrong twice.

Where eval charges for its own resources, it uses the one in-handler sequence:

```go
fee := cloud.ResourceFeeCents("EVAL", kind)
_, projectValidated := principal.ValidatedProject(c)
if err := bill.Gate(c.Context(), principal.HomeOrg(c), project, projectValidated, kind, fee); err != nil {
    return cloud.DenyResource(c, err)
}
// … do the work …
bill.Meter(principal.HomeOrg(c), project, kind, fee, c.RequestID(), cloud.ClientIP(c))
```

`bill` is the `*cloud.ResourceMeter` that `cloud.NewBase(deps, "eval")` supplies,
with provider `eval`. A run MUST be gated **before** the first judge call and MUST
NOT write a score when the gate denies.

**Observable by the plane it observes.** eval MUST emit spans from the **global**
tracer provider (`otel.Tracer("hanzo-eval")`), parented from `c.Context()` — cloud
installs the one provider before mounting subsystems and calls
`aiobject.AdoptHostTracerProvider()` so ai's `gen_ai` spans share it. eval MUST NOT
construct a provider or an exporter of its own.

Run, item and judge spans MUST carry `gen_ai.hanzo.org_id` set to the caller's org —
o11y's llmobs views hard-filter on it, and a span without it is invisible. eval adds
`eval.run.id`, `eval.dataset`, `eval.item.id`, `eval.judge`, `eval.rubric`,
`eval.score.name`, `eval.score.value`, `eval.score.source`. Cost attributes
(`_o11y.gen_ai.*`) belong to ai and MUST NOT be re-emitted by eval — one cost
vocabulary, emitted by the plane that knows the price.

### §6 Storage

Two stores, one seam each.

**Metastore** — encrypted SQLite (`cek`) under `DataDir`, opened through
`cloud.OrgDB` / `cloud.NewOrgStore` with `cloud.WithDurable` so it survives a rolling
deploy on the HA plane (HIP-0107). It holds dataset, item, judge, rubric,
experiment, run rollup, queue, queue item and assignment. Natural keys are unique
**within an org** (`(org, name)`), never globally.

**OLAP** — scores and per-item run results, over the **shared** datastore client
(`aiobject.DatastoreEnabled`, `DatastoreExec`, `DatastoreQuery`). eval MUST NOT open
its own datastore connection: the pool, the retries, and the KMS-injected
credentials live in exactly one place. Tables are append-only, partitioned by month,
ordered by org first; every predicate is a bound parameter, never interpolated; and
every list route is bounded by a server-side limit.

SQL identifiers are not URL paths. The grammar of §3 governs the route surface; the
existing table names (`hanzo.eval_traces`, `hanzo.eval_scores`) are data at rest and
are NOT renamed by this HIP — renaming them buys nothing and costs a migration.

### §7 Bounds instead of a queue

eval bounds work rather than queueing it: a per-org concurrent-run cap that returns
`429` immediately (runs are never queued — the only queue on this plane is the human
one), a wall-clock run deadline, a per-run item cap, and content and comment size
caps. Fail fast and say so; a silent backlog is a worse answer than a refusal.

### §8 Judge

A judge is `kind: model` or `kind: code`.

A **model** judge MUST validate its verdict against the named rubric before the
score is recorded, and MUST fail the item when the reply cannot be parsed against
that rubric. It MUST NOT default an unparseable verdict to a value — a fabricated
zero is worse than a recorded failure. Untrusted content (the item, the model's
output) MUST be delimiter-fenced and never concatenated into the instruction.
`ai/object/eval_judge.go` (`JudgeRubric`, `RunJudge`, `parseVerdict`) is the
implementation of record; eval MUST NOT ship a second, weaker judge parser beside
it, which is what `cloud/clients/eval/runner.go` is today.

A **code** judge is a deterministic function of `(input, output, expected)` returning
a value admissible under its rubric. Where it executes is an open question.

### §9 Degraded, honestly

With no OLAP store configured, eval MUST serve dataset, item, judge, rubric,
experiment and queue from the metastore, MUST return `503` from the score and run
routes, and MUST report the degradation on `/v1/eval/health`. It MUST NOT fabricate
an empty result that reads as a real one.

### §10 Forbidden

- A dependency edge from o11y or ai to eval.
- A write endpoint in the o11y plane; a second score store; a mutable or deletable
  score.
- An `annotation` resource, or any second spelling of the queue.
- A plural, compound, or `/api/`-prefixed path segment; a second prefix aliasing
  `/v1/eval`.
- Reading an identity header directly; an org normalized before it is used as a key;
  a global-id primary key on a tenant table.
- A second billing path, a second `metering.Client`, a write to `cloud_usage`, or a
  fee charged to any org but the payer's.
- A tracer provider, an exporter, or a datastore connection of eval's own.
- An aggregate-only dashboard on this plane.

## Migration

One release; the old spellings are removed, not aliased — two ways to say one thing
is the defect this HIP exists to remove.

1. Stand up `hanzoai/eval` with `Mount`/`Shutdown` over `eval.Deps` (no `cloud`
   import), porting `cloud/clients/eval` and its ~40 tests, which are the real
   specification of the current behavior.
2. Add the adapter and the one `apps.Wire()` line **with `Shutdown` wired**; delete
   `cloud/clients/eval`.
3. Move the annotation queue to `/v1/eval/queue`; delete
   `cloud/clients/o11y/annotation_queues.go`, `o11y_annotations.db`, o11y's
   `/api/annotation` and `/api/score*` routes, `llm_annotations` and `llm_scores`.
4. Move the metrics board to o11y; `/v1/eval/metrics` is never created.
5. Repoint the console: `evals/*` → `eval/*` in its API modules, its proxy allow
   list, and the tests that pin the literal paths.
6. Resolve `clients/admin`'s direct read of `hanzo.eval_traces` and
   `hanzo.eval_scores` (see Open questions) before eval's tables are touched.

## Acceptance tests

A conformant implementation passes all of these. (1) and (4) are where this breaks
silently, so they are not optional.

1. **Cross-tenant isolation.** For every route in §3: a validated principal of org B
   presenting an id created by org A gets `404`/`403` and never `200`, on reads,
   writes and deletes alike. A list issued by B never contains a row of A's.
2. **Fail-closed tenancy.** Every route, called with `X-Org-Id: victim` and **no**
   bearer, returns `403` — the header alone never scopes anything.
3. **Org verbatim.** Orgs differing only by case or surrounding whitespace are
   distinct tenants and never share a row, a file or a natural key.
4. **A judge run bills the correct org.** A run issued by a principal of org A whose
   home org is A produces exactly one `cloud_usage` attribution per judge call,
   addressed to `account.Payer` for A; when the effective org differs from the home
   org, the debit follows the **home** org and the data follows the effective one.
   eval itself writes zero `cloud_usage` rows.
5. **Gate precedes work.** A spend-capped org gets `402` from `POST /v1/eval/run`
   before any judge call is issued, and no score, run rollup or item row is written.
6. **Score immutability.** No route mutates or deletes a score; a retraction is a new
   row and the original remains readable.
7. **Rubric fail-closed.** A score violating its rubric's type, bounds or label set is
   rejected; an unparseable model verdict fails the item and records no value.
8. **Assignment is exclusive.** Two annotators claiming one queue item: one `200`,
   one `409`; releasing returns it to the pool.
9. **Degraded honesty.** With no OLAP store: score and run routes `503`; dataset,
   item, judge, rubric, experiment and queue `200`; `/v1/eval/health` `200`, reporting
   the degradation.
10. **Bounds hold.** Exceeding the per-org concurrent-run cap returns `429`
    immediately and enqueues nothing; the run deadline terminates a run and records it
    as failed.
11. **Teardown.** SIGTERM closes the metastore handle exactly once, via the wired
    `Shutdown`.
12. **Grammar.** A table-driven assertion over the registered route list: no plural
    segment, no compound segment, no `/api/`, no prefix but `/v1/eval`.
13. **Acyclic.** `go list -deps` for o11y and for ai contains no `hanzoai/eval`.
14. **Span shape.** A run emits spans carrying `gen_ai.hanzo.org_id` equal to the
    caller's org, parented to the request span, and emits no `_o11y.gen_ai.*`
    attribute.

## Open questions

Named, not hidden. Each needs a human call before the corresponding code is written.

- **Where a code judge executes.** In-process pure expression, the extension runtime
  (HIP-0105/0116), or a sandbox — and whether it may make network calls at all. This
  is an arbitrary-code-execution decision and is deliberately unresolved here.
- **Standalone or embedded.** Whether `hanzoai/eval` also ships a binary, an image
  and a `Service` CR (o11y's shape, with the two listeners of HIP-0119 §1), or exists
  only embedded in cloud. This HIP specifies the embedded contract; the standalone one
  is additive.
- **The existing rows.** `llm_scores` and `llm_annotations` — migrate into eval's
  score store, or drop? Migration `099`'s `Down()` is a no-op, so whichever is chosen
  is one-way.
- **`clients/admin`'s direct read** of `hanzo.eval_traces` and `hanzo.eval_scores` for
  the SuperAdmin fleet board: does admin keep a documented warehouse read (eval owns
  the schema, admin reads it with no interface between them), or does eval expose a
  fleet-scoped read the board calls?
- **Ordering with the console.** Whether the metrics board lands in o11y before or
  after the eval cut; the console reads it today either way.
- **Per-org file or shared file.** eval's metastore is one shared `evals.db` with a
  `WHERE org = ?`; `cloud.OrgDB`/`NewOrgStore` would make the isolation a file
  boundary. Stronger, and a data migration.
- **Is project authoritative?** Whether the project axis hard-enforces
  (`ValidatedProject`) or stays advisory on eval reads.
- **What eval charges for.** `ResourceFeeCents("EVAL", …)` is unset, so everything
  but the judge's inference is free today. Whether a run, a stored dataset or a queue
  seat is billable — and whether eval gets its own spend-cap service axis or inherits
  ai's — is a pricing decision, not an engineering one.

## References

- HIP-0031 Observability & Metrics · HIP-0106 Unified Cloud Binary · HIP-0111 IAM
- HIP-0114 ZAP Transport · HIP-0119 Service Conventions · HIP-0120 gRPC Elimination
- HIP-0122 zip — ZAP-Native Application Server · HIP-0105/0116 Extension Runtime
