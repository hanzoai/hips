---
hip: 1333
title: Train — One Endpoint for Training
author: Hanzo AI
type: Standards Track
category: Infrastructure
status: Draft
implementation-go: partial
implementation-rust: partial
created: 2026-09-28
requires: HIP-0026, HIP-0043, HIP-0106, HIP-0139, HIP-1145, HIP-1313, HIP-1332
---

# HIP-1333: Train — One Endpoint for Training

## Abstract

`/v1/train` is the cloud's one training endpoint. It teaches a base model one new
capability while holding what the model already does, and its first-class output is a
capability artifact, not a new model. It is implemented in `hanzoai/cloud` at
`apps/train`. Clients run on `hanzoai/engine` (HIP-0043); managed jobs run on the org's
linked machines, Kai's (HIP-1332) through `train serve` in `hanzoai/decision`.

Two nouns and no others. A **client** is the loop the caller drives: the Tinker-shaped
`create → forward_backward → optim_step → sample → save_weights` wire. A **job** is the loop
the platform drives. Adaptation, protection, objective, evaluation and output are fields
of those two objects; artifacts, bases and evaluations are what a job produces.

## Motivation

Three training surfaces existed and none could teach a capability safely:

- `/v1/training/*`, the engine's Tinker-shaped wire, reached by an ingress carve straight
  to the engine pod, admin-only because the engine authenticates nobody
  (`hanzoai/universe` `infra/k8s/ingress/routes.yaml`, `training-guard`).
- `/v1/ai/finetune/*`, the managed-job broker in `hanzoai/ai`, authenticated by the
  console session cookie, which no bearer caller carries, and submitting Kubeflow
  `TrainJob` resources the cluster does not serve (`hanzoai/cloud` `apps/ml` package
  doc).
- Kai's stage training (`train fit`, `train join`), reachable only from a shell.

Each changed weights without a statement of what must not regress, and none produced an
artifact that could be evaluated, merged or published apart from its base.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as in
RFC 2119.

### §1 The store

One per-org SQLite file, `train.db`, through `cloud.OrgStore` (HIP-0106): jobs, their
tasks, their events, the org's clients and the org's artifacts. Artifact bytes are in
Hanzo S3, bucket `TRAIN_BUCKET` (default `hanzo-train`), key `<org>/<sha256>`. Nothing
else is stored and no other capability's store is read.

### §2 The addresses

All under `/v1/train`. Every operation is typed.

| method and path | what |
|---|---|
| `POST /v1/train/clients` | create a client: `base_model`, `lora_config`, `adaptation`, `protect` |
| `GET /v1/train/clients` | the org's clients |
| `GET /v1/train/clients/{id}` | one client, with its loss history |
| `DELETE /v1/train/clients/{id}` | drop it and free its memory |
| `POST /v1/train/clients/{id}/forward_backward` | accumulate gradients over `data` |
| `POST /v1/train/clients/{id}/optim_step` | apply the optimizer |
| `POST /v1/train/clients/{id}/sample` | decode from the current weights |
| `POST /v1/train/clients/{id}/save_weights` | write the adapter |
| `POST /v1/train/jobs` | create a job |
| `GET /v1/train/jobs` | the org's jobs, newest first (`?status=`) |
| `GET /v1/train/jobs/{id}` | one job: its spec, status, result, artifacts |
| `POST /v1/train/jobs/{id}/cancel` | stop it |
| `POST /v1/train/jobs/{id}/publish` | publish its output |
| `GET /v1/train/jobs/{id}/events` | its events after a cursor, waiting up to `wait` seconds |
| `GET /v1/train/jobs/{id}/metrics` | its metric series |
| `GET /v1/train/jobs/{id}/artifacts` | its artifacts, each with a short-lived download URL |
| `GET /v1/train/models` | each trainable base and what it supports today |
| `POST /v1/train/jobs/claim` | an executor's long poll for a task |
| `POST /v1/train/jobs/{id}/events` | an executor's report |
| `POST /v1/train/jobs/{id}/artifacts` | an executor's artifact, answered with an upload grant |

The client wire is the engine's, byte for byte, except its path: a Tinker-shaped loop
written against `/v1/training/clients` runs against `/v1/train/clients` with no other
change. `/v1/training/*` and `/v1/ai/finetune/*` MUST NOT answer once `/v1/train` is
served; neither is kept as an alias.

### §3 The job

```json
{
  "base_model": "kai", "revision": "a7",
  "dataset": {"uri": "stage:a11", "splits": {"train": "train", "validation": "validation"}},
  "objective": {"loss": "cross_entropy",
                "terms": [{"kind": "pairwise_margin", "weight": 1, "margin": 0.5},
                          {"kind": "consistency", "weight": 0.5}]},
  "adaptation": {"mode": "orthogonal_subspace"},
  "protect": {"suites": ["typed_decisions", "ag_news"],
              "methods": ["functional_distillation"],
              "budget": {"accuracy": 0.02, "ece": 0.03}},
  "resources": {"machines": ["dgx", "evo"], "steps": 2000},
  "evaluation": {"suites": ["labels"], "project": "kai"},
  "output": {"kind": "capability", "name": "open-labels"}
}
```

- `base_model` names a trainable base (§4); `revision` pins it. The executor resolves the
  revision to the weights' SHA-256, which the job records as `base.sha256`.
- `dataset.uri` is `hf://<repo>[@<rev>]`, `s3://<bucket>/<key>`, `artifact:<sha256>` (an
  artifact the org holds) or, for Kai, `stage:<name>`: that stage's data build as the
  executor holds it, pinned by its manifest hash.
- `objective.loss` is `cross_entropy`. `terms` add `pairwise_margin` (a hinge between a
  group's attack and benign rows, with `margin`), `hard_margin` (a hinge between gold and
  the hardest negative) and `consistency` (symmetric KL across a group's views), each
  with a `weight`.
- `adaptation.mode` is one of `full`, `lora`, `qlora`, `eigenlorax`,
  `orthogonal_subspace`, `universal_subspace`, `auto`. `lora` and `qlora` take `rank`,
  `alpha`, `targets`. `eigenlorax` takes `sources` (lora artifacts) or `basis`, and
  `residual_rank`. `universal_subspace` takes `basis` and `residual_rank`.
  `orthogonal_subspace` confines the update to the complement of the subspace the
  protected suites' gradients span at the base, and requires `protect.suites`. `auto`
  chooses, and the job's `adaptation.chose` says what and why.
- `protect.suites` names capabilities the base already has. `methods` are
  `gradient_projection` (each step's gradient projected off the protected suites'
  directions, for adapter modes; on a full-weight update that is `orthogonal_subspace`
  and MUST be spelled so) and `functional_distillation` (KL to the base's answers on a
  preservation set drawn from those suites). `budget` bounds the regression the job may
  cause on each protected suite: accuracy down at most `accuracy`, calibration error up
  at most `ece`.
- `resources.machines` names linked machines (the first leads); absent, the first
  executor of the org that claims leads alone. `steps` bounds optimizer steps; `seconds`
  bounds wall time.
- `evaluation.suites` are the target suites; `project` is the research project the
  results are filed under (§8).
- `output.kind` is `checkpoint`, `lora`, `capability`, `basis` or `merged`, with a `name`.
- `from` names an artifact the job starts from. A job with `from` and no `dataset` trains
  nothing: it evaluates (`evaluation` set), merges (`output.kind` `merged`) or extends a
  basis (`output.kind` `basis`).

A create is validated in this order, and the first failure is the answer: the shape
(`400 invalid_request`), the base (`400 unsupported_base`, naming the bases), the
inputs' agreement (`400 incompatible_adapters` when `sources` differ in base, revision
or module set; `400 incompatible_basis` when a basis belongs to another base), then
each choice against §4 (`400 unsupported_adaptation`, `unsupported_objective`,
`unsupported_protect`, `unsupported_output`), each naming in `supported` what that base
runs today. Incompatible inputs are never projected into agreement, and an unsupported
choice is never accepted and left to fail later. A refusal is an RFC 9457 problem
document carrying `code`.

### §4 What each base runs

`GET /v1/train/models` answers this table from the same code that validates a create;
the two cannot disagree. Today:

| base | executor | adaptation | protect | objective terms | output |
|---|---|---|---|---|---|
| `kai` | `train serve`, jobs only | `full`, `orthogonal_subspace`, `auto` (chooses `full`, or `orthogonal_subspace` when `protect.suites` is set) | `functional_distillation` | `pairwise_margin`, `hard_margin`, `consistency` | `checkpoint`, `capability` |
| engine LLMs (Hugging Face causal LMs the engine loads) | engine, clients only | `lora` | none | none | `lora` |

A client on `kai` and a job on an engine LLM are refused as `unsupported_base` for that
noun. `qlora`, `eigenlorax`, `universal_subspace`, `basis` and `merged` are specified
and run nowhere yet; asking for them is a `400` naming the supported set. A base gains a
row when its executor implements the row.

For Kai the job becomes a stage file (HIP-1332): the stage named by `dataset.uri`, its
init replaced by `revision`, `objective.terms` its `terms`, `protect` its `protect`
(`orthogonal_subspace` sets `protect.project`; `functional_distillation` sets
`protect.distill`), `resources.steps` its `max_steps`.

### §5 Lifecycle

`queued → running → evaluating →` one of `succeeded`, `rejected`, `failed`,
`cancelled`. `rejected` means the run finished and broke its regression budget: its
artifacts are kept and it is not publishable by default.

A job is one `lead` task and one `join` task per further machine. An executor claims
with `POST /v1/train/jobs/claim` (`machine`, `bases`, `devices`), holding the request up
to 25 seconds; it is answered one task, or `204`. A `join` task is offered only once its
lead has reported the address it coordinates on. The claim answers a `lease`, returned
once and stored as its SHA-256; every report for the task carries it, and a report under
a lease that is not the task's current one is `409 lease_lost`. A task with no report for
`TRAIN_LEASE_TTL` (default 10 minutes) loses its lease, and the job fails with
`executor_lost`: a Kai run resumes only where its checkpoint is, so it is not moved.

`POST /v1/train/jobs/{id}/events` carries `status`, `coordinator` (the lead's address),
`metric` (`name`, `step`, `value`), `log`, `artifact` and `result`. Its answer says
`cancel: true` once the job is cancelled, and the executor MUST stop its trainer.

### §6 Artifacts

An artifact is one object named by the SHA-256 of its bytes. A directory is packed as a
tar of its files in name order, with zero times, owners and modes `0644`, so the same
files are the same artifact. The executor asks `POST /v1/train/jobs/{id}/artifacts`
(`kind`, `name`, `sha256`, `size`) and is answered a presigned `PUT` to `<org>/<sha256>`
that S3 accepts only with that checksum, or `stored: true` when the org already holds
those bytes. The artifact is `stored` once an `artifact` event names it and the object's
size and checksum read back equal.

- `checkpoint`: the trained model whole (Kai: `kai.json`, `model.safetensors`,
  `tokenizer/`).
- `capability`: what the job taught, apart from its base: the changed tensors as `W − W₀`
  in `delta.safetensors`, and `capability.json` naming the base and its SHA-256, the
  adaptation, the protected suites and the evaluation. Applied to that base it is the
  checkpoint.
- `lora`: a PEFT adapter.
- `basis`: a subspace, `basis://<base>/<name>`, versioned by the jobs that extend it,
  carrying its explained variance by rank.
- `merged`: a base with a capability or adapter folded in.

### §7 Clients

A create is validated like a job's (§3, §4), then forwarded to the engine
(`ENGINE_UPSTREAM`); the client's id is recorded under the org. Every other client
operation looks the id up in the org's store first, so another org's client answers
exactly as an unknown one does. An org holds at most `TRAIN_CLIENTS` (default 2) live
clients. `save_weights` writes the adapter on the engine, as the engine's wire says;
exporting it as an artifact is not specified yet.

### §8 Evaluation and research

A job with `protect` or `evaluation` is evaluated by its executor before it ends: the
base and the trained model on the target and protected suites of the dataset's
validation split, per suite accuracy, log loss and 15-bin expected calibration error.
The verdict is `accepted` when every protected suite stays within the budget, else
`rejected`; the target suites' change is reported and does not decide. The executor
files each suite as a research run (HIP-1145) under `evaluation.project`, the base as
the `baseline`, and reports the run ids, which the job carries in `result.research`.

### §9 Tenancy

The org is the gateway's verdict, never a body, query or path value (HIP-0026). A job,
task, client or artifact of another org answers `404` exactly as an unknown one does.
An executor acts as a principal of the org whose jobs it claims; it can claim no other
org's. A task's reports need its lease besides the org's credential. Artifact grants are
scoped to one key under the org's prefix and live 30 minutes; download URLs live 10.

### §10 Money

The plugin declares `Price: cloud.Metered`. Through the org's meter (HIP-1313):

- stored artifacts, per GB-month at `train/storage`, the first month when stored;
- client compute, per engine-second of each forwarded operation at `train/client`;
- job compute on a linked machine is the org's own hardware and is recorded, not
  charged; platform-run executors are not offered yet.

Rates are rows in commerce's meter authority read through `cloud.RateCents`, with the
compiled floor when absent.

### §11 Events and observability

It publishes nothing on the bus. A job's events and metrics are its own record, read
back through `/v1/train/jobs/{id}/events` and `/metrics`. Beyond the request span every
route gets, it emits structured log lines at each job transition.

### §12 Stage

`alpha`: its prefix answers `404` to an org without the flag `train`. It is promoted
after an adversarial review of its tenancy and its executor and client paths. Until then
this HIP declares no `capability:` (HIP-0139 §5).

### §13 Upstream

It forks no project. The client wire mirrors the Tinker API's shape (Thinking Machines
Lab) with Hanzo field names, a wire we implement. EigenLoRAx, orthogonal-subspace
learning and gradient projection memory are published methods; no code of theirs is
used.

## Rationale

Folding into one endpoint rather than adding a third was the owner's decision and the
cheaper one: `/v1/ai/finetune` could not be called with a bearer and its executor did
not exist in the cluster, and `/v1/training` was an ingress carve around the cloud's
tenancy. The engine's wire was kept whole because loops already run against it.

Jobs run on the org's linked machines because that is where Kai trains and where a
model's data already is. A scheduler that placed Kai on cluster pods would copy a data
build per run and discard the resume a local checkpoint gives.

The capability artifact is a delta over a named base rather than a new model because a
delta can be evaluated against its base, merged into it, or refused, and a new model can
only replace one.

## Security Considerations

A wrong org scope hands one tenant another's weights or data: every read is keyed by the
gateway's org, and absence and foreignness answer the same `404`. A forged report could
mark a regressing run `accepted`: reports need the task's lease, fenced per claim, and
the verdict records the executor and machine that produced it, but an org's own
executor is trusted with its org's verdicts. A client holds a model in the engine's
memory, which also serves inference: the per-org cap and the stage bound it until
per-org engine isolation exists. Upload grants are write-only, single-key and
checksum-bound, so a grant cannot overwrite another object or store bytes under a hash
they do not have.

## References

- HIP-0026 — Identity & Access Management Standard
- HIP-0043 — Hanzo Engine — LLM Inference Engine Standard
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1145 — Research — The Experiment Record
- HIP-1313 — Usage — The Metered Record
- HIP-1332 — Kai — The Decision Model and the Decision Plane

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
