---
hip: 0047
title: Analytics Datastore Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-02-23
requires: HIP-0017, HIP-0029
---

# HIP-47: Analytics Datastore Standard

## Abstract

This proposal defines the analytics datastore standard for the Hanzo ecosystem.
Hanzo Datastore provides columnar analytics storage via ClickHouse, deployed as
a replicated cluster on each DOKS Kubernetes cluster. Every Hanzo service that
requires high-throughput event ingestion, OLAP queries, or time-series
aggregation MUST use the cluster-local ClickHouse instance following this
specification.

**Repository**: [github.com/hanzoai/datastore](https://github.com/hanzoai/datastore)
**Image**: `ghcr.io/hanzoai/datastore:latest`
**Ports**: 8123 (HTTP), 9000 (native TCP), 9440 (native TLS)
**Engine**: ClickHouse 24.x+

## Motivation

Hanzo generates massive volumes of event data across its services. Insights
(HIP-0017) ingests 10M+ events per day from product analytics, session replay,
feature flags, and A/B tests. Metrics (HIP-0031) ships structured logs to
long-term storage. Billing analytics tracks token usage, credit consumption, and
API call volumes across every organization.

All of this data shares a common characteristic: it is **append-only**, **time-
stamped**, and **queried in aggregate**. These are the exact access patterns
that row-oriented databases like PostgreSQL handle poorly and columnar databases
handle exceptionally well.

Without a dedicated analytics datastore:

1. **PostgreSQL becomes the bottleneck.** Running `SELECT COUNT(*) FROM events
   WHERE timestamp > '2026-01-01' GROUP BY user_id` on a 500M-row PostgreSQL
   table takes 45-120 seconds. The same query on ClickHouse completes in
   200-800 milliseconds. PostgreSQL scans every column of every row;
   ClickHouse reads only the columns referenced in the query.

2. **Storage costs explode.** A single analytics event averages 1-2 KB in
   PostgreSQL (row storage, TOAST overhead, indexes). ClickHouse compresses
   the same event to 50-100 bytes using columnar compression. At 10M
   events/day, PostgreSQL consumes ~15 GB/day; ClickHouse consumes ~700 MB/day.
   Over a year, that is 5.4 TB vs 250 GB.

3. **SaaS analytics are prohibitively expensive.** BigQuery charges $5/TB
   scanned. Snowflake charges per-second compute plus storage. At our query
   volume (thousands of dashboard loads per day, each scanning 10-100 GB),
   managed analytics would cost $5,000-20,000/month. Self-hosted ClickHouse
   runs on existing Kubernetes infrastructure for near-zero marginal cost.

4. **No unified query layer.** Without a standard, Insights uses one database,
   Metrics uses another, and billing analytics lives in a third. Cross-cutting
   queries (correlate LLM token usage with product engagement) become
   multi-system joins that are slow and fragile.

We need ONE analytics datastore that all event-driven workloads share, with a
single schema convention, replication strategy, backup policy, and query
interface.

## Design Philosophy

This section explains the reasoning behind each major architectural decision.
Understanding the *why* is as important as understanding the *what*.

### Why ClickHouse Over PostgreSQL for Analytics

PostgreSQL is the Hanzo standard for transactional data (HIP-0029). It excels
at OLTP: small reads and writes, row-level locking, ACID transactions, foreign
keys, and joins across normalized tables. IAM stores users, organizations, and
OAuth tokens in PostgreSQL. Cloud stores projects, API keys, and configuration.

Analytics data has the opposite access pattern:

| Property | OLTP (PostgreSQL) | OLAP (ClickHouse) |
|----------|-------------------|-------------------|
| Write pattern | Single-row inserts/updates | Batch inserts (1000+ rows) |
| Read pattern | Point lookups by primary key | Full-column scans with aggregation |
| Schema | Normalized, many tables | Denormalized, few wide tables |
| Transactions | Required (ACID) | Not needed (append-only) |
| Compression | Row-level, 1-2x | Column-level, 10-100x |
| Typical query | `SELECT * FROM users WHERE id = 42` | `SELECT COUNT(*) FROM events WHERE ts > '2026-01-01' GROUP BY browser` |

ClickHouse stores data column-by-column on disk. When a query references 3 out
of 50 columns, only those 3 columns are read from disk. PostgreSQL stores data
row-by-row, so it must read all 50 columns even if only 3 are needed.

For a table with 1 billion rows and 50 columns, a query touching 3 columns:
- **PostgreSQL**: Reads ~1 TB from disk (all columns, all rows)
- **ClickHouse**: Reads ~6 GB from disk (3 columns, compressed)

This is not a marginal difference. It is 100-200x less I/O, which translates
directly into 100-200x faster queries.

**Decision**: Use ClickHouse for all analytics workloads. Keep PostgreSQL for
transactional data per HIP-0029.

### Why ClickHouse Over Snowflake / BigQuery

Both Snowflake and BigQuery are excellent managed columnar databases. We reject
them for three reasons:

1. **Data sovereignty.** Hanzo stores user behavior data, LLM prompts (in
   aggregated form), and billing records. Enterprise customers require that
   this data stays on infrastructure we control. Snowflake and BigQuery are
   third-party managed services where data resides on vendor infrastructure.

2. **Per-query pricing is unpredictable.** BigQuery charges $5/TB scanned.
   A single poorly written query on a 10 TB table costs $50. A dashboard
   with 20 panels, each scanning 5 GB, costs $0.50 per page load. At 1000
   dashboard loads/day, that is $500/day or $15,000/month -- just for
   dashboards. ClickHouse has zero per-query cost.

3. **Latency.** Snowflake and BigQuery add network round-trip latency
   (50-200ms) before query execution begins. ClickHouse is co-located with
   the services that query it, so the network hop is sub-millisecond. For
   interactive dashboards where users expect instant results, this matters.

**Decision**: Self-host ClickHouse. Eliminate per-query costs and data
residency concerns.

### Why ClickHouse Over Apache Druid

Druid is a real-time analytics database designed for sub-second OLAP queries.
It is a valid alternative. We chose ClickHouse over Druid for three reasons:

1. **Simpler architecture.** Druid has six process types (Coordinator,
   Overlord, Broker, Router, Historical, MiddleManager) plus external
   dependencies on ZooKeeper, a metadata store (PostgreSQL/MySQL), and deep
   storage (S3/HDFS). ClickHouse is a single binary. A production cluster
   needs ClickHouse nodes and (optionally since 24.x) ClickHouse Keeper
   for coordination. No ZooKeeper, no external metadata store.

2. **SQL-native.** Druid has its own query language (Druid SQL is a subset
   of SQL with significant gaps). ClickHouse supports full ANSI SQL plus
   extensions for arrays, maps, nested data, and window functions. Engineers
   already know SQL. Druid SQL requires learning Druid-specific syntax and
   limitations.

3. **Better compression.** ClickHouse consistently achieves 10-20x
   compression ratios on analytics data. Druid achieves 3-8x. On a dataset
   of 1 billion events (1 TB uncompressed), ClickHouse stores it in ~60 GB;
   Druid stores it in ~150 GB.

**Decision**: Use ClickHouse. Simpler to operate, better compression, standard
SQL.

### Why ClickHouse Over TimescaleDB

TimescaleDB is PostgreSQL with time-series extensions. It is excellent for
metrics (CPU usage, request latency, disk I/O) where each data point is a
small fixed-schema tuple with a timestamp and a few numeric values.

Analytics events are different. Each event has 20-50 fields: timestamp, user
ID, session ID, event type, URL, browser, OS, device, screen dimensions,
referrer, UTM parameters, custom properties (JSON), and more. Events arrive
at 100-1000x the rate of metrics. A busy dashboard page load generates
10-20 analytics events; the same page generates 1-2 metric data points.

TimescaleDB inherits PostgreSQL's row-oriented storage. For wide tables with
billions of rows, it cannot match ClickHouse's columnar performance:

| Workload | TimescaleDB | ClickHouse |
|----------|-------------|------------|
| Ingestion (events/sec, single node) | 50,000-100,000 | 1,000,000-5,000,000 |
| Query: COUNT by day (1B rows) | 8-15 seconds | 0.1-0.3 seconds |
| Compression ratio (analytics events) | 3-5x | 10-20x |
| Disk usage (1B events) | 200-400 GB | 50-100 GB |

TimescaleDB is the right choice for infrastructure metrics (Prometheus
long-term storage, IoT sensor data). ClickHouse is the right choice for
analytics events.

**Decision**: Use ClickHouse for analytics events. Use Prometheus + Grafana
for infrastructure metrics per HIP-0031. TimescaleDB is not needed.

### Why Separate from PostgreSQL (HIP-0029)

The simplest architecture would be one database for everything. We reject
this because analytics and transactional workloads compete destructively
when co-located:

1. **Lock contention.** A long-running analytics query (`SELECT ... GROUP BY
   ... ORDER BY ... LIMIT 100` on 500M rows) holds read locks that block
   transactional writes. PostgreSQL's MVCC mitigates this but does not
   eliminate it -- vacuum, buffer pool pressure, and WAL volume all increase.

2. **Resource competition.** Analytics queries consume CPU and memory for
   sorting, hashing, and aggregation. This starves transactional queries
   that need sub-millisecond response times for user-facing API calls.

3. **Scaling dimensions differ.** Transactional databases scale vertically
   (bigger instance) and with read replicas. Analytics databases scale
   horizontally (shard by time, distribute across nodes). Combining them
   forces a compromise that serves neither well.

**Decision**: PostgreSQL for OLTP (HIP-0029). ClickHouse for OLAP (this HIP).
Separate processes, separate storage, separate scaling.

## Specification

### Architecture Overview

```
                          ┌─────────────────────────────────┐
                          │       Hanzo Services            │
                          │  (Insights, Metrics, Billing)   │
                          └────────┬────────────┬───────────┘
                                   │            │
                          Batch HTTP        Kafka Consumer
                          (port 8123)       (HIP-0030)
                                   │            │
                          ┌────────▼────────────▼───────────┐
                          │         ClickHouse Cluster       │
                          │  ┌──────────┐  ┌──────────┐     │
                          │  │ Shard 1  │  │ Shard 1  │     │
                          │  │ Replica A│  │ Replica B│     │
                          │  └──────────┘  └──────────┘     │
                          │  ┌──────────────────────┐       │
                          │  │  ClickHouse Keeper    │       │
                          │  │  (coordination)       │       │
                          │  └──────────────────────┘       │
                          └─────────────────────────────────┘
                                        │
                               ┌────────▼────────┐
                               │  MinIO (S3)     │
                               │  (HIP-0032)     │
                               │  Backups        │
                               └─────────────────┘
```

### Engine: MergeTree Family

All tables MUST use a MergeTree-family engine. The MergeTree engine is the
foundation of ClickHouse's performance. It provides:

- **Sorted storage**: Data is stored sorted by the `ORDER BY` key, enabling
  efficient range queries and binary search.
- **Sparse indexing**: Primary index stores one entry per 8192 rows (granule),
  not per row. This keeps the index small enough to fit in memory even for
  billion-row tables.
- **Background merges**: Small data parts are merged into larger ones
  asynchronously, maintaining sort order and applying TTL/compression.

For production deployments with replication, all tables MUST use
`ReplicatedMergeTree`:

```sql
CREATE TABLE events ON CLUSTER '{cluster}'
(
    -- columns defined below
)
ENGINE = ReplicatedMergeTree('/clickhouse/tables/{shard}/events', '{replica}')
PARTITION BY toYYYYMM(timestamp)
ORDER BY (team_id, toDate(timestamp), event, cityHash64(distinct_id), uuid)
SETTINGS index_granularity = 8192;
```

The ZooKeeper path template `{shard}` and `{replica}` are resolved from the
ClickHouse server configuration. Since ClickHouse 24.x, ClickHouse Keeper
(a built-in Raft-based coordination service) replaces ZooKeeper.

### Schema Design

#### Events Table

The primary table storing all analytics events. This is the table that
Insights (HIP-0017) writes to and queries from.

```sql
CREATE TABLE events ON CLUSTER '{cluster}'
(
    -- Identity
    uuid                UUID DEFAULT generateUUIDv4(),
    team_id             UInt64,
    distinct_id         String,
    session_id          String DEFAULT '',

    -- Event
    event               String,
    timestamp           DateTime64(3, 'UTC'),
    created_at          DateTime64(3, 'UTC') DEFAULT now64(3),

    -- Properties (stored as JSON string, queried via JSONExtract)
    properties          String DEFAULT '{}',

    -- Denormalized property columns for high-cardinality queries
    -- These are extracted from properties at ingestion time
    url                 String DEFAULT '',
    referrer            String DEFAULT '',
    host                String DEFAULT '',
    pathname            String DEFAULT '',

    -- Device
    browser             LowCardinality(String) DEFAULT '',
    browser_version     String DEFAULT '',
    os                  LowCardinality(String) DEFAULT '',
    os_version          String DEFAULT '',
    device_type         LowCardinality(String) DEFAULT '',

    -- Geo (resolved at ingestion from IP)
    country_code        LowCardinality(FixedString(2)) DEFAULT '\0\0',
    city                LowCardinality(String) DEFAULT '',
    region              LowCardinality(String) DEFAULT '',

    -- Attribution
    utm_source          LowCardinality(String) DEFAULT '',
    utm_medium          LowCardinality(String) DEFAULT '',
    utm_campaign        LowCardinality(String) DEFAULT '',

    -- LLM-specific (Hanzo extension)
    model               LowCardinality(String) DEFAULT '',
    provider            LowCardinality(String) DEFAULT '',
    tokens_prompt       UInt32 DEFAULT 0,
    tokens_completion   UInt32 DEFAULT 0,
    cost_usd            Decimal64(8) DEFAULT 0,

    -- Billing
    organization_id     String DEFAULT '',
    project_id          String DEFAULT '',
    api_key_id          String DEFAULT ''
)
ENGINE = ReplicatedMergeTree(
    '/clickhouse/tables/{shard}/events',
    '{replica}'
)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (team_id, toDate(timestamp), event, cityHash64(distinct_id), uuid)
SETTINGS index_granularity = 8192;
```

**Design decisions in this schema**:

- **`LowCardinality(String)`** for columns with few distinct values (browser,
  OS, country). ClickHouse stores these as dictionary-encoded integers,
  reducing storage 5-10x and speeding equality comparisons.
- **`FixedString(2)`** for country codes. All ISO 3166-1 alpha-2 codes are
  exactly 2 bytes. Fixed-size storage avoids length prefix overhead.
- **`properties` as String (JSON)** rather than a Map or Nested type. This
  preserves schema flexibility -- any event can carry any custom properties.
  Queries use `JSONExtractString(properties, 'key')` for ad-hoc access.
  High-frequency property keys are denormalized into dedicated columns.
- **ORDER BY includes `cityHash64(distinct_id)`** to distribute rows with
  the same team/date/event across granules, improving parallelism for
  queries that filter by distinct_id.
- **PARTITION BY `toYYYYMM(timestamp)`** creates monthly partitions. This
  enables efficient partition pruning (queries with date ranges skip
  irrelevant months) and simplified TTL management.

#### Sessions Table

Materialized from the events table for session-level analytics.

```sql
CREATE MATERIALIZED VIEW sessions_mv ON CLUSTER '{cluster}'
TO sessions
AS SELECT
    team_id,
    session_id,
    distinct_id,
    min(timestamp)                          AS session_start,
    max(timestamp)                          AS session_end,
    dateDiff('second', min(timestamp),
             max(timestamp))                AS duration_seconds,
    count()                                 AS event_count,
    countIf(event = '$pageview')            AS pageview_count,
    argMin(url, timestamp)                  AS entry_url,
    argMax(url, timestamp)                  AS exit_url,
    argMin(referrer, timestamp)             AS initial_referrer,
    argMin(utm_source, timestamp)           AS initial_utm_source,
    argMin(utm_medium, timestamp)           AS initial_utm_medium,
    argMin(utm_campaign, timestamp)         AS initial_utm_campaign,
    argMin(browser, timestamp)              AS browser,
    argMin(os, timestamp)                   AS os,
    argMin(device_type, timestamp)          AS device_type,
    argMin(country_code, timestamp)         AS country_code
FROM events
GROUP BY team_id, session_id, distinct_id;
```

The `sessions` target table uses `ReplicatedAggregatingMergeTree` so that
late-arriving events for the same session are merged correctly.

#### Metrics Rollup Tables

For long-term metric storage (HIP-0031), pre-aggregated rollup tables reduce
query time and storage for common dashboard queries.

```sql
-- Hourly event counts by team, event type
CREATE MATERIALIZED VIEW events_hourly_mv ON CLUSTER '{cluster}'
TO events_hourly
AS SELECT
    team_id,
    event,
    toStartOfHour(timestamp)                AS hour,
    count()                                 AS count,
    uniqHLL12(distinct_id)                  AS unique_users
FROM events
GROUP BY team_id, event, hour;

-- Daily token usage by organization, model
CREATE MATERIALIZED VIEW token_usage_daily_mv ON CLUSTER '{cluster}'
TO token_usage_daily
AS SELECT
    organization_id,
    model,
    provider,
    toDate(timestamp)                       AS day,
    sum(tokens_prompt)                      AS total_prompt_tokens,
    sum(tokens_completion)                  AS total_completion_tokens,
    sum(cost_usd)                           AS total_cost_usd,
    count()                                 AS request_count
FROM events
WHERE event = '$llm_request'
GROUP BY organization_id, model, provider, day;
```

**Why materialized views**: ClickHouse materialized views are triggers that
run on INSERT. They are not periodic batch jobs. When a batch of events is
inserted into the `events` table, ClickHouse automatically updates the
materialized view target tables. This means rollup tables are always
up-to-date with sub-second latency.

### Data Ingestion

#### Batch HTTP Inserts

The primary ingestion path for Insights (HIP-0017). The Rust capture service
buffers events in memory (or Kafka, per HIP-0030) and flushes to ClickHouse
in batches via HTTP.

```
POST http://clickhouse:8123/?query=INSERT+INTO+events+FORMAT+JSONEachRow
Content-Type: application/json

{"uuid":"...","team_id":1,"event":"$pageview","timestamp":"2026-02-23T12:00:00.000Z","distinct_id":"user_42","properties":"{\"url\":\"/dashboard\"}"}
{"uuid":"...","team_id":1,"event":"$pageview","timestamp":"2026-02-23T12:00:01.000Z","distinct_id":"user_43","properties":"{\"url\":\"/settings\"}"}
```

**Batch size requirements**:

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Minimum batch size | 1,000 rows | Below this, per-INSERT overhead dominates |
| Recommended batch size | 10,000-100,000 rows | Optimal merge behavior |
| Maximum batch size | 1,000,000 rows | Beyond this, INSERT timeout risk increases |
| Flush interval | 5-10 seconds | Balance latency vs batch size |

Services MUST NOT insert single rows per HTTP request. Single-row inserts
create thousands of tiny data parts that ClickHouse must merge, consuming
CPU and degrading query performance. The `too many parts` exception is a
hard failure mode caused by excessive single-row inserts.

#### Kafka Consumer (Streaming)

For high-throughput services that cannot batch in-process, ClickHouse's
built-in Kafka engine consumes directly from Kafka topics (HIP-0030).

```sql
CREATE TABLE events_kafka ON CLUSTER '{cluster}'
(
    uuid            String,
    team_id         UInt64,
    event           String,
    timestamp       String,
    distinct_id     String,
    properties      String
)
ENGINE = Kafka
SETTINGS
    kafka_broker_list = 'kafka:9092',
    kafka_topic_list = 'hanzo_events',
    kafka_group_name = 'clickhouse_events_consumer',
    kafka_format = 'JSONEachRow',
    kafka_num_consumers = 4,
    kafka_max_block_size = 65536;

CREATE MATERIALIZED VIEW events_kafka_mv ON CLUSTER '{cluster}'
TO events
AS SELECT
    toUUID(uuid)                            AS uuid,
    team_id,
    event,
    parseDateTimeBestEffort(timestamp)      AS timestamp,
    now64(3)                                AS created_at,
    distinct_id,
    properties
FROM events_kafka;
```

This pattern decouples ingestion from query serving. Kafka absorbs traffic
spikes; ClickHouse consumes at its own pace.

### Query Interface

ClickHouse uses SQL with extensions. All Hanzo services MUST query ClickHouse
using standard SQL via the HTTP interface or the native TCP protocol.

#### HTTP Interface (Port 8123)

```bash
# Simple query
curl 'http://clickhouse:8123/?query=SELECT+count()+FROM+events+WHERE+team_id=1'

# Parameterized query (prevents SQL injection)
curl 'http://clickhouse:8123/' \
  --data-urlencode "param_team_id=1" \
  --data-urlencode "param_start=2026-02-01" \
  -d "query=SELECT count() FROM events WHERE team_id = {team_id:UInt64} AND timestamp >= {start:Date}"
```

#### Common Query Patterns

**Funnel analysis** (Insights):
```sql
SELECT
    level,
    count() AS users
FROM
(
    SELECT
        distinct_id,
        windowFunnel(86400)(
            timestamp,
            event = 'signup',
            event = 'onboarding_complete',
            event = 'first_api_call'
        ) AS level
    FROM events
    WHERE team_id = 1
      AND timestamp >= '2026-02-01'
      AND timestamp <  '2026-03-01'
    GROUP BY distinct_id
)
GROUP BY level
ORDER BY level DESC;
```

**Retention analysis** (Insights):
```sql
SELECT
    cohort_date,
    period,
    count(DISTINCT distinct_id) AS retained_users
FROM
(
    SELECT
        distinct_id,
        toDate(min(timestamp)) AS cohort_date,
        dateDiff('week', toDate(min(timestamp)), toDate(timestamp)) AS period
    FROM events
    WHERE team_id = 1
      AND event IN ('$pageview', '$screen')
      AND timestamp >= '2026-01-01'
    GROUP BY distinct_id, toDate(timestamp)
)
GROUP BY cohort_date, period
ORDER BY cohort_date, period;
```

**Token usage dashboard** (Billing):
```sql
SELECT
    organization_id,
    model,
    sum(total_prompt_tokens)        AS prompt_tokens,
    sum(total_completion_tokens)    AS completion_tokens,
    sum(total_cost_usd)             AS total_cost
FROM token_usage_daily
WHERE day >= today() - 30
GROUP BY organization_id, model
ORDER BY total_cost DESC
LIMIT 100;
```

### Partitioning Strategy

All tables MUST use time-based partitioning:

| Table | Partition Key | Granularity | Rationale |
|-------|---------------|-------------|-----------|
| events | `toYYYYMM(timestamp)` | Monthly | Balances partition count vs pruning efficiency |
| sessions | `toYYYYMM(session_start)` | Monthly | Aligned with events |
| events_hourly | `toYYYYMM(hour)` | Monthly | Rollups are small per partition |
| token_usage_daily | `toYYYYMM(day)` | Monthly | Consistent with events |

**Why monthly, not daily**: Daily partitions create 365 partitions per year.
With 2 replicas, that is 730 data parts to track per table. After 3 years of
data, the partition count becomes unwieldy. Monthly partitions keep the count
manageable (36 per year) while still enabling efficient date-range pruning.

#### TTL (Time-to-Live)

Raw event data has a default retention of 12 months. Rollup tables retain
data for 36 months. TTL is enforced at the table level:

```sql
ALTER TABLE events ON CLUSTER '{cluster}'
    MODIFY TTL timestamp + INTERVAL 12 MONTH DELETE;

ALTER TABLE events_hourly ON CLUSTER '{cluster}'
    MODIFY TTL hour + INTERVAL 36 MONTH DELETE;

ALTER TABLE token_usage_daily ON CLUSTER '{cluster}'
    MODIFY TTL day + INTERVAL 36 MONTH DELETE;
```

TTL is evaluated during background merges. Expired data is dropped during
merge, not immediately upon expiration. This is a lazy deletion model that
avoids write amplification.

Organizations on enterprise plans MAY override TTL via the `team_settings`
table in PostgreSQL. The ingestion service respects per-team TTL overrides
when creating partitions.

### Compression

ClickHouse supports per-column codec selection. The default codec is LZ4,
which provides fast compression/decompression with moderate ratios. For
columns that benefit from higher compression, ZSTD is used.

```sql
CREATE TABLE events
(
    uuid                UUID              CODEC(LZ4),
    team_id             UInt64            CODEC(Delta, LZ4),
    distinct_id         String            CODEC(ZSTD(3)),
    session_id          String            CODEC(ZSTD(3)),
    event               String            CODEC(ZSTD(1)),
    timestamp           DateTime64(3)     CODEC(DoubleDelta, LZ4),
    properties          String            CODEC(ZSTD(3)),
    url                 String            CODEC(ZSTD(3)),
    browser             LowCardinality(String) CODEC(ZSTD(1)),
    os                  LowCardinality(String) CODEC(ZSTD(1)),
    country_code        LowCardinality(FixedString(2)) CODEC(LZ4),
    tokens_prompt       UInt32            CODEC(Delta, LZ4),
    tokens_completion   UInt32            CODEC(Delta, LZ4),
    cost_usd            Decimal64(8)      CODEC(Delta, LZ4)
    -- ... remaining columns
);
```

**Codec selection rationale**:

| Codec | Used For | Why |
|-------|----------|-----|
| `LZ4` | UUIDs, fixed-width types | Fast decompression, acceptable ratio |
| `ZSTD(1)` | Low-cardinality strings | Better ratio than LZ4, still fast |
| `ZSTD(3)` | High-cardinality strings (URLs, properties) | 2-3x better ratio than LZ4 |
| `Delta + LZ4` | Monotonic integers (team_id, timestamps) | Delta encodes small differences; LZ4 compresses the deltas |
| `DoubleDelta + LZ4` | Timestamps | Timestamps increment by near-constant intervals; double-delta reduces to near-zero |

Expected compression ratios on production data:

| Column | Uncompressed | Compressed | Ratio |
|--------|-------------|------------|-------|
| timestamp | 8 bytes/row | 0.3 bytes/row | 27x |
| team_id | 8 bytes/row | 0.1 bytes/row | 80x |
| properties (JSON) | 500 bytes/row avg | 40 bytes/row avg | 12x |
| url | 80 bytes/row avg | 8 bytes/row avg | 10x |
| **Overall** | **~1200 bytes/row** | **~80 bytes/row** | **~15x** |

### Replication

Production deployments MUST use a 2-replica configuration. ClickHouse
replication is asynchronous and log-based:

1. When a write arrives at Replica A, it is written to the local MergeTree
   and a log entry is created in ClickHouse Keeper.
2. Replica B polls the log and fetches the new data part from Replica A.
3. Both replicas are eventually consistent. Replication lag is typically
   under 1 second.

#### Cluster Configuration

```xml
<!-- /etc/clickhouse-server/config.d/cluster.xml -->
<clickhouse>
  <remote_servers>
    <hanzo_cluster>
      <shard>
        <internal_replication>true</internal_replication>
        <replica>
          <host>clickhouse-0</host>
          <port>9000</port>
        </replica>
        <replica>
          <host>clickhouse-1</host>
          <port>9000</port>
        </replica>
      </shard>
    </hanzo_cluster>
  </remote_servers>

  <macros>
    <cluster>hanzo_cluster</cluster>
    <shard>01</shard>
    <replica>clickhouse-{replica_number}</replica>
  </macros>
</clickhouse>
```

#### ClickHouse Keeper Configuration

Since ClickHouse 24.x, the built-in ClickHouse Keeper replaces ZooKeeper.
A 3-node Keeper ensemble provides coordination for replication:

```xml
<!-- /etc/clickhouse-server/config.d/keeper.xml -->
<clickhouse>
  <keeper_server>
    <tcp_port>9181</tcp_port>
    <server_id>1</server_id>
    <raft_configuration>
      <server>
        <id>1</id>
        <hostname>keeper-0</hostname>
        <port>9234</port>
      </server>
      <server>
        <id>2</id>
        <hostname>keeper-1</hostname>
        <port>9234</port>
      </server>
      <server>
        <id>3</id>
        <hostname>keeper-2</hostname>
        <port>9234</port>
      </server>
    </raft_configuration>
  </keeper_server>
</clickhouse>
```

**Why 3 Keeper nodes, not 2**: Raft consensus requires a majority quorum.
With 2 nodes, losing 1 node means no quorum and the cluster cannot
coordinate writes. With 3 nodes, the cluster tolerates 1 node failure.

### Backup and Recovery

Backups follow the Hanzo backup standard using S3-compatible storage
(MinIO, per HIP-0032).

#### Backup Strategy

```bash
# Full backup to S3
clickhouse-backup create --tables 'default.events,default.sessions' daily_2026_02_23
clickhouse-backup upload daily_2026_02_23

# Incremental backup (only changed parts since last full)
clickhouse-backup create_remote --diff-from-remote daily_2026_02_23 incremental_2026_02_24
```

| Backup Type | Frequency | Retention | Storage |
|-------------|-----------|-----------|---------|
| Full | Weekly (Sunday 02:00 UTC) | 4 weeks | MinIO (HIP-0032) |
| Incremental | Daily (02:00 UTC) | 7 days | MinIO (HIP-0032) |
| Partition-level | On TTL drop | 30 days | MinIO (HIP-0032) |

#### Backup Configuration

```yaml
# /etc/clickhouse-backup/config.yml
general:
  remote_storage: s3
  backups_to_keep_local: 2
  backups_to_keep_remote: 28

s3:
  access_key: "${MINIO_ACCESS_KEY}"
  secret_key: "${MINIO_SECRET_KEY}"
  bucket: "clickhouse-backups"
  endpoint: "http://minio:9000"
  region: "us-east-1"
  path: "hanzo-k8s/"
  compression_format: "zstd"
```

#### Recovery Procedure

```bash
# List available backups
clickhouse-backup list remote

# Download and restore
clickhouse-backup download daily_2026_02_23
clickhouse-backup restore daily_2026_02_23

# Verify row counts
clickhouse-client -q "SELECT count() FROM events"
```

Recovery time objective (RTO): < 1 hour for full cluster restore.
Recovery point objective (RPO): < 24 hours (last daily backup).

### Monitoring

ClickHouse exposes internal metrics through system tables. Hanzo Zap
(HIP-0031) scrapes these and exports them as Prometheus metrics.

#### Key System Tables

| Table | Purpose | Query Frequency |
|-------|---------|-----------------|
| `system.metrics` | Current server state (connections, queries, merges) | Every 15s |
| `system.events` | Cumulative counters (inserts, selects, bytes read) | Every 15s |
| `system.asynchronous_metrics` | Background metrics (memory, disk, replication lag) | Every 60s |
| `system.query_log` | Query history with timing and resource usage | On demand |
| `system.parts` | Data part inventory per table | Every 60s |
| `system.replicas` | Replication status and lag | Every 30s |

#### Critical Alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| Too Many Parts | `SELECT count() FROM system.parts WHERE active AND table = 'events'` > 300 | Critical |
| Replication Lag | `SELECT replica_delay FROM system.replicas WHERE table = 'events'` > 300 seconds | Warning |
| Disk Usage | `SELECT free_space FROM system.disks WHERE name = 'default'` < 10 GB | Critical |
| Query Duration | p99 query time > 30 seconds | Warning |
| Insert Failures | `system.events` counter `FailedInsertQuery` increasing | Critical |
| Keeper Disconnect | `SELECT * FROM system.zookeeper WHERE path = '/clickhouse'` fails | Critical |

#### Grafana Dashboard

The standard Grafana dashboard for ClickHouse includes panels for:

1. **Ingestion rate**: Rows inserted per second (from `system.events`)
2. **Query performance**: p50/p95/p99 query latency (from `system.query_log`)
3. **Active parts**: Part count per table (from `system.parts`)
4. **Replication lag**: Seconds behind leader (from `system.replicas`)
5. **Disk usage**: Used/free per disk (from `system.disks`)
6. **Memory usage**: Resident memory and cache hit rates
7. **Merge throughput**: Background merge rate and duration
8. **Compression ratio**: Raw vs compressed bytes per table

### Deployment

#### Docker (Development)

```yaml
# compose.yml
services:
  clickhouse:
    image: ghcr.io/hanzoai/datastore:latest
    ports:
      - "8123:8123"   # HTTP
      - "9000:9000"   # Native TCP
    volumes:
      - clickhouse_data:/var/lib/clickhouse
      - clickhouse_logs:/var/log/clickhouse-server
    environment:
      CLICKHOUSE_DB: hanzo
      CLICKHOUSE_USER: hanzo
      CLICKHOUSE_PASSWORD: "${CLICKHOUSE_PASSWORD}"
    ulimits:
      nofile:
        soft: 262144
        hard: 262144
    healthcheck:
      test: ["CMD", "clickhouse-client", "--query", "SELECT 1"]
      interval: 10s
      timeout: 5s
      retries: 3

volumes:
  clickhouse_data:
  clickhouse_logs:
```

#### Kubernetes (Production)

Production deployments use the ClickHouse Operator for lifecycle management.

```yaml
# k8s/clickhouse-installation.yaml
apiVersion: clickhouse.altinity.com/v1
kind: ClickHouseInstallation
metadata:
  name: hanzo-datastore
  namespace: hanzo
spec:
  configuration:
    clusters:
      - name: hanzo_cluster
        layout:
          shardsCount: 1
          replicasCount: 2
        templates:
          podTemplate: clickhouse-pod
          volumeClaimTemplate: data-volume

    settings:
      max_concurrent_queries: 200
      max_memory_usage: 10000000000        # 10 GB per query
      max_bytes_before_external_group_by: 5000000000  # 5 GB
      max_execution_time: 300              # 5 minutes
      log_queries: 1
      merge_tree/max_parts_in_total: 100000

    profiles:
      default/max_memory_usage: 10000000000
      default/max_execution_time: 300
      readonly/readonly: 1
      readonly/max_execution_time: 60

    users:
      hanzo/password_sha256_hex: "${CLICKHOUSE_PASSWORD_SHA256}"
      hanzo/networks/ip: "10.0.0.0/8"
      hanzo/profile: default
      hanzo/quota: default
      readonly/password_sha256_hex: "${CLICKHOUSE_READONLY_PASSWORD_SHA256}"
      readonly/networks/ip: "10.0.0.0/8"
      readonly/profile: readonly

  templates:
    podTemplates:
      - name: clickhouse-pod
        spec:
          containers:
            - name: clickhouse
              image: ghcr.io/hanzoai/datastore:latest
              resources:
                requests:
                  memory: 8Gi
                  cpu: "4"
                limits:
                  memory: 16Gi
                  cpu: "8"
    volumeClaimTemplates:
      - name: data-volume
        spec:
          accessModes: [ReadWriteOnce]
          resources:
            requests:
              storage: 500Gi
          storageClassName: do-block-storage
```

#### Resource Sizing Guide

| Cluster Size | Events/Day | CPU | RAM | Disk | Replicas |
|-------------|------------|-----|-----|------|----------|
| Small (dev) | < 1M | 2 cores | 4 GB | 50 GB | 1 |
| Medium | 1M - 50M | 4-8 cores | 8-16 GB | 200-500 GB | 2 |
| Large | 50M - 500M | 16-32 cores | 32-64 GB | 1-2 TB | 2 |
| XL | 500M+ | 64+ cores | 128+ GB | 4+ TB | 2 (multi-shard) |

### Security

#### Authentication

ClickHouse MUST require authentication for all connections. Two user
profiles are provisioned:

| User | Purpose | Permissions |
|------|---------|-------------|
| `hanzo` | Application writes and reads | Full DDL + DML on `hanzo` database |
| `readonly` | Dashboard queries, Grafana | SELECT only, 60s query timeout |

Passwords are stored as SHA-256 hashes in the ClickHouse users configuration.
Credentials are managed through KMS (HIP-0033) and injected as Kubernetes
secrets.

#### Network

- HTTP port (8123) and native port (9000) MUST be accessible only from within
  the Kubernetes cluster network (`10.0.0.0/8`).
- Native TLS port (9440) is used for cross-cluster replication if needed.
- No ports are exposed to the public internet.
- Kubernetes NetworkPolicy restricts access to pods with the label
  `clickhouse-client: "true"`.

#### Data Classification

| Data Type | Sensitivity | Handling |
|-----------|-------------|----------|
| Event metadata (timestamps, counts) | Low | Standard retention |
| User identifiers (distinct_id) | Medium | Hashed or pseudonymized |
| URLs and referrers | Medium | Retained per TTL, no PII |
| Properties (custom JSON) | Variable | May contain PII; TTL enforced |
| LLM request content | High | NOT stored in analytics; only token counts and costs |

Services MUST NOT store raw LLM prompts or completions in the analytics
datastore. Only aggregate metadata (model, token counts, latency, cost)
is permitted.

### Integration Points

#### Insights (HIP-0017)

Insights is the primary consumer of the analytics datastore. The integration
flow is:

```
SDK (browser/server) --> Capture Service (Rust) --> Kafka --> ClickHouse
                                                         --> PostgreSQL (metadata only)
```

Insights queries ClickHouse for:
- Event trends and breakdowns
- Funnel analysis (multi-step conversion)
- Retention cohorts
- Session replay event sequences
- Feature flag exposure tracking
- A/B test statistical analysis

#### Metrics (HIP-0031)

Zap (HIP-0031) ships structured logs to ClickHouse for long-term storage.
Prometheus handles short-term metrics (15-day retention). For queries
spanning weeks or months, Grafana queries ClickHouse via the ClickHouse
data source plugin.

```
Zap sidecar --> Prometheus (15-day) --> remote_write --> ClickHouse (36-month)
```

#### Billing Analytics

The billing pipeline tracks per-organization resource consumption:

```sql
-- Monthly invoice line items
SELECT
    organization_id,
    model,
    sum(tokens_prompt + tokens_completion)  AS total_tokens,
    sum(cost_usd)                           AS total_cost,
    count()                                 AS api_calls
FROM events
WHERE event = '$llm_request'
  AND organization_id = 'org_123'
  AND timestamp >= '2026-02-01'
  AND timestamp <  '2026-03-01'
GROUP BY organization_id, model
ORDER BY total_cost DESC;
```

This query runs against the `token_usage_daily` materialized view in
production for sub-second response times.

## Migration Path

### From PostgreSQL Analytics Tables

Services currently storing analytics data in PostgreSQL MUST migrate to
ClickHouse:

1. **Schema mapping**: Convert PostgreSQL table schema to ClickHouse DDL.
   Replace `SERIAL` with `UInt64`, `JSONB` with `String`, `TIMESTAMPTZ`
   with `DateTime64(3, 'UTC')`.

2. **Data migration**: Use `clickhouse-client` with `INSERT INTO ... SELECT`
   from PostgreSQL via the `postgresql()` table function:

   ```sql
   INSERT INTO events
   SELECT * FROM postgresql(
       'postgres:5432', 'hanzo_iam', 'analytics_events',
       'hanzo', 'password'
   );
   ```

3. **Dual-write period**: Write to both PostgreSQL and ClickHouse for 7 days.
   Validate row counts and query results match.

4. **Cutover**: Switch reads to ClickHouse. Stop writes to PostgreSQL.
   Drop PostgreSQL analytics tables after 30-day grace period.

### Version Upgrades

ClickHouse follows a calendar-based release cycle (YY.M). Upgrades MUST
follow this procedure:

1. Read the changelog for breaking changes.
2. Test the upgrade on a staging replica.
3. Upgrade one replica at a time (rolling upgrade).
4. Verify replication health after each replica upgrade.
5. Run validation queries to confirm data integrity.

## Rationale

The analytics datastore is a critical piece of Hanzo infrastructure that
sits between event ingestion (HIP-0017, HIP-0030) and user-facing dashboards
(Insights, Grafana, billing). The choice of ClickHouse is driven by three
non-negotiable requirements:

1. **Sub-second queries on billions of rows.** Interactive dashboards require
   that users see results immediately. No row-oriented database can deliver
   this at our data volume.

2. **10x-100x compression over PostgreSQL.** Storage costs scale linearly
   with data volume. Columnar compression is the only way to keep analytics
   data for 12+ months affordably.

3. **Self-hosted with zero per-query costs.** Managed analytics services
   charge by the query or by data scanned. At Hanzo's query volume, this
   creates unpredictable and unacceptable costs.

ClickHouse satisfies all three. It is battle-tested at companies processing
trillions of events (Uber, Cloudflare, eBay, GitLab). It is open-source
(Apache 2.0). It has a single-binary deployment model that fits our
Kubernetes-native infrastructure.

## Backwards Compatibility

This HIP introduces a new infrastructure component. There are no backwards
compatibility concerns for existing services because:

1. PostgreSQL (HIP-0029) continues to serve transactional workloads unchanged.
2. Services currently using PostgreSQL for analytics will undergo a phased
   migration (see Migration Path).
3. The ClickHouse query interface (SQL over HTTP) requires no new client
   libraries -- any HTTP client can query ClickHouse.

## Reference Implementation

The reference implementation is at
[github.com/hanzoai/datastore](https://github.com/hanzoai/datastore) and
includes:

- `Dockerfile`: ClickHouse image with Hanzo-specific configuration
- `schemas/`: DDL for all tables and materialized views
- `config/`: ClickHouse server configuration templates
- `k8s/`: Kubernetes manifests and ClickHouse Operator CRD
- `backup/`: Backup scripts and CronJob manifests
- `grafana/`: Dashboard JSON exports
- `tests/`: Integration tests using `clickhouse-client`

## Copyright

This document is placed in the public domain.
