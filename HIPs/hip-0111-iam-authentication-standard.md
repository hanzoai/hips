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
6. **Per-app social OAuth clients** — an app registering its own Google/GitHub (or Web3) OAuth client. Social providers are configured ONCE per network, org-level, and shared (§7). A per-app client re-creates the shared one N times and drifts.
7. **`/api/` on the front-door too** — the IAM's own login UI / portal Worker uses the native login API under `/v1/iam/*` (§6), never `/api/login`, `/api/get-app-login`, `/api/signup`. The "no `/api/`" rule is absolute, including the front-door.

### 5. Gotchas (call out explicitly)

- **SPA catch-all** — IAM returns a `200 text/html` page for ANY unregistered path. A wrong path is not a `404`; it is silent breakage. Clients MUST hit the exact `/v1/iam/*` paths. This is why the SDK centralizes paths and degrades discovery to hard-coded canonical values.
- **Discovery self-consistency** — issuer/authorize/token/userinfo/jwks share one origin (host-relative). Keep `originFrontend` empty in `app.prod.conf`.
- **`owner` is the tenant** — the org slug. IAM emits **`owner`** (and the standard-name alias **`organization`**) in BOTH the OIDC userinfo response AND the JWT, in every token format, scope-independent — so a consumer reading either claim off either surface gets the tenant. Scope every data query to it. The gateway (HIP-0044) propagates it as `X-Org-Id`; backends behind the gateway trust that header and do not re-parse the JWT. A consumer that reads org from a non-standard field (e.g. Casdoor `groups`) and finds nothing MUST fail closed, never silently fall back to a `"default"`/`"personal"` org — that is a tenant-isolation defect.

### 6. The login front-door surface

The OIDC endpoints (§1) are how **client applications** authenticate. The IAM *also* serves a native login API under the same canonical `/v1/iam/*` prefix — used **only** by the IAM's own login UI (the per-brand portal at `hanzo.id`/`lux.id`/… and its Cloudflare Worker), never by client apps:

| Purpose | Path |
|---------|------|
| App/org resolution before login | `/v1/iam/get-app-login` |
| Password login | `/v1/iam/login` |
| Signup | `/v1/iam/signup` |
| Verification code | `/v1/iam/send-verification-code` |
| Account | `/v1/iam/get-account` |
| Native userinfo | `/v1/iam/userinfo` |
| Logout | `/v1/iam/logout` |

Same rule as §1: `/v1/iam/*` only — no `/api/`, anywhere, including the front-door Worker. The separation is strict: **client apps use only the OIDC surface (§1) through the SDK**; the native login API is the IAM's internal front-end contract, not a client integration point.

### 7. Social & Web3 — one shared provider, never per-app

Google, GitHub, and Web3 are configured **once per network** as org-level providers in IAM (`admin/provider-google`, `admin/provider-github`, …). Every app reuses them via a per-app `canSignIn` toggle — an application **never** registers its own social OAuth client (§4.6).

- The shared social OAuth client's redirect URI is **IAM's own callback** (`https://iam.<brand>/callback`); the provider hop happens inside IAM, not in the app. The app only ever sets *its own* `redirect_uri` (its `/auth/callback`).
- An app selects a method with one knob: `startLogin({ provider })` adds `&provider=<name>` to `/v1/iam/oauth/authorize`. Omit `provider` for the IAM login page (password + whatever it offers). **One flow; the provider is a parameter, not a separate code path** — adding a provider is a config entry plus a button, and every app inherits it.
- Login buttons are presentation, wired through `@hanzo/ui` `<SignIn providers={…}>` to the SDK. A surface that lacks a working button has it *disabled in config* — it is never *deleted from code*, because the shared provider is always available.

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
