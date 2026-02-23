---
hip: 0057
title: ML Pipeline & Training Standard
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-02-23
---

# HIP-57: ML Pipeline & Training Standard

## Abstract

This proposal defines the ML Pipeline standard for end-to-end machine learning lifecycle management in the Hanzo ecosystem. Hanzo ML covers training, fine-tuning, evaluation, and deployment of models -- everything that happens *before* a model is served by the Inference Engine (HIP-0043). It provides distributed training orchestration across GPU clusters, dataset versioning and preprocessing, experiment tracking, hyperparameter optimization, a model registry for versioned artifacts, and fine-tuning pipelines purpose-built for Zen models.

The system is designed as a lightweight, AI-native alternative to Kubeflow and MLflow. It integrates directly with Hanzo Object Storage (HIP-0032) for training data and checkpoints, Hanzo Stream (HIP-0030) for training event logging, the Container Registry (HIP-0033) for model artifact distribution, and the Candle tensor library (HIP-0019) for Rust-accelerated training utilities.

**Repository**: [github.com/hanzoai/ml](https://github.com/hanzoai/ml)
**Port**: 8057 (API)
**Binary**: `hanzo-ml`
**Container**: `hanzoai/ml:latest`

## Motivation

HIP-0043 defines how trained models are served for inference. HIP-0039 defines the Zen model family. Neither specifies how models are trained, how training datasets are managed, how experiments are tracked, or how fine-tuned model artifacts flow from a training cluster to the inference engine. That is the domain of the ML Pipeline.

Production ML training has concrete problems:

1. **Training runs are expensive and irreproducible.** A single Zen-72b fine-tuning run costs $5,000-$50,000 in GPU hours. When a run fails at 80% completion because a checkpoint was not saved, or when a researcher cannot reproduce a result because the dataset version changed, money is burned with nothing to show for it. The pipeline must checkpoint aggressively, version everything, and make every run fully reproducible from its configuration alone.

2. **GPU clusters are shared and underutilized.** Multiple teams fine-tune different models on the same GPU cluster. Without centralized scheduling, teams hoard GPUs they are not using, while other teams wait in a queue. The pipeline must schedule training jobs across available GPUs with fair-share policies, preemption for high-priority runs, and gang scheduling for distributed training.

3. **Dataset management is ad hoc.** Researchers store training data in personal directories, S3 buckets without versioning, or shared NFS mounts with no access control. When a model's training data is questioned -- "What data was this model trained on? Was PII included?" -- there is no audit trail. The pipeline must version datasets, track lineage from raw data to training splits, and enforce access policies.

4. **Experiment tracking is fragmented.** Some researchers use Weights & Biases, some use MLflow, some use TensorBoard, some use spreadsheets. There is no single place to compare runs, identify the best checkpoint, or trace a deployed model back to its training configuration. The pipeline must provide a unified experiment tracking API that all training code reports to.

5. **Fine-tuning Zen models requires specific infrastructure.** LoRA, QLoRA, and full fine-tuning each have different memory profiles, optimizer states, and checkpoint formats. A QLoRA fine-tune of zen-72b requires 4-bit base weights plus FP16 adapter weights plus optimizer states -- this must fit in a specific GPU memory budget. The pipeline must provide pre-configured fine-tuning recipes for each Zen model size and technique.

6. **The training-to-serving gap is manual.** After training completes, someone downloads the checkpoint, converts it to the right format, uploads it to the model registry, updates the inference engine configuration, and triggers a deployment. Each manual step is an opportunity for error. The pipeline must automate the path from "training complete" to "model serving traffic."

## Design Philosophy

### Why a Custom Pipeline over Kubeflow

Kubeflow is the standard open-source ML platform. It provides pipelines, experiment tracking, model serving, and notebook management on Kubernetes. So why build a custom pipeline?

**Kubeflow is a platform, not a library.** Installing Kubeflow adds 30+ Kubernetes resources: Istio service mesh, Knative serving, Argo Workflows, Katib for hyperparameter tuning, KFServing, Jupyter controllers, and a complex UI. Each component has its own CRDs, its own RBAC policies, and its own failure modes. When a training pipeline fails, debugging requires understanding the interaction between Argo, Kubernetes, and Istio -- three systems that the ML engineer did not sign up for.

Hanzo ML is a single binary with a REST API. It schedules training jobs directly on Kubernetes without intermediate workflow engines. It stores metadata in PostgreSQL (HIP-0029) without requiring a separate metadata store. It tracks experiments through its own API without requiring MLflow or Katib as dependencies. The total installation is one Deployment, one Service, and one ConfigMap.

**Kubeflow does not understand Hanzo infrastructure.** Kubeflow stores artifacts in its own S3 buckets, tracks experiments in its own MySQL instance, and serves models through KFServing. Hanzo already has Object Storage (HIP-0032), a relational database (HIP-0029), event streaming (HIP-0030), and an inference engine (HIP-0043). Adding Kubeflow would create parallel infrastructure that duplicates what already exists and does not integrate with Hanzo IAM, billing, or observability.

**Kubeflow's pipeline DSL is Python-heavy and opinionated.** Kubeflow Pipelines uses a Python DSL that compiles to Argo Workflow YAML. This is a leaky abstraction -- when something goes wrong, you debug YAML, not Python. Hanzo ML pipelines are defined as declarative YAML configurations that map directly to Kubernetes Jobs. There is no compilation step, no intermediate representation, and no hidden state.

The tradeoff is feature breadth. Kubeflow supports dozens of ML frameworks, notebook environments, and model serving backends. Hanzo ML supports exactly the workflows that matter for the Hanzo ecosystem: training and fine-tuning Zen models, with integration points to existing Hanzo infrastructure. This narrower scope means fewer moving parts and faster iteration.

### Why MLflow-Compatible API

Despite building a custom pipeline, we expose an MLflow-compatible experiment tracking API. This is a pragmatic choice:

- Researchers already know the MLflow API. `mlflow.log_metric("loss", 0.42)` is muscle memory for anyone who has used MLflow.
- Existing training scripts can migrate by changing the tracking URI, not the logging calls.
- MLflow's UI is well-designed for experiment comparison. We can support the MLflow UI as a read-only frontend while storing data in our own backend.
- Third-party integrations (HuggingFace Trainer, PyTorch Lightning) already have MLflow callbacks. These work with Hanzo ML without modification.

The API compatibility layer is thin: we implement the MLflow REST API endpoints (`/api/2.0/mlflow/runs/*`, `/api/2.0/mlflow/experiments/*`) backed by our own storage. We do not fork or embed MLflow's Python server.

### How Training Connects to Inference

The pipeline's output is the inference engine's input. The connection is explicit:

```
Training Pipeline (this HIP)
  |
  +---> Checkpoint saved to Object Storage (HIP-0032)
  |       s3://hanzo-ml/checkpoints/{run_id}/{step}/
  |
  +---> Model registered in Model Registry
  |       name: zen-72b-finance, version: 3
  |       format: safetensors, quantization: none
  |
  +---> Conversion job (optional)
  |       safetensors -> GGUF (Q4_K_M) for edge deployment
  |       safetensors -> AWQ (INT4) for datacenter inference
  |
  +---> Model artifact pushed to Object Storage
  |       s3://hanzo-models/zen-72b-finance/v3/safetensors/
  |       s3://hanzo-models/zen-72b-finance/v3/gguf-q4km/
  |
  +---> Inference Engine (HIP-0043) loads new version
          Zero-downtime model swap via engine reload
```

The model registry is the handoff point. Training writes to it; inference reads from it. The registry stores metadata (architecture, quantization, training config, evaluation metrics) alongside a pointer to the model weights in Object Storage. It does not store the weights themselves -- that would duplicate storage and bypass the Object Storage access policies.

### Integration with Candle (HIP-0019)

While the primary training runtime is PyTorch (the ecosystem demands it), Candle (HIP-0019) plays a specific role:

- **Checkpoint validation**: After training completes, the pipeline loads the checkpoint into Candle to verify that weights are loadable and produce finite logits. This catches corruption before the model reaches the inference engine.
- **Quantization**: Post-training quantization (GPTQ, AWQ) is implemented in Candle for deterministic, bit-exact results. Python quantization tools produce slightly different outputs depending on CUDA version and PyTorch build -- Candle does not.
- **Evaluation harness**: Small-scale evaluation benchmarks (perplexity on a held-out set, accuracy on standard tasks) run in Candle for faster iteration than PyTorch evaluation loops.
- **Edge model export**: Converting safetensors to GGUF for edge deployment uses Candle's quantization pipeline, producing files directly consumable by the inference engine.

Training itself remains in PyTorch. There is no benefit to rewriting training loops in Rust -- training is inherently GPU-bound, and PyTorch's CUDA integration is more mature for training-specific operations (gradient accumulation, mixed-precision scaling, FSDP). The Rust advantage that matters for inference (startup time, memory safety, single-binary deployment) does not matter for long-running training jobs.

## Specification

### Architecture Overview

```
                    ┌──────────────────────────────────────────┐
                    │           Hanzo ML API (8057)             │
                    │                                          │
                    │  ┌─────────┐ ┌──────────┐ ┌───────────┐ │
                    │  │ Dataset │ │Experiment│ │  Model    │ │
                    │  │ Manager │ │ Tracker  │ │ Registry  │ │
                    │  └────┬────┘ └────┬─────┘ └─────┬─────┘ │
                    │       │           │             │       │
                    │  ┌────┴───────────┴─────────────┴────┐  │
                    │  │         Job Scheduler              │  │
                    │  └────┬──────────┬──────────┬────────┘  │
                    └───────┼──────────┼──────────┼────────────┘
                            │          │          │
                    ┌───────┴──┐ ┌─────┴────┐ ┌──┴─────────┐
                    │ Training │ │  Eval    │ │ Conversion │
                    │   Job    │ │  Job     │ │   Job      │
                    │ (GPU Pod)│ │(CPU/GPU) │ │ (CPU/GPU)  │
                    └────┬─────┘ └────┬─────┘ └──────┬─────┘
                         │            │              │
              ┌──────────┴────────────┴──────────────┴───┐
              │         Hanzo Object Storage (9000)       │
              │    checkpoints / datasets / models        │
              └──────────────────────────────────────────┘
```

**Hanzo ML API** (port 8057) is the control plane. It receives job submissions, manages datasets, tracks experiments, and maintains the model registry. It is a stateless Go service backed by PostgreSQL for metadata and Object Storage for binary artifacts.

**Job Scheduler** creates Kubernetes Jobs for training, evaluation, and model conversion. Each job runs in its own Pod with specified GPU resources. The scheduler implements fair-share allocation across teams and gang scheduling for multi-node distributed training.

**Training Jobs** run user-defined training scripts in containerized environments with GPU access. The pipeline provides base images with PyTorch, CUDA, and Hanzo ML client libraries pre-installed.

**Evaluation Jobs** run model evaluation benchmarks after training. These can be GPU-accelerated (for perplexity computation) or CPU-only (for accuracy on text tasks).

**Conversion Jobs** transform model artifacts between formats: safetensors to GGUF, safetensors to AWQ, adapter merging for LoRA checkpoints.

### Dataset Management

Datasets are versioned, immutable collections of files stored in Object Storage.

```yaml
Dataset Schema:
  id: string                    # UUID
  name: string                  # Human-readable name (e.g., "finance-corpus-v3")
  version: integer              # Auto-incrementing version number
  organization: string          # Owning organization in Hanzo IAM
  created_at: timestamp
  created_by: string            # IAM user ID
  storage_path: string          # s3://hanzo-ml/datasets/{name}/{version}/
  format: enum                  # jsonl | parquet | csv | arrow | text
  size_bytes: integer
  num_records: integer
  schema: object                # Column names and types (for tabular data)
  splits:                       # Named subsets
    train: { path, num_records, size_bytes }
    validation: { path, num_records, size_bytes }
    test: { path, num_records, size_bytes }
  metadata: object              # Arbitrary key-value pairs
  tags: string[]                # Searchable tags
  lineage:                      # Data provenance
    parent_datasets: string[]   # IDs of source datasets
    transform: string           # Description of how this was derived
```

**Immutability.** Once a dataset version is created, its files cannot be modified. Creating a modified version produces a new version number. This guarantees that a training run's dataset reference is stable -- re-running with the same dataset version produces the same data.

**Preprocessing.** The pipeline provides built-in preprocessing for common training data formats:

```yaml
Preprocessing Operations:
  tokenize:
    tokenizer: "zenlm/zen-72b"          # HuggingFace tokenizer
    max_length: 8192                     # Truncate or pad to this length
    output_format: arrow                 # Apache Arrow for fast loading

  filter:
    min_length: 64                       # Minimum token count
    max_length: 8192                     # Maximum token count
    dedup: true                          # Remove exact duplicates
    language: "en"                       # Language filter (fasttext)

  augment:
    shuffle_seed: 42                     # Deterministic shuffle
    oversample_minority: true            # Balance class distribution
    mask_pii: true                       # Replace PII with [REDACTED]
```

Preprocessing runs as a batch job. The output is a new dataset version with the transform recorded in the lineage field.

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| **Datasets** | | |
| `/v1/datasets` | GET | List datasets (filtered by org, tags, name) |
| `/v1/datasets` | POST | Create a new dataset version |
| `/v1/datasets/{id}` | GET | Get dataset metadata |
| `/v1/datasets/{id}/download` | GET | Get pre-signed download URL |
| `/v1/datasets/{id}/preview` | GET | Preview first N records |
| **Experiments** | | |
| `/v1/experiments` | GET | List experiments |
| `/v1/experiments` | POST | Create an experiment |
| `/v1/experiments/{id}` | GET | Get experiment details |
| `/v1/experiments/{id}/runs` | GET | List runs in an experiment |
| **Runs** | | |
| `/v1/runs` | POST | Create a new run |
| `/v1/runs/{id}` | GET | Get run details (config, metrics, artifacts) |
| `/v1/runs/{id}/metrics` | POST | Log metrics (batch) |
| `/v1/runs/{id}/params` | POST | Log parameters |
| `/v1/runs/{id}/artifacts` | POST | Upload an artifact |
| `/v1/runs/{id}/status` | PATCH | Update run status |
| **Jobs** | | |
| `/v1/jobs` | POST | Submit a training/eval/conversion job |
| `/v1/jobs/{id}` | GET | Get job status and logs |
| `/v1/jobs/{id}/cancel` | POST | Cancel a running job |
| `/v1/jobs/{id}/logs` | GET | Stream job logs (SSE) |
| **Models** | | |
| `/v1/models` | GET | List registered models |
| `/v1/models` | POST | Register a new model |
| `/v1/models/{name}/versions` | GET | List model versions |
| `/v1/models/{name}/versions` | POST | Create a new model version |
| `/v1/models/{name}/versions/{v}` | GET | Get version metadata |
| `/v1/models/{name}/versions/{v}/stage` | PATCH | Promote/demote (staging/production/archived) |
| **HPO** | | |
| `/v1/hpo` | POST | Start a hyperparameter optimization sweep |
| `/v1/hpo/{id}` | GET | Get sweep status and best trial |
| `/v1/hpo/{id}/trials` | GET | List all trials |
| **MLflow Compatibility** | | |
| `/api/2.0/mlflow/experiments/*` | * | MLflow-compatible experiment API |
| `/api/2.0/mlflow/runs/*` | * | MLflow-compatible run API |

### Experiment Tracking

Every training run records its configuration, metrics, and artifacts to the experiment tracker.

```yaml
Run Schema:
  id: string                    # UUID
  experiment_id: string         # Parent experiment
  name: string                  # Human-readable run name
  status: enum                  # queued | running | completed | failed | cancelled
  start_time: timestamp
  end_time: timestamp
  user_id: string               # IAM user who started the run
  organization: string

  params:                       # Logged parameters (immutable per run)
    model: "zen-72b"
    method: "qlora"
    learning_rate: 2e-5
    batch_size: 4
    gradient_accumulation_steps: 8
    lora_rank: 64
    lora_alpha: 128
    dataset: "finance-corpus-v3"
    dataset_version: 7

  metrics:                      # Time-series metrics
    - { key: "train/loss", value: 0.342, step: 1000, timestamp: ... }
    - { key: "eval/loss", value: 0.415, step: 1000, timestamp: ... }
    - { key: "eval/perplexity", value: 8.72, step: 1000, timestamp: ... }
    - { key: "gpu/memory_used_gb", value: 72.4, step: 1000, timestamp: ... }
    - { key: "gpu/utilization", value: 0.94, step: 1000, timestamp: ... }

  artifacts:                    # Associated files
    - { key: "checkpoint/step-1000", path: "s3://hanzo-ml/runs/{id}/checkpoint-1000/" }
    - { key: "config.yaml", path: "s3://hanzo-ml/runs/{id}/config.yaml" }
    - { key: "eval/results.json", path: "s3://hanzo-ml/runs/{id}/eval-results.json" }

  system_metrics:               # Auto-collected by the training container
    gpu_type: "NVIDIA A100 80GB"
    gpu_count: 4
    total_gpu_hours: 12.5
    peak_memory_gb: 78.2
    total_tokens_processed: 1_200_000_000
```

**Client Library.** Training scripts log metrics and parameters using the Hanzo ML Python client:

```python
import hanzo_ml

# Initialize client -- connects to Hanzo ML API
hanzo_ml.set_tracking_uri("http://ml.hanzo.svc:8057")
hanzo_ml.set_experiment("zen-72b-finance-finetune")

with hanzo_ml.start_run(run_name="qlora-lr2e5-r64") as run:
    # Log parameters (once per run)
    run.log_params({
        "model": "zen-72b",
        "method": "qlora",
        "learning_rate": 2e-5,
        "lora_rank": 64,
    })

    for step, batch in enumerate(dataloader):
        loss = train_step(model, batch)

        # Log metrics (every N steps)
        if step % 100 == 0:
            run.log_metrics({
                "train/loss": loss.item(),
                "gpu/memory_used_gb": torch.cuda.max_memory_allocated() / 1e9,
            }, step=step)

        # Save checkpoint (every M steps)
        if step % 1000 == 0:
            checkpoint_path = save_checkpoint(model, step)
            run.log_artifact("checkpoint/step-{step}", checkpoint_path)

    # Register final model
    run.register_model(
        name="zen-72b-finance",
        artifact_path="checkpoint/step-final",
        tags={"task": "finance-qa", "method": "qlora"},
    )
```

This client is API-compatible with `mlflow`. Existing scripts that use `mlflow.log_metric()` and `mlflow.log_param()` work by replacing the tracking URI.

### Distributed Training Orchestration

The pipeline schedules distributed training jobs as Kubernetes Jobs with multiple Pods, one per GPU node.

```yaml
Distributed Training Configuration:
  strategy: enum                # ddp | fsdp | deepspeed_zero2 | deepspeed_zero3
  num_nodes: integer            # Number of GPU nodes
  gpus_per_node: integer        # GPUs per node (typically 8 for A100 nodes)
  backend: "nccl"               # Communication backend (NCCL for NVIDIA)

  # Gang scheduling: all pods must be scheduled simultaneously
  gang_scheduling: true

  # Network: RDMA/InfiniBand where available, TCP fallback
  rdma: auto                    # auto | enabled | disabled

Job Submission (YAML):
  name: "zen-72b-finetune-finance"
  type: training
  image: "hanzoai/ml-pytorch:2.3-cuda12.4"
  command: ["torchrun", "--nproc_per_node=8", "train.py"]
  env:
    HANZO_ML_TRACKING_URI: "http://ml.hanzo.svc:8057"
    HANZO_ML_EXPERIMENT: "zen-72b-finance"
  resources:
    gpus: 8
    gpu_type: "nvidia-a100-80gb"
    memory: "512Gi"
    cpu: 64
  distributed:
    strategy: fsdp
    num_nodes: 4
    gpus_per_node: 8
  storage:
    datasets: "s3://hanzo-ml/datasets/finance-corpus-v3/7/"
    checkpoints: "s3://hanzo-ml/checkpoints/zen-72b-finance/"
  schedule:
    max_duration: "48h"
    checkpoint_interval: "1h"
    preemptible: false
```

**Gang Scheduling.** For multi-node training, all Pods must start simultaneously. If the cluster has 3 free A100 nodes but the job needs 4, the job waits rather than starting 3 and hoping the 4th becomes available. This is implemented using Kubernetes scheduler plugins (Coscheduling).

**Fault Tolerance.** Training jobs checkpoint at regular intervals to Object Storage. If a Pod is evicted (node failure, preemption), the job restarts from the latest checkpoint. The pipeline tracks checkpoint freshness and alerts if a long-running job has not checkpointed within the configured interval.

```yaml
Checkpoint Strategy:
  storage: "s3://hanzo-ml/checkpoints/{run_id}/"
  interval: "1h"              # Time-based checkpointing
  keep_last: 3                # Retain last 3 checkpoints, delete older ones
  save_on_preempt: true       # Emergency checkpoint when SIGTERM received
  resume_from: "latest"       # Auto-resume from most recent checkpoint

  # Checkpoint contents:
  # - Model weights (safetensors or PyTorch state_dict)
  # - Optimizer state
  # - Learning rate scheduler state
  # - Data loader position (epoch, batch index)
  # - RNG states (Python, NumPy, PyTorch, CUDA)
  # - Run metadata (step count, elapsed time)
```

### GPU Scheduling and Resource Allocation

The scheduler manages GPU allocation across the cluster with fair-share policies.

```yaml
GPU Scheduling:
  allocation_policy: fair_share   # fair_share | priority | fifo

  quotas:                         # Per-organization GPU quotas
    research:
      max_gpus: 64
      max_concurrent_jobs: 8
      priority: high
    engineering:
      max_gpus: 32
      max_concurrent_jobs: 4
      priority: medium
    community:
      max_gpus: 16
      max_concurrent_jobs: 2
      priority: low
      preemptible: true           # Community jobs can be preempted

  preemption:
    enabled: true
    grace_period: 300s            # 5 minutes to checkpoint before kill
    policy: lowest_priority_first

  bin_packing:
    enabled: true                 # Pack jobs onto fewest nodes
    fragmentation_threshold: 0.2  # Alert if >20% GPUs are stranded
```

**Fair-share scheduling** ensures that no single team monopolizes the cluster. Each organization receives a GPU quota proportional to its allocation. When the cluster is fully loaded, jobs are queued in priority order. When GPUs free up, the most under-served organization's queued job starts first.

**Preemption** allows high-priority jobs (production fine-tuning, urgent experiments) to reclaim GPUs from low-priority jobs (community experiments, hyperparameter sweeps). Preempted jobs receive SIGTERM with a grace period to save a checkpoint before SIGKILL.

### Hyperparameter Optimization

The pipeline provides built-in hyperparameter optimization (HPO) with three strategies.

```yaml
HPO Sweep Configuration:
  experiment: "zen-7b-lora-hpo"
  base_config:
    model: "zen-7b"
    method: "lora"
    dataset: "instruction-v2"
    max_steps: 5000
    eval_steps: 500

  search_space:
    learning_rate:
      type: log_uniform
      min: 1e-6
      max: 1e-3
    lora_rank:
      type: choice
      values: [8, 16, 32, 64, 128]
    lora_alpha:
      type: choice
      values: [16, 32, 64, 128, 256]
    warmup_ratio:
      type: uniform
      min: 0.0
      max: 0.1
    weight_decay:
      type: log_uniform
      min: 1e-4
      max: 1e-1

  strategy: bayesian             # grid | random | bayesian | pbt
  objective:
    metric: "eval/loss"
    direction: minimize
  max_trials: 50
  max_concurrent_trials: 4       # Run 4 trials in parallel
  early_stopping:
    patience: 3                  # Stop trial if no improvement for 3 evals
    min_delta: 0.001

  resources_per_trial:
    gpus: 1
    gpu_type: "nvidia-a100-80gb"
    memory: "64Gi"
```

**Grid Search.** Exhaustive search over a discrete grid. Useful when the search space is small (< 100 combinations) and you want complete coverage.

**Random Search.** Sample randomly from the search space. More efficient than grid search for high-dimensional spaces because it explores more of each dimension.

**Bayesian Optimization.** Fits a Gaussian Process surrogate to completed trials and uses an acquisition function (Expected Improvement) to select the next trial. Converges to good hyperparameters in fewer trials than random search. Implemented using the Tree-Structured Parzen Estimator (TPE) algorithm.

**Population-Based Training (PBT).** Runs a population of trials in parallel. Periodically, low-performing trials copy the weights and hyperparameters of high-performing trials, then perturb the hyperparameters. This combines training and hyperparameter search into a single process, reducing total GPU hours. Best suited for long-running fine-tuning jobs where the optimal learning rate schedule is not known in advance.

### Fine-Tuning Pipelines for Zen Models

The pipeline provides pre-configured recipes for fine-tuning each Zen model size.

```yaml
Fine-Tuning Recipes:

  LoRA:
    description: Low-Rank Adaptation -- adds small trainable matrices to attention layers
    memory_profile: Base model (frozen, loaded in inference dtype) + adapter weights + optimizer states
    when_to_use: Single-GPU fine-tuning, domain adaptation, instruction tuning

    recipes:
      zen-7b-lora:
        gpu_requirement: "1x A100 40GB"
        base_dtype: float16
        lora_rank: 64
        lora_alpha: 128
        lora_target_modules: ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]
        learning_rate: 2e-4
        batch_size: 4
        gradient_accumulation: 4
        max_steps: 10000
        estimated_time: "4 hours"
        estimated_cost: "$20"

      zen-72b-lora:
        gpu_requirement: "4x A100 80GB"
        base_dtype: float16
        lora_rank: 64
        lora_alpha: 128
        lora_target_modules: ["q_proj", "k_proj", "v_proj", "o_proj"]
        learning_rate: 1e-4
        batch_size: 1
        gradient_accumulation: 16
        max_steps: 5000
        distributed:
          strategy: fsdp
          num_nodes: 1
          gpus_per_node: 4
        estimated_time: "12 hours"
        estimated_cost: "$200"

  QLoRA:
    description: Quantized LoRA -- base model loaded in 4-bit, adapters in FP16
    memory_profile: 75% less than LoRA (base weights in NF4 instead of FP16)
    when_to_use: Fine-tuning large models on limited GPU memory

    recipes:
      zen-72b-qlora:
        gpu_requirement: "1x A100 80GB"
        base_dtype: nf4                   # 4-bit NormalFloat quantization
        compute_dtype: bfloat16
        lora_rank: 64
        lora_alpha: 128
        lora_target_modules: ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]
        learning_rate: 2e-5
        batch_size: 2
        gradient_accumulation: 8
        max_steps: 5000
        double_quant: true                # Quantize the quantization constants
        estimated_time: "24 hours"
        estimated_cost: "$100"

  Full Fine-Tune:
    description: All model weights are trainable -- highest quality, highest cost
    memory_profile: Model weights + gradients + optimizer states (3-4x model size)
    when_to_use: Significant domain shift, pre-training continuation, large data

    recipes:
      zen-7b-full:
        gpu_requirement: "8x A100 80GB"
        dtype: bfloat16
        optimizer: adamw
        learning_rate: 2e-5
        batch_size: 4
        gradient_accumulation: 4
        max_steps: 50000
        distributed:
          strategy: fsdp
          sharding: full_shard            # Shard weights, gradients, and optimizer across GPUs
          num_nodes: 1
          gpus_per_node: 8
        estimated_time: "48 hours"
        estimated_cost: "$1,600"

      zen-72b-full:
        gpu_requirement: "32x A100 80GB"
        dtype: bfloat16
        optimizer: adamw
        learning_rate: 5e-6
        batch_size: 1
        gradient_accumulation: 32
        max_steps: 20000
        distributed:
          strategy: fsdp
          sharding: full_shard
          num_nodes: 4
          gpus_per_node: 8
        estimated_time: "7 days"
        estimated_cost: "$22,400"
```

**Adapter Merging.** After LoRA/QLoRA fine-tuning, the adapter weights can be merged back into the base model to produce a single set of weights for inference. The pipeline provides an automated merge-and-export job:

```yaml
Merge Job:
  type: conversion
  source_run: "{run_id}"
  operations:
    - merge_lora:
        base_model: "zenlm/zen-72b"
        adapter_path: "s3://hanzo-ml/runs/{run_id}/checkpoint-final/adapter/"
        output_format: safetensors
        output_path: "s3://hanzo-models/zen-72b-finance/v3/safetensors/"
    - quantize:
        input_path: "s3://hanzo-models/zen-72b-finance/v3/safetensors/"
        output_format: gguf
        quantization: Q4_K_M
        output_path: "s3://hanzo-models/zen-72b-finance/v3/gguf-q4km/"
    - validate:
        model_path: "s3://hanzo-models/zen-72b-finance/v3/safetensors/"
        test_prompts: ["What is the P/E ratio of AAPL?", "Explain bond yields."]
        check_finite: true
        check_perplexity_threshold: 15.0
    - register:
        name: "zen-72b-finance"
        version: 3
        formats: [safetensors, gguf-q4km]
        stage: staging
```

### Model Registry

The model registry stores metadata about trained model artifacts and manages their lifecycle.

```yaml
Model Version Schema:
  name: string                  # Model name (e.g., "zen-72b-finance")
  version: integer              # Auto-incrementing version
  stage: enum                   # none | staging | production | archived
  run_id: string                # Training run that produced this model

  architecture: string          # Model architecture (e.g., "LlamaForCausalLM")
  base_model: string            # Base model name (e.g., "zenlm/zen-72b")
  method: string                # Training method (full | lora | qlora)

  artifacts:                    # Available formats for this version
    safetensors:
      path: "s3://hanzo-models/zen-72b-finance/v3/safetensors/"
      size_bytes: 144_000_000_000
      checksum: "sha256:abc123..."
    gguf-q4km:
      path: "s3://hanzo-models/zen-72b-finance/v3/gguf-q4km/"
      size_bytes: 42_000_000_000
      checksum: "sha256:def456..."

  metrics:                      # Evaluation results
    perplexity: 7.2
    mmlu_accuracy: 0.72
    finance_qa_accuracy: 0.89
    humaneval_pass_at_1: 0.45

  training_config:              # Full training configuration for reproducibility
    dataset: "finance-corpus-v3"
    dataset_version: 7
    method: "qlora"
    learning_rate: 2e-5
    lora_rank: 64
    total_steps: 5000
    gpu_hours: 24.0

  created_at: timestamp
  created_by: string
  tags: object
```

**Stage Promotion.** Model versions progress through stages:

```
none -> staging -> production -> archived
```

- **none**: Freshly registered, not yet evaluated.
- **staging**: Passed automated evaluation, ready for human review and A/B testing.
- **production**: Serving live traffic via the inference engine.
- **archived**: Replaced by a newer version, retained for rollback.

Only one version per model name can be in the `production` stage at a time. Promoting a new version to production automatically archives the previous production version.

### Integration with Hanzo Stream (HIP-0030)

Training events are published to Hanzo Stream (Kafka) for real-time monitoring and downstream automation.

```yaml
Kafka Topics:
  hanzo.ml.jobs:                # Job lifecycle events
    - { event: "job.submitted", job_id, user_id, config, timestamp }
    - { event: "job.started", job_id, node_ids, gpu_ids, timestamp }
    - { event: "job.completed", job_id, duration, gpu_hours, timestamp }
    - { event: "job.failed", job_id, error, timestamp }

  hanzo.ml.metrics:             # Training metrics (high-volume)
    - { run_id, step, metrics: { "train/loss": 0.42 }, timestamp }

  hanzo.ml.models:              # Model registry events
    - { event: "model.registered", name, version, run_id, timestamp }
    - { event: "model.promoted", name, version, stage, timestamp }

  hanzo.ml.gpu:                 # GPU utilization telemetry
    - { node_id, gpu_id, utilization, memory_used, temperature, timestamp }
```

Consumers include:

- **Observability (HIP-0031)**: GPU utilization dashboards, training progress graphs.
- **Billing**: GPU-hour metering per organization for cost allocation.
- **Automation**: Trigger evaluation jobs on `job.completed`, trigger deployment on `model.promoted` to production.
- **Alerting**: Alert on `job.failed`, on GPU temperature spikes, on stalled training (no metric logged for N minutes).

### Configuration

```yaml
# /etc/hanzo-ml/config.yaml

server:
  host: 0.0.0.0
  port: 8057
  workers: 4

database:
  url: "postgresql://hanzo:password@postgres:5432/hanzo_ml"

storage:
  endpoint: "http://minio:9000"
  access_key: "${HANZO_STORAGE_ACCESS_KEY}"
  secret_key: "${HANZO_STORAGE_SECRET_KEY}"
  buckets:
    datasets: "hanzo-ml-datasets"
    checkpoints: "hanzo-ml-checkpoints"
    models: "hanzo-models"

stream:
  brokers: "kafka:9092"
  topic_prefix: "hanzo.ml"

auth:
  iam_url: "https://hanzo.id"
  verify_tokens: true

scheduler:
  namespace: "hanzo-ml"
  default_image: "hanzoai/ml-pytorch:2.3-cuda12.4"
  gpu_types:
    - "nvidia-a100-80gb"
    - "nvidia-a100-40gb"
    - "nvidia-h100-80gb"
  max_concurrent_jobs: 32
  checkpoint_bucket: "hanzo-ml-checkpoints"

hpo:
  max_concurrent_trials: 8
  default_strategy: "bayesian"

metrics:
  enabled: true
  port: 9090
  path: /metrics

logging:
  level: info
  format: json
```

Environment variable overrides follow the pattern `HANZO_ML_{SECTION}_{KEY}` (e.g., `HANZO_ML_SERVER_PORT=8057`).

## Implementation

### Training Base Images

The pipeline provides pre-built container images for training:

```dockerfile
# hanzoai/ml-pytorch:2.3-cuda12.4
FROM nvidia/cuda:12.4.1-devel-ubuntu22.04

# PyTorch with CUDA 12.4 support
RUN pip install torch==2.3.0+cu124 --index-url https://download.pytorch.org/whl/cu124

# Training essentials
RUN pip install \
    transformers==4.45.0 \
    datasets==3.0.0 \
    accelerate==1.0.0 \
    peft==0.13.0 \
    bitsandbytes==0.44.0 \
    deepspeed==0.15.0 \
    hanzo-ml-client==1.0.0

# Hanzo ML client pre-configured
ENV HANZO_ML_TRACKING_URI="http://ml.hanzo.svc:8057"
```

Images are tagged by PyTorch version and CUDA version. Multi-arch builds (amd64/arm64) follow the Container Registry standard (HIP-0033).

### CLI Interface

```bash
# Submit a training job
hanzo-ml job submit --config train-config.yaml

# List running jobs
hanzo-ml job list --status running

# Stream job logs
hanzo-ml job logs <job-id> --follow

# Cancel a job
hanzo-ml job cancel <job-id>

# Create a dataset from local files
hanzo-ml dataset create --name "finance-corpus" --path ./data/ --format jsonl

# List experiments
hanzo-ml experiment list

# Compare runs
hanzo-ml run compare <run-id-1> <run-id-2> --metrics "eval/loss,eval/accuracy"

# Register a model from a run
hanzo-ml model register --name "zen-7b-finance" --run <run-id> --artifact checkpoint-final

# Promote a model to production
hanzo-ml model promote --name "zen-7b-finance" --version 3 --stage production

# Start an HPO sweep
hanzo-ml hpo start --config sweep-config.yaml

# View HPO results
hanzo-ml hpo results <sweep-id> --top 5
```

### Deployment

#### Docker

```bash
docker run -p 8057:8057 -p 9090:9090 \
  -e HANZO_ML_DATABASE_URL="postgresql://..." \
  -e HANZO_ML_STORAGE_ENDPOINT="http://minio:9000" \
  -e HANZO_ML_STREAM_BROKERS="kafka:9092" \
  hanzoai/ml:latest
```

#### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hanzo-ml
  namespace: hanzo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: hanzo-ml
  template:
    metadata:
      labels:
        app: hanzo-ml
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9090"
    spec:
      serviceAccountName: hanzo-ml
      containers:
        - name: hanzo-ml
          image: hanzoai/ml:latest
          ports:
            - containerPort: 8057
              name: api
            - containerPort: 9090
              name: metrics
          env:
            - name: HANZO_ML_DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: hanzo-ml-secrets
                  key: database-url
          readinessProbe:
            httpGet:
              path: /ready
              port: 8057
          livenessProbe:
            httpGet:
              path: /alive
              port: 8057
---
apiVersion: v1
kind: Service
metadata:
  name: hanzo-ml
  namespace: hanzo
spec:
  selector:
    app: hanzo-ml
  ports:
    - name: api
      port: 8057
    - name: metrics
      port: 9090
---
# RBAC: hanzo-ml needs permission to create Jobs and Pods for training
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: hanzo-ml-scheduler
  namespace: hanzo-ml
rules:
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["create", "delete", "get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]
```

### Health and Metrics

```yaml
Metrics (Prometheus):
  Counters:
    hanzo_ml_jobs_total{type, status, org}          # Total jobs submitted
    hanzo_ml_gpu_hours_total{gpu_type, org}          # Total GPU hours consumed
    hanzo_ml_datasets_created_total{org}             # Datasets created
    hanzo_ml_models_registered_total{org}            # Models registered

  Histograms:
    hanzo_ml_job_duration_seconds{type}              # Job duration distribution
    hanzo_ml_api_request_duration_seconds{endpoint}  # API latency

  Gauges:
    hanzo_ml_jobs_running{type, org}                 # Currently running jobs
    hanzo_ml_gpus_allocated{gpu_type}                # GPUs currently in use
    hanzo_ml_gpus_available{gpu_type}                # GPUs available
    hanzo_ml_queue_depth{org, priority}              # Queued jobs
    hanzo_ml_storage_bytes{bucket}                   # Storage usage
```

### Implementation Roadmap

**Phase 1: Core Pipeline (Q1 2026)**
- Job submission and scheduling (single-node GPU jobs)
- Experiment tracking API with MLflow compatibility
- Dataset management (create, version, download)
- Checkpoint storage and resume
- CLI and Python client library

**Phase 2: Distributed Training (Q2 2026)**
- Multi-node distributed training (FSDP, DeepSpeed)
- Gang scheduling with Kubernetes coscheduling plugin
- Fault tolerance with automatic checkpoint resume
- GPU utilization monitoring and alerting

**Phase 3: Fine-Tuning and HPO (Q3 2026)**
- Pre-configured Zen model fine-tuning recipes
- LoRA, QLoRA, and full fine-tune support
- Hyperparameter optimization (grid, random, Bayesian, PBT)
- Adapter merging and model conversion jobs

**Phase 4: Model Registry and Automation (Q4 2026)**
- Model registry with stage promotion
- Automated evaluation pipelines
- Training-to-serving automation (promote to production triggers engine reload)
- Candle-based checkpoint validation and quantization
- Cost tracking and GPU billing integration

## Security Considerations

### Authentication and Authorization

All API endpoints require a valid Hanzo IAM bearer token. Permissions are scoped per organization:

```yaml
RBAC Roles:
  ml-admin:
    - datasets: read, write, delete
    - experiments: read, write, delete
    - jobs: submit, cancel, delete
    - models: register, promote, archive
    - hpo: create, cancel

  ml-researcher:
    - datasets: read, write
    - experiments: read, write
    - jobs: submit, cancel (own only)
    - models: register
    - hpo: create (within quota)

  ml-viewer:
    - datasets: read
    - experiments: read
    - jobs: read
    - models: read
```

### Data Security

- **Dataset encryption at rest.** All data in Object Storage is encrypted using server-side encryption (SSE-S3). Sensitive datasets can use customer-managed keys via KMS (HIP-0027).
- **Network isolation.** Training Pods run in a dedicated namespace (`hanzo-ml`) with network policies that restrict egress to Object Storage, the ML API, and NCCL ports for distributed training. No internet access by default.
- **Secret injection.** Training jobs receive secrets (API keys, storage credentials) via Kubernetes Secrets mounted as environment variables, never baked into container images.
- **Audit logging.** Every API call (job submission, model promotion, dataset access) is logged with the caller's IAM identity, timestamp, and action. Logs are published to Hanzo Stream for retention and compliance.

### Training Job Isolation

Training jobs from different organizations run in separate Kubernetes namespaces with resource quotas enforced. A misbehaving training job cannot consume GPUs allocated to another organization. Pod security policies prevent privilege escalation, host network access, and host filesystem mounts.

### Model Artifact Integrity

Model artifacts in the registry include SHA-256 checksums computed at upload time. Before loading a model for inference, the engine verifies the checksum against the registry record. If the checksum does not match -- indicating corruption or tampering -- the load is rejected and an alert is raised.

## References

1. [HIP-0004: LLM Gateway - Unified AI Provider Interface](./hip-0004-llm-gateway-unified-ai-provider-interface.md)
2. [HIP-0019: Tensor Operations Standard (Candle)](./hip-0019-tensor-operations-standard.md)
3. [HIP-0027: Secrets Management Standard](./hip-0027-secrets-management-standard.md)
4. [HIP-0029: Relational Database Standard](./hip-0029-relational-database-standard.md)
5. [HIP-0030: Event Streaming Standard](./hip-0030-event-streaming-standard.md)
6. [HIP-0032: Object Storage Standard](./hip-0032-object-storage-standard.md)
7. [HIP-0033: Container Registry Standard](./hip-0033-container-registry-standard.md)
8. [HIP-0039: Zen Model Architecture](./hip-0039-zen-model-architecture.md)
9. [HIP-0043: LLM Inference Engine Standard](./hip-0043-llm-inference-engine-standard.md)
10. [LoRA: Low-Rank Adaptation of Large Language Models](https://arxiv.org/abs/2106.09685)
11. [QLoRA: Efficient Finetuning of Quantized LLMs](https://arxiv.org/abs/2305.14314)
12. [PyTorch FSDP: Experiences on Scaling Fully Sharded Data Parallel](https://arxiv.org/abs/2304.11277)
13. [DeepSpeed: Extreme-scale Model Training for Everyone](https://www.deepspeed.ai/)
14. [MLflow: An Open Source Platform for the Machine Learning Lifecycle](https://mlflow.org/)
15. [Tree-Structured Parzen Estimator (TPE)](https://papers.nips.cc/paper/2011/hash/86e8f7ab32cfd12577bc2619bc635690-Abstract.html)
16. [Population Based Training of Neural Networks](https://arxiv.org/abs/1711.09846)
17. [Kubernetes Coscheduling Plugin](https://github.com/kubernetes-sigs/scheduler-plugins/tree/master/pkg/coscheduling)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
