---
hip: 0037
title: AI Cloud Platform Standard
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2025-01-15
requires: HIP-0004, HIP-0026, HIP-0027
---

# HIP-37: AI Cloud Platform Standard

## Abstract

Hanzo Cloud (cloud.hanzo.ai) is the AI operations platform for the Hanzo ecosystem. It provides a unified control plane for managing LLM inference, agent orchestration, MCP tool invocation, API key lifecycle, usage metering, and credit-based billing -- all through a single dashboard and API.

Cloud does not run inference. It does not host models. It does not execute agent code. Instead, it orchestrates the services that do: LLM Gateway (HIP-0004) for inference routing, Agent SDK (HIP-0009) for multi-agent orchestration, MCP (HIP-0010) for tool invocation, and IAM (HIP-0026) for authentication and balance tracking. Cloud is the layer that turns a collection of AI infrastructure components into a product that teams can adopt in minutes.

**Repository**: [github.com/hanzoai/cloud](https://github.com/hanzoai/cloud)
**Production**: https://cloud.hanzo.ai
**Port**: 3000 (frontend), 8000 (API via gateway)
**Cluster**: hanzo-k8s (24.199.76.156)

## Motivation

### The Problem

The Hanzo ecosystem contains powerful but disconnected infrastructure:

1. **LLM Gateway** (HIP-0004) proxies 100+ AI providers with intelligent routing, caching, and failover. But it exposes a raw API. There is no dashboard to see which models your team uses, how much they cost, or whether error rates are climbing.

2. **Agent SDK** (HIP-0009) enables multi-agent orchestration with shared state and tool use. But deploying agents, monitoring their runs, and debugging failures requires SSH access and log tailing. There is no managed runtime.

3. **MCP tools** (HIP-0010) provide 260+ capabilities for AI models. But discovering available tools, configuring them per-project, and auditing which tools an agent invoked requires reading source code.

4. **IAM** (HIP-0026) handles authentication and tracks credit balances. But there is no interface for users to see their spend breakdown, purchase credits, or set usage alerts.

5. **API keys** are the primary credential for programmatic access. But generating, scoping, rotating, and revoking keys requires direct database manipulation or API calls with admin tokens.

Each component works. None of them are usable by a product team without significant integration effort. The missing piece is an operations layer -- a control plane that stitches these components together behind a coherent UI and API.

### What Teams Actually Need

When a team adopts AI infrastructure, they need answers to five questions on day one:

- **"How do I get an API key?"** -- Self-service key generation with clear scoping.
- **"Which models can I use?"** -- A catalog of available models with pricing and capability metadata.
- **"How much am I spending?"** -- Real-time usage dashboards with cost attribution per model, per user, per project.
- **"What went wrong?"** -- Error logs, latency histograms, and request traces for debugging production issues.
- **"Who has access?"** -- Team management with roles, so the intern cannot rotate the production API key.

Hanzo Cloud answers all five. It is the product layer that makes the infrastructure layer usable.

## Design Philosophy

This section explains *why* each major architectural decision was made. The decisions are non-obvious, and understanding the rationale prevents future engineers from reversing them without understanding the consequences.

### Why Build vs. Use Existing Platforms

**Vercel AI SDK** is a frontend toolkit. It helps you build chat UIs and streaming responses in Next.js. It does not manage API keys, track costs, route between providers, or run agents. It solves a different problem (building AI-powered frontends) at a different layer (the application).

**AWS SageMaker** is an ML training and deployment platform. It manages model training jobs, endpoints, and inference pipelines. It is designed for teams that train their own models and deploy them on AWS infrastructure. It does not proxy third-party providers, does not support MCP tools, and does not provide credit-based billing. Its pricing model (per-instance-hour) penalizes experimentation.

**Replicate / Modal / Banana** are inference platforms. They run models on GPUs and expose APIs. They do not aggregate multiple providers, do not support agents, and do not provide team management or billing dashboards.

**OpenRouter** is the closest analogue -- a multi-provider LLM proxy with usage tracking. But it is a pure proxy. It does not provide agent orchestration, MCP tool management, team workspaces, or self-hosted deployment. And it is a third-party service, which means sending all prompts through their infrastructure.

No existing platform unifies LLM proxy, agent orchestration, MCP tools, team management, and usage-based billing in a single experience. That is the gap Hanzo Cloud fills.

### Why Separate Cloud and Console

This is the most frequently asked architectural question, and the answer is subtle.

**Cloud** (cloud.hanzo.ai) is the *user-facing product*. Teams sign up, create projects, generate API keys, view usage dashboards, manage team members, and purchase credits. The audience is developers and team leads who consume AI infrastructure. The permission model is project-scoped: a user sees only their projects, their keys, and their usage.

**Console** (console.hanzo.ai) is the *operator dashboard*. Hanzo staff use it to manage organizations, configure quotas, view cross-tenant metrics, and handle billing disputes. The audience is Hanzo operations engineers. The permission model is org-scoped or global: an operator sees all organizations, all users, and all usage.

The separation exists because the two audiences have fundamentally different threat models:

- A Cloud user who gains Console access can see other organizations' data, modify quotas, and disable accounts. This is a catastrophic breach.
- A Console operator who only has Cloud access cannot perform their job -- they need cross-tenant visibility.

Combining both into one application with feature flags is possible but fragile. A single misconfigured RBAC rule exposes admin functionality to end users. Two separate applications with separate deployments, separate domains, and separate authentication scopes make the boundary enforceable at the network level.

| Dimension | Cloud (cloud.hanzo.ai) | Console (console.hanzo.ai) |
|-----------|----------------------|---------------------------|
| Audience | Developers, team leads | Hanzo operators |
| Scope | Per-project | Per-org / global |
| Auth | OAuth2 user tokens | OAuth2 admin tokens |
| Data access | Own projects only | All tenants |
| Key operations | Generate, rotate, revoke own keys | View all keys, set quotas |
| Billing | View own usage, purchase credits | View all usage, issue refunds |

### Why Credit-Based Billing

AI usage is fundamentally variable. A developer testing a new prompt might make 5 LLM calls in a day. A production pipeline might make 50,000. Per-seat pricing (like most SaaS) charges both the same amount, which is unfair and unpredictable for the provider.

Per-request pricing (like AWS Lambda) is granular but unpredictable for the user. A bug that retries requests in a loop can generate a surprise bill in minutes.

Credits provide a middle ground:

1. **Prepaid**: Users purchase credits in advance. There are no surprise bills because spend cannot exceed the balance.
2. **Granular**: Each LLM call, agent run, or tool invocation deducts a precise amount from the balance based on actual token consumption and model pricing.
3. **Transparent**: The dashboard shows real-time balance and per-request cost breakdown. Users always know where they stand.
4. **Unified**: Credits work across all services -- LLM inference, agent runs, MCP tools, storage. One balance, one currency.

Credits are tracked in IAM (HIP-0026) as a `balance` field on the user entity. This means the same database query that validates a user's authentication token also returns their current balance. The LLM Gateway checks the balance before proxying a request and deducts the cost after completion. No separate billing service roundtrip is required.

The credit unit is USD cents. 1 credit = $0.01 USD. This keeps the arithmetic simple and the display familiar.

### How Cloud Orchestrates the Stack

Cloud is a control plane, not a data plane. It never touches prompts, completions, or tool outputs. Here is the request flow for a typical LLM API call:

```
Developer App
    |
    | (1) POST /v1/chat/completions
    |     Header: Authorization: Bearer hk_live_abc123
    |
    v
Hanzo Cloud API
    |
    | (2) Validate API key (lookup in Cloud DB)
    | (3) Resolve user from key -> check IAM balance
    | (4) If balance sufficient, proxy to LLM Gateway
    |
    v
LLM Gateway (HIP-0004)
    |
    | (5) Route to optimal provider (OpenAI, Anthropic, etc.)
    | (6) Stream response back
    |
    v
Hanzo Cloud API
    |
    | (7) Record usage: tokens, cost, latency, model
    | (8) Deduct credits from IAM balance
    | (9) Emit webhook if usage alert threshold crossed
    |
    v
Developer App
    |
    | (10) Receives streamed completion
```

Steps 2-3 and 7-9 are Cloud's responsibility. Steps 5-6 are Gateway's. The developer's application talks to Cloud's API endpoint, which looks identical to OpenAI's API. The only difference is the API key prefix (`hk_` instead of `sk-`).

For agent orchestration, the flow is similar but Cloud delegates to Agent SDK (HIP-0009) instead of Gateway:

```
Cloud API -> Agent Runtime -> [LLM Gateway + MCP Tools] -> Cloud API (record usage)
```

For MCP tool invocations within agent runs, Cloud records each tool call as a separate usage event, enabling per-tool cost attribution.

## Specification

### API Key Management

API keys are the primary credential for programmatic access to Hanzo Cloud services.

#### Key Format

```
hk_live_<32 random bytes, base62 encoded>    # Production key
hk_test_<32 random bytes, base62 encoded>    # Test key (rate limited, no billing)
```

The prefix encodes the environment. Parsers can distinguish live keys from test keys without a database lookup.

#### Key Scoping

Each key has an associated scope that restricts which operations it can perform:

```typescript
interface APIKeyScope {
  // Which models the key can access
  models: string[] | "*";          // e.g., ["gpt-4", "claude-3-opus"] or "*"

  // Which services the key can invoke
  services: ServiceScope[];        // e.g., ["llm", "agents", "mcp"]

  // Rate limits (requests per minute)
  rateLimit: number;               // Default: 60 rpm

  // Maximum spend per billing period (USD cents)
  spendLimit: number | null;       // null = no limit (uses account balance)

  // IP allowlist (CIDR notation)
  allowedIPs: string[] | null;     // null = any IP

  // Expiration
  expiresAt: Date | null;          // null = no expiration
}

type ServiceScope = "llm" | "agents" | "mcp" | "embeddings" | "images" | "audio";
```

#### Key Lifecycle API

```
POST   /v1/api-keys              # Create key
GET    /v1/api-keys              # List keys (masked)
GET    /v1/api-keys/:id          # Get key metadata
PATCH  /v1/api-keys/:id          # Update scope/limits
DELETE /v1/api-keys/:id          # Revoke key
POST   /v1/api-keys/:id/rotate   # Rotate (new secret, same scope)
```

Key creation returns the full key exactly once. Subsequent reads return only the last 4 characters for identification. This follows the same security pattern as Stripe and OpenAI.

### Usage Tracking

Every request through Cloud is recorded as a usage event:

```typescript
interface UsageEvent {
  id: string;
  timestamp: Date;

  // Identity
  orgId: string;
  projectId: string;
  userId: string;
  apiKeyId: string;

  // Request
  service: ServiceScope;
  model: string;
  provider: string;              // Which provider actually served the request

  // Tokens
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;

  // Cost (USD cents)
  cost: number;

  // Performance
  latencyMs: number;
  ttftMs: number;                // Time to first token (streaming)
  status: "success" | "error" | "timeout" | "rate_limited";

  // Agent-specific
  agentId?: string;
  agentRunId?: string;
  toolCalls?: ToolCallEvent[];

  // Request metadata (no PII, no prompt content)
  metadata: Record<string, string>;
}

interface ToolCallEvent {
  toolName: string;
  toolProvider: string;          // MCP server name
  durationMs: number;
  status: "success" | "error";
}
```

Usage events are written to PostgreSQL with TimescaleDB hypertables for efficient time-series aggregation. Events older than 90 days are compressed and archived to object storage (MinIO / S3).

### Usage Dashboard API

```
GET /v1/usage/summary            # Aggregate usage for current billing period
GET /v1/usage/timeseries         # Time-bucketed usage (hourly/daily/monthly)
GET /v1/usage/by-model           # Cost breakdown per model
GET /v1/usage/by-user            # Cost breakdown per team member
GET /v1/usage/by-key             # Cost breakdown per API key
GET /v1/usage/events             # Paginated raw events
```

All endpoints accept `start`, `end`, `granularity`, and `filter` query parameters.

### Model Catalog

Cloud maintains a catalog of available models with pricing, capability metadata, and routing preferences:

```typescript
interface ModelEntry {
  id: string;                     // e.g., "gpt-4-turbo"
  provider: string;               // e.g., "openai"
  displayName: string;            // e.g., "GPT-4 Turbo"
  description: string;

  // Capabilities
  capabilities: {
    chat: boolean;
    completion: boolean;
    embedding: boolean;
    imageGeneration: boolean;
    imageAnalysis: boolean;
    audio: boolean;
    functionCalling: boolean;
    streaming: boolean;
    jsonMode: boolean;
  };

  // Context
  contextWindow: number;          // Max tokens
  maxOutputTokens: number;

  // Pricing (per 1M tokens, USD cents)
  pricing: {
    promptPer1M: number;
    completionPer1M: number;
    embeddingPer1M?: number;
    imagePer1K?: number;          // Per 1K images
  };

  // Availability
  status: "available" | "degraded" | "unavailable";
  regions: string[];
}
```

```
GET  /v1/models                   # List all available models
GET  /v1/models/:id               # Get model details and current status
```

### Team Management

Cloud provides project-scoped team management with role-based access:

```typescript
interface ProjectMember {
  userId: string;
  email: string;
  role: ProjectRole;
  joinedAt: Date;
  invitedBy: string;
}

type ProjectRole = "owner" | "admin" | "developer" | "viewer";
```

| Permission | Owner | Admin | Developer | Viewer |
|------------|-------|-------|-----------|--------|
| View usage dashboard | Yes | Yes | Yes | Yes |
| Make API calls | Yes | Yes | Yes | No |
| Create/revoke API keys | Yes | Yes | Own only | No |
| Invite team members | Yes | Yes | No | No |
| Change member roles | Yes | Yes | No | No |
| Purchase credits | Yes | Yes | No | No |
| Delete project | Yes | No | No | No |
| Transfer ownership | Yes | No | No | No |

```
GET    /v1/projects/:id/members          # List members
POST   /v1/projects/:id/members          # Invite member
PATCH  /v1/projects/:id/members/:uid     # Change role
DELETE /v1/projects/:id/members/:uid     # Remove member
```

### Billing

#### Credit Purchase

```
POST /v1/billing/credits/purchase
{
  "amount": 5000,          // USD cents ($50.00)
  "paymentMethod": "pm_..."
}
```

Payment processing is handled by Commerce (HIP-0018). Cloud sends the purchase request, Commerce processes the payment, and on success, Commerce calls IAM to increment the user's balance. Cloud never touches payment card data.

#### Usage Alerts

Users configure spend thresholds that trigger webhook notifications:

```typescript
interface UsageAlert {
  id: string;
  projectId: string;
  type: "spend" | "requests" | "errors";
  threshold: number;             // USD cents for spend, count for requests/errors
  period: "daily" | "weekly" | "monthly";
  channels: AlertChannel[];
  enabled: boolean;
}

type AlertChannel =
  | { type: "webhook"; url: string }
  | { type: "email"; address: string }
  | { type: "slack"; webhookUrl: string };
```

```
GET    /v1/billing/alerts            # List alerts
POST   /v1/billing/alerts            # Create alert
PATCH  /v1/billing/alerts/:id        # Update alert
DELETE /v1/billing/alerts/:id        # Delete alert
```

### MCP Tool Marketplace

Cloud provides a catalog of MCP tools (HIP-0010) that agents and applications can invoke:

```
GET  /v1/mcp/tools                   # List available MCP tools
GET  /v1/mcp/tools/:id              # Tool details, schema, pricing
POST /v1/mcp/tools/:id/invoke       # Invoke a tool (standalone)
```

Each tool invocation is recorded as a usage event. Tools that call external APIs (e.g., web search, code execution) may have additional per-invocation costs that are deducted from the user's credit balance.

Tools are organized by MCP server:

```typescript
interface MCPToolEntry {
  id: string;
  server: string;                 // MCP server name (e.g., "hanzo-browser")
  name: string;                   // Tool name (e.g., "navigate")
  description: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  costPerInvocation: number;      // USD cents (0 for free tools)
  category: string;               // e.g., "browser", "filesystem", "search"
}
```

### Agent Deployment

Cloud provides managed deployment for agents built with Agent SDK (HIP-0009):

```
POST   /v1/agents                    # Deploy an agent
GET    /v1/agents                    # List deployed agents
GET    /v1/agents/:id               # Agent details and status
PATCH  /v1/agents/:id               # Update agent configuration
DELETE /v1/agents/:id               # Undeploy agent
POST   /v1/agents/:id/runs          # Start an agent run
GET    /v1/agents/:id/runs          # List runs
GET    /v1/agents/:id/runs/:runId   # Run details with step-by-step trace
POST   /v1/agents/:id/runs/:runId/cancel  # Cancel a running agent
```

Agent runs are traced at every step -- each LLM call, each tool invocation, each state transition is recorded. The run detail endpoint returns a full execution trace for debugging:

```typescript
interface AgentRun {
  id: string;
  agentId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: Date;
  completedAt: Date | null;
  steps: AgentStep[];
  totalCost: number;              // USD cents
  totalTokens: number;
  error?: string;
}

interface AgentStep {
  index: number;
  type: "think" | "act" | "observe" | "tool_call" | "llm_call";
  timestamp: Date;
  durationMs: number;
  input: string;                  // Summarized, no raw prompts
  output: string;                 // Summarized, no raw completions
  model?: string;
  tokens?: number;
  cost?: number;
  toolName?: string;
}
```

### Webhook Notifications

Cloud emits webhooks for key events. Consumers register endpoints and select event types:

```
POST   /v1/webhooks                  # Register webhook endpoint
GET    /v1/webhooks                  # List registered webhooks
PATCH  /v1/webhooks/:id             # Update webhook
DELETE /v1/webhooks/:id             # Remove webhook
GET    /v1/webhooks/:id/deliveries  # Delivery log with payloads and responses
POST   /v1/webhooks/:id/test       # Send test event
```

Supported event types:

```
usage.threshold.reached      # Spend/request/error alert triggered
api_key.created              # New API key generated
api_key.rotated              # API key rotated
api_key.revoked              # API key revoked
agent.run.completed          # Agent run finished
agent.run.failed             # Agent run failed
credits.low                  # Balance below configured threshold
credits.depleted             # Balance reached zero
member.invited               # Team member invited
member.removed               # Team member removed
```

Webhook payloads include an HMAC-SHA256 signature header (`X-Hanzo-Signature`) computed with a per-webhook secret, enabling receivers to verify authenticity.

## Implementation

### Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Frontend | Next.js 14, React 18, Tailwind CSS | SSR for SEO, RSC for performance, Tailwind for consistency with Hanzo UI system |
| API | Node.js, Express | Same runtime as LLM Gateway; shared middleware and SDK code |
| Database | PostgreSQL + TimescaleDB | Relational for entities, time-series hypertables for usage events |
| Cache | Redis (HIP-0028 KV) | Session state, rate limit counters, real-time dashboard data |
| Auth | OAuth2 via IAM (HIP-0026) | Single sign-on across all Hanzo services |
| Payments | Commerce (HIP-0018) | PCI-compliant payment processing |
| Queue | Redis Streams | Async usage event processing, webhook delivery |

### Database Schema (Core Tables)

```sql
-- Projects
CREATE TABLE projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      TEXT NOT NULL,                -- IAM organization
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- API Keys
CREATE TABLE api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id),
    user_id     TEXT NOT NULL,                -- IAM user who created it
    name        TEXT NOT NULL,
    key_hash    TEXT NOT NULL UNIQUE,         -- SHA-256 of full key
    key_prefix  TEXT NOT NULL,               -- "hk_live_" or "hk_test_"
    key_suffix  TEXT NOT NULL,               -- Last 4 chars for display
    scope       JSONB NOT NULL DEFAULT '{}',
    expires_at  TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Usage Events (TimescaleDB hypertable)
CREATE TABLE usage_events (
    id              UUID DEFAULT gen_random_uuid(),
    time            TIMESTAMPTZ NOT NULL,
    org_id          TEXT NOT NULL,
    project_id      UUID NOT NULL,
    user_id         TEXT NOT NULL,
    api_key_id      UUID NOT NULL,
    service         TEXT NOT NULL,
    model           TEXT NOT NULL,
    provider        TEXT NOT NULL,
    prompt_tokens   INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    cost_cents      INTEGER NOT NULL DEFAULT 0,
    latency_ms      INTEGER NOT NULL DEFAULT 0,
    ttft_ms         INTEGER,
    status          TEXT NOT NULL,
    agent_id        UUID,
    agent_run_id    UUID,
    metadata        JSONB DEFAULT '{}',
    PRIMARY KEY (id, time)
);

SELECT create_hypertable('usage_events', 'time');

-- Compression policy: compress chunks older than 7 days
SELECT add_compression_policy('usage_events', INTERVAL '7 days');

-- Retention policy: move to cold storage after 90 days
SELECT add_retention_policy('usage_events', INTERVAL '90 days');

-- Continuous aggregates for dashboard queries
CREATE MATERIALIZED VIEW usage_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    org_id,
    project_id,
    model,
    COUNT(*) AS request_count,
    SUM(prompt_tokens) AS total_prompt_tokens,
    SUM(completion_tokens) AS total_completion_tokens,
    SUM(cost_cents) AS total_cost_cents,
    AVG(latency_ms) AS avg_latency_ms,
    COUNT(*) FILTER (WHERE status = 'error') AS error_count
FROM usage_events
GROUP BY bucket, org_id, project_id, model;
```

### Deployment Architecture

```
                    Internet
                       |
                   [Traefik]
                   /       \
        cloud.hanzo.ai    api.hanzo.ai
               |               |
        [Cloud Frontend]  [Cloud API]
          (Next.js SSR)   (Express)
               |               |
               +-------+-------+
                       |
              [PostgreSQL + TimescaleDB]
              [Redis]
                       |
          +------------+------------+
          |            |            |
   [LLM Gateway]  [Agent Runtime] [MCP Servers]
    (HIP-0004)     (HIP-0009)     (HIP-0010)
          |
   [AI Providers]
   OpenAI, Anthropic, Together, ...
```

All services run on the hanzo-k8s cluster. Cloud Frontend and Cloud API are separate Kubernetes deployments with independent scaling. The API is the only component that talks to downstream services -- the frontend communicates exclusively through the API.

### Request Authentication Flow

```
1. Client sends request with Authorization: Bearer hk_live_abc123
2. Cloud API hashes the key: SHA-256("hk_live_abc123")
3. Lookup hash in api_keys table -> get project_id, user_id, scope
4. Check key not revoked, not expired
5. Check scope allows the requested service and model
6. Resolve user_id -> IAM balance check (cached in Redis, TTL 10s)
7. If balance > estimated cost, proceed
8. Proxy request to downstream service
9. On completion, record usage event and deduct actual cost from IAM
```

The balance check at step 6 uses an optimistic strategy: the cached balance is checked to avoid a round-trip to IAM on every request. The actual deduction at step 9 is authoritative. If the cache is stale and the user's balance has actually been exhausted, the deduction will fail and the request is still served (to avoid degrading user experience for a billing edge case) but subsequent requests will be blocked after the cache refreshes.

## Security

### API Key Security

- Keys are never stored in plaintext. Only the SHA-256 hash is persisted.
- The full key is returned exactly once at creation time. It cannot be retrieved afterward.
- Key rotation generates a new secret while preserving the key ID. The old key is revoked after a configurable grace period (default: 24 hours) to allow clients to transition.
- Revoked keys return HTTP 401 immediately. There is no grace period for revocation.

### Scope Enforcement

API keys can be scoped to specific models, services, IP ranges, and spend limits. Scope is enforced at the Cloud API layer before any request reaches a downstream service. An over-scoped key (e.g., one that allows all models when the project only uses GPT-4) is a security risk. The dashboard displays warnings when keys have broader permissions than their actual usage pattern suggests.

### Rate Limiting

Rate limiting is enforced per API key using Redis sliding window counters:

```
Key: ratelimit:{api_key_id}:{minute_bucket}
TTL: 120 seconds
Increment on each request
Reject with HTTP 429 when count > key.scope.rateLimit
```

The default rate limit is 60 requests per minute. Enterprise projects can request higher limits.

### Audit Logging

All mutating operations on API keys, team membership, billing, and webhooks are logged to an append-only audit table:

```sql
CREATE TABLE audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_id    TEXT NOT NULL,          -- IAM user ID
    actor_email TEXT NOT NULL,
    action      TEXT NOT NULL,          -- e.g., "api_key.create", "member.invite"
    resource    TEXT NOT NULL,          -- e.g., "api_key:uuid", "project:uuid"
    details     JSONB NOT NULL,         -- Action-specific metadata
    ip_address  INET NOT NULL,
    user_agent  TEXT
);
```

Audit logs are immutable. They cannot be modified or deleted through any API. Retention is indefinite for compliance purposes.

### Data Isolation

Cloud never stores, logs, or inspects prompt content or completion content. Usage events record token counts and costs, not the text of requests or responses. This is a deliberate architectural constraint:

1. **Privacy**: Prompts may contain PII, trade secrets, or sensitive instructions. Cloud has no business reason to retain them.
2. **Compliance**: Storing prompt content would subject Cloud to data residency regulations in every jurisdiction where users operate. Storing only metadata avoids this.
3. **Performance**: Prompt content can be megabytes per request. Storing it would require orders of magnitude more storage and make the usage database unwieldy.

If a team needs request logging for debugging, they enable it in the LLM Gateway (HIP-0004) with their own storage destination. Cloud is not in that path.

### SOC 2 Compliance

For enterprise customers, Cloud maintains SOC 2 Type II compliance:

- **Access controls**: All internal access requires MFA and is logged.
- **Change management**: All infrastructure changes go through CI/CD with approval gates.
- **Monitoring**: Real-time alerting on anomalous access patterns.
- **Encryption**: All data encrypted at rest (AES-256) and in transit (TLS 1.3).
- **Vendor management**: Third-party AI providers are assessed for security posture.

## OpenAI API Compatibility

Cloud exposes an OpenAI-compatible API so that existing applications can switch to Hanzo by changing only the base URL and API key:

```python
# Before (OpenAI direct)
from openai import OpenAI
client = OpenAI(api_key="sk-...")

# After (Hanzo Cloud)
from openai import OpenAI
client = OpenAI(
    api_key="hk_live_...",
    base_url="https://cloud.hanzo.ai/v1"
)

# Same code works unchanged
response = client.chat.completions.create(
    model="gpt-4-turbo",
    messages=[{"role": "user", "content": "Hello"}]
)
```

This compatibility is achieved by implementing the OpenAI API spec at the Cloud API layer and translating requests to the LLM Gateway's internal format. The Gateway (HIP-0004) handles provider-specific translation.

Supported OpenAI-compatible endpoints:

```
POST /v1/chat/completions          # Chat completions (streaming + non-streaming)
POST /v1/completions               # Legacy completions
POST /v1/embeddings                # Text embeddings
POST /v1/images/generations        # Image generation
POST /v1/audio/transcriptions      # Speech to text
POST /v1/audio/translations        # Audio translation
GET  /v1/models                    # Available models
```

## SDK Integration

### Python

```python
from hanzo import Hanzo

client = Hanzo(api_key="hk_live_...")

# LLM inference
response = client.chat.completions.create(
    model="claude-3-opus",
    messages=[{"role": "user", "content": "Explain quantum computing"}]
)

# Usage check
usage = client.usage.summary()
print(f"This month: ${usage.total_cost / 100:.2f}")

# API key management
key = client.api_keys.create(name="production", scope={"models": ["gpt-4"]})
```

### TypeScript

```typescript
import { Hanzo } from '@hanzoai/sdk'

const client = new Hanzo({ apiKey: 'hk_live_...' })

// LLM inference
const response = await client.chat.completions.create({
  model: 'claude-3-opus',
  messages: [{ role: 'user', content: 'Explain quantum computing' }],
})

// Usage
const usage = await client.usage.summary()
console.log(`This month: $${(usage.totalCost / 100).toFixed(2)}`)
```

### Go

```go
import "github.com/hanzoai/go-sdk"

client := hanzo.NewClient("hk_live_...")

resp, err := client.Chat.Completions.Create(ctx, hanzo.ChatCompletionRequest{
    Model:    "claude-3-opus",
    Messages: []hanzo.Message{{Role: "user", Content: "Explain quantum computing"}},
})
```

## Migration Path

For teams currently using OpenAI, Anthropic, or other providers directly:

1. **Sign up** at cloud.hanzo.ai and create a project.
2. **Generate an API key** with appropriate scoping.
3. **Change two lines** in your application: the base URL and API key.
4. **Monitor usage** through the dashboard to understand cost and performance.
5. **Optimize** by enabling model routing rules (e.g., route simple queries to cheaper models).

No code changes beyond the base URL and API key are required for basic functionality. Advanced features (team management, usage alerts, agent deployment) are additive.

## Backwards Compatibility

Cloud maintains backwards compatibility with all previous API versions through URL versioning (`/v1/`, `/v2/`). Breaking changes are introduced only in new major versions. The previous version remains supported for a minimum of 12 months after a new version is released.

## References

- [HIP-0004: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md)
- [HIP-0009: Agent SDK](./hip-0009-agent-sdk-multi-agent-orchestration-framework.md)
- [HIP-0010: MCP Integration](./hip-0010-model-context-protocol-mcp-integration-standards.md)
- [HIP-0018: Payment Processing](./hip-0018-payment-processing-standard.md)
- [HIP-0026: Identity & Access Management](./hip-0026-identity-access-management-standard.md)
- [HIP-0027: KMS Standard](./hip-0027-key-management-service-standard.md)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
- [TimescaleDB Documentation](https://docs.timescale.com)

## Copyright

Copyright 2025 Hanzo AI, Inc. All rights reserved.
