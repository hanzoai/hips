---
hip: 0512
title: Benchmark Arena, Verified Commons, and the Enso Router — Measure, Adjudicate, Route
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-07-22
requires: HIP-0001, HIP-0111, HIP-0510, HIP-0511
---

# HIP-512: Benchmark Arena, Verified Commons, and the Enso Router

## Abstract

This proposal specifies three composable layers that turn Hanzo's position as the
unified AI gateway into an empirical model-intelligence system:

1. **The Benchmark Arena** (`/v1/benchmark`) — a first-class primitive, sibling to
   `/v1/eval`, that runs the canonical public benchmarks against any model or endpoint
   under **one standardized harness** and, provenance-first, layers a provider's
   **published claim** against Hanzo's **measured** result. The gap between them is the
   product: a leaderboard where every number is *reproducible*, not marketing.

2. **The Verified Commons** — because Hanzo *executed* every run through its own
   harness, a run is verifiable. Consented runs aggregate into a public arena where the
   community trusts the numbers precisely because Hanzo produced them, not the vendor.

3. **The Enso Router** — the learned layer HIP-0510 anticipated, specified here as
   three orthogonal models over one growing dataset: **Verified Memory** (reuse the
   known answer on a seen or equivalent question), **Scout** (predict champion-relative
   arm uplift *before* calling, from prompt prefill activations), and **Critic** (read
   candidate responses and select the correct one or abstain), composed by a
   **Controller** that decides whether to stop, challenge, or purchase another response.

The layers share one append-only, provenance-first store: the Arena *produces* labeled
outcomes, the gateway *produces* unlabeled usage, and the Router *consumes* both. The
thesis, earned from measurement rather than assumed: **routing is not "predict one
winner from an embedding"; it is learning when to purchase additional intelligence
under a cost, latency, and risk contract.**

## Motivation

Two measured facts from Hanzo's own harness set the direction.

**Published numbers are not measured numbers.** Under one standardized single-attempt
harness on GPQA-Diamond, provider-reported scores run materially hot: a model card's
94.6 measures 81.3 here (a +13.3 gap); Fugu's reported 95.5 measures 94.4 (answered) /
91.9 (fault-inclusive). The gap is not noise to average away — it is the difference in
prompting, pass@k, tools, exclusions, and unpublished scaffolding, and surfacing it is a
product no vendor can offer about itself. A neutral arena that can **replicate or
disprove** any provider's claim is a defensible position only the unified gateway holds.

**The routing win is not yet detectable at current data scale.** Selecting one model per
request is bounded by the pool's per-item oracle (98.5% on the current pool) and by
whether *which model wins* is predictable before the call. Measured on 198 questions, on
the correct objective — recovery minus damage, grouped cross-validation, a 400-permutation
null — a question-only router shows **no detectable positive policy value: Δ = −1.06pp,
p = 0.611** (0.7 recoveries against 2.8 damages). Failure to reject the null is *not* proof
routing is impossible; it is the honest state at n=198. The **leading diagnosis** is data
scarcity, not an algorithm ceiling — to be *confirmed* by a learning curve as the
independent-question count grows, not assumed. The activation-based routing literature
reaches useful accuracy (mean per-model AUC ~0.856) on ~10⁴ outcomes per model, not ~10²,
which is why the first lever is a **data plane** that grows the labeled corpus.

These compose: the Arena is how the labeled corpus grows honestly, the gateway is how the
unlabeled corpus grows continuously, and the Router is what the corpus is *for*.

## Specification

### 1. The Arena primitive (`/v1/benchmark`)

A native surface on the unified cloud binary (HIP-0112), mounted beside `/v1/eval`. The
division of labor is orthogonal: **`/v1/eval` scores *your* data with *your* judge;
`/v1/benchmark` scores the *canonical public tests* for cross-model comparison.** One
sentence, no overlap.

```
GET    /v1/benchmark/catalog              the canonical benchmark set + native-support flags
GET    /v1/benchmark/leaderboard?benchmark= per-model measured ∥ published, coverage-aware
GET    /v1/benchmark/compare?a=&b=        paired common-set (rescue/damage + exact McNemar)
POST   /v1/benchmark/runs                 run a benchmark against a model or BYO endpoint
GET    /v1/benchmark/runs/{id}            run state + progress + reconciled cost
GET    /v1/benchmark/runs/{id}/attempts   per-item attempts (the evidence)
POST   /v1/benchmark/runs/{id}/cancel     item-granular cancellation
POST   /v1/benchmark/runs/{id}/retry      selective retry of faulted items
GET/POST /v1/benchmark/presets            author a router blend, served as enso-<name>
```

The **canonical set** is the benchmarks every major provider reports and the set needed
to replicate-or-disprove the strongest published orchestrators: GPQA-Diamond, Humanity's
Last Exam, LiveCodeBench (+ Pro), SWE-Bench (Verified + Pro), Terminal-Bench, MMLU-Pro,
AIME/MathArena, MMMU-Pro, CharXiv, τ²-Bench, SciCode, MRCRv2. Each is a versioned
`benchmark_revision` (exact dataset, split, label, scoring revision); a run pins one so a
later label dispute is a new score, never a rewrite.

### 2. Provenance, never blended

Three planes are stored and displayed separately; blending them is the error the arena
exists to prevent:

- **`published_claim`** — a provider-reported aggregate, tagged with its protocol
  (single-attempt / pass@k / agentic / unknown), sample size, exclusions, and source.
- **`hanzo_measured`** — an attempt through Hanzo's harness: raw response, extracted
  answer, tokens, cost, latency, faults, harness commit.
- **`score_event`** — correctness derived from an attempt under a grader + label
  revision. A re-score adds a new event; the raw response is immutable.

Coverage travels with every measured number: an arm at n=90 is never compared to an arm
at n=198 by aggregate. The **only** valid arm-vs-arm comparison is the paired common set
(items both completed) with an exact McNemar test — the check that caught a phantom
champion swap this session (a 71/75 easy-subset read as +6pp against a full-198 champion;
paired on the common set it was a dead tie). Two accuracy denominators are always
reported: **answered-only** and **fault-inclusive**.

### 3. The Verified Commons

A run Hanzo executed is a run Hanzo can vouch for. A run may be `private` (default),
`org-shared`, or `public`. Public runs aggregate into the community leaderboard where the
trust model inverts the usual one: the number is credible *because the neutral gateway
produced it under a pinned revision*, not because a vendor reported it. Answer-key-bearing
benchmarks stay in an isolated evaluator store; the public export carries outcomes and
(where license permits) responses, never the key. Consent is per-run and explicit; the
commons is opt-in.

### 4. Cache before spend

No `(benchmark_revision, item, arm_configuration, attempt#)` is ever paid for twice. The
response cache is immutable model output keyed by that tuple plus harness version; the
score cache is keyed by grader + label revision + response hash, so a disputed label
re-scores without re-calling the model. An arm configuration is the *complete* execution
spec — provider, model revision, prompt/scaffold, tools, reasoning budget, decoding — not
a model alias, because those change the number. Provider `latest` aliases carry a
timestamped fingerprint and a conservative TTL, since the model behind them changes
silently.

### 5. The durable execution plane

The API pod is stateless; execution is a separate worker role (HIP-0112 topology). A run
is a durable job with an idempotency key and a state machine —
`queued → planning → running → scoring → {completed | partial | failed | cancelled}` —
with per-item leases so workers scale horizontally, crashes recover, and cancellation is
item-granular. Before a run leaves `planning` it reserves a budget: max cost, token and
attempt ceilings, per-provider concurrency, a deadline, and a fault policy. If realized
pricing would exceed the reservation, the run **pauses** rather than spending through the
boundary. Reads and writes go through an `AttemptStore` interface: a local filesystem
backend for development, a relational-plus-object-store backend in production. Attempts
never live in pod-local state in production, and importing an existing corpus is
idempotent by stable id.

BYO endpoints are an SSRF surface and are gated accordingly: loopback, private,
link-local, and cloud-metadata addresses are refused; DNS resolves through a controlled
egress; credentials are KMS references, never job fields or logs; redirects, response
sizes, and connection lifetimes are bounded; HTTPS is required outside a private
customer deployment.

### 6. The Enso Router — three models, one controller

The router is not one model emitting a name. It is three models over the shared corpus,
each solving a different problem with different information, composed by a controller.
This is the HIP-0510 policy made learned, and it inherits HIP-0511's account pool beneath
(which credential pays) and HIP-0510's model pool above (which models are eligible).

- **Verified Memory.** For a seen or verifiably-equivalent question, return the recorded
  validated answer. This is the only place "100%" is real — it is retrieval, not
  prediction — and it is disabled during any benchmark claim (answer-bearing retrieval
  is excluded from the held-out set).

- **Scout.** A frozen 0.5–1.7B open transformer, run **prefill only**, from whose upper-
  and mid-layer pooled activations a shared low-rank capability trunk predicts, per arm:
  P(correct), expected cost, latency, a wall probability (no arm succeeds), and calibrated
  uncertainty. The scoring form is neural item-response theory —
  `ℓ(q,m) = b_m − d(q) + a(q)·θ_m + z_q·W·z_m` — where `d(q)` is difficulty, `a(q)` the
  demanded capabilities, `θ_m` the measured model ability, and the bilinear term the
  interaction. New models are admitted by fingerprint on a diagnostic probe set (their
  `θ_m`, `z_m`), never a full retrain — the open-world property routing over a churning
  frontier requires.

- **Critic.** A 1–2B reasoning model that reads the question and the **anonymized,
  order-randomized candidate responses** (identities and vote counts hidden) and selects
  the correct candidate or abstains, with auxiliary per-candidate correctness and pairwise
  ranking heads. Critic is the stronger lever: which minority answer is right lives in the
  reasoning, not the tally. Critic is trained first, with privileged access to candidate
  responses; Scout is then distilled toward Critic's judgments so cheap pre-routing
  inherits expensive adjudication.

- **Controller.** Given Scout's uplift estimate and uncertainty, the cost/latency/risk
  contract, and (after a probe) Critic's confidence, it chooses: **accept** the champion,
  **challenge** with the most complementary arm, **buy** another response, invoke a
  **deterministic verifier** where truth is checkable (tests, execution, symbolic), or
  **abstain**. It deviates from the champion only when a calibrated lower bound on
  recovery-minus-damage is positive — the objective the diagnostic proved is the right one.

### 7. The routing objective (why recovery-minus-damage)

For champion `c` and challenger `a`, the four joint outcomes `(y_c, y_a)` give recovery
`P(y_c=0, y_a=1 | q)` and damage `P(y_c=1, y_a=0 | q)`. The Controller's per-challenger
value is `Δ_a(q) = P(recovery) − P(damage) − λ·Δcost − μ·Δlatency`, and it routes away
from the champion only when a conservative lower confidence bound on `Δ_a` is positive.
This is the actual product objective; champion-failure AUC is not, because it cannot
identify *which* arm recovers and is rewarded for detecting wall questions no arm solves.
Global AUC is not a threshold — a router wins with modest AUC if its high-confidence
deviation region is small and precise, and loses with high AUC if it routes to the wrong
challenger.

### 8. Training and `/v1/train`

The data plane exports the append-only store into a grouped training set — one row per
question, all arm outcomes and captured candidate responses grouped so cross-validation
never leaks a question across folds — carrying consent and evaluation-lockbox flags (the
trainer excludes lockbox). `/v1/train` schedules the frozen-encoder + low-rank-head fit on
the cloud ML plane; the encoder is fine-tuned only after the corpus reaches thousands of
independent questions per model. Every gateway dispatch already logs the eligible arm set,
the chosen arm and policy version, the selection propensity, the outcome, and cost/latency
— so online learning is a propensity-aware bandit with valid off-policy evaluation, and
manual runs record `selection_policy: manual` rather than leaving a telemetry hole.

### 9. Presets — author a blend

A preset is a named arm-set and rank — exactly what `enso-ultra` *is* in the family
catalog (HIP-0510), but user-authored and served as `enso-<name>`. A caller composes a
blend from the arena's measured leaderboard (the arms that win *their* tasks), and the
preset records which measured evidence justified each arm, so a blend is auditable rather
than asserted. The mechanism is the existing family-as-data catalog; presets are scoped
catalog entries, never a new serving path.

## Rationale

- **Decomplected.** Measurement (Arena), trust (Commons), and decision (Router) are three
  layers over one store; each is independently useful. Within the Router, *which model can*
  (Scout), *which candidate is right* (Critic), and *whether to buy more* (Controller) are
  three problems with three information sets, not one tangled model.
- **Values, not places.** A benchmark is a versioned revision; an attempt is an immutable
  value; a score is derived, never overwritten; a preset is data. Provenance is a property
  of the value, not a side effect of where it ran.
- **Orthogonal to its neighbors.** HIP-0510 chooses *which model*, HIP-0511 chooses *which
  credential pays*, this HIP chooses *whether one model suffices and, if not, what to buy*.
  Each composes at one seam and reads none of the others' policy.
- **Earned, not assumed.** Every quantitative claim here is measured on Hanzo's harness;
  the routing thesis is stated as "no detectable value at n=198" (a failure to reject,
  not a proof of impossibility), and the build order follows from that honest state — a
  data plane and a learning curve to confirm the diagnosis — rather than preceding it.

## Architectural canon (one way, unified)

Everything above lands on the single `hanzoai/cloud` Go binary — the unified product
surface (HIP-0112) — and follows the house canon so no layer is reinvented:

- **ORM generates the plane.** Persistence is `hanzoai/orm` with generic `mixin.Model[T]`
  + `orm.Register[T]()` (the `~/work/hanzo/commerce` pattern): one model type yields CRUD,
  namespace/tenant scoping, and `orm.WithStringKey` idempotent ids. New code uses orm, not
  raw `database/sql`.
- **Two data planes, not one.** Per-org transactional writes on Hanzo SQLite (HIP-0302,
  per-org file, S3-replicated) are the tenant source of truth; the **aggregate/real-time**
  leaderboard and all AI-research o11y read from the **warehouse OLAP plane**
  (`clients/usage/datastore.go` — ClickHouse). The arena leaderboard is an OLAP read, not
  a per-org scan.
- **ZAP-native throughout.** Handlers are `zip` over the neutral ZAP surface; JSON is the
  ZAP adaptor (`zap-proto/json`/`c.JSON`), not hand-rolled marshalling. Client-to-client is
  ZAP bidirectional pipelining, no bespoke transport.
- **CRUD → ZAP → MCP for free.** A registered orm model projects its CRUD onto the ZAP
  node, and the MCP layer rides ZAP for free — a model, an API, and an agent tool from one
  declaration, one way.
- **OpenAPI is generated** from the cloud surface (`~/work/hanzo/openapi`), never
  hand-maintained.
- **One dataset noun (`/v1/datasets`), not three.** A dataset is a versioned collection
  of items with `source` provenance (`hf | synthetic | production-captured |
  user-uploaded`) — it is not owned by eval. `/v1/eval` *scores* a dataset, `/v1/benchmark`
  *runs models against* one, and `/v1/synth` *generates into* one. Today eval owns
  `/v1/evals/datasets`; the canon is to promote it to the shared top-level `/v1/datasets`
  so the three surfaces compose on one primitive rather than each carrying its own item
  store (eval-datasets vs benchmark-items vs synth-output collapse to one way).
- **Hugging Face is the native dataset remote (bidirectional).** Hanzo already loads the
  public benchmarks *from* HF (`hendrydong/gpqa_diamond_mc`, `macabdul9/hle_text_only`),
  so a dataset is naturally `hf://<repo>@<commit>` — and the HF **commit sha pins the
  immutable `benchmark_revision`**, solving versioning for free (a re-labeled upstream is
  a new sha, a new revision, never a silent rewrite). Bidirectional via HF Pro: (1) *pull*
  — the canonical set resolves to pinned HF datasets; (2) *push* — the **verified commons
  publishes as open, citable HF datasets** (consented Hanzo-measured results become a
  public HF dataset the community can cite, the arena's trust made concrete); (3)
  *private* — synth corpora and μRouter training exports save to org-private HF repos as
  the versioned training corpus. One remote, `hf` CLI / Hub API, no bespoke dataset store.
- **Synth is training-only, firewalled.** `/v1/synth` generates INTO a dataset
  (`source:synthetic`) to grow the seed corpus for Scout/Critic; synthetic items are
  **never** admitted to a benchmark leaderboard claim or the public commons (real
  questions are the locked test set). Fabricated questions in a leaderboard would be the
  exact integrity violation the arena exists to prevent — the `source` field on the
  unified dataset is what enforces the firewall.

## Backwards Compatibility

Forward-only. `/v1/benchmark` is additive beside `/v1/eval`. A caller with no presets and
no linked accounts sees today's Enso (HIP-0510) unchanged — Verified Memory misses,
Scout defers to the rule router, the Controller accepts the champion. The Router layers
turn on as the corpus grows; none changes an existing request contract. enso family
evolution is zero-downtime by construction (rolling update, drain-after-ready), so
catalog and model changes ship continuously without a serving gap.

## Open Questions

1. **Commons terms.** Which benchmark licenses permit publishing raw responses (not just
   outcomes) in the public commons; where only outcomes may be shared.
2. **Scout activation access.** Prefill activations require either self-hosted arms or a
   provider that returns hidden states; for closed API arms Scout falls back to
   question-plus-probe features. Which arms support which is a per-provider fact.
3. **Critic exposure.** Whether to ever show full chains-of-thought to Critic (risk:
   persuasive-but-wrong reasoning herds it) versus final artifacts plus independent
   re-derivation. Default: artifacts + re-derivation; CoT only where checkable.
4. **Locked test set.** GPQA-Diamond is now development data (inspected and tuned
   against). A published routing claim requires a locked external test set and a temporal
   holdout created after the router is frozen.
5. **Continuous-learning cadence.** Real-time propensity logging is always on; the
   promote/rollback cadence for a retrained Scout/Critic (daily? on-drift?) is a policy
   the flywheel should tune with data.

## Reference Implementation (staging)

1. `/v1/benchmark` read surface + provenance registry + paired-compare + presets —
   *landed* (native Go in the unified binary; leaderboard proven on the measured corpus).
2. Data plane: registry → grouped training tensor with consent/lockbox flags — *landed*.
3. Durable execution: `AttemptStore` cloud backend, run state machine + leasing, budget
   reservation, BYO SSRF gate — the next prod increment.
4. Verified Commons: run visibility (`private`/`org-shared`/`public`) + consented
   aggregation + evaluator-store isolation.
5. Critic prototype on captured candidate responses (grouped nested-CV over the eight
   policy conditions), then Scout on prefill activations, then the Controller.
6. `/v1/train` on the cloud ML plane; online propensity-aware adaptation; new-model
   fingerprinting.

Each stage ships and is reviewed independently (blue builds, red reviews, CTO confirms
live) before the next; stages 1–2 are already in the release line.
