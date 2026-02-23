---
hip: 0014
title: Application Deployment Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2025-01-09
requires: HIP-0026, HIP-0027, HIP-0029
---

# HIP-14: Application Deployment Standard

## Abstract

This proposal defines the application deployment standard for the Hanzo ecosystem. The Hanzo Platform is a self-hosted PaaS (Platform as a Service) built as a fork of [Dokploy](https://github.com/Dokploy/dokploy), an open-source application deployment platform. It provides a standardized pipeline for building, deploying, scaling, and monitoring all Hanzo services -- from the LLM Gateway to the Chat frontend to internal tooling.

Every Hanzo service MUST be deployable through Platform. The deployment flow is: git push to repository, Platform detects the change, builds a container image, pushes it to the registry, deploys it to the target environment, runs health checks, and either promotes the deployment or rolls back. Developers interact with Platform through a web UI at **platform.hanzo.ai** or through the `hanzo` CLI. They never run `kubectl apply` or `docker compose up` on production infrastructure directly.

**Repository**: [github.com/hanzoai/platform](https://github.com/hanzoai/platform)
**Production**: https://platform.hanzo.ai
**Port**: 3000 (Platform UI), 5173 (legacy admin)
**Docker**: `ghcr.io/hanzoai/platform:latest`
**Cluster**: hanzo-k8s (`24.199.76.156`)

## Motivation

### The Problem

Hanzo operates 30+ services across two Kubernetes clusters (hanzo-k8s, lux-k8s). Without a standardized deployment layer, each team deploys independently:

1. **Manual kubectl**: Engineers write Kubernetes manifests by hand, SSH into the cluster, and `kubectl apply`. Manifests drift between what is in Git and what is deployed. A typo in a resource limit brings down a service with no audit trail of who changed what.

2. **Inconsistent build pipelines**: The LLM Gateway uses a Makefile. Chat uses `pnpm build`. The Python SDK uses `uv`. IAM uses `go build`. Each project invents its own CI/CD workflow. A new engineer onboarding to any project must first reverse-engineer how it gets built and deployed.

3. **No rollback mechanism**: When a bad deploy goes out, the recovery path is "find the previous Docker image tag, edit the Kubernetes manifest, apply it, hope the health check passes." Under pressure (production outage at 2 AM), this process takes 15-30 minutes. A PaaS provides instant rollback to the previous known-good image.

4. **Secret sprawl**: Environment variables are scattered across GitHub Actions secrets, Kubernetes secrets, Docker Compose files, and `.env` files on developer machines. Without centralized injection from KMS (HIP-27), secrets leak into build logs, Git history, and container images.

5. **No visibility**: There is no single place to see "what version of which service is running where." Operators must `kubectl get pods` on each cluster, parse image tags, and cross-reference with Git commits. Platform provides a dashboard showing every service, its current deployment, health status, and resource usage.

6. **No multi-org isolation**: Hanzo, Lux, Zoo, and Pars all share infrastructure. Without tenant isolation at the deployment layer, an engineer with access to deploy Chat can also see (and modify) the IAM deployment. Platform enforces organization boundaries -- each org sees only its own applications.

### What Platform Solves

A single PaaS layer eliminates all six problems. Teams define a `hanzo.yaml` manifest in their repository. Platform handles everything else: build, image push, deploy, health check, TLS certificate, domain routing, log aggregation, and rollback. The cognitive load drops from "understand Kubernetes, Docker, Traefik, and Let's Encrypt" to "write a 10-line YAML file and push."

## Design Philosophy

This section explains the *why* behind every major architectural decision. PaaS choices are sticky -- once 30 services depend on a deployment platform, migrating away costs months. Understanding the rationale prevents future engineers from re-evaluating settled questions.

### Why Not Vercel or Netlify

Vercel and Netlify are excellent products for frontend deployments. They are not suitable for Hanzo's use case:

- **Cost at scale**: Vercel charges per serverless function invocation ($0.60 per million) and per GB of bandwidth ($0.15/GB after the free tier). The LLM Gateway alone handles millions of requests per day. At Hanzo's scale, Vercel costs would exceed $5,000/month for a service that runs on a $40/month VM.
- **Vendor lock-in**: Vercel's Edge Functions, Image Optimization, and ISR are proprietary. Code written for Vercel cannot run on AWS, GCP, or bare metal without rewriting. A PaaS should be a deployment abstraction, not an application framework.
- **No backend support**: Vercel is designed for Next.js frontends. Deploying a Go binary (IAM), a Python FastAPI service (agent), or a Rust service (node) requires workarounds. Platform supports any language that produces a Docker container.
- **No self-hosting**: Vercel cannot be deployed on our own Kubernetes clusters. For air-gapped environments, compliance requirements, or simply avoiding egress fees between our compute and our deployment platform, self-hosting is non-negotiable.
- **No multi-org tenancy**: Vercel's team model does not map to Hanzo's multi-organization structure. We need Hanzo engineers to see Hanzo services, Lux engineers to see Lux services, and the CTO to see everything.

### Why Not Coolify or CapRover

Both are open-source PaaS alternatives. Neither fits our requirements:

- **CapRover**: Built on Docker Swarm, which is effectively unmaintained. The UI is functional but dated. The codebase is JavaScript with limited TypeScript adoption. No Kubernetes support. The project's last major release was years ago. Building on CapRover means building on a declining foundation.
- **Coolify**: The closest competitor to Dokploy. Active development, modern UI, good feature set. However, Coolify uses a BSL (Business Source License) that restricts commercial self-hosting without a license. For an infrastructure company that deploys its PaaS as part of its product offering, licensing ambiguity is unacceptable. Dokploy is Apache 2.0.

### Why Dokploy

Dokploy was selected after evaluating all major open-source PaaS platforms:

| Factor | Dokploy | Coolify | CapRover | Vercel |
|--------|---------|---------|----------|--------|
| License | Apache 2.0 | BSL | Apache 2.0 | Proprietary |
| Architecture | Docker + Traefik | Docker + Traefik | Docker Swarm | Proprietary |
| Language | TypeScript/Node.js | PHP/TypeScript | JavaScript | N/A |
| UI quality | Modern, clean | Modern, good | Dated | Excellent |
| K8s support | Via Docker | Planned | No | No |
| Active development | Yes (2024+) | Yes | Stagnant | Yes |
| Self-hostable | Yes | Yes (with license) | Yes | No |

Dokploy's architecture is the simplest correct design: applications are Docker containers, routing is Traefik, builds are Docker builds, and state is PostgreSQL. There is no custom scheduler, no proprietary runtime, no magic. When something breaks, `docker logs` and `docker inspect` tell you everything you need to know.

### Why Fork

Upstream Dokploy covers the common case well. Our fork adds capabilities specific to the Hanzo ecosystem that upstream cannot or will not support:

1. **Hanzo IAM integration (HIP-26)**: Upstream Dokploy supports GitHub and GitLab OAuth for login. We need login via hanzo.id (our IAM provider) using the OAuth 2.0 Authorization Code Grant with PKCE. This requires a custom OAuth provider implementation in Better Auth, the authentication library Dokploy uses.

2. **KMS secret injection (HIP-27)**: Upstream Dokploy stores environment variables in its own PostgreSQL database. We need environment variables to be sourced from Hanzo KMS at deploy time, so that secrets are never stored in the Platform database and rotation in KMS propagates to all deployments automatically.

3. **Multi-org tenancy**: Upstream Dokploy is single-tenant -- one admin, one set of applications. We need organizational boundaries: the `hanzo` org sees IAM, Cloud, Console; the `lux` org sees validators, gateway, markets; the `zoo` org sees research services. A user's org membership (from IAM) determines what they see in Platform.

4. **Custom domain management**: Hanzo services use vanity domains (hanzo.ai, lux.network, zoo.ngo). Platform must provision TLS certificates for these domains via Let's Encrypt, configure Traefik routing rules, and verify domain ownership -- all through the UI, without editing Traefik TOML files by hand.

5. **Deployment audit log**: Every deployment, rollback, scale event, and configuration change must be logged with the acting user, timestamp, and diff. This is a compliance requirement for enterprise customers and an operational requirement for incident response.

We maintain our fork by periodically rebasing on upstream Dokploy releases, resolving conflicts in the IAM/KMS integration layer. The fork diverges only in authentication, secrets, multi-tenancy, and audit -- core application deployment logic remains aligned with upstream.

### Why a PaaS Layer Matters

The alternative to Platform is "every team deploys their own way." This works at 5 services. It does not work at 30. Consider what happens without a PaaS when a new engineer joins the Cloud team:

1. Clone the repo. Read the README. The README says "deploy with Docker Compose."
2. But production uses Kubernetes. The Compose file is for local dev only.
3. Find the Kubernetes manifests. They are in a separate `universe/infra/k8s/` directory in a different repository.
4. The manifests reference secrets that do not exist in their kubeconfig context.
5. Ask a senior engineer which cluster to deploy to, what namespace to use, and where the secrets come from.
6. Senior engineer walks them through it in 45 minutes.

With Platform, the new engineer:

1. Logs in to platform.hanzo.ai with their Hanzo account.
2. Sees the Cloud service. Clicks "Deploy." Selects the branch. Clicks "Deploy" again.
3. Platform builds, pushes, deploys, and health-checks. Done.

The PaaS is not just a deployment tool. It is an organizational boundary that separates "understanding your application code" from "understanding production infrastructure." Application engineers should write application code. Platform handles the rest.

## Specification

### Application Manifest

Every deployable service includes a `hanzo.yaml` at the repository root. This manifest declares the application's build, runtime, scaling, and routing configuration. Platform reads this file to determine how to build and deploy the service.

```yaml
# hanzo.yaml -- full schema
name: my-service                      # Required. Unique within the org.
org: hanzo                            # Required. Organization that owns this service.
runtime: auto                         # auto | node-20 | node-22 | python-3.12 | go-1.22 | rust-1.78 | docker
version: "1.0.0"                      # Informational. Not used for deployment decisions.

build:
  dockerfile: Dockerfile              # Path to Dockerfile (default: Dockerfile). Ignored if runtime != docker.
  context: .                          # Docker build context (default: repository root).
  command: npm run build              # Build command for non-Docker runtimes.
  output: dist                        # Build output directory (for static sites).
  args:                               # Build arguments (NOT for secrets -- use env.secret).
    NODE_ENV: production
    NEXT_TELEMETRY_DISABLED: "1"

deploy:
  instances: 2                        # Number of replicas (default: 1).
  memory: 512Mi                       # Memory limit per instance (default: 256Mi).
  cpu: "0.5"                          # CPU limit per instance (default: 0.25).
  strategy: rolling                   # rolling | recreate (default: rolling).
  max_surge: 1                        # Extra instances during rolling update (default: 1).
  max_unavailable: 0                  # Instances that can be down during rolling update (default: 0).
  startup_timeout: 120                # Seconds to wait for health check before marking failed (default: 120).

services:
  - type: web                         # web | worker | cron
    port: 3000                        # Container port for web services.
    protocol: http                    # http | grpc | tcp (default: http).
    healthcheck:
      path: /api/health               # HTTP path for health check (default: /).
      interval: 30s                   # Time between checks (default: 30s).
      timeout: 5s                     # Per-check timeout (default: 5s).
      retries: 3                      # Failures before marking unhealthy (default: 3).
    domains:
      - cloud.hanzo.ai                # Custom domains. TLS provisioned automatically.
      - api.hanzo.ai/v2               # Path-based routing supported.

  - type: worker                      # Background workers have no port or domain.
    command: node worker.js
    healthcheck:
      exec: ["node", "healthcheck.js"]

  - type: cron
    command: node cleanup.js
    schedule: "0 */6 * * *"           # Standard cron syntax.

env:
  - name: DATABASE_URL
    secret: true                      # Resolved from KMS at deploy time.
    kms_key: CLOUD_DATABASE_URL       # KMS secret key name.
    kms_project: hanzo-cloud          # KMS project (default: matches app name).
    kms_env: prod                     # KMS environment (default: matches deploy target).
  - name: NODE_ENV
    value: production                 # Plaintext env var. Stored in Platform DB.
  - name: LOG_LEVEL
    value: info

resources:
  postgres:                           # Managed PostgreSQL (optional).
    version: "16"
    storage: 10Gi
  redis:                              # Managed Redis (optional).
    version: "7"
    maxmemory: 256mb
```

When `runtime: auto` is specified (or the field is omitted), Platform detects the runtime by inspecting the repository:

| Detection Signal | Runtime |
|-----------------|---------|
| `Dockerfile` exists | docker |
| `package.json` with `engines.node` | node (matching version) |
| `requirements.txt` or `pyproject.toml` | python |
| `go.mod` | go |
| `Cargo.toml` | rust |
| None of the above | Error: cannot detect runtime |

If a `Dockerfile` is present, it always takes precedence over language-based detection. This ensures that teams with custom build requirements can always escape to full Docker control.

### Build Pipeline

The build pipeline executes in isolated Docker containers. No build shares state with any other build.

```
1. git clone (shallow, single branch)
   │
2. Runtime detection (if runtime: auto)
   │
3. Build
   ├─ Docker runtime:  docker build --file <dockerfile> --build-arg ... <context>
   ├─ Node runtime:    Install deps (npm/yarn/pnpm) → run build command → copy output
   ├─ Python runtime:  uv sync → run build command → package with uvicorn
   ├─ Go runtime:      go build -o app . → copy binary into scratch/distroless
   └─ Rust runtime:    cargo build --release → copy binary into scratch/distroless
   │
4. docker tag ghcr.io/hanzoai/<org>-<app>:<git-sha-short>
   │
5. docker push ghcr.io/hanzoai/<org>-<app>:<git-sha-short>
   │
6. Update deployment record in PostgreSQL
   │
7. Deploy (see Deployment section)
```

Build logs are streamed to the Platform UI in real-time via WebSocket. Logs are retained for 30 days.

**Build caching**: Platform mounts a persistent Docker build cache per application. Subsequent builds reuse layers from previous builds, reducing build times by 50-80% for typical Node.js and Go applications.

**Build timeout**: Builds that exceed 15 minutes are killed. This prevents runaway builds from blocking the build queue. The timeout is configurable per application.

### Deployment Targets

Platform supports two deployment targets:

#### Docker Compose (Single Server)

For development, staging, and low-traffic services. Platform generates a `compose.yml` from the application manifest, runs `docker compose up -d`, and monitors the container health.

```
Platform DB → Generate compose.yml → docker compose up -d → Health check → Route traffic
```

This is the default target for new applications. It requires no Kubernetes cluster.

#### Kubernetes (Cluster)

For production services that require horizontal scaling, rolling updates, and resource isolation. Platform generates Kubernetes Deployment, Service, and Ingress manifests from the application manifest and applies them via the Kubernetes API.

```
Platform DB → Generate K8s manifests → kubectl apply → Wait for rollout → Health check → Route traffic
```

The Kubernetes target requires a kubeconfig with appropriate RBAC permissions. Platform creates one namespace per organization and one Deployment per application.

### Rolling Updates and Health Check Gates

All production deployments use rolling updates by default. The sequence:

1. Platform creates new pods with the updated image.
2. Each new pod must pass the health check within `startup_timeout` seconds.
3. Once healthy, Traefik routes traffic to the new pod.
4. Old pods are drained (existing connections complete, no new connections) and terminated.
5. If any new pod fails its health check, the rollout is halted and the deployment is marked `failed`. Old pods continue serving traffic.

The `max_surge` and `max_unavailable` fields control the rollout speed. The default (`max_surge: 1, max_unavailable: 0`) means at most one extra pod is created during the update, and zero pods are taken down until the new pod is healthy. This is the safest configuration -- it trades speed for zero-downtime guarantees.

### Rollback

Rollback is instant because it is an image tag revert, not a rebuild:

```
Current: ghcr.io/hanzoai/hanzo-cloud:abc123f (deployed 10 minutes ago, broken)
Previous: ghcr.io/hanzoai/hanzo-cloud:def456a (deployed yesterday, known good)

Rollback: Update deployment image tag to def456a → K8s pulls existing image from cache → Pods start in <10s
```

Platform retains the last 25 deployment records per application. Each record includes the image tag, Git commit SHA, deploy timestamp, deploying user, and deployment status. Rolling back to any of these 25 versions is a one-click operation in the UI or a single CLI command:

```bash
hanzo rollback                    # Roll back to the immediately previous deployment
hanzo rollback --to def456a       # Roll back to a specific image tag
hanzo rollback --to 3             # Roll back to the 3rd most recent deployment
```

### Custom Domains and TLS

When a domain is added to a service's `domains` list (either in `hanzo.yaml` or via the UI), Platform:

1. Validates domain ownership via DNS TXT record (`_hanzo-verify.example.com → <verification-token>`).
2. Adds a Traefik router rule for the domain.
3. Requests a TLS certificate from Let's Encrypt via the ACME HTTP-01 challenge.
4. Stores the certificate in Traefik's certificate resolver.
5. Configures automatic renewal (certificates renew 30 days before expiry).

Wildcard certificates are supported for organizations that manage many subdomains (e.g., `*.hanzo.ai`). These use the DNS-01 challenge and require API credentials for the DNS provider (stored in KMS).

### Environment Variable Injection from KMS

Environment variables marked with `secret: true` in the application manifest are resolved from KMS (HIP-27) at deploy time:

1. Platform authenticates to KMS using its Universal Auth credentials.
2. For each secret env var, Platform fetches the value from KMS using the specified `kms_key`, `kms_project`, and `kms_env`.
3. The resolved values are injected into the container at startup via the container runtime's environment variable mechanism.
4. Secret values never appear in build logs, the Platform database, or the application manifest.

When a secret is rotated in KMS, the next deployment of the affected service automatically picks up the new value. For immediate rotation without redeployment, Platform supports a "restart" action that restarts containers with fresh environment variables from KMS.

### Log Streaming and Monitoring

Platform aggregates logs from all containers and exposes them through:

- **Web UI**: Real-time log streaming with search, filter by service/timestamp/severity.
- **CLI**: `hanzo logs --follow` for tail-like streaming.
- **API**: `GET /api/v1/apps/{app}/logs?since=1h&level=error` for programmatic access.

Logs are retained for 30 days in Platform's database. For long-term retention, logs can be forwarded to an external sink (e.g., Loki, Elasticsearch) via a configurable log drain.

Platform also exposes basic metrics per application:

| Metric | Source | Description |
|--------|--------|-------------|
| CPU usage | cAdvisor / Docker stats | Per-container CPU utilization |
| Memory usage | cAdvisor / Docker stats | Per-container RSS |
| Request count | Traefik access logs | HTTP requests per second |
| Response time | Traefik access logs | p50, p95, p99 latency |
| Error rate | Traefik access logs | 4xx and 5xx responses per second |
| Container restarts | Docker / K8s events | Crash loop detection |

### Multi-Organization Isolation

Platform enforces organization boundaries at every layer:

1. **Authentication**: Users log in via Hanzo IAM (HIP-26). IAM returns the user's organization memberships in the JWT claims.
2. **Authorization**: Platform reads the org memberships from the JWT and scopes all API calls and UI views to those organizations. A user with membership in `hanzo` and `lux` sees services from both orgs. A user with membership in only `zoo` sees only Zoo services.
3. **Resource isolation**: In Kubernetes, each organization gets its own namespace. Network policies restrict cross-namespace traffic by default. An application in the `hanzo` namespace cannot reach a database in the `lux` namespace unless explicitly allowed.
4. **Audit logging**: Every action is logged with the user, organization, and timestamp. Org admins can view the audit log for their organization. Global admins can view all audit logs.

### Deployment API

```typescript
// Core deployment types
interface Application {
  id: string;
  name: string;                          // e.g., "cloud"
  org: string;                           // e.g., "hanzo"
  repo: string;                          // e.g., "github.com/hanzoai/cloud"
  branch: string;                        // e.g., "main"
  runtime: "auto" | "node" | "python" | "go" | "rust" | "docker";
  status: "running" | "deploying" | "failed" | "stopped";
  currentDeployment: Deployment | null;
  domains: string[];
  createdAt: string;
  updatedAt: string;
}

interface Deployment {
  id: string;
  appId: string;
  imageTag: string;                      // e.g., "ghcr.io/hanzoai/hanzo-cloud:abc123f"
  gitCommit: string;                     // Full SHA
  gitMessage: string;                    // First line of commit message
  status: "building" | "pushing" | "deploying" | "running" | "failed" | "rolled_back";
  deployedBy: string;                    // IAM user ID
  startedAt: string;
  completedAt: string | null;
  buildLogs: string;                     // URL to build log stream
  url: string;                           // Public URL of the deployed service
}

interface DeploymentEvent {
  id: string;
  deploymentId: string;
  type: "build_started" | "build_completed" | "build_failed"
      | "deploy_started" | "deploy_completed" | "deploy_failed"
      | "health_check_passed" | "health_check_failed"
      | "rollback_initiated" | "rollback_completed";
  message: string;
  timestamp: string;
}
```

### CLI Commands

```bash
# Authentication
hanzo login                          # Opens browser for IAM OAuth login

# Application management
hanzo apps                           # List applications in your orgs
hanzo apps create --name my-app      # Create a new application
hanzo apps delete my-app             # Delete an application (requires confirmation)

# Deployment
hanzo deploy                         # Deploy current branch from hanzo.yaml
hanzo deploy --branch feature/x      # Deploy a specific branch
hanzo deploy --image ghcr.io/...     # Deploy a pre-built image

# Monitoring
hanzo status                         # Show status of all applications
hanzo status my-app                  # Show detailed status of one application
hanzo logs my-app                    # Stream logs
hanzo logs my-app --since 1h         # Logs from the last hour

# Scaling
hanzo scale my-app 5                 # Scale to 5 instances
hanzo scale my-app 0                 # Scale to zero (stop)

# Rollback
hanzo rollback my-app                # Rollback to previous deployment
hanzo rollback my-app --to <tag>     # Rollback to specific version

# Environment variables
hanzo env my-app                     # List env vars (secrets are masked)
hanzo env my-app set KEY=value       # Set a plaintext env var
hanzo env my-app set KEY --secret    # Set a secret env var (prompts for value)
hanzo env my-app unset KEY           # Remove an env var

# Domains
hanzo domains my-app                 # List domains
hanzo domains my-app add example.com # Add a custom domain
hanzo domains my-app remove ex.com   # Remove a domain
```

## Implementation

### Production Architecture

```
                            Internet
                               │
                     ┌─────────┴─────────┐
                     │     Traefik        │
                     │  (TLS termination) │
                     │   :80 → :443      │
                     └─────────┬─────────┘
                               │
               ┌───────────────┼───────────────┐
               │               │               │
      platform.hanzo.ai   cloud.hanzo.ai   *.hanzo.ai ...
               │               │               │
               │      ┌────────┴────────┐      │
               │      │  Deployed Apps  │      │
               │      │  (containers)   │      │
               │      └─────────────────┘      │
               │                               │
     ┌─────────┴─────────┐                     │
     │   Hanzo Platform   │─────────────────────┘
     │  (Node.js/Next.js) │     (manages routing)
     │       :3000        │
     └────┬─────────┬────┘
          │         │
 ┌────────┴──┐  ┌───┴────────┐    ┌─────────────┐
 │ PostgreSQL │  │   Redis     │    │  Hanzo IAM  │
 │   :5432    │  │   :6379     │    │  hanzo.id   │
 │  platform  │  │  (queues)   │    │  (OAuth)    │
 └────────────┘  └────────────┘    └─────────────┘
                                   ┌─────────────┐
                                   │  Hanzo KMS  │
                                   │kms.hanzo.ai │
                                   │  (secrets)  │
                                   └─────────────┘
                                   ┌─────────────┐
                                   │    GHCR     │
                                   │ (registry)  │
                                   └─────────────┘
```

### Authentication: OAuth2 via Hanzo IAM

Platform authenticates users via Hanzo IAM (HIP-26) using the OAuth 2.0 Authorization Code Grant with PKCE. The integration uses [Better Auth](https://better-auth.com/), the authentication library used by Dokploy, with a custom `hanzo` provider:

```typescript
// platform/pkg/platform/src/lib/auth.ts (simplified)
import { betterAuth } from "better-auth";

const iamUrl = process.env.HANZO_IAM_URL
  || process.env.HANZO_IAM_ENDPOINT
  || process.env.HANZO_IAM_SERVER_URL
  || process.env.IAM_ENDPOINT
  || "https://hanzo.id";

export const auth = betterAuth({
  socialProviders: {
    hanzo: {
      clientId: process.env.HANZO_IAM_CLIENT_ID || process.env.HANZO_CLIENT_ID,
      clientSecret: process.env.HANZO_IAM_CLIENT_SECRET || process.env.HANZO_CLIENT_SECRET,
      issuer: iamUrl,
      authorization: `${iamUrl}/login/oauth/authorize`,
      token: `${iamUrl}/api/login/oauth/access_token`,
      userinfo: `${iamUrl}/api/userinfo`,
    },
  },
});
```

When a user clicks "Sign in with Hanzo" on the Platform login page:

1. Platform redirects to `hanzo.id/login/oauth/authorize` with PKCE challenge.
2. User authenticates at hanzo.id (password, WebAuthn, or social login).
3. hanzo.id redirects back to `platform.hanzo.ai/callback` with authorization code.
4. Platform exchanges the code for tokens.
5. Platform reads the user's org memberships from the token claims.
6. User sees only applications belonging to their organizations.

For users who previously logged in via GitHub (legacy Dokploy flow), Platform matches the IAM email against existing user records. This prevents duplicate identity silos.

### Database

Platform uses PostgreSQL (HIP-29) to store:

- Application definitions (name, org, repo, branch, runtime configuration)
- Deployment history (image tags, Git commits, status, timestamps)
- Environment variables (plaintext values only -- secrets are KMS references)
- Domain configurations
- Audit log entries
- User sessions (via Better Auth)

The database is `platform` on `postgres.hanzo.svc` in the hanzo-k8s cluster.

### Container Registry

Built images are pushed to GitHub Container Registry (GHCR) at `ghcr.io/hanzoai/`. The image naming convention is:

```
ghcr.io/hanzoai/<org>-<app>:<git-sha-short>
ghcr.io/hanzoai/<org>-<app>:latest
```

Examples:
- `ghcr.io/hanzoai/hanzo-cloud:abc123f`
- `ghcr.io/hanzoai/hanzo-iam:latest`
- `ghcr.io/hanzoai/lux-gateway:def456a`

GHCR was chosen over self-hosted registries (Harbor, MinIO-backed) because it requires zero operational overhead and integrates natively with GitHub Actions for CI-triggered builds.

### Reverse Proxy

Traefik handles all ingress routing, TLS termination, and load balancing. Platform dynamically updates Traefik's configuration when domains are added, removed, or when deployments change:

- **TLS**: Automatic certificate provisioning via Let's Encrypt ACME.
- **Routing**: Host-based and path-based routing rules.
- **Load balancing**: Round-robin across healthy instances.
- **Health checks**: Active health probes per backend.
- **Rate limiting**: Per-IP rate limiting for public endpoints.
- **Headers**: Automatic security headers (HSTS, X-Frame-Options, X-Content-Type-Options).

### CI/CD Integration

Platform supports two deployment triggers:

1. **Git push (webhook)**: A GitHub/GitLab webhook fires on push to the configured branch. Platform pulls the latest code, builds, and deploys. This is the primary flow for continuous deployment.

2. **Manual deploy (UI/CLI)**: A developer clicks "Deploy" in the UI or runs `hanzo deploy` in the CLI. This triggers the same build pipeline but with explicit human intent.

Platform does NOT replace CI for testing. The expected flow is:

```
Developer pushes code
    │
    ├─ GitHub Actions: lint, test, type-check
    │     │
    │     └─ Tests pass → merge to main
    │
    └─ Platform webhook: build → push → deploy → health check
```

Tests run in CI (GitHub Actions). Deployment runs in Platform. These are separate concerns.

## Security

### Build Isolation

Every build runs in a fresh Docker container with:

- **No network access during build** (configurable): By default, builds can fetch dependencies (npm install, pip install). Hermetic builds that require no network access can set `build.network: none` in the manifest.
- **No access to host filesystem**: The build container sees only the cloned repository and the Docker build cache. It cannot access other applications' source code, secrets, or state.
- **Resource limits**: Builds are limited to 2 CPU cores and 4 GB of memory. This prevents a single build from starving other builds or the Platform service itself.
- **No Docker socket access**: The build container cannot run `docker` commands. Building Docker images uses BuildKit in rootless mode.

### Secret Injection at Deploy Time

Secrets follow a strict lifecycle:

1. Secrets are stored in KMS (HIP-27). They never exist in Git, the Platform database, build logs, or Docker image layers.
2. At deploy time, Platform authenticates to KMS and fetches the required secrets.
3. Secrets are injected as environment variables into the running container via the container runtime (Docker `--env` or Kubernetes `envFrom`).
4. Build logs are scrubbed for patterns that match known secret formats (API keys, tokens, connection strings). Matched patterns are replaced with `[REDACTED]`.
5. The `docker history` of built images is inspected to ensure no `ENV` or `ARG` instructions contain secret values. If found, the build is rejected with a clear error message.

### Network Policies

In Kubernetes deployments, each organization's namespace has a default-deny NetworkPolicy:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: hanzo
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
  ingress: []       # Deny all ingress by default
  egress:
    - to:           # Allow DNS resolution
      - namespaceSelector: {}
        podSelector:
          matchLabels:
            k8s-app: kube-dns
      ports:
        - port: 53
          protocol: UDP
```

Applications must explicitly declare their network dependencies in the manifest. Platform generates NetworkPolicy rules that allow only declared communication paths. For example, if `cloud` declares `resources.postgres`, Platform creates a NetworkPolicy allowing egress from the `cloud` pods to the PostgreSQL service on port 5432.

### Audit Logging

Every action in Platform is logged to the `audit_log` table:

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Event ID |
| timestamp | timestamptz | When the event occurred |
| user_id | string | IAM user who performed the action |
| user_email | string | Email for human-readable logs |
| org | string | Organization context |
| app | string | Application name (if applicable) |
| action | string | `deploy`, `rollback`, `scale`, `env.set`, `env.delete`, `domain.add`, `domain.remove`, `app.create`, `app.delete` |
| details | jsonb | Action-specific metadata (image tag, scale count, env var name, etc.) |
| ip_address | inet | Client IP |
| user_agent | string | Client user agent |

Audit logs are retained for 1 year. They are queryable via the Platform API and UI. Global admins can export audit logs in CSV or JSON format for compliance reporting.

### RBAC

Platform defines three roles per organization:

| Role | Permissions |
|------|------------|
| **Viewer** | View applications, deployments, logs. Cannot modify anything. |
| **Developer** | Everything Viewer can do, plus: deploy, rollback, set env vars, manage domains. |
| **Admin** | Everything Developer can do, plus: create/delete applications, manage team members, view audit logs. |

Role assignments are derived from IAM group memberships. The mapping is configurable per organization:

```yaml
# Platform role mapping (stored in Platform DB)
org: hanzo
roles:
  admin: ["hanzo-platform-admins"]     # IAM group name
  developer: ["hanzo-engineers"]
  viewer: ["hanzo-all"]
```

## References

1. [Dokploy](https://github.com/Dokploy/dokploy) - Open-source application deployment platform (Apache 2.0)
2. [Traefik](https://traefik.io/) - Cloud-native reverse proxy and load balancer
3. [Better Auth](https://better-auth.com/) - Authentication library for TypeScript applications
4. [BuildKit](https://github.com/moby/buildkit) - Concurrent, cache-efficient, and Dockerfile-agnostic builder toolkit
5. [Let's Encrypt](https://letsencrypt.org/) - Free, automated TLS certificate authority
6. [HIP-26: Identity & Access Management Standard](./hip-0026-identity-access-management-standard.md) - IAM for authentication
7. [HIP-27: Secrets Management Standard](./hip-0027-secrets-management-standard.md) - KMS for secret injection
8. [HIP-29: Relational Database Standard](./hip-0029-relational-database-standard.md) - PostgreSQL for deployment state
9. [HIP-4: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md) - Example service deployed via Platform
10. [Hanzo Platform Repository](https://github.com/hanzoai/platform)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
