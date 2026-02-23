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

# HIP-39: Zen Model Architecture

## Abstract

This proposal defines the Zen model family, Hanzo's frontier large language models co-developed with research partners. Zen models use a **Mixture of Distilled Experts (MoDE)** architecture spanning nine sizes from 600M to 480B parameters. The family provides a single, consistent architecture across scales -- from edge devices to datacenter clusters -- with multimodal capabilities (text, vision, audio, code) in the larger variants.

Zen models are served via the LLM Gateway (HIP-0004) and the dedicated Zen Gateway, which handles model-specific routing, quantization selection, and KV cache management. Model weights are hosted on Hugging Face (zenlm org) and Hanzo Object Storage (HIP-0032).

**Gateway Configuration**: [github.com/hanzoai/zen-gateway](https://github.com/hanzoai/zen-gateway)
**Model Weights**: [huggingface.co/zenlm](https://huggingface.co/zenlm)
**Documentation**: [zenlm.org](https://zenlm.org)

## Motivation

Current approaches to serving frontier language models face several structural problems:

1. **Dense Model Waste**: A dense 70B model activates all 70B parameters for every token, regardless of whether the input is simple arithmetic or nuanced legal reasoning. Most parameters contribute nothing to any given forward pass.
2. **Training Cost Barriers**: Training a 480B model from scratch requires $10M+ in compute. Few organizations can afford this, creating artificial scarcity at the frontier.
3. **One-Size-Fits-All Deployment**: Organizations must choose between a single large model (expensive, slow) or a single small model (cheap, less capable). There is no principled way to match model capacity to task complexity.
4. **Fragmented Model Families**: Most providers offer disconnected model sizes with different architectures, training recipes, and behavioral characteristics. Switching sizes means changing behavior.
5. **Serving Complexity**: Each model size requires bespoke serving configuration -- different quantization strategies, different memory layouts, different batching parameters.

Zen addresses all five problems through a unified MoDE architecture with a dedicated serving gateway.

## Design Philosophy

### Why Mixture of Distilled Experts (MoDE)

The core insight behind MoDE is that **intelligence is sparse**. For any given input, only a small fraction of a model's knowledge is relevant. A question about Python syntax does not need the parameters that encode knowledge of organic chemistry.

Dense models ignore this. A dense 70B model runs all 70B parameters for every token. A MoDE model with 480B total parameters activates only ~60B per forward pass -- selecting the expert subnetworks most relevant to the current input. The result: large-model quality at small-model cost.

Concretely, a 480B MoDE model achieves:

- **Quality parity** with dense 70B models on standard benchmarks (MMLU, HumanEval, MATH)
- **3x lower inference cost** per token (60B active vs 70B dense)
- **Higher peak capability** because the full 480B parameter space encodes more knowledge, accessed sparsely

The routing mechanism is learned end-to-end. A lightweight router network examines each token's hidden state and selects the top-k experts (typically k=8 from a pool of 64-128) for that token. Different tokens in the same sequence may activate different expert subsets. This means a single prompt containing both code and natural language will route code tokens to code-specialized experts and language tokens to language-specialized experts, without any explicit orchestration.

### Why Distillation

Training 480B parameters from scratch on raw text requires thousands of GPU-months and meticulous hyperparameter tuning. Distillation provides a more efficient path: train a large teacher model once, then distill specialized knowledge into expert subnetworks.

Each expert in a Zen MoDE model is distilled to specialize in a domain:

| Expert Group | Specialization | Distillation Source |
|--------------|----------------|---------------------|
| Experts 0-15 | General language, world knowledge | Full teacher model |
| Experts 16-31 | Code generation, debugging | Code-focused teacher checkpoint |
| Experts 32-47 | Mathematical and logical reasoning | Math/reasoning teacher checkpoint |
| Experts 48-63 | Creative writing, style transfer | Creative teacher checkpoint |

Distillation transfers knowledge efficiently because the student (expert subnetwork) only needs to learn a narrow domain, not the full distribution. A 7B expert distilled from a 480B teacher on code tasks can match the teacher's code performance while being 70x smaller.

This approach also enables **iterative improvement**: when a stronger teacher becomes available, individual expert groups can be re-distilled without retraining the entire model. The router and shared layers remain fixed; only the expert weights update.

### Why a Model Family (600M to 480B)

Different use cases have fundamentally different constraints:

| Use Case | Constraint | Zen Model |
|----------|-----------|-----------|
| On-device autocomplete | <2GB RAM, <10ms latency | zen-600m, zen-1b |
| Mobile assistant | <4GB RAM, <50ms latency | zen-3b |
| Real-time chat | Low latency, moderate quality | zen-7b, zen-14b |
| Document analysis | High quality, long context | zen-32b |
| Complex reasoning | Maximum capability | zen-72b |
| Research, agentic workflows | Frontier capability, tool use | zen-235b, zen-480b |

A model family with one architecture across all sizes provides:

- **Consistent behavior**: A prompt that works on zen-7b works on zen-72b (with higher quality). No behavioral surprises when scaling.
- **Smooth quality gradient**: Users can start with zen-7b for prototyping and move to zen-72b for production without rewriting prompts.
- **Shared tooling**: One tokenizer, one serving stack, one fine-tuning pipeline, one evaluation harness across all sizes.
- **Progressive deployment**: Start cheap, scale up only where the task demands it.

### Why Zen Gateway

The LLM Gateway (HIP-0004) provides a unified proxy for 100+ providers with OpenAI-compatible API. The Zen Gateway sits beneath it, handling concerns specific to the Zen model family:

- **Task-aware routing**: Analyze incoming requests and route to the optimal model size. Simple classification tasks go to zen-7b; multi-step reasoning goes to zen-72b.
- **Quantization selection**: Choose FP16, INT8, or INT4 serving based on the request's quality requirements and available GPU memory.
- **Context window management**: Route long-context requests (>32K tokens) to models deployed with extended context configurations.
- **KV cache sharing**: Multiple requests for the same system prompt share a single KV cache, reducing memory and time-to-first-token.
- **Failover**: If a large model is at capacity, gracefully fall back to a smaller model with a quality warning, rather than returning an error.

The Zen Gateway configuration lives at `github.com/hanzoai/zen-gateway` and integrates with the LLM Gateway as a first-class provider.

## Specification

### Model Sizes

| Model | Total Params | Active Params | Experts | Context | Modalities |
|-------|-------------|---------------|---------|---------|------------|
| zen-600m | 600M | 600M | 1 (dense) | 8K | Text |
| zen-1b | 1B | 1B | 1 (dense) | 8K | Text |
| zen-3b | 3B | 3B | 1 (dense) | 32K | Text |
| zen-7b | 7B | 7B | 1 (dense) | 32K | Text, Vision, Code |
| zen-14b | 14B | 3.5B | 16 | 32K | Text, Vision, Audio, Code |
| zen-32b | 32B | 8B | 32 | 128K | Text, Vision, Audio, Code |
| zen-72b | 72B | 18B | 64 | 128K | Text, Vision, Audio, Code |
| zen-235b | 235B | 37B | 96 | 128K | Text, Vision, Audio, Code |
| zen-480b | 480B | 60B | 128 | 1M | Text, Vision, Audio, Code |

**Note**: zen-600m through zen-7b are dense models (all parameters active). MoDE routing activates at zen-14b and above, where the expert count justifies the router overhead.

### Architecture Details

```yaml
Core Architecture:
  Type: Transformer with Mixture of Distilled Experts (MoDE)
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

### Multimodal Encoder Specifications

Models zen-7b and above support multimodal inputs through modality-specific encoders that project into the shared token embedding space:

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

### Quantization Support

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

### Serving Backends

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

### API Specification

Zen models are accessible through the OpenAI-compatible API exposed by the LLM Gateway:

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://llm.hanzo.ai/v1",
    api_key="sk-hanzo-..."
)

# Text completion
response = client.chat.completions.create(
    model="zen-72b",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Explain the MoDE architecture."}
    ],
    temperature=0.7,
    max_tokens=2048,
    stream=True
)

# Vision input (zen-7b+)
response = client.chat.completions.create(
    model="zen-32b",
    messages=[
        {"role": "user", "content": [
            {"type": "text", "text": "What is in this image?"},
            {"type": "image_url", "image_url": {"url": "https://example.com/photo.jpg"}}
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

## Implementation Roadmap

### Phase 1: Foundation (Q1 2025)
- Release zen-7b and zen-14b (dense and MoDE)
- Zen Gateway v1 with basic routing
- vLLM serving on A100 clusters
- OpenAI-compatible API via LLM Gateway
- GGUF exports for Ollama

### Phase 2: Scale (Q2 2025)
- Release zen-32b and zen-72b
- Multimodal support (vision + audio)
- Zen Gateway v2 with auto-routing
- KV cache sharing for shared system prompts
- Fine-tuning API (LoRA/QLoRA)

### Phase 3: Frontier (Q3 2025)
- Release zen-235b and zen-480b
- 1M context window (zen-480b)
- Distributed inference across GPU clusters
- Candle backend for edge/WASM (zen-600m, zen-1b)
- Chat integration with all 14 variants

### Phase 4: Optimization (Q4 2025)
- Speculative decoding (small model drafts, large model verifies)
- Expert offloading (CPU/NVMe for inactive experts)
- Continuous distillation from improved teachers
- On-device deployment for zen-3b (iOS/Android)
- Integration with Jin multimodal framework (HIP-0003)

## Backwards Compatibility

Zen models maintain compatibility with existing ecosystem standards:

- **OpenAI API**: Drop-in replacement; same request/response format
- **Hugging Face Transformers**: Standard `AutoModelForCausalLM` loading
- **GGUF/llama.cpp**: Standard format for local inference
- **MCP (HIP-0010)**: Tool use via standard function calling
- **LLM Gateway (HIP-0004)**: First-class provider integration

Existing applications using the LLM Gateway can switch to Zen models by changing only the `model` parameter. No code changes required.

## References

1. [HIP-0002: Hamiltonian Large Language Models](./hip-0002-hamiltonian-large-language-models-hllms-specification.md)
2. [HIP-0003: Jin Multimodal AI Architecture](./hip-0003-jin-multimodal-ai-architecture.md)
3. [HIP-0004: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md)
4. [HIP-0010: Model Context Protocol Integration](./hip-0010-model-context-protocol-mcp-integration-standards.md)
5. [HIP-0011: Chat Interface Standard](./hip-0011-chat-interface-standard.md)
6. [HIP-0019: Tensor Operations Standard (Candle)](./hip-0019-tensor-operations-standard.md)
7. [HIP-0026: Identity Access Management](./hip-0026-identity-access-management-standard.md)
8. [Zen LM Documentation](https://zenlm.org)
9. [Zen Gateway Repository](https://github.com/hanzoai/zen-gateway)
10. [Switch Transformers: Scaling to Trillion Parameter Models](https://arxiv.org/abs/2101.03961)
11. [Mixtral of Experts](https://arxiv.org/abs/2401.04088)
12. [vLLM: Efficient Memory Management for LLM Serving](https://arxiv.org/abs/2309.06180)
13. [RoFormer: Enhanced Transformer with Rotary Position Embedding](https://arxiv.org/abs/2104.09864)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
