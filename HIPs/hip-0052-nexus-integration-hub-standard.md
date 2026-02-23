---
hip: 0052
title: Nexus Integration Hub Standard
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2026-02-23
---

# HIP-52: Nexus Integration Hub Standard

## Abstract

This proposal defines the Nexus Integration Hub, a lightweight service mesh and API orchestration layer for Hanzo Cloud. Nexus provides service discovery, circuit breaking, protocol translation, traffic management, and health-aware routing for all 33+ internal services in the Hanzo ecosystem.

Nexus is not a general-purpose service mesh. It is a Go binary purpose-built for Hanzo's topology: two DOKS Kubernetes clusters, a mix of gRPC and REST backends, and a traffic pattern dominated by fan-out from the API Gateway (HIP-0044) to multiple downstream services per request. It replaces ad hoc service-to-service communication with a configuration-driven control plane and a transparent data plane proxy.

**Repository**: [github.com/hanzoai/nexus](https://github.com/hanzoai/nexus)
**Control Plane Port**: 8052
**Data Plane Port**: 15001
**Docker**: `ghcr.io/hanzoai/nexus:latest`

## Motivation

### The Problem: 33 Services, No Mesh

Hanzo runs 33+ services across two Kubernetes clusters (`hanzo-k8s` and `lux-k8s`). Today, inter-service communication relies on Kubernetes Service DNS and basic ClusterIP routing. This works -- until it does not.

Consider what happens when the LLM Gateway (port 4000) calls IAM (port 8000) for token validation, then calls Search (port 3000) for context retrieval, then calls Analytics (port 9090) for usage tracking. Each call is a bare HTTP request with no retry logic, no circuit breaker, no timeout propagation, and no distributed trace. When IAM is slow, the LLM Gateway blocks. When Search is down, the Gateway returns a 500 to the user. When Analytics drops a write, the data is lost silently.

These failure modes compound. In a 33-service topology, the blast radius of a single slow service is the entire platform.

### Five Specific Problems

1. **No circuit breaking.** A degraded IAM instance accepting connections but responding in 30+ seconds will cascade latency into every service that validates tokens. Without circuit breaking, the entire platform slows to IAM's pace.

2. **No retry budget.** Services either do not retry (losing data on transient failures) or retry aggressively (amplifying load on an already struggling service). There is no coordinated retry budget across the call graph.

3. **No protocol translation.** Some services speak gRPC (Candle inference, node RPC), others speak REST (IAM, Commerce, Console). Services that need to call across protocol boundaries must embed translation logic, duplicating marshaling code.

4. **No traffic management.** Deploying a new version of any service is all-or-nothing. There is no mechanism for canary deployments, traffic splitting, or header-based routing to test builds.

5. **No service dependency awareness.** Kubernetes readiness probes check whether a *single* container is healthy. They do not check whether a service's *dependencies* are healthy. A service can be "ready" while its database is unreachable.

### Why Not Istio or Linkerd?

This is the obvious question. Both are mature service meshes with large communities. We evaluated both and rejected them for Hanzo's use case.

**Istio** is architecturally complex. It requires Envoy sidecars (50-100 MB memory per pod), a control plane (istiod), and generates substantial configuration via CRDs. For a 33-service deployment on two modest DOKS clusters, Istio's resource overhead would consume 15-20% of available cluster capacity. Its Envoy-based data plane adds 2-5 ms of latency per hop. And its configuration surface area (VirtualService, DestinationRule, Gateway, PeerAuthentication, AuthorizationPolicy, ServiceEntry, Sidecar, EnvoyFilter) is larger than the services it manages.

**Linkerd** is lighter than Istio but still requires a control plane (destination, identity, proxy-injector) and Rust-based micro-proxies. Its resource overhead is lower (~20 MB per sidecar) but still non-trivial at scale. More importantly, Linkerd's mTLS identity system conflicts with our Zero Trust architecture (HIP-0054), which uses SPIFFE-based identity managed by a dedicated certificate authority.

**Nexus** is purpose-built for Hanzo. It runs as a single Go binary per node (DaemonSet, not sidecar), consuming ~15 MB of memory. It understands Hanzo's service topology natively. It delegates mTLS to the Zero Trust layer (HIP-0054) rather than reimplementing it. It integrates directly with Zap (HIP-0031) for traces rather than requiring adapter configuration. And its entire configuration fits in a single YAML file.

### The Nexus Approach

```
                    External Traffic
                          |
                    ┌─────v─────┐
                    │  Gateway   │  HIP-0044 (KrakenD)
                    │  :8080     │
                    └─────┬─────┘
                          |
                    ┌─────v─────┐
                    │  Nexus    │  Control Plane :8052
                    │  Control  │  Service registry, config, health
                    └─────┬─────┘
                          |
            ┌─────────────┼─────────────┐
            |             |             |
      ┌─────v─────┐ ┌────v─────┐ ┌────v─────┐
      │  Nexus    │ │  Nexus   │ │  Nexus   │
      │  Data     │ │  Data    │ │  Data    │
      │  :15001   │ │  :15001  │ │  :15001  │
      └─────┬─────┘ └────┬─────┘ └────┬─────┘
            |             |             |
      ┌─────v─────┐ ┌────v─────┐ ┌────v─────┐
      │  IAM      │ │  LLM GW  │ │  Search  │
      │  :8000    │ │  :4000   │ │  :3000   │
      └───────────┘ └──────────┘ └──────────┘
```

Nexus has two planes:

- **Control plane** (:8052): Maintains the service registry, distributes routing configuration, aggregates health checks, and exposes the management API.
- **Data plane** (:15001): Runs on every node as a DaemonSet. Intercepts outbound service-to-service traffic (via iptables REDIRECT or explicit proxy configuration), applies routing rules, circuit breaking, retries, and protocol translation.

## Design Philosophy

### Principle 1: One Binary, One Config

Nexus is a single statically linked Go binary. The control plane and data plane are compiled into the same binary and selected at startup via `nexus control` or `nexus proxy`. There is no code generation, no CRDs, no operator pattern. Configuration is a single YAML file distributed via ConfigMap.

### Principle 2: DaemonSet, Not Sidecar

Istio and Linkerd inject a proxy sidecar into every pod. This means N sidecars for N pods, each with independent memory, CPU, and connection pools. Nexus runs one proxy per node. All pods on that node route through the same proxy. This reduces memory overhead from O(pods) to O(nodes) and simplifies certificate management.

### Principle 3: Delegate What Others Do Better

Nexus does not implement mTLS (HIP-0054 does that), does not implement external routing (HIP-0044 does that), and does not implement metric collection (HIP-0031 does that). Nexus emits OpenTelemetry spans and Prometheus metrics in the formats those systems expect. It trusts SPIFFE identities injected by the Zero Trust layer. It accepts traffic from the API Gateway without re-authenticating it. Each system does one thing well.

### Principle 4: Fail Open, Not Closed

When the Nexus control plane is unreachable, the data plane continues routing with its last known configuration. When the data plane proxy itself fails, iptables rules are removed and traffic routes directly to services (bypassing mesh features but preserving availability). The mesh is an enhancement, not a gate.

## Specification

### Service Registry

Every Hanzo service registers with the Nexus control plane at startup. Registration is automatic for Kubernetes-native services (Nexus watches the Kubernetes API for Service and Endpoint resources) and explicit for external services.

```yaml
# nexus.yaml - Service registry and routing configuration
registry:
  # Automatic discovery from Kubernetes
  kubernetes:
    enabled: true
    namespaces:
      - hanzo
      - lux
    label_selector: "hanzo.ai/mesh=enabled"

  # Explicit service entries for external dependencies
  external:
    - name: postgres
      endpoints:
        - address: postgres.hanzo.svc
          port: 5432
      protocol: tcp
      health_check:
        type: tcp
        interval: 10s
        timeout: 3s

    - name: redis
      endpoints:
        - address: redis.hanzo.svc
          port: 6379
      protocol: tcp
      health_check:
        type: command
        command: ["redis-cli", "ping"]
        interval: 5s
```

### Service Definition

Each service declares its mesh configuration via annotations or the central config file:

```yaml
services:
  iam:
    address: iam.hanzo.svc
    port: 8000
    protocol: http
    timeout: 5s
    retry:
      attempts: 3
      per_try_timeout: 2s
      retry_on: [503, 502, 504, "connect-failure", "reset"]
    circuit_breaker:
      consecutive_errors: 5
      interval: 30s
      base_ejection_time: 30s
      max_ejection_percent: 50
    health_check:
      path: /api/health
      interval: 10s
      healthy_threshold: 2
      unhealthy_threshold: 3

  llm-gateway:
    address: llm-gateway.hanzo.svc
    port: 4000
    protocol: http
    timeout: 120s  # LLM requests can be slow
    retry:
      attempts: 2
      per_try_timeout: 60s
      retry_on: [503, "connect-failure"]
    circuit_breaker:
      consecutive_errors: 10
      interval: 60s
      base_ejection_time: 15s
      max_ejection_percent: 30

  candle-inference:
    address: candle.hanzo.svc
    port: 50051
    protocol: grpc
    timeout: 30s
    retry:
      attempts: 2
      retry_on: ["unavailable", "resource-exhausted"]
    circuit_breaker:
      consecutive_errors: 3
      interval: 30s
      base_ejection_time: 60s
      max_ejection_percent: 50
```

### Circuit Breaker

Nexus implements the circuit breaker pattern with three states:

```
        ┌──────────┐    errors > threshold    ┌──────────┐
        │  CLOSED  │ ────────────────────────> │   OPEN   │
        │ (normal) │                           │ (reject) │
        └──────────┘                           └────┬─────┘
              ^                                     |
              |              timer expires          |
              |                                     v
              |                              ┌──────────┐
              └───── success ────────────────│HALF-OPEN │
                                             │ (probe)  │
                                             └──────────┘
```

**CLOSED**: Traffic flows normally. Nexus counts consecutive errors per upstream endpoint.

**OPEN**: After `consecutive_errors` failures within `interval`, the endpoint is ejected. All requests to that endpoint receive an immediate 503 without making the upstream call. This prevents cascading latency.

**HALF-OPEN**: After `base_ejection_time`, Nexus allows a single probe request through. If it succeeds, the circuit closes. If it fails, the ejection time doubles (up to a maximum of 300s).

The `max_ejection_percent` parameter prevents the circuit breaker from ejecting all endpoints simultaneously, which would make the service completely unreachable.

### Retry Policy

Retries are budget-aware. Each service defines the maximum number of retries, but Nexus enforces a global retry budget: no more than 20% of total requests to a service can be retries. This prevents retry storms when a service is partially degraded.

```go
type RetryPolicy struct {
    MaxAttempts     int           `yaml:"attempts"`
    PerTryTimeout   time.Duration `yaml:"per_try_timeout"`
    RetryOn         []string      `yaml:"retry_on"`
    RetryBudget     float64       `yaml:"retry_budget"`      // default: 0.20
    BackoffBase     time.Duration `yaml:"backoff_base"`      // default: 25ms
    BackoffMax      time.Duration `yaml:"backoff_max"`       // default: 250ms
}
```

Retries use exponential backoff with jitter: `sleep = min(backoff_base * 2^attempt + jitter, backoff_max)`. The jitter is uniformly distributed over `[0, backoff_base)` to decorrelate retry waves from multiple callers.

### Protocol Translation

Nexus transparently translates between gRPC and REST at the data plane:

```yaml
translation:
  routes:
    # REST callers can reach gRPC services via Nexus
    - from:
        protocol: http
        path: /api/v1/inference/predict
        method: POST
      to:
        service: candle-inference
        protocol: grpc
        method: candle.Inference/Predict
      request_mapping:
        body: proto  # JSON body is marshaled to protobuf
      response_mapping:
        proto: json  # Protobuf response is marshaled to JSON

    # gRPC callers can reach REST services via Nexus
    - from:
        protocol: grpc
        method: hanzo.IAM/ValidateToken
      to:
        service: iam
        protocol: http
        path: /api/validate-token
        method: POST
      request_mapping:
        proto: json
      response_mapping:
        json: proto
```

Translation uses pre-compiled protobuf descriptors. Nexus does not perform runtime reflection or dynamic proto parsing. Services register their `.proto` files with the control plane, which compiles them at configuration load time.

### Request Routing

Nexus supports three routing modes:

#### 1. Direct Routing (Default)

Requests are routed by service name. When service A calls `http://iam:8000/api/health`, the Nexus data plane intercepts the DNS resolution, resolves it to a healthy IAM endpoint, and proxies the request.

#### 2. Header-Based Routing

Used for canary deployments and testing:

```yaml
routing:
  rules:
    - match:
        headers:
          x-hanzo-version: "v2.1-canary"
      route:
        service: llm-gateway
        subset: canary

    - match:
        headers:
          x-hanzo-tenant: "enterprise-acme"
      route:
        service: llm-gateway
        subset: dedicated
```

#### 3. Content-Based Routing

Used for intelligent fan-out based on request body inspection:

```yaml
routing:
  rules:
    - match:
        content:
          json_path: "$.model"
          pattern: "^zen-.*"
      route:
        service: llm-gateway
        subset: zen-cluster

    - match:
        content:
          json_path: "$.model"
          pattern: "^gpt-.*|^claude-.*"
      route:
        service: llm-gateway
        subset: provider-proxy
```

Content-based routing incurs a small overhead (the request body must be buffered and parsed). It is disabled by default and enabled per-route.

### Traffic Splitting

Canary deployments use weighted traffic splitting:

```yaml
traffic:
  splits:
    - service: llm-gateway
      subsets:
        - name: stable
          weight: 95
          labels:
            version: v1.8.0
        - name: canary
          weight: 5
          labels:
            version: v1.9.0-rc1

    - service: search
      subsets:
        - name: stable
          weight: 90
          labels:
            version: v2.3.0
        - name: canary
          weight: 10
          labels:
            version: v2.4.0-beta
```

Weights are enforced per-request using deterministic hashing of the request ID. This ensures that a single user session is consistently routed to the same subset (sticky canary), preventing inconsistent behavior within a session.

### Health Checking and Dependency Management

Nexus extends Kubernetes health checking with dependency-aware health:

```yaml
health:
  # Standard liveness/readiness
  liveness:
    path: /healthz
    interval: 10s
    timeout: 3s

  # Dependency-aware health
  dependencies:
    llm-gateway:
      critical:
        - iam          # Must be healthy for auth
        - redis        # Must be healthy for caching
      degraded:
        - analytics    # Can function without analytics
        - search       # Can function without context search

    console:
      critical:
        - iam
        - postgres
      degraded:
        - commerce
```

A service is **healthy** when all `critical` dependencies are reachable. It is **degraded** when one or more `degraded` dependencies are unreachable (Nexus reports it as healthy to Kubernetes but emits a `nexus_service_degraded` metric). It is **unhealthy** when any `critical` dependency is unreachable.

The control plane builds a dependency graph and detects circular dependencies at configuration load time, rejecting configurations that would create health check cycles.

### Observability Integration

Nexus emits telemetry in three formats, all consumed by Zap (HIP-0031):

#### OpenTelemetry Traces

Every proxied request generates a span:

```
Trace: 4bf92f3577b34da6a3ce929d0e0e4736
├─ Span: gateway-ingress (API Gateway, HIP-0044)
│  ├─ Span: nexus-route (Nexus data plane)
│  │  ├─ Span: iam-validate-token (IAM service)
│  │  ├─ Span: nexus-route (Nexus data plane)
│  │  │  └─ Span: llm-completion (LLM Gateway)
│  │  └─ Span: nexus-route (Nexus data plane)
│  │     └─ Span: analytics-track (Analytics)
```

Nexus propagates W3C Trace Context headers (`traceparent`, `tracestate`) and injects its own span attributes:

```
nexus.service.source = "llm-gateway"
nexus.service.destination = "iam"
nexus.routing.rule = "direct"
nexus.retry.attempt = 0
nexus.circuit_breaker.state = "closed"
```

#### Prometheus Metrics

```
# Request metrics
nexus_requests_total{source, destination, method, status}
nexus_request_duration_seconds{source, destination, quantile}
nexus_request_size_bytes{source, destination}
nexus_response_size_bytes{source, destination}

# Circuit breaker metrics
nexus_circuit_breaker_state{service, endpoint}  # 0=closed, 1=half-open, 2=open
nexus_circuit_breaker_ejections_total{service, endpoint}

# Retry metrics
nexus_retries_total{source, destination, attempt}
nexus_retry_budget_exhausted_total{source, destination}

# Health metrics
nexus_service_healthy{service}
nexus_service_degraded{service, missing_dependency}
nexus_health_check_duration_seconds{service}

# Traffic split metrics
nexus_traffic_split_requests_total{service, subset, version}
```

#### Structured Logs

Nexus logs in JSON format to stdout, consumed by the Zap log pipeline:

```json
{
  "level": "warn",
  "ts": "2026-02-23T10:30:00.000Z",
  "msg": "circuit breaker opened",
  "service": "iam",
  "endpoint": "10.244.0.15:8000",
  "consecutive_errors": 5,
  "ejection_time": "30s",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736"
}
```

### Control Plane API

The control plane exposes a management API on port 8052:

```yaml
endpoints:
  # Service registry
  GET    /api/v1/services                    # List all services
  GET    /api/v1/services/{name}             # Get service detail
  GET    /api/v1/services/{name}/endpoints   # List healthy endpoints
  GET    /api/v1/services/{name}/health      # Get dependency health

  # Routing
  GET    /api/v1/routes                      # List routing rules
  PUT    /api/v1/routes                      # Update routing rules (hot reload)
  GET    /api/v1/routes/graph                # Dependency graph (DOT format)

  # Traffic management
  GET    /api/v1/traffic/splits              # List active splits
  PUT    /api/v1/traffic/splits/{service}    # Update traffic split
  DELETE /api/v1/traffic/splits/{service}    # Remove split (100% stable)

  # Circuit breakers
  GET    /api/v1/circuits                    # List circuit states
  POST   /api/v1/circuits/{service}/reset    # Force close circuit

  # Diagnostics
  GET    /api/v1/topology                    # Full mesh topology
  GET    /api/v1/topology/dot                # Graphviz DOT output
  GET    /metrics                            # Prometheus metrics
  GET    /healthz                            # Control plane health
```

### Integration with API Gateway (HIP-0044)

The API Gateway handles external traffic. Nexus handles internal traffic. They meet at the boundary:

```
External (Internet)                      Internal (Mesh)
        |                                       |
  ┌─────v──────┐    Proxy Pass    ┌─────────────v───────────┐
  │  Gateway   │ ───────────────> │  Nexus Data Plane       │
  │  :8080     │                  │  :15001                  │
  │  (KrakenD) │                  │  circuit break, retry,   │
  │  TLS term, │                  │  translate, split, trace │
  │  auth,     │                  └─────────────┬───────────┘
  │  rate limit│                                |
  └────────────┘                          ┌─────v─────┐
                                          │  Backend  │
                                          └───────────┘
```

The Gateway terminates TLS and validates authentication. Nexus handles service-to-service concerns. Neither duplicates the other's work.

### Integration with Zero Trust (HIP-0054)

Nexus does not implement its own mTLS. Instead, it trusts the SPIFFE identity injected by the Zero Trust layer:

1. The Zero Trust agent provisions a SPIFFE SVID (X.509 certificate) for each workload.
2. Nexus reads the SVID from the SPIFFE Workload API socket.
3. All data plane connections use the SVID for mutual TLS.
4. Nexus extracts the SPIFFE ID (`spiffe://hanzo.ai/service/iam`) and uses it for authorization policy evaluation.

This separation means Nexus never touches private keys and never needs to run a certificate authority.

## Implementation

### Binary Structure

```
nexus/
├── cmd/
│   └── nexus/
│       └── main.go           # CLI: nexus control | nexus proxy
├── internal/
│   ├── control/
│   │   ├── registry.go       # Service registry (K8s watch + static)
│   │   ├── health.go         # Dependency-aware health aggregation
│   │   ├── config.go         # YAML config loader with hot reload
│   │   └── api.go            # Control plane HTTP API
│   ├── proxy/
│   │   ├── listener.go       # Transparent proxy listener (:15001)
│   │   ├── router.go         # Direct / header / content routing
│   │   ├── circuit.go        # Circuit breaker state machine
│   │   ├── retry.go          # Budget-aware retry with backoff
│   │   ├── translate.go      # gRPC <-> REST translation
│   │   └── split.go          # Weighted traffic splitting
│   ├── telemetry/
│   │   ├── traces.go         # OpenTelemetry span emission
│   │   ├── metrics.go        # Prometheus metric registration
│   │   └── logs.go           # Structured JSON logging
│   └── mesh/
│       ├── topology.go       # Dependency graph construction
│       └── spiffe.go         # SPIFFE Workload API integration
├── proto/
│   └── nexus/v1/
│       ├── control.proto     # Control plane gRPC service
│       └── health.proto      # Health reporting proto
├── deploy/
│   ├── daemonset.yaml        # Data plane DaemonSet
│   ├── deployment.yaml       # Control plane Deployment
│   └── configmap.yaml        # Nexus configuration
├── nexus.yaml                # Example configuration
├── go.mod
├── go.sum
├── Makefile
├── Dockerfile
└── README.md
```

### Deployment

#### Kubernetes Manifests

```yaml
# Control plane
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nexus-control
  namespace: hanzo
spec:
  replicas: 2  # HA pair
  selector:
    matchLabels:
      app: nexus-control
  template:
    metadata:
      labels:
        app: nexus-control
    spec:
      serviceAccountName: nexus
      containers:
        - name: nexus
          image: ghcr.io/hanzoai/nexus:latest
          args: ["control"]
          ports:
            - containerPort: 8052
              name: api
          volumeMounts:
            - name: config
              mountPath: /etc/nexus
          env:
            - name: NEXUS_LOG_LEVEL
              value: "info"
            - name: NEXUS_OTEL_ENDPOINT
              value: "zap.hanzo.svc:4317"
      volumes:
        - name: config
          configMap:
            name: nexus-config
---
# Data plane
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: nexus-proxy
  namespace: hanzo
spec:
  selector:
    matchLabels:
      app: nexus-proxy
  template:
    metadata:
      labels:
        app: nexus-proxy
    spec:
      serviceAccountName: nexus
      hostNetwork: true
      containers:
        - name: nexus
          image: ghcr.io/hanzoai/nexus:latest
          args: ["proxy", "--control-plane=nexus-control.hanzo.svc:8052"]
          ports:
            - containerPort: 15001
              name: proxy
          resources:
            requests:
              memory: "15Mi"
              cpu: "50m"
            limits:
              memory: "64Mi"
              cpu: "200m"
          securityContext:
            capabilities:
              add: ["NET_ADMIN"]  # Required for iptables redirect
          volumeMounts:
            - name: spiffe
              mountPath: /run/spiffe
              readOnly: true
      volumes:
        - name: spiffe
          csi:
            driver: spiffe.csi.cert-manager.io
```

### Configuration Hot Reload

The control plane watches its ConfigMap for changes (via Kubernetes informer). When the configuration changes:

1. The new configuration is validated (schema check, cycle detection, endpoint resolution).
2. If valid, it is distributed to all data plane proxies via gRPC streaming.
3. Data plane proxies apply the new configuration atomically (swap the routing table in a single pointer write).
4. The old configuration is retained as fallback for 60 seconds.

If the new configuration is invalid, the control plane rejects it and logs an error. The running configuration is not affected.

### Graceful Degradation

Nexus is designed to fail safely at every level:

| Failure Mode | Behavior |
|---|---|
| Control plane unreachable | Data plane continues with last known config |
| Data plane proxy crash | iptables rules removed; traffic routes directly |
| Config update invalid | Rejected; running config preserved |
| All endpoints ejected | Circuit breaker respects `max_ejection_percent` |
| SPIFFE socket unavailable | Falls back to plaintext (logged as critical) |
| Upstream timeout | Returns 504 with `x-nexus-timeout: true` header |

## Security Considerations

### Network Security

- **No new attack surface**: Nexus does not expose any port externally. The control plane API (8052) and data plane proxy (15001) are cluster-internal only.
- **mTLS delegation**: By delegating mTLS to HIP-0054, Nexus avoids the complexity (and risk) of managing certificates. It never possesses private key material beyond what the SPIFFE Workload API provides for its own identity.
- **Authorization policy**: Nexus can enforce service-to-service authorization based on SPIFFE identities. For example, only `spiffe://hanzo.ai/service/llm-gateway` can call `spiffe://hanzo.ai/service/candle-inference`.

### Data Security

- **No request storage**: Nexus does not persist request or response bodies. Content-based routing reads the body, routes the request, and discards the parsed content immediately.
- **Header sanitization**: Nexus strips internal mesh headers (`x-nexus-*`) from responses before they leave the mesh, preventing internal topology leakage.
- **Trace ID propagation**: Trace IDs are opaque identifiers that do not contain PII. Nexus never logs request bodies in trace spans.

### Operational Security

- **RBAC on control plane API**: The management API (8052) requires a Kubernetes ServiceAccount token with the `nexus-admin` ClusterRole.
- **Audit logging**: All configuration changes (route updates, traffic splits, circuit resets) are logged with the requesting identity and timestamp.
- **Rate limiting the control plane**: The management API enforces a rate limit of 100 requests/second to prevent configuration churn from destabilizing the mesh.

## References

1. [HIP-0031: Observability & Metrics Standard](./hip-0031-observability-metrics-standard.md) -- Telemetry consumption
2. [HIP-0044: API Gateway Standard](./hip-0044-api-gateway-standard.md) -- External traffic ingress
3. HIP-0054: Zero Trust Security Standard -- mTLS and SPIFFE identity
4. [HIP-0004: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md) -- AI-specific proxy
5. [Envoy Proxy Circuit Breaking](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/circuit_breaking)
6. [SPIFFE Specification](https://spiffe.io/docs/latest/spiffe-about/overview/)
7. [W3C Trace Context](https://www.w3.org/TR/trace-context/)
8. [Nexus Repository](https://github.com/hanzoai/nexus)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
