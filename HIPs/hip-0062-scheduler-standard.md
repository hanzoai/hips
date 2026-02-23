---
hip: 0062
title: Cron & Job Scheduler Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-02-23
---

# HIP-62: Cron & Job Scheduler Standard

## Abstract

This proposal defines the cron and job scheduler standard for the Hanzo ecosystem. **Hanzo Scheduler** provides distributed scheduling for recurring and one-off tasks, with first-class support for AI-specific workloads: model retraining triggers, data pipeline ETL, cache warming, provider health checks, and benchmark runs.

The scheduler supports standard cron expressions, natural language schedules ("every Monday at 9am UTC"), job dependency graphs (DAGs) for multi-step workflows, distributed locking to prevent duplicate execution across replicas, and retry with exponential backoff. It dispatches work through Hanzo MQ (HIP-0055) and executes tasks via Hanzo Functions (HIP-0060), creating a clean separation between *when* a job runs and *what* it does.

**Repository**: [github.com/hanzoai/scheduler](https://github.com/hanzoai/scheduler)
**Port**: 8062 (API)
**Binary**: `hanzo-scheduler`
**Container**: `hanzoai/scheduler:latest`
**Cluster**: `hanzo-k8s` (`24.199.76.156`)

## Motivation

The Hanzo platform has dozens of recurring operational tasks that must run reliably on a schedule:

1. **Model health checks.** Every 5 minutes, the LLM Gateway (HIP-0004) needs to probe downstream providers for latency and availability. Today this runs inside the gateway process -- a restart drops the schedule, and multiple replicas duplicate probes.

2. **Credit reconciliation.** IAM (HIP-0026) tracks user credit balances. Every 6 hours, a reconciliation job verifies that the sum of transactions matches the current balance. If this fails silently, billing drift accumulates.

3. **Cache warming.** Popular embedding indices and API response caches expire on TTLs. Scheduled jobs pre-warm caches during low-traffic windows. This requires timezone-aware scheduling -- "warm the cache at 4am in each user's primary region."

4. **Data pipeline ETL.** Analytics events from Hanzo Stream (HIP-0030) must be extracted, transformed, loaded into the analytics datastore (HIP-0047), and cleaned up. This is a four-step pipeline where each step depends on the previous one.

5. **Benchmark runs.** Zen model inference must be benchmarked nightly against a fixed prompt suite. Results feed into O11y dashboards (HIP-0031). Running it twice wastes GPU hours.

6. **Model retraining triggers.** When evaluation metrics drift below a threshold, a retraining pipeline (HIP-0057) should trigger automatically -- event-driven scheduling, not purely time-based.

Without a centralized scheduler, each service implements its own: `time.Ticker` in Go, `setInterval` in Node.js, cron containers across Kubernetes, manual `kubectl` jobs from laptops. This fragmentation means no unified view, no coordinated retry, no dependency management, and no audit trail.

## Design Philosophy

### Why a Custom Scheduler over Kubernetes CronJobs

Kubernetes has built-in CronJob resources. Why not use them?

**No DAG support.** A CronJob is a single unit of work. "Run ETL extract, then transform, then load" requires three CronJobs with manual coordination. Kubernetes has no concept of "Job B starts after Job A succeeds." Hanzo Scheduler provides native DAG definitions where step dependencies are explicit and the engine handles ordering, fan-out, and failure propagation.

**No timezone handling.** Kubernetes CronJobs default to UTC. The `timeZone` field (beta since 1.27) requires a feature gate and is not universally available on managed providers. "Run at 2am local time in each region" is a real requirement. The scheduler supports IANA timezones natively.

**No retry with backoff.** CronJob `backoffLimit` retries failed Jobs with fixed backoff. If a job fails because a downstream service is temporarily unreachable, you want 30s, then 60s, then 120s -- not the next cron tick 6 hours later. The scheduler implements configurable initial delay, multiplier, max delay, and max attempts.

**No execution history.** CronJobs keep a configurable number of Job objects -- Kubernetes resources, not a queryable database. There is no API to answer "show me all executions of reconciliation in the last 30 days with durations and exit codes." The scheduler stores history in PostgreSQL (HIP-0029).

**No operator UI.** Managing CronJobs means `kubectl`. No dashboard for schedule overview, next fire times, or failure rates. The scheduler provides a REST API and integrates with O11y (HIP-0031).

**Trade-off acknowledged.** CronJobs are zero-dependency. Adding a scheduler is another component. We accept this because DAGs, timezones, retries, history, and distributed locking exceed what CronJobs provide.

### Why Not Apache Airflow

**Airflow is heavy.** A minimal deployment requires: web server, scheduler process, executor, metadata DB, and message broker. That is 5-6 components. Hanzo Scheduler is a single Go binary backed by the PostgreSQL and NATS instances already in the cluster.

**Airflow is for data engineering, not infrastructure scheduling.** Airflow assumes Python-literate engineers writing DAG files with XCom, Jinja SQL, and branching logic. Hanzo's needs are simpler: run this function on this cron, with dependencies, retry on failure. Job definitions are declarative YAML, not Python.

**Airflow conflicts with Hanzo's execution model.** Airflow spins up its own workers. Hanzo already has MQ (HIP-0055) for dispatch and Functions (HIP-0060) for execution. Adding Airflow would bypass existing backpressure, monitoring, and billing infrastructure.

### Separation of Concerns

The scheduler does one thing: decide *when* a task runs and *in what order*. It does not execute tasks itself.

```
Scheduler (this HIP)           MQ (HIP-0055)              Functions (HIP-0060)
┌───────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│ Cron evaluation   │    │ Task queue with       │    │ Stateless function   │
│ DAG orchestration │───>│ delivery guarantees,  │───>│ execution runtime    │
│ Distributed lock  │    │ retry, dead letter    │    │ with resource limits │
│ Execution history │    │ priority routing      │    │ and billing          │
└───────────────────┘    └──────────────────────┘    └──────────────────────┘
      when?                    to whom?                    what?
```

Benefits: the scheduler never needs GPU access or large memory. Functions can be triggered by the scheduler *or* by API calls. MQ provides at-least-once delivery regardless of trigger source. Each layer scales independently.

## Specification

### Job Registry

All production jobs MUST be registered in version-controlled YAML. Ad-hoc scheduling is available via the API.

```yaml
jobs:
  - name: provider-health-check
    schedule: "*/5 * * * *"
    timezone: UTC
    function: hanzo/llm-gateway/health-probe
    timeout: 30s
    retry: { max_attempts: 2, initial_delay: 5s, multiplier: 2 }
    lock: true
    tags: [health, llm, critical]

  - name: credit-reconciliation
    schedule: "0 */6 * * *"
    function: hanzo/iam/credit-reconcile
    timeout: 300s
    retry: { max_attempts: 3, initial_delay: 30s, multiplier: 2, max_delay: 300s }
    lock: true
    dead_letter: true
    tags: [billing, critical]

  - name: cache-warm-embeddings
    schedule: "every weekday at 7am"          # Natural language
    timezone: America/Los_Angeles
    function: hanzo/cloud/cache-warm
    input: { cache_type: embeddings, top_k: 1000 }
    timeout: 600s
    tags: [cache, performance]

  - name: nightly-benchmark
    schedule: "0 3 * * *"
    function: hanzo/ml/benchmark-suite
    input: { models: [zen-7b, zen-72b], prompt_suite: standard-v2 }
    timeout: 3600s
    retry: { max_attempts: 1 }                # No retry -- expensive
    tags: [benchmark, ml]

  - name: daily-analytics-etl
    schedule: "0 2 * * *"
    dag:
      - step: extract
        function: hanzo/analytics/etl-extract
        timeout: 1800s
      - step: transform
        function: hanzo/analytics/etl-transform
        depends_on: [extract]
        timeout: 1800s
      - step: load
        function: hanzo/analytics/etl-load
        depends_on: [transform]
        timeout: 900s
      - step: cleanup
        function: hanzo/analytics/etl-cleanup
        depends_on: [load]
        timeout: 300s
    retry: { max_attempts: 2, initial_delay: 60s }
    dead_letter: true
    tags: [analytics, etl]

  - name: model-drift-check
    schedule: "0 6 * * 1"                     # Mondays at 06:00 UTC
    function: hanzo/ml/drift-evaluation
    input: { models: [zen-72b-finance, zen-7b-code], threshold: 0.05 }
    timeout: 7200s
    tags: [ml, evaluation, weekly]
```

### Schedule Expressions

**Standard cron (5-field).** Minute granularity. Fields: minute, hour, day-of-month, month, day-of-week.

```
*/5 * * * *         Every 5 minutes
0 */6 * * *         Every 6 hours
0 9 * * 1-5         Weekdays at 09:00
0 0 1 * *           First of every month
```

**Natural language.** Parsed at registration time into a cron expression using a deterministic grammar (not an LLM). Ambiguous expressions are rejected with a suggestion. The parsed cron is returned in the response so operators can verify.

```
every 5 minutes                    every Monday at 9am
every day at 2am                   every first of the month at midnight
every weekday at 9am               twice daily at 8am and 8pm
```

### Distributed Locking

When `lock: true`, the scheduler acquires a distributed lock before dispatching. This prevents duplicate execution when a cron tick fires while a previous execution is still running.

Locking uses NATS JetStream key-value store (already deployed for MQ):

```
Key:    scheduler.lock.{job_name}
Value:  {execution_id, acquired_at, ttl}
TTL:    job.timeout + 60s grace period
```

1. Cron tick fires. Scheduler attempts to create the lock key with a TTL.
2. Key exists (previous run still active) -> tick skipped, `job.skipped` event emitted.
3. Key absent -> lock acquired, task dispatched to MQ.
4. Execution completes -> lock released by deleting the key.
5. Scheduler crashes -> TTL ensures automatic release.

This is *advisory* locking. It prevents the common case of duplicate execution under normal operation. Exactly-once guarantee comes from function idempotency (HIP-0060), not from the lock.

### Job Dependency Graphs (DAGs)

Multi-step workflows define a `dag` field with named steps and dependency edges.

```
daily-analytics-etl:              Fan-out example:

  extract                           extract
    |                                /    \
  transform                  transform-A  transform-B
    |                                \    /
  load                                load
    |                                  |
  cleanup                           notify
```

DAG execution rules:
- A step starts when **all** `depends_on` steps have completed successfully.
- If a step exhausts retries, downstream steps are **cancelled** and the DAG is marked `failed`.
- Steps with no dependencies start immediately. Parallel steps dispatch as separate MQ messages.
- Circular dependencies are rejected at registration time.

Each step is an independent MQ message. DAG state is persisted to PostgreSQL so scheduler restarts resume from the last completed step.

### Retry Policy

Retries use exponential backoff with jitter to prevent thundering herds:

```yaml
retry:
  max_attempts: 3          # 1 initial + 2 retries
  initial_delay: 30s
  multiplier: 2            # 30s -> 60s -> 120s -> 240s -> 300s (capped)
  max_delay: 300s
  jitter: 0.1              # +/- 10% random
```

Formula: `delay(n) = min(initial_delay * multiplier^(n-1), max_delay) * (1 + random(-jitter, +jitter))`

When all retries are exhausted and `dead_letter: true`, the failed execution is persisted to the dead letter table with full error and attempt history. An alert fires via O11y (HIP-0031).

### Dead Letter Handling

```sql
CREATE TABLE scheduler_dead_letters (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_name      TEXT NOT NULL,
    execution_id  TEXT NOT NULL,
    attempts      INTEGER NOT NULL,
    last_error    TEXT,
    input         JSONB,
    first_attempt TIMESTAMPTZ NOT NULL,
    last_attempt  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved      BOOLEAN NOT NULL DEFAULT false
);
```

Operators replay individual failures (`POST /v1/dead-letters/{id}/replay`), bulk replay (`POST /v1/dead-letters/replay-all`), or acknowledge without action (`PATCH /v1/dead-letters/{id}`).

### Execution History

Every execution is recorded for auditability:

```sql
CREATE TABLE scheduler_executions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_name       TEXT NOT NULL,
    execution_id   TEXT NOT NULL UNIQUE,
    trigger        TEXT NOT NULL,            -- cron | manual | api | event
    started_at     TIMESTAMPTZ NOT NULL,
    completed_at   TIMESTAMPTZ,
    status         TEXT NOT NULL,            -- pending | running | completed | failed | skipped
    duration_ms    INTEGER,
    attempt        INTEGER NOT NULL DEFAULT 1,
    error          TEXT,
    dag_state      JSONB
);
```

Retention: 90 days default, configurable per job. Older records archived to Object Storage (HIP-0032).

### API Endpoints

```
POST   /v1/jobs                     Register a new job
GET    /v1/jobs                     List jobs (with next fire time)
GET    /v1/jobs/{name}              Job details and schedule
PUT    /v1/jobs/{name}              Update job definition
DELETE /v1/jobs/{name}              Delete a job
POST   /v1/jobs/{name}/trigger      Trigger immediate execution
POST   /v1/jobs/{name}/pause        Pause scheduling
POST   /v1/jobs/{name}/resume       Resume scheduling

GET    /v1/executions               List executions (filter by job, status, time)
GET    /v1/executions/{id}          Execution details (including DAG step states)
POST   /v1/executions/{id}/cancel   Cancel a running execution

GET    /v1/dead-letters             List unresolved dead letters
POST   /v1/dead-letters/{id}/replay Replay a dead letter
PATCH  /v1/dead-letters/{id}        Mark as resolved

GET    /v1/schedule                 Upcoming fire times (next 24h)
GET    /v1/health                   Health check
GET    /metrics                     Prometheus metrics (port 9090)
```

### Integration with MQ (HIP-0055)

The scheduler publishes task messages using the MQ envelope format:

```json
{
  "schema": "hanzo.mq.v1",
  "id": "task_01HQ3X7K8M2N4P5R6S7T8U9V0W",
  "type": "scheduler.execute",
  "source": "scheduler",
  "timestamp": "2026-02-23T02:00:00.000Z",
  "data": {
    "job_name": "credit-reconciliation",
    "execution_id": "exec_01HQ3X...",
    "function": "hanzo/iam/credit-reconcile",
    "input": {},
    "attempt": 1,
    "timeout": 300
  }
}
```

Subject: `mq.scheduled.{job_name}`. Consumer group: `job-executors` (HIP-0055). Executors invoke the function via HIP-0060 and publish results to a completion subject the scheduler monitors.

### Integration with O11y (HIP-0031)

```promql
hanzo_scheduler_executions_total{job, status, trigger}    # Execution counts
hanzo_scheduler_retries_total{job}                         # Retry counts
hanzo_scheduler_dead_letters_total{job}                    # Dead letter counts
hanzo_scheduler_execution_duration_seconds{job}            # Duration histogram
hanzo_scheduler_jobs_registered                            # Registered job gauge
hanzo_scheduler_next_fire_seconds{job}                     # Seconds until next fire
hanzo_scheduler_lock_held{job}                             # Lock status
hanzo_scheduler_dag_steps_total{job, step, status}         # DAG step counts
```

Alerting rules:

```yaml
groups:
  - name: hanzo-scheduler
    rules:
      - alert: ScheduledJobFailing
        expr: increase(hanzo_scheduler_executions_total{status="failed"}[1h]) > 3
        labels: { severity: warning }

      - alert: DeadLettersAccumulating
        expr: increase(hanzo_scheduler_dead_letters_total[24h]) > 0
        labels: { severity: critical }

      - alert: SchedulerLeaderLost
        expr: absent(hanzo_scheduler_leader_active) == 1
        for: 1m
        labels: { severity: critical }
```

## Implementation

### Architecture

The scheduler runs as a Kubernetes Deployment with 2 replicas (1 leader + 1 standby). Leader election uses a NATS JetStream KV key with a 15-second TTL, renewed every 5 seconds. Failover takes under 15 seconds.

```
┌─────────────────────────────────────────────┐
│              Hanzo Scheduler                 │
│                                             │
│  ┌───────────┐ ┌───────────┐ ┌──────────┐  │
│  │Cron Engine│ │DAG Engine │ │Lock Mgr  │  │
│  └─────┬─────┘ └─────┬─────┘ └────┬─────┘  │
│        └──────┬──────┘            │         │
│               ▼                   │         │
│        ┌────────────┐             │         │
│        │ Dispatcher │─────────────┘         │
│        └──────┬─────┘                       │
│               │     ┌────────────────────┐  │
│               │     │Completion Listener │  │
│               │     └────────┬───────────┘  │
│        ┌──────┴──────────────┴─────┐        │
│        │    PostgreSQL (state)      │        │
│        └───────────────────────────┘        │
└───────────────┬───────────────▲──────────────┘
                │ publish       │ complete
                ▼               │
         ┌────────────┐  ┌─────┴──────┐
         │  NATS MQ   │─>│  Functions │
         │ (HIP-0055) │<─│ (HIP-0060) │
         └────────────┘  └────────────┘
```

**Cron Engine** evaluates schedules every second. When a cron expression matches the current time (truncated to the minute), a tick is generated. Next fire times are pre-computed at registration for the `/v1/schedule` endpoint.

**DAG Engine** maintains execution graphs for multi-step jobs. On step completion, it evaluates which downstream steps are unblocked and dispatches them. State is persisted to PostgreSQL so restarts resume from the last completed step.

**Lock Manager** wraps NATS KV operations. Handles TTL renewal for long-running jobs to prevent premature lock release.

**Dispatcher** publishes task messages to NATS MQ and re-publishes with delay on failure callbacks.

**Completion Listener** subscribes to `mq.scheduler.complete.>` for results. Updates execution records, releases locks, advances DAGs, and triggers retries.

### Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hanzo-scheduler
  namespace: hanzo
spec:
  replicas: 2
  template:
    metadata:
      labels: { app: hanzo-scheduler }
      annotations: { prometheus.io/scrape: "true", prometheus.io/port: "9090" }
    spec:
      containers:
        - name: scheduler
          image: hanzoai/scheduler:latest
          ports:
            - { containerPort: 8062, name: api }
            - { containerPort: 9090, name: metrics }
          env:
            - name: DATABASE_URL
              valueFrom: { secretKeyRef: { name: scheduler-secrets, key: database-url } }
            - { name: NATS_URL, value: "nats://nats-mq.hanzo.svc:4222" }
          resources:
            requests: { memory: 128Mi, cpu: 100m }
            limits:   { memory: 512Mi, cpu: 500m }
          readinessProbe: { httpGet: { path: /v1/health, port: 8062 } }
```

Resource footprint is small. The scheduler is CPU-light (cron evaluation is trivial) and memory-light (state lives in PostgreSQL). 128Mi handles thousands of registered jobs.

### Configuration

```yaml
server:  { host: 0.0.0.0, port: 8062 }
database: { url: "${DATABASE_URL}", max_connections: 10 }
nats:    { url: "${NATS_URL}", user: scheduler, password: "${NATS_PASSWORD}" }
leader:  { ttl: 15s, renew_interval: 5s }
execution: { default_timeout: 300s, history_retention_days: 90 }
jobs_file: /etc/scheduler/jobs.yaml
auth:    { iam_url: "https://hanzo.id", verify_tokens: true }
metrics: { enabled: true, port: 9090 }
```

### CLI

```bash
hanzo-scheduler jobs list                                    # List with next fire times
hanzo-scheduler jobs apply -f scheduler-jobs.yaml            # Register from YAML
hanzo-scheduler jobs trigger credit-reconciliation           # Immediate execution
hanzo-scheduler jobs pause nightly-benchmark                 # Pause scheduling
hanzo-scheduler executions list --job credit-reconciliation  # Recent executions
hanzo-scheduler schedule                                     # Upcoming 24h
hanzo-scheduler dead-letters list --unresolved               # Failed jobs
hanzo-scheduler dead-letters replay <id>                     # Retry a failure
```

## Security Considerations

### Authentication and Authorization

All API endpoints require a valid Hanzo IAM bearer token. RBAC roles:

| Role | Permissions |
|------|------------|
| `scheduler-admin` | Register, update, delete, pause, resume, trigger. Replay dead letters. |
| `scheduler-operator` | Trigger jobs, view executions, replay dead letters. |
| `scheduler-viewer` | Read-only: list jobs, view executions, view schedule. |

### NATS Credentials

The scheduler authenticates to NATS with a dedicated user (`scheduler`) scoped to publish `mq.scheduled.>` and `mq.scheduler.>`, subscribe to `mq.scheduler.complete.>`. No access to inference or batch queues.

### Job Input Sanitization

Inputs are validated against a JSON schema at registration. The scheduler rejects payloads exceeding 64KB -- large data belongs in Object Storage, referenced by ID. Environment variable references resolve at dispatch time from Kubernetes Secrets, never stored in job definitions.

### Audit Trail

Every registration, update, deletion, pause, resume, and manual trigger is logged with the caller's IAM identity. Execution records include trigger source and are retained per the configured retention period.

## References

1. [HIP-0029: Relational Database Standard](./hip-0029-relational-database-standard.md) -- Execution history storage
2. [HIP-0031: Observability & Metrics Standard](./hip-0031-observability-metrics-standard.md) -- Metrics and alerting
3. [HIP-0055: Message Queue Standard](./hip-0055-message-queue-standard.md) -- Task dispatch via NATS
4. [HIP-0060: Functions Standard](./hip-0060-functions-standard.md) -- Task execution runtime
5. [HIP-0057: ML Pipeline Standard](./hip-0057-ml-pipeline-standard.md) -- Model retraining triggers
6. [HIP-0004: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md) -- Provider health checks
7. [HIP-0026: IAM Standard](./hip-0026-identity-access-management-standard.md) -- Authentication
8. [HIP-0027: Secrets Management](./hip-0027-secrets-management-standard.md) -- NATS credentials
9. [HIP-0030: Event Streaming](./hip-0030-event-streaming-standard.md) -- Event-driven triggers
10. [HIP-0047: Analytics Datastore](./hip-0047-analytics-datastore-standard.md) -- ETL target
11. [IANA Time Zone Database](https://www.iana.org/time-zones)
12. [Hanzo Scheduler Repository](https://github.com/hanzoai/scheduler)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
