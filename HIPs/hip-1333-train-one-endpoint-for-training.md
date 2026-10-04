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
requires: HIP-0026, HIP-0043, HIP-0106, HIP-0118, HIP-0139, HIP-1145, HIP-1313, HIP-1332
---

# HIP-1333: Train — One Endpoint for Training

## Abstract

`/v1/train` is the cloud's one training endpoint. It teaches a base model one new
capability while holding what the model already does, and its first-class output is a
capability artifact, not a new model. It is implemented in `hanzoai/cloud` at
`apps/train`. Clients run on `hanzoai/engine` (HIP-0043); managed jobs run on the org's
linked machines or on Hanzo's executor, Kai's (HIP-1332) through `train serve` in
`hanzoai/decision`. A job Hanzo runs is billed by the device-second inside a window held
ahead of it, so it never runs past what its payer can pay.

Two nouns and no others. A **client** is the loop the caller drives: the
`create → forward_backward → optim_step → sample → save_weights` wire. A **job** is the loop
the platform drives. Adaptation, protection, objective, evaluation and output are fields
of those two objects; artifacts, bases and evaluations are what a job produces.

## Motivation

Training has to teach a base one capability without regressing what it already does, and
has to produce something that can be evaluated, merged or published apart from that base.
It also has to sit behind the gateway's bearer and org. The surfaces this replaces (§14)
do none of that: the engine's wire is an admin-only ingress carve, because the engine
authenticates nobody; `hanzoai/ai`'s managed jobs take only a console session cookie and
submit training-job resources the cluster does not serve; Kai's stage training runs only
from a shell.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as in
RFC 2119.

### §1 The store

One per-org SQLite file, `train.db`, through `cloud.OrgStore` (HIP-0106): jobs, their
tasks, their events, the org's clients, the org's artifacts and the objects holding their
bytes. Artifact bytes are in Hanzo S3, bucket `TRAIN_BUCKET` (default `hanzo-train`), key
`<org>/<sha256>`, each object encrypted under the org's own key (§6). Nothing else is
stored and no other capability's store is read.

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
| `GET /v1/train/models` | each trainable base and what it supports |
| `POST /v1/train/artifacts` | rows the org uploads (`kind: dataset`), answered with an upload grant |
| `GET /v1/train/artifacts` | the org's objects, one per sha256, with when retention deletes each |
| `GET /v1/train/artifacts/{sha256}` | one object, with a short-lived download URL |
| `DELETE /v1/train/artifacts/{sha256}` | delete one of the org's objects |
| `GET /v1/train/published` | every org's published capabilities; the platform credential only (§10) |
| `POST /v1/train/jobs/claim` | an executor's long poll for a task (§5) |
| `POST /v1/train/jobs/{id}/events` | an executor's report (§5) |
| `POST /v1/train/jobs/{id}/artifacts` | an executor's artifact, answered with an upload grant |

The client wire is the engine's, byte for byte.

### §3 The job

```json
{
  "base_model": "kai", "revision": "a7",
  "dataset": {"uri": "stage:a11", "splits": {"train": "train", "validation": "validation"}},
  "objective": {"loss": "cross_entropy",
                "terms": [{"kind": "pairwise_margin", "weight": 1, "margin": 0.5},
                          {"kind": "consistency", "weight": 0.5}]},
  "adaptation": {"mode": "full"},
  "protect": {"suites": ["typed_decisions", "ag_news"],
              "projection": {"strength": 0.5}, "distillation": true,
              "budget": {"accuracy": 0.02, "ece": 0.03}},
  "resources": {"machines": ["gpu-1", "gpu-2"], "steps": 2000},
  "evaluation": {"suites": ["labels"]},
  "output": {"kind": "capability", "name": "open-labels"}
}
```

`adaptation` says how the trained parameters are represented; `protect` says what they
must not damage. The two do not mix: every protection applies to whatever the
adaptation trains.

- `base_model` names a trainable base (§4); `revision` pins it. The executor resolves the
  revision to the weights' SHA-256, which the job records as `base.sha256`.
- `dataset.uri` is `hf://<repo>[@<rev>]`, `s3://<bucket>/<key>`, `artifact:<sha256>` or,
  for Kai, `stage:<name>`: that stage's data build as the executor holds it, pinned by its
  manifest hash. `artifact:<sha256>` names JSON Lines rows the org uploaded through
  `POST /v1/train/artifacts` (§6); a create reads the upload back before it accepts the
  job, and a sha256 the org did not upload is `400 invalid_request`.
- `objective.loss` is `cross_entropy`. `terms` add `pairwise_margin` (a hinge between a
  group's attack and benign rows, with `margin`), `hard_margin` (a hinge between gold and
  the hardest negative) and `consistency` (symmetric KL across a group's views), each
  with a `weight`.
- `adaptation.mode` is `full`, `readout`, `lora`, `qlora`, `basis` or `auto`. `readout`
  trains the head alone over the frozen base, and its capability is of form `head` (§6).
  `lora` and `qlora` take `rank`, `alpha` and `targets`. `basis` trains coefficients in a
  subspace: `basis` names a basis artifact (its sha256, or `basis://<base>/<name>`) or `sources` names lora
  artifacts to build one from; `rank` is how many of its directions are used, and
  `residual_rank` the rank of an orthonormal residual learned beside them (0: the
  coefficients alone). `auto` chooses, and `adaptation.chose` says what and why.
- `protect.suites` names capabilities the base already has, by suite; `capabilities`
  names capability artifacts, by sha256. `projection` projects every update — a full
  update, an adapter or a residual — off the protected directions: the subspace `P` the
  suites' gradients span at the base, and each named capability's subspace. Its
  `strength` λ in [0, 1] (default 1) scales it: `g' = g − λ·P g`. At λ = 1 the update
  keeps only what lies outside `P`; at 0 it is untouched. Each step reports the share
  of the gradient removed, per layer. `distillation` adds KL to the base's answers on a preservation set drawn from the
  suites. `budget` bounds the regression the job may cause on each protected suite:
  accuracy down at most `accuracy`, calibration error up at most `ece`.
- `resources.machines` names linked machines (the first leads); absent, Hanzo's executor
  runs the job and its compute is charged to the creator's wallet (§10). `devices` names
  the accelerator kinds it may run on — `cuda`, `rocm`, `metal`, `vulkan`, `cpu` — and,
  absent, any its base runs. `steps` bounds optimizer steps. `max_seconds` bounds the
  device-seconds the job's tasks use together, and `budget` what a job Hanzo runs may cost,
  in US cents; a job on the org's machines costs nothing, so `budget` with `machines` is
  `400 invalid_request`. Whichever bound is reached first stops the job (§10).
- `evaluation.suites` are the target suites (§8).
- `output.kind` is `checkpoint`, `lora`, `capability`, `basis` or `merged`, with a `name`.
  A job's result names one artifact of that kind; a job stopped before its result keeps
  the checkpoint its executor stored (§5).
- `from` names an artifact the job starts from. A job with `from` and no `dataset` trains
  nothing: it evaluates (`evaluation` set), merges (`output.kind` `merged`) or extends a
  basis (`output.kind` `basis`). No executor runs `from` yet (§4).

A create is validated in this order, and the first failure is the answer: the shape
(`400 invalid_request`), the base (`400 unsupported_base`, naming the bases), the
inputs' agreement (`400 incompatible_adapters` when `sources` differ in base, revision
or module set; `400 incompatible_basis` when a basis belongs to another base), then
each choice against §4 (`400 unsupported_adaptation`, `unsupported_objective`,
`unsupported_protect`, `unsupported_output`, `unsupported_device`), each naming in
`supported` what that base runs. A refusal is an RFC 9457 problem document carrying
`code`. A job Hanzo runs is then weighed against its payer (§10): `402
insufficient_balance` or `402 spend_cap_exceeded` when the payer cannot hold its first
window, `503 balance_unavailable` when the balance cannot be read, `403` when the caller
names no wallet to charge. Those three refusals are the money wire's body,
`{"error": {"code", "message"}}`.

### §4 What each base runs

`GET /v1/train/models` answers this table from the same code that validates a create;
the two cannot disagree.

| base | executor | adaptation | protect | objective terms | output | datasets | devices |
|---|---|---|---|---|---|---|---|
| `kai` | `train serve`, jobs only | `full`, `readout`, `auto` (chooses `full`) | `suites`, `projection` with `strength`, `distillation` | `pairwise_margin`, `hard_margin`, `consistency` | `checkpoint`, `capability` | `stage`, `artifact` | `cuda`, `rocm`, `metal`, `vulkan`, `cpu` |
| engine LLMs (Hugging Face causal LMs the engine loads) | engine, clients only | `lora` | none | none | `lora` | none | none |

A client on `kai` and a job on an engine LLM are refused as `unsupported_base` for that
noun. `qlora`, `basis`, `protect.capabilities`, the `basis` and `merged` outputs, `from`,
and `lora` on Kai are specified and run nowhere; asking for them is a `400`, naming the
supported set where there is one. A base gains a row when its executor implements the row.

For Kai the job becomes a stage file (HIP-1332): the stage named by `dataset.uri`, its
init replaced by `revision`, `objective.terms` its `terms`, `protect.suites` with
`projection` and `distillation` its `protect.project` (λ its `strength`) and
`protect.distill`, `resources.steps` its `max_steps`. `readout` holds every parameter
outside the head fixed (the stage's `frozen`). An `artifact:` dataset is fetched through
`GET /v1/train/artifacts/{sha256}` and built into the stage's data.

### §5 Lifecycle

`queued → running → evaluating →` one of `succeeded`, `rejected`, `failed`,
`cancelled`, `stopped`. `rejected` means the run finished and broke its regression
budget: its artifacts are kept and it is not publishable by default. `stopped` means the
job's own bounds or its payer's money ended it (§10): its `error` is the reason, the
checkpoint its executor stored is kept, and it is not publishable.

A job is one `lead` task and one `join` task per further machine. A task is claimed,
held under a lease, reported on and ended.

**Claim.** `POST /v1/train/jobs/claim`, held up to 25 seconds, is answered one task or
`204`:

```json
{"machine": "gpu-0", "platform": true, "bases": ["kai"], "devices": ["cuda", "cuda"],
 "supports": {"adaptations": ["full", "readout"], "protect": ["projection", "distillation"],
              "terms": ["pairwise_margin", "hard_margin", "consistency"],
              "outputs": ["capability", "checkpoint"]}}
```

`machine` names the claiming host. `devices` has one entry per accelerator, 1 to 64 of
`cuda`, `rocm`, `metal`, `vulkan`, `cpu`. `supports` is what the executor's build runs.
An executor acting as a principal of an org (`platform` false) is offered that org's
tasks placed on `machine`: a lead, or a join once its lead has reported the address it
coordinates on. Hanzo's executor sets `platform: true` under the platform credential
(§9) and is offered the oldest open lead of any org's job that names no machines. Either
is offered only a job whose `base_model` is in `bases`, whose adaptation, output,
protections and objective terms are in `supports`, and one of whose device kinds the
claim has; the task runs on the first such kind in the claim's order, on as many of
those devices as the claim lists, or on fewer when its payer's money holds fewer (§10).
The answer:

```json
{"org": "acme",
 "task": {"id": "tsk_0123456789abcdef", "job": "job_0123456789abcdef", "role": "lead",
          "lease": "trl_…", "coordinator": "", "device": "cuda", "devices": 2,
          "held": 600, "report": 60},
 "job": {"id": "job_0123456789abcdef", "status": "running", "…": "the job as read"}}
```

`org` is the job's org, which Hanzo's executor acts in for every later call on the task.
`lease` is answered once and stored as its SHA-256. `devices` is how many devices the
task runs on and `held` the device-seconds held for it (§10): it MUST NOT run past them.
`report` is the most seconds that may pass between its reports.

**Report.** `POST /v1/train/jobs/{id}/events`:

```json
{"task": "tsk_0123456789abcdef", "lease": "trl_…", "seconds": 120,
 "events": [{"type": "metric", "name": "nll", "step": 100, "value": 0.66}]}
```

`seconds` is the device-seconds the task has used since it was claimed, in all, summed
over its devices. A report's events are `status` (a lead's `running`, `evaluating`,
`failed` with `error`, or `stopped`; a join's `done`, `failed` or `stopped`),
`coordinator` (the lead's `addr`, `host:port`), `metric` (`name`, `step`, `value`), `log`
(`line`, cut to 4096 bytes), `artifact` (`sha256`) and `result`, at most 500 a report. A
report with no events is a heartbeat, due at least every `report` seconds. The answer:

```json
{"cancel": false, "held": 900, "status": "running", "seq": 42,
 "stop": {"reason": "budget", "by": 1800000660}}
```

`held` is the device-seconds held now. `stop` is present once the job is stopping:
`reason` is `budget`, `max_seconds`, `insufficient_balance`, `spend_cap`,
`balance_unavailable` or `no_payer`, and `by` the unix second its leases end. On a stop
the executor MUST stop training within one report interval, MUST NOT run past `held`,
and SHOULD store a checkpoint (§6) and report its `artifact` event and then
`{"type": "status", "status": "stopped"}` before `by`; at `by` the job ends `stopped`
whatever it reported. `cancel: true` says the job was cancelled: the executor MUST stop
its trainer and report nothing more. Once the job has succeeded, been rejected or
cancelled, or stopped before `by`, a report records nothing and answers its status. A
report on a failed job, under a lease that is not the task's current one, or after `by`
is `409 lease_lost`, and the executor stops.

A task with no report or registration for `TRAIN_LEASE_TTL` (default 10 minutes) loses
its lease. A lost lead fails its job with `executor_lost`, or ends it `stopped` when it
was stopping: a Kai run resumes only where its checkpoint is, so it is not moved.

### §6 Artifacts

An artifact is one object named by the SHA-256 of its bytes. A directory is packed as a
tar of its files in name order, with zero times, owners and modes `0644`, so the same
files are the same artifact. The executor asks `POST /v1/train/jobs/{id}/artifacts`
(`task`, `lease`, `kind`, `name`, `sha256`, `size`, `meta`) and is answered `stored: true`
when the org already holds those bytes, or a grant:

```json
{"sha256": "…", "stored": false,
 "upload": {"method": "PUT", "url": "https://…", "headers": {"x-amz-checksum-sha256": "…",
            "content-type": "application/x-tar", "content-length": "1048576",
            "x-amz-server-side-encryption": "aws:kms",
            "x-amz-server-side-encryption-aws-kms-key-id": "train-acme"},
            "expires": 1800007200}}
```

The `PUT` is accepted only with those headers, which the signature covers: that checksum,
that length, and encryption under the org's own key. Over 64 MiB the grant is `parts`
instead, each `{number, offset, size, url, headers}` a presigned `PUT` of one 64 MiB range
of a multipart upload opened under the org's key. A grant lives two hours: every part's
address is signed when the grant is, and the largest artifact, 64 GiB, takes about that
long at 80 Mbit/s. The artifact is `stored` once an `artifact` event names it and the
object reads back as those bytes, that size, encrypted under the org's key; an object
that reads back otherwise is deleted.

The org's key is minted into KMS the first time the org stores anything, 32 random bytes
under the key id `train-<org>`, and only S3 reads it; the cloud keeps no key material and
answers none.

The org's own rows are uploaded the same way: `POST /v1/train/artifacts`
(`kind: dataset`, `name`, `sha256`, `size`) answers the same grant for JSON Lines bytes
(`application/jsonl`), and a job names them as `dataset.uri` `artifact:<sha256>` (§3).
`GET /v1/train/artifacts` lists the org's objects, one per sha256, with what produced
each, whether it is published and when retention deletes it; `GET
/v1/train/artifacts/{sha256}` answers one with a download URL; `DELETE
/v1/train/artifacts/{sha256}` deletes one, refused `409 published` while a publish names
it and `409 in_use` while a job that has not ended reads it. A job reads an object when
one of the fields that name an artifact to read — `dataset.uri` as `artifact:<sha256>`,
`adaptation.basis`, `from`, an element of `protect.capabilities` or `adaptation.sources` —
is its sha256; no other mention counts. An object stored more than
`TRAIN_RETENTION_DAYS` (default 30; 0 keeps everything) ago that is not published and
that no job which has not ended reads is deleted by the hourly sweep. The org may hold at
most 128 GiB granted and not confirmed (`409 pending_limit` past it); bytes whose every
grant lapsed unconfirmed are deleted by the same sweep, their multipart uploads
aborted. Each deletion the sweep makes is on the platform's audit trail before it is
made, and a deployment with no trail deletes nothing on its own. A deleted object's
artifacts read `deleted`.

Bytes the org stored before objects were encrypted are not held as its own: a
registration of them is answered a sealed grant, and their read-back seals them.

- `checkpoint`: the trained model whole (Kai: `kai.json`, `model.safetensors`,
  `tokenizer/`).
- `capability`: what the job taught, apart from its base: `capability.json` (the base
  and its SHA-256, the adaptation, the protection, the evaluation, and `form`) and its
  tensors — `delta.safetensors`, the changed tensors as `W − W₀` (`form` `delta`, a full
  update); `lora.safetensors`, the adapter's factors per target (`lora`); or
  `coefficients.safetensors` and `residual.safetensors` over a basis the manifest names
  by SHA-256 (`basis`). Applied to that base it is the trained model.
- `lora`: the adapter alone, as the engine loads it.
- `basis`: a subspace, `basis://<base>/<name>`, versioned by the jobs that extend it:
  `basis.json` (layer names, rank, singular spectrum, explained variance by rank, the
  capabilities it was built from, their principal-angle matrix, functional
  reconstruction at r = 4, 8, 16 and 32, residual energy by capability, the protected
  directions, and its parent's SHA-256 and version) and `basis.safetensors`.
- `merged`: a base with a capability or adapter folded in.

**Publishing.** `POST /v1/train/jobs/{id}/publish` publishes a succeeded job's output (a
rejected one's with `force: true`, which the record keeps) under `name`, the output's
name when absent; a name the org already published moves to this job. A capability is
published with its route, the shape of a release's `routing.json` (HIP-1332):

```json
{"name": "triage",
 "route": {"keys": ["topic"],
           "options": {"topic": {"type": "choice", "labels": ["billing", "bug", "other"]}}}}
```

`keys` are the question keys it answers, 1 to 64, each 1 to 256 bytes with no control
characters and none twice. `options` narrows a key to one question: one under that key
routes here only when its type (`choice`, `score` or `noul`) and its option labels, in
order, are exactly these. Options for a key the route does not answer, a question with
no labels, and a label twice are `400`. Two capabilities of one org may not claim one
question — both on a key with no options, or both naming the same question under it —
so a publish that would is `409 route_conflict`. The record carries the base's SHA-256
from the job's result, and how the capability is served, its `form`: `head` for a
`readout`, which applies over the frozen base and shares its encoder, `full` for every
other adaptation. It is a different fact from `capability.json`'s `form`, which says how
the tensors are encoded.
A route is refused for an output that is not a capability.

`GET /v1/train/published` answers every org's published capabilities, what the decision
service installs, under the platform credential alone (§9):

```json
{"revision": "4f1c…", "changed": true,
 "data": [{"org": "acme", "name": "triage", "sha256": "…", "base_sha256": "…",
           "form": "full", "route": {"keys": ["topic"]}, "published": 1800000000,
           "url": "https://…", "expires": 1800000600}]}
```

`revision` names the list: it moves when a capability is published, replaced or moved to
another name, and at nothing else. A poll that sends `?revision=` with the one it holds
is answered `changed: false` and no data while it is current; one without it gets the
whole list with download URLs that live 10 minutes. An org whose store cannot be read,
or that the serving process holds and does not own, fails the answer (`503`) rather
than reading as having published nothing.

### §7 Clients

A client holds a model in the engine's memory, which every org's inference shares, so
until the engine isolates orgs only a SuperAdmin (HIP-0118) may create one; anyone else
is refused `403`. A create is validated like a job's (§3, §4), then forwarded to the
engine (`ENGINE_UPSTREAM`); the client's id is recorded under the org. Every other client
operation looks the id up in the org's store first, so another org's client answers
exactly as an unknown one does, and one the engine no longer holds leaves the org. An
org holds at most `TRAIN_CLIENTS` (default 2) live clients and the engine at most
`TRAIN_ENGINE_CLIENTS` (default 2) across every org, past which a create is `503
engine_full`; an engine serving no training plane answers `503 training_unavailable`.
`save_weights` writes the adapter on the engine, as the engine's wire says; exporting
it as an artifact is not specified.

### §8 Evaluation and research

A job with `protect` or `evaluation` is evaluated by its executor before it ends: the
base and the trained model on the target and protected suites of the dataset's
validation split, per suite accuracy, log loss and 15-bin expected calibration error.
The verdict is `accepted` when every protected suite stays within the budget, else
`rejected`; the target suites' change is reported and does not decide. The executor
files each suite as a research run (HIP-1145) under its credential's project, the base
as the `baseline`, and reports the project and run ids, which the job carries in
`result.research`.

HIP-1334 replaces `protect.budget` and `evaluation` with a stored gate the job names, moves
metrics, artifacts and the result into the job's run, and makes publishing require a passed
claim on that run.

### §9 Tenancy

The org is the gateway's verdict, never a body, query or path value (HIP-0026). A job,
task, client or artifact of another org answers `404` exactly as an unknown one does.
An org's executor acts as a principal of the org whose jobs it claims; it can claim no
other org's, and is offered only the tasks placed on its machine. Hanzo's executor holds
the platform credential (a SuperAdmin, HIP-0118): it claims with `platform: true` a task
of any org's job that names no machines, and makes every later call on that task acting
in the assignment's `org` (`X-Org-Id`). A platform claim by anyone else, and a report or
registration on a task Hanzo runs under any other credential, is `403`. Each platform
claim is put on the platform's audit trail — the org, job, task, machine, device class
and count, the rate, the seconds held and the payer — before it is answered; one the
trail cannot record, or a deployment with no trail, is answered `503` and the task is
given back. A task's reports need its lease besides the credential. Artifact grants are
scoped to one key under the org's prefix and are accepted for two hours, after which
bytes put under them and never confirmed are deleted (§6); download URLs live 10
minutes. A platform claim, a payer's holds (§10) and `GET /v1/train/published` read the
org stores held by the process that serves them.

### §10 Money

The plugin declares `Price: cloud.Metered`. Every charge goes through the org's meter
(HIP-1313) to a payer's wallet, and every rate is a row of the meter authority under
product `train`, with a compiled floor when there is none:

| meter | charged for | floor |
|---|---|---|
| `<base>-gpu-hour` (`kai-gpu-hour`) | a device-hour of a job Hanzo runs on an accelerator | $3.48, one H100 for an hour |
| `<base>-cpu-hour` (`kai-cpu-hour`) | a device-hour of a job Hanzo runs on `cpu` | $0.08 |
| `storage-gb-month` | a GB-month of stored objects | $0.02 |
| `client-second` | an engine-second of a client operation | $0.18 an hour |

**Who pays.** A job that names no machines is run by Hanzo's executor and its compute is
charged to the wallet that created it. A job on the org's linked machines runs on the
org's own hardware: its seconds are counted and its `max_seconds` holds, and it is
charged nothing.

**Hold a window, charge what ran.** A task may use only the device-seconds held for it.
A claim holds the first window, 300 seconds of wall time on each of the task's devices;
the executor reports at least every 60 seconds the device-seconds it has used in all
(§5), and each report is charged exactly what it adds, at the rate read when the task
was claimed, no more than the task's devices' wall time since it was claimed (plus 5
seconds) and no more than is held. When less than
180 seconds a device is left, the report asks for the next window: 300 seconds a device,
clipped to what `max_seconds` and `budget` leave, then weighed against the payer's
balance and spend caps — a project's cap as hard as at create, when the job's project was
claim-bound — together with everything the payer has committed that the ledger does not
know yet: its live holds beyond what they used, and its charges not yet sent, in every
org the serving process holds. One payer's weighings and holds are taken one at a time,
so two claims or reports cannot weigh the same balance. Granted, `held` grows. Refused,
the job is told to stop with the refusal's reason — `max_seconds`, `budget`,
`insufficient_balance`, `spend_cap`, `no_payer` — its leases end 300 seconds later, and
nothing past what is held is charged. A balance or a hold that cannot be read is not a
refusal: the hold runs down to 120 seconds a device before the job is stopped
`balance_unavailable`. So a job never runs, and is never charged, past what its payer
could pay when its last window was held.

A report's seconds and the charge they owe are recorded together, and the charge is sent
to the ledger once the record is durable; a report that cannot be made durable is
answered `503` and its charge is sent by the next report, the answer to its retry, or the
hourly sweep. The ledger knows each charge by its name, so one sent twice is charged once.

A platform claim whose payer cannot hold a window on every device the claim offers is
given fewer, halving down to one. A job whose first window its bounds or its payer refuse
outright is ended `stopped` before it runs; one whose payer's money is held by the
payer's other work, or whose balance cannot be read, waits for a later claim.

**Ends.** A task that goes silent is charged through its last report, and what it held
beyond that is released when its lease lapses. A job that succeeds, is rejected, fails,
is cancelled or is stopped releases what its tasks held; the seconds a cancelled task ran
after its last report are not charged.

**Create.** A job Hanzo runs is refused at create when its payer cannot hold one
device's first window on its own — 300 seconds clipped to `max_seconds`, costing at most
`budget` — at the job's device class (`cpu` when that is all it allows, else `gpu`):
`402 insufficient_balance`, `402 spend_cap_exceeded`, `503 balance_unavailable` (§3). A
job admitted while the payer's other work holds its money waits for a claim.

**Storage.** Stored objects are charged by the GB-month for as long as they are kept,
accrued hourly: each payer of an org carries the second through which its storage was
charged, and each hourly sweep charges the span since at the bytes it keeps now: every
stored object, whatever produced it and however that job ended, from the first sweep
after it is stored. A deleted object stops being charged at the next sweep. Bytes
granted and not confirmed are not charged; they are bounded and deleted once their
grants lapse (§6). Each debit is named by its span, so a span is charged once, and the span's
watermark is made durable before the debit is sent.

Client compute is charged per engine-second of each forwarded operation that succeeds.

### §11 Events and observability

It publishes nothing on the bus. A job's events and metrics are its own record, read
back through `/v1/train/jobs/{id}/events` and `/metrics`. Beyond the request span every
route gets, it emits structured log lines at each job transition.

### §12 Stage

`alpha`: its prefix answers `404` to an org without the flag `train`. It is promoted
after an adversarial review of its tenancy and its executor and client paths. Until then
this HIP declares no `capability:` (HIP-0139 §5).

### §13 Upstream

It forks no project. The client wire is the engine's, a wire we implement. Low-rank adaptation, shared subspace
bases and gradient projection are published methods; no code of theirs is used.

### §14 Migration

`/v1/train` replaces `/v1/training/*` (the engine serves its wire at
`/v1/train/clients`) and `/v1/ai/finetune/*` (hanzoai/ai). Neither answers, and neither
is an alias.

In hanzoai/ai, delete `routers/finetune_router.go`, `controllers/finetune.go`,
`controllers/zap_finetune_test.go`, `object/finetune_job.go`,
`object/finetune_runtime.go`, `object/finetune_billing.go`,
`object/finetune_billing_test.go`, `object/finetune_hf.go`, `object/finetune_serve.go`
and `cluster/finetune.go`, and edit:

| file | edit |
|---|---|
| `routers/router.go` | drop `registerFinetune(app)` |
| `routers/wired_gen.go` | regenerate: the nine finetune operations go |
| `controllers/answers.go` | drop the six `*Finetune*` entries |
| `object/adapter.go` | drop `&FinetuneJob{}` from the synced tables |
| `cluster/serve.go` | drop `DeployFinetune`, `UndeployFinetune`, `finetuneServiceName` and the `hanzo.ai/finetune-job` label |
| `cluster/accelerator_test.go` | drop the `FinetuneJob` fixture |
| `controllers/zap_ownership_test.go` | drop the `refreshFinetuneJob` entry |
| `LLM.md` | drop `/v1/finetune/*` from the alias list |

Then in `hanzoai/cloud`, with the new hanzoai/ai pinned:
`make -f mk/fleet.mk describe/ai && make closure && make -f mk/fleet.mk openapi`, which
drops `/v1/ai/finetune/*` from `private.yaml` and `openapi.yaml` and so from the generated
clients and the CLI.

## Rationale

One endpoint puts every training call behind the gateway's bearer and org (§9). The
client wire is the engine's, so a loop written against that wire runs against it as
written.

Jobs run on the org's linked machines because that is where Kai trains and where a
model's data already is. A scheduler that placed Kai on cluster pods would copy a data
build per run and discard the resume a local checkpoint gives. An org with no machine of
its own has its job run by Hanzo's executor, which claims through the same wire as the
org's own and differs only in its credential and in being charged.

A job is billed by the second inside a window held ahead of it, rather than on an
estimate held at create, because no estimate bounds a run that stops early or runs long:
holding five minutes at a time keeps at most one window of a payer's money committed to
a task, a payer whose money runs out mid-run is stopped within one report, and a run is
charged what it reported, never what was guessed.

Storage is charged for as long as an object is kept, at the bytes kept each hour,
because a charge taken once at store time bills an object kept for a year the same as
one deleted the next day. Unpublished objects are deleted after a retention period
because nothing else would ever remove what an org stopped using.

The capability artifact is a delta over a named base rather than a new model because a
delta can be evaluated against its base, merged into it, or refused, and a new model can
only replace one.

## Security Considerations

A wrong org scope hands one tenant another's weights or data: every read is keyed by the
gateway's org, and absence and foreignness answer the same `404`. A forged report could
mark a regressing run `accepted`: reports need the task's lease, fenced per claim, and
the verdict records the executor and machine that produced it, but an org's own
executor is trusted with its org's verdicts. A client holds a model in the engine's
memory, which also serves inference, so clients are a SuperAdmin's until per-org engine
isolation exists; the stage flag cannot bound them, since an org sets its own flags.
Upload grants are write-only, single-key, and bound to the declared size and checksum,
so a grant cannot overwrite another object, store more bytes than it declared, or store
bytes under a hash they do not have; an object that reads back wrong is deleted. Bytes
put under a grant and never confirmed are uncharged, so an org may hold at most 128 GiB
of them, and they are deleted once the grant lapses. Every object is encrypted under its
org's own key, which only the object store reads from KMS; a read-back refuses one that
is not, and bytes stored before encryption are uploaded again sealed before they count,
so a store copied without KMS discloses no org's bytes.

The platform credential reads and charges every org, so it is a SuperAdmin's alone,
every platform claim is on the audit trail before it is answered — a deployment with
no trail answers none — and a task Hanzo runs accepts reports under that credential only, so no org's principal can report seconds
against another payer. Hanzo's executor is trusted with the seconds it reports; the
charge is still bounded by the task's devices' wall time and by what is held. Deletion
by retention destroys an org's data on the platform's schedule, so each one is audited
before it is made, and nothing published or in use is ever taken.

## References

- HIP-0026 — Identity & Access Management Standard
- HIP-0043 — Hanzo Engine — LLM Inference Engine Standard
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0118 — SuperAdmin & Tenant Isolation Model
- HIP-0139 — Capability
- HIP-1145 — Research — The Experiment Record
- HIP-1313 — Usage — The Metered Record
- HIP-1332 — Kai — The Decision Model and the Decision Plane
- HIP-1334 — Research — The Unified Research Runtime

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
