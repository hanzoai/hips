---
hip: 0063
title: Feature Flags & Experimentation Standard
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2026-02-23
requires: HIP-0017, HIP-0139
capability: [experiments, flags]
---


# HIP-0063: Feature Flags & Experimentation Standard

## Abstract

This proposal defines the feature flag and experimentation platform for the Hanzo ecosystem. Hanzo Flags provides boolean flags, multivariate flags, percentage rollouts, user targeting, and a full A/B experimentation engine with statistical significance analysis -- all with first-class support for AI-specific experiments like model routing, prompt template testing, and RAG strategy comparison.

Evaluation semantics are PostHog-compatible — the embedded evaluator is pinned to a 621-case parity table (`apps/flags/engine.go:11-13`) — so a PostHog-shaped client repoints by changing the host. It integrates with Hanzo Analytics (HIP-0017) for experiment metric collection; an OpenFeature adapter, if published, wraps the generated SDK rather than defining the wire.

**Evaluator**: [github.com/hanzoai/flags](https://github.com/hanzoai/flags) — the stateless Go engine (`flags/go`) compiled into the cloud binary
**Serving**: `apps/flags` and `apps/experiments` in `hanzoai/cloud`, at `/v1/flags` and `/v1/experiments` — there is no standalone flags service, port or image; SDK access is the generated cloud SDKs (HIP-1030)

## Motivation

Every software team eventually needs to decouple deployment from release. You push code to production, but the new behavior is hidden behind a flag. You turn it on for 1% of users, watch metrics, then ramp to 100%. If something breaks, you kill the flag -- no rollback, no redeployment, no incident.

This is table stakes for web applications. But AI systems introduce a category of experimentation that traditional feature flag platforms were never designed for:

1. **Model version rollouts**: You have Zen-72B in production. Zen-120B is ready. You want to route 5% of inference traffic to the new model, compare quality scores, latency, and cost, then decide whether to promote. This is not a boolean flag -- it is a traffic split with multi-dimensional metric analysis.

2. **Prompt template A/B testing**: The same model with two different system prompts produces different outputs. Which prompt yields better user satisfaction? Better task completion? Lower token usage? You need to randomly assign users to prompt variants and track downstream metrics.

3. **RAG strategy comparison**: Retrieval-augmented generation has multiple knobs -- chunk size, overlap, embedding model, reranker, top-k. Comparing strategies requires running parallel pipelines and measuring answer quality. This is a multi-armed bandit problem, not a simple on/off switch.

4. **Cost optimization experiments**: Route 20% of traffic to a cheaper model. If quality metrics remain within 5% of the baseline, promote the cheaper model for that traffic segment. This saves real money -- at 10M requests/month, a $0.001/request savings is $10K/month.

No existing feature flag platform handles these use cases natively. LaunchDarkly, Split, Unleash, and Flagsmith all treat flags as configuration switches. They support A/B tests on UI elements ("button color", "pricing page layout"). None of them understand tokens, latency percentiles, model quality scores, or cost-per-inference.

## Design Philosophy

### Why Custom Over LaunchDarkly

LaunchDarkly is the market leader in feature flags. It is also a SaaS product that charges per Monthly Active User (MAU). Pricing starts at $10/month per seat (Starter) and scales to enterprise contracts in the six-figure range. At Hanzo's scale -- multiple products, millions of AI inference requests, thousands of flag evaluations per second -- LaunchDarkly would cost $50K-200K/year.

More critically, LaunchDarkly's evaluation model is opaque. Flags are defined in their cloud dashboard. Evaluation happens either client-side (their SDK polls their CDN for flag state) or server-side (their SDK maintains a streaming connection to their service). In both cases, **flag evaluation depends on LaunchDarkly's infrastructure**. If their CDN has an outage, your flags stop updating. If their streaming service drops connections, your server-side evaluations stale.

For AI inference routing, stale flags mean requests routed to the wrong model -- potentially a model that has been deprecated or a cost tier that exceeds budget. This is not acceptable for production AI infrastructure.

**Unleash** is open-source (Apache 2.0) and self-hostable. It solves the data sovereignty problem. However, Unleash's evaluation engine is a Node.js/Java application backed by SQL. It does not support AI experiment types, continuous metric analysis, or integration with inference gateways. We would need to build those features on top of Unleash, effectively maintaining a fork with custom experiment logic, custom metric pipelines, and custom SDK extensions. At that point, we are building a custom system with Unleash's data model -- a worse starting point than building from first principles.

**Decision**: Build Hanzo Flags as our own engine — a stateless, PostHog-compatible evaluator compiled into the cloud binary, definitions in each org's own encrypted SQLite, native support for AI experiment types. Total cost: infrastructure we already operate. Zero per-seat or per-MAU licensing, and no evaluation tier that can go stale.

## Specification

### The shipped surface — two capabilities, two prefixes

**flags** (`manifest/apps.go:47`) serves seven operations under `/v1/flags`
(`apps/flags/routes.go:47-60`): `POST /v1/flags` and `POST /v1/flags/decide`
are the SAME evaluate handler — one verdict function, two spellings for the
PostHog-shaped clients; `GET /v1/flags/defs`, `GET|PUT|DELETE
/v1/flags/defs/{key}` manage definitions; `GET /v1/flags/activity` reads the
audit log; `GET /v1/flags/health` probes. Definitions live in per-(org,
project) encrypted SQLite — `{DataDir}/orgs/{org}/projects/{project}/flags.db`
via `cloud.OrgDB` (`apps/flags/store.go:3-6`) — and evaluation runs in-process
through the embedded evaluator `github.com/hanzoai/flags/go`, a pure function
of (definitions JSON, context JSON) answering in microseconds
(`apps/flags/engine.go:1-13`). **No KV, no sync protocol, no network hop**:
every pod evaluates from its own hot copy, which is what makes the p99 targets
below ordinary rather than aspirational.

**experiments** (`manifest/apps.go:404`) serves six operations under
`/v1/experiments`: `GET|POST /v1/experiments`, `GET /{id}`,
`GET /{id}/assign`, `POST /{id}/analyze`, `POST /{id}/decide`, plus
`/health`. It is a composition, not a fourth engine: it owns only the
experiment registry — one per-org SQLite file,
`{DataDir}/orgs/{slug}/experiments.db` (`apps/experiments/store.go:3-9`) —
and composes assignment from flags (a deterministic rollout hash, so there is
no assignment store), outcomes from the analytics warehouse, and evidence
from research's immutable sample rows.

The credential on both is the org's ordinary bearer per HIP-0026 — there is
no `hf_*` key family. The admin plane is not a second prefix: definition
writes are org-scoped on the same surface, and the platform's own switches
are the reserved platform store the SuperAdmin flips from the cockpit through
the same engine (`apps/flags/flags.go:21-27`).

Stated for HIP-0139 §6: both capabilities are **free**, said in those words
(`plugin/flags/main.go:21`, `plugin/experiments/main.go:22` — `Price:
cloud.Free`), and `/v1/flags/` is on the spend gate's never-refuse list
(`spend.go:433`) because the kill switch must be observable by an unpaid org.
Both publish **no events** on the bus — exposure lands as analytics events
from the surfaces that serve traffic, not from here — and emit nothing to
observability beyond the request span. Both are **ga** (HIP-0139 §8): flags
is the mechanism stage-gating itself rides, so it cannot sit behind a flag.
Upstream: flags embeds `github.com/hanzoai/flags/go`, our own implementation
of PostHog-compatible evaluation semantics, pinned to the prior
implementation's answers by a 621-case parity table
(`apps/flags/engine.go:11-13`); experiments derives from none — its
significance test is stdlib math.

### Flag Types

Hanzo Flags supports four flag value types, matching the OpenFeature specification:

| Type | Use Case | Example |
|------|----------|---------|
| **Boolean** | Kill switches, feature gates | `new-dashboard: true/false` |
| **String** | Multivariate experiments, model selection | `inference-model: "zen-72b" / "zen-120b"` |
| **Number** | Numeric configuration, thresholds | `rate-limit-multiplier: 1.5` |
| **Object** | Complex configuration, prompt templates | `rag-config: {"chunk_size": 512, "top_k": 5}` |

### Flag Definition Schema

The stored definition is the PostHog-compatible JSON the embedded evaluator
consumes (`apps/flags/store.go:5`), versioned and audited; the evaluator's
parity table, not this document, is the normative statement of its fields.
The JSON below illustrates the concepts a definition carries — variants,
targeting, rollout percentages, a fallthrough — in a reader-friendly shape:

```json
{
  "key": "inference-model-experiment",
  "name": "Inference Model A/B Test",
  "description": "Compare Zen-72B vs Zen-120B on production traffic",
  "type": "string",
  "defaultValue": "zen-72b",
  "enabled": true,
  "targeting": {
    "rules": [
      {
        "name": "Internal dogfood",
        "priority": 1,
        "conditions": [
          {"attribute": "org", "op": "in", "value": ["hanzo", "zoo"]}
        ],
        "variant": "zen-120b"
      },
      {
        "name": "Pro users 20% rollout",
        "priority": 2,
        "conditions": [
          {"attribute": "plan", "op": "eq", "value": "pro"}
        ],
        "rollout": {
          "percentages": {"zen-72b": 80, "zen-120b": 20},
          "seed": "inference-model-experiment"
        }
      }
    ],
    "fallthrough": {
      "variant": "zen-72b"
    }
  },
  "variants": {
    "zen-72b": {"value": "zen-72b"},
    "zen-120b": {"value": "zen-120b"}
  },
  "metadata": {
    "owner": "ml-team",
    "jira": "ML-1234",
    "experiment_id": "exp_model_comparison_2026Q1"
  }
}
```

### Targeting Rules

Targeting determines which variant a user receives. Rules are evaluated top-to-bottom by priority; the first matching rule wins.

#### Condition Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `eq` | Equals | `{"attribute": "plan", "op": "eq", "value": "pro"}` |
| `neq` | Not equals | `{"attribute": "plan", "op": "neq", "value": "free"}` |
| `in` | In set | `{"attribute": "org", "op": "in", "value": ["hanzo", "zoo"]}` |
| `not_in` | Not in set | `{"attribute": "country", "op": "not_in", "value": ["CN", "RU"]}` |
| `gt`, `gte`, `lt`, `lte` | Numeric comparison | `{"attribute": "account_age_days", "op": "gte", "value": 30}` |
| `contains` | String contains | `{"attribute": "email", "op": "contains", "value": "@hanzo.ai"}` |
| `regex` | Regex match | `{"attribute": "user_agent", "op": "regex", "value": "Mobile.*"}` |
| `semver_gt`, `semver_lt` | Semantic version | `{"attribute": "app_version", "op": "semver_gt", "value": "2.1.0"}` |

#### Targeting Dimensions

```yaml
User Attributes:
  - user_id / distinct_id     # Stable user identifier
  - email                     # Email-based targeting
  - org / organization        # Organization membership
  - plan                      # Subscription tier (free, pro, enterprise)
  - account_age_days          # Days since signup
  - country / region          # GeoIP-derived (from request IP)
  - language                  # Accept-Language header

Device Attributes:
  - device_type               # Desktop, Mobile, Tablet
  - os                        # macOS, Windows, Linux, iOS, Android
  - browser                   # Chrome, Firefox, Safari
  - app_version               # Semantic version of client app

AI-Specific Attributes:
  - model_requested           # Model the user requested
  - token_budget              # User's remaining token budget
  - request_complexity        # Estimated prompt complexity (token count)
  - provider_preference       # User's preferred AI provider
```

#### Percentage Rollouts

Percentage-based rollouts use consistent hashing on a stable identifier (typically `user_id` + flag key). This ensures a user always receives the same variant for a given flag, even across multiple evaluations, multiple servers, and service restarts.

```
hash = murmur3(user_id + ":" + flag_key + ":" + seed)
bucket = hash % 10000  // 0-9999, giving 0.01% granularity
```

The seed is configurable per flag. Changing the seed reshuffles the assignment -- useful when you want to run a new experiment on the same flag key without the previous assignment biasing results.

### Evaluation API

#### POST /v1/flags/decide

Evaluate flags for an identity. This is the primary hot-path endpoint —
served as both `POST /v1/flags` and `POST /v1/flags/decide`, one handler
(`apps/flags/routes.go:52-55`). It answers for EVERY flag in the caller's
definitions at once (the PostHog `/decide` shape), so there is no separate
batch endpoint to keep in step with it.

```http
POST /v1/flags/decide HTTP/1.1
Host: api.hanzo.ai
Authorization: Bearer <the org's ordinary key, HIP-0026>
Content-Type: application/json

{
  "distinct_id": "user_789",
  "properties": {
    "org": "hanzo",
    "plan": "pro",
    "country": "US"
  }
}
```

Response:
```json
{
  "key": "inference-model-experiment",
  "value": "zen-120b",
  "variant": "zen-120b",
  "reason": "TARGETING_MATCH",
  "rule_id": "internal-dogfood",
  "metadata": {
    "experiment_id": "exp_model_comparison_2026Q1"
  }
}
```

The response and reason vocabulary is the embedded evaluator's —
PostHog-compatible, pinned by its parity table — and the JSON above is
illustrative of the verdict's shape (state, variant, payload per flag), not a
schema this HIP owns: the definitive shape is what the evaluator answers and
the served document publishes (HIP-1030).

#### Performance Requirements

| Metric | Target |
|--------|--------|
| Evaluation latency (p50) | < 1ms |
| Evaluation latency (p99) | < 5ms |
| Batch evaluation (10 flags, p99) | < 10ms |
| Availability | 99.99% |
| Throughput | 100K evaluations/second per node |

These targets are achievable because flag evaluation is a pure in-memory operation: definitions are read from the org's own SQLite store into a hot in-process copy, and the evaluator is a pure function over them (`apps/flags/engine.go:5-7`). There is no KV tier and no sync hop to go stale.

### Management surface

Definition management is org-scoped on the SAME prefix — there is no
`/admin/v1` and no separate management key family:

```
GET    /v1/flags/defs          # list definitions
GET    /v1/flags/defs/{key}    # read one
PUT    /v1/flags/defs/{key}    # create / update (versioned)
DELETE /v1/flags/defs/{key}    # delete
GET    /v1/flags/activity      # the audit log of definition changes

GET    /v1/experiments               # list experiments
POST   /v1/experiments               # create (writes the multivariate flag def)
GET    /v1/experiments/{id}          # read, with results
POST   /v1/experiments/{id}/analyze  # run the analysis fold
POST   /v1/experiments/{id}/decide   # stop, lock the winner (rewrites the def's weights to 100%)
```

Every mutation to a flag definition is recorded append-only with the acting
user, timestamp and version (`apps/flags/store.go`), readable at
`GET /v1/flags/activity` — which is what answers "who changed the model
rollout percentage at 3am?". The platform's own operational switches are the
one cross-tenant surface: they live in the reserved platform store and only a
SuperAdmin writes them (`apps/flags/flags.go:21-27`).

## AI Model Experimentation

This is the core differentiator of Hanzo Flags. Traditional A/B testing asks "which button color converts better?" AI experimentation asks "which model/prompt/strategy produces better results at what cost?"

### Experiment Definition

```json
{
  "id": "exp_zen120b_rollout",
  "name": "Zen-120B Production Readiness",
  "description": "Compare Zen-120B against Zen-72B on production inference traffic",
  "flag_key": "inference-model-experiment",
  "type": "ai_model_comparison",
  "variants": [
    {"key": "control", "value": "zen-72b", "allocation": 80},
    {"key": "treatment", "value": "zen-120b", "allocation": 20}
  ],
  "metrics": {
    "primary": {
      "name": "quality_score",
      "type": "continuous",
      "direction": "increase",
      "minimum_detectable_effect": 0.05
    },
    "secondary": [
      {"name": "latency_p95_ms", "type": "continuous", "direction": "decrease"},
      {"name": "cost_per_request_usd", "type": "continuous", "direction": "decrease"},
      {"name": "user_satisfaction", "type": "continuous", "direction": "increase"},
      {"name": "error_rate", "type": "proportion", "direction": "decrease"}
    ],
    "guardrails": [
      {"name": "latency_p99_ms", "type": "continuous", "threshold": 5000, "action": "alert"},
      {"name": "error_rate", "type": "proportion", "threshold": 0.05, "action": "kill"}
    ]
  },
  "analysis": {
    "method": "bayesian",
    "confidence_threshold": 0.95,
    "minimum_sample_size": 1000,
    "maximum_duration_days": 14
  },
  "targeting": {
    "conditions": [
      {"attribute": "plan", "op": "in", "value": ["pro", "enterprise"]}
    ]
  }
}
```

### Metric Collection

AI experiments collect metrics through two channels:

**Automatic metrics** land in the analytics warehouse: the analyze fold reads each subject's outcome from the org-scoped `hanzo.events` query (`analytics.Outcomes`, joined to the flags variant by `distinct_id` — `apps/experiments/analyze.go`), so exposure and outcome ride the ONE analytics plane rather than a second exposure topic. There is no Kafka `experiment_exposures` topic and no gateway emitter; the event a serving surface records is an ordinary analytics event shaped like:

```json
{
  "event": "experiment_exposure",
  "experiment_id": "exp_zen120b_rollout",
  "variant": "treatment",
  "distinct_id": "user_789",
  "timestamp": "2026-02-23T14:30:00.000Z",
  "properties": {
    "model": "zen-120b",
    "prompt_tokens": 245,
    "completion_tokens": 512,
    "latency_ms": 1850,
    "cost_usd": 0.0042,
    "status": 200
  }
}
```

**Custom metrics** are sent by application code via the Flags SDK or the Analytics SDK (HIP-0017):

```python
from hanzoai.flags import FlagsClient

flags = FlagsClient(api_key="hf_project_key_abc123")

# Evaluate the flag (get the variant)
variant = flags.get_string_value(
    "inference-model-experiment",
    default="zen-72b",
    context={"user_id": "user_789", "plan": "pro"}
)

# ... perform inference with the assigned model ...

# Report a custom metric
flags.track_metric(
    experiment_id="exp_zen120b_rollout",
    distinct_id="user_789",
    metric="quality_score",
    value=0.87
)
```

### Integration with the serving path

Traffic splitting at the infrastructure layer — the gateway evaluating a flag
before the request reaches application code — is a design this section used
to specify in KrakenD configuration. No such gateway plugin ships; what
ships is in-process composition: any subsystem in the binary evaluates
through `flags.Assign` (the same deterministic rollout hash the HTTP surface
uses), which is how `apps/experiments` and `apps/campaign` split traffic
today with no network hop at all. A gateway-level split remains open design
and MUST, if built, evaluate through the same embedded engine rather than a
second one.

### AI-Specific Experiment Types

#### Model Version Rollout

Route a percentage of inference traffic to a new model version. Measure quality, latency, and cost. Auto-promote when confidence threshold is met.

```yaml
Type: ai_model_comparison
Control: zen-72b (80%)
Treatment: zen-120b (20%)
Primary metric: quality_score (increase)
Guardrail: latency_p99 < 5000ms, error_rate < 5%
Duration: 7-14 days
Auto-promote: yes, when P(treatment > control) > 0.95
```

#### Prompt Template A/B Test

Same model, different system prompts. Measure task completion, user satisfaction, and token efficiency.

```yaml
Type: prompt_ab_test
Model: zen-72b (fixed)
Variant A: "You are a helpful assistant. Be concise." (50%)
Variant B: "You are an expert analyst. Think step by step." (50%)
Primary metric: task_completion_rate (increase)
Secondary: tokens_per_response (decrease), user_thumbs_up (increase)
```

#### RAG Strategy Comparison

Compare different retrieval-augmented generation configurations. The flag returns a JSON object that the RAG pipeline consumes directly.

```yaml
Type: rag_strategy
Variant A: {"chunk_size": 256, "overlap": 50, "top_k": 3, "reranker": "none"}
Variant B: {"chunk_size": 512, "overlap": 100, "top_k": 5, "reranker": "cross-encoder"}
Variant C: {"chunk_size": 1024, "overlap": 200, "top_k": 10, "reranker": "cohere"}
Primary metric: answer_relevance_score (increase)
Secondary: retrieval_latency_ms (decrease), context_tokens (decrease)
Method: multi-armed bandit (auto-allocate traffic to best performer)
```

#### Cost Optimization Experiment

Route traffic to cheaper models and verify quality holds. This is financially motivated -- the experiment succeeds if quality stays within tolerance AND cost decreases.

```yaml
Type: cost_optimization
Control: zen-72b @ $0.003/1K tokens
Treatment: zen-32b @ $0.0008/1K tokens
Primary metric: quality_score (must stay within 5% of control)
Success condition: cost_per_request decreases AND quality holds
Guardrail: quality_score > 0.80 (absolute floor)
```

## Statistical Engine

What ships is one method: the analyze fold runs a **two-proportion z-test**
against the control arm over the immutable evidence rows — stdlib
`math.Erfc`, no dependency, degenerate inputs answered honestly rather than
scored (`apps/experiments/analyze.go:83,152-166`) — and `decide` locks the
winner by rewriting the flag definition's weights to 100%. The Bayesian and
multi-armed-bandit methods below are PROPOSED extensions, not built; they are
kept because the arguments for them (the peeking problem, regret
minimization) are what any future engine must answer.

### Bayesian Analysis

The default method. Bayesian analysis provides a natural answer to "what is the probability that treatment is better than control?" rather than the frequentist "can we reject the null hypothesis?"

For **continuous metrics** (latency, cost, quality score), the engine uses a Normal-Inverse-Gamma conjugate prior:

```
Prior:     mu ~ Normal(mu_0, sigma^2 / kappa_0)
           sigma^2 ~ Inverse-Gamma(alpha_0, beta_0)

Posterior: Updated with observed data (sample mean, sample variance, n)

Decision:  P(mu_treatment > mu_control | data) > threshold
```

For **proportion metrics** (conversion rate, error rate), the engine uses a Beta-Binomial model:

```
Prior:     theta ~ Beta(alpha_0, beta_0)   # default: Beta(1, 1) = uniform
Posterior: theta | data ~ Beta(alpha_0 + successes, beta_0 + failures)
Decision:  P(theta_treatment > theta_control | data) > threshold
```

The probability is computed via Monte Carlo sampling (100K draws from each posterior). This is fast -- under 10ms for two-variant experiments, under 100ms for multi-variant.

**Why Bayesian over frequentist as default?** Bayesian analysis lets you check results at any time without inflating false positive rates (the "peeking problem" that plagues frequentist A/B tests). With frequentist tests, checking results daily before reaching the planned sample size inflates the Type I error rate from 5% to 20-30%. Bayesian posterior probabilities are valid at every observation count.

### Frequentist Analysis

Available for teams that prefer traditional hypothesis testing or need results compatible with academic publication standards.

For **continuous metrics**: Welch's t-test (unequal variances assumed). Reports p-value, confidence interval, and effect size (Cohen's d).

For **proportion metrics**: Two-proportion z-test. Reports p-value, confidence interval, and relative lift.

**Sample size calculation** is performed upfront based on the minimum detectable effect (MDE), significance level (alpha, default 0.05), and power (1-beta, default 0.80):

```
n_per_variant = (Z_alpha/2 + Z_beta)^2 * 2 * sigma^2 / delta^2
```

The experiment dashboard shows a progress bar toward the required sample size. Results are marked as "preliminary" until the planned sample size is reached.

### Multi-Armed Bandit

For experiments where the goal is optimization rather than measurement, Hanzo Flags supports Thompson Sampling -- a multi-armed bandit algorithm that automatically allocates more traffic to the winning variant as evidence accumulates.

```
For each request:
  1. Sample from each variant's posterior distribution
  2. Select the variant with the highest sample
  3. Serve that variant to the user
  4. Observe the outcome and update the posterior
```

Thompson Sampling converges to the best variant while minimizing regret (the cost of showing inferior variants during the experiment). It is ideal for RAG strategy comparison, where you have 3+ variants and want to find the best one quickly without exposing users to poor configurations.

**Trade-off**: Bandit experiments do not produce clean statistical comparisons between variants. The traffic allocation is non-uniform and changes over time. If you need a rigorous "is A better than B?" answer, use Bayesian or frequentist A/B testing. If you need to "find and use the best option as fast as possible," use Thompson Sampling.

### Experiment Results API

```http
GET /admin/v1/experiments/exp_zen120b_rollout/results HTTP/1.1
Host: flags.hanzo.ai
Authorization: Bearer hf_admin_key_xyz
```

Response:
```json
{
  "experiment_id": "exp_zen120b_rollout",
  "status": "running",
  "started_at": "2026-02-16T00:00:00Z",
  "duration_days": 7,
  "variants": {
    "control": {
      "name": "zen-72b",
      "allocation": 80,
      "sample_size": 45230,
      "metrics": {
        "quality_score": {"mean": 0.82, "std": 0.15, "ci_95": [0.816, 0.824]},
        "latency_p95_ms": {"mean": 1200, "std": 450},
        "cost_per_request_usd": {"mean": 0.0031, "std": 0.0012},
        "error_rate": {"mean": 0.012, "std": 0.002}
      }
    },
    "treatment": {
      "name": "zen-120b",
      "allocation": 20,
      "sample_size": 11308,
      "metrics": {
        "quality_score": {"mean": 0.87, "std": 0.13, "ci_95": [0.863, 0.877]},
        "latency_p95_ms": {"mean": 2100, "std": 680},
        "cost_per_request_usd": {"mean": 0.0058, "std": 0.0018},
        "error_rate": {"mean": 0.009, "std": 0.001}
      }
    }
  },
  "analysis": {
    "method": "bayesian",
    "primary_metric": "quality_score",
    "probability_treatment_better": 0.993,
    "expected_lift": 0.061,
    "ci_95_lift": [0.047, 0.075],
    "recommendation": "Treatment (zen-120b) shows 6.1% quality improvement with 99.3% probability. Latency increased 75% and cost increased 87%. Recommend promotion for quality-sensitive traffic; maintain control for cost-sensitive segments.",
    "guardrails": {
      "latency_p99_ms": {"status": "pass", "value": 4200, "threshold": 5000},
      "error_rate": {"status": "pass", "value": 0.009, "threshold": 0.05}
    }
  }
}
```

## Architecture

One binary, two subsystems, no tiers. `apps/flags` holds the definitions in
each org's own encrypted SQLite file and evaluates them in-process through the
embedded evaluator; `apps/experiments` holds the experiment registry in each
org's own file and composes flags (assignment), analytics (outcomes) and
research (evidence). There is no standalone flags service, no SQL-to-KV sync,
no KV pub/sub channel, no Kafka exposure topic and no separate deployment —
the earlier revision of this HIP specified all four, and the shipped shape
replaced them with something strictly simpler: the store is beside the
evaluator, so there is nothing to sync and nothing to go stale. Deployment is
the cloud image; the plugin binaries are `plugin/flags` and
`plugin/experiments`.

The credential is the caller's ordinary org key (HIP-0026). There is no
`hf_*` key family: the evaluate routes take the same bearer as every other
`/v1` surface, and tenancy is the validated principal, never the key prefix.

### SDK Usage

The client surface is the generated cloud SDKs and the `hanzo` CLI, both
projections of the served document (HIP-1030): the flags operations appear as
the `Flags` class/command group in every generated language, the experiments
operations as `Experiments`. The hand-written `@hanzoai/flags-js` /
`hanzoai-flags` / `flags-go` packages and the OpenFeature provider wrappers
this section used to show are not published; if OpenFeature adapters are
wanted they wrap the generated client, they do not replace it.

## Security

### Authentication

Every request carries the org's ordinary credential (HIP-0026); there is no
flags-specific key family. Tenancy is the VALIDATED principal — `principal.Org`
and `principal.Project` — never a header a client can write.

### Flag Access Control

Flags are scoped to (org, project), and the isolation is physical, not a
filter: each (org, project) pair is its own SQLite file
(`apps/flags/store.go:3-6`), so one tenant's evaluation cannot read another's
definitions even in the presence of a query defect. The platform-switch store
is the reserved platform namespace and only a SuperAdmin writes it.

What an attacker gets from the wrong implementation: flags are the policy
primitive other planes compose (admission, stage gating per HIP-0139 §8.2),
so a cross-tenant write here is not a cosmetic defect — it is another org's
kill switches flipped, and a readable beta-flag roster is an existence oracle
for capabilities a customer has not been shown.

### Audit Trail

Every flag mutation (create, update, toggle, delete) is recorded with:
- Acting user (from IAM token or API key)
- Timestamp (UTC, millisecond precision)
- Full diff of the change (before/after JSON)
- IP address and user agent

The audit log is append-only and cannot be modified or deleted via the API. It is stored in SQL with a 2-year retention policy.

### Experiment Data Privacy

Experiment exposure events contain `distinct_id` and variant assignment. They do NOT contain the user's request or response content. Metric values (latency, cost, quality score) are aggregate numbers, not raw inference data. This ensures that the experimentation system never stores or transmits user prompts, completions, or any PII beyond the stable user identifier.

## Monitoring

Neither capability exports metrics of its own today: there is no
`flags_*` metric family and no sync or consumer lag to alert on, because
there is no sync and no consumer. What a customer can read back under
`/v1/o11y` is the request span every route already gets; the definition
change history is `GET /v1/flags/activity`. Alerting on evaluation latency,
if wanted, rides the fleet's ordinary request telemetry rather than a
capability-local exporter.

## References

1. [HIP-4: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md)
2. [HIP-17: Analytics Event Standard](./hip-0017-analytics-event-standard.md)
3. HIP-44: API Gateway Standard
4. [OpenFeature Specification](https://openfeature.dev/specification/)
5. [OpenFeature Go SDK](https://github.com/open-feature/go-sdk)
6. [Thompson Sampling for Multi-Armed Bandits](https://arxiv.org/abs/1707.02038)
7. [Bayesian A/B Testing at VWO](https://vwo.com/downloads/VWO_SmartStats_technical_whitepaper.pdf)
8. [Hanzo Flags Repository](https://github.com/hanzoai/flags)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
