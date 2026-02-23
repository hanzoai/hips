---
hip: 0060
title: Serverless Functions (FaaS) Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-02-23
requires: HIP-0030, HIP-0050, HIP-0055
---

# HIP-60: Serverless Functions (FaaS) Standard

## Abstract

This proposal defines the Serverless Functions standard for the Hanzo ecosystem. **Hanzo Functions** is a Function-as-a-Service platform for event-driven AI workloads, built on Knative Serving with a custom AI runtime that supports GPU-attached execution and sub-second cold starts.

Functions are the smallest deployable unit of compute in the Hanzo platform. Where the Inference Engine (HIP-0043) runs persistent model-serving processes and the Edge layer (HIP-0050) runs V8 isolates for lightweight request processing, Functions occupy the middle ground: containerized, stateless units of work that spin up on demand, execute, and disappear. They are the correct abstraction for bursty, event-driven AI workloads that do not justify a long-running service.

The platform supports four function runtimes: **Python**, **Go**, **Rust**, and **TypeScript**. Each runtime ships as a pre-built base image with AI-specific dependencies (PyTorch, ONNX Runtime, Candle, transformers.js) pre-installed and pre-warmed, eliminating the dependency installation tax that plagues cold starts on generic FaaS platforms.

AI-specific triggers connect functions to the broader Hanzo infrastructure: model inference events from the LLM Gateway (HIP-0004), webhook delivery, scheduled retraining cycles, data pipeline stages from Hanzo Stream (HIP-0030), and async task invocation from Hanzo MQ (HIP-0055). Functions can also be deployed to the Edge (HIP-0050) for latency-sensitive invocation without GPU requirements.

**Repository**: [github.com/hanzoai/functions](https://github.com/hanzoai/functions)
**Port**: 8060 (API), 8061 (function invocation proxy)
**Docker**: `ghcr.io/hanzoai/functions:latest`
**Binary**: `hanzo-fn`

## Motivation

### The Bursty Inference Problem

AI workloads are fundamentally bursty. A customer fine-tunes a model once a week. A webhook fires when a document is uploaded and needs embedding. A nightly job recomputes recommendation scores. A Slack bot classifies incoming messages and routes them to the right team.

None of these workloads justify a long-running service. A persistent Kubernetes Deployment with 2 replicas, running 24/7 to handle a webhook that fires 50 times a day, wastes 99.9% of its allocated compute. Multiply this across dozens of AI-adjacent microservices and the waste is substantial -- hundreds of dollars per month in idle GPU and CPU time.

The serverless model eliminates this waste. A function scales to zero when idle and scales up within seconds when triggered. You pay (in cluster resources) only for the milliseconds of actual execution. For the webhook that fires 50 times a day, the cost drops from "always-on Deployment" to "50 cold starts + 50 executions."

### The GPU Cold Start Problem

Generic FaaS platforms (AWS Lambda, Google Cloud Functions, Knative with default configuration) are designed for CPU workloads. Cold start time is typically 100-500ms for a pre-built container, which is acceptable for HTTP request handling.

GPU functions are a different story. A function that runs a small inference model must:

1. Schedule onto a node with an available GPU (0-30 seconds if the cluster has spare capacity, minutes if a new node must be provisioned)
2. Pull the container image (2-10 seconds for a base Python + PyTorch image, which is 2-8GB)
3. Initialize the CUDA runtime (1-3 seconds)
4. Load model weights into GPU memory (1-10 seconds depending on model size)
5. Execute the actual inference (10-500ms)

Steps 1-4 can take 30+ seconds. For a function that processes a webhook in 200ms, spending 30 seconds on cold start is absurd. The cold start is 150x longer than the useful work.

Hanzo Functions solves this with three mechanisms: **pre-warmed GPU pools** (step 1 is eliminated), **container snapshots** (steps 2-3 are reduced to <1 second), and **model caching** (step 4 is eliminated for recently-used models). The result is GPU function cold starts under 2 seconds for models already in the cache, and under 5 seconds for first-time model loads.

### The Event-Driven AI Pipeline Problem

Modern AI applications are not monolithic inference endpoints. They are pipelines of discrete steps:

```
Document uploaded
  --> Extract text (CPU, 500ms)
  --> Chunk text (CPU, 50ms)
  --> Generate embeddings (GPU, 200ms per chunk)
  --> Store in vector DB (CPU, 100ms)
  --> Trigger reranking index update (CPU, 2s)
  --> Send notification (CPU, 50ms)
```

Each step has different resource requirements (CPU vs. GPU), different scaling characteristics (embedding generation is the bottleneck), and different failure modes (vector DB write might fail independently of embedding generation). Running this pipeline in a single service means the entire service needs GPU access even though only one step uses the GPU.

Functions let you decompose the pipeline into independent units. The embedding step runs on a GPU function. Every other step runs on a CPU function. The GPU function scales independently based on its queue depth. If the embedding step fails, it retries independently without re-running text extraction.

The glue between steps is Hanzo Stream (HIP-0030) for durable event-driven pipelines and Hanzo MQ (HIP-0055) for async task invocation. Functions subscribe to stream topics or MQ subjects and are triggered automatically when events arrive.

### Why Not Just Use Kubernetes Jobs

Kubernetes Jobs are the simplest way to run one-off compute tasks. They schedule a pod, run a container to completion, and clean up. Why build a FaaS layer on top?

Three reasons: **cold start optimization**, **event binding**, and **developer experience**.

**Cold start**: A Kubernetes Job starts from scratch every time. It pulls the image, initializes the runtime, and loads dependencies. There is no concept of a warm pool, container reuse, or model caching. Knative Serving (which underlies Hanzo Functions) maintains a pool of warm containers that are immediately available for new requests. The difference is 200ms vs. 30 seconds for a GPU workload.

**Event binding**: Kubernetes Jobs have no built-in trigger mechanism. You need an external system (CronJob for schedules, a webhook receiver for HTTP events, a custom controller for Kafka consumption) to create Jobs in response to events. Hanzo Functions provides a declarative trigger configuration: "run this function when a message arrives on `mq.batch.embeddings`" or "run this function on a cron schedule." The trigger-to-function binding is managed by the platform, not by the developer.

**Developer experience**: A Kubernetes Job requires writing a Dockerfile, a Job YAML manifest, understanding pod scheduling, resource limits, service accounts, and image pull secrets. A Hanzo Function requires writing a function in Python/Go/Rust/TypeScript, pointing the CLI at it, and declaring a trigger. The platform handles containerization, scheduling, scaling, and monitoring.

## Design Philosophy

### Why Knative Over OpenFaaS and AWS Lambda

The three major approaches to serverless on Kubernetes are Knative, OpenFaaS, and Lambda-compatible runtimes (Firecracker/Lambda containers). Each makes different tradeoffs.

**AWS Lambda** is the gold standard for serverless developer experience: write a function, deploy it, never think about infrastructure. But Lambda is a proprietary AWS service. Running Lambda-compatible runtimes on Kubernetes (via Firecracker or Lambda Web Adapter) gives you the API surface but not the operational benefits. You still manage the cluster, the networking, and the scaling. And Lambda's runtime contract (256MB /tmp, 15-minute timeout, no GPU support) is designed for web APIs, not AI workloads. There is no path to GPU-attached Lambda functions on self-hosted infrastructure.

**OpenFaaS** is a lightweight, Kubernetes-native FaaS framework. It is simpler than Knative: fewer CRDs, no Istio dependency, and a straightforward watchdog pattern (HTTP → container → response). However, OpenFaaS has two limitations for AI workloads. First, its autoscaler is basic: it scales based on requests-per-second, not queue depth or GPU utilization. For AI functions where a single request takes 10 seconds of GPU time, request-rate scaling is the wrong signal. Second, OpenFaaS does not support scale-to-zero natively (the "zero-scale" feature requires a separate component and has a 5-10 second wake-up penalty with no warm pool concept).

**Knative Serving** is the most sophisticated option. It provides:

1. **Scale-to-zero with warm pools**: Knative maintains a configurable number of warm instances (the "initial scale" and "min scale" settings). When traffic drops to zero, instances drain gracefully. When traffic returns, warm instances handle requests immediately while new instances spin up.

2. **Concurrency-based autoscaling**: Knative scales based on concurrent requests per instance, not requests per second. This is the correct signal for AI functions: if each instance can handle 1 concurrent GPU inference, and 10 requests arrive, Knative scales to 10 instances. OpenFaaS's rate-based scaling would see "10 requests in 1 second" and might scale differently.

3. **Revision management**: Knative supports traffic splitting between function revisions. Deploy a new version, route 10% of traffic to it, monitor GPU utilization and latency, then promote to 100%. This is essential for AI functions where a new model version might have different memory or latency characteristics.

4. **Kubernetes-native**: Knative uses standard Kubernetes primitives (Deployments, Services, HPAs). No proprietary abstractions. When something breaks, you debug with `kubectl`, not a vendor-specific CLI.

**Trade-off acknowledged**: Knative is more complex than OpenFaaS. It has more CRDs, a heavier control plane, and a steeper learning curve. We accept this because its autoscaling model and revision management are correct for GPU workloads, and its Kubernetes-native design means we are not locked into a framework-specific operational model.

| Factor | AWS Lambda | OpenFaaS | Knative |
|--------|-----------|----------|---------|
| GPU support | No | Manual (no first-class) | Via custom runtime (this HIP) |
| Scale-to-zero | Native | Plugin (slow wake) | Native (warm pool) |
| Autoscaling signal | Concurrency | Request rate | Concurrency |
| Revision/traffic split | Aliases + weights | No | Native |
| K8s integration | External | Lightweight | Deep (CRDs, Services) |
| Operational complexity | None (managed) | Low | Medium |
| Vendor lock-in | AWS only | None | None |
| Cold start (CPU) | 100-500ms | 1-5s | 500ms-2s |
| Cold start (GPU) | N/A | 30s+ | 2-5s (with this HIP) |

### Why AI Needs Serverless

The dominant pattern for AI model serving is persistent deployments: load a model into GPU memory and keep it there, serving requests indefinitely. This is correct for high-traffic models (zen-72b serving thousands of requests per minute). But the AI ecosystem has a long tail of workloads that are poorly served by persistent deployments:

1. **Bursty inference**: A customer's fine-tuned model receives 100 requests during business hours and zero requests overnight. A persistent deployment wastes 16 hours of GPU time per day. A function scales to zero overnight and wakes in seconds when the first morning request arrives.

2. **Event-driven pipelines**: Document processing, image annotation, video transcription, and data enrichment are triggered by uploads, not by user requests. They run for seconds or minutes, not hours. Functions are the natural execution model.

3. **Scheduled retraining**: Nightly model retraining, weekly evaluation runs, and monthly dataset refreshes are periodic GPU workloads. Functions with cron triggers replace the CronJob + custom-container pattern with a single declarative configuration.

4. **Webhook handlers**: OAuth callbacks, payment confirmations, CI/CD notifications, and third-party API webhooks need lightweight, stateless request handling. Functions handle these without a dedicated microservice per webhook source.

5. **Prototyping and experimentation**: Researchers need to deploy a model for a demo, test a new preprocessing step, or run a one-off evaluation. Functions let them deploy in seconds without writing Dockerfiles or Kubernetes manifests.

The principle: **persistent deployments for steady-state serving; functions for everything else.**

### Why Not Edge Functions for Everything

Hanzo Edge (HIP-0050) provides V8 isolate-based functions at globally distributed PoPs. Why not use Edge for all serverless workloads?

Because Edge functions run on CPU-only infrastructure. They execute JavaScript/TypeScript in V8 isolates with sub-millisecond cold starts and <128MB memory limits. This is perfect for authentication, routing, caching, and small-model inference (embeddings, classification).

But Edge functions cannot:
- Attach to GPUs for model inference
- Run Python, Go, or Rust code natively
- Use more than 128MB of memory
- Execute for longer than 100ms of CPU time (configurable, but fundamentally limited by the isolate model)

Hanzo Functions fills the gap between Edge (millisecond-scale, CPU-only, globally distributed) and the Inference Engine (persistent, GPU-attached, origin-only). Functions run in containers with full OS access, arbitrary memory limits, GPU attachment, and execution times measured in seconds or minutes.

```
Workload Type          │ Execution Model      │ Cold Start  │ GPU │ Duration
───────────────────────┼──────────────────────┼─────────────┼─────┼──────────
Auth/routing/caching   │ Edge (HIP-0050)      │ <1ms        │ No  │ <100ms
Webhooks/ETL/pipelines │ Functions (HIP-0060) │ 500ms-5s    │ Opt │ <15min
Model serving          │ Engine (HIP-0043)    │ 2-30s       │ Yes │ Persistent
Training/fine-tuning   │ ML Pipeline (HIP-57) │ Minutes     │ Yes │ Hours
```

## Specification

### Architecture

```
                    ┌────────────────────────────────────────────┐
                    │              Hanzo Functions                │
                    │             Control Plane :8060             │
                    │                                            │
                    │  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
                    │  │ Function │  │ Trigger  │  │ Revision │ │
                    │  │ Registry │  │ Manager  │  │ Router   │ │
                    │  └──────────┘  └──────────┘  └──────────┘ │
                    └────────────────────┬───────────────────────┘
                                        │
               ┌────────────────────────┼────────────────────────┐
               │                        │                        │
        ┌──────┴──────┐         ┌───────┴──────┐         ┌──────┴──────┐
        │   Knative   │         │   Knative    │         │   Knative   │
        │  Serving    │         │  Serving     │         │  Serving    │
        │ (CPU Pool)  │         │ (GPU Pool)   │         │ (Edge Sync) │
        │             │         │              │         │             │
        │  Python     │         │  Python+CUDA │         │  Sync to    │
        │  Go         │         │  Rust+Candle │         │  HIP-0050   │
        │  Rust       │         │              │         │             │
        │  TypeScript │         │              │         │             │
        └──────┬──────┘         └──────┬───────┘         └─────────────┘
               │                       │
     ┌─────────┴──────────┐    ┌───────┴───────────┐
     │                    │    │                    │
  ┌──┴───┐  ┌──────┐  ┌──┴──┐ │ ┌──────┐  ┌─────┐ │
  │Stream│  │  MQ  │  │HTTP │ │ │Model │  │GPU  │ │
  │HIP-30│  │HIP-55│  │     │ │ │Cache │  │Pool │ │
  └──────┘  └──────┘  └─────┘ │ └──────┘  └─────┘ │
                               └───────────────────┘
```

The architecture has three layers:

1. **Control Plane** (port 8060): Manages function definitions, trigger bindings, revision history, and deployment orchestration. Talks to the Knative API server to create/update Knative Services.

2. **Execution Plane**: Knative Serving manages the lifecycle of function instances. CPU functions run on the standard node pool. GPU functions run on GPU-labeled nodes with pre-warmed CUDA containers. Edge-compatible functions are synced to the Edge control plane (HIP-0050) for deployment as V8 isolates.

3. **Event Plane**: Trigger sources (Stream, MQ, HTTP, Cron) are connected to functions via the Trigger Manager. When an event arrives, the Trigger Manager invokes the function through the Knative invocation proxy (port 8061).

### Function Definition

A function is defined by a manifest file (`function.yaml`) and source code:

```yaml
# function.yaml
name: embed-document
runtime: python
version: 1.0.0
entry: handler.embed
description: Generate embeddings for uploaded documents

resources:
  cpu: "500m"
  memory: "1Gi"
  gpu: "nvidia.com/gpu: 1"    # Optional: request a GPU
  timeout: 300s                # Maximum execution time
  concurrency: 4               # Max concurrent requests per instance

scaling:
  min_instances: 0             # Scale to zero when idle
  max_instances: 20            # Hard ceiling
  target_concurrency: 1        # Scale up when concurrency exceeds this
  scale_down_delay: 300s       # Wait 5 min before scaling down

triggers:
  - type: mq
    source: mq.batch.embeddings
    consumer_group: fn-embed-document

  - type: http
    path: /v1/functions/embed-document
    methods: [POST]

  - type: cron
    schedule: "0 2 * * *"      # Daily at 02:00 UTC
    payload: '{"mode": "reindex"}'

environment:
  MODEL_NAME: bge-large-en-v1.5
  BATCH_SIZE: "32"

secrets:
  - name: hanzo-api-key
    env: HANZO_API_KEY
```

#### Manifest Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Function name. Lowercase, alphanumeric + hyphens. Globally unique within the org. |
| `runtime` | enum | yes | `python`, `go`, `rust`, `typescript` |
| `version` | semver | yes | Function version. New versions create new Knative revisions. |
| `entry` | string | yes | Entrypoint. Format depends on runtime (see Runtime Specification). |
| `description` | string | no | Human-readable description. |
| `resources.cpu` | string | no | CPU request (Kubernetes format). Default: `250m`. |
| `resources.memory` | string | no | Memory request. Default: `256Mi`. |
| `resources.gpu` | string | no | GPU resource request. Omit for CPU-only functions. |
| `resources.timeout` | duration | no | Max execution time. Default: `60s`. Max: `900s` (15 minutes). |
| `resources.concurrency` | int | no | Max concurrent requests per instance. Default: `1` for GPU, `10` for CPU. |
| `scaling.min_instances` | int | no | Minimum instances. `0` enables scale-to-zero. Default: `0`. |
| `scaling.max_instances` | int | no | Maximum instances. Default: `10`. |
| `scaling.target_concurrency` | int | no | Target concurrency for autoscaling. Default: `1`. |
| `scaling.scale_down_delay` | duration | no | Grace period before scaling down. Default: `300s`. |
| `triggers` | list | yes | One or more trigger definitions (see Trigger Specification). |
| `environment` | map | no | Environment variables injected into the function container. |
| `secrets` | list | no | KMS secrets (HIP-0027) injected as environment variables. |

### Runtime Specification

Each runtime provides a base container image with pre-installed dependencies and a standard invocation contract.

#### Python Runtime

Base image: `ghcr.io/hanzoai/fn-python:3.12`

Pre-installed: `torch`, `transformers`, `onnxruntime`, `numpy`, `httpx`, `pydantic`

```python
# handler.py
from hanzo.functions import Context, Response

def embed(ctx: Context) -> Response:
    """Generate embeddings for a document."""
    doc_id = ctx.data["document_id"]
    text = fetch_document(doc_id)

    model = ctx.model("bge-large-en-v1.5")  # Loaded from model cache
    embeddings = model.encode(text, batch_size=32)

    store_embeddings(doc_id, embeddings)

    return Response(
        status=200,
        body={"document_id": doc_id, "dimensions": len(embeddings[0])}
    )
```

The `Context` object provides:

| Attribute | Type | Description |
|-----------|------|-------------|
| `ctx.data` | dict | Parsed trigger payload (JSON body, MQ message data, Stream event data) |
| `ctx.headers` | dict | HTTP headers (for HTTP triggers) or message headers |
| `ctx.trigger` | TriggerInfo | Trigger metadata (type, source, timestamp) |
| `ctx.model(name)` | Model | Load a model from the GPU model cache |
| `ctx.kv` | KVClient | Valkey client (HIP-0028) |
| `ctx.storage` | StorageClient | Object storage client (HIP-0032) |
| `ctx.publish(subject, data)` | None | Publish to MQ (HIP-0055) or Stream (HIP-0030) |
| `ctx.log` | Logger | Structured logger with request correlation ID |

#### Go Runtime

Base image: `ghcr.io/hanzoai/fn-go:1.22`

Pre-installed: ONNX Runtime C bindings, Hanzo SDK

```go
// handler.go
package main

import (
    "github.com/hanzoai/functions/sdk"
)

func Classify(ctx *sdk.Context) *sdk.Response {
    text := ctx.Data["text"].(string)

    model, err := ctx.Model("distilbert-intent")
    if err != nil {
        return sdk.Error(500, err)
    }

    result, err := model.Predict(text)
    if err != nil {
        return sdk.Error(500, err)
    }

    return sdk.OK(map[string]interface{}{
        "label":      result.Label,
        "confidence": result.Score,
    })
}
```

#### Rust Runtime

Base image: `ghcr.io/hanzoai/fn-rust:1.77`

Pre-installed: Candle (HIP-0019), `tokio`, `serde`, `reqwest`

```rust
// src/handler.rs
use hanzo_functions::{Context, Response, Result};

pub async fn transcribe(ctx: Context) -> Result<Response> {
    let audio_url: String = ctx.data().get("audio_url")?;
    let audio = ctx.storage().get(&audio_url).await?;

    let model = ctx.model("whisper-small").await?;
    let transcript = model.transcribe(&audio).await?;

    ctx.publish("mq.pipeline.transcription.complete", &serde_json::json!({
        "audio_url": audio_url,
        "transcript": transcript,
    })).await?;

    Ok(Response::ok(serde_json::json!({
        "transcript": transcript,
    })))
}
```

#### TypeScript Runtime

Base image: `ghcr.io/hanzoai/fn-typescript:22`

Pre-installed: `@xenova/transformers`, `onnxruntime-node`, Hanzo SDK

```typescript
// handler.ts
import { Context, Response } from '@hanzo/functions'

export async function webhook(ctx: Context): Promise<Response> {
  const event = ctx.data as WebhookPayload

  // Classify the incoming webhook
  const intent = await ctx.model('distilbert-intent').predict(event.text)

  // Route based on classification
  if (intent.label === 'support') {
    await ctx.publish('mq.notify.support', {
      channel: 'slack',
      message: event.text,
      metadata: { confidence: intent.score },
    })
  }

  return Response.ok({ routed: true, intent: intent.label })
}
```

### Trigger Specification

Triggers connect external events to function invocations. A function can have multiple triggers of different types.

#### HTTP Trigger

Exposes the function as an HTTP endpoint on the invocation proxy (port 8061).

```yaml
triggers:
  - type: http
    path: /v1/functions/my-function
    methods: [GET, POST]
    auth: required          # "required" (default), "optional", "none"
    rate_limit: 100/min     # Per-API-key rate limit
```

HTTP triggers create a Knative Route that maps the path to the function's Knative Service. Authentication is handled by the invocation proxy using IAM (HIP-0026) JWT validation.

#### MQ Trigger (HIP-0055)

Invokes the function when a message arrives on a NATS JetStream subject.

```yaml
triggers:
  - type: mq
    source: mq.batch.embeddings
    consumer_group: fn-embed-document
    batch_size: 1            # Messages per invocation (default: 1)
    max_batch_wait: 5s       # Max wait to fill batch
```

The Trigger Manager runs a NATS consumer in the specified consumer group. When a message arrives, it invokes the function via HTTP and acknowledges the message only after the function returns successfully. If the function fails, the message is nacked and redelivered per the MQ queue's retry policy.

#### Stream Trigger (HIP-0030)

Invokes the function when an event is published to a Kafka topic.

```yaml
triggers:
  - type: stream
    topic: llm_usage
    consumer_group: fn-usage-aggregator
    batch_size: 100          # Events per invocation
    max_batch_wait: 10s
    start_offset: latest     # "latest" or "earliest"
```

The Trigger Manager runs a Kafka consumer. Events are batched and delivered to the function as an array in `ctx.data`. The consumer commits offsets only after successful function execution.

#### Cron Trigger

Invokes the function on a schedule.

```yaml
triggers:
  - type: cron
    schedule: "0 */6 * * *"  # Every 6 hours (standard cron syntax)
    timezone: UTC
    payload: '{"type": "full_reconcile"}'
```

The Trigger Manager uses an internal scheduler (backed by PostgreSQL, not Kubernetes CronJobs) to fire cron triggers. This avoids the Kubernetes CronJob limitation of 1-minute granularity and provides better observability through the management API.

#### Inference Event Trigger

Invokes the function in response to LLM Gateway (HIP-0004) inference events. This is a convenience trigger built on top of the Stream trigger that filters `llm_usage` events.

```yaml
triggers:
  - type: inference
    models: [zen-7b, zen-14b]        # Filter by model
    event_types: [completed, failed]  # Filter by outcome
    min_tokens: 1000                  # Filter by token count
```

### GPU Function Execution

GPU functions are the distinguishing feature of Hanzo Functions. This section specifies the mechanisms that make GPU cold starts tolerable.

#### Pre-Warmed GPU Pool

The cluster maintains a pool of GPU-equipped pods that are pre-initialized with the CUDA runtime and a base function container. These pods are idle but warm -- the CUDA context is loaded, the GPU driver is initialized, and the base container is running.

When a GPU function is invoked:
1. The scheduler selects a warm pod from the pool (0ms scheduling delay).
2. The function code and dependencies are injected into the warm pod via a volume mount (200-500ms).
3. The model is loaded from the model cache (0ms if cached, 1-10s if not).
4. The function executes.
5. After execution, the pod returns to the pool for reuse.

Pool sizing:

```yaml
gpu_pool:
  size: 4                    # Pre-warmed GPU pods
  gpu_type: nvidia-a10g      # GPU type for pool pods
  idle_timeout: 600s         # Return to pool after 10 min idle
  max_model_cache: 8Gi       # Per-pod model cache size
  preload_models:            # Models loaded at pool startup
    - bge-large-en-v1.5
    - whisper-small
    - distilbert-intent
```

#### Container Snapshots

Traditional container cold start involves pulling the image, unpacking layers, and initializing the runtime. For a Python + PyTorch image (5GB+), this takes 5-15 seconds even from a local registry.

Hanzo Functions uses **container snapshots** (CRIU-based checkpoint/restore) to reduce cold start to <1 second:

1. **Snapshot creation**: When a function is deployed, the platform runs the container, initializes the runtime (imports, CUDA setup, model loading), and creates a CRIU checkpoint of the process state.
2. **Snapshot restore**: On cold start, instead of starting the container from scratch, the platform restores the checkpoint. All imports are loaded, CUDA is initialized, and models are in memory. The function is ready to execute in <1 second.

Snapshots are stored in Object Storage (HIP-0032) and cached on local SSD at each node. They are invalidated when the function code or runtime version changes.

```
Traditional cold start:  Pull image (5s) → Start container (1s) → Import torch (3s) → Load CUDA (2s) → Load model (3s) = 14s
Snapshot cold start:     Restore checkpoint (800ms) → Ready
```

Snapshot support is available for Python and Rust runtimes. Go and TypeScript runtimes already have fast cold starts (<1s) without snapshots due to their lightweight initialization.

#### Model Cache

GPU functions frequently load the same models. The model cache is a node-local LRU cache backed by NVMe SSD that stores model weights in a ready-to-load format.

```
Model requested by function
  --> Check node-local cache (NVMe SSD)
      --> Hit: mmap into GPU memory (50-200ms)
      --> Miss: Download from Object Storage (HIP-0032) (1-10s)
              --> Cache locally
              --> mmap into GPU memory
```

The cache operates at the node level, not the pod level. Multiple function pods on the same node share the cache. Cache eviction uses LRU with a configurable size limit (default: 50GB per node).

Cache metrics:

```
hanzo_fn_model_cache_hits_total{node, model}
hanzo_fn_model_cache_misses_total{node, model}
hanzo_fn_model_cache_size_bytes{node}
hanzo_fn_model_cache_evictions_total{node}
hanzo_fn_model_load_duration_seconds{model}
```

### Control Plane API

The control plane runs on port 8060 and manages function lifecycle.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/functions` | GET | List all functions (paginated, filterable by runtime/trigger type) |
| `/v1/functions` | POST | Create a new function (accepts function.yaml + source archive) |
| `/v1/functions/{name}` | GET | Function detail: revisions, triggers, scaling config |
| `/v1/functions/{name}` | PUT | Update function (creates new revision) |
| `/v1/functions/{name}` | DELETE | Delete function and all revisions |
| `/v1/functions/{name}/revisions` | GET | List revisions with traffic allocation |
| `/v1/functions/{name}/revisions/{rev}` | GET | Revision detail: instances, metrics |
| `/v1/functions/{name}/invoke` | POST | Synchronous invocation (waits for response) |
| `/v1/functions/{name}/invoke-async` | POST | Asynchronous invocation (returns task ID) |
| `/v1/functions/{name}/logs` | GET | Function execution logs (streaming SSE) |
| `/v1/functions/{name}/metrics` | GET | Per-function metrics (invocations, latency, errors) |
| `/v1/functions/{name}/traffic` | PUT | Update traffic split between revisions |
| `/v1/triggers` | GET | List all active triggers |
| `/v1/triggers/{id}` | GET | Trigger detail: source, function, status |
| `/v1/gpu-pool` | GET | GPU pool status: warm pods, cache utilization |
| `/health` | GET | Control plane health |

### Invocation Protocol

Functions are invoked via HTTP POST to the function's Knative Service endpoint. The invocation proxy (port 8061) handles routing, authentication, and trigger-specific payload transformation.

#### Request Format

```json
POST /v1/functions/embed-document/invoke
Content-Type: application/json
Authorization: Bearer <jwt>
X-Hanzo-Trigger: mq
X-Hanzo-Trigger-Source: mq.batch.embeddings
X-Hanzo-Request-ID: req_01HQ3X7K8M2N4P5R6S7T8U9V0W

{
  "document_id": "doc_abc123",
  "options": { "model": "bge-large-en-v1.5" }
}
```

#### Response Format

```json
HTTP/1.1 200 OK
Content-Type: application/json
X-Hanzo-Function: embed-document
X-Hanzo-Revision: embed-document-00003
X-Hanzo-Duration-Ms: 1250
X-Hanzo-Instance: fn-embed-document-00003-deployment-abc12-xyz

{
  "document_id": "doc_abc123",
  "dimensions": 1024,
  "chunks_processed": 42
}
```

### Traffic Splitting

Functions support gradual rollouts via traffic splitting between revisions:

```bash
# Deploy new version (creates revision 4)
hanzo-fn deploy --name embed-document --source ./src

# Route 10% of traffic to the new revision
hanzo-fn traffic embed-document --revision 4 --percent 10

# Monitor metrics, then promote
hanzo-fn traffic embed-document --revision 4 --percent 100
```

Traffic splitting is implemented via Knative's traffic configuration:

```yaml
traffic:
  - revisionName: embed-document-00003
    percent: 90
  - revisionName: embed-document-00004
    percent: 10
```

### Prometheus Metrics

Metrics are exported on port 9060 with namespace `hanzo_fn`:

| Metric | Type | Description |
|--------|------|-------------|
| `hanzo_fn_invocations_total` | Counter | Total invocations by function, trigger type, status |
| `hanzo_fn_duration_seconds` | Histogram | End-to-end execution time (includes cold start) |
| `hanzo_fn_cold_start_duration_seconds` | Histogram | Cold start time by function, runtime |
| `hanzo_fn_cold_starts_total` | Counter | Cold starts by function (vs. warm invocations) |
| `hanzo_fn_errors_total` | Counter | Errors by function, error type |
| `hanzo_fn_concurrent_executions` | Gauge | Currently executing instances per function |
| `hanzo_fn_gpu_utilization` | Gauge | GPU utilization per function (GPU functions only) |
| `hanzo_fn_gpu_memory_bytes` | Gauge | GPU memory usage per function |
| `hanzo_fn_gpu_pool_available` | Gauge | Available warm GPU pods in pool |
| `hanzo_fn_gpu_pool_in_use` | Gauge | GPU pods currently executing functions |
| `hanzo_fn_model_cache_hit_rate` | Gauge | Model cache hit ratio per node |
| `hanzo_fn_trigger_lag` | Gauge | Lag between event arrival and function invocation |
| `hanzo_fn_snapshot_restore_seconds` | Histogram | CRIU snapshot restore time |

## Implementation

### CLI

The `hanzo-fn` CLI is the primary developer interface:

```bash
# Initialize a new function project
hanzo-fn init --runtime python --name my-function

# Local development (runs function locally with hot reload)
hanzo-fn dev --port 8080

# Deploy to cluster
hanzo-fn deploy --name my-function --source ./src

# Invoke a deployed function
hanzo-fn invoke my-function --data '{"key": "value"}'

# View logs
hanzo-fn logs my-function --follow

# View metrics
hanzo-fn metrics my-function

# List all functions
hanzo-fn list

# Delete a function
hanzo-fn delete my-function
```

### Kubernetes Deployment

#### Control Plane

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hanzo-functions
  namespace: hanzo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: hanzo-functions
  template:
    spec:
      containers:
      - name: control-plane
        image: ghcr.io/hanzoai/functions:latest
        args: ["serve", "--config", "/etc/functions/config.yaml"]
        ports:
        - containerPort: 8060
          name: api
        - containerPort: 8061
          name: invoke
        - containerPort: 9060
          name: metrics
        resources:
          requests: { cpu: "500m", memory: "512Mi" }
          limits: { cpu: "2000m", memory: "2Gi" }
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: hanzo-functions-db
              key: url
        - name: NATS_URL
          value: nats://nats-mq.hanzo.svc:4222
        - name: KAFKA_BROKERS
          value: insights-kafka-0.insights-kafka.hanzo.svc:9092
        volumeMounts:
        - name: config
          mountPath: /etc/functions
      volumes:
      - name: config
        configMap:
          name: functions-config
```

#### GPU Pool DaemonSet

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: hanzo-fn-gpu-pool
  namespace: hanzo
spec:
  selector:
    matchLabels:
      app: hanzo-fn-gpu-pool
  template:
    spec:
      nodeSelector:
        nvidia.com/gpu.present: "true"
      containers:
      - name: gpu-warm
        image: ghcr.io/hanzoai/fn-python:3.12-cuda
        command: ["hanzo-fn-agent", "--mode=pool", "--model-cache=/cache"]
        resources:
          requests:
            cpu: "1000m"
            memory: "4Gi"
            nvidia.com/gpu: "1"
          limits:
            cpu: "4000m"
            memory: "16Gi"
            nvidia.com/gpu: "1"
        volumeMounts:
        - name: model-cache
          mountPath: /cache
        - name: snapshots
          mountPath: /snapshots
      volumes:
      - name: model-cache
        hostPath:
          path: /var/hanzo/model-cache
          type: DirectoryOrCreate
      - name: snapshots
        hostPath:
          path: /var/hanzo/snapshots
          type: DirectoryOrCreate
```

### Docker Development

```yaml
# compose.yml
services:
  functions:
    image: ghcr.io/hanzoai/functions:latest
    ports:
      - "8060:8060"
      - "8061:8061"
      - "9060:9060"
    environment:
      DATABASE_URL: postgresql://hanzo:hanzo@postgres:5432/hanzo_functions
      NATS_URL: nats://nats:4222
      KAFKA_BROKERS: kafka:9092
      OBJECT_STORAGE_URL: http://minio:9000
      GPU_POOL_ENABLED: "false"  # No GPU in dev
    volumes:
      - ./config.yaml:/etc/functions/config.yaml

  # Local function runner (no Knative needed for dev)
  function-runner:
    image: ghcr.io/hanzoai/fn-python:3.12
    ports:
      - "8080:8080"
    volumes:
      - ./my-function:/app
    command: ["hanzo-fn-agent", "--mode=dev", "--source=/app"]
```

### Configuration

```yaml
# config.yaml
server:
  api_port: 8060
  invoke_port: 8061
  metrics_port: 9060

database:
  url: ${DATABASE_URL}
  max_connections: 20

knative:
  namespace: hanzo-functions
  domain: fn.hanzo.ai

triggers:
  nats:
    url: ${NATS_URL}
    credentials:
      user: functions-trigger
      password: ${NATS_PASSWORD}
  kafka:
    brokers: ${KAFKA_BROKERS}
    group_prefix: fn-
  cron:
    store: database       # Cron state in PostgreSQL

gpu_pool:
  enabled: true
  size: 4
  gpu_type: nvidia.com/gpu
  idle_timeout: 600s
  max_model_cache: 50Gi
  preload_models:
    - bge-large-en-v1.5
    - whisper-small

snapshots:
  enabled: true
  storage: s3://hanzo-functions/snapshots/
  max_age: 7d

runtimes:
  python:
    image: ghcr.io/hanzoai/fn-python:3.12
    gpu_image: ghcr.io/hanzoai/fn-python:3.12-cuda
    default_timeout: 60s
    max_timeout: 900s
  go:
    image: ghcr.io/hanzoai/fn-go:1.22
    default_timeout: 30s
    max_timeout: 300s
  rust:
    image: ghcr.io/hanzoai/fn-rust:1.77
    gpu_image: ghcr.io/hanzoai/fn-rust:1.77-cuda
    default_timeout: 60s
    max_timeout: 900s
  typescript:
    image: ghcr.io/hanzoai/fn-typescript:22
    default_timeout: 30s
    max_timeout: 300s

observability:
  log_level: info
  trace_sampling: 0.1
  metrics_namespace: hanzo_fn
```

### Implementation Roadmap

#### Phase 1: Core Platform (Q1 2026)
- Knative Serving integration with Hanzo control plane
- Python and TypeScript runtimes with CPU execution
- HTTP triggers with IAM authentication
- CLI for deploy/invoke/logs
- Prometheus metrics export

#### Phase 2: Event Triggers (Q1 2026)
- MQ trigger (NATS JetStream consumer)
- Stream trigger (Kafka consumer)
- Cron trigger with PostgreSQL-backed scheduler
- Async invocation with task status tracking

#### Phase 3: GPU Functions (Q2 2026)
- Pre-warmed GPU pool with CUDA-initialized containers
- Model cache with LRU eviction on NVMe SSD
- Python + CUDA and Rust + Candle GPU runtimes
- Container snapshots (CRIU) for Python GPU functions

#### Phase 4: Edge Integration (Q2 2026)
- Sync TypeScript functions to Edge (HIP-0050) as V8 isolates
- Unified deployment: single function.yaml deploys to both origin and edge
- Latency-based routing: edge for CPU functions, origin for GPU functions

#### Phase 5: Advanced Features (Q3 2026)
- Go runtime with ONNX bindings
- Traffic splitting and canary deployments
- Function composition (output of one function triggers another)
- Cost attribution per function per org (integrated with billing)

## Security Considerations

### Function Isolation

Each function instance runs in its own Kubernetes pod with:
- **Network namespace isolation**: Functions cannot communicate with each other directly. All inter-function communication goes through MQ or Stream.
- **Filesystem isolation**: Read-only root filesystem. Writable `/tmp` with size limits (512MB default).
- **Resource limits**: CPU, memory, and GPU limits enforced by Kubernetes. Functions that exceed limits are OOM-killed.
- **Service account**: Each function runs with a dedicated Kubernetes service account with minimal RBAC permissions.

### Secret Management

Function secrets are sourced from KMS (HIP-0027) and injected as environment variables. Secrets are never stored in function.yaml, the control plane database, or container images.

```yaml
secrets:
  - name: hanzo-api-key        # KMS secret name
    env: HANZO_API_KEY          # Environment variable name in function
  - name: db-connection-string
    env: DATABASE_URL
```

The control plane fetches secrets from KMS at deployment time and creates Kubernetes Secrets that are mounted into function pods. Secret rotation triggers a rolling update of function pods.

### Authentication and Authorization

- **Function deployment**: Requires IAM authentication with `functions:deploy` permission scoped to the organization.
- **HTTP trigger invocation**: Requires IAM JWT or API key. Configurable per trigger (`auth: required`, `optional`, or `none`).
- **MQ/Stream triggers**: Authenticated via NATS/Kafka credentials managed by the control plane. Individual functions do not handle message bus authentication.
- **Control plane API**: All endpoints require IAM authentication with appropriate `functions:*` permissions.

### Network Policies

Functions can only communicate with:
- Hanzo internal services (IAM, KV, Object Storage, MQ, Stream) via their cluster-internal endpoints
- External URLs explicitly allowlisted in the function configuration

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: hanzo-functions-egress
  namespace: hanzo-functions
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/managed-by: hanzo-functions
  egress:
  - to:
    - namespaceSelector:
        matchLabels:
          name: hanzo
    ports:
    - protocol: TCP
      port: 4222    # NATS
    - protocol: TCP
      port: 9092    # Kafka
    - protocol: TCP
      port: 6379    # Valkey
    - protocol: TCP
      port: 9000    # MinIO
    - protocol: TCP
      port: 5432    # PostgreSQL
  policyTypes:
  - Egress
```

### Execution Time Limits

Functions have a hard timeout (default 60s, max 900s). The invocation proxy terminates functions that exceed their timeout and returns a 504 Gateway Timeout to the caller. For MQ/Stream triggers, the message is nacked and redelivered.

This prevents runaway GPU consumption from buggy or malicious functions. A function that enters an infinite loop will be killed after its timeout, and the GPU is returned to the pool.

### Supply Chain Security

Function container images are built from Hanzo-maintained base images. These base images are:
- Built from minimal base images (distroless for Go/Rust, slim for Python/TypeScript)
- Scanned for CVEs on every build via Trivy
- Signed with cosign and verified at deployment time
- Pinned to specific digests in the function manifest (not mutable tags)

User function code is injected into these base images at deployment time. The control plane validates that the source archive does not contain executable binaries, symlinks outside the function directory, or files larger than 100MB.

## Relationship to Other HIPs

| HIP | Relationship |
|-----|-------------|
| **HIP-4** (LLM Gateway) | Inference event trigger source. Functions process LLM usage events. |
| **HIP-19** (Tensor Operations) | Candle library used in Rust GPU runtime for tensor operations. |
| **HIP-26** (IAM) | Authentication for function deployment and HTTP trigger invocation. |
| **HIP-27** (KMS) | Secret injection into function environments. |
| **HIP-28** (KV Store) | Functions access Valkey via `ctx.kv` for caching and state. |
| **HIP-30** (Event Streaming) | Stream trigger consumes Kafka topics. Functions publish to Stream. |
| **HIP-31** (Observability) | Prometheus metrics and structured logging. |
| **HIP-32** (Object Storage) | Model cache storage. Container snapshot storage. Function access via `ctx.storage`. |
| **HIP-37** (AI Cloud) | Functions are a deployment target within the Cloud platform. |
| **HIP-43** (Inference Engine) | Persistent serving complement. Engine for steady-state; Functions for bursty. |
| **HIP-50** (Edge Computing) | TypeScript functions sync to Edge for latency-sensitive CPU workloads. |
| **HIP-55** (Message Queue) | MQ trigger consumes NATS subjects. Functions publish to MQ via `ctx.publish`. |
| **HIP-57** (ML Pipeline) | Pipeline stages can be implemented as functions. Retraining triggers. |

## References

1. [Knative Serving Documentation](https://knative.dev/docs/serving/)
2. [Knative Autoscaling](https://knative.dev/docs/serving/autoscaling/)
3. [CRIU: Checkpoint/Restore in Userspace](https://criu.org/Main_Page)
4. [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/)
5. [HIP-4: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md)
6. [HIP-30: Event Streaming Standard](./hip-0030-event-streaming-standard.md)
7. [HIP-43: LLM Inference Engine Standard](./hip-0043-llm-inference-engine-standard.md)
8. [HIP-50: Edge Computing Standard](./hip-0050-edge-computing-standard.md)
9. [HIP-55: Message Queue Standard](./hip-0055-message-queue-standard.md)
10. [HIP-57: ML Pipeline & Training Standard](./hip-0057-ml-pipeline-standard.md)
11. [OpenFaaS Architecture](https://docs.openfaas.com/architecture/stack/)
12. [AWS Lambda Execution Environment](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html)
13. [Hanzo Functions Repository](https://github.com/hanzoai/functions)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
