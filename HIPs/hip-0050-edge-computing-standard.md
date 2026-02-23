---
hip: 0050
title: Edge Computing Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-02-23
---

# HIP-50: Edge Computing Standard

## Abstract

This proposal defines the Edge Computing standard for the Hanzo ecosystem. The Edge layer deploys lightweight AI inference, response caching, and request routing to globally distributed Points of Presence (PoPs), reducing round-trip latency for AI workloads from hundreds of milliseconds to single-digit milliseconds.

The runtime is built on **workerd**, Cloudflare's open-source JavaScript/Wasm runtime, which uses V8 isolates for multi-tenant execution. It exposes a Cloudflare Workers-compatible API surface, meaning any existing Workers script runs unmodified on Hanzo Edge. The control plane manages isolate scheduling, model deployment, KV replication, and health across all PoPs.

Edge workers handle four classes of work: (1) request routing and authentication at the edge, (2) semantic caching of AI responses, (3) inference of small models (embeddings, classification, tokenization), and (4) WebSocket termination for real-time AI streaming. Everything else is proxied to origin services via the API Gateway (HIP-0044).

**Repository**: [github.com/hanzoai/edge](https://github.com/hanzoai/edge)
**Port**: 8050 (control plane), 8051 (worker runtime)
**Docker**: `ghcr.io/hanzoai/edge:latest`
**Binary**: `hanzo-edge`

## Motivation

### The Latency Problem for AI Agents

AI agents operate in tight loops: observe, think, act, observe again. Each loop iteration involves at least one LLM call. When agents are deployed in interactive settings -- copilots, customer service, real-time coding assistants -- the total loop latency determines whether the experience feels instantaneous or sluggish.

A user in Tokyo making an inference request to a Hanzo origin in New York experiences ~180ms of network round-trip time before the first token is generated. For a multi-step agent that makes 5 sequential calls per user interaction, that is 900ms of pure network overhead on top of inference time. This overhead is invisible for batch workloads but devastating for interactive AI.

The solution is to move computation closer to the user. Not all computation -- full LLM inference requires GPUs that cannot be economically deployed at every PoP. But a surprising amount of AI-adjacent work can run at the edge:

1. **Authentication and routing**: Validate JWTs, resolve API keys, and route to the nearest origin. Saves one full round-trip for every request.
2. **Semantic caching**: If the same (or semantically similar) query was answered recently, return the cached response. Eliminates inference entirely for cache hits.
3. **Small model inference**: Embeddings, text classification, tokenization, and intent detection run on CPU in <10ms. These do not need GPUs.
4. **WebSocket termination**: Edge-terminated WebSockets reduce connection setup latency and enable server-sent events (SSE) streaming from the nearest PoP.
5. **Request coalescing**: Multiple identical in-flight requests to the same model with the same prompt are collapsed into one origin call.

### The Multi-Region Cost Problem

The naive approach to latency reduction is deploying full origin stacks in multiple regions. For Hanzo, this would mean running IAM, LLM Gateway, KV, PostgreSQL, and 20+ other services in Tokyo, Frankfurt, Sao Paulo, and Sydney. The operational cost is multiplicative: 4 regions means 4x the infrastructure, 4x the monitoring, 4x the database replication complexity, and 4x the attack surface.

Edge computing inverts this economics. A single-binary edge worker consumes ~50MB of memory per isolate. Deploying 200 edge workers across 50 PoPs costs less than deploying one additional full origin stack. The edge handles the latency-sensitive fast path; the origin handles the compute-intensive slow path.

### The Vendor Lock-in Problem

Cloudflare Workers is the dominant edge compute platform, but deploying on Cloudflare means accepting their pricing, their execution limits (10ms CPU time on free tier, 50ms on paid), and their proprietary control plane. For a platform like Hanzo that runs its own infrastructure, this creates an unacceptable dependency.

workerd -- Cloudflare's open-source Workers runtime -- gives us the same V8 isolate execution model without the vendor dependency. We run workerd on our own infrastructure, at our own PoPs, with our own limits. Scripts written for Cloudflare Workers run on Hanzo Edge unmodified. Scripts written for Hanzo Edge run on Cloudflare Workers unmodified. Portability in both directions.

## Design Philosophy

### Why Edge Compute for AI

The traditional edge compute use case is serving static assets and running simple request transformations. AI seems like the opposite -- enormous models, GPU-bound, latency measured in seconds. Why put AI at the edge?

Because "AI" is not a single operation. A modern AI request pipeline looks like this:

```
User Request
  --> Authenticate (5ms at edge, 200ms at origin)
  --> Check semantic cache (2ms at edge, 200ms at origin)
  --> Classify intent (8ms at edge with small model)
  --> Route to correct model/provider (1ms at edge)
  --> Forward to origin for inference (unavoidable)
  --> Stream response via edge WebSocket (saves connection setup)
```

Four of the six steps can run at the edge. The single most expensive step (inference) cannot, but every other step saves a full round-trip. For a request that hits the semantic cache, the entire response is served from the edge in <10ms.

The principle: **move everything except GPU inference to the edge.** This is not about running LLaMA at the edge. It is about running everything around LLaMA at the edge.

### Why V8 Isolates Over Containers

The competing approaches for multi-tenant edge execution are containers (Docker/Firecracker), WebAssembly (Wasm), and V8 isolates. Each has different tradeoffs.

**Containers** provide strong isolation via Linux namespaces and cgroups. Cold start time is 50-500ms for Firecracker microVMs. Memory overhead is 5-30MB per instance. This is acceptable for long-running services but prohibitive for per-request execution at the edge. If each incoming request spawns a container, the cold start alone exceeds our latency budget.

**WebAssembly** provides near-native execution speed and ~1ms cold start. However, the Wasm ecosystem for AI workloads is immature. There is no production-quality Wasm runtime for ONNX model inference. The Wasm-WASI interface for networking, file I/O, and crypto is still stabilizing. Building on Wasm today means building on shifting sand.

**V8 isolates** provide sub-millisecond cold start (~0.5ms), ~2MB memory overhead per isolate, and access to the entire Web API surface (fetch, crypto, streams, WebSocket). The JavaScript ecosystem has mature libraries for tokenization (tiktoken-js), embeddings (transformers.js), and classification. V8's JIT compiler produces near-native performance for numeric workloads after warmup.

| Factor | Containers | Wasm | V8 Isolates |
|--------|-----------|------|-------------|
| Cold start | 50-500ms | ~1ms | ~0.5ms |
| Memory per tenant | 5-30MB | ~1MB | ~2MB |
| AI library ecosystem | Excellent | Immature | Good |
| Isolation model | OS-level | Sandboxed | Sandboxed |
| API surface | Full Linux | WASI (limited) | Web APIs |
| Network I/O | Native | Via WASI | fetch/WebSocket |
| Portability | OCI images | .wasm modules | JS/TS scripts |

V8 isolates win for edge AI because they combine fast startup, low overhead, and a mature ecosystem. The tradeoff is weaker isolation compared to containers -- a V8 sandbox escape is a security incident. We mitigate this with defense-in-depth (see Security Considerations).

### Why Cloudflare-Compatible API Surface

There are three edge compute API standards competing for developer adoption: Cloudflare Workers, Deno Deploy, and Vercel Edge Runtime. All three implement subsets of the Web Worker API with platform-specific extensions.

Cloudflare Workers has the largest ecosystem: 500,000+ deployed workers, extensive documentation, and the broadest third-party library support. By implementing the Workers API surface -- `fetch` event handler, `Request`/`Response` objects, `KV` namespace, `Durable Objects`, `WebSocket` pairs -- we gain immediate access to this ecosystem.

A practical example: `tiktoken-js` (the JavaScript port of OpenAI's tokenizer) runs on Cloudflare Workers. It runs on Hanzo Edge without modification. If we had invented a proprietary API, we would need to port every such library ourselves.

The Workers API is also the thinnest viable abstraction. A worker is a function that takes a `Request` and returns a `Response`. There is no framework, no dependency injection, no lifecycle hooks. This simplicity maps directly to the edge execution model: receive HTTP request, do work, return HTTP response.

### Why Not Just Use Cloudflare Workers Directly

Three reasons: cost, control, and integration.

**Cost**: Cloudflare Workers charges $0.50 per million requests on the paid plan, with a $5/month base fee per account. At 100M edge requests/month (a modest number for a platform serving AI workloads globally), the cost is $50/month for Cloudflare vs. ~$0 marginal cost on our own PoP infrastructure.

**Control**: Cloudflare imposes CPU time limits (10ms free, 50ms paid) that are insufficient for small model inference. An embedding generation that takes 30ms of CPU would fail on the free tier. On our own infrastructure, we set our own limits.

**Integration**: Cloudflare Workers cannot directly access Hanzo's internal services (IAM, KV, LLM Gateway) without going over the public internet. Hanzo Edge runs inside our network, with direct access to origin services via private peering.

## Specification

### Architecture

```
                     Global Anycast DNS
                            |
              +-------------+-------------+
              |             |             |
         +----+----+  +----+----+  +----+----+
         |  PoP    |  |  PoP    |  |  PoP    |
         | Tokyo   |  | London  |  | NYC     |
         |         |  |         |  |         |
         | workerd |  | workerd |  | workerd |
         | :8051   |  | :8051   |  | :8051   |
         +----+----+  +----+----+  +----+----+
              |             |             |
              +-------------+-------------+
                            |
                   +--------+--------+
                   |  Control Plane  |
                   |   :8050         |
                   +--------+--------+
                            |
              +-------------+-------------+
              |             |             |
         +----+----+  +----+----+  +----+----+
         |   API   |  |   LLM   |  |   KV    |
         | Gateway |  | Gateway |  | (Valkey) |
         | HIP-44  |  | HIP-04  |  | HIP-28  |
         +---------+  +---------+  +---------+
```

The architecture has three layers:

1. **PoP Layer**: workerd instances at each Point of Presence, running edge workers. Each PoP is stateless; all persistent state lives in the edge KV store or origin services.
2. **Control Plane**: Centralized management of worker deployments, model registry, KV replication, and PoP health. Runs alongside origin services.
3. **Origin Layer**: Full Hanzo service stack (API Gateway, LLM Gateway, IAM, KV, PostgreSQL).

### Worker API

Edge workers implement the standard Workers API:

```javascript
export default {
  async fetch(request, env, ctx) {
    // env.AI      - Edge AI inference bindings
    // env.KV      - Edge KV store (HIP-0028 compatible)
    // env.CACHE   - Semantic cache API
    // env.ORIGIN  - Origin fetch with automatic routing

    const url = new URL(request.url)

    if (url.pathname.startsWith('/v1/embeddings')) {
      return env.AI.run('bge-small-en-v1.5', {
        input: await request.json()
      })
    }

    // Proxy to origin via API Gateway
    return env.ORIGIN.fetch(request)
  }
}
```

#### Environment Bindings

| Binding | Type | Description |
|---------|------|-------------|
| `env.AI` | `EdgeAI` | Small model inference (embeddings, classification) |
| `env.KV` | `KVNamespace` | Edge-replicated key-value store |
| `env.CACHE` | `SemanticCache` | AI response semantic cache |
| `env.ORIGIN` | `OriginFetcher` | Authenticated fetch to origin services |
| `env.AUTH` | `EdgeAuth` | JWT validation and API key resolution |
| `env.METRICS` | `MetricsReporter` | Prometheus-compatible metrics |

### Edge AI Model Registry

Not all models can run at the edge. The Edge AI Model Registry maintains the subset of models that are small enough for CPU inference at PoPs.

#### Registry Schema

```json
{
  "models": [
    {
      "id": "bge-small-en-v1.5",
      "task": "embedding",
      "format": "onnx",
      "size_mb": 130,
      "max_tokens": 512,
      "dimensions": 384,
      "languages": ["en"],
      "p99_latency_ms": 8,
      "deployed_pops": ["*"]
    },
    {
      "id": "distilbert-intent",
      "task": "classification",
      "format": "onnx",
      "size_mb": 260,
      "max_tokens": 512,
      "classes": ["question", "command", "statement", "search"],
      "p99_latency_ms": 12,
      "deployed_pops": ["*"]
    },
    {
      "id": "tiktoken-cl100k",
      "task": "tokenization",
      "format": "native",
      "size_mb": 5,
      "deployed_pops": ["*"]
    }
  ]
}
```

#### Model Deployment Rules

- **Maximum model size**: 500MB per model. Larger models belong on GPU-equipped origin servers (HIP-0043).
- **Inference runtime**: ONNX Runtime compiled to Wasm, executed within the V8 isolate. No native extensions.
- **Model distribution**: Models are pulled from Hanzo Object Storage (HIP-0032) on PoP startup and cached locally. Updates propagate via control plane push.
- **Warm pool**: Each PoP maintains loaded instances of all registered models. Cold inference is not acceptable; the first request to any model must be as fast as the thousandth.

### Edge KV Store

Each PoP maintains a local read replica of designated KV namespaces from the origin Valkey instance (HIP-0028). Writes go to origin and propagate to edge replicas asynchronously.

#### Consistency Model

Edge KV provides **eventual consistency** with a configurable staleness bound:

```javascript
// Read from edge KV with 60-second staleness tolerance
const value = await env.KV.get('user:session:abc123', {
  cacheTtl: 60   // Accept values up to 60s stale
})

// Write-through to origin (synchronous)
await env.KV.put('rate:user:abc123', count, {
  writeThrough: true,
  expiration: 3600
})
```

| Operation | Latency | Consistency |
|-----------|---------|-------------|
| `get` (cache hit) | <1ms | Eventual (bounded staleness) |
| `get` (cache miss) | 50-200ms | Strong (fetched from origin) |
| `put` (write-through) | 50-200ms | Strong (written to origin) |
| `put` (fire-and-forget) | <1ms | Eventual |
| `delete` | 50-200ms | Strong (propagated to origin) |
| `list` | 50-200ms | Eventual |

#### Replication Protocol

The control plane maintains a change stream from origin KV. Each PoP subscribes to the namespaces it needs. Changes are batched and shipped every 500ms (configurable). PoPs acknowledge receipt; the control plane retries unacknowledged batches.

Key namespaces replicated to edge by default:

| Namespace | Use Case | TTL |
|-----------|----------|-----|
| `iam:jwks:*` | JWT validation keys | 3600s |
| `iam:apikey:*` | API key -> org mapping | 300s |
| `llm:rate:*` | Rate limit counters | 60s |
| `edge:config:*` | Worker configuration | 0 (persistent) |
| `edge:model:*` | Model registry metadata | 300s |

### Semantic Cache

The semantic cache stores AI responses keyed by a hash of the prompt and model parameters. It operates at two levels: exact match and semantic similarity.

#### Exact Match Cache

```
key = SHA-256(model || temperature || max_tokens || system_prompt || user_prompt)
```

Exact cache hits return in <1ms. This catches identical requests from different users or repeated requests from the same user.

#### Semantic Similarity Cache

For requests that do not match exactly, the edge computes an embedding of the user prompt using the local `bge-small-en-v1.5` model and searches a local vector index for similar cached prompts. If a cached prompt has cosine similarity > 0.95, the cached response is returned.

```
User prompt: "What is the capital of France?"
Cached prompt: "What's France's capital city?"
Similarity: 0.97 --> Cache hit
```

This is configurable per endpoint. Semantic caching is appropriate for factual queries and retrieval-augmented generation but not for creative tasks where identical prompts should produce different outputs.

```javascript
// Worker configuration for semantic cache
const cacheConfig = {
  exact: { enabled: true, ttl: 3600 },
  semantic: {
    enabled: true,
    ttl: 1800,
    threshold: 0.95,
    model: 'bge-small-en-v1.5',
    exclude_paths: ['/v1/images/*', '/v1/audio/*']
  }
}
```

#### Cache Metrics

```
hanzo_edge_cache_hits_total{type="exact|semantic", pop}
hanzo_edge_cache_misses_total{pop}
hanzo_edge_cache_latency_seconds{type="exact|semantic", pop}
hanzo_edge_cache_size_bytes{pop}
hanzo_edge_cache_evictions_total{pop}
```

### WebSocket and SSE Streaming

Edge PoPs terminate WebSocket connections and Server-Sent Events (SSE) streams, proxying to origin via persistent connections.

#### Streaming Architecture

```
Client <--WebSocket--> Edge PoP <--HTTP/2 stream--> Origin (LLM Gateway)
```

The edge PoP establishes a pool of persistent HTTP/2 connections to origin. When a client opens a WebSocket for streaming completions, the edge:

1. Authenticates the connection (JWT or API key via `env.AUTH`)
2. Opens a streaming request to origin via the connection pool
3. Forwards tokens from origin to client as they arrive
4. Buffers tokens for potential semantic cache storage
5. Closes the origin stream when the client disconnects (prevents wasted inference)

Client disconnection detection is critical. Without edge termination, a user who closes their browser tab continues consuming GPU time at origin until the full response is generated. Edge-terminated connections detect the disconnect immediately and cancel the origin request.

### Request Routing

Edge workers perform intelligent routing before forwarding to origin:

```javascript
async function routeRequest(request, env) {
  const auth = await env.AUTH.validate(request)
  if (!auth.valid) return new Response('Unauthorized', { status: 401 })

  // Check semantic cache first
  const cached = await env.CACHE.match(request)
  if (cached) return cached

  // Classify intent for routing
  const intent = await env.AI.run('distilbert-intent', {
    input: await request.clone().text()
  })

  // Route to nearest healthy origin
  const origin = env.ORIGIN.nearest({
    service: intentToService(intent.label),
    headers: {
      'X-User-ID': auth.userId,
      'X-Org-ID': auth.orgId,
      'X-Edge-Pop': env.POP_ID,
      'X-Edge-Latency': Date.now() - request.startTime
    }
  })

  return origin.fetch(request)
}
```

### Control Plane API

The control plane runs on port 8050 and manages all PoPs.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/edge/pops` | GET | List all PoPs with health status |
| `/v1/edge/pops/{id}` | GET | PoP detail (workers, models, KV lag) |
| `/v1/edge/workers` | GET | List deployed workers |
| `/v1/edge/workers` | POST | Deploy a new worker to all PoPs |
| `/v1/edge/workers/{id}` | PUT | Update worker code (rolling deploy) |
| `/v1/edge/workers/{id}` | DELETE | Remove worker from all PoPs |
| `/v1/edge/models` | GET | List edge model registry |
| `/v1/edge/models` | POST | Register a model for edge deployment |
| `/v1/edge/cache/purge` | POST | Purge semantic cache (global or per-PoP) |
| `/v1/edge/metrics` | GET | Aggregated metrics across all PoPs |
| `/health` | GET | Control plane health |

### PoP Health and Failover

Each PoP reports health to the control plane every 10 seconds:

```json
{
  "pop_id": "nrt-1",
  "region": "ap-northeast-1",
  "status": "healthy",
  "workers_active": 12,
  "models_loaded": 3,
  "kv_lag_ms": 450,
  "requests_per_second": 1200,
  "cpu_utilization": 0.45,
  "memory_utilization": 0.62,
  "uptime_seconds": 864000
}
```

If a PoP fails to report for 30 seconds, the control plane removes it from DNS rotation. Anycast routing automatically directs traffic to the next-nearest PoP. When the PoP recovers and reports healthy for three consecutive intervals, it is re-added.

### Prometheus Metrics

Metrics exported on port 9052 with namespace `hanzo_edge`:

| Metric | Type | Description |
|--------|------|-------------|
| `hanzo_edge_requests_total` | Counter | Requests by PoP, worker, status |
| `hanzo_edge_request_duration_seconds` | Histogram | End-to-end latency at edge |
| `hanzo_edge_inference_duration_seconds` | Histogram | Edge AI model inference time |
| `hanzo_edge_cache_hit_rate` | Gauge | Semantic cache hit ratio per PoP |
| `hanzo_edge_kv_replication_lag_seconds` | Gauge | KV staleness per PoP |
| `hanzo_edge_websocket_connections` | Gauge | Active WebSocket connections |
| `hanzo_edge_origin_latency_seconds` | Histogram | Edge-to-origin round-trip |
| `hanzo_edge_isolate_count` | Gauge | Active V8 isolates per PoP |
| `hanzo_edge_model_load_duration_seconds` | Histogram | Model loading time |

## Implementation

### Runtime Binary

The `hanzo-edge` binary embeds workerd and the control plane:

```bash
# Start edge worker runtime (PoP mode)
hanzo-edge serve --config edge.toml --pop-id nrt-1

# Start control plane
hanzo-edge control --config control.toml --listen :8050

# Deploy a worker
hanzo-edge deploy --worker ./ai-cache.js --name ai-cache

# Check PoP status
hanzo-edge status --pop nrt-1
```

### Configuration

```toml
# edge.toml (PoP configuration)

[pop]
id = "nrt-1"
region = "ap-northeast-1"
control_plane = "https://edge-control.hanzo.ai:8050"

[runtime]
port = 8051
max_isolates = 200
isolate_memory_limit = "128MB"
isolate_cpu_limit = "100ms"
warmup_workers = true

[kv]
origin = "redis-master.hanzo.svc:6379"
replication_interval = "500ms"
max_cache_size = "1GB"
namespaces = ["iam:*", "llm:rate:*", "edge:*"]

[ai]
model_store = "s3://hanzo-models/edge/"
models = ["bge-small-en-v1.5", "distilbert-intent", "tiktoken-cl100k"]
inference_threads = 4

[cache]
semantic_enabled = true
semantic_threshold = 0.95
max_entries = 1_000_000
max_size = "2GB"
ttl = 3600

[origin]
gateway = "https://api.hanzo.ai"
pool_size = 50
keepalive = "90s"
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hanzo-edge
  namespace: hanzo
spec:
  replicas: 3
  selector:
    matchLabels:
      app: hanzo-edge
  template:
    spec:
      containers:
      - name: edge
        image: ghcr.io/hanzoai/edge:latest
        args: ["serve", "--config", "/etc/edge/edge.toml"]
        ports:
        - containerPort: 8051
          name: worker
        - containerPort: 9052
          name: metrics
        resources:
          requests: { cpu: "500m", memory: "512Mi" }
          limits: { cpu: "4000m", memory: "4Gi" }
        volumeMounts:
        - name: config
          mountPath: /etc/edge
        - name: models
          mountPath: /var/edge/models
      volumes:
      - name: config
        configMap:
          name: edge-config
      - name: models
        emptyDir:
          sizeLimit: 2Gi
```

### Docker Development

```yaml
# compose.yml
services:
  edge:
    image: ghcr.io/hanzoai/edge:latest
    ports:
      - "8050:8050"
      - "8051:8051"
      - "9052:9052"
    volumes:
      - ./edge.toml:/etc/edge/edge.toml
      - ./workers:/etc/edge/workers
    environment:
      - ORIGIN_URL=http://gateway:8080
      - KV_URL=redis://redis-master:6379
```

### Implementation Roadmap

#### Phase 1: Core Runtime (Q1 2026)
- workerd integration with Hanzo control plane
- Edge KV with origin replication
- JWT validation and API key resolution at edge
- Request proxying to origin via API Gateway (HIP-0044)

#### Phase 2: Edge AI (Q2 2026)
- ONNX Runtime in V8 isolates for small model inference
- Edge embedding generation (bge-small-en-v1.5)
- Intent classification at edge
- Tokenization at edge (tiktoken)

#### Phase 3: Semantic Cache (Q2 2026)
- Exact match AI response cache
- Semantic similarity cache with local vector index
- Cache analytics and purge API

#### Phase 4: Global PoP Network (Q3 2026)
- Deploy to 10+ PoPs across NA, EU, APAC
- Anycast DNS integration
- Automated PoP health management and failover
- WebSocket termination and streaming optimization

## Security Considerations

### V8 Isolate Security

V8 isolates provide process-level sandboxing: each worker runs in its own isolate with no shared memory, no file system access, and no network access beyond the `fetch` API. However, V8 isolate escapes have occurred historically (CVE-2021-21224, CVE-2023-2033). Defense-in-depth measures:

- **OS-level sandboxing**: Each workerd process runs under seccomp-bpf with a minimal syscall allowlist.
- **Memory limits**: Per-isolate memory caps prevent a compromised isolate from exhausting host memory.
- **Network egress filtering**: Isolates can only `fetch` to allowlisted origins (Hanzo services, configured external APIs).
- **Automatic V8 updates**: workerd is rebuilt weekly with the latest V8 security patches.

### Edge Authentication

Edge PoPs validate JWTs using cached JWKS from IAM (HIP-0026). The JWKS is replicated to edge KV with a 3600-second TTL and refreshed proactively before expiry. API keys are validated against a local replica of the key-to-org mapping.

A compromised PoP could theoretically serve stale authentication data for up to the JWKS TTL (1 hour). To mitigate this, the control plane can force-push JWKS rotations to all PoPs within seconds via the replication protocol.

### Data Residency

Edge caching may store AI responses at PoPs in jurisdictions subject to data residency regulations (GDPR, CCPA). The control plane supports per-namespace geographic restrictions:

```toml
[cache.geo_restrictions]
"eu-only" = ["fra-1", "ams-1", "cdg-1"]    # EU PoPs only
"us-only" = ["iad-1", "lax-1", "ord-1"]    # US PoPs only
```

Requests tagged with `X-Data-Residency: eu` are cached only at EU PoPs.

### Model Security

Edge models are downloaded from Hanzo Object Storage over TLS with SHA-256 integrity verification. Models are stored on ephemeral local disk (not persistent volumes) and re-downloaded on PoP restart. A compromised model artifact is detected by checksum mismatch and rejected.

### DDoS Mitigation

Edge PoPs are the first point of contact for all traffic, making them natural DDoS mitigation points:

- Per-IP rate limiting at the edge (before any origin traffic)
- Connection limits per PoP (max 10,000 concurrent connections)
- Automatic challenge pages for suspected bot traffic
- Geographic blocking configurable via control plane

## Relationship to Other HIPs

| HIP | Relationship |
|-----|-------------|
| **HIP-4** (LLM Gateway) | Origin backend for AI inference. Edge proxies streaming responses from LLM Gateway. |
| **HIP-26** (IAM) | Edge validates JWTs using cached JWKS from IAM. |
| **HIP-28** (KV Store) | Edge KV is a read-replica subset of origin Valkey. |
| **HIP-43** (Inference Engine) | GPU inference stays at origin. Edge runs only CPU-compatible small models. |
| **HIP-44** (API Gateway) | Edge routes requests to origin via the API Gateway. |
| **HIP-46** (Embeddings) | Edge generates embeddings locally for semantic cache; full embedding API served via origin. |

## References

1. [workerd: Cloudflare's Open-Source Workers Runtime](https://github.com/cloudflare/workerd)
2. [Cloudflare Workers API Reference](https://developers.cloudflare.com/workers/runtime-apis/)
3. [V8 Isolates and Security Model](https://v8.dev/docs/embed)
4. [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/)
5. [BGE Small Embedding Model](https://huggingface.co/BAAI/bge-small-en-v1.5)
6. [HIP-4: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md)
7. [HIP-28: Key-Value Store Standard](./hip-0028-key-value-store-standard.md)
8. [HIP-44: API Gateway Standard](./hip-0044-api-gateway-standard.md)
9. [HIP-46: Embeddings Standard](./hip-0046-embeddings-standard.md)
10. [Semantic Caching for LLMs (GPTCache)](https://github.com/zilliztech/GPTCache)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
