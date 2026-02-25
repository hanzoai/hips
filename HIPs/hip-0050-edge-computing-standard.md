---
hip: 0050
title: Hanzo Edge — Edge AI Runtime Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Active
created: 2026-02-23
updated: 2026-02-24
requires: HIP-0019, HIP-0043
---

# HIP-50: Hanzo Edge — Edge AI Runtime Standard

## Abstract

This proposal defines Hanzo Edge, the on-device AI inference runtime for mobile, web, and embedded platforms. Edge is the lightweight counterpart to Hanzo Engine (HIP-0043): where Engine runs on cloud/datacenter GPUs, Edge runs on end-user hardware -- iPhones, Android phones, web browsers, and embedded ARM devices.

Edge is built on the same Rust ML framework (Candle, at `~/work/hanzo/ml`) as Engine. Both share the same model format and quantization pipeline. A model quantized for Engine can be further compressed for Edge deployment. This shared foundation means a single model development workflow produces artifacts for both cloud and on-device inference.

Edge is optimized for small Zen models: zen3-nano (4B parameters) and zen4-mini (8B parameters) at 4-bit quantization. It provides streaming inference within fixed memory budgets, local MCP tool execution, and platform-native SDKs for Swift (iOS), Kotlin (Android), JavaScript/WASM (Web), and Rust (embedded).

**Repository**: [github.com/hanzoai/edge](https://github.com/hanzoai/edge) (Rust, built on Engine + ML)
**ML Framework**: [github.com/hanzoai/ml](https://github.com/hanzoai/ml) (Candle, Rust)
**Engine**: [github.com/hanzoai/engine](https://github.com/hanzoai/engine) (cloud counterpart)
**Target Models**: zen3-nano (4B), zen4-mini (8B), zen3-embedding, zen3-guard
**Binary**: `hanzo-edge`

## Motivation

### The On-Device Inference Problem

Cloud inference works well when the user has a reliable, low-latency network connection. But many critical use cases cannot depend on network availability:

1. **Offline operation**: A field technician using an AI assistant in a factory with no cell signal. A soldier operating in a communications-denied environment. A developer on an airplane.

2. **Privacy-sensitive workloads**: Medical data that cannot leave a hospital's network. Legal documents that cannot be sent to third-party servers. Personal conversations that users do not want processed in the cloud.

3. **Latency-critical interaction**: Voice assistants that must respond in <200ms. Real-time code completion in an IDE. Augmented reality overlays that must track in real-time.

4. **Cost at scale**: An app with 10 million daily active users making 10 inference calls each costs $1M+/month at cloud inference prices. On-device inference is free after the initial model download.

5. **Regulatory requirements**: GDPR data residency rules, HIPAA requirements for protected health information, government classified data handling -- all scenarios where data must not leave the device.

### Why Not Just Use llama.cpp or ONNX Runtime

Existing on-device inference solutions have significant limitations:

**llama.cpp** is the most popular on-device LLM runtime. It is C/C++, which means manual memory management, platform-specific build systems, and no memory safety guarantees. Integrating llama.cpp into an iOS or Android app requires maintaining C/C++ FFI bindings, which are fragile and platform-specific. Its model format (GGUF) is optimized for desktop CPU inference, not for mobile GPU accelerators.

**ONNX Runtime** supports mobile deployment but is designed for traditional ML models (classification, detection, embeddings), not autoregressive LLM inference. It lacks KV cache management, continuous generation, and the streaming token output that LLM applications require.

**Core ML / TensorFlow Lite** are platform-locked. A model deployed on Core ML does not run on Android. A TFLite model does not run in a web browser. Each platform requires a separate model conversion, optimization, and testing pipeline.

Hanzo Edge solves all three problems by building on the same Rust ML framework (Candle) used by Engine. Rust compiles to all target platforms (iOS, Android, WASM, ARM Linux) from a single codebase. The `ModelPipeline` trait from Engine is reused directly. Platform-specific GPU acceleration (Metal on iOS, Vulkan on Android, WebGPU in browsers) is implemented behind a unified backend interface.

### Relationship to Engine

Engine and Edge are two deployment targets from the same codebase:

```
                    Hanzo ML Framework (Candle)
                    ~/work/hanzo/ml
                            |
              +-------------+-------------+
              |                           |
       Hanzo Engine                 Hanzo Edge
       (HIP-0043)                  (HIP-0050)
              |                           |
    Cloud/Datacenter GPUs        On-Device Hardware
    CUDA, multi-GPU              Metal, Vulkan, WASM, CPU
    60+ architectures            Small models (4B-8B)
    FP16/FP8/INT4                4-bit quantization (AFQ)
    llm.hanzo.ai                 Local inference
```

The key difference is the optimization target. Engine maximizes throughput per dollar on datacenter GPUs. Edge maximizes quality per watt on consumer hardware with fixed memory budgets.

## Design Philosophy

### Why Rust for On-Device

The same constraints that make Rust ideal for Engine (HIP-0043) -- deterministic memory, no GC, no runtime -- are even more critical on mobile:

1. **Fixed memory budget**: A phone has 4-8GB of RAM shared with the OS and all apps. The edge runtime must guarantee its peak memory usage at model load time. Rust's ownership model makes this possible. A GC-based runtime (Python, Java, JavaScript) cannot make this guarantee.

2. **No runtime dependency**: Edge ships as a static library linked into the host application. No Python interpreter, no JVM, no V8. On iOS, this means a `.framework` bundle. On Android, a `.so` via JNI. On Web, a `.wasm` module.

3. **Cross-compilation**: `cargo build --target aarch64-apple-ios` produces an iOS binary. `cargo build --target aarch64-linux-android` produces an Android binary. `cargo build --target wasm32-unknown-unknown` produces a WASM module. One codebase, four platforms.

4. **GPU backend abstraction**: Rust's trait system allows a `GpuBackend` trait with implementations for Metal (iOS/macOS), Vulkan (Android), WebGPU (browsers), and CPU fallback. The inference pipeline is written once against the trait; GPU-specific code is isolated to backend implementations.

### Why AFQ Quantization for Mobile

Standard quantization formats (GPTQ, AWQ, GGUF) are optimized for desktop/server hardware with wide SIMD units and large caches. Mobile hardware is different:

- **Apple Neural Engine (ANE)**: Operates on fixed-point arithmetic. INT4 quantized to ANE-aligned block sizes runs 3-5x faster than naive INT4.
- **Qualcomm Hexagon DSP**: Optimized for per-channel quantization with specific alignment requirements.
- **ARM NEON/SVE**: SIMD widths vary by generation; quantization must adapt.

**AFQ (Adaptive Fixed-point Quantization)** is a quantization format designed for these constraints:

| Property | GGUF Q4_K_M | AFQ-4 |
|----------|-------------|-------|
| Block size | 256 | Hardware-aligned (32-256) |
| Scale format | FP16 | FP8 or fixed-point |
| Zero-point | Per-block | Per-channel |
| ANE compatible | No | Yes |
| Vulkan compatible | Partial | Yes |
| WebGPU compatible | No | Yes |
| Quality (perplexity) | Baseline | -0.1 to +0.2 vs baseline |

AFQ models are converted from the same SafeTensors/GGUF weights used by Engine. The conversion pipeline is part of the shared ML framework.

### Why Small Models Are Sufficient

On-device inference targets different tasks than cloud inference:

| Task | Cloud Model | Edge Model | Rationale |
|------|------------|------------|-----------|
| Open-ended conversation | zen4 (744B) | zen4-mini (8B) | Quality matters more than speed |
| Code completion | zen4-coder (480B) | zen3-nano (4B) | Single-line completions, latency-critical |
| Text classification | zen3-guard (4B) | zen3-guard (4B) | Same model, same task |
| Embeddings | zen3-embedding | zen3-embedding | Same model, same task |
| Safety filtering | zen3-guard (4B) | zen3-guard (4B) | Must run locally for privacy |
| Summarization | zen4-pro (80B) | zen4-mini (8B) | Adequate for short documents |

For tasks where the 4B/8B model is insufficient, Edge falls back to cloud inference via Engine (HIP-0043) through the Hanzo Gateway (HIP-0044). The SDK handles this transparently: try local, fall back to cloud, cache the result locally.

## Specification

### Architecture

```
+------------------------------------------+
|            Host Application               |
|  (iOS App / Android App / Web App / CLI)  |
+------------------------------------------+
|         Platform SDK Layer                |
|  Swift / Kotlin / JS-WASM / Rust          |
+------------------------------------------+
|         Hanzo Edge Core (Rust)            |
|  +----------+  +----------+  +---------+ |
|  | Model    |  | Inference|  | MCP     | |
|  | Loader   |  | Pipeline |  | Client  | |
|  +----------+  +----------+  +---------+ |
|  +----------+  +----------+  +---------+ |
|  | KV Cache |  | Sampler  |  | Cloud   | |
|  | Manager  |  |          |  | Fallback| |
|  +----------+  +----------+  +---------+ |
+------------------------------------------+
|         GPU Backend Abstraction           |
|  Metal / Vulkan / WebGPU / CPU            |
+------------------------------------------+
|         Hanzo ML (Candle)                 |
|  Tensor ops, GPU kernels, BLAS            |
+------------------------------------------+
```

### Supported Platforms

| Platform | GPU Backend | Quantization | Memory Budget | SDK |
|----------|------------|--------------|---------------|-----|
| iOS 17+ | Metal (+ ANE) | AFQ-4, AFQ-8 | 2-4 GB | Swift |
| Android 12+ | Vulkan / CPU | AFQ-4, GGUF Q4 | 2-4 GB | Kotlin (JNI) |
| Web (modern browsers) | WebGPU / WASM SIMD | AFQ-4 | 2 GB | JavaScript/TypeScript |
| Embedded (ARM64 Linux) | CPU (NEON/SVE) | GGUF Q4, AFQ-4 | 512 MB - 4 GB | Rust |
| macOS 14+ | Metal | AFQ-4, AFQ-8 | 4-8 GB | Swift / Rust |

### Model Registry

Edge supports a curated subset of Zen models optimized for on-device deployment:

| Model | Params | Quantized Size | Min Memory | Tasks |
|-------|--------|----------------|------------|-------|
| zen3-nano | 4B | 2.3 GB (AFQ-4) | 3 GB | Chat, code, summarization |
| zen4-mini | 8B | 4.5 GB (AFQ-4) | 6 GB | Chat, code, reasoning |
| zen3-guard | 4B | 2.3 GB (AFQ-4) | 3 GB | Safety classification |
| zen3-embedding | 0.3B | 350 MB (FP16) | 512 MB | Text embeddings (3072 dim) |

Models are downloaded from Hanzo Object Storage (HIP-0032) on first use and cached on device. Incremental updates (LoRA patches) are supported to avoid full re-downloads.

### Inference Pipeline

The on-device inference pipeline follows the same six stages as Engine (HIP-0043), with mobile-specific optimizations:

```
Input → Tokenize → KV Cache Alloc → Prefill → Decode → Sample → Output
                        |                |         |
                   Fixed budget     GPU accel   Streaming
                   (pre-allocated)  (Metal/     (token-by-
                                    Vulkan/     token callback)
                                    WebGPU)
```

**Key differences from Engine:**

1. **Fixed memory budget**: KV cache is pre-allocated at model load time based on a configured `max_context_tokens`. No dynamic allocation during inference. If the context exceeds the budget, older tokens are evicted (sliding window) rather than OOM-killing the process.

2. **Single-sequence optimization**: Mobile typically runs one inference at a time. The pipeline is optimized for single-sequence throughput rather than batch throughput.

3. **Power-aware scheduling**: On battery-powered devices, the pipeline monitors thermal state and reduces batch size or switches to CPU fallback when the device is throttling.

### Memory Management

```yaml
Memory Budget Calculation (zen3-nano, AFQ-4, 4K context):
  Model Weights: 2.3 GB (4B params * 4 bits / 8 + overhead)
  KV Cache: 256 MB (32 layers * 2 * 32 heads * 128 dim * 4096 tokens * 2 bytes)
  Scratch: 128 MB (activation buffers, temporary tensors)
  Total: ~2.7 GB

  Fits in: iPhone 15 (6GB), Pixel 8 (8GB), modern web browser (2GB WASM limit)

Memory Budget Calculation (zen4-mini, AFQ-4, 4K context):
  Model Weights: 4.5 GB (8B params * 4 bits / 8 + overhead)
  KV Cache: 512 MB (64 layers * 2 * 32 heads * 128 dim * 4096 tokens * 2 bytes)
  Scratch: 256 MB (activation buffers, temporary tensors)
  Total: ~5.3 GB

  Fits in: iPhone 15 Pro (8GB), Pixel 8 Pro (12GB), high-end tablets
```

The runtime enforces a hard memory ceiling. If the configured `max_memory_bytes` is exceeded during model loading, the load fails with a clear error rather than triggering an OS-level kill.

### Platform SDKs

#### Swift SDK (iOS/macOS)

```swift
import HanzoEdge

let edge = try HanzoEdge(
    model: .zen3Nano,
    quantization: .afq4,
    maxContextTokens: 4096,
    maxMemoryBytes: 3 * 1024 * 1024 * 1024  // 3 GB
)

// Streaming inference
for try await token in edge.chat([
    .system("You are a helpful assistant."),
    .user("What is the capital of France?")
]) {
    print(token, terminator: "")
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

## Implementation Roadmap

### Phase 1: Core Runtime (Q1 2026)
- Rust core with CPU backend (NEON/SSE)
- zen3-nano and zen3-embedding model loading (GGUF, SafeTensors)
- OpenAI-compatible local HTTP API
- Basic streaming inference with fixed memory budget
- macOS/Linux desktop builds

### Phase 2: Mobile SDKs (Q2 2026)
- Metal backend for iOS/macOS
- Swift SDK with async/await streaming
- Vulkan backend for Android
- Kotlin SDK with coroutine-based streaming
- AFQ quantization format support
- Model download and caching from Hanzo Object Storage

### Phase 3: Web and Embedded (Q2 2026)
- WASM build with WebGPU backend
- JavaScript/TypeScript SDK (`@hanzo/edge`)
- Embedded ARM64 Linux builds (Raspberry Pi, Jetson)
- Rust SDK for embedded integration

### Phase 4: Advanced Features (Q3 2026)
- Local MCP tool execution
- Cloud fallback with transparent routing
- zen4-mini (8B) support on high-memory devices
- LoRA adapter loading for fine-tuned models
- Speculative decoding with zen3-embedding as draft model
- Power-aware inference scheduling
- zen3-guard integration for on-device safety filtering

## Security Considerations

### Model Weight Protection

Model weights on device are stored encrypted at rest using platform key storage (iOS Keychain, Android Keystore, Web Crypto API). Weights are decrypted into GPU memory only during inference. The decryption key is bound to the device and cannot be extracted.

### Sandboxed Execution

On mobile platforms, the Edge runtime runs within the host application's sandbox. It has no access to files, network, or sensors beyond what the host application explicitly provides via the SDK.

### Privacy by Design

On-device inference is private by default. No inference data is sent to any server unless:
1. The user explicitly triggers cloud fallback.
2. The application opts into telemetry (disabled by default).
3. The user initiates a model update check.

Telemetry, when enabled, reports only aggregate metrics (tokens/sec, model load time, fallback rate) -- never prompt content or generated text.

### Supply Chain Security

Edge binaries are signed with Hanzo's code signing keys. Model weights are distributed with SHA-256 checksums verified on download. The update pipeline uses certificate pinning to prevent MITM attacks on model distribution.

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
11. [HIP-0044: Hanzo Gateway Standard](./hip-0044-api-gateway-standard.md)
12. [HIP-0010: MCP Integration Standards](./hip-0010-model-context-protocol-mcp-integration-standards.md)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
