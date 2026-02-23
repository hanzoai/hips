---
hip: 0055
title: Message Queue Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-02-23
---

# HIP-55: Message Queue Standard

## Abstract

This proposal defines the message queue standard for the Hanzo ecosystem. **Hanzo MQ** provides lightweight, high-performance task distribution based on NATS JetStream, serving as the backbone for asynchronous job processing, AI inference request queuing, batch workload scheduling, and inter-service request-reply communication.

Hanzo MQ is distinct from Hanzo Stream (HIP-0030). Stream is a Kafka-based event log for durable replay and analytics pipelines. MQ is a NATS-based task queue for distributing units of work to consumers. The two systems serve fundamentally different purposes and coexist in production.

**Repository**: [github.com/hanzoai/mq](https://github.com/hanzoai/mq)
**Protocol**: NATS client protocol (TCP 4222, TLS 4223)
**Management API**: Port 8055
**Cluster**: `hanzo-k8s` (`24.199.76.156`)

## Motivation

The Hanzo platform processes millions of asynchronous tasks per day that do not fit the event streaming model:

1. **Inference requests**: When the LLM Gateway (HIP-0004) receives a burst of requests that exceeds downstream provider rate limits, it must queue overflow requests and process them as capacity becomes available. This is a work queue problem, not an event log problem.

2. **Batch processing**: Fine-tuning jobs, embedding generation over large document sets, and bulk image generation are long-running tasks that must be distributed across a pool of GPU workers. Workers pull tasks when idle. The queue must support priority ordering so urgent jobs complete before background jobs.

3. **Scheduled jobs**: Credit balance reconciliation, usage report generation, and model health checks run on fixed schedules. These are delayed tasks that must execute exactly once at their scheduled time.

4. **Request-reply**: Synchronous inference requests from the Cloud API (HIP-0037) to specialized model workers need sub-second request-reply with timeout handling. HTTP is fragile under load; a message-based request-reply pattern provides backpressure and load balancing for free.

5. **Dead letter handling**: When a task fails after all retries, it must be preserved for inspection and manual replay rather than silently dropped.

Without a unified task queue, each service would implement its own queuing mechanism -- Redis lists here, PostgreSQL `SKIP LOCKED` there, in-memory channels elsewhere. This creates operational fragmentation, inconsistent retry policies, and no centralized visibility into queue depth or processing latency.

## Design Philosophy

This section explains why NATS JetStream was chosen over alternatives and how MQ relates to the existing streaming infrastructure.

### Why a Separate System from Kafka (HIP-0030)

This is the most important architectural question, so it deserves a thorough answer.

**Kafka is a log. NATS is a queue.** These are different data structures with different semantics:

A **log** (Kafka) appends events to an immutable, ordered sequence. Multiple consumers read the same log independently, each tracking their own position. Events are retained for a configured period regardless of whether any consumer has read them. The primary value proposition is replay: you can rewind a consumer and reprocess historical events. This is why HIP-0030 chose Kafka for analytics ingestion, billing aggregation, and audit trails.

A **queue** (NATS JetStream) delivers each message to exactly one consumer in a group. Once acknowledged, the message is removed from the queue. There is no concept of "replaying the last 7 days of tasks" because tasks are ephemeral work items, not historical records. The primary value proposition is load distribution: N workers pull from one queue, and the queue balances work across them automatically.

Using Kafka as a task queue is possible (consumer groups with auto-commit), but it introduces problems:

- **Partition coupling**: Kafka parallelism is bound by partition count. If you have 8 partitions, you can have at most 8 consumers. Adding a 9th consumer requires repartitioning. NATS scales consumers independently of any partition concept.
- **Head-of-line blocking**: If one Kafka consumer is slow on a partition, all subsequent messages in that partition are blocked. NATS delivers to whichever consumer is available.
- **Redelivery complexity**: Kafka does not natively support per-message acknowledgment or retry with backoff. You must implement this yourself with offset management. NATS JetStream provides `Nak`, `InProgress`, and `Term` per-message controls out of the box.

Using NATS for event streaming is equally problematic: JetStream has weaker replay semantics, no schema registry, and less mature tooling for long-term retention.

**Decision**: Use each system for what it does best. Kafka for event logs (HIP-0030). NATS for task queues (this HIP).

### Why NATS Over RabbitMQ

RabbitMQ is the traditional answer for message queuing. It is mature, well-documented, and has a large ecosystem. We chose NATS instead for three reasons:

1. **Operational simplicity**: NATS is a single static binary with zero external dependencies. No Erlang runtime, no Mnesia database, no cluster configuration files. A NATS cluster is three instances that discover each other via seed URLs. RabbitMQ requires Erlang/OTP, has a complex clustering protocol (Raft for quorum queues, Mnesia for classic), and needs careful tuning of memory watermarks, disk alarms, and flow control.

2. **Go-native ecosystem**: Hanzo's backend infrastructure is predominantly Go (IAM, LLM Gateway, Zap, blockchain node). NATS is written in Go. The NATS Go client is the reference implementation -- not a third-party binding. This means the client library, the server, and our services share the same debugging tools (`pprof`, `dlv`), the same concurrency model (goroutines + channels), and the same deployment model (static binary, no runtime).

3. **Built-in request-reply**: NATS has native request-reply semantics. A client publishes a request on a subject with an auto-generated reply inbox, and the responder publishes to that inbox. This gives us synchronous RPC over the message bus with automatic load balancing and timeout handling. RabbitMQ's RPC pattern requires manual correlation IDs and temporary reply queues.

**Trade-off acknowledged**: RabbitMQ has a more mature management UI (the built-in dashboard) and richer routing primitives (exchanges, bindings, header routing). We accept this gap because our routing needs are simple (subject-based), and we build our own management API at port 8055 integrated with O11y (HIP-0031).

### Why Not Redis Queues

Redis lists (`BRPOPLPUSH`) and Redis Streams (`XREADGROUP`) are already in our stack (HIP-0028). Why not use them for task queuing?

1. **Memory-bound**: Redis holds all data in RAM. A queue with 10 million pending tasks at 1KB each consumes 10GB of Redis memory. NATS JetStream uses a file-based storage engine that keeps only hot messages in memory and pages the rest to disk. Our Redis instances are sized for caching and session state, not for buffering millions of tasks.

2. **No consumer groups with acknowledgment**: Redis Streams have consumer groups, but the acknowledgment model is basic. There is no configurable redelivery delay, no maximum delivery count with dead-letter routing, and no per-message `InProgress` heartbeat to extend processing time. NATS JetStream provides all of these.

3. **Single-purpose principle**: Redis is our KV cache (HIP-0028). Adding queue semantics overloads it operationally. When Redis is under memory pressure from a cache stampede, you do not want task queue consumers to also degrade.

### Why Not AWS SQS / Google Pub/Sub

Managed cloud queues eliminate operational burden but introduce other problems:

1. **Vendor lock-in**: SQS is AWS-only. Our infrastructure runs on DigitalOcean Kubernetes. Using SQS would require cross-cloud networking (VPN or public internet), adding latency and egress costs.

2. **Cost at scale**: SQS charges per million requests ($0.40/M). At 50M tasks/day, that is $600/month for the queue alone. NATS runs on existing cluster resources at near-zero marginal cost.

3. **Latency**: SQS has a minimum polling interval and does not support push-based delivery. Long polling adds 1-20 seconds of latency. NATS push delivery is sub-millisecond.

4. **Self-hosted deployment parity**: Our staging and local development environments must behave identically to production. NATS runs the same binary everywhere. SQS requires either LocalStack (imperfect emulation) or a live AWS account for every developer.

## Specification

### Queue Registry

All queues MUST be registered in this section. Ad-hoc queue creation is prohibited in production.

| Queue | Subject | Max Deliver | Ack Wait | DLQ | Producers | Consumers |
|-------|---------|-------------|----------|-----|-----------|-----------|
| `inference.requests` | `mq.inference.>` | 3 | 30s | Yes | LLM Gateway, Cloud API | Inference Workers |
| `batch.embeddings` | `mq.batch.embeddings` | 5 | 300s | Yes | Cloud API | Embedding Workers |
| `batch.finetune` | `mq.batch.finetune` | 2 | 3600s | Yes | Cloud API | Fine-tune Workers |
| `batch.images` | `mq.batch.images` | 3 | 120s | Yes | Cloud API | Image Workers |
| `scheduled.jobs` | `mq.scheduled.>` | 3 | 60s | Yes | Scheduler | Job Executors |
| `notifications` | `mq.notify.>` | 5 | 10s | Yes | All Services | Notification Workers |
| `dead_letter` | `mq.dlq.>` | 1 | - | No | NATS (automatic) | Ops (manual) |

### Subject Naming Convention

```
mq.<domain>.<entity>[.<action>]
```

Examples: `mq.inference.chat`, `mq.batch.embeddings`, `mq.scheduled.reconcile`, `mq.notify.webhook`.

Subjects MUST use lowercase dot-delimited names. Wildcards (`>` and `*`) are used for consumer subscriptions, never for publishing. Environment isolation is achieved through separate NATS clusters, not subject prefixes.

### Message Envelope

All messages MUST conform to a base envelope:

```json
{
  "schema": "hanzo.mq.v1",
  "id": "task_01HQ3X7K8M2N4P5R6S7T8U9V0W",
  "type": "inference.chat.request",
  "source": "cloud-api",
  "timestamp": "2026-02-23T10:30:00.000Z",
  "priority": 5,
  "org_id": "org_hanzo",
  "team_id": "team_abc123",
  "delay_until": null,
  "ttl_seconds": 300,
  "data": { }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schema` | string | yes | Envelope version. Always `hanzo.mq.v1` for this spec. |
| `id` | string | yes | Globally unique task ID. ULID recommended (time-sortable). |
| `type` | string | yes | Dot-delimited task type (e.g., `inference.chat.request`). |
| `source` | string | yes | Producing service identifier. |
| `timestamp` | string | yes | ISO 8601 UTC timestamp with millisecond precision. |
| `priority` | integer | no | 1 (highest) to 10 (lowest). Default: 5. |
| `org_id` | string | no | Organization identifier for billing attribution. |
| `team_id` | string | no | Team identifier for quota enforcement. |
| `delay_until` | string | no | ISO 8601 timestamp. Message is invisible until this time. |
| `ttl_seconds` | integer | no | Message expires if unprocessed after this many seconds. |
| `data` | object | yes | Task-specific payload. |

### Queue Patterns

#### Work Queue (Competing Consumers)

The fundamental pattern. Multiple workers subscribe to the same queue. Each message is delivered to exactly one worker. When the worker acknowledges, the message is removed. If the worker fails to acknowledge within `ack_wait`, the message is redelivered to another worker.

```
Producer  ──publish──→  mq.inference.chat
                              │
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
               Worker-1  Worker-2  Worker-3
              (ack in 2s) (ack in 5s) (idle, gets next)
```

This is how inference request queuing works. The LLM Gateway publishes overflow requests. A pool of inference workers pulls and processes them. NATS distributes tasks to the least-loaded worker automatically.

#### Priority Queue

NATS JetStream does not support native priority ordering within a single stream. We implement priority using multiple subject levels:

```
mq.inference.priority.1    # Critical (real-time user requests)
mq.inference.priority.5    # Normal (API batch calls)
mq.inference.priority.10   # Background (pre-computation)
```

Workers subscribe to `mq.inference.priority.>` but process subjects in priority order by maintaining separate pull subscriptions per priority level. The worker drains priority-1 before pulling from priority-5.

```go
// Worker priority loop (simplified)
for {
    if msg := tryFetch("mq.inference.priority.1", 1ms); msg != nil {
        process(msg)
        continue
    }
    if msg := tryFetch("mq.inference.priority.5", 1ms); msg != nil {
        process(msg)
        continue
    }
    msg := fetch("mq.inference.priority.10", 100ms) // block on lowest
    if msg != nil {
        process(msg)
    }
}
```

#### Delayed / Scheduled Jobs

Messages with a `delay_until` field are held invisible by the scheduler service until the specified time. Implementation uses NATS key-value store as a schedule index:

1. Producer publishes to `mq.scheduled.reconcile` with `delay_until: "2026-02-23T14:00:00Z"`.
2. The scheduler service stores the message in a JetStream stream with a consumer that filters by delivery time.
3. At the scheduled time, the scheduler re-publishes to the target work queue.

For recurring jobs, the scheduler uses a cron-like configuration:

```yaml
scheduled_jobs:
  - name: credit-reconciliation
    subject: mq.scheduled.reconcile
    cron: "0 */6 * * *"       # Every 6 hours
    data: { "type": "full_reconcile" }

  - name: usage-report
    subject: mq.scheduled.report
    cron: "0 2 * * *"          # Daily at 02:00 UTC
    data: { "type": "daily_usage", "granularity": "hourly" }

  - name: model-health-check
    subject: mq.scheduled.healthcheck
    cron: "*/5 * * * *"        # Every 5 minutes
    data: { "type": "provider_latency_probe" }
```

#### Dead Letter Queue

When a message exceeds its `max_deliver` count, NATS JetStream routes it to the dead letter subject `mq.dlq.<original_subject>`. The DLQ consumer writes failed messages to a PostgreSQL table for inspection:

```sql
CREATE TABLE dead_letters (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_id TEXT NOT NULL,
    subject     TEXT NOT NULL,
    payload     JSONB NOT NULL,
    error       TEXT,
    attempts    INTEGER NOT NULL,
    first_seen  TIMESTAMPTZ NOT NULL,
    last_failed TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved    BOOLEAN NOT NULL DEFAULT false
);
```

Operators inspect failed tasks via the management API and can replay individual messages or entire batches.

#### Request-Reply (Synchronous Inference)

For latency-sensitive inference where the caller needs a response within a timeout, NATS request-reply provides a synchronous pattern over the asynchronous transport:

```
Client  ──request──→  mq.inference.chat  ──→  Worker
                                                 │
Client  ←──reply───  _INBOX.abc123.1    ←───────┘
                      (auto-generated)
```

```go
// Client: synchronous inference with 10s timeout
resp, err := nc.Request("mq.inference.chat", payload, 10*time.Second)
if err != nil {
    // Timeout or no responders -- fall back to direct provider call
}

// Worker: respond to the reply subject
sub, _ := nc.QueueSubscribe("mq.inference.chat", "inference-workers", func(msg *nats.Msg) {
    result := runInference(msg.Data)
    msg.Respond(result)
})
```

This pattern gives us:
- **Automatic load balancing**: NATS routes to the first available worker in the queue group.
- **Backpressure**: If all workers are busy, the request times out at the client. No unbounded queue growth.
- **Timeout handling**: Built into the protocol. No separate health check or circuit breaker needed for basic cases.

### Consumer Groups

Consumer groups enable horizontal scaling. All workers in a group share the task load.

| Consumer Group | Queue | Workers | Processing |
|---------------|-------|---------|------------|
| `inference-workers` | `mq.inference.>` | 4-16 (autoscaled) | LLM inference via provider APIs |
| `embedding-workers` | `mq.batch.embeddings` | 2-8 | Batch embedding generation |
| `finetune-workers` | `mq.batch.finetune` | 1-4 (GPU-bound) | Model fine-tuning jobs |
| `image-workers` | `mq.batch.images` | 2-8 | Image generation / processing |
| `job-executors` | `mq.scheduled.>` | 2 | Scheduled job execution |
| `notify-workers` | `mq.notify.>` | 2 | Webhook delivery, email, Slack |
| `dlq-monitor` | `mq.dlq.>` | 1 | Dead letter persistence and alerting |

#### Consumer Group Naming

```
<function>-workers
```

Examples: `inference-workers`, `embedding-workers`. Kebab-case. MUST NOT include instance identifiers or version numbers.

### Delivery Guarantees

| Guarantee | Configuration | Use Case |
|-----------|--------------|----------|
| At-most-once | `AckPolicy: None` | Non-critical notifications, metrics pings |
| At-least-once | `AckPolicy: Explicit`, idempotent consumers | Inference requests, batch jobs (default) |
| Exactly-once | `AckPolicy: Explicit` + deduplication window | Billing-sensitive operations, credit deductions |

**At-least-once** is the default and covers most AI workloads. Inference requests are naturally idempotent: re-running the same prompt produces a valid (if different) response. The cost of occasional duplicates is far lower than the cost of dropped tasks.

**Exactly-once** uses NATS JetStream's deduplication window. The producer sets a `Nats-Msg-Id` header. JetStream rejects duplicates within the configured window (default: 2 minutes). Combined with idempotent consumers that check the task ID before processing, this provides end-to-end exactly-once semantics.

```go
// Producer: exactly-once publish
msg := &nats.Msg{
    Subject: "mq.batch.finetune",
    Data:    payload,
    Header:  nats.Header{"Nats-Msg-Id": []string{taskID}},
}
js.PublishMsg(msg, nats.MsgId(taskID))
```

### JetStream Configuration

```yaml
# NATS JetStream stream for MQ
streams:
  - name: HANZO_MQ
    subjects:
      - "mq.>"
    retention: WorkQueuePolicy    # Messages deleted on ack (not limits-based)
    max_msgs: 10_000_000          # 10M messages max
    max_bytes: 10_737_418_240     # 10GB max
    max_age: 86400s               # 24h TTL for unprocessed messages
    max_msg_size: 1_048_576       # 1MB max per message
    storage: file                 # File-based (not memory)
    num_replicas: 1               # Single node (scale to 3 for HA)
    duplicate_window: 120s        # 2-minute dedup window
    discard: old                  # Drop oldest when full

consumers:
  - name: inference-workers
    durable: inference-workers
    filter_subject: "mq.inference.>"
    ack_policy: explicit
    ack_wait: 30s
    max_deliver: 3
    max_ack_pending: 1000
    deliver_policy: all

  - name: finetune-workers
    durable: finetune-workers
    filter_subject: "mq.batch.finetune"
    ack_policy: explicit
    ack_wait: 3600s               # 1 hour for long-running jobs
    max_deliver: 2
    max_ack_pending: 10           # Limited by GPU count
    deliver_policy: all
```

### Integration with Cloud (HIP-0037) for Autoscaling

Queue depth is the primary autoscaling signal for AI workers. When more tasks are queued than workers can process, Cloud scales up the worker pool. When queues drain, it scales down.

```
                ┌─────────────┐
                │  NATS MQ    │
                │ queue depth │
                └──────┬──────┘
                       │ expose via management API
                       ▼
                ┌─────────────┐
                │ O11y / Zap  │  hanzo_mq_pending_count
                │  (HIP-0031) │  hanzo_mq_consumer_lag
                └──────┬──────┘
                       │ Prometheus metrics
                       ▼
                ┌─────────────┐
                │   Cloud     │  autoscaling rules
                │  (HIP-0037) │
                └──────┬──────┘
                       │ kubectl scale / KEDA
                       ▼
                ┌─────────────┐
                │   Workers   │  inference-workers: 4 → 12
                └─────────────┘
```

Autoscaling rules (configured in Cloud):

```yaml
autoscaling:
  - queue: mq.inference.>
    consumer_group: inference-workers
    min_replicas: 2
    max_replicas: 16
    scale_up:
      threshold: pending_count > 100
      cooldown: 30s
    scale_down:
      threshold: pending_count == 0 for 5m
      cooldown: 300s

  - queue: mq.batch.finetune
    consumer_group: finetune-workers
    min_replicas: 0           # Scale to zero when idle
    max_replicas: 4
    scale_up:
      threshold: pending_count > 0
      cooldown: 60s
    scale_down:
      threshold: pending_count == 0 for 15m
      cooldown: 600s
```

### Integration with O11y (HIP-0031) for Metrics

The MQ management API exposes Prometheus metrics on port 8055:

```promql
# Queue depth
hanzo_mq_pending_count{stream="HANZO_MQ",consumer="inference-workers"}
hanzo_mq_pending_count{stream="HANZO_MQ",consumer="finetune-workers"}

# Processing rate
hanzo_mq_delivered_total{consumer="inference-workers"}
hanzo_mq_acked_total{consumer="inference-workers"}
hanzo_mq_nacked_total{consumer="inference-workers"}

# Latency (time from publish to ack)
hanzo_mq_processing_duration_seconds{consumer="inference-workers",quantile="0.95"}

# Dead letters
hanzo_mq_dead_letter_total{original_subject="mq.inference.chat"}

# Connection health
hanzo_mq_connections_active
hanzo_mq_reconnections_total
```

Alerting rules:

```yaml
groups:
  - name: hanzo-mq
    rules:
      - alert: QueueBacklogGrowing
        expr: rate(hanzo_mq_pending_count{consumer="inference-workers"}[5m]) > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Inference queue backlog growing at {{ $value }} msgs/sec"

      - alert: QueueBacklogCritical
        expr: hanzo_mq_pending_count{consumer="inference-workers"} > 10000
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Inference queue depth {{ $value }} -- autoscaling may be failing"

      - alert: DeadLetterAccumulating
        expr: increase(hanzo_mq_dead_letter_total[1h]) > 100
        for: 0m
        labels:
          severity: critical
        annotations:
          summary: "{{ $value }} dead letters in the last hour"

      - alert: ConsumerStalled
        expr: rate(hanzo_mq_acked_total[5m]) == 0 AND hanzo_mq_pending_count > 0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Consumer {{ $labels.consumer }} has stopped processing"
```

## Implementation

### Production Deployment

Deployed as a Kubernetes StatefulSet on `hanzo-k8s` using `nats:2.10-alpine`.

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: nats-mq
  namespace: hanzo
spec:
  replicas: 1                      # Single node; scale to 3 for HA
  selector:
    matchLabels:
      app: nats-mq
  serviceName: nats-mq
  template:
    spec:
      containers:
      - name: nats
        image: nats:2.10-alpine
        args:
          - "--config=/etc/nats/nats.conf"
          - "--jetstream"
          - "--store_dir=/data/jetstream"
        ports:
        - name: client
          containerPort: 4222
        - name: cluster
          containerPort: 6222
        - name: monitor
          containerPort: 8222
        resources:
          requests: { memory: 256Mi, cpu: 250m }
          limits:   { memory: 1Gi, cpu: 1000m }
        volumeMounts:
        - name: data
          mountPath: /data
        - name: config
          mountPath: /etc/nats
        readinessProbe:
          httpGet:
            path: /healthz
            port: 8222
          initialDelaySeconds: 2
          periodSeconds: 5
        livenessProbe:
          httpGet:
            path: /healthz
            port: 8222
          initialDelaySeconds: 5
          periodSeconds: 15

      - name: mq-api
        image: ghcr.io/hanzoai/mq:latest
        args:
          - "--nats-url=nats://localhost:4222"
          - "--port=8055"
          - "--metrics-port=9090"
        ports:
        - name: api
          containerPort: 8055
        - name: metrics
          containerPort: 9090
  volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: [ReadWriteOnce]
      storageClassName: do-block-storage
      resources:
        requests:
          storage: 20Gi
```

### NATS Server Configuration

```conf
# /etc/nats/nats.conf
server_name: nats-mq-0
listen: 0.0.0.0:4222

jetstream {
  store_dir: /data/jetstream
  max_mem: 256MB
  max_file: 16GB
}

# Monitoring endpoint
http: 0.0.0.0:8222

# Authorization
authorization {
  users: [
    { user: "cloud-api",       password: "$CLOUD_API_NATS_PASS",  permissions: { publish: "mq.>",          subscribe: "_INBOX.>" } }
    { user: "llm-gateway",     password: "$LLM_GW_NATS_PASS",     permissions: { publish: "mq.inference.>", subscribe: "_INBOX.>" } }
    { user: "inference-worker", password: "$WORKER_NATS_PASS",     permissions: { publish: "_INBOX.>",       subscribe: "mq.inference.>" } }
    { user: "batch-worker",    password: "$BATCH_NATS_PASS",       permissions: { publish: "_INBOX.>",       subscribe: "mq.batch.>" } }
    { user: "scheduler",       password: "$SCHED_NATS_PASS",       permissions: { publish: "mq.>",          subscribe: "mq.scheduled.>" } }
    { user: "monitor",         password: "$MONITOR_NATS_PASS",     permissions: { subscribe: "$SYS.>" } }
  ]
}

# Cluster (when scaling to 3 nodes)
# cluster {
#   name: hanzo-mq
#   listen: 0.0.0.0:6222
#   routes: [
#     nats-route://nats-mq-0.nats-mq.hanzo.svc:6222
#     nats-route://nats-mq-1.nats-mq.hanzo.svc:6222
#     nats-route://nats-mq-2.nats-mq.hanzo.svc:6222
#   ]
# }
```

### Management API

The MQ management API runs as a sidecar alongside the NATS server. It provides a REST interface for queue inspection, dead letter management, and Prometheus metrics export.

```
GET    /v1/queues                    # List all queues with depth and consumer count
GET    /v1/queues/:name              # Queue details: depth, rate, consumers
GET    /v1/queues/:name/messages     # Peek at pending messages (non-destructive)
POST   /v1/queues/:name/purge       # Purge all pending messages (admin only)

GET    /v1/consumers                 # List all consumer groups
GET    /v1/consumers/:name           # Consumer details: pending, ack rate, lag

GET    /v1/dead-letters              # List dead letter entries (paginated)
POST   /v1/dead-letters/:id/replay   # Replay a single dead letter
POST   /v1/dead-letters/replay-all   # Replay all unresolved dead letters
PATCH  /v1/dead-letters/:id          # Mark as resolved

GET    /metrics                      # Prometheus metrics (port 9090)
GET    /healthz                      # Health check
```

### Scaling Path

1. **Single node** (current): All queues on one NATS instance. JetStream storage on a single PVC. Sufficient for < 50K messages/sec.
2. **Three-node cluster**: JetStream replication factor 3. Automatic leader election. Required when inference queue becomes critical path.
3. **Leaf nodes**: Edge NATS servers in GPU worker clusters that connect to the central cluster. Reduces latency for geographically distributed workers.

### SDK Usage

#### Go

```go
import "github.com/hanzoai/mq/client"

mq, err := client.Connect("nats://nats-mq.hanzo.svc:4222",
    client.WithCredentials("cloud-api", password),
)

// Publish a task
err = mq.Publish("mq.inference.chat", &mq.Task{
    ID:       ulid.New(),
    Type:     "inference.chat.request",
    Priority: 1,
    Data:     requestPayload,
})

// Consume tasks
mq.Subscribe("mq.inference.>", "inference-workers", func(task *mq.Task) error {
    result, err := runInference(task.Data)
    if err != nil {
        return err // Triggers Nak + redelivery
    }
    task.Respond(result) // For request-reply
    return nil           // Triggers Ack
})
```

#### Python

```python
from hanzo.mq import MQClient

mq = MQClient("nats://nats-mq.hanzo.svc:4222", user="cloud-api", password=password)

# Publish
await mq.publish("mq.batch.embeddings", {
    "id": generate_ulid(),
    "type": "batch.embeddings.generate",
    "data": {"document_ids": ["doc_1", "doc_2", "doc_3"]},
})

# Consume
@mq.subscribe("mq.batch.embeddings", group="embedding-workers")
async def handle_embedding(task):
    embeddings = await generate_embeddings(task.data["document_ids"])
    await store_embeddings(embeddings)
    # Return without error = automatic Ack
```

## Security Considerations

### Authentication

Every service connecting to NATS MUST authenticate with a dedicated username and password. Credentials are stored in KMS (HIP-0027) and injected via Kubernetes secrets.

No service gets wildcard publish access. Each user account is scoped to the subjects it needs:

| Principal | Publish | Subscribe | Rationale |
|-----------|---------|-----------|-----------|
| `cloud-api` | `mq.>` | `_INBOX.>` | Publishes all task types, receives request-reply responses |
| `llm-gateway` | `mq.inference.>` | `_INBOX.>` | Publishes inference overflow only |
| `inference-worker` | `_INBOX.>` | `mq.inference.>` | Consumes inference tasks, replies to inboxes |
| `batch-worker` | `_INBOX.>` | `mq.batch.>` | Consumes batch tasks |
| `scheduler` | `mq.>` | `mq.scheduled.>` | Publishes scheduled tasks to target queues |
| `monitor` | (none) | `$SYS.>` | System monitoring only, no application access |

### Encryption

- **In transit**: TLS 1.3 for all client connections on port 4223. Intra-cluster routes use mutual TLS.
- **At rest**: JetStream data directory on encrypted block storage (DigitalOcean volume encryption).
- **Credentials**: NATS passwords stored in KMS, injected as Kubernetes secrets, never in config files.

### Network Policies

NATS is accessible only from within the `hanzo` namespace:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: nats-mq-access
  namespace: hanzo
spec:
  podSelector:
    matchLabels:
      app: nats-mq
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: hanzo
    ports:
    - protocol: TCP
      port: 4222
    - protocol: TCP
      port: 8055
  - from:
    - namespaceSelector:
        matchLabels:
          name: monitoring
    ports:
    - protocol: TCP
      port: 8222
    - protocol: TCP
      port: 9090
```

### Message Payload Security

Task payloads MUST NOT contain raw user prompts, API keys, or PII. Messages carry references (IDs) to data stored in the appropriate service. For example, an inference request message contains a `request_id` that the worker uses to fetch the full prompt from the Cloud API, not the prompt itself.

This ensures that even if NATS storage is compromised, no sensitive user data is exposed.

## References

1. [HIP-0004: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md) -- Inference request source
2. [HIP-0030: Event Streaming Standard](./hip-0030-event-streaming-standard.md) -- Kafka event log (complementary system)
3. [HIP-0031: Observability & Metrics Standard](./hip-0031-observability-metrics-standard.md) -- Queue metrics and alerting
4. [HIP-0037: AI Cloud Platform Standard](./hip-0037-ai-cloud-platform-standard.md) -- Autoscaling integration
5. [NATS Documentation](https://docs.nats.io/)
6. [NATS JetStream](https://docs.nats.io/nats-concepts/jetstream)
7. [KEDA - Kubernetes Event-Driven Autoscaling](https://keda.sh/)
8. [Hanzo MQ Repository](https://github.com/hanzoai/mq)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
