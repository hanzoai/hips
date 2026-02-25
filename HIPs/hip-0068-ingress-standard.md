---
hip: 0068
title: Ingress Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Active
created: 2026-02-24
requires: HIP-0026, HIP-0044
---

# HIP-68: Ingress Standard

## Abstract

This proposal defines the Ingress standard for the Hanzo ecosystem. Hanzo Ingress is the Layer 7 reverse proxy and load balancer that sits at the edge of every Hanzo Kubernetes cluster. It handles host-based routing, TLS termination (via Cloudflare proxy mode), load balancing, health checks, and middleware chains for all inbound traffic.

Hanzo Ingress is a maintained fork of **Traefik v3.6**. It watches Kubernetes Ingress resources and IngressRoute CRDs natively -- no config generation, no external sync loops, no sidecar injection. A new Service or Ingress resource appears in the cluster; Ingress picks it up within seconds and starts routing traffic.

This HIP is explicitly distinct from **HIP-44 (API Gateway)**, which is the application-level gateway handling authentication, rate limiting, and request transformation for `api.hanzo.ai`. Ingress operates one layer below: it routes `api.hanzo.ai` traffic to the API Gateway, `hanzo.ai` traffic to the marketing site, `platform.hanzo.ai` traffic to Dokploy, and so on. The API Gateway is one of many backends behind Ingress.

**Repository**: [github.com/hanzoai/ingress](https://github.com/hanzoai/ingress)
**Entrypoints**: web (8080), websecure (8443)
**Image**: `ghcr.io/hanzoai/ingress:latest`
**Providers**: KubernetesIngress, KubernetesCRD

## Motivation

### The Edge Routing Problem

Hanzo operates two Kubernetes clusters (`hanzo-k8s` and `lux-k8s`) serving 30+ domains across multiple services. Each domain needs:

1. **Host-based routing**: `api.hanzo.ai` goes to the API Gateway, `platform.hanzo.ai` goes to Dokploy, `kms.hanzo.ai` goes to KMS. Each domain is a separate routing decision at the edge.
2. **TLS termination**: Every domain needs HTTPS. Managing 30+ TLS certificates manually is operationally unsustainable.
3. **Health-aware load balancing**: When a backend pod crashes, the edge proxy must stop sending traffic to it immediately, not after a 30-second DNS TTL.
4. **Middleware chains**: Some services need rate limiting at the edge, some need IP whitelisting, some need request buffering for large uploads. These cross-cutting concerns must be configurable per-route, not hardcoded.

### Why Not nginx-ingress?

The NGINX Ingress Controller is the Kubernetes default. It has three problems that make it unsuitable for Hanzo:

1. **Config generation lag**: nginx-ingress watches Kubernetes resources, generates an `nginx.conf` file, validates it, and performs a graceful reload. This takes 5-30 seconds. During that window, new services are unreachable and deleted services still receive traffic.

2. **No native CRDs**: nginx-ingress relies on annotations (`nginx.ingress.kubernetes.io/rewrite-target`, `nginx.ingress.kubernetes.io/ssl-redirect`) for advanced configuration. Annotations are untyped strings with no schema validation. A typo silently does nothing. Traefik's IngressRoute CRDs are typed, validated at apply time, and self-documenting.

3. **No native integration with Hanzo PaaS**: Dokploy (the Hanzo PaaS platform) generates Traefik configuration natively for app deployments. Using nginx-ingress would require a translation layer between Dokploy's Traefik config and nginx annotations. Hanzo Ingress eliminates this translation entirely.

| Factor | nginx-ingress | Hanzo Ingress (Traefik) |
|--------|--------------|------------------------|
| Config update | 5-30s (generate + reload) | < 1s (watch + apply) |
| Advanced routing | Annotations (untyped) | IngressRoute CRDs (typed) |
| PaaS integration | Translation layer needed | Native (Dokploy speaks Traefik) |
| Middleware | Annotation hacks | First-class Middleware CRD |
| TCP/UDP routing | Limited | Full TCP/UDP routing support |
| Dashboard | None (third-party) | Built-in (disabled by default) |

The tradeoff: NGINX has marginally higher raw throughput for static content. For a dynamic Kubernetes environment where routing changes frequently and services come and go, Traefik's native Kubernetes integration is decisive.

### Why a Fork?

Upstream Traefik is open-source and well-maintained. The fork exists for three reasons:

1. **Hanzo branding**: The container image, CRD names in documentation, and dashboard reference Hanzo, not Traefik Labs.
2. **Default configuration**: The fork ships with Hanzo-specific defaults (Cloudflare TLS, internal dashboard disabled, Prometheus metrics enabled, access log format matching Hanzo's log aggregation schema).
3. **PaaS patches**: Minor patches for tighter integration with Dokploy's deployment lifecycle hooks.

The fork tracks upstream Traefik releases. Merge conflicts are rare because changes are limited to defaults and branding.

## Specification

### Architecture

```
                       Internet
                          |
               +----------+----------+
               |  DigitalOcean LB    |
               |  (TCP passthrough)  |
               +----------+----------+
                          |
               +----------+----------+
               |   Hanzo Ingress     |
               |   (Traefik v3.6)    |
               |  :8080 / :8443     |
               +----------+----------+
                          |
     +--------------------+--------------------+
     |          |         |         |          |
+----+----+ +--+---+ +---+--+ +----+----+ +---+---+
|   API   | | PaaS | | IAM  | |  KMS    | | Chat  |
| Gateway | |(Dokp)| |      | |         | |       |
|  :8080  | |:3000 | |:8000 | | :8080   | |:3081  |
+---------+ +------+ +------+ +---------+ +-------+
```

Ingress is the first process to handle an inbound connection after the cloud load balancer. It terminates TLS (or relies on Cloudflare to do so), inspects the `Host` header, matches the request against its routing table, applies any configured middleware, and forwards the request to the correct backend service.

### Entrypoints

| Name | Port | Protocol | Purpose |
|------|------|----------|---------|
| `web` | 8080 | HTTP | Plaintext HTTP; redirects to `websecure` in production |
| `websecure` | 8443 | HTTPS | TLS-terminated HTTPS traffic |
| `traefik` | 9090 | HTTP | Dashboard and API (disabled by default) |
| `metrics` | 9100 | HTTP | Prometheus metrics endpoint |

In production with Cloudflare proxy mode, the DigitalOcean LoadBalancer forwards TCP traffic on ports 80/443 to Ingress ports 8080/8443. Cloudflare terminates the external TLS connection and re-encrypts to the origin using Cloudflare's edge certificates.

### Providers

Hanzo Ingress watches two Kubernetes providers simultaneously:

**1. KubernetesIngress Provider**

Watches standard `networking.k8s.io/v1` Ingress resources. Any service that creates an Ingress resource with `ingressClassName: hanzo-ingress` is automatically routed.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-gateway
  namespace: hanzo
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: websecure
spec:
  ingressClassName: hanzo-ingress
  rules:
  - host: api.hanzo.ai
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: api-gateway
            port:
              number: 8080
```

**2. KubernetesCRD Provider**

Watches Traefik-specific CRDs for advanced routing. IngressRoute resources support weighted routing, header-based matching, middleware chains, and TCP/UDP routing that standard Ingress resources cannot express.

```yaml
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: platform-route
  namespace: hanzo
spec:
  entryPoints:
  - websecure
  routes:
  - match: Host(`platform.hanzo.ai`)
    kind: Rule
    services:
    - name: dokploy
      port: 3000
    middlewares:
    - name: rate-limit
    - name: security-headers
```

### Host Routing Table (Production)

| Host | Backend Service | Port | Cluster |
|------|----------------|------|---------|
| `api.hanzo.ai` | API Gateway (HIP-44) | 8080 | hanzo-k8s |
| `llm.hanzo.ai` | LLM Gateway (HIP-4) | 4000 | hanzo-k8s |
| `hanzo.id` | IAM (Casdoor) | 8000 | hanzo-k8s |
| `lux.id` | IAM (Casdoor) | 8000 | hanzo-k8s |
| `zoo.id` | IAM (Casdoor) | 8000 | hanzo-k8s |
| `pars.id` | IAM (Casdoor) | 8000 | hanzo-k8s |
| `kms.hanzo.ai` | KMS (Infisical) | 8080 | hanzo-k8s |
| `platform.hanzo.ai` | Platform (Dokploy) | 3000 | hanzo-k8s |
| `console.hanzo.ai` | Console | 3001 | hanzo-k8s |
| `cloud.hanzo.ai` | Cloud | 3002 | hanzo-k8s |
| `hanzo.app` | Main App | 3000 | hanzo-k8s |
| `api.lux.network` | Lux Gateway (KrakenD) | 8080 | lux-k8s |
| `cloud.lux.network` | Lux Cloud | 3000 | lux-k8s |
| `markets.lux.network` | Markets | 3000 | lux-k8s |

### TLS Configuration

**Primary mode: Cloudflare Proxy (Flexible SSL)**

All Hanzo domains use Cloudflare as DNS proxy. Cloudflare terminates TLS at the edge and forwards traffic to the origin. In this mode, Ingress receives plaintext HTTP from Cloudflare on port 8080. No certificate management is required on the origin.

```
Client --[TLS]--> Cloudflare --[HTTP]--> DO LB --[HTTP]--> Ingress :8080
```

**Secondary mode: Full (Strict) SSL with CertManager**

For domains where end-to-end encryption is required (e.g., `kms.hanzo.ai` handling secrets), CertManager provisions Let's Encrypt certificates and stores them as Kubernetes Secrets. Ingress reads these secrets and terminates TLS at port 8443.

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: kms-tls
  namespace: hanzo
spec:
  secretName: kms-tls-secret
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
  dnsNames:
  - kms.hanzo.ai
```

```yaml
apiVersion: traefik.io/v1alpha1
kind: TLSOption
metadata:
  name: default
  namespace: hanzo
spec:
  minVersion: VersionTLS12
  preferServerCipherSuites: true
  cipherSuites:
  - TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384
  - TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256
  - TLS_AES_256_GCM_SHA384
  - TLS_AES_128_GCM_SHA256
  - TLS_CHACHA20_POLY1305_SHA256
```

### Middleware

Middleware CRDs are applied per-route via IngressRoute references. Each middleware is a standalone Kubernetes resource that can be shared across routes.

**Rate Limiting**

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: rate-limit
  namespace: hanzo
spec:
  rateLimit:
    average: 100
    burst: 200
    period: 1m
    sourceCriterion:
      ipStrategy:
        depth: 1
```

**Security Headers**

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: security-headers
  namespace: hanzo
spec:
  headers:
    frameDeny: true
    sslRedirect: true
    browserXssFilter: true
    contentTypeNosniff: true
    stsIncludeSubdomains: true
    stsPreload: true
    stsSeconds: 31536000
    customResponseHeaders:
      X-Powered-By: ""
      Server: ""
```

**Retry**

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: retry
  namespace: hanzo
spec:
  retry:
    attempts: 3
    initialInterval: 100ms
```

**Circuit Breaker**

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: circuit-breaker
  namespace: hanzo
spec:
  circuitBreaker:
    expression: "LatencyAtQuantileMS(50.0) > 1000 || NetworkErrorRatio() > 0.30"
```

**IP Whitelist (Admin Services)**

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: admin-whitelist
  namespace: hanzo
spec:
  ipAllowList:
    sourceRange:
    - "10.0.0.0/8"
    - "172.16.0.0/12"
```

### Health Checks

Ingress performs active health checks on backend services:

```yaml
apiVersion: traefik.io/v1alpha1
kind: ServersTransport
metadata:
  name: default
  namespace: hanzo
spec:
  serverName: ""
  insecureSkipVerify: false
  maxIdleConnsPerHost: 200
  forwardingTimeouts:
    dialTimeout: 5s
    responseHeaderTimeout: 30s
    idleConnTimeout: 90s
```

Kubernetes readiness probes are the primary health signal. When a pod's readiness probe fails, Kubernetes removes it from the Endpoints object. Ingress watches Endpoints and stops routing to that pod within one watch cycle (typically < 1 second). No additional health check configuration is needed for most services.

### Load Balancing

Default algorithm is weighted round-robin. Sticky sessions are available via cookie-based affinity for stateful services:

```yaml
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: stateful-service
  namespace: hanzo
spec:
  routes:
  - match: Host(`app.hanzo.ai`)
    services:
    - name: stateful-backend
      port: 8080
      sticky:
        cookie:
          name: hanzo_affinity
          secure: true
          httpOnly: true
```

### Observability

**Access Logs**

Structured JSON on stdout, one line per request:

```json
{
  "time": "2026-02-24T12:00:00Z",
  "level": "info",
  "msg": "",
  "ClientAddr": "10.244.0.1:54321",
  "ClientHost": "10.244.0.1",
  "Duration": 12345678,
  "DownstreamStatus": 200,
  "RequestHost": "api.hanzo.ai",
  "RequestMethod": "POST",
  "RequestPath": "/v1/chat/completions",
  "RequestProtocol": "HTTP/1.1",
  "RouterName": "api-gateway@kubernetes",
  "ServiceName": "api-gateway-hanzo@kubernetes",
  "entryPointName": "websecure"
}
```

**Prometheus Metrics**

Exported on port 9100 with namespace `hanzo_ingress`:

| Metric | Type | Description |
|--------|------|-------------|
| `hanzo_ingress_entrypoint_requests_total` | Counter | Total requests by entrypoint, method, protocol, code |
| `hanzo_ingress_entrypoint_request_duration_seconds` | Histogram | Request duration by entrypoint |
| `hanzo_ingress_entrypoint_open_connections` | Gauge | Open connections by entrypoint, method, protocol |
| `hanzo_ingress_service_requests_total` | Counter | Total requests by service, method, protocol, code |
| `hanzo_ingress_service_request_duration_seconds` | Histogram | Request duration by service |
| `hanzo_ingress_service_open_connections` | Gauge | Open connections by service |
| `hanzo_ingress_service_retries_total` | Counter | Retry count by service |
| `hanzo_ingress_service_server_up` | Gauge | Backend server health (1=up, 0=down) |
| `hanzo_ingress_tls_certs_not_after` | Gauge | TLS certificate expiry timestamp |
| `hanzo_ingress_config_reloads_total` | Counter | Configuration reload count |
| `hanzo_ingress_config_last_reload_success` | Gauge | Last reload success (1/0) |

**Tracing**

OpenTelemetry traces are emitted for every request, propagating `traceparent` and `tracestate` headers to backend services. Traces are exported to the cluster's OTLP collector for correlation with backend spans.

### RBAC

Ingress requires the following Kubernetes RBAC permissions:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: hanzo-ingress
rules:
- apiGroups: [""]
  resources: ["services", "endpoints", "secrets"]
  verbs: ["get", "list", "watch"]
- apiGroups: ["networking.k8s.io"]
  resources: ["ingresses", "ingressclasses"]
  verbs: ["get", "list", "watch"]
- apiGroups: ["networking.k8s.io"]
  resources: ["ingresses/status"]
  verbs: ["update"]
- apiGroups: ["traefik.io"]
  resources: ["ingressroutes", "ingressroutetcps", "ingressrouteudps",
              "middlewares", "middlewaretcps", "tlsoptions", "tlsstores",
              "traefikservices", "serverstransports", "serverstransporttcps"]
  verbs: ["get", "list", "watch"]
- apiGroups: ["extensions", "networking.k8s.io"]
  resources: ["ingresses", "ingressclasses"]
  verbs: ["get", "list", "watch"]
```

The ClusterRole is bound to a dedicated ServiceAccount (`hanzo-ingress`) via ClusterRoleBinding.

## Deployment

### Kubernetes (Production)

Two replicas with rolling updates (`maxSurge: 1`, `maxUnavailable: 0`). Resource limits: 200m-1000m CPU, 128Mi-512Mi memory. Pod anti-affinity ensures replicas run on different nodes for availability.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hanzo-ingress
  namespace: hanzo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: hanzo-ingress
  strategy:
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: hanzo-ingress
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9100"
    spec:
      serviceAccountName: hanzo-ingress
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchExpressions:
                - key: app
                  operator: In
                  values: ["hanzo-ingress"]
              topologyKey: kubernetes.io/hostname
      containers:
      - name: ingress
        image: ghcr.io/hanzoai/ingress:latest
        args:
        - --entrypoints.web.address=:8080
        - --entrypoints.websecure.address=:8443
        - --entrypoints.metrics.address=:9100
        - --providers.kubernetesingress=true
        - --providers.kubernetesingress.ingressclass=hanzo-ingress
        - --providers.kubernetescrd=true
        - --metrics.prometheus=true
        - --metrics.prometheus.entrypoint=metrics
        - --accesslog=true
        - --accesslog.format=json
        - --ping=true
        - --api.dashboard=false
        - --api.insecure=false
        ports:
        - name: web
          containerPort: 8080
        - name: websecure
          containerPort: 8443
        - name: metrics
          containerPort: 9100
        resources:
          requests: { cpu: "200m", memory: "128Mi" }
          limits: { cpu: "1000m", memory: "512Mi" }
        readinessProbe:
          httpGet:
            path: /ping
            port: 9100
          initialDelaySeconds: 5
          periodSeconds: 10
        livenessProbe:
          httpGet:
            path: /ping
            port: 9100
          initialDelaySeconds: 10
          periodSeconds: 15
---
apiVersion: v1
kind: Service
metadata:
  name: hanzo-ingress
  namespace: hanzo
  annotations:
    service.beta.kubernetes.io/do-loadbalancer-protocol: "tcp"
    service.beta.kubernetes.io/do-loadbalancer-size-slug: "lb-small"
    service.beta.kubernetes.io/do-loadbalancer-enable-proxy-protocol: "true"
spec:
  type: LoadBalancer
  selector:
    app: hanzo-ingress
  ports:
  - name: web
    port: 80
    targetPort: 8080
  - name: websecure
    port: 443
    targetPort: 8443
---
apiVersion: networking.k8s.io/v1
kind: IngressClass
metadata:
  name: hanzo-ingress
  annotations:
    ingressclass.kubernetes.io/is-default-class: "true"
spec:
  controller: traefik.io/ingress-controller
```

### Docker (Development)

```yaml
# compose.yml
services:
  ingress:
    image: ghcr.io/hanzoai/ingress:latest
    command:
    - --entrypoints.web.address=:8080
    - --entrypoints.websecure.address=:8443
    - --providers.docker=true
    - --providers.docker.exposedbydefault=false
    - --api.dashboard=true
    - --api.insecure=true
    - --accesslog=true
    - --accesslog.format=json
    ports:
    - "80:8080"
    - "443:8443"
    - "9090:8080"
    volumes:
    - /var/run/docker.sock:/var/run/docker.sock:ro
```

In development mode, the Docker provider watches container labels for routing configuration. The dashboard is enabled for debugging.

### IngressClass

Hanzo Ingress registers itself as the default IngressClass (`hanzo-ingress`). Any Ingress resource without an explicit `ingressClassName` is handled by Hanzo Ingress. Services that need a different ingress controller (e.g., for testing) can specify an alternate IngressClass.

## Relationship to Other HIPs

| HIP | Relationship |
|-----|-------------|
| **HIP-4** (LLM Gateway) | Ingress routes `llm.hanzo.ai` traffic to LLM Gateway. Separate processes at different layers. |
| **HIP-14** (Application Deployment) | Dokploy generates IngressRoute resources that Ingress watches and routes. |
| **HIP-26** (IAM) | Ingress routes `hanzo.id`, `lux.id`, `zoo.id`, `pars.id` to IAM. No auth at the ingress layer; auth is handled by the API Gateway or services themselves. |
| **HIP-27** (KMS) | Ingress routes `kms.hanzo.ai` to KMS. TLS certificates for strict SSL mode are stored as K8s Secrets provisioned by CertManager. |
| **HIP-31** (Observability) | Ingress exports Prometheus metrics consumed by Grafana dashboards. Access logs feed into the log aggregation pipeline. |
| **HIP-37** (AI Cloud Platform) | Ingress routes `cloud.hanzo.ai` and `cloud.lux.network` to their respective cloud services. |
| **HIP-44** (API Gateway) | The API Gateway (KrakenD) is a backend behind Ingress. Ingress handles L7 host routing; the API Gateway handles application-level concerns (auth, rate limiting, circuit breaking). |
| **HIP-49** (DNS) | DNS records point domains to the DigitalOcean LoadBalancer IP. Cloudflare proxies these records for DDoS protection and edge TLS. |

### Layer Separation

```
Internet
  --> Cloudflare (DDoS protection, edge TLS, CDN caching)
    --> DigitalOcean LoadBalancer (TCP passthrough, health checks)
      --> Hanzo Ingress [HIP-68] (host routing, middleware, backend selection)
        --> API Gateway [HIP-44] (auth, rate limiting, request transformation)
          --> Backend Services (LLM Gateway, IAM, KMS, ...)
```

Each layer has a single responsibility. Ingress does not authenticate requests. The API Gateway does not route by hostname. Cloudflare does not know about backend services. This separation means each layer can be replaced, scaled, or debugged independently.

## Security Considerations

### Network Security

- Ingress listens on cluster-internal interfaces. External access is via DigitalOcean LoadBalancer only.
- Backend connections use cluster DNS (e.g., `api-gateway.hanzo.svc`). No traffic leaves the cluster for internal routing.
- The Traefik dashboard and API are disabled by default in production. When enabled for debugging, they are accessible only via `kubectl port-forward`.

### TLS Security

- Minimum TLS 1.2 for direct TLS termination. TLS 1.3 preferred.
- HSTS headers with `includeSubdomains` and `preload` on all HTTPS responses.
- Cloudflare provides edge TLS with automatic certificate rotation. Origin certificates are managed by CertManager where strict SSL is required.

### Request Validation

- Maximum request header size: 16 KB
- Maximum request body: configurable per-route (default 10 MB, 100 MB for upload routes)
- Proxy protocol enabled to preserve client IP through the load balancer chain

### RBAC Security

- Ingress runs as a non-root user with a read-only root filesystem.
- The ServiceAccount has minimal permissions: read-only access to Ingress, Service, Endpoint, and Secret resources. Write access only to Ingress status (for IP address annotation).
- No access to ConfigMaps, Deployments, Pods, or other sensitive resources.

### DDoS Mitigation

- Cloudflare absorbs volumetric DDoS at the edge before traffic reaches the origin.
- DigitalOcean LoadBalancer provides basic SYN flood protection.
- Ingress rate limiting middleware provides per-IP throttling as a last line of defense.

## Implementation Roadmap

### Phase 1: Core Deployment (Complete)

- Traefik v3.6 fork with Hanzo defaults
- Deployment on hanzo-k8s with DigitalOcean LoadBalancer
- KubernetesIngress and KubernetesCRD providers
- Host routing for all production domains
- Cloudflare Flexible SSL for TLS termination
- Prometheus metrics on port 9100
- JSON access logs on stdout

### Phase 2: Advanced Middleware (Q1 2026)

- Rate limiting middleware on high-traffic routes
- Security headers middleware (HSTS, X-Frame-Options, CSP)
- Circuit breaker middleware for degraded backend protection
- Retry middleware with exponential backoff
- IP whitelist middleware for admin services

### Phase 3: Multi-Cluster (Q2 2026)

- Deploy Ingress on lux-k8s cluster
- Cross-cluster service discovery via ExternalName services
- Global server load balancing (GSLB) via Cloudflare DNS
- Canary deployments with weighted IngressRoute services

### Phase 4: Edge Expansion (Q3 2026)

- Edge Ingress instances in multiple DigitalOcean regions
- CertManager integration for strict SSL on all domains
- OpenTelemetry tracing pipeline integration
- Custom Traefik plugins for Hanzo-specific middleware

## References

1. [Traefik Documentation](https://doc.traefik.io/traefik/)
2. [Traefik Kubernetes IngressRoute](https://doc.traefik.io/traefik/routing/providers/kubernetes-crd/)
3. [Traefik Middleware Reference](https://doc.traefik.io/traefik/middlewares/overview/)
4. [Kubernetes Ingress Specification](https://kubernetes.io/docs/concepts/services-networking/ingress/)
5. [Cloudflare SSL/TLS Modes](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/)
6. [DigitalOcean Load Balancer](https://docs.digitalocean.com/products/networking/load-balancers/)
7. [HIP-44: API Gateway Standard](./hip-0044-api-gateway-standard.md)
8. [HIP-26: Identity & Access Management](./hip-0026-identity-access-management-standard.md)
9. [HIP-31: Observability & Metrics](./hip-0031-observability-metrics-standard.md)
10. [Ingress Repository](https://github.com/hanzoai/ingress)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
