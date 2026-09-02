---
hip: "0026"
title: Identity & Access Management Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Final
created: 2025-01-15
requires: HIP-0027, HIP-0139
capability: iam
---


# HIP-0026: Identity & Access Management Standard

## Abstract

Hanzo IAM is the unified identity and access management provider for the Hanzo ecosystem, serving production traffic at **hanzo.id**. It is a clean-room native rewrite on the Hanzo stack -- `zip` over `hanzoai/orm` -- and carries no Beego and no xorm. (This paragraph asserted a Go/Beego platform until 2026-08-13; the Casdoor-derived Beego/xorm tree is the retired v1 line at `hanzoai/iam-v1`. `iam/go.mod` requires no beego module and no Go file imports one -- the only occurrences in the tree are comments describing what v1 did.)

Hanzo IAM implements OAuth 2.0 and OpenID Connect (OIDC) — authorization code with PKCE, client credentials, the device grant, introspection and revocation — plus WebAuthn and TOTP MFA. (Earlier revisions also claimed SAML 2.0 and CAS; no SAML or CAS route exists in the served surface, `plugin/iam/openapi.json`, and the claim is withdrawn until one does.) It provides multi-tenant authentication with per-organization white-label identity domains — any organization registered in IAM can get its own branded login page and identity domain. The default deployment ships with hanzo.id, lux.id, zoo.id, pars.id, and id.ad.nexus, but the system supports arbitrary additional tenants via configuration.

IAM is the source of truth for identity. It is NOT the source of truth for spend: prepaid credit is the finance ledger's, read at the caller's own wallet address by the one spend predicate in `hanzoai/cloud` (`spend.go`), and IAM serves no balance or transaction route.

**Repository**: [github.com/hanzoai/iam](https://github.com/hanzoai/iam)
**Port**: 8000
**Docker**: `ghcr.io/hanzoai/iam:latest`

## Motivation

Keycloak is the most popular open-source IAM. It is also a 500MB+ Java application that requires a JVM, takes 30+ seconds to start, and consumes 512MB of heap at idle. In the Hanzo ecosystem, where the blockchain node, CLI tools, SDK, and wallet are all written in Go, introducing a Java dependency for IAM is a poor fit.

Hanzo IAM compiles to a single Go binary (~50MB), starts in under 2 seconds, and idles at ~50MB RSS. It ships a React frontend (easy to customize for branding) and serves OAuth 2.0, OIDC, WebAuthn and TOTP MFA. The tradeoff is a smaller community and fewer enterprise features (no fine-grained RBAC policies, no UMA). For our use case -- OAuth SSO across a handful of first-party services -- the Hanzo IAM feature set is sufficient, and the operational simplicity is decisive.

| Factor | Hanzo IAM | Keycloak |
|--------|---------|----------|
| Language | Go | Java |
| Binary size | ~50 MB | ~500 MB+ |
| Idle memory | ~50 MB RSS | ~512 MB heap |
| Startup time | < 2s | 30-60s |
| Frontend | React (customizable) | Freemarker (limited) |
| Protocol support | OAuth2, OIDC, WebAuthn | OAuth2, OIDC, SAML, UMA |
| Stack alignment | Same as Lux node, CLI, SDK | Requires JVM |

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
                    │   (zip + orm)      │
                    │     :8000          │
                    └─────────┬─────────┘
                              │
                    ┌─────────┴─────────┐
                    │      iam.db        │
                    │ (SQLite, encrypted │
                    │     at rest)       │
                    └───────────────────┘
```

One store: `{DataDir}/iam/iam.db`, an encrypted-at-rest SQLite file opened by
IAM's own `orm.DB`, converted in place if it arrived plaintext — the same file
the standalone binary is pointed at with `--db`, so the graft in
`hanzoai/cloud` and the standalone process serve the same identities
(`cloud` `apps/iam/iam.go:36-48`). There is no external database and no
session cache beside it. (Earlier revisions drew SQL on :5432 and a KV
session store on :6379; both belonged to the retired v1 line.)

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

Access tokens are JWTs signed with the application's certificate (e.g., `cert-hanzo`). Lifetimes are per-application: `expireInHours` sets the access-token lifetime (1 hour when undeclared), and `refreshExpireInHours` sets the refresh lifetime, clamping to the access lifetime when unset (`iam` `pkg/schema/application.go:28`, `internal/oidc/token.go:533-548`). The example registration in *Bootstrap* below declares 168h/720h, which is what the flow example's `expires_in` reflects.

### Multi-Tenant Domain Resolution

When a request arrives, IAM resolves the organization context through the following chain:

1. **Application lookup via `/v1/iam/get-app-login`**: The login UI (hosted at hanzo.id, served by the `hanzo.id-worker` Cloudflare Worker) calls this endpoint with the `clientId` from the OAuth authorize URL. IAM returns the application name and organization name. This is the source of truth.

2. **Direct login via `/v1/iam/login`**: The payload includes `application` and `organization` fields. These must match the application's configured organization. Hardcoding `organization: "hanzo"` for all requests breaks scoped SSO clients (e.g., KMS has its own client ID and expects the correct org context).

3. **The Host decides the issuer, not the org**: there is no Host-based org fallback — `get-app-login` refuses a missing `clientId` with a 400 (`iam` `internal/oidc/frontdoor.go:101`). What the request `Host` does decide is the issuer the tokens carry, derived per request so each brand domain emits its own (`internal/oidc/token.go:608-609`).

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
- **Grant types**: `authorization_code`, `refresh_token`, `client_credentials`, `password`, token exchange (RFC 8693), device code (RFC 8628)
- **Response types**: `code` (the only one the discovery document advertises)
- **Token format**: JWT
- **Password hashing**: argon2id
- **WebAuthn**: Enabled

Client secrets use KMS-managed placeholders (`${IAM_APP_HANZO_CLIENT_SECRET}`) resolved at startup via the `resolveSecrets()` function. Plaintext secrets never appear in configuration files or init_data.json.

### Identity, Not Money

IAM serves no balance and no transaction route (`plugin/iam/openapi.json`
carries neither noun), and earlier revisions of this section — a per-user
`balance` field, `/api/add-balance`, `/api/add-transaction`, a `Transaction`
model — described the retired v1 line. Prepaid credit is the finance ledger's:
the one spend predicate reads the caller's own wallet address, exact to the
atto-USD, and composes it with the subscription answer commerce resolves
(`hanzoai/cloud` `spend.go`). IAM's contribution to that decision is the
identity the wallet is derived from, nothing more.

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
      "grantTypes": ["authorization_code", "refresh_token", "client_credentials", "password"],
      "tokenFormat": "JWT",
      "expireInHours": 168,
      "refreshExpireInHours": 720
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

Seeding is new-only and idempotent: an entity that already exists is left untouched, and `${VAR}` references are substituted from the environment before parsing (`iam` `internal/seed/seed.go:10-13`). Users are deliberately excluded from the seed — accounts and service-account applications are provisioned through the operator-driven bootstrap endpoints (`POST /v1/iam/admin/{applications,users}/upsert`, `internal/bootstrap/bootstrap.go:4-16`), which fail closed when no service token is configured.

### API Endpoints

#### Authentication (canonical OIDC endpoints)

These `/v1/iam/oauth/*` paths are the only OIDC endpoints. There is no `/oauth/*`, no `/api/login/*`, no `/api/`-prefixed auth path. Clients reach them only through `@hanzo/iam`; see **HIP-0111 (Hanzo IAM Authentication Standard)**, which is authoritative for the client contract. IAM serves a `200 text/html` SPA catch-all for any unregistered path — a wrong path is silent breakage, not a `404`.

| Method | Endpoint | RFC | Description |
|--------|----------|-----|-------------|
| GET | `/v1/iam/get-app-login` | — | Resolve application and org from client ID |
| POST | `/v1/iam/login` | — | Password login (returns session or redirects) |
| GET | `/v1/iam/oauth/authorize` | RFC 6749 §3.1 | Authorization endpoint (PKCE `S256` required) |
| POST | `/v1/iam/oauth/token` | RFC 6749 §3.2 | Token exchange (`client_secret_basic` for confidential clients) |
| GET | `/v1/iam/oauth/userinfo` | OIDC Core §5.3 | UserInfo endpoint |
| POST | `/v1/iam/oauth/introspect` | RFC 7662 | Token introspection |
| POST | `/v1/iam/oauth/revoke` | RFC 7009 | Token revocation |
| GET | `/v1/iam/oauth/logout` | OIDC RP-Initiated Logout | End session endpoint |
| GET | `/v1/iam/.well-known/jwks` | RFC 7517 | JSON Web Key Set |
| GET | `/.well-known/openid-configuration` | OIDC Discovery 1.0 | Discovery (host-relative; issuer derived from the request Host) |

#### User Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/iam/get-account` | Get current user (from session/token) |
| GET | `/v1/iam/oauth/userinfo` | OIDC UserInfo endpoint |
| GET | `/v1/iam/get-user` | Get user by ID |
| POST | `/v1/iam/update-user` | Update user profile |
| POST | `/v1/iam/add-user` | Create new user (admin) |
| POST | `/v1/iam/delete-user` | Delete user (admin) |

(There is no billing table any more: earlier revisions listed
`/api/add-transaction` and `/api/add-balance` here, routes the served surface
does not carry — see *Identity, Not Money* above.)

#### Discovery

| Method | Endpoint | RFC | Description |
|--------|----------|-----|-------------|
| GET | `/.well-known/openid-configuration` | OIDC Discovery 1.0 | OIDC discovery document (host-relative) |
| GET | `/v1/iam/.well-known/jwks` | RFC 7517 | JSON Web Key Set |

The OIDC discovery document is host-relative and self-consistent — issuer, authorize, token, userinfo, and jwks all share one origin, because every endpoint URL is built from the same request-derived issuer (`iam` `internal/oidc/oidc.go:134-146`):

```json
{
  "issuer": "https://iam.hanzo.ai",
  "authorization_endpoint": "https://iam.hanzo.ai/v1/iam/oauth/authorize",
  "token_endpoint": "https://iam.hanzo.ai/v1/iam/oauth/token",
  "userinfo_endpoint": "https://iam.hanzo.ai/v1/iam/oauth/userinfo",
  "jwks_uri": "https://iam.hanzo.ai/v1/iam/.well-known/jwks",
  "end_session_endpoint": "https://iam.hanzo.ai/v1/iam/oauth/logout",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token",
    "client_credentials", "password",
    "urn:ietf:params:oauth:grant-type:token-exchange",
    "urn:ietf:params:oauth:grant-type:device_code"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post", "none"]
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

### Deployment Shapes

IAM ships two ways, one store either way. Standalone, the binary serves the
brand identity domains behind the platform ingress, opening `iam.db` at the
path `--db` names. Grafted, `hanzoai/cloud` composes the whole IAM surface
in-process — `host.Use(iamserver.NewApp(db))`, so cloud's router learns IAM's
route patterns AND its op registry while IAM's own router keeps IAM's
behaviour — and opens the same file under its data directory
(`cloud` `apps/iam/iam.go:13-18`, `:36-48`). A store that will not open is
handed to IAM as nil and every identity request answers 503 while co-resident
subsystems stay up; the degrade never moves the route table
(`apps/iam/iam.go:56-69`).

### Production Configuration

Key configuration facts (the v1 config file and its knobs — `enableErrorMask`,
`logPostOnly`, `initDataNewOnly`, `kmsUrl` — retired with that line; v2 is
configured by flags and environment):
- **`--db`** names the one store; grafted, cloud opens the same file under its data directory.
- **`--init-data`** seeds on boot, new-only, with `${VAR}` substituted from the environment (`iam` `main.go:88`).
- **Bootstrap fails closed**: the operator provisioning routes authenticate a service token from the first non-empty of `HANZO_API_KEY` / `KMS_SERVICE_TOKEN` / `IAM_SERVICE_TOKEN`; unset means no bootstrap (`internal/bootstrap/bootstrap.go:11-16`).

### The Entities

Every entity is addressed `(owner, name)` — the owner is the organization, and
that pair is the tenancy key on every row: organizations, users, applications,
tokens, sessions, signing certs, identity providers, roles and permissions.
(Earlier revisions described the schema as XORM auto-migration over SQL/MySQL
and listed a `transaction` table; all three belonged to the retired v1 line —
the store is `hanzoai/orm` over the one SQLite file above, and there is no
transaction entity.)

### Secrets Management

IAM integrates with Hanzo KMS (HIP-27) for secret resolution. Configuration files and init_data.json use `${VARIABLE}` placeholders:

```json
{
  "clientSecret": "${IAM_APP_HANZO_CLIENT_SECRET}"
}
```

The placeholders resolve from the process environment at seed time (`iam`
`internal/seed/seed.go:54-56`); the environment itself is KMS-synced by the
deployment, so client secrets and signing keys never appear in Git, Docker
images, or config files. (The v1 line fetched from a `kmsUrl` at startup via
`resolveSecrets()`; v2 carries no runtime KMS client — the sync happens outside
the process.)

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

### The Capability Contract

What HIP-0139 §6 asks of every capability, answered for `iam`:

- **Addresses.** Everything is under `/v1/iam`, plus the two families a
  protocol fixes at other roots: `/.well-known/*` (RFC 8615 — OIDC discovery,
  OAuth server metadata, JWKS) and `/login/oauth/*`, the browser authorize
  surface the `/v1/iam/oauth/authorize` 302 targets
  (`cloud` `manifest/apps.go:70`). Every operation is typed through IAM's own
  op registry, which the graft composes rather than wraps
  (`apps/iam/iam.go:19-27`).
- **Tenancy.** IAM is the issuer, so it is the one capability whose tenant
  does not arrive as another service's claim: the organization is the `owner`
  half of every entity key, resolved from the application the client
  authenticates as (or, for a direct login, the payload's `application` +
  `organization`, which must match), and each brand emits its own issuer from
  the request Host. A request that resolves no organization is refused, not
  defaulted.
- **Meter.** It is free, said in those words: no meter, no debit through any
  plane (`cloud` `plugin/iam/main.go`, `Price: cloud.Free`). Identity is what
  the paid planes charge AGAINST, not a thing charged for.
- **Events.** It publishes none — a customer's webhooks receive nothing from
  `iam`. Authentication events go to the audit log (below), not the bus.
- **Observability.** Nothing beyond the request span every route already
  gets; the audit trail of authentication events is IAM's own store, read
  through `/v1/iam/audit-logs`.
- **Stage.** `ga`.
- **Upstreams.** None survive in HEAD. The v1 line was a fork (Beego/xorm
  lineage, retired to `hanzoai/iam-v1`); v2 is the clean-room rewrite this
  HIP's opening paragraph describes, and `cloud`'s graph carries no v1 module
  (`apps/iam/iam.go:8-13`).
- **Attacker.** The Security Considerations below are that analysis: the
  wrong implementation here is an estate-wide credential mint.

## Security Considerations

### Authentication Security

- **PKCE required**: All public clients (SPAs, mobile apps) MUST use PKCE (RFC 7636) with S256 challenge method. Authorization code interception is the most common OAuth attack vector; PKCE eliminates it.
- **Token rotation**: Refresh tokens are rotated on use. The previous refresh token is invalidated when a new one is issued. This limits the window of a leaked refresh token.
- **Password hashing**: argon2id with per-org salt configuration. argon2id is the winner of the Password Hashing Competition and is resistant to both GPU and side-channel attacks.
- **WebAuthn**: Enabled on all applications for phishing-resistant second-factor authentication.

### Session Security

- **Session lifetime**: the portal session TTL is 14 days, matching the refresh window (`iam` `internal/sessions/resolve.go:17-19`). Logout revokes the sid server-side AND expires the cookie, so a copy of the cookie taken before logout does not still resolve.
- **Secure cookies**: sessions use HttpOnly, SameSite=Lax cookies (`internal/oidc/challenge.go:124`, `internal/sessions/cookie.go`).
- **Store-backed sessions**: sessions are rows in the one identity store. (The v1 line held them in a KV side-store; there is no session cache beside `iam.db` any more.)

### Network Security

- **TLS everywhere**: Traefik terminates TLS with Let's Encrypt certificates. HTTP is redirected to HTTPS. No plaintext traffic.
- **CORS**: only a registered browser client's origin is admitted; a reverse proxy MUST NOT append CORS headers of its own beside it (`iam` `internal/cors/cors.go`).
- **Signin throttle**: failed signins are throttled per organization or per application — `failedSigninLimit` and `failedSigninFrozenTime`, clamped to safe bounds before persistence; zero inherits the application default (`pkg/schema/organization.go:84-88`).
- **Health endpoint isolation**: the liveness probe is unauthenticated (required for load balancer probes) but returns only a boolean status, leaking no internal state.

### Operational Security

- **No seeded admin**: init_data.json seeds no user at all (`iam` `internal/seed/seed.go:28-29`), so there is no default admin password to rotate. Admin accounts arrive only through the operator bootstrap upsert, under the service token.
- **Audit logging**: authentication events are rows in IAM's own store, read back through `/v1/iam/audit-logs`.

### Authentication vs Authorization (AuthN vs AuthZ)

IAM handles both authentication (identity verification) and authorization (access control), but they are distinct concerns:

**Authentication (AuthN)** — "Who are you?"
- OAuth 2.0 flows (authorization code + PKCE, client credentials, device code)
- Password login with argon2id hashing
- Social login (GitHub, Google, etc.) via identity providers
- WebAuthn / FIDO2 for phishing-resistant MFA
- Session management (store-backed; see Session Security)

**Authorization (AuthZ)** — "What can you do?"
- **OAuth scopes**: Applications request scopes (openid, profile, email, custom). IAM validates requested scopes against the application's allowed scope set and returns `invalid_scope` per RFC 6749 §4.1.2.1 if the client requests scopes not configured for its application.
- **RBAC roles and permissions**: IAM supports role-based access control. Roles are collections of permissions; users are assigned roles per-organization. The `permission` and `role` tables enforce this.
- **Organization isolation**: Users can be members of multiple organizations (hanzo, lux, zoo, pars, adnexus) but each session is scoped to one organization context. Cross-org access requires switching context.
- **Application-level isolation**: Each OAuth application has its own client credentials, redirect URIs, grant types, and scopes. A token issued for `app-console` cannot be used at `app-commerce` (different `aud` claim).
- **Admin vs normal user**: The `isAdmin` flag on the user entity grants full API access within the organization. Non-admin users are restricted to self-service operations.
- **Spend is not a claim**: whether a caller may spend is the finance ledger's answer, computed by the one predicate in `hanzoai/cloud` (`spend.go`) — never a balance field read off a token IAM signed.

The key design principle: **IAM authenticates users and issues scoped tokens. Services authorize requests by validating token claims.** IAM does not make fine-grained authorization decisions for downstream services — it provides the identity and claims that services use to make their own authorization decisions.

## References

1. [Hanzo IAM](https://github.com/hanzoai/iam) - Open-source identity and access management platform
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
9. [HIP-27: KMS for Secrets Management](./hip-0027-secrets-management-standard.md) - Secret resolution at startup
10. [HIP-139: Capability](./hip-0139-capability.md) - The contract every capability HIP meets
11. [Hanzo IAM Repository](https://github.com/hanzoai/iam)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
