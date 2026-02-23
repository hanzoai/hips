---
hip: 0019
title: Tensor Operations Standard
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2025-01-09
requires: HIP-0003
---

# HIP-19: Tensor Operations Standard

## Abstract

This proposal defines the tensor operations standard for all ML computations in the Hanzo ecosystem. It specifies the data types, device backends, operation primitives, model formats, quantization strategies, memory management, custom operations, WebAssembly compilation pipeline, and API surface that every inference workload MUST use. The reference implementation is Hanzo Candle, a fork of HuggingFace's Candle Rust ML framework extended with Apple Silicon Metal support, custom quantization kernels, Hamiltonian dynamics operations, and integration with the Hanzo model serving pipeline.

**Repository**: [github.com/hanzoai/candle](https://github.com/hanzoai/candle)
**Crates**: `candle-core`, `candle-nn`, `candle-transformers`, `candle-metal-kernels`, `candle-wasm`
**NPM Package**: `@hanzoai/candle-wasm`

## Motivation

ML inference in production has a set of concrete problems that existing tooling does not solve together:

1. **Runtime bloat**: PyTorch requires a 2GB+ runtime. For a service that loads a 4-bit quantized 7B model into 4GB of RAM, the framework itself should not double the memory footprint. Inference servers should be small, fast to start, and free of dynamic library dependency chains.
2. **No single-binary deployment**: Python-based inference requires a virtualenv, pip dependencies, CUDA toolkit installation, and careful version pinning. Deploying to a new machine means reproducing this environment exactly. A compiled binary that statically links its dependencies eliminates this class of failure.
3. **GIL contention**: Python's Global Interpreter Lock serializes CPU-bound work across threads. For inference servers handling concurrent requests, this means either multiprocessing (with memory duplication) or yielding to C extensions (with complex FFI). Rust has no GIL.
4. **Memory safety at the hardware boundary**: CUDA and Metal kernels operate on raw pointers. Buffer overflows, use-after-free, and data races in kernel launch code cause silent corruption or segfaults. Rust's ownership model catches these at compile time.
5. **No edge/browser deployment path**: PyTorch cannot compile to WebAssembly. ONNX Runtime has a WASM build but it is large and limited. Candle compiles to WASM natively, enabling in-browser inference with no server round-trip.
6. **Fragmented hardware support**: Most frameworks treat CUDA as first-class and everything else as an afterthought. Apple Silicon (Metal) and WebAssembly are second-class or unsupported. We need uniform performance across CPU, CUDA, Metal, and WASM.
7. **No custom operation pathway for scientific computing**: Production ML frameworks are optimized for standard neural network operations. Applications that require physics-informed layers -- such as Hamiltonian dynamics for the HMM protocol (HIP-0008) or active inference for HLLM (HIP-0002) -- have no clean extension mechanism in PyTorch or ONNX. Candle's trait-based backend system makes custom operations first-class.

Hanzo Candle addresses all seven problems with a single codebase.

## Design Philosophy

This section explains the reasoning behind every major architectural decision. These are not arbitrary choices -- each follows from a specific constraint.

### Why Rust for ML

Python is the ML lingua franca. Every researcher writes Python. Every training framework (PyTorch, JAX, TensorFlow) has Python as its primary interface. So why would an ML infrastructure company build its inference layer in Rust?

The answer is that **training and inference have fundamentally different requirements**.

Training is exploratory. Researchers iterate on architectures, loss functions, and data pipelines. They need rapid prototyping, interactive debugging, and the ability to inspect intermediate tensors. Python excels at this. The GIL does not matter because training is GPU-bound and Python is just orchestrating CUDA kernels.

Inference is operational. A production inference server must:

- Start in milliseconds (not seconds) for serverless cold starts
- Handle thousands of concurrent requests without GIL contention
- Use minimal memory so more RAM is available for model weights
- Deploy as a single artifact without dependency chains
- Run for months without memory leaks or GC pauses

For these requirements, Rust provides:

- **C-level performance**: No interpreter overhead, no garbage collector, no JIT warmup. For CPU-bound operations (tokenization, beam search, KV cache management), Rust is 10-100x faster than Python.
- **Memory safety without GC**: Ownership and borrowing eliminate use-after-free, double-free, and data races at compile time. No garbage collection pauses during inference.
- **Zero-cost abstractions**: Traits, generics, and iterators compile to the same machine code as hand-written C. The device abstraction layer adds no runtime overhead.
- **Single-binary deployment**: `cargo build --release` produces one statically-linked binary. Our inference server is ~50MB, starts in <100ms, and has zero runtime dependencies.
- **Fearless concurrency**: Rust's type system prevents data races. Concurrent request handling requires no locks on read-only model weights.

The tradeoff is development velocity. Rust has a steeper learning curve than Python, and compile times are longer. We accept this tradeoff because inference code changes infrequently once correct -- the model architecture is fixed, and the serving logic is stable. The operational benefits compound over millions of inference requests.

### Why Candle (HuggingFace Fork)

There are several Rust ML frameworks: tch-rs (PyTorch bindings), burn, ort (ONNX Runtime bindings), and Candle. We chose Candle for specific reasons:

**tch-rs** wraps libtorch via FFI. This gives you PyTorch's full operator set in Rust, but you are still shipping a 2GB libtorch dynamic library. The binary is not self-contained, and you inherit PyTorch's memory allocator behavior (including fragmentation under long-running inference). You also cannot compile to WASM.

**burn** is a pure-Rust framework with its own backend system. It is well-designed but young. Its model ecosystem is small -- loading a HuggingFace checkpoint requires manual weight mapping for each architecture. It does not yet support GGUF quantized formats.

**ort** wraps ONNX Runtime. ONNX is a good interchange format, but not all model architectures export cleanly to ONNX (notably: models with dynamic control flow, KV caching, or custom attention patterns). You are also limited to what ONNX operators support.

**Candle** is HuggingFace's native Rust ML framework. It provides:

- PyTorch-like tensor API (`Tensor::matmul`, `Tensor::softmax`, etc.)
- Direct loading of safetensors files (HuggingFace's standard model format)
- Pre-built model architectures (LLaMA, Mistral, Phi, Whisper, Stable Diffusion)
- CPU, CUDA, and Metal backends in a single crate
- WASM compilation support
- Active maintenance by HuggingFace engineers

We fork Candle to add:

1. **Enhanced Metal kernels**: Custom quantized matmul kernels for Apple Silicon that outperform the upstream implementation by 2-3x on M-series chips
2. **GGUF quantization support**: Full Q4_K_M and Q5_K_M quantization with optimized dequantization kernels
3. **KV cache management**: Pre-allocated, ring-buffer KV caches for efficient autoregressive generation
4. **Hanzo model registry integration**: Direct loading from Hanzo Object Storage (HIP-0032) and the Zen Gateway model cache
5. **Batched inference**: Dynamic batching with padding-free attention for throughput optimization
6. **Hamiltonian dynamics operations**: Symplectic integrators and energy-preserving transforms for the HMM protocol (HIP-0008) and active inference (HIP-0007)

By building on HuggingFace's work, we get broad model compatibility. Any model published to HuggingFace Hub in safetensors format can be loaded with minimal effort.

### Why Not Just Use PyTorch or ONNX Runtime

This deserves explicit comparison because the question comes up frequently.

**PyTorch** is the correct choice when:
- You are training a model
- You are prototyping a new architecture
- You need the full operator set (2000+ ops)
- Your team only knows Python

PyTorch is the wrong choice when:
- Your inference server must start in <1 second (PyTorch import alone takes 3-5 seconds)
- You need single-binary deployment (PyTorch requires CUDA toolkit, cuDNN, NCCL)
- You want to run in a browser or on edge devices (no WASM support)
- Memory efficiency matters (PyTorch's allocator fragments under long-running workloads)
- You serve on Apple Silicon (PyTorch MPS backend is incomplete and slower than Metal)

**ONNX Runtime** is the correct choice when:
- Your model exports cleanly to ONNX
- You need the widest hardware support (CPU, CUDA, TensorRT, DirectML, CoreML, NNAPI)
- You do not need custom attention kernels or KV cache management

ONNX Runtime is the wrong choice when:
- Your model uses dynamic control flow (if/else in forward pass)
- You need custom quantization (GPTQ, AWQ) beyond ONNX's built-in INT8
- You want WASM deployment without a 20MB+ runtime
- You need to modify the inference loop (e.g., speculative decoding, guided generation)

Candle fills the gap: **a minimal, embeddable ML runtime that compiles to native code or WASM, supports the model formats and quantization strategies that matter for LLM/diffusion inference, and gives the developer full control over the inference loop**.

### Why WebAssembly Support

Candle compiles to WASM via `wasm32-unknown-unknown`. This enables a deployment model that no other ML framework supports well: **in-browser inference with zero server infrastructure**.

Concrete use cases:

- **Privacy-sensitive applications**: Medical text analysis, personal document summarization, journal entry processing. The data never leaves the user's device. There is no API call, no server log, no data retention policy to worry about.
- **Offline capability**: A WASM model works without network connectivity. Mobile web apps, field tools, and disaster-response systems benefit from this.
- **Latency elimination**: No network round-trip. For small models (1-3B parameters with INT4 quantization), in-browser inference is faster than a cloud API call because you eliminate 50-200ms of network latency.
- **Cost elimination**: No GPU servers to provision, no API bills, no autoscaling complexity. The user's device provides the compute.

The tradeoff is model size. WASM inference is CPU-only (no GPU access from the browser) and limited by the device's RAM. In practice, this means models up to ~3B parameters with INT4 quantization (~1.5GB) work well on modern laptops and high-end phones. Larger models require server-side inference.

### Why Tensor-Level Standardization

Multiple systems in the Hanzo ecosystem consume tensors: Jin (HIP-0003) for multimodal inference, Node (HIP-0020) for blockchain-verified inference, browser clients for edge ML, and the LLM Gateway (HIP-0004) for model serving. Without a shared standard, each system invents its own tensor format, memory layout, and operation semantics. This leads to:

- **Serialization overhead**: Converting between formats (e.g., PyTorch tensors to ONNX to TFLite) introduces bugs and performance loss.
- **Correctness drift**: Two implementations of softmax that differ in numerical precision produce different model outputs, making inference non-reproducible.
- **Duplicated effort**: Every team writes their own matmul, attention, and normalization kernels.

By standardizing at the tensor level, all Hanzo systems share a single implementation of every operation. A tensor produced by Jin can be consumed by Node without conversion. Browser and server inference produce bit-identical results for the same model and input.

## Specification

### Architecture

```
Application Layer
├── Jin (HIP-0003) - Multimodal inference
├── Node (HIP-0020) - Blockchain inference
├── Browser Client - Edge ML via WASM
└── LLM Gateway (HIP-0004) - Model serving
        |
        v
Candle High-Level API
├── candle-transformers  - Pre-built model architectures
├── candle-nn            - Neural network layers
└── candle-hamiltonian   - Physics-informed operations
        |
        v
Candle Core
├── Tensor              - N-dimensional array
├── Op                  - Operation enum (for autograd)
├── Backend trait       - Device abstraction
└── Storage             - Typed memory buffer
        |
        v
Backend Implementations
├── CPU    (BLAS/LAPACK: OpenBLAS, MKL, Accelerate)
├── CUDA   (cuBLAS, cuDNN, custom kernels)
├── Metal  (MPS, custom compute shaders)
└── WASM   (Rust stdlib, SIMD128 where available)
```

### Tensor Types

All tensor operations MUST support the following data types:

| DType | Size | Use Case | Backend Support |
|-------|------|----------|-----------------|
| `f32` | 4 bytes | Default precision, training, CPU inference | CPU, CUDA, Metal, WASM |
| `f16` | 2 bytes | GPU inference, reduced memory | CPU (emulated), CUDA, Metal |
| `bf16` | 2 bytes | Training stability, GPU inference | CPU (emulated), CUDA, Metal |
| `f64` | 8 bytes | High-precision numerical computation, Hamiltonian dynamics | CPU, CUDA |
| `i64` | 8 bytes | Indices, token IDs, positions | CPU, CUDA, Metal, WASM |
| `u32` | 4 bytes | Indices, masks, vocabulary IDs | CPU, CUDA, Metal, WASM |
| `u8` | 1 byte | Quantized weights, raw data | CPU, CUDA, Metal, WASM |

Type promotion rules follow NumPy conventions: `u8 + f32 -> f32`, `f16 + f32 -> f32`, `bf16 + f16 -> f32`.

### Device Backends

```rust
pub enum Device {
    Cpu,
    Cuda(usize),    // GPU ordinal
    Metal(usize),   // Metal device ordinal
}
```

| Backend | Library | Matmul Dispatch | Notes |
|---------|---------|-----------------|-------|
| **CPU** | BLAS (OpenBLAS, MKL, Accelerate) | `sgemm`/`dgemm` | Universal fallback; vectorized with AVX2/NEON |
| **CUDA** | cuBLAS, cuDNN, custom kernels | `cublasSgemm`, flash attention | NVIDIA GPUs; requires CUDA toolkit >= 12.0 |
| **Metal** | Metal Performance Shaders, custom kernels | `MPSMatrixMultiplication`, custom Q4 matmul | Apple Silicon; M1/M2/M3/M4 |
| **WASM** | Rust stdlib, SIMD128 | Manual tiling | Browser/edge; no GPU, SIMD optional |

Backend selection is explicit at tensor creation time. Tensors on different devices cannot be combined -- the caller must explicitly transfer with `tensor.to_device(&device)`.

### Memory Management

Efficient memory management is critical for inference workloads where model weights may consume most available RAM. Candle uses three strategies:

**Zero-copy memory mapping** for model weights. When loading safetensors files, Candle uses `mmap(2)` via the `memmap2` crate. The OS maps the file into virtual address space without copying it into a heap buffer. This means:
- Model loading is near-instant (page faults load data on demand)
- Multiple processes serving the same model share physical memory pages
- The OS can evict unused pages under memory pressure

```rust
// Zero-copy loading: no heap allocation for weight data
let tensors = safetensors::MmapedSafetensors::new(&["model.safetensors"])?;
let weight = tensors.load("model.layers.0.attention.wq.weight", &device)?;
```

**Arena allocation** for intermediate tensors during inference. A single forward pass through a 7B-parameter model creates hundreds of intermediate tensors (attention scores, normalized activations, FFN outputs). Allocating and freeing each one individually causes memory fragmentation over millions of requests. Candle uses a per-request arena:

- Pre-allocate a contiguous buffer sized for the worst-case forward pass
- Intermediate tensors are bump-allocated within the arena
- The entire arena is freed at once when the request completes
- No fragmentation, no GC pauses, deterministic memory usage

**Ring-buffer KV cache** for autoregressive generation. The key-value cache for transformer attention grows linearly with sequence length. Rather than reallocating on each token, Candle pre-allocates the full cache at the maximum sequence length and writes into it with a rotating index. This eliminates allocation during the generation loop entirely.

```rust
pub struct KvCache {
    k: Tensor,          // [batch, heads, max_seq, head_dim] -- pre-allocated
    v: Tensor,          // [batch, heads, max_seq, head_dim] -- pre-allocated
    current_len: usize, // current position in the ring buffer
}
```

### Core Operations

Every backend MUST implement the following operation set:

#### Element-wise Operations

```rust
// Arithmetic
fn add(&self, rhs: &Tensor) -> Result<Tensor>;
fn sub(&self, rhs: &Tensor) -> Result<Tensor>;
fn mul(&self, rhs: &Tensor) -> Result<Tensor>;
fn div(&self, rhs: &Tensor) -> Result<Tensor>;

// Unary
fn neg(&self) -> Result<Tensor>;
fn abs(&self) -> Result<Tensor>;
fn exp(&self) -> Result<Tensor>;
fn log(&self) -> Result<Tensor>;
fn sqrt(&self) -> Result<Tensor>;
fn recip(&self) -> Result<Tensor>;
fn relu(&self) -> Result<Tensor>;
fn gelu(&self) -> Result<Tensor>;
fn silu(&self) -> Result<Tensor>;
fn tanh(&self) -> Result<Tensor>;

// Comparison
fn eq(&self, rhs: &Tensor) -> Result<Tensor>;  // returns u8
fn lt(&self, rhs: &Tensor) -> Result<Tensor>;
fn gt(&self, rhs: &Tensor) -> Result<Tensor>;
```

#### Reduction Operations

```rust
fn sum(&self, dims: &[usize]) -> Result<Tensor>;
fn mean(&self, dims: &[usize]) -> Result<Tensor>;
fn max(&self, dim: usize) -> Result<Tensor>;
fn min(&self, dim: usize) -> Result<Tensor>;
fn argmax(&self, dim: usize) -> Result<Tensor>;
fn argmin(&self, dim: usize) -> Result<Tensor>;
```

#### Linear Algebra

```rust
fn matmul(&self, rhs: &Tensor) -> Result<Tensor>;
fn transpose(&self, dim1: usize, dim2: usize) -> Result<Tensor>;
fn contiguous(&self) -> Result<Tensor>;
fn broadcast_as(&self, shape: &[usize]) -> Result<Tensor>;
```

#### Neural Network Primitives

```rust
// Attention
fn scaled_dot_product_attention(
    query: &Tensor,   // [batch, heads, seq_len, head_dim]
    key: &Tensor,     // [batch, heads, kv_len, head_dim]
    value: &Tensor,   // [batch, heads, kv_len, head_dim]
    mask: Option<&Tensor>,
    scale: f64,
) -> Result<Tensor>;

// Normalization
fn layer_norm(x: &Tensor, weight: &Tensor, bias: Option<&Tensor>, eps: f64) -> Result<Tensor>;
fn rms_norm(x: &Tensor, weight: &Tensor, eps: f64) -> Result<Tensor>;

// Positional encoding
fn rotary_embedding(x: &Tensor, cos: &Tensor, sin: &Tensor) -> Result<Tensor>;

// Activation
fn softmax(x: &Tensor, dim: usize) -> Result<Tensor>;
fn log_softmax(x: &Tensor, dim: usize) -> Result<Tensor>;

// Embedding
fn embedding(ids: &Tensor, weight: &Tensor) -> Result<Tensor>;

// Convolution
fn conv2d(
    input: &Tensor,    // [batch, channels, height, width]
    kernel: &Tensor,   // [out_ch, in_ch, kh, kw]
    bias: Option<&Tensor>,
    padding: usize,
    stride: usize,
) -> Result<Tensor>;

// Pooling
fn avg_pool2d(input: &Tensor, kernel_size: usize, stride: usize) -> Result<Tensor>;
fn max_pool2d(input: &Tensor, kernel_size: usize, stride: usize) -> Result<Tensor>;
```

#### Shape Operations

```rust
fn reshape(&self, shape: &[usize]) -> Result<Tensor>;
fn squeeze(&self, dim: usize) -> Result<Tensor>;
fn unsqueeze(&self, dim: usize) -> Result<Tensor>;
fn narrow(&self, dim: usize, start: usize, len: usize) -> Result<Tensor>;
fn chunk(&self, chunks: usize, dim: usize) -> Result<Vec<Tensor>>;
fn cat(tensors: &[&Tensor], dim: usize) -> Result<Tensor>;
fn stack(tensors: &[&Tensor], dim: usize) -> Result<Tensor>;
fn gather(&self, indices: &Tensor, dim: usize) -> Result<Tensor>;
fn scatter(&self, indices: &Tensor, src: &Tensor, dim: usize) -> Result<Tensor>;
fn index_select(&self, indices: &Tensor, dim: usize) -> Result<Tensor>;
```

#### Hamiltonian Dynamics Operations

The HMM protocol (HIP-0008) and active inference framework (HIP-0007) require physics-informed tensor operations that preserve energy and symplectic structure. These are not available in standard ML frameworks. Candle extends its operation set with:

```rust
/// Symplectic Euler integrator: advances (q, p) by one timestep dt
/// under Hamiltonian H(q, p). Preserves the symplectic 2-form exactly.
fn symplectic_euler_step(
    q: &Tensor,               // generalized positions [batch, dim]
    p: &Tensor,               // generalized momenta   [batch, dim]
    grad_h_q: &Tensor,        // dH/dq evaluated at (q, p)
    grad_h_p: &Tensor,        // dH/dp evaluated at (q, p)
    dt: f64,
) -> Result<(Tensor, Tensor)>; // (q_next, p_next)

/// Leapfrog (Stormer-Verlet) integrator: second-order symplectic method.
/// Used for Hamiltonian Monte Carlo sampling in HLLM (HIP-0002).
fn leapfrog_step(
    q: &Tensor,
    p: &Tensor,
    grad_h: impl Fn(&Tensor) -> Result<Tensor>,  // gradient of H w.r.t. q
    dt: f64,
    n_steps: usize,
) -> Result<(Tensor, Tensor)>;

/// Compute the Hamiltonian energy H(q, p) = kinetic(p) + potential(q).
/// Used to verify energy conservation in symplectic integrators.
fn hamiltonian_energy(
    q: &Tensor,
    p: &Tensor,
    potential: impl Fn(&Tensor) -> Result<Tensor>,
    mass_matrix: Option<&Tensor>,
) -> Result<Tensor>;  // scalar energy per batch element
```

These operations are critical for:
- **HMM (HIP-0008)**: Hamiltonian Market Maker uses symplectic integrators to evolve market state along energy-preserving trajectories, ensuring conservation laws that prevent arbitrage.
- **HLLM (HIP-0002)**: Hamiltonian LLMs use leapfrog integration for HMC sampling during inference, enabling Bayesian uncertainty quantification over token probabilities.
- **Active Inference (HIP-0007)**: Free energy minimization via variational inference requires Hamiltonian dynamics for efficient posterior sampling.

### Model Formats

| Format | Extension | Use Case | Quantization | Loading |
|--------|-----------|----------|--------------|---------|
| **safetensors** | `.safetensors` | Primary format for all models | No (full precision) | Memory-mapped, zero-copy |
| **GGUF** | `.gguf` | Quantized models for CPU/Metal inference | Q4_0, Q4_K_M, Q5_K_M, Q8_0 | Streamed with on-the-fly dequant |
| **ONNX** | `.onnx` | Import from external frameworks | INT8 (limited) | Full graph import |

safetensors is the REQUIRED format for model storage and distribution. GGUF is REQUIRED for quantized deployment. ONNX is OPTIONAL for import compatibility.

**Why safetensors, not pickle**: Python pickle files (PyTorch's `.pt`/`.bin` format) can execute arbitrary code on load. A malicious model file can run `os.system("rm -rf /")` when loaded. safetensors is a simple binary format that contains only tensor metadata and raw bytes. It cannot execute code. For a system that loads models from external sources (HuggingFace Hub, user uploads), this is a non-negotiable security requirement.

**Why safetensors as primary, not GGUF**: GGUF is excellent for quantized deployment but limited as a storage format. It encodes quantization into the file format -- you cannot store full-precision weights in GGUF without waste. safetensors stores full-precision weights that can be quantized at load time to any target precision. The workflow is: store in safetensors, quantize to GGUF at deployment time for the target hardware.

**Why not ONNX as primary**: ONNX is a graph format, not a weight format. It encodes the model's computation graph alongside weights. This means ONNX files are specific to a model architecture version -- you cannot swap in new weights for the same architecture without re-exporting. safetensors stores weights independently of architecture, enabling weight-only updates.

### Quantization

Quantization reduces model size and inference cost by representing weights in lower precision. The following quantization schemes MUST be supported:

| Scheme | Bits | Block Size | Quality | Speed | Memory |
|--------|------|------------|---------|-------|--------|
| `f16` | 16 | - | Baseline | 1x | 50% of f32 |
| `INT8` | 8 | per-channel | ~99% of f16 | 1.5x | 50% of f16 |
| `GPTQ` | 4 | 128 | ~97% of f16 | 2x | 25% of f16 |
| `AWQ` | 4 | 128 | ~97% of f16 | 2x | 25% of f16 |
| `Q4_K_M` | 4.5 (avg) | 256 (super-blocks) | ~96% of f16 | 2.5x (CPU) | 27% of f16 |
| `Q5_K_M` | 5.5 (avg) | 256 (super-blocks) | ~98% of f16 | 2x (CPU) | 34% of f16 |
| `Q8_0` | 8 | 32 | ~99.5% of f16 | 1.8x (CPU) | 50% of f16 |

GPTQ and AWQ are GPU-optimized (CUDA). Q4_K_M and Q5_K_M are CPU/Metal-optimized (GGUF format). For Apple Silicon deployment, Q4_K_M provides the best quality-per-TFLOP.

### Model Architectures

The following architectures MUST have reference implementations in `candle-transformers`:

| Architecture | Type | Models | Key Operations |
|--------------|------|--------|----------------|
| **Transformer (decoder)** | Autoregressive LLM | LLaMA, Mistral, Phi, Falcon, Qwen, Zen | Causal attention, RoPE, GQA, MoE routing |
| **Transformer (encoder)** | Embedding/classification | BERT, RoBERTa, BGE, E5 | Bidirectional attention, [CLS] pooling |
| **Transformer (encoder-decoder)** | Seq2seq | T5, Whisper | Cross-attention, encoder KV cache |
| **Diffusion (UNet)** | Image generation | Stable Diffusion, SDXL | Conv2d, GroupNorm, cross-attention |
| **Diffusion (DiT)** | Image generation | Flux, SD3 | AdaLN, patchify, unpatchify |
| **Vision (ViT)** | Image understanding | CLIP, SigLIP, DINOv2, BLIP, SAM | Patch embedding, CLS token |
| **Audio (Conformer)** | Speech processing | Whisper, Encodec | Conv1d, relative attention, mel spectrogram |

### GPU Kernel Interface

Custom CUDA and Metal kernels are essential for competitive performance on quantized operations and fused attention. Candle defines a kernel interface that backend-specific code must implement:

**CUDA Kernels** (`candle-kernels/`):

```c
// Quantized matrix multiplication: dequantize Q4_K_M blocks on-the-fly
// during matmul, avoiding a separate dequantization pass.
__global__ void q4_k_m_matmul(
    const void* __restrict__ a,      // quantized weights [M, K] in Q4_K_M
    const float* __restrict__ b,     // activations [K, N] in f32
    float* __restrict__ c,           // output [M, N] in f32
    int M, int K, int N
);

// Flash Attention v2: fused softmax(QK^T/sqrt(d))V with online softmax
// and tiling for O(N) memory instead of O(N^2).
__global__ void flash_attention_v2(
    const half* __restrict__ Q, const half* __restrict__ K,
    const half* __restrict__ V, half* __restrict__ O,
    int batch, int heads, int seq_len, int head_dim
);

// Fused RMSNorm + residual add: avoids writing intermediate
// residual tensor to global memory.
__global__ void fused_rms_norm_residual(
    const float* __restrict__ input,
    const float* __restrict__ residual,
    const float* __restrict__ weight,
    float* __restrict__ output,
    float eps, int hidden_size
);
```

**Metal Kernels** (`candle-metal-kernels/`):

```metal
// Custom Q4_K_M matmul for Apple Silicon: uses threadgroup memory
// for block dequantization, achieving 2-3x over naive implementation.
kernel void q4_k_m_matmul_metal(
    device const void* a       [[buffer(0)]],
    device const float* b      [[buffer(1)]],
    device float* c            [[buffer(2)]],
    constant uint& M           [[buffer(3)]],
    constant uint& K           [[buffer(4)]],
    constant uint& N           [[buffer(5)]],
    uint2 gid                  [[thread_position_in_grid]],
    uint2 lid                  [[thread_position_in_threadgroup]]
);
```

Custom kernels are registered via the `CustomOp` trait, which allows backend-specific dispatch without modifying core tensor code:

```rust
pub trait CustomOp: Send + Sync {
    fn name(&self) -> &str;
    fn cpu_fwd(&self, storage: &CpuStorage, layout: &Layout) -> Result<(CpuStorage, Shape)>;
    fn cuda_fwd(&self, storage: &CudaStorage, layout: &Layout) -> Result<(CudaStorage, Shape)>;
    fn metal_fwd(&self, storage: &MetalStorage, layout: &Layout) -> Result<(MetalStorage, Shape)>;
}
```

### WASM Compilation Pipeline

The WASM pipeline compiles Candle to WebAssembly and packages it as an npm module for browser consumption. The full pipeline:

```
Rust source (candle-core, candle-nn, candle-transformers)
    |
    v
wasm-pack build --target web --release
    |  (compiles to wasm32-unknown-unknown, runs wasm-opt)
    v
pkg/
  candle_wasm_bg.wasm     (~2MB, gzipped ~800KB)
  candle_wasm.js          (JS bindings generated by wasm-bindgen)
  candle_wasm.d.ts        (TypeScript declarations)
    |
    v
npm publish @hanzoai/candle-wasm
```

Browser usage:

```typescript
import init, { Model } from '@hanzoai/candle-wasm';

// Initialize WASM module
await init();

// Load a quantized model (fetched as ArrayBuffer)
const weights = await fetch('/models/phi-3-mini-q4.gguf')
  .then(r => r.arrayBuffer());

const model = new Model(new Uint8Array(weights));

// Run inference
const tokens = model.encode("What is the capital of France?");
const output = model.generate(tokens, { max_tokens: 100, temperature: 0.7 });
const text = model.decode(output);
```

WASM-specific constraints:
- No GPU access: All computation runs on CPU with optional SIMD128
- Memory limit: Browsers limit WASM linear memory to 4GB (in practice, 2GB is safer)
- No filesystem: Model weights must be fetched via HTTP and loaded from `ArrayBuffer`
- No threads by default: `SharedArrayBuffer` requires COOP/COEP headers; single-threaded fallback is mandatory

### Crate Structure

```
candle/
  candle-core/           # Tensor type, DType, Device, Storage, ops
    src/
      tensor.rs          # Core Tensor struct and operations
      dtype.rs           # Data type definitions and conversions
      device.rs          # Device enum and backend dispatch
      storage.rs         # CpuStorage, CudaStorage, MetalStorage
      op.rs              # Operation enum for autograd graph
      error.rs           # CandleError type
      layout.rs          # Shape, stride, contiguity checks
      backprop.rs        # Backward pass (training only)
  candle-nn/             # Neural network layers
    src/
      linear.rs          # Linear (dense) layer
      conv.rs            # Conv1d, Conv2d
      embedding.rs       # Token/position embedding
      layer_norm.rs      # LayerNorm, RMSNorm
      activation.rs      # GELU, SiLU, ReLU
      attention.rs       # Multi-head attention, GQA, flash attention
      rotary.rs          # Rotary position embedding (RoPE)
      var_builder.rs     # Weight loading from safetensors
  candle-transformers/   # Pre-built model architectures
    src/models/
      llama.rs           # LLaMA 2/3 and derivatives
      mistral.rs         # Mistral, Mixtral (MoE)
      phi.rs             # Phi-2, Phi-3
      falcon.rs          # Falcon
      qwen.rs            # Qwen
      stable_diffusion/  # SD 1.5, SDXL, SD3
      whisper.rs         # Whisper (speech-to-text)
      clip.rs            # CLIP (vision-language)
      blip.rs            # BLIP (image captioning)
      sam.rs             # SAM (segmentation)
      bert.rs            # BERT, RoBERTa
      bge.rs             # BGE (embedding)
      quantized_llama.rs # GGUF quantized LLaMA
  candle-hamiltonian/    # Physics-informed operations
    src/
      integrators.rs     # Symplectic Euler, Leapfrog, Yoshida
      energy.rs          # Hamiltonian energy computation
      hmc.rs             # Hamiltonian Monte Carlo sampling
  candle-metal-kernels/  # Custom Metal compute shaders
    src/
      quantized.metal    # Q4/Q5 dequantization + matmul
      attention.metal    # Flash attention for Metal
      layernorm.metal    # Fused LayerNorm kernel
  candle-kernels/        # Custom CUDA kernels
    src/
      quantized.cu       # Q4/Q5 dequantization + matmul
      flash_attn.cu      # Flash attention v2
      fused_ops.cu       # Fused RMSNorm + residual
  candle-wasm/           # WASM build target and JS bindings
    src/
      lib.rs             # wasm-bindgen entry points
      model.rs           # High-level Model API for JS
    pkg/                 # wasm-pack output (gitignored)
```

### API Surface

The public API is organized into three layers:

**Layer 1: Tensor operations** (`candle-core`)

```rust
use candle_core::{Device, DType, Tensor, Result};

// Create tensors
let device = Device::Metal(0);
let x = Tensor::randn(0f32, 1.0, (2, 3), &device)?;
let w = Tensor::zeros((3, 4), DType::F32, &device)?;

// Operations
let y = x.matmul(&w)?;                    // [2, 4]
let y = y.relu()?;                         // element-wise ReLU
let y = candle_nn::ops::softmax(&y, 1)?;  // softmax over dim 1

// Device transfer
let y_cpu = y.to_device(&Device::Cpu)?;
let data: Vec<f32> = y_cpu.to_vec2()?;
```

**Layer 2: Neural network layers** (`candle-nn`)

```rust
use candle_nn::{Linear, LayerNorm, Module, VarBuilder};

// Load weights from safetensors
let vb = VarBuilder::from_safetensors(
    &["model.safetensors"],
    DType::F16,
    &Device::Cuda(0),
)?;

// Build layers
let linear = Linear::new(vb.pp("fc1"), 768, 3072)?;
let norm = LayerNorm::new(vb.pp("ln"), 768, 1e-5)?;

// Forward pass
let x = norm.forward(&input)?;
let x = linear.forward(&x)?;
```

**Layer 3: Complete models** (`candle-transformers`)

```rust
use candle_transformers::models::llama::{Llama, Config};

// Load model
let config = Config::from_file("config.json")?;
let model = Llama::load(&vb, &config)?;

// Generate
let tokens = tokenizer.encode("Hello, world")?;
let input = Tensor::new(tokens.as_slice(), &device)?;
let logits = model.forward(&input, 0)?;  // position offset = 0
let next_token = logits.argmax(D::Minus1)?;
```

## Implementation

### Repository

[github.com/hanzoai/candle](https://github.com/hanzoai/candle) -- fork of [huggingface/candle](https://github.com/huggingface/candle) with Hanzo extensions.

### Build

```bash
# CPU only (all platforms)
cargo build --release

# CUDA (NVIDIA GPUs, Linux)
cargo build --release --features cuda

# Metal (Apple Silicon, macOS)
cargo build --release --features metal

# WASM (browser/edge)
wasm-pack build candle-wasm --target web --release

# All features (development)
cargo build --release --features "cuda metal"
```

### Integration Points

| System | Integration | Details |
|--------|-------------|---------|
| **Zen Gateway** (HIP-0039) | Edge inference | Quantized Zen models served via Candle on CPU/Metal for low-latency edge nodes |
| **Studio** (HIP-0035) | Diffusion inference | Stable Diffusion / Flux pipelines run on Candle Metal backend for Apple Silicon users |
| **Jin** (HIP-0003) | Multimodal backbone | Jin model architectures implemented as Candle modules in `candle-transformers` |
| **LLM Gateway** (HIP-0004) | Local model serving | Gateway routes to local Candle inference workers for on-premise deployments |
| **Object Storage** (HIP-0032) | Model distribution | Model weights stored in safetensors/GGUF format in Hanzo Object Storage, loaded by Candle |
| **MCP** (HIP-0010) | Tool inference | MCP tool servers embed Candle for classification, embedding, and small-model inference |
| **Node** (HIP-0020) | Verified inference | Blockchain nodes use Candle for deterministic inference with reproducible outputs |
| **HMM** (HIP-0008) | Market dynamics | Hamiltonian Market Maker uses `candle-hamiltonian` for symplectic market state evolution |

### Execution Flow

```
User Request
    |
    v
Zen Gateway (HIP-0039) / LLM Gateway (HIP-0004)
    |
    v
Model Router (selects model + quantization)
    |
    v
Candle Inference Worker
    |
    +---> Tokenizer (HuggingFace tokenizers, Rust)
    |         |
    |         v
    +---> Model Forward Pass (candle-transformers)
    |         |
    |         +---> Embedding lookup
    |         +---> N x Transformer Block
    |         |         +---> RMSNorm
    |         |         +---> Multi-Head Attention (with KV cache)
    |         |         +---> RMSNorm
    |         |         +---> FFN (or MoE routing)
    |         +---> Final LayerNorm
    |         +---> LM Head (matmul to vocab)
    |         v
    +---> Sampling (temperature, top-p, top-k)
    |         |
    |         v
    +---> Detokenize
    |
    v
Response (streamed tokens)
```

### Performance Characteristics

Benchmarks on Apple M3 Max (36GB unified memory), LLaMA-2 7B:

| Configuration | Tokens/sec | Memory | Startup |
|---------------|------------|--------|---------|
| PyTorch f16 (MPS) | ~25 t/s | 14GB | 8s |
| llama.cpp Q4_K_M | ~55 t/s | 4.2GB | 0.3s |
| Candle f16 (Metal) | ~30 t/s | 13GB | 0.1s |
| Candle Q4_K_M (Metal) | ~50 t/s | 4.2GB | 0.1s |
| Candle Q4_K_M (CPU, Accelerate) | ~15 t/s | 4.2GB | 0.08s |

Benchmarks on NVIDIA A100 (80GB), LLaMA-2 7B:

| Configuration | Tokens/sec | Memory | Startup |
|---------------|------------|--------|---------|
| vLLM f16 (CUDA) | ~120 t/s | 14GB | 15s |
| Candle f16 (CUDA) | ~95 t/s | 13.5GB | 0.2s |
| Candle GPTQ-4bit (CUDA) | ~140 t/s | 4GB | 0.2s |
| TensorRT-LLM INT4 | ~180 t/s | 4GB | 30s |

Benchmarks for WASM (Chrome 120, M3 MacBook Pro), Phi-3-mini 3.8B Q4:

| Configuration | Tokens/sec | WASM Size | Model Size |
|---------------|------------|-----------|------------|
| Candle WASM (SIMD128) | ~8 t/s | 2.1MB | 2.0GB |
| Candle WASM (no SIMD) | ~3 t/s | 1.9MB | 2.0GB |
| ONNX Runtime WASM | ~5 t/s | 18MB | 2.2GB (ONNX) |

Key observations:
- Candle is not the fastest on raw throughput (TensorRT-LLM and vLLM win on GPU). Its advantage is startup time, memory efficiency, and deployment simplicity.
- On Apple Silicon, Candle with custom Metal kernels approaches llama.cpp performance while offering a much cleaner Rust API.
- For WASM deployment, Candle is the only viable option among production-quality frameworks. The WASM binary is 10x smaller than ONNX Runtime's WASM build.

### Error Handling

All operations return `candle_core::Result<T>`, which is `std::result::Result<T, candle_core::Error>`. Error variants:

```rust
pub enum Error {
    // Shape errors
    ShapeMismatch { expected: Shape, got: Shape, op: &'static str },
    UnexpectedNumberOfDims { expected: usize, got: usize },

    // Device errors
    DeviceMismatch { lhs: Device, rhs: Device, op: &'static str },
    NotAvailable(&'static str),  // e.g., "CUDA not available"

    // Type errors
    DTypeMismatch { expected: DType, got: DType, op: &'static str },
    UnsupportedDTypeForOp { dtype: DType, op: &'static str },

    // Backend errors
    Cuda(CudaError),
    Metal(MetalError),

    // I/O
    SafetensorError(safetensors::Error),
    Io(std::io::Error),

    // Generic
    Msg(String),
    Wrapped(Box<dyn std::error::Error + Send + Sync>),
}
```

Errors are precise and actionable. A `ShapeMismatch` tells you the expected shape, the actual shape, and which operation failed. No guessing.

## Security Considerations

- **Model file validation**: safetensors format is designed to be safe against arbitrary code execution (unlike pickle-based formats). GGUF files contain only tensor data and metadata. Neither format can execute code on load.
- **Memory safety**: Rust's ownership model prevents buffer overflows in tensor operations. CUDA and Metal kernels are the primary attack surface -- these are audited manually and fuzzed with random tensor shapes.
- **WASM sandboxing**: Browser-based inference runs in the WASM sandbox. The model cannot access the filesystem, network, or other browser APIs unless explicitly granted by the host application.
- **Supply chain**: The `candle-core` crate has minimal dependencies (num-traits, half, safetensors, memmap2). No transitive dependency on OpenSSL or other C libraries for the CPU backend.
- **Quantized weight integrity**: GGUF files loaded from untrusted sources MUST have their header checksums verified before tensor data is accessed. Malformed block sizes or dimension metadata could cause out-of-bounds reads in dequantization kernels.

## Backwards Compatibility

This HIP establishes the initial tensor operations standard. Future changes to the operation set MUST be additive -- existing operations MUST NOT change signature or semantics. New DTypes and backends MAY be added. Deprecation of an operation requires a new HIP.

## Test Vectors

Reference implementations MUST pass the following test cases:

```rust
#[test]
fn test_matmul_basic() {
    let a = Tensor::new(&[[1f32, 2.], [3., 4.]], &Device::Cpu).unwrap();
    let b = Tensor::new(&[[5f32, 6.], [7., 8.]], &Device::Cpu).unwrap();
    let c = a.matmul(&b).unwrap();
    assert_eq!(c.to_vec2::<f32>().unwrap(), &[[19., 22.], [43., 50.]]);
}

#[test]
fn test_softmax() {
    let x = Tensor::new(&[1f32, 2., 3.], &Device::Cpu).unwrap();
    let y = candle_nn::ops::softmax(&x, 0).unwrap();
    let vals = y.to_vec1::<f32>().unwrap();
    assert!((vals[0] - 0.0900).abs() < 1e-3);
    assert!((vals[1] - 0.2447).abs() < 1e-3);
    assert!((vals[2] - 0.6652).abs() < 1e-3);
}

#[test]
fn test_rope_embedding() {
    // RoPE must produce position-dependent embeddings
    let x = Tensor::ones((1, 1, 4, 64), DType::F32, &Device::Cpu).unwrap();
    let cos = Tensor::ones((4, 64), DType::F32, &Device::Cpu).unwrap();
    let sin = Tensor::zeros((4, 64), DType::F32, &Device::Cpu).unwrap();
    let y = candle_nn::rotary::apply_rotary_emb(&x, &cos, &sin).unwrap();
    // With cos=1, sin=0, output should equal input
    let diff = (&x - &y).unwrap().abs().unwrap().sum_all().unwrap();
    assert_eq!(diff.to_scalar::<f32>().unwrap(), 0.0);
}

#[test]
fn test_device_transfer() {
    let x = Tensor::randn(0f32, 1.0, (2, 3), &Device::Cpu).unwrap();
    // Round-trip through another device should preserve values
    let x2 = x.to_device(&Device::Cpu).unwrap();
    let diff = (x - x2).unwrap().abs().unwrap().sum_all().unwrap();
    assert_eq!(diff.to_scalar::<f32>().unwrap(), 0.0);
}

#[test]
fn test_symplectic_energy_conservation() {
    // Symplectic integrator must conserve energy to within numerical precision
    let q = Tensor::new(&[1.0f64, 0.0], &Device::Cpu).unwrap();
    let p = Tensor::new(&[0.0f64, 1.0], &Device::Cpu).unwrap();
    let h0 = hamiltonian_energy(&q, &p, harmonic_potential, None).unwrap();
    let (q1, p1) = leapfrog_step(&q, &p, harmonic_grad, 0.01, 1000).unwrap();
    let h1 = hamiltonian_energy(&q1, &p1, harmonic_potential, None).unwrap();
    let drift = (h1 - h0).unwrap().abs().unwrap().to_scalar::<f64>().unwrap();
    assert!(drift < 1e-6, "Energy drift {} exceeds tolerance", drift);
}

#[test]
fn test_quantized_load() {
    // GGUF quantized model must load and produce valid logits
    let model = QuantizedLlama::load("test_model.gguf", &Device::Cpu).unwrap();
    let input = Tensor::new(&[1u32, 2, 3], &Device::Cpu).unwrap();
    let logits = model.forward(&input, 0).unwrap();
    assert_eq!(logits.dims(), &[1, 3, VOCAB_SIZE]);
    // Logits must be finite
    assert!(logits.to_vec3::<f32>().unwrap().iter()
        .all(|batch| batch.iter().all(|seq| seq.iter().all(|v| v.is_finite()))));
}
```

## References

1. [HIP-0002: Hamiltonian Large Language Models](./hip-0002-hamiltonian-large-language-models-hllms-specification.md)
2. [HIP-0003: Jin Multimodal AI Architecture](./hip-0003-jin-multimodal-ai-architecture.md)
3. [HIP-0004: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md)
4. [HIP-0007: Active Inference Integration](./hip-0007-active-inference-integration-for-hamiltonian-llms.md)
5. [HIP-0008: HMM Hanzo Market Maker](./hip-0008-hmm-hanzo-market-maker-native-dex-for-ai-compute-resources.md)
6. [HIP-0010: Model Context Protocol](./hip-0010-model-context-protocol-mcp-integration-standards.md)
7. [HIP-0020: Blockchain Node Standard](./hip-0020-blockchain-node-standard.md)
8. [HIP-0032: Object Storage Standard](./hip-0032-object-storage-standard.md)
9. [HIP-0035: Image & Video Generation Standard](./hip-0035-image-video-generation-standard.md)
10. [HIP-0039: Zen Model Architecture](./hip-0039-zen-model-architecture.md)
11. [HuggingFace Candle](https://github.com/huggingface/candle) -- upstream repository
12. [safetensors format](https://huggingface.co/docs/safetensors/) -- model serialization standard
13. [GGUF format](https://github.com/ggerganov/ggml/blob/master/docs/gguf.md) -- quantized model format
14. [Leapfrog integration](https://en.wikipedia.org/wiki/Leapfrog_integration) -- symplectic integrator theory

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
