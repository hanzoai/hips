---
hip: 1334
title: Research — The Unified Research Runtime
author: Hanzo AI
type: Standards Track
category: Infrastructure
status: Draft
implementation-go: partial
implementation-rust: partial
created: 2026-09-29
requires: HIP-0026, HIP-0106, HIP-0118, HIP-0129, HIP-0139, HIP-1105, HIP-1145, HIP-1332, HIP-1333
---

# HIP-1334: Research — The Unified Research Runtime

## Abstract

Hanzo records research — training, evaluation, benchmarks, teacher queries — as five
canonical objects: **Dataset**, **Artifact**, **Run**, **Evaluation** and **Claim**. Two more
bind them: a **Gate**, the frozen criteria a claim is judged by, and a **Comparison**, a
baseline and a candidate with what they share. Every other route is a view over these.

The objects live under `/v1/research` in `hanzoai/cloud` (`apps/research`). The runtime that
produces them is Rust: `hanzo-research` and `hanzo-train` in `hanzoai/ml`, and the `train` and
`bench` binaries in `hanzoai/decision`.

Four rules hold everywhere, and each has a check that enforces it (§1):

1. No result exists without lineage.
2. No claim exists without an evaluation.
3. No promotion exists without a prospectively frozen gate.
4. No training row exists without provenance and purpose.

This HIP is the contract the implementation builds against and the migration plan from today's
`/v1/research`, `/v1/eval`, `/v1/benchmark` and `/v1/train` to this model. §2–§13 and §15 each
open by saying what is live and what is specified and not built; §14 maps every live route.

## Motivation

Today four surfaces hold numbers, and none binds a number to what produced it.

- A number lives in up to three places. `/v1/research/runs` carries measures on the run record,
  `/v1/research/experiments` carries one value per row, `/v1/eval/scores` carries judge verdicts
  as telemetry events, `/v1/benchmark` keeps attempts in deployment-wide JSONL, and a
  `/v1/train` job's `result` carries its suites' grades, which `train serve` also files as
  research runs.
- A gate is command-line flags (`bench gate --accuracy 0.02 --ece 0.03`) or a job's
  `protect.budget`, read when the run ends. HIP-1333 §8 decides on protected suites only and
  reports the target suites without deciding on them, so job `job_30bfc6e5af09a9f7` lowered
  support-triage accuracy from 0.6641 to 0.6486 and ended `succeeded` with verdict `accepted`.
- An artifact's address is the SHA-256 of the bytes as submitted. `bench post` files
  `preds.json.gz`, so one set of predictions compressed twice is two addresses.
- Nothing records what a row may be used for. `hanzoai/decision`'s stage builder refuses
  evaluation data (`stage::license::Role::Eval`, `stage::barrier`), but `/v1/eval` datasets and
  research records carry no purpose, and nothing refuses training on them.
- Teacher outputs (enso-flash views, zen6 contrasts, the a7 and laya-agent teacher targets)
  enter training as files, with no record of the request, the model that answered, or what was
  derived from the answer.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as in
RFC 2119.

### §1 Status and the four rules

| § | object or part | live today | specified, not built |
|---|---|---|---|
| §2 | encoding | `hanzoai/decision` `program::canon` | the same encoding in `apps/research` |
| §3 | data purpose | decision stage builds: license role `eval`, the barrier | purpose on every item and artifact; the refusals |
| §4 | Dataset | `/v1/eval/datasets` (mutable, no purpose); research benchmark definitions | `/v1/research/datasets` |
| §5 | Artifact | research artifacts (≤ 16 MiB, submitted bytes hashed); train artifacts in S3 | one store; canonical uncompressed address; purpose and lineage fields |
| §6 | Environment, determinism | bit-identical dgx training steps from hanzo-ml a6daf44; resume tested on CPU | the environment artifact, the probe, the report |
| §7 | Run | `POST /v1/research/runs` batches; `/v1/train` job events | the event log and its materialized view |
| §8 | Evaluation | measures on research runs; eval scores; train job results | the Evaluation object, items, server scoring |
| §9 | Gate | `bench gate` flags; `protect.budget` | stored, hashed, server-evaluated gates |
| §10 | Comparison | `GET /v1/research/compare` | declared comparisons with a verified `matched` record |
| §11 | Claim | nothing | claims and their statuses |
| §12 | teacher lineage | teacher outputs as files | interactions, derived artifacts, the two Jev datasets |
| §13 | runtime | `train fit`, `join`, `serve`; `bench gate`, `cap`, `post`; the barrier | the spool, `train harvest`, `train determinism`, `bench eval`, `train sync` |

The four rules and the check that enforces each:

1. **No result exists without lineage.** The server accepts an Evaluation only inside a Run
   (§7), and a Run only with an environment artifact and a config artifact. Every measure names
   its evaluation, every evaluation its run, dataset and subject.
2. **No claim exists without an evaluation.** `POST /v1/research/claims` refuses a claim with no
   evaluation ids, or with one that is not complete or has no items (§11).
3. **No promotion exists without a prospectively frozen gate.** A claim passes only when its
   gate was stored before the subject run's `RUN_CREATED` was received and that event named it
   (§9.3). Publishing a `/v1/train` job's output and every leaderboard or paper-facing entry
   require a passed claim.
4. **No training row exists without provenance and purpose.** A dataset item carries
   `source_hash` and `purpose`; the trainer refuses any row whose purpose does not admit
   training, and the server refuses the attach (§3.5).

### §2 Encoding

**Live:** `hanzoai/decision` `program::canon` implements §2.1. **Not built:** the same
encoding in `apps/research`, which canonicalizes an experiment's `meta` with its own rule.

#### §2.1 Canonical JSON

No whitespace. Object keys sorted by code point. Strings escaped as `serde_json` escapes them.
Integers written as themselves; every other number as the shortest decimal that round-trips to
the same f64, without exponent, with `-0` written `0`. Non-finite numbers are refused (422).
Every implementation MUST reproduce this vector:

```text
input  {"b": 1, "a": [1.5, -0.0, 1e21, 2.0, 1e-7, true, null, "é\"x"], "A": {"z": 0, "y": -3}}
canon  {"A":{"y":-3,"z":0},"a":[1.5,0,1000000000000000000000,2,0.0000001,true,null,"é\"x"],"b":1}
hash   sha256:de589dce225ed22919e1b8f9772640da12415ddb786abdd200ab3bb6894e0e0c
```

#### §2.2 Hashes

- A field named `sha256` or ending `_sha256` holds 64 lowercase hex: an artifact's address
  (§5.1).
- A field ending `_hash` holds `sha256:` followed by 64 lowercase hex: the SHA-256 of a value's
  canonical JSON.
- A content-addressed record's own id is the `_hash` of the record without that field:
  `event_id` (§7.1), `interaction_id` (§12.1). A gate's id is its `_hash` (§9.1).

#### §2.3 Ids

| id | form | minted by |
|---|---|---|
| dataset | `^[a-z0-9][a-z0-9._-]{0,63}$` | the caller |
| item | `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`, unique within its dataset | the caller |
| artifact | its `sha256` | the bytes |
| run | `^[A-Za-z0-9][A-Za-z0-9._:+@-]{0,191}$`, unique within the org | the caller |
| evaluation | `evl_` and 16 hex | the runtime, at `EVAL_STARTED` |
| gate | `gate_spec_hash` | the spec |
| comparison | the `_hash` of the comparison | the spec |
| claim | `clm_` and the first 16 hex of the claim's `_hash` over `statement`, `subject_run`, `baseline_run`, sorted `evaluation_ids` and `gate_spec_hash` | the server |
| event, interaction | `_hash` of the record | the record |

A write that repeats a content-addressed record is a no-op that answers the stored record. A
caller-named id written again with different content is `409 exists`.

The examples in §4–§12 use job `job_30bfc6e5af09a9f7`'s recorded ids, base and trained weights,
step count and grades; their other hashes, counts and instants show the shape.

#### §2.4 Time and errors

Instants are RFC 3339 in UTC with `Z`; event instants carry milliseconds. The server stamps
every write with its own receipt instant, `received`, which is the only clock §9.3 reads.

A refusal is an RFC 9457 problem document carrying `code`, the way `/v1/train` refuses. An id
another org holds answers exactly as an unknown one: `404`.

### §3 Data purpose

**Live:** decision's stage build classes every record's license, gives evaluation data the role
`eval`, refuses `--allow EVAL`, leaves `role: eval` records out of `fit::admit`, and barriers
every build against the protected evaluation sets (`stage::barrier`). **Not built:** purpose as
a field on items and artifacts, the admission matrix, and the server's refusals.

#### §3.1 The type

```rust
/// What an item or artifact may be used for. Set when written; never changed.
#[serde(rename_all = "snake_case")]
pub enum DataPurpose {
    Train,         // gradient steps, selection, derivation, teacher queries
    Dev,           // selection, early stopping, calibration; never a gradient step
    EvalOnly,      // evaluation and observation; nothing is derived from it
    SealedEval,    // scored by the server only; its gold never leaves the store
    TeacherMining, // sent to a teacher; trains only through what is derived from the answers
}
```

On the wire: `train`, `dev`, `eval_only`, `sealed_eval`, `teacher_mining`. Every dataset item
and every artifact carries one; a write without it is `400`; a write that changes it is `409`.

#### §3.2 Roles

A run reads a dataset in one role, declared by `DATASET_ATTACHED` (§7.2):

```rust
#[serde(rename_all = "snake_case")]
pub enum Role {
    Train,    // gradient steps
    Select,   // selection, early stopping, calibration
    Evaluate, // an evaluation scores it
    Query,    // a teacher or another system is asked about it
}
```

| purpose | `train` | `select` | `evaluate` | `query` | derivation |
|---|---|---|---|---|---|
| `train` | yes | yes | yes | yes | yes |
| `dev` | no | yes | yes | yes | yes |
| `eval_only` | no | no | yes | yes | no |
| `sealed_eval` | no | no | yes, by the server (§8.4) | no | no |
| `teacher_mining` | no | no | no | yes | yes |

`derivation_allowed` on an item equals the last column; a write that disagrees is `422
purpose_refused`.

#### §3.3 Derivation

A derived item or artifact — a teacher response, an embedding, a paraphrase, a pair, a view, a
set of predictions — takes its purpose from its parents:

- if any parent is `eval_only` or `sealed_eval`, derivation is refused (`422 derivation_refused`);
- else if any parent is `dev`, it is `dev`;
- else it is `train` (so `teacher_mining` parents yield `train`, and an artifact with no data
  parent is `train`).

Predictions and items over an evaluation set are not derivations of it: they carry the
evaluated dataset's purpose, and the same refusal applies to anything derived from them.

#### §3.4 Provenance fields

- `source_hash`: the `_hash` of the canonical source record the item was read from.
- `canonical_example_id`: `<source>:<id>`, the underlying example. Every view, paraphrase and
  derivation of one example carries the same value, so the firewall catches an example that
  reaches training and evaluation under two item ids.
- `contamination_hash`: `sha256:` of the string leaves of `payload.input`, in canonical key
  order, each in normal form, joined by U+001F. Normal form is decision's `stage::near::normal`:
  lowercase, every run of non-alphanumeric characters one space, trimmed.

```text
input               {"message": "Hello,  World!", "b": ["Été", 3]}
leaves, normalized  "été", "hello world"
contamination_hash  sha256:cd0430f72dd327122592ba27f0a2fb14a65cc5c19515197d750de1c034134ecf
```

#### §3.5 The firewall

- The trainer (`hanzo-train`, every `train` subcommand that takes a gradient step) reads rows
  only from sealed datasets attached with role `train`, and refuses a row whose `purpose` is not
  `train`, whose dataset's purpose is not `train`, or whose lineage (§5, `parents`) reaches an
  `eval_only` or `sealed_eval` object. It refuses before the first step, not by filtering.
- The server refuses a `DATASET_ATTACHED` whose purpose does not admit its role, and an artifact
  whose purpose disagrees with §3.3 over its parents (`422 purpose_refused`).
- A `train` or `teacher_mining` item whose `contamination_hash` or `canonical_example_id` equals
  an `eval_only` or `sealed_eval` item's in the same org is refused at append (`422
  contaminated`). Near duplicates are caught locally, by decision's barrier (5-gram Jaccard at
  least 0.5 under MinHash 256 with 64 bands of 4, or 80% of sampled 50-character spans); a
  runtime build records the barrier it ran as `contamination_barrier_hash`, the `_hash` of the
  sorted protected-item hashes and those parameters.

### §4 Dataset

**Live:** `/v1/eval/datasets` holds named sets of items that are edited in place and carry no
purpose; `/v1/research/benchmarks` holds task definitions; decision's stage builds are
content-addressed by their manifest hash. **Not built:** everything in this section.

#### §4.1 Types

```rust
pub struct Dataset {
    pub id: String,
    pub purpose: DataPurpose,
    pub title: String,
    pub license: String,                // SPDX identifier, or "unstated"
    pub origin: String,                 // hf://<repo>@<rev>, a URL, <repo>@<commit>
    pub parents: Vec<String>,           // datasets its items were derived from
    pub benchmark: Option<Benchmark>,   // the task this is an evaluation set of
    pub state: DatasetState,            // open | sealed
    pub items: u64,
    pub sha256: Option<String>,         // set when sealed: its items artifact (§4.2)
    pub created: String,
    pub sealed: Option<String>,
}

pub struct Benchmark {
    pub id: String,           // typed_decisions, gpqa_diamond
    pub title: String,
    pub version: String,      // its own revision; empty when it publishes none
    pub split: String,
    pub metric: String,       // the metric its authors score it by
    pub metrics: Vec<String>, // every metric its protocol reports
    pub citation: String,
}

pub struct DatasetItem {
    pub dataset_id: String,
    pub item_id: String,
    pub purpose: DataPurpose,           // equals its dataset's
    pub canonical_example_id: String,
    pub source_hash: String,
    pub contamination_hash: String,
    pub derivation_allowed: bool,       // equals purpose's derivation column (§3.2)
    pub payload: Payload,
}

pub struct Payload {
    pub input: Value,                   // what a model reads
    pub gold: Option<Value>,            // absent on any read of a sealed_eval item
}
```

```json
{
  "dataset_id": "jev-teacher-train-v1",
  "item_id": "support_triage:4812",
  "purpose": "teacher_mining",
  "canonical_example_id": "support_triage:train:4812",
  "source_hash": "sha256:09bfe0857d425f3ec0211ceab1105394fcc53bc131ee82de6d456486195ed8f5",
  "contamination_hash": "sha256:fda7140abe86d58bd2432f6234c501e3d0d96bf3a00f672a45862fc281dd326b",
  "derivation_allowed": true,
  "payload": {
    "input": {"ticket": "I was charged twice for my March invoice."},
    "gold": {"team": "billing"}
  }
}
```

#### §4.2 Lifecycle

A dataset is created `open`. Items are appended to an open dataset; none is changed or removed,
and an item appended again with identical content is a no-op. Sealing fixes `sha256`: the
dataset's items artifact (kind `dataset`, §5) is its items in canonical JSON, one per line,
sorted by `item_id`, each line ending `\n`. A sealed dataset takes no more items (`409 sealed`).
A run attaches only a sealed dataset, naming its `sha256` (`422 not_sealed` otherwise).

Retiring an item is a new dataset without it, whose `parents` names the old one. A dataset is
deleted only while no run has attached it (`409 referenced`).

A `sealed_eval` item's `payload.gold` is never answered by any read. Its `payload.input` is
answered only to a request naming a run that attached the dataset with role `evaluate`, and each
such read is counted on the dataset.

#### §4.3 Routes

| method and path | does |
|---|---|
| `POST /v1/research/datasets` | create an open dataset |
| `GET /v1/research/datasets` | the org's datasets (`?purpose=` `?benchmark=`) |
| `GET /v1/research/datasets/{id}` | one dataset |
| `DELETE /v1/research/datasets/{id}` | delete one no run attached |
| `POST /v1/research/datasets/{id}/items` | append at most 20,000 items |
| `GET /v1/research/datasets/{id}/items` | items in `item_id` order (`?after=` `?limit=`, at most 1,000) |
| `POST /v1/research/datasets/{id}/seal` | seal it; answers `sha256` |

### §5 Artifact

**Live:** `POST /v1/research/artifacts` stores up to 16 MiB of bytes in the org's research
SQLite, kinds `snapshot` and `report`, addressed by the server's SHA-256 of the submitted bytes;
`/v1/train` stores job outputs in S3 at `<org>/<sha256>` through presigned `PUT`s, 64 MiB parts
past 64 MiB, and counts one stored once it reads the object back. **Not built:** one store for
both, the canonical uncompressed address, purpose and lineage fields.

#### §5.1 The address

An artifact is addressed by the SHA-256 of its **canonical uncompressed representation**, never
of compressed bytes:

| `media_type` | canonical representation |
|---|---|
| `application/json` | canonical JSON (§2.1) |
| `application/x-ndjson` | each line canonical JSON, ending `\n`, in the order its kind states |
| `application/x-tar` | HIP-1333 §6's tar: files in name order, zero times and owners, mode `0644`, uncompressed |
| anything else | the bytes as written |

A producer MUST write a safetensors file with its header keys sorted and its tensors in that
order, so equal tensors are equal bytes. Bytes MAY be stored and transferred gzip- or
zstd-compressed; `compression` and `compressed_size` say so, and the address does not change.
For a JSON or JSON Lines artifact the server decompresses, re-canonicalizes and hashes on write,
and refuses a mismatch (`422 address_mismatch`); for any other it hashes the decompressed bytes.

#### §5.2 The type

```rust
pub struct Artifact {
    pub sha256: String,
    pub kind: ArtifactKind,
    pub media_type: String,
    pub schema_version: u32,             // the version of the kind's schema, from 1
    pub purpose: DataPurpose,
    pub size: u64,                       // uncompressed bytes
    pub compressed_size: Option<u64>,
    pub compression: Option<Compression>, // gzip | zstd
    pub producer: Producer,
    pub parents: Vec<String>,            // artifacts it was made from
    pub state: ArtifactState,            // registered | stored
    pub created: String,
}

pub struct Producer {
    pub run: Option<String>,
    pub event_id: Option<String>,        // the event that names it
    pub tool: String,                    // "train fit", "bench eval"
    pub version: String,                 // the tool's commit
}
```

| kind | media type | what |
|---|---|---|
| `checkpoint`, `capability`, `lora`, `basis`, `merged` | `application/x-tar` | HIP-1333 §6 |
| `config` | `application/json` | a run's config: a stage file, a job spec, a harness's settings |
| `plan` | `application/json` | a training run's batch plan |
| `dataset` | `application/x-ndjson` | a sealed dataset's items (§4.2) |
| `predictions`, `items` | `application/x-ndjson` | an evaluation's per-item output and scores (§8.2) |
| `environment` | `application/json` | §6.1 |
| `request`, `response` | `application/json` | a teacher interaction's bodies (§12.2) |
| `target`, `pairs`, `distribution`, `invariance` | `application/x-ndjson` | derived supervision R1–R4 (§12.3) |
| `report`, `snapshot` | `text/markdown`, `image/png` | writing and board images, as today |

```json
{
  "sha256": "86a96f20c92f165b388152896a5e71a8712919a6f481f19c927a7c39fef58c3f",
  "kind": "capability",
  "media_type": "application/x-tar",
  "schema_version": 1,
  "purpose": "train",
  "size": 502030336,
  "compressed_size": null,
  "compression": null,
  "producer": {
    "run": "job_30bfc6e5af09a9f7",
    "event_id": "sha256:bf1f52c93c849ca3be6301c4edaa3de0ab3f7396e33ab234724c65fab7118ed0",
    "tool": "train fit",
    "version": "edd4821"
  },
  "parents": ["0834a74f2d140642a453373da09e5a128e3d2c8d9e8bb1dcaf86d7210a4ecdfc"],
  "state": "stored",
  "created": "2026-09-29T07:50:36Z"
}
```

#### §5.3 Store and routes

Bytes live in Hanzo S3 at `<org>/<sha256>` (bucket `RESEARCH_BUCKET`), metadata in the org's
research store. `/v1/train`'s artifacts move into this store; their keys do not change.

| method and path | does |
|---|---|
| `POST /v1/research/artifacts` | register one: the metadata, and `content` (base64, at most 16 MiB) or nothing; answers `stored: true`, or an upload grant — a presigned `PUT` to `<org>/<sha256>`, or one per 64 MiB part — valid 30 minutes |
| `GET /v1/research/artifacts` | the org's artifacts (`?kind=` `?run=` `?purpose=` `?since=`) |
| `GET /v1/research/artifacts/{sha256}` | the bytes, decompressed, under the artifact's `media_type` |

An artifact is `stored` once the server reads the object back and it hashes to its address; a
mismatch deletes the object. A registration naming a parent the org does not hold is `422
unknown_parent`. The bytes of a `sealed_eval` artifact — a sealed dataset, its evaluations'
items — are never served: `GET /v1/research/artifacts/{sha256}` answers `403 sealed`.

### §6 Environment and determinism

**Live:** a dgx training step is the same bits every run from hanzo-ml a6daf44
(`train/tests/cuda.rs`), and `--resume` continues bit-identically on the CPU; research runs
record a commit. **Not built:** everything in this section.

#### §6.1 Environment

An environment is an artifact of kind `environment`; `environment_artifact_sha256` names it.

```rust
pub struct Environment {
    pub git_sha: String,                 // the producing tree's commit, 40 hex
    pub dirty: bool,                     // the tree differed from the commit
    pub lockfile_hash: String,           // the lockfile's bytes
    pub ml: String,                      // the hanzo-ml commit
    pub kernels: String,                 // the kernels' commit
    pub accelerator: Accelerator,        // { api: cuda | rocm | metal | cpu, version, driver }
    pub kernel_plan_hash: String,        // the backend's kernel plan
    pub precision: Precision,            // { compute, master, accumulate } dtypes
    pub gpus: Vec<Gpu>,                  // { uuid, arch }
    pub compiler_flags: Vec<String>,
    pub determinism_flags: Vec<String>,
    pub image: Option<String>,           // the container image digest, when one ran
}
```

The kernel plan is the canonical JSON list the backend reports of every kernel it selected:
`{op, dtype, shape, kernel, reduction}` per selection, sorted. `accelerator.version` is the CUDA
or ROCm toolkit's version.

#### §6.2 The probe

`train determinism` runs one config as two replicas, A and B, for 100 steps from the same
initial weights, optimizer state, RNG state and batch ids. It hashes each of those four before
the first step, and each replica's weights after steps 1, 2, 4, 8, 16, 32, 64 and 100.

A weights hash is `sha256:` over, for each parameter in name order: its name in UTF-8, `0x00`,
its dtype name, `0x00`, each dimension as a little-endian u64, then its values' little-endian
bytes in the master dtype.

```rust
pub struct DeterminismReport {
    pub environment_artifact_sha256: String,
    pub config_sha256: String,
    pub probe: Probe,                    // the four initial hashes, and { step, a, b } per probed step
    pub exact: bool,                     // every probed step hashed equal
    pub first_divergent_step: Option<u64>,
    pub max_abs_weight_delta: f64,       // at step 100, max |a − b| over every element
    pub max_rel_weight_delta: f64,       // max |a − b| / max(|a|, |b|) over elements not both 0
    pub prediction_agreement: f64,       // share of the config's select rows with equal argmax at step 100
    pub known_nondeterministic_ops: Vec<String>, // what the backend declares nondeterministic here
}
```

#### §6.3 Reference eligibility

A report passes when `exact` is true. A run is **reference-eligible** when its environment is not
`dirty` and has a passing report. Only a reference-eligible run may be a Comparison's baseline
(§10); the run view says so in `reference`.

| method and path | does |
|---|---|
| `POST /v1/research/determinism` | record a report; its environment must be a stored artifact |
| `GET /v1/research/determinism` | reports (`?environment=`) |

### §7 Run

**Live:** `POST /v1/research/runs` records batches of finished executions with derived
`completion`; a `/v1/train` job keeps its executor's reports as job events. **Not built:** the
event log, its rules and its materialized view.

A run is its events. The server keeps each run's events in order, accepts each once, and folds
them into the run view. Nothing else writes a run.

#### §7.1 The envelope

```rust
pub struct Event {
    pub event_id: String, // the event's _hash without this field
    pub run: String,
    pub seq: u64,         // 1, 2, 3, … within the run, gapless
    pub at: String,       // the producer's clock
    #[serde(flatten)]
    pub body: Body,       // tagged by "type"
}
```

#### §7.2 The nine events

```rust
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Body {
    RunCreated(RunCreated),
    DatasetAttached(DatasetAttached),
    TrainStarted(TrainStarted),
    StepRecorded(StepRecorded),
    CheckpointCreated(CheckpointCreated),
    EvalStarted(EvalStarted),
    EvalCompleted(EvalCompleted),
    GateEvaluated(GateEvaluated),
    RunCompleted(RunCompleted),
}
```

| type | fields | rule |
|---|---|---|
| `RUN_CREATED` | `kind` (`train`, `eval`, `harvest`, `probe`), `environment_artifact_sha256`, `config_sha256`, `parents`, `seed`, `gate_spec_hash`, `job`, `tags`, `by` | seq 1, and only there; its artifacts registered; its gate stored |
| `DATASET_ATTACHED` | `dataset`, `dataset_sha256`, `purpose`, `role` | the dataset sealed at that hash; purpose equal to the dataset's and admitting the role (§3.2) |
| `TRAIN_STARTED` | `plan_sha256`, `batches`, `tokens` | at most once; after a `train` attach |
| `STEP_RECORDED` | `step`, `tokens`, `loss`, `grad_norm`, `lr`, `batch_ids_hash` | after `TRAIN_STARTED`; a step at or below the last recorded equals that record exactly (§7.3) |
| `CHECKPOINT_CREATED` | `step`, `tokens`, `artifact_sha256` | the artifact registered; its purpose `train` |
| `EVAL_STARTED` | `evaluation`, `subject`, `dataset`, `dataset_sha256`, `evaluator` | the dataset attached with role `evaluate` |
| `EVAL_COMPLETED` | `evaluation`, `questions`, `answered`, `measures`, `predictions_sha256`, `items_sha256` | after its `EVAL_STARTED`; measures finite |
| `GATE_EVALUATED` | `gate_spec_hash`, `verdict`, `rules` | the server's own evaluation agrees (§9.4) |
| `RUN_COMPLETED` | `status` (`completed`, `failed`, `cancelled`), `steps`, `tokens`, `batches`, `error` | last; nothing after it |

```text
{"event_id":"sha256:c9c222eabb429839ceb9434b6cfc54a7001c68b89cea5fa92eceffde7a750a3c","run":"job_30bfc6e5af09a9f7","seq":1,"at":"2026-09-29T07:42:00.000Z","type":"RUN_CREATED","kind":"train","environment_artifact_sha256":"365c787b95809ee792f0e918fd6fe94c601c4278473879fa789b9a01ac73b76a","config_sha256":"3d81768a6bdff4e5186113ecb40805a009ca793aef523771c3de6a34ec7063dd","parents":["0834a74f2d140642a453373da09e5a128e3d2c8d9e8bb1dcaf86d7210a4ecdfc"],"seed":1,"gate_spec_hash":"sha256:010f18f5d6986a6d1fcc8c467df88df82ae4318f4617db14cd864e66727e6095","job":"job_30bfc6e5af09a9f7","tags":[],"by":"evo"}
{"event_id":"sha256:d35e0f0fdcd45e1209794a9a3f0e94282cd7958170e24923f8fef36eee95cde6","run":"job_30bfc6e5af09a9f7","seq":2,"at":"2026-09-29T07:42:00.010Z","type":"DATASET_ATTACHED","dataset":"triage.train","dataset_sha256":"5ce335dc5fa6ad50712fba0ea667c65f055c8eb66a4129dbdc75669b6600bb11","purpose":"train","role":"train"}
{"event_id":"sha256:950cdfa41cc2866bbe233a03ba6ef12ddf34fa417e22fd42fd77f190011e6cbe","run":"job_30bfc6e5af09a9f7","seq":4,"at":"2026-09-29T07:42:03.000Z","type":"STEP_RECORDED","step":1,"tokens":262144,"loss":0.6612,"grad_norm":0.93,"lr":1.5e-6,"batch_ids_hash":"sha256:e8dd3d6efcbcbfd661ce183f441401a2fd17654d9d2a3ca56214d6ef05988ae1"}
{"event_id":"sha256:3a5d9b20c35af1e49912c396d950159df117fd1a0e971a46a69e05d75c8e6306","run":"job_30bfc6e5af09a9f7","seq":242,"at":"2026-09-29T07:50:22.000Z","type":"EVAL_COMPLETED","evaluation":"evl_9c1f0a7d52e84b36","questions":310,"answered":310,"measures":[{"category":"all","metric":"accuracy","value":0.8064516129032258,"lo":null,"hi":null,"n":310,"of":310},{"category":"all","metric":"ece","value":0.1821982464086091,"lo":null,"hi":null,"n":310,"of":310}],"predictions_sha256":"6954fc80398244a02c97ea73d7de20427a085f02bd6675719cf935c95c36d82b","items_sha256":"5f3c4f8580d392e422e7c2f6802674ac27966c98d95c39696e4b2490168e5488"}
```

#### §7.3 Acceptance

`POST /v1/research/runs/{id}/events` takes `{"events": [...]}`: at most 1,000 events of that run,
in `seq` order. The server applies them in order and answers `{run, accepted, duplicate, next}`,
`next` being the seq it expects.

- An event whose `event_id` is not its `_hash` is `400`.
- An event at a seq already stored is a duplicate when its `event_id` equals the stored one's —
  accepted once, answered again — and `409 event_conflict` otherwise.
- An event past `next` is `409 seq_gap`, naming `next`.
- A `STEP_RECORDED` at or below the last recorded step must equal that step's record in
  `tokens`, `loss`, `grad_norm`, `lr` and `batch_ids_hash`, or it is `409 step_diverged`. A
  resumed trainer compares its steps with its own spool first (§13.3); a resume that does not
  reproduce them ends the run `failed` and continues as a new run whose `parents` name the
  checkpoint.
- Anything after `RUN_COMPLETED` is `409 run_completed`.
- A rule of §7.2 broken is `422`, naming the rule.

A refused batch applies the events before the refusal and answers which one refused.

#### §7.4 The run view

`GET /v1/research/runs/{id}` answers the fold of the run's events:

```rust
pub struct Run {
    pub id: String,
    pub project: String,
    pub kind: RunKind,
    pub status: RunStatus,          // created | training | evaluating | completed | failed | cancelled
    pub tags: Vec<String>,
    pub environment_artifact_sha256: String,
    pub reference: bool,            // §6.3
    pub config_sha256: String,
    pub parents: Vec<String>,
    pub seed: u64,
    pub gate_spec_hash: Option<String>,
    pub job: Option<String>,
    pub by: String,
    pub datasets: Vec<DatasetAttached>,
    pub steps: u64,                 // from RUN_COMPLETED, else the last STEP_RECORDED
    pub tokens: u64,
    pub batches: u64,
    pub checkpoints: Vec<CheckpointCreated>,
    pub evaluations: Vec<String>,   // evaluation ids, in EVAL_STARTED order
    pub gates: Vec<GateEvaluated>,
    pub error: Option<String>,
    pub seq: u64,                   // the last event applied
    pub created: String,
    pub ended: Option<String>,
    pub visibility: Visibility,     // private | org | public
}
```

`status` is `RUN_COMPLETED`'s when present; else `evaluating` while an `EVAL_STARTED` lacks its
`EVAL_COMPLETED`; else `training` once `TRAIN_STARTED` is recorded; else `created`. Measures are
not on the run: they are on its evaluations (§8).

| method and path | does |
|---|---|
| `POST /v1/research/runs/{id}/events` | append events |
| `GET /v1/research/runs/{id}/events` | the log after `?after=` (at most 1,000) |
| `GET /v1/research/runs/{id}` | the run view |
| `GET /v1/research/runs` | run views (`?kind=` `?status=` `?tag=` `?job=` `?since=` `?until=`; `?org=` for a caller with no org, public runs only) |

### §8 Evaluation

**Live:** research runs carry `measures` (category, metric, value, interval, n, of) and derive
`completion` from `questions`, `answered` and `ended`; `/v1/eval` records judge scores as
telemetry; a `/v1/train` job's `result` carries per-suite accuracy, nll and ECE. **Not built:**
the Evaluation object, items, and server scoring.

An Evaluation is the only home of a metric record. `/v1/eval/scores`, `/v1/benchmark` and
`/v1/research/runs` answer evaluation ids and never hold a copy of a number.

#### §8.1 The type

```rust
pub struct Evaluation {
    pub id: String,
    pub run: String,
    pub subject: Subject,               // { kind: artifact, sha256 } | { kind: system, name, version }
    pub dataset: String,
    pub dataset_sha256: String,
    pub purpose: DataPurpose,           // the dataset's
    pub evaluator: Evaluator,           // { kind: harness | judge | human | server, name, version, definition_hash }
    pub questions: Option<u64>,
    pub answered: Option<u64>,
    pub completion: Completion,         // complete | partial | inconsistent | unknown
    pub measures: Vec<Measure>,
    pub predictions_sha256: Option<String>,
    pub items_sha256: Option<String>,
    pub environment_artifact_sha256: String, // the run's
    pub started: String,
    pub ended: Option<String>,
}

pub struct Measure {                     // the shape /v1/research/runs carries today
    pub category: String,                // "all", or a slice
    pub metric: String,
    pub value: f64,
    pub lo: Option<f64>,
    pub hi: Option<f64>,
    pub n: Option<u64>,
    pub of: Option<u64>,
}
```

`completion` is derived as today (HIP-1145): `inconsistent` when `answered > questions`,
`partial` when below, `complete` when equal and `EVAL_COMPLETED` is recorded, else `unknown`.
`evaluator.definition_hash` is the `_hash` of what scored: a harness's code tree, a judge's
model, criteria and score name. An evaluation with no `items_sha256` can be read and never
claimed (§11).

#### §8.2 Items and predictions

An `items` artifact (`application/x-ndjson`, schema 1) has one line per question of each item,
sorted by `item`, then `question`:

```json
{"item":"tdv:0017","question":"priority","group":"tdv:0017","correct":true,"p_gold":0.83,"confidence":0.83,"brier":0.0478}
```

`group` is the bootstrap unit when a rule resamples groups (a task, a conversation); it defaults
to `item`. `correct`, `p_gold` (the probability given to the gold answer), `confidence` (the
probability of the answer given), `brier` (Σ over options of (p − y)²), `score` (a judge's or a
person's numeric verdict, or a per-item measurement), `label` (a categorical verdict) and `trace`
(the model call graded) are each present when the evaluator produced them.

A `predictions` artifact has one line per question of each item, in the same order:
`{item, question, answer, probabilities}`, `probabilities` over the question's options in their
order.

#### §8.3 Metrics a gate computes

A paired rule (§9.2) recomputes its metric from items. Four are defined, and a server and a
runtime MUST agree to 1e-12:

- `accuracy`: the mean of `correct`.
- `nll`: the mean of −ln max(`p_gold`, 1e-12).
- `brier`: the mean of `brier`.
- `ece`: 15 bins with edges eᵢ = i · (1/15) in f64 and e₁₅ = 1; bin 0 is [e₀, e₁] and bin i is
  (eᵢ, eᵢ₊₁]; the sum over non-empty bins of nᵦ/N · |mean `confidence` − mean `correct`|. This
  is the harness's ECE (`bench score`, `harness/merge.py`).
- `score`: the mean of `score`.

A rule on any other metric reads the evaluation's `measures` and cannot take an interval.

#### §8.4 Sealed evaluation

For a `sealed_eval` dataset the server scores. The evaluator is `{kind: server}`; the runtime
sends `EVAL_COMPLETED` with `predictions_sha256` and no measures or items. The server scores the
predictions against the held gold, once per (run, dataset), writes the evaluation's items and
measures, and serves the measures and never the items. It scores only for a run whose
`RUN_CREATED` named a gate with a rule on that dataset; otherwise the `EVAL_COMPLETED` is `422
not_gated`. It counts every scoring under each gate, and `GET /v1/research/gates/{hash}` answers
the counts.

#### §8.5 Routes

| method and path | does |
|---|---|
| `GET /v1/research/evaluations` | evaluations (`?run=` `?dataset=` `?subject=` `?purpose=`) |
| `GET /v1/research/evaluations/{id}` | one evaluation |

Evaluations are written only by run events (§7). The server writes the events of the runs it
executes itself: `/v1/eval/runs`, `/v1/eval/scores` and sealed scoring.

### §9 Gate

**Live:** `bench gate` judges a checkpoint against a baseline on drawn suites with thresholds
given as flags (`--accuracy`, `--ece`) and compiled floors; a `/v1/train` job's `protect.budget`
bounds protected suites. **Not built:** everything in this section.

#### §9.1 The spec

```rust
pub struct Gate {
    pub name: String,             // ^[a-z0-9][a-z0-9._-]{0,63}$
    pub version: u32,             // 1, 2, …
    pub previous: Option<String>, // the gate_spec_hash of version − 1; absent at 1
    pub baseline: Option<String>, // the run whose evaluations are the baseline
    pub rules: Vec<Rule>,
}

pub struct Rule {
    pub dataset: String,
    pub dataset_sha256: String,
    pub category: String,
    pub metric: String,
    pub higher: bool,             // larger is better
    pub test: Test,
}

#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Test {
    Hold { tolerance: f64, interval: Option<Interval> },   // not worse than the baseline by more than tolerance
    Improve { margin: f64, interval: Option<Interval> },   // better than the baseline by more than margin
    Floor { value: f64, strict: bool },                    // at least value; above it when strict
    Ceiling { value: f64, strict: bool },                  // at most value; below it when strict
}

#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Interval {
    Bootstrap { draws: u32, level: f64, seed: u64, unit: Unit }, // unit: item | group
    Mcnemar { alpha: f64 },
}
```

`gate_spec_hash` is the gate's `_hash`. This gate holds typed decisions and requires support
triage to improve, the budget and target of job `job_30bfc6e5af09a9f7`:

```json
{
  "name": "kai.triage",
  "version": 1,
  "previous": null,
  "baseline": "kai.a7.val",
  "rules": [
    {"dataset": "kai.typed_decisions.val", "dataset_sha256": "19ad99cad377c666eee047792c63279afe063045cbfe5148defe5b25b90982b7",
     "category": "all", "metric": "accuracy", "higher": true, "test": {"kind": "hold", "tolerance": 0.02, "interval": null}},
    {"dataset": "kai.typed_decisions.val", "dataset_sha256": "19ad99cad377c666eee047792c63279afe063045cbfe5148defe5b25b90982b7",
     "category": "all", "metric": "ece", "higher": false, "test": {"kind": "hold", "tolerance": 0.03, "interval": null}},
    {"dataset": "kai.support_triage.val", "dataset_sha256": "0a8a72f3934ac0702440738a0dab6c61f0c190d57dbe2d47a511eac083fe4bcf",
     "category": "all", "metric": "accuracy", "higher": true, "test": {"kind": "improve", "margin": 0.0, "interval": null}}
  ]
}
```

```text
gate_spec_hash  sha256:010f18f5d6986a6d1fcc8c467df88df82ae4318f4617db14cd864e66727e6095
```

#### §9.2 Evaluating a rule

For each rule the evaluator takes the subject's evaluation and, for `hold` and `improve`, the
baseline run's evaluation on the same `dataset_sha256`. Either missing fails the rule with
`reason: missing`; either not `complete` fails it with `reason: incomplete`. Rows pair on
(`item`, `question`); a row in only one fails the rule with `reason: unpaired`.

`v`, the subject's metric, and `b`, the baseline's, are computed from items for the metrics of
§8.3 and read from `measures` for any other. The improvement is `d = v − b` when `higher`, else
`b − v`. With ε = 1e-9:

- `hold` passes when `d ≥ −tolerance − ε`; with a bootstrap, when its upper bound `hi ≥
  −tolerance − ε` (not worse beyond noise); with McNemar, unless `d < −tolerance − ε` and
  `p < alpha`.
- `improve` passes when `d > margin + ε`; with a bootstrap, when its lower bound `lo > margin +
  ε`; with McNemar, when `d > margin + ε` and `p < alpha`.
- `floor` passes when `v ≥ value − ε` (`v > value + ε` when strict); `ceiling` mirrors it.

The bootstrap is paired and percentile. Units (items, or groups) are sorted by id. SplitMix64 —
`state += 0x9e3779b97f4a7c15; z = state; z = (z ^ z>>30)·0xbf58476d1ce4e5b9; z = (z ^
z>>27)·0x94d049bb133111eb; z ^ z>>31` — seeded with `seed` draws each unit index by rejection:
`zone = 2⁶⁴−1 − (2⁶⁴−1) mod n`, redraw while `z ≥ zone`, index `z mod n`. Each of `draws`
resamples takes n units with replacement and computes `d` over their rows; with the `d`s sorted
and α = 1 − level, `lo = d[⌊α/2 · draws⌋]` and `hi = d[⌈(1 − α/2) · draws⌉ − 1]`. McNemar is
exact and two-sided on the discordant counts b (subject right, baseline wrong) and c:
`p = min(1, 2 · Σ_{k ≤ min(b,c)} C(b+c, k) / 2^(b+c))`, and 1 when b + c = 0.

The verdict is `pass` when every rule passes. Every rule has a result:

```rust
pub struct RuleResult {
    pub rule: u32,
    pub pass: bool,
    pub value: Option<f64>,
    pub baseline: Option<f64>,
    pub delta: Option<f64>,
    pub lo: Option<f64>,
    pub hi: Option<f64>,
    pub p: Option<f64>,
    pub n: u64,               // paired rows
    pub reason: Option<String>,
}
```

Vector (eight items; subject right on 1, 2, 3, 5, 6, 8; baseline right on 1, 4, 5, 8; groups
`g1`–`g4` by pairs): accuracy 0.75 against 0.5; bootstrap of 1,000 draws at level 0.95 with seed
13 gives [−0.25, 0.75] over items and [0, 0.5] over groups; McNemar b = 3, c = 1, p = 0.625.

#### §9.3 Prospective freezing

A gate is stored before the run it judges. `RUN_CREATED` names it in `gate_spec_hash`, and the
server refuses a `RUN_CREATED` naming a gate it does not hold (`422 gate_unknown`), so the gate's
`received` precedes the run's. Server receipt is the only clock read; a producer's `at` is never
trusted for this. The spool uploads a gate before the events that name it (§13.3).

A gate is immutable. Changing a threshold, a rule or the baseline is a new version: a new spec
with `version` one higher and `previous` naming the old hash, which the server checks (`422
bad_version`). A run keeps the version its `RUN_CREATED` named.

#### §9.4 Where it is evaluated

`bench gate` evaluates a stored gate for a run locally and emits `GATE_EVALUATED`. On receipt the
server evaluates the same gate from the stored evaluations and items; a disagreement in any
rule's `pass` is `409 gate_disagrees`, and the event is not stored. A claim's verdict is always
the server's (§11).

| method and path | does |
|---|---|
| `POST /v1/research/gates` | store a spec; answers `{gate_spec_hash, created}` |
| `GET /v1/research/gates` | the org's gates (`?name=`) |
| `GET /v1/research/gates/{hash}` | one spec, with `received` |

### §10 Comparison

**Live:** `GET /v1/research/compare?a=&b=` reads two recorded runs side by side: what blocks the
comparison, every configuration field they differ in, and the per-metric change with whether the
intervals overlap. **Not built:** the declared comparison with a verified `matched` record.

```rust
pub struct Comparison {
    pub kind: ComparisonKind, // architecture | scaling
    pub baseline: Point,      // { run, checkpoint }; no checkpoint is the run's last
    pub candidate: Point,
    pub matched: Matched,
    pub differs: Vec<String>, // what the candidate varies: "reader", "encoder", "data"
}

pub struct Matched {
    pub start_checkpoint: String,
    pub token_budget: u64,
    pub batch_count: u64,
    pub seed: u64,
    pub environment_artifact_sha256: String,
}
```

```json
{
  "kind": "architecture",
  "baseline": {"run": "j1a", "checkpoint": null},
  "candidate": {"run": "j1c", "checkpoint": null},
  "matched": {
    "start_checkpoint": "71a6ad030479f6bc000e1837c533dcd2b86e79b4bf150b3492a913905b520d28",
    "token_budget": 1986000000,
    "batch_count": 7751,
    "seed": 1,
    "environment_artifact_sha256": "365c787b95809ee792f0e918fd6fe94c601c4278473879fa789b9a01ac73b76a"
  },
  "differs": ["reader"]
}
```

An **architecture** comparison is two runs. The server checks, from their events, that each
names `start_checkpoint` in `parents`, completed with `tokens = token_budget` and `batches =
batch_count`, has `seed` and the environment named, and — unless `differs` names `data` —
attached the same `train` datasets. A **scaling** comparison is two checkpoints of one run: the
server checks both are its checkpoints, the candidate's `tokens` exceed the baseline's, and the
run's plan (`TRAIN_STARTED`) was `token_budget` and `batch_count`. The baseline run must be
reference-eligible (§6.3), else `422 reference_ineligible`. A failed check is `422 unmatched`,
naming the field and both values; two runs whose configs are equal and whose `differs` is empty
are `422 nothing_differs`.

The view answers the comparison with `comparable`, `blocks` (an evaluation incomplete, a dataset
hash differing), `config` (every leaf of the two config artifacts that differs, by RFC 6901
pointer, with both values) and `deltas` (per dataset, category and metric both evaluated: both
values, the change, and whether the intervals overlap). Empty lists are `[]`, never `null`.

| method and path | does |
|---|---|
| `POST /v1/research/comparisons` | declare one; answers its hash and view |
| `GET /v1/research/comparisons/{hash}` | the view |

### §11 Claim

**Live:** nothing. **Not built:** everything in this section.

```rust
pub struct Claim {
    pub id: String,
    pub statement: String,              // one sentence, at most 500 characters
    pub subject_run: String,
    pub baseline_run: Option<String>,   // equal to the gate's baseline
    pub evaluation_ids: Vec<String>,
    pub gate_spec_hash: String,
    pub status: ClaimStatus,            // pending | passed | failed | retracted
    pub verdict: Option<GateEvaluated>, // the server's
    pub retraction: Option<String>,
    pub created: String,
    pub decided: Option<String>,
}
```

`POST /v1/research/claims` refuses (`422`, naming the code) a claim whose subject run's
`RUN_CREATED` did not name `gate_spec_hash` (`gate_mismatch`); whose `baseline_run` is not the
gate's `baseline` (`baseline_mismatch`); with no evaluation ids, or one outside the subject and
baseline runs (`no_evaluation`); or with an evaluation that is not complete or has no items
(`incomplete`); or whose subject run trained on a dataset sharing a `contamination_hash` or
`canonical_example_id` with an evaluated one (`contaminated`). An accepted claim is `pending`;
the server then evaluates the gate (§9.2) and sets `passed` or `failed` with the verdict.

`POST /v1/research/claims/{id}/retract` takes a reason and moves any status to `retracted`.
Nothing else moves a status, and nothing deletes a claim.

A leaderboard row and a paper-facing number require a `passed` claim whose evaluations all read
`eval_only` or `sealed_eval` datasets. A paper cites claim ids.

```json
{
  "id": "clm_8192806920c773c1",
  "statement": "The triage capability raises support-triage accuracy over a7 without losing typed decisions or AG News.",
  "subject_run": "job_30bfc6e5af09a9f7",
  "baseline_run": "kai.a7.val",
  "evaluation_ids": ["evl_9c1f0a7d52e84b36", "evl_2d7e41a0c93b5f16", "evl_71c0e9a45b2d3f88"],
  "gate_spec_hash": "sha256:010f18f5d6986a6d1fcc8c467df88df82ae4318f4617db14cd864e66727e6095",
  "status": "failed",
  "verdict": {
    "gate_spec_hash": "sha256:010f18f5d6986a6d1fcc8c467df88df82ae4318f4617db14cd864e66727e6095",
    "verdict": "fail",
    "rules": [
      {"rule": 0, "pass": true, "value": 0.8064516129032258, "baseline": 0.7967741935483871, "delta": 0.009677419354838679, "lo": null, "hi": null, "p": null, "n": 310, "reason": null},
      {"rule": 1, "pass": true, "value": 0.1821982464086091, "baseline": 0.1790709034007661, "delta": -0.0031273430078430087, "lo": null, "hi": null, "p": null, "n": 310, "reason": null},
      {"rule": 2, "pass": false, "value": 0.6486486486486487, "baseline": 0.6640926640926641, "delta": -0.015444015444015413, "lo": null, "hi": null, "p": null, "n": 518, "reason": null}
    ]
  },
  "retraction": null,
  "created": "2026-09-29T07:52:00Z",
  "decided": "2026-09-29T07:52:01Z"
}
```

| method and path | does |
|---|---|
| `POST /v1/research/claims` | make a claim; answers it, decided |
| `GET /v1/research/claims` | claims (`?status=` `?run=` `?gate=`; `?org=` for a caller with no org, public claims only) |
| `GET /v1/research/claims/{id}` | one claim |
| `POST /v1/research/claims/{id}/retract` | retract it |

### §12 Teacher lineage

**Live:** teacher outputs are files: `bench mine typed` (a7 and laya-agent),
`bench rename` (enso-flash), `bench contrast` (zen6), `antjeworring/kai-synth` (enso-flash), and
Jev's recorded answers in `compat/bench` and the harness's `jev/preds.json.gz`. **Not built:**
everything in this section.

#### §12.1 The interaction

Every question put to a teacher, or to any system whose answers are kept, is one record:

```rust
pub struct TeacherInteraction {
    pub interaction_id: String,
    pub purpose: DataPurpose,             // the source item's
    pub source_dataset: String,
    pub source_item_id: String,
    pub canonical_example_id: String,
    pub provider: String,                 // openrouter, hanzo
    pub requested_model: String,
    pub returned_model: String,           // what the provider says answered
    pub request_template_hash: String,    // the request with the item's slots empty
    pub request_hash: String,             // the request as sent
    pub response_hash: String,            // the response as received
    pub state_hash: String,
    pub question_hash: String,
    pub candidate_set_hash: String,       // the options, in order
    pub choice: Option<String>,
    pub probabilities: Option<Vec<f64>>,  // over the candidate set, in its order
    pub usage: Usage,                     // { input_tokens, output_tokens }
    pub latency_ms: u64,
    pub cost: f64,                        // US dollars, as billed
    pub contamination_barrier_hash: String,
}
```

```json
{
  "interaction_id": "sha256:b7f713e5cef39c09fc70c79edd330b653cf080762e5a9849c0a2b359e9701219",
  "purpose": "teacher_mining",
  "source_dataset": "jev-teacher-train-v1",
  "source_item_id": "support_triage:4812",
  "canonical_example_id": "support_triage:train:4812",
  "provider": "openrouter",
  "requested_model": "typesafe/jev-1.13",
  "returned_model": "typesafe/jev-1.13",
  "request_template_hash": "sha256:5cde0f1298f41f7d1c8b907a36992a7a513225a2615bd6e307bf1a9149b06b40",
  "request_hash": "sha256:1f58b9145b24d108d7ac38887338b3ea3229833b9c1e418250343f907bfd1047",
  "response_hash": "sha256:a9f4b3d22a523fdada41c85c175425bcd15b32b4cd0f54d9433accd52d7195a1",
  "state_hash": "sha256:fb31ebe8dd3992379974e45ca20a7d281ed37b4e63b17499c40fc8818edcd3c2",
  "question_hash": "sha256:1f5087db919ced5c123c7f507d3fcce818cb0cf6e77c2f95a8a35e951e03fdb9",
  "candidate_set_hash": "sha256:546b42e5f1430c72e970d43b033fb9f389126258c3e4a62b2bba01be4e56be61",
  "choice": "billing",
  "probabilities": [0.91, 0.06, 0.03],
  "usage": {"input_tokens": 212, "output_tokens": 0},
  "latency_ms": 133,
  "cost": 0.000212,
  "contamination_barrier_hash": "sha256:f0dc3075f012ecffa9225a29f5dda815bb4aac0c0f97edfb894152c1e7e0ec1d"
}
```

An interaction whose source item is `sealed_eval` is refused (`422 purpose_refused`). A noul is
the candidate set `["true", "false"]`; a score, its levels in order.

#### §12.2 Request and response

The request and response bodies are artifacts of kinds `request` and `response`, addressed by the
hex of `request_hash` and `response_hash`, with the interaction's purpose.

#### §12.3 Derived supervision

What is learned from answers is a separate artifact, never a field of the interaction. Each line
names the interactions it came from, and each artifact's purpose follows §3.3 over them:

| | kind | line |
|---|---|---|
| R1 hard target | `target` | `{item, question, choice, interactions}` |
| R2 direct pairs | `pairs` | `{item, question, i, j, p, evidence: "direct_query", interactions}`: the teacher was asked i against j |
| R2 implied pairs | `pairs` | `{…, evidence: "k_way_implied"}`: P(i≻j) = pᵢ / (pᵢ + pⱼ) read off one K-way distribution |
| R3 probability vector | `distribution` | `{item, question, candidate_set_hash, p, interactions}` |
| R4 invariance group | `invariance` | `{group, members: [{item, question}], answer, interactions}`: views the teacher answered alike |

```rust
#[serde(rename_all = "snake_case")]
pub enum PairEvidence {
    DirectQuery, // the teacher compared i and j
    KWayImplied, // read off a K-way distribution: derived supervision, not an observation
    Gold,        // the gold answer orders them
}
```

A `k_way_implied` pair is derived supervision: a trainer that weights pairs reads `evidence`, and
a report counts the kinds apart.

```json
{"item":"support_triage:4812","question":"team","i":"billing","j":"tech","p":0.9381443298969073,"evidence":"k_way_implied","interactions":["sha256:b7f713e5cef39c09fc70c79edd330b653cf080762e5a9849c0a2b359e9701219"]}
```

#### §12.4 The two Jev datasets

- `jev-teacher-train-v1`, purpose `teacher_mining`: train-split items put to Jev as a teacher.
  Its interactions derive R1–R4 artifacts of purpose `train`.
- `jev-eval-observations-v1`, purpose `eval_only`: Jev's recorded answers on evaluation items
  (the frozen harness, jevlab B1–B3b, jev-harness review and routing). Analysis only; derivation
  off, so no target, pair, vector or group is made from it.

#### §12.5 Routes

| method and path | does |
|---|---|
| `POST /v1/research/interactions` | record at most 20,000 interactions |
| `GET /v1/research/interactions` | interactions (`?dataset=` `?model=` `?purpose=`) |

### §13 Runtime

**Live:** `train fit`, `join` and `serve`; `bench gate`, `cap`, `preds`, `score` and `post`;
decision's stage barrier; `hanzo-research` (Rust) and `hanzo_research` (Python) record
experiments. **Not built:** the spool, `train harvest`, `train determinism`, `bench eval`,
`train sync`, and the rest of this section.

#### §13.1 Components

| component | does | home |
|---|---|---|
| wire | the types of §2–§12, one definition in Rust | `hanzo-research` (hanzoai/ml) |
| spool | the local append-only log and its uploader (§13.3) | `hanzo-research` |
| artifact manager | content-addresses, stores locally, registers, uploads | `hanzo-research` |
| lineage recorder | appends each event as the step that causes it happens | `hanzo-research` |
| contamination firewall | the purpose checks of §3.5 at ingest | `hanzo-train`; the barrier in decision `train::stage` |
| deterministic trainer | trains from sealed `train` datasets only | `hanzo-train`; decision `train fit`, `train join` |
| determinism probe | §6.2 | `hanzo-train`; decision `train determinism` |
| teacher harvester | asks a teacher about items, records interactions, writes R1–R4 | decision `train harvest` |
| benchmark evaluator | runs a subject over an evaluation dataset: predictions, items, measures | decision `bench eval` |
| gate evaluator | evaluates a stored gate for a run (§9.2) | decision `bench gate` |

decision's `train::research` (its copy of the research wire) and `bench post` are removed: every
subcommand records as it runs, through the spool.

#### §13.2 No scripts

Every step is a subcommand of a binary: `train data`, `train stage`, `train harvest`, `train
fit`, `train join`, `train determinism`, `bench eval`, `bench gate`, `train sync`. A step that
cannot be expressed as one is added as one.

#### §13.3 The spool

The spool is a directory, `$HANZO_SPOOL` (default `~/.hanzo/spool`), under `<org>/<project>/`:

- `runs/<run>.log` — the run's events, canonical JSON, one per line, in `seq` order. An event is
  hashed when it is built, appended, and fsync'd before the step that caused it continues.
- `runs/<run>.ack` — the highest `seq` the server acknowledged.
- `gates/<hash>.json` — a gate the producer stored, uploaded before any event naming it.
- `artifacts/<sha256>` — an artifact's canonical bytes (or `<sha256>.zst`), beside
  `<sha256>.json`, its metadata; `<sha256>.ack` once the server holds it stored.

A resumed trainer reads its own `runs/<run>.log` and compares each step it re-runs with the step
recorded there (§7.3) before appending anything.

#### §13.4 The uploader

Each process that writes the spool runs one uploader thread; `train sync` drains a spool on its
own. The uploader sends unacknowledged gates and artifacts first, then events in `seq` order in
batches of at most 1,000, and writes the ack after each 2xx. On a network error, `429`, `503` or a timeout
it waits 1 s, doubling to 60 s, and retries without limit. On a permanent refusal (a `409` or
`422`) it stops that run's upload and reports it; the producer continues.

#### §13.5 Availability

Cloud availability never blocks or kills training. A producer never waits on the network: it
appends, fsyncs and continues, and exits with its own status whatever the upload state. With the
API unreachable a run completes and its spool holds every event; `train sync` later leaves the
server's run view equal to the fold of the local log (`train sync --check` compares them).

### §14 Routes

#### §14.1 The canonical surface

Everything the runtime writes goes through `/v1/research`: §4.3, §5.3, §6.3, §7.4, §8.5, §9.4,
§10, §11, §12.5, and three kept from HIP-1145:

| method and path | does |
|---|---|
| `POST /v1/research/grants` | set `visibility` (`private`, `org`, `public`) on a run, artifact, dataset or claim, by `{target, id}` |
| `GET /v1/research/projects` | per project: runs, evaluations, claims, datasets, artifacts |
| `GET /v1/research/totals` | the same, summed, per run kind |

#### §14.2 Every live route

Each route served today, the object it reads or writes, and its fate. **Kept** is unchanged but
for the fields stated; **view** answers from the canonical objects and holds nothing of its own;
**removed** answers `404` once its replacement ships.

| route | object | fate |
|---|---|---|
| `POST /v1/research/experiments` | Run, Evaluation | removed: `RUN_CREATED` and `EVAL_COMPLETED` |
| `GET /v1/research/experiments` | Evaluation | removed: `GET /v1/research/evaluations` |
| `GET /v1/research/projects`, `GET /v1/research/totals` | all | view |
| `POST /v1/research/grants` | visibility | kept; `trainable` and `publishable` removed — purpose (§3) and claims (§11) replace them |
| `POST /v1/research/artifacts` | Artifact | kept; §5 fields; bytes past 16 MiB by grant |
| `GET /v1/research/artifacts`, `GET /v1/research/artifacts/{sha256}` | Artifact | kept |
| `POST /v1/research/benchmarks` | Dataset | removed: `benchmark` on `POST /v1/research/datasets` |
| `GET /v1/research/benchmarks` | Dataset | view: datasets carrying `benchmark`, grouped by its id |
| `POST /v1/research/runs` | Run | removed: `POST /v1/research/runs/{id}/events` |
| `GET /v1/research/runs` | Run | kept; answers run views (§7.4); measures move to evaluations |
| `POST /v1/research/studies`, `GET /v1/research/studies` | — | removed: a study's question is a claim's statement, its finding the claim's status |
| `POST /v1/research/papers`, `GET /v1/research/papers` | — | removed: a paper cites claims |
| `GET /v1/research/compare` | Comparison | removed: `/v1/research/comparisons` |
| `POST /v1/eval/datasets`, `GET /v1/eval/datasets`, `GET /v1/eval/datasets/{name}`, `DELETE /v1/eval/datasets/{name}` | Dataset | removed: `/v1/research/datasets` |
| `POST /v1/eval/datasets/{name}/items`, `GET /v1/eval/datasets/{name}/items` | DatasetItem | removed: `/v1/research/datasets/{id}/items` |
| `POST /v1/eval/evaluators`, `GET /v1/eval/evaluators` | Evaluator | kept; a judge's `definition_hash` is the `_hash` of its model, criteria and score name |
| `POST /v1/eval/rubrics`, `GET /v1/eval/rubrics` | rubric | kept; validates an item's `score` and `label` |
| `POST /v1/eval/scores` | Evaluation | view: a batch of human or out-of-band verdicts on one dataset and subject is one evaluation (evaluator `human`); answers its id |
| `GET /v1/eval/scores` | Evaluation | view: item rows, each with its evaluation id |
| `GET /v1/eval/traces` | trace | kept; a row's `trace` names one |
| `GET /v1/eval/metrics` | usage | kept here; HIP-0129 moves it to o11y |
| `POST /v1/eval/runs` | Run, Evaluation | kept: the server runs the model and judge as a run of kind `eval`; answers the summary with its run and evaluation ids |
| `GET /v1/eval/runs` | Run | removed: `GET /v1/research/runs?kind=eval` |
| `GET /v1/benchmark/catalog` | Dataset | view: public datasets of the `admin` org carrying `benchmark` |
| `GET /v1/benchmark/leaderboard` | Claim, report | view: measured rows from public passed claims on catalog datasets, beside reports |
| `GET /v1/benchmark/compare` | Evaluation | view: McNemar over two evaluations' items on one dataset |
| `GET /v1/benchmark/history` | Evaluation | view |
| `POST /v1/benchmark/runs` | Run | kept: admission; the harness records a run and its evaluations |
| `GET /v1/benchmark/claims`, `POST /v1/benchmark/claims` | report | renamed `/v1/benchmark/reports`: a number someone else published, with its citation, is a report, not a claim; writes by SuperAdmin |
| `GET /v1/benchmark/presets`, `POST /v1/benchmark/presets` | — | kept; router blends, outside this HIP |
| `GET /v1/train/models` | — | kept |
| `POST /v1/train/jobs` | job | kept; `gate` (a `gate_spec_hash`) replaces `protect.budget` and `evaluation` |
| `GET /v1/train/jobs`, `GET /v1/train/jobs/{id}` | job | kept; `result` names the run, its evaluations and its claim; `artifacts` are views |
| `POST /v1/train/jobs/{id}/cancel`, `POST /v1/train/jobs/claim` | job | kept |
| `POST /v1/train/jobs/{id}/publish` | job | kept; requires a passed claim on the job's run; `force` removed |
| `GET /v1/train/jobs/{id}/events` | job | kept: the job's control log |
| `POST /v1/train/jobs/{id}/events` | job | kept for `status`, `coordinator`, `log` and heartbeats; `metric`, `artifact` and `result` move to run events |
| `GET /v1/train/jobs/{id}/metrics` | Run | view: the job run's steps and evaluations |
| `GET /v1/train/jobs/{id}/artifacts` | Artifact | view: artifacts the job's run produced |
| `POST /v1/train/jobs/{id}/artifacts` | Artifact | removed: `POST /v1/research/artifacts` |
| `/v1/train/clients` and its eight operations | client | kept; the engine's wire |

`/v1/dataset` (HIP-1167, the risk plane's event snapshots), `/v1/experiment` (HIP-1311, A/B
arms) and `/v1/leaderboard` are other products and outside this HIP. The A/B plane's evidence,
written today through `research.Record` as experiment rows of kind `ab`, becomes runs and
evaluations of kind `eval` tagged `ab`.

Paths are `/v1/`; there is no `/api/` prefix and no second version.

### §15 Tenancy and authority

**Live:** as HIP-1145 and HIP-1333 state; `/v1/research` and `/v1/train` are `alpha` (flags
`research`, `train`), with `GET /v1/research/runs` open to `?org=`; `/v1/eval` and
`/v1/benchmark` are `ga`. **Not built:** the SuperAdmin rule on reports and catalog datasets.

- Auth is Hanzo IAM only. The org is the validated principal's, never a body, query or path
  value (HIP-0026); the project is the principal's sub-scope, stamped by the server. This HIP
  defines no credential, token or header.
- Each org's objects are in its own research store (`cloud.OrgStore`) and under `<org>/` in S3.
  An id another org holds answers `404`, exactly as an unknown one.
- Everything is `private` when written. `POST /v1/research/grants` moves a run, artifact, dataset
  or claim to `org` or `public`. A caller with no org reads `public` runs and claims of the org
  `?org=` names (the manifest's `Open` list gains `GET /v1/research/claims`).
- Deployment-wide data — the benchmark catalog's datasets (in the reserved `admin` org) and
  `/v1/benchmark/reports` — is written only by a SuperAdmin, `owner == "admin"` (HIP-0118), and
  every such write is audited. An org admin (`isAdmin`) is not a SuperAdmin.
- An executor acts as a principal of its org; `/v1/train`'s task lease stays `/v1/train`'s.

### §16 Migration

In this order; each step ships whole, with its producers, in one pass.

1. **Encoding.** `apps/research` implements §2 and passes §17's vectors beside `hanzo-research`.
2. **Artifacts.** One store (§5.3): research and train artifacts share `<org>/<sha256>`; the
   metadata fields land; `POST /v1/train/jobs/{id}/artifacts` goes. Existing research artifacts
   keep their addresses, which are hashes of submitted bytes; each JSON or gzip artifact is
   re-registered under its canonical address with the old one as its `parents`.
3. **Datasets and purpose.** `/v1/research/datasets` ships; every `/v1/eval` dataset becomes one
   with purpose `eval_only`; decision's stage builds register their shards as sealed datasets
   (train shards `train`, validation shards `dev`, sealed tests `sealed_eval`); `/v1/eval`'s
   dataset routes go.
4. **Runs and evaluations.** The event routes, run views and evaluations ship. Producers move to
   the spool: `train serve`, `train fit`, `bench` (`bench post` goes), `hanzo-research` in Rust
   and Python, and `apps/experiment`'s `research.Record`. Recorded runs become run views of kind
   `eval` holding one evaluation each, their measures unchanged and no items; experiment rows
   the same, their `kind` a tag; `/v1/benchmark` attempts become evaluations with items
   (`correct` per attempt); `/v1/eval` scores become evaluations of their runs. None of these can
   back a claim until re-evaluated with items. The removed research routes go.
5. **Gates, comparisons, claims.** Their routes ship; `bench gate` reads a stored gate; a
   `/v1/train` job names `gate`, and publish requires a passed claim; the leaderboard reads
   claims; `/v1/benchmark/claims` becomes `/v1/benchmark/reports`, SuperAdmin-only.
6. **Teachers.** Interactions and derived artifacts ship; `train harvest` replaces `bench mine`,
   `bench rename` and `bench contrast`; the two Jev datasets are built from the recorded calls.
7. **Environment and determinism.** Every run names an environment; `train determinism` ships;
   comparisons enforce reference eligibility.
8. **The document.** `private.yaml` and `openapi.yaml` regenerate; the SDKs, the CLI and the MCP
   catalog follow from them (HIP-0139 §1).

### §17 Conformance

An implementation passes each of these; each names the section it tests.

1. §2.1's vector, byte for byte, in Go and Rust.
2. §3.4's `contamination_hash` vector.
3. §3.2's matrix: every (purpose, role) pair attached in a `DATASET_ATTACHED` is accepted or
   refused as the table says; `train` with `eval_only` is `422 purpose_refused`.
4. §3.3: an artifact of purpose `train` with an `eval_only` parent is refused; `teacher_mining`
   and `train` parents give `train`; a `dev` parent gives `dev`.
5. §3.5: `train fit` over a stage whose shard has one `eval_only` row exits non-zero before its
   first step.
6. §4.2: a `sealed_eval` item read by any route never carries `payload.gold`.
7. §5.1: a JSON artifact registered from its gzip bytes and from its plain bytes gets one address,
   the hash of its canonical form.
8. §7.3: one event posted twice is accepted once and answered `duplicate` the second time; the
   same seq with other content is `409 event_conflict`; seq `next + 1` is `409 seq_gap`; a
   re-sent step with another loss is `409 step_diverged`.
9. §7.4: the run view equals the fold of its events, whether they arrived in one batch or one at
   a time.
10. §8.3 and §9.2's vector: metrics, bootstrap bounds and McNemar p to 1e-12.
11. §9.3: a `RUN_CREATED` naming a gate the server does not hold is `422 gate_unknown`; a gate
    re-posted unchanged answers the same hash and `created: false`; one threshold changed is a
    new hash, refused as `422 bad_version` unless `previous` and `version` follow the old one.
12. §9.4: a `GATE_EVALUATED` whose verdict the server does not reproduce is `409
    gate_disagrees`.
13. §10: an architecture comparison whose runs differ in `seed` is `422 unmatched`; one whose
    baseline has no exact determinism report is `422 reference_ineligible`.
14. §11: a `/v1/train` job's publish without a passed claim is `409 not_publishable`.
15. §13.5: `train fit` with the API unreachable exits 0 with every event in the spool; `train
    sync` then leaves `train sync --check` clean.
16. §15: every route of §14.1 answers `404` for another org's id.

## Rationale

**Events rather than records.** A run recorded after it ends can say anything about how it got
there; a run recorded as it happens cannot. Event ids that are content hashes make every upload a
replay, so the spool can resend without coordination, and a resumed trainer that does not
reproduce its steps is caught by the log rather than by a later reader.

**One home for a number.** Every copy of a number is a place for it to disagree with itself. The
evaluation holds the number and the rows it was computed from; everything else points at it.

**Gates stored, not passed.** A threshold chosen after a run is read is a description of the run.
Storing the spec before the run, hashing it, and reading only the server's receipt clock makes
the order checkable. Evaluating on the server as well as locally keeps the runtime's fast feedback
without trusting it for the verdict.

**Purpose on the row.** A training set is only as clean as its dirtiest row, and a row travels:
into a shard, a teacher prompt, a pair. Carrying purpose on every item and artifact, and deriving
it along lineage, lets the trainer refuse locally without asking the server.

**The alternative** is to keep four surfaces and reconcile them. Each reconciliation is a
join someone has to remember, and a claim that rests on a reconciled number cannot say which
copy it read.

## Security Considerations

- **Forged verdicts.** A client can send any `GATE_EVALUATED`; the server recomputes it and
  refuses a disagreement, and a claim's verdict is the server's alone. An org's own runtime still
  produces the items the server reads; the server cannot tell honest predictions from fabricated
  ones except on `sealed_eval` datasets, where it holds the gold.
- **Gates tuned after the fact.** Prospective freezing reads only server receipt instants. A
  producer that runs offline, reads its results, and only then stores a gate and uploads its run
  passes the check; that is procedure, not proof. Only sealed evaluation (§8.4) is proof: the
  server scores sealed predictions for a run whose gate it already held, once.
- **Contamination.** Purpose stops accidental training on evaluation data; it cannot stop a
  person copying `eval_only` inputs by hand. `sealed_eval` gold never leaves the store, and every
  read of sealed inputs is counted against the run that made it.
- **Tenancy.** Every object is keyed by the validated org; foreign and unknown ids answer alike.
  Deployment-wide writes are a SuperAdmin's, one predicate, `owner == "admin"`, audited.
- **Poisoned addresses.** The server hashes what it stores and refuses a mismatch, so a caller
  cannot bind an address to other bytes.

## References

- HIP-0026 — Identity & Access Management Standard
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0118 — SuperAdmin & Tenant Isolation Model
- HIP-0129 — Eval — A Score Over Model Output
- HIP-0139 — Capability
- HIP-1105 — Benchmark — The Measurement Arena
- HIP-1145 — Research — The Experiment Record
- HIP-1332 — Kai — The Decision Model and the Decision Plane
- HIP-1333 — Train — One Endpoint for Training
- RFC 6901 — JSON Pointer
- RFC 9457 — Problem Details for HTTP APIs
- [Research](https://docs.hanzo.ai/docs/research) — the usage docs: the live routes, with calls

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
