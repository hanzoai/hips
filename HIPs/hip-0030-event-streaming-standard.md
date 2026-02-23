---
hip: 0030
title: Event Streaming Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2025-01-15
requires: HIP-0028
---

# HIP-30: Event Streaming Standard

## Abstract

This proposal defines the event streaming standard for the Hanzo ecosystem. Hanzo Stream provides distributed event streaming based on Apache Kafka, serving as the backbone for real-time event ingestion, analytics pipelines, inter-service communication, and billing aggregation. All services producing or consuming asynchronous events MUST use Hanzo Stream as specified in this document.

**Repository**: [github.com/hanzoai/stream](https://github.com/hanzoai/stream)
**Protocol**: Kafka wire protocol (TCP 9092, TLS 9093)
**Production**: `insights-kafka` on `hanzo-k8s` cluster (`24.199.76.156`)

## Motivation

The Hanzo platform generates millions of events per day across multiple services:

1. **Insights** (PostHog fork) captures frontend/backend analytics events
2. **LLM Gateway** (HIP-4) produces usage and billing events per API call
3. **IAM** (hanzo.id) emits audit log events for authentication and authorization
4. **Commerce** tracks payment and transaction events
5. **Bot agents** (HIP-25) generate RPC billing and metering events

Without a unified streaming layer, each service would either:
- Poll databases (wasteful, high latency)
- Use point-to-point HTTP webhooks (fragile, no replay, no fan-out)
- Implement its own queue (operational burden, inconsistent guarantees)

We need ONE streaming backbone that gives us durable replay, ordered delivery, parallel consumption, and schema evolution.

## Design Philosophy

This section explains the architectural decisions behind Hanzo Stream. Understanding the *why* is essential for making correct integration choices.

### Why Kafka Over NATS / RabbitMQ / Pulsar

The core question is: **what happens when you need to reprocess events?**

**Kafka** uses a log-based architecture. Events are appended to an immutable, ordered log. Consumers track their position (offset) in the log. The log is retained for a configurable period regardless of whether consumers have read it. This gives us:

- **Replay capability**: Reset a consumer group's offset to reprocess historical events. This is critical for Insights, where schema changes or analytics bugs require reprocessing days of events.
- **Multiple independent consumers**: The billing aggregator and the analytics pipeline both read from `llm_usage` independently, at their own pace, without interfering with each other.
- **Ordering guarantees**: Events within a partition are strictly ordered. We partition by `team_id` so all events for a given team arrive in order.

**NATS** (including JetStream) is simpler and lower-latency for pub/sub, but its replay semantics are weaker. Better fit for request-reply where replay is not needed.

**RabbitMQ** is message-oriented, not log-oriented. Once acknowledged, messages are deleted. No concept of "replay the last 7 days." Excels at task queues, not our primary use case.

**Apache Pulsar** is architecturally comparable (log-based, tiered storage), but has a smaller ecosystem and fewer battle-tested client libraries. Kafka's tooling (Connect, Schema Registry, Streams) gives us more out of the box.

**Decision**: Kafka. Log-based replay is non-negotiable for analytics reprocessing.

### Why Self-Hosted Over Confluent Cloud

**Cost at scale.** Confluent Cloud charges per GB of throughput and per partition-hour. Our analytics pipeline processes multiple GB/hour of events. At our current volume, self-hosted Kafka on Kubernetes costs roughly 3-5x less than Confluent Cloud.

**Data locality.** Our ClickHouse instance runs on the same Kubernetes cluster. Keeping Kafka co-located eliminates cross-network transfer costs and latency. Events flow from Kafka to ClickHouse over the cluster network, not over the public internet.

**Operational simplicity with KRaft.** The traditional objection to self-hosted Kafka was ZooKeeper complexity. KRaft eliminates that objection entirely (see below).

**Trade-off acknowledged**: We accept the operational responsibility of managing Kafka ourselves. This is manageable because KRaft mode reduces Kafka to a single StatefulSet with no external dependencies.

### Why KRaft Over ZooKeeper

**KRaft** (Kafka Raft) is Kafka's built-in consensus protocol, available since Kafka 3.3 and production-ready since Kafka 3.6. It replaces ZooKeeper for metadata management (broker registration, topic configuration, partition leadership).

**Before KRaft**, running Kafka meant running two distributed systems: Kafka + ZooKeeper. ZooKeeper was a separate failure domain (session timeouts, snapshot corruption). Most Kafka outages trace back to ZooKeeper.

**With KRaft**, Kafka manages its own metadata. Single StatefulSet, no external dependencies. ZooKeeper is deprecated and will be removed in Kafka 4.0.

### How Stream Connects to the Data Pipeline

The following diagram shows how Hanzo Stream fits into the broader data flow:

```
                                        ┌──────────────────┐
                                        │   ClickHouse     │
                                        │  (Analytics DB)  │
                                        └────────▲─────────┘
                                                 │ consume
                                                 │
┌─────────────┐    ┌──────────────┐    ┌─────────┴─────────┐    ┌──────────────┐
│  Insights   │───→│              │───→│  Consumer Groups   │    │   Billing    │
│  Capture    │    │              │    │                    │    │  Aggregator  │
│  (Rust)     │    │  Hanzo       │    │  analytics-ingest  │    └──────▲───────┘
└─────────────┘    │  Stream      │    │  billing-agg       │           │
                   │  (Kafka)     │    │  audit-archive     │           │ consume
┌─────────────┐    │              │    │  llm-metrics       │    ┌──────┴───────┐
│ LLM Gateway │───→│  Topics:     │    └───────────────────┘    │  Consumer    │
│  (HIP-4)    │    │   events_*   │                              │  Group:      │
└─────────────┘    │   llm_usage  │                              │  billing-agg │
                   │   billing_*  │                              └──────────────┘
┌─────────────┐    │   audit_log  │
│    IAM      │───→│              │
│ (hanzo.id)  │    └──────────────┘
└─────────────┘
```

**Data flow summary**:
1. Producers (Insights capture, LLM Gateway, IAM) write events to Kafka topics
2. Kafka retains events in the log for the configured retention period
3. Consumer groups read events independently and at their own pace
4. ClickHouse ingestion consumer writes analytics events to ClickHouse tables
5. Billing aggregator consumes `llm_usage` events and produces `billing_events`
6. Audit archiver consumes `audit_log` and writes to long-term storage

## Specification

### Topic Registry

All Kafka topics MUST be registered in this section. Ad-hoc topic creation is prohibited in production.

| Topic | Partitions | Retention | Key | Producers | Consumers |
|-------|-----------|-----------|-----|-----------|-----------|
| `events_plugin_ingestion` | 16 | 7 days | `team_id` | Insights Capture | ClickHouse Ingestion |
| `llm_usage` | 8 | 14 days | `team_id` | LLM Gateway | Billing Aggregator, Analytics |
| `billing_events` | 4 | 30 days | `org_id` | Billing Aggregator | Commerce, Reporting |
| `audit_log` | 4 | 90 days | `org_id` | IAM, all services | Audit Archiver, Compliance |
| `agent_rpc_metering` | 8 | 7 days | `agent_id` | Bot Gateway | RPC Billing (HIP-25) |
| `dead_letter` | 1 | 30 days | `source_topic` | All consumers | Ops team (manual) |

### Topic Naming Convention

```
<domain>_<entity>_<action>
```

Examples: `events_plugin_ingestion`, `llm_usage`, `billing_events`, `audit_log`.

Topics MUST use snake_case. Topics MUST NOT include environment prefixes (e.g., `prod_` or `stg_`). Environment isolation is achieved through separate Kafka clusters, not topic naming.

### Partitioning Strategy

Partitioning determines parallelism and ordering. The key design principle: **events that must be processed in order MUST share a partition key.**

| Topic | Partition Key | Rationale |
|-------|--------------|-----------|
| `events_plugin_ingestion` | `team_id` | All events for a team arrive in order; ClickHouse ingests per-team batches |
| `llm_usage` | `team_id` | Billing must see all usage for a team in order to compute running totals |
| `billing_events` | `org_id` | Organization-level billing aggregation |
| `audit_log` | `org_id` | Audit trail must be ordered per organization |
| `agent_rpc_metering` | `agent_id` | Per-agent metering must be ordered for accurate tallying |

**Partition count guidelines**:
- Start with `max(expected_consumer_count * 2, 4)`
- Never reduce partition count (Kafka does not support this)
- Increase partitions only when consumer lag consistently exceeds SLA

### Event Schema

All events MUST conform to a base envelope. The envelope wraps topic-specific payloads.

#### Base Envelope

```json
{
  "schema": "hanzo.stream.v1",
  "id": "evt_01HQ3X7K8M2N4P5R6S7T8U9V0W",
  "type": "llm.usage.completed",
  "source": "llm-gateway",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "team_id": "team_abc123",
  "org_id": "org_hanzo",
  "data": { }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schema` | string | yes | Envelope version. Always `hanzo.stream.v1` for this spec. |
| `id` | string | yes | Globally unique event ID. ULID or UUID v7 recommended. |
| `type` | string | yes | Dot-delimited event type (e.g., `llm.usage.completed`). |
| `source` | string | yes | Producing service identifier. |
| `timestamp` | string | yes | ISO 8601 UTC timestamp with millisecond precision. |
| `team_id` | string | no | Team identifier (used as partition key for most topics). |
| `org_id` | string | no | Organization identifier. |
| `data` | object | yes | Topic-specific payload. Schema defined per event type. |

#### LLM Usage Event (`llm_usage`)

```json
{
  "schema": "hanzo.stream.v1",
  "id": "evt_01HQ3X7K8M2N4P5R6S7T8U9V0W",
  "type": "llm.usage.completed",
  "source": "llm-gateway",
  "timestamp": "2025-01-15T10:30:00.123Z",
  "team_id": "team_abc123",
  "org_id": "org_hanzo",
  "data": {
    "request_id": "req_xyz789",
    "model": "zen-72b",
    "provider": "together",
    "prompt_tokens": 150,
    "completion_tokens": 230,
    "total_tokens": 380,
    "latency_ms": 1250,
    "cost_usd": 0.0038,
    "user_id": "user_456",
    "api_key_hash": "sha256:abc...",
    "cache_hit": false,
    "stream": true
  }
}
```

#### Insights Plugin Ingestion Event (`events_plugin_ingestion`)

```json
{
  "schema": "hanzo.stream.v1",
  "id": "evt_01HQ4Y8L9N3O5Q6R7S8T9U0V1X",
  "type": "insights.event.captured",
  "source": "insights-capture",
  "timestamp": "2025-01-15T10:31:00.456Z",
  "team_id": "team_abc123",
  "data": {
    "event": "$pageview",
    "distinct_id": "user_456",
    "properties": {
      "$current_url": "https://hanzo.ai/dashboard",
      "$browser": "Chrome",
      "$os": "macOS"
    },
    "ip": "203.0.113.42",
    "session_id": "sess_abc123",
    "sent_at": "2025-01-15T10:30:59.800Z"
  }
}
```

#### Audit Log Event (`audit_log`)

```json
{
  "schema": "hanzo.stream.v1",
  "id": "evt_01HQ5Z9M0O4P6R7S8T9U0V1W2Y",
  "type": "iam.auth.login_success",
  "source": "iam",
  "timestamp": "2025-01-15T10:32:00.789Z",
  "org_id": "org_hanzo",
  "data": {
    "user_id": "user_456",
    "email": "user@hanzo.ai",
    "method": "oauth2",
    "provider": "github",
    "ip": "203.0.113.42",
    "user_agent": "Mozilla/5.0...",
    "application": "app-hanzo"
  }
}
```

### Schema Registry

Event schemas MUST be registered in a schema registry to enable:
- **Schema evolution**: Add fields without breaking consumers
- **Validation**: Reject malformed events at the producer
- **Documentation**: Machine-readable schema catalog

#### Registry Configuration

```yaml
schema_registry:
  type: json-schema       # JSON Schema (not Avro - see rationale below)
  url: http://schema-registry.hanzo.svc:8081
  compatibility: BACKWARD  # New schemas must be readable by old consumers
```

**Why JSON Schema over Avro**: Our producers and consumers span multiple languages (Rust capture service, Python billing, Go IAM, TypeScript gateway). JSON Schema is language-agnostic and requires no code generation. Avro has better compression but adds build-time complexity for schema compilation. At our event sizes (< 2KB average), the compression difference is negligible.

#### Compatibility Rules

- **BACKWARD** compatibility is the default: new schema versions can read data written by the previous version
- Fields MAY be added with defaults
- Fields MUST NOT be removed or renamed (mark as deprecated instead)
- Field types MUST NOT change

### Consumer Groups

Consumer groups enable parallel processing. Each consumer in a group reads from a disjoint set of partitions.

| Consumer Group | Topic(s) | Consumers | Processing |
|---------------|----------|-----------|------------|
| `analytics-ingest` | `events_plugin_ingestion` | 4 | Write to ClickHouse `events` table |
| `billing-agg` | `llm_usage` | 2 | Aggregate usage per team per hour, produce `billing_events` |
| `audit-archive` | `audit_log` | 1 | Write to S3-compatible long-term storage |
| `llm-metrics` | `llm_usage` | 2 | Compute real-time latency/throughput metrics for Prometheus |
| `rpc-billing` | `agent_rpc_metering` | 2 | Aggregate agent RPC usage for settlement (HIP-25) |
| `dead-letter-monitor` | `dead_letter` | 1 | Alert on failed events, PagerDuty integration |

#### Consumer Group Naming Convention

```
<function>-<action>
```

Examples: `analytics-ingest`, `billing-agg`, `audit-archive`. Kebab-case. MUST NOT include service version or instance identifiers.

### Retention Policies

| Category | Retention | Rationale |
|----------|-----------|-----------|
| Analytics events | 7 days | Sufficient for reprocessing; ClickHouse is the durable store |
| LLM usage | 14 days | Billing reconciliation window is 14 days |
| Billing events | 30 days | Monthly billing cycle + buffer |
| Audit log | 90 days | Compliance requirement; also archived to S3 |
| Dead letter | 30 days | Ops investigation window |

Retention is configured per topic via `retention.ms`. After retention expires, segments are deleted. There is no compaction (log compaction is for changelog-style topics, not event streams).

### Producer Configuration

```yaml
producer:
  acks: all                  # Wait for all in-sync replicas (durability)
  retries: 3                 # Retry transient failures
  retry_backoff_ms: 100      # Backoff between retries
  max_in_flight: 5           # Max unacknowledged batches
  compression: lz4           # LZ4 for speed; zstd for better ratio if CPU-bound
  batch_size: 16384          # 16KB batch size
  linger_ms: 5               # Wait up to 5ms to fill batch
  idempotence: true          # Exactly-once per partition (requires acks=all)
```

**Why `acks=all`**: We cannot lose billing or audit events. The latency cost of waiting for replica acknowledgment (typically < 10ms intra-cluster) is acceptable.

**Why LZ4 compression**: LZ4 provides ~2x compression at near-zero CPU cost. For analytics events with repetitive JSON keys, this cuts network and storage usage in half.

### Insights Capture Integration

The Insights Rust capture service is the highest-throughput producer. It receives HTTP POST requests from frontend SDKs and writes batches to Kafka.

```
Browser SDK  ──HTTP POST──→  Capture (Rust)  ──Kafka Produce──→  events_plugin_ingestion
                              Port 3000                            ↓
                              Batch: 500 events                    ClickHouse consumer
                              Flush: 1 second                      ↓
                                                                   events table
```

The capture service MUST:
- Batch events (up to 500 or 1 second, whichever comes first)
- Produce with `acks=all` and idempotence enabled
- Return HTTP 200 immediately after Kafka acknowledgment (not after ClickHouse write)
- Write to `dead_letter` topic on serialization or validation failure

## Implementation

### Production Deployment

Deployed as a Kubernetes StatefulSet on `hanzo-k8s` using `bitnami/kafka:3.7` in KRaft combined mode (broker + controller in one process).

```yaml
# Key configuration (insights-kafka StatefulSet, namespace: hanzo)
image: bitnami/kafka:3.7
replicas: 1                          # Single broker, partition-ready for scale
ports: [9092 (PLAINTEXT), 9093 (TLS), 9094 (CONTROLLER)]
env:
  KAFKA_CFG_PROCESS_ROLES: "broker,controller"
  KAFKA_CFG_NODE_ID: "0"
  KAFKA_CFG_CONTROLLER_QUORUM_VOTERS: "0@insights-kafka-0.insights-kafka.hanzo.svc:9094"
  KAFKA_CFG_LISTENERS: "PLAINTEXT://:9092,CONTROLLER://:9094"
  KAFKA_CFG_LOG_RETENTION_HOURS: "168"          # 7 days default
  KAFKA_CFG_AUTO_CREATE_TOPICS_ENABLE: "false"  # Explicit topic creation only
resources:
  requests: { memory: 1Gi, cpu: 500m }
  limits:   { memory: 2Gi, cpu: 1000m }
storage: 50Gi (do-block-storage PVC)
```

### Topic Provisioning

Topics MUST be created explicitly. Auto-creation is disabled in production.

```bash
BROKER=insights-kafka-0.insights-kafka.hanzo.svc:9092

# Each topic: --partitions N --replication-factor 1 --config retention.ms=MS
kafka-topics.sh --bootstrap-server $BROKER --create \
  --topic events_plugin_ingestion --partitions 16 --config retention.ms=604800000
kafka-topics.sh --bootstrap-server $BROKER --create \
  --topic llm_usage --partitions 8 --config retention.ms=1209600000
kafka-topics.sh --bootstrap-server $BROKER --create \
  --topic billing_events --partitions 4 --config retention.ms=2592000000
kafka-topics.sh --bootstrap-server $BROKER --create \
  --topic audit_log --partitions 4 --config retention.ms=7776000000
kafka-topics.sh --bootstrap-server $BROKER --create \
  --topic agent_rpc_metering --partitions 8 --config retention.ms=604800000
kafka-topics.sh --bootstrap-server $BROKER --create \
  --topic dead_letter --partitions 1 --config retention.ms=2592000000
```

### Scaling Path

The current deployment is a single broker. This is sufficient for our current throughput (< 50 MB/s). The scaling path is:

1. **Single broker** (current): All topics on one node. Replication factor 1. Acceptable for non-critical analytics; billing events are also persisted in PostgreSQL.
2. **Three brokers**: Replication factor 3. Automatic failover. Required when billing events become the sole source of truth.
3. **Multi-rack**: Spread brokers across availability zones. Required for 99.99% uptime SLA.

Scaling from 1 to 3 brokers requires:
- Update StatefulSet `replicas: 3`
- Update `KAFKA_CFG_CONTROLLER_QUORUM_VOTERS` to include all three nodes
- Reassign partitions with `kafka-reassign-partitions.sh`
- Increase replication factor for existing topics

### Monitoring

Prometheus metrics are exposed via JMX Exporter. The critical metrics:

| Metric | Alert Threshold | Meaning |
|--------|----------------|---------|
| `kafka_messages_in_per_sec` | - | Throughput: messages received per second |
| `kafka_bytes_in_per_sec` | - | Throughput: bytes received per second |
| `kafka_under_replicated_partitions` | > 0 for 5m | Partitions without enough replicas |
| `kafka_consumer_group_lag` | > 100K warn, > 1M critical | Events a consumer is behind |

**Consumer lag** is the single most important Kafka metric. It measures how far behind a consumer group is from the latest event. If lag grows continuously, the consumer cannot keep up and events will expire before being processed.

## Security

### Authentication

SASL/PLAIN authentication. Each service gets a dedicated credential with scoped topic access. Passwords are injected from KMS via Kubernetes secrets.

```yaml
sasl:
  mechanism: PLAIN
  credentials:
    - { username: insights-capture,    topics: [events_plugin_ingestion],  ops: [WRITE] }
    - { username: llm-gateway,         topics: [llm_usage],                ops: [WRITE] }
    - { username: iam-service,         topics: [audit_log],                ops: [WRITE] }
    - { username: analytics-ingest,    topics: [events_plugin_ingestion],  ops: [READ]  }
    - { username: billing-aggregator,  topics: [llm_usage, billing_events], ops: [READ, WRITE] }
```

### Access Control Lists (ACLs)

Each producer and consumer MUST have minimal permissions:

| Principal | Topic | Operations | Rationale |
|-----------|-------|------------|-----------|
| `insights-capture` | `events_plugin_ingestion` | WRITE | Capture only produces |
| `llm-gateway` | `llm_usage` | WRITE | Gateway only produces |
| `analytics-ingest` | `events_plugin_ingestion` | READ | ClickHouse consumer |
| `billing-aggregator` | `llm_usage` | READ | Reads usage |
| `billing-aggregator` | `billing_events` | WRITE | Produces billing |
| `audit-archiver` | `audit_log` | READ | Archives to S3 |

**No service gets blanket access to all topics.** The `dead_letter` topic is writable by all authenticated producers (events that fail processing are redirected here).

### Encryption

- **In transit**: TLS 1.3 for all client-to-broker and inter-broker communication on port 9093
- **At rest**: Disk encryption via DigitalOcean block storage encryption (transparent)
- **Secrets**: Kafka credentials stored in KMS (HIP-5) and injected via Kubernetes secrets

### Network Policies

Kafka is accessible only from within the `hanzo` namespace via Kubernetes NetworkPolicy. No external ingress. Services outside the cluster MUST use the LLM Gateway or Insights capture HTTP endpoints, which produce to Kafka internally.

## Operational Runbook

### Consumer Lag Resolution

```bash
# Check lag, then scale or reset offsets
kafka-consumer-groups.sh --bootstrap-server insights-kafka-0:9092 \
  --group analytics-ingest --describe
kubectl scale deployment analytics-ingest --replicas=8    # if lag growing
```

### Disaster Recovery

Single-broker failure causes full outage. Mitigations: persistent volume survives pod restart; producers buffer ~30s in-memory; capture returns HTTP 503 (frontend SDKs retry with backoff); on restart, consumers resume from last committed offset. Multi-broker (Phase 2) with replication factor 3 eliminates single-point failure.

## References

1. [HIP-4: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md)
2. [HIP-17: Analytics Event Standard](./hip-0017-analytics-event-standard.md)
3. [HIP-25: Bot Agent Wallet & RPC Billing Protocol](./hip-0025-bot-agent-wallet-rpc-billing-protocol.md)
4. [HIP-28: Insights Analytics Platform](./hip-0028-insights-analytics-platform.md)
5. [Apache Kafka Documentation](https://kafka.apache.org/documentation/)
6. [KRaft: Apache Kafka Without ZooKeeper](https://cwiki.apache.org/confluence/display/KAFKA/KIP-500)
7. [Kafka on Kubernetes - Strimzi](https://strimzi.io/)
8. [ClickHouse Kafka Engine](https://clickhouse.com/docs/en/engines/table-engines/integrations/kafka)
9. [Hanzo Stream Repository](https://github.com/hanzoai/stream)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
