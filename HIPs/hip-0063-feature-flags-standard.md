---
hip: 0063
title: Feature Flags & Experimentation Standard
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2026-02-23
requires: HIP-0017, HIP-0044
---

# HIP-63: Feature Flags & Experimentation Standard

## Abstract

This proposal defines the feature flag and experimentation platform for the Hanzo ecosystem. Hanzo Flags provides boolean flags, multivariate flags, percentage rollouts, user targeting, and a full A/B experimentation engine with statistical significance analysis -- all with first-class support for AI-specific experiments like model routing, prompt template testing, and RAG strategy comparison.

The platform implements the [OpenFeature](https://openfeature.dev) specification for flag evaluation, ensuring SDK interoperability across languages and preventing vendor lock-in. It integrates with Hanzo Analytics (HIP-0017) for experiment metric collection and with the API Gateway (HIP-0044) for traffic splitting at the infrastructure layer.

**Repository**: [github.com/hanzoai/flags](https://github.com/hanzoai/flags)
**Port**: 8063 (API)
**Docker**: `ghcr.io/hanzoai/flags:latest`
**SDKs**: `@hanzoai/flags-js`, `hanzoai-flags` (Python), `github.com/hanzoai/flags-go`

## Motivation

Every software team eventually needs to decouple deployment from release. You push code to production, but the new behavior is hidden behind a flag. You turn it on for 1% of users, watch metrics, then ramp to 100%. If something breaks, you kill the flag -- no rollback, no redeployment, no incident.

This is table stakes for web applications. But AI systems introduce a category of experimentation that traditional feature flag platforms were never designed for:

1. **Model version rollouts**: You have Zen-72B in production. Zen-120B is ready. You want to route 5% of inference traffic to the new model, compare quality scores, latency, and cost, then decide whether to promote. This is not a boolean flag -- it is a traffic split with multi-dimensional metric analysis.

2. **Prompt template A/B testing**: The same model with two different system prompts produces different outputs. Which prompt yields better user satisfaction? Better task completion? Lower token usage? You need to randomly assign users to prompt variants and track downstream metrics.

3. **RAG strategy comparison**: Retrieval-augmented generation has multiple knobs -- chunk size, overlap, embedding model, reranker, top-k. Comparing strategies requires running parallel pipelines and measuring answer quality. This is a multi-armed bandit problem, not a simple on/off switch.

4. **Cost optimization experiments**: Route 20% of traffic to a cheaper model. If quality metrics remain within 5% of the baseline, promote the cheaper model for that traffic segment. This saves real money -- at 10M requests/month, a $0.001/request savings is $10K/month.

No existing feature flag platform handles these use cases natively. LaunchDarkly, Split, Unleash, and Flagsmith all treat flags as configuration switches. They support A/B tests on UI elements ("button color", "pricing page layout"). None of them understand tokens, latency percentiles, model quality scores, or cost-per-inference.

### Why Not Use the Feature Flags in HIP-0017 (Insights)?

HIP-0017 specifies Hanzo Insights (PostHog fork), which includes basic feature flags and A/B testing. Those flags are excellent for product experiments -- UI variants, onboarding flows, pricing page tests. They evaluate via the `/decide` endpoint in Django, store definitions in PostgreSQL, and track exposure via `$feature_flag_called` events.

Hanzo Flags (this HIP) is a dedicated service for two reasons:

**Separation of concerns.** Analytics (event ingestion, ClickHouse queries, session replay) and flag evaluation (sub-millisecond lookups, high fanout) have fundamentally different performance profiles. The Insights `/decide` endpoint queries PostgreSQL on every evaluation. At 10K flag evaluations per second (typical for a gateway handling inference traffic), PostgreSQL becomes the bottleneck. Hanzo Flags stores flag state in Redis with local in-process caching -- evaluation takes < 1ms with zero database queries on the hot path.

**AI-native experiment types.** PostHog experiments measure conversion rates: "Did the user click the button?" AI experiments measure continuous distributions: "What is the p95 latency delta between model A and model B?" "Is the quality score distribution of prompt variant B statistically higher than variant A?" PostHog's Bayesian engine supports binomial metrics (conversion, retention). Hanzo Flags supports continuous metrics (latency, cost, quality scores) with both Bayesian and frequentist analysis.

The two systems complement each other. Insights handles product analytics and product experiments. Flags handles infrastructure flags and AI experiments. Both emit events to the same Kafka pipeline (HIP-0030) and share the same ClickHouse storage for metric analysis.

## Design Philosophy

### Why Custom Over LaunchDarkly

LaunchDarkly is the market leader in feature flags. It is also a SaaS product that charges per Monthly Active User (MAU). Pricing starts at $10/month per seat (Starter) and scales to enterprise contracts in the six-figure range. At Hanzo's scale -- multiple products, millions of AI inference requests, thousands of flag evaluations per second -- LaunchDarkly would cost $50K-200K/year.

More critically, LaunchDarkly's evaluation model is opaque. Flags are defined in their cloud dashboard. Evaluation happens either client-side (their SDK polls their CDN for flag state) or server-side (their SDK maintains a streaming connection to their service). In both cases, **flag evaluation depends on LaunchDarkly's infrastructure**. If their CDN has an outage, your flags stop updating. If their streaming service drops connections, your server-side evaluations stale.

For AI inference routing, stale flags mean requests routed to the wrong model -- potentially a model that has been deprecated or a cost tier that exceeds budget. This is not acceptable for production AI infrastructure.

**Unleash** is open-source (Apache 2.0) and self-hostable. It solves the data sovereignty problem. However, Unleash's evaluation engine is a Node.js/Java application backed by PostgreSQL. It does not support AI experiment types, continuous metric analysis, or integration with inference gateways. We would need to build those features on top of Unleash, effectively maintaining a fork with custom experiment logic, custom metric pipelines, and custom SDK extensions. At that point, we are building a custom system with Unleash's data model -- a worse starting point than building from first principles.

**Decision**: Build Hanzo Flags as a Go service with Redis-backed evaluation, OpenFeature-compatible SDKs, and native support for AI experiment types. Total cost: infrastructure we already operate (Redis, ClickHouse, Kafka). Zero per-seat or per-MAU licensing.

### Why OpenFeature

[OpenFeature](https://openfeature.dev) is a CNCF (Cloud Native Computing Foundation) sandbox project that defines a vendor-neutral API for feature flag evaluation. It specifies:

- A `Client` interface with `getBooleanValue`, `getStringValue`, `getNumberValue`, `getObjectValue` methods
- An `EvaluationContext` that carries user/request metadata for targeting
- A `Provider` interface that backends implement
- `Hook` interfaces for logging, metrics, and validation

OpenFeature is to feature flags what OpenTelemetry is to observability: a standard interface that decouples application code from the vendor.

By implementing Hanzo Flags as an OpenFeature provider, every application that uses OpenFeature SDKs can switch to Hanzo Flags by changing one line of configuration -- the provider initialization. No application code changes. No SDK migration. This is critical for adoption: teams already using OpenFeature with LaunchDarkly or Flagsmith can migrate to Hanzo Flags transparently.

```typescript
// Before: LaunchDarkly
import { OpenFeature } from '@openfeature/server-sdk';
import { LaunchDarklyProvider } from '@launchdarkly/openfeature-node-server';
OpenFeature.setProvider(new LaunchDarklyProvider('sdk-key'));

// After: Hanzo Flags -- only this line changes
import { OpenFeature } from '@openfeature/server-sdk';
import { HanzoFlagsProvider } from '@hanzoai/flags-openfeature';
OpenFeature.setProvider(new HanzoFlagsProvider('https://flags.hanzo.ai', 'hf_api_key'));

// Application code is IDENTICAL in both cases
const client = OpenFeature.getClient();
const value = await client.getBooleanValue('new-feature', false, context);
```

## Specification

### Flag Types

Hanzo Flags supports four flag value types, matching the OpenFeature specification:

| Type | Use Case | Example |
|------|----------|---------|
| **Boolean** | Kill switches, feature gates | `new-dashboard: true/false` |
| **String** | Multivariate experiments, model selection | `inference-model: "zen-72b" / "zen-120b"` |
| **Number** | Numeric configuration, thresholds | `rate-limit-multiplier: 1.5` |
| **Object** | Complex configuration, prompt templates | `rag-config: {"chunk_size": 512, "top_k": 5}` |

### Flag Definition Schema

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

#### POST /v1/evaluate

Evaluate a single flag for a given context. This is the primary hot-path endpoint.

```http
POST /v1/evaluate HTTP/1.1
Host: flags.hanzo.ai
Authorization: Bearer hf_project_key_abc123
Content-Type: application/json

{
  "flag_key": "inference-model-experiment",
  "context": {
    "user_id": "user_789",
    "org": "hanzo",
    "plan": "pro",
    "country": "US"
  },
  "default_value": "zen-72b"
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

Evaluation reasons follow the OpenFeature specification:

| Reason | Meaning |
|--------|---------|
| `STATIC` | Flag has no targeting rules; default value returned |
| `TARGETING_MATCH` | A targeting rule matched |
| `SPLIT` | Percentage rollout assignment |
| `DEFAULT` | No rules matched; fallthrough value returned |
| `DISABLED` | Flag is disabled; default value returned |
| `ERROR` | Evaluation error; default value returned |

#### POST /v1/evaluate/batch

Evaluate multiple flags in a single request. SDKs SHOULD use this to reduce round-trips on page load or request initialization.

```http
POST /v1/evaluate/batch HTTP/1.1
Host: flags.hanzo.ai
Authorization: Bearer hf_project_key_abc123
Content-Type: application/json

{
  "flags": ["inference-model-experiment", "new-dashboard", "rag-strategy"],
  "context": {
    "user_id": "user_789",
    "org": "hanzo",
    "plan": "pro"
  }
}
```

Response:
```json
{
  "flags": {
    "inference-model-experiment": {
      "value": "zen-120b",
      "variant": "zen-120b",
      "reason": "TARGETING_MATCH"
    },
    "new-dashboard": {
      "value": true,
      "variant": "on",
      "reason": "SPLIT"
    },
    "rag-strategy": {
      "value": {"chunk_size": 512, "top_k": 5, "reranker": "cross-encoder"},
      "variant": "strategy-b",
      "reason": "SPLIT"
    }
  }
}
```

#### Performance Requirements

| Metric | Target |
|--------|--------|
| Evaluation latency (p50) | < 1ms |
| Evaluation latency (p99) | < 5ms |
| Batch evaluation (10 flags, p99) | < 10ms |
| Availability | 99.99% |
| Throughput | 100K evaluations/second per node |

These targets are achievable because flag evaluation is a pure in-memory operation. Flag definitions are synced from PostgreSQL to Redis, then pulled into an in-process cache in each SDK instance. The evaluation endpoint exists for server-side languages that prefer a thin client; SDKs with local evaluation never hit this endpoint at all.

### Admin API

The Admin API manages flag definitions, experiments, and audit history. It requires a management API key (`hf_admin_` prefix) and is NOT exposed to end-user SDKs.

```
POST   /admin/v1/flags                  # Create flag
GET    /admin/v1/flags                  # List flags
GET    /admin/v1/flags/{key}            # Get flag
PUT    /admin/v1/flags/{key}            # Update flag
DELETE /admin/v1/flags/{key}            # Archive flag
POST   /admin/v1/flags/{key}/toggle     # Enable/disable

POST   /admin/v1/experiments            # Create experiment
GET    /admin/v1/experiments            # List experiments
GET    /admin/v1/experiments/{id}       # Get experiment with results
PUT    /admin/v1/experiments/{id}       # Update experiment
POST   /admin/v1/experiments/{id}/stop  # Stop experiment, lock winner

GET    /admin/v1/audit                  # Audit log of all changes
```

Every mutation to a flag or experiment is recorded in an append-only audit log with the acting user, timestamp, and diff of the change. This audit log is queryable via the Admin API and is critical for debugging production incidents ("who changed the model rollout percentage at 3am?").

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

**Automatic metrics** are collected by the LLM Gateway (HIP-0004) and API Gateway (HIP-0044). When a request passes through the gateway with an active experiment assignment, the gateway emits a structured event to Kafka:

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

### Integration with Gateway (HIP-0044)

The API Gateway integrates with Hanzo Flags to perform traffic splitting at the infrastructure layer. This is essential for model routing experiments where the split must happen before the request reaches any application code.

```
Client request
  --> API Gateway (HIP-0044)
      --> Evaluate flag: "inference-model-experiment"
      --> Result: "zen-120b"
      --> Route to LLM Gateway with X-Model-Override: zen-120b
          --> LLM Gateway (HIP-0004) uses specified model
          --> Response includes X-Experiment-Variant: treatment
      --> Gateway emits experiment_exposure event to Kafka
  <-- Response to client
```

KrakenD configuration for gateway-level flag evaluation:

```json
{
  "endpoint": "/v1/chat/completions",
  "extra_config": {
    "plugin/hanzo-flags": {
      "flag_key": "inference-model-experiment",
      "context_from_headers": {
        "user_id": "X-User-Id",
        "org": "X-Org-Id",
        "plan": "X-User-Plan"
      },
      "action": "set_header",
      "target_header": "X-Model-Override",
      "emit_exposure_event": true
    }
  }
}
```

This gateway plugin evaluates the flag using the local in-process cache (no network call), sets a header that the LLM Gateway respects, and emits the exposure event asynchronously. The evaluation adds < 0.1ms to request latency.

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

Hanzo Flags includes a built-in statistical engine for experiment analysis. It supports three analysis methods, chosen based on the experiment type and organizational preference.

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

```
                                    ┌─────────────────────┐
                                    │   Admin UI / API     │
                                    │  Flag management     │
                                    │  Experiment config   │
                                    └──────────┬──────────┘
                                               │ write
                                               v
┌──────────────┐                    ┌─────────────────────┐
│  PostgreSQL   │<───── persist ────│   Flags Service      │
│  (flag defs,  │                   │   (Go, port 8063)    │
│   audit log)  │                   │                      │
└──────────────┘                    │  - Admin API          │
                                    │  - Evaluation API     │
┌──────────────┐                    │  - Sync to Redis      │
│  Redis        │<───── sync ──────│  - Stats engine       │
│  (flag state, │                   └──────────┬──────────┘
│   cache)      │                              │
└──────┬───────┘                               │ emit
       │ read                                  v
       v                            ┌─────────────────────┐
┌──────────────┐                    │   Kafka (HIP-0030)   │
│  SDK / Gateway│                   │  topic: experiment_   │
│  (in-process  │                   │  exposures            │
│   cache)      │                   └──────────┬──────────┘
└──────────────┘                               │ consume
                                               v
                                    ┌─────────────────────┐
                                    │   ClickHouse          │
                                    │  (experiment metrics, │
                                    │   shared w/ HIP-0017) │
                                    └─────────────────────┘
```

### Flag Sync Protocol

1. Flag definitions are stored in PostgreSQL (source of truth)
2. On create/update/delete, the Flags Service writes to PostgreSQL and publishes a change event to Redis Pub/Sub channel `flags:changes`
3. All Flags Service instances subscribe to `flags:changes` and update their Redis hash (`flags:{project_id}`)
4. SDKs with local evaluation poll Redis every 30 seconds (configurable) or subscribe to Server-Sent Events for real-time updates
5. The evaluation endpoint reads from the in-process cache (populated from Redis), never from PostgreSQL

This architecture means PostgreSQL can go down for 30 minutes and flag evaluation continues uninterrupted from the Redis + in-process cache. SDKs with local evaluation continue working even if Redis is down, using their last-known flag state.

### API Key Types

| Prefix | Type | Capabilities |
|--------|------|-------------|
| `hf_project_` | Project key | Evaluate flags, report metrics |
| `hf_admin_` | Admin key | Full CRUD on flags and experiments |
| `hf_server_` | Server SDK key | Evaluate flags with local evaluation (pulls full flag config) |

## Implementation

### Deployment

```yaml
# K8s Deployment on hanzo-k8s
apiVersion: apps/v1
kind: Deployment
metadata:
  name: flags
  namespace: hanzo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: flags
  template:
    spec:
      containers:
      - name: flags
        image: ghcr.io/hanzoai/flags:latest
        ports:
        - containerPort: 8063
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: flags-secrets
              key: database-url
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: flags-secrets
              key: redis-url
        - name: KAFKA_BROKERS
          value: "insights-kafka.hanzo.svc:9092"
        resources:
          requests:
            cpu: 250m
            memory: 256Mi
          limits:
            cpu: 500m
            memory: 512Mi
        livenessProbe:
          httpGet:
            path: /healthz
            port: 8063
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /readyz
            port: 8063
          periodSeconds: 5
```

### SDK Usage

#### Go (Server-Side with Local Evaluation)

```go
package main

import (
    "context"
    "fmt"

    "github.com/hanzoai/flags-go"
    "github.com/open-feature/go-sdk/openfeature"
)

func main() {
    // Register Hanzo Flags as OpenFeature provider
    provider := flags.NewProvider(flags.Config{
        ServerURL: "https://flags.hanzo.ai",
        APIKey:    "hf_server_key_abc123",
        CacheTTL:  30 * time.Second,
    })
    openfeature.SetProvider(provider)
    defer provider.Shutdown()

    client := openfeature.NewClient("inference-service")

    // Evaluate a string flag
    ctx := openfeature.NewEvaluationContext("user_789", map[string]interface{}{
        "org":  "hanzo",
        "plan": "pro",
    })

    model, _ := client.StringValue(context.Background(), "inference-model-experiment", "zen-72b", ctx)
    fmt.Printf("Using model: %s\n", model)
}
```

#### Python (Server-Side)

```python
from openfeature import api as openfeature
from hanzoai.flags import HanzoFlagsProvider

# Register provider
provider = HanzoFlagsProvider(
    server_url="https://flags.hanzo.ai",
    api_key="hf_server_key_abc123",
)
openfeature.set_provider(provider)

client = openfeature.get_client()

# Evaluate with context
context = openfeature.EvaluationContext(
    targeting_key="user_789",
    attributes={"org": "hanzo", "plan": "pro"},
)

model = client.get_string_value("inference-model-experiment", "zen-72b", context)
print(f"Using model: {model}")

# Object flag for RAG config
rag_config = client.get_object_value("rag-strategy", {"chunk_size": 256}, context)
print(f"RAG config: chunk_size={rag_config['chunk_size']}, top_k={rag_config['top_k']}")
```

#### TypeScript (Client-Side)

```typescript
import { OpenFeature } from '@openfeature/web-sdk';
import { HanzoFlagsProvider } from '@hanzoai/flags-openfeature-web';

// Initialize
OpenFeature.setProvider(new HanzoFlagsProvider({
  serverUrl: 'https://flags.hanzo.ai',
  apiKey: 'hf_project_key_abc123',
}));

const client = OpenFeature.getClient();

// Set context once (persists across evaluations)
OpenFeature.setContext({
  targetingKey: 'user_789',
  org: 'hanzo',
  plan: 'pro',
});

// Evaluate
const showNewDashboard = await client.getBooleanValue('new-dashboard', false);
const model = await client.getStringValue('inference-model-experiment', 'zen-72b');
```

## Security

### Authentication

All API requests require a valid API key in the `Authorization` header. Project keys (`hf_project_`) can only evaluate flags. Admin keys (`hf_admin_`) can manage flags and experiments. Server keys (`hf_server_`) can evaluate and pull full flag configurations for local evaluation.

### Flag Access Control

Flags are scoped to projects. A project key can only evaluate flags within its project. Admin keys are scoped to organizations. Multi-tenant isolation is enforced at the API layer -- there is no way for one project's SDK to evaluate another project's flags.

### Audit Trail

Every flag mutation (create, update, toggle, delete) is recorded with:
- Acting user (from IAM token or API key)
- Timestamp (UTC, millisecond precision)
- Full diff of the change (before/after JSON)
- IP address and user agent

The audit log is append-only and cannot be modified or deleted via the API. It is stored in PostgreSQL with a 2-year retention policy.

### Experiment Data Privacy

Experiment exposure events contain `distinct_id` and variant assignment. They do NOT contain the user's request or response content. Metric values (latency, cost, quality score) are aggregate numbers, not raw inference data. This ensures that the experimentation system never stores or transmits user prompts, completions, or any PII beyond the stable user identifier.

## Monitoring

```yaml
alerts:
  - name: FlagEvaluationLatencyHigh
    expr: histogram_quantile(0.99, flags_evaluation_duration_seconds_bucket) > 0.005
    for: 5m
    severity: warning
    summary: "Flag evaluation p99 > 5ms"

  - name: FlagSyncStale
    expr: (time() - flags_last_sync_timestamp_seconds) > 120
    for: 2m
    severity: critical
    summary: "Flag state not synced from Redis in > 2 minutes"

  - name: ExperimentGuardrailBreached
    expr: flags_experiment_guardrail_breached == 1
    for: 0m
    severity: critical
    summary: "Experiment guardrail threshold exceeded -- auto-kill may trigger"

  - name: ExposureEventLag
    expr: kafka_consumer_group_lag{group="flags-exposures"} > 50000
    for: 5m
    severity: warning
    summary: "Experiment exposure event consumer lag > 50K"
```

## Migration Path

For teams currently using the PostHog/Insights feature flags (HIP-0017), migration is straightforward:

1. **Export existing flags** from Insights via `GET /api/feature_flags`
2. **Import into Hanzo Flags** via `POST /admin/v1/flags` (schema mapping is provided in the `flags-migrate` CLI tool)
3. **Switch SDKs** from PostHog `featureFlags` to OpenFeature with `HanzoFlagsProvider`
4. **Verify** by running both systems in parallel (dual-evaluation mode) and comparing results

The `flags-migrate` tool handles the schema translation and verifies evaluation consistency between the two systems before cutover.

## References

1. [HIP-4: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md)
2. [HIP-17: Analytics Event Standard](./hip-0017-analytics-event-standard.md)
3. [HIP-44: API Gateway Standard](./hip-0044-api-gateway-standard.md)
4. [OpenFeature Specification](https://openfeature.dev/specification/)
5. [OpenFeature Go SDK](https://github.com/open-feature/go-sdk)
6. [Thompson Sampling for Multi-Armed Bandits](https://arxiv.org/abs/1707.02038)
7. [Bayesian A/B Testing at VWO](https://vwo.com/downloads/VWO_SmartStats_technical_whitepaper.pdf)
8. [Hanzo Flags Repository](https://github.com/hanzoai/flags)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
