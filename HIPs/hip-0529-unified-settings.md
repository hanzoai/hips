---
hip: 0529
title: Unified Settings — One Control Plane for Hanzo
author: Hanzo AI
type: Informational
category: Interface
status: Draft
created: 2026-11-04
---

# HIP-0529: Unified Settings — One Control Plane for Hanzo

## Abstract

Hanzo's web, desktop and connected applications need one place to answer: what
does my AI know, what can it do, which machines and providers may it use, who can
change the rules, and what does it cost? This HIP specifies the unified
hanzo.ai/settings experience: navigation, the full control inventory, scope
and policy inheritance, backend ownership, accessibility, state transitions,
migration and acceptance tests. The product promise is **Own your AI**.

This is an **interface and implementation proposal**, not a declaration that
every listed control exists. It composes existing personal preferences
(HIP-1141), per-product organization settings (HIP-1151), agent authority
(HIP-0524), tenancy (HIP-0527), and the app/mod contract (HIP-0528). A user
interface MUST NOT manufacture a second source of truth for any of them.

The target application is the Hanzo web app; the public app contract lives at
https://github.com/hanzoai/app. It must have the same semantics on desktop and
mobile, allowing device-only controls to remain device-only.

## Motivation

A monolithic General page mixes profile, appearance, reasoning, wallet payouts,
tool approval and organization navigation. The sidebar exposes every enterprise
product as a first-class link, while users cannot easily discover their AI's
memory, identity, agent permissions or connected applications. This makes a
working platform difficult to operate without technical knowledge.

Adding more independent settings pages would make the problem worse unless
their scope and data owner are fixed. The redesign must combine the approachability
of an ordinary account-settings interface with the precision of an AI control
plane. People need a small set of intelligible decisions; engineers and admins
need every applicable knob, and every knob needs a real behavioral effect.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY describe the proposed
acceptance contract for the web implementation.

### §1 Product, scope and navigation

The four top-level groups are **Personal**, **Your AI**, **Plan & Usage**, and
**Workspace**. A group is collapsible. Search remains available even when a
group is closed. The default view shows a compact navigation column, not an
ever-growing product list.

| Group | Page | Canonical route |
| --- | --- | --- |
| Personal | Account | /settings/account |
| Personal | Security & Login | /settings/security |
| Personal | Appearance | /settings/appearance |
| Personal | Notifications | /settings/notifications |
| Personal | Voice | /settings/voice |
| Personal | Keyboard | /settings/keyboard |
| Personal | Storage | /settings/storage |
| Personal | Privacy & Data | /settings/privacy |
| Your AI | Personalization | /settings/ai/personalization |
| Your AI | Memory & History | /settings/ai/memory |
| Your AI | Models & Reasoning | /settings/ai/models |
| Your AI | Capabilities | /settings/ai/capabilities |
| Your AI | Agents & Tasks | /settings/ai/agents |
| Your AI | Customize | /settings/ai/customize |
| Your AI | Computer & Browser | /settings/ai/computer |
| Your AI | Code & Git | /settings/ai/code |
| Plan & Usage | Billing | /settings/billing |
| Plan & Usage | Usage | /settings/usage |
| Plan & Usage | Wallets & Rewards | /settings/wallets |
| Workspace | Organization | /settings/organization |
| Workspace | People & Access | /settings/organization/people |
| Workspace | API & Developer | /settings/organization/developer |
| Workspace | Cloud & Infrastructure | /settings/organization/cloud |
| Workspace | Products | /settings/organization/products |
| Workspace | Governance & Audit | /settings/organization/governance |

These are route targets, not an instruction to delete shipped organization URLs.
Existing organization routes MUST remain accessible through aliases or redirect
after the new view is verified. A product-specific control has a contextual
link inside its product and an entry inside Products, not another primary sidebar
row. Marketplace is discoverable from Customize and the main app.

A setting MUST declare one owner scope: account, personal agent, device,
organization, project or individual agent. Every editable page shows the scope,
its effective value, and any governing restriction. A personal setting is not
a proxy for an organization's admin settings.

### §2 Personal controls

#### §2.1 Account — /settings/account

- Profile photo upload/replace/remove; existing avatar generation when entitled.
- Legal or full name; preferred display name; username/handle where IAM supports
  it; bio; occupation; website; preferred language, locale and time zone.
- Email and phone with verification and add/remove; linked sign-in identities and
  identity wallets; organization memberships and active organization.
- Account identifier with copy; subscription summary; data export; account
  deletion with reauthentication and confirmation.
- Profile editing reports saved, saving, validation failure and authorization
  refusal without implying persistence before it happens.

Account identity is not the AI's name or persona. Login wallets are not payout
wallets.

#### §2.2 Security & Login — /settings/security

- Passkeys and hardware security keys; password changes only when password login
  is enabled; authenticator MFA, SMS MFA where supported, backup codes,
  recovery methods and required reauthentication.
- Active sessions: current device, platform, approximate location, first/last
  activity, per-session revoke, sign out other devices, and security history.
- Trusted computers: connection type, device trust, remote-use permissions,
  pairing approvals, last seen, expiry, revoke, and global device restriction.
- Authorized sign-in applications; emergency account lockdown; advanced
  high-risk action verification.
- Family/trusted-contact features, if offered, require separate eligibility,
  authorization and consent; they are not enabled merely by exposing a row.

Neither password nor secret material may be returned for rendering in settings.

#### §2.3 Appearance — /settings/appearance

Basic controls are System/Light/Dark, accent, text size, interface and response
fonts, motion, density, conversation width, light/dark code theme and code text
size. Advanced controls preserve scale, scale system, spacing, corners, native
OS style (iOS, Android, macOS, Windows, Linux), custom font, approved webfonts,
theme mods, preview, import/export and reset. Respect reduced motion, high
contrast, OS accessibility and keyboard focus. Existing Hanzo Look and mod
configuration are the implementation, not a parallel theme store.

#### §2.4 Notifications — /settings/notifications

Each event offers the channels it actually supports: in-app, push, email,
occasionally SMS, or off. Event classes are completed responses, long research,
scheduled tasks, agent results, permission requests, coding runs, PRs, CI and
deploys, shares, mentions, calendar events, account security, organizational
events, spending alerts, usage resets, and opt-in marketing. Include quiet hours,
time zone, digest cadence, device permission state, test notification and
delivery failures. Security messages required by policy cannot be silenced by a
marketing preference.

#### §2.5 Voice — /settings/voice

Voice choice, spoken language/autodetect, recognition language, playback speed,
auto-read, push-to-talk, hands-free, interruption behavior, dictation on/off,
dictation review before send, microphone selection and test, microphone grant,
local recordings, retention, transcript history and deletion. Label remote
audio processing versus local-only processing.

#### §2.6 Keyboard — /settings/keyboard

Editable shortcuts for Send, Focus chat, New chat, Switch chat, Search,
command palette, sidebar, model/effort selector, attachment, voice/dictation,
agent trigger, delete chat and shortcuts help. Show platform-appropriate keys,
detect conflicts and provide per-shortcut enable and Reset. Shortcut edits are
device-aware and must never silently intercept OS-reserved combinations.

#### §2.7 Storage — /settings/storage

Usage/quota by file, image, audio/video, generated artifact, knowledge source,
search index, conversation archive, agent workspace, sandbox volume and cache.
Show local versus cloud, account versus org, sortable rows, download originals,
selective cleanup, retention and storage upgrades. Deletion must identify the
effect on derived embeddings, cached copies and retained memories; a file-delete
action does not falsely claim that all extracted facts have been forgotten.

#### §2.8 Privacy & Data — /settings/privacy

Model-improvement consent, product analytics, marketing preferences,
personalization from chats and connected apps, coarse/precise location permission,
retention and information-sharing disclosures. Manage links, shared chats,
artifacts, projects and public apps; revoke shares. Archive/unarchive chats,
export conversations/files/settings, delete a conversation or all conversations,
erase derived stores where supported, and request account deletion. Separately
explain a conversation's deletion versus removal of a memory inferred from it.

### §3 Your AI controls

#### §3.1 Personalization — /settings/ai/personalization

Identity: personal AI display name, persona, role, goals, custom instructions,
user context, preferred languages and per-project overrides. Response preferences:
warmth, enthusiasm, formality, brevity, directness, humor, emoji, technical depth,
visual answers, lists, citations and writing style. Reference resources: approved
writing samples, personal reference images and design examples with provenance.
Provide a live style preview, instruction precedence, reset, and clear warning
that a style profile cannot reproduce the weights of an unavailable model.

#### §3.2 Memory & History — /settings/ai/memory

Controls: enable memory, search previous chats, derive useful memories, explicit
remember requests, consent to sensitive memory (default off), use connected
sources as evidence, retention, cross-project access and org segregation.

Memory manager: search; date/source/project/sensitivity filters; open source
conversation; view extraction timestamp and uncertainty; edit, correct, pin,
merge duplicate, reject inference and forget; report conflict/staleness. Deleting
a memory must re-read and verify server state, not only hide the row.

Conversation manager: search, rename, archive, move project, export, bulk remove
and show which memories came from a chat. Imports support user-supplied official
archives from ChatGPT, Claude and supported text/JSON/Markdown sources. Show
source, parser version, progress, deduplication, failures and review before
promoting uncertain or sensitive facts to long-term memory. Exports contain a
portable manifest, source references, memory records, user instructions and
permitted agent definitions. An API/model connection is NOT automatically
permission to retrieve a provider's entire consumer-chat history.

#### §3.3 Models & Reasoning — /settings/ai/models

Default model and Enso Auto; preferred fast, reasoning, coding, image, voice
and structured-decision models; fallback order; local model/endpoint selection;
provider connection status. Reasoning effort uses only supported levels
(Auto/Low/Medium/High/XHigh/Max as applicable); model-capability flags determine
visible options. Additional controls: adaptive effort, fast response, context
preferences, model/agent task overrides, output limit, timeout, retry, failure
fallback and spending cap. Show actual model availability, pricing/limits where
known, and the data destination for remote inference. The live model catalog is
authoritative; fallback examples are not presented as live inventory.

#### §3.4 Capabilities — /settings/ai/capabilities

Chat and research: web search/fetch, deep research, linked-source search,
library/history lookup and citations. Creation: editable files, charts,
diagrams, artifacts, PDFs, sheets, presentations, images, voice and design
systems. Execution: isolated code, internet during execution, local/cloud files,
browser, cloud computer, automated tasks and agent delegation. Each capability
indicates Ready, Off, Needs connection, Managed, Plan-restricted or Unavailable.

Tool approval policy defaults to Recommended: permitted read-only operations
may run, while external messages, payments, public sharing, commits/pushes,
merges, secret changes and production deployments require confirmation.
Additional controls are Manual/Auto within allowed bounds, per-tool/per-site
rules, approval lease lifetime, revocation and an explanation of decisions.
An org prohibition cannot be overridden by choosing Auto.

#### §3.5 Agents & Tasks — /settings/ai/agents

List, create, duplicate, enable, disable, export and delete specialized agents.
Each agent has role, instructions, model, skill set, tool grants, memory scope,
knowledge sources, budget, sandbox/deployment and maximum concurrency. Authority
ladder follows HIP-0524 where the personal agent sends on a user's behalf;
subagents cannot acquire more permission than their delegator. Provide
Manual/Supervised/Autonomous modes only as UI presets mapped to explicit grants.

Tasks view: schedule, conditional trigger, time zone, recurrence, retry,
pause/resume/cancel, awaiting approval, expiration, status, cost and artifacts.
Activity view: runs, actions, tools, logs, model decisions, errors and audit refs.
Configuration via chat follows the exact same validation and consent path as UI.

#### §3.6 Customize — /settings/ai/customize

Four tabs: Connectors, Skills, Plugins, Marketplace. Each supports Yours and
Discover, search, categorization and a unified Add menu. Connector rows show
OAuth/credential state, authorized resources, effective grants, last sync,
test/reconnect/revoke and personal versus org installation. Support custom
MCP endpoints and local MCP servers only with explicit policy.

Skills: upload validated Markdown/skill/ZIP formats, read SKILL.md manifest,
create manually or with Hanzo, preview instructions, version, test, enable,
disable, uninstall and publish. Scan structure, code/dependencies, requested
permissions, outbound network and prompt injection risk; scans never guarantee
safety. Plugins: publisher, version, manifest, tool-level risk, credentials
sealed in KMS, updates, revocation and execution boundary. Marketplace:
verified listing, categories, installation preview, permission confirmation,
version pinning and report/revoke. Reuse the established tool and listing
registries rather than creating a separate extensions database.

#### §3.7 Computer & Browser — /settings/ai/computer

Local/cloud/hybrid runtime; trusted computers, active remote sessions, pairing,
approval, timeout, cancel, revoke and activity log. Browser extension state,
pair/unpair, preferred and built-in browser, default site policy, allowed and
blocked domains, per-site read/write grants, screenshots, downloads, uploads and
clipboard policy. Cloud computer: environments, website approvals, session
retention, supported cookie/session-state management and reset. No extraction
of site session cookies or password collection for third-party AI accounts.
The user signs in on the provider's own surface. Use official APIs or exports
for integrations and data migration where available.

#### §3.8 Code & Git — /settings/ai/code

Coding harness, default coding model, branch prefix, default branch/repo,
workdir, transcript (Normal/Thinking/Verbose), sandbox, labels and progress.
Git providers, Forge, automatic branches, commits, pushes, draft/ready PRs,
auto-fix, test-required gate, response to review and merge approvals.
Automatic review toggle, triggers (PR open/update/manual), exhaustive mode,
repository overrides and budget. Cloud environments: repository, setup
script, runtime/dependencies, KMS secrets, CPU/RAM, network/egress, volumes,
retention, live previews and lifecycle. A coding agent's PR merge or external
publish must obey effective approval rules even when a UI preset enables
autonomous development.

### §4 Plan & Usage controls

#### §4.1 Billing — /settings/billing

Plan, billing cycle, renewal, included allowances, upgrade/downgrade/cancel,
payment methods and backup, invoice history, billing contact/address/tax,
promotions, prepaid API credits, auto-reload and spending limits. Subscription,
prepaid API credits, organization wallet and per-agent spending are distinct
balances with independently stated scope.

#### §4.2 Usage — /settings/usage

Real rolling plan windows, remaining/reset time, activity by chat/model/product,
tokens, tool calls, agent time, microVM compute, storage and cost. Break down
account/org/project/agent; show charts, billed versus included credits, alerts,
history/export and spend forecasts where measured. Never fabricate a reset,
available amount, price or quota. Show gaps when telemetry is incomplete.

#### §4.3 Wallets & Rewards — /settings/wallets

Identity-linked wallets, payout wallet, verified address and chain, rewards
balance/history, supported USDC/API top-ups, x402 when available, transaction
state, account association and disconnect. Reauthentication for payout changes;
identity wallets, rewards payout wallets and agent payment identities are
separate authorities.

### §5 Organization and workspace controls

#### §5.1 Organization — /settings/organization

Name, handle, logo, contact, address, country, immutable ID, personal/team
organization, convert to team, brand defaults, data region where applicable,
organization-wide instructions, ownership transfer and org deletion.

#### §5.2 People & Access — /settings/organization/people

Tabs: Members, Groups, Roles, Identity, Agents. Invitations, membership,
roles, group policies, custom role matrix, seat counts; SSO, SCIM, verified
domains and MFA/session requirements where supported. Service identities,
federated agent grants, delegated scopes and audit access. IAM-signed acting
organization and role remain authoritative, never labels from client state.

#### §5.3 API & Developer — /settings/organization/developer

API access and key lifecycle, scopes, expiration, rate limits, model access,
webhooks/signing, OAuth apps/redirects, MCP endpoints, SDK/docs links, secret
custody, API history and budgets. Preserve platform.hanzo.ai as the canonical
key destination until its replacement is explicit and tested. Never return
unmasked secrets after creation.

#### §5.4 Cloud & Infrastructure — /settings/organization/cloud

Environments, regions and residency, quotas, CPU/GPU, microVM runtimes,
versions, volumes, object storage, network and egress, domain allowlists,
KMS references, sandbox leases, Forge hosting, preview deployments,
logs/metrics, backup, retention and decommission. Distinguish policy governing
environments from the environments' actual lifecycle state.

#### §5.5 Products — /settings/organization/products

Searchable catalog: Chat/App, Bot, Dev/Code, Chrome, Tag, Cowork,
Artifacts, Design, Security, Science, University, Office Agents and any other
registered product. Each detail exposes actual availability and maturity,
enablement, member/group access, budgets, connectors, product policies,
activity and an Open product action. Product catalog is not a 20-item settings
navigation group.

#### §5.6 Governance & Audit — /settings/organization/governance

Data retention/residency, provider/model restrictions, training contribution,
sensitive topics, external sharing, allowed skills/plugins/connectors, website
and network egress, execution and autonomous approval ceilings, budgets,
role controls, compliance, log export, administrative changes and response
to incidents. It is visible only to principals with the necessary grants.
SuperAdmin-only platform routing controls are not rendered as org-admin fields
(HIP-1044).

### §6 Data owners and effective policy

There MUST NOT be one giant settings JSON document standing in for the existing
services. The ownership map is:

| Data | Authoritative source |
| --- | --- |
| Account, authentication, verified identities, roles | IAM |
| Small per-user UI preferences, no secrets | /v1/pref (HIP-1141) |
| Per-organization per-product configuration | /v1/settings/{product} (HIP-1151) |
| Cross-tenant platform operator routing policy | /v1/org (HIP-1044), SuperAdmin only |
| Versioned app layout/mod patches | /v1/mod as specified by HIP-0528 |
| Memory, provenance, deletion | Memory service and its source archives |
| Model IDs and supported capabilities | Live model catalog |
| Credentials and connector tokens | KMS and connection-plane custody |
| Agent identity, authority, schedules and runs | Agent/task services |
| Sandboxes, git and hosting | Sandbox/Forge/cloud services |
| Usage, credits and subscriptions | Billing and usage services |

Every setting descriptor names: ID, label, description, value type, default,
stored value, *effective* value, owner scope, required role/entitlement,
validation, persistence operation, version, last update and provenance of an
enforced policy. The frontend MUST NOT infer privilege from an admin badge.
Write the exact signed-in principal and acting org into the authorized backend
request; organizational policy is enforced server-side.

**Resolution:** the platform sets immutable ceilings; organizational policy
may narrow them; project/agent grants may narrow further; personal preferences
and device defaults select values only within the remaining allowed set. This
is not last-writer-wins. An explicitly denied external send cannot be turned
on by choosing Auto, by a mod, by a lower-level override or by a delegated agent.
User preferences (HIP-1141) are not an organization administrator's document.
Org product configuration (HIP-1151) never reads its org from a query/body
string. Secrets are never stored in either.

A settings write MUST be atomic at the owning service. Simple toggles may
optimistically display Pending but may announce Saved only after success.
Failed writes roll back. Forms use explicit Save/Cancel. Conflicting edits use
version or compare-and-set rather than an unguarded read-merge-write. Do not
treat a failed read as permission to overwrite defaults.

### §7 UI and interaction contract

- Desktop sidebar approximately 240–260 px; content about 720–800 px, wider
  for tables/inspectors. Mobile shows a drawer with route title and working
  back navigation. Do not force massive whitespace on ultra-wide screens.
- All controls are consistent setting rows: title, one-sentence consequence,
  optional secondary help, control, status. Complex settings use a Manage
  page or explicit editor, not an overflowing inline form.
- Basic appearance settings precede collapsed advanced theme controls.
  Developer and administrator detail is progressively disclosed, not removed.
- Search indexes setting labels, synonyms, descriptions and routes, not just
  navigation headings. Results deep-link to the correct control.
- Scope and policy owner are visible. A managed setting says who controls it,
  why the control cannot be changed and where an authorized admin can go.
- Use one menu for Add connector / Upload skill / Create skill / Create with
  Hanzo / Add MCP server. Install screens reveal source, permissions and
  data boundaries before consent.
- State vocabulary: Loading, Ready, Off, Needs connection, Pending approval,
  Managed, Plan restricted, Unsupported runtime, Beta, Error and Revoked.
  These are operational states, not decorative badges.
- Destructive actions require meaningful confirmation; irreversible account
  and organization operations require reauthentication and typed confirmation.
- Internationalize through shared translations. Meet WCAG 2.2 AA: label and
  description association, keyboard navigation, visible focus, reduced
  motion, contrast, screen reader status and narrow-layout support.
- Every setting has a help description and documentation link where needed.
  A future conversational settings agent may propose changes, but must use the
  same backend write permissions, preview, confirmation and audit gate.

### §8 Application integration and migration

The current web implementation's reusable units are the settings frame,
central navigation registry, General, Memory, Capabilities, Models, Plugins,
Products and settings row primitives. Prefer moving controls and reusing
handlers over rewriting services. The org-specific settings clients already
speak the /v1/settings product contract; keep that authority.

Preserve existing URLs such as /settings, /settings/memory and all shipped
/settings/organization/* destinations. Add aliases/redirects only after the
new page is tested. Keep external platform API-key links intact. Do not expose
a route in navigation until it has a real view and functioning owner service.

Recommended implementation order:

1. **Navigation and scope:** canonical registry, grouped sidebar, search,
   responsive frame, legacy route tests.
2. **Personal split:** account, appearance, notifications, voice, keyboard,
   security/privacy and wallet placement; migrate without losing values.
3. **Personal AI:** personalization and memory/history, model selection,
   capabilities and approvals, agent/task surfaces.
4. **Customize:** reuse existing plugins/skills/connectors/marketplace contracts,
   add personal scope and grants where backend supports it.
5. **Computer and coding:** browser pairing, site policy, cloud runtime,
   Forge/git, sandbox environment and PR review settings.
6. **Organization consolidation:** members/roles, developer, infrastructure,
   product directory, governance. Preserve existing API/role checks.
7. **Hardening:** audits, security validation, accessibility and browser QA.

A feature without a backend remains absent or clearly marked unavailable; it
must not masquerade as enabled. Proposed endpoints are not deployed contracts.

### §9 Testable acceptance criteria

For **every** shipped control, test:

1. Read the actual value; change it; obtain a successful authorized write;
   reload; verify persistence and behavior; restore the prior value.
2. Invalid input, network failure, concurrent updates, expired session and
   insufficient permission show correct errors, with no false Saved state.
3. A member cannot change an org-admin value; an org admin cannot view
   another person's personal memory/prefs; switching orgs cannot expose a
   previous organization's configuration.
4. Secret values never round-trip from KMS; revoking a connector removes
   agent tool access, including running sessions when policy requires.
5. Restricted models, prohibited websites, external send, repository merge
   and spending ceilings are blocked by server policy even when a UI or
   model prompts otherwise.
6. Removing personal history or memory correctly reports which derivative
   objects were deleted and which remain.
7. Every deep link, search result, keyboard interaction, mobile view and
   dark/light appearance works. Screens are testable via accessibility APIs.
8. Production and local modes show only their actual supported capabilities;
   a local privacy mode does not silently fall back to remote embeddings.
9. Built assets contain no session-bound private profile or organization
   data before authenticated hydration.
10. No missing settings page, inert toggle, mock usage, or duplicate source
    of truth is shipped as complete.

Release evidence includes a page inventory, route audit, persisted-operation
matrix, IAM/tenancy and secret-handling tests, screenshots (desktop/mobile and
light/dark), accessibility results, successful build and CI, and a list of
clearly identified unavailable or future controls.

## Rationale

One consolidated sidebar with deep pages beats a primary navigation that grows
one entry per product and per release. A settings page can be approachable
without denying engineers precision: user-friendly defaults are the short
path, advanced controls are the disclosed path. The user needs to control one
AI, not understand every internal service.

A single new mega-settings database would be attractive to frontend code, but
breaks personal/organization tenancy, secret custody and the existing shipped
capability contracts. One **experience** is correct; one **store** is not.

## Security Considerations

The dangerous failure mode is confusing *visibility* with *authority*. A hidden
control does not prevent a forged API request; IAM and the relevant service must
enforce the effective policy on every write and tool execution. Personal
memories are private to the canonical subject and never become org-admin
readable because of navigation consolidation.

A settings action invoked by an AI agent is potentially influenced by prompt
injection from tool output, imported archives or third-party pages. The agent
must not grant itself new permissions, install executable plugins without the
proper consent, weaken security or commit org-wide policy. External sends,
financial operations, production deployment, secrets, bulk deletion and
other high-impact changes require the policy's designated confirmation.

Remote browser sessions and third-party model accounts are distinct from API
credentials. The browser retains consumer sessions; supported OAuth and exports
are the preferred integration path. Do not take raw session cookies or
passwords into Hanzo as a shortcut. Show provider data destinations explicitly.

A public mod must not render untrusted script in the first-party origin or
override the host's consent dialog (HIP-0528). A setting influenced by an
untrusted extension is a proposal until an authorized principal approves it.

## References

- HIP-0026 — Identity & Access Management Standard
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0118 — SuperAdmin & Tenant Isolation Model
- HIP-0524 — The Personal Agent
- HIP-0527 — Tenancy
- HIP-0528 — Mods — The App SDK
- HIP-1044 — Org Settings (platform operator controls)
- HIP-1141 — Pref — One Document Per Person
- HIP-1151 — Settings — Per-Product Org Configuration
- HIP-1210 — Agents — Define, Run, Keep the Run
- HIP-1213 — Tools — The Tool Plane
- HIP-1250 — Integrations — The Connection Registry
- HIP-1335 — Listings — One Market for Apps, Skills, Mods, Plugins, Automations and Packs

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
