---
hip: 0063
title: Feature Flags Standard
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Final
created: 2026-02-23
requires: HIP-1190, HIP-0139, HIP-1311
capability: flags
---


# HIP-0063: Feature Flags Standard

## Abstract

This proposal defines the feature flag platform for the Hanzo ecosystem. Hanzo
Flags provides boolean flags, multivariate flags, percentage rollouts and user
targeting — the primitive every other plane composes, including the AI-specific
splits that make model routing, prompt selection and retrieval strategy
switchable without a deploy.

Evaluation semantics are PostHog-compatible — the embedded evaluator is pinned
to a 621-case parity table (`apps/flags/engine.go:11-13`) — so a PostHog-shaped
client repoints by changing the host. An OpenFeature adapter, if published,
wraps the generated SDK rather than defining the wire.

The A/B plane that composes this primitive — the experiment registry, its
analysis and its decision — is the separate `experiment` capability, HIP-1311.

**Evaluator**: [github.com/hanzoai/flags](https://github.com/hanzoai/flags) — the
stateless Go engine (`flags/go`) compiled into the cloud binary
**Serving**: `apps/flags` in `hanzoai/cloud`, at `/v1/flags` — there is no
standalone flags service, port or image; SDK access is the generated cloud SDKs
(HIP-1030)

## Motivation

Every software team eventually needs to decouple deployment from release. You push code to production, but the new behavior is hidden behind a flag. You turn it on for 1% of users, watch metrics, then ramp to 100%. If something breaks, you kill the flag -- no rollback, no redeployment, no incident.

This is table stakes for web applications. But AI systems introduce a category of experimentation that traditional feature flag platforms were never designed for:

1. **Model version rollouts**: You have Zen-72B in production. Zen-120B is ready. You want to route 5% of inference traffic to the new model, compare quality scores, latency, and cost, then decide whether to promote. This is not a boolean flag -- it is a traffic split with multi-dimensional metric analysis.

2. **Prompt template A/B testing**: The same model with two different system prompts produces different outputs. Which prompt yields better user satisfaction? Better task completion? Lower token usage? You need to randomly assign users to prompt variants and track downstream metrics.

3. **RAG strategy comparison**: Retrieval-augmented generation has multiple knobs -- chunk size, overlap, embedding model, reranker, top-k. Comparing strategies requires running parallel pipelines and measuring answer quality. This is a multi-armed bandit problem, not a simple on/off switch.

4. **Cost optimization experiments**: Route 20% of traffic to a cheaper model. If quality metrics remain within the baseline, promote the cheaper model for that traffic segment.

General-purpose flag platforms treat flags as configuration switches for UI elements, and their evaluation rides a hosted tier — a CDN poll or a streaming connection — that can go stale. For AI inference routing, a stale flag is a request routed to a deprecated model or a cost tier over budget. Hence the design: a stateless, PostHog-compatible evaluator compiled into the cloud binary, definitions in each org's own encrypted SQLite, with no evaluation tier that can go stale.

## Specification

### The shipped surface

**flags** (`manifest/apps.go:54`) serves seven operations under `/v1/flags`
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

The credential is the org's ordinary bearer per HIP-0026 — there is no `hf_*`
key family. The admin plane is not a second prefix: definition writes are
org-scoped on the same surface, and the platform's own switches are the
reserved platform store the SuperAdmin flips from the cockpit through the same
engine (`apps/flags/flags.go:21-27`).

Stated for HIP-0139 §6: the capability is **free**, said in those words
(`plugin/flags/main.go:21` — `Price: cloud.Free`), and `/v1/flags/` is on the
spend gate's never-refuse list (`spend.go:453`) because the kill switch must be
observable by an unpaid org. It owns the definition store above and no other.
It publishes **no events** on the bus, so a customer's webhooks (HIP-1310)
receive nothing from it, and it emits nothing to observability beyond the
request span. It is **ga** (HIP-0139 §8): flags is the mechanism stage-gating
itself rides, so it cannot sit behind a flag. Upstream: it embeds
`github.com/hanzoai/flags/go`, our own implementation of PostHog-compatible
evaluation semantics, pinned to the prior implementation's answers by a
621-case parity table (`apps/flags/engine.go:11-13`).

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
```

Every mutation to a flag definition is recorded append-only with the acting
user, timestamp and version (`apps/flags/store.go`), readable at
`GET /v1/flags/activity` — which is what answers "who changed the model
rollout percentage at 3am?". The platform's own operational switches are the
one cross-tenant surface: they live in the reserved platform store and only a
SuperAdmin writes them (`apps/flags/flags.go:21-27`).

## The plane that composes this one

An A/B test is a caller of this primitive, not a second engine inside it: the
experiment registry, the analysis over its arms and the decision that locks a
winner are the `experiment` capability, HIP-1311. Create and decide there write
a flag definition here, which is why the arm a request is served and the arm a
report names are one value.

### Integration with the serving path

Traffic splitting at the infrastructure layer — the gateway evaluating a flag
before the request reaches application code — is a design this section used
to specify in KrakenD configuration. No such gateway plugin ships; what
ships is in-process composition: any subsystem in the binary evaluates
through `flags.Assign` (the same deterministic rollout hash the HTTP surface
uses), which is how `apps/experiment` and `apps/campaign` split traffic
today with no network hop at all. A gateway-level split remains open design
and MUST, if built, evaluate through the same embedded engine rather than a
second one.

## Architecture

One binary, one subsystem, no tiers. `apps/flags` holds the definitions in each
org's own encrypted SQLite file and evaluates them in-process through the
embedded evaluator. There is no standalone flags service, no SQL-to-KV sync, no
KV pub/sub channel, no Kafka exposure topic and no separate deployment — the
earlier revision of this HIP specified all four, and the shipped shape replaced
them with something strictly simpler: the store is beside the evaluator, so
there is nothing to sync and nothing to go stale. Deployment is the cloud image;
the plugin binary is `plugin/flags`.

The credential is the caller's ordinary org key (HIP-0026). There is no `hf_*`
key family: the evaluate routes take the same bearer as every other `/v1`
surface, and tenancy is the validated principal, never the key prefix.

### SDK Usage

The client surface is the generated cloud SDKs and the `hanzo` CLI, both
projections of the served document (HIP-1030): the flags operations appear as
the `Flags` class/command group in every generated language. The hand-written `@hanzoai/flags-js` /
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

## Monitoring

It exports no metrics of its own today: there is no `flags_*` metric family and
no sync or consumer lag to alert on, because there is no sync and no consumer. What a customer can read back under
`/v1/o11y` is the request span every route already gets; the definition
change history is `GET /v1/flags/activity`. Alerting on evaluation latency,
if wanted, rides the fleet's ordinary request telemetry rather than a
capability-local exporter.

## References

1. [HIP-4: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md)
2. [HIP-1190: Event — The Product Analytics Plane](./hip-1190-event-product-analytics.md)
3. HIP-44: API Gateway Standard
4. [OpenFeature Specification](https://openfeature.dev/specification/)
5. [OpenFeature Go SDK](https://github.com/open-feature/go-sdk)
6. [Thompson Sampling for Multi-Armed Bandits](https://arxiv.org/abs/1707.02038)
7. [Hanzo Flags Repository](https://github.com/hanzoai/flags)
8. [HIP-1311: Experiment — Arms, Assignment, a Verdict](./hip-1311-experiment-the-ab-plane.md)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
