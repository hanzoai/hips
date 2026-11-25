---
hip: 1405
title: Hanzo Unified Global Analytics
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-11-25
requires: HIP-0000, HIP-0111, HIP-0119, HIP-0132, HIP-0139, HIP-0300, HIP-0401, HIP-0402, HIP-0403, HIP-1001, HIP-1103, HIP-1190, HIP-1220, HIP-1240, HIP-1332
---

# HIP-1405: Hanzo Unified Global Analytics

## Abstract

This HIP specifies **Hanzo Unified Global Analytics**, the canonical analytical read plane, semantic metric catalog, streaming rollup architecture, unified `/v1/analytics/*` HTTP and MCP interface, and coalesced Server-Sent Events (SSE) delivery layer across the Hanzo ecosystem (`hanzoai/datastore`, `hanzoai/cloud`, `hanzoai/mcp`). It establishes one foundational architectural invariant — **aggregate on ingestion, not on request** — by consolidating cross-ecosystem analytical serving under the `analytics.*` namespace in Hanzo Datastore (ClickHouse, HIP-0401) without duplicating historical raw telemetry already stored in `event.*`, `hanzo.cloud_usage`, `hanzo.compute_samples`, and `insights.*`. Every product surface (Admin, Cloud, Console, Insights, Commerce, Science) and every autonomous bot (Data, Fin, Rev, Mark, Cyber, Vi, Kai) reads from the same governed semantic definitions, achieving sub-20 ms global KPI latency, sub-2 s freshness, $O(1)$ database load for 1,000+ concurrent real-time viewers, zero per-org operational RPC fan-out, and 100% exact financial reconciliation against authoritative Hanzo SQL commerce books.

## Motivation

### 1. Why Operational Fan-Out Fails at Scale

Hanzo isolates transactional tenant state — billing books, double-entry ledgers (HIP-1001), subscriptions, invoices, and customer balances (HIP-1220) — in per-organization schemas on Hanzo SQL (PostgreSQL, HIP-0402). Per-schema isolation is the right design for transactional consistency, tenant blast-radius containment, and point-in-time operational queries scoped to a single organization.

It is fundamentally the wrong substrate for fleet-wide analytics. Computing global KPIs by fanning out across per-org schemas (`MemoLedger` fleet folds) executes $O(N_{\text{orgs}} \times K_{\text{RPCs}})$ transactional round-trips per refresh:

- At ~2,906 organizations, a single full fleet fold issues **17,436 operational RPCs** (per-org funds, multi-window spend, subscriptions, and paginated invoices) and requires **90–120 seconds** to complete, saturating PostgreSQL connection pools and competing directly with customer checkout, metering, and authorization traffic.
- At **100,000 organizations**, operational fan-out scales to ~600,000 RPCs per fold (>50 minutes wall-clock even under aggressive concurrency), causing unbounded staleness and cascading transactional outages.

### 2. Why Caching and Vertical Headroom Cannot Fix It

Adding caching in Hanzo KV (Valkey, HIP-0403) or provisioning larger SQL instances treats symptoms rather than the complexity class:

- **Cache misses and stampedes**: Cold starts, pod restarts, TTL expiry, and cache eviction still trigger $O(N_{\text{orgs}})$ refold storms against operational databases.
- **Unindexed slicing**: Pre-cached global blobs cannot answer arbitrary filters or breakdowns (by plan, SKU, currency, model, upstream provider, region, cohort, or custom time range) without falling back to full scans.
- **Polling amplification**: Pairing request-time aggregation with 15-second frontend polling scales backend load as $O(N_{\text{viewers}} \times N_{\text{widgets}})$, turning every open Admin or Console tab into continuous background pressure.
- **Metric drift**: When Admin, Cloud, Console, Insights, Commerce, Science, and autonomous bots each compute their own definitions of MRR, active organizations, gross margin, or p95 latency, dashboards contradict each other and erode operational trust.

### 3. Core Principle: Aggregate on Ingestion, Not on Request

Analytical aggregation MUST happen once at ingestion time inside a columnar analytical engine (Hanzo Datastore), producing mergeable rollups and constant-cost serving views. Read requests then execute in $O(1)$ to $O(\log N)$ time against pre-aggregated state, decoupled completely from transactional PostgreSQL schemas, resilient to cold caches, and broadcast to thousands of live viewers via coalesced SSE hubs.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as in RFC 2119.

### 1. Unified Architecture & Layer Responsibilities

```text
+-----------------------------------------------------------------------------+
|  Writers & Telemetry Emitters                                               |
|  Commerce · Finance · IAM · AI Gateway · Enso · Kai · Compute · Event · O11y|
+--------------------+-------------------------------------+------------------+
                     | ACID Tx + Outbox / CDC              | Append-Only Stream
                     v                                     v
+--------------------+------------------+   +--------------+------------------+
|  Hanzo SQL (PostgreSQL, HIP-0402)     |   |  Existing Raw Streams           |
|  Authoritative transactional books,   |   |  event.* (1.77B+ rows)          |
|  per-org schemas, analytics_outbox    |   |  hanzo.cloud_usage              |
+--------------------+------------------+   |  hanzo.compute_samples          |
                     | Idempotent Relay     |  insights.*                     |
                     +----------+-----------+--------------+------------------+
                                |                          | Native MVs (0 dup)
                                v                          v
+-----------------------------------------------------------------------------+
|  Hanzo Datastore (ClickHouse, HIP-0401) — Canonical `analytics.*` Plane     |
|  catalog · watermarks · dim_* · fact_commerce_ledger · state_*              |
|  rollup_* (SummingMergeTree / AggregatingMergeTree)                         |
|  Serving Views: global_* · org_* · model_performance · provider_economics   |
+---------------------+---------------------------------+---------------------+
                      | Constant-Cost Reads             | Optional Hot Cache
                      v                                 v
+---------------------+------------------+   +----------+---------------------+
|  Hanzo Cloud API (`hanzoai/cloud`)     |<->|  Hanzo KV (Valkey, HIP-0403)   |
|  IAM Authz · Planner · Budgets         |   |  Optional snapshot cache,      |
|  /v1/analytics/* · Coalesced SSE Hubs  |   |  SSE pub/sub coordination,     |
|  Unified MCP Tools (HIP-0300)          |   |  rate-limit & watermark hints  |
+-----+----------------------------+-----+   +--------------------------------+
      | Coalesced SSE + HTTP       | Scoped MCP Tools
      v                            v
+-----+-------------------------+  +------------------------------------------+
|  Product Frontends            |  |  Autonomous Bot Workforce                |
|  Admin · Cloud · Console      |  |  Data · Fin · Rev · Mark · Cyber         |
|  Insights · Commerce · Science|  |  Vi · Kai                                |
+-------------------------------+  +------------------------------------------+
```

Each layer has strict, non-overlapping responsibilities:

| Layer | Technology / Spec | Authoritative Role | Normative Prohibitions |
| :--- | :--- | :--- | :--- |
| **Transactional Plane** | Hanzo SQL (PostgreSQL, HIP-0402) | Authoritative system of record for checkout, double-entry ledger postings, subscriptions, invoices, IAM, and provisioning. Emits durable outbox/CDC records. | MUST NOT serve fleet-wide analytical fan-out queries or cross-org dashboard rollups. |
| **Analytical Read Plane** | Hanzo Datastore (ClickHouse, HIP-0401) | Canonical store for `analytics.*` catalog, watermarks, conformed dimensions, append-only facts, latest-state projections, streaming MVs, rollups, and serving views. | MUST NOT duplicate historical raw rows already stored in `event.*`, `hanzo.cloud_usage`, `hanzo.compute_samples`, or `insights.*`. |
| **Acceleration & Coordination** | Hanzo KV (Valkey, HIP-0403) | Optional low-latency snapshot cache, cross-replica SSE pub/sub bus, single-flight locks, and rate-limit counters. | MUST NOT be a system of record. Cold or unavailable KV MUST NEVER cause errors, incorrect totals, or fallback to SQL fan-out. |
| **Serving & Governance API** | Hanzo Cloud API (`hanzoai/cloud`) | IAM authentication & tenant authorization (HIP-0111), declarative query planning, cardinality/cost/timeout enforcement, `/v1/analytics/*` HTTP + SSE hubs, and Unified MCP tool serving (HIP-0300). | MUST NOT accept raw arbitrary SQL from untrusted clients or bots; MUST NOT trust client-supplied `org_id` without IAM verification. |
| **Presentation & Consumers** | Frontends & Bot Workforce | Scope selection, visualization, coalesced SSE consumption with tab-visibility pause and `?since_version=` resync, and explicit freshness/stale banners. | MUST NOT run fixed-interval polling against analytics endpoints when `/v1/analytics/stream` is available. |

### 2. Canonical `analytics` Namespace in Hanzo Datastore

All unified analytical objects MUST reside in the `analytics` database in Hanzo Datastore (`CREATE DATABASE IF NOT EXISTS analytics`).

#### 2.1 Zero Historical Raw Duplication Policy

Hanzo Datastore already stores high-volume raw telemetry across production namespaces. The `analytics` namespace MUST reconcile with existing raw tables by attaching ClickHouse Materialized Views (`TO analytics.rollup_*`) or read-through views directly to them — **zero historical raw row copying**:

| Existing Production Namespace | Scale & Content | Reconciliation Strategy in `analytics.*` |
| :--- | :--- | :--- |
| `event.*` (HIP-1190) | 1.77B+ product & behavioral analytics events | Attach MVs to feed `analytics.rollup_events_1h` and `analytics.rollup_events_1d`; backfill rollups directly via `INSERT INTO ... SELECT` without copying raw events. |
| `hanzo.cloud_usage` | Raw AI gateway, token, latency, and API metering records | Attach MVs to feed `analytics.rollup_ai_usage_1m/1h/1d`, `analytics.model_performance`, and `analytics.provider_economics`. |
| `hanzo.compute_samples` | Raw GPU, CPU, memory, and sandbox utilization samples | Attach MVs to feed `analytics.rollup_compute_1m/1h` and `analytics.rollup_sandboxes_1h`. |
| `insights.*` (HIP-0132, HIP-1240) | Raw O11y logs, traces, spans, and error fingerprints | Attach MVs to feed `analytics.rollup_o11y_1m/1h` for cross-domain SLO, latency, and error-budget rollups. |
| `hanzo.fleet_*` (transitional) | Transitional single-org billing mirrors (`fleet_org_books`, `fleet_subscriptions`, `fleet_invoices`, `fleet_sync_meta`) | Bridged during migration (§8) and superseded by `analytics.fact_commerce_ledger`, `analytics.state_*`, and `analytics.watermarks`. |

#### 2.2 Semantic Catalog & Watermarks (`analytics.catalog`, `analytics.watermarks`)

Every metric queryable via `/v1/analytics/*` or MCP MUST be registered in `analytics.catalog`, and every analytical pipeline MUST advance `analytics.watermarks`:

```sql
CREATE TABLE IF NOT EXISTS analytics.catalog (
    metric_id          LowCardinality(String),
    domain             LowCardinality(String),
    display_name       String,
    description        String,
    unit               LowCardinality(String), -- minor_currency_unit | micros | tokens | count | ms | bytes | ratio
    unit_scale         Int64,                  -- e.g. 100 for cents, 1000000 for micros, 1 for counts
    aggregation_kind   LowCardinality(String), -- sum | state_latest | tdigest_quantile | uniq_hll | uniq_exact | ratio
    serving_tables     Array(String),          -- ordered coarsest-to-finest eligible backing tables
    allowed_dimensions Array(LowCardinality(String)),
    default_granularity LowCardinality(String),
    max_cardinality    UInt32,
    allowed_scopes     Array(LowCardinality(String)), -- ['global', 'org', 'project']
    required_permission LowCardinality(String),
    pii_class          LowCardinality(String), -- none | org_internal | restricted
    freshness_sla_ms   UInt32,
    owner_team         LowCardinality(String),
    deprecated         UInt8,
    schema_version     UInt32,
    updated_at         DateTime64(3, 'UTC')
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (domain, metric_id);

CREATE TABLE IF NOT EXISTS analytics.watermarks (
    domain             LowCardinality(String),
    source_table       LowCardinality(String),
    partition_key      String,
    high_watermark_ts  DateTime64(3, 'UTC'),
    high_watermark_seq UInt64,
    version            UInt64,                 -- strictly monotonic across updates
    lag_ms             UInt64,
    reconciled_at      DateTime64(3, 'UTC'),
    reconciliation_ok  UInt8,
    status             LowCardinality(String), -- healthy | lagging | reconciling | degraded
    updated_at         DateTime64(3, 'UTC')
) ENGINE = ReplacingMergeTree(version)
ORDER BY (domain, source_table, partition_key);
```

#### 2.3 Conformed Dimensions (`analytics.dim_*`)

Conformed dimension tables provide consistent cross-domain attributes and join keys across all 20 domains:

- `analytics.dim_orgs` (`org_id`, `slug`, `display_name`, `tier`, `plan_id`, `country`, `created_at`, `is_internal`, `is_test`, `status`, `updated_at`)
- `analytics.dim_users` (`user_id`, `org_id`, `role`, `signup_channel`, `created_at`, `status`, `updated_at`)
- `analytics.dim_plans` (`plan_id`, `slug`, `product_id`, `billing_interval`, `unit_price_minor`, `currency`, `updated_at`)
- `analytics.dim_products` (`product_id`, `slug`, `domain`, `category`, `sku`, `updated_at`)
- `analytics.dim_models` (`model_id`, `family`, `modality`, `context_window`, `input_price_micros`, `output_price_micros`, `updated_at`)
- `analytics.dim_providers` (`provider_id`, `region`, `tier`, `sla_target`, `updated_at`)
- `analytics.dim_regions` (`region_id`, `cloud_zone`, `continent`, `jurisdiction`, `updated_at`)
- `analytics.dim_fx_rates` (`currency`, `effective_ts`, `usd_rate_scaled Decimal64(8)`, `source`, `updated_at`)

Dimension tables MUST use `ReplacingMergeTree(updated_at)` and SHOULD be exposed via ClickHouse Dictionaries (`HASHED` or `CACHE` layout) for constant-time attribute lookups without expensive shuffle joins.

#### 2.4 Immutable Fact Tables (`analytics.fact_commerce_ledger` & Domain Facts)

Financial flows and append-only domain facts MUST be modeled as immutable `MergeTree` tables:

```sql
CREATE TABLE IF NOT EXISTS analytics.fact_commerce_ledger (
    entry_id           String,                 -- deterministic idempotency key from Hanzo SQL
    outbox_seq         UInt64,
    org_id             String,
    user_id            String,
    subscription_id    String,
    invoice_id         String,
    product_id         LowCardinality(String),
    plan_id            LowCardinality(String),
    account_kind       LowCardinality(String), -- cash | credit | receivables | fees | provider_cost
    entry_type         LowCardinality(String), -- charge | payment | refund | credit_grant | credit_burn | adjustment | reversal | payout
    currency           LowCardinality(String), -- ISO-4217 uppercase
    amount_minor       Int64,                  -- exact signed minor currency units (e.g. cents)
    fx_rate_ts         DateTime64(3, 'UTC'),
    fx_rate_scaled     Decimal64(8),           -- rate at fx_rate_ts (1.00000000 for USD)
    usd_minor          Int64,                  -- deterministic USD minor units computed at fx_rate_ts
    reverses_entry_id  String,                 -- non-empty for compensating entries
    is_test            UInt8,
    effective_at       DateTime64(3, 'UTC'),
    ingested_at        DateTime64(3, 'UTC')
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(effective_at)
ORDER BY (is_test, currency, org_id, entry_type, effective_at, entry_id)
SETTINGS index_granularity = 8192;
```

Companion append-only fact tables follow the same immutable discipline for domains without an existing raw ClickHouse stream: `analytics.fact_security_events`, `analytics.fact_bot_runs`, `analytics.fact_research_runs`, `analytics.fact_support_events`, and `analytics.fact_sales_events`.

#### 2.5 Latest-State Projections (`analytics.state_*`)

Point-in-time entity snapshots (balances, subscriptions, open invoices, live compute nodes, active sandboxes, registered bots) MUST live in dedicated `ReplacingMergeTree(state_version)` tables with explicit `is_deleted UInt8` tombstones:

- `analytics.state_org_books` (`org_id`, `currency`, `cash_minor`, `credit_minor`, `credit_limit_minor`, `owed_minor`, `has_books`, `state_version`, `updated_at`)
- `analytics.state_subscriptions` (`org_id`, `subscription_id`, `user_id`, `plan_id`, `product_id`, `status`, `mrr_minor`, `currency`, `usd_mrr_minor`, `seats`, `interval`, `provider`, `cancel_at_period_end`, `is_test`, `is_deleted`, `state_version`, `updated_at`)
- `analytics.state_invoices` (`org_id`, `invoice_id`, `subscription_id`, `status`, `amount_minor`, `paid_minor`, `currency`, `issued_at`, `paid_at`, `is_test`, `is_deleted`, `state_version`, `updated_at`)
- `analytics.state_compute_nodes`, `analytics.state_sandboxes`, `analytics.state_bots`

Queries reading `analytics.state_*` MUST resolve latest versions deterministically using `FINAL` (on bounded key ranges) or `argMax(col, state_version) ... HAVING argMax(is_deleted, state_version) = 0`.

#### 2.6 ClickHouse-Native Rollups (`analytics.rollup_*`)

Pre-aggregated time-series rollups MUST use ClickHouse-native `SummingMergeTree` (for purely additive signed sums) and `AggregatingMergeTree` (for mergeable quantiles, distinct sketches, and compound aggregates) fed by Materialized Views from **immutable append-only sources only**:

```sql
CREATE TABLE IF NOT EXISTS analytics.rollup_commerce_1h (
    bucket_1h          DateTime('UTC'),
    is_test            UInt8,
    currency           LowCardinality(String),
    org_id             String,
    product_id         LowCardinality(String),
    account_kind       LowCardinality(String),
    entry_type         LowCardinality(String),
    entry_count        UInt64,
    amount_minor_sum   Int64,
    usd_minor_sum      Int64
) ENGINE = SummingMergeTree((entry_count, amount_minor_sum, usd_minor_sum))
PARTITION BY toYYYYMM(bucket_1h)
ORDER BY (is_test, bucket_1h, currency, account_kind, entry_type, product_id, org_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.mv_rollup_commerce_1h
TO analytics.rollup_commerce_1h AS
SELECT
    toStartOfHour(effective_at) AS bucket_1h,
    is_test,
    currency,
    org_id,
    product_id,
    account_kind,
    entry_type,
    toUInt64(1) AS entry_count,
    amount_minor AS amount_minor_sum,
    usd_minor AS usd_minor_sum
FROM analytics.fact_commerce_ledger;
```

Non-additive metrics (percentiles, distinct active orgs/users) MUST store mergeable ClickHouse aggregate states (`quantileTDigestState`, `uniqState` / `uniqCombinedState`):

```sql
CREATE TABLE IF NOT EXISTS analytics.rollup_ai_usage_1m (
    bucket_1m             DateTime('UTC'),
    org_id                String,
    model_id              LowCardinality(String),
    provider_id           LowCardinality(String),
    region_id             LowCardinality(String),
    status_class          LowCardinality(String),
    requests              SimpleAggregateFunction(sum, UInt64),
    error_requests        SimpleAggregateFunction(sum, UInt64),
    cache_hit_requests    SimpleAggregateFunction(sum, UInt64),
    prompt_tokens         SimpleAggregateFunction(sum, UInt64),
    completion_tokens     SimpleAggregateFunction(sum, UInt64),
    revenue_micros        SimpleAggregateFunction(sum, Int64),
    provider_cost_micros  SimpleAggregateFunction(sum, Int64),
    latency_ms_tdigest    AggregateFunction(quantileTDigest(0.95), Float32),
    ttft_ms_tdigest       AggregateFunction(quantileTDigest(0.95), Float32),
    active_orgs_state     AggregateFunction(uniq, String),
    active_users_state    AggregateFunction(uniq, String)
) ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(bucket_1m)
ORDER BY (bucket_1m, model_id, provider_id, region_id, status_class, org_id);
```

Normative aggregation rules:

1. **Mergeable Percentiles**: Every latency, TTFT, or duration percentile MUST be stored via `quantileTDigestState` (or `quantilesTDigestState(0.5, 0.95, 0.99)`) and read via `quantileTDigestMerge`. Implementations MUST NOT average precomputed percentiles across buckets or shards.
2. **Mergeable Distincts**: Every active-org, active-user, or DAU/WAU/MAU metric MUST use `uniqState` / `uniqCombinedState` and `uniqMerge` (or `uniqExactState` where compliance/financial exactness is declared in `analytics.catalog`).
3. **Granularity Tiers**: High-volume streams MUST maintain cascading rollups (`_1m` retained 14 days, `_1h` retained 365 days, `_1d` retained indefinitely) so long-horizon queries scan at most hundreds of rows.

#### 2.7 Constant-Cost Serving Views

The `analytics` namespace MUST expose standardized serving views over the rollups and latest-state tables so every dashboard and API endpoint answers in constant or near-constant cost:

- `analytics.global_kpi_summary` — Fleet-wide live KPIs (USD cash collected 24h/7d/30d/MTD, spend 24h/7d/30d/MTD, cash & credit liabilities, live MRR/ARR, active paying orgs, DAU/MAU, AI tokens/sec, gross margin %, global error rate).
- `analytics.global_revenue_timeseries` — Hourly and daily fleet cash, spend, credit burn, refunds, and MRR movement series.
- `analytics.org_kpi_summary` — Per-org financial summary, active subscriptions, AI/compute spend, seat utilization, and SLO health.
- `analytics.org_usage_timeseries` — Per-org hourly/daily breakdown across AI, compute, storage, networking, and commerce.
- `analytics.model_performance` — Per-model request volume, throughput (tokens/s), TTFT p50/p95, end-to-end latency p50/p95/p99, error rate, prompt-cache hit ratio, and distinct active orgs.
- `analytics.provider_economics` — Per-upstream-provider token cost, customer revenue, gross margin, fallback/retry rate, availability, and blended cost per 1M tokens.
- `analytics.product_performance` — Per-product/SKU/plan adoption, active orgs, revenue, conversion, expansion, contraction, and churn across the Hanzo suite.

### 3. Cross-Ecosystem Domain Coverage (All 20 Hanzo Domains)

Hanzo Unified Global Analytics MUST govern metrics across all **20 Hanzo Domains** under one semantic namespace and one catalog:

| # | Domain | Primary Authoritative Source | Canonical `analytics.*` Objects | Core Metrics |
| :- | :--- | :--- | :--- | :--- |
| 1 | `commerce` | Hanzo SQL Commerce (HIP-1220) | `fact_commerce_ledger`, `state_invoices`, `state_subscriptions`, `rollup_commerce_1h/1d`, `product_performance` | GMV, checkout conversion, order volume, invoices paid/past-due, refunds, disputes |
| 2 | `finance` | Hanzo SQL Ledger (HIP-1001) | `fact_commerce_ledger`, `state_org_books`, `rollup_mrr_daily`, `global_kpi_summary`, `provider_economics` | Cash vs credit balances, MRR/ARR, net dollar retention, gross margin, COGS, payouts, FX variance |
| 3 | `iam` | Hanzo IAM (HIP-0111) | `dim_orgs`, `dim_users`, `rollup_iam_1h/1d` | Total/active orgs, active users, SSO/MFA adoption, seat utilization, authz deny rate |
| 4 | `ai` | AI Gateway (`hanzo.cloud_usage`) | `rollup_ai_usage_1m/1h/1d`, `model_performance`, `provider_economics` | Requests/s, prompt & completion tokens, TTFT p50/p95, latency p95/p99, cache hit rate, AI revenue |
| 5 | `enso` | Enso Router (`hanzoai/enso`) | `rollup_enso_1m/1h` | Route distribution, failover rate, cost-quality Pareto savings, routing overhead p95 |
| 6 | `kai` | Kai Decision Plane (HIP-1332) | `rollup_kai_1m/1h` | Decision volume, calibration error (ECE/Brier), policy hit rate, decision latency p95, outcome lift |
| 7 | `cloud` | Cloud Control Plane (`hanzoai/cloud`) | `rollup_cloud_1m/1h` | Deployments, Sites/Functions invocations, control-plane QPS, quota headroom, deploy success rate |
| 8 | `compute` | Compute Fleet (`hanzo.compute_samples`) | `state_compute_nodes`, `rollup_compute_1m/1h` | Active GPU/CPU hours, fleet utilization %, spot vs dedicated mix, metered compute revenue |
| 9 | `storage` | S3 / Disk / SQL / Datastore / KV | `rollup_storage_1h/1d` | Stored GB-months, IOPS, throughput, backup success rate, snapshot age, growth velocity |
| 10 | `networking` | Edge / DNS / Gateway / Tunnels | `rollup_networking_1m/1h` | Ingress/egress bytes, POP latency p95, DNS QPS, WAF/rate-limit blocks, tunnel uptime |
| 11 | `bots` | Agent Workforce Runtime | `fact_bot_runs`, `state_bots`, `rollup_bots_1h/1d` | Runs completed/failed, task success rate, tool-call mix, tokens & cost per task, autonomous throughput |
| 12 | `sandboxes` | Visor Runtime (`hanzoai/visor`) | `state_sandboxes`, `rollup_sandboxes_1m/1h` | Concurrent sandboxes, cold-start p95, warm-pool hit rate, OOM/timeout kills, isolation faults |
| 13 | `research` | Research Runtime (`hanzoai/research`) | `fact_research_runs`, `rollup_research_1d` | Pre-registered hypotheses, runs executed, replication rate, Research Yield ($Y_R$), research compute cost |
| 14 | `product` | Event Plane (`event.*`, HIP-1190) | `rollup_events_1h/1d`, `product_performance` | DAU/WAU/MAU, activation funnels, D1/D7/D30 retention cohorts, feature adoption |
| 15 | `marketing` | Attribution & Campaign Events | `rollup_marketing_1d` | Acquisition by channel, signup-to-active conversion, campaign spend, CAC, payback period |
| 16 | `sales` | CRM & Enterprise Quotes | `fact_sales_events`, `rollup_sales_1d` | Pipeline value, win rate, trial-to-paid conversion, expansion MRR, enterprise cycle length |
| 17 | `support` | Support & Escalation Plane | `fact_support_events`, `rollup_support_1h/1d` | Ticket volume, first-response & resolution p50/p95, CSAT, SLA breach count, bot deflection rate |
| 18 | `security` | Audit (HIP-1103), KMS, CA, WAF | `fact_security_events`, `rollup_security_1m/1h` | Auth anomalies, secret/cert rotations, policy denials, abuse blocks, audit trail continuity |
| 19 | `infrastructure` | O11y (`insights.*`, HIP-1240) | `rollup_o11y_1m/1h`, `watermarks` | Cluster/node saturation, SLO burn rate, Datastore merge queue, SQL pool pressure, ingestion lag |
| 20 | `developer` | CLI, SDK, Unified MCP (HIP-0300) | `rollup_developer_1h/1d` | Active API keys, SDK/CLI version mix, MCP tool QPS & error rate, webhook delivery success |

#### 3.1 Shared Consumers Matrix

All Hanzo surfaces and autonomous bots MUST consume metrics exclusively through this plane so definitions never diverge:

- **Product Surfaces**:
  - **Admin** (`admin.hanzo.ai`): Fleet-wide `global` overview across all 20 domains, org drill-downs, reconciliation health, and real-time operational SSE streams.
  - **Cloud** (`cloud.hanzo.ai`): Org-scoped `cloud`, `compute`, `storage`, `networking`, `ai`, and `commerce` usage and billing overview.
  - **Console** (`console.hanzo.ai`): Developer-focused `ai`, `enso`, `kai`, `developer`, `bots`, and `sandboxes` telemetry and cost analytics.
  - **Insights** (`insights.hanzo.ai`): Deep `product`, `marketing`, `infrastructure`, and `event.*` funnel/cohort/SLO exploration.
  - **Commerce** (`commerce.hanzo.ai`): Merchant `commerce`, `finance`, `sales`, and `product_performance` views.
  - **Science** (`science.hanzo.ai`): `research`, `compute`, `ai`, and `bots` experimental yield and cost analytics.
- **Autonomous Bot Workforce** (via scoped Unified MCP tools, §5.4):
  - **Data**: Catalog hygiene, anomaly triage, schema drift detection, and ingestion lag remediation across all domains (read-only metadata + aggregates).
  - **Fin**: Exact `finance` and `commerce` monitoring (cashflow, margin, provider COGS, reconciliation status).
  - **Rev**: `commerce`, `sales`, and `finance` MRR/ARR movement, expansion signals, and churn risk scoring.
  - **Mark**: `marketing` and `product` funnels, attribution, CAC/LTV, and activation diagnostics (zero PII access).
  - **Cyber**: `security`, `iam`, `networking`, and `infrastructure` anomaly detection and abuse posture.
  - **Vi**: `product`, `developer`, and `support` adoption, UX friction, and feature retention analysis.
  - **Kai**: Cross-domain calibrated evidence retrieval across `ai`, `enso`, `kai`, `finance`, and `infrastructure` to inform autonomous decisions (HIP-1332).

### 4. Financial Correctness & Replay Safety

Financial metrics MUST be auditable, replay-safe, and bit-exact with Hanzo SQL commerce books.

#### 4.1 Prohibition of Mutable `ReplacingMergeTree` Feeding Incremental Rollups

A mutable `ReplacingMergeTree` table **MUST NEVER** be the source of a `SummingMergeTree` or `AggregatingMergeTree` Materialized View.

In ClickHouse, Materialized Views execute exclusively on newly inserted blocks prior to background deduplication merges. When a mutable entity (such as an org balance or invoice) is updated from `$100` to `$120` by inserting a new version into a `ReplacingMergeTree`, an attached `SummingMergeTree` MV blindly adds `+$120` to the previously accumulated `+$100`, producing `$220` and permanently corrupting financial aggregates on every update or backfill replay.

#### 4.2 Strict Separation of Monetary Flows from Point-in-Time State

1. **Monetary Flows (`analytics.fact_commerce_ledger`)**: Every revenue, spend, cash collection, credit grant, credit burn, refund, fee, or adjustment MUST be emitted as an **immutable, append-only signed entry** with a globally unique deterministic `entry_id`. Corrections MUST be recorded as new compensating rows (`reverses_entry_id != ''`) rather than in-place mutations. Cash (`account_kind = 'cash'`) and promotional/granted credits (`account_kind = 'credit'`) MUST remain distinct ledgers and MUST NEVER be collapsed into a single undifferentiated balance.
2. **Latest Entity State (`analytics.state_*`)**: Current account balances (`state_org_books`), active subscriptions (`state_subscriptions`), and invoice statuses (`state_invoices`) live in `ReplacingMergeTree(state_version)` tables with `is_deleted` tombstones and are read via `FINAL` or `argMax(..., state_version)` — never summed by incremental MVs.

#### 4.3 Integer Minor Currency Units & FX Timestamps

1. All monetary amounts MUST be represented as exact signed `Int64` minor currency units (e.g., USD cents, JPY yen) or exact signed `Int64` micro-units for sub-cent AI token metering with explicit `unit_scale` in `analytics.catalog`. Floating-point types (`Float32`, `Float64`) MUST NOT be used to store or sum monetary values.
2. Every monetary ledger row MUST carry ISO-4217 `currency`, `fx_rate_ts` (`DateTime64(3, 'UTC')`), `fx_rate_scaled` (`Decimal64(8)`), and pre-computed `usd_minor` (`Int64`) derived from `analytics.dim_fx_rates` at `fx_rate_ts`. Historical USD totals MUST NOT shift retroactively when exchange rates move later; FX revaluation adjustments, if required, are posted as explicit ledger entries.

#### 4.4 Durable Outbox & CDC Ingestion

1. Every monetary or subscription state mutation in Hanzo SQL MUST atomically append a record to a transactional `analytics_outbox` table within the **same ACID PostgreSQL transaction** (or be streamed from PostgreSQL logical replication WAL CDC). Best-effort fire-and-forget async goroutines from request handlers MUST NOT be the sole ingestion path for financial data.
2. An idempotent outbox relay batches committed rows into Hanzo Datastore with deterministic block deduplication (`insert_deduplicate = 1`) and advances `analytics.watermarks.high_watermark_seq` only after durable acknowledgment.
3. Duplicate delivery and out-of-order batch arrival MUST be idempotent: replaying any historical outbox range MUST converge to identical ledger sums and state projections.

#### 4.5 MRR & ARR from Subscription State

MRR and ARR MUST be computed from `analytics.state_subscriptions` (filtered to `is_deleted = 0 AND is_test = 0 AND status IN ('active', 'past_due_grace')`), never by summing raw invoice amounts (which distort recurring run-rate on annual prepayments, prorations, one-time fees, and metered usage).

- Each subscription normalizes its recurring contract value into monthly minor units (`annual / 12`, `quarterly / 3`, `weekly * 52 / 12`, integer-rounded deterministically) and USD minor units (`usd_mrr_minor`).
- One-time charges, taxes, and metered AI/compute usage are reported in separate revenue categories (`usage_revenue_minor`, `one_time_minor`).
- Daily MRR movement (`new`, `expansion`, `contraction`, `churn`, `reactivation`, `net_mrr_delta`) is materialized deterministically at UTC day boundaries into `analytics.rollup_mrr_daily` from snapshot diffs of `analytics.state_subscriptions`.

#### 4.6 Deterministic Backfill & Automated 100% Reconciliation

1. **Partition-Atomic Backfill**: Historical replays MUST rebuild target partitions into a staging table and swap atomically via `ALTER TABLE analytics.fact_commerce_ledger REPLACE PARTITION <yyyymm> FROM <staging>`, followed by deterministic rebuild of corresponding `rollup_commerce_*` partitions, guaranteeing zero double-counting.
2. **Automated Continuous Reconciliation**: A dedicated reconciliation verifier compares Hanzo Datastore (`fact_commerce_ledger` + `state_org_books` + `state_subscriptions`) against authoritative Hanzo SQL commerce books per `(org_id, currency, account_kind)` up to the aligned `high_watermark_seq`:
   - Rolling 24-hour window reconciled every **15 minutes**.
   - Full month-to-date and lifetime book balances reconciled **daily** at 00:15 UTC.
   - Required accuracy tolerance: **0 minor units (100.000% exact match)**. Any non-zero discrepancy sets `analytics.watermarks.reconciliation_ok = 0`, fires a critical `analytics.reconciliation_drift` alert carrying `(org_id, account_kind, currency, sql_minor, datastore_minor, delta_minor, watermark_seq)`, and blocks release promotion (§7.3).

### 5. Unified `/v1/analytics/*` API & MCP Contract

Hanzo Cloud API (`api.hanzo.ai`) exposes the unified analytical contract under `/v1/analytics/*` following HIP-0119 service conventions:

| Method & Path | Purpose | Scope | Target p95 |
| :--- | :--- | :--- | :--- |
| `GET /v1/analytics/metrics` | Discoverable semantic metric catalog from `analytics.catalog` (filterable by `domain`, `scope`, `tag`). | `global` / `org` | ≤ 15 ms |
| `POST /v1/analytics/query` | Declarative, typed analytical query across catalog metrics, dimensions, filters, and time windows. | `global` / `org` | ≤ 50 ms |
| `GET /v1/analytics/overview` | Pre-composed executive & operational KPI bundle + top breakdowns for a scope (`global` or `org`). | `global` / `org` | ≤ 20 ms |
| `GET /v1/analytics/stream` | Coalesced real-time SSE stream with monotonic versions and `?since_version=` resync (§6). | `global` / `org` | push |
| `GET /v1/analytics/health` | Analytical plane health: Datastore & KV status, outbox lag, merge queue, reconciliation status. | `global` / ops | ≤ 15 ms |
| `GET /v1/analytics/freshness` | Per-domain watermark freshness (`as_of`, `lag_ms`, `version`, `stale`, `reconciled_at`). | `global` / `org` | ≤ 15 ms |

#### 5.1 Query Request & Freshness Envelope

`POST /v1/analytics/query` accepts a strictly typed JSON payload (never raw SQL):

```json
{
  "scope": "global",
  "metrics": ["finance.cash_collected_usd_minor", "ai.requests", "ai.latency_p95_ms"],
  "dimensions": ["model_id", "provider_id"],
  "filters": [
    { "field": "is_test", "op": "eq", "value": false },
    { "field": "provider_id", "op": "in", "value": ["zen", "hanzo-gpu"] }
  ],
  "time_range": {
    "start": "2026-11-18T00:00:00Z",
    "end": "2026-11-25T00:00:00Z"
  },
  "granularity": "1h",
  "compare_previous": true,
  "order_by": [{ "field": "ai.requests", "dir": "desc" }],
  "limit": 100
}
```

Every `/v1/analytics/query` and `/v1/analytics/overview` response MUST include a standardized `meta` freshness and provenance envelope:

```json
{
  "data": [
    {
      "bucket": "2026-11-24T23:00:00Z",
      "dimensions": { "model_id": "zen-max", "provider_id": "zen" },
      "values": {
        "finance.cash_collected_usd_minor": 4829100,
        "ai.requests": 148920,
        "ai.latency_p95_ms": 412.5
      }
    }
  ],
  "meta": {
    "scope": "global",
    "version": 9842104,
    "as_of": "2026-11-25T02:58:59.412Z",
    "freshness_ms": 840,
    "stale": false,
    "reconciliation_ok": true,
    "reconciled_at": "2026-11-25T02:45:00.000Z",
    "source_table": "analytics.rollup_ai_usage_1h",
    "cache_status": "miss",
    "query_ms": 14.2,
    "truncated": false
  }
}
```

#### 5.2 Query Planner & Table Selection

The Cloud API query planner MUST compile each declarative query into parameterized ClickHouse SQL:

1. **Catalog Validation**: Reject unknown `metrics`, disallowed `dimensions`, or unauthorized `scope` with `400 Bad Request` / `403 Forbidden` before touching Datastore.
2. **Coarsest Lossless Table Selection**: Select the coarsest rollup whose granularity divides the requested `granularity` and contains all required dimensions and mergeable states (`_1d` → `_1h` → `_1m` → serving view → raw table only if `catalog.serving_tables` explicitly permits raw scan).
3. **Zero Unbounded Raw Scans**: Requests spanning > 24 hours at `1m` granularity or requesting raw scans without explicit catalog eligibility MUST be rejected with `422 Unprocessable Entity` and a suggested coarser granularity.

#### 5.3 IAM Tenant Isolation & Query Budgets

1. **Mandatory IAM Enforcement (HIP-0111)**: Every request MUST authenticate via a verified Hanzo IAM bearer token or service identity. For org-scoped principals, the planner MUST unconditionally bind `org_id = @verified_org_id` at the AST/parameter layer; any attempt to query `scope = "global"` or filter another `org_id` MUST return `403 Forbidden`. Platform `global` access requires explicit `analytics:global:read` or domain-restricted `analytics:<domain>:global:read` permission.
2. **Cardinality, Cost & Timeout Budgets**: Enforced per caller profile (`ui`, `api`, `bot`, `export`) via both API validation and ClickHouse execution settings:

| Budget Dimension | `ui` / Overview | `api` Ad-Hoc | `bot` (MCP) | `export` |
| :--- | :--- | :--- | :--- | :--- |
| Max `limit` / groups | 250 (top-K + `__other__`) | 1,000 | 500 | 10,000 |
| Max time span (`1m` / `1h` / `1d`) | 24h / 90d / 2y | 24h / 90d / 5y | 24h / 90d / 2y | 7d / 365d / 5y |
| `max_execution_time` | 2 s | 10 s | 5 s | 30 s |
| `max_memory_usage` | 512 MiB | 1 GiB | 512 MiB | 2 GiB |
| `max_rows_to_read` | 5,000,000 | 25,000,000 | 10,000,000 | 100,000,000 |
| Concurrent queries per principal | 8 | 10 | 4 | 2 |

#### 5.4 Safe MCP Access for Hanzo Bots & Kai

Unified MCP (`hanzoai/mcp`, HIP-0300) MUST expose read-only semantic analytics tools backed directly by `/v1/analytics/*`:

- `analytics_list_metrics(domain?, scope?)` → `GET /v1/analytics/metrics`
- `analytics_overview(scope, domain?, window?)` → `GET /v1/analytics/overview`
- `analytics_query(scope, metrics, dimensions?, filters?, time_range, granularity?, limit?)` → `POST /v1/analytics/query`
- `analytics_freshness(domain?)` → `GET /v1/analytics/freshness`

Safety invariants for autonomous bots (Data, Fin, Rev, Mark, Cyber, Vi, Kai):

1. **No Raw SQL Tool**: Bots MUST interact solely through the typed semantic tools above; arbitrary SQL execution against production Datastore or SQL is prohibited.
2. **Domain Least Privilege**: Each bot runs under a dedicated IAM service identity granted only the domains required for its role (e.g., `Mark` cannot read `finance` payouts or `pii_class = restricted` fields; `Fin` reads `commerce` and `finance`; `Cyber` reads `security`, `iam`, and `networking`).
3. **PII Redaction by Default**: Fields marked `pii_class != none` in `analytics.catalog` MUST be omitted or irreversibly hashed unless the bot identity holds an explicit `analytics:pii:read` grant.
4. **Tamper-Evident Audit Trail**: Every MCP analytics call MUST emit a HIP-1103 audit record containing `(principal, tool, scope, metrics, row_count, query_ms, version)`.

### 6. Real-Time Delivery (Coalesced SSE)

Fixed-interval client polling (e.g., 15-second `setInterval` fetches across dashboard widgets) is deprecated and MUST be replaced by coalesced Server-Sent Events at `GET /v1/analytics/stream`.

#### 6.1 Shared Per-Scope SSE Hubs ($O(1)$ Database Load)

1. Cloud API maintains an in-memory **Scope Hub** keyed by `(scope, view, domain_set)` (for example, `global:overview:all` or `org:<id>:overview:commerce`).
2. Every authenticated client subscribing to an identical scope joins the existing hub rather than spawning its own query loop.
3. A single hub leader refreshes from Hanzo Datastore at most once per watermark advance or bounded cadence (default 2 seconds when active, 0 queries when zero subscribers are connected). Across multiple API replicas, hub refresh payloads are coalesced via Hanzo KV pub/sub (`analytics:hub:<scope_key>`) with a single-flight lease; if Hanzo KV is unavailable, each replica degrades cleanly to local single-flight hub refresh without amplifying load per viewer.
4. Consequently, **1,000+ concurrent viewers** watching the same dashboard generate **$O(1)$ Datastore queries** per tick.

#### 6.2 Monotonic Versions, Wire Events & `?since_version=` Resync

1. Every snapshot emitted by a Scope Hub carries a strictly monotonic `version` (`UInt64`, derived from `max(analytics.watermarks.version)` paired with hub sequence), sent in both the SSE `id:` header and the JSON payload.
2. Supported SSE event types:
   - `snapshot` — Full coalesced view payload for initial hydration or after a version gap.
   - `delta` — Compact changed-metric diff when consecutive versions differ minimally.
   - `freshness` — Lightweight watermark update (`version`, `as_of`, `freshness_ms`).
   - `stale` — Explicit degraded-plane indicator emitted immediately when Datastore is unreachable or watermark lag exceeds `freshness_sla_ms`.
   - `heartbeat` — Keepalive emitted every 25 seconds (or comment frame `: keepalive`) to traverse proxies and detect dead sockets.
3. **Watermark Resync**: Clients connecting or reconnecting MUST pass `?since_version=<last_seen>` (or standard `Last-Event-ID`). If the hub's current version equals `since_version`, the server MUST NOT re-serialize the full snapshot and instead emits a lightweight `freshness` confirmation.
4. **Bounded Slow-Consumer Backpressure**: Each subscriber channel has a fixed ring capacity (default 16 frames). If a slow consumer falls behind, intermediate frames are dropped and replaced with the newest coalesced `snapshot` so slow browsers never cause unbounded server memory growth.

#### 6.3 Tab Visibility Pause

Browser clients (Admin, Cloud, Console, Insights, Commerce, Science) MUST observe `document.visibilitychange`:

- When a tab enters `hidden` state for more than 30 seconds, the client MUST pause/close its SSE stream.
- Upon returning to `visible`, the client MUST immediately reconnect to `/v1/analytics/stream?since_version=<last_seen>`, recovering any missed updates in a single coalesced frame with zero idle background socket drain.

### 7. Workload Isolation, Observability & Release Qualification Gates

#### 7.1 Workload Isolation

Hanzo Datastore MUST isolate analytical workloads via dedicated ClickHouse settings profiles, connection pools, and (at scale) dedicated read replicas:

| Pool / Profile | Workload | Priority | Memory & Time Guardrails |
| :--- | :--- | :--- | :--- |
| `analytics_serving` | `/v1/analytics/overview`, KPI serving views, SSE hub refreshes | Highest | `max_execution_time = 2s`, strict memory cap, dedicated connection pool |
| `analytics_ingest` | Outbox/CDC inserts, MV execution, watermark commits | High | Batched inserts (`min_insert_block_size_rows`), bounded merge threads |
| `analytics_adhoc` | `/v1/analytics/query`, Insights exploration, bot MCP queries | Medium | Per-principal concurrency caps, `max_execution_time = 5–10s`, spill disabled |
| `analytics_backfill` | Historical partition rebuilds, reconciliation verification | Lowest | Throttled `max_threads`, background pool; MUST NEVER starve serving or ingest |

#### 7.2 Plane Observability

The analytics plane MUST emit structured telemetry to Hanzo O11y (HIP-1240):

- `analytics_query_duration_ms` (histogram by endpoint, domain, `source_table`, `cache_status`, caller profile)
- `analytics_outbox_lag_ms` and `analytics_watermark_lag_ms` (gauge by domain and source)
- `analytics_reconciliation_delta_minor` (gauge by org/currency/account_kind; alerts on `!= 0`)
- `analytics_sse_subscribers` vs `analytics_sse_hub_refreshes_total` (proving $O(1)$ fan-out ratio)
- `analytics_budget_rejections_total` (counter by reason: cardinality, timeout, memory, authz)
- `analytics_stale_responses_total` (counter tracking degraded serving)

#### 7.3 Release Qualification Gates

Production promotion of any release touching `analytics.*`, `/v1/analytics/*`, or SSE hubs MUST pass all quantitative gates and failure-mode tests below:

| Qualification Gate | Mandatory Threshold | Verification Method |
| :--- | :--- | :--- |
| Global KPI latency (`GET /v1/analytics/overview?scope=global`) | **p95 ≤ 20 ms** | Load test against 100,000-org dataset (cold & warm KV) |
| Analytics API latency (`POST /v1/analytics/query`) | **p95 ≤ 50 ms** | Representative multi-domain query mix |
| Event & financial freshness (source commit → queryable) | **p95 ≤ 2 s** | End-to-end outbox/stream synthetic canary timestamp diff |
| Dashboard data available (initial render → hydrated KPIs) | **≤ 250 ms** | Synthetic browser measurement on Admin & Cloud overviews |
| Financial reconciliation vs Hanzo SQL commerce books | **100% exact (0 minor-unit drift)** | Automated verifier across all active orgs, currencies, cash & credit ledgers |
| Per-org operational Postgres RPC fan-out on fleet reads | **0 RPCs** | Runtime SQL/RPC counter assertion during fleet dashboard suite |
| Organization scale qualification | **100,000 organizations** | Synthetic fleet benchmark in staging Datastore |
| Concurrent real-time viewer qualification | **1,000+ concurrent SSE viewers** | Load generator verifying $O(1)$ Datastore QPS & bounded RSS |

Mandatory failure-mode qualification tests:

1. **Cold KV / KV Outage Test**: Flush and disconnect Hanzo KV under steady load. `/v1/analytics/overview` and `/v1/analytics/query` MUST continue returning HTTP 200 with exact values directly from Hanzo Datastore, zero SQL RPC fan-out, and within serving SLOs.
2. **Datastore Outage & Stale Indicator Test**: Sever Datastore connectivity. `/v1/analytics/overview` and active SSE hubs MUST serve last-known KV snapshots (when present) marked `stale: true` with accurate `as_of` / `freshness_ms` and emit `event: stale` on SSE (or `503 Service Unavailable` with explicit structured error when no snapshot exists) — never silent zeros or unflagged stale data.
3. **Duplicate & Out-of-Order Replay Test**: Replay an outbox window 3× with shuffled batch ordering. `fact_commerce_ledger`, `rollup_commerce_*`, `state_org_books`, `state_subscriptions`, and MRR totals MUST remain 100% identical to single ordered delivery.
4. **Tenant Isolation Adversarial Test**: Execute cross-org filter injection, `scope=global` escalation attempts, and dimension-pivoting queries using org-scoped user and bot tokens. Every unauthorized request MUST fail closed with `403 Forbidden` or return exclusively caller-owned rows.

### 8. Migration Plan

Transitioning from legacy `MemoLedger` fleet folds and transitional `hanzo.fleet_*` mirrors to canonical `analytics.*` serving tables MUST proceed in four zero-downtime phases without breaking existing Admin or Cloud API consumers:

#### 8.1 Phase 0 — Stabilize & Contain (Prerequisite)

- Eliminate unbounded refold storms via KV memoization and transitional single-org mirrors (`hanzo.fleet_org_books`, `hanzo.fleet_subscriptions`, `hanzo.fleet_invoices`, `hanzo.fleet_sync_meta`) so Admin boards decouple from immediate 17,436-RPC outages while canonical infrastructure deploys.

#### 8.2 Phase 1 — Canonical `analytics` Namespace & Durable Outbox

- Provision `analytics.catalog`, `analytics.watermarks`, `analytics.dim_*`, `analytics.fact_commerce_ledger`, `analytics.state_*`, `analytics.rollup_*`, and constant-cost serving views in Hanzo Datastore.
- Attach ClickHouse Materialized Views to existing `event.*`, `hanzo.cloud_usage`, `hanzo.compute_samples`, and `insights.*` with zero historical raw duplication.
- Enable transactional `analytics_outbox` writes in Hanzo SQL Commerce/Ledger/IAM services and start the idempotent relay to `analytics.*` in parallel with legacy mirrors.

#### 8.3 Phase 2 — Deterministic Backfill & Shadow Reconciliation

- Execute partition-atomic backfills for historical commerce ledgers, subscription states, and domain rollups.
- Run automated continuous reconciliation comparing `analytics.*` against authoritative Hanzo SQL books and shadow-diffing legacy `MemoLedger` responses against `analytics.global_kpi_summary` and `analytics.org_kpi_summary` for at least 7 consecutive days until 100% exact parity (0 minor-unit drift) is sustained.

#### 8.4 Phase 3 — Unified `/v1/analytics/*` API, MCP & Coalesced SSE Cutover

- Deploy `/v1/analytics/*` endpoints, Scope Hubs, and Unified MCP tools behind progressive per-surface feature flags.
- Re-point legacy Admin metrics endpoints to thin compatibility adapters backed by `analytics.*` so existing Admin clients experience zero breaking schema changes.
- Migrate Admin, Cloud, Console, Insights, Commerce, and Science UIs from 15-second polling to `/v1/analytics/overview` + `/v1/analytics/stream` with tab-visibility pause and `?since_version=` resync.

#### 8.5 Phase 4 — Decommission Fan-Out & Lock Qualification Gates

- Remove legacy per-org RPC fleet fold code paths (`MemoLedger` fan-out loop) and enforce a hard CI/runtime invariant of `0 per-org RPC fan-out` on fleet routes.
- Retire transitional `hanzo.fleet_*` tables once zero readers remain.
- Enable all §7.3 Release Qualification Gates as mandatory blocking checks in CI/CD.

#### 8.6 Unified Global Schema Bridge (`hanzoai/orm/schema` + ZAP + Zip)

To permanently eliminate schema drift across operational SQL tables, ClickHouse analytical DDL, wire protocols, and API/MCP catalogs, canonical Hanzo entities are declared once in `github.com/hanzoai/orm/schema` (`hanzoai/orm#22`) via typed Go structs (`Reflect[T]` / `RegisterStruct[T]`) or ZAP `.zap` IDL (`ParseZAP`) and deterministically compiled to:

1. **Hanzo SQL (`hanzoai/sql`) DDL** — PostgreSQL and SQLite parity, `CHECK ("org" <> '')`, forced PostgreSQL Row-Level Security (`ENABLE`/`FORCE ROW LEVEL SECURITY`), and direct `ToTenantTable()` integration with `orm/tenant`.
2. **Hanzo Datastore (`hanzoai/datastore`) ClickHouse 26.2-Safe DDL** — L0 `ReplacingMergeTree(version)`/`MergeTree` tables, L1 `AggregatingMergeTree`/`SummingMergeTree` rollups + `MaterializedView`s, L3 `ReplacingMergeTree(refreshed_at)` serving snapshots, and compile-time static validation (`CheckClickHouse262Safety`, zero floats on financial entities, HIP-1405 §4.1 invariant blocking `ReplacingMergeTree` -> `SummingMergeTree` MVs, zero raw `event.*` scans in L3 snapshots).
3. **Bidirectional ZAP `.zap` IDL** — emits both `zap/go/idl` (`zapgen`) and `zapc-rs` (Rust) wire schemas with lossless round-trip back to SQL and ClickHouse DDL.
4. **Governance & Analytics Catalog Projection** — OpenAPI 3.1 / JSON Schema / Unified MCP metadata with domain, units, accuracy, freshness SLAs, and PII tags.

#### 8.7 Phase II Production Qualification Receipts (2026-11-25)

Every qualification gate is tracked honestly against live `datastore-0` (ClickHouse `26.2.7`, 2-core CFS limit, `12 GiB` RAM), the Go `/v1/analytics/*` qualification suite (`apps/analytics/qualification_test.go`), and live production deployment state. Untested or pending-rollout gates remain explicitly marked **PENDING PROD VERIFY**.

| Release Gate | Target | Measured Receipt | Status |
|---|---|---|---|
| **Global KPI Query Latency** (`serving_global_overview`, live `datastore-0`, `N=500`, `c=4`) | p95 <= 20ms | **p50 = 3ms, p90 = 9ms, p95 = 16ms** (4 rows read; down from pre-L3 view p50 = 62ms / p95 = 121ms) | **PASS (Live `datastore-0`)** |
| **Model & Provider Economics** (`serving_model_performance` / `serving_provider_economics`, `N=500`, `c=4`) | p95 <= 20ms | **p50 = 2ms, p90 = 4ms, p95 = 7ms** (down from pre-L3 p95 = 95ms / 51ms) | **PASS (Live `datastore-0`)** |
| **100K & 1M Organizations Under Concurrent Writes** (`N=500`, `c=4`, 2,000 rows/sec bg mutations, isolated temp tables) | p95 <= 20ms | L3 `serving_global_overview` @ 1M orgs: **p50 = 6ms, p90 = 14ms, p95 = 20ms** (`index_granularity=64`, `max_threads=1`); 100K org point lookup: **p50 = 4ms, p95 = 17ms** | **PASS (Live `datastore-0`)** |
| **Real-Time MV Freshness** (`N=50` sequential insert -> MV read on live `datastore-0` + live `rollup_o11y_minute`/`rollup_ai_minute`) | p95 <= 2,000ms | **p50 = 113ms, p95 = 141ms, max = 165ms** (includes 2x CLI spawn; live `rollup_o11y_minute` streaming 2,918 spans/2m) | **PASS (Live `datastore-0`)** |
| **1,000 & 10,000 Concurrent Viewers** (`TestHIP1405Qualification1KAnd10KConcurrentViewers`, 50 stalled slow consumers) | Coalesced O(1) DS, bounded heap, p95 <= 50ms | 1K viewers: **1,000x coalesce, p50 = 3.18ms, p95 = 3.81ms, heap = 5.5 MiB**; 10K viewers: **10,000x coalesce, p50 = 2.24ms, p95 = 6.84ms, heap = 26.8 MiB** | **PASS (Suite Verified)** |
| **Analytics HTTP API & Cold KV** (`TestHIP1405QualificationAPILatencyAndColdKV`, `N=500`, `c=16`, 3ms L3 backend) | p95 <= 50ms (warm & cold KV) | Warm KV: **p50 = 0.09ms, p95 = 2.10ms**; Cold/Down KV: **p50 = 3.37ms, p95 = 3.66ms, max = 5.27ms** | **PASS (Suite) / PENDING PROD ROLLOUT** |
| **Exact Financial Reconciliation & Idempotent Replay** (`datastore/analytics_reconcile_test.go`, `apps/commerce/fleet_mirror_test.go`) | 0 duplicate effects, 0 minor-unit drift | Unit/race tests PASS for concurrent debits, refunds (`sign=-1`), multi-currency, duplicate `entry_id`, out-of-order `version` | **PASS (Suite) / PENDING PROD SHADOW RUN** |
| **Zero Per-Org RPC Fan-Out on Interactive Reads** | 0 per-org RPCs | Removed interactive delta/fallback sweeps in `fleet_datastore.go`; live `cloud` CPU `-70.2%` (`5,270m -> 1,573m`), `sql-2` CPU `-84.7%` (`4,093m -> 628m`) | **PASS (Code) / PENDING PROD ROLLOUT** |
| **Strict Cross-Tenant Isolation** (`TestStrictTenantIsolation`) | 0 cross-org leakage | Unauth -> 401, no-org -> 403, non-super cross-org/global -> 403 across HTTP, planner, KV keys, and SSE | **PASS (Suite) / PENDING PROD VERIFY** |

Merged implementation artifacts: Hanzo Cloud analytics plane & Phase II L3 qualification (`v8.5.1428+` live & release train); `hanzoai/admin#35` (live), `#36`; `hanzoai/orm#22`; `hanzoai/o11y#46`, `#47`; `hanzoai/sql#6`; `hanzoai/kv#14`; `hanzoai/docdb#23`.

## Rationale

- **ClickHouse-Native Streaming Rollups over Batch ETL or SQL Materialized Views**: Materialized views in PostgreSQL cannot aggregate across thousands of isolated per-org schemas without cross-schema polling, and scheduled batch ETL warehouses cannot satisfy a 2-second freshness target. ClickHouse `SummingMergeTree` and `AggregatingMergeTree` MVs aggregate incrementally on insert with native mergeable t-digest percentiles and HyperLogLog distinct sketches while reusing existing raw Datastore tables without copying 1.77B+ historical rows.
- **Immutable Ledger Facts Separate from Latest State**: Attempting to feed incremental `SummingMergeTree` MVs from mutable `ReplacingMergeTree` tables is a well-known analytical correctness hazard in ClickHouse because MVs fire before merge-time deduplication. Separating immutable signed ledger flows (`fact_commerce_ledger`) from latest-state snapshots (`state_*`) guarantees exact replay safety and 100% financial reconciliation.
- **Coalesced SSE Hubs over WebSockets or Polling**: Dashboard updates are overwhelmingly server-to-client push. HTTP/2 SSE traverses corporate proxies cleanly, provides standard `Last-Event-ID` / `?since_version=` resync semantics, requires zero bidirectional state protocol overhead, and collapses 1,000+ concurrent viewers into $O(1)$ backend work.
- **Semantic Catalog & Typed Query API over Raw SQL Exposure**: Exposing raw SQL to dashboards or autonomous bots invites tenant-isolation bypasses, metric-definition drift, and unbounded full-table scans. A catalog-governed declarative API enforces IAM tenant predicates, coarsest-rollup selection, PII masking, and resource budgets uniformly for humans and bots alike.

## Security Considerations

- **Multi-Tenant Isolation**: Cross-tenant leakage is the highest-severity risk in a global analytical plane. Org-scoped predicates (`org_id = @verified_org_id`) MUST be injected deterministically by the Cloud API query planner from verified IAM claims (HIP-0111), never interpolated from untrusted strings or client filters. Global queries require explicit elevated permissions audited under HIP-1103.
- **Analytical Denial of Service**: High-cardinality `GROUP BY` queries, wide unrolled time ranges, or runaway bot loops can exhaust Datastore memory or CPU. Workload isolation pools (§7.1), catalog-enforced cardinality caps with `__other__` bucketing, and strict ClickHouse execution budgets (`max_execution_time`, `max_memory_usage`, `max_rows_to_read`) bound blast radius per principal.
- **Bot & MCP Governance**: Autonomous bots operating via Unified MCP (HIP-0300) receive domain-scoped least-privilege identities, zero raw SQL access, default PII redaction, and full audit logging so compromised or misbehaving agents cannot exfiltrate sensitive customer or treasury records.
- **Financial Integrity**: Enforcing append-only signed minor currency units, explicit compensating entries, transactional outbox delivery, and automated zero-drift reconciliation against Hanzo SQL prevents silent monetary corruption, double-counting, or conflation of promotional credit with collected cash.
- **SSE Resource Exhaustion**: Per-principal concurrent SSE connection limits, bounded per-subscriber ring buffers, mandatory IAM token validation on connect and periodic re-validation on long-lived streams, and tab-visibility pause prevent slow-loris and socket-exhaustion attacks.

## References

- [HIP-0000](./hip-0000-hanzo-ai-architecture-framework.md) — Hanzo AI Architecture & Framework
- [HIP-0111](./hip-0111-iam-authentication-standard.md) — Hanzo IAM Authentication Standard
- [HIP-0119](./hip-0119-hanzo-service-conventions.md) — Hanzo Service Conventions
- [HIP-0132](./hip-0132-one-telemetry-plane.md) — One Telemetry Plane — One Endpoint, One Schema, Many Lenses
- [HIP-0139](./hip-0139-capability.md) — One Capability, Nine Projections
- [HIP-0300](./hip-0300-unified-mcp.md) — Unified MCP — One Endpoint, and Local Servers That Forward to It
- [HIP-0401](./hip-0401-datastore-crd.md) — Datastore CRD
- [HIP-0402](./hip-0402-sql-crd.md) — SQL CRD
- [HIP-0403](./hip-0403-kv-crd.md) — KV CRD
- [HIP-1001](./hip-1001-ledger-double-entry-ledger.md) — Ledger — The Double-Entry Ledger
- [HIP-1103](./hip-1103-audit-tamper-evident-trail.md) — Audit Tamper-Evident Trail
- [HIP-1190](./hip-1190-event-product-analytics.md) — Event — The Product Analytics Plane
- [HIP-1220](./hip-1220-commerce-the-merchant-half.md) — Commerce — The Merchant Half
- [HIP-1240](./hip-1240-o11y-the-observability-plane.md) — O11y — The Observability Plane
- [HIP-1332](./hip-1332-kai-the-decision-model.md) — Kai — The Decision Model and the Decision Plane

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
