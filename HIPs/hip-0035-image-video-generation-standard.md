---
hip: 0035
title: Image & Video Generation Standard
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2025-01-15
requires: HIP-0004, HIP-0019
---

# HIP-35: Image & Video Generation Standard

## Abstract

This proposal defines the standard for visual AI generation workflows across the Hanzo ecosystem, encompassing image generation, video synthesis, and 3D asset creation. It specifies two complementary interfaces: **Hanzo Studio**, a node-based visual programming environment for composing diffusion pipelines, and **Hanzo Painter**, a simplified prompt-to-image interface for casual generation. Both share a common backend compute layer with queue-based GPU scheduling.

**Repositories**:
- Studio: [github.com/hanzoai/studio](https://github.com/hanzoai/studio)
- Painter: [github.com/hanzoai/painter](https://github.com/hanzoai/painter)

**Ports**:
- Studio: 8188 (ComfyUI default)
- Painter: 3035

**Docker**:
- `hanzoai/studio:latest`
- `hanzoai/painter:latest`

## Motivation

Visual AI generation is converging on diffusion-based architectures (Stable Diffusion, Flux, DALL-E). However, the tooling landscape is fragmented:

1. **No composability**: Most generation UIs expose a single pipeline -- prompt in, image out. There is no way to chain ControlNet, IP-Adapter, LoRA, upscaling, and inpainting into a reproducible workflow.
2. **No reproducibility**: Generation parameters are scattered across UI sliders. Recreating a result requires screenshotting settings or manually recording every parameter.
3. **Vendor lock-in**: Cloud APIs (Replicate, RunPod, Midjourney) charge per-inference and add cold-start latency. At production scale, this is unsustainable.
4. **Skill gap**: Power users want node graphs and fine-grained control. Casual users want a text box and a "Generate" button. One UI cannot serve both.
5. **No integration with Hanzo compute**: Generated images should flow into Hanzo's object storage (HIP-0032), billing (HIP-0004), and analytics pipelines without manual glue.

## Design Philosophy

This section explains the architectural reasoning behind every major decision. These are not arbitrary choices -- each one follows from a specific constraint or tradeoff.

### Why ComfyUI Over Automatic1111 or Fooocus

The core question is: **what is the right abstraction for a diffusion pipeline?**

**Automatic1111 (A1111)** treats the pipeline as a monolithic function: you configure a set of global parameters (model, sampler, steps, CFG scale, seed) and get an image. Extensions bolt on additional features (ControlNet, LoRA) through a plugin system, but the execution graph is implicit and hardcoded. You cannot, for example, route the output of one sampler into the ControlNet input of another sampler in the same generation. The pipeline topology is fixed.

**Fooocus** goes further in the simplicity direction: it hides most parameters behind "presets" and focuses on prompt quality. This is excellent for casual users, but it is a dead end for anyone who needs custom pipelines. There is no extension point for novel architectures.

**ComfyUI** takes the opposite approach: the diffusion pipeline is an explicit directed acyclic graph (DAG) of nodes. Each node performs one operation -- load a model, encode a prompt, sample latents, decode to pixels, apply ControlNet conditioning. The user wires nodes together visually. This has three critical consequences:

1. **Composability**: Any pipeline topology is expressible. ControlNet + IP-Adapter + LoRA merging + two-pass sampling + upscaling is just a graph, not a special mode.
2. **Reproducibility**: The entire graph, including every parameter on every node, is serialized as a single JSON document. Sharing a workflow means sharing a file. Version control works.
3. **Extensibility**: Adding a new model architecture means adding a new node type. The execution engine does not change. This is why ComfyUI supported Flux, SD3, and SDXL-Turbo within days of release.

The tradeoff is complexity: ComfyUI's UI is intimidating for beginners. This is why we split into Studio (full node graph) and Painter (simplified UI). Painter is a thin client that submits pre-built workflow templates to Studio's API.

### Why Self-Hosted Over Cloud APIs

Consider the economics of image generation at scale:

| Approach | Cost per image | Cold start | Control |
|----------|---------------|------------|---------|
| Replicate (SDXL) | $0.0023 | 2-10s | None |
| RunPod Serverless | $0.0019 | 3-15s | Limited |
| Midjourney | $0.01-0.04 | 0s (queued) | None |
| Self-hosted (A100) | $0.0002-0.0005 | 0s | Full |

At 10,000 generations/day, self-hosted saves $5,000-15,000/month. At 100,000/day, the savings are transformative. Self-hosting also eliminates cold starts (models stay loaded in VRAM), enables custom model merges and LoRAs, and keeps generated content on our infrastructure.

The tradeoff is operational complexity: we must manage GPU hardware, model storage, and queue scheduling. This is acceptable because Hanzo already operates GPU infrastructure for LLM inference (HIP-0004).

### Why Separate Studio and Painter

These serve fundamentally different user populations:

**Studio users** (artists, researchers, pipeline engineers):
- Want full control over every node and parameter
- Build custom workflows with novel architectures
- Experiment with LoRA combinations, ControlNet conditioning, multi-pass generation
- Need the node graph interface

**Painter users** (content creators, marketers, developers):
- Want to type a prompt and get an image
- May adjust style, aspect ratio, and model -- but not sampler settings
- Need a clean, fast interface with good defaults
- Should not see nodes, latent spaces, or VAE configurations

Same backend, different frontends. Painter submits workflows to Studio's `/api/prompt` endpoint using pre-built templates. This means every Painter generation is a valid Studio workflow and can be "opened in Studio" for fine-tuning.

### Why Candle Integration (HIP-0019)

Not every generation target has an NVIDIA GPU. For development, previewing, and lightweight generation on macOS (Apple Silicon) or CPU-only servers, we need a Python/PyTorch-free inference path.

Candle (HIP-0019) provides Rust-native tensor operations with Metal and CPU backends. Studio can route inference to either:
- **PyTorch backend**: Full-speed generation on NVIDIA GPUs (CUDA)
- **Candle backend**: Portable generation on CPU/Metal without Python

This dual-backend approach means Studio runs natively on a MacBook for development and on an A100 cluster for production, with the same workflow JSON.

## Specification

### Node Graph Architecture

The execution model is a directed acyclic graph (DAG) where each node represents a discrete operation:

```
┌──────────────┐     ┌───────────────┐     ┌──────────────┐
│  Load SDXL   │────▶│ CLIP Encode   │────▶│   KSampler   │
│  Checkpoint  │     │  (Positive)   │     │              │
└──────────────┘     └───────────────┘     │  model ──────│
                                            │  positive ───│
┌──────────────┐     ┌───────────────┐     │  negative ───│
│ Empty Latent │────▶│               │────▶│  latent ─────│
│   Image      │     │ CLIP Encode   │     └──────┬───────┘
└──────────────┘     │  (Negative)   │            │
                     └───────────────┘            ▼
                                           ┌──────────────┐
                                           │  VAE Decode  │
                                           └──────┬───────┘
                                                  │
                                                  ▼
                                           ┌──────────────┐
                                           │  Save Image  │
                                           └──────────────┘
```

#### Node Interface

```typescript
interface NodeDefinition {
  // Unique node type identifier
  type: string;

  // Human-readable display name
  display_name: string;

  // Category for UI grouping
  category: string;

  // Input slots
  inputs: Record<string, {
    type: DataType;
    required: boolean;
    default?: any;
    tooltip?: string;
    // For numeric inputs
    min?: number;
    max?: number;
    step?: number;
    // For enum inputs
    options?: string[];
  }>;

  // Output slots
  outputs: Record<string, {
    type: DataType;
  }>;

  // Execution function identifier
  function: string;
}

type DataType =
  | "MODEL"          // Diffusion model
  | "CLIP"           // Text encoder
  | "VAE"            // Variational autoencoder
  | "CONDITIONING"   // Encoded text/image conditioning
  | "LATENT"         // Latent space tensor
  | "IMAGE"          // Decoded pixel image (RGB float32)
  | "MASK"           // Single-channel mask
  | "CONTROL_NET"    // ControlNet model
  | "LORA"           // LoRA weights
  | "INT"            // Integer parameter
  | "FLOAT"          // Float parameter
  | "STRING"         // Text parameter
  | "BOOLEAN";       // Boolean parameter
```

#### Workflow Format

Workflows are serialized as JSON for storage, versioning, and sharing:

```json
{
  "version": 1,
  "nodes": {
    "1": {
      "type": "CheckpointLoaderSimple",
      "inputs": {
        "ckpt_name": "sdxl_base_1.0.safetensors"
      }
    },
    "2": {
      "type": "CLIPTextEncode",
      "inputs": {
        "text": "a photorealistic mountain landscape at sunset",
        "clip": ["1", "CLIP"]
      }
    },
    "3": {
      "type": "CLIPTextEncode",
      "inputs": {
        "text": "blurry, low quality, watermark",
        "clip": ["1", "CLIP"]
      }
    },
    "4": {
      "type": "EmptyLatentImage",
      "inputs": {
        "width": 1024,
        "height": 1024,
        "batch_size": 1
      }
    },
    "5": {
      "type": "KSampler",
      "inputs": {
        "model": ["1", "MODEL"],
        "positive": ["2", "CONDITIONING"],
        "negative": ["3", "CONDITIONING"],
        "latent_image": ["4", "LATENT"],
        "seed": 42,
        "steps": 30,
        "cfg": 7.5,
        "sampler_name": "euler_ancestral",
        "scheduler": "karras",
        "denoise": 1.0
      }
    },
    "6": {
      "type": "VAEDecode",
      "inputs": {
        "samples": ["5", "LATENT"],
        "vae": ["1", "VAE"]
      }
    },
    "7": {
      "type": "SaveImage",
      "inputs": {
        "images": ["6", "IMAGE"],
        "filename_prefix": "hanzo_gen"
      }
    }
  }
}
```

### Model Format Support

```yaml
Formats:
  safetensors:
    description: Primary format. Memory-mapped, fast loading, no pickle exploits.
    extensions: [".safetensors"]
    recommended: true

  GGUF:
    description: Quantized format for reduced VRAM usage.
    extensions: [".gguf"]
    use_case: Running large models on consumer GPUs (8-16GB VRAM).

  ONNX:
    description: Cross-platform inference format.
    extensions: [".onnx"]
    use_case: Candle backend, DirectML (Windows), CoreML (macOS).
```

### Supported Architectures

```yaml
Image Generation:
  Stable Diffusion 1.5:
    resolution: 512x512
    vram: 4GB minimum
    status: Legacy, widely supported
    lora_compatible: true

  Stable Diffusion XL:
    resolution: 1024x1024
    vram: 8GB minimum
    status: Production standard
    lora_compatible: true
    refiner: Optional two-stage pipeline

  Stable Diffusion 3 / 3.5:
    resolution: 1024x1024
    vram: 12GB minimum
    status: Current generation
    text_encoders: [CLIP-L, CLIP-G, T5-XXL]
    architecture: MMDiT (Multi-Modal Diffusion Transformer)

  Flux:
    resolution: Up to 2048x2048
    vram: 12-24GB
    status: Current generation
    variants: [dev, schnell, pro]
    architecture: Rectified flow transformer
    lora_compatible: true

Video Generation:
  Stable Video Diffusion (SVD):
    input: Single image
    output: 14-25 frames
    resolution: 576x1024
    vram: 16GB minimum

  AnimateDiff:
    input: Text prompt or image + motion module
    output: 16-32 frames
    resolution: 512x512
    vram: 12GB minimum

  CogVideo:
    input: Text prompt
    output: Up to 6 seconds
    resolution: 480x720
    vram: 24GB minimum

External Proxies:
  DALL-E 3:
    type: API proxy via HIP-0004
    resolution: 1024x1024, 1024x1792, 1792x1024
    note: Routed through LLM Gateway, billed per generation
```

### LoRA, ControlNet, and IP-Adapter

These are the three primary conditioning mechanisms for guiding generation beyond text prompts:

```yaml
LoRA (Low-Rank Adaptation):
  purpose: Fine-tuned style or subject weights merged at inference time
  format: safetensors
  application: Merged into MODEL before sampling
  stacking: Multiple LoRAs can be applied with independent strength weights
  example_node: LoraLoader
    inputs:
      model: MODEL
      clip: CLIP
      lora_name: "pixel_art_v2.safetensors"
      strength_model: 0.8
      strength_clip: 0.8

ControlNet:
  purpose: Spatial conditioning from reference images (edges, depth, pose)
  preprocessors:
    - Canny (edge detection)
    - Depth (MiDaS, Zoe)
    - OpenPose (human skeleton)
    - Scribble (hand-drawn guides)
    - Tile (detail preservation for upscaling)
    - Inpainting (masked region fill)
  application: Injected as additional conditioning into the sampler
  example_node: ControlNetApply
    inputs:
      conditioning: CONDITIONING
      control_net: CONTROL_NET
      image: IMAGE (preprocessed reference)
      strength: 0.75

IP-Adapter:
  purpose: Image-prompt conditioning (style transfer from reference images)
  application: Encodes a reference image into CLIP embedding space
  variants: [ip-adapter, ip-adapter-plus, ip-adapter-face]
  example_node: IPAdapterApply
    inputs:
      model: MODEL
      image: IMAGE (reference)
      weight: 0.7
      noise: 0.3
```

### API Specification

#### Queue a Workflow

```yaml
POST /api/prompt
Headers:
  Authorization: Bearer <token>
  Content-Type: application/json
Body:
  client_id: string          # WebSocket client ID for progress updates
  prompt: WorkflowJSON       # The node graph (see Workflow Format above)
  extra_data:
    extra_pnginfo:           # Metadata embedded in output PNG
      workflow: WorkflowJSON
Response:
  prompt_id: string          # UUID for tracking
  number: integer            # Queue position
  node_errors: {}            # Validation errors (empty if valid)
```

#### Check Queue Status

```yaml
GET /api/queue
Response:
  queue_running:             # Currently executing
    - prompt_id: string
      workflow: WorkflowJSON
      started: timestamp
  queue_pending:             # Waiting for GPU
    - prompt_id: string
      number: integer
      queued: timestamp
```

#### Get Generation History

```yaml
GET /api/history
Query:
  prompt_id?: string         # Filter by specific generation
  max_items?: integer        # Pagination (default: 200)
Response:
  <prompt_id>:
    prompt: WorkflowJSON
    outputs:
      <node_id>:
        images:
          - filename: string
            subfolder: string
            type: "output"
    status:
      status_str: "success" | "error"
      completed: boolean
      messages: [[timestamp, message], ...]
```

#### Retrieve Generated Image

```yaml
GET /api/view
Query:
  filename: string
  subfolder?: string
  type: "output" | "input" | "temp"
Response:
  Content-Type: image/png | image/jpeg | image/webp
  Body: Raw image bytes
```

#### WebSocket Progress

```yaml
WS /ws?clientId=<client_id>

# Server -> Client messages:

# Execution started
{"type": "execution_start", "data": {"prompt_id": "..."}}

# Node execution progress
{"type": "progress", "data": {"value": 15, "max": 30, "prompt_id": "..."}}

# Node execution complete
{"type": "executed", "data": {"node": "5", "output": {"images": [...]}}}

# Full execution complete
{"type": "execution_complete", "data": {"prompt_id": "..."}}

# Error during execution
{"type": "execution_error", "data": {"prompt_id": "...", "node_id": "5", "exception_message": "..."}}
```

### Output Formats

```yaml
Images:
  PNG:
    default: true
    metadata: Workflow JSON embedded in PNG tEXt chunk
    use_case: Lossless, preserves workflow for re-import
  JPEG:
    quality: 85-95
    use_case: Web delivery, smaller file size
  WebP:
    quality: 80-95
    use_case: Web delivery, best compression ratio

Video:
  MP4:
    codec: H.264 or H.265
    fps: 8-30 (configurable)
    use_case: Standard video delivery
  GIF:
    use_case: Short animations, social media
    max_frames: 64
  WebM:
    codec: VP9
    use_case: Web-optimized video
```

### Painter API (Simplified Interface)

Painter exposes a high-level API that maps to Studio workflows internally:

```yaml
POST /api/generate
Headers:
  Authorization: Bearer <token>
Body:
  prompt: string              # Positive prompt
  negative_prompt?: string    # Negative prompt (default: quality negatives)
  model?: string              # Model name (default: "flux-schnell")
  width?: integer             # Output width (default: 1024)
  height?: integer            # Output height (default: 1024)
  steps?: integer             # Sampling steps (default: model-dependent)
  cfg_scale?: float           # Classifier-free guidance (default: 7.0)
  seed?: integer              # Seed for reproducibility (-1 for random)
  style?: string              # Style preset name
  num_images?: integer        # Batch count (1-4, default: 1)
  reference_image?: string    # URL or base64 for IP-Adapter
  control_image?: string      # URL or base64 for ControlNet
  control_type?: string       # "canny" | "depth" | "pose" | "scribble"
Response:
  generation_id: string
  images:
    - url: string
      width: integer
      height: integer
      seed: integer
      workflow_id: string     # Can be opened in Studio
  usage:
    model: string
    steps: integer
    compute_ms: integer
    cost_credits: float
```

## Implementation

### System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         Clients                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │  Studio   │  │ Painter  │  │   API    │  │  MCP Tool      │  │
│  │  (Nodes)  │  │  (React) │  │ Clients  │  │ (HIP-0010)     │  │
│  └─────┬─────┘  └────┬─────┘  └────┬─────┘  └───────┬────────┘  │
└────────┼──────────────┼─────────────┼────────────────┼───────────┘
         │              │             │                │
         ▼              ▼             ▼                ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Studio API Server (:8188)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Workflow      │  │  Prompt      │  │   Model Manager        │ │
│  │ Validator     │  │  Queue       │  │   (load/unload/cache)  │ │
│  └──────────────┘  └──────┬───────┘  └────────────────────────┘ │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                    GPU Worker Pool                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ Worker 0 │  │ Worker 1 │  │ Worker 2 │  │ Worker N │        │
│  │ A100 80G │  │ A100 80G │  │ RTX 4090 │  │ (Candle) │        │
│  │ PyTorch  │  │ PyTorch  │  │ PyTorch  │  │ CPU/Metal│        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
└──────────────────────────────────────────────────────────────────┘
         │              │             │                │
         ▼              ▼             ▼                ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Storage Layer                                  │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────┐    │
│  │ Model Storage │  │ Output Storage│  │ Workflow Storage  │    │
│  │ (S3/MinIO)   │  │ (S3/MinIO)   │  │ (PostgreSQL)      │    │
│  │ safetensors   │  │ PNG/MP4      │  │ JSON documents    │    │
│  └───────────────┘  └───────────────┘  └───────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

### GPU Scheduling

The prompt queue implements a priority-based FIFO scheduler:

```python
class GPUScheduler:
    """
    Assigns queued prompts to available GPU workers.
    Workers are selected based on VRAM capacity and loaded models.
    """
    def schedule(self, prompt: QueuedPrompt) -> Worker:
        # 1. Determine required models from workflow
        required_models = self.extract_models(prompt.workflow)
        total_vram = self.estimate_vram(required_models)

        # 2. Prefer worker that already has models loaded (avoid reload)
        for worker in self.workers:
            if worker.has_models_loaded(required_models):
                return worker

        # 3. Find worker with sufficient free VRAM
        for worker in self.available_workers():
            if worker.free_vram >= total_vram:
                return worker

        # 4. If no worker fits, queue for next available
        return self.enqueue_waiting(prompt)

    def estimate_vram(self, models: list[str]) -> int:
        """
        SDXL base: ~6.5GB
        SDXL refiner: ~6.5GB
        Flux dev: ~12GB (fp16) or ~6GB (fp8)
        ControlNet: ~1.5GB each
        LoRA: ~200MB each (merged, no extra VRAM at inference)
        T5-XXL: ~10GB (fp16) or ~5GB (fp8)
        """
        return sum(self.model_vram_map[m] for m in models)
```

### Model Storage

Models are stored in Object Storage (S3/MinIO) and cached locally on GPU workers:

```yaml
Storage Layout:
  s3://hanzo-models/
    checkpoints/
      sdxl_base_1.0.safetensors        # 6.94GB
      flux1-dev.safetensors             # 23.8GB (fp16)
      flux1-dev-fp8.safetensors         # 11.9GB (fp8)
      sd3.5_large.safetensors           # 16.5GB
    loras/
      pixel_art_v2.safetensors          # 150MB
      film_grain.safetensors            # 200MB
    controlnet/
      control_v11p_sd15_canny.safetensors
      controlnet-sdxl-depth.safetensors
    vae/
      sdxl_vae.safetensors
    clip/
      t5xxl_fp16.safetensors
    upscale/
      4x-UltraSharp.pth

Worker Local Cache:
  /models/                               # Fast NVMe SSD
    checkpoints/                         # Most-used models pinned
    loras/                               # LRU eviction
    controlnet/
  Cache Policy:
    max_size: 200GB per worker
    eviction: LRU with pinning support
    prefetch: Preload models referenced in queued prompts
```

### Hanzo Custom Nodes

Studio ships with Hanzo-specific custom nodes that integrate with the broader ecosystem:

```yaml
Custom Nodes:
  HanzoModelLoader:
    description: Load models from Hanzo Object Storage with automatic caching
    inputs:
      model_id: STRING    # Hanzo model registry ID
      precision: ENUM     # fp32, fp16, fp8, int8
    outputs:
      model: MODEL
      clip: CLIP
      vae: VAE

  HanzoSaveToStorage:
    description: Save output directly to Hanzo Object Storage
    inputs:
      images: IMAGE
      bucket: STRING
      path: STRING
      format: ENUM        # png, jpeg, webp

  HanzoContentFilter:
    description: NSFW detection gate -- blocks unsafe content
    inputs:
      images: IMAGE
      threshold: FLOAT    # 0.0-1.0 (default: 0.85)
    outputs:
      safe_images: IMAGE
      flagged: BOOLEAN

  HanzoBillingMeter:
    description: Records compute usage for billing via HIP-0004
    inputs:
      images: IMAGE       # Pass-through
      user_id: STRING
      model_name: STRING
      steps: INT
    outputs:
      images: IMAGE       # Unchanged pass-through

  HanzoWatermark:
    description: Optional invisible watermark for provenance tracking
    inputs:
      images: IMAGE
      metadata: STRING    # JSON metadata to embed
    outputs:
      images: IMAGE
```

### Deployment

#### Docker Compose (Development)

```yaml
services:
  studio:
    image: hanzoai/studio:latest
    ports:
      - "8188:8188"
    volumes:
      - ./models:/models
      - ./output:/output
      - ./workflows:/workflows
    environment:
      - HANZO_API_KEY=${HANZO_API_KEY}
      - S3_ENDPOINT=${S3_ENDPOINT}
      - S3_ACCESS_KEY=${S3_ACCESS_KEY}
      - S3_SECRET_KEY=${S3_SECRET_KEY}
      - S3_MODEL_BUCKET=hanzo-models
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]

  painter:
    image: hanzoai/painter:latest
    ports:
      - "3035:3035"
    environment:
      - STUDIO_URL=http://studio:8188
      - HANZO_API_KEY=${HANZO_API_KEY}
      - DATABASE_URL=postgresql://user:pass@db:5432/painter
    depends_on:
      - studio

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=painter
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
    volumes:
      - painter_data:/var/lib/postgresql/data

volumes:
  painter_data:
```

#### Kubernetes (Production)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: studio-worker
  namespace: hanzo
spec:
  replicas: 3
  selector:
    matchLabels:
      app: studio-worker
  template:
    metadata:
      labels:
        app: studio-worker
    spec:
      containers:
      - name: studio
        image: hanzoai/studio:latest
        ports:
        - containerPort: 8188
        resources:
          limits:
            nvidia.com/gpu: 1
            memory: "32Gi"
          requests:
            nvidia.com/gpu: 1
            memory: "24Gi"
        volumeMounts:
        - name: model-cache
          mountPath: /models
        env:
        - name: HANZO_API_KEY
          valueFrom:
            secretKeyRef:
              name: hanzo-secrets
              key: api-key
      nodeSelector:
        gpu-type: a100
      volumes:
      - name: model-cache
        hostPath:
          path: /mnt/nvme/models
          type: DirectoryOrCreate
```

## Security Considerations

### Content Moderation

All generated images pass through the `HanzoContentFilter` node before delivery:

1. **NSFW Detection**: Multi-label classifier (nudity, violence, hate symbols) with configurable threshold
2. **Prompt Filtering**: Blocklist + semantic similarity check against known harmful prompts
3. **Watermarking**: Optional invisible watermark encoding generation metadata (user, timestamp, model, prompt hash) for provenance tracking
4. **Audit Log**: Every generation is logged with prompt, parameters, user ID, and moderation result

### Rate Limiting

```yaml
Tiers:
  free:
    generations_per_day: 50
    max_resolution: 1024x1024
    max_steps: 30
    max_batch: 1
    models: [flux-schnell, sdxl]

  pro:
    generations_per_day: 1000
    max_resolution: 2048x2048
    max_steps: 50
    max_batch: 4
    models: all
    priority_queue: true

  enterprise:
    generations_per_day: unlimited
    max_resolution: 4096x4096
    max_steps: 100
    max_batch: 8
    models: all
    priority_queue: true
    dedicated_gpu: optional
```

### Model Provenance

Every model in the registry includes:
- **Source**: Original model card URL (HuggingFace, Civitai)
- **License**: SPDX identifier (CreativeML-OpenRAIL-M, Apache-2.0, etc.)
- **SHA-256**: Hash of the safetensors file for integrity verification
- **Scan status**: Result of malware/pickle scan (safetensors files are inherently safe; .ckpt files are scanned)

### Input Validation

- Maximum prompt length: 10,000 characters
- Maximum workflow size: 1MB JSON
- Maximum node count per workflow: 500
- Image upload limits: 20MB per image, PNG/JPEG/WebP only
- All user-provided file paths are sandboxed to prevent directory traversal

## Performance Targets

```yaml
Image Generation:
  SDXL 1024x1024 30 steps (A100): < 3 seconds
  Flux schnell 1024x1024 4 steps (A100): < 2 seconds
  Flux dev 1024x1024 30 steps (A100): < 8 seconds

Video Generation:
  SVD 14 frames 576x1024 (A100): < 30 seconds
  AnimateDiff 16 frames 512x512 (A100): < 15 seconds

Queue:
  Time to first byte (prompt submission to WebSocket ack): < 100ms
  Queue throughput: > 100 generations/minute per A100

Storage:
  Model load time (NVMe cache hit): < 5 seconds
  Model load time (S3 fetch, 10GB model): < 60 seconds
  Output image delivery (S3): < 200ms
```

## Integration Points

```
HIP-0004 (LLM Gateway)  ──▶  DALL-E proxy, prompt enhancement via LLM
HIP-0010 (MCP)           ──▶  "generate_image" tool for AI agents
HIP-0013 (Workflows)     ──▶  Image generation as workflow step
HIP-0017 (Analytics)     ──▶  Generation events, usage metrics
HIP-0018 (Payments)      ──▶  Credit billing per generation
HIP-0019 (Candle)        ──▶  Rust inference backend for CPU/Metal
HIP-0032 (Storage)       ──▶  Model weights and output image storage
```

## References

1. [ComfyUI Documentation](https://docs.comfy.org/)
2. [Stable Diffusion Paper (Rombach et al., 2022)](https://arxiv.org/abs/2112.10752)
3. [Flux Architecture (Black Forest Labs)](https://blackforestlabs.ai/)
4. [ControlNet (Zhang et al., 2023)](https://arxiv.org/abs/2302.05543)
5. [IP-Adapter (Ye et al., 2023)](https://arxiv.org/abs/2308.06721)
6. [LoRA (Hu et al., 2021)](https://arxiv.org/abs/2106.09685)
7. [HIP-4: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md)
8. [HIP-19: Tensor Operations Standard](./hip-0019-tensor-operations-standard.md)
9. [Hanzo Studio Repository](https://github.com/hanzoai/studio)
10. [Hanzo Painter Repository](https://github.com/hanzoai/painter)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
