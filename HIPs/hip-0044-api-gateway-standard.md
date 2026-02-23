---
hip: 0044
title: API Gateway Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-02-23
requires: HIP-0004, HIP-0026
---

# HIP-44: API Gateway Standard

## Abstract

This proposal defines the API Gateway standard for the Hanzo ecosystem. The API Gateway is the single ingress point for all external traffic destined for Hanzo services. It handles routing, authentication, rate limiting, CORS, circuit breaking, caching, and observability for every HTTP request that enters the platform.

The gateway is built on **KrakenD**, a Go-based, stateless API gateway that routes requests declaratively via a single JSON configuration file. It requires no database, no clustering protocol, and no external coordination. One binary, one config file, sub-millisecond routing overhead.

This HIP is explicitly distinct from **HIP-4 (LLM Gateway)**, which is the AI-specific proxy for 100+ LLM providers. The API Gateway routes traffic *to* the LLM Gateway (among 26+ other backends). They solve different problems at different layers.

**Repository**: [github.com/hanzoai/gateway](https://github.com/hanzoai/gateway)
**Port**: 8080 (HTTP), 8443 (HTTPS)
**Docker**: `ghcr.io/hanzoai/gateway:latest`
**Config**: `krakend.json` (declarative)

## Motivation

### The Routing Problem

Hanzo runs 26+ backend services across two Kubernetes clusters. Without a gateway, each service would need its own Ingress resource, its own TLS certificate, its own rate limiting, and its own authentication middleware. This leads to:

1. **Configuration sprawl**: 26 Ingress resources, 26 TLS certificates, 26 rate limit configs. Each one slightly different. Each one a potential misconfiguration.
2. **Duplicated auth logic**: Every service independently validates JWTs, checks API keys, or calls IAM for token introspection. When the auth scheme changes, every service must be updated.
3. **No unified rate limiting**: Per-service rate limits cannot enforce org-wide or user-wide quotas. A user could exhaust their quota by spreading requests across services.
4. **No cross-cutting observability**: Without a central point, there is no single place to measure total request volume, error rates, or latency distributions across the platform.
5. **CORS chaos**: Each service configures CORS independently. One misconfigured `Access-Control-Allow-Origin` header and the frontend breaks silently.

### The Gateway Solution

A single API Gateway at `api.hanzo.ai` eliminates all five problems. Every external request enters through one point. Authentication is validated once. Rate limits are enforced globally. CORS headers are set consistently. Metrics are collected uniformly. Backend services receive pre-authenticated, pre-validated requests and focus exclusively on business logic.

### Why Not Just Use the LLM Gateway?

The LLM Gateway (HIP-4) is a *specialized* proxy for AI workloads. It understands tokens, models, providers, semantic caching, and cost optimization. None of that logic applies to IAM, Search, Storage, or the other 20+ services. Conflating general API routing with LLM-specific routing would create a monolithic gateway that does everything poorly.

```
Internet --> API Gateway (HIP-44) --> LLM Gateway (HIP-4) --> AI Providers
                                  --> IAM (HIP-26)
                                  --> Search, Storage, Flow, ...
                                  --> 23+ other services
```

The API Gateway routes `/v1/chat/*` to the LLM Gateway on port 4000. The LLM Gateway then handles provider selection, failover, and cost optimization. Each layer does one thing well.

## Design Philosophy

### Why KrakenD Over Kong

Kong is the most popular open-source API gateway. It is also a Lua/OpenResty application that requires PostgreSQL or Cassandra for configuration storage:

- **Stateful configuration**: Kong stores routes in a database. Database failure means routing failure. KrakenD reads a JSON file at startup. No database means no database failure mode.
- **Operational complexity**: Kong needs PostgreSQL schema migrations, database backups, connection pool tuning. KrakenD needs a file on disk.
- **Configuration drift**: Kong's Admin API allows runtime changes that may diverge from checked-in config. KrakenD's config is a file in Git. What is in Git is what is running.

| Factor | KrakenD | Kong |
|--------|---------|------|
| Language | Go | Lua/OpenResty |
| Configuration | Declarative JSON file | PostgreSQL/Cassandra |
| Database required | No | Yes |
| Runtime config changes | No (by design) | Yes (Admin API) |
| Memory at idle | ~30 MB | ~100 MB+ |
| Startup time | < 1s | 5-10s (DB connection) |
| Stack alignment | Same as IAM, Lux node | Requires separate runtime |

The tradeoff: Kong has a larger plugin ecosystem and a GUI. For our use case -- declarative routing with JWT validation and rate limiting -- KrakenD's feature set is sufficient, and the stateless architecture is decisive.

### Why KrakenD Over Envoy/Istio

An API gateway answers: "Given this HTTP request from the internet, which backend should handle it?" A service mesh answers: "Given this pod-to-pod communication inside the cluster, how should it be routed, encrypted, retried, and observed?"

These are different questions. Using Envoy as an API gateway means configuring xDS APIs, writing Envoy filter chains, and deploying a control plane (Pilot, Citadel, Galley) just to route HTTP requests. KrakenD does the same job with a single JSON file.

If Hanzo later needs service mesh capabilities (mTLS between pods, traffic splitting for canary deployments), Istio can be added alongside the API Gateway. They operate at different layers and are complementary, not competing.

### Why KrakenD Over AWS API Gateway

- **Latency**: AWS API Gateway adds 20-30ms per request. KrakenD adds sub-millisecond overhead.
- **Cost**: AWS charges $3.50/million requests. At 100M requests/month, that is $350/month for routing alone. KrakenD costs ~$0 marginal on existing infrastructure.
- **Vendor lock-in**: AWS integrations (Lambda authorizers, VPC links) do not port to other clouds. KrakenD runs anywhere Docker runs.
- **Configuration speed**: AWS stage deployments take minutes. KrakenD reloads config in milliseconds.
- **WebSocket support**: AWS requires a separate product (API Gateway v2). KrakenD proxies WebSockets natively.

### Why Declarative Configuration

The `krakend.json` file is the single source of truth. It lives in Git, is reviewed in pull requests, and is deployed via CI/CD. No Admin API, no database, no runtime mutation.

- **Reproducibility**: `git checkout <sha> && krakend run` reproduces any past configuration exactly.
- **Auditability**: `git log krakend.json` shows every routing change, who made it, and why.
- **Rollback**: `git revert <sha>` rolls back any bad config change in seconds.
- **No state corruption**: There is no database to corrupt, no cache to invalidate, no cluster state to synchronize.

The tradeoff is that changes require a restart (or graceful reload). KrakenD supports zero-downtime reloads via `krakend run -d`. In Kubernetes, a ConfigMap update triggers a rolling restart with zero dropped connections.

## Specification

### Architecture

```
                          Internet
                             |
                  +----------+----------+
                  |    Load Balancer    |
                  |  (DigitalOcean LB)  |
                  +----------+----------+
                             |
                  +----------+----------+
                  |    API Gateway      |
                  |    (KrakenD)        |
                  |   :8080 / :8443    |
                  +----------+----------+
                             |
        +--------------------+--------------------+
        |          |         |         |          |
   +----+----+ +--+---+ +---+--+ +----+----+ +---+---+
   |   LLM   | | IAM  | |Search| | Storage | | Flow  |
   | Gateway | |      | |      | | (MinIO) | |       |
   |  :4000  | | :8000| | :7700| |  :9000  | | :7860 |
   +---------+ +------+ +------+ +---------+ +-------+
```

The gateway is stateless. Every instance is identical. Horizontal scaling is achieved by adding more pods behind the load balancer. No leader election, no quorum, no consensus.

### Service Routing Table

All external API traffic is routed through the gateway at `api.hanzo.ai`. Each service is mounted at a versioned path prefix.

| Path Prefix | Backend Service | Port | Description |
|-------------|----------------|------|-------------|
| `/v1/chat/*` | LLM Gateway | 4000 | AI completions, embeddings, audio |
| `/v1/models/*` | LLM Gateway | 4000 | Model listing, capabilities |
| `/v1/auth/*` | IAM | 8000 | OAuth, OIDC, user management |
| `/v1/search/*` | Meilisearch | 7700 | Full-text and vector search |
| `/v1/flow/*` | Flow (n8n) | 7860 | Workflow execution |
| `/v1/storage/*` | MinIO | 9000 | Object storage (S3-compatible) |
| `/v1/kv/*` | Valkey | 6379 | Key-value store |
| `/v1/stream/*` | Kafka REST Proxy | 8082 | Event streaming |
| `/v1/vector/*` | Qdrant | 6333 | Vector database |
| `/v1/metrics/*` | Zap (HIP-31) | 9090 | Prometheus metrics |
| `/v1/registry/*` | Container Registry | 5000 | Docker image registry |
| `/v1/docs/*` | Document Service | 8001 | Document processing |
| `/v1/analytics/*` | Analytics | 8002 | Event collection |
| `/v1/payments/*` | Commerce | 8003 | Payment processing |
| `/v1/deploy/*` | Platform (Dokploy) | 3000 | Application deployment |
| `/v1/console/*` | Console | 3001 | Admin console API |
| `/v1/cloud/*` | Cloud | 3002 | Cloud management |
| `/v1/agents/*` | Agent Service | 8004 | Multi-agent orchestration |
| `/v1/images/*` | Image Generation | 8005 | Image/video generation |
| `/v1/compute/*` | Compute Marketplace | 8006 | GPU compute scheduling |
| `/v1/blockchain/*` | Lux Node | 9650 | Blockchain RPC |
| `/v1/ide/*` | IDE Backend | 8007 | Hanzo IDE services |
| `/v1/mcp/*` | MCP Server | 8008 | Model Context Protocol |
| `/v1/tensors/*` | Tensor Service | 8009 | Tensor operations |
| `/v1/bots/*` | Bot Service | 8010 | Bot/agent wallets |
| `/v1/kms/*` | KMS (Infisical) | 8011 | Secrets management |
| `/health` | Gateway (self) | -- | Liveness probe |
| `/__health` | Gateway (self) | -- | Readiness probe |
| `/__stats` | Gateway (self) | -- | Internal statistics |

### Endpoint Configuration Example

```json
{
  "endpoint": "/v1/chat/completions",
  "method": "POST",
  "timeout": "120s",
  "input_headers": ["Authorization", "Content-Type", "X-Request-ID", "X-Org-ID", "X-Hanzo-Key"],
  "output_encoding": "no-op",
  "backend": [{
    "url_pattern": "/v1/chat/completions",
    "host": ["http://llm-gateway.hanzo.svc:4000"],
    "encoding": "no-op"
  }],
  "extra_config": {
    "auth/validator": {
      "alg": "RS256",
      "jwk_url": "http://iam.hanzo.svc:8000/.well-known/jwks",
      "cache": true,
      "cache_duration": 3600
    },
    "qos/ratelimit/router": {
      "max_rate": 1000,
      "client_max_rate": 100,
      "strategy": "header",
      "key": "X-Hanzo-Key"
    }
  }
}
```

### Authentication

The gateway validates authentication before forwarding requests to backends. Three methods are supported, checked in order.

**1. JWT Validation (Bearer Token)**

The gateway fetches the JWKS from IAM at `http://iam.hanzo.svc:8000/.well-known/jwks`, caches it for one hour, and validates every `Authorization: Bearer <token>` header. Validated claims are propagated as headers to backend services (`sub` -> `X-User-ID`, `org` -> `X-Org-ID`, `scope` -> `X-Scopes`), so backends never need to parse JWTs themselves.

**2. API Key Lookup**

API keys prefixed `sk-hanzo-` are resolved via IAM's `/api/validate-key` endpoint. The gateway caches valid keys for 5 minutes. On key rotation, the cache TTL ensures stale keys expire promptly.

**3. OAuth Token Introspection**

For third-party OAuth tokens, the gateway performs RFC 7662 token introspection against IAM.

**Public Endpoints** (no auth required): `/health`, `/__health`, `/v1/auth/login`, `/v1/auth/signup`, `/v1/auth/.well-known/*`.

### Rate Limiting

Rate limiting operates at three levels:

**Global**: Protects the gateway itself -- 50,000 req/s max.

**Per-Endpoint**: Controls traffic to specific backends (e.g., 5,000 req/s to LLM Gateway).

**Per-Key / Per-Org**: Enforced by identifying the caller via API key or JWT claims:

| Tier | Requests/min | Requests/day | Burst |
|------|-------------|-------------|-------|
| Free | 60 | 1,000 | 10 |
| Developer | 600 | 50,000 | 50 |
| Team | 3,000 | 500,000 | 200 |
| Enterprise | 30,000 | Unlimited | 1,000 |

Rate limit headers are included in every response: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`.

### CORS Configuration

```json
{
  "security/cors": {
    "allow_origins": [
      "https://hanzo.ai", "https://hanzo.app",
      "https://cloud.hanzo.ai", "https://console.hanzo.ai",
      "https://platform.hanzo.ai", "https://*.hanzo.ai",
      "http://localhost:*"
    ],
    "allow_methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    "allow_headers": ["Authorization", "Content-Type", "X-Request-ID", "X-Hanzo-Key", "X-Org-ID"],
    "expose_headers": ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "X-Request-ID"],
    "allow_credentials": true,
    "max_age": "12h"
  }
}
```

Wildcard origins (`http://localhost:*`) are permitted only in non-production configurations.

### Circuit Breaker

Each backend has a circuit breaker that opens after consecutive failures:

```json
{
  "qos/circuit-breaker": {
    "interval": 60,
    "timeout": 10,
    "max_errors": 5,
    "name": "llm-gateway-cb",
    "log_status_change": true
  }
}
```

- **Closed**: Normal operation. Requests pass through.
- **Open**: Backend is failing. Requests return `503` immediately. Re-checked every `timeout` seconds.
- **Half-Open**: One probe request is allowed. Success closes the circuit; failure re-opens it.

### Response Caching

| Endpoint | Cache TTL | Rationale |
|----------|-----------|-----------|
| `/v1/models` | 300s | Model list changes infrequently |
| `/v1/search/*` | 60s | Search results are semi-static |
| `/v1/auth/.well-known/*` | 3600s | OIDC config is stable |
| `/v1/chat/*` | 0 (disabled) | AI responses must not be cached at gateway |
| `/v1/storage/*` | 0 (disabled) | Object storage has its own caching |

Cache keys include the full URL, query parameters, and the `Authorization` header hash to prevent cross-user cache leaks.

### Request/Response Transformation

- **X-Gateway-Version**: Injected into every request (`hanzo-gateway/1.0`).
- **X-Request-ID**: Generated if absent, propagated to all backends, included in the response for end-to-end tracing.
- **Claim propagation**: JWT claims (`sub`, `org`, `scope`) are extracted and forwarded as typed headers.

### WebSocket and SSE Proxying

Streaming endpoints (LLM completions, event streams) use `no-op` encoding to pass through without buffering. For Server-Sent Events, the gateway forwards `text/event-stream` responses verbatim. WebSocket connections are proxied with full duplex support, with the same authentication and rate limiting applied at connection establishment.

### TLS Termination

In production, TLS terminates at the load balancer. The gateway receives plaintext HTTP on port 8080 from within the cluster. For bare-metal or edge deployments, KrakenD terminates TLS directly with minimum TLS 1.2 (TLS 1.3 preferred).

### Health Checks

```
GET /health    --> 200 {"status": "ok"}                       (liveness)
GET /__health  --> 200 {"status": "ok", "backends": {...}}    (readiness)
```

The liveness probe returns 200 if the process is running. The readiness probe checks that critical backends (IAM, LLM Gateway) are reachable. Backend health is probed every 10 seconds; unhealthy backends are removed from the pool until they recover.

### Logging

Structured JSON logs on stdout, compatible with Kubernetes log collection:

- **ERROR**: Backend failures, authentication errors, circuit breaker state changes
- **WARN**: Rate limit hits, degraded backends, slow responses (> 5s)
- **INFO**: Request summaries (method, path, status, duration, request_id)
- **DEBUG**: Full request/response headers (disabled in production)

### Metrics

Prometheus metrics are exported on port 9091 with namespace `hanzo_gateway`:

| Metric | Type | Description |
|--------|------|-------------|
| `hanzo_gateway_requests_total` | Counter | Total requests by method, path, status |
| `hanzo_gateway_request_duration_seconds` | Histogram | Request latency distribution |
| `hanzo_gateway_backend_errors_total` | Counter | Backend errors by service |
| `hanzo_gateway_circuit_breaker_state` | Gauge | 0=closed, 1=open |
| `hanzo_gateway_rate_limit_hits_total` | Counter | Rate limit rejections |
| `hanzo_gateway_cache_hits_total` | Counter | Cache hit/miss ratio |
| `hanzo_gateway_active_connections` | Gauge | Current active connections |
| `hanzo_gateway_websocket_connections` | Gauge | Active WebSocket connections |

### Error Handling

The gateway returns consistent error responses:

```json
{
  "status": 429,
  "error": "rate_limit_exceeded",
  "message": "Rate limit exceeded. Retry after 60 seconds.",
  "request_id": "req_abc123",
  "retry_after": 60
}
```

| HTTP Status | Error Code | Cause |
|-------------|-----------|-------|
| 400 | `bad_request` | Malformed request |
| 401 | `unauthorized` | Missing or invalid credentials |
| 403 | `forbidden` | Valid credentials, insufficient permissions |
| 404 | `not_found` | No matching route |
| 408 | `request_timeout` | Backend did not respond within timeout |
| 429 | `rate_limit_exceeded` | Rate limit hit |
| 502 | `bad_gateway` | Backend returned invalid response |
| 503 | `service_unavailable` | Circuit breaker open or backend down |
| 504 | `gateway_timeout` | Backend timed out |

## Deployment

### Kubernetes (Production)

Three replicas with rolling updates (`maxSurge: 1`, `maxUnavailable: 0`). Configuration is mounted via ConfigMap. Resource limits: 250m-1000m CPU, 128Mi-512Mi memory. Prometheus annotations enable automatic scraping on port 9091. Readiness probe checks `/__health`; liveness probe checks `/health`.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-gateway
  namespace: hanzo
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api-gateway
  template:
    spec:
      containers:
      - name: gateway
        image: ghcr.io/hanzoai/gateway:latest
        ports:
        - containerPort: 8080
        - containerPort: 9091
        resources:
          requests: { cpu: "250m", memory: "128Mi" }
          limits: { cpu: "1000m", memory: "512Mi" }
        volumeMounts:
        - name: config
          mountPath: /etc/krakend
      volumes:
      - name: config
        configMap:
          name: gateway-config
```

### Docker (Development)

```yaml
# compose.yml
services:
  gateway:
    image: ghcr.io/hanzoai/gateway:latest
    ports: ["8080:8080", "9091:9091"]
    volumes:
      - ./krakend.json:/etc/krakend/krakend.json
    environment:
      - FC_ENABLE=1
      - FC_SETTINGS=/etc/krakend/settings
      - FC_PARTIALS=/etc/krakend/partials
```

### Bare Metal

```bash
curl -L https://github.com/hanzoai/gateway/releases/latest/download/gateway-linux-amd64 \
  -o /usr/local/bin/hanzo-gateway && chmod +x /usr/local/bin/hanzo-gateway

hanzo-gateway check -c /etc/hanzo/krakend.json   # Validate
hanzo-gateway run -c /etc/hanzo/krakend.json -d   # Run with hot-reload
```

### Flexible Configuration

For large deployments, `krakend.json` can be split into partials:

```
/etc/krakend/
  krakend.tmpl                # Main template (Go text/template)
  settings/
    production.json           # Environment-specific values
    staging.json
  partials/
    auth.tmpl                 # JWT/API key config
    cors.tmpl                 # CORS settings
    ratelimit.tmpl            # Rate limit tiers
    endpoints/
      llm.tmpl                # /v1/chat/* routes
      iam.tmpl                # /v1/auth/* routes
```

CI/CD pipelines run `krakend check -tlc krakend.json` on every PR. Merges are blocked if validation fails.

## Relationship to Other HIPs

| HIP | Relationship |
|-----|-------------|
| **HIP-4** (LLM Gateway) | API Gateway routes `/v1/chat/*` to LLM Gateway. Separate processes. |
| **HIP-26** (IAM) | API Gateway validates JWTs against IAM's JWKS endpoint. |
| **HIP-27** (KMS) | TLS certificates and API key secrets stored in KMS. |
| **HIP-28** (KV Store) | Distributed rate limit counters may use Valkey. |
| **HIP-29** (Database) | Gateway uses no database. Backend services use PostgreSQL. |
| **HIP-31** (Observability) | Gateway exports Prometheus metrics consumed by Zap/Grafana. |
| **HIP-32** (Object Storage) | Gateway routes `/v1/storage/*` to MinIO. |
| **HIP-33** (Registry) | Gateway routes `/v1/registry/*` to container registry. |

## Security Considerations

### Request Validation

- Maximum request body: 10 MB (100 MB for LLM file upload endpoints)
- Maximum URL length: 8,192 bytes
- Maximum header count: 64 / header size: 16 KB
- Query parameter sanitization

### Authentication Security

- JWKS fetched over cluster-internal HTTP (no external dependency for auth)
- JWT clock skew tolerance: 30 seconds
- API keys hashed (SHA-256) before cache storage
- Failed authentication attempts logged with source IP

### Network Security

- Gateway listens on cluster-internal interfaces; external access via load balancer only
- Backend connections use cluster DNS (`iam.hanzo.svc`) -- no external hops
- No management API exposed (configuration is file-based only)

### DDoS Mitigation

- Global rate limit (50,000 req/s) prevents gateway overload
- Per-IP rate limiting at the load balancer layer
- Circuit breakers prevent cascading failures to backends

## Implementation Roadmap

### Phase 1: Core Gateway (Complete)
- KrakenD deployment on hanzo-k8s cluster
- Routing to LLM Gateway, IAM, Console, Cloud
- JWT validation against IAM JWKS
- Basic rate limiting and Prometheus metrics

### Phase 2: Full Service Coverage (Q1 2026)
- Route all 26+ services through gateway
- Per-key rate limiting with distributed counters (Valkey)
- Circuit breakers on all backends
- Response caching and WebSocket proxying

### Phase 3: Advanced Features (Q2 2026)
- Flexible Configuration with environment-specific partials
- Request/response transformation pipelines
- Traffic splitting for A/B testing and canary deployments
- Custom Go middleware plugins

### Phase 4: Edge Deployment (Q3 2026)
- Edge gateway instances in multiple regions
- Edge caching with CDN integration
- Automatic cross-region failover

## References

1. [KrakenD Documentation](https://www.krakend.io/docs/)
2. [KrakenD Configuration Schema](https://www.krakend.io/docs/configuration/structure/)
3. [RFC 6749 - OAuth 2.0 Authorization Framework](https://tools.ietf.org/html/rfc6749)
4. [RFC 7662 - OAuth 2.0 Token Introspection](https://tools.ietf.org/html/rfc7662)
5. [HIP-4: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md)
6. [HIP-26: Identity & Access Management](./hip-0026-identity-access-management-standard.md)
7. [HIP-31: Observability & Metrics](./hip-0031-observability-metrics-standard.md)
8. [API Gateway Repository](https://github.com/hanzoai/gateway)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
