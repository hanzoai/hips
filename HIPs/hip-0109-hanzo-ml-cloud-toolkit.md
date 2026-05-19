---
hip: 0109
title: Hanzo ML Cloud Toolkit
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-05-18
requires: HIP-0026, HIP-0027, HIP-0106, HIP-0108
---

# HIP-109: Hanzo ML Cloud Toolkit

## Abstract

The Hanzo ML Cloud Toolkit is the Hanzo-native ML operator and control
plane that lives in `~/work/hanzo/operator` (Rust, BSD-3). It replaces
the functional surface of the prior open-source ML operator estate
(training, experiment tracking, hyperparameter sweeps, pipelines,
notebooks, model registry, inference serving) **without taking that
estate as a dependency**. Seven `hanzo.ai/v1` Custom Resource
Definitions reconciled by one Rust binary, mounted under the unified
`cloud` HTTP surface from HIP-0106, talking to Hanzo primitives:
`hanzoai/iam` (auth), `hanzoai/vfs` (artifacts), `hanzoai/datastore`
(metrics), `hanzoai/base` (per-tenant SQLite), `hanzoai/tasks` (DAG
runner), `hanzoai/o11y` (general observability), `hanzoai/insights`
(LLM-specific observability), `hanzoai/engine` (inference),
`hanzoai/ml` (Candle-based ML primitives), `hanzoai/cloud` (control
plane mux).

**Brand and scope policy.** `hanzoai/ml` STAYS the primitive Rust ML
toolkit (Candle core + tensor ops + model primitives). It does NOT
absorb control-plane responsibilities; those land in
`hanzoai/operator`. `hanzoai/ml` is consumed by training-container
images that the operator schedules — it is not the scheduler. One way
to do everything: `ml/` is primitives, `operator/` is control plane,
`cloud/` is the HTTP mux, and the protocols at the edges are MCP for
tools, A2A for federation, and ZAP between Hanzo subsystems.

## Motivation

Today every team that wants to ship a real ML workload on Hanzo has
to either (a) bring in the entire open-source ML operator estate
(seven projects, three CRD groups, two namespaces of pods, a
PostgreSQL, a MinIO, a MySQL, a separate frontend), or (b)
re-implement training/serving by hand. Neither is acceptable.

The Hanzo platform already ships every primitive that estate
re-invents:

| Concern | Hanzo primitive | What replaces |
|---|---|---|
| Auth | `hanzoai/iam` | Open-source profile controller, Dex |
| Artifact storage | `hanzoai/vfs` | MinIO, S3 directly |
| Experiment metrics | `hanzoai/datastore` | MySQL + tracking-server |
| Run config / registry metadata | `hanzoai/base` | MySQL, PostgreSQL |
| Pipeline DAG runner | `hanzoai/tasks` (HIP-0108) | Argo, KFP backend |
| Infrastructure obs | `hanzoai/o11y` | Prometheus + Grafana + Jaeger |
| LLM/AI obs | `hanzoai/insights` | Langfuse, WhyLabs, custom |
| Inference engine | `hanzoai/engine` | Inference servers (Triton-style) |
| ML primitives | `hanzoai/ml` (Candle) | PyTorch as a service |
| Control plane mux | `hanzoai/cloud` (HIP-0106) | API aggregator |

What's missing is the **declarative API + reconciler** that ties them
together. That's what HIP-0109 specifies and what
`hanzoai/operator`'s new `ml-controller` module implements.

## Protocol boundaries (decomplect)

Protocols sit at distinct layers. Each does one thing.

| Protocol | Layer | Role |
|---|---|---|
| **ZAP** | inter-subsystem (Hanzo internal) | The spine. `cloud` ↔ `operator` ↔ `iam` ↔ `tasks` etc. — all over ZAP. Same generated bindings serve in-process and over-wire per HIP-0106. |
| **MCP** | external tool/resource exposure | The ML control plane exposes its actions (create_training_job, query_experiment, list_models, deploy_inference) as MCP tools so MCP-aware models and IDEs can drive ML workloads. ML is a **server** of MCP tools, not a client. |
| **A2A** | external agent-to-agent federation | Hanzo's ML-aware agents accept task delegations from other agents via A2A. The ML operator itself does not speak A2A; the agents subsystem does, and the agents call into the operator via the cloud subsystem's `/v1/ml/*` HTTP routes. |
| **ACP compat adapter** | optional IDE / coding-agent client compat | Where an external IDE or coding-agent client speaks ACP and wants to issue ML commands, the cloud subsystem exposes an ACP-compatible adapter that translates to the canonical `/v1/ml/*` HTTP routes. NOT canonical core. |
| **HTTP/REST** | public management API | The operator's CRDs are mirrored under `/v1/ml/jobs`, `/v1/ml/experiments`, `/v1/ml/sweeps`, `/v1/ml/pipelines`, `/v1/ml/notebooks`, `/v1/ml/models`, `/v1/ml/inference` by the cloud subsystem. JWT-authenticated via IAM, per-org scoped. |
| **K8s CRDs** | operator-facing declarative API | Seven Kinds at `hanzo.ai/v1`: `TrainingJob`, `Experiment`, `Sweep`, `Pipeline`, `Notebook`, `Model`, `Inference`. The Rust operator reconciles. |

**MCP is not the control plane.** MCP exposes ML actions as tools that
external models/IDEs can call. The control plane API is HTTP/REST on
top of `/v1/ml/*`, backed by K8s CRDs. Same for A2A — A2A delegates
tasks between agents; agents call into the control plane like any
other client.

## Specification

### Lifecycle CRDs at `hanzo.ai/v1`

The operator owns these Kinds:

| Kind | Plural | Short | What it owns |
|---|---|---|---|
| `TrainingJob` | `trainingjobs` | `mlj` | Distributed training pods. One unified type with `spec.framework: tensorflow | pytorch | mpi | xgboost | jax | candle | hanzo-ml`. Backs all training-job variants from the open-source operator family. |
| `Experiment` | `experiments` | `mlx` | Tracking experiment. Status surfaces metric streams from `hanzoai/datastore`; artifacts via `hanzoai/vfs`; run config in per-tenant `hanzoai/base`. |
| `Sweep` | `sweeps` | `mls` | Hyperparameter sweep. Owns N child `TrainingJob`s with parameter assignments; runs Bayesian / grid / random search per `spec.algorithm`. |
| `Pipeline` | `pipelines` | `mlp` | DAG of steps. Each step is a `TrainingJob`, `Inference`, or generic container task. Durable execution by delegating to `hanzoai/tasks` (HIP-0108). |
| `Notebook` | `notebooks` | `mln` | Per-tenant JupyterLab pod with IAM SSO sidecar. Storage is a PVC backed by `hanzoai/vfs`. Idle eviction per HIP-0108 tier-2 supervisor. |
| `Model` | `models` | `mlm` | Model registry entry. Metadata (versions, lineage, signatures, framework, tags) in per-tenant `hanzoai/base`; blobs in `hanzoai/vfs`. |
| `Inference` | `inferences` | `mli` | Inference service. Routes to `hanzoai/engine` for Hanzo-native serving, or to an external runtime container when `spec.runtime: external`. |

All seven are namespaced. All seven follow the operator's existing
phase lifecycle: `Pending → Creating → Running → Degraded → Deleting`.
All seven mint standard `status.conditions` (`Ready`, `Synced`,
`Available`).

### Replacement table

The operator estate this displaces, and the Hanzo CRD that subsumes
each:

| Subsumed responsibility | Hanzo CRD | Notes |
|---|---|---|
| TFJob, PyTorchJob, MPIJob, XGBoostJob, JAXJob | `TrainingJob` | One Kind. `spec.framework` selects pod template + worker/parameter-server topology. |
| MLflow Tracking + tracking server | `Experiment` | Metric writes go to `hanzoai/datastore`; artifact writes go to `hanzoai/vfs`; UI lives in Hanzo Console. |
| Katib Experiment | `Sweep` | Bayesian/grid/random default. BYO algorithm via in-process extension (HIP-0105). |
| KFP Pipeline + Argo backend | `Pipeline` | DAG durable execution on `hanzoai/tasks`. No Argo. |
| Notebook Operator | `Notebook` | One JupyterLab image with IAM SSO sidecar. Per-tenant. |
| MLflow Model Registry | `Model` | Metadata in `hanzoai/base`; blobs in `hanzoai/vfs`. |
| KServe / Seldon Core | `Inference` | Routes to `hanzoai/engine` (Rust, Candle) or external runtime. |
| Profile Controller (open-source) | `hanzoai/iam` | Per-org isolation already handled. No new controller. |
| Dex | `hanzoai/iam` | Single IDP across all subsystems. |
| Central Dashboard | Hanzo Console `/ml/*` views | Out of scope for this HIP. |

The replacement is **functional, not source-level**. Zero lines of
open-source operator code are imported, vendored, or forked. The
Hanzo operator is a clean-room Rust implementation.

### Architecture

```
External clients
  ├── MCP-aware models/IDEs → ml.create_training_job, query_experiment, ...
  ├── A2A federation        → ml agents accept task delegation
  └── ACP compat (optional) → IDE/coding-agent clients

K8s API
  └── ml CRDs (TrainingJob, Experiment, Sweep, Pipeline, Notebook, Model, Inference)
      └── hanzoai/operator (Rust) reconciles
          ├── pods/services/PVCs
          └── GPU/CPU/memory scheduling

cloud subsystem mounts (HTTP routes):
  /v1/ml/jobs, /v1/ml/experiments, /v1/ml/sweeps, /v1/ml/pipelines,
  /v1/ml/notebooks, /v1/ml/models, /v1/ml/inference

Hanzo primitives consumed:
  hanzoai/iam      — auth via JWT, per-org isolation
  hanzoai/vfs      — artifact storage (S3-compat)
  hanzoai/datastore — experiment metrics (OLAP)
  hanzoai/base     — per-tenant SQLite (model registry metadata, run config)
  hanzoai/tasks    — pipeline DAG durable runner (HIP-0108)
  hanzoai/o11y     — infrastructure observability
  hanzoai/insights — AI-specific observability (LLM traces, eval)
  hanzoai/engine   — Rust inference serving
  hanzoai/ml       — Candle-based ML primitives (used INSIDE training containers)
```

### `TrainingJob` shape

```yaml
apiVersion: hanzo.ai/v1
kind: TrainingJob
metadata:
  name: imagenet-finetune
  namespace: tenant-acme
spec:
  framework: pytorch              # tensorflow|pytorch|mpi|xgboost|jax|candle|hanzo-ml
  image: ghcr.io/acme/trainer:v1.2.0
  command: ["python", "train.py"]
  workers:
    replicas: 4
    resources:
      requests: { nvidia.com/gpu: "1", cpu: "8", memory: "32Gi" }
  parameterServer:                # optional, framework-specific
    replicas: 1
  master:                         # optional, MPI/PyTorch DDP master
    replicas: 1
  artifacts:                      # writes go to hanzoai/vfs
    output: vfs://tenant-acme/runs/imagenet-finetune/v1
  experiment:                     # optional binding to an Experiment CR
    name: acme-finetune-2026q2
  env:
    - name: WANDB_DISABLED
      value: "true"
  ttlSecondsAfterFinished: 86400
status:
  phase: Running
  conditions: [...]
  workersReady: 4
  workersTotal: 4
  startTime: "2026-05-18T...Z"
  artifactURI: vfs://tenant-acme/runs/imagenet-finetune/v1
```

The framework field selects which pod-topology builder runs. The
operator ships exactly one image-agnostic worker/master/parameter-
server template per framework. Customer code is in
`spec.image` + `spec.command`; the operator never injects framework
sidecars beyond what the canonical template requires.

### `Experiment` shape

```yaml
apiVersion: hanzo.ai/v1
kind: Experiment
metadata:
  name: acme-finetune-2026q2
  namespace: tenant-acme
spec:
  description: "Q2 fine-tune sweep across LR / batch size"
  tags: { team: vision, project: imagenet }
  metricsBackend: datastore        # hanzoai/datastore (default)
  artifactsBackend: vfs            # hanzoai/vfs (default)
  metadataBackend: base            # hanzoai/base per-tenant SQLite (default)
status:
  phase: Running
  runs: 17
  bestRun:
    name: imagenet-finetune-r12
    metric: { name: val_acc, value: 0.823 }
```

Experiments are durable handles. `TrainingJob.spec.experiment.name`
binds a job to an experiment; the operator wires the binding into the
container env so the customer's training script can write metrics to
the right experiment without knowing the metric backend URL.

### `Sweep` shape

```yaml
apiVersion: hanzo.ai/v1
kind: Sweep
metadata:
  name: lr-sweep-q2
  namespace: tenant-acme
spec:
  experiment: acme-finetune-2026q2
  algorithm: bayesian             # bayesian|grid|random
  maxTrials: 50
  parallelism: 4
  objective:
    metric: val_acc
    goal: maximize
  parameters:
    - name: learning_rate
      type: log_uniform
      min: 1e-5
      max: 1e-2
    - name: batch_size
      type: choice
      values: [32, 64, 128]
  template:                       # TrainingJob template
    framework: pytorch
    image: ghcr.io/acme/trainer:v1.2.0
    workers: { replicas: 2 }
status:
  phase: Running
  trialsRunning: 4
  trialsCompleted: 12
  bestTrial: { name: lr-sweep-q2-t7, value: 0.811 }
```

Sweep spawns child `TrainingJob`s with parameter assignments injected
via env. Default algorithm is Bayesian (Tree-Parzen Estimator); grid
and random are also built in; BYO algorithm via HIP-0105 extension
module.

### `Pipeline` shape

```yaml
apiVersion: hanzo.ai/v1
kind: Pipeline
metadata:
  name: train-eval-deploy
  namespace: tenant-acme
spec:
  steps:
    - name: prep
      type: container
      image: ghcr.io/acme/prep:v1
    - name: train
      type: trainingjob
      dependsOn: [prep]
      template:
        framework: pytorch
        image: ghcr.io/acme/trainer:v1
        workers: { replicas: 4 }
    - name: eval
      type: container
      dependsOn: [train]
      image: ghcr.io/acme/eval:v1
    - name: deploy
      type: inference
      dependsOn: [eval]
      template:
        runtime: engine
        model: { name: acme-resnet50, version: latest }
  taskQueue: hanzo-tasks            # delegates to hanzoai/tasks (HIP-0108)
status:
  phase: Running
  currentStep: train
  completedSteps: [prep]
```

Pipelines do **not** own their own scheduler. They submit each step
as a durable task on `hanzoai/tasks` and reconcile the resulting
status into `Pipeline.status`. One DAG runner, one place — no
parallel scheduler stack.

### `Notebook` shape

```yaml
apiVersion: hanzo.ai/v1
kind: Notebook
metadata:
  name: alice-dev
  namespace: tenant-acme
spec:
  image: ghcr.io/hanzoai/notebook:v1.0.0
  resources:
    requests: { nvidia.com/gpu: "0", cpu: "2", memory: "4Gi" }
  storage:
    size: 20Gi
    storageClass: ""               # defaults to cluster default
  idleTimeoutSeconds: 1800         # HIP-0108 tier-2 idle eviction
  user: { email: alice@acme.com }  # IAM SSO sidecar gates by email
status:
  phase: Running
  url: https://nb-alice-dev.tenant-acme.cloud.hanzo.ai
```

The notebook base image (`ghcr.io/hanzoai/notebook:v1.0.0`) is a
JupyterLab image with the IAM SSO sidecar pre-baked. Per-user, per-
tenant isolation. Idle eviction follows HIP-0108. The actual image
build lives at `~/work/hanzo/notebook` (separate repo, separate
release cadence).

### `Model` shape

```yaml
apiVersion: hanzo.ai/v1
kind: Model
metadata:
  name: acme-resnet50
  namespace: tenant-acme
spec:
  framework: pytorch
  artifact: vfs://tenant-acme/models/acme-resnet50/v1.bin
  signature:                       # input/output tensor specs
    inputs:
      - { name: image, shape: [1, 3, 224, 224], dtype: float32 }
    outputs:
      - { name: logits, shape: [1, 1000], dtype: float32 }
  tags: { team: vision }
  versions:
    - name: v1
      artifact: vfs://tenant-acme/models/acme-resnet50/v1.bin
      createdAt: "2026-05-01T...Z"
    - name: v2
      artifact: vfs://tenant-acme/models/acme-resnet50/v2.bin
      createdAt: "2026-05-18T...Z"
  metadataBackend: base
status:
  phase: Available
  currentVersion: v2
  totalVersions: 2
```

Metadata in per-tenant `hanzoai/base` SQLite (one row per Model CR,
versions as JSON; or normalized — implementation detail). Blobs in
`hanzoai/vfs`. There is no separate "model registry server"; the
operator's `Model` CR is the registry.

### `Inference` shape

```yaml
apiVersion: hanzo.ai/v1
kind: Inference
metadata:
  name: resnet50-prod
  namespace: tenant-acme
spec:
  runtime: engine                  # engine|external
  model:
    name: acme-resnet50
    version: v2
  replicas: 3
  resources:
    requests: { nvidia.com/gpu: "1", cpu: "2", memory: "8Gi" }
  autoscaling:
    enabled: true
    minReplicas: 1
    maxReplicas: 10
    targetGPUUtilization: 70
  ingress:
    enabled: true
    hosts: [resnet50.tenant-acme.cloud.hanzo.ai]
status:
  phase: Running
  url: https://resnet50.tenant-acme.cloud.hanzo.ai
  readyReplicas: 3
  desiredReplicas: 3
```

`runtime: engine` materializes pods that pull `ghcr.io/hanzoai/engine`
and load the model from `vfs`. `runtime: external` lets the customer
ship their own serving image (Triton-style or any other) — the
operator just provides the K8s plumbing (Deployment + Service +
Ingress + HPA + PDB + NetworkPolicy + KMSSecret).

### Auth, multi-tenancy, and per-org scoping

All seven CRDs live in tenant namespaces (`tenant-<org-slug>`). The
operator runs cluster-wide and watches CRs across namespaces, but
every action enforces:

- The namespace's `hanzo.ai/org` label matches the tenant the request
  comes from (when the request is over HTTP/REST or MCP).
- `spec.image` is pull-allowed from the tenant's image-pull-secret
  list (KMSSecret-managed per the existing operator pattern).
- Artifacts written to `vfs://<tenant-org>/...` paths.
- Experiment metrics scoped by `org_id` in `hanzoai/datastore`.
- Notebook IAM sidecar gates by the tenant's IAM application.

No cross-tenant CR visibility. No cross-tenant artifact reads. No
cross-tenant metric reads. The pattern matches every other Hanzo
subsystem.

### HTTP surface mounted by the `cloud` subsystem

The operator is the source of truth for CRD state. The HTTP layer is
a thin facade the `cloud` subsystem mounts when the `ml` flag is
enabled:

```
POST   /v1/ml/jobs                          → create TrainingJob
GET    /v1/ml/jobs                          → list TrainingJob
GET    /v1/ml/jobs/{name}                   → read TrainingJob
DELETE /v1/ml/jobs/{name}                   → delete TrainingJob
POST   /v1/ml/jobs/{name}/cancel            → cancel TrainingJob

POST   /v1/ml/experiments                   → create Experiment
GET    /v1/ml/experiments                   → list Experiment
GET    /v1/ml/experiments/{name}            → read Experiment
GET    /v1/ml/experiments/{name}/runs       → list runs (from datastore)
GET    /v1/ml/experiments/{name}/metrics    → metric stream (from datastore)

POST   /v1/ml/sweeps                        → create Sweep
GET    /v1/ml/sweeps                        → list Sweep
GET    /v1/ml/sweeps/{name}                 → read Sweep
GET    /v1/ml/sweeps/{name}/trials          → list child TrainingJobs

POST   /v1/ml/pipelines                     → create Pipeline
GET    /v1/ml/pipelines                     → list Pipeline
GET    /v1/ml/pipelines/{name}              → read Pipeline
POST   /v1/ml/pipelines/{name}/run          → trigger an execution

POST   /v1/ml/notebooks                     → create Notebook
GET    /v1/ml/notebooks                     → list Notebook
GET    /v1/ml/notebooks/{name}              → read Notebook
POST   /v1/ml/notebooks/{name}/stop         → stop (sets idleTimeoutSeconds=0)

POST   /v1/ml/models                        → create Model (registry entry)
GET    /v1/ml/models                        → list Model
GET    /v1/ml/models/{name}                 → read Model
POST   /v1/ml/models/{name}/versions        → add a version (metadata)

POST   /v1/ml/inference                     → create Inference
GET    /v1/ml/inference                     → list Inference
GET    /v1/ml/inference/{name}              → read Inference
POST   /v1/ml/inference/{name}:predict      → forward predict call to engine
```

Same JWT auth as every other `/v1/*` endpoint. Same `X-Org-Id` header
contract. Same in-process ZAP call from the cloud subsystem to the
operator-exposed ZAP service. No `/api/` prefix.

### MCP tools surface

The operator's actions are exposed as MCP tools when an MCP server is
mounted alongside (typical for Hanzo Cloud deployments):

- `ml.create_training_job(spec) → { name, namespace, phase }`
- `ml.query_training_job(name) → TrainingJobStatus`
- `ml.cancel_training_job(name) → bool`
- `ml.create_experiment(spec) → Experiment`
- `ml.query_experiment(name) → ExperimentStatus`
- `ml.list_experiments(filter?) → [Experiment]`
- `ml.create_sweep(spec) → Sweep`
- `ml.query_sweep(name) → SweepStatus`
- `ml.create_pipeline(spec) → Pipeline`
- `ml.run_pipeline(name) → PipelineRun`
- `ml.create_notebook(spec) → Notebook`
- `ml.stop_notebook(name) → bool`
- `ml.register_model(spec) → Model`
- `ml.list_models(filter?) → [Model]`
- `ml.deploy_inference(spec) → Inference`
- `ml.predict(name, payload) → ndarray`

The MCP tool definitions are co-located with the Rust types and
generated at build time. **MCP is a surface; it is not the API.** The
canonical API is the K8s CRDs and the HTTP routes.

## Non-goals

- **Bringing in the open-source ML operator estate as a dependency.**
  Zero lines vendored. The Hanzo operator is a clean-room Rust
  implementation that consumes only Hanzo primitives.
- **Making MCP the ML control plane.** MCP exposes ML actions as
  tools. The control plane is the CRD API plus the HTTP mux.
- **Making A2A the ML job API.** A2A delegates tasks between agents.
  Agents call the ML control plane via HTTP/REST like any other
  client.
- **Folding Python training runtimes into the Go binary.** Per
  HIP-0106, Python services with native ML deps stay out of the
  unified binary. Training containers run as their own pods,
  scheduled by the operator.
- **Replacing Hanzo Flow.** Flow is a visual ML pipeline / agent-
  building tool. Different concern. Flow can submit Pipelines via the
  HTTP surface like any other client.
- **Replacing Hanzo Auto.** Auto is an IFTT-style trigger framework
  on top of `hanzoai/tasks`. Different concern. Auto can call
  `/v1/ml/*` like any other client.
- **`hanzoai/ml` (Rust) becoming the control plane.** It stays as
  Candle-based ML primitives consumed inside training containers,
  not as the scheduler.
- **Multi-cluster scheduling.** Out of scope — see Open Questions.

## Open questions

1. **Multi-cluster scheduling.** Defer to a future HIP. For now, the
   operator is a single-cluster reconciler per Hanzo deployment.
   Cross-cluster federation can be layered later via A2A delegation
   between cluster-local ML agents.

2. **Notebook base image story.** Where does
   `ghcr.io/hanzoai/notebook:v1.0.0` live? Likely a `hanzoai/notebook`
   repo with the JupyterLab + IAM SSO sidecar image. Tracked
   separately; the operator only consumes the image.

3. **Sweep optimization library.** Default is Bayesian (Tree-Parzen
   Estimator). Pure Rust implementation in
   `operator/crates/ml-controller/src/sweep_opt.rs`. Grid and random
   are trivial. BYO algorithm via HIP-0105 extension module — open
   question is whether a stable plugin API graduates from
   "experimental" in v0.2.

4. **Console ML view.** Whether to fork the open-source ML pipeline
   frontend or write a clean Hanzo Console ML view from scratch. The
   sibling work tracks this; the operator is decoupled from the
   answer (the HTTP/REST surface is stable regardless).

5. **In-cluster GPU scheduling fairness.** Cross-tenant GPU fairness
   on a shared cluster is a real production concern. The operator's
   `TrainingJob` reconciler respects K8s resource requests but does
   not yet implement gang scheduling or fair-share. Either land that
   in v0.2 or document that gang scheduling is out of scope and
   require workloads that need it to use dedicated nodepools.

6. **Pipeline retry semantics on partial step failure.** Default is
   `hanzoai/tasks`'s retry policy. Whether to expose
   `spec.steps[].retryPolicy` at the Pipeline level for per-step
   overrides — yes, but tracked for v0.2.

7. **Experiment metric write rate limiting.** A misbehaving training
   loop can flood `hanzoai/datastore`. Need a per-experiment metric
   write quota; suggested default is 1000 writes/sec/experiment.
   Tracked for v0.2.

## Pending additions (v0.1.x roadmap)

The v0.1.0 CRD set covers TrainingJob / Experiment / Sweep / Pipeline /
Notebook / Model / Inference. The upstream Kubeflow project family also
ships a Spark Operator + Hub (Model Registry); to cover the full
lifecycle Hanzo ML will add in subsequent v0.1.x releases:

| Object | Replaces / competes with | Purpose | Target |
|---|---|---|---|
| **SparkJob** | Kubeflow Spark Operator | Spark + data workloads on K8s | v0.1.1 |
| **Run** | KFP / MLflow run record | One execution of a Pipeline / Sweep / Training | v0.1.1 |
| **Metric** | MLflow / Katib metric stream | Time-series + scalar metrics per Run | v0.1.1 |
| **ModelVersion** | MLflow Model Registry version | Versioned record of a Model | v0.1.1 |
| **Artifact** | KFP / MLflow artifact metadata | VFS-backed artifact pointer | v0.1.1 |

After these, Hanzo ML provides Kubeflow's full project surface
(Spark Operator, Notebooks, Trainer, Katib, KServe, Hub/Model Registry,
Pipelines, Dashboard) on Hanzo primitives, with one operator binary and
no Kubeflow estate dependency.

## Positioning

Hanzo ML is **not** a Kubeflow distribution. It is the Hanzo-native
integrated ML control plane for teams that want the same lifecycle
coverage — training, data jobs, notebooks, experiments, sweeps,
pipelines, model registry, and inference — wired directly into Hanzo
IAM, VFS, datastore, observability, MCP, billing, and white-label
cloud.

Kubeflow's strength is community modularity across many CNCF projects.
Hanzo ML's strength is integration with fewer moving parts. Both are
valid choices for different organizations.

## References

- HIP-0026 — IAM Standard (auth for ML control plane)
- HIP-0027 — Secrets Management Standard (KMSSecret CRs for image
  pull credentials, model registry credentials)
- HIP-0106 — Cloud / Unified Hanzo Binary (the HTTP mux that mounts
  `/v1/ml/*`)
- HIP-0108 — On-Demand Supervisor + Warm Pool (tier-2 idle eviction
  for notebooks and inference replicas)
- HIP-0037 — AI Cloud Platform (the `ai` subsystem; ML control plane
  is a sibling)
- HIP-0067 — Federated Learning Standard (downstream consumer of
  `TrainingJob`)
- HIP-0010 — MCP Integration Standards (the protocol the ML tools
  surface speaks)
- Upstream references (do NOT vendor or fork): Kubeflow project
  (https://www.kubeflow.org), MLflow (https://mlflow.org), Katib
  (https://www.kubeflow.org/docs/components/katib/), KServe
  (https://kserve.github.io), Seldon Core
  (https://www.seldon.io/solutions/seldon-core).
