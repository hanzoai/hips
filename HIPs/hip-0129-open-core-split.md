---
hip: 0129
title: "Open-Core Split — the Tenancy Line, the Composition Root, and Lazy Subsystems"
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-07-27
requires: HIP-0106, HIP-0127
---

# HIP-0129: Open-Core Split

## Abstract

`hanzoai/cloud` becomes two builds and stays one codebase.

```
hanzoai/cloud     PUBLIC   runtime + single-tenant subsystems + customer console.
                           A developer runs it on a laptop and gets a real stack.
                             ↑ imported as an ordinary Go module by
hanzo-inc/cloud   PRIVATE  a main.go that adds the multi-tenant subsystems.
                           One binary. Runs production.
hanzo-inc/admin   PRIVATE  the operator console. Not in either binary's OSS half.
```

Not a fork. Not a vendor drop. One module import, one composition root, one
order.

The line is **tenancy**, not feature. The exclusions are **pricing, plans,
routing intelligence, and the Zen serving stack**. Everything else a customer
gets, because a crippled demo teaches nobody and converts nobody.

## Motivation

Two forces meet here.

A developer cannot evaluate Hanzo by reading marketing. They evaluate it by
running it. Today running it means a Kubernetes cluster, a KMS, an IAM, and a
Cloudflare account — so nobody evaluates it. `make e2e` already proves the
binary boots standalone in seconds on a laptop with none of those. That
capability exists and is not shipped.

Against that: the parts of this system that took the longest to get right are
the parts a competitor would most like to read. The router that picks a model,
the rate card, the plan matrix. Those are the business.

Open core resolves it, but only if the line is drawn on a property that can be
**tested**, not negotiated per subsystem. This HIP defines that property.

## 1. The Line

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

### 1.1 The Test

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

### 1.2 Why not "feature"

A feature line ("advanced features are paid") requires a judgement call per
feature forever, and every call is relitigated by whoever wants their subsystem
on the other side. A tenancy line is a property of the code. It answers itself.

It also matches what customers actually pay for. Nobody pays for a chat
endpoint. They pay to not operate the thing.

## 2. Classification

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
| 48 | marketing | Audience + roster. (Campaign *metering* is separate — §3.) |
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
| 93 | admin | Cross-tenant authority. → **`hanzo-inc/admin`**, its own repo. |
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
it.** `usage` records tokens; `metering` rates them. `ads` launches a campaign;
`campaign` meters it. That is one interface repeated, not seventeen designs —
and it is the right seam because recording and pricing are genuinely different
concerns that were braided together for convenience.

### 2.1 Ambiguous — decided, with the reasoning exposed

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

## 3. Exclusions — the secret sauce, and why each

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

**The OSS build still works.** It defines `cloud.ModelRouter` and ships a
straightforward default: send the request to the configured endpoint. A
developer points it at any OpenAI-compatible URL and gets a real, working model
plane. They do not get our routing judgement. That is the deal, stated plainly,
and it is honest — the interface is not a stub that returns an error, it is a
real implementation of the obvious policy.

### 3.1 `model.go` leaks into the OSS half — must be fixed before publication

`/home/z/work/hanzo/cloud-wt/model.go` is in the **root package**, which is
necessarily OSS. It currently contains both a rate card and the Zen mapping:

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

## 4. The Composition Root — order is the hard part

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

## 5. Couplings that break on the move

Repo identity is load-bearing at runtime in places that do not follow a GitHub
transfer.

1. **The release gate.** `clients/platform/release.go:46` pins
   `releaseRepoURL = "https://github.com/hanzoai/cloud"`, and
   `clients/platform/push.go:107` gates every release on
   `sameRepo(releaseRepoURL, ev.CloneURL)`. If production builds from
   `hanzo-inc/cloud`, the clone URL stops matching and **releases stop firing
   with no error** — the push lands, the build runs, the tag is cut, and nothing
   rolls. This exact failure occurred on v1.801.248 and .249: built, tagged,
   never deployed. The constant must become configuration resolved from the
   running deployment, not a literal.
2. **Image paths.** `ghcr.io/hanzoai/*` is org-scoped and does not follow a repo
   transfer. Per `~/work/CLAUDE.md` the canonical push target is
   `registry.hanzo.ai` regardless; the split is the moment to finish that move.
3. **Module path.** 51 `go.mod` files reference `hanzoai/cloud` and 34
   reference `hanzoai/commerce`. The OSS module keeps the path
   `github.com/hanzoai/cloud` — that is the point of the split, and it means
   **51 files need no edit**. The private build takes a new path and imports the
   public one. Go modules stay v1.x.x; this is not a v2.
4. **The App CR.** `infra/k8s/operator/crs/cloud.yaml` pins the image and is
   reconciled with selfHeal, so a manual edit reverts. The image change is a
   universe commit, never a `kubectl edit`.

Ordering: fix (1) **before** the move, not after. It is the one that fails
silently.

## 6. `hanzo cloud up`

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
`hanzo-inc/admin`. The e2e suite already asserts the binary serves the real
console bundle and that it renders, so the claim is tested, not asserted.

## 7. Lazy subsystems

Boot must be fast and minimal, mounting work on demand.

**Two mechanisms, and they are not the same thing.** Conflating them produces a
design that cannot work.

### 7.1 Lazy plugins (child processes) — small and safe

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

### 7.2 Lazy subsystems (linked-in) — where the 35s actually is

The 109 subsystems are linked-in Go packages, not plugins. Making plugins lazy
does not change their boot cost by one millisecond. If boot time is per-subsystem
`Mount` work, the fix is deferring `spec.Mount`, and that is a different and
more dangerous change:

> **A subsystem's `Mount` does more than register routes.**

`platform.Mount` installs the push-to-deploy builder that `clients/git` invokes
(`cloud.RegisterPushBuilder`). `apps/wire_seams.go` binds channels, dispatchers,
and signal probes across packages. If `platform` mounts lazily and no request
has yet hit `/v1/platform`, a git push triggers **no build** — silently. That is
the §5 failure again, manufactured on purpose.

**Conformance rule.** A subsystem may be lazy only if its `Mount` registers
nothing but routes on its own declared prefixes — no cross-subsystem seam
registration, no background worker, no bus consumer. That is a checkable
property and the guard (§8) checks it. Every other subsystem stays eager.

**This is deliberately gated on measurement.** A boot profile is in flight. If
the 35s turns out to be one fixed cost — a network timeout, a single migration —
then lazy subsystem mounting is the wrong fix and this section is withdrawn
rather than implemented for its own sake. The plugin work in §7.1 stands either
way, because it is correct independent of the boot number.

### 7.3 Configuration

Lazy by default, overridable per subsystem: eager, disabled, or pinned to a
local `Path`/`Addr` instead of a downloaded release.

**One file: `~/.config/hanzo/config.toml`.** That is the canonical Hanzo CLI
config and it already documents itself as "one file, one source of truth", with
cross-process locking and atomic replace. Subsystem policy is a new `[subsystems]`
table in it.

**Not `~/.hanzo/`.** That directory is already a junk drawer holding three
different config files — `config` (JSON), `config.json` (JSON), and
`config.toml` (TOML) — belonging to three different tools. Adding a fourth
mechanism there would be the exact opposite of one way to do everything.

Resolution order, highest wins: explicit flag → environment →
`~/.config/hanzo/config.toml` → default (lazy).

## 8. Conformance — the guard

A line nobody checks is a line that moves. The OSS repo carries a test that
fails if excluded material appears.

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

## 9. Security finding — the exclusion is already breached

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
a follow-on**, and it is a decision about `hanzoai/ai`'s visibility that belongs
to the CTO. This HIP does not presume the answer; it refuses to pretend the
question is closed.

## 10. Sequencing

1. Fix the release gate (§5.1) — it fails silently and it fails now.
2. Resolve the `hanzoai/ai` exposure (§9).
3. Land `apps.Order` / `Compose` (§4) in the current repo, with `frozen`
   collapsed into it. No files move; the composition root simply stops
   declaring order twice.
4. Land the `model.go` seam (§3.1).
5. Land the guard (§8) and prove it fires.
6. Move `clients/admin/*` to `hanzo-inc/admin`.
7. Split the module.

Steps 1–5 are valuable if the split never happens, which is the property a good
migration plan has.

## Copyright

Public domain (CC0).
