---
hip: 0050
title: Hanzo Edge — Edge AI Runtime Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-02-23
updated: 2026-02-24
requires: HIP-0019, HIP-0043
---


# HIP-0050: Hanzo Edge — Edge AI Runtime Standard

## Abstract

This proposal defines Hanzo Edge, the on-device AI inference runtime for mobile, web, and embedded platforms. Edge is the lightweight counterpart to Hanzo Engine (HIP-0043): where Engine runs on cloud/datacenter GPUs, Edge runs on end-user hardware -- iPhones, Android phones, web browsers, and embedded ARM devices.

Edge is built on the same Rust ML framework (Candle, at `~/work/hanzo/ml`) as Engine. Both share the same model format and quantization pipeline. A model quantized for Engine can be further compressed for Edge deployment. This shared foundation means a single model development workflow produces artifacts for both cloud and on-device inference.

Edge is optimized for small Zen models: zen3-nano (4B parameters) and zen4-mini (8B parameters) at 4-bit quantization. It provides streaming inference within fixed memory budgets, local MCP tool execution, and platform-native SDKs for Swift (iOS), Kotlin (Android), JavaScript/WASM (Web), and Rust (embedded).

**Repository**: [github.com/hanzoai/edge](https://github.com/hanzoai/edge) (Rust, built on Engine + ML)
**ML Framework**: [github.com/hanzoai/ml](https://github.com/hanzoai/ml) (Candle, Rust)
**Engine**: [github.com/hanzoai/engine](https://github.com/hanzoai/engine) (cloud counterpart)
**Target Models**: zen3-nano (4B), zen4-mini (8B), zen3-embedding, zen3-guard
**Binary**: `hanzo-edge`


}

// Cloud fallback for complex tasks
let response = try await edge.chatWithFallback(
    messages: messages,
    localModel: .zen3Nano,
    cloudModel: "zen4",
    fallbackThreshold: .complexity(0.8)
)
```

#### Kotlin SDK (Android)

```kotlin
import ai.hanzo.edge.HanzoEdge

val edge = HanzoEdge.Builder()
    .model(Model.ZEN3_NANO)
    .quantization(Quantization.AFQ_4)
    .maxContextTokens(4096)
    .maxMemoryBytes(3L * 1024 * 1024 * 1024)
    .build()

// Streaming inference
edge.chat(
    messages = listOf(
        Message.system("You are a helpful assistant."),
        Message.user("Explain recursion.")
    ),
    onToken = { token -> print(token) },
    onComplete = { response -> /* handle completion */ }
)
```

#### JavaScript/WASM SDK (Web)

```javascript
import { HanzoEdge } from '@hanzo/edge';

const edge = await HanzoEdge.init({
  model: 'zen3-nano',
  quantization: 'afq-4',
  maxContextTokens: 2048,
  wasmUrl: '/hanzo-edge.wasm',  // Self-hosted WASM binary
});

// Streaming inference
const stream = edge.chat([
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Hello!' },
]);

for await (const token of stream) {
  document.getElementById('output').textContent += token;
}
```

#### Rust SDK (Embedded)

```rust
use hanzo_edge::{Edge, EdgeConfig, Model, Message};

let edge = Edge::new(EdgeConfig {
    model: Model::Zen3Nano,
    quantization: Quantization::Afq4,
    max_context_tokens: 4096,
    max_memory_bytes: 3 * 1024 * 1024 * 1024,
    backend: Backend::Cpu,  // or Backend::Metal, Backend::Vulkan
})?;

let mut stream = edge.chat(vec![
    Message::user("Summarize this document."),
])?;

while let Some(token) = stream.next().await {
    print!("{}", token?);
}
```

### Local MCP Support

Edge implements a local MCP client (HIP-0010) that enables on-device tool use without network access:

```yaml
Local MCP Tools:
  - file_read: Read files from the app sandbox
  - file_write: Write files to the app sandbox
  - clipboard: Read/write system clipboard
  - calendar: Query local calendar events (with permission)
  - contacts: Search local contacts (with permission)
  - location: Get current GPS coordinates (with permission)
  - camera: Capture photo/video (with permission)
  - sensor: Read device sensors (accelerometer, gyroscope, etc.)
```

Tools are permission-gated by the host application. The Edge runtime never accesses device capabilities without explicit SDK-level authorization.

### Cloud Fallback

When a task exceeds the on-device model's capability, Edge transparently falls back to cloud inference:

```
User Request
  --> Local inference attempt
  --> If confidence < threshold OR context > local_max:
      --> Forward to Hanzo Gateway (HIP-0044) --> Engine (HIP-0043)
  --> Cache cloud response locally for future reference
```

Fallback triggers:
- Context length exceeds local `max_context_tokens`
- Model outputs low-confidence tokens (high entropy)
- User explicitly requests a cloud model
- Device is thermally throttled and latency would be unacceptable

### API Specification

Edge exposes an OpenAI-compatible local API for applications that prefer HTTP over native SDK calls:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | Chat completions (streaming via SSE) |
| `/v1/completions` | POST | Text completions |
| `/v1/embeddings` | POST | Text embeddings (when embedding model loaded) |
| `/v1/models` | GET | List loaded models |
| `/health` | GET | Runtime health, model status, memory usage |

The local HTTP server binds to `127.0.0.1` only and is optional (disabled by default on mobile, enabled on embedded/desktop).

### Prometheus Metrics

Metrics exported on the local health endpoint with namespace `hanzo_edge`:

| Metric | Type | Description |
|--------|------|-------------|
| `hanzo_edge_tokens_generated_total` | Counter | Total output tokens |
| `hanzo_edge_inference_duration_seconds` | Histogram | Per-request latency |
| `hanzo_edge_time_to_first_token_seconds` | Histogram | TTFT distribution |
| `hanzo_edge_tokens_per_second` | Gauge | Current throughput |
| `hanzo_edge_memory_used_bytes` | Gauge | Current memory usage |
| `hanzo_edge_gpu_utilization` | Gauge | GPU utilization (0-1) |
| `hanzo_edge_thermal_state` | Gauge | Device thermal state (0=nominal, 3=critical) |
| `hanzo_edge_cloud_fallback_total` | Counter | Cloud fallback invocations |
| `hanzo_edge_model_load_duration_seconds` | Histogram | Model loading time |

### Performance Targets

Benchmarks on target hardware with zen3-nano (4B, AFQ-4):

| Device | TTFT | Tokens/sec | Memory | Battery Impact |
|--------|------|-----------|--------|---------------|
| iPhone 15 Pro (A17 Pro, Metal) | 120ms | 28 | 2.8 GB | ~15% per hour continuous |
| Pixel 8 Pro (Tensor G3, Vulkan) | 180ms | 18 | 2.9 GB | ~20% per hour continuous |
| MacBook Pro M3 (Metal) | 45ms | 52 | 2.7 GB | N/A |
| Chrome (WebGPU, M3 Mac) | 200ms | 15 | 2.0 GB | N/A |
| Raspberry Pi 5 (CPU, NEON) | 800ms | 4 | 2.8 GB | N/A |

Benchmarks with zen4-mini (8B, AFQ-4):

| Device | TTFT | Tokens/sec | Memory |
|--------|------|-----------|--------|
| iPhone 15 Pro (A17 Pro, Metal) | 250ms | 14 | 5.4 GB |
| Pixel 8 Pro (Tensor G3, Vulkan) | 380ms | 9 | 5.5 GB |
| MacBook Pro M3 (Metal) | 90ms | 32 | 5.3 GB |

s verified on download. The update pipeline uses certificate pinning to prevent MITM attacks on model distribution.

## Relationship to Other HIPs

| HIP | Relationship |
|-----|-------------|
| **HIP-19** (Tensor Operations) | Edge is built on the same Candle ML framework. Tensor ops are shared. |
| **HIP-43** (Engine) | Engine is the cloud counterpart. Shared model format, shared quantization pipeline, shared `ModelPipeline` trait. Edge targets on-device; Engine targets datacenter. |
| **HIP-44** (Gateway) | Edge uses Gateway for cloud fallback when local inference is insufficient. |
| **HIP-4** (LLM Gateway) | Cloud fallback requests route through LLM Gateway for provider selection. |
| **HIP-10** (MCP) | Edge implements local MCP for on-device tool use. |
| **HIP-32** (Object Storage) | Models are downloaded from Hanzo Object Storage. |
| **HIP-39** (Zen Architecture) | Edge serves Zen models (zen3-nano, zen4-mini, zen3-guard, zen3-embedding). |

## References

1. [Hanzo Edge Repository](https://github.com/hanzoai/edge)
2. [Hanzo Engine (HIP-0043)](./hip-0043-llm-inference-engine-standard.md)
3. [Hanzo ML Framework (Candle)](https://github.com/hanzoai/ml)
4. [Metal Performance Shaders](https://developer.apple.com/documentation/metalperformanceshaders)
5. [Vulkan Compute](https://www.khronos.org/vulkan/)
6. [WebGPU Specification](https://www.w3.org/TR/webgpu/)
7. [WASM SIMD](https://github.com/WebAssembly/simd)
8. [AWQ: Activation-aware Weight Quantization](https://arxiv.org/abs/2306.00978)
9. [GPTQ: Accurate Post-Training Quantization](https://arxiv.org/abs/2210.17323)
10. [HIP-0039: Zen Model Architecture](./hip-0039-zen-model-architecture.md)
11. HIP-0044: Hanzo Gateway Standard
12. [HIP-0010: MCP Integration Standards](./hip-0010-model-context-protocol-mcp-integration-standards.md)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
