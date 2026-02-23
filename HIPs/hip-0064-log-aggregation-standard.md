---
hip: 0064
title: Log Aggregation & Search Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-02-23
requires: HIP-0031, HIP-0047
---

# HIP-64: Log Aggregation & Search Standard

## Abstract

This proposal defines the log aggregation, indexing, and search standard for the
Hanzo ecosystem. **Hanzo Logs** provides centralized log collection, structured
storage, full-text search, and AI-powered anomaly detection across all services
in the Hanzo infrastructure.

The stack consists of three components: **Vector** (collection and routing),
**ClickHouse** (storage and indexing), and a **custom search UI** (query and
exploration). Every Hanzo service MUST emit structured JSON logs to stdout.
Vector agents running as Kubernetes DaemonSets collect, enrich, and forward
these logs to the shared ClickHouse cluster (HIP-0047) for long-term retention
and SQL-native querying.

AI-specific log enrichment -- request/response correlation, token counting,
model identification, and cost attribution -- is applied at the Vector
transformation layer before storage, enabling first-class observability for
LLM workloads without application-level instrumentation changes.

**Repository**: [github.com/hanzoai/logs](https://github.com/hanzoai/logs)
**Image**: `ghcr.io/hanzoai/logs:latest`
**Port**: 8064 (Search API)
**Storage**: ClickHouse (HIP-0047), database `hanzo_logs`

## Motivation

Logs are the most fundamental observability signal. Metrics tell you *that*
something is wrong. Traces tell you *where* in a request chain it went wrong.
Logs tell you *why* -- the actual error message, the malformed input, the
unexpected state that triggered the failure.

Hanzo runs 20+ services across two Kubernetes clusters. Without centralized
log aggregation:

1. **Debugging requires kubectl.** An engineer investigating a failed LLM
   request must identify which pod handled it, then `kubectl logs` that pod,
   then grep through unstructured text. If the request spanned multiple
   services (gateway -> IAM -> billing), the engineer repeats this for each
   service, manually correlating by timestamp.

2. **Logs vanish when pods restart.** Kubernetes discards container stdout
   when a pod restarts or is evicted. A crash-loop that started at 3 AM has
   no logs by 9 AM. The root cause is gone.

3. **No cross-service correlation.** A single user request may touch the LLM
   Gateway, IAM (token validation), the billing system (credit check), and
   the upstream model provider. Without a shared trace ID propagated through
   logs, correlating these interactions requires manual timestamp alignment
   across separate log streams.

4. **AI workloads generate unique log data.** LLM requests carry metadata
   that traditional logging does not capture: model name, token counts,
   provider latency, cache status, cost per request. This metadata is
   critical for cost attribution, capacity planning, and debugging model
   regressions. It must be extracted and indexed, not buried in unstructured
   text.

5. **Compliance requires immutable audit trails.** SOC 2 and enterprise
   customer contracts require that authentication events, permission changes,
   and data access are logged immutably and retained for defined periods.
   Ephemeral pod logs do not satisfy this requirement.

## Design Philosophy

### Why Not ELK (Elasticsearch + Logstash + Kibana)

ELK was the default log aggregation stack for a decade. We reject it for
three reasons:

1. **Licensing.** Elasticsearch switched from Apache 2.0 to SSPL (Server
   Side Public License) in January 2021. SSPL is not recognized as open
   source by the OSI. It restricts offering Elasticsearch as a managed
   service. While this does not directly affect self-hosted use, it signals
   a vendor trajectory toward commercial lock-in. OpenSearch (the Apache 2.0
   fork) exists but lags behind Elasticsearch in features and has its own
   operational complexity.

2. **Resource consumption.** Elasticsearch is a JVM application. A
   production cluster for log volumes of 50-100 GB/day requires a minimum
   of 3 nodes with 16 GB heap each -- 48 GB of RAM just for the search
   engine. Add Logstash (another JVM process, 1-4 GB heap) and Kibana
   (Node.js, 1-2 GB). Total baseline: 50-60 GB RAM. ClickHouse handles the
   same volume with 8-16 GB RAM because columnar storage and compression
   reduce the working set by 10-20x.

3. **Operational complexity.** Elasticsearch requires careful shard
   management, index lifecycle policies, and cluster balancing. Shard
   count misconfiguration is the single most common cause of Elasticsearch
   cluster instability. ClickHouse's MergeTree engine handles partitioning
   and compaction automatically with minimal tuning.

**Cost comparison at 100 GB/day log volume (30-day retention)**:

| Stack | RAM Required | Disk (30 days) | Nodes |
|-------|-------------|----------------|-------|
| ELK | 48-64 GB | 3 TB (1x compression) | 3-5 |
| ClickHouse + Vector | 8-16 GB | 200-300 GB (10-15x compression) | 1-2 |

ClickHouse stores the same logs in 10-15x less disk space. This is not an
optimization -- it is a fundamentally different storage architecture.

### Why Not Grafana Loki

Loki is the log aggregation system from the Grafana ecosystem. It is
designed for simplicity: logs are indexed only by labels (service name,
pod, namespace), not by content. Full-text search is not indexed; it scans
matching label streams sequentially.

This design works well for small deployments where engineers know which
service to look at. It breaks down for Hanzo's use case:

1. **No full-text indexing.** Searching for an error message like
   `"insufficient credits for model zen-72b"` across all services requires
   scanning every log line from every matching label stream. At 100 GB/day,
   a full-text search over 7 days scans 700 GB. Loki does this sequentially.
   Response time: minutes. ClickHouse with a tokenized full-text index
   returns results in seconds.

2. **Limited query language.** LogQL (Loki's query language) supports label
   filtering, line filtering, and basic aggregations. It does not support
   JOINs, subqueries, window functions, or complex aggregations. For
   queries like "show me the top 10 most expensive LLM requests per
   organization in the last 24 hours, correlated with their error rate,"
   LogQL cannot express this. ClickHouse SQL can.

3. **No correlation with analytics.** Hanzo's analytics data already lives
   in ClickHouse (HIP-0047). If logs also live in ClickHouse, engineers
   can JOIN log data with analytics events in a single query. With Loki,
   logs and analytics are in separate systems with different query
   languages, requiring manual correlation.

**Decision**: Use ClickHouse for log storage. Same engine as analytics
(HIP-0047), same query language (SQL), same operational tooling, and
full-text search capability via tokenized indexes.

### Why Vector Over Fluentd / Fluentbit / Logstash

Vector is a high-performance observability data pipeline written in Rust.
It collects, transforms, and routes logs, metrics, and traces.

| Feature | Vector | Fluentd | Fluentbit | Logstash |
|---------|--------|---------|-----------|----------|
| Language | Rust | Ruby + C | C | JVM (Java) |
| Memory (idle) | 15-30 MB | 100-200 MB | 10-20 MB | 500 MB+ |
| Throughput | 10+ GB/s | 1-2 GB/s | 3-5 GB/s | 1-3 GB/s |
| ClickHouse sink | Native | Plugin | Plugin | Plugin |
| VRL transforms | Yes (Turing-complete) | Ruby plugins | Lua plugins | Ruby/Grok |
| End-to-end acks | Yes | Partial | Partial | Yes |
| Disk buffering | Built-in | Plugin | Limited | Yes |

Fluentbit is the closest competitor in footprint. We choose Vector because:

1. **Native ClickHouse sink.** Vector writes directly to ClickHouse via the
   native TCP protocol (port 9000), batching inserts automatically. Fluentbit
   requires an HTTP output plugin with manual batch configuration.

2. **VRL (Vector Remap Language).** VRL is a purpose-built transformation
   language with compile-time type checking. It catches transformation
   errors at configuration load, not at runtime. This matters when a
   malformed transform silently drops log fields in production.

3. **End-to-end acknowledgments.** Vector guarantees that a log event is
   either delivered to ClickHouse and acknowledged, or buffered to disk for
   retry. No silent data loss during ClickHouse restarts or network
   partitions.

**Trade-off**: Vector has a smaller community than Fluentd/Fluentbit. We
accept this because the technical advantages (Rust performance, native
ClickHouse support, VRL type safety) outweigh community size for our
specific use case.

## Specification

### Structured JSON Logging Standard

All Hanzo services MUST emit logs as single-line JSON objects to stdout. This
is the canonical log format that Vector parses and ClickHouse stores.

#### Required Fields

```json
{
  "ts": "2026-02-23T14:30:00.123Z",
  "level": "info",
  "msg": "request completed",
  "service": "llm-gateway",
  "version": "1.4.2",
  "env": "production",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ts` | ISO 8601 DateTime | Yes | Event timestamp with millisecond precision, UTC |
| `level` | String enum | Yes | One of: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `msg` | String | Yes | Human-readable log message |
| `service` | String | Yes | Service name matching K8s Deployment name |
| `version` | SemVer string | Yes | Service version (git tag or commit SHA) |
| `env` | String | Yes | Deployment environment: `development`, `staging`, `production` |
| `trace_id` | Hex string (32) | Recommended | W3C trace ID for cross-service correlation (HIP-0031) |
| `span_id` | Hex string (16) | Recommended | W3C span ID for request-level correlation |

#### Optional Standard Fields

```json
{
  "org_id": "hanzo",
  "user_id": "usr_abc123",
  "request_id": "req_7f8a9b0c1d2e",
  "http.method": "POST",
  "http.path": "/v1/chat/completions",
  "http.status": 200,
  "latency_ms": 1250,
  "error.type": "InsufficientCredits",
  "error.message": "organization hanzo has 0 credits remaining",
  "error.stack": "..."
}
```

Services MAY include additional fields as flat key-value pairs. Nested objects
are discouraged -- they increase ClickHouse storage overhead and complicate
queries. Use dot-delimited keys for namespacing (e.g., `http.method` not
`http: { method: ... }`).

#### Log Levels

| Level | When to Use | Indexed | Sampled |
|-------|-------------|---------|---------|
| `fatal` | Process is terminating | Always | Never |
| `error` | Operation failed, requires attention | Always | Never |
| `warn` | Degraded operation, not yet failing | Always | Never |
| `info` | Normal operation milestones | Always | Yes, at high volume |
| `debug` | Detailed diagnostic information | Always | Yes, aggressive |
| `trace` | Extremely verbose, per-step details | Conditional | Always |

In production, services SHOULD default to `info` level. `debug` and `trace`
levels can be enabled per-service via environment variable
(`LOG_LEVEL=debug`) without redeployment, using Kubernetes ConfigMap patches.

### AI-Specific Log Enrichment

LLM workloads generate log data with domain-specific fields that standard
logging frameworks do not capture. Vector transforms enrich logs from the
LLM Gateway (HIP-0004) and Agent SDK (HIP-0009) with the following fields:

#### LLM Request/Response Fields

```json
{
  "ts": "2026-02-23T14:30:01.500Z",
  "level": "info",
  "msg": "llm request completed",
  "service": "llm-gateway",
  "trace_id": "abc123...",
  "llm.provider": "together",
  "llm.model": "zen-72b",
  "llm.tokens.prompt": 1500,
  "llm.tokens.completion": 380,
  "llm.tokens.total": 1880,
  "llm.cost_usd": 0.0094,
  "llm.cache_hit": false,
  "llm.ttft_ms": 320,
  "llm.stream": true,
  "llm.finish_reason": "stop",
  "org_id": "hanzo",
  "api_key_prefix": "sk-...7f8a"
}
```

#### Cost Attribution

Vector computes `llm.cost_usd` from token counts and a pricing table
maintained in Vector's configuration. This ensures cost attribution is
calculated at ingestion time, not query time, and remains consistent even
if pricing changes retroactively.

```yaml
# vector.toml (excerpt)
[transforms.cost_attribution]
type = "remap"
inputs = ["llm_logs"]
source = '''
  pricing = {
    "zen-7b":   {"prompt": 0.0000002, "completion": 0.0000002},
    "zen-72b":  {"prompt": 0.000005,  "completion": 0.000005},
    "zen-480b": {"prompt": 0.00003,   "completion": 0.00006},
  }
  model = .llm.model ?? "unknown"
  if exists(pricing, model) {
    prompt_cost = to_float!(.llm.tokens.prompt) * pricing[model].prompt
    completion_cost = to_float!(.llm.tokens.completion) * pricing[model].completion
    .llm.cost_usd = prompt_cost + completion_cost
  }
'''
```

#### Request/Response Correlation

Every LLM request generates two log entries: one at request start, one at
completion. Vector correlates these using the `trace_id` field, computing
derived fields like end-to-end latency and time-to-first-token (TTFT) that
appear only in the completion log.

### ClickHouse Log Schema

Logs are stored in a dedicated `hanzo_logs` database on the shared ClickHouse
cluster (HIP-0047). The schema is optimized for log-specific access patterns:
time-range queries, service filtering, level filtering, and full-text search.

```sql
CREATE DATABASE IF NOT EXISTS hanzo_logs ON CLUSTER '{cluster}';

CREATE TABLE hanzo_logs.logs ON CLUSTER '{cluster}'
(
    -- Temporal
    ts              DateTime64(3, 'UTC'),

    -- Identity
    service         LowCardinality(String),
    version         LowCardinality(String),
    env             LowCardinality(String),
    host            LowCardinality(String),
    pod             String,

    -- Log content
    level           Enum8(
                        'trace' = 0, 'debug' = 1, 'info' = 2,
                        'warn' = 3, 'error' = 4, 'fatal' = 5
                    ),
    msg             String,

    -- Correlation
    trace_id        FixedString(32) DEFAULT '',
    span_id         FixedString(16) DEFAULT '',
    request_id      String DEFAULT '',
    org_id          LowCardinality(String) DEFAULT '',
    user_id         String DEFAULT '',

    -- HTTP context
    http_method     LowCardinality(String) DEFAULT '',
    http_path       String DEFAULT '',
    http_status     UInt16 DEFAULT 0,
    latency_ms      UInt32 DEFAULT 0,

    -- Error context
    error_type      LowCardinality(String) DEFAULT '',
    error_message   String DEFAULT '',

    -- LLM-specific (HIP-0004 enrichment)
    llm_provider    LowCardinality(String) DEFAULT '',
    llm_model       LowCardinality(String) DEFAULT '',
    llm_tokens_prompt     UInt32 DEFAULT 0,
    llm_tokens_completion UInt32 DEFAULT 0,
    llm_cost_usd    Decimal64(8) DEFAULT 0,
    llm_cache_hit   Bool DEFAULT false,
    llm_ttft_ms     UInt32 DEFAULT 0,

    -- Overflow (fields not in fixed schema)
    attributes      Map(String, String) DEFAULT map(),

    -- Ingestion metadata
    _inserted_at    DateTime64(3) DEFAULT now64(3),

    -- Full-text search index
    INDEX idx_msg msg TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 4,
    INDEX idx_error error_message TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 4
)
ENGINE = ReplicatedMergeTree(
    '/clickhouse/tables/{shard}/hanzo_logs/logs',
    '{replica}'
)
PARTITION BY toYYYYMMDD(ts)
ORDER BY (service, level, ts)
TTL ts + INTERVAL 90 DAY DELETE
SETTINGS
    index_granularity = 8192,
    min_bytes_for_wide_part = 0;
```

**Schema design decisions**:

- **PARTITION BY day** (not month as in HIP-0047 events). Logs have 10-100x
  higher write volume than analytics events. Daily partitions enable faster
  TTL enforcement and partition dropping. At 90-day retention, this creates
  90 active partitions -- manageable for MergeTree.

- **ORDER BY (service, level, ts)**. The most common query pattern is
  "show me error logs from llm-gateway in the last hour." This ordering
  puts service first (prunes all non-matching services), then level (prunes
  info/debug when searching errors), then timestamp (range scan within the
  remaining data).

- **Enum8 for level**. Log levels are a fixed set of 6 values. Enum8 stores
  each as a single byte and enables integer comparison (`level >= 4` for
  error and above) instead of string comparison.

- **tokenbf_v1 full-text index**. This is a tokenized Bloom filter index.
  It splits the `msg` and `error_message` columns into tokens (words) and
  stores a Bloom filter per granule. The Bloom filter answers "does this
  granule possibly contain the token 'InsufficientCredits'?" with false
  positives but no false negatives. This enables full-text search queries
  (`WHERE msg LIKE '%InsufficientCredits%'`) to skip 90-99% of granules,
  reducing scan volume by orders of magnitude.

- **Map(String, String) for overflow**. Fields not in the fixed schema are
  stored in a schemaless map. This prevents schema sprawl while preserving
  all log data. Queries on map keys are slower than fixed columns, so
  frequently queried fields should be promoted to dedicated columns.

### Audit Log Table

Security-sensitive events require immutable storage with extended retention.
The audit log table is separate from the general log table with stricter
guarantees.

```sql
CREATE TABLE hanzo_logs.audit ON CLUSTER '{cluster}'
(
    ts              DateTime64(3, 'UTC'),
    event_type      LowCardinality(String),
    actor_id        String,
    actor_email     String,
    actor_ip        String,
    org_id          LowCardinality(String),
    resource_type   LowCardinality(String),
    resource_id     String,
    action          LowCardinality(String),
    result          LowCardinality(String),
    details         String DEFAULT '{}',
    trace_id        FixedString(32) DEFAULT '',

    _inserted_at    DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplicatedMergeTree(
    '/clickhouse/tables/{shard}/hanzo_logs/audit',
    '{replica}'
)
PARTITION BY toYYYYMM(ts)
ORDER BY (org_id, event_type, ts)
TTL ts + INTERVAL 730 DAY DELETE
SETTINGS index_granularity = 8192;
```

Audit logs have a 2-year retention (730 days) and are partitioned monthly
(lower write volume than operational logs). The table uses `ReplicatedMergeTree`
with no `DELETE` or `UPDATE` support -- ClickHouse MergeTree tables are
append-only by design, satisfying the immutability requirement without
additional application logic.

Audit events include: login/logout, permission changes, API key creation
and revocation, organization membership changes, billing transactions,
and data export requests.

### Vector Collection Pipeline

Vector runs as a Kubernetes DaemonSet, collecting logs from all containers
on each node via the Kubernetes log files at
`/var/log/containers/*.log`.

#### DaemonSet Configuration

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: vector
  namespace: hanzo-logs
spec:
  selector:
    matchLabels:
      app: vector
  template:
    metadata:
      labels:
        app: vector
    spec:
      serviceAccountName: vector
      containers:
      - name: vector
        image: timberio/vector:0.42.0-alpine
        args: ["--config-dir", "/etc/vector"]
        resources:
          requests:
            memory: 64Mi
            cpu: 50m
          limits:
            memory: 256Mi
            cpu: 500m
        volumeMounts:
        - name: config
          mountPath: /etc/vector
        - name: var-log
          mountPath: /var/log
          readOnly: true
        - name: data
          mountPath: /var/lib/vector
      volumes:
      - name: config
        configMap:
          name: vector-config
      - name: var-log
        hostPath:
          path: /var/log
      - name: data
        hostPath:
          path: /var/lib/vector
```

#### Vector Pipeline Configuration

```toml
# /etc/vector/vector.toml

# Source: Kubernetes container logs
[sources.kubernetes]
type = "kubernetes_logs"
auto_partial_merge = true
pod_annotation_fields.pod_labels = "pod_labels"

# Transform: Parse JSON from stdout
[transforms.parse_json]
type = "remap"
inputs = ["kubernetes"]
source = '''
  structured, err = parse_json(.message)
  if err == null {
    . = merge(., structured)
    del(.message)
  } else {
    # Non-JSON logs: wrap in standard envelope
    .msg = .message
    .level = "info"
    del(.message)
  }

  # Ensure required fields
  .service = .service ?? .kubernetes.pod_labels."app.kubernetes.io/name" ?? "unknown"
  .env = .env ?? "production"
  .host = .kubernetes.pod_node_name ?? ""
  .pod = .kubernetes.pod_name ?? ""
  .ts = .ts ?? now()
'''

# Transform: PII redaction
[transforms.redact_pii]
type = "remap"
inputs = ["parse_json"]
source = '''
  # Redact email addresses in msg and error_message
  if exists(.msg) {
    .msg = replace(.msg, r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', "[REDACTED_EMAIL]")
  }
  if exists(.error_message) {
    .error_message = replace(.error_message, r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', "[REDACTED_EMAIL]")
  }

  # Mask API keys (keep prefix + last 4 chars)
  if exists(.msg) {
    .msg = replace(.msg, r'(sk-|ha_|hax_)[a-zA-Z0-9]{8,}', "$1...XXXX")
  }

  # Zero last octet of IP addresses
  if exists(.actor_ip) {
    .actor_ip = replace(.actor_ip, r'(\d+\.\d+\.\d+)\.\d+', "$1.0")
  }
'''

# Transform: AI-specific enrichment
[transforms.llm_enrich]
type = "remap"
inputs = ["redact_pii"]
source = '''
  # Flatten dot-notation LLM fields for ClickHouse columns
  if exists(.llm) {
    .llm_provider = .llm.provider ?? ""
    .llm_model = .llm.model ?? ""
    .llm_tokens_prompt = to_int(.llm.tokens.prompt) ?? 0
    .llm_tokens_completion = to_int(.llm.tokens.completion) ?? 0
    .llm_cost_usd = to_float(.llm.cost_usd) ?? 0.0
    .llm_cache_hit = .llm.cache_hit ?? false
    .llm_ttft_ms = to_int(.llm.ttft_ms) ?? 0
    del(.llm)
  }
'''

# Transform: Sampling for high-volume debug logs
[transforms.sample]
type = "filter"
inputs = ["llm_enrich"]
condition = '''
  level = to_string(.level) ?? "info"
  if level == "debug" {
    # Sample 10% of debug logs in production
    .env != "production" || to_int(now()) % 10 == 0
  } else if level == "trace" {
    # Sample 1% of trace logs in production
    .env != "production" || to_int(now()) % 100 == 0
  } else {
    true
  }
'''

# Sink: ClickHouse for operational logs
[sinks.clickhouse_logs]
type = "clickhouse"
inputs = ["sample"]
endpoint = "http://clickhouse.hanzo.svc:8123"
database = "hanzo_logs"
table = "logs"
auth.strategy = "basic"
auth.user = "hanzo"
auth.password = "${CLICKHOUSE_PASSWORD}"
batch.max_events = 10000
batch.timeout_secs = 5
buffer.type = "disk"
buffer.max_size = 1073741824  # 1 GB disk buffer
encoding.timestamp_format = "rfc3339"

# Sink: ClickHouse for audit logs (separate routing)
[sinks.clickhouse_audit]
type = "clickhouse"
inputs = ["audit_filter"]
endpoint = "http://clickhouse.hanzo.svc:8123"
database = "hanzo_logs"
table = "audit"
auth.strategy = "basic"
auth.user = "hanzo"
auth.password = "${CLICKHOUSE_PASSWORD}"
batch.max_events = 1000
batch.timeout_secs = 2
buffer.type = "disk"
buffer.max_size = 268435456  # 256 MB disk buffer

# Route audit events to separate table
[transforms.audit_filter]
type = "filter"
inputs = ["redact_pii"]
condition = '''
  includes(["auth.login", "auth.logout", "permission.change",
            "apikey.create", "apikey.revoke", "org.member.add",
            "org.member.remove", "billing.transaction",
            "data.export"], to_string(.event_type) ?? "")
'''
```

### Retention Policies

Different log types have different retention requirements based on value
over time and compliance obligations.

| Log Type | Retention | Rationale |
|----------|-----------|-----------|
| Operational (info+) | 90 days | Covers most incident investigation windows |
| Debug | 7 days | High volume, low long-term value |
| Trace | 3 days | Extremely high volume, ephemeral debugging only |
| Audit | 730 days (2 years) | SOC 2 compliance, enterprise contract requirement |
| LLM request logs | 180 days | Cost attribution and model performance analysis |
| Error logs | 180 days | Extended retention for regression analysis |

Retention is enforced at the ClickHouse level via TTL clauses (see schema
above). Vector's sampling transform reduces volume for debug/trace levels
before they reach ClickHouse, preventing storage waste.

#### Sampling Strategy for High-Volume AI Traffic

At peak load, the LLM Gateway generates 10,000+ log lines per second. Most
of these are `info`-level request completion logs with similar structure.
Sampling reduces storage while preserving signal:

| Level | Production Sample Rate | Dev/Staging Rate |
|-------|----------------------|------------------|
| `fatal` / `error` | 100% (never sampled) | 100% |
| `warn` | 100% | 100% |
| `info` | 100% | 100% |
| `debug` | 10% | 100% |
| `trace` | 1% | 100% |

Error and warning logs are never sampled. These are the signals that
matter most for incident detection and are the lowest volume categories
by definition (if errors are the majority of logs, there is a bigger
problem).

### Log Search API

The search API provides a REST interface for querying logs. It runs as a
stateless Go service that translates search requests into ClickHouse SQL
and returns results.

**Port**: 8064

#### Endpoints

```
GET  /api/v1/logs/search       Search logs with filters
GET  /api/v1/logs/tail          Live tail (WebSocket upgrade)
GET  /api/v1/logs/stats         Aggregated statistics
GET  /api/v1/logs/context       Surrounding log lines for a given log entry
GET  /api/v1/audit/search       Search audit logs (requires admin role)
GET  /health                    Health check
```

#### Search Request

```http
GET /api/v1/logs/search?service=llm-gateway&level=error&from=2026-02-23T00:00:00Z&to=2026-02-23T23:59:59Z&q=InsufficientCredits&limit=100 HTTP/1.1
Host: logs.hanzo.ai:8064
Authorization: Bearer <IAM token>
```

This translates to:

```sql
SELECT ts, level, service, msg, trace_id, org_id,
       llm_model, llm_cost_usd, error_type, error_message
FROM hanzo_logs.logs
WHERE service = 'llm-gateway'
  AND level >= 4               -- error and above
  AND ts >= '2026-02-23 00:00:00'
  AND ts <= '2026-02-23 23:59:59'
  AND msg LIKE '%InsufficientCredits%'
ORDER BY ts DESC
LIMIT 100
```

The `tokenbf_v1` index on `msg` ensures the `LIKE '%InsufficientCredits%'`
clause skips granules that definitely do not contain the token, reducing
the scan from potentially millions of rows to thousands.

#### Live Tail

The `/api/v1/logs/tail` endpoint upgrades to a WebSocket connection and
streams new log entries matching the filter criteria in real time. The
implementation polls ClickHouse every 1 second with an incrementing
timestamp cursor. This is not true streaming (ClickHouse does not support
push notifications), but the 1-second polling interval is acceptable for
interactive debugging.

### AI-Powered Anomaly Detection

Hanzo Logs includes a lightweight anomaly detection system that identifies
unusual patterns in log data without manual threshold configuration.

#### Detection Methods

1. **Error rate spike detection.** A sliding-window comparison of the
   current error rate against the historical baseline (same hour of day,
   same day of week, over the past 4 weeks). An error rate exceeding 3
   standard deviations above the baseline triggers an alert.

   ```sql
   -- Hourly error rate baseline
   SELECT
       service,
       toHour(ts) AS hour,
       toDayOfWeek(ts) AS dow,
       count() AS error_count,
       avg(error_count) OVER (
           PARTITION BY service, hour, dow
           ORDER BY toDate(ts)
           ROWS BETWEEN 28 PRECEDING AND 1 PRECEDING
       ) AS baseline_avg,
       stddevPop(error_count) OVER (
           PARTITION BY service, hour, dow
           ORDER BY toDate(ts)
           ROWS BETWEEN 28 PRECEDING AND 1 PRECEDING
       ) AS baseline_stddev
   FROM hanzo_logs.logs
   WHERE level >= 4
   GROUP BY service, toDate(ts), hour, dow
   ```

2. **Novel error pattern detection.** New error messages that have not
   appeared in the past 7 days are flagged as "novel." This uses
   ClickHouse's `uniqExact` function to compare today's distinct error
   messages against the historical set.

3. **LLM cost anomaly detection.** Per-organization cost in the current
   hour compared against the rolling 7-day hourly average. A 5x spike
   triggers an alert. This catches runaway agent loops, prompt injection
   attacks that inflate token usage, or misconfigured retry logic.

Anomaly detection queries run as scheduled ClickHouse materialized views
that update every 5 minutes. Alerts are routed to the alerting pipeline
defined in HIP-0031 (Prometheus Alertmanager -> Slack/PagerDuty).

### Integration with Observability (HIP-0031)

Logs, metrics, and traces form the three pillars of observability. The
`trace_id` field is the correlation key that links them.

```
┌─────────────────────────────────────────────────────────────┐
│                     Grafana Dashboards                       │
├──────────────┬──────────────────┬────────────────────────────┤
│  Metrics     │  Traces          │  Logs                      │
│  (HIP-0031)  │  (HIP-0031)      │  (HIP-0064)                │
│  Prometheus  │  OTLP/ClickHouse │  ClickHouse                │
├──────────────┴──────────────────┴────────────────────────────┤
│         Correlation key: trace_id (W3C traceparent)          │
└──────────────────────────────────────────────────────────────┘
```

An engineer investigating a slow LLM request can:

1. See the latency spike in a **Prometheus metric** (HIP-0031)
2. Click the time range to open **traces**, identifying the slow span
3. Click the trace ID to see **logs** for that specific request
4. All three views share the same `trace_id`, providing seamless
   drill-down from metric anomaly to root cause

Grafana's ClickHouse data source plugin enables log panels alongside
metric panels in the same dashboard, querying the `hanzo_logs.logs`
table directly.

### Integration with Analytics Datastore (HIP-0047)

Logs and analytics events live in the same ClickHouse cluster but in
different databases: `hanzo_logs` (this HIP) and `default` (HIP-0047).
This enables cross-database queries for advanced analysis:

```sql
-- Correlate LLM errors with product analytics impact
SELECT
    l.llm_model,
    count(DISTINCT l.org_id) AS affected_orgs,
    count() AS error_count,
    a.unique_users AS active_users_during_outage
FROM hanzo_logs.logs l
JOIN (
    SELECT uniqExact(distinct_id) AS unique_users
    FROM default.events
    WHERE event = 'llm_request'
      AND timestamp >= '2026-02-23T14:00:00Z'
      AND timestamp <= '2026-02-23T15:00:00Z'
) a ON 1=1
WHERE l.level >= 4
  AND l.service = 'llm-gateway'
  AND l.ts >= '2026-02-23T14:00:00Z'
  AND l.ts <= '2026-02-23T15:00:00Z'
GROUP BY l.llm_model, a.unique_users
ORDER BY error_count DESC
```

This query is possible only because both datasets live in the same
ClickHouse cluster. With separate systems (e.g., Loki for logs,
ClickHouse for analytics), this correlation would require exporting
data from both systems and joining externally.

### PII Redaction

PII redaction is enforced at two layers:

1. **Vector transforms** (before storage). Email addresses, API keys, and
   IP address last octets are redacted in the Vector pipeline. This ensures
   PII never reaches ClickHouse.

2. **Application-level logging guidelines**. Services MUST NOT log:
   - Raw user passwords or authentication tokens
   - Full credit card numbers or banking details
   - LLM prompt/completion content (only token counts and metadata)
   - Personal health or financial information

   Services MAY log:
   - Hashed or truncated user identifiers
   - Organization IDs (not PII)
   - API key prefixes (first 3 + last 4 characters)
   - Geolocation at city/region granularity (not exact coordinates)

### Deployment

#### Port Allocation

| Port | Service | Protocol |
|------|---------|----------|
| 8064 | Log Search API | HTTP/REST |
| 8065 | Log Search API (internal/health) | HTTP |

#### Kubernetes Manifests

The Hanzo Logs deployment consists of three components:

1. **Vector DaemonSet** (hanzo-logs namespace): Log collection on every node
2. **Search API Deployment** (hanzo-logs namespace): Stateless query service
3. **ClickHouse tables** (existing cluster per HIP-0047): Storage

No additional ClickHouse infrastructure is required. The `hanzo_logs`
database is created on the existing cluster. Vector and the Search API
are the only new deployments.

#### Resource Sizing

| Component | CPU Request | Memory Request | Memory Limit |
|-----------|------------|----------------|--------------|
| Vector (per node) | 50m | 64 Mi | 256 Mi |
| Search API | 100m | 128 Mi | 512 Mi |
| ClickHouse (incremental) | +1 core | +4 Gi | +8 Gi |

The ClickHouse resource overhead is incremental -- the `hanzo_logs` tables
share the existing ClickHouse cluster with analytics (HIP-0047). At
100 GB/day raw log volume with 15x compression, logs add approximately
6-7 GB/day to ClickHouse storage.

## Security

### Access Control

The Log Search API authenticates via Hanzo IAM (HIP-0026) bearer tokens.
Access levels:

| Role | Operational Logs | Audit Logs | Admin |
|------|-----------------|------------|-------|
| Developer | Read (own org) | No | No |
| SRE / Platform | Read (all orgs) | Read | No |
| Security / Compliance | Read (all orgs) | Read + Export | No |
| Admin | Read (all orgs) | Read + Export | Yes |

Audit log access is restricted to Security and Admin roles. All access
to audit logs is itself logged (meta-auditing).

### Network Security

Vector communicates only with ClickHouse (port 8123/9000) within the
cluster network. The Search API communicates with ClickHouse and IAM.
No log data leaves the Kubernetes cluster network.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: vector-egress
  namespace: hanzo-logs
spec:
  podSelector:
    matchLabels:
      app: vector
  egress:
  - to:
    - namespaceSelector:
        matchLabels:
          name: hanzo
      podSelector:
        matchLabels:
          app: clickhouse
    ports:
    - port: 8123
    - port: 9000
  policyTypes:
  - Egress
```

### Audit Log Immutability

ClickHouse MergeTree tables are append-only. There is no `UPDATE` or
`DELETE` statement in standard ClickHouse SQL. The `ALTER TABLE DELETE`
mutation exists but requires the `ALTER DELETE` privilege, which is not
granted to the `hanzo` application user. Only the `admin` ClickHouse
user (used exclusively by infrastructure automation) can execute
mutations, and all mutations are logged in `system.mutations`.

This provides defense-in-depth immutability: the application cannot
modify or delete audit records, and any infrastructure-level mutation
leaves a permanent trace in ClickHouse system tables.

## Backward Compatibility

Services currently emitting unstructured text logs to stdout continue to
work. Vector's `parse_json` transform falls back to wrapping non-JSON
output in the standard envelope with `level: "info"` and the raw text as
`msg`. These logs are searchable but lack structured fields.

Services SHOULD migrate to structured JSON logging over time. The
migration path is:

1. Add a structured logging library (zerolog for Go, structlog for Python,
   pino for Node.js)
2. Configure the library to output JSON to stdout
3. Include the required fields (`ts`, `level`, `msg`, `service`, `version`,
   `env`)
4. Add `trace_id` and `span_id` from the request context (HIP-0031)
5. No changes to deployment, Vector, or ClickHouse are needed

## References

1. [HIP-0031: Observability & Metrics Standard](./hip-0031-observability-metrics-standard.md) -- Metrics, traces, and Zap sidecar
2. [HIP-0047: Analytics Datastore Standard](./hip-0047-analytics-datastore-standard.md) -- ClickHouse cluster and schema conventions
3. [HIP-0017: Analytics Event Standard](./hip-0017-analytics-event-standard.md) -- Product analytics events (Insights)
4. [HIP-0004: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md) -- LLM request logging source
5. [HIP-0026: Identity Access Management](./hip-0026-identity-access-management-standard.md) -- Authentication for Search API
6. [Vector Documentation](https://vector.dev/docs/) -- Collection agent
7. [ClickHouse Full-Text Search](https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/mergetree#table_engine-mergetree-data_skipping-indexes) -- tokenbf_v1 index
8. [W3C Trace Context](https://www.w3.org/TR/trace-context/) -- Cross-service correlation standard

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
