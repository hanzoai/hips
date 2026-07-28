---
hip: 0132
title: One Telemetry Plane — One Door, One Schema, Many Lenses
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-07-27
requires: HIP-0119, HIP-0131, HIP-0512
---

# HIP-132: One Telemetry Plane — One Door, One Schema, Many Lenses

## Abstract

Hanzo ingests telemetry through one door, stores it in one flat schema, and presents it
through as many product surfaces as the business needs. Today it has two doors, nine
databases, three DDL paths and a version suffix on the table taking production writes.

This HIP states the target and — because production is not empty — the path to it.

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
sibling path). It becomes a compatibility shim that forwards into `/v1/event` — PostHog
SDKs in the wild post to `/e/`, so a shim is defensible; a second plane behind it is not.

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

This is NOT a rename. Two facts make it a migration:

1. Spans today have **no general org column at all** — only `gen_ai` spans carry
   `gen_ai.hanzo.org_id`. That absence is why `/v1/sentry/traces/{id}` refuses to read
   the span plane.
2. The insights plane carries `team_id` as a real column across live rows, threaded
   through a large Django application.

Projects map to IAM projects on the same 1:1 basis.

### §5 Production is not empty — this is a migration

**499,250,285 rows / 11.37 GiB across 15 populated databases**, verified by direct query
against the live server, taking writes hours before observation. The database was created
2026-03-12 and incrementally migrated since; `schema_migrations_v2` holds 38 applied rows.

Deleting the migrations and creating fresh DESTROYS that data. The suffixes still go and
the chain still dies — but by migration, not by recreation.

**Why the opposite was believed, because the trap will catch the next person too:**
`/usr/bin/datastore-client` silently runs in EMBEDDED LOCAL mode — `uptime()=0`,
`currentUser()=''`, `SHOW DATABASES` returning only `default` and `system`. It reports an
empty in-process engine while the real server sits behind it. `/usr/bin/clickhouse-client`
is a dangling symlink, so no canonical-name client works in that pod. The control that
exposed it: `uptime()=0` on a 16-day-old pod. The correct invocation is
`hanzo-datastore client --host 127.0.0.1 --port 9000 --user $DATASTORE_USER`.

### §6 The centre of mass

`squashed_traces_migrations.go` is 1029 lines / 27 migration records, **all at v2-era
schema**: it creates `o11y_index_v2`, never the `o11y_index_v3` that production actually
writes. The v3 table is created by the incremental chain.

So "delete the migrations" is not a deletion. The squashed path must be RE-AUTHORED at the
final schema before the chain can go. Until it is:

- `o11y_index_v3` (3.53M rows) is created by **nobody** in any repo — the table taking
  production writes has no DDL.
- `distributed_spans` and `distributed_records` exist **nowhere** — no DDL, no table.
  A branch reading them ships two empty dashboards and no error.

A half-renamed surface is two surfaces. Writer and reader move in ONE commit.

## Conformance

1. One ingest door. A second door is a shim that forwards, or it is deleted.
2. One database. The table never restates it.
3. No version suffix on any live table.
4. `org` on every table, 1:1 with IAM.
5. Writer DDL, exporter and reader change together, never separately.
6. Nothing is created fresh over populated tables.

## References

HIP-0119 (service conventions) · HIP-0131 (the method) · HIP-0512 (the evidence plane)
