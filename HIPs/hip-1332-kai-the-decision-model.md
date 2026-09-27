---
hip: 1332
title: Kai — The Decision Model and the Decision Plane
author: Hanzo AI
type: Standards Track
category: Core
capability: decisions
status: Draft
implementation-rust: partial
created: 2026-09-25
requires: HIP-0004, HIP-0010, HIP-0043, HIP-0106, HIP-0113, HIP-0124, HIP-1190, HIP-1220, HIP-1322, HIP-1330
---

# HIP-1332: Kai — The Decision Model and the Decision Plane

## Abstract

Kai is Hanzo's decision model. It turns heterogeneous evidence into calibrated, typed, mutually
consistent decisions, many at once. It does not generate text, and it holds no authority:
deterministic policy, solvers and humans do.

Decision inference is a primitive beside generation, retrieval, forecasting, perception, solving
and policy:

```text
Zen     generates: open reasoning, code, language
Kai     decides: bounded judgment, decision state
Enso    routes: each operation to Kai or Zen (HIP-0510)
Embed   retrieves      TS      forecasts     Vision  perceives
Audio   hears          Graph   structures    Solver  proves
Policy  governs
```

Hanzo Decision composes them into versioned Decision Programs, served at `POST /v1/decisions`.
Kai's native output is Decision Program state, not prose:

```text
evidence → adapters → shared evidence → program graph → parallel Kai inference
  → freeze confident nodes, refine the rest → constraints + policy → human → Decision Package
```

Inside Enso, Kai is the in-process controller for model, context, tools, reasoning budget,
stopping and escalation.

## Motivation

Generative models are asked two kinds of question. Open ones: reason, write, explain, plan.
Bounded ones: which model, which tool, which file, is the evidence sufficient, how severe, did
the last step make progress, which option meets the constraints, does a human approve. The
second kind has a known answer space. Generating prose for it costs tokens, latency and context,
needs a parser, and is not reproducible. Hanzo separates decision from generation: Zen stays for
open work; Kai takes bounded judgment.

## Specification

### §1 Vocabulary

Normative terms. **Hanzo Decision**: the capability and API. **Kai**: the decision model.
**Zen**: the generative family. **Enso**: the router family (HIP-0510); it routes each operation to Kai or Zen. **Decision Program**:
a versioned, executable description of a decision. **Decision Package**: the reproducible record
of one program run. **Evidence**: anything a program may read. **Adapter**: maps one modality into
evidence. **Policy**: deterministic authority. **Decision Plane**: the runtime subsystem that
evaluates bounded decisions with Kai. Laya and Jev are baselines, not platform vocabulary.

### §2 One Kai

There is one model line, `hanzoai/kai`. Language, domain, modality or hardware MUST NOT spawn
separate product families (`kai-english`, `kai-agent`, `kai-sensor`, …). New checkpoints,
adapters, quantizations and training stages are revisions of the one line; each MUST be
identified by an immutable revision or digest, and every Decision Package MUST record it.

### §3 Encoder

Kai's text encoder is mmBERT-base, initialized from the Laya multilingual weights: one encoder
for every language, 8K context, smaller than the ModernBERT-large encoder of the English
baseline. Whether it keeps that baseline's English accuracy is an empirical question the
harness (§18) MUST answer.

### §4 Evidence

Everything a decision reads is Evidence:

```rust
Evidence { id, modality, source, time, payload, provenance, uncertainty, metadata }
```

Modalities include text, code, document, image, video, audio, waveform, series, telemetry,
point cloud, radar, thermal, geospatial, table, graph, SysML, simulation, tool output, agent
trace, human assertion, model output, and `Custom(name)` (e.g. `CAN-J1939`, `MIL-STD-1553`).
Evidence MUST keep enough metadata to say what was observed and where it came from; modalities
MAY add unit, sample rate, frame, sensor identity, calibration, quality, error bound, language,
timing, schema or model revision.

#### §4.1 Adapters

Each modality reaches the shared evidence space through an adapter. A new source SHOULD need a
new adapter, never a new Decision Program API. Evidence is encoded once per changed evidence
state.

#### §4.2 Sensors

Numeric sensor data MUST NOT have to be serialized as prose. An observation SHOULD keep value,
unit, channel, time, rate, sensor, frame, uncertainty, calibration, quality and provenance, so
43.2 °C, 43.2 psi and 43.2 mm/s differ and an expired calibration weakens the evidence. The
interface MUST extend to sensors nobody listed.

#### §4.3 Time

Raw series MAY pass through a temporal adapter. Kai SHOULD read temporal state: current value,
window, trend, derivative, anomaly score, baseline deviation, forecast, quality. Forecasting is
a separate model's job; its forecasts are evidence.

#### §4.4 Audio and video

Audio MUST carry both speech content and acoustic signal; a transcript alone does not conform
where sound is evidence (alarms, machinery, vibration). Video SHOULD reach Kai as events from
frames and clips, retrieved before deciding, never as unbounded frame tokens.

#### §4.5 Engineering models

SysML is evidence. A model SHOULD compile into the engineering knowledge graph or a Decision
Program, not be flattened to prose, and a decision MUST trace back to the element ids and
model revision it used.

### §5 Decision Programs

A program MAY hold objectives, options, constraints, assumptions, risks, bias checks, evidence,
provenance, typed variables, dependency edges, deterministic, Kai, Zen, graph, simulation and
solver nodes, policy gates, human approvals and refresh rules. The model is part of the program,
not the program.

### §6 Typed variables

Kai MUST support: **choice** (one of a set; the distribution exposed where practical);
**score** (ordinal; modeled as ordered, not as unordered classes); **predicate** (a calibrated
boolean); **defer** (abstain: insufficient evidence, out of distribution, conflict, human
judgment required). Kai MUST NOT be made to invent certainty.

### §7 Large choice sets

Kai MUST NOT depend on packing every option into one shared prompt. Large sets use candidate
retrieval, then independent option scoring, then joint refinement where needed; candidate
representations MAY be compiled and cached per program version. Targets span 10 to 100,000+
candidates; these are scale targets, not results.

### §8 Joint decoding

Kai SHALL predict many program variables in one execution, from one encoding of the evidence;
it MUST NOT need one full encoder pass per variable. With variables `Z = {z_1 … z_n}`, each in its
own domain `D_i`, Kai models `p(Z_M | E, Z_¬M, G)`: the masked subset `M` given evidence `E`, the
visible variables and the program graph `G`.

### §9 Refinement and dependencies

Parallel does not mean committed independently. Kai SHOULD predict all unresolved variables,
freeze confident ones, refine uncertain or dependent ones, then project onto constraints.
Independent branches resolve in the same wave; a node waits only for its parents, so the number
of waves follows graph depth, not variable count.

### §10 Constraints and policy

Hard requirements (equations, optimization, SAT/SMT, schemas, physical bounds, business rules,
security restrictions) MUST be enforced outside the model. Kai MAY inform a solver and MUST NOT
override one. Policy is authoritative: actions join on `ALLOW < ASK < DENY`, so a learned model
can tighten a verdict and MUST NOT weaken a deterministic denial.

### §11 Conflict

Conflicting evidence is a valid state (telemetry normal, video shows damage; simulation passes,
test fails; requirement ≤ 500 kg, model 530 kg). Kai MUST be trained and evaluated on cases whose
correct answer is `evidence_conflict = true`, `decision_ready = false`, `human_review = true`.

### §12 Decision Packages

A material run MAY produce a Decision Package holding the program and version, result and
alternatives, objectives, constraints, assumptions, risks, bias checks, evidence, provenance,
source hashes, model and calibration revisions, distributions, solver and policy results,
overrides, approvals, sensitivity, flip conditions, trace and a reproduction manifest. The
question a package answers is whether the decision can be inspected, replayed, refreshed and
reproduced.

#### §12.1 What flips the decision

The runtime SHALL compute sensitivity itself: vary objectives, constraints, assumptions,
evidence, forecasts, risks, cost, schedule or confidence, and report the boundary where the
result changes. Zen MAY describe those results and MUST NOT invent them.

#### §12.2 Refresh

When evidence changes, only affected nodes recompute. A refreshed package keeps the previous and
new result, changed evidence, assumptions and constraints, affected nodes, boundaries crossed and
new approvals.

### §13 Enso

Kai SHALL be native to Enso: `enso.decide("agent.preflight@4", state)` runs in process, with no
network hop when co-resident; `/v1/decisions` serves external callers. Kai MAY control model and
provider, context and retrieval depth, tools and skills (HIP-1322), reasoning budget, decoding
strategy (autoregressive, speculative, parallel draft, block diffusion, verification depth),
cache retention, progress, completion, retry, escalation and human approval.
Enso routes each operation: a bounded decision goes to Kai; generation, or a decision Kai defers,
goes to Zen.

#### §13.1 Modes

Every program runs `shadow` (Kai decides and logs; behaviour unchanged), `advisory` or
`enforced`, set per program. Kai MUST start in shadow.

#### §13.2 Minimum sufficient compute

Routing supervision SHOULD target the cheapest model that succeeds, not the largest. A
cost-aware objective MAY take the form `L = L_failure + λ·C_compute + μ·C_latency` under a quality
constraint. Context reduction counts only when downstream quality holds.

#### §13.3 Customer programs

Organizations MAY define their own programs (typed questions, options, thresholds) and specialize
Kai on validated outcomes through adapters, never a full model per tenant. Stable programs SHOULD
compile to a plan: question and candidate representations, indexes, graph, thresholds,
calibration and policy bindings, reused per request.

#### §13.4 Learning

Production traffic MUST NOT change weights synchronously. Traces go to a buffer, then offline
training, benchmark, shadow, and a controlled promotion; every promoted checkpoint has an
immutable version.

### §14 Personalized decisions

Recommendation, routing, UI, workflow and notification choices are one primitive: state,
evidence, candidates and policy in, a typed decision out. Kai MAY adapt at global, domain, tenant,
cohort, session and user scope, layered: base model, domain adapter, tenant adapter, user
preference state. Per-user adaptation SHOULD be state and lightweight adapters, not a checkpoint
per user. Preference state is probabilistic and revisable: each value keeps its prior, its
current estimate and a confidence.

#### §14.1 Commerce

A catalog compiles to a product graph: category, attributes, variants, price, inventory,
compatibility, merchant, signals. Recommendation is a large choice (§7): eligibility and
retrieval, Kai ranking, joint refinement. A program such as `commerce.recommend` (intent, price
sensitivity, novelty, best product, needs clarification) makes each recommendation inspectable,
and its flip conditions computable (§12.1). Zen explains a ranking; it does not produce one.

#### §14.2 Outcomes and consent

Interactions are graded supervision: a skipped impression is weak, a click or comparison
medium, a purchase strong, a purchase kept stronger, a return or refund negative. Counterfactual
replay targets the product that served the user best, not the most popular one. Every trace
carries source, consent scope, tenant, retention and allowed use, and policy, not model code,
decides `may_personalize`, `may_train_tenant` and `may_train_global`. Identifiable per-user
behaviour MUST NOT reach global training without that permission.

#### §14.3 Autopilot

A business runs on bounded decisions followed by generation and execution. Kai decides who, what,
when, why and through which channel: enrichment (industry, size, role, interest, intent, budget,
urgency, channel, readiness; each typed, scored, deferrable), lead fit and intent, next action,
offer, cadence, handoff to a human, stop. Zen writes the message; Enso routes each step; Policy
decides whether contact is permitted (consent, opt-outs, caps, quiet hours, jurisdiction, age,
suppression, sensitive attributes), so Kai may prefer SMS and policy may still forbid it. Each
program (`marketing.*`, `sales.*`, `commerce.*`) owns its outcome metrics (replies, qualified
meetings, pipeline, purchases, unsubscribes, cost per qualified lead) and is evaluated
counterfactually, then in shadow and A/B, before it acts. Supervision is the action with the best
downstream outcome, not the previous model's choice.

Programs, modes, thresholds, adapters and data-use policy are configured in Hanzo Cloud, where decisions mounts as
an app (HIP-0106), and signals arrive natively from product analytics (HIP-1190), insights and commerce (HIP-1220):
no export step between the data and the decision.

### §15 Training

Three stages on one checkpoint line:

- **A, decisions**: harness train splits, MASSIVE, CLINC150, XNLI, SST-5, large choice sets with
  hard negatives, order and label perturbations, agent control, coding decisions (file, symbol,
  test, failure category, continue, done, commit-ready), tool and skill selection. Outcome labels
  (tests, CI, diffs, accepted edits) are preferred over preferences.
- **B, adapters**: the encoder frozen or nearly so; sensors, time series, audio, image, video,
  graph, SysML, simulation. Public sources (HAR, CWRU, C-MAPSS, MIMII, UCR/UEA, Monash, NASA
  battery) under their licences.
- **C, programs**: whole programs with random and structured masks, dependencies, corrupted
  visible values, contradictions, missing evidence, `defer`, cross-modal cases.

Engineering data MAY be generated: requirements, components, interfaces, parameters, constraints
and verification cases, then controlled mutations with exact labels and expected decision
changes, compiled to programs. Multilingual training SHOULD target decision invariance across
languages (parallel examples, code-switching, low-resource sampling, balanced batches) and MUST
report per-language results. Training and evaluation data MUST stay separate; a test set is
never trained on.

Every build is barriered against every evaluation item: an equal content unit, an instance key, a
near duplicate (5-gram Jaccard ≥ 0.5) or contained spans exclude a training record. A stage MAY
name a benchmark's official train split in `official`; there only the item itself (equal unit or
key) is excluded, since a templated benchmark's train and test states are near by construction.
A result under `official` MUST say so and MUST name the baseline trained on the same split.

A specialist trained on another encoder (for example the English ModernBERT-large of the Laya
typed-decisions baseline) MAY serve as a teacher for the one line. It is never served (§2).

### §16 Training infrastructure

The trainer SHOULD span Hanzo's heterogeneous fleet (Metal, CUDA, ROCm) and MUST support resume,
versioned data, model revision tracking and optimizer-state recovery. A run MUST NOT be the only
copy of its own progress. A full stage-A run SHOULD start only when resume works, the CUDA and
ROCm builds are validated, and the stage-A mixture is built and versioned; a run on an obsolete
encoder is not the Kai lineage because compute was spent on it.

The trainer is local SGD with an outer Nesterov step: `train fit --listen` coordinates and trains,
`train join` adds a machine at any time, and deltas are summed in join order. It has run on Metal
(M4 Max), CUDA (GB10) and ROCm (Radeon 8060S) together. On a 2% pilot, CUDA and Metal agree on mean
validation accuracy (0.500 against 0.504 over 48 suites). A unified-memory worker MUST keep its
micro-batch within the OS memory guard: at half the budget, the ROCm worker was killed by
`earlyoom` within three rounds, while a quarter held.

### §17 API

`POST /v1/decisions`, with questions:

```json
{"model": "kai", "state": {}, "questions": {}}
```

or a program and evidence:

```json
{"model": "kai", "program": "agent.preflight@4", "evidence": [], "state": {}}
```

A response carries the decision id, program and version, model revision, typed answers,
probabilities, calibration revision, usage and trace link. The request is the Decisions shape Jev
clients already send, so there is no second endpoint.

### §18 Evaluation

Rehosted weights are not an improvement: until Kai's own training lands, its quality is its
source weights' quality, at runtime parity. Every gain names its source (runtime, architecture,
training, calibration, retrieval, modality, joint decoding). Baselines: Laya, Jev, Zen used as a
decision model, static rules, embedding retrieval. Axes are reported apart:

- quality: accuracy, ranking, ordinal error, Brier, log loss, ECE, abstention;
- generalization: held-out domains, languages, paraphrase, relabelling, reordering;
- cardinality: small, Banking77, CLINC150, 1K, 10K, 100K+, recall@K apart from reranking;
- robustness: permutation, irrelevant options, contradiction, missing evidence, OOD;
- runtime: CPU and GPU latency, throughput, memory, batch scaling, load time;
- joint decoding: decisions per pass, rounds, program consistency, constraint violations.

Documentation MUST NOT turn a target into a claim.

Measured on the frozen harness (`hanzoai/benchmarks` `decision/`, Laya's own builders, one
question set scored by one function for every backend). Kai is stage `a4`, `hanzoai/decision`
`train/stages/a4.json`, results `decision/results/kai-a4`:

| suite | Kai a4 | Laya | Jev |
|---|---|---|---|
| emotion | **0.938** | 0.595 | 0.603 |
| Banking77 (77) | **0.885** | 0.425 | 0.835 |
| phishing | **0.990** | 0.983 | 0.900 |
| toxicity | **0.833** | 0.530 | 0.662 |
| RAG relevance | **0.672** | 0.625 | 0.620 |
| routing | **1.000** | 0.639 | 0.977 |
| AG News | 0.935 | **0.950** | 0.860 |
| email spam | 0.995 | **0.998** | 0.978 |
| support triage | 0.453 | **0.502** | 0.365 |
| jailbreak | 0.907 | 0.705 | **0.940** |
| MASSIVE, 51 languages | 0.858 | 0.382 | **0.890** |
| typed decisions | 0.523 | **0.766** (Laya's typed checkpoint) | 0.736 |

Kai leads 6 of 12 suites. It trained on 638 of typed decisions' 1,185 train records (the near rule
dropped the rest), where Laya's typed checkpoint trained on all of them.

#### §18.1 Kai in the loop

Enso SHALL support the study: does Kai remove generative compute at equal task success? Baseline
B0: Zen does the work and its own control. Also B1 static routing, R1 Zen as its own router, and
cumulative Kai conditions K1 model routing, K2 + context, K3 + tools and skills, K4 + progress
and completion, K5 the full plane. Per successful task: GPU-seconds, prompt and generated tokens,
KV-cache GB-seconds, peak VRAM, latency, model calls, agent steps, energy where measured, cost;
`C_success = Σ C_task / successful tasks`. Routing regret against the cheapest successful model:
`R = C_Kai − C_cheapest`.

### §19 Observability

Every material decision SHOULD record decision and trace id, program and version, model revision,
evidence references, answer, distribution, calibration revision, latency, device, usage, mode,
override and downstream outcome: the record that debugging, calibration, training, replay and cost
attribution all read.

### §20 Deployment

Kai SHOULD run self-hosted: Hanzo Cloud, a customer cloud or cluster, a private GPU fleet,
on-premises, disconnected, or at the edge, as hardware allows. A conforming deployment MUST NOT
require sending evidence to a third-party model provider.

### §21 Conformance

A conforming system: treats Kai as a decision model, never an authority; types every decision;
keeps uncertainty; supports `defer`; cannot let Kai weaken policy; keeps provenance sufficient for
the application; versions programs; records the model revision in every material package; shares
one encoding across a state's decisions; needs no generative call per bounded decision; serves
`/v1/decisions`. Multimodal and joint decoding MAY be staged while this HIP is Draft.

### §22 Status

Descriptive, not normative, as of `hanzoai/decision` main `bcdc01d`.

- **Landed**:
  - Decision Programs and Packages, what-flips analysis, SysML v2 import, the engineering
    knowledge graph, a cited JLTV powertrain trade, and refinement passes;
  - the Laya baseline served natively (21 states, 108/108 labels at parity);
  - the heterogeneous resumable trainer (§16);
  - the stage-A corpus and its barrier, with `official` splits (§15);
  - trained Kai checkpoints: stage `a4` beside Laya and Jev (§18).
- **In progress**:
  - stage `a5` (from `a4`, all three backends): typed decisions from its official split, more
    AG News, MASSIVE, jailbreak, email spam and support triage;
  - `t1`, a typed-decisions teacher (§15);
  - evidence adapters, the joint decoder, the Enso study.
- **Not claimed**:
  - Kai ahead of Laya and Jev on every suite;
  - multimodal accuracy;
  - Enso savings;
  - any end-to-end engineering or acquisition result.

## Rationale

One large model can imitate every role here. It is not therefore the cheapest, most testable,
most controllable or most auditable way to fill them. Hanzo splits intelligence into perception,
retrieval, forecasting, decision, generation, mathematics, policy and execution, and composes them
through Enso and Hanzo Decision, so generative compute is spent where generation is the work.

The program tests four hypotheses, each unproven until measured: **H1** bounded decisions cost
far less on a typed decision model than through generative routing, at equal task success;
**H2** retrieval plus independent option scoring removes the cardinality limit of prompt-packed
decision models; **H3** encoding evidence once and resolving variables jointly lowers cost as
decisions per state grow; **H4** masked parallel prediction with dependency-aware refinement
yields consistent program state without serial decision calls.

Observe everything. Encode once. Decide in parallel. Refine uncertainty. Enforce constraints.
Keep provenance. Escalate when needed. Generate only when generation is the work. Zen generates,
Enso routes, Kai decides.

## Security Considerations

Kai's output is untrusted probabilistic computation until the surrounding program accepts it.
Anything security-relevant stays behind deterministic policy (§10), which Kai can tighten and
never loosen. Evidence keeps its provenance, so a decision shows which sources it rested on and
an injected or unsigned source can be weighed or refused. A deployment SHOULD be able to restrict
evidence sources, external providers, data egress, model revisions, programs, action classes and
tenant scope. Kai MUST NOT replace human acquisition or approval authority, and readiness claims
MUST rest on demonstrated integrated capability, never on the architecture described here.

## References

- HIP-0004 LLM gateway; HIP-0010 MCP; HIP-0043 inference engine; HIP-0113 engine provider runtime;
  HIP-0106 the cloud plugin contract; HIP-0124 bring your own provider; HIP-1190 product analytics; HIP-1220 commerce;
  HIP-1322 skills; HIP-1330 the agent loop.
- `hanzoai/decision` `LLM.md` at `d419552`: architecture, crates, models, training.
- Baselines: Laya 0.3.20 (typed decision models and runtime); Jev (typed decision API).
- Data: mmBERT; MASSIVE; CLINC150; XNLI; SST-5; UCR/UEA; Monash; CWRU; NASA C-MAPSS; MIMII;
  NASA battery data.

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
