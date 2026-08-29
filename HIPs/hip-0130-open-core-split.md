---
hip: 0130
title: "Open-Core Split — the Tenancy Line, the Composition Root, and Lazy Subsystems"
author: Hanzo AI Team
type: Standards Track
category: Core
status: Final
created: 2026-07-27
requires: HIP-0106, HIP-0127
---


# HIP-0130: Open-Core Split — the Tenancy Line, the Composition Root, and Lazy Subsystems

## Abstract

`hanzoai/cloud` becomes **three tiers** and stays one codebase.

```
hanzoai/cloud/         TIER 1  OSS CORE — Apache-2.0, free, forever.
                               Structurally single-tenant. A developer runs it
                               on a laptop, unlimited. The default build.

hanzoai/cloud/ee/      TIER 2  ENTERPRISE — visible source, proprietary license.
                               Multi-tenancy, HA, org isolation, provisioning,
                               metering, quota, operator surfaces.
                               Read it, evaluate it, PAY to run it in production.

hanzo-inc/*            TIER 3  MOAT — never published.
                               Enso routing internals, Zen backend, pricing and
                               plans, memos, patents, the operator console.
```

Not a fork. Not a vendor drop. One repo, one composition root, one order, three
licenses.

**The tier 2 / tier 3 line: tier 2 is what a customer runs; tier 3 is how we
win.** Multi-tenancy is table stakes any competent team could rebuild — showing
it costs little and sells the product. Model-routing intelligence and pricing
are the durable advantage — showing them costs the business.

The line is **tenancy**, not feature. The exclusions are **pricing, plans,
routing intelligence, and the Zen serving stack**. Everything else a customer
gets, because a crippled demo teaches nobody and converts nobody.

**The deliverable:** one binary, no cluster, no external services. `hanzo cloud
up` and a developer has Base + realtime + auth + storage + KV + search + AI on
localhost with the customer console embedded. Four ways in — HTTP, ZAP, MCP,
CLI — over one route table. Everything heavier lazy-mounts on demand. A cluster
is opt-in, for the developer who genuinely wants to deploy containers.

**Multi-tenancy and HA are the paid product.** Not a license key — a build. The
OSS binary is *structurally* single-tenant: serving a second tenant is not
disabled, it is absent.

Most of this is already true. We are largely enforcing and documenting what
exists, plus the lazy-mount work.

## Specification

### 1. The Line

> **Org-scoping is a data model. Multi-tenancy is a business.**

This distinction is the whole HIP and getting it backwards destroys the split.

Nearly every subsystem in `clients/*` carries an org identifier and scopes its
queries by the JWT `owner` claim. That is not the line. The OSS build keeps org
scoping in full — it is a correctness property, and removing it would fork the
data model and guarantee drift. A single-tenant deployment simply runs with one
org, exactly as `e2e/run.sh` runs with `org=hanzo`.

The line is not *"does the code have an org column"*. It is *"does this
subsystem exist so that **Hanzo** can run a service business for **other
people**"*.

#### 1.1 The Test

Three questions. **Any YES means PRIVATE.**

1. **Money** — does it compute or move a price, a charge, a credit, a payout, or
   a plan entitlement?
2. **Tenant lifecycle** — does it create, provision, quota, or isolate an org
   *other than the one running the binary*?
3. **Cross-tenant authority** — can any route serve a caller data about an org
   that is not their own?

Otherwise it is a product capability that one organization runs for itself.
**OSS.**

Question 3 is the sharpest because it is mechanically checkable: a handler that
takes an org from a path parameter or a query string rather than from the
validated principal is, by construction, cross-tenant. That is also the exact
shape of a tenant-isolation bug, so the guard pays for itself twice.

#### 1.2 Why not "feature"

A feature line ("advanced features are paid") requires a judgement call per
feature forever, and every call is relitigated by whoever wants their subsystem
on the other side. A tenancy line is a property of the code. It answers itself.

It also matches what customers actually pay for. Nobody pays for a chat
endpoint. They pay to not operate the thing.

#### 1.3 The line validates independently

The tenancy line was chosen on principle. It then turned out to coincide with a
property nobody designed for.

Exactly **11 of ~109** subsystems import `k8s.io/client-go` or `k8s.io/api`:
`admin, cron, deploy, fleet, membership, ml, paas, platform, provisioning,
validators, venue`. Every one of them provisions or operates infrastructure —
and the multi-tenant ones do it *for other customers*.

Two boundaries derived from different premises landed in the same place. That is
the strongest evidence available that the boundary is real and not an artifact
of how we happened to argue about it.

The empirical half is equally direct: the real binary boots on a laptop with no
cluster, no kubeconfig, and no external services, and serves correctly —
`/v1/marketing/health` and `/v1/notify/health` 200, `/v1/iam/users` 401,
`/v1/marketing/audiences` 403 ("org scope required"), drip engine live on the
durable queue. The guarded routes answering 401/403 rather than 200 is the point:
the stack is not degraded, it is enforcing.

#### 1.4 Two axes, deliberately separated

The classification answers one question. First-run experience is a different
question, and conflating them produces a bad default.

| Axis | Question | Decides |
|---|---|---|
| **Legality** | May we publish this? | OSS vs private (§1.1) |
| **Default** | Should it be ON at boot? | the developer's first run (§6.1) |

`git`, `deploy`, and `platform` are OSS-legal and should **not** be default-on.
A developer already has GitHub; an embedded git forge and a build pipeline on
their laptop is *our* infrastructure, not their product. Legal to ship, wrong to
boot.

#### 1.5 Structural single-tenancy — the business model

The OSS build must be single-tenant **by construction**, not by configuration.

A flag is a license check, and a license check is patched out in an afternoon.
The correct mechanism is absence: the multi-tenant implementation is not in the
binary, so there is no code path to re-enable.

**The enforcement seam is one function.** `clients/principal/principal.go:118`,
`func Org(c *zip.Ctx) (string, bool)` — already documented in place as "the
org-isolation KEY", and already the single point every subsystem resolves the
acting org through. In the OSS build it resolves the one local org, always.
Every `WHERE org = ?` in the tree is then trivially satisfied and no second
tenant is representable.

The multi-tenant mechanism is equally well localized, and worth naming because
it is exactly what must not ship. `principal.Owner` (line 129) distinguishes the
caller's *home* org from the *acted-on* org: for a normal caller they are
identical, but "a platform SuperAdmin acting in another org — an admin
org-switch (`owner == adminOrg`, `X-Org-Id` = the switched-into org) — has
`Owner == "admin"` while `Org` is the switched org." **That org-switch is
multi-tenancy.** It arrives with `clients/admin`, which moves to
a private repository and is absent from the OSS build. Removing the subsystem
removes the capability; nothing is left to guard.

This buys three things at once:

1. **Safe to publish.** A tenant-isolation bug in OSS cannot leak a real
   customer, because there is no second customer to leak.
2. **Honest.** The developer gets a complete, unlimited, single-org stack. Not a
   trial, not a seat cap, not a nag.
3. **A real paid product.** Multi-tenancy, HA, and enterprise operations are
   things you subscribe for because they are genuinely hard, not because we
   withheld a constant.

**HA is enterprise, and this is a feature boundary, not an omission.**
`internal/org` holds the multi-writer durable plane — `fence.go` (fencing),
`membership.go` (election), `condstore.go`/`condprobe.go` (S3
conditional-store), plus promotion, handoff, and rolling-upgrade paths. The OSS
build is **single-writer, local disk or plain S3, no election, no lease, no
fencing**. Stated plainly, up front, in the README.

Honesty here is strategy, not modesty. "Single-tenant, single-writer, no HA"
disclosed on the first page earns trust. Discovered at scale, it ends the
relationship.

### 2. Classification

#### 2.0 The decision rule — asymmetric on purpose

The tenancy test (§1.1) says what is *safe* to publish. It does not say what is
*wise* to publish. Those are different questions and the second one governs.

| Tier | Admits | Sizing |
|---|---|---|
| **OSS** (Apache-2.0) | Only what a single developer genuinely needs to build and run their own app locally | **Be generous.** This is the DX product. |
| **`ee/`** (licensed, visible) | Only what a customer must *read* to evaluate and buy: the multi-tenant and HA surfaces | **Keep small.** Enough to sell, no more. |
| **hanzo-inc** (private) | **Everything else. This is the default.** | Unbounded. |

**Ambiguity resolves to private.** Not to a split-the-difference compromise —
to private. The asymmetry is deliberate and it is not about secrecy:

> Publishing is irreversible. A competitor reading our multi-tenant
> implementation costs us more than a customer not seeing it costs us. We can
> always move something from private to `ee/` later. We can never un-publish.

#### 2.1 What this rule does to the classification

Applied honestly, it cuts the OSS tier well below my first pass, and the cut
falls in a coherent place.

**OSS is the platform primitives a developer builds ON** — the
backend-as-a-service core: runtime and registry, Base (data), realtime, IAM
(auth), KMS (secrets), storage/S3/VFS, KV, search/index, pubsub, tasks,
agents/chat/AI, the tool plane, functions, exec, knowledge, prompts, framework,
webhooks, automations, notify, settings, prefs, projects, flags, audit,
gateway, plugins.

That set is not arbitrary — it is almost exactly the default-on list of §6.1,
which was derived independently from "what does a dev's app need on line one".
Two derivations, one answer, again.

**Hanzo's own business applications are NOT developer primitives.** `crm`,
`marketing`, `social`, `ad`, `campaign`, `books`, `esign`, `dataroom`,
`captable`, `company`, `legal`, `help`, `content`, `tracker`, `team`,
`leaderboard`, `benchmark`, `research`, `experiment`, `guide`, `product`,
`sbom`, `do` — publishing these hands a competitor our entire product suite and
gives a developer nothing they need to build their own app. Under the revised
rule they are **private**, and none of them was a close call once the question
became "does showing this sell anything".

**`ee/` holds only:** the multi-tenant org plane, HA (`internal/org` — fencing,
election, conditional store, handoff, rolling upgrade), provisioning, metering,
quota, entitlements, and the operator-facing fleet surfaces. Enough for a
customer to read and satisfy themselves it is real.

#### 2.2 Ambiguous — held back, listed for the CTO to pull forward

Per the rule these went private. Each is genuinely arguable and cheap to move
the other way. **Pull any of them forward if there is a sales reason.**

- **`git`, `code`, `index`, `analytics`, `websearch`, `graph`, `world`,
  `translate`** — plausibly developer primitives. `git` in particular: an
  embedded forge is a real differentiator, but a developer already has GitHub
  (§1.4), so it earns nothing in OSS while being substantial work to publish.
- **`deploy`, `cron`** — single-tenant by the k8s sub-analysis and defensible as
  cluster-gated OSS. Held back because both reach production infrastructure and
  neither is needed to *build* an app.
- **`do`, `sbom`, `product`, `research`** — no clear sales value either way.
- **`captable`, `company`, `legal`** — these manage the running org's own
  corporate records and pass the tenancy test cleanly. They are held back purely
  on the "does showing it sell anything" test, which they fail.

The k8s finding (§1.3) still stands and still validates the tenancy line; it
simply no longer produces a "cluster-gated OSS" tier, because everything that
would have populated it is now held back.

#### 2.3 The k8s eleven, resolved on evidence

Read in full. The tenancy line held everywhere, and two of the eleven turned out
not to be subsystems at all.

**All eleven degrade gracefully. None crashes without a kubeconfig.** Nine build
their own client and every one follows an identical pattern:
`rest.InClusterConfig()` → `clientcmd` fallback → store the error in `initErr`
and return a **non-nil** wrapper with a nil inner client → `Mount` returns `nil`
unconditionally, logging a warning → handlers call a `ready()` guard and answer
an honest `503`. Zero `panic`, `log.Fatal`, or `os.Exit` across all eleven. So
the OSS build *could* safely link them; it holds them back by policy, not by
necessity. That uniform pattern is itself worth preserving as a conformance
property — it is what makes §6.3's "reports honestly, never crashes, never
silently 404s" already true rather than aspirational.

| Subsystem | Decisive evidence | Tier |
|---|---|---|
| `cron` | Uses **ConfigMaps + `batchv1.Job`**, never CronJob objects; all timing is in-process via the embedded tasks engine. With no operator-authored ConfigMaps — the OSS default — the k8s path is never exercised. | **OSS** |
| `membership` | LISTs Pods in the binary's **own** namespace for HA peer discovery. Nothing tenant-related. | **`ee/`** (moves with `internal/org`) |
| `fleet` | **Not a subsystem** — no `Mount`, absent from `Wire()`. A KMS-backed registry library. | private (with its consumers) |
| `platform` | Tenant isolation is the **cleanest of the eleven** — org only ever from the validated principal, no SuperAdmin bypass anywhere. | private, **for money** |
| `deploy` | SuperAdmin sees the whole fleet; a normal org gets a read-only reflection and **all writes are SuperAdmin-only, unconditionally** — it cannot act even on its own app. | private |
| `paas` | `discoverNamespaces` LISTs **every namespace in the cluster**. | private |
| `ml` | Namespace per `org[+project]`, plus a **live balance gate before every create** ("so an unfunded org cannot run free GPU compute"). | private |
| `validator` | **All orgs' CRs share one fixed namespace** (`lux-validators`), disambiguated by name, not isolated by namespace. | private |
| `venue`, `admin` | Per-org billing meter; `admin/infra` scans every Kubernetes cluster under one account token, spanning many customer orgs. | private |

#### 2.4 The rule sharpens: money is wiring, tenancy is structure

`platform` forced the distinction that should have been explicit from §1.1.

> **Money is wiring. Tenancy is structure. Wiring is separable at an interface;
> structure is not.**

The three questions are not equal. A subsystem that merely *charges* for a clean
single-tenant capability is not multi-tenant — it is a single-tenant capability
with a commercial cable attached, and the cable unplugs. A subsystem whose
*isolation model* assumes many customers cannot be unplugged from anything.

So the test becomes ordered:

1. **Is the tenancy structurally multi-tenant?** Cross-org authority, shared
   namespaces across customers, co-tenanted backends → **private**, full stop.
2. **Only then, is money the sole commercial concern?** → **OSS**, with the
   money behind the metering seam.

**Third category: inherently remote capabilities get no local seam.** A
capability whose function presupposes an account with a third party — or with us
— has no local implementation to write. Do not design an interface for it; ship
a **client**.

`platform` splits at an interface because deploying containers genuinely works
locally. Enso does not split at all because routing genuinely does not. Same
rule, different physics — and the asymmetry is not an inconsistency, it is the
rule reading the world correctly.

This category decides **shape, not tier.** Conflating the two is the trap: a
capability can be inherently remote and still perfectly OSS. It ships as a
client either way; whether the *remote side* is ours and proprietary is a
separate question, answered separately.

This is the same seam pattern as the Enso router and as §3.2's "OSS records the
fact, private prices it". One rule, applied consistently, now with a reason it
is the right rule and not merely a convenient one.

#### 2.5 What moves — `platform` and `ml` to OSS

**`platform` → OSS (cluster-gated).** Its tenancy is the cleanest of the eleven:
org only ever from the validated principal, `tenant-<org>` namespaces, no
SuperAdmin cross-org bypass anywhere. It degrades honestly without a
kubeconfig — 503, no crash — so a local dev with no cluster sees "needs a
cluster" on the deploy routes, and with an opt-in k3s/kind/Docker Desktop it
works fully.

This makes the **cluster-gated OSS tier earn its place** rather than existing
for one edge case, and it materially improves the product: a local developer
gets a real PaaS that deploys their own app. "Deployment is a paid feature" was
the weaker story.

**`ml` → OSS (cluster-gated).** Same shape: namespace per `org[+project]`
derived from `c.Org()`, honest 503 without a cluster. Its only commercial
mechanism is the pre-create balance gate, which is money wiring.

**`fleet` → OSS**, as a library. `ml` consumes it, it is per-org, KMS-gated, and
fails closed when unconfigured.

**`venue` stays private — and not for the money.** By the stated rule it would
qualify: its tenancy is clean ("MULTI-CREDENTIAL, PER ORG… org is
`principal.Org`… never a client field"). But it fails the prior question. Its
*purpose* is aggregating many cloud accounts' clusters into "the ONE fleet" that
surfaces in `visor` — an operator concern, and `visor` is private. The single-
tenant cluster story is already served by a kubeconfig in `.hanzo/cloud.json`
(§6.3); adding `venue` would add a cloud-credential custody surface for no local
DX gain. It is not a money-only case, so it does not get the money-only remedy.

#### 2.5.1 Third-category audit — read, not assumed

The three candidates were checked against their source. Two were not what they
looked like.

**`ai` — inherently remote. OSS ships a client.** Confirmed: `types.AIClient` is
already an outbound interface, so this is a naming and default change, not new
architecture. Stays **OSS**, as a client.

**`websearch` — the exact opposite, and it stays OSS.** Its package doc is
explicit: Web Search + Scrape "runs entirely on Hanzo infrastructure with **NO
external SaaS provider**", "backed by Hanzo's own services — **never a
third-party search API**", speaking self-hostable searxng and firecrawl
contracts. It requires no third-party account, so it is not in the third
category at all. Had shape been conflated with tier, this would have been pulled
private for a reason that does not exist.

**`gateway` — not remote, and it does not belong in my OSS primitives list.**
This corrects my own §2.1. It is the runtime config plane for the cloud edge
(CORS allowlist, per-IP flood cap, per-tenant rate ceiling), and it carries
**two IAM-gated scopes**: platform policy is SuperAdmin-only, and a SuperAdmin
"may target any tenant with `?org=<slug>`". That is cross-tenant authority
reading an org **from a query parameter** — precisely the §1.1 question-3 red
flag, found by the guard's own criterion.

So `gateway` is a **BOTH**: the per-org self-service row (`OrgRPM`, cache TTL,
method allowlist — org from `principal.Org`, never a raw header) is OSS; the
platform policy plane and the cross-tenant `?org=` targeting are private. The
interface is `gateway.PlatformPolicy`.

**Structurally multi-tenant, unchanged:** `provisioning` (its own doc: "TRUE
multitenancy by isolation-by-instance", co-tenanted backends with
`"o"+hash(org)` name-spacing), `deploy` (all writes SuperAdmin-only,
unconditionally), `paas` (LISTs every namespace in the cluster), `validator`
(all orgs' CRs in one shared fixed namespace), `admin` (cross-tenant by
definition). None of these is a money case and none moves.

#### 2.6 The metering seam — mostly already built

The surgery is far smaller than expected, because the decomplection is already
done in the code.

`clients/platform/computemeter.go:133` already takes an **injected sink**:
`emit func(org string, u metering.Usage)`. Its header states the property
outright — "creator/treasury paid, **no code in this file that knows anything
about royalties**" — and "the self-deploy exclusion that prevents a self-royalty
lives entirely in the sweep", i.e. in `clients/authors`, which is private and
stays private. `platform` already emits usage and knows nothing about what
happens to it.

`clients/ml` is the same: `s.State.bill.Gate(...)` and `s.State.bill.Meter(...)`
behind an abstraction, with the fee resolved by `cloud.ResourceFeeCents` — and
the code already documents the exact OSS behaviour: **"fee==0 or unconfigured
billing makes this a no-op."**

So there is no new interface to invent. The work is to make *unconfigured* the
OSS **default** rather than a degraded state, and to give it a name.

**`metering.Sink` — the one seam.** OSS ships a local recorder; `ee/` and
hanzo-inc register the commercial one.

**The OSS default meters locally with no royalty split.** Not "meters nothing" —
usage visibility is genuinely useful to a self-hoster ("this build took four
minutes; this app is holding two vCPU"), and discarding it would lose a real
capability for no benefit. It records **usage**, never a charge:

- no price is applied — `ResourceFeeCents` resolves to 0,
- no balance gate can deny — an unconfigured gate allows,
- **no royalty ledger entry is ever written.** A self-hoster deploying their own
  app must never silently accrue entries for a marketplace they are not part
  of. The royalty sweep lives in `clients/authors`, which is not in the OSS
  build, so this is guaranteed by absence rather than by a flag.

Note the OSS default must **allow**, not fail closed. `clients.DisabledCommerce()`
fails closed by design, which is right for production and wrong here: in a build
with no commerce, "no billing configured" means everything is free, not
everything is denied. That is a new fourth implementation alongside the existing
in-process/RPC/disabled trio (`deps.go:97`), not a change to any of them.

**`membership` has no `Wire()` line to delete.** It is installed by
`apps/install.go:19` — `init() { cloud.Peers = membership.K8s }` — assigning a
package-level func-var in package `cloud`. Excluding it means editing
`install.go`, not removing a spec. This is the one subsystem the `apps.Order` /
`Compose` mechanism (§4) does not cover, and a split that only edits `Wire()`
would ship it by accident.

Scope note from the inventory: `clients/` holds 126 directories but only ~102
are independently-registered subsystems. 18 are libraries (`principal`, `money`,
`metering`, `payout`, `finance`, `fleet`, `membership`, …), 2 are framework
DocType modules (`cms`, `erp`), 2 are sub-mounts of a sibling (`cron` inside
`tasks`, `connectorruntime` inside `automations`), 1 is build-tag excluded
(`controlplane`), and **1 is orphaned**: `clients/session` has a complete,
documented `Mount` following the standard contract that is called from nowhere —
not `Wire()`, not any sibling. It looks live and is dead. Resolve it before the
split rather than publishing it.

109 subsystems, in `apps.Wire()` mount order. `#` is mount position, which is
load-bearing (§4).

**OSS — single-tenant product capability (68)**

| # | Subsystem | Why OSS |
|---|---|---|
| 1 | pubsub | Embedded NATS. Infrastructure primitive. |
| 2 | kafka | Embedded Kafka adaptor. Infrastructure primitive. |
| 3 | agentskills | Static `.well-known` skill descriptors. |
| 5 | kms | Secrets plane. A local dev needs real secret handling, not a stub. |
| 6 | metrics | Native o11y counters. Already a public module. |
| 7 | ingress | Runtime edge. Already public (`hanzoai/ingress`). |
| 9 | iam | Identity. The single-tenant authority; org *provisioning* is separate. |
| 10 | base | App engine on SQLite. The storage substrate. |
| 12 | authz | Policy evaluation. Already a public module. |
| 17 | storage | Bucket CRUD against the org's own S3. |
| 22 | do | DigitalOcean API client under the caller's own token. |
| 24 | projects | Project = a scope *within* one org. |
| 25 | dns | Forwards to a DNS control plane under the caller's bearer. |
| 27 | prompts | Prompt library. |
| 28 | agents | Agent registry + runtime. |
| 29 | link | AI login-manager registry. |
| 34 | functions | Function runtime. |
| 35 | tracker | Issue tracker. |
| 36 | templates | Template catalog. |
| 38 | framework | DocType engine. The substrate for knowledge/help/content. |
| 39 | knowledge | Knowledge base. |
| 40 | help | Public help center + ticket intake. |
| 41 | content | Content lifecycle. |
| 42 | catalogsync | Bus consumer rendering catalog assets. |
| 43 | webhooks | Per-org webhook registry + delivery. |
| 44 | ml | ML surface. |
| 46 | leaderboard | Usage analytics within one org. |
| 47 | crm | Contact records. |
| 52 | social | Post scheduling. |
| 52 | social | Post scheduling. |
| 53 | analytics | Event analytics. |
| 54 | git | Embedded git server. |
| 55 | sync | Universal sync engine. |
| 58 | captable | Cap table for the org's own equity. |
| 59 | code | Coding surface. |
| 60 | zero-trust | Network policy. |
| 61 | share | zrok tunnel for a local port. |
| 62 | dataroom | Per-tenant data room. |
| 63 | graph | Graph store. |
| 65 | integrations | Connector plane + credential custody. |
| 66 | destinations | Event fan-out to the org's own ad/analytics accounts. |
| 67 | cloudflare | Manages the org's own Cloudflare resources. |
| 68 | sbom | SBOM generation. |
| 69 | team | Team/workspace. |
| 70 | settings | Settings. |
| 71 | prefs | Preferences. |
| 72 | notify | Notification delivery. |
| 73 | channels | Channel registry. |
| 74 | gateway | Request gateway. |
| 76 | exec | Sandboxed execution. |
| 77 | websearch | Outbound web search. |
| 78 | index | Per-org full-text index. |
| 79 | world | World state. |
| 80 | runtime | Bot runtime ops face. |
| 82 | bots | Bot control plane. |
| 83 | audit | Audit log. The org reads its own trail. |
| 85 | esign | E-signature. |
| 86 | product | Product catalog (definitions, not prices). |
| 87 | evals | Eval harness. |
| 88 | benchmark | Benchmark presets. |
| 89 | research | R&D evidence plane. |
| 90 | experiments | A/B assignment + analysis. |
| 95 | tasks | Durable workflow engine + cron. |
| 96 | automations | Connector catalogue + flow engine. |
| 97 | tools | Unified tool registry + MCP endpoint. |
| 100 | guide | Launch checklist engine. |
| 101 | company | Incorporation/fundraising state machine. |
| 103 | legal | Template + generation engine. |
| 104 | agent | Chat orchestrator over the tool plane. |
| 105 | ask | Grounded advisor. |
| 106 | translate | Translation surface. |
| 109 | plugins | Runtime plugin host. |

**PRIVATE — multi-tenant business (24)**

| # | Subsystem | Test failed |
|---|---|---|
| 13 | commerce | Money. Charges, wallets, transactions of record. |
| 14 | licensing | Money. Commercial entitlement. |
| 15 | plan | Money. The plan matrix. |
| 16 | pricing | Money. The rate card. |
| 18 | provisioning | Tenant lifecycle. Provisions managed data services per org. |
| 19 | billing | Money. |
| 20 | rollingcap | Money. Trailing-window spend cap. |
| 21 | account-bridge | Money. Billing/commerce data bridges. |
| 30 | wallets | Money. |
| 31 | x402 | Money. Settles signed payment authorizations. |
| 37 | blueprint | Money. Prices a stack's footprint through a rate card. |
| 51 | validators | Tenant lifecycle. NFT-gated onboarding into our fleet. |
| 57 | venue | Tenant lifecycle. Folds BYO cloud accounts into the fleet. |
| 75 | entitlements | Money. Commercial policy. |
| 81 | authors | Money. Royalty computation. |
| 84 | affiliates | Money. |
| 91 | books | Money. Revenue ledger of record. |
| 92 | treasury | Money. |
| 93 | admin | Cross-tenant authority. → **a private repository of its own**. |
| 94 | admission | Cross-tenant authority. Per-service launch gating across orgs. |
| 98 | marketplace | Money. Priced listings. |
| 99 | referrals | Money. |
| 102 | compliance | Tenant lifecycle. KYC/KYB verdicts we act on as operator. |
| 107 | zen | Excluded outright (§3). The Zen serving stack. |

**BOTH — split at an interface (17)**

These are the real work. Each is a single-tenant core with a multi-tenant
extension braided in.

| # | Subsystem | OSS keeps | Private adds | Interface |
|---|---|---|---|---|
| 4 | flags | Flag evaluation, per-org values | Platform switches (cross-org kill switches) | `flags.SwitchSource` |
| 8 | account | Self-service keys/onboard/CSRF | `/v1/commerce/topup/wallet` | already `MountAccount` / `MountBridge` — the split exists |
| 11 | o11y | The org reads its own telemetry | Fleet-wide control plane | `o11y.FleetReader` |
| 23 | platform | Build an app from a repo | Multi-tenant build fleet, release gating | `platform.ReleaseGate` (§5) |
| 26 | domain | Search + DNS management | Purchase (money) | `domain.Registrar` |
| 32 | paas | Service CR read/apply for one org | Cross-org fleet control | `paas.FleetControl` |
| 33 | deploy | The org's own deployments | ArgoCD-grade cross-tenant fleet view | shares `paas.FleetControl` |
| 45 | usage | Usage records | Metering for billing | `usage.Meter` |
| 49 | ads | Campaign store, spends the *customer's* ad budget | our metering of it | `campaign.Channel` (exists) |
| 50 | campaign | Orchestration + fan-out | Campaign metering | `campaign.Channel` (exists) |
| 56 | visor | The org's own workloads | Fleet autoscaling across tenants | `fleet.Registry` |
| 64 | security | The org's own posture | Cross-tenant security operations | `security.FleetScanner` |
| 108 | ai | Model plane: auth, discovery, completion passthrough | **Enso routing** (§3) | `cloud.ModelRouter` |
| — | metering | Usage records | Rating (records → money) | `metering.Rater` |
| — | money | Currency arithmetic | Rate card application | `money.Rates` |
| — | principal | Identity resolution | Wallet/payer resolution | `principal.Payer` |
| — | mount order | The ordered name list | which names resolve | `apps.Order` (§4) |

The recurring shape: **the OSS side records a fact, the private side prices
it.** `usage` records tokens; `metering` rates them. `ad` launches a campaign;
`campaign` meters it. That is one interface repeated, not seventeen designs —
and it is the right seam because recording and pricing are genuinely different
concerns that were braided together for convenience.

#### 2.7 Ambiguous — decided, with the reasoning exposed

Eight subsystems did not answer the test cleanly. Recording the reasoning so the
call can be revisited on evidence rather than re-argued from scratch.

- **`iam` (9) → OSS.** It creates orgs, which smells like tenant lifecycle. But
  a single-tenant deployment must be able to create its own org or it cannot
  boot. *Provisioning* an org as a billable customer is `provisioning` (18),
  which is private. The line is: minting an identity is OSS, monetizing it is not.
- **`do` (22) → OSS.** It manages the caller's own DigitalOcean account under
  the caller's own token. That it is *also* how we manage our fleet is a fact
  about `admin`, not about `do`.
- **`compliance` (102) → PRIVATE.** Weakest private call. The KYC *template*
  engine is arguably OSS; the *verdicts* are operator decisions with legal
  weight. Split later if a customer asks; do not ship it now.
- **`admission` (94) → PRIVATE.** A per-service waitlist is go-to-market
  machinery for a multi-tenant launch. A single-tenant install has nobody to
  gate.
- **`captable` (58) / `company` (101) / `legal` (103) → OSS.** These manage the
  *running org's own* corporate records. They fail all three questions. They
  feel commercial because they are business software, which is not the test.
- **`product` (86) → OSS, narrowly.** Product *definitions* are OSS; any price
  field on a product is `pricing` (16). Verify at implementation — if price
  lives on the product row, this becomes a BOTH.
- **`blueprint` (37) → PRIVATE.** Its own doc comment says it prices a stack
  "through a documented rate card". Documented or not, a rate card is a rate
  card. The compose→SBOM parse is OSS-able and should be lifted into `sbom`
  (68) so the private half is only the pricing.
- **`research` (89) → OSS, conditionally.** Blocked on confirming it holds no
  memos or patent drafts. If it does, those are content to remove, not a reason
  to close the subsystem.

### 3. Exclusions — the secret sauce, and why each

The tenancy line decides subsystems. These four decide *content*, and they
override it: excluded even where the surrounding subsystem is OSS.

1. **Enso routing internals** — the selection algorithm, the savings-vs-quality
   dial, the per-org enabled-models allowlist, the trainer. *Why:* it is the
   only part of the model plane a competitor cannot rebuild by reading an API
   doc. Its value is entirely in not being copyable.
2. **The Zen serving stack** (`hanzoai/zen`, `apps/zen.go`) — *Why:* the model
   family, its catalog, and the tier ladder are the product we sell.
3. **Pricing, plans, rate cards, promo and discount logic** — *Why:* publishing
   a rate card lets a competitor price against us line by line, and publishing
   the plan matrix hands them our segmentation.
4. **Memos, patents, confidential research** — *Why:* obvious, and a patent
   draft published before filing is a patent not granted.

**The OSS build still works, and AI in OSS is a client — not a seam.**

There is nothing to stub. Inference requires a provider: routing *across* models
presupposes access to those models, which presupposes an account with someone.
Enso is therefore not a capability with a degraded local mode, it is a **remote
service the client calls**. So the OSS build ships an OpenAI-compatible client
pointed at `api.hanzo.ai` by default, or at any provider configured in
`.hanzo/cloud.json`.

That interface already exists and is already the right shape: `types.AIClient`
(`types/types.go:299`) is the outbound seam, with `ChatCompletion` and `Embed`
resolving through "the SAME gateway + credential… never a static side-channel
key."

**Zero routing intelligence ships — not even an interface shape.** No dial, no
allowlist, no scoring, no selection heuristics, no catalog weights. This is
stronger than the seam it replaces: *an interface can leak a design.* Naming
`ModelRouter` with methods shaped around cost-versus-quality would publish the
architecture of the thing we are protecting, even with the algorithm removed. A
plain OpenAI-compatible client cannot leak what it does not model.

**Custom presets are a hosted feature, not a local file format.** Customers
compose and save routing presets in the SaaS console against their org; presets
live and apply server-side. A local preset format would put the router's
vocabulary — the nouns of the algorithm — into the public repo. There is no
`.hanzo/cloud.json` preset schema.

This is a deliberate **product boundary, not an omission**, and it should be
documented as one: the local stack is complete for building an application; the
routing intelligence is a hosted service, because it could not be anything else.

#### 3.0 Excluding Enso and Zen is a dependency drop, not an extraction

Verified: **no scoring or selection algorithm is in this repo.** The router
lives entirely in `github.com/hanzoai/ai`. The git history proves it — the
v1.801.140 release that shipped the allowlist and the dial (`db2e9284`) touches
`go.mod` and `go.sum` and nothing else, three lines changed. Every Enso commit
in this repo's history has that shape.

Zen is the same: `github.com/hanzoai/zen v1.4.4`, mounted through clean
interfaces (`zen.Config{Logger, Key, Tenant, Gate, Meter}`, `apps/zen.go:62`).
`apps/zen.go` is billing and tenancy glue; the serving stack is elsewhere.

So the exclusion is three edits each: drop the `go.mod` require, delete the
mount adapter (`apps/install.go` / `apps/zen.go`), remove the Wire entry. The
`cloud.ModelRouter` interface is still needed — not to *extract* anything, but
so the OSS build has a working model plane to point at an endpoint.

The real seam work is §3.2, which is where the numbers actually are.

#### 3.1 The root package leaks — must be fixed before publication

Three files in the **root package**, which is necessarily OSS, carry price
constants.

`model.go` contains both a rate card and the Zen mapping:

- Lines 23–29 disclose per-Mtok input/output prices for three tiers and the
  ratio between them.
- Lines 46–52 (`upstreamModels`) enumerate the upstream families behind the Zen
  lineage — `deepseek`, `qwen`, `glm`, `kimi`, `minimax`.

The file's own doc comment states the rule it breaks: naming an upstream on a
customer-visible surface "discloses which base sits behind an enso or zen model,
which is exactly what the Hanzo name exists to abstract." Publishing the file
is that disclosure, permanently and to everyone.

**Resolution.** The *function* is OSS — normalizing a model name at a brand
boundary is ordinary, useful, and not secret. The *table* and the price
commentary are private:

```go
// OSS: the seam. Empty by default.
func RegisterUpstreamFamilies(names ...string)
```

An OSS build registers nothing, so `UpstreamModel` is always false and
`ZenModel` is an identity function. That is the correct single-tenant behaviour
— a local developer has no Zen brand boundary to protect — and it degrades to a
no-op rather than to a lie.

Two more root-package files carry live numbers and must move behind the same
kind of seam: **`metered_ai.go`** (`defaultAIPriceUUSDPer1kTokens` line 42,
`defaultBYOFeeBps` line 289 — the platform fee on bring-your-own-key calls —
and `defaultBYOFloorMicros` line 315) and **`resource_billing.go`**
(`DefaultResourceFeeCents` line 51, the least sensitive of the three, being an
explicit policy default rather than a market price).

#### 3.2 The real seam work: native rate logic scattered across `clients/*`

The wrapped modules are clean. `clients/pricing` says so in its own header —
"pricing source + markup logic live in hanzoai/pricing. This wrapper is glue. No
pricing data or markup math is reimplemented in Go" — and `clients/plan`,
`clients/commerce`, `clients/billing`, `clients/entitlements` are the same
shape. Nothing to extract.

The problem is elsewhere: **real rate and discount logic written natively in
Go, in handler packages, behind no interface at all.**

| File | What it holds |
|---|---|
| `clients/marketing/promos.go` | Live launch promo: hardcoded Pro/Max/Team monthly list prices (`planListCents`, 44–55), promo seeding with percent-off and redemption caps (108–148), and the discount math itself (`Promo.quote`, 241–263) |
| `clients/affiliates/affiliates.go` | Full L1/L2/L3 commission schedule — `defaultRateBps` (75), `defaultMarginBps` (86), `defaultL2RateBps`/`defaultL3RateBps` (109–110), plus the clamping math |
| `clients/referrals/referrals.go` | Referral bonus amounts (62–66) |
| `clients/treasury/ledger/ledger.go:118` | `DefaultRevenueShareBps` — platform-wide creator/author share |
| `clients/admin/finance/providers.go` | `providerGrantsCents` — **a real negotiated vendor contract figure.** The single most sensitive constant found. |
| `clients/company/providers.go` | `formationFeeCents` — real product fee |
| `clients/translate/engine.go:234` | `defaultBulkPriceUUSDPer1kChars` |
| `clients/admin/digitalocean/do.go`, `clients/admin/infra/analyze.go` | `lbUnitCents`, `volumeGiBCents` — resource markup |

This corrects three of my own OSS classifications. **`marketing`, `company`, and
`translate` move to BOTH** — each is a legitimate single-tenant capability
carrying a live price constant. The seam is the same one already used
everywhere else: the OSS half does the work, the private half supplies the rate.
`clients/treasury`, `affiliate`, `referral`, and `admin` were already private.

The house style to follow already exists and is documented at `deps.go:97` —
"each is an interface with both in-process and ZAP-RPC implementations."
`types.CommerceClient` ships three today: in-process, RPC, and a fail-closed
disabled stub. That is the target shape for every rate seam.

### 4. The Composition Root — order is the hard part

`apps.Wire()` returns `[]cloud.MountSpec` and **slice position is mount order**
(`build.go:980`, `MountAll` at `build.go:1025` iterates as-given and does not
sort). Wire references each subsystem's `Mount` directly, so the compiler checks
every entry. There is no `init()` registry for subsystems — that was deliberately
removed, and this HIP does not bring it back.

**The trap.** Private subsystems do not sit at the end of the order. `commerce`
is 13th, `plan` 15th, `pricing` 16th, `provisioning` 18th, `billing` 19th — all
long before the bare `/v1/*` AI catch-all at 108. Fiber matches routes
first-registered-wins, so a private subsystem appended after `ai` never receives
a request: its routes are shadowed by the catch-all.

> A private build that appends its subsystems compiles, boots, logs every mount,
> and silently serves the wrong handler.

That is the same failure class as the release gate in §5, and it is why the
merge must be **order-preserving by position, not by append**.

**The design.** Order becomes a value, separate from implementation.

This is not new machinery. `apps/wire_test.go` already holds `frozen` — the
canonical ordered list of every subsystem, as data, described in its own comment
as "the SOLE guardian of mount order". The repo therefore already declares order
twice (the `Wire()` literal and `frozen`) with a test asserting they agree. The
split lets us delete that duplication instead of doubling it:

- `apps.Order` — one ordered `[]string`, the canonical sequence, **including
  the names of private subsystems this build does not link**. A name is not a
  secret; `commerce` and `pricing` are public route prefixes already.
- `apps.Specs()` — the OSS implementations, unordered, keyed by name.
- `apps.Compose(extra ...cloud.MountSpec) []cloud.MountSpec` — resolves `Order`
  against `Specs()` plus `extra`. A name with no implementation is skipped.

OSS build: `Compose()`. Private build: `Compose(privateSpecs...)`. Order is
declared **once**, in the public repo, and neither build can reorder the other.
`frozen` collapses into `Order`; the freeze test asserts against the thing it
was duplicating.

### 5. Couplings that break on the move

Repo identity is load-bearing at runtime in places that do not follow a GitHub
transfer.

1. **The release gate — silent, and the worst of these.**
   `clients/platform/release.go:46` pins
   `releaseRepoURL = "https://github.com/hanzoai/cloud"`;
   `clients/platform/push.go:107` gates every release on
   `sameRepo(releaseRepoURL, ev.CloneURL)`. There is **no `else` branch** on
   `if isReleasePush(ev)` in `buildFromPush` (`push.go:28`) — no log, no metric,
   no error. If the clone URL stops matching, a merge to `main` produces zero
   image, zero tag, and zero log lines. This exact failure hit v1.801.248 and
   .249: built, tagged, never rolled. The constant must become configuration
   resolved from the running deployment.

   Confirmed exhaustive: `release.go:44,45,46` are the **only** runtime string
   literals of `hanzoai/cloud` in non-test Go. Every other match repo-wide is
   prose in a comment.

2. **Tenant builds resolve a hardcoded GitHub owner.**
   `clients/git/build_on_push.go:303` — `brandGitHubOwner = {"hanzo": "hanzoai"}`
   — builds the clone coordinate for **every** native-git-triggered tenant build
   (`ghRepo := githubOwnerFor(ev.Org) + "/" + normalizeName(ev.Repo)`, line 207),
   which platform's BuildKit then clones. This is as load-bearing as (1) and has
   wider blast radius: it affects all tenant builds, not just cloud's own
   release. Two sibling bindings of the same `hanzo→hanzoai` identity:
   `clients/platform/runner.go:60,75` (registry push authorization — fails
   **closed**, so it is loud) and `clients/authors/authors.go:1015` (revenue-share
   attribution — silent misattribution).

3. **Image paths.** `ghcr.io/hanzoai/*` is org-scoped and does not follow a repo
   transfer. Beyond `release.go:44`, six more runtime literals:
   `clients/platform/k8s.go:145` (`defaultBuildImagePrefix`, env-overridable via
   `CLOUD_PLATFORM_IMAGE_PREFIX`), `k8s.go:772` (`packFrontendImage =
   ghcr.io/hanzoai/pack:latest`, **no override**, used by every
   zero-Dockerfile build), `clients/admin/infra/analyze.go:76` (first-party
   image classification), and `clients/provisioning/dedicated.go:179,205,237,263`
   (dedicated SQL/KV/datastore/docdb base images — only the *tag* is
   env-overridable, the image path is hardcoded). Plus `Dockerfile`,
   `Makefile:19`, `helm/cloud/values.yaml:8`, `deploy/compose.yml:17`,
   `hanzo.yml:21`. Per `~/work/CLAUDE.md` the canonical target is
   `oci.hanzo.ai`; the split is the moment to finish that move.

4. **Module path — the blast radius is 12 repos, not 51 files.** Raw file
   counts are inflated by ~16 live worktrees of the single `cloud` repo (this
   very tree, `cloud-wt`, is one). Deduplicated by gitdir: **12 distinct repos**
   require or replace `hanzoai/cloud` — `ai, vm, licensing, kms, commerce, o11y,
   mpc, visor, gateway, iam, ml, mcp` — and **8** reference `hanzoai/commerce`.
   The OSS module keeps the path `github.com/hanzoai/cloud`, so all 12 need **no
   edit**. That is the point of importing rather than forking. The private build
   takes a new path. Go modules stay v1.x.x; this is not a v2.

5. **The App CR.** `infra/k8s/operator/crs/cloud.yaml` pins
   `ghcr.io/hanzoai/cloud` (line 12) at `v1.801.250` (line 796). `selfHeal: true`
   is declared for the whole `crs/` directory by
   `infra/k8s/hanzo-cd/application.yaml:58-63` (`prune: false`), so a
   `kubectl edit` of the live CR is reverted on the next poll. The image change
   is a universe commit, never a manual patch.

Ordering: fix (1) and (2) **before** the move. They are the ones that fail
silently.

### 6. `hanzo cloud up`

There is already exactly one way to boot the stack locally, it works, and it is
`e2e/run.sh` — build, boot on isolated ports with a fresh data dir, wait for
readiness, seed identity, tear down. It is promoted to `hanzo cloud up`. **No
second boot path is written.**

Properties it already has, each of which was paid for once and must not be
rediscovered:

- The KMS master key must decode to **exactly 32 bytes** and be stable across
  runs against a persistent data dir. A pinned key with a stale data dir is the
  one combination that fails, and it fails as "unwrap DEK: message
  authentication failed".
- Ports come from the environment (`CLOUD_ZAP_LISTEN`, `CLOUD_HEALTH_LISTEN`),
  not flags. An unknown flag makes the binary print usage and **exit silently**.
- `/healthz` is on the health port. The HTTP port 404s it.
- The tasks ports (19999/9999) are compile-time constants, so one instance per
  host. The preflight refuses to start rather than booting with a dead drip
  engine.

`up` adds one thing: the customer console, embedded via `go:embed`, using the
existing `make e2e-ui` path — **not** the admin console, which leaves for
a private repository. The e2e suite already asserts the binary serves the real
console bundle and that it renders, so the claim is tested, not asserted.

#### 6.0 Local DX is a product goal with numbers

The OSS local stack must be **faster, lighter and better than pointing at our
cloud** for the one thing it does: one developer, one app. Not a hobbled demo
that nudges an upgrade — a stack so good it is the obvious way to develop. That
is what earns the trust that converts later.

Four commitments, each measurable, each already met or already designed:

| Goal | Status |
|---|---|
| **Fast boot** | **0.24–1.6 s**, measured, flat in subsystem count (§7.2). Already met — the "35 s" was the link step, not the boot. |
| **Zero external dependencies** | Verified: no cluster, no Docker, no broker, no cloud account, and **zero network in the boot path** (one `connect()`, to itself). A developer on a plane gets the full stack. |
| **Zero configuration** | Absent `.hanzo/cloud.json` is the normal case and yields the full experience (§7.4). |
| **No artificial limits** | No row caps, no throttles, no time bombs, no phone-home. Single-tenancy is a structural boundary (§1.5), never a crippling one. |

The one real DX friction is not boot — it is the **18–63 s relink** of a
270–375 MB binary after a one-file edit (§7.2). The fix is linking less, which
is what removing tiers 2 and 3 from the OSS build does. Publish the OSS binary's
link time as the metric to beat.

A developer must never hit a wall that exists only to sell them something. If
they do, we have built a trial, not a product.

#### 6.1 The default set — what a developer's app needs on line one

Chosen by asking what an application needs to exist, not what we happen to have
built:

**Base (data) · realtime · IAM (auth) · storage (S3/VFS) · KV · search ·
chat/agents/AI · pubsub.**

Two facts make this cheap. Base already serves `/v1/realtime` natively
alongside `/v1/base` (`clients/base/base.go:173`) — realtime needs no second
service. And pubsub is in-process NATS + JetStream (`clients/pubsub`, 111 lines,
binds `:4222`) — no broker, no Docker, no sidecar, nothing to install. It is
merely gated off today, which §7.3 fixes.

Everything else lazy-mounts on first use. In particular `git`, `deploy`, and
`platform` are **OSS-legal but not default-on**: a developer already has GitHub,
and an embedded forge plus a build pipeline on their laptop is our
infrastructure, not their product.

#### 6.2 Four ways in, one route table — already true

Nothing to build here; it needs stating and enforcing.

- **HTTP + ZAP** — `serve.go:489`, `app.Listen(cfg.ZAPListenAddr, "http://"+cfg.ListenAddr)`.
  One app, two transports, one route table.
- **MCP** — `/v1/mcp/` and `/v1/mcp/tools/call` are served natively, with 8+
  subsystems exposing MCP surfaces (agent, automations, tasks, integrations,
  framework, guide, content, destinations).
- **CLI** — the Rust `hanzo` CLI over the same `/v1` surface, via its
  OpenAPI-generated command surface.

One binary, one route table, four ways in, no cluster.

#### 6.3 Cluster access is opt-in

The default is **no cluster**, and that must need no configuration at all.

A developer who genuinely wants to deploy containers points at a kubeconfig
(k3s, kind, Docker Desktop, or a real cluster) in `.hanzo/cloud.json`, and the
cluster-gated subsystems become available.

We do **not** auto-boot k3s, and we do not ship a cluster installer. Owning an
installer means owning its failure modes on every OS, forever, for a
convenience that `k3s`/`kind` documentation already provides.

This composes with §7 rather than adding a mechanism: a cluster-gated subsystem
is one whose mount predicate includes "a kubeconfig resolves". Same seam, one
more condition. When it does not resolve, the route reports honestly that it
needs a cluster — it never crashes and never silently 404s.

### 7. Lazy subsystems

Boot must be fast and minimal, mounting work on demand.

**Two mechanisms, and they are not the same thing.** Conflating them produces a
design that cannot work.

#### 7.1 Lazy plugins (child processes) — small and safe

`zip.Load` (`~/work/zap/zip/load.go`) already composes an out-of-process plugin
as a `Service`, identical in type to a linked-in service. It is eager only
because `App.load` calls `start(spec)` inline at registration (line 242).

Everything needed for laziness is already there:

- Routes register **once**, via `a.mountVia(pre, p.target)`, and resolve their
  target per request. The route table is never mutated.
- `target()` already returns `(nil, "")` when no instance is current — that is
  how `Unload` leaves a prefix answering 503 without touching the router.
- `stop(nil, …)` is nil-safe, so shutdown of a never-started plugin already
  works and stays LIFO with no new code.

So the lazy variant swaps *which function is handed to `mountVia`* and skips the
eager start:

```go
// LoadLazy is Load, deferred: registration claims the prefixes and starts
// nothing. The first request to any of them starts the child and waits for it.
func LoadLazy(p Plugin, prefixes ...string) Service
```

with a start-on-demand target that takes `p.mu` — the mutex already documented
as serializing lifecycle transitions — double-checks `p.cur`, starts, stores,
and supervises. Decisions:

- **Single-flight**: the mutex. N concurrent first-requests spawn exactly one
  child; the rest wait on it.
- **First request blocks**, bounded by the existing `Plugin.Start` (default
  10s). No new timeout knob. A silent 503 on first use looks like a broken
  product; honest latency does not.
- **Failure is not cached.** A failed start stores nothing, so the next request
  retries. A transient download failure must not poison a prefix for the life of
  the process.
- `Plugin.URL` **without `Sum` stays refused**. Fetching and executing code is
  the one place a plugin host becomes an arbitrary-code-execution vector. This
  property is not weakened for laziness.

`zip` v1.10.3 → **v1.10.4**. Patch.

#### 7.2 Lazy subsystems — WITHDRAWN. There is no 35-second boot.

This section proposed deferring `spec.Mount`, gated on measuring where the 35
seconds went. The measurement came back and the premise was false. Withdrawing
it rather than building it.

**Boot is 0.24–1.6 seconds**, exec to `{"message":"listening"}`. `/healthz`
answers 15–22 ms later. No configuration reached 35 s — not fresh, not
cold-cache, not all 108 subsystems.

**Boot is flat in subsystem count**, which refutes the per-subsystem
SQLite-open + DEK-unwrap + migration hypothesis outright:

| Enabled | Subsystems | Boot |
|---|---:|---:|
| `kms` | 1 | 0.264 s |
| `iam,kms` | 2 | 0.462 s |
| `iam,base,kms,marketing,notify` | 5 | 0.259 s |
| *(no flag → all)* | **108** | **0.527 s** |

1 → 108 subsystems costs +0.26 s. DEK unwrap is real and costs ~1 ms per
database. Fresh-vs-warm delta is zero; there is no one-time migration.

**70 % of boot happens before the first log line** — package `init()`, paid
because the packages are *linked*, not because they are mounted. `GODEBUG=
inittrace=1`: 1819 packages with `init()`, 226.6 ms of init, 140.6 MB allocated
before `main`. It is CPU-bound (100 % CPU, 18 major faults), and strace shows
**exactly one `connect()`** — to its own in-process tasks engine — with zero DNS
or JWKS or registry traffic. There is no network in the boot path at all.

Lazy mounting could reach only the ~0.16 s of deferrable mount work. **It would
save 0.16 s of a 0.4 s boot, at the cost of a silent-failure class.** Not worth
building. The dangerous version of this change — deferring a `Mount` that also
installs `cloud.RegisterPushBuilder`, so a git push silently triggers no build —
is now simply avoided rather than guarded.

**The 35 seconds is the Go link step**, which `e2e/run.sh` runs on the line
before it boots:

| | |
|---|---:|
| `make native` (cargo, warm) | 0.86 s |
| `make build`, fully cached | 0.7–3.4 s |
| forced relink, `CGO_ENABLED=0` | 18.6 s |
| edit one file in package `cloud` | 17.5 s |
| forced relink, `CGO_ENABLED=1` | **62.9 s** |

A 270–375 MB binary. Stopwatch from harness start to ready lands at ~20 s or
~65 s depending on CGO, and 35 s sits inside that band.

**The lever is linking less — which is exactly what this HIP does.** The
strongest single example: `hanzoai/commerce/models/types/country` costs **106 ms
and 64 MB of package init, and is paid even when commerce is disabled**, because
it is linked. `clients/guide` costs another 43 ms / 29 MB. Removing the private
subsystems from the OSS binary removes their init cost and their link cost
outright — not deferred, gone.

So the open-core split *is* the boot-time optimisation. It was justified on
tenancy and it pays here too.

#### 7.2.1 Two defects found while measuring

Neither is latency; both are worth fixing.

1. **Tasks-port contention fails silently-soft.** A second instance boots
   successfully in 0.499 s, logs one warning
   (`tasks.Embed: zap start: failed to listen: listen tcp :19999: bind: address
   already in use`), and continues with durable ingest fallen back to inline and
   the drip engine idle. Green boot, dead subsystem. This is the exact trap
   `e2e/run.sh`'s preflight was written to catch, which means the harness is
   compensating for a binary that should refuse to start.
2. **Commerce mounts with an error under the all-on config:**
   `commerce.Embed: bootstrap: failed to initialize system database: … resolve
   encryption key for tenant "system"`. It fails fast, but the revenue plane is
   degraded behind a boot that reports healthy.

#### 7.3 Enable-gates die; lazy mounting replaces them

An enable-gate is a pre-lazy-loading workaround. Once a subsystem mounts on
first request, "is it enabled" stops being a question — an unused subsystem
never mounts and costs nothing. Keeping both is two mechanisms for one job.

Five ad-hoc gates exist. **Three die, one dies on security grounds, and one must
survive because it is not a gate at all.**

| Gate | Verdict |
|---|---|
| `CLOUD_PUBSUB_ENABLED` (`clients/pubsub`) | **Kill.** In-process NATS+JetStream — nothing to install, no sidecar. Default ON is the promise of "realtime wired out of the box". |
| `CLOUD_NATIVE_CICD_ENABLED` (`clients/git`) | **Kill.** Lazy mounting answers it. |
| `CLOUD_KAFKA_ENABLED` (`clients/kafka`) | **Kill the gate and the subsystem.** See below. |
| `CLOUD_AUDIT_DISABLED` (`audit_serve.go`) | **Kill — security.** See below. |
| `CLOUD_INGRESS_EDGE_ENABLED` (`clients/ingress`) | **Keep.** It is not a gate. |

**`clients/kafka` is dead code.** 142 lines, gated off by default as "a staged
cutover", and imported by exactly one file: its own `Wire()` entry in
`apps/apps.go:106`. `clients/pubsub` references it only in comments. Nothing
calls it. In a codebase whose pubsub is in-process NATS, an external-broker
wire adaptor that has never been switched on is not a migration candidate — it
is a delete.

**`CLOUD_AUDIT_DISABLED` must go, and not because of lazy loading.** An audit
trail with an off switch is not a tamper-evident record. Worse, the switch has
already leaked into security reasoning elsewhere: `clients/admin/core/grant.go:150`
carves out the disabled case because "moving money is not a supported op" under
it. That is a second, weaker security mode that every future author must
remember exists. Delete the mode. Its stated purpose — "a minimal single-service
dev run" (`audit_serve.go:11`) — is served by `hanzo cloud up`, which always
provisions a data dir. Audit becomes non-optional in both builds.

**`CLOUD_INGRESS_EDGE_ENABLED` fails the deletion test, by the test's own
terms.** It does not answer "should this run" — it selects a *role*: unset is
the app role serving `/v1/ingress`, set is the edge role that additionally binds
the `:80`/`:443` data plane (`clients/ingress/ingress.go:11-15`). That is "how
should this run", which the rule preserves. It should be restated as an explicit
role rather than a boolean, but it does not die here.

The same test retires `stagedSubsystems` (`config.go:597`), which asks the same
"should this run" question in a third way.

#### 7.4 One config surface: `.hanzo/cloud.json`

Two scopes, both already established conventions — 50 repos under `~/work/hanzo`
carry a project-local `.hanzo/` holding `workflows/`, and `~/.hanzo/` already
holds `auth.json`, `credentials.json`, `identities.json`, `agents/`, `backups/`.
No third thing is invented.

- **`.hanzo/cloud.json`** — project-local, committed, **the primary surface**. A
  project declares what it needs; the team shares it through git; it sits beside
  `.hanzo/workflows/`. Two files, one directory, one convention.
- **`~/.hanzo/cloud.json`** — user-global, optional. Per-developer preferences
  that should not be committed: pin a subsystem to a local build, disable
  something heavy on a laptop.

Identical schema in both, so there is one format to learn.

```
built-in defaults → ~/.hanzo/cloud.json → .hanzo/cloud.json → deployment flags/env
```

Nearest scope wins. **Absent files are the normal case** and must produce the
full correct experience: a developer who never writes either gets everything,
lazy-mounted on demand.

It is an **override file, not a manifest**. It expresses only deviations —
disable X, pin Y eager, point Z at a local `Path`/`Addr` instead of a downloaded
release, which composes directly with the `zip.Plugin{Path, Addr, URL, Sum}`
shape that already exists. A config surface grows to fill whatever shape it is
given; this one is given a narrow one.

**Not folded into the existing `~/.hanzo/config.json`.** That file today holds
one thing — a live `sk-` API key. It is a credential store, not a config file,
and mixing subsystem policy into a secrets file is how secrets end up
committed. (Separately: that key is sitting in plaintext on disk and belongs in
KMS. Out of scope here, worth fixing.)

**`--enable=` survives, narrowed.** It is load-bearing for production today —
the universe CR uses it to run role-specialised pods — and for the e2e harness.
But it stops being the mechanism that answers "should this run" and becomes the
deployment-time override at the end of the resolution chain. Empty means "all,
lazily", which is already its behaviour. One concept, one schema, one documented
precedence order — not three mechanisms.

### 8. Conformance — the guard

A line nobody checks is a line that moves. The OSS repo carries a test that
fails if excluded material appears.

**Two boundaries, one guard.**

- **(a) Tier 3 never appears in the public repo — including `ee/`.** No Enso,
  Zen, pricing, plans, or patent material anywhere under a published path.
- **(b) OSS never imports `ee/`.** Otherwise the permissive build silently
  acquires a dependency on licensed code, which breaks the Apache tier and the
  carve-out at once. This is the failure that turns an open-core repo into a
  license incident.

There is a working precedent for (b) in this repo already: `clients/controlplane`
is `//go:build controlplane`, excluded from the default build graph, and CI's
`containment` job proves it can never reach a release binary
(`.hanzo/workflows/cicd.yml` checks `go list -deps` for the package). The `ee/`
guard is that same mechanism pointed at a directory instead of a build tag —
extend the existing job rather than adding a second one.

**It parses, it does not grep.** A grep guard matches its own explanatory
comment, so the first thing it teaches is how to word around it — which is
strictly worse than no guard, because it produces confident green. The guard
uses `go/ast` and inspects declarations:

- **No import** of a private module: `hanzoai/zen`, `hanzoai/commerce`,
  `hanzoai/licensing`, or any `hanzo-inc/*` path.
- **No identifier** naming excluded concepts (routing policy, rate card, plan
  matrix) in a declared name — checked on AST identifiers, so comments and
  strings are structurally out of scope and cannot trip it.
- **No numeric literal** in a price-shaped context: a const or var whose name
  matches a price/rate/cents pattern must not have a literal initializer.
- **No cross-tenant handler**: a route handler must take its org from the
  validated principal, never from a path or query parameter. This is the §1.1
  question 3 test, and it catches real isolation bugs as a side effect.

**A guard never seen to fail is not evidence.** The guard ships with a test that
injects each violation class into a synthetic AST, asserts the specific
diagnostic, and restores green. Proving it fires is part of the deliverable, not
a follow-up.

### 9. Security finding — the exclusion is already breached

Stated here because it changes what this HIP is for.

**The Enso router is already public.** `github.com/hanzoai/ai` is a public
repository. As of this writing the following are readable without
authentication at `raw.githubusercontent.com/hanzoai/ai/main/`, all returning
HTTP 200:

```
router/routing_policy.go      router/policy.go          router/client.go
routers/router.go             routers/filter_balance.go
controllers/router_trainer.go controllers/router_policy.go
object/family_routing.go      object/provider_zen.go
object/model_access.go        object/org_settings.go
```

`router/routing_policy.go` exports `RouteDecisionFor(ctx, req, slo, rp
RoutingPolicy) Decision` and `overrideModel(task, enabled func(string) bool)` —
the routing decision function and the per-org enabled-models allowlist named in
the exclusion list. `controllers/router_trainer.go` is the trainer.
`routers/filter_balance.go` is the balance gate.

No rate card was found in that repository, so the pricing exclusion appears
intact there. The routing exclusion is not.

Designing an open-core boundary to protect this while it is served publicly is
theatre. **Resolving the existing exposure is a prerequisite for the split, not
a follow-on.**

#### 9.1 This does not decompose into two problems

It has been suggested that repo visibility and "does routing intelligence live
there" are separate concerns that happen to share a repo. They are not. The
routing intelligence **is** there, today, publicly readable — that is one
problem, verified by fetching the files without a token. It resolves only when
the code moves out. Until then, `hanzoai/ai`'s visibility is not a separable
question, it is the mechanism of the exposure.

#### 9.2 The tier-3 reclassification makes this more urgent, not less

Enso is now classified tier 3: proprietary, invisible, **possibly
patent-bearing** (§10.4 of the exclusions rationale, and the CTO's own framing).

That changes the character of the finding. A trade secret is defined by the
effort taken to keep it secret, and published source is the clearest possible
evidence of the opposite. Separately — and stated as a flag for counsel, not as
a legal opinion, which I am not qualified to give — **public disclosure interacts
with patent filing windows in most jurisdictions**, and a public GitHub
repository with commit timestamps is an unusually well-documented disclosure
record.

If there is any intention to file on the routing work, the exposure date is a
fact someone needs to establish, and `git log` on those eleven files establishes
it precisely. **This should go to counsel before it goes into a sprint.**

### 10. Every OSS component is three things

This reframes what the OSS tier *is*, and it is the difference between "here are
the packages that make up our monolith" and a set of products.

**Each OSS fork is three things at once, from one codebase:**

1. **A standalone product** — its own binary, its own dashboard, its own domain.
   Useful to someone who wants only that one thing.
2. **A plugin** — compiles to a `zip.Plugin` the cloud binary mounts for local
   development.
3. **An enterprise component** — consumed by the hosted service in SaaS mode.

What makes one codebase serve all three is **ZAP-native mounting**: a fork
exposes a `zip` Service, and linked-in, `ee/`-composed, and
downloaded-plugin are then the *same type* (§7.1). No adapter, no second entry
point, no build matrix.

#### 10.1 The conformance shape

Derived from `hanzoai/tasks`, which is the exemplar — live at `tasks.hanzo.ai`,
and the durable engine cloud already runs the marketing drip on.

| Requirement | Why |
|---|---|
| `cmd/` — a standalone binary | Role 1. It runs on its own or it is not a product. |
| `ui/` — its own dashboard, `@hanzo/ui` on `@hanzo/gui` | **Svelte forbidden.** A product with no face is a library. |
| **ZAP-native** — mounts as a `zip` Service | Role 2+3. This is the property that collapses the three roles into one build. |
| **Hanzo IAM native** | Auth is the platform's. Never a second identity system. |
| A published release artifact | Makes `zip.Plugin{URL, Sum}` work. |
| Its own domain, when user-facing | `tasks.hanzo.ai`. |
| A JS client package, where a browser or Node consumer needs one | Not every fork needs one. |

#### 10.2 Audit — measured, and better than expected

Current visibility of the developer-facing stack:

| Repo | Visibility | Language | `cmd/` | Own UI |
|---|---|---|---|---|
| `hanzoai/tasks` | **PUBLIC** | Go | yes | `ui/` + `sdk/` |
| `hanzoai/base` | **PUBLIC** | Go | yes | `ui-react/` + `sdk/` |
| `hanzoai/git` | **PUBLIC** | Go | yes | `web_src/` |
| `hanzoai/deploy` | **PUBLIC** | Go | yes | `ui/` |
| `hanzoai/ai` | **PUBLIC** | Go | yes | `web/` |
| `hanzoai/cloud` | private | Go | — | `webui/` |
| `hanzoai/console` | private | TypeScript | — | — |
| `hanzoai/openapi` | private | Python | — | — |
| `hanzoai/platform` | private | TypeScript | — | — |

**All five public forks already conform.** Every one ships `cmd/` and its own
web surface. The three-roles pattern is not aspirational — it is already
universal across the developer stack, and this HIP documents it rather than
proposing it.

The only defect is **naming drift**: `ui/`, `ui-react/`, `web/`, `web_src/` are
four names for one concept. Converge on `ui/`. That is the whole remediation.

Two corrections to claims I was asked to carry:

- **`@hanzo/tasks` does not exist on npm** — the registry returns 404. Do not
  cite it. `hanzoai/tasks` does ship an `sdk/` directory; if a published JS
  client is wanted, it needs publishing under a verified name, and the claim
  should not be repeated until it resolves.
- **`hanzoai/platform` is not stale.** It was pushed *today*
  (2026-07-27T23:18Z) and is described as "Hanzo Platform — unified PaaS for
  deploying AI applications". So there are two live things called Platform: this
  TypeScript repo, and the Go `clients/platform` subsystem the CTO just moved to
  OSS (§2.5). I will not guess which is canonical on this evidence — "shares a
  name" is not "same product", and calling an actively-developed repo legacy
  would be exactly the wrong call. **This needs a direct answer from whoever
  owns it**, and it is the one open question blocking the `platform` OSS move.

#### 10.3 Resolving the two directives that look contradictory

"Hold back as much as we can" (§2.0) and "everything a developer touches must be
open" are not in conflict once scoped:

> **The hold-back rule governs the commercial side only. It resolves ambiguity
> within tiers 2 and 3. It is never a reason to close something a developer
> needs.**

- **Developer-facing → OSS, public.** `ai`, `base`, `tasks`, `git`, `deploy`,
  `platform`. Openness is the product.
- **Commercial / multi-tenant → `ee/` or private.** Enso internals, Zen, pricing,
  plans, admin, metering and royalty.

Applied, this **reverses several of my §2.2 hold-backs**: `git`, `code`,
`index`, `analytics`, `websearch`, `graph`, `deploy`, and `cron` are developer
stack and go **OSS**. `git` and `deploy` are already public repos, so holding
back their in-cloud subsystems would have been incoherent. The hold-back list
now contains only Hanzo's own business applications and the commercial plane.

#### 10.4 Two consequences

**The plugin work gets cheaper, not larger.** Because each fork already builds
its own release binary, `zip.Plugin{URL, Sum}` has an artifact to point at
today. §7.1's `LoadLazy` becomes the last small piece of an existing pipeline
rather than the start of a new one.

**The OSS tier is not a hollowed-out core.** Each component is a real product
with its own users, and the hosted service composing them in SaaS mode is *one
more consumer*, not the only one. That is also the honest answer to "is this a
real open source project or a lead magnet" — five of them already run
standalone.

This reconciles cleanly with the k8s finding (§2.3): a standalone `platform`
binary that degrades honestly without a kubeconfig is exactly the wanted shape —
it runs locally, embedded or standalone, and gains cluster features only when a
cluster is configured.

#### 10.5 `console` and `openapi` — recommendations, not flips

- **`openapi` → make it PUBLIC.** A private API contract is a strange artifact:
  it is the thing SDK generation and customer integration consume, and every
  route it describes is already reachable on `api.hanzo.ai`. It documents a
  public surface; keeping the description private protects nothing and obstructs
  the integrators we want. Check it for unreleased-endpoint leakage first — that
  is a real risk and the only one.
- **`console` → keep private for now, revisit.** It passes the tenancy line (it
  is a client), so there is no correctness reason to hold it. But it is the
  customer UI whose admin surfaces are gated by SuperAdmin checks, and it is
  `go:embed`-ed into the cloud binary. Publishing it is a real project — auditing
  what the gated modules reveal — with a smaller payoff than `openapi`. Sequence
  it after the split lands.

### 11. Licensing

> **Not legal advice.** The structure below is drafted by mirroring an existing
> house license. It must be reviewed by counsel before publication. Nothing here
> should be treated as legally sound as written.

#### 11.1 The house pattern already exists — mirror it

`luxfi/aml` carries the **Lux Ecosystem License v1.2**, documented in its
`LICENSING.md` as the patent-protected tier of a three-tier IP strategy: free
for Authorized Networks, free for Research Use (explicitly including
*evaluation*), commercial use outside that requires a paid license, with a
canonical strategy doc in `luxfi/.github` and a `licensing@` contact.

Hanzo has no equivalent — `hanzoai/.github` documents Zen but no licensing
tiers. We draft the **Hanzo Ecosystem License** mirroring Lux structurally, with
one substitution: Lux's carve-out is *network* ("Authorized Network"); ours is
*competition* ("Competing Service"). That is the BSL / Elastic / Confluent
shape — free to use, not free to compete.

#### 11.2 The three grants

| Use | Grant |
|---|---|
| Local development, evaluation, research, education | **Free, unlimited, forever.** |
| Internal use — running it for your own organization, on your own servers | **Free, unlimited.** Including production. |
| Operating a **Competing Service** — multi-tenant SaaS, a hosted offering, reselling | **Prohibited without a paid license.** |
| White-labeling, or running SaaS on it commercially | **Available under a paid license.** |

The last row matters as much as the third. White-label SaaS is a **product we
sell**, not a thing we forbid. The license should make the paid path obvious and
attractive; an adversarial license loses the customer before the conversation
starts.

"Internal use is free, including production" is deliberate and generous. A
company running Hanzo for its own employees is not competing with us, and
charging them converts a advocate into an evaluator who leaves.

#### 11.3 File layout

```
LICENSE            Apache-2.0. MUST explicitly carve out ee/.
ee/LICENSE         Hanzo Ecosystem License v1.
ee/LICENSING.md    Plain-language tier explanation + licensing@hanzo.ai.
hanzoai/.github    Canonical strategy doc, mirroring luxfi/.github.
```

Every file under `ee/` carries a header identifying it as licensed, not Apache.

**The root-license carve-out is the single most common way this pattern fails.**
An ambiguous permissive license sitting above a proprietary subtree is read, in
practice, as permissive over everything. State the exclusion in the root LICENSE
itself, not only in a README.

#### 11.4 Runtime enforcement — what is actually enforceable

Being straight about this, because the alternative is security theatre:

- **A license check in the binary is not enforcement.** Anyone with the source —
  which, by design, is everyone — can remove it in an afternoon. Shipping one
  and calling it protection is worse than shipping none, because it produces
  false confidence and invites the removal.
- **What actually works is the legal instrument plus the build.** The OSS binary
  does not contain `ee/`. A company that wants multi-tenancy either buys the
  licensed build or knowingly compiles licensed code themselves — and the second
  is a deliberate, documented, provable act, which is exactly what makes a
  license enforceable in the only forum that matters.
- **What is worth building** is honest identification, not obstruction: an EE
  build reports its license state on `/v1/health` and in its boot log, so an
  operator can see what they are running and an auditor can too. That is a
  compliance aid, not a lock.

No phone-home. No time bomb. No usage telemetry as a gate. Those punish honest
customers and are trivially defeated by dishonest ones.

### 12. Sequencing

1. Fix the release gate (§5.1) — it fails silently and it fails now.
2. Resolve the `hanzoai/ai` exposure (§9).
3. Land `apps.Order` / `Compose` (§4) in the current repo, with `frozen`
   collapsed into it. No files move; the composition root simply stops
   declaring order twice.
4. Land the `model.go` seam (§3.1).
5. Land the guard (§8) and prove it fires.
6. Move `clients/admin/*` to a private repository.
7. Split the module.

Steps 1–5 are valuable if the split never happens, which is the property a good
migration plan has.

## Copyright

Public domain (CC0).
