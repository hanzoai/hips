---
hip: 0017
title: Analytics Event Standard
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2025-01-09
requires: HIP-0030
---

# HIP-17: Analytics Event Standard

## Abstract

This proposal defines the analytics event standard for the Hanzo ecosystem. All product analytics, session replay, feature flags, and A/B testing MUST use Hanzo Insights as specified in this document. Hanzo Insights is a fork of PostHog, rebranded with Hanzo token prefixes (`ha_`, `hax_`, `has_`, `haa_`), integrated with Hanzo IAM (hanzo.id), and backed by a Rust capture service for high-throughput event ingestion.

**Repository**: [github.com/hanzoai/insights](https://github.com/hanzoai/insights)
**Production**: `insights.hanzo.ai` on `hanzo-k8s` cluster (`24.199.76.156`)
**Capture**: Rust binary at `/e`, `/batch`, `/capture` endpoints
**Storage**: ClickHouse (analytics), Kafka (buffering, HIP-0030), PostgreSQL (metadata), Redis (cache)

## Motivation

Every product team needs answers to the same questions: What are users doing? Where do they drop off? Which features drive retention? What should we build next?

The Hanzo platform spans multiple services -- Chat, Cloud, Commerce, LLM Gateway, Platform -- each generating user interactions that must be tracked, correlated, and analyzed. Without a unified analytics layer:

1. **Each service builds its own tracking**: Inconsistent event schemas, duplicated instrumentation, no cross-service funnels.
2. **Third-party analytics create vendor lock-in**: Amplitude charges $0.001-0.01 per event at scale. At 10M events/day, that is $10K-100K/month. Mixpanel has similar pricing. GA4 is free but Google owns the data.
3. **Data residency becomes uncontrollable**: SaaS analytics send user data to third-party servers. For enterprise customers with data residency requirements, this is a dealbreaker.
4. **Session replay requires a separate vendor**: FullStory, LogRocket, and Hotjar each charge $300-1000/month and only cover replay -- not analytics, feature flags, or experiments.

We need ONE platform that provides product analytics, session replay, feature flags, A/B testing, and funnel analysis -- self-hosted, with a single event schema that all Hanzo services share.

## Design Philosophy

This section explains the architectural decisions behind Hanzo Insights. Understanding the *why* is essential for correct integration and for evaluating future alternatives.

### Why PostHog Over Amplitude / Mixpanel / GA4

The core question is: **who owns the data, and what does it cost at scale?**

**PostHog** is open-source (MIT license for core, paid features available). It is self-hosted, meaning all event data stays on our infrastructure. It provides product analytics, session replay, feature flags, A/B testing, surveys, and data pipelines in a single platform. The open-source model means we can inspect, modify, and extend every component.

**Amplitude** is a SaaS product analytics platform. It charges per Monthly Tracked User (MTU). Pricing starts at $0 for up to 10M events/month (Starter), then jumps to $49K+/year (Growth) based on MTU count. At our scale -- multiple products, millions of events per day -- Amplitude costs six figures annually. More critically, all event data lives on Amplitude's infrastructure. We cannot run custom ClickHouse queries against it. We cannot join analytics data with our billing or IAM data without exporting it.

**Mixpanel** has a similar pricing model. $0 for up to 20M events/month, then per-event pricing that scales aggressively. The data export API has rate limits that make bulk analysis painful. Like Amplitude, it is a black box -- we send events in but cannot run arbitrary queries against the underlying storage.

**GA4 (Google Analytics 4)** is free for standard use. The cost is that Google owns the data. GA4 data feeds Google's ad ecosystem. GA4's event model is rigid (predefined events with limited custom properties). Session replay is not included. Feature flags are not included. BigQuery export is available but adds latency and cost. For a company building an AI platform, handing user behavior data to Google is a strategic mistake.

**PostHog gives us**:
- Product analytics (events, funnels, retention, paths)
- Session replay (DOM snapshots, network waterfall, console logs)
- Feature flags (server-side and client-side evaluation)
- A/B testing (statistical significance calculation, Bayesian and frequentist)
- Surveys (in-app feedback collection)
- Data pipelines (export to S3, BigQuery, Redshift)

All in one platform, self-hosted, with a ClickHouse backend we can query directly.

**Decision**: Fork PostHog. Self-host. Own the data. Eliminate per-event costs at scale.

### Why Fork PostHog (Rather Than Use It Directly)

A vanilla PostHog deployment would work, but we fork for four reasons:

1. **Token prefix rebranding**: PostHog uses `phc_` (project API key), `phx_` (personal API key), `phs_` (session recording), and `pha_` (feature flag). We rebrand these to `ha_` (Hanzo Analytics project key), `hax_` (personal API key), `has_` (session recording), and `haa_` (feature flag). This is a cosmetic but important change -- customers see Hanzo branding throughout, not PostHog.

2. **IAM integration**: PostHog has its own user management. We replace it with Hanzo IAM (hanzo.id) for SSO. Users log into Insights with their Hanzo account. Organizations in Insights map 1:1 to organizations in IAM. This eliminates a separate identity silo.

3. **Event schema standardization**: PostHog's event schema is flexible but unstructured. We enforce the Hanzo event envelope (see Specification) so that all events across the ecosystem -- from Chat to Commerce to LLM Gateway -- share a common structure. This enables cross-service funnels and retention analysis.

4. **Custom dashboards**: Pre-built dashboards for Hanzo-specific metrics (LLM token usage, API latency percentiles, credit consumption, agent task completion rates) that a vanilla PostHog would not include.

### Why Rust Capture Service

PostHog's default ingestion path is: HTTP request hits a Django (Python) web server, which validates the event, writes it to Kafka, and returns HTTP 200. Django handles both the API and the ingestion hot path.

**The problem**: Django is not fast. A single Django process handles ~500-1000 events/second. Python's GIL limits true concurrency. Gunicorn with 4 workers gets you to ~2000-4000 events/second per pod. At 10M+ events/day (115 events/second average, but with 10-50x peak spikes), you need multiple Django pods just for ingestion -- pods that also serve the PostHog UI, API, and feature flag evaluation.

**The Rust capture service** (`capture` binary) is a standalone HTTP server that handles only event ingestion. It:
- Accepts POST requests on `/e` (single event), `/batch` (bulk), and `/capture` (legacy endpoint)
- Validates the project API key (`ha_` prefix)
- Deserializes the event payload (JSON or msgpack)
- Writes directly to Kafka (HIP-0030, topic `events_plugin_ingestion`)
- Returns HTTP 200

It does NOT:
- Serve the PostHog UI
- Evaluate feature flags (that is Django's job)
- Query ClickHouse
- Manage users or projects

By isolating the ingestion hot path to Rust, we achieve **100K+ events/second** on a single pod with < 50MB memory. The Django deployment handles everything else at a comfortable pace, uncontested for CPU and memory.

**Trade-off**: Two binaries to deploy instead of one. We accept this because the operational cost of a second Deployment is trivial compared to the performance gain.

### Why ClickHouse Over TimescaleDB

The original HIP-17 draft specified TimescaleDB. We replaced it with ClickHouse. Here is why.

**TimescaleDB** is PostgreSQL with time-series extensions. It stores data row-by-row (row-oriented). It is excellent for transactional workloads where you read and write individual rows. For analytics queries that scan millions of rows and aggregate them (e.g., "count pageviews per day for the last 90 days, grouped by browser"), TimescaleDB performs roughly the same as PostgreSQL -- because the query must read every column of every matching row, even if it only needs two columns.

**ClickHouse** is a columnar database purpose-built for analytics. It stores data column-by-column. When a query needs only `timestamp` and `event` from a table with 50 columns, ClickHouse reads only those 2 columns from disk. This alone gives a 10-25x speedup for typical analytics queries. Add vectorized execution (SIMD operations on column batches), aggressive compression (LZ4 on columns of similar data), and sparse indexing, and ClickHouse delivers 10-100x faster query performance than PostgreSQL/TimescaleDB for analytical workloads.

**Concrete numbers**: A query like "count distinct users per day for the last 30 days" over 100M events takes ~200ms in ClickHouse and ~15-30 seconds in PostgreSQL. Funnel analysis over 50M events: ~500ms in ClickHouse, timeout in PostgreSQL.

**Trade-off**: ClickHouse is not good for transactional workloads (single-row updates, foreign keys, ACID transactions). We use PostgreSQL for metadata (projects, users, feature flag definitions, dashboard configurations) and ClickHouse exclusively for event analytics. This is exactly PostHog's architecture.

### How Insights Connects to the Data Pipeline

```
                              ┌─────────────────────────┐
                              │      ClickHouse          │
                              │   (Analytics Storage)    │
                              │                          │
                              │  events table            │
                              │  session_replay_events   │
                              │  person_distinct_id      │
                              └────────────▲─────────────┘
                                           │ consume
                                           │
┌──────────────┐   ┌───────────────┐   ┌───┴───────────────┐
│  Browser SDK │──→│  Rust Capture │──→│  Kafka (HIP-0030) │
│  (ha_ key)   │   │  /e /batch    │   │  events_plugin_   │
└──────────────┘   │  /capture     │   │  ingestion         │
                   └───────────────┘   └───┬───────────────┘
┌──────────────┐                           │
│  Server SDK  │──→  (same path)           │ consume
│  Python/Go   │                           ▼
└──────────────┘                   ┌───────────────────┐
                                   │  Django Workers    │
┌──────────────┐                   │  (plugin-server)   │
│  LLM Gateway │──→  (same path)  │                    │
│  (HIP-4)     │                   │  - person mapping  │
└──────────────┘                   │  - property joins  │
                                   │  - plugin execution│
                                   └───────────────────┘
```

**Data flow**:
1. SDKs send events via HTTP POST to the Rust capture service
2. Capture validates the project API key and writes to Kafka
3. The ClickHouse Kafka engine consumes events and materializes them into the `events` table
4. Django plugin-server runs asynchronous transformations (person identification, property enrichment, plugin execution)
5. PostHog UI queries ClickHouse via the query API for dashboards, funnels, and retention

## Specification

### Event Schema

All analytics events MUST conform to the following schema. This is the canonical event format that SDKs produce and ClickHouse stores.

```typescript
interface AnalyticsEvent {
  // Required fields
  event: string                        // Event name: "$pageview", "$autocapture", "llm_request", etc.
  distinct_id: string                  // User identifier (anonymous or authenticated)
  timestamp: string                    // ISO 8601 UTC with millisecond precision
  properties: EventProperties          // Event-specific properties

  // Set by SDK (overridable)
  uuid: string                         // UUIDv7, globally unique event ID
  sent_at: string                      // Client-side send timestamp (for clock drift correction)

  // Set by server (never send from client)
  team_id?: number                     // Resolved from API key
  person_id?: string                   // Resolved via distinct_id mapping
  ip?: string                          // Client IP (captured server-side)
  now?: string                         // Server receive timestamp
}

interface EventProperties {
  // Standard properties ($ prefix = auto-captured by SDK)
  $current_url?: string                // Page URL
  $host?: string                       // Hostname
  $pathname?: string                   // URL path
  $browser?: string                    // Browser name
  $browser_version?: string            // Browser version
  $os?: string                         // Operating system
  $os_version?: string                 // OS version
  $device_type?: string                // "Desktop", "Mobile", "Tablet"
  $screen_height?: number              // Screen height in pixels
  $screen_width?: number               // Screen width in pixels
  $viewport_height?: number            // Viewport height
  $viewport_width?: number             // Viewport width
  $lib?: string                        // SDK name ("hanzo-js", "hanzo-python", etc.)
  $lib_version?: string                // SDK version
  $referrer?: string                   // HTTP referrer
  $referring_domain?: string           // Referrer domain
  $session_id?: string                 // Session identifier
  $window_id?: string                  // Tab/window identifier
  $insert_id?: string                  // Deduplication key

  // Person properties (set once or updated)
  $set?: Record<string, any>           // Set person properties
  $set_once?: Record<string, any>      // Set person properties only if not already set
  $unset?: string[]                    // Remove person properties

  // Feature flag properties
  $feature_flags?: Record<string, boolean | string>
  $active_feature_flags?: string[]

  // Custom properties (no $ prefix)
  [key: string]: any                   // Application-specific properties
}
```

### Reserved Event Names

Events with a `$` prefix are reserved for SDK auto-capture. Custom events MUST NOT use the `$` prefix.

| Event | Trigger | Key Properties |
|-------|---------|----------------|
| `$pageview` | Page load / SPA navigation | `$current_url`, `$pathname`, `$referrer` |
| `$pageleave` | Page unload / navigation away | `$current_url`, `$prev_pageview_duration` |
| `$autocapture` | Click, change, submit (auto) | `$event_type`, `$elements`, `$element_chain` |
| `$identify` | User identification call | `$set`, `$set_once`, `distinct_id` |
| `$groupidentify` | Group identification | `$group_type`, `$group_key`, `$group_set` |
| `$create_alias` | Merge anonymous + identified | `alias`, `distinct_id` |
| `$feature_flag_called` | Feature flag evaluated | `$feature_flag`, `$feature_flag_response` |
| `$session_start` | New session detected | `$session_id` |
| `$session_end` | Session timeout | `$session_id`, `$session_duration` |
| `$snapshot` | Session replay DOM snapshot | Compressed snapshot data |
| `$exception` | JavaScript error caught | `$exception_message`, `$exception_type`, `$exception_stack_trace_raw` |
| `$web_vitals` | Core Web Vitals measurement | `$web_vitals_LCP_value`, `$web_vitals_FID_value`, `$web_vitals_CLS_value` |
| `$survey_sent` | Survey displayed | `$survey_id`, `$survey_name` |
| `$survey_responded` | Survey answer submitted | `$survey_id`, `$survey_response` |

### Hanzo-Specific Events

These are custom events standardized across Hanzo services. They do NOT use the `$` prefix.

| Event | Source | Key Properties |
|-------|--------|----------------|
| `llm_request` | LLM Gateway | `model`, `provider`, `prompt_tokens`, `completion_tokens`, `latency_ms`, `cost_usd` |
| `llm_error` | LLM Gateway | `model`, `provider`, `error_code`, `error_message` |
| `credit_purchase` | Commerce | `amount_usd`, `credits_added`, `payment_method` |
| `credit_consumed` | Cloud / Gateway | `credits_used`, `service`, `model` |
| `agent_task_started` | Agent SDK | `agent_id`, `task_type`, `tools_available` |
| `agent_task_completed` | Agent SDK | `agent_id`, `task_type`, `duration_ms`, `tool_calls`, `tokens_used` |
| `deployment_created` | Platform | `project_id`, `runtime`, `region` |
| `api_key_created` | IAM | `key_prefix`, `scopes`, `application` |

### Capture Endpoints

The Rust capture service exposes three HTTP endpoints for event ingestion. All three accept the same payload format. The distinction is historical (PostHog compatibility) but all three MUST be supported.

#### POST /e (Primary)

Single event or batch. This is the primary endpoint used by current SDKs.

```http
POST /e HTTP/1.1
Host: insights.hanzo.ai
Content-Type: application/json

{
  "api_key": "ha_abc123def456",
  "event": "$pageview",
  "distinct_id": "user_789",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "properties": {
    "$current_url": "https://hanzo.ai/dashboard",
    "$browser": "Chrome",
    "$os": "macOS"
  },
  "uuid": "01945b7a-8c3d-7e2f-9a1b-4c5d6e7f8a9b",
  "sent_at": "2025-01-15T10:30:00.100Z"
}
```

Response (always immediate, does not wait for ClickHouse):
```http
HTTP/1.1 200 OK
Content-Type: application/json

{"status": 1}
```

#### POST /batch (Bulk)

Multiple events in a single request. SDKs SHOULD use this to reduce HTTP overhead.

```http
POST /batch HTTP/1.1
Host: insights.hanzo.ai
Content-Type: application/json

{
  "api_key": "ha_abc123def456",
  "batch": [
    {
      "event": "$pageview",
      "distinct_id": "user_789",
      "timestamp": "2025-01-15T10:30:00.000Z",
      "properties": {"$current_url": "https://hanzo.ai/dashboard"},
      "uuid": "01945b7a-8c3d-7e2f-9a1b-4c5d6e7f8a9b"
    },
    {
      "event": "llm_request",
      "distinct_id": "user_789",
      "timestamp": "2025-01-15T10:30:05.000Z",
      "properties": {"model": "zen-72b", "prompt_tokens": 150},
      "uuid": "01945b7a-9d4e-8f3g-0b2c-5d6e7f8a9b0c"
    }
  ],
  "sent_at": "2025-01-15T10:30:06.000Z"
}
```

Maximum batch size: 500 events. Requests exceeding this MUST receive HTTP 400.

#### POST /capture (Legacy)

Identical behavior to `/e`. Maintained for backward compatibility with older PostHog SDKs.

#### Endpoint Behavior

All capture endpoints MUST:
- Validate the `api_key` field (must start with `ha_`)
- Reject personal API keys (`hax_` prefix) with HTTP 401
- Write accepted events to Kafka topic `events_plugin_ingestion`
- Return HTTP 200 immediately after Kafka acknowledgment
- Return HTTP 400 for malformed payloads
- Return HTTP 401 for invalid or missing API keys
- Return HTTP 503 when Kafka is unavailable (SDKs retry with exponential backoff)

All capture endpoints MUST NOT:
- Query ClickHouse
- Query PostgreSQL (except for API key validation, which is cached in Redis)
- Block on any downstream processing

### Ingestion Pipeline

The full ingestion pipeline from client to queryable data:

```
1. Client SDK batches events locally (max 20 events or 5 seconds)
2. SDK sends POST /batch to insights.hanzo.ai
3. K8s Ingress routes /e, /batch, /capture to Rust capture service
4. Capture validates api_key (Redis cache lookup, TTL 5min)
5. Capture produces events to Kafka topic: events_plugin_ingestion
6. Kafka acknowledges (acks=all, idempotent)
7. Capture returns HTTP 200 to client
   --- synchronous path ends here ---
8. ClickHouse Kafka engine consumes from events_plugin_ingestion
9. Events materialized into ClickHouse sharded_events table
10. Plugin-server reads from Kafka for async transforms:
    - Person identification (distinct_id → person_id mapping)
    - Property enrichment (GeoIP, user-agent parsing)
    - Plugin execution (data transformations, webhooks)
11. Events queryable in ClickHouse within ~5 seconds of capture
```

### Query Engine

Analytics queries are executed against ClickHouse via the PostHog query API. The API accepts HogQL (PostHog's SQL dialect, a subset of ClickHouse SQL with guardrails).

#### Trends Query

```json
{
  "kind": "TrendsQuery",
  "series": [
    {
      "event": "$pageview",
      "math": "total"
    }
  ],
  "interval": "day",
  "dateRange": {
    "date_from": "-30d"
  },
  "breakdownFilter": {
    "breakdown": "$browser",
    "breakdown_type": "event"
  }
}
```

#### Funnel Query

```json
{
  "kind": "FunnelsQuery",
  "series": [
    {"event": "$pageview"},
    {"event": "llm_request"},
    {"event": "credit_purchase"}
  ],
  "funnelsFilter": {
    "funnelWindowInterval": 7,
    "funnelWindowIntervalUnit": "day",
    "funnelOrderType": "ordered"
  },
  "dateRange": {
    "date_from": "-30d"
  }
}
```

#### Retention Query

```json
{
  "kind": "RetentionQuery",
  "retentionFilter": {
    "targetEntity": {"id": "$pageview", "type": "events"},
    "returningEntity": {"id": "llm_request", "type": "events"},
    "retentionType": "retention_first_time",
    "period": "Week",
    "totalIntervals": 8
  },
  "dateRange": {
    "date_from": "-8w"
  }
}
```

#### Raw HogQL

For advanced queries, HogQL provides direct ClickHouse access with safety guardrails:

```sql
SELECT
  toDate(timestamp) AS day,
  count() AS events,
  uniqExact(distinct_id) AS unique_users
FROM events
WHERE event = 'llm_request'
  AND timestamp >= now() - INTERVAL 30 DAY
  AND properties.$model = 'zen-72b'
GROUP BY day
ORDER BY day DESC
```

### Session Replay

Session replay captures DOM snapshots, mouse movements, clicks, scrolls, network requests, and console logs. Replay data is stored as `$snapshot` events in ClickHouse.

#### Recording Configuration

```javascript
hanzo.init('ha_abc123', {
  api_host: 'https://insights.hanzo.ai',
  session_recording: {
    maskAllInputs: true,          // PII protection: mask all input values
    maskTextContent: false,        // Show text content (mask selectively with CSS)
    recordCrossOriginIframes: false,
    recordCanvas: false,           // Canvas recording is expensive
    recordNetworkRequests: true,   // Capture fetch/XHR waterfall
    recordConsole: true,           // Capture console.log/warn/error
  }
})
```

#### Replay Data Flow

```
Browser → rrweb (DOM snapshot library) → $snapshot events → /e endpoint
→ Kafka → ClickHouse session_replay_events table
→ PostHog UI replay player (reconstructs DOM from snapshots)
```

Session replay data is significantly larger than analytics events (~100KB-1MB per minute of recording). Compression (gzip on HTTP, LZ4 in Kafka, ZSTD in ClickHouse) reduces storage by ~10x.

### Feature Flags

Feature flags enable gradual rollouts, A/B tests, and kill switches. Flags are defined in the PostHog UI and evaluated either server-side or client-side.

#### Server-Side Evaluation

```python
# Python SDK
from hanzo import Hanzo

hanzo = Hanzo(
    api_key='ha_abc123',
    personal_api_key='hax_personal_xyz',
    host='https://insights.hanzo.ai'
)

# Boolean flag
if hanzo.feature_enabled('new-dashboard', distinct_id='user_789'):
    show_new_dashboard()

# Multivariate flag
variant = hanzo.get_feature_flag('pricing-experiment', distinct_id='user_789')
if variant == 'annual-discount':
    show_annual_pricing()
```

#### Client-Side Evaluation

```javascript
// JavaScript SDK
hanzo.onFeatureFlags(() => {
  if (hanzo.isFeatureEnabled('new-chat-ui')) {
    renderNewChatUI()
  }

  const variant = hanzo.getFeatureFlag('onboarding-flow')
  if (variant === 'guided-tour') {
    startGuidedTour()
  }
})
```

#### Flag Evaluation Endpoint

```http
POST /decide/?v=3 HTTP/1.1
Host: insights.hanzo.ai
Content-Type: application/json

{
  "api_key": "ha_abc123",
  "distinct_id": "user_789",
  "person_properties": {"plan": "pro", "country": "US"}
}
```

Response:
```json
{
  "featureFlags": {
    "new-dashboard": true,
    "pricing-experiment": "annual-discount",
    "beta-agent-tools": false
  },
  "featureFlagPayloads": {
    "pricing-experiment": "{\"discount_percent\": 20}"
  },
  "sessionRecording": {
    "endpoint": "/s/"
  }
}
```

The `/decide` endpoint is served by Django, NOT the Rust capture service. It requires PostgreSQL access for flag definitions and person property lookups.

### SDK Integration

#### JavaScript (Browser)

```javascript
import { Hanzo } from 'hanzo-js'

const hanzo = new Hanzo()
hanzo.init('ha_abc123def456', {
  api_host: 'https://insights.hanzo.ai',
  autocapture: true,              // Auto-capture clicks, form submits
  capture_pageview: true,         // Auto-capture $pageview on load
  capture_pageleave: true,        // Auto-capture $pageleave on unload
  session_recording: {
    maskAllInputs: true
  },
  bootstrap: {                    // Instant flag evaluation (no /decide round-trip)
    featureFlags: {
      'new-dashboard': true
    }
  }
})

// Custom event
hanzo.capture('llm_request', {
  model: 'zen-72b',
  prompt_tokens: 150,
  completion_tokens: 230,
  latency_ms: 1250
})

// Identify user (link anonymous → authenticated)
hanzo.identify('user_789', {
  email: 'user@example.com',
  plan: 'pro',
  org: 'hanzo'
})

// Group analytics (organization-level)
hanzo.group('company', 'org_hanzo', {
  name: 'Hanzo AI',
  plan: 'enterprise',
  employees: 50
})
```

#### Python (Server-Side)

```python
from hanzo import Hanzo

hanzo = Hanzo(
    api_key='ha_abc123def456',
    host='https://insights.hanzo.ai'
)

# Capture event
hanzo.capture(
    distinct_id='user_789',
    event='llm_request',
    properties={
        'model': 'zen-72b',
        'prompt_tokens': 150,
        'completion_tokens': 230,
        'cost_usd': 0.0038,
        'provider': 'together'
    }
)

# Identify with person properties
hanzo.identify(
    distinct_id='user_789',
    properties={
        '$set': {'plan': 'pro', 'company': 'Hanzo AI'},
        '$set_once': {'first_seen': '2025-01-15'}
    }
)

# Flush on shutdown (server SDKs batch events)
hanzo.flush()
hanzo.shutdown()
```

#### Go (Server-Side)

```go
package main

import "github.com/hanzoai/insights-go"

func main() {
    client := insights.New("ha_abc123def456")
    client.Endpoint = "https://insights.hanzo.ai"
    defer client.Close()

    client.Enqueue(insights.Capture{
        DistinctId: "user_789",
        Event:      "llm_request",
        Properties: insights.NewProperties().
            Set("model", "zen-72b").
            Set("prompt_tokens", 150).
            Set("completion_tokens", 230).
            Set("cost_usd", 0.0038),
    })
}
```

#### React

```tsx
import { HanzoProvider, useFeatureFlagEnabled, useHanzo } from 'hanzo-js/react'

function App() {
  return (
    <HanzoProvider
      apiKey="ha_abc123def456"
      options={{
        api_host: 'https://insights.hanzo.ai',
        autocapture: true,
      }}
    >
      <Dashboard />
    </HanzoProvider>
  )
}

function Dashboard() {
  const hanzo = useHanzo()
  const showNewUI = useFeatureFlagEnabled('new-dashboard')

  const handleAction = () => {
    hanzo.capture('dashboard_action', { action: 'export_csv' })
  }

  return showNewUI ? <NewDashboard onAction={handleAction} /> : <LegacyDashboard />
}
```

## Implementation

### Production Deployment

Hanzo Insights runs on `hanzo-k8s` (`24.199.76.156`) with the following services:

| Service | Image | Replicas | CPU | Memory | Purpose |
|---------|-------|----------|-----|--------|---------|
| `insights-web` | `ghcr.io/hanzoai/insights:latest` | 2 | 500m | 1Gi | Django: UI, API, /decide |
| `insights-capture` | `ghcr.io/posthog/posthog/capture:master` | 2 | 250m | 128Mi | Rust: /e, /batch, /capture |
| `insights-worker` | `ghcr.io/hanzoai/insights:latest` | 2 | 500m | 1Gi | Celery: async tasks |
| `insights-plugins` | `ghcr.io/hanzoai/insights:latest` | 1 | 500m | 512Mi | Plugin server: transforms |
| `insights-kafka` | `bitnami/kafka:3.7` | 1 | 500m | 2Gi | Event buffering (HIP-0030) |
| `insights-clickhouse` | `clickhouse/clickhouse-server:24.1` | 1 | 1000m | 4Gi | Analytics storage |
| `insights-kv` | `redis:7-alpine` | 1 | 100m | 256Mi | Cache, session store |
| `insights-postgres` | `postgres:16-alpine` | 1 | 250m | 512Mi | Metadata (or shared pg) |

### Ingress Routing

The K8s Ingress splits traffic between the Rust capture service and Django based on URL path:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: insights
  namespace: hanzo
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: "20m"
spec:
  rules:
  - host: insights.hanzo.ai
    http:
      paths:
      # Hot path: Rust capture (high throughput, low latency)
      - path: /e
        pathType: Exact
        backend:
          service:
            name: insights-capture
            port:
              number: 3000
      - path: /batch
        pathType: Exact
        backend:
          service:
            name: insights-capture
            port:
              number: 3000
      - path: /capture
        pathType: Exact
        backend:
          service:
            name: insights-capture
            port:
              number: 3000
      # Everything else: Django (UI, API, /decide, /api)
      - path: /
        pathType: Prefix
        backend:
          service:
            name: insights-web
            port:
              number: 8000
```

This routing is the single most important operational detail. Getting it wrong means either:
- Sending capture traffic to Django (performance regression)
- Sending UI/API traffic to Rust capture (404 errors)

### ClickHouse Schema

The core events table in ClickHouse:

```sql
CREATE TABLE IF NOT EXISTS sharded_events
(
    uuid UUID,
    event String,
    properties String,                    -- JSON string
    timestamp DateTime64(6, 'UTC'),
    team_id Int64,
    distinct_id String,
    elements_chain String,
    created_at DateTime64(6, 'UTC'),
    person_id UUID,
    person_created_at DateTime64(3, 'UTC'),
    person_properties String,             -- JSON string
    group0_properties String,
    group1_properties String,
    group2_properties String,
    group3_properties String,
    group4_properties String,
    $group_0 String,
    $group_1 String,
    $group_2 String,
    $group_3 String,
    $group_4 String,
    $session_id String,
    $window_id String,
    _timestamp DateTime,
    _offset UInt64
)
ENGINE = ReplicatedReplacingMergeTree('/clickhouse/tables/{shard}/events', '{replica}', _timestamp)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (team_id, toDate(timestamp), event, cityHash64(distinct_id), cityHash64(uuid))
SAMPLE BY cityHash64(distinct_id)
```

Key design decisions:
- **PARTITION BY month**: Enables efficient partition pruning for date-range queries
- **ORDER BY (team_id, date, event, ...)**: Team isolation is the primary filter, then date, then event type
- **SAMPLE BY distinct_id hash**: Enables approximate queries on large datasets (e.g., "~5% sample of pageviews")
- **ReplacingMergeTree**: Deduplicates events by UUID on merge (handles Kafka redelivery)

### Monitoring

```yaml
# Key metrics to monitor
alerts:
  - name: CaptureLatencyHigh
    expr: histogram_quantile(0.99, capture_request_duration_seconds_bucket) > 0.5
    for: 5m
    severity: warning
    annotations:
      summary: "Capture p99 latency exceeds 500ms"

  - name: CaptureErrorRateHigh
    expr: rate(capture_requests_total{status="error"}[5m]) / rate(capture_requests_total[5m]) > 0.01
    for: 5m
    severity: critical
    annotations:
      summary: "Capture error rate exceeds 1%"

  - name: ClickHouseQuerySlow
    expr: histogram_quantile(0.95, clickhouse_query_duration_seconds_bucket) > 10
    for: 10m
    severity: warning
    annotations:
      summary: "ClickHouse p95 query latency exceeds 10s"

  - name: KafkaConsumerLagInsights
    expr: kafka_consumer_group_lag{group="analytics-ingest"} > 100000
    for: 5m
    severity: warning
    annotations:
      summary: "Insights ClickHouse consumer lag exceeds 100K events"

  - name: EventIngestionDelay
    expr: (max(insights_events_last_seen_at) - max(insights_events_last_ingested_at)) > 30
    for: 5m
    severity: critical
    annotations:
      summary: "Events taking >30s from capture to ClickHouse"
```

## Security

### API Key Types and Scopes

| Prefix | Type | Usage | Capture Allowed | API Allowed |
|--------|------|-------|-----------------|-------------|
| `ha_` | Project API Key | Client SDKs (browser, mobile) | Yes | No |
| `hax_` | Personal API Key | Server-side API access | No | Yes |
| `has_` | Session Recording | Internal (SDK ↔ replay) | No | No |
| `haa_` | Feature Flag | Internal (SDK ↔ /decide) | No | No |

**Critical rule**: The capture endpoints (`/e`, `/batch`, `/capture`) MUST reject `hax_` personal API keys. Personal keys have full API access (read events, modify projects, delete data). If a personal key leaks in client-side JavaScript, an attacker could read all analytics data. Project keys (`ha_`) can only write events -- they cannot read anything.

### PII Anonymization

Event properties MUST NOT contain raw PII unless explicitly opted in per property. The following anonymization rules apply:

1. **IP addresses**: Captured server-side by the Rust capture service. Stored for GeoIP resolution, then replaced with `$geoip_city_name`, `$geoip_country_code`, etc. Raw IP is NOT stored in ClickHouse by default.
2. **Email addresses**: MUST be sent only via `$set` on `$identify` events (person properties), never in regular event properties.
3. **Session replay**: `maskAllInputs: true` is the default. Input values are replaced with `***` in replay. CSS class `ha-no-capture` excludes any DOM element from recording.
4. **URLs**: Query parameters may contain tokens or PII. SDKs SHOULD strip sensitive query parameters (configurable via `sanitize_properties`).

### Data Retention

| Data Type | Default Retention | Configurable | Storage |
|-----------|------------------|--------------|---------|
| Analytics events | 365 days | Yes, per team | ClickHouse |
| Session replay | 30 days | Yes, per team | ClickHouse |
| Person profiles | Indefinite | Deletable | ClickHouse + PostgreSQL |
| Feature flag definitions | Indefinite | N/A | PostgreSQL |
| Kafka events | 7 days | Per topic (HIP-0030) | Kafka |

Retention enforcement is via ClickHouse TTL:

```sql
ALTER TABLE sharded_events
MODIFY TTL timestamp + INTERVAL 365 DAY;

ALTER TABLE session_replay_events
MODIFY TTL timestamp + INTERVAL 30 DAY;
```

### GDPR Compliance

Hanzo Insights supports the right to erasure (GDPR Article 17):

1. **Delete person data**: API endpoint `DELETE /api/person/{distinct_id}` removes all person properties and optionally all events associated with that `distinct_id`.
2. **Anonymize events**: Alternative to deletion -- replace `distinct_id` with a random hash, strip person properties, keep aggregate event data for analytics.
3. **Data export**: API endpoint `GET /api/person/{distinct_id}/events` returns all events for a given user in JSON format.
4. **Consent management**: SDKs support `opt_out_capturing()` which stops all event collection and deletes the local anonymous ID.

```javascript
// Respect user consent
if (!userConsentedToAnalytics()) {
  hanzo.opt_out_capturing()  // No events sent, no cookies set
}

// Later, if consent is given
hanzo.opt_in_capturing()
```

### Token Validation

The Rust capture service validates API keys on every request:

1. Check Redis cache for key → team_id mapping (TTL 5 minutes)
2. On cache miss, query PostgreSQL `posthog_team` table
3. Reject if key prefix is not `ha_` (capture only accepts project keys)
4. Reject if key is not found or team is disabled
5. Cache the result in Redis

This validation adds < 1ms latency on cache hit and < 10ms on cache miss.

### Network Security

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: insights-capture-policy
  namespace: hanzo
spec:
  podSelector:
    matchLabels:
      app: insights-capture
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: ingress-nginx
    ports:
    - port: 3000
      protocol: TCP
  egress:
  - to:
    - podSelector:
        matchLabels:
          app: insights-kafka
    ports:
    - port: 9092
  - to:
    - podSelector:
        matchLabels:
          app: insights-kv
    ports:
    - port: 6379
```

The capture service can only talk to Kafka (write events) and Redis (validate keys). It has no access to ClickHouse, PostgreSQL, or the internet.

## Operational Runbook

### Verify Event Ingestion

```bash
# Send a test event
curl -X POST https://insights.hanzo.ai/e \
  -H 'Content-Type: application/json' \
  -d '{
    "api_key": "ha_abc123",
    "event": "test_event",
    "distinct_id": "test_user",
    "properties": {"test": true}
  }'

# Check Kafka consumer lag
kubectl exec -n hanzo insights-kafka-0 -- \
  kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --group analytics-ingest --describe

# Query ClickHouse directly
kubectl exec -n hanzo insights-clickhouse-0 -- \
  clickhouse-client --query "
    SELECT event, count()
    FROM events
    WHERE timestamp > now() - INTERVAL 1 HOUR
    GROUP BY event
    ORDER BY count() DESC
    LIMIT 10
  "
```

### Debug Missing Events

If events are captured but not appearing in the UI:

1. **Check capture returned 200**: SDK network tab or server logs
2. **Check Kafka**: Consumer lag for `analytics-ingest` group -- if lag is growing, ClickHouse consumer is stuck
3. **Check ClickHouse**: Query `events` table directly -- if events are there, the issue is in the PostHog query layer
4. **Check team_id**: Verify the API key maps to the correct team in PostgreSQL

### ClickHouse Maintenance

```bash
# Check table sizes
clickhouse-client --query "
  SELECT table, formatReadableSize(sum(bytes_on_disk)) AS size
  FROM system.parts
  WHERE active
  GROUP BY table
  ORDER BY sum(bytes_on_disk) DESC
"

# Force merge (reduces part count, improves query performance)
OPTIMIZE TABLE sharded_events FINAL;

# Check slow queries
SELECT query, elapsed, read_rows, formatReadableSize(read_bytes)
FROM system.query_log
WHERE type = 'QueryFinish'
  AND elapsed > 5
ORDER BY elapsed DESC
LIMIT 10;
```

## References

1. [HIP-4: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md)
2. [HIP-5: Secrets Management (KMS)](./hip-0005-secrets-management-standard.md)
3. [HIP-30: Event Streaming Standard (Kafka)](./hip-0030-event-streaming-standard.md)
4. [PostHog Documentation](https://posthog.com/docs)
5. [ClickHouse Documentation](https://clickhouse.com/docs)
6. [PostHog Rust Capture Service](https://github.com/PostHog/posthog/tree/master/rust/capture)
7. [rrweb: DOM Recording Library](https://www.rrweb.io/)
8. [Hanzo Insights Repository](https://github.com/hanzoai/insights)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
