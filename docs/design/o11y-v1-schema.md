# o11y v1 — the full schema design (machine-generated, adversarially reviewed)

Source: workflow one-event-plane. Verifier verdict: safeToExecute=false against a LIVE
plane; the three refutations are recorded in HIP-0132 §5/§6. With the old plane destroyed
rather than migrated, they become a completeness bar, not a safety blocker.

## Layout

THE ONE FLAT v1 TELEMETRY SCHEMA

ONE DATABASE: `o11y`. It replaces nine: o11y_traces, o11y_logs, o11y_metrics,
o11y_meter, o11y_metadata, o11y_analytics, o11y_audit (phantom), o11y_sentry,
o11y_ai (dead) — plus the event plane's home in `hanzo`.
The database qualifies. A table never restates it. No _v2/_v3. `distributed_` is
topology and stays. Rollup suffixes (_5m, _1d) are RESOLUTION, same class as
`distributed_`: the reader derives the base name by splitting on them.

Nine tables. Three signals, three dimensions, two catalogues, one ledger.
Every columnar table has exactly one `distributed_<name>` mirror over it.

=========================== THREE SIGNALS ===========================

o11y.spans          an interval with causality
  org LowCardinality(String)          <- NEW. the tenant key. today spans have NO
                                         general org column; only gen_ai spans carry
                                         gen_ai.hanzo.org_id, which is why
                                         /v1/sentry/traces/{id} refuses to read the
                                         span plane at all
  ts_bucket_start UInt64, resource_fingerprint String
  timestamp DateTime64(9)
  trace_id FixedString(32), span_id String, parent_span_id String, trace_state, flags
  name LowCardinality(String), kind Int8, kind_string String
  duration_nano UInt64
  status_code Int16, status_message String, status_code_string String
  attributes_string Map(LC(String),String)
  attributes_number Map(LC(String),Float64)
  attributes_bool   Map(LC(String),Bool)
  resources_string  Map(LC(String),String)
  resource JSON, scope JSON            <- as chain 1006/1009 left them
  events Array(String), links String
  + 10 derived composite columns (http_url, http_method, http_host, db_name,
    db_operation, response_status_code, external_http_url, external_http_method,
    has_error, is_remote)
  + 9 materialized attribute columns (`resource_string_service$$name`,
    `attribute_string_http$$route`, ...$$rpc$$method, ...) — DEFAULT expressions
    over the maps, a typed fast path, not a second storage model
  _retention_days UInt16 DEFAULT 15
  ENGINE MergeTree PARTITION BY toDate(timestamp)
  ORDER BY (org, ts_bucket_start, resource_fingerprint, has_error, name, timestamp)
  TTL toDateTime(timestamp) + toIntervalDay(_retention_days)
  DELETED vs today: the 30 v2-compat ALIAS columns (traceID, spanID, durationNano,
  serviceName, httpRoute, ...). One generation has nothing to be compatible with;
  cloud@65775405 already moved every read to the real column.

o11y.records        a point in time with a body
  org LowCardinality(String)          <- ONE tenant key, the IAM org SLUG.
                                         today: tenant_id (slug) in hanzo.events,
                                         org_id (UUIDv5 of the slug) in
                                         o11y_sentry_events, `organization` in
                                         cloud_usage. Three names, and the two error
                                         planes cannot be joined at all.
  timestamp DateTime64(9), observed_at DateTime64(9), id String
  kind LowCardinality(String)          log | error | event | audit | alert
  severity LowCardinality(String), severity_number UInt8
  name String                          logger scope / $pageview / TypeError / rule name
  body String CODEC(ZSTD(2))
  trace_id String, span_id String, trace_flags UInt32
  fingerprint String                   grouping key; set for kind='error', else ''
  session String, actor String         analytics session + person/distinct id
  ts_bucket_start UInt64, resource_fingerprint String
  attributes_string / attributes_number / attributes_bool, resources_string
  scope JSON                           library + library_version land here natively
  + derived analytics columns over the maps, same mechanism as spans' http_url:
    url, path, referrer, referrer_domain, utm_source, utm_medium, utm_campaign,
    utm_term, utm_content, channel, ref_code, group_id, product_id,
    quantity UInt32, revenue Float64, currency
  _retention_days UInt16 DEFAULT 15, _retention_days_cold UInt16 DEFAULT 0
  ENGINE MergeTree PARTITION BY toDate(timestamp)
  ORDER BY (org, kind, ts_bucket_start, resource_fingerprint, timestamp)
  TTL toDateTime(timestamp) + toIntervalDay(_retention_days)

  PER-ROW RETENTION IS WHAT MAKES THE UNION PHYSICAL, not just conceptual: logs
  already carry _retention_days (15) and analytics events need 730. One table,
  one TTL expression, two lifetimes. The mechanism exists in logs_v2 today.

  There are no sentry-shaped columns because there need not be. An exception is
  OTLP: exception.type -> name, exception.message -> body,
  exception.stacktrace -> attributes_string. That is the SAME row a span-exception
  produces, which is why o11y_error_index_v2 folds in here and not somewhere else.
  `sample String` (sentry's full occurrence JSON) is dropped: it was a second
  encoding of the row it sits on.

o11y.samples        a number on a named series at a time
  org, env LowCardinality(String), temporality LowCardinality(String)
  metric LowCardinality(String), fingerprint UInt64
  unix_milli Int64
  value Float64
  sketch AggregateFunction(quantilesDD(0.01), Float64)   <- exp_hist folds in here
  kind LowCardinality(String)          gauge | sum | histogram
  flags UInt32, _retention_days UInt16
  ENGINE MergeTree ORDER BY (org, metric, fingerprint, unix_milli)

========================== THREE DIMENSIONS =========================

o11y.resources      resource label set <-> fingerprint
  org, labels String, fingerprint String, seen_at_ts_bucket_start Int64
  ENGINE ReplacingMergeTree ORDER BY (org, labels, fingerprint, seen_at_ts_bucket_start)
  traces_v3_resource and logs_v2_resource have the SAME THREE COLUMNS today. That
  they are two tables is the accident; one table is the fact.

o11y.series         metric label set <-> fingerprint (+ the metric's own metadata)
  org, env, temporality, metric, fingerprint UInt64, labels String, unix_milli Int64,
  type LowCardinality(String), unit LowCardinality(String), description String,
  is_monotonic Bool, attrs JSON
  ENGINE ReplacingMergeTree ORDER BY (org, env, temporality, metric, fingerprint, unix_milli)
  unit/type/description come from o11y_metrics.metadata, which is a phantom
  constant with no DDL — the signal gets a real home for the first time.

o11y.traces         one row per trace (the aggregate of its spans)
  org, trace_id String,
  start SimpleAggregateFunction(min, DateTime64(9)),
  end   SimpleAggregateFunction(max, DateTime64(9)),
  spans SimpleAggregateFunction(sum, UInt64),
  root_name, root_service, has_error
  ENGINE AggregatingMergeTree ORDER BY (org, trace_id)
  FED BY o11y.traces_mv FROM o11y.spans

========================== TWO CATALOGUES ===========================

o11y.attributes     every name this tenant has emitted (autocomplete, evolution)
  org, subject LowCardinality(String)  span | record | sample | resource
  key String, type LowCardinality(String)  string | number | bool
  value String, seen_at DateTime, count UInt64
  ENGINE ReplacingMergeTree ORDER BY (org, subject, key, type, value)
  Collapses SIX tables that are one concern: traces.tag_attributes_v2,
  logs.tag_attributes_v2, traces.span_attributes_keys, logs.logs_attribute_keys,
  logs.logs_resource_keys, metadata.attributes_metadata +
  metadata.column_evolution_metadata.

o11y.operations     the (service, operation) picker
  org, service LowCardinality(String), name LowCardinality(String),
  root Bool, seen_at DateTime
  ENGINE ReplacingMergeTree ORDER BY (org, service, name, root)
  FED BY o11y.operations_root_mv + o11y.operations_child_mv FROM o11y.spans
  (two feeders because "root" and "cross-service child" are two predicates and an
  MV cannot UNION; the MV naming rule is <target>[_<predicate>]_mv, stated once)

============================= ONE LEDGER ============================

o11y.usage          per-tenant ingest volume, in plaintext
  org, signal LowCardinality(String)   span | record | sample
  hour DateTime, rows UInt64, bytes UInt64
  ENGINE SummingMergeTree ORDER BY (org, signal, hour)
  FED BY usage_span_mv / usage_record_mv / usage_sample_mv
o11y.usage_1d       same, daily, fed by usage_1d_mv
  Replaces FIVE surfaces: o11y_traces.usage + o11y_logs.usage + o11y_metrics.usage
  (AES-encrypted blobs with 115/80/N rows and ZERO readers anywhere),
  o11y_traces.usage_explorer (0 rows, MV bound to dead v2, two LIVE readers), and
  o11y_meter.samples (a counting problem wearing a metric-series costume).

============================== ROLLUPS ==============================

o11y.samples_5m, o11y.samples_30m       fed by samples_5m_mv, samples_30m_mv
o11y.series_6h, o11y.series_1d, o11y.series_1w
  Same rows, coarser resolution. The suffix is the resolution, exactly as
  `distributed_` is the topology. Nothing else changes.

===================== STATE (NOT TELEMETRY) =========================

issues              relational (o11y SQL store), NOT the datastore
  id, org, service, fingerprint, name, body, severity,
  status (unresolved|resolved|ignored), assignee,
  first_seen, last_seen, count, regressed, version
  UNIQUE (org, service, fingerprint)
  Today o11y_issues keys on (org_id, fingerprint) with NO project/service column,
  so resolving an issue in one product resolves it in every product of that org.
  Adding `service` to the key fixes a real semantic bug, and it is the same
  `service` the records carry — the sub-org scope exists once.

========================= BOOKKEEPING ===============================

o11y.migrations     name String, hash String, applied_at DateTime
  ONE table, replacing five per-database schema_migrations_v2 pairs. Storing the
  hash of each rendered DDL makes DRIFT detectable, which 38 rows of migration ids
  never could.

============================ ROUTES =================================

POST /v1/event                one ingest door, all kinds, all shapes
POST /v1/event/{key}/envelope one Sentry-wire door for third-party SDKs
GET  /v1/record               the record lens (kind= filters it)
GET  /v1/span, /v1/trace/{id}, /v1/sample, /v1/issue, /v1/issue/{id}
RETIRED: /v1/ingest, /v1/analytics, /v1/analytics/batch, /v1/tracker,
/v1/insights/e, /v1/errors, /v1/sentry/{uuid}/store/,
/v1/o11y/api/{org}/envelope|store/, /v1/o11y/errortracking/issues.
Singular resources, /v1/ only, no /api/, and POST /v1/ingest/keys — promised in
three docstrings and 404 live — is not resurrected: the ingest credential is an
IAM pk- publishable key, minted where every other key is minted.

## Unified

- event + sentry + logs + span-exceptions => ONE table o11y.records. All four answer 'what happened at time T with these attributes'. Today an exception from a Hanzo surface is written TWICE by the same client call (@hanzo/event captureError dual-writes a Sentry envelope AND a type:'error' row), into two tables, under two tenant keys (org SLUG vs UUIDv5 of that slug), read by two different UIs, and only one of the two groups it. 58 rows on one side, 167 on the other, un-joinable. That is the defect, stated in rows.
- insights => STOPS EXISTING as a concern. It never had a table. POST /v1/insights/e was a PostHog-wire shim onto hanzo.events and GET /v1/insights/events was a read lens over the same rows. It is a second wire for the one ingest, which is exactly the thing the contract forbids. One door, one lens.
- the TWO error-tracking faces => ONE. The project-DSN face (POST /v1/sentry/{uuid}/envelope) and the org-DSN face (POST /v1/o11y/api/{org}/envelope) run the SAME ingest engine (implerrortracking/reuse.go) and upsert the SAME o11y_issues rows, differing only in which UUID the DSN HMAC is domain-separated by. The org-DSN face is already dead in production (403 at the edge, because mount.go's rewriteExternalPath strips /v1/o11y/ before the gate's isErrorIngestPath prefix test can match). Delete it rather than fix it.
- six attribute catalogues => o11y.attributes. traces.tag_attributes_v2, logs.tag_attributes_v2, traces.span_attributes_keys, logs.logs_attribute_keys, logs.logs_resource_keys, metadata.attributes_metadata + column_evolution_metadata are one question: what names has this tenant emitted.
- two resource tables => o11y.resources. traces_v3_resource and logs_v2_resource have the identical three columns (labels, fingerprint, seen_at_ts_bucket_start) today. Being two tables is the accident.
- o11y_audit => o11y.records with kind='audit'. o11y_audit is a phantom DATABASE: pkg/telemetryaudit/tables.go declares seven table names and the statement builder emits SQL against them, but no migration in otel-collector, o11y, cloud or universe creates any of it (searched all four for 'o11y_audit'). An audit entry is a record with o11y.audit.* attributes; telemetryaudit becomes a filter, not a namespace.
- alert state history => o11y.records with kind='alert'. o11y_analytics.rule_state_history_v0 stores (rule, state, changed, time, fingerprint, labels, value) — a state transition is a record. It also carries a _v0 suffix that the contract forbids outright.
- five ingest-metering surfaces => o11y.usage. The three AES-encrypted `usage` tables (traces/logs/metrics) have a live writer and ZERO readers in o11y or cloud; usage_explorer has two live readers and zero rows (its MV is still bound to the dead o11y_index_v2); o11y_meter.samples is a counting problem modelled as a metric series. One SummingMergeTree of (org, signal, hour, rows, bytes) answers all of it in plaintext.
- o11y_ai.observations => o11y.spans. The retired Langfuse plane has no writer in this fleet; the gen_ai span is already the observation of record. cloud@65775405 deletes the last two reads.
- the DSN/project credential => the IAM pk- publishable key. o11y_sentry_projects exists to hold a rotating ingest secret and a sub-org scope. IAM already mints and rotates publishable keys, and `service` already scopes rows below the org. Two credential systems for one concern; keep the one that is already the fleet's answer.

## Still distinct

- spans vs records — a span is an INTERVAL in a causal tree; a record is a POINT. The span's identity needs trace_id/span_id/parent_span_id/duration_nano and it is written when it CLOSES; a record is complete when emitted. Merging gives every log a meaningless duration and every span an empty body, and destroys the sort key that makes trace lookup cheap. Two shapes, two tables — and they join on trace_id, which is precisely what a unified org column finally makes legal.
- samples vs records — a sample is a NUMBER on a named series, identified by a label-set fingerprint, and it is AGGREGATED (5m/30m/6h/1d/1w rollups over SummingMergeTree/AggregatingMergeTree) rather than searched. It has no body, no id, no fingerprint-of-a-crash. Folding 268M numeric points into a table with a String body and ZSTD text indexes throws away the entire reason metrics are cheap.
- issues vs records — an issue is HUMAN STATE ABOUT telemetry: who resolved it, who owns it, an optimistic-concurrency version so two operators do not clobber each other. It is mutable, tiny and transactional. Telemetry is immutable, huge and columnar. This is the one boundary that must never be crossed; it stays in the relational store, keyed (org, service, fingerprint) — derived from telemetry, never mixed into it.
- hanzo.cloud_usage (the LLM money ledger) — NOT telemetry, and deliberately untouched. The gen_ai SPAN says what happened; cloud_usage says what is owed. Different question, different retention, different audit obligations, different owner (hanzoai/ai writes it). It stays where it is, and /v1/analytics keeps reading it as the LLM lens — today the only lens with real data.
- the ingest CREDENTIAL — a key is not a telemetry row. Dropping o11y_sentry_projects does not mean inventing a table for keys; it means the credential lives in IAM, which is the fleet's one answer for credentials. The schema's only trace of it is the `org` the key resolves to and the `service` it scopes.
- o11y_annotations.db — NOT a database despite the name. It is a SQLite FILE at {DataDir}/o11y_annotations.db (cloud/clients/o11y/annotation_queues.go:80). Named here only so a global rename does not sweep it in.

## Dropped tables and where each signal went

- **o11y_traces.o11y_index_v2 + distributed_o11y_index_v2** → DROP. 0 rows. Signal genuinely dead — superseded by v3 before the rebrand. Its reader-side constants (datastorereader defaultIndexTable/defaultLocalIndexTable) are assigned and never used in a query; delete them with it. This is the pair the SQUASHED path creates today, which is why deleting the chain without re-authoring leaves the live table uncreated.
- **o11y_traces.o11y_index_v3 + distributed_o11y_index_v3** → NOT dropped — RENAMED to o11y.spans / o11y.distributed_spans, minus the 30 v2-compat ALIAS columns. 3,530,279 rows, fresh. This is the live span plane and the one the exporter writes.
- **o11y_traces.o11y_error_index_v2 + distributed_o11y_error_index_v2** → DROP as a table; signal FOLDED into o11y.records kind='error'. 517,651 rows and 10 live read sites in datastorereader — all move. A span exception and a Sentry occurrence are the same OTLP shape (exception.type/message/stacktrace); storing them apart is what made the fleet's error picture split in the first place.
- **o11y_traces.durationSort + distributed_durationSort + durationSortMV** → DROP. Signal already carried by spans (idx_duration minmax index). The MV was created then dropped by chain 1001; distributed_durationSort is a live reader constant over a table with no writer.
- **o11y_traces.o11y_spans + distributed_o11y_spans** → DROP. 0 rows, no writer — yet datastorereader reader.go:5080 QUERIES distributed_o11y_spans in a live path. Signal: none; the read moves to o11y.spans. HAZARD: the dead name distributed_o11y_spans and the new live name distributed_spans differ by one token. A careless sed makes a dead read silently start returning live rows.
- **o11y_traces.dependency_graph_minutes_v2 + its 3 MVs + distributed_dependency_graph_minutes_v2** → DROP. 0 rows despite a fresh source, because the service-map MVs are SELF-JOINS and a ClickHouse MV only ever sees the block being inserted — it can never match the other side. Signal (service-to-service edges) is ALREADY absent in production: the service map renders empty. Recovered as a read-time GROUP BY over o11y.spans, or later as a single-pass MV keyed (caller service, callee service, minute) that can actually fire.
- **o11y_traces.usage_explorer + usage_explorer_mv + distributed_usage_explorer** → DROP. The MV is the ONLY live MV still bound to o11y_traces.o11y_index_v2 (verified in system.tables.create_table_query), and v2 has 0 rows, so it can never fire — while reader.go:844 and :846 query the distributed table in live paths. Signal FOLDED into o11y.usage, fed from spans, which actually has rows.
- **o11y_traces.top_level_operations + root_operations + sub_root_operations + distributed** → NOT dropped — RENAMED to o11y.operations with two feeder MVs. 11,066 rows, healthy, real readers (condition_builder.go, implservices).
- **o11y_traces.span_attributes + distributed_span_attributes** → DROP. 0 rows, no writer, no reader anywhere in o11y or cloud — the purest cruft in the plane. Signal superseded by o11y.attributes.
- **o11y_traces.span_attributes_keys + distributed / tag_attributes_v2 + distributed** → FOLDED into o11y.attributes (subject='span'). 83 and 1,382,408 rows, both healthy, both real signals.
- **o11y_traces.trace_summary + trace_summary_mv + distributed** → NOT dropped — RENAMED to o11y.traces / traces_mv. 3,519,326 rows, fresh. `traces` is what it always was: one row per trace.
- **o11y_traces.traces_v3_resource + distributed** → MERGED into o11y.resources with the logs resource table. Identical columns.
- **o11y_traces.usage + distributed_usage** → DROP. 115 rows of AES-encrypted metering blobs with a live writer (usage/usage.go:119) and NO reader in o11y or cloud. Signal FOLDED into o11y.usage as plaintext counts.
- **o11y_traces.distributed_o11y_operations** → DROP THE CONSTANT. Phantom — no DDL in any repo. datastorereader options.go:19 defines it, reader.go:199 assigns it to a struct field, and zero queries use it. Nothing to fold; delete the default and the field.
- **o11y_logs.logs_v2 + distributed_logs_v2** → NOT dropped — RENAMED and MERGED into o11y.records (kind='log'). 137,324,833 rows / 6.06 GiB, the biggest table in the plane. Its _retention_days column is the mechanism that lets 15-day logs and 730-day analytics events share one table.
- **o11y_logs.logs_v2_resource + distributed** → MERGED into o11y.resources.
- **o11y_logs.logs_attribute_keys + distributed / logs_resource_keys + distributed / tag_attributes_v2 + distributed** → FOLDED into o11y.attributes (subject='record'/'resource'). Note the first four have an ACTIVE writer (datastorelogsexporter exporter.go:540/546) and 0 rows — a live writer/empty-table disagreement that the single catalogue resolves by construction.
- **o11y_logs.usage + distributed_usage** → DROP. 80 encrypted rows, no reader. Signal FOLDED into o11y.usage.
- **o11y_logs.logs + distributed_logs + tag_attributes + distributed_tag_attributes** → DROP. The v1-era ORPHANED squashed set — runSquashedMigrationsForLogs (manager.go:283) is defined and NEVER CALLED (RunSquashedMigrations calls runCustomRetentionMigrationsForLogs instead; verified symbol-level, only its own definition and its tests reference it). These tables were never created. Signal: none. datastorereader still holds defaultLogsTable/defaultLogsLocalTable constants for them; delete.
- **o11y_logs.attribute_keys_{bool,float64,int64,string}_final_mv + resource_keys_string_final_mv** → DROP. Create-then-drop churn inside the orphaned set. Never live.
- **o11y_logs.distributed_json_promoted_paths + distributed_json_path_types** → DROP THE CONSTANTS. Phantom names in telemetrylogs/tables.go with no DDL anywhere; PathTypesTableName additionally points at the WRONG database (the real json/column-evolution DDL lives under o11y_metadata). Signal (column evolution) FOLDED into o11y.attributes.
- **o11y_metrics.samples_v4 + distributed / time_series_v4 + distributed** → NOT dropped — RENAMED to o11y.samples / o11y.series. 268,642,107 and 3,640,478 rows, but the newest data is 2026-07-10: the writer (o11ydatastoremetrics) is in no deployed pipeline since the standalone collector retired. That is a DEPLOY gate, not a schema problem, but it means the metrics half of this cut cannot be verified in production today.
- **o11y_metrics.samples_v4_agg_5m/_30m + MVs + distributed; time_series_v4_6hrs/_1day/_1week + MVs + distributed** → NOT dropped — RENAMED to o11y.samples_5m / samples_30m / series_6h / series_1d / series_1w. Their live create_table_query still says FROM signoz_metrics.* (the pre-rebrand name recorded at creation); re-creating them at final state clears that too.
- **o11y_metrics.exp_hist + distributed_exp_hist** → DROP as a table; signal FOLDED into o11y.samples.sketch (kind='histogram'). 0 rows, writer not deployed — the cheapest possible moment to collapse a second numeric shape into the first.
- **o11y_metrics.samples_v2 + distributed / time_series_v2 + distributed** → DROP. 0 rows, no writer, no reader. Genuinely dead.
- **o11y_metrics.usage + distributed_usage** → DROP. Signal FOLDED into o11y.usage.
- **o11y_metrics.metadata / updated_metadata / samples_v4_buffer / time_series_v4_buffer / samples_v4_reduced_last_60s / samples_v4_reduced_sum_60s / time_series_v4_reduced / distributed_metric_reduction_rules (+ distributed mirrors)** → DROP THE CONSTANTS. Verified phantom: I enumerated every Table: literal in squashed_metrics_migrations.go and none of these appears. Metric metadata (unit/type/description) gets a real home as columns on o11y.series; the reduction-rules feature is unimplemented and genuinely dead.
- **o11y_meter.samples + distributed_samples + samples_agg_1d + _mv + distributed** → FOLDED into o11y.usage / o11y.usage_1d. Note it is not created by the deployed migrator at all: MeterMigrations is referenced ONLY from cmd/o11yotelcollector/migrate/*.go — the incremental chain CLI in the OTHER binary — never from cmd/o11yschemamigrator/main.go, which calls Bootstrap + RunSquashedMigrations only.
- **o11y_metadata.attributes_metadata + distributed / column_evolution_metadata + distributed** → FOLDED into o11y.attributes. Same chain-CLI-only creation caveat as meter.
- **o11y_analytics.rule_state_history_v0 + distributed_rule_state_history_v0** → FOLDED into o11y.records kind='alert' (rule_id/state/overall_state -> attributes, value -> attributes_number, labels -> body). Two readers move: datastorereader reader.go:66 and modules/rulestatehistory/implrulestatehistory/store.go:23. Same chain-CLI-only creation caveat. The _v0 suffix is forbidden outright.
- **o11y_audit.logs / distributed_logs / tag_attributes / logs_attribute_keys / logs_resource_keys / distributed_logs_resource** → DROP THE WHOLE DBName CONSTANT SET (pkg/telemetryaudit/tables.go). Phantom database — searched otel-collector, o11y, cloud and universe for o11y_audit and found only the reader constants and the statement-builder tests. Signal FOLDED into o11y.records kind='audit'; telemetryaudit's condition builder and field mapper survive as a FILTER over records.
- **o11y_sentry.o11y_sentry_events** → FOLDED into o11y.records kind='error'. 58 live rows, 2 orgs, 6 projects. Its lazy runtime DDL (implsentry/eventstore.go ensureSchema) is DELETED — schema is the migrator's job, and the in-source warning that a multi-shard datastore needs the local+Distributed split is answered for free by the unified table. org_id (UUIDv5) becomes the org SLUG; project_id becomes `service`.
- **o11y_sentry_projects (relational)** → DROP. Three signals, three homes: the rotating DSN secret -> the IAM pk- publishable key (IAM already mints and rotates these); the sub-org scope -> the `service` column that every record already carries; the key_version watermark -> IAM key rotation. This also removes the blank-DSN failure mode where an empty ingest secret silently renders every project's DSN as an empty string in the console.
- **o11y_issues (relational)** → NOT dropped — RENAMED to `issues` (the table was stuttering its database prefix) and re-keyed (org, service, fingerprint). The added `service` fixes a live semantic bug: today the unique key is (org_id, fingerprint) with no project column, so resolving an issue in one product resolves it across every product in the org.
- **o11y_ai.observations** → DROP. The retired Langfuse plane — no writer in this fleet. Signal already carried by o11y.spans gen_ai.* attributes. cloud@65775405 deletes the last two reads (the admin fleet-LLM lens and the aimetrics generation lens), both already documented in-code as honest-empty.
- **hanzo.events** → FOLDED into o11y.records. tenant_id->org, event->name, event_type->kind, properties(JSON String)->the attribute maps, library/library_version->scope (an exact OTLP fit), and the wide marketing columns become DEFAULT-materialized columns over the maps — the same mechanism that already gives spans http_url. Its DDL stops living in the writer (cloud/clients/analytics/capture.go eventsTableDDL) and moves to the migrator, so cloud stops owning a schema it also reads. Companion policy change, not schema: the '$public' tenant is a write-to-nowhere — every reader binds the caller's validated org and '$' cannot appear in an IAM slug, so 113 of 167 anonymous error rows are structurally unreadable. Anonymous ingest must resolve a real org (the site-host carve already does) or refuse.
- **hanzo.cloud_usage** → NOT dropped, NOT moved, NOT touched. It is the money ledger, not telemetry. /v1/analytics keeps reading it as the LLM lens.
- **o11y_traces.schema_migrations_v2 / o11y_logs.schema_migrations_v2 (+ distributed) and their metrics/metadata/analytics siblings** → COLLAPSED into one o11y.migrations table carrying the hash of each rendered DDL — so drift becomes detectable, which 38 rows of migration ids never made it.

## Change sites (INCOMPLETE — see HIP-0132 §6: 34 of 48 o11y files were missing)

- hanzoai/otel-collector cmd/o11yschemamigrator/schema_migrator/squashed_traces_migrations.go — RE-AUTHORED at final state as o11y.spans + distributed_spans + traces + traces_mv + operations (+2 MVs) + resources. This is the load-bearing file: 1029 lines, 27 records, ALL of it at v2-era schema today.
- hanzoai/otel-collector cmd/o11yschemamigrator/schema_migrator/v2_squashed_logs_migration.go — becomes the o11y.records definition (it is the path RunSquashedMigrations actually calls for logs).
- hanzoai/otel-collector cmd/o11yschemamigrator/schema_migrator/squashed_logs_migrations.go (+ _test) — DELETE. Orphaned v1 set; runSquashedMigrationsForLogs is defined at manager.go:283 and never called.
- hanzoai/otel-collector cmd/o11yschemamigrator/schema_migrator/squashed_metrics_migrations.go — o11y.samples + series + the five rollups; drop samples_v2/time_series_v2/exp_hist/usage.
- hanzoai/otel-collector cmd/o11yschemamigrator/schema_migrator/meter_migrations.go — becomes o11y.usage + usage_1d.
- hanzoai/otel-collector cmd/o11yschemamigrator/schema_migrator/metadata_migrations.go — DELETE, folds into o11y.attributes.
- hanzoai/otel-collector cmd/o11yschemamigrator/schema_migrator/analytics_migrations.go — DELETE, folds into o11y.records kind='alert'.
- hanzoai/otel-collector cmd/o11yschemamigrator/schema_migrator/manager.go — Databases = []string{"o11y"} (line 37 today lists six); ONE runSquashed pass instead of the logs/metrics/traces trio at line 350; Bootstrap's five per-database V2MigrationTables fan-outs collapse to one.
- hanzoai/otel-collector cmd/o11yschemamigrator/schema_migrator/schema_migrations_v2_tables.go — one o11y.migrations table carrying a DDL hash.
- hanzoai/otel-collector cmd/o11yschemamigrator/schema_migrator/table_operations.go — ADD a Distributed-of-local derive so a distributed mirror is declared, not re-typed. Today every distributed create repeats the full column list (68 lines for the span mirror alone), in both the squashed and chain files.
- hanzoai/otel-collector cmd/o11yschemamigrator/main.go — already single-path (Bootstrap + RunSquashedMigrations, lines 145-151); drop the vestigial --down flag.
- hanzoai/otel-collector cmd/o11yotelcollector/migrate/{sync.go,sync_up.go,sync_check.go,async.go,async_up.go,async_check.go,bootstrap.go,ready.go,cmd.go} — DELETE the incremental chain CLI. THESE ARE WHY THE EXISTING WIP BRANCH DOES NOT COMPILE: I built it — 11 errors, undefined schemamigrator.TracesMigrations / LogsMigrations / LogsMigrationsV2 across async_check.go:102,114,116, async_up.go:114,119,121, sync_check.go:102,114,116, sync_up.go:113. The WIP commit's 'schema_migrator builds and its tests pass' is true and package-scoped; the repo does not build.
- hanzoai/otel-collector exporter/datastoretracesexporter/datastore_exporter.go — the five default table constants at lines 35-39 (defaultErrorTable, defaultAttributeTableV2, defaultAttributeKeyTable, defaultIndexTableV3, defaultResourceTableV3).
- hanzoai/otel-collector exporter/datastoretracesexporter/writer.go — INSERT targets at :152 (index), :235 (error -> now records), :290 (attribute keys -> attributes), :296 (tag attributes -> attributes), :518 (resource -> resources), plus the doFetchShouldSkipKeys read-back.
- hanzoai/otel-collector exporter/datastorelogsexporter/exporter.go — the six table constants at lines 54-59 and the insertLogsSQLTemplateV2 / insertLogsResourceSQLTemplate statements (:72, :113, :540, :546, :761).
- hanzoai/otel-collector exporter/o11ydatastoremetrics/factory.go — SamplesTable/TimeSeriesTable/ExpHistTable at :97-99.
- hanzoai/otel-collector exporter/o11ydatastoremeter/ — meter samples become o11y.usage.
- hanzoai/otel-collector exporter/metadataexporter/json_writer.go — the hardcoded "o11y_logs.distributed_tag_attributes_v2" at :26 (and :264).
- hanzoai/otel-collector usage/usage.go — the encrypted usage collector at :119; delete or repoint to o11y.usage.
- hanzoai/o11y pkg/telemetrytraces/tables.go, pkg/telemetrylogs/tables.go, pkg/telemetrymetrics/tables.go, pkg/telemetrymeter/tables.go, pkg/telemetrymetadata/tables.go, pkg/telemetryaudit/tables.go — SIX vocabulary files collapse to ONE. Note telemetrymeter/tables.go is already at target naming (samples, distributed_samples, samples_agg_1d) — it is the precedent, not the exception.
- hanzoai/o11y pkg/query-service/app/datastorereader/options.go — the 20 default* constants at lines 19-53, six of which name tables nothing creates or nothing reads.
- hanzoai/o11y pkg/query-service/app/datastorereader/reader.go — the ~10 errorTable sites (:2240, :2307, ...), the spans site :5080, usage_explorer :844/:846, dependency graph :902, ruleStateHistoryTableName :66, and the emptiness check :414.
- hanzoai/o11y pkg/query-service/app/datastorereader/filter_suggestions.go — attribute-catalogue reads.
- hanzoai/o11y pkg/telemetrylogs/{condition_builder.go,field_mapper.go,statement_builder.go} and pkg/telemetrytraces/{condition_builder.go,field_mapper.go,statement_builder.go} — the two builders converge on records/spans.
- hanzoai/o11y pkg/telemetryaudit/{condition_builder.go,field_mapper.go,statement_builder.go,const.go} — audit becomes kind='audit' over records, not its own database.
- hanzoai/o11y pkg/telemetrymetadata/{metadata.go,body_json_metadata.go} — reads both the audit constants and logs_v2 directly (:238).
- hanzoai/o11y pkg/telemetrymetrics/tables.go + the samples/series statement builders.
- hanzoai/o11y pkg/modules/sentry/implsentry/eventstore.go — DELETE createSchemaDDL and ensureSchema outright. Lazy runtime DDL from a read path is the second creator; there must be one.
- hanzoai/o11y pkg/modules/sentry/implsentry/{eventsql.go,module.go} — the pure builders retarget o11y.distributed_records with a leading (org, kind='error') scope; DistinctFingerprints keys on service instead of project_id.
- hanzoai/o11y pkg/modules/sentry/implsentry/projectstore.go — DELETE with the projects table.
- hanzoai/o11y pkg/modules/errortracking/implerrortracking/{store.go,fingerprint.go,reuse.go,envelope.go,sink.go} — keep the fingerprint + issue engine verbatim, retarget the sink; sink.go's documented-but-unbuilt OccurrenceSink becomes unnecessary because the occurrence IS the record.
- hanzoai/o11y pkg/sqlmigration/100_add_error_tracking.go — o11y_issues -> issues, key (org, service, fingerprint).
- hanzoai/o11y pkg/sqlmigration/101_add_sentry_projects.go — DELETE; and pkg/o11y/provider.go:223-224 where both factories are registered.
- hanzoai/o11y pkg/modules/rulestatehistory/implrulestatehistory/store.go — :23 rule state -> records kind='alert'.
- hanzoai/o11y pkg/querier/o11yquerier/provider.go and pkg/o11y/o11y.go — the per-signal provider wiring that names the audit/meter/metadata planes.
- hanzoai/o11y pkg/apiserver/o11yapiserver/errortracking.go — DELETE the org-DSN ingest routes (already 403 in production).
- hanzoai/o11y mount.go — rewriteExternalPath; the asymmetry that killed the org-DSN ingest goes away with the door.
- hanzoai/cloud clients/o11y/tables.go + tables_test.go — ALREADY AUTHORED on branch o11y/v1-table-names (commit 65775405) and must change AGAIN: o11y_traces.distributed_spans -> o11y.distributed_spans, o11y_logs.distributed_records -> o11y.distributed_records.
- hanzoai/cloud clients/o11y/{logs.go,metricsread.go,tracesink.go,ingest.go,zapingest.go,event_ingest.go,spanconv.go,alerts.go}
- hanzoai/cloud clients/admin/{o11y.go,aimetrics.go} (+ their tests) — the const block at o11y.go:26-29,58-60 and the o11y_ai.observations reads.
- hanzoai/cloud clients/eval/metrics.go:335 — genAISpanTable.
- hanzoai/cloud clients/analytics/capture.go — DELETE eventsTableDDL and EnsureEventsTable. The writer stops owning DDL; the migrator owns it. (This also removes the odd second caller, analytics.Outcomes at outcomes.go:45, creating a table from a read path.)
- hanzoai/cloud clients/analytics/{query.go,event.go,public.go,publishable.go,insights.go,analytics.go,outcomes.go,campaign.go,forward.go} — query.go:41's `const eventsTable`, the /v1/ingest + /v1/analytics + /v1/tracker + /v1/insights/e doors, GET /v1/errors (live, 403 vs a 404 control, and read by nothing first-party), and the $public tenant at public.go:89.
- hanzoai/cloud clients/guide/{detect.go,gtm.go} — detect.go:127 carries a SECOND `const eventsTable` literal for the same table; a rename that misses it breaks the guide silently.
- hanzoai/cloud clients/campaign/metrics.go:89
- hanzoai/cloud apps/apps.go:265 — the o11y PluginSpec prefixes (/v1/o11y, /v1/sentry) and the gate's isSentryIngestPath / isErrorIngestPath exemptions.
- universe infra/k8s/ingress/routes.yaml:1397 and infra/k8s/kustomization.yaml — both still assert sentry.hanzo.ai reads GET /v1/errors, which console has zero references to. Comments are a surface too.
- ONE COMMIT — per repo, landed together, plus one migrator run in the same window. This is not a style preference: cloud commit 65775405 (branch o11y/v1-table-names, unmerged, NOT on main) already renames the READ side to distributed_spans/distributed_records, and otel-collector commit a9b99a1 (branch v1/one-generation, unmerged) already deletes the chain that CREATES the table the exporter WRITES. Either one alone produces HTTP 200, zero rows, and no log line — the exact failure this cut exists to end. A half-renamed surface is two surfaces.

## Scope

HONEST ANSWER: NO, THIS CANNOT BE DONE WITHOUT RE-AUTHORING THE SQUASHED TRACES MIGRATION AT THE v3 SCHEMA. That is the whole job's centre of mass, and the existing WIP branch says so in its own commit message.

THE NUMBERS, measured not estimated:
- squashed_traces_migrations.go = 1029 lines / 27 migration records, ALL at v2-era schema. It creates o11y_index_v2, distributed_o11y_index_v2, o11y_spans, durationSort, the dependency-graph MVs and usage_explorer. Not one of those is the live plane.
- The live v3 definition exists ONLY in the incremental chain file traces_migrations.go (1164 lines, deleted by WIP a9b99a1). Its migration 1000 creates o11y_index_v3 with 91 COLUMN DEFINITIONS and 22 skip indexes, then distributed_o11y_index_v3 with a further 68. Migrations 1004-1010 then add `resource JSON`, `scope JSON`, `resource_string_service$$name_exists` to BOTH, and rewrite four MV queries.
- So the create-at-final-state span pair as the migrator is written today is 91 + 68 = 159 column definitions, not the 110 the WIP note claims — that number is wrong in both directions (the local table alone is 91).
- ONE GENERATION SHRINKS IT. 30 of the 91 are v2-compat ALIAS columns (traceID, spanID, durationNano, serviceName, httpRoute...) that exist only to look like the retired generation; cloud@65775405 already moved every read to the real column. And the distributed mirror should be DERIVED from the local table, not retyped — the migrator has no such helper today (verified: every distributed create in both the squashed and chain files repeats its full column list). With both: roughly 70 authored column definitions for the span pair instead of 159, and the same trick removes ~200 more lines across logs/metrics.

SIZING, by piece:
- otel-collector DDL: 1-2 focused days. The traces file is the risk; metrics/logs/meter/metadata/analytics folds are mechanical beside it. Must be exercised against a real datastore — the re-authored DDL is NEW TEXT, and this codebase has already shipped one create-at-final-state DDL (implsentry/eventstore.go) whose own comment admits it was never byte-verified.
- Deleting the chain is NOT free and is not what the WIP branch achieved. I compiled it: cmd/o11yotelcollector/migrate has 11 undefined-symbol errors across four files. Those four files must be deleted in the same change.
- o11y read plane: six tables.go collapse to one; datastorereader has 20 default constants and ~15 query sites; telemetryaudit becomes a filter over records; sentry's eventstore/eventsql retarget and its lazy DDL is deleted; two sqlmigrations change. Call it 2-3 days including tripwire tests.
- cloud: ~25 files. Twelve of them are ALREADY WRITTEN on branch o11y/v1-table-names (+361/-229) and must be redone against the new database name — that branch picked o11y_traces.distributed_spans and o11y_logs.distributed_records, which fixes the table names but KEEPS the signal-split databases, and o11y_logs.records cannot also hold pageviews. The half-done work is a hazard, not a head start.

WHAT DOES NOT MOVE: THE DATA. 137M log rows, 268M metric samples, 3.5M spans live in the old tables. Do NOT write an INSERT...SELECT for them: logs and spans carry a 15-day TTL and metrics have been frozen since 2026-07-10, so the old tables age out on their own inside one retention window. The single exception is hanzo.events (2-YEAR TTL, ~15K rows) — one INSERT...SELECT, minutes.

THREE THINGS THAT CANNOT BE CLOSED BY THIS COMMIT, stated so nobody claims them:
1. The metrics half is UNVERIFIABLE in production today. o11ydatastoremetrics is in no deployed pipeline (18 days of no data), and the exporters now run inside the cloud pod rather than a standalone collector. Renaming those tables changes nothing observable until that pipeline is restored.
2. The '$public' write-to-nowhere is an INGEST POLICY defect, not a schema defect. The unified table gives those rows a home; only a policy change (resolve a real org via the site-host carve, or refuse) makes them readable.
3. Dropping o11y_sentry_projects changes the DSN WIRE. @hanzo/event parses DSNs itself and takes the userinfo verbatim, so a pk- key drops straight in; third-party Sentry SDKs keep working via ?sentry_key=. But it is a product change with its own rollout, and it should be sized and shipped as its own commit AFTER the storage cut lands — not smuggled inside it.

FINALLY, THE THING THAT MAKES THIS URGENT RATHER THAN TIDY: the two halves of this rename already exist, on two unmerged branches, in two repos, pointing at DIFFERENT names. cloud reads distributed_spans; the collector creates distributed_o11y_index_v3, and the branch that was supposed to fix that deletes the only code that creates it. Whoever merges one of those branches alone gets HTTP 200, zero rows, and no error in any log.
