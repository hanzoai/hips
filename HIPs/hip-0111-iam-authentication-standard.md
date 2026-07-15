---
hip: 0111
title: Hanzo IAM Authentication Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Active
created: 2026-06-16
updated: 2026-07-15
requires: HIP-0026, HIP-0044, HIP-0068
---

# HIP-111: Hanzo IAM Authentication Standard

## Abstract

This is the one and only way an application authenticates a user, provisions an identity, or validates a token against Hanzo IAM. It defines the canonical IETF/RFC endpoint surface, the single approved client library (`@hanzo/iam`), the integration pattern for every supported framework, the application-registration rules, and the anti-patterns that are forbidden.

**RFC-standard only — no vendor compat.** Every wire contract on this surface is an IETF RFC or OpenID Connect standard. There are NO Casdoor verb aliases (`get-users`, `add-user`, `get-account`, `issue-user-token`, …), no bespoke "verb" REST, and no backward-compat shims, on iam or on any client. Where a capability has a standard, the standard IS the surface: identity provisioning is **SCIM 2.0** (RFC 7644/7643), delegated/on-behalf-of tokens are **OAuth 2.0 Token Exchange** (RFC 8693), account claims are **OIDC UserInfo**, token validation is **Introspection** (RFC 7662) + JWKS (RFC 7517). A client that needs a capability uses its RFC; if no RFC covers it, it is the authorization server's internal concern (§6), never a new public "verb".

HIP-0026 specifies the IAM **server** — the provider itself (the clean-room `hanzoai/iam2` implementation). This HIP specifies the **wire contract** — how everything talks to it. Where the two touch (endpoint paths, discovery), this HIP is authoritative and HIP-0026 follows it.

Hanzo IAM (`hanzoai/iam2`) is a clean-room, standards-based OAuth 2.0 + OpenID Connect + SCIM 2.0 provider — original expression, no upstream fork — deployed once per brand:

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

| Purpose | Path | RFC / spec |
|---------|------|------------|
| OIDC discovery | `/.well-known/openid-configuration` | OIDC Discovery 1.0 |
| AS metadata | `/.well-known/oauth-authorization-server` | RFC 8414 |
| Authorize | `/v1/iam/oauth/authorize` | RFC 6749 §3.1 |
| Token | `/v1/iam/oauth/token` | RFC 6749 §3.2 |
| UserInfo | `/v1/iam/oauth/userinfo` | OIDC Core §5.3 |
| Introspection | `/v1/iam/oauth/introspect` | RFC 7662 |
| Revocation | `/v1/iam/oauth/revoke` | RFC 7009 |
| JWKS | `/v1/iam/.well-known/jwks` — also served at `/.well-known/jwks` | RFC 7517, RFC 8414 §3 |
| Logout | `/v1/iam/oauth/logout` | OIDC RP-Initiated Logout |
| Provisioning (SCIM) | `/v1/iam/scim/v2/{Users,Groups,…}` | RFC 7644/7643 (§8) |

The **token endpoint** (`/v1/iam/oauth/token`) dispatches ONLY standard `grant_type`s — `authorization_code` (RFC 6749 §4.1, always PKCE-bound), `refresh_token` (§6, rotating), `client_credentials` (§4.4), `password` (§4.3, confidential first-party only), and `urn:ietf:params:oauth:grant-type:token-exchange` (RFC 8693, §7 — delegation / on-behalf-of). There is exactly one token endpoint and one spelling of it; the legacy `access_token` alias is **gone** (a client posts to `token`, never `access_token`).

**`jwks_uri` comes from discovery — never hard-code it.** The key set is served at the `/v1/iam/`-prefixed path AND at the root well-known path, because RFC 8414 §3 puts the well-known URI at the issuer origin and a bare-origin verifier (the gateway's default, HIP-0044) looks there. Both spellings are one handler over one key set; discovery's `jwks_uri` is authoritative and a verifier MUST take the URI from the discovery document it already fetched. An IAM that serves only one of the two silently breaks every verifier defaulting to the other — token validation fails closed and reads as an outage.

Mandatory parameters, everywhere:

- **PKCE `S256`** on every authorization request. `plain` is not permitted. Public clients (SPAs, native) require it; confidential clients use it too.
- **`client_secret_basic`** for confidential clients. HTTP Basic, not body params.
- **Scopes** `openid profile email` (+ `offline_access` for a refresh token).
- **`resource` / `audience`** (RFC 8707) name the resource server a token is minted for; the AS stamps `aud` accordingly and validators fail closed on a mismatch.
- **`iss`** is pinned per deployment (`IAM_ISSUER`, e.g. `https://hanzo.id`) so every token and the discovery document advertise ONE stable issuer regardless of request host — never steerable by `X-Forwarded-Host`.

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
8. **Casdoor "verb" aliases / bespoke REST for a standardized capability** — `get-users`, `get-user?id=`, `add-user`, `update-user`, `delete-user`, `get-organizations`, `get-records`, `issue-user-token`, `get-account`, `mint-user-keys`, and every other Casdoor-shaped verb are **gone**, on iam and on every client. Each has an RFC that IS the surface: identity provisioning → **SCIM 2.0** (§8), delegated/on-behalf-of tokens → **Token Exchange** (§7), account claims → **UserInfo** (§1). A client that reaches for a verb is reaching for the wrong contract; there is no compat layer that will answer it.
9. **A duplicate spelling of a standard endpoint** — one `token` endpoint, not `token` + `access_token`; one `userinfo`, not `userinfo` + `get-account`. An alias is two ways to do one thing; the standard path is the only one served.

### 5. Gotchas (call out explicitly)

- **SPA catch-all** — IAM returns a `200 text/html` page for ANY unregistered path. A wrong path is not a `404`; it is silent breakage. Clients MUST hit the exact `/v1/iam/*` paths. This is why the SDK centralizes paths and degrades discovery to hard-coded canonical values.
- **Discovery self-consistency** — issuer/authorize/token/userinfo/jwks share one origin (host-relative). Keep `originFrontend` empty in `app.prod.conf`.
- **`owner` is the tenant** — the org slug. IAM emits **`owner`** (and the standard-name alias **`organization`**) in BOTH the OIDC userinfo response AND the JWT, in every token format, scope-independent — so a consumer reading either claim off either surface gets the tenant. Scope every data query to it. The gateway (HIP-0044) propagates it as `X-Org-Id`; backends behind the gateway trust that header and do not re-parse the JWT. A consumer that reads org from a non-standard field (e.g. a legacy `groups` claim) and finds nothing MUST fail closed, never silently fall back to a `"default"`/`"personal"` org — that is a tenant-isolation defect.

### 6. The login front-door — the AS's own concern, not a client surface

OAuth 2.0 / OIDC deliberately do **not** specify how the authorization server authenticates the end user (the credential-entry step). That is the AS's internal concern. So the hosted login page (the per-brand portal at `hanzo.id`/`lux.id`/… and its Worker) has a small first-party API it — and ONLY it — calls, under the canonical `/v1/iam/*` prefix:

| Purpose | Path |
|---------|------|
| App/org resolution before login | `/v1/iam/get-app-login` |
| Password login (mints the code) | `/v1/iam/login` |
| Signup | `/v1/iam/signup` |
| Verification code | `/v1/iam/send-verification-code` |
| Logout | `/v1/iam/oauth/logout` (§1) |

This is NOT a client integration surface and NOT a set of "verbs" a client may call — it is the AS's own login UI talking to the AS. **Account claims are NOT here**: there is no `get-account` and no second `userinfo` — every consumer (including the gateway admin-guard, HIP-0044) reads the standard **OIDC UserInfo** (`/v1/iam/oauth/userinfo`, §1), which carries `sub`, `owner`/`organization`, `email`, `email_verified`, and the `isAdmin` claim the SuperAdmin predicate derives from. One account contract, and it is the RFC one.

Same rule as §1: `/v1/iam/*` only — no `/api/`, anywhere, including the front-door Worker. **Client apps use only the standard surface (§1) through the SDK**; the login API is internal to the AS.

### 7. Delegation / on-behalf-of — OAuth 2.0 Token Exchange (RFC 8693)

A trusted first-party backend that must call a downstream API **as** an end user (the console BFF forwarding a request on the signed-in user's behalf, the keyless AI proxy) obtains that token through **RFC 8693 Token Exchange** on the token endpoint — never a bespoke `issue-user-token` verb.

- `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, `client_secret_basic` (confidential clients only, capability-gated by `IAM_KEY_MINT_ALLOWED_APPS`), `subject_token` naming the target user (or a `requested_subject`), `requested_token_type=urn:ietf:params:oauth:token-type:access_token`, and `resource`/`audience` (RFC 8707) pinning the downstream resource server.
- The issued token carries the **target user's** subject + `owner` (so a resource server that scopes on the validated `owner` claim scopes to the user's tenant), an `act` claim recording the acting client, and the requested `aud`. It is signed by the same trusted key the JWKS publishes — indistinguishable from a token the user obtained directly, which is the point.
- Acting on behalf of a **reserved-org (`admin`/`built-in`)** subject requires the separate `IAM_ADMIN_MINT_ALLOWED_APPS` capability (defense in depth: a leaked general-exchange credential can never reach a SuperAdmin identity). Every exchange is audit-logged.

### 8. Identity provisioning — SCIM 2.0 (RFC 7644 / RFC 7643)

Creating, reading, updating, and deleting identities is **SCIM 2.0** — the IETF standard for cross-domain identity management — under `/v1/iam/scim/v2/`. There are NO `get-users`/`add-user`/`get-organizations` verbs.

| Resource | Path | Maps to |
|----------|------|---------|
| Service provider config | `/v1/iam/scim/v2/ServiceProviderConfig` | supported features |
| Schemas / resource types | `/v1/iam/scim/v2/{Schemas,ResourceTypes}` | discovery |
| Users | `/v1/iam/scim/v2/Users` (+ `/{id}`) | the user entity |
| Groups | `/v1/iam/scim/v2/Groups` (+ `/{id}`) | organizations, roles |

- Standard verbs are HTTP: `GET` (list with `filter`/`startIndex`/`count`, or by id), `POST` (create), `PUT`/`PATCH` (RFC 7644 §3.5.2 patch ops), `DELETE`. Lists return the SCIM `ListResponse` envelope (`totalResults`/`Resources`), not a Casdoor `{status,data,data2}` one.
- A User is the SCIM core schema (`urn:ietf:params:scim:schemas:core:2.0:User`) plus a Hanzo enterprise extension for `owner`/`isAdmin`/credential metadata. Passwords are write-only (`password` attribute in), never returned. Secrets never cross a SCIM response (the AS masks on read).
- Tenant scope: a non-super caller's SCIM view is pinned to its own `owner`; a SuperAdmin may `filter` across tenants. Same authorization model as every other surface — bearer-authenticated, owner-scoped, fail-closed.
- Clients provision through the SDK's SCIM client (or any conformant SCIM library); no client writes SCIM URLs by hand, same as §2/§3.

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

### Server-side invariants

These bind the IAM itself, not its clients. Each is stated because an implementation violated it and the violation was a total-account-takeover path.

- **Signing keys never cross the API.** A signing key lives in the store and signs in process. No endpoint — not for a SuperAdmin, not on any entity read — serves `privateKey` or an equivalent secret. Relying parties consume the **public** half from the JWKS (RFC 7517 publishes `n`/`e`, `x`/`y`, never `d`). An entity that holds secret material is masked at exactly one place on its way out; a key that reaches a caller forges every token the IAM issues.
- **Authorize the value you execute.** The value an operation is authorized against MUST be the value the handler binds. Deriving authorization from a *second, independent* parse of the request (a re-parsed body, an envelope, a query string) is a bypass the moment the two can disagree: authorize `orgA`, execute `admin`. Authorize the decoded input, once, at one seam — for every transport that reaches the handler.
- **A read's tenant comes from the bearer, never from a parameter.** An owner-scoped listing resolves its owner from the verified principal. A request parameter may only *narrow* within that authority (and widen for a SuperAdmin, the one cross-tenant scope); an absent or unrecognized owner MUST fail closed and never fall back to listing every tenant.
- **Reserved owners are the trust boundary.** A token-signing cert is trusted, and published in the JWKS, only under the reserved platform orgs (`admin`, `built-in`) — so a tenant cannot shadow a platform key by creating a cert whose name collides with a `kid`. Writes to those certs are SuperAdmin-only (HIP-0026's `owner == "admin"` predicate). The trusted set and the writable set are one list, in one place.

## References

1. [HIP-0026: Identity & Access Management Standard](./hip-0026-identity-access-management-standard.md) — the IAM server
2. [HIP-0044: Hanzo Gateway Standard](./hip-0044-api-gateway-standard.md) — JWT validation + `X-Org-Id` propagation at the gateway
3. [HIP-0068: Ingress Standard](./hip-0068-ingress-standard.md) — edge TLS and routing
4. [HIP-0027: Secrets Management Standard](./hip-0027-secrets-management-standard.md) — KMS-managed client secrets
5. [HIP-0112: Cloud Infrastructure Topology Standard](./hip-0112-cloud-infrastructure-topology-standard.md) — how IAM fits the estate
6. [`@hanzo/iam`](https://github.com/hanzo-js/iam) — the SDK; `src/paths.ts` is the canonical path source
7. Standards this surface implements (the wire contract, in full):
   - [RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749) OAuth 2.0 — authorize, token (authorization_code / refresh_token / client_credentials / password grants)
   - [RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636) PKCE `S256`
   - [RFC 7517](https://datatracker.ietf.org/doc/html/rfc7517) JWK / JWKS
   - [RFC 7662](https://datatracker.ietf.org/doc/html/rfc7662) Token Introspection
   - [RFC 7009](https://datatracker.ietf.org/doc/html/rfc7009) Token Revocation
   - [RFC 8414](https://datatracker.ietf.org/doc/html/rfc8414) Authorization Server Metadata
   - [RFC 8693](https://datatracker.ietf.org/doc/html/rfc8693) OAuth 2.0 Token Exchange — delegation / on-behalf-of (replaces `issue-user-token`)
   - [RFC 8707](https://datatracker.ietf.org/doc/html/rfc8707) Resource Indicators (`resource`/`audience`)
   - [RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628) Device Authorization Grant (optional, for input-constrained clients)
   - [RFC 7644](https://datatracker.ietf.org/doc/html/rfc7644) SCIM 2.0 Protocol + [RFC 7643](https://datatracker.ietf.org/doc/html/rfc7643) SCIM Core Schema — identity provisioning (replaces the `get-users`/`add-user` verbs)
   - [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html) + [Discovery 1.0](https://openid.net/specs/openid-connect-discovery-1_0.html) — id_token, UserInfo, discovery, RP-initiated logout

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
