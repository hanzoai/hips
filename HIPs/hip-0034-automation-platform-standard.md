---
hip: 0034
title: Automation Platform Standard
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2025-01-15
requires: HIP-0004, HIP-0010
---

# HIP-34: Automation Platform Standard

## Abstract

This proposal defines the Automation Platform Standard for **Hanzo Auto**, a no-code/low-code automation platform that connects the Hanzo ecosystem -- LLM Gateway, MCP tools, IAM, KMS, and 200+ external services -- through visual, event-driven flows. Hanzo Auto is a fork of ActivePieces, chosen for its MIT license, clean TypeScript piece (plugin) architecture, and first-class support for both drag-and-drop and inline code within the same flow.

**Repository**: [github.com/hanzoai/auto](https://github.com/hanzoai/auto)
**Production**: `auto.hanzo.ai`
**Port**: 8080
**Docker**: `hanzoai/auto:latest`

## Motivation

Modern AI infrastructure generates value only when it connects to real business processes. A team can have the best LLM Gateway (HIP-4), the most capable MCP tools (HIP-10), and sophisticated agents (HIP-9), but without a way to wire them into triggers, schedules, webhooks, and third-party services, the last mile between "AI capability" and "business outcome" remains unbuilt.

Current automation landscape problems:

1. **Vendor Lock-in**: Zapier and Make are SaaS-only. Your flows, execution history, and secrets live on someone else's infrastructure. You cannot self-host, audit, or fork.
2. **Per-Execution Pricing**: Zapier charges per "task" (each step counts). A 5-step flow running every minute costs thousands per month. This pricing model punishes high-frequency AI workloads.
3. **No AI-Native Primitives**: Existing platforms treat LLM calls as generic HTTP requests. There is no streaming support, no token tracking, no model routing, no MCP tool invocation.
4. **Fragmented Tooling**: Teams use Zapier for business automation, Airflow for data pipelines, and custom scripts for AI orchestration. Three systems, three failure modes, three sets of credentials.
5. **License Ambiguity**: n8n uses a "Sustainable Use License" (formerly fair-code). You can self-host, but you cannot offer it as a service or modify the licensing terms. This creates legal uncertainty for platform operators.

Hanzo Auto solves these problems with a single, self-hosted, MIT-licensed platform that treats AI operations as first-class citizens.

## Design Philosophy

### Why ActivePieces Over Alternatives

The automation platform space has four serious contenders. Here is why we chose ActivePieces as our upstream:

| Criterion | Zapier | Make | n8n | ActivePieces |
|-----------|--------|------|-----|--------------|
| **License** | Proprietary | Proprietary | Sustainable Use | MIT |
| **Self-hosted** | No | No | Yes | Yes |
| **Language** | N/A | N/A | TypeScript | TypeScript |
| **Plugin system** | Closed | Closed | Community nodes | Pieces (modular) |
| **Code blocks** | Limited | Limited | Function nodes | Full TypeScript |
| **Pricing** | Per-task | Per-operation | Per-workflow | Unlimited |
| **AI primitives** | HTTP only | HTTP only | HTTP only | Extensible |

**Zapier/Make** are immediately disqualified by vendor lock-in and per-execution pricing. AI workloads are high-frequency and high-volume; per-task pricing makes them economically unviable.

**n8n** is the closest open-source competitor. However:
- Its "Sustainable Use License" prohibits offering n8n as a managed service, which conflicts with `auto.hanzo.ai`.
- Its codebase mixes Vue.js frontend with a monolithic Node.js backend, making deep customization difficult.
- Community nodes are loosely structured, leading to inconsistent quality and API surfaces.

**ActivePieces** wins on every axis that matters to us:
- **MIT license** means we can fork, modify, host, and redistribute without legal constraints.
- **TypeScript throughout** (frontend and backend) means our team works in one language.
- **Piece architecture** is genuinely modular: each integration is an independent npm package with a typed schema, making it trivial to add Hanzo-specific pieces without touching core.
- **Built-in code blocks** let developers write arbitrary TypeScript inline, alongside visual steps in the same flow.

### Why Fork vs. Use Upstream

We maintain a fork (`github.com/hanzoai/auto`) rather than using ActivePieces directly for three reasons:

1. **AI-native pieces**: We need pieces that invoke the LLM Gateway with streaming support, call MCP tools with context propagation, authenticate via Hanzo IAM, and inject secrets from Hanzo KMS. These are deeply Hanzo-specific and would not be accepted upstream.

2. **Multi-tenant isolation**: Production `auto.hanzo.ai` serves multiple organizations. Each org needs isolated flow storage, execution quotas, and secret namespaces. ActivePieces' upstream multi-tenancy model does not align with Hanzo IAM's org/project hierarchy.

3. **Upstream compatibility**: We track upstream releases and rebase regularly. Our custom pieces live in a separate `@hanzoai/auto-pieces` package, keeping the fork diff minimal. This is not a hard fork -- it is a maintained extension.

### Why Visual + Code

Non-developers (ops teams, marketers, support leads) need drag-and-drop flows to connect services without writing code. Developers need code blocks for string manipulation, data transformation, conditional logic, and calling internal APIs.

ActivePieces supports both paradigms in the same flow:
- A visual trigger (e.g., "new Stripe payment") feeds into a code block (e.g., compute a loyalty tier), which feeds into a visual action (e.g., "update CRM record").
- This eliminates the false dichotomy between "no-code for simple things" and "code for everything else."

### How Auto Differs from Flow (HIP-13)

This is the most common point of confusion, so it deserves a thorough explanation.

**Flow** (HIP-13, `github.com/hanzoai/flow`, forked from Langflow) is a visual **AI workflow builder**. It is for constructing AI pipelines: prompt chains, RAG retrieval, agent loops, embedding generation, model evaluation. Its nodes are AI primitives -- LLMs, vector stores, retrievers, parsers, output formatters. Its users are AI engineers building and iterating on AI logic.

**Auto** (this HIP, `github.com/hanzoai/auto`, forked from ActivePieces) is a **business automation platform**. It is for connecting services: "when a form is submitted, call the LLM Gateway, store the result in Airtable, and send a Slack notification." Its nodes are service integrations -- triggers, actions, conditions, loops. Its users are operations teams, developers, and anyone who needs to automate a multi-step business process.

The distinction maps to a well-understood separation in software architecture:

| Dimension | Flow (HIP-13) | Auto (HIP-34) |
|-----------|---------------|----------------|
| **Purpose** | Build AI logic | Connect services |
| **Upstream** | Langflow | ActivePieces |
| **Nodes** | LLMs, retrievers, parsers | Triggers, actions, integrations |
| **Users** | AI engineers | Ops teams, developers |
| **Execution** | Synchronous chains | Event-driven, scheduled |
| **Triggers** | Manual, API call | Webhook, schedule, event |
| **Output** | AI response, evaluation | Side effects (send email, update DB) |
| **Analogy** | Jupyter Notebook for AI | Zapier, but self-hosted + AI-native |
| **URL** | flow.hanzo.ai | auto.hanzo.ai |

**They are complementary, not competing.** A typical production setup uses both:
1. An AI engineer builds an RAG pipeline in **Flow** and exposes it as an API endpoint.
2. An ops team builds an automation in **Auto** that triggers on a webhook, calls the Flow endpoint, and routes the result to Slack/email/CRM.

Flow is the brain. Auto is the nervous system.

## Specification

### Piece Architecture

A "piece" is ActivePieces' term for a plugin -- a self-contained integration package. Each piece exports triggers and/or actions with typed input/output schemas.

```typescript
// @hanzoai/auto-pieces/src/llm-gateway/index.ts
import { createPiece, PieceAuth } from '@activepieces/pieces-framework';
import { chatCompletion } from './actions/chat-completion';
import { streamCompletion } from './actions/stream-completion';
import { generateEmbedding } from './actions/generate-embedding';
import { completionFinished } from './triggers/completion-finished';

export const llmGateway = createPiece({
  displayName: 'Hanzo LLM Gateway',
  description: 'Invoke 100+ LLM providers via the unified Hanzo Gateway',
  auth: PieceAuth.CustomAuth({
    props: {
      apiKey: PieceAuth.SecretText({
        displayName: 'API Key',
        description: 'Hanzo API key (sk-hanzo-...)',
        required: true,
      }),
      baseUrl: PieceAuth.ShortText({
        displayName: 'Gateway URL',
        description: 'LLM Gateway endpoint',
        required: false,
        defaultValue: 'https://llm.hanzo.ai/v1',
      }),
    },
  }),
  logoUrl: 'https://cdn.hanzo.ai/img/logo-icon.svg',
  authors: ['hanzo'],
  actions: [chatCompletion, streamCompletion, generateEmbedding],
  triggers: [completionFinished],
});
```

### Hanzo-Specific Pieces

These are the custom pieces that justify the fork:

| Piece | Type | Description |
|-------|------|-------------|
| **LLM Gateway** | Action | Chat completions, embeddings, image generation via HIP-4 |
| **MCP Tools** | Action | Invoke any of 260+ MCP tools via HIP-10 |
| **IAM Auth** | Auth | OAuth2/OIDC authentication via Hanzo IAM (hanzo.id) |
| **KMS Secrets** | Utility | Inject secrets from Hanzo KMS at runtime |
| **Stream Events** | Trigger | React to events from Hanzo event stream |
| **Auto Agent** | Action | Spawn a Hanzo Agent (HIP-9) within a flow step |
| **Search** | Action | Invoke Hanzo Search with generative UI |
| **Commerce** | Action | Create orders, check balances, process payments |

### Trigger Types

Flows are initiated by triggers. Auto supports four trigger categories:

```yaml
Trigger Types:
  Webhook:
    description: "HTTP POST/GET to a unique URL starts the flow"
    use_case: "GitHub push event, Stripe payment, form submission"
    config:
      method: POST | GET
      path: /webhooks/{flow_id}
      auth: optional (HMAC, Bearer, Basic)

  Schedule:
    description: "Cron-based or interval-based execution"
    use_case: "Daily report, hourly sync, weekly cleanup"
    config:
      cron: "0 9 * * MON-FRI"
      timezone: "America/Los_Angeles"

  Event:
    description: "React to events from Hanzo Stream or external event buses"
    use_case: "New user signup, model training complete, payment received"
    config:
      source: hanzo-stream | kafka | redis-pubsub
      topic: "user.created"
      filter: "$.org_id == 'hanzo'"

  Polling:
    description: "Periodically check an external service for changes"
    use_case: "New rows in Google Sheets, new emails, RSS feed updates"
    config:
      interval: 300  # seconds
      deduplication: "$.id"
```

### Flow Definition Format

Flows are stored as JSON documents in PostgreSQL:

```json
{
  "id": "flow_abc123",
  "name": "AI Support Ticket Router",
  "org_id": "org_hanzo",
  "project_id": "proj_main",
  "version": 3,
  "trigger": {
    "type": "webhook",
    "config": {
      "method": "POST",
      "path": "/webhooks/flow_abc123"
    }
  },
  "steps": [
    {
      "id": "step_1",
      "type": "action",
      "piece": "@hanzoai/auto-pieces-llm-gateway",
      "action": "chatCompletion",
      "input": {
        "model": "zen-72b",
        "messages": [
          {
            "role": "system",
            "content": "Classify the following support ticket..."
          },
          {
            "role": "user",
            "content": "{{trigger.body.message}}"
          }
        ],
        "temperature": 0.1
      }
    },
    {
      "id": "step_2",
      "type": "branch",
      "conditions": [
        {
          "if": "{{step_1.output.category == 'billing'}}",
          "goto": "step_3a"
        },
        {
          "if": "{{step_1.output.category == 'technical'}}",
          "goto": "step_3b"
        }
      ],
      "default": "step_3c"
    },
    {
      "id": "step_3a",
      "type": "action",
      "piece": "@activepieces/piece-slack",
      "action": "sendMessage",
      "input": {
        "channel": "#billing-support",
        "text": "New billing ticket: {{trigger.body.subject}}"
      }
    },
    {
      "id": "step_3b",
      "type": "action",
      "piece": "@hanzoai/auto-pieces-mcp",
      "action": "executeTool",
      "input": {
        "tool": "search",
        "arguments": {
          "query": "{{trigger.body.message}}",
          "scope": "docs"
        }
      }
    },
    {
      "id": "step_3c",
      "type": "action",
      "piece": "@activepieces/piece-gmail",
      "action": "sendEmail",
      "input": {
        "to": "support@hanzo.ai",
        "subject": "Unclassified: {{trigger.body.subject}}",
        "body": "{{trigger.body.message}}"
      }
    }
  ],
  "error_handling": {
    "retry": {
      "max_attempts": 3,
      "backoff": "exponential",
      "initial_delay_ms": 1000
    },
    "on_failure": "notify",
    "notification_channel": "#auto-alerts"
  }
}
```

### Execution Engine

The execution engine processes flows with reliability guarantees:

```typescript
interface FlowExecution {
  id: string;
  flowId: string;
  flowVersion: number;
  orgId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'paused';
  trigger: TriggerEvent;
  steps: StepExecution[];
  startedAt: string;
  completedAt?: string;
  duration_ms?: number;
  error?: ExecutionError;
}

interface StepExecution {
  stepId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  input: Record<string, any>;
  output: Record<string, any>;
  duration_ms: number;
  retryCount: number;
  error?: StepError;
}

interface ExecutionError {
  stepId: string;
  code: string;
  message: string;
  retryable: boolean;
}
```

Execution guarantees:

```yaml
Execution Engine:
  Delivery:
    guarantee: at-least-once
    deduplication: idempotency keys on triggers

  Retry:
    strategy: exponential backoff with jitter
    max_attempts: configurable per step (default 3)
    dead_letter: failed executions stored for manual replay

  Timeout:
    per_step: 300s (configurable)
    per_flow: 3600s (configurable)

  Concurrency:
    per_flow: configurable (default 10 parallel executions)
    per_org: configurable quota
    global: worker pool with auto-scaling

  Ordering:
    guarantee: none (event-driven, not sequential)
    option: enable FIFO mode per flow for ordered processing
```

### Multi-Tenancy

Each organization gets fully isolated automation:

```yaml
Multi-Tenancy Model:
  Organization:
    - Isolated flow storage (PostgreSQL row-level security)
    - Separate execution queues
    - Independent secret namespaces (via KMS)
    - Per-org rate limits and quotas

  Project:
    - Flows belong to projects within an org
    - Project-level API keys
    - Shared pieces across projects in same org

  User:
    - RBAC via Hanzo IAM
    - Roles: Owner, Editor, Viewer
    - Audit log per user action

  Mapping to IAM:
    org_id:     → IAM Organization
    project_id: → IAM Application
    user_id:    → IAM User
    api_key:    → IAM Access Token
```

### API Specification

Programmatic flow management via REST API:

```yaml
Flows:
  POST   /api/v1/flows                  # Create flow
  GET    /api/v1/flows                  # List flows (paginated)
  GET    /api/v1/flows/{id}             # Get flow
  PUT    /api/v1/flows/{id}             # Update flow
  DELETE /api/v1/flows/{id}             # Delete flow
  POST   /api/v1/flows/{id}/enable      # Enable flow
  POST   /api/v1/flows/{id}/disable     # Disable flow
  POST   /api/v1/flows/{id}/test        # Test-run flow

Executions:
  GET    /api/v1/executions             # List executions (paginated)
  GET    /api/v1/executions/{id}        # Get execution details
  POST   /api/v1/executions/{id}/retry  # Retry failed execution
  POST   /api/v1/executions/{id}/cancel # Cancel running execution

Pieces:
  GET    /api/v1/pieces                 # List available pieces
  GET    /api/v1/pieces/{name}          # Get piece schema

Connections:
  POST   /api/v1/connections            # Store auth credentials
  GET    /api/v1/connections            # List connections
  DELETE /api/v1/connections/{id}       # Remove connection

Webhooks:
  POST   /webhooks/{flow_id}           # Trigger webhook flow
  GET    /webhooks/{flow_id}           # Trigger webhook flow (GET)
```

Authentication: All API endpoints (except `/webhooks/*`) require a Bearer token from Hanzo IAM.

## Implementation

### Production Deployment

```yaml
Service: auto.hanzo.ai
Cluster: hanzo-k8s (24.199.76.156)
Namespace: hanzo

Components:
  Frontend:
    image: hanzoai/auto:latest
    replicas: 2
    port: 8080
    resources:
      requests: { cpu: 250m, memory: 512Mi }
      limits: { cpu: 1000m, memory: 1Gi }

  Worker:
    image: hanzoai/auto-worker:latest
    replicas: 3
    resources:
      requests: { cpu: 500m, memory: 1Gi }
      limits: { cpu: 2000m, memory: 4Gi }
    env:
      - SANDBOX_MEMORY_LIMIT: 256Mi
      - SANDBOX_TIMEOUT: 300

  Database:
    type: PostgreSQL
    host: postgres.hanzo.svc
    database: hanzo_auto

  Cache:
    type: Redis
    host: redis.hanzo.svc
    database: 3
```

### Docker Compose (Local Development)

```yaml
# compose.yml
services:
  auto:
    image: hanzoai/auto:latest
    ports:
      - "8080:8080"
    environment:
      - AP_DB_TYPE=POSTGRES
      - AP_POSTGRES_DATABASE=hanzo_auto
      - AP_POSTGRES_HOST=postgres
      - AP_POSTGRES_PORT=5432
      - AP_POSTGRES_USERNAME=hanzo
      - AP_POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - AP_REDIS_URL=redis://redis:6379
      - AP_ENCRYPTION_KEY=${ENCRYPTION_KEY}
      - AP_JWT_SECRET=${JWT_SECRET}
      - AP_FRONTEND_URL=http://localhost:8080
      - AP_WEBHOOK_URL=http://localhost:8080
      - HANZO_IAM_URL=https://hanzo.id
      - HANZO_KMS_URL=https://kms.hanzo.ai
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=hanzo_auto
      - POSTGRES_USER=hanzo
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    volumes:
      - auto_pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - auto_redis:/data

volumes:
  auto_pgdata:
  auto_redis:
```

### Custom Piece Development

Creating a new Hanzo piece follows the ActivePieces piece framework:

```typescript
// packages/pieces/hanzo-kms/src/index.ts
import { createPiece } from '@activepieces/pieces-framework';
import { getSecret } from './actions/get-secret';
import { createSecret } from './actions/create-secret';

export const hanzoKms = createPiece({
  displayName: 'Hanzo KMS',
  description: 'Retrieve and manage secrets from Hanzo Key Management Service',
  auth: PieceAuth.CustomAuth({
    props: {
      machineIdentityId: PieceAuth.SecretText({
        displayName: 'Machine Identity ID',
        required: true,
      }),
      machineIdentitySecret: PieceAuth.SecretText({
        displayName: 'Machine Identity Secret',
        required: true,
      }),
      kmsUrl: PieceAuth.ShortText({
        displayName: 'KMS URL',
        defaultValue: 'https://kms.hanzo.ai',
        required: false,
      }),
    },
  }),
  actions: [getSecret, createSecret],
  triggers: [],
});

// packages/pieces/hanzo-kms/src/actions/get-secret.ts
import { createAction, Property } from '@activepieces/pieces-framework';

export const getSecret = createAction({
  name: 'get_secret',
  displayName: 'Get Secret',
  description: 'Retrieve a secret value from KMS',
  props: {
    environment: Property.ShortText({
      displayName: 'Environment',
      description: 'KMS environment slug',
      required: true,
      defaultValue: 'production',
    }),
    secretPath: Property.ShortText({
      displayName: 'Secret Path',
      description: 'Path to the secret (e.g., /app/database)',
      required: true,
    }),
    secretKey: Property.ShortText({
      displayName: 'Secret Key',
      description: 'Key name within the path',
      required: true,
    }),
  },
  async run(context) {
    const { machineIdentityId, machineIdentitySecret, kmsUrl } = context.auth;

    // Authenticate with KMS via Universal Auth
    const tokenRes = await context.httpClient.post(`${kmsUrl}/api/v1/auth/universal-auth/login`, {
      clientId: machineIdentityId,
      clientSecret: machineIdentitySecret,
    });

    // Retrieve secret
    const secretRes = await context.httpClient.get(
      `${kmsUrl}/api/v3/secrets/raw/${context.propsValue.secretKey}`,
      {
        headers: { Authorization: `Bearer ${tokenRes.body.accessToken}` },
        params: {
          workspaceSlug: context.propsValue.environment,
          secretPath: context.propsValue.secretPath,
        },
      }
    );

    return { value: secretRes.body.secret.secretValue };
  },
});
```

### Execution Sandbox

Flow steps execute in isolated sandboxes to prevent interference:

```yaml
Sandbox Architecture:
  Runtime: Node.js worker threads (code blocks) + HTTP calls (pieces)

  Code Block Isolation:
    method: vm2 sandbox (Node.js)
    memory_limit: 256MB per step
    timeout: 300s per step
    network: restricted to allowlisted domains
    filesystem: no access

  Piece Execution:
    method: process-level isolation
    auth: credentials injected at runtime, never persisted in flow JSON
    http: outbound only, no inbound listeners

  Secrets:
    storage: encrypted at rest in PostgreSQL (AES-256-GCM)
    injection: decrypted at execution time only
    kms_integration: optionally synced from Hanzo KMS
    rotation: automatic via KMS secret versioning
```

## Security

### Authentication and Authorization

```yaml
Authentication:
  UI Login:
    method: OAuth2 via Hanzo IAM (hanzo.id)
    flow: Authorization Code + PKCE
    scopes: [auto:read, auto:write, auto:admin]

  API Access:
    method: Bearer token (IAM access token) or API key
    validation: token introspection against IAM

  Webhook Endpoints:
    method: optional HMAC signature verification
    config: per-flow shared secret

Authorization:
  Model: Role-Based Access Control (RBAC)
  Roles:
    owner:  [create, read, update, delete, enable, disable, manage_connections]
    editor: [create, read, update, enable, disable]
    viewer: [read]
  Enforcement: checked on every API call and UI action
```

### Secret Management

```yaml
Secret Handling:
  Storage:
    - Connection credentials encrypted at rest (AES-256-GCM)
    - Encryption key stored in environment variable (AP_ENCRYPTION_KEY)
    - Never stored in flow definitions (reference by connection ID)

  KMS Integration:
    - Preferred method for production deployments
    - Secrets synced from kms.hanzo.ai via Universal Auth
    - Automatic rotation support
    - Audit trail of secret access

  Runtime:
    - Secrets decrypted only during step execution
    - Cleared from memory after step completes
    - Never logged or included in execution output
```

### Flow Execution Security

```yaml
Execution Security:
  Input Validation:
    - All trigger payloads validated against schema
    - Template injection prevention ({{...}} expressions sandboxed)
    - Maximum payload size: 10MB

  Network:
    - Outbound requests only (no inbound listeners from steps)
    - TLS required for all external connections
    - DNS resolution restricted in sandbox

  Resource Limits:
    - Per-step: 256MB memory, 300s timeout
    - Per-flow: 3600s total timeout
    - Per-org: configurable execution quota

  Audit:
    - All flow creates/updates/deletes logged
    - All executions logged with trigger, steps, duration, status
    - Retention: 90 days (configurable)
    - Export: structured JSON for SIEM integration
```

## Integration with Hanzo Ecosystem

### Service Map

```
                  ┌───────────────────────────┐
                  │     Hanzo Auto (HIP-34)    │
                  │      auto.hanzo.ai         │
                  └─────┬─────┬─────┬─────┬───┘
                        │     │     │     │
          ┌─────────────┘     │     │     └──────────────┐
          │                   │     │                     │
          v                   v     v                     v
    ┌───────────┐    ┌──────────┐  ┌──────────┐   ┌────────────┐
    │    IAM    │    │   LLM    │  │   MCP    │   │    KMS     │
    │  HIP-N/A  │    │  HIP-4   │  │  HIP-10  │   │   HIP-N/A  │
    │ hanzo.id  │    │ llm.hanzo│  │  260+    │   │kms.hanzo.ai│
    │           │    │ .ai      │  │  tools   │   │            │
    └───────────┘    └──────────┘  └──────────┘   └────────────┘
         auth          AI calls     tool exec      secret mgmt

    ┌───────────┐    ┌──────────┐  ┌──────────┐   ┌────────────┐
    │   Flow    │    │  Agent   │  │ Commerce │   │  External  │
    │  HIP-13   │    │  HIP-9   │  │  HIP-18  │   │  200+      │
    │flow.hanzo │    │  agents  │  │ commerce │   │  services  │
    │  .ai      │    │          │  │ .hanzo.ai│   │            │
    └───────────┘    └──────────┘  └──────────┘   └────────────┘
    AI pipelines     agent spawn    billing        Slack, GitHub,
                                                   Sheets, etc.
```

### Example: Full-Stack AI Automation

This example demonstrates Auto and Flow working together:

1. **Flow** (HIP-13): AI engineer builds a RAG pipeline that answers questions about product documentation. Exposed at `flow.hanzo.ai/api/v1/run/doc-qa`.

2. **Auto** (HIP-34): Ops team builds an automation:
   - **Trigger**: Webhook from Intercom (new support message)
   - **Step 1**: Call Flow's doc-qa endpoint with the customer's question
   - **Step 2**: If confidence > 0.8, auto-reply via Intercom API
   - **Step 3**: If confidence <= 0.8, create a Jira ticket and notify #support on Slack
   - **Step 4**: Log the interaction to Hanzo Analytics (HIP-17)

The AI engineer iterates on the RAG pipeline in Flow. The ops team iterates on the routing logic in Auto. Neither blocks the other.

## Implementation Roadmap

### Phase 1: Core Platform (Q1 2025)
- Fork ActivePieces, rebrand to Hanzo Auto
- Deploy to hanzo-k8s at auto.hanzo.ai
- IAM OAuth2 integration for login
- LLM Gateway piece (chat completions, embeddings)
- 10 most-used external pieces (Slack, Gmail, Sheets, GitHub, etc.)

### Phase 2: AI-Native Pieces (Q2 2025)
- MCP Tools piece (invoke any of 260+ tools)
- KMS Secrets piece (runtime secret injection)
- Stream Events trigger (react to Hanzo event bus)
- Agent piece (spawn HIP-9 agents within flows)
- Streaming LLM support (SSE pass-through)

### Phase 3: Enterprise Features (Q3 2025)
- Multi-tenant isolation with IAM org mapping
- Per-org execution quotas and rate limits
- Flow versioning and rollback
- Execution replay for debugging
- RBAC enforcement via IAM roles

### Phase 4: Scale and Optimize (Q4 2025)
- Horizontal worker scaling on K8s
- Flow templates marketplace
- Custom piece SDK documentation
- Webhook delivery guarantees (retry with dead-letter)
- Prometheus metrics and Grafana dashboards

## Backwards Compatibility

Hanzo Auto tracks upstream ActivePieces releases. All upstream community pieces work without modification. Custom Hanzo pieces are maintained in a separate `@hanzoai/auto-pieces` npm scope, ensuring zero conflicts with upstream updates.

Migration path from other platforms:
- **Zapier**: Import via Zapier's export format (JSON) with a conversion script
- **n8n**: Manual rebuild (no standard export format)
- **Make**: Manual rebuild (proprietary format)

## References

1. [ActivePieces](https://github.com/activepieces/activepieces) - MIT-licensed automation platform
2. [HIP-4: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md) - Unified AI provider interface
3. [HIP-10: MCP Integration](./hip-0010-model-context-protocol-mcp-integration-standards.md) - Model Context Protocol standards
4. [HIP-13: Workflow Execution](./hip-0013-workflow-execution-standard.md) - Flow (Langflow) AI workflow builder
5. [HIP-9: Agent SDK](./hip-0009-agent-sdk-multi-agent-orchestration-framework.md) - Multi-agent orchestration
6. [HIP-18: Payment Processing](./hip-0018-payment-processing-standard.md) - Commerce integration
7. [Hanzo Auto Repository](https://github.com/hanzoai/auto)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
