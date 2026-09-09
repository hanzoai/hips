---
hip: 0026
title: Identity & Access Management Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2025-01-15
requires: HIP-0027, HIP-0111, HIP-0138
---

# HIP-0026: Identity & Access Management Standard

## Abstract

Hanzo IAM is the identity and access management provider for the Hanzo
ecosystem and the **sole** authority for identity and tokens. Nothing else in
the estate issues a credential, validates one, or keeps a session: there is no
service token, no shared secret and no per-app auth stack. This HIP specifies
the **server**; HIP-0111 specifies the wire contract every client speaks to it,
and where the two touch, HIP-0111 is authoritative.

IAM is a clean-room native rewrite on the Hanzo stack — `zip` over
`hanzoai/orm`, with no Beego and no xorm. Storage is one `orm.DB` abstraction
with the backend chosen at boot (`--store`): embedded SQLite by default
(`hanzoai/sqlite`, pure-Go, WAL), or the shared `sql` or `datastore` over ZAP
(HIP-0138). Every handler is written once against `orm.DB` and never against a
driver.

It implements OAuth 2.0, OpenID Connect, and SCIM 2.0, and provides multi-tenant
authentication with per-organization white-label identity domains. Any
organization registered in IAM can be assigned a branded login page and identity
domain; the default deployment ships hanzo.id, lux.id, zoo.id, pars.id and
id.ad.nexus.

**Repository**: [github.com/hanzoai/iam](https://github.com/hanzoai/iam)
**Image**: `ghcr.io/hanzoai/iam`
**Retired**: the Beego/xorm fork this replaced is `hanzoai/iam-v1`, out of every
graph. A description of Beego, xorm, or a Postgres schema is a description of
that repository.

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

### Why one identity service, owned outright

A managed identity service prices per monthly active user and puts the most
sensitive part of the stack behind somebody else's export path: migrating
password hashes out is not a routine operation, and an air-gapped or sovereign
deployment cannot use a hosted provider at all. Those are the constraints, and
they are why identity is ours.

Owning it is not the same as forking it. The predecessor was a fork, and the
fork is what a clean-room rewrite replaced — `hanzoai/iam` owns its source
outright and collapses to one way of doing each thing. What that buys is the
ability to delete: the vendor error envelope, the verb aliases, the second
spelling of the token endpoint, and the second storage engine all go away
because nothing upstream requires them (HIP-0111 §4 lists what is gone and
§Conformance status records what is still live).

The cost is stated plainly: a rewrite carries no upstream community and no
inherited security review, so the surface is RFC-standard precisely so that
review can be done against the RFCs rather than against us.

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
3. Add the domain to the edge (an `IngressRoute` served by Hanzo Ingress, HIP-0068, or a DNS record)
4. Either add the domain to the `hanzo/id` middleware tenant map, or deploy a forked instance with `IAM_ORIGIN`, `NEXT_PUBLIC_ORG`, and `NEXT_PUBLIC_CLIENT_ID` environment variables

Hanzo Ingress (HIP-0068) routes every tenant domain to the same IAM process. IAM resolves the organization from the request's `Host` header via the `origin` configuration and the application's `organization` field. Organizations are fully isolated — different themes, different OAuth applications, different password policies, different MFA requirements — while sharing one IAM process and one database.

The `hanzo/id` login UI is designed to be forked for deep customization. Organizations can:
- Fork `hanzoai/id` to `luxfi/id`, `zoofdn/id`, etc. for fully custom branding
- Or use the same `hanzoai/id` image with per-tenant env vars for lightweight white-labeling
- Or add entries to the middleware tenant map for multi-domain deployment from a single image

The alternative (path-based multi-tenancy like `hanzo.id/lux/login`) is fragile. It leaks the organizational structure into URLs, makes CORS configuration harder, and prevents each org from having a clean, branded identity domain that users can trust.

### Why balances are NOT IAM's

An earlier revision of this HIP argued that the user's balance belongs on the
user record, so that "is this caller authenticated?" and "does this caller have
credit?" answer in one token validation. That is not what shipped, and the
argument does not survive contact with the money.

A balance is a position in a ledger. It is derived from transactions that
Commerce records, that a payment processor confirms, and that a metered usage
record debits — three systems with their own ordering, retries and reconciliation
(HIP-0018, HIP-1220, HIP-1313, HIP-1001). Putting the authoritative copy on the
identity record makes identity a participant in settlement: a failed debit
becomes an identity write, and a disagreement between the two copies is resolved
by whichever one a reader happened to ask.

**The balance fields IAM carries are read-only mirrors, and the code says so.**
The authoritative balance lives in Commerce. A service that gates on credit reads
the entitlement surface, not the identity record; a token is proof of who is
calling, never of what they can afford.

## Specification

### Architecture

```
                           Internet
                              │
                    ┌─────────┴─────────┐
                    │   Hanzo Ingress    │
                    │  (TLS termination) │
                    │   HIP-0068         │
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
                    │  zip over orm.DB   │
                    │  HTTP edge + ZAP   │
                    └─────────┬─────────┘
                              │  --store
                    ┌─────────┴─────────┐
                    │ sqlite (default)  │
                    │ sql | datastore   │
                    │     HIP-0138      │
                    └───────────────────┘
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

1. **Application lookup via `/v1/iam/get-app-login`**: The login UI (hosted at hanzo.id, served by the `hanzo.id-worker` Cloudflare Worker) calls this endpoint with the `clientId` from the OAuth authorize URL. IAM returns the application name and organization name. This is the source of truth.

2. **Direct login via `/v1/iam/login`**: The payload includes `application` and `organization` fields. These must match the application's configured organization. Hardcoding `organization: "hanzo"` for all requests breaks scoped SSO clients (e.g., KMS has its own client ID and expects the correct org context).

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

### The balance mirror

Every user and organization carries balance fields. They are a **cache with a
publisher**, not a ledger:

- Commerce owns the authoritative position and every balance-affecting event.
- IAM's copy exists so a surface that has already validated a token can render a
  number without a second round trip.
- A decision that costs money — admitting a request, starting a run, releasing a
  payout — MUST read the authoritative surface. Gating spend on a mirror gates it
  on a value that can be stale in the direction that costs us.

There is no `add-balance` and no `add-transaction` verb on IAM (HIP-0111 §4.8).
The ledger's shape is specified where the ledger is: HIP-1001 for double-entry,
HIP-1313 for the metered record, HIP-1220 for the merchant half.

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

**HIP-0111 §1 is the one table of endpoints.** It is not repeated here, because
two tables of one surface is how the second one goes stale — which is exactly
what happened: this section previously listed `get-account`, `get-user`,
`add-user`, `update-user`, `delete-user`, `add-balance`, `add-transaction` and
`get-transactions` as the user-management and billing surface, and every one of
those is a verb alias HIP-0111 §4.8 forbids. Identity provisioning is SCIM 2.0
(§8); account claims are OIDC UserInfo (§1); delegation is RFC 8693 token
exchange (§7); balances are Commerce's, not IAM's.

What this HIP states about the surface, as the server's own concern:

- The paths are `/v1/iam/*`. There is no `/oauth/*`, no `/api/login/*`, no
  `/api/` prefix anywhere, and no `v2` (HIP-0119).
- IAM serves a `200 text/html` SPA catch-all for any unregistered path, so a
  wrong path is silent breakage rather than a `404`. That is why clients reach
  the surface only through `@hanzo/iam`, which holds the paths in one place.
- The login entry point (`get-app-login`, `login`, `signup`,
  `send-verification-code`) is the authorization server's own concern — OAuth
  deliberately does not specify how an AS authenticates the end user — and is
  called by the hosted login UI alone. It is not a client integration surface.
  HIP-0111 §6 is normative for it.
- Health is at the root: `/healthz`, `/readyz`. Not `/api/health`.

The discovery document is host-relative and self-consistent — issuer, authorize,
token, userinfo and jwks share one origin, which requires `originFrontend` to be
empty:

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

A split-origin discovery document breaks strict OIDC clients that pin the issuer.

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

### Deployment

IAM runs on the `hanzo-k8s` cluster, one process per brand origin, behind Hanzo
Ingress (HIP-0068), which terminates TLS and routes every tenant domain to it.
The image is `ghcr.io/hanzoai/iam`, built by Hanzo Git Actions from
`.hanzo/workflows/` (HIP-0036); there is no second registry.

Health is at the root — `/healthz`, `/readyz` — never under a version prefix and
never under `/api/` (HIP-0119 §Health).

### Configuration

Configuration is flags with environment fallbacks; there is no `app.conf` and no
Beego `runmode`.

| flag | what it decides |
|---|---|
| `--store` | `sqlite` (default), `sql`, or `datastore` — see Storage below |
| `--db` | SQLite path, when the store is `sqlite` |
| `--zap` | the ZAP listener for service-to-service calls |
| `--http` | the external HTTP edge |
| `--init-data` | seed file, new entities only |

Deployment environment: `IAM_ISSUER` pins the issuer per brand (e.g.
`https://hanzo.id`) so every token and the discovery document advertise one
stable issuer regardless of request host, never steerable by `X-Forwarded-Host`.
The three capability allow-lists — `IAM_TOKEN_EXCHANGE_APPS`,
`IAM_ADMIN_TOKEN_EXCHANGE_APPS` and `IAM_KEY_MINT_ALLOWED_APPS` — are specified
in HIP-0111 §7, which is the one description of them.

The seed file expands `${VAR}` from the environment and creates only what is
missing. It never deletes or overwrites an existing user, application or org, so
a restart cannot reset a password, an MFA enrolment or any other user data.

### Storage

One `orm.DB` abstraction, backend chosen at boot, per HIP-0138:

- `sqlite` (default) — embedded, pure-Go, WAL. No server, no credential.
- `sql` — the one shared `hanzoai/sql`, reached over ZAP.
- `datastore` — `hanzoai/datastore` over ZAP, with snapshots, at no code change.

There is no `hanzo_iam` database, no per-app Postgres instance, no Redis, and no
MySQL path. Sessions are IAM's own state in that store, not a second engine: an
external cache for sessions was a property of the retired fork.

The entities are `organization`, `user`, `application`, `token`, `session`,
`cert`, `provider`, `permission` and `role`. Balance fields on an organization
are **read-only mirrors**; the authoritative balance lives in Commerce
(HIP-0018, HIP-1220) and the metered record in HIP-1313. IAM is not a billing
engine and is not the source of truth for spend.

### Secrets

Client secrets and signing material are KMS references, never values, and never
plaintext in Git, a manifest, the seed file or an image. The path is derivable
from the app that reads the secret and the variable it becomes — HIP-0136 is the
one statement of that convention, and it also records why `base` keeps its own
KMS project rather than being folded into the shared one.

Passwords are hashed, never stored or transmitted in the clear. Verification is
algorithm-resolved from the stored row (argon2id and bcrypt), verify-only and
fail-closed: an unrecognised algorithm is a refusal, not a fallback.

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
| RFC 7519 (JWT) | Full | RS256 today; ML-DSA-65 hybrid JWT and JWKS from the Cert entity is the direction (HIP-0005) |
| RFC 7662 / RFC 7009 | Full | Introspection and revocation |
| RFC 8414 | Full | Authorization server metadata |
| RFC 8693 (Token Exchange) | Full | Delegation, gated per HIP-0111 §7 |
| RFC 8707 (Resource Indicators) | Full | `resource`/`audience` pins `aud`; validators fail closed |
| RFC 7644 / RFC 7643 (SCIM 2.0) | Full | Identity provisioning |

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
- **Sessions are IAM's own state**, held in its `orm.DB` store with a TTL and registered for revocation. There is no external session cache: a second engine for sessions was a property of the retired fork, and it made "log everyone out" an operation on infrastructure rather than on the identity service.

### Network Security

- **TLS everywhere**: Hanzo Ingress (HIP-0068) terminates TLS. HTTP is redirected to HTTPS. IAM rejects plaintext.
- **CORS whitelist**: The `origin` and `originFrontend` settings restrict which origins can interact with IAM APIs. Cross-origin requests from unknown origins are rejected.
- **Rate limiting**: Per-IP rate limiting on login endpoints prevents brute-force attacks. Failed login attempts increment a counter; after 5 failures, the IP is throttled for 15 minutes.
- **Health endpoint isolation**: `/healthz` is unauthenticated (load-balancer probes require it) and returns only a boolean status, leaking no internal state. It is at the root, not under `/api/` and not under a version prefix (HIP-0119).

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
- Session management (30-minute idle timeout, in IAM's own store)

**Authorization (AuthZ)** — "What can you do?"
- **OAuth scopes**: Applications request scopes (openid, profile, email, custom). IAM validates requested scopes against the application's allowed scope set and returns `invalid_scope` per RFC 6749 §4.1.2.1 if the client requests scopes not configured for its application.
- **RBAC roles and permissions**: IAM supports role-based access control. Roles are collections of permissions; users are assigned roles per-organization. The `permission` and `role` tables enforce this.
- **Organization isolation**: Users can be members of multiple organizations (hanzo, lux, zoo, pars, adnexus) but each session is scoped to one organization context. Cross-org access requires switching context.
- **Application-level isolation**: Each OAuth application has its own client credentials, redirect URIs, grant types, and scopes. A token issued for `app-console` cannot be used at `app-commerce` (different `aud` claim).
- **Admin vs normal user**: The `isAdmin` flag on the user entity grants full API access within the organization. Non-admin users are restricted to self-service operations.
- **Balance-gated access**: Services can check `balance > 0` from the JWT claims or userinfo endpoint to gate access to paid features (AI inference, compute).

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
12. [HIP-0111: Hanzo IAM Authentication Standard](./hip-0111-iam-authentication-standard.md) - the wire contract, authoritative where it touches this HIP
13. [HIP-0118: SuperAdmin & Tenant Isolation Model](./hip-0118-superadmin-and-tenant-isolation-model.md) - the reserved `admin` org and the one SuperAdmin predicate
14. [HIP-0519: One Identity Boundary](./hip-0519-one-identity-boundary.md) - where the token is validated and `X-Org-Id` is minted
15. [HIP-0068: Ingress Standard](./hip-0068-ingress-standard.md) - the edge that terminates TLS and routes every brand domain
16. [HIP-0138: Where State Lives](./hip-0138-where-state-lives.md) - the store this service is a tenant of
17. [HIP-0136: One Secret, One Path](./hip-0136-one-secret-one-path.md) - where a client secret is addressed
18. [HIP-0027: Secrets Management Standard](./hip-0027-secrets-management-standard.md) - the KMS this reads from
19. [HIP-0004: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md) - consumes IAM tokens
20. [HIP-0018: Payment Processing Standard](./hip-0018-payment-processing-standard.md) - Commerce, which owns the authoritative balance
21. [HIP-0025: Bot Agent Wallet & RPC Billing Protocol](./hip-0025-bot-agent-wallet-rpc-billing-protocol.md) - agent identity, built on IAM

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
