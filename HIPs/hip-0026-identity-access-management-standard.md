---
hip: 0026
title: Identity & Access Management Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2025-01-15
requires: HIP-0027, HIP-0029
---

# HIP-26: Identity & Access Management Standard

## Abstract

Hanzo IAM is the unified identity and access management provider for the Hanzo ecosystem, serving production traffic at **hanzo.id**. It is a fork of [Casdoor](https://github.com/casdoor/casdoor), a Go/Beego-based identity platform, chosen for its lightweight single-binary deployment model and native compatibility with the Go-heavy Hanzo and Lux infrastructure stack.

Hanzo IAM implements OAuth 2.0, OpenID Connect (OIDC), SAML 2.0, and CAS protocols. It provides multi-tenant authentication with per-organization white-label identity domains — any organization registered in IAM can get its own branded login page and identity domain. The default deployment ships with hanzo.id, lux.id, zoo.id, pars.id, and id.ad.nexus, but the system supports arbitrary additional tenants via configuration.

The system also tracks per-user credit balances for AI usage billing, making IAM the source of truth for user identity *and* user spend across all Hanzo services.

**Repository**: [github.com/hanzoai/iam](https://github.com/hanzoai/iam)
**Port**: 8000
**Docker**: `ghcr.io/hanzoai/iam:latest`

## Motivation

### The Problem

Every service in the Hanzo ecosystem needs authentication. Without a centralized IAM, each team independently builds login flows, token validation, user storage, and session management. This leads to:

1. **Duplicated effort**: Cloud, Commerce, Console, Platform, and Chat all need OAuth. Five teams building five login pages is waste.
2. **Inconsistent security posture**: Some teams do PKCE, some do not. Some rotate tokens, some use static API keys. The attack surface is the union of all weaknesses.
3. **No cross-service SSO**: A user logged into cloud.hanzo.ai should not need to log in again at console.hanzo.ai. Without centralized identity, SSO requires ad-hoc token sharing.
4. **Multi-org complexity**: Hanzo (AI infrastructure), Lux (blockchain), Zoo (research foundation), Pars (regional platform), and AdNexus (advertising) are separate organizations with separate branding, but share users and infrastructure. Each organization needs its own login page, theme, and policies, while a single user (e.g., `z@hanzo.ai`) must hold memberships across all of them.
5. **Billing integration**: AI usage is metered per-user. The billing system needs a single source of truth for "who is this user and what is their balance?" If user identity lives in IAM and balance lives in a separate billing service, every LLM API call requires two round-trips.

### Why Centralized IAM Solves This

A single IAM instance at hanzo.id eliminates all five problems. Services delegate authentication entirely. The OAuth application model provides per-service isolation (each app has its own client ID, redirect URIs, and scopes). Multi-org support is built into the data model. And the user entity in IAM carries a `balance` field, so balance checks are a single query against the same database that validates the token.

## Design Philosophy

This section explains the *why* behind each major design decision. Good infrastructure decisions compound; bad ones metastasize. Understanding the rationale prevents future engineers from "fixing" things that are not broken.

### Why Casdoor Over Keycloak

Keycloak is the most popular open-source IAM. It is also a 500MB+ Java application that requires a JVM, takes 30+ seconds to start, and consumes 512MB of heap at idle. In the Hanzo ecosystem, where the blockchain node, CLI tools, SDK, and wallet are all written in Go, introducing a Java dependency for IAM is a poor fit.

Casdoor compiles to a single Go binary (~50MB), starts in under 2 seconds, and idles at ~50MB RSS. It ships a React frontend (easy to customize for branding) and supports the same protocol set as Keycloak (OAuth 2.0, OIDC, SAML, CAS, LDAP, RADIUS). The tradeoff is a smaller community and fewer enterprise features (no fine-grained RBAC policies, no UMA). For our use case -- OAuth SSO across a handful of first-party services -- Casdoor's feature set is sufficient, and the operational simplicity is decisive.

| Factor | Casdoor | Keycloak |
|--------|---------|----------|
| Language | Go | Java |
| Binary size | ~50 MB | ~500 MB+ |
| Idle memory | ~50 MB RSS | ~512 MB heap |
| Startup time | < 2s | 30-60s |
| Frontend | React (customizable) | Freemarker (limited) |
| Protocol support | OAuth2, OIDC, SAML, CAS, LDAP | OAuth2, OIDC, SAML, UMA |
| Stack alignment | Same as Lux node, CLI, SDK | Requires JVM |

### Why Not Auth0 or Okta

Managed identity services charge per monthly active user (MAU). Auth0's pricing starts at $0.003/MAU for the essentials tier. At 1M MAU (a realistic target for an AI platform with free-tier users), that is $3,000/month *just for login*. At 10M MAU, $30,000/month. Self-hosted IAM costs the price of a single VM (~$40/month on DigitalOcean).

Beyond cost, managed services create vendor lock-in in the most sensitive part of your stack. Migrating user password hashes out of Auth0 is non-trivial. And for air-gapped or sovereign deployments (required for some enterprise and government customers), a SaaS identity provider is simply not an option.

### Why Multi-Tenant via Domain

Each organization gets its own white-label identity domain. The system supports an arbitrary number of tenants — any organization registered in IAM can be assigned a custom domain. The default deployment includes:

| Organization | Domain | Primary Color | Description |
|-------------|--------|---------------|-------------|
| Hanzo | hanzo.id | #fd4444 (red) | AI infrastructure |
| Lux | lux.id | #e4e4e7 (zinc) | Blockchain network |
| Zoo | zoo.id | #10b981 (emerald) | Research foundation |
| Pars | pars.id | #3b82f6 (blue) | Regional platform |
| AdNexus | id.ad.nexus | #3b82f6 (blue) | Advertising platform |

Adding a new tenant requires:
1. Create the organization in IAM (via API or init_data.json)
2. Create an OAuth application for the organization
3. Add the domain to the reverse proxy (Traefik IngressRoute or DNS record)
4. Either add the domain to the `hanzo/id` middleware tenant map, or deploy a forked instance with `IAM_ORIGIN`, `NEXT_PUBLIC_ORG`, and `NEXT_PUBLIC_CLIENT_ID` environment variables

The reverse proxy (Traefik in production) routes all tenant domains to the same IAM container on port 8000. IAM resolves the organization from the request's `Host` header via the `origin` configuration and the application's `organization` field. Organizations are fully isolated — different themes, different OAuth applications, different password policies, different MFA requirements — while sharing one IAM process and one database.

The `hanzo/id` login UI is designed to be forked for deep customization. Organizations can:
- Fork `hanzoai/id` to `luxfi/id`, `zoofdn/id`, etc. for fully custom branding
- Or use the same `hanzoai/id` image with per-tenant env vars for lightweight white-labeling
- Or add entries to the middleware tenant map for multi-domain deployment from a single image

The alternative (path-based multi-tenancy like `hanzo.id/lux/login`) is fragile. It leaks the organizational structure into URLs, makes CORS configuration harder, and prevents each org from having a clean, branded identity domain that users can trust.

### Why Credit Balances Live in IAM

IAM already owns the user entity. Every authenticated API call already hits IAM (to validate the JWT or session). Adding a `balance` field to the user record means that the LLM Gateway (HIP-4) can check "is this user authenticated?" and "does this user have credits?" in a single token validation, without a second round-trip to a billing microservice.

The `Transaction` model in IAM records both credits (Recharge from Commerce) and debits (Purchase from Cloud/LLM Gateway). This is not a full accounting system -- it is a ledger of balance-affecting events scoped to the user. Complex billing logic (invoices, Stripe integration, subscription tiers) lives in Commerce (HIP-18). IAM is the *balance cache*, not the billing engine.

## Specification

### Architecture

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
         hanzo.id         lux.id          zoo.id ...
              │               │               │
              └───────────────┼───────────────┘
                              │
                    ┌─────────┴─────────┐
                    │    Hanzo IAM       │
                    │   (Go/Beego)       │
                    │     :8000          │
                    └────┬─────────┬────┘
                         │         │
                ┌────────┴──┐  ┌───┴────────┐
                │ PostgreSQL │  │   Redis     │
                │   :5432    │  │   :6379     │
                │ hanzo_iam  │  │  (sessions) │
                └────────────┘  └────────────┘
```

### OAuth 2.0 Flow: Authorization Code Grant with PKCE

Every Hanzo application uses Authorization Code Grant with PKCE (RFC 7636). Implicit grant is not supported. This is the flow:

```
1. Client generates code_verifier (random 43-128 chars)
2. Client computes code_challenge = BASE64URL(SHA256(code_verifier))

3. Client redirects user to:
   GET https://iam.hanzo.ai/v1/iam/oauth/authorize
     ?client_id=hanzo-app-client-id
     &redirect_uri=https://hanzo.ai/callback
     &response_type=code
     &scope=openid profile email
     &state=<random>
     &code_challenge=<code_challenge>
     &code_challenge_method=S256

4. User authenticates at the brand login UI (password, WebAuthn, or social login)

5. IAM redirects back:
   GET https://hanzo.ai/callback
     ?code=<authorization_code>
     &state=<random>

6. Client exchanges code for tokens:
   POST https://iam.hanzo.ai/v1/iam/oauth/token
     grant_type=authorization_code
     &code=<authorization_code>
     &redirect_uri=https://hanzo.ai/callback
     &client_id=hanzo-app-client-id
     &code_verifier=<code_verifier>

7. IAM returns:
   {
     "access_token": "eyJhbGciOi...",
     "token_type": "Bearer",
     "expires_in": 604800,
     "refresh_token": "eyJhbGciOi...",
     "id_token": "eyJhbGciOi...",
     "scope": "openid profile email"
   }
```

Access tokens are JWTs signed with the application's certificate (e.g., `cert-hanzo`). Token lifetime defaults to 168 hours (7 days). Refresh token lifetime defaults to 720 hours (30 days).

### Multi-Tenant Domain Resolution

When a request arrives, IAM resolves the organization context through the following chain:

1. **Application lookup via `/api/get-app-login`**: The login UI (hosted at hanzo.id, served by the `hanzo.id-worker` Cloudflare Worker) calls this endpoint with the `clientId` from the OAuth authorize URL. IAM returns the application name and organization name. This is the source of truth.

2. **Direct login via `/api/login`**: The payload includes `application` and `organization` fields. These must match the application's configured organization. Hardcoding `organization: "hanzo"` for all requests breaks scoped SSO clients (e.g., KMS has its own client ID and expects the correct org context).

3. **Domain-based fallback**: If no application context is provided, IAM falls back to matching the request `Host` header against known origins. Each application configures `origin` and `originFrontend` to enable this.

### Application Configuration

Each service in the ecosystem registers as an OAuth application with its own client credentials, redirect URIs, and scopes:

| Application | Client ID | Organization | Redirect URIs (production) |
|------------|-----------|--------------|---------------------------|
| app-hanzo | hanzo-app-client-id | hanzo | hanzo.ai/callback, hanzo.app/callback, cloud.hanzo.ai/callback |
| app-cloud | hanzo-cloud-client-id | hanzo | cloud.hanzo.ai/callback |
| app-commerce | hanzo-commerce-client-id | hanzo | commerce.hanzo.ai/callback |
| app-console | hanzo-console-client-id | hanzo | console.hanzo.ai/api/auth/callback/hanzo-iam |
| app-platform | hanzo-platform-client-id | hanzo | platform.hanzo.ai/callback |
| app-zoo | zoo-app-client-id | zoo | zoo.ngo/callback, zips.zoo.ngo/callback |
| app-lux | lux-app-client-id | lux | lux.network/callback, wallet.lux.network/callback |
| app-pars | pars-app-client-id | pars | pars.ai/callback |
| app-adnexus | adnexus-app-client-id | adnexus | ad.nexus/callback |

All applications use:
- **Grant types**: `authorization_code`, `refresh_token`, `client_credentials`, `implicit`, `password`
- **Response types**: `code`, `token`, `id_token`
- **Token format**: JWT
- **Password hashing**: argon2id
- **WebAuthn**: Enabled

Client secrets use KMS-managed placeholders (`${IAM_APP_HANZO_CLIENT_SECRET}`) resolved at startup via the `resolveSecrets()` function. Plaintext secrets never appear in configuration files or init_data.json.

### User Balance and Credit System

Every user has a `balance` field (float64, USD-denominated). The flow:

```
Commerce (payment)              IAM (balance)              Cloud (AI usage)
       │                            │                            │
       │  POST /api/add-balance     │                            │
       │  { user: "z", amount: 50 } │                            │
       ├───────────────────────────►│                            │
       │                            │  balance: 50 → 100        │
       │                            │                            │
       │                            │  POST /api/add-transaction │
       │                            │◄────────────────────────────┤
       │                            │  { category: "Purchase",   │
       │                            │    amount: -0.02,          │
       │                            │    subtype: "llm-tokens" } │
       │                            │                            │
       │                            │  balance: 100 → 99.98     │
```

The `Transaction` model records every balance-affecting event:

```go
type Transaction struct {
    Owner       string              // Organization (e.g., "hanzo")
    Name        string              // Transaction ID
    CreatedTime string              // ISO 8601 timestamp
    Application string              // Which app triggered it
    Category    TransactionCategory // "Purchase" or "Recharge"
    User        string              // User being charged/credited
    Amount      float64             // Positive for credit, negative for debit
    Currency    string              // "USD"
    State       string              // "Completed", "Pending", "Failed"
}
```

Services check balance before executing expensive operations. The LLM Gateway (HIP-4) reads the user's balance from the JWT claims or via `/api/get-account` and rejects requests when balance is insufficient.

### Bootstrap: init_data.json

IAM bootstraps from `init_data.json` on first startup. This file defines the initial state of the system:

```json
{
  "organizations": [
    {
      "name": "hanzo",
      "displayName": "Hanzo",
      "websiteUrl": "https://hanzo.ai",
      "passwordType": "argon2id",
      "defaultApplication": "app-hanzo",
      "themeData": {
        "themeType": "dark",
        "colorPrimary": "#fd4444"
      }
    },
    { "name": "zoo", "displayName": "Zoo Labs", "colorPrimary": "#10b981" },
    { "name": "lux", "displayName": "Lux Network", "colorPrimary": "#e4e4e7" },
    { "name": "pars", "displayName": "Pars", "colorPrimary": "#3b82f6" },
    { "name": "adnexus", "displayName": "AdNexus", "colorPrimary": "#3b82f6" }
  ],
  "applications": [
    {
      "name": "app-hanzo",
      "organization": "hanzo",
      "clientId": "hanzo-app-client-id",
      "clientSecret": "${IAM_APP_HANZO_CLIENT_SECRET}",
      "grantTypes": ["authorization_code", "refresh_token", "client_credentials", "implicit", "password"],
      "tokenFormat": "JWT",
      "expireInHours": 168,
      "refreshExpireInHours": 720
    }
  ],
  "users": [
    {
      "name": "admin",
      "email": "admin@hanzo.ai",
      "type": "normal-user",
      "isAdmin": true,
      "balance": 10000
    }
  ],
  "certs": [
    {
      "name": "cert-hanzo",
      "cryptoAlgorithm": "RS256",
      "bitSize": 4096
    }
  ]
}
```

The `initDataNewOnly` configuration flag controls whether init_data.json overwrites existing records (false) or only creates missing ones (true). Production uses `initDataNewOnly = false` to ensure configuration drift is corrected on restart.

### API Endpoints

#### Authentication (canonical OIDC endpoints)

These `/v1/iam/oauth/*` paths are the only OIDC endpoints. There is no `/oauth/*`, no `/api/login/*`, no `/api/`-prefixed auth path. Clients reach them only through `@hanzo/iam`; see **HIP-0111 (Hanzo IAM Authentication Standard)**, which is authoritative for the client contract. IAM serves a `200 text/html` SPA catch-all for any unregistered path — a wrong path is silent breakage, not a `404`.

| Method | Endpoint | RFC | Description |
|--------|----------|-----|-------------|
| GET | `/api/get-app-login` | — | Resolve application and org from client ID |
| POST | `/api/login` | — | Password login (returns session or redirects) |
| GET | `/v1/iam/oauth/authorize` | RFC 6749 §3.1 | Authorization endpoint (PKCE `S256` required) |
| POST | `/v1/iam/oauth/token` | RFC 6749 §3.2 | Token exchange (`client_secret_basic` for confidential clients) |
| GET | `/v1/iam/oauth/userinfo` | OIDC Core §5.3 | UserInfo endpoint |
| GET | `/v1/iam/oauth/logout` | OIDC RP-Initiated Logout | End session endpoint |
| GET | `/v1/iam/.well-known/jwks` | RFC 7517 | JSON Web Key Set |
| GET | `/.well-known/openid-configuration` | OIDC Discovery 1.0 | Discovery (host-relative; `originFrontend` empty) |

#### User Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/get-account` | Get current user (from session/token) |
| GET | `/api/userinfo` | OIDC UserInfo endpoint |
| GET | `/api/get-user` | Get user by ID |
| POST | `/api/update-user` | Update user profile |
| POST | `/api/add-user` | Create new user (admin) |
| POST | `/api/delete-user` | Delete user (admin) |

#### Billing

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/add-transaction` | Record a balance-affecting event |
| GET | `/api/get-transactions` | List transactions for org |
| GET | `/api/get-user-transactions` | List transactions for user |
| POST | `/api/add-balance` | Add credits to user balance |

#### Discovery

| Method | Endpoint | RFC | Description |
|--------|----------|-----|-------------|
| GET | `/.well-known/openid-configuration` | OIDC Discovery 1.0 | OIDC discovery document (host-relative) |
| GET | `/v1/iam/.well-known/jwks` | RFC 7517 | JSON Web Key Set |
| GET | `/api/health` | — | Health check |

The OIDC discovery document is host-relative and self-consistent — issuer, authorize, token, userinfo, and jwks all share one origin (`originFrontend` empty in `app.prod.conf`):

```json
{
  "issuer": "https://iam.hanzo.ai",
  "authorization_endpoint": "https://iam.hanzo.ai/v1/iam/oauth/authorize",
  "token_endpoint": "https://iam.hanzo.ai/v1/iam/oauth/token",
  "userinfo_endpoint": "https://iam.hanzo.ai/v1/iam/oauth/userinfo",
  "jwks_uri": "https://iam.hanzo.ai/v1/iam/.well-known/jwks",
  "end_session_endpoint": "https://iam.hanzo.ai/v1/iam/oauth/logout",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token", "client_credentials"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["client_secret_basic"]
}
```

### SDK Integration

The client contract is **HIP-0111**. JS/TS applications integrate only through `@hanzo/iam`; Go services use `iamsdk`. No application writes an OIDC path string.

#### Go SDK

```go
import "github.com/hanzoai/iam/iamsdk"

func init() {
    iamsdk.InitConfig(
        "https://iam.hanzo.ai",       // IAM endpoint
        "hanzo-app-client-id",        // Client ID
        "client-secret-here",         // Client secret
        "cert-hanzo",                 // Certificate name
        "hanzo",                      // Organization
        "app-hanzo",                  // Application
    )
}

// Validate a JWT access token
func validateToken(token string) (*iamsdk.Claims, error) {
    claims, err := iamsdk.ParseJwtToken(token)
    if err != nil {
        return nil, fmt.Errorf("invalid token: %w", err)
    }
    return claims, nil
}

// Get user info from token
func getUserInfo(token string) (*iamsdk.User, error) {
    return iamsdk.GetUserByAccessToken(token)
}
```

#### JavaScript / TypeScript SDK (`@hanzo/iam`)

Server-side token validation:

```ts
import { validateToken } from "@hanzo/iam/server";

const result = await validateToken(accessToken, {
  serverUrl: "https://iam.hanzo.ai",
  clientId: "hanzo-app-client-id",
});
if (result.ok) {
  const { userId, email, owner } = result; // owner = org slug; scope queries to it
}
```

Framework providers (`@hanzo/iam/betterauth`, `@hanzo/iam/nextauth`), the React SPA client (`@hanzo/iam/react`, `@hanzo/iam/browser`), and Passport (`@hanzo/iam/passport`) are specified in HIP-0111.

## Implementation

### Production Deployment

IAM runs on the **hanzo-k8s** DOKS cluster at `24.199.76.156`. The deployment uses Docker Compose with Traefik for TLS termination and automatic certificate provisioning via Let's Encrypt.

```yaml
# compose.production.yml (simplified)
services:
  iam:
    image: ghcr.io/hanzoai/iam:latest
    ports:
      - "8000:8000"
    environment:
      IAM_DB_HOST: ${IAM_DB_HOST:-postgres}
      IAM_DB_PASSWORD: ${IAM_DB_PASSWORD}
      IAM_REDIS_HOST: ${IAM_REDIS_HOST:-redis}
    volumes:
      - ./conf/app.prod.conf:/app/conf/app.conf:ro
      - ./init_data.json:/app/init_data.json:ro
    labels:
      - "traefik.http.routers.iam-hanzo.rule=Host(`hanzo.id`)"
      - "traefik.http.routers.iam-lux.rule=Host(`lux.id`)"
      - "traefik.http.routers.iam-zoo.rule=Host(`zoo.id`)"
      - "traefik.http.routers.iam-pars.rule=Host(`pars.id`)"
      - "traefik.http.routers.iam-adnexus.rule=Host(`id.ad.nexus`)"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/health"]
      interval: 30s

  postgres:
    image: ghcr.io/hanzoai/sql:16-alpine
    environment:
      POSTGRES_USER: hanzo
      POSTGRES_DB: hanzo_iam

  redis:
    image: ghcr.io/hanzoai/kv:latest
    command: kv-server --appendonly yes
```

### Production Configuration

```ini
# conf/app.prod.conf
appname = hanzo-iam
httpport = 8000
runmode = prod
driverName = postgres
origin = https://hanzo.id
originFrontend = https://hanzo.id
staticBaseUrl = "https://cdn.hanzo.ai"
enableGzip = true
enableErrorMask = true
inactiveTimeoutMinutes = 30
logPostOnly = true
initDataFile = "./init_data.json"
initDataNewOnly = true
kmsUrl = https://kms.hanzo.ai
kmsProjectSlug = hanzo-iam
kmsEnvironment = prod
```

Key configuration decisions:
- **`enableErrorMask = true`**: Production never leaks internal error details to clients.
- **`logPostOnly = true`**: GET requests are not logged (reduces log volume by ~80%).
- **`initDataNewOnly = true`**: Only create missing entities from init_data.json. Never delete or overwrite existing users, apps, or orgs. This protects passwords, MFA settings, and all user data from being reset on pod restarts.
- **`kmsUrl`**: Secrets are fetched from KMS (HIP-27) at startup, not stored in config files.

### Database Schema

IAM uses PostgreSQL (HIP-29) in production and supports MySQL for local development. The schema is managed by XORM auto-migration. Key tables:

| Table | Description | Primary Key |
|-------|-------------|-------------|
| `organization` | Tenant orgs (hanzo, lux, zoo, pars, adnexus) | owner + name |
| `user` | User accounts with balance, score, properties | owner + name |
| `application` | OAuth applications with client credentials | owner + name |
| `token` | Active access/refresh tokens | owner + name |
| `session` | Active user sessions | owner + name |
| `transaction` | Balance-affecting events (credits/debits) | owner + name |
| `cert` | RSA/ECDSA certificates for JWT signing | owner + name |
| `provider` | OAuth/SAML identity providers (GitHub, Google) | owner + name |
| `permission` | RBAC permissions | owner + name |
| `role` | RBAC roles | owner + name |

### CI/CD Pipeline

```
Push to main
    │
    ├─ Go tests (with PostgreSQL service)
    ├─ Frontend build (yarn build)
    ├─ Backend build (go build -race)
    ├─ Linter (gofumpt)
    └─ E2E tests (Cypress + Chrome)
          │
          ▼
    Semantic Version Tag
          │
          ▼
    Docker Multi-Arch Build (amd64 + arm64)
          │
          ├─ Push to ghcr.io/hanzoai/iam:latest
          └─ Push to Docker Hub (continue-on-error)
                │
                ▼
          SSH Deploy to hanzo-k8s
                │
                ├─ docker compose pull
                ├─ docker compose up -d
                └─ Health check: curl https://hanzo.id/api/health
```

### Local Development

#### MySQL (recommended for fast iteration)

```bash
# Start MySQL + Redis
docker compose -f compose.mysql.yml up -d

# Build Go binary
go build -o server .

# Copy local config
cp conf/app.mysql.conf conf/app.conf

# Run
./server
```

MySQL config note: `dataSourceName` must end with `/` (no database name). The `dbName` field is appended automatically by XORM.

```ini
# conf/app.mysql.conf
driverName = mysql
dataSourceName = hanzo:password@tcp(localhost:3306)/
dbName = hanzo_iam
```

#### PostgreSQL (matches production)

```bash
docker compose -f compose.dev.yml up -d
cp conf/app.dev.conf conf/app.conf
go build -o server . && ./server
```

### Secrets Management

IAM integrates with Hanzo KMS (HIP-27) for secret resolution. Configuration files and init_data.json use `${VARIABLE}` placeholders:

```json
{
  "clientSecret": "${IAM_APP_HANZO_CLIENT_SECRET}"
}
```

At startup, IAM's `resolveSecrets()` function fetches values from KMS using:
- **KMS URL**: `kmsUrl = https://kms.hanzo.ai`
- **Project**: `kmsProjectSlug = hanzo-iam`
- **Environment**: `kmsEnvironment = prod`

This means client secrets, database passwords, and encryption keys never appear in Git, Docker images, or config files. KMS authentication uses Universal Auth tokens stored as Kubernetes secrets.

## Standards Compliance

### Standards Implemented

| Standard | Status | Notes |
|----------|--------|-------|
| RFC 6749 (OAuth 2.0) | Full | Authorization Code + PKCE; `client_secret_basic` |
| RFC 7636 (PKCE) | Full | `S256` only |
| OIDC Core 1.0 | Full | Discovery, UserInfo, ID Tokens |
| OIDC Discovery 1.0 | Full | `/.well-known/openid-configuration` (host-relative) |
| OIDC RP-Initiated Logout | Full | `/v1/iam/oauth/logout` |
| RFC 7517 (JWK) | Full | `/v1/iam/.well-known/jwks` |
| RFC 7519 (JWT) | Full | RS256 signing |

### Custom Login UI

The `hanzo/id` repository provides a forkable, white-label Next.js login UI that serves as the frontend for all identity domains. It includes:

- **OIDC discovery rewriting**: serves `.well-known` host-relative to the tenant domain
- **Multi-tenant detection**: hostname-based tenant resolution (per-brand origin)
- **PKCE support**: built-in `S256` code challenge generation and verification
- **White-label forkable**: fork to `luxfi/id`, `zoofdn/id`, etc. for org-specific branding

### SDK Compliance

The client contract is **HIP-0111**. JS/TS uses `@hanzo/iam`; Go uses `iamsdk`. All hit the canonical `/v1/iam/oauth/*` endpoints.

| SDK | Package | Authorize | Token |
|-----|---------|-----------|-------|
| JS/TS | `@hanzo/iam` | `/v1/iam/oauth/authorize` | `/v1/iam/oauth/token` |
| Go | `github.com/hanzoai/iam/iamsdk` | `/v1/iam/oauth/authorize` | `/v1/iam/oauth/token` |

### No Backward Compatibility

There are no legacy paths. `/oauth/*`, `/api/login/oauth/*`, and `/api/`-prefixed auth paths are not served and not supported. The OIDC discovery document returns only the canonical `/v1/iam/oauth/*` endpoints.

## Security Considerations

### Authentication Security

- **PKCE required**: All public clients (SPAs, mobile apps) MUST use PKCE (RFC 7636) with S256 challenge method. Authorization code interception is the most common OAuth attack vector; PKCE eliminates it.
- **Token rotation**: Refresh tokens are rotated on use. The previous refresh token is invalidated when a new one is issued. This limits the window of a leaked refresh token.
- **Password hashing**: argon2id with per-org salt configuration. argon2id is the winner of the Password Hashing Competition and is resistant to both GPU and side-channel attacks.
- **WebAuthn**: Enabled on all applications for phishing-resistant second-factor authentication.

### Session Security

- **Session timeout**: `inactiveTimeoutMinutes = 30` in production. Idle sessions expire after 30 minutes.
- **Secure cookies**: Sessions use HttpOnly, Secure, SameSite=Lax cookies. The `authState` configuration pins sessions to the IAM origin.
- **Redis-backed sessions**: Sessions are stored in Redis with TTL. If the Redis instance is restarted, all sessions are invalidated (fail-secure).

### Network Security

- **TLS everywhere**: Traefik terminates TLS with Let's Encrypt certificates. HTTP is redirected to HTTPS. No plaintext traffic.
- **CORS whitelist**: The `origin` and `originFrontend` settings restrict which origins can interact with IAM APIs. Cross-origin requests from unknown origins are rejected.
- **Rate limiting**: Per-IP rate limiting on login endpoints prevents brute-force attacks. Failed login attempts increment a counter; after 5 failures, the IP is throttled for 15 minutes.
- **Health endpoint isolation**: `/api/health` is unauthenticated (required for load balancer probes) but returns only a boolean status, leaking no internal state.

### Operational Security

- **Error masking**: `enableErrorMask = true` in production ensures internal errors (database errors, stack traces) are never exposed to clients. Clients receive generic error messages; details are logged server-side.
- **Admin password rotation**: The default admin password in init_data.json is `admin`. Production deployments MUST rotate this immediately. The `HANZO_INIT_USER_EMAIL` bootstrap flow creates admin users with KMS-managed passwords.
- **Audit logging**: All authentication events (login, logout, token refresh, password change) are logged with timestamp, IP, user agent, and result. Logs are shipped to the centralized logging stack.

### Authentication vs Authorization (AuthN vs AuthZ)

IAM handles both authentication (identity verification) and authorization (access control), but they are distinct concerns:

**Authentication (AuthN)** — "Who are you?"
- OAuth 2.0 flows (authorization code + PKCE, client credentials, device code)
- Password login with argon2id hashing
- Social login (GitHub, Google, etc.) via identity providers
- WebAuthn / FIDO2 for phishing-resistant MFA
- SAML 2.0 and CAS for enterprise SSO
- Session management (Redis-backed, 30-min idle timeout)

**Authorization (AuthZ)** — "What can you do?"
- **OAuth scopes**: Applications request scopes (openid, profile, email, custom). IAM validates requested scopes against the application's allowed scope set and returns `invalid_scope` per RFC 6749 §4.1.2.1 if the client requests scopes not configured for its application.
- **RBAC roles and permissions**: IAM supports role-based access control. Roles are collections of permissions; users are assigned roles per-organization. The `permission` and `role` tables enforce this.
- **Organization isolation**: Users can be members of multiple organizations (hanzo, lux, zoo, pars, adnexus) but each session is scoped to one organization context. Cross-org access requires switching context.
- **Application-level isolation**: Each OAuth application has its own client credentials, redirect URIs, grant types, and scopes. A token issued for `app-console` cannot be used at `app-commerce` (different `aud` claim).
- **Admin vs normal user**: The `isAdmin` flag on the user entity grants full API access within the organization. Non-admin users are restricted to self-service operations.
- **Balance-gated access**: Services can check `balance > 0` from the JWT claims or userinfo endpoint to gate access to paid features (AI inference, compute).

The key design principle: **IAM authenticates users and issues scoped tokens. Services authorize requests by validating token claims.** IAM does not make fine-grained authorization decisions for downstream services — it provides the identity and claims that services use to make their own authorization decisions.

## References

1. [Casdoor](https://github.com/casdoor/casdoor) - Open-source identity and access management platform
2. [RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749) - The OAuth 2.0 Authorization Framework
3. [RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636) - Proof Key for Code Exchange (PKCE)
4. [RFC 7519](https://datatracker.ietf.org/doc/html/rfc7519) - JSON Web Token (JWT)
5. [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html) - OIDC specification
6. [RFC 7662](https://datatracker.ietf.org/doc/html/rfc7662) - OAuth 2.0 Token Introspection
7. [RFC 7009](https://datatracker.ietf.org/doc/html/rfc7009) - OAuth 2.0 Token Revocation
8. [RFC 8414](https://datatracker.ietf.org/doc/html/rfc8414) - OAuth 2.0 Authorization Server Metadata
9. [RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628) - OAuth 2.0 Device Authorization Grant
10. [RFC 7517](https://datatracker.ietf.org/doc/html/rfc7517) - JSON Web Key (JWK)
11. [RFC 7033](https://datatracker.ietf.org/doc/html/rfc7033) - WebFinger
6. [HIP-4: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md) - Unified AI provider interface (consumes IAM tokens)
7. [HIP-18: Payment Processing Standard](./hip-0018-payment-processing-standard.md) - Commerce billing (feeds credits into IAM)
8. [HIP-25: Bot Agent Wallet & RPC Billing Protocol](./hip-0025-bot-agent-wallet-rpc-billing-protocol.md) - Agent identity (built on IAM)
9. [HIP-27: KMS for Secrets Management](./hip-0027-kms-secrets-management.md) - Secret resolution at startup
10. [HIP-29: PostgreSQL Storage Standard](./hip-0029-postgresql-storage-standard.md) - Database layer
11. [Hanzo IAM Repository](https://github.com/hanzoai/iam)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
