---
hip: 0132
title: One Telemetry Plane — One Door, One Schema, Many Lenses
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Active
created: 2026-07-27
requires: HIP-0119, HIP-0131, HIP-0512
---

# HIP-132: One Telemetry Plane — One Door, One Schema, Many Lenses

## Abstract

Hanzo ingests telemetry through one door, stores it in one flat schema, and presents it
through as many product surfaces as the business needs. Today it has two doors, nine
databases, three DDL paths and a version suffix on the table taking production writes.

This HIP states the target, and the cut that reaches it: the old plane is destroyed,
not migrated. No compatibility layer survives this document.

## Motivation

The rule that generates every decision here:

> **A new door for a new data SHAPE. Never for a new VIEW.**

Errors, analytics and BI are views of what happened. Giving each its own ingest is how a
company ends up unable to ask whether a change helped, because the answer lives in three
stores with three schemas and three tenant keys. Session replay is a genuinely different
shape, so it earns a door. Error grouping is not, so it does not.

## Specification

### §1 Doors

| door | why it exists |
|---|---|
| `POST /v1/event` | the one telemetry ingest. Accepts a bare object, a bare array, or `{batch:[…]}`/`{events:[…]}` — batching is a SHAPE, not a route |
| `POST /v1/replay` | session replay: a different data shape, not a different view |
| `/v1/form` | the form primitive — fields, submit, thank-you |
| `/v1/survey` | a form PLUS targeting, scheduling, recurrence. Its RESPONSES are events |
| `/v1/experiment` | the verdict plane (HIP-0512) |

`/v1/event/batch` MUST NOT exist — the batch envelope already rides the one path.
`/v1/error` MUST NOT exist — an error is an event; grouping is a lens.
`/v1/session` MUST NOT be used for replay — `/v1/agents/sessions` already owns that word,
and one word for two concepts is the defect this HIP removes.

`/v1/insights/e` is a live SECOND door today (verified 200, against a 404 control on a
sibling path). It is **deleted**, not shimmed. A forwarding shim exists to serve SDKs you
do not control; we own `@hanzo/event`, so the client moves and the door closes. A shim
here would be permanent debt bought for nothing.

### §2 Lenses, not planes

`analytics.hanzo.ai`, `sentry.hanzo.ai` and `insights.hanzo.ai` are product surfaces over
the one plane. Two of the three already answer on `/v1/event`; insights' own capture tier
was retired at the ingress. **insights remains a distinct paid product** — the BI surface
— and that is a packaging decision, not a storage one. A paid lens is still a lens.

`bigquery` and `facebook` are DESTINATIONS fed FROM the plane, never emitters beside it.

### §3 The schema

ONE database, `o11y`, replacing nine (`o11y_traces`, `o11y_logs`, `o11y_metrics`,
`o11y_meter`, `o11y_metadata`, `o11y_analytics`, `o11y_audit`, `o11y_sentry`, `o11y_ai`)
plus the event plane's home in `hanzo`.

Naming, per HIP-0119 and the standing rules:

- The database qualifies; a table never restates it — `o11y.spans`, never `o11y.trace_spans`.
- No version suffixes. `_v2`/`_v3` are generations; one live generation carries none.
- `distributed_` STAYS: it is topology (a Distributed engine over a local table), and the
  reader derives the base name by splitting on it.
- Rollup suffixes (`_5m`, `_1d`) are RESOLUTION, the same class as `distributed_`.

Three signals (spans, logs, metrics), three dimensions, two catalogues, one ledger. Every
columnar table has exactly one `distributed_<name>` mirror.

### §4 The tenant key is `org`

`org` is the tenant key on every table, mapping 1:1 to the IAM org. Not `team_id`.

It is not a rename of an existing column, because there is nothing to rename: spans today
carry **no general org column at all** — only `gen_ai` spans have `gen_ai.hanzo.org_id`,
which is precisely why `/v1/sentry/traces/{id}` cannot read the span plane. The column is
new, and it exists from the first row written.

`team_id` does not survive anywhere. The insights queries move to `org` with the schema.

Projects map to IAM projects on the same 1:1 basis.

### §5 The old plane is destroyed, not migrated

Production held 499,250,285 rows / 11.37 GiB across 15 databases when this was written.
They are **deliberately destroyed**. The decision is explicit and it is correct: this is
15-day-TTL operational telemetry with no customers behind it. A span from twelve days ago
has no value, and carrying it forward would buy a schema with ancestry — the exact thing
this cut exists to remove.

So there is NO migration, NO dual-write, NO translation view, and NO compatibility shim.
The new schema is created at its final names and the old databases are dropped. A
discontinuity in dashboards is the whole cost, and it is paid once.

Anything that would survive the cut only to be renamed later is not built.

**The trap that made this look unnecessary, documented because it will catch the next
person:** `/usr/bin/datastore-client` silently runs in EMBEDDED LOCAL mode — `uptime()=0`,
`currentUser()=''`, `SHOW DATABASES` returning only `default` and `system`. It reports an
empty in-process engine while the real server sits behind it, and
`/usr/bin/clickhouse-client` is a dangling symlink, so no canonical-name client works in
that pod. The control that exposed it: `uptime()=0` on a 16-day-old pod. Correct
invocation: `hanzo-datastore client --host 127.0.0.1 --port 9000 --user $DATASTORE_USER`.

### §6 The centre of mass, measured

Two claims in an earlier draft of this HIP were WRONG, and an adversarial pass disproved
both. They are recorded because the errors are instructive, not embarrassing.

**WRONG: "main.go is already single-path."** It is not. `main.go:147` calls `Bootstrap()`
and `:153` calls `RunSquashedMigrations()`, but `:164` still calls `MigrateUpSync(...)`.
The incremental chain is reachable from the entrypoint. Any plan that assumed otherwise —
including deleting the chain first — is built on a misreading of one file.

**WRONG: the change-site inventory was complete.** It cited exact line numbers and warned
that a missed site "breaks the guide silently". In `hanzoai/o11y`, **48 non-test `.go`
files** reference the renamed vocabulary and **34 are absent from that list** — including
`pkg/modules/tracefunnel/datastore_queries.go`, which hardcodes
`FROM o11y_traces.distributed_o11y_index_v3` in all six of its query sites, and
`pkg/modules/tracedetail/impltracedetail/store.go`, which reaches the names indirectly.

`squashed_traces_migrations.go` is 1029 lines / 27 migration records, **all at v2-era
schema**: it creates `o11y_index_v2`, never the `o11y_index_v3` production actually writes.
The v3 table is created by the chain. Re-authoring the squashed path at the final schema
is the centre of mass of this work.

**WRONG a third time: that the migration chain has one consumer.** It has two, in two
BINARIES. `cmd/o11yschemamigrator` is the standalone migrator; `cmd/o11yotelcollector` is
the collector itself — the image running as the `otel-agent` DaemonSet on every node — and
its `migrate/sync_check.go` and `migrate/sync_up.go` call `schemamigrator.TracesMigrations`,
`LogsMigrations` and `LogsMigrationsV2` directly.

A branch that deleted the chain therefore broke a LIVE binary while reporting a green
build, because the build was scoped to `./cmd/o11yschemamigrator/...` rather than `./...`.
The acceptance bar is `go build ./...`, always. Deleting a package-level var requires a
symbol search across the module, not the package — checking functions when vars are the
consumers is the same error twice.

Because the old plane is destroyed rather than migrated, these stop being risks to a live
system and become a completeness requirement: every one of the 48 files moves, and the
count is the acceptance test.

### §7 Transport is OTLZ; the node keeps one job

**OTLZ** is the OpenTelemetry data model over the ZAP transport. Same semantics as OTLP,
our wire. Cloud already speaks it — `cmd/cloud/telemetry.go` exports through
`zaptrace.New(:4319)` and has never needed a collector hop.

Everything we instrument moves to OTLZ. An OTLP receiver exists only to relay apps that
are not ZAP-native yet, which makes it a compatibility layer by this HIP's own rule, and
it is removed as each app moves.

**What stays on the node, and why it is not negotiable.** The `otel-agent` DaemonSet
(18 pods for 18 nodes — one per NODE, not per pod, and not a sidecar) runs exactly two
receivers: `otlp` and `filelog`. The first is the relay above. The second tails
`/var/log/pods/*` — stdout from containers that emit no telemetry at all: the datastore,
Postgres, every third-party image, and any process that **dies before an SDK
initializes**. No transport reaches that; the log is on disk and nothing is left running
to send it. A telemetry plane that cannot explain a crash-on-startup is not finished.

So the end state is one small log tailer per node, and OTLZ direct from everything else.

**Also measured and unresolved:** TWO collector images run side by side in `ns hanzo` —
`ghcr.io/hanzoai/otel-collector:v0.1.0` (the `otel-agent` DaemonSet) and
`ghcr.io/hanzoai/analytics-collector:v0.7.390`. The version spread says which has been
developed. There are ZERO migration Jobs, so DDL runs in-process at service startup —
which is why disagreeing schema paths never announce themselves. One collector, and DDL
owned by one thing that runs once, is the target.

### §8 The four surfaces, and where LLM obs and eval sit

The whole point is that these are FOUR VIEWS OF ONE PLANE, not four systems:

| surface | reads | it is |
|---|---|---|
| `o11y.hanzo.ai` | spans · records · samples | the engineering lens |
| `analytics.hanzo.ai` | records where `kind='event'` | the product lens |
| `insights.hanzo.ai` | the same records | the **paid BI** lens |
| `sentry.hanzo.ai` | records where `kind='error'`, grouped by `fingerprint` | the error lens |

Not one of them owns storage. Adding a fifth surface is a query, not a database.

**LLM observability is not a fourth signal.** A `gen_ai` span IS a span — the wire already
carries `gen_ai.system`, `gen_ai.request.model`, `gen_ai.response.model`,
`gen_ai.operation.name`, `gen_ai.hanzo.org_id`, `gen_ai.hanzo.project` as span attributes.
It lands in `o11y.spans` like any other span and needs no table, no database and no door
of its own. That an LLM call is expensive does not make it a different KIND of thing; it
makes it a span with a cost attribute.

Note what §3's `org` column fixes here: today only `gen_ai` spans carry a tenant
(`gen_ai.hanzo.org_id`) because there is no general org column, which is why
`/v1/sentry/traces/{id}` cannot read the span plane at all. One tenant key on every span
removes that asymmetry — LLM spans stop being the only ones that are tenant-scoped.

**Spend is a projection, not a signal.** Cost per call is derived from the span, and the
billing ledger (`cloud_usage`) stays the money record of authority. Telemetry never
becomes a second source of truth about what a customer owes.

**Eval is a genuinely separate plane, and stays one.** HIP-0129 (`/v1/eval`) is judgment —
was the output any good — and HIP-0512 (`/v1/experiment`) is the verdict of a falsifiable
claim. Both CONSUME this plane; neither is stored in it. The dependency runs one way, and
must: telemetry records what happened, eval decides whether it was good, experiment
records whether a change helped. Collapsing them would put an opinion in the same table as
an observation.

## Conformance

1. One ingest door. A second door is a shim that forwards, or it is deleted.
2. One database. The table never restates it.
3. No version suffix on any live table.
4. `org` on every table, 1:1 with IAM.
5. All 48 o11y reference sites move. The count is the acceptance test.
6. No shim, no view, no dual-write, no aliased column. If it exists only to ease the cut,
   it is not built.
7. OTLZ from everything we instrument. One log tailer per node, one collector, and DDL
   owned by one thing that runs once — never by whichever pod starts first.
8. A new surface is a query. If it wants a table, it is not a surface.

## References

HIP-0119 (service conventions) · HIP-0131 (the method) · HIP-0512 (the evidence plane)
