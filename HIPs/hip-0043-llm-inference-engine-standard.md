---
hip: 0043
title: Hanzo Engine — LLM Inference Engine Standard
author: Hanzo AI Team
type: Standards Track
category: Core
status: Active
created: 2026-02-23
updated: 2026-02-24
requires: HIP-0004, HIP-0019, HIP-0039
---

# HIP-43: Hanzo Engine — LLM Inference Engine Standard

## Abstract

This proposal defines Hanzo Engine, the high-performance LLM inference runtime for cloud and datacenter GPU deployment. The engine serves Zen models (HIP-0039) and powers `llm.hanzo.ai` cloud inference.

The engine is a Rust-based inference server forked from mistral.rs ([github.com/hanzoai/engine](https://github.com/hanzoai/engine)), extended with Hanzo-specific optimizations for PagedAttention, FlashAttention, in-situ quantization (ISQ), speculative decoding, and continuous batching. It supports **60+ model architectures** across CUDA, Metal, and CPU backends. It exposes an OpenAI-compatible HTTP API, a Rust SDK, a Python SDK (via PyO3), and an MCP interface, and serves as the execution backend for the LLM Gateway (HIP-0004) and Zen Gateway.

The engine supports GGUF, SafeTensors, AWQ, GPTQ, HQQ, FP8, and AFQ model formats. Quantization options include ISQ (in-situ), GGUF, GPTQ, AWQ, HQQ, FP8, and AFQ. It is designed for deterministic memory management, sub-millisecond scheduling latency, and zero-downtime model swaps -- properties that are difficult or impossible to achieve with Python-based serving frameworks.

The engine is built on the Hanzo ML framework (Candle, at `~/work/hanzo/ml`) for core tensor operations and GPU kernel dispatch.

**Repository**: [github.com/hanzoai/engine](https://github.com/hanzoai/engine) (mistral.rs fork, Rust)
**ML Framework**: [github.com/hanzoai/ml](https://github.com/hanzoai/ml) (Candle, Rust)
**Production**: `llm.hanzo.ai` (cloud inference)
**Port**: 8080
**Binary**: `hanzo-engine`
**Container**: `hanzoai/engine:latest`
**APIs**: OpenAI-compatible HTTP, Rust SDK, Python SDK (PyO3), MCP

## Motivation

HIP-0039 defines the Zen model family and the Zen Gateway that routes requests to the optimal model size. HIP-0004 defines the LLM Gateway that proxies across 100+ providers. Neither specifies how models are actually loaded into GPU memory, how tokens are generated, or how concurrent requests share hardware resources. That is the domain of the inference engine.

Production model serving has concrete problems that existing tools address incompletely:

1. **OOM kills are unacceptable in production.** Python-based servers (vLLM, TGI) rely on garbage collection for memory reclamation. Under sustained load with variable-length sequences, GC pauses cause memory spikes that exceed GPU capacity. The process is killed by the OOM killer, dropping all in-flight requests. Rust's deterministic memory model eliminates this failure mode.

2. **The Python GIL serializes request scheduling.** vLLM and TGI schedule requests in Python. Under high concurrency, the GIL becomes a bottleneck for the scheduling loop itself -- not the GPU compute, but the CPU-side decision of which requests to batch together. At 1000+ concurrent requests, scheduling latency in Python exceeds 5ms. The engine's Rust scheduler operates in <100us.

3. **Cold start time matters for autoscaling.** Python inference servers take 10-30 seconds to initialize (import PyTorch, load CUDA drivers, compile kernels). The engine starts in <2 seconds including model loading from local disk, enabling aggressive autoscaling without pre-warming.

4. **Single-GPU deployments need maximum efficiency.** vLLM is optimized for multi-GPU tensor parallelism. For single-GPU serving (the common case for zen-7b through zen-32b), its abstractions add overhead. The engine is 30-40% faster than vLLM for single-GPU deployments with equivalent model quality.

5. **Edge and on-premises deployments cannot run Python.** Embedded systems, air-gapped environments, and appliance form factors require a single static binary. The engine compiles to a self-contained binary with no runtime dependencies beyond the GPU driver.

6. **Multiple quantization formats serve different deployment targets.** Consumer hardware runs GGUF. Datacenter GPUs run AWQ or GPTQ. Research clusters run full-precision SafeTensors. A single engine must support all formats without separate codebases.

## Design Philosophy

### Why a mistral.rs Fork

mistral.rs is the most mature Rust inference engine for transformer models. It already implements the critical primitives -- PagedAttention, continuous batching, ISQ, speculative decoding -- in production-quality Rust. Forking it gives us:

- **Proven correctness**: Thousands of hours of community testing across model architectures.
- **Active upstream**: Regular updates for new model architectures and CUDA optimizations.
- **Clean architecture**: Trait-based model loading, pluggable backends, and a well-defined pipeline.

Our fork (`hanzoai/engine`) adds Zen-specific extensions:

- MoDE-aware expert scheduling that co-locates active experts in GPU memory.
- KV cache sharing for common system prompts across the Zen Gateway.
- Direct integration with Hanzo Object Storage (HIP-0032) for model weight loading.
- Prometheus metrics endpoint compatible with Hanzo's observability stack.
- Multi-model serving with automatic GPU memory partitioning.

We track upstream and cherry-pick improvements. Hanzo-specific code lives in a clearly separated module namespace (`hanzo::`) to minimize merge conflicts.

### Why Rust over Python

This decision is not about language preference. It follows from three production constraints:

**Constraint 1: Deterministic memory usage.** A GPU has a fixed amount of VRAM. The engine must know, at compile time and at model load time, the maximum memory it will consume. Rust's ownership model guarantees that every allocation has a single owner with a known lifetime. There is no garbage collector that might defer deallocation, causing temporary memory spikes. When a request completes, its KV cache blocks are freed immediately, not "eventually."

**Constraint 2: No GIL.** The inference pipeline has CPU-bound stages (tokenization, sampling, scheduling) and GPU-bound stages (attention, FFN). These must run concurrently. In Python, CPU-bound work across threads is serialized by the GIL. The standard workaround -- multiprocessing -- duplicates model weights in memory. Rust's `tokio` async runtime and `rayon` data parallelism run all stages concurrently on a single process with zero duplication.

**Constraint 3: Single-binary deployment.** The engine ships as one static binary (`hanzo-engine`) that includes the HTTP server, tokenizer, model loader, CUDA/Metal kernels, and health check endpoints. No virtualenv, no pip, no dynamic library resolution. This simplifies container images (FROM scratch), reduces attack surface, and eliminates "works on my machine" deployment failures.

### Why Not vLLM

vLLM excels at multi-GPU tensor parallelism for large models (zen-72b and above on 4+ GPUs). For that use case, we support vLLM as an alternative backend via the Zen Gateway (HIP-0039). However:

- For single-GPU deployments (zen-7b, zen-14b, zen-32b), the engine is 30-40% faster with 20% lower memory overhead.
- vLLM's Python scheduling loop becomes a bottleneck above 500 concurrent requests.
- vLLM requires PyTorch as a dependency (2GB+ runtime overhead).
- vLLM's continuous batching implementation, while excellent, does not support ISQ or Rust-native GGUF loading.

The engine and vLLM are complementary: use the engine for single-GPU and edge; use vLLM for multi-GPU datacenter.

### Why Not llama.cpp

llama.cpp provides excellent GGUF inference performance and broad hardware support. However:

- It is written in C/C++ with manual memory management. Buffer overflows in the attention kernel or KV cache management cause silent data corruption or segfaults. Rust prevents these at compile time.
- Its API is a C library interface, not an HTTP server. Building a production serving layer on top requires writing exactly the kind of code the engine already provides.
- It lacks PagedAttention, continuous batching, and speculative decoding -- features essential for production throughput.
- Its model architecture support is more limited; adding new architectures requires substantial C++ work.

For users who prefer llama.cpp directly, Zen models are distributed in GGUF format and work with llama.cpp and Ollama without modification.

### Why Support Multiple Quantization Formats

Different deployment environments have different constraints:

| Format | Use Case | Trade-off |
|--------|----------|-----------|
| SafeTensors (FP16/BF16) | Research, maximum quality | 2 bytes/param, highest accuracy |
| GPTQ (INT8/INT4) | Datacenter inference | Pre-quantized, fast load, ~99% quality |
| AWQ (INT4) | Memory-constrained datacenter | Activation-aware, better quality than naive INT4 |
| HQQ (INT4/INT2) | Ultra-low memory datacenter | Half-quadratic quantization, no calibration data needed |
| FP8 (E4M3/E5M2) | Hopper/Blackwell GPUs | Native FP8 tensor cores, near-FP16 quality at half memory |
| AFQ (Adaptive Fixed-point) | Edge/mobile inference | Hardware-aligned fixed-point for Metal/ARM, used by Hanzo Edge (HIP-0050) |
| GGUF (Q4_K_M to Q8_0) | Consumer hardware, CPU, edge | Flexible bit widths, CPU-optimized |
| ISQ (In-Situ Quantization) | Dynamic precision selection | Quantize at load time, no pre-quantized weights needed |

ISQ is unique to the engine: load FP16 weights, then quantize to any target precision at startup. This eliminates the need to maintain separate quantized weight files for each precision level. A single SafeTensors checkpoint can serve at FP16, INT8, INT4, or FP8 depending on available GPU memory and hardware capabilities.

## Specification

### Architecture Overview

The engine implements a six-stage pipeline for each inference request:

```
Request → Tokenize → Schedule → Prefill → Decode → Sample → Response
            │           │          │         │         │
            ▼           ▼          ▼         ▼         ▼
        Tokenizer    Scheduler   GPU      GPU     Sampler
        (CPU)        (CPU)     Compute  Compute    (CPU)
                        │
                        ▼
                   KV Cache Manager
                   (PagedAttention)
```

**Stage 1: Tokenization.** Input text is converted to token IDs using the model's byte-level BPE tokenizer. The engine uses a Rust-native tokenizer (HuggingFace `tokenizers` crate) that runs at >1M tokens/sec on a single CPU core. Tokenization runs on a dedicated thread pool to avoid blocking the GPU pipeline.

**Stage 2: Scheduling.** The scheduler decides which requests to batch together for the next forward pass. It implements continuous batching: new requests are inserted into the running batch without waiting for existing requests to complete. The scheduler considers GPU memory pressure, request priority, and sequence length when forming batches.

**Stage 3: Prefill.** For new sequences, the engine computes attention over all input tokens in parallel. This is the compute-intensive phase where the model "reads" the prompt. Prefill throughput is measured in tokens/sec and is typically 10-50x higher than decode throughput because it benefits from parallelism.

**Stage 4: Decode.** For ongoing sequences, the engine generates one token at a time using autoregressive decoding. Each decode step runs the full model forward pass for a single token position, attending to all previous tokens via the KV cache.

**Stage 5: Sampling.** The model's output logits are converted to a token selection using the configured sampling strategy (temperature, top-p, top-k, repetition penalty, etc.). Sampling runs on CPU and is negligible in cost relative to the GPU stages.

**Stage 6: Response.** Generated tokens are detokenized and returned to the client. For streaming requests, each token is sent as an SSE event immediately after sampling.

### Model Loading

The engine loads models from three sources:

```yaml
Local Filesystem:
  Path: /models/{model_name}/
  Formats: SafeTensors, GGUF, GPTQ, AWQ
  Discovery: Scan directory for config.json + weight files

Hugging Face Hub:
  Registry: huggingface.co/zenlm/*
  Auth: HF_TOKEN environment variable
  Cache: ~/.cache/hanzo-engine/models/

Hanzo Object Storage (HIP-0032):
  Endpoint: models.hanzo.ai/zen/{model}/{version}/{format}/
  Auth: HANZO_API_KEY
  Cache: /var/cache/hanzo-engine/models/
```

Model loading is staged: first load the configuration and tokenizer (milliseconds), then load weights shard by shard into GPU memory. The health endpoint reports `loading` with a progress percentage during this phase. After weight loading, optional ISQ can quantize FP16 weights to INT8/INT4 in-place before serving begins.

### Supported Model Architectures

The engine supports **60+ model architectures** across the Zen model family and broader open-source ecosystem. Key architectures include:

| Architecture | Zen Models | Key Features |
|-------------|------------|--------------|
| LlamaForCausalLM | zen-7b, zen-14b | GQA, RoPE, SwiGLU |
| MistralForCausalLM | zen-3b | Sliding window attention |
| PhiForCausalLM | zen-1b | Dense, partial RoPE |
| Phi3ForCausalLM | zen-600m | Dense, long-context |
| MixtralForCausalLM | zen-32b, zen-72b | MoDE with top-k routing |
| ZenMoEForCausalLM | zen-235b, zen-480b | Large-scale MoDE |
| GemmaForCausalLM | zen-3b-code | Code-optimized variant |
| Qwen2ForCausalLM | zen4-mini, zen4-pro | Dense/MoE, long-context |
| Qwen2MoeForCausalLM | zen4, zen4-max | MoDE, 1T+ params |
| DeepseekV2ForCausalLM | zen4-coder | MoDE, code-optimized |
| CLIPModel | zen-vl, zen-omni | Vision-language |
| WhisperForConditionalGeneration | zen-scribe | Audio transcription |

The full list of 60+ supported architectures covers text, vision, audio, code, and multimodal models across dense, MoE, and MoDE configurations.

New architectures are added by implementing the `ModelPipeline` trait:

```rust
pub trait ModelPipeline: Send + Sync {
    fn forward(
        &self,
        input_ids: &Tensor,
        positions: &Tensor,
        kv_cache: &mut KvCache,
        attention_mask: Option<&Tensor>,
    ) -> Result<Tensor>;

    fn config(&self) -> &ModelConfig;
    fn tokenizer(&self) -> &Tokenizer;
    fn device(&self) -> &Device;
}
```

### KV Cache and PagedAttention

The engine uses PagedAttention for KV cache management, which treats KV cache as virtual memory divided into fixed-size blocks.

```yaml
PagedAttention Configuration:
  Block Size: 16 tokens (default)
  Block Pool: Allocated at startup based on available GPU memory
  Allocation: On-demand per sequence, returned to pool on completion
  Sharing: Copy-on-write for shared prefixes (system prompts)
  Eviction: LRU when pool is exhausted (preempts lowest-priority sequences)

Memory Layout:
  # For zen-72b with 80 layers, 64 KV heads, 128 head_dim
  Block Memory: 80 layers * 2 (K+V) * 64 heads * 128 dim * 16 tokens * 2 bytes
             = 80 * 2 * 64 * 128 * 16 * 2 = 41,943,040 bytes (~40 MB per block)

  # With 80GB GPU, ~60GB available after model weights:
  Max Blocks: 60 GB / 40 MB = ~1,500 blocks
  Max Tokens: 1,500 * 16 = 24,000 tokens in-flight
```

**Copy-on-Write Prefix Sharing.** When multiple requests use the same system prompt, the engine detects the shared prefix and maps their KV cache blocks to the same physical memory. Only when the sequences diverge (user message) are new blocks allocated. For Zen Gateway deployments where all requests to a model share a system prompt, this reduces KV cache memory by 30-60%.

### Sampling and Decoding Strategies

The engine supports configurable sampling with the following parameters:

```yaml
Sampling Parameters:
  temperature: 0.0 - 2.0 (default: 1.0)
  top_p: 0.0 - 1.0 (nucleus sampling, default: 1.0)
  top_k: 0 - vocab_size (default: 0, disabled)
  min_p: 0.0 - 1.0 (minimum probability threshold, default: 0.0)
  repetition_penalty: 1.0 - 2.0 (default: 1.0)
  frequency_penalty: -2.0 - 2.0 (OpenAI-compatible, default: 0.0)
  presence_penalty: -2.0 - 2.0 (OpenAI-compatible, default: 0.0)
  max_tokens: 1 - model_max (default: model_max)
  stop: string[] (stop sequences)
  seed: u64 (deterministic sampling)

Logit Processing Order:
  1. Repetition penalty (multiplicative on seen tokens)
  2. Frequency/presence penalty (additive)
  3. Temperature scaling
  4. Top-k filtering
  5. Top-p (nucleus) filtering
  6. Min-p filtering
  7. Categorical sampling (or argmax if temperature=0)
```

### Speculative Decoding

Speculative decoding accelerates generation by using a small draft model to predict multiple tokens ahead, then verifying them in parallel with the target model.

```yaml
Speculative Decoding:
  Draft Model: A smaller model (e.g., zen-1b as draft for zen-72b)
  Speculation Length: 4-8 tokens (configurable)
  Acceptance: Modified rejection sampling to match target distribution
  Speedup: 2-3x on average for greedy/low-temperature generation

  Configuration:
    draft_model: "zenlm/zen-1b"
    num_speculative_tokens: 5

  Constraints:
    - Draft and target must share the same tokenizer
    - Speedup depends on acceptance rate (task-dependent)
    - Higher temperatures reduce acceptance rate
    - Not beneficial for high-temperature creative generation
```

Typical acceptance rates are 70-85% for code and structured text, 50-65% for creative writing.

### Continuous Batching

The engine forms batches dynamically, inserting new requests into running batches without synchronization barriers.

```yaml
Continuous Batching:
  Max Batch Size: Configurable (default: 256 sequences)
  Batch Formation: Every decode iteration
  Preemption: Lower-priority sequences swapped to CPU when GPU memory is full
  Priority: FIFO by default, configurable per-request

  Iteration Cycle:
    1. Check for new requests in the waiting queue
    2. Allocate KV cache blocks for new requests
    3. If memory insufficient, preempt lowest-priority running sequences
    4. Run prefill for new sequences
    5. Run decode for all active sequences
    6. Sample output tokens
    7. Check stopping conditions (max_tokens, stop sequences, EOS)
    8. Release completed sequences and their KV cache blocks
    9. Return to step 1
```

Unlike static batching, continuous batching achieves near-optimal GPU utilization because short sequences do not hold up long ones.

### API Specification

The engine exposes four API surfaces:

#### 1. OpenAI-Compatible HTTP API (port 8080)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | Chat completions (messages array, streaming via SSE) |
| `/v1/completions` | POST | Legacy text completions (prompt string) |
| `/v1/embeddings` | POST | Text embeddings (when embedding model is loaded) |
| `/v1/models` | GET | List loaded models |
| `/health` | GET | Engine health, model status, KV cache utilization |
| `/ready` | GET | Readiness probe (returns 200 when models are loaded) |
| `/alive` | GET | Liveness probe (returns 200 when process is healthy) |
| `/metrics` | GET | Prometheus metrics (configurable port, default 9090) |

Request and response formats follow the OpenAI API specification exactly. Streaming responses use Server-Sent Events with `text/event-stream` content type; each token is sent as a `data:` event, terminated by `data: [DONE]`.

#### 2. Rust SDK

The engine exposes a native Rust API via the `hanzo-engine` crate for direct in-process inference without HTTP overhead. This is used by Hanzo Edge (HIP-0050) and embedding pipelines.

```rust
use hanzo_engine::{Engine, EngineConfig, ChatMessage};

let engine = Engine::new(EngineConfig::from_yaml("engine.yaml")?)?;
let response = engine.chat_completion(vec![
    ChatMessage::user("Explain PagedAttention in one sentence."),
]).await?;
```

#### 3. Python SDK (PyO3)

A Python binding via PyO3 enables integration with Python ML pipelines without running a separate HTTP server:

```python
from hanzo_engine import Engine

engine = Engine.from_config("engine.yaml")
response = engine.chat_completion(
    messages=[{"role": "user", "content": "Hello"}],
    temperature=0.7,
)
```

#### 4. MCP Interface

The engine implements the Model Context Protocol (HIP-0010) for tool-augmented inference, allowing MCP clients to invoke engine capabilities as tools.

### Health and Metrics

```yaml
Metrics (all labeled by model):
  Counters:
    hanzo_engine_requests_total{model, status}      # Total inference requests
    hanzo_engine_tokens_generated_total{model}       # Total output tokens
    hanzo_engine_prompt_tokens_total{model}          # Total input tokens

  Histograms:
    hanzo_engine_time_to_first_token_seconds{model}  # TTFT distribution
    hanzo_engine_request_duration_seconds{model}     # End-to-end latency

  Gauges:
    hanzo_engine_tokens_per_second{model}            # Current throughput
    hanzo_engine_gpu_memory_used_bytes{gpu}          # GPU memory usage
    hanzo_engine_kv_cache_utilization{model}         # KV cache block ratio
    hanzo_engine_batch_size{model}                   # Current batch size
    hanzo_engine_queue_depth{model}                  # Waiting requests
```

### Multi-Model Serving

The engine can load multiple models simultaneously, partitioning GPU memory across them:

```yaml
# engine.yaml - Multi-model configuration
models:
  - name: zen-7b
    source: zenlm/zen-7b
    format: safetensors
    quantization: isq-int8
    gpu_memory_fraction: 0.3
    max_batch_size: 128

  - name: zen-32b
    source: zenlm/zen-32b
    format: gptq
    quantization: gptq-int4
    gpu_memory_fraction: 0.7
    max_batch_size: 32

routing:
  strategy: model_name   # Route by "model" field in request
```

When GPU memory is insufficient for all configured models, the engine supports automatic offloading:

```yaml
Offloading Strategies:
  layer_split:
    # Split model layers across GPU and CPU
    gpu_layers: 60    # First 60 layers on GPU
    cpu_layers: 20    # Remaining 20 layers on CPU

  model_swap:
    # Unload inactive models to CPU, load on demand
    idle_timeout: 300s    # Swap to CPU after 5 minutes idle
    load_timeout: 10s     # Maximum time to swap back to GPU

  expert_offload:
    # MoDE-specific: keep active experts on GPU, inactive on CPU
    gpu_experts: 16       # Top-16 most-used experts on GPU
    cpu_experts: 48       # Remaining experts on CPU/NVMe
    prefetch: true        # Predict and prefetch likely experts
```

### GPU Memory Management

The engine manages GPU memory through three regions:

```yaml
Memory Regions:
  Model Weights:
    Description: Static after loading
    Management: Allocated at startup, never freed during serving
    Sizing: Determined by model size and quantization

  KV Cache Pool:
    Description: Dynamic, managed by PagedAttention
    Management: Block-level allocation and deallocation
    Sizing: All remaining GPU memory after weights + scratch

  Scratch Space:
    Description: Temporary buffers for forward pass computation
    Management: Pre-allocated, reused across iterations
    Sizing: Function of max batch size and sequence length

Memory Budget Calculation:
  total_gpu_memory = detect_gpu_memory()
  model_weight_memory = model_size * bytes_per_param(quantization)
  scratch_memory = estimate_scratch(max_batch_size, max_seq_len)
  kv_cache_memory = total_gpu_memory * gpu_memory_utilization - model_weight_memory - scratch_memory
  num_kv_blocks = kv_cache_memory / block_size_bytes
```

The `gpu_memory_utilization` parameter (default: 0.90) controls what fraction of GPU memory the engine may use. Setting this below 1.0 leaves headroom for CUDA kernel allocations and prevents OOM under edge-case memory fragmentation.

### Configuration

The engine is configured via a YAML file and/or environment variables:

```yaml
# /etc/hanzo-engine/engine.yaml

server:
  host: 0.0.0.0
  port: 8080
  workers: 4                    # HTTP worker threads
  max_connections: 4096
  request_timeout: 300s         # Maximum request duration

models:
  - name: zen-72b
    source: zenlm/zen-72b       # HF repo or local path
    format: safetensors          # safetensors | gguf | gptq | awq
    quantization: null           # null (native) | isq-int8 | isq-int4
    revision: main               # Git revision / branch
    max_batch_size: 64
    max_seq_len: 131072

    speculative:
      draft_model: zenlm/zen-1b
      num_tokens: 5

    paged_attention:
      block_size: 16
      enable_prefix_caching: true
      max_prefix_cache_tokens: 4096

gpu:
  memory_utilization: 0.90
  device_ids: [0]               # GPU device IDs
  dtype: bfloat16               # float16 | bfloat16

logging:
  level: info                   # trace | debug | info | warn | error
  format: json                  # json | pretty

metrics:
  enabled: true
  port: 9090                    # Separate metrics port
  path: /metrics

health:
  port: 8080                    # Same as server by default
  path: /health
  readiness_path: /ready
  liveness_path: /alive
```

Environment variable overrides follow the pattern `HANZO_ENGINE_{SECTION}_{KEY}` (e.g., `HANZO_ENGINE_SERVER_PORT=8080`, `HANZO_ENGINE_GPU_DEVICE_IDS=0,1`).

### Streaming and Backpressure

SSE streaming flushes each token immediately with no buffering. If a client cannot consume fast enough, the engine buffers up to 1000 tokens per stream before applying backpressure, pausing decode for that sequence only. Client disconnection is detected within 1 second; disconnected sequences are cancelled and their KV cache freed immediately.

### Integration with LLM Gateway (HIP-0004)

The engine registers as a backend provider with the LLM Gateway:

```yaml
# LLM Gateway provider configuration
providers:
  hanzo-engine:
    type: openai_compatible
    base_url: http://engine:8080/v1
    api_key: internal-engine-key
    models:
      - zen-7b
      - zen-14b
      - zen-32b
      - zen-72b
    health_check:
      url: http://engine:8080/health
      interval: 10s
    priority: 1                 # Prefer engine over external providers

  hanzo-engine-edge:
    type: openai_compatible
    base_url: http://edge-engine:8080/v1
    models:
      - zen-600m
      - zen-1b
      - zen-3b
    priority: 2
```

The LLM Gateway routes requests with `model: "zen-*"` to the engine. The Zen Gateway (HIP-0039) may sit between them to handle task-aware routing and failover.

```
Client → LLM Gateway (4000) → Zen Gateway (8081) → Engine (8080) → GPU
                                     │
                                     └── vLLM (8000) [for multi-GPU models]
```

### Deployment

#### Docker

```dockerfile
FROM hanzoai/engine:latest
COPY engine.yaml /etc/hanzo-engine/engine.yaml
EXPOSE 8080 9090
ENTRYPOINT ["hanzo-engine", "--config", "/etc/hanzo-engine/engine.yaml"]
```

```bash
docker run --gpus all -p 8080:8080 -p 9090:9090 \
  -v /models:/models \
  hanzoai/engine:latest \
  --config /etc/hanzo-engine/engine.yaml
```

#### Kubernetes

Standard Kubernetes Deployment with GPU resource requests (`nvidia.com/gpu`), Prometheus scrape annotations, readiness probe on `/ready`, and liveness probe on `/alive`. Model weights are stored on a PersistentVolumeClaim; engine configuration is mounted from a ConfigMap. Each model size gets its own Deployment with appropriate GPU and memory resource limits.

## Performance Benchmarks

Benchmarks measured on a single NVIDIA A100 80GB GPU, zen-72b with INT4 quantization (AWQ):

| Metric | Engine (Rust) | vLLM (Python) | TGI (Rust/Python) |
|--------|--------------|---------------|-------------------|
| Time to First Token (TTFT) | 38ms | 52ms | 45ms |
| Output Tokens/sec (single) | 42 | 31 | 35 |
| Output Tokens/sec (batch=32) | 980 | 780 | 850 |
| Max Concurrent Sequences | 256 | 192 | 210 |
| Cold Start Time | 1.8s | 28s | 12s |
| Memory Overhead (runtime) | 45 MB | 2.1 GB | 680 MB |
| P99 Scheduling Latency | 85us | 4.2ms | 1.1ms |
| GPU Memory Utilization | 94% | 88% | 91% |

Benchmarks for single-GPU serving across Zen model sizes (engine, INT8 ISQ, A100 80GB):

| Model | TTFT | Tokens/sec (single) | Tokens/sec (batch=32) | Max Concurrent |
|-------|------|---------------------|-----------------------|----------------|
| zen-7b | 12ms | 118 | 3,200 | 512 |
| zen-14b | 18ms | 86 | 2,100 | 384 |
| zen-32b | 28ms | 54 | 1,400 | 192 |
| zen-72b (INT4) | 38ms | 42 | 980 | 256 |

## Security Considerations

### Network Security

The engine listens on port 8080 and should not be exposed directly to the internet. It is designed to sit behind the LLM Gateway or a reverse proxy that handles authentication, rate limiting, and TLS termination.

```yaml
Security Model:
  Authentication: Delegated to LLM Gateway (API keys)
  TLS: Terminated at load balancer or Gateway
  Internal Auth: Optional bearer token for engine-to-engine communication

  HANZO_ENGINE_AUTH_TOKEN: "internal-secret-token"
  # If set, all requests must include: Authorization: Bearer <token>
```

### Input Validation

```yaml
Input Limits:
  max_prompt_tokens: 131072     # Reject prompts exceeding model context
  max_output_tokens: 32768      # Cap generation length
  max_stop_sequences: 16        # Limit stop sequence count
  max_request_size: 10MB        # HTTP body size limit

Sanitization:
  - UTF-8 validation on all string inputs
  - JSON schema validation on request bodies
  - Numeric range checks on all sampling parameters
  - Reject NaN/Inf in temperature, top_p, penalties
```

### Model Isolation

When serving multiple models, each model runs in an isolated memory region. A bug in one model's forward pass cannot corrupt another model's weights or KV cache. This isolation is enforced by Rust's ownership model -- each model owns its tensors, and cross-model references are impossible without explicit sharing primitives.

## Implementation Roadmap

### Phase 1: Core Engine (Q1 2026)
- Fork and adapt mistral.rs for Zen model architectures
- Implement PagedAttention with copy-on-write prefix sharing
- OpenAI-compatible API (`/v1/chat/completions`, `/v1/completions`, `/v1/models`)
- GGUF and SafeTensors model loading
- SSE streaming with backpressure handling
- Docker image and Kubernetes manifests
- Prometheus metrics and health endpoints

### Phase 2: Advanced Features (Q2 2026)
- Speculative decoding with configurable draft models
- ISQ (in-situ quantization) at load time
- AWQ and GPTQ format support
- Multi-model serving with GPU memory partitioning
- MoDE-aware expert scheduling for Zen MoE models
- Integration with Hanzo Object Storage for model loading
- Automatic model offloading (GPU to CPU/NVMe)

### Phase 3: Production Hardening (Q3 2026)
- Continuous batching optimization under sustained load
- Zero-downtime model swap (load new version while serving old)
- Expert offloading for zen-235b and zen-480b on limited GPU counts
- KV cache sharing integration with Zen Gateway
- Distributed engine coordination for multi-node deployments
- Candle backend integration (HIP-0019) for edge/WASM targets

### Phase 4: Optimization (Q4 2026)
- Custom CUDA kernels for Zen-specific attention patterns
- FlashAttention-3 integration for Hopper GPUs (H100/H200)
- FP8 native tensor core utilization on Hopper and Blackwell GPUs
- Disaggregated prefill/decode for latency-sensitive workloads
- Apple Silicon Metal backend for local development
- Benchmark suite and regression testing infrastructure
- Shared model format and quantization pipeline with Hanzo Edge (HIP-0050)

## Backwards Compatibility

The engine maintains full compatibility with the OpenAI API specification. Any client that works with the OpenAI API works with the engine by changing the base URL:

```python
# Before: OpenAI direct
client = OpenAI(api_key="sk-openai-...")

# After: Hanzo Engine
client = OpenAI(
    base_url="http://localhost:8080/v1",
    api_key="hanzo-engine-key"
)
```

Model format compatibility:
- **SafeTensors**: Standard HuggingFace format, no modifications needed.
- **GGUF**: Standard llama.cpp format, compatible with Ollama and other GGUF consumers.
- **GPTQ/AWQ**: Standard quantized formats from AutoGPTQ and AutoAWQ.

The engine does not modify model weights or tokenizers. A model loaded in the engine produces identical outputs (given the same seed and sampling parameters) as the same model loaded in vLLM, TGI, or llama.cpp.

## References

1. [HIP-0004: LLM Gateway - Unified AI Provider Interface](./hip-0004-llm-gateway-unified-ai-provider-interface.md)
2. [HIP-0019: Tensor Operations Standard (Candle)](./hip-0019-tensor-operations-standard.md)
3. [HIP-0039: Zen Model Architecture](./hip-0039-zen-model-architecture.md)
4. [mistral.rs: Blazingly fast LLM inference](https://github.com/EricLBuehler/mistral.rs)
5. [Efficient Memory Management for Large Language Model Serving with PagedAttention](https://arxiv.org/abs/2309.06180)
6. [Fast Inference from Transformers via Speculative Decoding](https://arxiv.org/abs/2211.17192)
7. [FlashAttention: Fast and Memory-Efficient Exact Attention](https://arxiv.org/abs/2205.14135)
8. [AWQ: Activation-aware Weight Quantization](https://arxiv.org/abs/2306.00978)
9. [GPTQ: Accurate Post-Training Quantization for Generative Pre-trained Transformers](https://arxiv.org/abs/2210.17323)
10. [GGML/GGUF: Tensor Library for Machine Learning](https://github.com/ggerganov/ggml)
11. [Orca: A Distributed Serving System for Transformer-Based Models](https://www.usenix.org/conference/osdi22/presentation/yu)
12. [Zen LM Documentation](https://zenlm.org)
13. [Hanzo Engine Repository](https://github.com/hanzoai/engine)
14. [Hanzo ML Framework (Candle)](https://github.com/hanzoai/ml)
15. [HIP-0050: Edge AI Runtime Standard](./hip-0050-edge-computing-standard.md)
16. [HIP-0068: Ingress Standard](./hip-0068-ingress-standard.md)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
