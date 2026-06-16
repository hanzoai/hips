---
hip: 0111
title: Hanzo IAM Authentication Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Active
created: 2026-06-16
requires: HIP-0026, HIP-0044, HIP-0068
---

# HIP-111: Hanzo IAM Authentication Standard

## Abstract

This is the one and only way an application authenticates a user or validates a token against Hanzo IAM. It defines the canonical OIDC endpoint paths, the single approved client library (`@hanzo/iam`), the integration pattern for every supported framework, the application-registration rules, and the anti-patterns that are forbidden.

HIP-0026 specifies the IAM **server** — the provider itself. This HIP specifies the **client contract** — how everything else talks to it. Where the two touch (endpoint paths, discovery), this HIP is authoritative and HIP-0026 follows it.

Hanzo IAM is a Casdoor-derived, standards-compliant OIDC provider deployed once per brand:

| Brand | IAM origin (`serverUrl`) | Login UI |
|-------|--------------------------|----------|
| Hanzo | `https://iam.hanzo.ai` | `hanzo.id` |
| Lux | `https://lux.id` | `lux.id` |
| Zoo | `https://zoo.id` | `zoo.id` |
| Bootnode | `https://id.bootno.de` | `id.bootno.de` |
| Pars | `https://pars.id` | `pars.id` |

The library is brand-agnostic. You select the brand by setting `serverUrl`; nothing else changes.

**SDK**: [`@hanzo/iam`](https://github.com/hanzo-js/iam) (npm, v0.11.0+)
**Source of truth for paths**: `@hanzo/iam` → `src/paths.ts` → `OIDC_PATHS`

## Motivation

Every authentication regression in the estate has had one of three root causes:

1. **Path drift** — a client invented its own OIDC path (`/oauth/authorize`, `/api/login/oauth/access_token`, `/api/...`). IAM serves a **200 `text/html` SPA catch-all for any unregistered path**, so a wrong path returns an HTML body with a `200`, not a `404`. The OAuth library then dies on `content-type must be application/json` and the failure looks like a server bug. It is not; it is a client hitting the wrong URL.

2. **Discovery drift** — a client used raw `better-auth` `genericOAuth({ discoveryUrl })`. Discovery resolution landed on the SPA catch-all HTML and the client wired itself to garbage endpoints.

3. **Hand-rolled OAuth** — a team reimplemented PKCE, token exchange, or JWKS validation and got the audience check, the `S256` challenge, or the refresh rotation subtly wrong.

All three vanish if there is exactly one library that owns exactly one set of paths, and every application uses it. That is this standard.

## Specification

### 1. The canonical OIDC endpoints

These are the **only** paths. There is no `/oauth/*`, no `/api/login/*`, no `/api/` prefix. They are relative to the brand `serverUrl`.

| Purpose | Path | RFC |
|---------|------|-----|
| Discovery | `/.well-known/openid-configuration` | OIDC Discovery 1.0 |
| Authorize | `/v1/iam/oauth/authorize` | RFC 6749 §3.1 |
| Token | `/v1/iam/oauth/token` | RFC 6749 §3.2 |
| UserInfo | `/v1/iam/oauth/userinfo` | OIDC Core §5.3 |
| JWKS | `/v1/iam/.well-known/jwks` | RFC 7517 |
| Logout | `/v1/iam/oauth/logout` | OIDC RP-Initiated Logout |

Mandatory parameters, everywhere:

- **PKCE `S256`** on every authorization request. `plain` is not permitted. Public clients (SPAs, native) require it; confidential clients use it too.
- **`client_secret_basic`** for confidential clients (server-side token exchange). HTTP Basic, not body params.
- **Scopes** `openid profile email`.

The discovery document MUST be self-consistent: `issuer`, `authorization_endpoint`, `token_endpoint`, `userinfo_endpoint`, and `jwks_uri` all share one origin (host-relative to the brand). The IAM knob that controls this is `originFrontend` in `app.prod.conf` — it MUST be empty so discovery is host-relative. A split-origin discovery document breaks strict OIDC clients (`openid-client`, NextAuth) that pin the issuer.

### 2. The only integration: `@hanzo/iam`

JavaScript and TypeScript applications integrate **only** through `@hanzo/iam`. No application writes an OIDC path string. No application calls these endpoints by hand. The SDK holds the paths in one place (`OIDC_PATHS`) and every entry point reads from it; a failed discovery round-trip degrades to these same hard-coded values, so a client can never resolve to the SPA catch-all.

The SDK is split into per-environment entry points. Import the one that matches your runtime:

| Subpath | Surface | Use |
|---------|---------|-----|
| `@hanzo/iam` | `IamClient`, types | conditional Node/browser entry |
| `@hanzo/iam/server` | `validateToken`, `getServerSession` | server-side JWT validation + session |
| `@hanzo/iam/betterauth` | `iamProvider` | better-auth apps |
| `@hanzo/iam/nextauth` | `IamProvider` | NextAuth / Auth.js apps |
| `@hanzo/iam/react` | hooks, `OrgProjectSwitcher` | React SPAs |
| `@hanzo/iam/browser` | `IAM` (PKCE client) | browser PKCE login |
| `@hanzo/iam/passport` | `createIamPassportStrategy` | Node/Express + Passport |

#### Server-side token validation (any backend)

```ts
import { validateToken } from "@hanzo/iam/server";

const result = await validateToken(accessToken, {
  serverUrl: process.env.IAM_ENDPOINT!, // e.g. https://iam.hanzo.ai
  clientId: process.env.IAM_CLIENT_ID!,
});

if (!result.ok) return unauthorized(result.reason);
const { userId, email, owner } = result; // owner = org slug → scope every query to it
```

`validateToken` discovers JWKS from `/.well-known/openid-configuration`, caches the key set per issuer, and verifies signature, `iss`, `aud`, and `exp`. Scope all multi-tenant data access to `owner`.

#### Server session (App Router / RSC)

```ts
import { getServerSession } from "@hanzo/iam/server";

const session = await getServerSession({ serverUrl: process.env.IAM_ENDPOINT! });
if (!session) redirect("/login");
```

#### better-auth

```ts
import { betterAuth } from "better-auth";
import { genericOAuth } from "better-auth/plugins";
import { iamProvider } from "@hanzo/iam/betterauth";

export const auth = betterAuth({
  plugins: [
    genericOAuth({
      config: [
        iamProvider({
          serverUrl: process.env.IAM_ENDPOINT!,
          clientId: process.env.IAM_CLIENT_ID!,
          clientSecret: process.env.IAM_CLIENT_SECRET!,
        }),
      ],
    }),
  ],
});
```

`iamProvider()` returns a config with **explicit** `authorization`, `token`, and `userinfo` endpoints (the canonical `/v1/iam/oauth/*` paths) — it never relies on discovery resolution. The registered redirect URI for this provider is `https://<app-host>/api/auth/oauth2/callback/hanzo`.

#### NextAuth / Auth.js

```ts
import { IamProvider } from "@hanzo/iam/nextauth";

export default NextAuth({
  providers: [
    IamProvider({
      serverUrl: process.env.IAM_ENDPOINT!,
      clientId: process.env.IAM_CLIENT_ID!,
      clientSecret: process.env.IAM_CLIENT_SECRET!,
      checks: ["state", "pkce"],
    }),
  ],
});
```

#### React SPA (PKCE)

```ts
import { IAM } from "@hanzo/iam/browser";

const iam = new IAM({
  serverUrl: "https://iam.hanzo.ai",
  clientId: "hanzo-myspa",
  redirectUri: `${location.origin}/auth/callback`,
});

await iam.signinRedirect();              // start
const token = await iam.handleCallback(); // on /auth/callback
const access = await iam.getValidAccessToken(); // auto-refresh
```

```tsx
import { IamProvider, useIam } from "@hanzo/iam/react";

<IamProvider serverUrl="https://iam.hanzo.ai" clientId="hanzo-myspa">
  <App />
</IamProvider>;
```

The browser client uses PKCE `S256`, holds tokens in memory, and refreshes silently. Never persist access tokens in `localStorage`.

#### Node / Express + Passport

```ts
import passport from "passport";
import { createIamPassportStrategy } from "@hanzo/iam/passport";

passport.use("iam", createIamPassportStrategy({
  serverUrl: "https://iam.hanzo.ai",
  clientId: "hanzo-myservice",
  clientSecret: process.env.IAM_CLIENT_SECRET!,
  callbackUrl: "https://myservice.hanzo.ai/v1/sso/oidc/callback",
}));
```

### 3. Application registration

Every application is registered once per brand in IAM before it can authenticate.

- **`client_id` naming**: `<org>-<app>` (e.g. `hanzo-console`, `lux-wallet`, `zoo-research`). One ID per app per brand.
- **`redirectUris`**: MUST contain the **exact** callback the SDK/framework uses. There is no wildcard. Per framework:

| Framework | Registered redirect URI |
|-----------|-------------------------|
| better-auth (`genericOAuth` + `iamProvider`) | `https://<app-host>/api/auth/oauth2/callback/hanzo` |
| NextAuth / Auth.js | `https://<app-host>/api/auth/callback/iam` |
| React SPA (`@hanzo/iam/browser`) | `https://<app-host>/auth/callback` |
| Passport | `https://<app-host>/v1/sso/oidc/callback` |

- **Grant**: Authorization Code + PKCE. Implicit grant is not used.
- **Client secret**: KMS-managed (HIP-0027). Never in Git, init data, env files, or images.
- **Superuser convention**: `z@<domain>` / `Ilove<App>2026!!` (e.g. `z@hanzo.ai`). No built-in admin — the seeded superuser is the only privileged account.

### 4. Forbidden anti-patterns

These break in production and are not permitted under any circumstance:

1. **Raw `better-auth` `genericOAuth({ discoveryUrl })`** — discovery resolves to the SPA catch-all HTML and the client dies with `content-type must be application/json`. Use `iamProvider()`, which pins explicit endpoints.
2. **Hand-rolled OAuth / PKCE / JWKS** — use the SDK. Reimplementation gets `aud`, `S256`, or refresh rotation wrong.
3. **Any per-app OIDC path string** — no application writes `/v1/iam/oauth/...` (or, worse, `/oauth/...`) itself. The path lives in `OIDC_PATHS` inside the SDK; applications pass only `serverUrl`.
4. **Legacy paths** — `/oauth/*`, `/api/login/oauth/*`, anything `/api/`-prefixed. Gone. No backward compatibility.
5. **Non-empty `originFrontend`** in production — produces a split-origin discovery document that breaks strict clients.

### 5. Gotchas (call out explicitly)

- **SPA catch-all** — IAM returns a `200 text/html` page for ANY unregistered path. A wrong path is not a `404`; it is silent breakage. Clients MUST hit the exact `/v1/iam/*` paths. This is why the SDK centralizes paths and degrades discovery to hard-coded canonical values.
- **Discovery self-consistency** — issuer/authorize/token/userinfo/jwks share one origin (host-relative). Keep `originFrontend` empty in `app.prod.conf`.
- **`owner` is the tenant** — the JWT `owner` claim is the org slug. Scope every data query to it. The gateway (HIP-0044) propagates it as `X-Org-Id`; backends behind the gateway trust that header and do not re-parse the JWT.

## Security Considerations

- **PKCE `S256` mandatory** for all flows. Authorization-code interception is the most common OAuth attack; PKCE eliminates it.
- **Signature + claim validation** — `validateToken` verifies the JWKS signature and `iss`/`aud`/`exp`. Never accept a token without these checks.
- **Token storage** — in-memory or httpOnly cookies. Never `localStorage`.
- **Confidential-client secrets** — KMS only (HIP-0027). `client_secret_basic` over TLS.
- **Refresh rotation** — handled by the SDK; refresh tokens rotate on use and the previous token is invalidated.
- **TLS everywhere** — IAM rejects plaintext. The gateway and ingress (HIP-0044, HIP-0068) terminate and re-encrypt.

## References

1. [HIP-0026: Identity & Access Management Standard](./hip-0026-identity-access-management-standard.md) — the IAM server
2. [HIP-0044: Hanzo Gateway Standard](./hip-0044-api-gateway-standard.md) — JWT validation + `X-Org-Id` propagation at the gateway
3. [HIP-0068: Ingress Standard](./hip-0068-ingress-standard.md) — edge TLS and routing
4. [HIP-0027: Secrets Management Standard](./hip-0027-secrets-management-standard.md) — KMS-managed client secrets
5. [HIP-0112: Cloud Infrastructure Topology Standard](./hip-0112-cloud-infrastructure-topology-standard.md) — how IAM fits the estate
6. [`@hanzo/iam`](https://github.com/hanzo-js/iam) — the SDK; `src/paths.ts` is the canonical path source
7. [RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749), [RFC 7636 (PKCE)](https://datatracker.ietf.org/doc/html/rfc7636), [RFC 7517 (JWK)](https://datatracker.ietf.org/doc/html/rfc7517), [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
