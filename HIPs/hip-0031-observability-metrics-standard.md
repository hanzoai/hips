---
hip: 0031
title: Observability & Metrics Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2025-01-15
---

# HIP-31: Observability & Metrics Standard

## Abstract

This proposal defines the observability and metrics standard for the Hanzo ecosystem. **Hanzo Zap** provides unified observability -- metrics, traces, and structured logs -- across all services in the Hanzo infrastructure.

Zap is a Go binary that runs as a sidecar container or standalone service alongside every Hanzo workload. It collects infrastructure telemetry, exports Prometheus metrics, forwards OpenTelemetry traces, and ships structured JSON logs to ClickHouse. Together with Grafana dashboards, it forms the single pane of glass for all Hanzo operations.

**Repository**: [github.com/hanzoai/zap](https://github.com/hanzoai/zap)
**Docker**: `ghcr.io/hanzoai/zap:latest`
**Wire Protocol**: ZAP (Zero-copy Agent Protocol) -- see [HIP-007-zap.md](./HIP-007-zap.md)
**Default Port**: 9651

## Motivation

### The Cost Problem

Observability SaaS pricing scales with data volume. At Hanzo's throughput -- millions of LLM requests per day across 14 Zen models and 100+ third-party providers -- managed observability is prohibitively expensive:

| Provider | Estimated Monthly Cost | Notes |
|----------|----------------------|-------|
| Datadog | $12,000-18,000 | Custom metrics + APM + logs |
| New Relic | $8,000-15,000 | Full-stack observability |
| Splunk | $10,000-20,000 | Log volume-based pricing |
| **Self-hosted** | **~$200** | **Compute cost on existing K8s** |

The self-hosted stack (Prometheus + Grafana + ClickHouse) runs on resources already allocated in our DOKS clusters. The marginal cost is near zero.

### The Integration Problem

Hanzo's infrastructure spans multiple domains:

1. **LLM Gateway** (HIP-4): Token throughput, provider latency, cache hit rates
2. **IAM** (hanzo.id): Authentication events, OAuth flows, session counts
3. **Blockchain nodes** (HIP-20): Consensus rounds, block times, peer counts
4. **Compute marketplace** (hanzo.network): GPU utilization, job scheduling
5. **Analytics** (HIP-17): Application events, user behavior

Each domain needs observability, but no SaaS vendor understands all of them natively. A unified in-house standard lets us define metrics that span these domains coherently.

### The Sidecar Pattern

Rather than instrumenting every service from the inside, Zap runs alongside each service as a sidecar. This provides:

- **Zero code changes**: Existing services get observability without modification
- **Uniform collection**: Same metric format regardless of service language
- **Resource isolation**: Sidecar crash does not take down the main service
- **Independent upgrades**: Update observability without redeploying services

## Design Philosophy

### Why Go for the Sidecar

Go is the natural choice for three reasons:

1. **Ecosystem alignment**: The blockchain stack (Lux node, Lux CLI, genesis tools) is Go. Same language means shared libraries, shared debugging tools, shared expertise. The Zap sidecar imports `github.com/luxfi/zap` directly for wire protocol handling.

2. **Minimal footprint**: A production Zap sidecar binary is ~8MB. Runtime RSS is ~15MB. In Kubernetes, where every sidecar container competes for pod memory limits, this matters. Compare: a Java-based collector starts at 200MB+ heap.

3. **No runtime dependency**: The binary is statically linked (`CGO_ENABLED=0`). The Docker image is `alpine:latest` plus a single binary. No JVM, no Python interpreter, no Node.js runtime. Startup time is <100ms.

### Why Cap'n Proto for the Wire Protocol

The full ZAP (Zero-copy Agent Protocol) specification lives in [HIP-007-zap.md](./HIP-007-zap.md). The key insight for observability:

Cap'n Proto gives us **zero-copy serialization**. When a Zap sidecar receives a metric payload from a co-located service, it can forward that payload to Prometheus or ClickHouse without deserializing and reserializing the data. The sidecar reads field offsets directly from the wire bytes.

Benchmarks on commodity hardware (4-core, 8GB):

```
BenchmarkZapForward-4    2,300,000 msg/sec    0 allocs/op
BenchmarkJsonForward-4     180,000 msg/sec    12 allocs/op
BenchmarkProtobufFwd-4     420,000 msg/sec    4 allocs/op
```

At 2.3M messages/sec, a single Zap sidecar can handle the metric volume of an entire K8s node without becoming a bottleneck.

### Why Prometheus over Alternatives

| Feature | Prometheus | InfluxDB | VictoriaMetrics |
|---------|-----------|----------|-----------------|
| K8s native | Yes (de facto standard) | No | Compatible |
| Pull model | Yes | Push | Both |
| PromQL | Native | Flux (different) | PromQL compatible |
| Service mesh integration | Built-in | Manual | Compatible |
| Operator maturity | 8+ years | Limited | Growing |

Prometheus is the K8s-native standard. Every K8s operator, every service mesh (Istio, Linkerd), and every cloud provider already exports Prometheus metrics. Choosing Prometheus means zero translation layer for infrastructure metrics.

**Future consideration**: VictoriaMetrics as a long-term storage backend for Prometheus. Prometheus's local TSDB retains ~15 days by default. VictoriaMetrics provides efficient long-term retention with the same PromQL query interface.

### How Zap Connects to Insights (HIP-17)

The observability stack has two layers with distinct granularity:

```
┌──────────────────────────────────────────────────────┐
│                    Grafana Dashboards                 │
├──────────────────────┬───────────────────────────────┤
│   Infrastructure     │      Application              │
│   (Zap / HIP-31)    │      (Insights / HIP-17)      │
├──────────────────────┼───────────────────────────────┤
│ CPU, memory, network │ Page views, LLM usage         │
│ Request latency      │ User journeys                 │
│ Error rates          │ Feature adoption               │
│ Pod health           │ Revenue events                │
├──────────────────────┼───────────────────────────────┤
│ Prometheus + OTLP    │ ClickHouse + TimescaleDB      │
│ Scrape interval: 15s │ Event-driven, real-time       │
└──────────────────────┴───────────────────────────────┘
```

Zap handles the bottom layer: infrastructure metrics at 15-second granularity. Insights (HIP-17) handles the top layer: application events as they occur. Both feed into the same Grafana instance, enabling dashboards that correlate infrastructure health with business metrics (e.g., "LLM latency spike caused a drop in chat completions").

## Specification

### Metrics Export: Prometheus Exposition Format

All Hanzo services MUST expose metrics in the OpenMetrics/Prometheus exposition format on a `/metrics` endpoint. The Zap sidecar exposes a consolidated `/metrics` endpoint that aggregates its own metrics with any scraped from the co-located service.

#### Standard Metric Names

All metrics MUST use the `hanzo_` prefix. Subsystem names follow the service:

```promql
# LLM Gateway metrics
hanzo_llm_request_duration_seconds{provider="openai",model="gpt-4",status="200"}
hanzo_llm_tokens_total{direction="input",model="claude-3-opus"}
hanzo_llm_tokens_total{direction="output",model="claude-3-opus"}
hanzo_llm_cache_hit_total{cache="semantic"}
hanzo_llm_cache_miss_total{cache="semantic"}
hanzo_llm_provider_errors_total{provider="anthropic",error="rate_limit"}
hanzo_llm_active_requests{provider="together"}

# IAM metrics
hanzo_iam_login_total{method="oauth",provider="github",status="success"}
hanzo_iam_login_total{method="password",status="failure"}
hanzo_iam_session_active_count{organization="hanzo"}
hanzo_iam_token_issued_total{grant_type="authorization_code"}
hanzo_iam_token_refresh_total{status="success"}

# Zap sidecar metrics
hanzo_zap_messages_forwarded_total{mode="sql",backend="postgres"}
hanzo_zap_message_latency_seconds{mode="kv",operation="get"}
hanzo_zap_backend_health{mode="datastore",status="healthy"}
hanzo_zap_connections_active{mode="documentdb"}

# Blockchain node metrics (Lux)
hanzo_node_consensus_rounds_total{chain="P"}
hanzo_node_block_processing_seconds{chain="C"}
hanzo_node_peers_connected{network="mainnet"}
hanzo_node_validator_uptime_ratio

# Infrastructure metrics (auto-collected by sidecar)
hanzo_pod_cpu_usage_ratio{pod="llm-gateway-abc123"}
hanzo_pod_memory_bytes{pod="llm-gateway-abc123",type="rss"}
hanzo_pod_network_bytes_total{pod="llm-gateway-abc123",direction="rx"}
hanzo_pod_restarts_total{pod="llm-gateway-abc123"}
```

#### Metric Types

Services MUST use the correct Prometheus metric type:

| Type | Use Case | Example |
|------|----------|---------|
| Counter | Monotonically increasing totals | `hanzo_llm_tokens_total` |
| Gauge | Current values that go up/down | `hanzo_llm_active_requests` |
| Histogram | Request duration distributions | `hanzo_llm_request_duration_seconds` |
| Summary | Pre-computed quantiles (rare) | Avoid -- histograms are preferred |

#### Histogram Buckets

Standard latency buckets for request duration histograms:

```go
var DefaultLatencyBuckets = []float64{
    0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5,
    1.0, 2.5, 5.0, 10.0, 30.0, 60.0,
}
```

LLM-specific buckets (longer tail for model inference):

```go
var LLMLatencyBuckets = []float64{
    0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0,
    15.0, 30.0, 60.0, 120.0, 300.0,
}
```

### Traces: OpenTelemetry Protocol (OTLP)

Distributed traces follow the OpenTelemetry standard. The Zap sidecar acts as an OTLP collector endpoint, receiving spans from services and forwarding to the central collector.

#### Trace Context Propagation

All inter-service calls MUST propagate W3C `traceparent` and `tracestate` headers:

```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
tracestate: hanzo=org:hanzo;svc:llm-gateway
```

#### Span Naming Convention

```
{service}.{operation}

Examples:
  llm-gateway.chat.completion
  llm-gateway.provider.openai.request
  iam.oauth.authorize
  iam.token.validate
  zap.sql.query
  zap.kv.get
  zap.datastore.insert
```

#### Required Span Attributes

```yaml
# All spans
service.name: "llm-gateway"
service.version: "1.4.2"
deployment.environment: "production"
hanzo.org_id: "hanzo"

# HTTP spans
http.method: "POST"
http.url: "https://api.hanzo.ai/v1/chat/completions"
http.status_code: 200
http.request.body.size: 1024
http.response.body.size: 8192

# LLM spans (additional)
llm.provider: "openai"
llm.model: "gpt-4"
llm.tokens.input: 150
llm.tokens.output: 230
llm.cache.hit: false

# Database spans (additional)
db.system: "postgresql"
db.name: "hanzo_iam"
db.operation: "SELECT"
db.statement: "SELECT id FROM users WHERE email = $1"
```

#### OTLP Collector Configuration

```yaml
# otel-collector-config.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 5s
    send_batch_size: 1024

  # Drop high-cardinality attributes to control storage
  attributes:
    actions:
      - key: http.request.body
        action: delete
      - key: db.statement
        action: hash  # Hash SQL to prevent PII leakage

exporters:
  clickhouse:
    endpoint: tcp://clickhouse.hanzo.svc:9000
    database: traces
    ttl: 720h  # 30 days retention

  prometheus:
    endpoint: 0.0.0.0:8889
    namespace: hanzo_traces

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch, attributes]
      exporters: [clickhouse]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [prometheus]
```

### Logs: Structured JSON to ClickHouse

All services MUST emit structured JSON logs to stdout. The Zap sidecar (or a node-level Fluentd DaemonSet) forwards these to ClickHouse.

#### Log Format

```json
{
  "ts": "2025-01-15T10:30:00.123Z",
  "level": "info",
  "msg": "request completed",
  "service": "llm-gateway",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "http.method": "POST",
  "http.path": "/v1/chat/completions",
  "http.status": 200,
  "latency_ms": 1250,
  "provider": "openai",
  "model": "gpt-4",
  "tokens.input": 150,
  "tokens.output": 230,
  "org_id": "hanzo",
  "user_id": "usr_abc123"
}
```

#### ClickHouse Schema

```sql
CREATE TABLE hanzo_logs (
    ts          DateTime64(3),
    level       LowCardinality(String),
    service     LowCardinality(String),
    msg         String,
    trace_id    FixedString(32),
    span_id     FixedString(16),
    org_id      LowCardinality(String),
    user_id     String,
    attributes  Map(String, String)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (service, ts)
TTL ts + INTERVAL 90 DAY
SETTINGS index_granularity = 8192;
```

ClickHouse is chosen for logs because:
1. Columnar storage compresses JSON logs 10-20x
2. SQL query interface familiar to all engineers
3. Already deployed as the Zap datastore backend
4. Can handle 500K+ inserts/sec on a single node

### Sidecar Deployment

#### Kubernetes Admission Webhook (Automated)

The Zap mutating webhook automatically injects sidecar containers into pods with the `hanzo.ai/zap: "true"` annotation:

```yaml
apiVersion: v1
kind: Pod
metadata:
  annotations:
    hanzo.ai/zap: "true"
    hanzo.ai/zap-mode: "sql"
    hanzo.ai/zap-backend: "postgres.hanzo.svc:5432"
spec:
  containers:
  - name: app
    image: hanzoai/iam:latest
    ports:
    - containerPort: 8000
  # Sidecar injected automatically by webhook:
  # - name: zap
  #   image: ghcr.io/hanzoai/zap:latest
  #   args: ["--mode=sql", "--backend=postgres.hanzo.svc:5432"]
  #   ports:
  #   - containerPort: 9651
  #   resources:
  #     requests: { memory: "16Mi", cpu: "10m" }
  #     limits:   { memory: "64Mi", cpu: "100m" }
```

#### Manual Container Spec (Current Production)

Until the admission webhook is deployed, services add the sidecar manually:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: llm-gateway
spec:
  template:
    spec:
      containers:
      - name: llm-gateway
        image: hanzoai/llm-gateway:latest
        ports:
        - containerPort: 4000

      - name: zap
        image: ghcr.io/hanzoai/zap:latest
        args:
          - "--mode=sql"
          - "--backend=postgres.hanzo.svc:5432"
          - "--port=9651"
        ports:
        - name: zap
          containerPort: 9651
        - name: metrics
          containerPort: 9090
        env:
        - name: ZAP_MODE
          value: "sql"
        resources:
          requests:
            memory: "16Mi"
            cpu: "10m"
          limits:
            memory: "64Mi"
            cpu: "100m"
        readinessProbe:
          httpGet:
            path: /health
            port: 9651
          initialDelaySeconds: 2
          periodSeconds: 10
        livenessProbe:
          httpGet:
            path: /health
            port: 9651
          initialDelaySeconds: 5
          periodSeconds: 15
```

#### Standalone Mode

For services that do not need the ZAP wire protocol (e.g., pure HTTP services), Zap runs in standalone mode as a Prometheus exporter that scrapes the service's `/metrics` endpoint and augments it with pod-level infrastructure metrics:

```bash
zap --mode=standalone \
    --scrape-target=http://localhost:4000/metrics \
    --port=9651
```

### Service Mesh Integration

Zap is compatible with Istio and Linkerd service meshes. When a mesh sidecar (Envoy/Linkerd-proxy) is present, Zap defers network metrics to the mesh and focuses on application-specific metrics:

```yaml
# Istio: merge Zap metrics with Envoy metrics
apiVersion: networking.istio.io/v1alpha3
kind: EnvoyFilter
metadata:
  name: zap-metrics-merge
spec:
  configPatches:
  - applyTo: CLUSTER
    match:
      context: SIDECAR_OUTBOUND
    patch:
      operation: ADD
      value:
        name: zap-metrics
        type: STATIC
        load_assignment:
          cluster_name: zap-metrics
          endpoints:
          - lb_endpoints:
            - endpoint:
                address:
                  socket_address:
                    address: 127.0.0.1
                    port_value: 9651
```

### Custom Metrics SDK

Services that need to export custom metrics beyond what the sidecar auto-collects can use the Hanzo metrics SDK.

#### Go SDK

```go
package main

import (
    "github.com/hanzoai/zap/metrics"
)

var (
    requestDuration = metrics.NewHistogram(metrics.HistogramOpts{
        Namespace: "hanzo",
        Subsystem: "llm",
        Name:      "request_duration_seconds",
        Help:      "LLM request duration in seconds",
        Buckets:   metrics.LLMLatencyBuckets,
    })

    tokensProcessed = metrics.NewCounter(metrics.CounterOpts{
        Namespace: "hanzo",
        Subsystem: "llm",
        Name:      "tokens_total",
        Help:      "Total tokens processed",
    }, []string{"direction", "model", "provider"})
)

func handleRequest(provider, model string) {
    timer := metrics.NewTimer(requestDuration)
    defer timer.ObserveDuration()

    // ... process request ...

    tokensProcessed.WithLabelValues("input", model, provider).Add(150)
    tokensProcessed.WithLabelValues("output", model, provider).Add(230)
}
```

#### Python SDK

```python
from hanzo.metrics import Counter, Histogram, start_metrics_server

request_duration = Histogram(
    "hanzo_llm_request_duration_seconds",
    "LLM request duration in seconds",
    labelnames=["provider", "model", "status"],
    buckets=[0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0],
)

tokens_total = Counter(
    "hanzo_llm_tokens_total",
    "Total tokens processed",
    labelnames=["direction", "model", "provider"],
)

# Expose /metrics on port 9090
start_metrics_server(port=9090)

@request_duration.labels(provider="openai", model="gpt-4", status="200").time()
async def handle_completion(request):
    response = await call_provider(request)
    tokens_total.labels(direction="input", model="gpt-4", provider="openai").inc(
        response.usage.prompt_tokens
    )
    tokens_total.labels(direction="output", model="gpt-4", provider="openai").inc(
        response.usage.completion_tokens
    )
    return response
```

#### TypeScript SDK

```typescript
import { Counter, Histogram, startMetricsServer } from '@hanzoai/metrics';

const requestDuration = new Histogram({
  name: 'hanzo_llm_request_duration_seconds',
  help: 'LLM request duration in seconds',
  labelNames: ['provider', 'model', 'status'],
  buckets: [0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0],
});

const tokensTotal = new Counter({
  name: 'hanzo_llm_tokens_total',
  help: 'Total tokens processed',
  labelNames: ['direction', 'model', 'provider'],
});

// Expose /metrics on port 9090
startMetricsServer({ port: 9090 });
```

## Implementation

### Current Production State

As of January 2025, the observability stack is deployed in standalone mode on the `hanzo-k8s` cluster (`24.199.76.156`):

```
┌─────────────────────────────────────────────────────────┐
│                   hanzo-k8s cluster                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐              │
│  │ IAM     │  │ LLM GW   │  │ Console  │  ...services │
│  │ :8000   │  │ :4000    │  │ :3000    │              │
│  └────┬────┘  └────┬─────┘  └────┬─────┘              │
│       │            │             │                      │
│       └────────────┼─────────────┘                      │
│                    │ /metrics                            │
│               ┌────▼─────┐                              │
│               │Prometheus│ :9090                        │
│               └────┬─────┘                              │
│                    │                                    │
│               ┌────▼─────┐     ┌────────────┐          │
│               │ Grafana  │────▶│ ClickHouse │          │
│               │ :3000    │     │ :8123      │          │
│               └──────────┘     └────────────┘          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Note**: The Zap sidecar is temporarily removed from KV pods due to an authentication configuration gap (KV password injection via K8s secrets is not yet wired into the sidecar container spec). Services currently expose `/metrics` directly for Prometheus scraping.

### Prometheus Configuration

```yaml
# prometheus.yml on hanzo-k8s
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'hanzo-services'
    kubernetes_sd_configs:
      - role: pod
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        action: keep
        regex: true
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_port]
        action: replace
        target_label: __address__
        regex: (.+)
        replacement: ${1}

  - job_name: 'llm-gateway'
    static_configs:
      - targets: ['llm-gateway.hanzo.svc:4000']
    metrics_path: /metrics

  - job_name: 'iam'
    static_configs:
      - targets: ['iam.hanzo.svc:8000']
    metrics_path: /metrics

  - job_name: 'zap-sidecars'
    kubernetes_sd_configs:
      - role: pod
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_container_name]
        action: keep
        regex: zap
      - source_labels: [__meta_kubernetes_pod_container_port_name]
        action: keep
        regex: metrics
```

### Grafana Dashboards

Three standard dashboards ship with every Hanzo deployment:

#### 1. LLM Operations Dashboard

Key panels:
- Request rate by provider (stacked bar)
- P50/P95/P99 latency by model (time series)
- Token throughput: input vs output (dual-axis)
- Error rate by provider with alerting threshold
- Cache hit ratio (gauge)
- Cost accumulation (USD, running total)

```json
{
  "title": "Hanzo LLM Operations",
  "panels": [
    {
      "title": "Request Rate by Provider",
      "type": "timeseries",
      "targets": [{
        "expr": "sum(rate(hanzo_llm_request_duration_seconds_count[5m])) by (provider)"
      }]
    },
    {
      "title": "P95 Latency by Model",
      "type": "timeseries",
      "targets": [{
        "expr": "histogram_quantile(0.95, sum(rate(hanzo_llm_request_duration_seconds_bucket[5m])) by (le, model))"
      }]
    },
    {
      "title": "Token Throughput",
      "type": "timeseries",
      "targets": [{
        "expr": "sum(rate(hanzo_llm_tokens_total[5m])) by (direction)"
      }]
    }
  ]
}
```

#### 2. Infrastructure Health Dashboard

Key panels:
- Pod CPU/memory usage across all services
- Network I/O per service
- Pod restart count with annotations
- Disk usage for persistent volumes
- Node resource allocation

#### 3. IAM & Security Dashboard

Key panels:
- Login success/failure rate
- Active sessions by organization
- Token issuance rate
- OAuth flow completion funnel
- Failed authentication geolocation

### Alerting Rules

```yaml
# alerting-rules.yml
groups:
  - name: hanzo-llm
    rules:
      - alert: HighLLMLatency
        expr: histogram_quantile(0.95, rate(hanzo_llm_request_duration_seconds_bucket[5m])) > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "LLM P95 latency above 10s for {{ $labels.model }}"

      - alert: ProviderDown
        expr: up{job="llm-gateway"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "LLM Gateway is unreachable"

      - alert: HighErrorRate
        expr: sum(rate(hanzo_llm_provider_errors_total[5m])) / sum(rate(hanzo_llm_request_duration_seconds_count[5m])) > 0.05
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "LLM error rate above 5%"

  - name: hanzo-infra
    rules:
      - alert: PodMemoryHigh
        expr: hanzo_pod_memory_bytes{type="rss"} / on(pod) kube_pod_container_resource_limits{resource="memory"} > 0.9
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Pod {{ $labels.pod }} memory usage above 90%"

      - alert: PodRestarting
        expr: increase(hanzo_pod_restarts_total[1h]) > 3
        for: 0m
        labels:
          severity: critical
        annotations:
          summary: "Pod {{ $labels.pod }} restarted {{ $value }} times in 1h"
```

## Security

### Metrics Endpoint Authentication

Prometheus scraping endpoints MUST be protected in production:

```yaml
# Option 1: Bearer token authentication
scrape_configs:
  - job_name: 'hanzo-services'
    bearer_token_file: /var/run/secrets/prometheus/token
    tls_config:
      ca_file: /var/run/secrets/prometheus/ca.crt

# Option 2: mTLS (preferred for inter-cluster)
scrape_configs:
  - job_name: 'hanzo-services'
    scheme: https
    tls_config:
      cert_file: /var/run/secrets/prometheus/client.crt
      key_file: /var/run/secrets/prometheus/client.key
      ca_file: /var/run/secrets/prometheus/ca.crt
```

### Network Policies

Restrict Prometheus scraping to the monitoring namespace:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-prometheus-scrape
  namespace: hanzo
spec:
  podSelector:
    matchLabels:
      hanzo.ai/metrics: "true"
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: monitoring
      podSelector:
        matchLabels:
          app: prometheus
    ports:
    - protocol: TCP
      port: 9090
    - protocol: TCP
      port: 9651
```

### PII Filtering in Traces and Logs

Traces and logs MUST NOT contain personally identifiable information. The OTLP collector and log pipeline apply filtering:

1. **Email addresses**: Hashed with SHA-256 before storage
2. **IP addresses**: Last octet zeroed (e.g., `192.168.1.0`)
3. **API keys**: Replaced with `sk-...XXXX` (last 4 chars only)
4. **SQL parameters**: Query parameters stripped; only query shape retained
5. **Request/response bodies**: Never stored in traces (attribute deleted by collector)

```go
// PII filter applied in Zap sidecar before forwarding
func FilterPII(attrs map[string]string) map[string]string {
    filtered := make(map[string]string, len(attrs))
    for k, v := range attrs {
        switch {
        case k == "user.email":
            filtered[k] = sha256Hex(v)
        case k == "http.client_ip":
            filtered[k] = zeroLastOctet(v)
        case strings.HasPrefix(v, "sk-"):
            filtered[k] = v[:3] + "..." + v[len(v)-4:]
        default:
            filtered[k] = v
        }
    }
    return filtered
}
```

### Audit Trail

All access to Grafana dashboards and Prometheus queries is logged:

```json
{
  "ts": "2025-01-15T14:22:00Z",
  "action": "grafana.dashboard.view",
  "user": "z@hanzo.ai",
  "dashboard": "llm-operations",
  "source_ip": "10.244.0.15",
  "org_id": "hanzo"
}
```

## Backward Compatibility

Services that already expose Prometheus metrics on `/metrics` require zero changes. The Zap sidecar and Prometheus scrape configuration discover and collect these metrics automatically.

Services using custom logging formats should migrate to structured JSON over time. During the transition, Zap supports a `--log-format=text` flag that parses common log formats (Apache, Nginx, syslog) into the standard JSON schema.

## References

1. [HIP-007-zap.md](./HIP-007-zap.md) -- ZAP (Zero-copy Agent Protocol) wire protocol specification
2. [HIP-4: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md) -- Unified AI provider interface
3. [HIP-17: Analytics Event Standard](./hip-0017-analytics-event-standard.md) -- Application-level event tracking
4. [HIP-20: Blockchain Node Standard](./hip-0020-blockchain-node-standard.md) -- Node metrics interface
5. [Prometheus Documentation](https://prometheus.io/docs/)
6. [OpenTelemetry Specification](https://opentelemetry.io/docs/specs/)
7. [ClickHouse Documentation](https://clickhouse.com/docs)
8. [Zap Repository](https://github.com/hanzoai/zap) -- Reference implementation
9. [luxfi/zap](https://github.com/luxfi/zap) -- ZAP wire protocol library (Cap'n Proto)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
