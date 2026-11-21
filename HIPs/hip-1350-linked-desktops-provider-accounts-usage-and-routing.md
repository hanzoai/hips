---
hip: 1350
title: Linked Desktops — Provider Accounts, Usage and Routing for Hanzo Dev
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: desktop
status: Draft
implementation-go: partial
created: 2026-11-20
requires: HIP-0026, HIP-0106, HIP-0114, HIP-1330
---

# HIP-1350: Linked Desktops

## Abstract

A developer installs the Hanzo Dev desktop app, links their other AI accounts there,
and links the desktop to their Hanzo account through Hanzo IAM. Hanzo cloud then
knows each linked desktop, what providers it can reach, and what it used. When the
developer codes at hanzo.app/dev they pick where a session runs: a linked desktop, a
cloud cell with an API key held in Hanzo KMS, or a cell on Hanzo's own models.

Four nouns, one owner each, all under `/v1/desktops` and `/v1/providers` on
`api.hanzo.ai`, served over ZAP (HIP-0114); the HTTP and OpenAPI forms are
projections of the same typed ops.

| Noun | Meaning | Where it lives |
|------|---------|----------------|
| Desktop | One installed Dev app, linked to one IAM user | cloud registry row |
| Provider account | A login or key the user holds with a provider, by reference | cloud row (reference), desktop (login), KMS (key) |
| Usage | What a desktop reports about runs on its providers | cloud, per user and org |
| Route | Which desktop or key a web session executes through | `/v1/dev` session field |

## The one rule: credentials do not move

A **subscription login** (an OAuth token or CLI session for a consumer plan) stays on
the desktop that created it. It is never sent to cloud, never stored in KMS, never
copied to another device. The cloud holds a *reference* (`desktop id + provider
instance id`) and a *state* (`ready`, `needs_login`, `limited`).

A **key** (an API key from a model provider) is written once, from the desktop or the
web, to Hanzo KMS at `kms://orgs/<org>/users/<sub>/providers/<provider>/<id>`. The
registry row stores that path and nothing else. The value is read by the `/v1`
gateway at call time and is not returned by any op, including to its owner.

A web session could in principle "run on my desktop's login" by sending the turn to the
desktop, where the provider's official client, logged in as the user, executes it; the
credential still never moves. That is the only relay this HIP defines, and it is
enabled per provider only where the provider's terms allow it. Today none do (see
Provider policy), so every subscription login is `local`.

## Provider policy

Each provider has one `route` class, set by Hanzo from the provider's terms (below) and
enforced by cloud, not chosen by the client.

| Class | Meaning |
|-------|---------|
| `desktop` | May run a web session on the linked desktop, executed by the provider's official client on that machine. Token never leaves. |
| `local` | Runs only in the desktop app itself. Not offered to web sessions. |
| `key` | Runs from the user's API key in KMS, in a cell or via the gateway, from any session. |

A provider can carry several: a user's Anthropic API key is `key`; the same user's Claude
subscription is `local`. The table is data in `apps/desktop/policy.go`
and in the Dev desktop's provider catalog, and a change is a HIP amendment.

Terms were read from each provider's own pages (November 2026). No provider's terms
permit relaying a consumer-subscription session to another device or a web session;
Anthropic and Google forbid it outright, the rest are silent or bar sharing a login.
So **no subscription login is `desktop`-routable today**. The `desktop` class exists
and stays empty until a provider confirms in writing that the user driving their own
official client on their own machine from a web screen is permitted.

| Provider | Subscription login | API key in KMS | Basis |
|----------|--------------------|----------------|-------|
| Anthropic Claude Code | `local` | `key` | Forbids routing, collecting, storing or intermediating Claude.ai credentials or session tokens (code.claude.com/docs/en/legal-and-compliance); consumer terms bar sharing credentials. The user's own key, billed to them, is allowed. |
| OpenAI Codex / ChatGPT | `local` | `key` | Bars sharing credentials or making the account available to others; `auth.json` is "like a password". Own key allowed; no resale or transfer to third parties. |
| Google Gemini CLI / Antigravity | `local` | `key` | Third-party tools on subscription OAuth are a stated violation, with documented bans. Gemini API has no key-sharing clause. |
| GitHub Copilot | `local` | none (no user key) | One login, one person. |
| OpenCode (Zen/Go) | `local` | `key` | Own internal use only; third-party models need the user's keys. |
| Cursor | `local` | not found, `local` | Silent on credential sharing; bars lease or rental of the service. |
| xAI Grok | `local` | `key` (verify) | Consumer terms not retrievable; enterprise terms bar time-sharing. |
| AWS Kiro | `local` | `key` | AWS agreement, no sharing clause found. |
| Pi | `local` | inherits upstream | No terms of its own. |
| Anthropic, OpenAI, Gemini, xAI API; OpenRouter | n/a | `key` | Per-user custody, billed to the key owner; never pooled across users, never resold. |

A provider's class is fail-closed: a provider not in this table is `local`.
Hanzo's own models (Zen) are `cell` and need no account.

Consequence for web sessions: at hanzo.app/dev a user runs on a Hanzo cell with Zen, or
with their own API key from KMS. Their subscription logins work on the desktop itself,
and the web can show them (state, usage) but cannot drive them. The existing
ChatGPT-profile transfer between machines in Dev predates this HIP and is outside it;
it should be reviewed against the OpenAI terms.

## Registry

### Link

The desktop signs the user in with Hanzo IAM (device code or loopback PKCE, already in
Dev's `CliTokenManager`), then:

    POST /v1/desktops
    { "name": "Zach's MacBook", "os": "darwin", "arch": "arm64", "version": "1.8.4",
      "key": "<ed25519 public key, base64url>", "zap": "https://…" }
    → 201 { "id": "dsk_…", "interval": 30, "level": "metadata" }

- Identity is the validated IAM token. `owner` (org) and `subject` (user) come from
  it, never from the body. A machine token is refused.
- `key` is the desktop's own device key. Later relay and usage calls are signed with it,
  so a stolen IAM token alone does not impersonate a linked desktop.
- `zap` is the desktop's reachable ZAP endpoint (its Connect tunnel), used exactly as
  given by the `machine` DevRuntime. Optional: a desktop with no tunnel is registered
  and not routable.
- Idempotent on `(subject, key)`: relinking the same install returns the same id.
- Cap: 25 active desktops per user.

### List, read, revoke

    GET    /v1/desktops          the caller's desktops, newest heartbeat first
    GET    /v1/desktops/{id}
    DELETE /v1/desktops/{id}     revoke

Only the owner reads or revokes. An org admin sees *counts* in the org view (Usage),
not another person's desktop rows, and a SuperAdmin (`owner == "admin"`) has no
extra read. Revoke sets `revoked_at`, drops routes through it, and is audited. The
next heartbeat from a revoked desktop answers `410`, on which the desktop forgets the
link. Revoke is also offered from the desktop and from hanzo.app.

### Heartbeat

    POST /v1/desktops/{id}/heartbeat
    { "at": "2026-11-20T10:00:00Z", "version": "1.8.4", "zap": "https://…",
      "providers": [ { "provider": "claude", "instance": "claude-1", "kind": "login",
                       "state": "ready", "plan": "max" } ],
      "busy": 0 }
    → 200 { "interval": 30, "level": "metadata", "revoked": false }

- Interval 30 s. Online means a heartbeat in the last 90 s; otherwise `offline`.
  Neither is an error, and a laptop that sleeps is simply offline.
- `providers` is state only: provider, instance id, kind, state, plan label. No token,
  no email, no key material.
- The reply carries the usage `level` the user chose (below) so cloud and desktop cannot
  disagree about what is sent.
- Heartbeats are signed by the device key; unsigned or mis-signed answers `401`.

### ZAP service

One service, `desktop.v1`, on cloud's ZAP port; HTTP is its projection.

    Link(LinkRequest) → Desktop
    List() → [Desktop]
    Get(id) → Desktop
    Revoke(id) → Ok
    Heartbeat(id, Beat) → BeatReply
    Report(id, UsageBatch) → Ok            (slice 3)
    Dispatch(id, Route) → stream Frame     (slice 4; see Routing)

Desktop wire type:

    Desktop { id, name, os, arch, version, state: online|offline|revoked,
              last_seen, linked_at, zap?, providers: [ProviderState] }

Storage is the per-tenant SQLite store every cloud app uses: table `desktops`
(`owner, subject, id, name, os, arch, version, key, zap, last_seen, linked_at,
revoked_at`) and `desktop_providers` (`id, instance, kind, state, plan`). No secret
column exists.

## Provider accounts

    GET    /v1/providers/accounts
    POST   /v1/providers/accounts            { provider, kind: "key", label, value }
    DELETE /v1/providers/accounts/{id}

A `login` account is created by the desktop's heartbeat (it appears when the user logs
in there and disappears when they log out); users cannot create one from the web. A
`key` account is created by `POST` with `value`: cloud seals it to KMS, stores
`{ id, provider, label, key_ref, created }` and zeroes the buffer. `value` appears in no
response, log, trace or audit field. Deleting an account deletes the KMS secret first,
then the row. A provider key is org-scoped by KMS path with the user's subject in it;
nobody else in the org can resolve it.

## Usage

### What is reported

Default level `metadata`. A report is a batch of records, one per provider window or
run. The record carries the same fields as the Dev desktop's typed usage module
(the CodexBar-derived `usage/` model), so desktop and cloud share one model:

    UsageRecord {
      desktop, provider, instance,
      window:    "session" | "weekly" | "monthly" | "run",
      used, limit?, unit: "tokens" | "requests" | "credits" | "usd",
      resets_at?,
      credits?:  { remaining, unit },
      cost?:     { amount, currency },
      model?, tokens?: { input, output, cached, reasoning },
      started_at, duration_ms?, outcome?: "ok" | "error" | "cancelled",
      run?:      "<hash of thread id>"
    }

At `metadata` the schema has no field for prompt, response, file path, repository name,
branch, diff or command text; a payload with one is rejected whole, never trimmed. `run`
is a salted hash so a user can count runs without cloud learning the thread.

Level `metadata+content` is a per-desktop opt-in the user turns on. Content goes to the
user's own Space (HIP-1337) for that user, readable only by them, and is deleted when
they turn the level off or revoke the desktop. It is never aggregated and never visible
to an org admin.

### The user sees exactly what is sent

The desktop writes every batch to a local outbox *before* sending, and the "Linked to
Hanzo" screen has a "What is reported" view that renders the outbox verbatim: the exact
JSON, last 100 batches, with sent/pending state and a "Send nothing" switch. The reply
level is shown next to it. What the user reads is the bytes that left.

### Aggregation

Cloud keeps rows by `(owner, subject, desktop, provider, model, day)` and answers

    GET /v1/desktops/usage?by=user|desktop|provider|model&from=&to=

for the caller (their own rows), and for an org admin the same query with `by=user`
returning per-user totals only: tokens, requests, cost. No admin read reaches content,
desktop names or provider labels of another user.

## Routing

A `/v1/dev` session (HIP-1330) gets an `execution` field:

    { "via": "cell" }                                    default, cloud cell on Zen
    { "via": "key",     "account": "<provider account id>" }
    { "via": "desktop", "desktop": "<id>", "provider": "<instance id>" }

`desktop` resolves in the registry: the desktop must be the caller's, not revoked,
online, have a `zap` endpoint, report the provider instance `ready`, and the provider's
class must include `desktop`. Anything else is refused up front with the reason, never
silently falling back to another credential. The `machine` DevRuntime
(`apps/web/src/embed/runtime.ts`) is the resolved target: ZAP over WebTransport, the
user's IAM bearer as cap, no new transport. `Dispatch` is only the lookup-and-policy
step that returns that runtime's endpoint; frames flow browser to desktop, not through
cloud. `key` is resolved by the gateway from KMS at call time for the session's model
calls.

The session's usage is reported by the executing side: a desktop reports its own, the
gateway meters `key` and `cell`.

## Desktop UI

Settings → "Linked to Hanzo".

1. **Status.** "Linked as `z@hanzo.ai` · org Hanzo", this desktop's name (editable),
   online dot, last heartbeat. Button: Unlink this desktop. Not linked: one button,
   "Link to Hanzo", which runs IAM sign-in.
2. **Your desktops.** Every linked desktop with online/offline and last seen; Revoke on
   each, confirmed.
3. **Providers on this desktop.** One row per instance: provider, plan, state, and a
   route chip: *This desktop only*, *Available on hanzo.app*, or *API key*. Chips are
   read-only for `local`, a toggle for `desktop`.
4. **API keys.** Add a key; it is sent to KMS, the field is cleared, the row shows only
   the label and last four characters of the key's own fingerprint, never of the value.
5. **What is reported.** Level selector (Metadata / Metadata and content), the outbox
   viewer, Send nothing.

Every control has its reverse: link/unlink, share/unshare a provider, add/remove a key,
opt in/opt out.

## Security

- IAM only. No password, OTP or session scheme here; the device key signs, IAM
  authenticates.
- User-scope everywhere: the subject comes from the validated token, and no op reads
  another user's desktop, account or content. SuperAdmin has no path in.
- KMS paths only in docs and rows; values never leave KMS except to the gateway at call
  time.
- Audit: link, revoke, key add and delete, level change, every Dispatch.
- Rate: heartbeat 1 per 10 s per desktop; link 10 per hour per user.

## Slices

1. Registry: link, list, get, revoke, heartbeat, ZAP service; desktop "Linked to Hanzo"
   screen (status, your desktops, providers read-only). **This HIP's first build.**
2. Provider accounts and KMS keys; route chips.
3. Usage reports, outbox viewer, aggregation.
4. Routing: `execution` on `/v1/dev`, Dispatch, hanzo.app picker.

## Rejected

- Storing provider tokens in KMS so any cell can use a subscription: violates provider
  terms and the one rule.
- A second usage model: the desktop's typed usage module is the schema.
- WebSocket or HTTP session bridges: ZAP only.
