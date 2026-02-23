---
hip: 0059
title: Timeseries Database Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-02-23
---

# HIP-59: Timeseries Database Standard

## Abstract

This proposal defines the timeseries database standard for the Hanzo ecosystem.
Hanzo Metrics provides a dedicated TimescaleDB instance for storing, querying,
and aggregating infrastructure metrics, AI performance telemetry, and
operational time-series data. Every Hanzo service that produces or consumes
numeric measurements indexed by time MUST use the cluster-local TimescaleDB
instance following this specification.

**Repository**: [github.com/hanzoai/metrics](https://github.com/hanzoai/metrics)
**Image**: `ghcr.io/hanzoai/metrics:latest`
**Ports**: 8059 (HTTP API), 5433 (PostgreSQL wire protocol)
**Engine**: TimescaleDB 2.x on PostgreSQL 16+

## Motivation

Hanzo operates 14 Zen models, 100+ third-party LLM providers, and dozens of
infrastructure services across two DOKS Kubernetes clusters. Each of these
produces a continuous stream of numeric measurements: request latencies, token
throughput, GPU utilization, memory pressure, queue depths, error rates, and
cost accumulation.

Today, Prometheus (HIP-0031) handles short-term metrics with a 15-day retention
window. ClickHouse (HIP-0047) handles high-volume analytics events. But a gap
exists between these two systems:

1. **Prometheus is not a long-term database.** Its local TSDB is designed for
   real-time alerting with limited retention. Queries over weeks or months
   require workarounds like Thanos or Cortex, each introducing significant
   operational complexity (object storage, compactors, store gateways, query
   frontends). We need a simpler long-term metrics store.

2. **ClickHouse is optimized for analytics, not metrics.** ClickHouse excels
   at scanning billions of wide event rows with dozens of string columns. Metrics
   are narrow: a timestamp, a metric name, a numeric value, and a handful of
   labels. ClickHouse can store metrics, but it lacks native constructs for
   continuous aggregation, time-bucket functions, gap filling, and
   last-observation-carried-forward interpolation that metrics queries demand
   constantly.

3. **AI workloads need metric correlation with relational data.** When a model's
   p99 latency spikes, engineers need to JOIN that timeseries against the
   relational model registry (which model version, which GPU node, which
   organization's traffic caused the spike). This requires the metrics database
   to speak SQL and live in the PostgreSQL ecosystem where relational tables
   already exist.

4. **No rollup pipeline.** Raw metrics at 1-second resolution consume
   substantial storage. A single metric with 100 label combinations produces
   8.6 million data points per day. After 90 days, that is 780 million rows
   for ONE metric. Without continuous aggregation that rolls 1-second data
   into 1-minute, 1-hour, and 1-day summaries, long-term metric storage is
   economically infeasible.

5. **Alerting needs historical context.** Alert rules that fire on "p99 latency
   exceeds the 30-day rolling average by 3 standard deviations" require
   efficient access to 30 days of aggregated latency data. Prometheus cannot
   serve this. ClickHouse can, but not with the ergonomics that time-series
   native functions provide.

We need a dedicated timeseries database that bridges the gap between
Prometheus's real-time window and ClickHouse's analytics warehouse.

## Design Philosophy

This section explains the reasoning behind each major architectural decision.
Understanding the *why* is as important as understanding the *what*.

### Why TimescaleDB Over InfluxDB

InfluxDB is the most well-known open-source time-series database. We reject
it for three reasons:

1. **SQL compatibility.** TimescaleDB is a PostgreSQL extension. Every SQL
   tool, ORM, driver, and visualization platform that works with PostgreSQL
   works with TimescaleDB unchanged. InfluxDB uses Flux (InfluxDB 2.x) or
   InfluxQL (1.x), both proprietary query languages. Flux is being deprecated
   in favor of SQL in InfluxDB 3.x, which validates our position: the industry
   is converging on SQL for time-series.

2. **PostgreSQL ecosystem.** TimescaleDB inherits PostgreSQL's mature ecosystem:
   pgvector for embeddings, pg_cron for scheduling, pg_stat_statements for
   query analysis, logical replication, point-in-time recovery, and decades of
   operational tooling. InfluxDB is a standalone system with its own backup,
   replication, and monitoring tools that our team must learn separately.

3. **JOIN with relational data.** The killer feature. TimescaleDB hypertables
   live in the same PostgreSQL database as regular tables. A single query can
   JOIN a timeseries of model latencies against a relational table of model
   configurations, deployment versions, or organization metadata. InfluxDB
   cannot do this without exporting data to an external system.

**Decision**: Use TimescaleDB. SQL compatibility and PostgreSQL ecosystem
integration outweigh InfluxDB's purpose-built ingestion performance.

### Why TimescaleDB Over VictoriaMetrics

VictoriaMetrics is a high-performance Prometheus-compatible TSDB. It excels
as a drop-in Prometheus replacement with better compression and longer
retention. We still choose TimescaleDB because:

1. **Query expressiveness.** VictoriaMetrics uses PromQL (and MetricsQL, a
   superset). PromQL is powerful for dashboards but limited for ad-hoc
   analysis. It cannot express JOINs, subqueries with CTEs, window functions,
   or aggregations that group by non-label dimensions. SQL can express all
   of these natively.

2. **Unified storage layer.** VictoriaMetrics is metrics-only. It cannot store
   the relational metadata (model registry, deployment history, organization
   configuration) that engineers need to correlate with metrics. With
   TimescaleDB, metrics and metadata live side by side.

3. **Continuous aggregation.** TimescaleDB's continuous aggregates are
   materialized views that automatically maintain rollups as new data arrives.
   VictoriaMetrics has downsampling, but it operates as a batch process with
   less granular control over aggregation intervals and retention per tier.

**Decision**: Use TimescaleDB. VictoriaMetrics is an excellent Prometheus
backend, but we need SQL and relational JOINs.

### Why Not Just ClickHouse (HIP-0047)

ClickHouse (HIP-0047) is already deployed for analytics. Could it also store
metrics? Technically yes. Practically, the access patterns are different enough
to warrant separate systems:

| Property | Metrics (TimescaleDB) | Analytics (ClickHouse) |
|----------|----------------------|----------------------|
| Row width | Narrow (timestamp + value + 5-10 labels) | Wide (50+ columns per event) |
| Write pattern | Continuous single-row or small-batch inserts | Large batch inserts (10K+ rows) |
| Read pattern | Time-range scans with aggregation, gap filling | Full-table scans with GROUP BY |
| Query language | SQL with time-series functions | SQL with columnar optimizations |
| Rollups | Continuous aggregation (real-time) | Materialized views (insert-triggered) |
| Retention | Tiered (hot/warm/cold with different resolutions) | TTL-based (uniform resolution) |
| JOIN requirement | Frequent JOINs with relational metadata | Rare JOINs (denormalized schema) |
| Cardinality | Low-medium (metric names x label values) | High (arbitrary user properties) |

ClickHouse's batch-insert requirement is the fundamental incompatibility. Metrics
arrive continuously -- a Prometheus remote-write flush every 15 seconds sends
hundreds of individual metric samples. ClickHouse's `too many parts` failure mode
punishes exactly this pattern. TimescaleDB, built on PostgreSQL's WAL-based
storage, handles continuous small inserts without degradation.

**Decision**: TimescaleDB for metrics. ClickHouse for analytics. Different tools
for different access patterns.

### Why a Separate Instance (Port 5433, Not 5432)

Hanzo already runs PostgreSQL on port 5432 for transactional data (IAM, Cloud,
Console). Why not add TimescaleDB as an extension to the existing instance?

1. **Resource isolation.** Metric ingestion is write-heavy and continuous.
   A burst of metric writes (GPU cluster scaling event producing 50,000
   data points per second) should not increase p99 latency on IAM login
   queries running on the same PostgreSQL instance.

2. **Independent scaling.** The transactional PostgreSQL instance scales
   based on connection count and query complexity. The metrics instance
   scales based on data volume and retention depth. These dimensions are
   uncorrelated.

3. **Different maintenance windows.** TimescaleDB chunk compression,
   continuous aggregate refresh, and retention policy enforcement create
   I/O spikes. These should not compete with transactional VACUUM and
   autovacuum cycles.

4. **Configuration tuning.** Metrics workloads benefit from aggressive
   `shared_buffers`, large `work_mem` for time-bucket aggregations, and
   `synchronous_commit = off` for higher write throughput. These settings
   would harm transactional workload latency if shared.

**Decision**: Dedicated TimescaleDB instance on port 5433. Isolated from
transactional PostgreSQL on port 5432.

## Specification

### Architecture Overview

```
                    ┌─────────────────────────────────────────┐
                    │           Hanzo Services                 │
                    │  (LLM Gateway, Cloud, IAM, Nodes)       │
                    └──────┬──────────────┬───────────────────┘
                           │              │
                   Prometheus         Direct SQL
                   remote_write       (port 5433)
                   (port 8059)            │
                           │              │
                    ┌──────▼──────────────▼───────────────────┐
                    │          Hanzo Metrics                   │
                    │    ┌─────────────────────────────┐      │
                    │    │   HTTP API (port 8059)       │      │
                    │    │   Prometheus remote-write    │      │
                    │    │   compatible ingestion       │      │
                    │    └──────────┬──────────────────┘      │
                    │               │                          │
                    │    ┌──────────▼──────────────────┐      │
                    │    │   TimescaleDB (port 5433)    │      │
                    │    │   PostgreSQL 16 + Timescale  │      │
                    │    │                              │      │
                    │    │   ┌──── Hypertables ───────┐│      │
                    │    │   │ metrics_raw     (1s)   ││      │
                    │    │   │ metrics_1m      (cagg) ││      │
                    │    │   │ metrics_1h      (cagg) ││      │
                    │    │   │ metrics_1d      (cagg) ││      │
                    │    │   └────────────────────────┘│      │
                    │    │                              │      │
                    │    │   ┌──── Relational ────────┐│      │
                    │    │   │ metric_metadata         ││      │
                    │    │   │ alert_rules             ││      │
                    │    │   │ alert_state             ││      │
                    │    │   └────────────────────────┘│      │
                    │    └─────────────────────────────┘      │
                    └──────────────┬───────────────────────────┘
                                   │
                    ┌──────────────▼───────────────────┐
                    │   Consumers                      │
                    │   - Visor dashboards (HIP-0053)  │
                    │   - Grafana (HIP-0031)           │
                    │   - Alert evaluator              │
                    │   - Analytics (HIP-0017)         │
                    └──────────────────────────────────┘
```

### Hypertable Schema

The core data model uses a single hypertable partitioned by time with a
label-based schema following the Prometheus data model.

#### Raw Metrics Table

```sql
-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Core metrics hypertable
CREATE TABLE metrics_raw (
    time        TIMESTAMPTZ      NOT NULL,
    metric      TEXT             NOT NULL,
    value       DOUBLE PRECISION NOT NULL,

    -- Labels (denormalized for query performance)
    service     TEXT             NOT NULL DEFAULT '',
    instance    TEXT             NOT NULL DEFAULT '',
    org_id      TEXT             NOT NULL DEFAULT '',
    model       TEXT             NOT NULL DEFAULT '',
    provider    TEXT             NOT NULL DEFAULT '',
    node        TEXT             NOT NULL DEFAULT '',
    endpoint    TEXT             NOT NULL DEFAULT '',
    status      TEXT             NOT NULL DEFAULT '',

    -- Overflow labels stored as JSONB for low-frequency dimensions
    labels      JSONB            NOT NULL DEFAULT '{}'
);

-- Convert to hypertable with 1-hour chunks
SELECT create_hypertable(
    'metrics_raw',
    by_range('time', INTERVAL '1 hour')
);

-- Composite index for the most common query pattern:
-- "give me metric X for service Y over time range Z"
CREATE INDEX idx_metrics_raw_metric_service_time
    ON metrics_raw (metric, service, time DESC);

-- Index for organization-scoped queries (billing, usage dashboards)
CREATE INDEX idx_metrics_raw_org_time
    ON metrics_raw (org_id, time DESC)
    WHERE org_id != '';

-- Index for model-specific queries (AI performance)
CREATE INDEX idx_metrics_raw_model_time
    ON metrics_raw (model, time DESC)
    WHERE model != '';
```

**Design decisions in this schema**:

- **Denormalized labels** rather than a normalized label table with JOINs.
  Metric queries filter by label values in WHERE clauses. Denormalized columns
  enable B-tree index scans. A normalized design would require JOINs on every
  query, adding 2-5ms latency that compounds on dashboard loads with 20+ panels.

- **JSONB `labels` column** for overflow. Most metrics use 3-5 well-known
  labels (service, instance, model). Occasionally, a metric carries additional
  context (Kubernetes pod name, deployment revision, canary group). These
  low-frequency labels go into JSONB rather than adding more columns.

- **1-hour chunk interval.** TimescaleDB partitions hypertables into chunks
  by time range. Smaller chunks (1 hour) mean faster chunk exclusion during
  time-range queries and more granular compression. With 1-hour chunks, a
  query for the last 24 hours touches only 24 chunks instead of scanning
  the entire table.

- **`TIMESTAMPTZ`** not `TIMESTAMP`. All times are stored in UTC. TimescaleDB's
  time-series functions (`time_bucket`, `time_bucket_gapfill`) work correctly
  with timezone-aware timestamps.

#### AI-Specific Metrics

The following standard metric names MUST be used by all AI services:

```sql
-- Token throughput (LLM Gateway, HIP-0004)
-- metric: hanzo_llm_tokens_total
-- labels: model, provider, org_id, token_type (prompt|completion)

-- Model latency distribution
-- metric: hanzo_llm_request_duration_seconds
-- labels: model, provider, org_id, status, quantile

-- GPU utilization (Compute nodes)
-- metric: hanzo_gpu_utilization_percent
-- labels: node, gpu_index, model

-- GPU memory usage
-- metric: hanzo_gpu_memory_used_bytes
-- labels: node, gpu_index, model

-- Cost accumulation (per-organization running total)
-- metric: hanzo_cost_accumulated_usd
-- labels: org_id, model, provider

-- Inference queue depth
-- metric: hanzo_inference_queue_depth
-- labels: model, provider

-- Cache hit rate (LLM semantic cache)
-- metric: hanzo_cache_hit_ratio
-- labels: model, cache_type (semantic|exact)

-- Active concurrent requests
-- metric: hanzo_requests_active
-- labels: service, endpoint
```

### Continuous Aggregation

Continuous aggregates are the mechanism by which raw 1-second data is rolled
up into coarser resolutions. TimescaleDB evaluates these incrementally -- only
new data since the last refresh is processed, not the entire dataset.

#### 1-Minute Rollup

```sql
CREATE MATERIALIZED VIEW metrics_1m
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 minute', time)   AS bucket,
    metric,
    service,
    instance,
    org_id,
    model,
    provider,
    node,
    endpoint,
    status,
    AVG(value)                      AS avg_value,
    MIN(value)                      AS min_value,
    MAX(value)                      AS max_value,
    COUNT(*)                        AS sample_count,
    -- Approximate percentiles for latency distributions
    percentile_agg(value)           AS pct_agg
FROM metrics_raw
GROUP BY bucket, metric, service, instance, org_id,
         model, provider, node, endpoint, status;

-- Refresh policy: process new data every 1 minute, with a 5-minute lag
-- to ensure late-arriving samples are included
SELECT add_continuous_aggregate_policy('metrics_1m',
    start_offset    => INTERVAL '10 minutes',
    end_offset      => INTERVAL '5 minutes',
    schedule_interval => INTERVAL '1 minute'
);
```

#### 1-Hour Rollup

```sql
CREATE MATERIALIZED VIEW metrics_1h
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', bucket)   AS bucket,
    metric,
    service,
    org_id,
    model,
    provider,
    status,
    AVG(avg_value)                  AS avg_value,
    MIN(min_value)                  AS min_value,
    MAX(max_value)                  AS max_value,
    SUM(sample_count)               AS sample_count,
    rollup(pct_agg)                 AS pct_agg
FROM metrics_1m
GROUP BY bucket, metric, service, org_id,
         model, provider, status;

SELECT add_continuous_aggregate_policy('metrics_1h',
    start_offset    => INTERVAL '4 hours',
    end_offset      => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour'
);
```

#### 1-Day Rollup

```sql
CREATE MATERIALIZED VIEW metrics_1d
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', bucket)    AS bucket,
    metric,
    service,
    org_id,
    model,
    provider,
    AVG(avg_value)                  AS avg_value,
    MIN(min_value)                  AS min_value,
    MAX(max_value)                  AS max_value,
    SUM(sample_count)               AS sample_count,
    rollup(pct_agg)                 AS pct_agg
FROM metrics_1h
GROUP BY bucket, metric, service, org_id,
         model, provider;

SELECT add_continuous_aggregate_policy('metrics_1d',
    start_offset    => INTERVAL '3 days',
    end_offset      => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day'
);
```

**Why cascaded aggregation** (1m from raw, 1h from 1m, 1d from 1h): Each
level processes only the data from the level below, not the full raw dataset.
Rolling up 1 day of raw data at 1-second resolution means aggregating
86,400 rows per metric-label combination. Rolling up 1 day from the 1-minute
aggregate means aggregating only 1,440 rows. Rolling up from the 1-hour
aggregate means 24 rows. The computational cost decreases by orders of
magnitude at each tier.

### Retention Policies

Data retention follows a tiered model. Higher resolution data expires sooner;
aggregated data lives longer.

| Tier | Resolution | Retention | Storage (est. per 1000 metrics) | Source |
|------|-----------|-----------|--------------------------------|--------|
| **Hot** | 1 second (raw) | 7 days | ~25 GB | `metrics_raw` |
| **Warm** | 1 minute (aggregated) | 90 days | ~3 GB | `metrics_1m` |
| **Cool** | 1 hour (aggregated) | 365 days | ~150 MB | `metrics_1h` |
| **Cold** | 1 day (aggregated) | Indefinite | ~5 MB/year | `metrics_1d` |

Retention is enforced by TimescaleDB's built-in retention policies, which
drop entire chunks when they expire. This is an O(1) operation (dropping a
PostgreSQL table) rather than an O(n) row-by-row DELETE.

```sql
-- Drop raw data older than 7 days
SELECT add_retention_policy('metrics_raw', INTERVAL '7 days');

-- Drop 1-minute aggregates older than 90 days
SELECT add_retention_policy('metrics_1m', INTERVAL '90 days');

-- Drop 1-hour aggregates older than 1 year
SELECT add_retention_policy('metrics_1h', INTERVAL '365 days');

-- Daily aggregates are kept indefinitely (negligible storage)
```

### Chunk Compression

TimescaleDB compresses older chunks using columnar compression, reducing
storage by 10-20x. Compressed chunks are still queryable via standard SQL
but cannot accept new writes.

```sql
-- Enable compression on raw hypertable
ALTER TABLE metrics_raw SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'metric, service, org_id',
    timescaledb.compress_orderby = 'time DESC'
);

-- Compress chunks older than 2 hours (after continuous aggregation has processed them)
SELECT add_compression_policy('metrics_raw', INTERVAL '2 hours');

-- Compress 1-minute aggregates older than 1 day
ALTER MATERIALIZED VIEW metrics_1m SET (
    timescaledb.compress
);
SELECT add_compression_policy('metrics_1m', INTERVAL '1 day');
```

**Why `compress_segmentby = 'metric, service, org_id'`**: Compression groups
rows by segment columns. Queries that filter on these columns can skip
entire compressed segments without decompression. Since nearly every metric
query filters by metric name and service (and often org_id), segmenting on
these columns gives the best query-time performance on compressed data.

### Prometheus Remote-Write Ingestion

The HTTP API on port 8059 accepts Prometheus remote-write protocol, making
Hanzo Metrics a drop-in long-term storage backend for any Prometheus instance.

```
┌────────────┐    remote_write     ┌─────────────────────┐
│ Prometheus │ ──────────────────→ │ Metrics API (:8059) │
│ (HIP-0031) │    (protobuf/snappy)│                     │
│  15-day    │                     │  - Decode protobuf   │
│  retention │                     │  - Map labels → cols │
└────────────┘                     │  - Batch INSERT      │
                                   └──────────┬──────────┘
                                              │
                                   ┌──────────▼──────────┐
                                   │ TimescaleDB (:5433) │
                                   │   metrics_raw       │
                                   └─────────────────────┘
```

#### Prometheus Configuration

```yaml
# prometheus.yml (HIP-0031 Zap configuration)
remote_write:
  - url: "http://metrics-api:8059/api/v1/write"
    queue_config:
      max_samples_per_send: 5000
      batch_send_deadline: 15s
      max_shards: 10
    write_relabel_configs:
      # Only send metrics with the hanzo_ prefix to long-term storage
      - source_labels: [__name__]
        regex: 'hanzo_.*'
        action: keep
```

**Why relabel to `hanzo_` prefix only**: Prometheus scrapes thousands of
internal metrics from every pod (Go runtime, HTTP handler, gRPC, Kubernetes
cadvisor). Most of these are useful only for real-time debugging within
Prometheus's 15-day window. Only Hanzo-defined metrics (`hanzo_llm_*`,
`hanzo_gpu_*`, `hanzo_cost_*`, etc.) need long-term retention. The relabel
filter reduces write volume by 90%+ and keeps TimescaleDB focused on
business-relevant metrics.

#### Remote-Write API

The ingestion endpoint implements the Prometheus remote-write specification
(protobuf with Snappy compression):

```
POST /api/v1/write
Content-Type: application/x-protobuf
Content-Encoding: snappy

# Request body: prometheus.WriteRequest protobuf message
# Response: 204 No Content (success) or 400/500 with error details
```

The API server decodes the protobuf, maps well-known labels to denormalized
columns, and inserts into `metrics_raw` using `COPY` for maximum throughput.

### Query Interface

Services query TimescaleDB directly over the PostgreSQL wire protocol
(port 5433) using standard SQL. The HTTP API (port 8059) also exposes a
PromQL-compatible read endpoint for Grafana compatibility.

#### Common Query Patterns

**Model latency over time** (Visor dashboard, HIP-0053):
```sql
SELECT
    time_bucket('5 minutes', time)              AS bucket,
    model,
    AVG(value)                                  AS avg_latency,
    approx_percentile(0.99, pct_agg)            AS p99_latency
FROM metrics_1m
WHERE metric = 'hanzo_llm_request_duration_seconds'
  AND time > NOW() - INTERVAL '24 hours'
GROUP BY bucket, model
ORDER BY bucket;
```

**GPU utilization heatmap** (operations dashboard):
```sql
SELECT
    time_bucket('1 hour', time)                 AS bucket,
    node,
    AVG(value)                                  AS avg_util,
    MAX(value)                                  AS peak_util
FROM metrics_1m
WHERE metric = 'hanzo_gpu_utilization_percent'
  AND time > NOW() - INTERVAL '7 days'
GROUP BY bucket, node
ORDER BY bucket, node;
```

**Cost accumulation by organization** (billing, HIP-0017):
```sql
SELECT
    org_id,
    model,
    time_bucket('1 day', bucket)                AS day,
    MAX(avg_value) - MIN(avg_value)             AS daily_cost_usd
FROM metrics_1h
WHERE metric = 'hanzo_cost_accumulated_usd'
  AND bucket > NOW() - INTERVAL '30 days'
  AND org_id = 'org_123'
GROUP BY org_id, model, day
ORDER BY day;
```

**Gap-filled time series** (for smooth chart rendering):
```sql
SELECT
    time_bucket_gapfill('1 minute', time)       AS bucket,
    COALESCE(AVG(value), 0)                     AS value,
    locf(AVG(value))                            AS value_interpolated
FROM metrics_raw
WHERE metric = 'hanzo_requests_active'
  AND service = 'llm-gateway'
  AND time > NOW() - INTERVAL '1 hour'
GROUP BY bucket
ORDER BY bucket;
```

**`locf` (Last Observation Carried Forward)** fills gaps by repeating the
most recent known value. This is critical for metrics that report only on
change (gauge metrics from intermittent scrapers) where missing data points
mean "same as before," not "zero."

### Alerting Rules Engine

TimescaleDB stores alert rule definitions and maintains alert state. The
alert evaluator is a lightweight Go process that runs SQL queries on a
schedule and fires notifications when thresholds are breached.

```sql
-- Alert rules table
CREATE TABLE alert_rules (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    description     TEXT NOT NULL DEFAULT '',
    query           TEXT NOT NULL,
    condition       TEXT NOT NULL,  -- 'gt', 'lt', 'eq', 'ne'
    threshold       DOUBLE PRECISION NOT NULL,
    for_duration    INTERVAL NOT NULL DEFAULT '5 minutes',
    severity        TEXT NOT NULL DEFAULT 'warning',
    labels          JSONB NOT NULL DEFAULT '{}',
    annotations     JSONB NOT NULL DEFAULT '{}',
    enabled         BOOLEAN NOT NULL DEFAULT true,
    eval_interval   INTERVAL NOT NULL DEFAULT '1 minute',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Alert state (current firing/pending/resolved)
CREATE TABLE alert_state (
    rule_id         INTEGER REFERENCES alert_rules(id),
    state           TEXT NOT NULL DEFAULT 'inactive',
    value           DOUBLE PRECISION,
    fired_at        TIMESTAMPTZ,
    resolved_at     TIMESTAMPTZ,
    last_eval       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (rule_id)
);
```

Example alert rule: notify when LLM p99 latency exceeds 5 seconds for
5 consecutive minutes:

```sql
INSERT INTO alert_rules (name, description, query, condition, threshold, for_duration, severity)
VALUES (
    'llm_p99_latency_high',
    'LLM request p99 latency exceeds 5 seconds',
    $$
        SELECT approx_percentile(0.99, pct_agg)
        FROM metrics_1m
        WHERE metric = 'hanzo_llm_request_duration_seconds'
          AND bucket > NOW() - INTERVAL '10 minutes'
    $$,
    'gt',
    5.0,
    '5 minutes',
    'critical'
);
```

Alert notifications are dispatched via HIP-0031 (Zap) webhook integration
to Slack, PagerDuty, or any webhook-compatible endpoint.

### Metric Metadata

A relational table stores metric descriptions, types, and units for
self-documenting metric discovery:

```sql
CREATE TABLE metric_metadata (
    metric          TEXT PRIMARY KEY,
    type            TEXT NOT NULL,      -- 'gauge', 'counter', 'histogram', 'summary'
    unit            TEXT NOT NULL DEFAULT '',
    description     TEXT NOT NULL DEFAULT '',
    service         TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed with standard Hanzo metrics
INSERT INTO metric_metadata (metric, type, unit, description, service) VALUES
    ('hanzo_llm_tokens_total', 'counter', 'tokens', 'Total LLM tokens processed', 'llm-gateway'),
    ('hanzo_llm_request_duration_seconds', 'histogram', 'seconds', 'LLM request latency distribution', 'llm-gateway'),
    ('hanzo_gpu_utilization_percent', 'gauge', 'percent', 'GPU compute utilization', 'compute'),
    ('hanzo_gpu_memory_used_bytes', 'gauge', 'bytes', 'GPU memory in use', 'compute'),
    ('hanzo_cost_accumulated_usd', 'counter', 'usd', 'Cumulative cost per organization', 'billing'),
    ('hanzo_inference_queue_depth', 'gauge', 'requests', 'Pending inference requests', 'llm-gateway'),
    ('hanzo_cache_hit_ratio', 'gauge', 'ratio', 'Semantic/exact cache hit rate', 'llm-gateway'),
    ('hanzo_requests_active', 'gauge', 'requests', 'Active concurrent requests', '*');
```

## Implementation

### Deployment

#### Docker (Development)

```yaml
# compose.yml
services:
  metrics-db:
    image: timescale/timescaledb:latest-pg16
    ports:
      - "5433:5432"
    environment:
      POSTGRES_DB: hanzo_metrics
      POSTGRES_USER: hanzo
      POSTGRES_PASSWORD: "${METRICS_DB_PASSWORD}"
    volumes:
      - metrics_data:/var/lib/postgresql/data
      - ./schemas/init.sql:/docker-entrypoint-initdb.d/01-init.sql
    command: >
      postgres
        -c shared_preload_libraries=timescaledb
        -c timescaledb.telemetry_level=off
        -c max_connections=200
        -c shared_buffers=2GB
        -c work_mem=64MB
        -c synchronous_commit=off
        -c wal_level=replica
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U hanzo -d hanzo_metrics"]
      interval: 10s
      timeout: 5s
      retries: 3

  metrics-api:
    image: ghcr.io/hanzoai/metrics:latest
    ports:
      - "8059:8059"
    environment:
      DATABASE_URL: "postgresql://hanzo:${METRICS_DB_PASSWORD}@metrics-db:5432/hanzo_metrics"
      LISTEN_ADDR: "0.0.0.0:8059"
    depends_on:
      metrics-db:
        condition: service_healthy

volumes:
  metrics_data:
```

#### Kubernetes (Production)

```yaml
# k8s/metrics-statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: metrics-db
  namespace: hanzo
spec:
  serviceName: metrics-db
  replicas: 1
  selector:
    matchLabels:
      app: metrics-db
  template:
    metadata:
      labels:
        app: metrics-db
    spec:
      containers:
        - name: timescaledb
          image: timescale/timescaledb:latest-pg16
          ports:
            - containerPort: 5432
              name: postgresql
          env:
            - name: POSTGRES_DB
              value: hanzo_metrics
            - name: POSTGRES_USER
              value: hanzo
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: metrics-db-credentials
                  key: password
          args:
            - postgres
            - -c
            - shared_preload_libraries=timescaledb
            - -c
            - timescaledb.telemetry_level=off
            - -c
            - max_connections=200
            - -c
            - shared_buffers=4GB
            - -c
            - work_mem=128MB
            - -c
            - synchronous_commit=off
            - -c
            - effective_cache_size=12GB
          resources:
            requests:
              memory: 8Gi
              cpu: "4"
            limits:
              memory: 16Gi
              cpu: "8"
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: [ReadWriteOnce]
        resources:
          requests:
            storage: 200Gi
        storageClassName: do-block-storage
---
apiVersion: v1
kind: Service
metadata:
  name: metrics-db
  namespace: hanzo
spec:
  selector:
    app: metrics-db
  ports:
    - port: 5433
      targetPort: 5432
      name: postgresql
  clusterIP: None
```

#### Resource Sizing Guide

| Cluster Size | Metrics | Scrape Interval | CPU | RAM | Disk |
|-------------|---------|-----------------|-----|-----|------|
| Small (dev) | < 500 | 15s | 2 cores | 4 GB | 50 GB |
| Medium | 500 - 5,000 | 15s | 4 cores | 8 GB | 200 GB |
| Large | 5,000 - 50,000 | 10s | 8 cores | 16 GB | 500 GB |
| XL | 50,000+ | 10s | 16 cores | 32 GB | 1 TB |

### Integration Points

#### O11y / Zap (HIP-0031)

Zap is the primary data producer. It scrapes Prometheus metrics from every
Hanzo service and remote-writes the `hanzo_*` subset to the Metrics API.
TimescaleDB serves as the long-term storage backend that extends Prometheus's
15-day retention to 1 year+.

```
Zap sidecar → Prometheus (15-day real-time) → remote_write → Metrics API → TimescaleDB (1y+)
```

#### Visor Dashboards (HIP-0053)

Visor connects to TimescaleDB via the PostgreSQL wire protocol as a standard
data source. Dashboard panels issue SQL queries with `time_bucket` for
time-series charts, `approx_percentile` for latency distributions, and
`time_bucket_gapfill` for continuous line charts.

#### Analytics / Insights (HIP-0017)

Business metrics (daily active users, feature adoption, conversion rates)
are computed in ClickHouse (HIP-0047) and pushed to TimescaleDB as derived
metric time-series. This enables a single dashboard to display both
infrastructure metrics (from Prometheus) and business metrics (from
ClickHouse) with consistent time-bucketing and aggregation.

#### Grafana (HIP-0031)

Grafana's built-in PostgreSQL data source queries TimescaleDB directly.
The `timescaledb` macro support in Grafana enables `$__timeFilter(time)`,
`$__timeGroup(time, $__interval)`, and other template variables that map
to TimescaleDB time-series functions.

## Security Considerations

### Authentication

TimescaleDB inherits PostgreSQL's authentication. Two database roles are
provisioned:

| Role | Purpose | Permissions |
|------|---------|-------------|
| `hanzo` | API server, ingestion | Full DDL + DML on `hanzo_metrics` |
| `metrics_readonly` | Dashboards, Grafana, Visor | SELECT only, 60s statement timeout |

Credentials are managed through KMS (HIP-0033) and injected as Kubernetes
secrets.

### Network

- PostgreSQL port (5433) MUST be accessible only from within the Kubernetes
  cluster network (`10.0.0.0/8`).
- HTTP API port (8059) MUST be accessible only from within the cluster.
- No ports are exposed to the public internet.
- Kubernetes NetworkPolicy restricts access to pods with the label
  `metrics-client: "true"`.

### Data Classification

| Data Type | Sensitivity | Handling |
|-----------|-------------|----------|
| Metric values (numeric) | Low | Standard retention |
| Metric names | Low | Public knowledge (documented in this HIP) |
| Label values (service, instance) | Low | Internal infrastructure identifiers |
| Organization IDs (org_id) | Medium | Pseudonymized; no PII |
| Alert rules and state | Low | Operational data |

Metric data MUST NOT contain personally identifiable information. Label values
MUST be limited to infrastructure identifiers (service names, node names,
model names) and organizational pseudonyms (org_id, not org_name). If a
metric requires user-level granularity, it MUST be aggregated to remove
individual user identification before ingestion.

### Backup and Recovery

Backups use PostgreSQL's native `pg_basebackup` and WAL archiving to
MinIO (HIP-0032):

```bash
# Base backup (weekly)
pg_basebackup -D /backups/base_$(date +%Y%m%d) \
  -h metrics-db -U replication -Ft -z -P

# Continuous WAL archiving
archive_command = 'aws s3 cp %p s3://metrics-backups/wal/%f --endpoint-url http://minio:9000'
```

| Backup Type | Frequency | Retention | Storage |
|-------------|-----------|-----------|---------|
| Base backup | Weekly (Sunday 03:00 UTC) | 4 weeks | MinIO (HIP-0032) |
| WAL archive | Continuous | 7 days | MinIO (HIP-0032) |

Recovery time objective (RTO): < 30 minutes.
Recovery point objective (RPO): < 5 minutes (WAL archive lag).

## References

- **HIP-0017**: Analytics Event Standard -- business event ingestion and ClickHouse queries
- **HIP-0031**: Observability & Metrics Standard -- Prometheus, Zap sidecar, Grafana
- **HIP-0032**: Object Storage Standard -- MinIO for backups
- **HIP-0033**: Secret Management Standard -- KMS for credential injection
- **HIP-0047**: Analytics Datastore Standard -- ClickHouse for OLAP analytics events
- **HIP-0053**: Visor Dashboard Standard -- dashboard queries against TimescaleDB
- **TimescaleDB Documentation**: [docs.timescale.com](https://docs.timescale.com/)
- **Prometheus Remote Write**: [prometheus.io/docs/specs/remote_write_spec](https://prometheus.io/docs/specs/remote_write_spec/)
- **PostgreSQL 16**: [postgresql.org/docs/16](https://www.postgresql.org/docs/16/)

## Copyright

This document is placed in the public domain.
