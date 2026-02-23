---
hip: 0051
title: Guard Security Standard
author: Hanzo AI Team
type: Standards Track
category: Security
status: Draft
created: 2026-02-23
---

# HIP-51: Guard Security Standard

## Abstract

This proposal defines **Guard**, an AI-aware Web Application Firewall (WAF) for the Hanzo ecosystem. Guard sits inline between the API Gateway (HIP-44) and backend services, inspecting every request and response for threats specific to AI workloads: prompt injection, model abuse, PII leakage, token budget exhaustion, and adversarial inputs that traditional WAFs cannot detect.

Traditional WAFs understand HTTP. They can block SQL injection, cross-site scripting, and malformed headers. They cannot read a prompt and determine that it is attempting to override system instructions. They cannot inspect a model response and detect that it contains a user's social security number. They cannot enforce that a single API key has spent no more than $50 on inference today. Guard can.

**Repository**: [github.com/hanzoai/guard](https://github.com/hanzoai/guard)
**Port**: 8051 (API / admin), 8052 (inline proxy)
**Docker**: `ghcr.io/hanzoai/guard:latest`
**Language**: Go

## Motivation

### AI Endpoints Are Not Normal Endpoints

A traditional API accepts structured input (JSON with known fields), performs deterministic operations, and returns structured output. The threat model is well understood: injection, authentication bypass, authorization escalation, denial of service.

AI endpoints are fundamentally different:

1. **Input is natural language.** The "payload" is a prompt -- unstructured text in any human language, potentially containing instructions that the model will interpret and execute. There is no schema to validate against. The attack surface is the entire space of human language.

2. **Output is non-deterministic.** The same input can produce different outputs. A model might leak training data, generate harmful content, or reveal system prompts -- not because of a software bug, but because that is how language models work. The response itself is a threat vector.

3. **Cost is per-token, not per-request.** A single request with a 100,000-token context window costs 1,000x more than a request with 100 tokens. Traditional rate limiting (requests per second) does not prevent a single expensive request from exhausting a budget.

4. **Attacks are semantic, not syntactic.** SQL injection has syntactic signatures (`' OR 1=1 --`). Prompt injection has no fixed syntax. "Ignore all previous instructions" works, but so does an infinite number of paraphrases in any language. Detection requires understanding intent, not matching patterns.

5. **Models can be weaponized.** Jailbroken models can generate malware, phishing content, or instructions for harm. The WAF must inspect outputs, not just inputs.

### Why Not Just Use Cloudflare WAF?

Cloudflare WAF is excellent at what it does: DDoS mitigation, IP reputation, bot management, and OWASP rule enforcement at the network edge. Hanzo uses Cloudflare (or equivalent) for these capabilities. But Cloudflare operates at L3-L7 and treats request bodies as opaque blobs. It cannot:

- Parse a prompt and detect injection attempts
- Scan a model response for PII before it reaches the client
- Track cumulative token spend per API key across requests
- Distinguish between a legitimate 50,000-token research query and an adversarial context-stuffing attack
- Apply different rules to different models (a code generation model needs different guardrails than a medical Q&A model)

Guard operates at the **application layer**, with full semantic understanding of AI request/response payloads. It complements Cloudflare; it does not replace it.

```
Internet --> Cloudflare (L3-L7) --> API Gateway (HIP-44) --> Guard (HIP-51) --> LLM Gateway (HIP-4)
                DDoS, IP rep,         Routing, auth,          Prompt scan,       Provider routing,
                edge caching          rate limit (req/s)      PII filter,        model selection,
                                                              token budget       cost optimization
```

### Why Inline, Not Sidecar

Guard runs as an inline reverse proxy, not as a sidecar container or an out-of-band analyzer.

**Sidecar pattern** (Envoy + external authorization): The sidecar intercepts the request, sends it to an external service for analysis, waits for a decision, then forwards or rejects. This adds one network hop per direction (request to authz service, response back), increasing latency by 5-20ms. Worse, response scanning requires buffering the entire response before forwarding, which breaks streaming (SSE) -- the primary delivery mechanism for LLM completions.

**Out-of-band analysis** (log-and-analyze): Requests are forwarded immediately and analyzed asynchronously. This adds zero latency but cannot block threats. A leaked SSN reaches the client before the analyzer detects it.

**Inline proxy** (Guard's approach): Guard is in the request path. It inspects and decides synchronously for requests, and inspects streaming response chunks as they pass through. This enables:

- Blocking malicious requests before they reach the model
- Scanning response tokens as they stream, halting the stream if PII is detected mid-response
- Accurate token counting for budget enforcement
- Sub-5ms added latency for cached rule evaluations

The tradeoff is that Guard is in the critical path. If Guard crashes, requests fail. This is mitigated by running multiple replicas behind the API Gateway, with health checks and automatic failover.

## Design Philosophy

### Defense in Depth, Not Single Point

Guard is one layer in a multi-layer security architecture:

| Layer | Component | Responsibility |
|-------|-----------|---------------|
| Edge | Cloudflare / DO Firewall | DDoS, IP reputation, TLS |
| Gateway | API Gateway (HIP-44) | Auth, routing, request rate limiting |
| Application | **Guard (HIP-51)** | AI-specific: prompt, PII, token budget, abuse |
| Model | LLM Gateway (HIP-4) | Provider-level safety filters, content policy |
| Audit | O11y (HIP-31) | Post-hoc analysis, anomaly detection |

Each layer handles threats appropriate to its position. Guard does not duplicate the API Gateway's JWT validation or Cloudflare's SYN flood protection. It focuses exclusively on threats that require understanding AI payloads.

### Rules Are Data, Not Code

Guard's detection logic is driven by a rules engine with declarative YAML configuration, not hardcoded pattern matching. Rules can be added, modified, and deployed without recompiling Guard. This matters because AI attack techniques evolve weekly. A new jailbreak technique discovered on Monday should be blocked by Tuesday, without a code release.

### Fail Open vs Fail Closed

Guard defaults to **fail closed** for request scanning (block suspicious requests) and **fail open** for response scanning (allow responses if the scanner is degraded). The rationale: a false positive on a request means the user retries; a false positive on a response means the user's in-progress stream is killed, which is a worse experience. Operators can configure either behavior per rule.

## Specification

### Architecture

```
                     API Gateway (HIP-44)
                            |
                   +--------+--------+
                   |     Guard       |
                   |   :8052 proxy   |
                   |   :8051 admin   |
                   +--------+--------+
                   |  Rule  | Token  |
                   | Engine | Budget |
                   +---+----+---+----+
                       |        |
              +--------+--+  +--+--------+
              | Prompt     |  | PII       |
              | Analyzer   |  | Scanner   |
              +--------+---+  +---+-------+
                       |          |
                   +---+----------+---+
                   |  LLM Gateway     |
                   |  (HIP-4) :4000   |
                   +------------------+
```

Guard exposes two ports:

- **8052 (proxy)**: Inline reverse proxy. The API Gateway forwards AI-bound traffic here. Guard inspects, decides, and proxies to the LLM Gateway.
- **8051 (admin)**: Management API for rule CRUD, statistics, health checks, and manual overrides (e.g., unblocking a false-positive IP).

### Request Inspection Pipeline

Every inbound request passes through these stages in order:

```
Request --> [1. IP Check] --> [2. Auth Enrich] --> [3. Rate/Budget] --> [4. Prompt Scan] --> Forward
               |                   |                    |                    |
               v                   v                    v                    v
            Blocked            Enriched              429/Budget           Blocked
           (403/ban)          (headers)              exhausted           (400/inject)
```

**Stage 1: IP Reputation and Geo-Check**

Guard maintains an IP reputation database, updated hourly from threat intelligence feeds and internal abuse signals. Each IP is scored 0-100 (0 = known malicious, 100 = known good).

| Score | Action |
|-------|--------|
| 0-20 | Block immediately, log to O11y |
| 21-50 | Challenge (require valid API key + CAPTCHA) |
| 51-80 | Allow, elevated monitoring |
| 81-100 | Allow, normal monitoring |

Geo-blocking rules restrict traffic by country code. Operators configure allowed/blocked regions per application. Default: allow all.

**Stage 2: Authentication Enrichment**

Guard does not perform authentication (that is the API Gateway's responsibility). It reads the headers injected by the Gateway (`X-User-ID`, `X-Org-ID`, `X-Hanzo-Key`, `X-Scopes`) and uses them for per-identity policy enforcement. If these headers are missing, Guard rejects the request -- it refuses to operate on unauthenticated traffic.

**Stage 3: Rate Limiting and Token Budget**

Guard enforces three dimensions of rate limiting that the API Gateway cannot:

| Dimension | Scope | Example |
|-----------|-------|---------|
| **Requests per minute** | Per key, per model | `sk-hanzo-abc` may call `zen-72b` 60 times/min |
| **Tokens per minute** | Per key, per model | `sk-hanzo-abc` may consume 100K tokens/min on `zen-72b` |
| **Dollar budget per day** | Per key, per org | `sk-hanzo-abc` may spend $50/day across all models |

Token counting is performed on the request body (input tokens via tokenizer estimation) and on the response (output tokens counted as they stream). Budget accounting is stored in Valkey (HIP-28) with atomic increment operations.

When a budget is exhausted, Guard returns:

```json
{
  "error": {
    "type": "budget_exceeded",
    "message": "Daily token budget exhausted for this API key.",
    "budget_limit": 5000000,
    "budget_used": 5000127,
    "resets_at": "2026-02-24T00:00:00Z"
  }
}
```

**Stage 4: Prompt Injection Detection**

This is Guard's most distinctive capability. Prompt injection occurs when user input attempts to override the system prompt or manipulate the model into unintended behavior. Guard uses a layered detection approach:

**Layer A -- Pattern matching (< 1ms):** A curated set of regular expressions catches known injection patterns: "ignore previous instructions", "you are now", "system prompt override", base64-encoded instructions, and common jailbreak templates. This catches the low-hanging fruit with zero latency cost.

**Layer B -- Heuristic analysis (< 2ms):** Structural analysis of the prompt detects anomalies:
- Sudden role switches within user content (e.g., `\nAssistant:` or `\n[SYSTEM]` injected mid-prompt)
- Unusual Unicode characters used to visually disguise instructions
- Excessive repetition (token-flooding attacks)
- Embedded code blocks containing shell commands or SQL

**Layer C -- Classifier model (< 10ms):** A lightweight fine-tuned classifier (distilled from Zen models, running locally on CPU) scores prompts on a 0-1 injection probability scale. Prompts scoring above 0.85 are blocked; 0.5-0.85 are flagged for elevated monitoring. The classifier is updated weekly with new adversarial examples.

Each layer runs in sequence. If Layer A blocks, Layers B and C are skipped. This keeps average latency under 3ms for legitimate traffic while providing deep analysis for suspicious inputs.

### Response Inspection Pipeline

```
LLM Response --> [1. PII Scan] --> [2. Content Filter] --> [3. Token Count] --> Client
                      |                   |                       |
                      v                   v                       v
                   Redacted           Filtered/Halted         Budget updated
```

**Stage 1: PII Scanner**

Guard scans response tokens for Personally Identifiable Information using a combination of pattern matching and entity recognition:

| PII Type | Detection Method | Action |
|----------|-----------------|--------|
| Email addresses | Regex | Redact (`j***@example.com`) |
| Phone numbers | Regex + country format | Redact |
| SSN / National ID | Regex + checksum | Block response, alert |
| Credit card numbers | Regex + Luhn check | Block response, alert |
| Physical addresses | NER model | Redact (configurable) |
| API keys / secrets | Regex (known prefixes) | Block response, alert |

For streaming responses (SSE), Guard maintains a sliding window buffer of 200 tokens. PII detection runs on the buffer. If PII is found, the stream is halted, the partial response is redacted, and the client receives a termination event:

```
data: {"choices":[{"delta":{"content":"The user's email is j"}}]}

data: {"choices":[{"delta":{"content":"[REDACTED]"}}]}

data: {"choices":[{"finish_reason":"content_filter"}]}

data: [DONE]
```

**Stage 2: Content Filter**

Guard evaluates response content against configurable content policies: harmful content (violence, self-harm, illegal instructions), malware generation (dangerous system calls, known signatures), and system prompt leakage. Violations halt the stream and return a standardized refusal, with the partial response logged to O11y.

**Stage 3: Token Accounting**

As response tokens stream through, Guard counts them and updates budget counters in Valkey. This provides real-time spend tracking without requiring cooperation from the LLM provider.

### Bot Detection and Management

Not all bots are bad. Guard distinguishes three categories:

| Category | Examples | Policy |
|----------|---------|--------|
| **Verified bots** | Googlebot, Bingbot, GPTBot | Allow with rate limit, respect robots.txt |
| **Unverified bots** | Scrapers claiming to be Googlebot | Challenge (reverse DNS verification) |
| **Malicious bots** | Credential stuffing, enumeration | Block, add IP to reputation database |

Bot detection uses User-Agent analysis, behavioral analysis (request timing, access patterns), reverse DNS verification, TLS fingerprinting (JA3/JA4), and challenge-response (JavaScript challenge for browsers, CAPTCHA for suspected bots).

### Custom Rules Engine

Operators define rules in YAML. Each rule specifies a condition, an action, and a scope:

```yaml
rules:
  - id: block-context-stuffing
    description: Block requests with excessive input tokens
    condition:
      field: estimated_input_tokens
      operator: gt
      value: 128000
    action: block
    response:
      status: 413
      error: "Input exceeds maximum token limit"
    scope:
      models: ["zen-8b", "zen-14b"]  # small models only
    severity: medium

  - id: rate-limit-image-gen
    description: Limit image generation to prevent abuse
    condition:
      field: endpoint
      operator: matches
      value: "/v1/images/*"
    action: rate_limit
    rate_limit:
      max_requests: 10
      window: 60s
      per: api_key
    severity: low

  - id: block-known-jailbreak
    description: Block a specific known jailbreak pattern
    condition:
      field: prompt_content
      operator: contains_any
      value:
        - "DAN mode enabled"
        - "Developer Mode enabled"
        - "ignore your content policy"
    action: block
    response:
      status: 400
      error: "Request violates content policy"
    severity: high
    log: true
```

Rules are evaluated in priority order (high severity first). The first matching rule determines the action. A `pass` action explicitly allows the request, short-circuiting remaining rules.

Rules are hot-reloaded from a ConfigMap in Kubernetes or a watched file on disk. Changes take effect within 5 seconds without restart.

### Audit Logging

Every security-relevant event is logged to the O11y stack (HIP-31) as structured JSON:

```json
{
  "timestamp": "2026-02-23T14:30:00.123Z",
  "event": "prompt_injection_blocked",
  "request_id": "req_abc123",
  "user_id": "usr_xyz",
  "org_id": "org_hanzo",
  "api_key_hash": "sha256:abcdef...",
  "source_ip": "203.0.113.42",
  "model": "zen-72b",
  "detection_layer": "classifier",
  "injection_score": 0.92,
  "action": "block",
  "latency_ms": 8,
  "rule_id": null,
  "prompt_hash": "sha256:fedcba..."
}
```

Events are categorized:

| Event Type | Severity | Description |
|-----------|----------|-------------|
| `prompt_injection_blocked` | High | Prompt injection detected and blocked |
| `pii_redacted` | High | PII found in response, redacted |
| `pii_blocked` | Critical | High-sensitivity PII (SSN, credit card), stream halted |
| `budget_exceeded` | Medium | Token or dollar budget exhausted |
| `rate_limit_hit` | Low | Request rate limit exceeded |
| `ip_blocked` | Medium | IP blocked by reputation or geo-rule |
| `bot_challenged` | Low | Unverified bot issued challenge |
| `content_filtered` | High | Harmful content detected in response |
| `jailbreak_detected` | High | Model jailbreak attempt detected |
| `rule_triggered` | Varies | Custom rule matched |

Prompts are **never logged in plaintext**. Only the SHA-256 hash is stored. If investigation requires the original prompt, a separate, access-controlled audit store holds encrypted copies with a 30-day retention, accessible only to the security team via IAM role `security:audit:read`.

### Metrics

Prometheus metrics exported on port 8051 under namespace `hanzo_guard`:

| Metric | Type | Description |
|--------|------|-------------|
| `hanzo_guard_requests_total` | Counter | Requests by action (allow, block, challenge) |
| `hanzo_guard_prompt_injection_total` | Counter | Injection detections by layer (pattern, heuristic, classifier) |
| `hanzo_guard_pii_detections_total` | Counter | PII detections by type (email, ssn, credit_card, etc.) |
| `hanzo_guard_token_budget_usage` | Gauge | Current token budget utilization per org |
| `hanzo_guard_scan_latency_seconds` | Histogram | Request/response scan latency |
| `hanzo_guard_classifier_score` | Histogram | Distribution of injection classifier scores |
| `hanzo_guard_rules_evaluated_total` | Counter | Rule evaluations by rule_id and result |
| `hanzo_guard_bot_detections_total` | Counter | Bot detections by category |
| `hanzo_guard_active_streams` | Gauge | Currently active SSE response streams |

## Implementation

### Phase 1: Core Proxy and IP Layer (Q1 2026)

- Inline proxy between API Gateway and LLM Gateway
- IP reputation database (MaxMind GeoIP2 + internal feeds)
- Geo-blocking with configurable allow/deny lists
- Basic request rate limiting (per-key, per-model)
- Structured audit logging to O11y
- Health checks and Prometheus metrics

### Phase 2: Prompt and Response Scanning (Q2 2026)

- Pattern-based prompt injection detection (Layer A)
- Heuristic prompt analysis (Layer B)
- PII scanner for responses (regex-based: email, phone, SSN, credit card)
- Streaming response inspection with sliding window buffer
- Token counting and budget enforcement via Valkey
- Custom rules engine (YAML, hot-reload)

### Phase 3: ML-Based Detection (Q3 2026)

- Prompt injection classifier model (Layer C)
- NER-based PII detection for addresses and names
- Content policy classifier (harmful content, malware generation)
- System prompt leakage detection
- Bot behavioral analysis

### Phase 4: Advanced and Adaptive (Q4 2026)

- Adaptive rate limiting (thresholds adjust based on traffic patterns)
- TLS fingerprinting (JA3/JA4)
- Federated threat intelligence sharing across Hanzo deployments
- API for third-party rule providers
- Dashboard in Console (HIP-30) for security operations

### Deployment

Guard runs as a stateless Deployment with three replicas. Configuration is mounted via ConfigMap. Resource requirements: 500m-2000m CPU, 256Mi-1Gi memory (the classifier model loads into memory at startup).

| Environment | Image | Config | Upstream |
|-------------|-------|--------|----------|
| Production (K8s) | `ghcr.io/hanzoai/guard:latest` | ConfigMap `guard-rules` | `llm-gateway.hanzo.svc:4000` |
| Development | Same image | `./rules.yaml` bind mount | `llm-gateway:4000` |

Environment variables: `GUARD_VALKEY_URL`, `GUARD_LLM_UPSTREAM`, `GUARD_RULES_PATH`, `GUARD_LOG_LEVEL`.

Health probes: `GET /health` (liveness on :8051), `GET /ready` (readiness on :8051, checks Valkey and upstream connectivity).

### API Gateway Integration

The API Gateway (HIP-44) is reconfigured to route AI traffic through Guard instead of directly to the LLM Gateway:

```json
{
  "endpoint": "/v1/chat/completions",
  "method": "POST",
  "timeout": "120s",
  "backend": [{
    "url_pattern": "/v1/chat/completions",
    "host": ["http://guard.hanzo.svc:8052"],
    "encoding": "no-op"
  }]
}
```

Guard then forwards inspected traffic to the LLM Gateway. Non-AI endpoints (IAM, Search, Storage) bypass Guard entirely and route directly from the API Gateway to their backends.

## Security Considerations

### Guard Itself as an Attack Surface

Guard is a security component in the critical path. Its own security is paramount:

- **No external dependencies at runtime.** The classifier model runs locally. IP reputation is cached locally. Rules are read from a file. Guard does not call external APIs during request processing.
- **Memory safety.** Written in Go with no unsafe operations. Request body size is capped at 10 MB. Response buffer is capped at 50 MB.
- **Admin API authentication.** The admin port (8051) requires a separate `guard-admin` API key, not the same credentials used for AI endpoints. In production, the admin port is not exposed outside the cluster.
- **Rule injection.** Rules are loaded from a ConfigMap, not from user input. There is no API to create rules from unauthenticated requests.

### Evasion Resistance

Adversaries will attempt to bypass Guard's detection:

- **Encoding attacks** (base64, ROT13, Unicode homoglyphs): Guard normalizes input before scanning -- decoding common encodings, canonicalizing Unicode, and stripping zero-width characters.
- **Language switching**: The classifier is trained on multilingual injection examples. Pattern matching includes non-English templates.
- **Prompt splitting**: Distributing an injection across multiple messages in a conversation. Guard maintains per-session context (keyed by conversation ID) to detect multi-turn injection patterns.
- **Indirect injection** (via retrieved documents or tool outputs): Guard scans tool call results and RAG context, not just the user message.

No detection system is perfect. Guard's layered approach (patterns + heuristics + classifier) raises the cost of evasion significantly. The weekly classifier update cycle ensures that successful evasions are short-lived.

### Privacy

- Prompts are **never stored in plaintext** in logs or metrics. Only SHA-256 hashes are recorded.
- PII detected in responses is redacted **in memory** before logging. The original PII is never written to disk.
- The encrypted audit store has a 30-day automatic expiration.
- Guard's Valkey access is scoped to its budget-tracking keyspace. It cannot read other services' data.

### False Positives

- **Configurable thresholds**: Operators adjust the classifier threshold (default 0.85) per model or per organization.
- **Bypass tokens**: Trusted internal services include a signed `X-Guard-Bypass` header to skip prompt scanning. The key is rotated daily via KMS (HIP-27).
- **Appeal workflow**: Blocked requests include a `request_id` that users can submit for security team review.
- **Shadow mode**: New rules deploy in `log_only` mode first. Once false positive rates are acceptable, the rule is promoted to `enforce` mode.

## Relationship to Other HIPs

| HIP | Relationship |
|-----|-------------|
| **HIP-4** (LLM Gateway) | Guard proxies to LLM Gateway. LLM Gateway handles provider-level safety. |
| **HIP-5** (Post-Quantum Security) | Guard's TLS and key material will adopt PQC algorithms. |
| **HIP-26** (IAM) | Guard reads IAM-enriched headers for identity-based policy. |
| **HIP-27** (KMS) | Bypass tokens and encryption keys for audit store are managed by KMS. |
| **HIP-28** (KV Store) | Token budget counters and IP reputation cache stored in Valkey. |
| **HIP-31** (O11y) | All security events are exported to the O11y stack. |
| **HIP-44** (API Gateway) | API Gateway routes AI traffic to Guard before the LLM Gateway. |

## References

1. [OWASP Top 10 for Large Language Model Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
2. [NIST AI Risk Management Framework (AI RMF)](https://www.nist.gov/artificial-intelligence/ai-risk-management-framework)
3. [Prompt Injection Attacks and Defenses in LLM-Integrated Applications (Liu et al., 2023)](https://arxiv.org/abs/2310.12815)
4. [HIP-4: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md)
5. [HIP-26: Identity & Access Management](./hip-0026-identity-access-management-standard.md)
6. [HIP-31: Observability & Metrics](./hip-0031-observability-metrics-standard.md)
7. [HIP-44: API Gateway Standard](./hip-0044-api-gateway-standard.md)
8. [OWASP ModSecurity Core Rule Set](https://coreruleset.org/)
9. [RFC 6749 - OAuth 2.0 Authorization Framework](https://tools.ietf.org/html/rfc6749)
10. [Guard Repository](https://github.com/hanzoai/guard)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
