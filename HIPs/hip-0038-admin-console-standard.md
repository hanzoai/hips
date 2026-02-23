---
hip: 0038
title: Admin Console Standard
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2025-01-15
requires: HIP-0026, HIP-0027
---

# HIP-38: Admin Console Standard

## Abstract

Hanzo Console is the administrative dashboard for Hanzo platform operators, serving production traffic at **console.hanzo.ai**. It provides a unified interface for managing organizations, users, projects, API keys, quotas, billing oversight, and infrastructure health across the entire Hanzo ecosystem.

Console is built on a fork of [Langfuse](https://github.com/langfuse/langfuse), an open-source LLM engineering platform, chosen for its mature tracing, evaluation, and prompt management capabilities. Hanzo extends it with multi-organization administration, IAM integration (HIP-26), KMS secret management (HIP-27), and operator-grade access controls.

The distinction between Console and Cloud is fundamental to Hanzo's architecture. Cloud (cloud.hanzo.ai) is the customer-facing product where teams manage their AI workloads. Console is the operator-facing product where Hanzo administrators manage the platform itself. This separation follows the control plane vs. management plane pattern established by cloud infrastructure providers.

**Repository**: [github.com/hanzoai/console](https://github.com/hanzoai/console)
**Port**: 3000
**Docker**: `ghcr.io/hanzoai/console:latest`

## Motivation

### The Problem

A platform serving multiple organizations (Hanzo, Lux, Zoo, Pars) across multiple products (Cloud, Chat, Commerce, Platform) generates operational complexity that no individual service dashboard can address:

1. **No unified view**: Each service has its own admin panel, if it has one at all. An operator diagnosing a billing issue must SSH into the IAM database, cross-reference with Cloud logs, and check KMS audit trails. This takes minutes instead of seconds.

2. **Organization sprawl**: Hanzo serves four distinct brands with separate user bases, billing, and branding. Creating a new organization requires touching IAM (create org), KMS (create project), Cloud (provision resources), and Commerce (set up billing). Without Console, this is four manual operations across four systems.

3. **No audit visibility**: When an API key is created, a user role is changed, or a project quota is updated, operators need a single place to see what happened, when, and by whom. Without centralized audit logging, compliance requires stitching together logs from every service.

4. **Unsafe direct database access**: Without an admin UI, operators resort to direct database queries for common tasks -- resetting a user's password, adjusting a balance, revoking a token. Direct database access is error-prone, unaudited, and bypasses business logic.

5. **LLM observability gap**: AI workloads are expensive and opaque. Without tracing and evaluation infrastructure, operators cannot answer basic questions: which models are users calling, how much are they spending, which prompts are performing poorly.

### Why Console Solves This

Console provides a single pane of glass for all operator tasks. It proxies to IAM for identity operations, KMS for secret management, Cloud for workload monitoring, and LLM Gateway for usage analytics. Operators never touch databases directly. Every action is authenticated, authorized, and logged.

## Design Philosophy

This section explains the reasoning behind Console's architecture. These decisions are interconnected -- changing one would cascade into the others.

### Why Separate Console from Cloud

Cloud and Console serve fundamentally different audiences with different trust levels and different operational needs.

**Cloud** is a customer-facing product. A team at an AI startup uses Cloud to manage their LLM deployments, monitor costs, and evaluate model performance. Cloud users see only their own organization's data. The UI is designed for ease of use, onboarding, and self-service. Trust level: authenticated external users.

**Console** is an operator-facing product. A Hanzo engineer uses Console to manage the platform itself -- creating organizations, adjusting quotas, investigating billing anomalies, monitoring infrastructure health. Console users see data across all organizations. The UI is designed for power users who need complete visibility. Trust level: internal administrators with elevated privileges.

This mirrors the pattern in cloud infrastructure:
- **AWS Console** (customer-facing): Teams manage their own EC2 instances, S3 buckets, and Lambda functions.
- **AWS Organizations** (operator-facing): The account administrator manages billing, access policies, and organizational structure across all accounts.
- **Kubernetes**: The dashboard (customer-facing workload management) is separate from the control plane (operator-facing cluster management).

Combining these into a single application creates a permission and UX problem. Either the UI is cluttered with admin controls that 99% of users should never see, or the permission model is so complex that a misconfiguration could expose operator tools to customers. Separating them at the application level makes the security boundary explicit and the UX clean.

### Why Multi-Org from Day One

Hanzo is not a single-product company. It operates four brands:

| Organization | Domain | Purpose |
|-------------|--------|---------|
| Hanzo | hanzo.ai | AI infrastructure and services |
| Lux | lux.network | Blockchain network and validators |
| Zoo | zoo.ngo | Decentralized AI research foundation |
| Pars | pars.ai | Regional AI platform |

Each organization has its own users, billing, API keys, branding, and compliance requirements. A Lux validator operator should never see Hanzo AI billing data. A Zoo researcher should not have access to Pars API keys.

But the infrastructure is shared. All four organizations run on the same Kubernetes clusters, use the same IAM instance, share the same KMS. An operator managing this infrastructure needs to work across all organizations in a single session.

Console's multi-org bootstrap solves this at startup:

```bash
# Environment variables for multi-org provisioning
HANZO_INIT_ORG_IDS=hanzo,lux,zoo,pars
HANZO_INIT_ORG_NAMES="Hanzo,Lux Network,Zoo Labs,Pars"
HANZO_INIT_USER_EMAIL=z@hanzo.ai
HANZO_INIT_PROJECT_ORG_ID=hanzo
```

On first boot, Console calls IAM to create or upsert all four organizations, grants OWNER membership to the bootstrap user, and creates default projects and API keys for the primary org. This means a fresh deployment goes from zero to fully multi-org in a single startup, not a series of manual steps.

The alternative -- adding organizations one at a time through a UI -- is both slow and error-prone. It also introduces a chicken-and-egg problem: you need an organization to log in, but you need to log in to create an organization. Bootstrap solves this.

### Why Membership-Based Access

Users can belong to multiple organizations with different roles. This is a deliberate design choice that reflects how real teams work.

Consider `z@hanzo.ai`:
- **OWNER** of the `hanzo` organization (full admin access)
- **ADMIN** of the `lux` organization (can manage users and projects)
- **MEMBER** of the `zoo` organization (can view data but not change settings)

The three-tier role hierarchy:

| Role | Capabilities |
|------|-------------|
| **OWNER** | Full control: create/delete projects, manage billing, invite/remove users, change org settings, delete the organization |
| **ADMIN** | Operational control: manage projects, invite users, view billing, manage API keys |
| **MEMBER** | Read access: view projects, traces, evaluations; use API keys assigned to their projects |

This is simpler than fine-grained RBAC (which Casdoor supports but Console does not expose). Three roles cover 95% of real-world access patterns. Adding custom roles would increase the permission surface area without proportional benefit. If a specific permission is needed (e.g., "can view billing but not traces"), the answer is to create a separate project with appropriate visibility, not to add another role.

### How It Integrates

Console does not own data. It is a management proxy that delegates to specialized services:

```
Console (console.hanzo.ai)
    |
    |-- IAM (hanzo.id, HIP-26)
    |     |-- Organization CRUD
    |     |-- User management
    |     |-- Role/membership management
    |     |-- Balance queries
    |     |-- OAuth application management
    |
    |-- KMS (kms.hanzo.ai, HIP-27)
    |     |-- Secret creation and rotation
    |     |-- Project-scoped secret access
    |     |-- Audit log retrieval
    |
    |-- LLM Gateway (llm.hanzo.ai, HIP-4)
    |     |-- Usage metrics per org/project/user
    |     |-- Model performance data
    |     |-- Cost tracking
    |
    |-- Cloud (cloud.hanzo.ai)
          |-- Deployment status
          |-- Resource utilization
          |-- Service health
```

This proxy architecture means Console has no persistent state of its own beyond session data. If Console goes down, the underlying services continue operating. If Console needs to be redeployed, there is no data migration -- just restart the container.

## Specification

### Organization Management

Console provides full lifecycle management for organizations:

```typescript
interface Organization {
  id: string;                    // Unique identifier
  name: string;                  // URL-safe slug (e.g., "hanzo")
  displayName: string;           // Human-readable name (e.g., "Hanzo AI")
  websiteUrl: string;            // Organization website
  logoUrl?: string;              // Custom branding
  themeData: {
    themeType: "dark" | "light";
    colorPrimary: string;        // Hex color (e.g., "#fd4444")
  };
  passwordType: string;          // Hash algorithm (argon2id)
  defaultApplication: string;    // Default OAuth app
  createdTime: string;           // ISO 8601
  memberCount: number;           // Computed from memberships
}
```

Operations:
- **Create organization**: Calls IAM `POST /api/add-organization`. Automatically creates default OAuth application and certificate.
- **Update organization**: Calls IAM `POST /api/update-organization`. Supports branding, password policy, and MFA settings.
- **List organizations**: Calls IAM `GET /api/get-organizations`. Filtered by operator's membership.
- **Delete organization**: Calls IAM `POST /api/delete-organization`. Requires OWNER role. Cascades to applications, users (membership only), and projects.

### User Management

```typescript
interface UserMembership {
  userId: string;
  organizationId: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  joinedAt: string;
  invitedBy?: string;
}
```

Operations:
- **Invite user**: Send email invitation with org-scoped role. Creates pending membership.
- **Change role**: OWNER can change any member's role. ADMIN can change MEMBER roles only.
- **Remove member**: Revokes membership. Does not delete the user account (they may belong to other orgs).
- **View user details**: Cross-org view showing all memberships, balance, last login, and active sessions.
- **Reset credentials**: Trigger password reset email. Revoke all active sessions.

### Project Management

Projects are the primary resource isolation unit within an organization. Each project has its own API keys, quotas, traces, and evaluations.

```typescript
interface Project {
  id: string;
  name: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
  settings: {
    defaultModel?: string;       // Default LLM for this project
    maxTokensPerRequest?: number;
    monthlyBudget?: number;      // USD budget cap
    rateLimitRpm?: number;       // Requests per minute
  };
  apiKeys: APIKey[];
}

interface APIKey {
  id: string;
  projectId: string;
  name: string;
  keyPrefix: string;             // First 8 chars for identification
  hashedKey: string;             // Stored hashed, never in plaintext
  scopes: string[];              // e.g., ["traces:read", "traces:write"]
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
}
```

Operations:
- **Create project**: Within an organization. Generates initial API key pair.
- **Configure quotas**: Set per-project budget caps, rate limits, and model restrictions.
- **Rotate API keys**: Generate new key, revoke old key. Supports grace period for migration.
- **Archive project**: Soft-delete. Data retained for audit but API keys revoked.

### LLM Observability

Console inherits Langfuse's tracing and evaluation capabilities, extended for multi-org use:

- **Traces**: Hierarchical view of LLM calls, with latency, token counts, cost, and model metadata.
- **Evaluations**: LLM-as-a-judge, manual labeling, and custom evaluation pipelines.
- **Prompt management**: Version-controlled prompts with A/B testing support.
- **Datasets**: Curated test sets for regression testing and benchmarking.
- **Dashboards**: Per-org and per-project usage analytics with cost breakdowns.

### Infrastructure Monitoring

Console aggregates health signals from all Hanzo services:

```typescript
interface ServiceHealth {
  name: string;                  // e.g., "iam", "kms", "llm-gateway"
  url: string;                   // Health check endpoint
  status: "healthy" | "degraded" | "down";
  latencyMs: number;
  lastChecked: string;
  details?: Record<string, any>; // Service-specific metadata
}
```

Monitored services:
| Service | Health Endpoint | Expected Response |
|---------|----------------|-------------------|
| IAM | `https://hanzo.id/api/health` | `{"status": "ok"}` |
| KMS | `https://kms.hanzo.ai/api/status` | `{"status": "ok"}` |
| LLM Gateway | `https://llm.hanzo.ai/health` | `{"status": "ok"}` |
| Cloud | `https://cloud.hanzo.ai/api/health` | `{"status": "ok"}` |
| Console | `https://console.hanzo.ai/api/health` | `{"status": "ok"}` |

### Billing Oversight

Console provides operator-level billing visibility by aggregating data from IAM balances and Cloud usage:

- **Credit allocation**: View and adjust user balances across organizations.
- **Usage reports**: Per-org, per-project, per-user cost breakdowns by time period.
- **Budget alerts**: Configure thresholds that trigger notifications when an org or project approaches its budget cap.
- **Transaction history**: Full ledger of credits (from Commerce) and debits (from Cloud/LLM Gateway) via IAM's transaction API.

### Audit Log

Every administrative action in Console generates an audit entry:

```typescript
interface AuditEntry {
  id: string;
  timestamp: string;             // ISO 8601
  actor: {
    userId: string;
    email: string;
    role: string;
    ipAddress: string;
    userAgent: string;
  };
  action: string;                // e.g., "org.update", "user.invite", "apikey.create"
  resource: {
    type: string;                // e.g., "organization", "user", "project"
    id: string;
    name: string;
  };
  organizationId: string;
  details: Record<string, any>;  // Action-specific metadata
  result: "success" | "failure";
  errorMessage?: string;
}
```

Audit logs are queryable by time range, actor, action type, resource, and organization. They are immutable -- once written, they cannot be modified or deleted, even by OWNER users. Retention is configurable per organization (default: 90 days).

### Settings

Per-organization configuration managed through Console:

- **Custom domains**: Map organization domains to IAM login pages.
- **Branding**: Logo, primary color, theme (dark/light) for the login page and Console chrome.
- **OAuth providers**: Configure social login providers (GitHub, Google, Microsoft) per organization.
- **MFA policy**: Require MFA for all users, admin users only, or optional.
- **Session policy**: Configure session timeout, maximum concurrent sessions, and IP allowlists.
- **Notification channels**: Configure Slack webhooks, email notifications for billing alerts and security events.

## Implementation

### Architecture

```
                         Internet
                            |
                  +---------+---------+
                  |      Traefik      |
                  | (TLS termination) |
                  +---------+---------+
                            |
                  console.hanzo.ai
                            |
              +-------------+-------------+
              |    Hanzo Console           |
              |    (Next.js 14)            |
              |      :3000                 |
              +---+------+------+----+----+
                  |      |      |    |
           +------+  +---+--+ +--+--+  +-------+
           | IAM  |  | KMS  | | LLM |  | Cloud |
           |:8000 |  |:8080 | |:4000|  | :8000 |
           +--+---+  +--+---+ +--+--+  +---+---+
              |         |        |          |
        +-----+----+ +--+---+ +-+------+ +-+------+
        |PostgreSQL | |Vault | |100+    | |Workers |
        | hanzo_iam | |Store | |Models  | |Queues  |
        +----------+ +------+ +--------+ +--------+
```

### Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Frontend | Next.js 14 (Pages Router) | SSR for admin dashboards, tRPC for type safety |
| UI | shadcn/ui (Radix primitives) + Tailwind CSS | Consistent with Hanzo design system |
| API | tRPC (internal) + REST (public) | Type-safe internal APIs, standard REST for integrations |
| Database | PostgreSQL (Prisma ORM) | Primary data store for projects, traces, evaluations |
| Analytics | ClickHouse | High-volume trace data, fast aggregation queries |
| Cache/Queue | Redis + BullMQ | Session cache, background job processing |
| Storage | MinIO (S3-compatible) | File attachments, exported reports |
| Auth | NextAuth.js with IAM provider | Delegates to hanzo.id for OAuth |

### Production Deployment

Console runs on the **hanzo-k8s** DOKS cluster at `24.199.76.156`:

```yaml
# compose.prod.yaml (simplified)
services:
  console-web:
    image: ghcr.io/hanzoai/console:latest
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: ${DATABASE_URL}
      CLICKHOUSE_URL: ${CLICKHOUSE_URL}
      REDIS_URL: ${REDIS_URL}
      NEXTAUTH_URL: https://console.hanzo.ai
      NEXTAUTH_SECRET: ${NEXTAUTH_SECRET}
      HANZO_IAM_URL: https://hanzo.id
      HANZO_IAM_CLIENT_ID: hanzo-console-client-id
      HANZO_IAM_CLIENT_SECRET: ${HANZO_IAM_CLIENT_SECRET}
      HANZO_INIT_ORG_IDS: hanzo,lux,zoo,pars
      HANZO_INIT_ORG_NAMES: "Hanzo,Lux Network,Zoo Labs,Pars"
      HANZO_INIT_USER_EMAIL: z@hanzo.ai
      HANZO_INIT_PROJECT_ORG_ID: hanzo
      S3_ENDPOINT: ${S3_ENDPOINT}
      S3_BUCKET: console-data
    labels:
      - "traefik.http.routers.console.rule=Host(`console.hanzo.ai`)"
      - "traefik.http.routers.console.tls=true"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  console-worker:
    image: ghcr.io/hanzoai/console-worker:latest
    environment:
      DATABASE_URL: ${DATABASE_URL}
      CLICKHOUSE_URL: ${CLICKHOUSE_URL}
      REDIS_URL: ${REDIS_URL}
    depends_on:
      console-web:
        condition: service_healthy
```

### Bootstrap Sequence

On first startup, Console executes the following bootstrap sequence:

```
1. Connect to PostgreSQL and run Prisma migrations
2. Connect to ClickHouse and initialize analytics schema
3. Read HANZO_INIT_ORG_IDS environment variable
4. For each org ID:
   a. Call IAM GET /api/get-organization/{orgId}
   b. If not found: Call IAM POST /api/add-organization
   c. If found: Call IAM POST /api/update-organization (upsert)
5. Read HANZO_INIT_USER_EMAIL
   a. Call IAM GET /api/get-user to find or create user
   b. Grant OWNER membership for all initialized orgs
6. Read HANZO_INIT_PROJECT_ORG_ID
   a. Create default project in specified org
   b. Generate initial API key pair
7. Log bootstrap summary and start serving
```

If `HANZO_INIT_USER_EMAIL` matches an existing user (even one created through a different path, e.g., Git-provider login on Platform), the bootstrap grants membership without requiring a password. This prevents duplicate identity silos.

### Authentication Flow

Console uses NextAuth.js with a custom IAM provider:

```
1. User visits console.hanzo.ai
2. NextAuth redirects to hanzo.id/login/oauth/authorize
   ?client_id=hanzo-console-client-id
   &redirect_uri=console.hanzo.ai/api/auth/callback/hanzo-iam
   &scope=openid profile email
3. User authenticates at hanzo.id
4. IAM redirects back with authorization code
5. Console exchanges code for tokens via IAM token endpoint
6. Console validates JWT, checks admin role
7. Session created in Redis (30-minute idle timeout)
```

Only users with OWNER or ADMIN role in at least one organization can access Console. MEMBER-only users are redirected to Cloud.

### Local Development

```bash
# Clone repository
git clone https://github.com/hanzoai/console
cd console

# Install dependencies
pnpm install

# Start infrastructure (PostgreSQL, ClickHouse, Redis, MinIO)
pnpm run infra:dev:up

# Initialize database
pnpm --filter=shared run db:reset
pnpm --filter=shared run ch:reset
pnpm --filter=shared run db:seed:examples

# Start development server
pnpm run dev:web    # http://localhost:3000

# Development credentials
# Email: demo@hanzo.ai
# Password: password
```

### API Proxy Routes

Console proxies administrative requests to backend services. The proxy layer strips client-supplied tenant headers and replaces them with server-side session-derived values to prevent header injection attacks:

```typescript
// Proxy tenant header construction (simplified)
function buildProxyTenantHeaders(session: Session): Headers {
  // Start with EMPTY headers -- never trust client-supplied values
  const headers: Headers = {};

  // Only use server-verified session context
  if (session.orgId) {
    headers["x-org-id"] = session.orgId;
    headers["x-tenant-id"] = session.orgId;
  }
  if (session.projectId) {
    headers["x-project-id"] = session.projectId;
  }
  headers["x-actor-id"] = session.userId;

  return headers;
}
```

Proxy routes exist for:
- `/api/proxy/iam/*` -- IAM administrative operations
- `/api/proxy/kms/*` -- KMS secret management
- `/api/proxy/agents/*` -- Agent orchestration
- `/api/proxy/compute/*` -- Compute resource management

## Security Considerations

### Access Control

Console enforces the strictest access controls in the Hanzo ecosystem:

- **Admin-only access**: Only OWNER and ADMIN role users can log in. This is checked both at OAuth callback (Console rejects the session if the user lacks admin role) and on every tRPC procedure via `protectedOrganizationProcedure` middleware.
- **Organization scoping**: Every database query and API proxy call is scoped to the user's current organization context. The `protectedProjectProcedure` middleware ensures project-level operations are authorized.
- **Cross-tenant isolation**: Tenant headers (`x-org-id`, `x-project-id`, `x-tenant-id`) are constructed exclusively from server-side session data. Client-supplied tenant headers are stripped before proxying. This prevents a compromised client from accessing another organization's data.

### IP Allowlisting

Production Console supports IP-based access restriction:

```yaml
# Per-organization IP allowlist
CONSOLE_IP_ALLOWLIST_HANZO: "24.199.76.0/24,10.0.0.0/8"
CONSOLE_IP_ALLOWLIST_LUX: "24.144.69.0/24,10.0.0.0/8"
```

Requests from non-allowlisted IPs receive a 403 Forbidden response. This is enforced at the Traefik middleware level, before the request reaches the Console application.

### MFA Enforcement

Console requires MFA for all admin users. On first login, if a user does not have WebAuthn or TOTP configured, Console redirects them to hanzo.id to enroll a second factor before granting a session. This is enforced by checking the `mfaEnabled` claim in the IAM JWT.

### Audit Trail

All administrative actions generate immutable audit entries. The audit subsystem:

- Logs to both PostgreSQL (for querying) and a write-ahead log (for tamper detection).
- Records the full request context: actor, IP, user agent, timestamp, action, target resource, and result.
- Is queryable through the Console UI with filters for time range, actor, action type, and organization.
- Cannot be modified or deleted by any user, including OWNERs. Retention is managed by automated cleanup jobs.

### Secret Handling

Console never stores secrets directly:

- OAuth client secrets are fetched from KMS at startup via Universal Auth.
- Database credentials use KMS-synced Kubernetes secrets (`KMSSecret` CRDs).
- API keys are hashed before storage (only the key prefix is stored in plaintext for identification).
- Session secrets are rotated on deployment via KMS.

### Dependency Security

Console's dependency supply chain is monitored:

- `pnpm` lockfile integrity is verified in CI.
- `pnpm overrides` pin known-vulnerable transitive dependencies to patched versions.
- Docker images use `turbo prune` for minimal attack surface.
- `DOCKER_BUILD=1` disables Sentry integration and environment validation during build to prevent secret leakage into image layers.

## Testing

### Unit Tests

```bash
# Run synchronous tests
pnpm test-sync --testPathPatterns="admin"

# Run async tests
pnpm test -- --testPathPatterns="organization"
```

### Integration Tests

```bash
# Run against local infrastructure
pnpm run infra:dev:up
pnpm test -- --testPathPatterns="proxy"
```

### Type Checking

```bash
# Fast typecheck across all packages
pnpm tc

# Full Next.js build (catches runtime type errors)
pnpm build:check
```

## Performance Targets

| Metric | Target |
|--------|--------|
| Page load (first contentful paint) | < 1.5s |
| tRPC query response (P95) | < 200ms |
| Trace list query (ClickHouse, 10M rows) | < 500ms |
| Concurrent admin sessions | > 100 |
| Uptime SLA | 99.9% |

## References

1. [HIP-4: LLM Gateway Standard](./hip-0004-llm-gateway-unified-ai-provider-interface.md) - AI provider interface (usage metrics source)
2. [HIP-26: Identity & Access Management Standard](./hip-0026-identity-access-management-standard.md) - User/org CRUD, authentication, balances
3. [HIP-27: KMS Secrets Management](./hip-0027-kms-secrets-management.md) - Secret resolution and rotation
4. [Langfuse](https://github.com/langfuse/langfuse) - Open-source LLM engineering platform (upstream fork)
5. [Hanzo Console Repository](https://github.com/hanzoai/console)
6. [shadcn/ui](https://ui.shadcn.com/) - UI component library (Radix + Tailwind)
7. [NextAuth.js](https://next-auth.js.org/) - Authentication framework for Next.js
8. [Prisma](https://www.prisma.io/) - TypeScript ORM for PostgreSQL
9. [ClickHouse](https://clickhouse.com/) - Analytics database for trace data
10. [BullMQ](https://docs.bullmq.io/) - Redis-backed job queue for background processing

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
