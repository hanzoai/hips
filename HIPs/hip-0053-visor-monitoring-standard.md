---
hip: 0053
title: Visor Monitoring & Supervision Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-02-23
---

# HIP-53: Visor Monitoring & Supervision Standard

## Abstract

This proposal defines the monitoring, visualization, and supervision standard for the Hanzo ecosystem. **Hanzo Visor** provides real-time dashboards, AI-specific metrics, anomaly detection, alert management, SLA tracking, and cost attribution across all Hanzo services.

Visor is the presentation and intelligence layer that sits on top of the observability stack (HIP-0031, Zap) and the analytics platform (HIP-0017, Insights). Zap collects metrics, traces, and logs. Insights collects product analytics. Visor consumes both data streams and turns them into actionable dashboards, intelligent alerts, and cost reports. It is the single pane of glass through which operators, engineers, and business stakeholders understand the health, performance, and economics of the Hanzo platform.

**Repository**: [github.com/hanzoai/visor](https://github.com/hanzoai/visor)
**Docker**: `ghcr.io/hanzoai/visor:latest`
**API Port**: 8053
**Grafana Port**: 3053
**Production**: `visor.hanzo.ai` on `hanzo-k8s` cluster (`24.199.76.156`)

## Motivation

### The Gap Between Collection and Understanding

HIP-0031 (Zap) solved the data collection problem. Prometheus scrapes metrics every 15 seconds. ClickHouse stores structured logs. OpenTelemetry traces connect requests across services. But raw data is not understanding.

An engineer staring at Prometheus's built-in expression browser cannot answer: "Is the LLM Gateway healthy right now?" They can write a PromQL query, interpret the result, compare it to yesterday, and decide. That takes minutes. A well-designed dashboard answers the question in two seconds.

The gap is wider for AI workloads. Traditional infrastructure monitoring measures CPU, memory, and request latency. AI services have additional dimensions that matter: tokens per second, cost per request, model error rates, cache hit ratios, time-to-first-token, and prompt/completion token ratios. No off-the-shelf Grafana dashboard covers these.

### Why Monitoring AI Is Different

A typical web service processes a request in 50-200ms. The response size is predictable. Failure modes are well-understood: timeouts, 5xx errors, database connection exhaustion.

An LLM request takes 1-120 seconds. Response size varies by orders of magnitude (10 tokens to 4,096 tokens). Cost per request varies by 1000x depending on the model ($0.0001 for a small Zen model, $0.10 for a frontier model with long context). Failure modes include provider rate limits, content filtering, context length exceeded, model degradation (the model returns garbage but HTTP 200), and cost runaway (a bug sends expensive requests in a loop).

These failure modes require AI-specific metrics and AI-specific alerting logic. A traditional "error rate > 5%" alert misses model degradation entirely because the HTTP response is 200. A cost-aware alert that fires when spend exceeds $X/hour catches it immediately.

### Why a Separate Service From O11y

The temptation is to add dashboards and alerting directly to the Zap sidecar (HIP-0031). We deliberately separate them for three reasons:

1. **Separation of concerns**: Zap is a data plane component. It runs as a sidecar in every pod, must be tiny (~15MB RSS), and must never become a bottleneck. Adding Grafana, alert evaluation, cost calculation, and anomaly detection to the sidecar would bloat it and create failure coupling.

2. **Different scaling profiles**: Zap scales with the number of pods (one sidecar per pod). Visor scales with the number of dashboards, alerts, and users viewing them. These are independent dimensions.

3. **Different update cadences**: Dashboards and alert rules change frequently as we add services and refine thresholds. The sidecar binary changes rarely. Coupling them means redeploying every sidecar to update a dashboard.

**Visor = control plane. Zap = data plane.** The same separation that exists between Kubernetes's API server (control plane) and kubelet (data plane).

### Cost Attribution: The Business Case

At Hanzo's scale, LLM API costs are the largest operational expense. In January 2026, LLM provider spend exceeded compute infrastructure spend for the first time. Without per-org, per-user, per-model cost attribution, we cannot:

- Bill customers accurately for API usage
- Identify which models offer the best cost/quality ratio
- Detect cost anomalies (a misconfigured agent calling GPT-4 in a loop)
- Plan capacity and budget for the next quarter

Visor provides this attribution by joining LLM Gateway metrics (HIP-0031 `hanzo_llm_*` counters) with pricing data from provider rate cards, broken down by organization, user, model, and endpoint.

## Design Philosophy

### Why Grafana Over a Custom Dashboard

We evaluated three approaches for the visualization layer:

| Approach | Build Time | Maintenance | Ecosystem | Extensibility |
|----------|-----------|-------------|-----------|---------------|
| Custom React app | 3-6 months | High (every panel custom) | None | Unlimited but costly |
| Grafana (open-source) | 2-4 weeks | Low (community maintains) | 100+ data source plugins | Custom plugins when needed |
| Datadog/New Relic SaaS | 0 | Zero (vendor manages) | Vendor-locked | Limited |

**Custom React app**: Maximum control, maximum cost. Every chart, every filter, every time-range selector must be built and maintained. We estimated 3-6 engineer-months for a minimum viable dashboard, with ongoing maintenance consuming 20-30% of one engineer's time. This is a poor allocation when the same engineer could build AI features.

**Grafana**: Open-source (AGPL v3), battle-tested at scale (Netflix, Uber, GitLab all use it), supports Prometheus and ClickHouse natively, has a rich plugin ecosystem, and allows custom plugins for domain-specific visualizations. Setup time: days, not months. The trade-off is that Grafana's UI is opinionated -- but its opinions are good, refined over a decade of usage.

**SaaS (Datadog/New Relic)**: Zero build time, but $12K-18K/month at our volume (see HIP-0031 cost analysis), vendor lock-in, and no custom AI-specific panels. The cost alone disqualifies this option.

**Decision**: Grafana with custom plugins for AI-specific visualizations. We get 90% of the dashboard functionality for free, and build the remaining 10% (AI metrics panels, cost attribution views) as Grafana plugins.

### Why AI Monitoring AI (Anomaly Detection)

Static alert thresholds break down for AI workloads. LLM latency has high variance by nature: a 10-token completion takes 500ms, a 4096-token completion takes 30 seconds. Setting a static threshold of "P95 > 10s" either alerts constantly (too sensitive) or misses real degradation (too lenient).

Visor uses a lightweight anomaly detection model that learns normal behavior patterns per model and per endpoint. The model is deliberately simple -- a sliding-window z-score over the last 24 hours with seasonal adjustment for time-of-day patterns. No deep learning, no GPU required. The anomaly detector runs as a goroutine inside the Visor API server, consuming Prometheus query results.

This is "AI monitoring AI" in the most literal sense: a statistical model watching the behavior of language models. The meta-recursion is intentional. The monitoring model is small (megabytes of state), deterministic (reproducible anomaly scores), and explainable (z-score with a clear threshold). It does not suffer from the same failure modes as the models it monitors.

### Integration Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                      Visor (visor.hanzo.ai)                       │
├──────────────────┬──────────────────┬─────────────────────────────┤
│  Grafana (:3053) │ Visor API (:8053)│  Anomaly Detector (internal)│
│  - AI Dashboards │ - Cost Engine    │  - Z-score per metric       │
│  - SLA Panels    │ - Alert Router   │  - Seasonal adjustment      │
│  - Custom Plugins│ - SLA Tracker    │  - 24h sliding window       │
└────────┬─────────┴────────┬─────────┴──────────┬──────────────────┘
         │                  │                     │
    ┌────▼────┐       ┌─────▼──────┐        ┌────▼─────┐
    │Prometheus│       │ClickHouse  │        │ Insights │
    │(HIP-0031)│       │(HIP-0031)  │        │(HIP-0017)│
    │ Metrics  │       │Logs/Traces │        │Analytics │
    └──────────┘       └────────────┘        └──────────┘
```

Visor reads from Prometheus (real-time metrics), ClickHouse (historical logs and traces), and Insights (business analytics). It does not duplicate data collection -- that remains Zap's responsibility (HIP-0031). Visor only consumes, transforms, visualizes, and alerts.

## Specification

### AI-Specific Metrics

Beyond the standard infrastructure metrics defined in HIP-0031, Visor tracks and visualizes AI-specific metrics that the Grafana dashboards present:

#### Token Throughput

```promql
# Tokens per second (input), 5-minute rate
sum(rate(hanzo_llm_tokens_total{direction="input"}[5m]))

# Tokens per second (output), per model
sum(rate(hanzo_llm_tokens_total{direction="output"}[5m])) by (model)

# Token ratio (output/input) -- measures model verbosity
sum(rate(hanzo_llm_tokens_total{direction="output"}[5m])) by (model)
  /
sum(rate(hanzo_llm_tokens_total{direction="input"}[5m])) by (model)
```

#### Latency Percentiles

```promql
# P50 latency by model
histogram_quantile(0.50, sum(rate(hanzo_llm_request_duration_seconds_bucket[5m])) by (le, model))

# P95 latency by model
histogram_quantile(0.95, sum(rate(hanzo_llm_request_duration_seconds_bucket[5m])) by (le, model))

# P99 latency by model
histogram_quantile(0.99, sum(rate(hanzo_llm_request_duration_seconds_bucket[5m])) by (le, model))

# Time-to-first-token (streaming requests only)
histogram_quantile(0.95, sum(rate(hanzo_llm_ttft_seconds_bucket[5m])) by (le, model))
```

#### Error Classification

```promql
# Error rate by provider and error type
sum(rate(hanzo_llm_provider_errors_total[5m])) by (provider, error)

# Model-level error rate (errors / total requests)
sum(rate(hanzo_llm_provider_errors_total[5m])) by (model)
  /
sum(rate(hanzo_llm_request_duration_seconds_count[5m])) by (model)

# Rate limit events (a leading indicator of provider saturation)
sum(rate(hanzo_llm_provider_errors_total{error="rate_limit"}[5m])) by (provider)
```

#### Cost Per Request

Cost is not a Prometheus metric -- it is computed by the Visor API server by joining token counts with pricing tables:

```json
{
  "cost_per_request": {
    "model": "gpt-4-turbo",
    "input_tokens": 1500,
    "output_tokens": 500,
    "input_cost_per_1k": 0.01,
    "output_cost_per_1k": 0.03,
    "total_cost_usd": 0.030
  }
}
```

The Visor API exposes a `/api/v1/costs` endpoint that Grafana queries via the JSON API data source plugin. Pricing tables are maintained in a YAML configuration file:

```yaml
# visor-pricing.yaml
providers:
  openai:
    gpt-4-turbo:
      input_per_1k_tokens: 0.01
      output_per_1k_tokens: 0.03
    gpt-4o:
      input_per_1k_tokens: 0.0025
      output_per_1k_tokens: 0.01
  anthropic:
    claude-3-opus:
      input_per_1k_tokens: 0.015
      output_per_1k_tokens: 0.075
    claude-3-sonnet:
      input_per_1k_tokens: 0.003
      output_per_1k_tokens: 0.015
  together:
    zen-72b:
      input_per_1k_tokens: 0.0009
      output_per_1k_tokens: 0.0009
    zen-8b:
      input_per_1k_tokens: 0.0002
      output_per_1k_tokens: 0.0002
```

### Cost Attribution

Visor attributes costs along four dimensions:

| Dimension | Source | Granularity |
|-----------|--------|-------------|
| Organization | `hanzo.org_id` span attribute | Per-org totals, hourly/daily/monthly |
| User | `user_id` property from LLM Gateway logs | Per-user totals |
| Model | `model` label on `hanzo_llm_tokens_total` | Per-model cost breakdown |
| Endpoint | `http.path` span attribute | Per-API-endpoint cost |

#### Cost Attribution Query

```sql
-- ClickHouse: daily cost by organization and model (last 30 days)
SELECT
    toDate(ts) AS day,
    JSONExtractString(attributes, 'org_id') AS org,
    JSONExtractString(attributes, 'model') AS model,
    sum(JSONExtractFloat(attributes, 'cost_usd')) AS total_cost_usd,
    sum(JSONExtractUInt(attributes, 'tokens.input')) AS input_tokens,
    sum(JSONExtractUInt(attributes, 'tokens.output')) AS output_tokens
FROM hanzo_logs
WHERE service = 'llm-gateway'
  AND msg = 'request completed'
  AND ts >= now() - INTERVAL 30 DAY
GROUP BY day, org, model
ORDER BY day DESC, total_cost_usd DESC
```

### SLA Monitoring

Visor tracks uptime and performance SLAs per service. SLA definitions are stored in the Visor API configuration:

```yaml
# visor-slas.yaml
slas:
  llm-gateway:
    availability: 99.9          # percentage uptime target
    p95_latency_ms: 10000       # max acceptable P95 latency
    error_rate: 0.01            # max 1% error rate
    measurement_window: 30d     # rolling 30-day window

  iam:
    availability: 99.95
    p95_latency_ms: 500
    error_rate: 0.001
    measurement_window: 30d

  insights-capture:
    availability: 99.99
    p95_latency_ms: 100
    error_rate: 0.001
    measurement_window: 30d
```

SLA status is computed from Prometheus metrics:

```promql
# Availability: fraction of time the service returned non-5xx responses
1 - (
  sum(rate(hanzo_llm_provider_errors_total{error=~"5.."}[30d]))
  /
  sum(rate(hanzo_llm_request_duration_seconds_count[30d]))
)

# SLA burn rate: how fast are we consuming our error budget?
# A burn rate of 1.0 means we will exactly exhaust the budget over the window.
# Above 1.0 means we are burning faster than sustainable.
(
  sum(rate(hanzo_llm_provider_errors_total[1h]))
  /
  sum(rate(hanzo_llm_request_duration_seconds_count[1h]))
)
/
(1 - 0.999)  # error budget = 1 - SLA target
```

### Anomaly Detection

The Visor anomaly detector evaluates metrics every 60 seconds. For each monitored metric, it computes a z-score against the 24-hour baseline, adjusted for time-of-day seasonality.

#### Algorithm

```
For each metric M at time T:
  1. Fetch M values for the same hour-of-day over the last 7 days
  2. Compute mean(M) and stddev(M) from that window
  3. Fetch current M value
  4. z_score = (current - mean) / stddev
  5. If |z_score| > threshold (default 3.0), emit anomaly alert
```

#### Configuration

```yaml
# visor-anomaly.yaml
anomaly_detection:
  enabled: true
  evaluation_interval: 60s
  default_threshold: 3.0        # standard deviations
  seasonal_window: 7d           # lookback for baseline
  min_data_points: 48           # minimum samples before alerting (avoid cold-start noise)

  metrics:
    - name: hanzo_llm_request_duration_seconds
      quantile: 0.95
      threshold: 3.0
      labels: [model, provider]

    - name: hanzo_llm_tokens_total
      rate_interval: 5m
      threshold: 2.5            # more sensitive for throughput drops
      labels: [direction, model]

    - name: hanzo_llm_provider_errors_total
      rate_interval: 5m
      threshold: 2.0            # very sensitive for error spikes
      labels: [provider, error]
```

### Alert Management

Visor routes alerts to multiple channels. Prometheus Alertmanager evaluates rules; Visor enriches alerts with context (cost impact, affected users, historical frequency) and routes them.

#### Alert Routing

```yaml
# visor-alerts.yaml
routes:
  - match:
      severity: critical
    receivers: [pagerduty, slack-critical]
    repeat_interval: 5m
    group_wait: 30s

  - match:
      severity: warning
    receivers: [slack-warnings]
    repeat_interval: 30m
    group_wait: 2m

  - match:
      severity: info
      type: anomaly
    receivers: [slack-ai-ops]
    repeat_interval: 1h

  - match:
      type: cost
    receivers: [slack-finance, webhook-billing]
    repeat_interval: 6h

receivers:
  pagerduty:
    type: pagerduty
    service_key: "${PAGERDUTY_SERVICE_KEY}"
    severity_map:
      critical: critical
      warning: warning

  slack-critical:
    type: slack
    webhook_url: "${SLACK_CRITICAL_WEBHOOK}"
    channel: "#incidents"
    mention: "@oncall"

  slack-warnings:
    type: slack
    webhook_url: "${SLACK_WARNINGS_WEBHOOK}"
    channel: "#monitoring"

  slack-ai-ops:
    type: slack
    webhook_url: "${SLACK_AI_OPS_WEBHOOK}"
    channel: "#ai-ops"

  webhook-billing:
    type: webhook
    url: "https://commerce.hanzo.ai/api/v1/alerts"
    method: POST
    headers:
      Authorization: "Bearer ${COMMERCE_API_TOKEN}"
```

#### AI-Specific Alert Rules

```yaml
groups:
  - name: visor-ai
    rules:
      - alert: LLMCostSpike
        expr: |
          sum(rate(hanzo_llm_tokens_total[5m]) * on(model)
            group_left visor_model_cost_per_token) by (org_id)
          > 10
        for: 5m
        labels:
          severity: warning
          type: cost
        annotations:
          summary: "Org {{ $labels.org_id }} spending >$10/min on LLM"
          runbook: "https://visor.hanzo.ai/runbooks/cost-spike"

      - alert: ModelDegradation
        expr: |
          visor_anomaly_score{metric="hanzo_llm_request_duration_seconds"} > 3.0
            and
          rate(hanzo_llm_provider_errors_total[5m]) < 0.01
        for: 10m
        labels:
          severity: warning
          type: anomaly
        annotations:
          summary: "Model {{ $labels.model }} latency anomaly (z={{ $value }}) with low error rate -- possible degradation"

      - alert: ProviderRateLimitEscalation
        expr: |
          rate(hanzo_llm_provider_errors_total{error="rate_limit"}[5m])
          / rate(hanzo_llm_request_duration_seconds_count[5m])
          > 0.10
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Provider {{ $labels.provider }} rate-limiting >10% of requests"

      - alert: SLABurnRateHigh
        expr: visor_sla_burn_rate > 5.0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Service {{ $labels.service }} burning SLA error budget 5x faster than sustainable"

      - alert: CacheEfficiencyDrop
        expr: |
          rate(hanzo_llm_cache_hit_total[1h])
          / (rate(hanzo_llm_cache_hit_total[1h]) + rate(hanzo_llm_cache_miss_total[1h]))
          < 0.20
        for: 30m
        labels:
          severity: warning
        annotations:
          summary: "Semantic cache hit rate below 20% -- check cache invalidation"
```

### Grafana Dashboards

Visor ships five standard dashboards, provisioned automatically via Grafana's dashboard-as-code:

#### 1. AI Operations Overview

The primary dashboard for AI platform operators. Six rows, twelve panels:

| Row | Panels | Purpose |
|-----|--------|---------|
| Request Flow | Request rate (stacked by provider), Active requests gauge | Traffic volume |
| Latency | P50/P95/P99 time series by model, TTFT distribution | Performance |
| Tokens | Input/output token rate, Token ratio by model | Throughput |
| Errors | Error rate by provider, Error classification pie chart | Reliability |
| Cost | Hourly cost accumulation, Cost by org (top 10) | Economics |
| Cache | Cache hit ratio gauge, Cache savings (USD avoided) | Efficiency |

#### 2. Cost Attribution

Breakdown of LLM spend across every dimension. Designed for finance and billing teams.

- Total spend: hourly, daily, monthly time series
- By organization: stacked bar chart
- By model: pie chart with cost-per-1K-token annotation
- By user: table with top 50 spenders
- By endpoint: treemap visualization
- Budget tracking: actual vs. projected spend with alert threshold lines

#### 3. SLA Status

Traffic-light dashboard for service level objectives.

- Per-service availability gauge (green/yellow/red)
- Error budget remaining (percentage bar)
- Burn rate trend (7-day time series)
- Incident timeline (annotations from PagerDuty)
- Monthly SLA report summary table

#### 4. Anomaly Detection

Real-time view of the anomaly detector output.

- Anomaly score time series per metric (z-score with threshold line)
- Active anomalies table (metric, labels, score, duration)
- Historical anomaly frequency heatmap (hour-of-day vs day-of-week)
- False positive rate tracking (operator feedback loop)

#### 5. Infrastructure Health

Extended version of HIP-0031's infrastructure dashboard, with Visor-specific additions:

- Cross-service dependency graph (which services call which)
- Pod resource utilization with headroom indicators
- Database connection pool saturation
- Kafka consumer lag across all topics

### Custom Grafana Plugins

Visor includes two custom Grafana plugins for AI workload visualization:

#### hanzo-ai-cost-panel

A panel plugin that renders cost attribution with drill-down. Click on an organization to see per-user breakdown. Click on a user to see per-model breakdown. Click on a model to see per-endpoint breakdown. This hierarchical drill-down is not possible with standard Grafana panels.

```
Plugin ID: hanzo-ai-cost-panel
Type: Panel
Data sources: JSON API (Visor /api/v1/costs)
Install: grafana-cli plugins install hanzo-ai-cost-panel
```

#### hanzo-sla-gauge

A panel plugin that renders SLA status as a gauge with error budget consumption. The gauge shows:
- Current availability percentage (large number, color-coded)
- Error budget remaining (progress bar)
- Burn rate arrow (up/down/stable)
- Time until budget exhaustion at current burn rate

```
Plugin ID: hanzo-sla-gauge
Type: Panel
Data sources: Prometheus (via Visor SLA recording rules)
Install: grafana-cli plugins install hanzo-sla-gauge
```

### API Specification

The Visor API server (port 8053) exposes REST endpoints consumed by Grafana, external alerting systems, and the Hanzo CLI.

#### GET /api/v1/costs

Returns cost data for Grafana's JSON API data source.

```http
GET /api/v1/costs?org=hanzo&from=2026-02-01&to=2026-02-23&group_by=model HTTP/1.1
Host: visor.hanzo.ai
Authorization: Bearer ${VISOR_API_TOKEN}
```

Response:
```json
{
  "total_cost_usd": 4231.50,
  "period": {"from": "2026-02-01", "to": "2026-02-23"},
  "breakdown": [
    {"model": "gpt-4-turbo", "cost_usd": 1850.20, "requests": 62340, "tokens": 45000000},
    {"model": "claude-3-sonnet", "cost_usd": 1120.80, "requests": 89200, "tokens": 38000000},
    {"model": "zen-72b", "cost_usd": 620.30, "requests": 340000, "tokens": 120000000},
    {"model": "zen-8b", "cost_usd": 640.20, "requests": 1200000, "tokens": 280000000}
  ]
}
```

#### GET /api/v1/sla

Returns current SLA status for all monitored services.

```http
GET /api/v1/sla HTTP/1.1
Host: visor.hanzo.ai
Authorization: Bearer ${VISOR_API_TOKEN}
```

Response:
```json
{
  "services": [
    {
      "name": "llm-gateway",
      "target": 99.9,
      "current": 99.94,
      "budget_remaining_pct": 42.0,
      "burn_rate": 0.8,
      "window": "30d",
      "status": "healthy"
    },
    {
      "name": "iam",
      "target": 99.95,
      "current": 99.98,
      "budget_remaining_pct": 71.0,
      "burn_rate": 0.4,
      "window": "30d",
      "status": "healthy"
    }
  ]
}
```

#### GET /api/v1/anomalies

Returns active anomalies detected by the anomaly engine.

```http
GET /api/v1/anomalies?active=true HTTP/1.1
Host: visor.hanzo.ai
Authorization: Bearer ${VISOR_API_TOKEN}
```

Response:
```json
{
  "anomalies": [
    {
      "metric": "hanzo_llm_request_duration_seconds",
      "labels": {"model": "gpt-4-turbo", "quantile": "0.95"},
      "z_score": 3.4,
      "current_value": 18.2,
      "baseline_mean": 8.1,
      "baseline_stddev": 2.97,
      "detected_at": "2026-02-23T14:30:00Z",
      "duration_seconds": 600
    }
  ]
}
```

## Implementation

### Deployment Architecture

Visor runs three containers on the `hanzo-k8s` cluster:

| Component | Image | Port | CPU | Memory | Purpose |
|-----------|-------|------|-----|--------|---------|
| `visor-api` | `ghcr.io/hanzoai/visor:latest` | 8053 | 250m | 256Mi | Cost engine, SLA tracker, anomaly detector, alert router |
| `visor-grafana` | `grafana/grafana-oss:11.x` | 3053 | 250m | 512Mi | Dashboards, custom plugins |
| `visor-alertmanager` | `prom/alertmanager:0.27` | 9093 | 100m | 128Mi | Alert deduplication, routing, silencing |

Total resource footprint: 600m CPU, 896Mi memory. Minimal overhead for the value delivered.

### Kubernetes Manifests

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: visor-api
  namespace: hanzo
spec:
  replicas: 1
  selector:
    matchLabels:
      app: visor-api
  template:
    metadata:
      labels:
        app: visor-api
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "8053"
    spec:
      containers:
      - name: visor-api
        image: ghcr.io/hanzoai/visor:latest
        ports:
        - containerPort: 8053
          name: api
        env:
        - name: PROMETHEUS_URL
          value: "http://prometheus.hanzo.svc:9090"
        - name: CLICKHOUSE_URL
          value: "tcp://clickhouse.hanzo.svc:9000"
        - name: ALERTMANAGER_URL
          value: "http://visor-alertmanager.hanzo.svc:9093"
        volumeMounts:
        - name: config
          mountPath: /etc/visor
        resources:
          requests: { cpu: "100m", memory: "128Mi" }
          limits:   { cpu: "250m", memory: "256Mi" }
        readinessProbe:
          httpGet:
            path: /health
            port: 8053
          initialDelaySeconds: 5
          periodSeconds: 10
        livenessProbe:
          httpGet:
            path: /health
            port: 8053
          initialDelaySeconds: 10
          periodSeconds: 30
      volumes:
      - name: config
        configMap:
          name: visor-config
---
apiVersion: v1
kind: Service
metadata:
  name: visor-api
  namespace: hanzo
spec:
  selector:
    app: visor-api
  ports:
  - port: 8053
    targetPort: 8053
    name: api
```

### Grafana Provisioning

Dashboards are provisioned as code via ConfigMap. Data sources connect to Prometheus, ClickHouse, and the Visor API:

```yaml
# grafana-datasources.yaml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus.hanzo.svc:9090
    isDefault: true

  - name: ClickHouse
    type: grafana-clickhouse-datasource
    access: proxy
    jsonData:
      host: clickhouse.hanzo.svc
      port: 9000
      defaultDatabase: default

  - name: Visor API
    type: marcusolsson-json-datasource
    access: proxy
    url: http://visor-api.hanzo.svc:8053/api/v1
    jsonData:
      httpHeaderName1: Authorization
    secureJsonData:
      httpHeaderValue1: "Bearer ${VISOR_API_TOKEN}"

  - name: Insights
    type: grafana-clickhouse-datasource
    access: proxy
    jsonData:
      host: insights-clickhouse.hanzo.svc
      port: 9000
      defaultDatabase: posthog
```

### Visor API: Go Implementation

The Visor API server is written in Go for the same reasons as Zap (HIP-0031): small binary, fast startup, low memory, ecosystem alignment.

```go
package main

import (
    "net/http"
    "time"

    "github.com/hanzoai/visor/anomaly"
    "github.com/hanzoai/visor/cost"
    "github.com/hanzoai/visor/sla"
    "github.com/prometheus/client_golang/api"
)

func main() {
    promClient, _ := api.NewClient(api.Config{
        Address: envOrDefault("PROMETHEUS_URL", "http://prometheus:9090"),
    })

    costEngine := cost.NewEngine("visor-pricing.yaml")
    slaTracker := sla.NewTracker("visor-slas.yaml", promClient)
    detector := anomaly.NewDetector("visor-anomaly.yaml", promClient)

    // Start background loops
    go slaTracker.Run(30 * time.Second)
    go detector.Run(60 * time.Second)

    mux := http.NewServeMux()
    mux.HandleFunc("/health", healthHandler)
    mux.HandleFunc("/api/v1/costs", costEngine.Handler)
    mux.HandleFunc("/api/v1/sla", slaTracker.Handler)
    mux.HandleFunc("/api/v1/anomalies", detector.Handler)
    mux.HandleFunc("/metrics", metricsHandler)

    http.ListenAndServe(":8053", mux)
}
```

## Security Considerations

### Access Control

Grafana integrates with Hanzo IAM (hanzo.id) via OAuth2 for single sign-on. Role mapping:

| IAM Role | Grafana Role | Access |
|----------|-------------|--------|
| `org:admin` | Admin | Full dashboard CRUD, data source config, user management |
| `org:member` | Editor | View and edit dashboards, cannot modify data sources |
| `org:viewer` | Viewer | Read-only dashboard access |

```ini
# grafana.ini
[auth.generic_oauth]
enabled = true
name = Hanzo IAM
client_id = ${VISOR_OAUTH_CLIENT_ID}
client_secret = ${VISOR_OAUTH_CLIENT_SECRET}
auth_url = https://hanzo.id/login/oauth/authorize
token_url = https://hanzo.id/api/login/oauth/access_token
api_url = https://hanzo.id/api/userinfo
scopes = openid profile email
role_attribute_path = contains(groups[*], 'admin') && 'Admin' || contains(groups[*], 'editor') && 'Editor' || 'Viewer'
allow_sign_up = true
```

### API Authentication

The Visor API requires a bearer token on all `/api/v1/*` endpoints. Tokens are issued through Hanzo IAM and validated on each request. The `/health` and `/metrics` endpoints are unauthenticated (required for Kubernetes probes and Prometheus scraping).

### Network Isolation

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: visor-api-policy
  namespace: hanzo
spec:
  podSelector:
    matchLabels:
      app: visor-api
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: visor-grafana
    - namespaceSelector:
        matchLabels:
          name: monitoring
    ports:
    - port: 8053
  egress:
  - to:
    - podSelector:
        matchLabels:
          app: prometheus
    ports:
    - port: 9090
  - to:
    - podSelector:
        matchLabels:
          app: clickhouse
    ports:
    - port: 9000
  - to:
    - podSelector:
        matchLabels:
          app: visor-alertmanager
    ports:
    - port: 9093
```

Visor API can only read from Prometheus and ClickHouse, and write to Alertmanager. It has no access to user databases, IAM internals, or the internet.

### Sensitive Data Handling

Cost data and SLA metrics are not PII, but they are commercially sensitive. The Visor API does not log request bodies or response payloads. Cost attribution data is only accessible to users with `org:admin` or `org:member` roles. Per-user cost breakdowns require `org:admin`.

## References

1. [HIP-0031: Observability & Metrics Standard](./hip-0031-observability-metrics-standard.md) -- Data collection layer (Zap)
2. [HIP-0017: Analytics Event Standard](./hip-0017-analytics-event-standard.md) -- Product analytics (Insights)
3. [HIP-0004: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md) -- LLM metrics source
4. [HIP-0030: Event Streaming Standard](./hip-0030-event-streaming-standard.md) -- Kafka infrastructure
5. [Grafana Documentation](https://grafana.com/docs/)
6. [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/)
7. [Grafana Plugin Development](https://grafana.com/developers/plugin-tools/)
8. [Google SRE: Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/)
9. [Visor Repository](https://github.com/hanzoai/visor) -- Reference implementation

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
