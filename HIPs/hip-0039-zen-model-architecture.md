---
hip: 0039
title: Zen Model Architecture
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2025-01-15
requires: HIP-0002, HIP-0004
---


# HIP-0039: Zen Model Architecture

## Abstract

This proposal defines the Zen model family, [Zoo Labs Foundation's](https://zoo.industries) frontier large language models, and how Hanzo serves them. Zen models use a **Mixture of Diverse Experts (MoDE)** architecture spanning nine sizes from 600M to 480B parameters. The family provides a single, consistent architecture across scales -- from edge devices to datacenter clusters -- with multimodal capabilities (text, vision, audio, code) in the larger variants.

Zen models are served via the LLM Gateway (HIP-0004) and the dedicated Zen Gateway, which handles model-specific routing, quantization selection, and KV cache management. Model weights are hosted on Hugging Face (zenlm org) and Hanzo Object Storage (HIP-0032).

**Gateway Configuration**: [github.com/hanzoai/zen-gateway](https://github.com/hanzoai/zen-gateway)
**Model Weights**: [huggingface.co/zenlm](https://huggingface.co/zenlm)
**Documentation**: [zenlm.org](https://zenlm.org)

## Specification

```yaml
Core Architecture:
  Type: Transformer with Mixture of Diverse Experts (MoDE)
  Attention: Grouped Query Attention (GQA)
  Position Encoding: Rotary Position Embeddings (RoPE)
  Activation: SwiGLU
  Normalization: RMSNorm (pre-norm)
  Tokenizer: Byte-level BPE (shared across all sizes)
  Vocabulary: 152,064 tokens

MoDE Configuration (zen-72b example):
  Total Experts: 64
  Active Experts per Token: 8
  Router: Top-k softmax with load balancing loss
  Expert FFN Hidden Dim: 4096
  Shared Attention Layers: 80
  Expert FFN Layers: 80 (interleaved)

Context Window Variants:
  Standard: 8K / 32K / 128K (per model size)
  Extended: Up to 1M tokens (zen-480b with YaRN scaling)
  KV Cache: Paged attention (vLLM) or continuous batching (TGI)
```
```yaml
Vision Encoder:
  Architecture: ViT-L/14 (shared across all multimodal sizes)
  Resolution: 448x448 (dynamic resolution for larger images)
  Patch Size: 14x14
  Output: Projected to model hidden dimension

Audio Encoder:
  Architecture: Whisper-style encoder
  Input: 16kHz mel-spectrogram
  Window: 30-second chunks with overlap
  Output: Projected to model hidden dimension

Code Encoder:
  Architecture: Shared tokenizer with code-specific tokens
  Languages: 50+ programming languages
  Features: AST-aware tokenization for structured understanding
```
```yaml
Formats:
  FP16:
    Use: Training, high-accuracy inference
    Memory: 2 bytes/param
    Quality: Baseline (100%)

  BF16:
    Use: Training on Ampere+ GPUs, inference
    Memory: 2 bytes/param
    Quality: ~100% (better dynamic range than FP16)

  INT8 (GPTQ):
    Use: Production inference
    Memory: 1 byte/param
    Quality: ~99.5% of FP16

  INT4 (AWQ):
    Use: Memory-constrained inference, edge deployment
    Memory: 0.5 bytes/param
    Quality: ~98% of FP16

  GGUF (llama.cpp):
    Use: CPU inference, Ollama, local deployment
    Variants: Q4_K_M, Q5_K_M, Q6_K, Q8_0
    Quality: 96-99% of FP16 depending on variant

Memory Requirements (zen-72b):
  FP16:  144 GB (2x A100 80GB or 2x H100 80GB)
  INT8:   72 GB (1x A100 80GB or 1x H100 80GB)
  INT4:   36 GB (1x A100 40GB or consumer GPU)
  Q4_K_M: 40 GB (CPU RAM, ~10 tok/s on Apple M3 Max)
```
```yaml
Production (GPU):
  vLLM:
    Status: Primary serving backend
    Features: PagedAttention, continuous batching, tensor parallelism
    Config: See zen-gateway/configs/vllm/

  TGI (Text Generation Inference):
    Status: Supported
    Features: Flash Attention 2, quantization, watermarking
    Config: See zen-gateway/configs/tgi/

Local / Edge:
  Ollama:
    Status: Supported (GGUF format)
    Models: All sizes via ollama.com/library/zen

  Candle (HIP-0019):
    Status: Experimental
    Features: Pure Rust inference, WASM support
    Use: Edge deployment, browser inference (zen-600m, zen-1b)

  llama.cpp:
    Status: Supported (GGUF format)
    Features: CPU + Metal + CUDA inference
```
```python
        ]}
    ]
)

# Auto-routing via Zen Gateway (selects optimal model size)
response = client.chat.completions.create(
    model="zen-auto",
    messages=[
        {"role": "user", "content": "Write a quicksort in Python."}
    ]
)
```

```typescript
// TypeScript SDK
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://llm.hanzo.ai/v1',
  apiKey: 'sk-hanzo-...'
});

const response = await client.chat.completions.create({
  model: 'zen-72b',
  messages: [{ role: 'user', content: 'Hello' }],
  stream: true
});
```

### Zen Gateway Configuration

```yaml
# zen-gateway/config.yaml
gateway:
  listen: 0.0.0.0:8080
  upstream: llm-gateway:4000

models:
  zen-7b:
    backend: vllm
    gpu_memory: 16GB
    quantization: int8
    max_batch_size: 64
    max_context: 32768

  zen-32b:
    backend: vllm
    gpu_memory: 80GB
    quantization: fp16
    tensor_parallel: 2
    max_batch_size: 32
    max_context: 131072

  zen-72b:
    backend: vllm
    gpu_memory: 160GB
    quantization: fp16
    tensor_parallel: 4
    max_batch_size: 16
    max_context: 131072

  zen-480b:
    backend: vllm
    gpu_memory: 640GB
    quantization: fp16
    tensor_parallel: 8
    pipeline_parallel: 2
    max_batch_size: 8
    max_context: 1048576

routing:
  auto:
    strategy: task_complexity
    rules:
      - pattern: "classify|label|yes_no"
        model: zen-7b
      - pattern: "summarize|translate|explain"
        model: zen-32b
      - pattern: "code|debug|refactor"
        model: zen-72b
      - pattern: "research|agent|multi_step"
        model: zen-235b
    fallback: zen-32b

  kv_cache:
    shared_prefixes: true
    max_prefix_length: 4096
    eviction: lru

  failover:
    enabled: true
    cascade: [zen-480b, zen-235b, zen-72b, zen-32b]
    quality_warning: true
```

### Performance Benchmarks

| Benchmark | zen-7b | zen-14b | zen-32b | zen-72b | zen-235b | zen-480b |
|-----------|--------|---------|---------|---------|----------|----------|
| MMLU (5-shot) | 74.2 | 79.8 | 83.1 | 86.4 | 89.2 | 91.7 |
| HumanEval (pass@1) | 62.8 | 71.3 | 76.2 | 82.9 | 86.1 | 89.4 |
| MATH (4-shot) | 51.6 | 62.4 | 71.8 | 78.3 | 83.7 | 87.2 |
| GPQA (0-shot) | 31.2 | 38.7 | 44.1 | 49.8 | 55.6 | 61.3 |
| MT-Bench | 7.8 | 8.3 | 8.7 | 9.0 | 9.2 | 9.4 |
| IFEval (strict) | 68.4 | 74.1 | 79.6 | 83.2 | 86.8 | 89.1 |
| MBPP+ (pass@1) | 58.3 | 66.7 | 72.4 | 78.6 | 82.3 | 85.9 |

**Inference throughput** (vLLM, FP16, A100 80GB):

| Model | Time to First Token | Tokens/sec (single) | Tokens/sec (batch=32) |
|-------|--------------------|--------------------|----------------------|
| zen-7b | 18ms | 92 | 2,400 |
| zen-14b | 24ms | 71 | 1,800 |
| zen-32b | 35ms | 48 | 1,200 |
| zen-72b | 52ms | 31 | 780 |
| zen-235b | 85ms | 18 | 420 |
| zen-480b | 140ms | 11 | 260 |

## Implementation

### Production Deployment

Zen models are served via vLLM on GPU clusters managed through Kubernetes:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: zen-72b-vllm
  namespace: zen
spec:
  replicas: 2
  selector:
    matchLabels:
      app: zen-72b
  template:
    metadata:
      labels:
        app: zen-72b
    spec:
      containers:
      - name: vllm
        image: hanzoai/vllm-zen:latest
        args:
          - --model=zenlm/zen-72b
          - --tensor-parallel-size=4
          - --max-model-len=131072
          - --enable-prefix-caching
          - --gpu-memory-utilization=0.92
        resources:
          limits:
            nvidia.com/gpu: 4
        ports:
        - containerPort: 8000
```

### Chat Integration (HIP-0011)

Hanzo Chat exposes 14 Zen model variants to end users:

```yaml
Chat Model Selector:
  Small (Fast):
    - zen-3b       # Quick answers, autocomplete
    - zen-7b       # General chat, light coding
  Medium (Balanced):
    - zen-14b      # Standard conversation
    - zen-32b      # Document analysis, detailed answers
  Large (Powerful):
    - zen-72b      # Complex reasoning, long code generation
    - zen-235b     # Research, multi-step problem solving
  Frontier:
    - zen-480b     # Maximum capability
  Specialized:
    - zen-7b-code  # Code-optimized variant
    - zen-14b-code # Code-optimized variant
    - zen-32b-math # Math/reasoning-optimized variant
    - zen-72b-long # 1M context variant
    - zen-7b-vision  # Vision-focused variant
    - zen-32b-vision # Vision-focused variant
    - zen-72b-vision # Vision-focused variant
```

### Model Weight Distribution

```yaml
Hugging Face (zenlm org):
  Repository Pattern: zenlm/zen-{size}[-variant]
  Formats: SafeTensors (primary), GGUF (Ollama/llama.cpp)
  License: Apache 2.0

Object Storage (HIP-0032):
  Bucket: models.hanzo.ai/zen/
  Layout: /zen/{size}/{version}/{format}/
  CDN: Cloudflare R2 with regional caching

Ollama Registry:
  Names: zen:7b, zen:14b, zen:32b, zen:72b
  Pull: ollama pull zen:72b
```

### Fine-Tuning Pipeline

```yaml
Supported Methods:
  LoRA:
    Rank: 8-256 (default 64)
    Alpha: 2x rank
    Target Modules: q_proj, k_proj, v_proj, o_proj, gate_proj, up_proj, down_proj
    Memory: ~10% of full model

  QLoRA:
    Base Quantization: INT4 (NF4)
    LoRA on top: FP16
    Memory: ~5% of full model
    Use: Fine-tuning zen-72b on a single A100

  Full Fine-Tune:
    Available: zen-600m through zen-7b
    Method: DeepSpeed ZeRO Stage 3
    Use: When task diverges significantly from base distribution

API:
  Endpoint: https://api.hanzo.ai/v1/fine-tuning/jobs
  Compatibility: OpenAI fine-tuning API format
```

## Security Considerations

### Model Access Control

```yaml
Authentication:
  Method: API key (sk-hanzo-...) via LLM Gateway
  Scopes: Per-model access grants
  Integration: IAM (HIP-0026) for user identity

Rate Limiting:
  Per-Key:
    zen-7b: 1000 RPM
    zen-32b: 500 RPM
    zen-72b: 200 RPM
    zen-480b: 50 RPM
  Per-Organization: Configurable quotas
  Burst: 2x sustained rate for 10 seconds
```

### Content Safety

```yaml
Input Filtering:
  - Prompt injection detection
  - PII detection and masking (opt-in)
  - Harmful content classification

Output Filtering:
  - Toxicity scoring (threshold configurable)
  - Code safety analysis (zen-*-code variants)
  - Factuality guardrails (experimental, zen-72b+)

Watermarking:
  Method: Statistical watermark in token sampling
  Detection: Watermark detection API endpoint
  Purpose: Distinguish AI-generated from human text
```

### Usage Tracking and Billing

```yaml
Metering:
  Granularity: Per-request, per-token
  Fields: model, input_tokens, output_tokens, latency_ms, user_id
  Storage: Analytics pipeline (HIP-0017)

Billing Integration:
  Credits: IAM user balance (HIP-0026)
  Pricing: Per-1K tokens, varies by model size
  Tiers:
    zen-7b:   $0.0003 / 1K input,  $0.0006 / 1K output
    zen-32b:  $0.0015 / 1K input,  $0.003  / 1K output
    zen-72b:  $0.004  / 1K input,  $0.008  / 1K output
    zen-480b: $0.015  / 1K input,  $0.03   / 1K output
```

12. [vLLM: Efficient Memory Management for LLM Serving](https://arxiv.org/abs/2309.06180)
13. [RoFormer: Enhanced Transformer with Rotary Position Embedding](https://arxiv.org/abs/2104.09864)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
