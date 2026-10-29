---
hip: "0007"
title: Active Inference — Local Beliefs, World Models and Planning
author: Hanzo AI Team
type: Standards Track
category: Core
status: Final
implementation-rust: partial
created: 2024-12-20
requires: HIP-0019, HIP-0043, HIP-0111, HIP-0135, HIP-0510, HIP-0522, HIP-0526, HIP-1332, HIP-1333, HIP-1334
---

# HIP-0007: Active Inference — Local Beliefs, World Models and Planning

## Abstract

This HIP specifies Hanzo's active-inference primitive: maintain beliefs about a
partially observed world, predict consequences, and infer policies that balance
preferred outcomes with information gain. **Sekai models the world; Kai decides;
Enso routes; Zen generates; deterministic policy governs.** World modeling and
planning use `/v1/worlds`; bounded judgments remain at `/v1/decisions`.

The mathematical reference is the `hanzo-active-inference` crate in
[hanzoai/ml](https://github.com/hanzoai/ml), with the native host boundary
`hanzo-worlds` in [hanzoai/engine](https://github.com/hanzoai/engine).
The categorical core implements exact finite-state inference and finite-horizon
open-loop planning. Sparse world-state scheduling, learned latent dynamics,
capability adaptation and domain qualification are separate conformance profiles.
A runtime MUST declare which profiles it actually implements.

`Final` settles this specification; it does not assert that every profile is
implemented, that a crate has been published, or that an application is qualified
for physical or business execution. The implementation matrix in §1 is part of
the specification, not an implied deployment claim.

## Motivation

An agent usually needs a sufficient local belief for a decision, not an exact
reconstruction of the entire world. Re-encoding all observations and updating all
entities after each event wastes compute and hides what is unknown. Treating a
plausible generated explanation as a belief update also loses the distinction
between an observation, a prediction and an authorized action.

The primitive must therefore support bounded local work, missing modalities,
uncertainty, prediction error and explicit abstention. It must make information
seeking mathematically meaningful, preserve the evidence behind a decision, and
specialize cheaply without giving a learned model authority over safety or money.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are interpreted as in
RFC 2119 and RFC 8174 when capitalized. Logarithms are natural; information and
free-energy terms are in nats unless a response declares another unit.

### §1 Profiles and implementation boundary

| Profile | Conformance scope | Reference implementation boundary |
|---|---|---|
| `categorical-core-v1` | §3–§6: stochastic tables, filtering, both EFE decompositions, policy posterior, masks and expected-count learning | Implemented in the proposed public ML source; bounded local factor, CPU f64 |
| `native-host-v1` | §2 and §8: host-owned model, preferences, habits and admissibility; no execution authority | Implemented in the proposed native `hanzo-worlds` library; not mounted in the production HTTP server |
| `world-runtime-v1` | §7–§9: tenant world, persistent events/beliefs, bounded propagation, consistent snapshots and traces | Partial experimental world API; neighbor invalidation is not a completed propagation scheduler |
| `latent-world-v1` | §10: action-conditioned latent prediction, uncertainty and modality contracts | Synthetic multimodal training/evaluation scaffold; approximate Gaussian planning is not categorical EFE |
| `capability-v1` | §11: representation-bound adaptation, protected evaluations and controlled publication | Frozen-feature readout experiment; full domain-adapter serving and publication are not complete |
| `domain-qualified-v1` | §12–§13: application-specific gates, external authorization and execution safety | Not established by mathematical or synthetic smoke tests |

The public reference snapshots are ML commit
[`9775f7482747769737ce18ce41cbb7dd6ce4c989`](https://github.com/hanzoai/ml/tree/9775f7482747769737ce18ce41cbb7dd6ce4c989/hanzo-active-inference)
and native engine commit
[`b32563d8cbba510720ff3efde6c7bec1c87e15e3`](https://github.com/hanzoai/engine/tree/b32563d8cbba510720ff3efde6c7bec1c87e15e3/hanzo-worlds).
They are reviewable source, not evidence of a released registry dependency or a
running public world service. An independent implementation needs no private
repository, model weights, service credential or managed training allocation to
implement and test the categorical profile.

An implementation MUST report profile ids, model/representation revision,
algorithm, approximation, limits and unsupported operations. It MUST NOT report
an optional profile as supported because its interface exists. Unsupported
operations MUST fail explicitly, rather than returning simulated success.

### §2 Ownership and composition

| Component | Owns | Does not acquire from this HIP |
|---|---|---|
| Sekai/world runtime | Observation likelihoods, belief state, dynamics, counterfactual rollouts and policy inference | Permission to execute a recommendation |
| Kai / HIP-1332 | Typed choice, predicate, score, defer and Decision Programs | Ownership of every temporal forecast or world state |
| Enso / HIP-0510 | Model/provider selection and compute allocation within access and SLO limits | Authority to bypass a denied tool, sensor or action |
| Zen | Generative proposals, extraction and explanations | Authority to invent measured scores or counterfactual results |
| Graph / HIP-0522 | Entity/relation identity and derivation edges | A second copy of raw source data in every belief |
| Semantic memory / HIP-0526 | Source-to-assertion provenance and retrieval inputs | Proof that a retrieved assertion is true |
| Train / HIP-1333 | Training jobs, adaptation, protection and artifacts | An independent world-specific training control plane |
| Research / HIP-1334 | Dataset, Artifact, Run, Evaluation, Gate, Comparison and Claim | Permission to promote without a passed gate |
| Deterministic policy / executor | Admissibility, consent, constraints, approvals and execution | A learned substitute for hard constraints |

A host MUST bind an inference call to an authenticated tenant and world revision.
The native library MUST accept those resolved values from its host; it MUST NOT
open an unauthenticated listener or infer identity from caller-supplied prose.
A caller MAY propose actions. The host owns the admissibility mask, preference
revision and policy prior; a request MUST NOT silently overwrite them.

### §3 Generative model and belief state

For a categorical local factor, let `s` denote state, `o` outcome, `a` action and
`pi` an explicitly enumerated finite action sequence. Let:

```text
A[a][o][s]       = P(o | s, a)              observation likelihood
B[a][s_next][s]  = P(s_next | s, a)        controlled transition
C[o]            = P_preferred(o)           preference distribution
D[s]            = P(s_initial)            initial belief
E[pi]           = P_prior(pi)              habit/policy prior
q[s]            = Q(s)                    current belief
gamma           >= 0                      policy precision
```

Every A and B column MUST be finite, nonnegative and sum to one within a declared
numerical tolerance. Beliefs and E MUST be normalized. C MUST be strictly positive
and normalized in `categorical-core-v1`; structural prohibitions belong in hard
masks, not `log(0)` preference tricks. Actions, states, outcomes and policies MUST
share a registered schema and stable ordering. Ragged arrays, unknown indices,
negative probabilities and non-finite inputs MUST be refused.

A model manifest MUST distinguish the generative model from the belief it is
currently applied to. It MUST identify the state/outcome/action schema and units,
likelihood/transition revisions, preference revision and supported horizons.
A generative parameter change, a preference change and new observational evidence
are distinct revisions; none may be hidden as an ordinary event replay.

The reference core limits one factor to 256 states, 256 outcomes and 64 actions,
and a call to 256 supplied policies with horizon at most 16. Its normalization
tolerance is `1e-9`. These are implementation limits, not mathematical constants;
other limits MUST be advertised and enforced before unbounded work is allocated.

### §4 Prediction, inference and variational free energy

Prediction is separate from conditioning on a current observation:

```text
q_pred(s_next) = sum_s B[a][s_next][s] q(s)
Z(o,a)        = sum_s A[a][o][s] q_prior(s)
q_post(s)     = A[a][o][s] q_prior(s) / Z(o,a)
```

`observe` MUST NOT apply a hidden extra transition. A caller observing the result
of an action first predicts through B, then conditions through A. A current-time
measurement conditions its current prior directly. The host MUST distinguish
these two cases in its event/action schema.

For a candidate posterior Q, the variational free energy is

```text
F(Q) = sum_s Q(s) [log Q(s) - log q_prior(s) - log A[a][o][s]]
     = KL(Q || P(s | o,a)) - log P(o | a).
```

At the exact Bayesian posterior, `F* = -log Z`. A zero-mass Q term contributes
zero; positive Q mass outside the joint support has infinite F. A wire response
MUST represent that condition as a typed support error, not non-finite JSON.
A zero-evidence observation MUST fail or enter an explicitly declared robust
outlier model. It MUST NOT be silently normalized into a confident belief.

Bayesian posterior updates MAY happen on each observation. This does not authorize
production gradient updates to encoders or learned dynamics (§11). Approximate
inference MUST name its approximation, convergence criterion and residual work.

### §5 Expected free energy and policy inference

For each future step of a supplied policy, predict `q_pi(s)` through its selected
transition and form `q_pi(o) = sum_s A[a][o][s] q_pi(s)`.
The categorical profile minimizes:

```text
risk        = KL(q_pi(o) || C(o))
ambiguity   = sum_s q_pi(s) H(A[a][:][s])
extrinsic   = -sum_o q_pi(o) log C(o)
information_gain = H(q_pi(o)) - ambiguity
G_step      = risk + ambiguity
            = extrinsic - information_gain
G(pi)       = sum_future_steps G_step(pi).
```

Positive information gain reduces the cost being minimized. An implementation
MUST NOT add positive curiosity as a penalty while claiming this objective.
It MUST return both decompositions and verify their equality within a declared
tolerance. Expected observation ambiguity, state information gain, parameter
information gain and ensemble variance MUST NOT share an unlabeled field.

For nonnegative finite precision, policy inference is

```text
Q(pi) = normalize(allowed(pi) * E(pi) * exp(-gamma * G(pi))).
```

Normalization MUST be numerically stable. A disallowed policy has exactly zero
posterior mass. If no allowed policy has positive prior, the result is `defer` or
a typed refusal; there is no fallback to an unauthorized action. At gamma zero,
Q reduces to the prior restricted to allowed policies. Selection MUST have a
specified tie rule; the reference chooses the first maximum. A response MUST
retain the selected candidate's own terms, not the last candidate evaluated.

The step terms are exact for the declared predictive marginals. Their open-loop
sum does not condition on every possible future observation history and is not
the joint information gain of the entire future trajectory.

The profile is open-loop: each supplied action sequence is evaluated without a
future observation-contingent branch. Its sum is not a full closed-loop policy
tree. A closed-loop extension MUST represent future observations and conditional
actions explicitly and state its pruning/approximation. It MUST NOT repeatedly
count the same evidence as independent information gain. Unequal horizons MUST
be declared; equal-length candidates SHOULD be used when comparing total scores.

The public information-seeking fixture has `q=[0.5,0.5]`, identity B for both
candidate actions, `C=[0.5,0.5]`, `E=[0.5,0.5]` and gamma 4. Action 0 has identity
A; action 1 has every A entry 0.5. Its expected values are:

| Action | Risk | Ambiguity | Extrinsic | Information gain | G | Policy probability |
|---|---|---|---|---|---|---|
| Informative | 0 | 0 | ln(2) | ln(2) | 0 | 16/17 |
| Uninformative | 0 | ln(2) | ln(2) | 0 | ln(2) | 1/17 |

Masking the informative action MUST give it probability zero and the other action
probability one. Masking both MUST refuse. Conditioning the identity likelihood
on an impossible outcome MUST refuse. These fixtures test epistemic behavior and
safety independently of any model checkpoint or language understanding.

A parameter-epistemic extension MAY maintain a posterior over parameters or model
hypotheses theta. It MUST declare the joint predictive distribution, posterior
update and estimator. A consistent joint objective is

```text
G_extended = -E_q(o|pi) log C(o) - I_q((s,theta); o | pi)
I_q((s,theta); o | pi) = I_q(theta; o | pi)
                       + E_q(theta) I_q(s; o | theta, pi).
```

The parameter term is
`E_q(o|pi) KL(q(theta|o,pi) || q(theta))`: posterior relative to prior after
an outcome. An implementation MUST NOT add unconditional state and parameter
information gains as if they were independent; their shared information can be
double-counted. With fixed theta this reduces to the categorical state term. The
core MUST NOT claim parameter information gain from state information gain alone.
Cost, latency, energy or privacy penalties MAY be added as a separately named
objective with declared units and weights. The response MUST preserve G and the
additional terms separately; the result MUST NOT be labeled unmodified EFE.

### §6 Learning categorical parameters

Positive Dirichlet pseudo-counts `alpha[a][o][s]` and
`beta[a][s_next][s]` define A and B by column normalization. For a known previous
belief, action and resulting observation, compute the adjacent-state joint:

```text
xi(s_next,s) proportional to
    q_previous(s) B[a][s_next][s] A[a][o][s_next]
q_post(s_next) = sum_s xi(s_next,s)
alpha_new[a][o][s_next] = alpha_old[a][o][s_next] + eta q_post(s_next)
beta_new[a][s_next][s]  = beta_old[a][s_next][s] + eta xi(s_next,s).
```

The learning rate eta MUST be finite and positive. A failed update MUST leave the
old value unchanged; normalized tables and counts MUST remain finite and valid.
The added total mass to each selected count tensor is eta. Unselected actions
MUST remain unchanged. This is an expected-count update using the current model;
it is not a claim of globally exact structure learning or parameter planning.

C and hard constraints MUST NOT be learned from the frequency of observed harmful
outcomes. Preference learning, when enabled by application policy, MUST be
versioned separately from non-negotiable constraints and retain consent/provenance.

### §7 Sparse event-driven world runtime

A world is an authenticated namespace for a versioned generative model, entity
and factor identities, timestamped beliefs, observations/actions and derivation
references. A world implementation MUST keep observation time distinct from
ingest time and model/graph validity time. Evidence retains source, units, frame,
quality, missingness, sensor/encoder revision and allowed use where applicable.

An observation MUST NOT be stored as an established fact merely because an
extractor produced it. Predicted relations and counterfactuals remain hypotheses,
with the supporting evidence and uncertainty retained. Contradictory observations
MUST remain distinguishable; averaging them MUST NOT erase their provenance.

Each accepted event MUST have a tenant/world-scoped idempotency key and a digest.
Replaying the same key and content returns the original result. Reusing the key
with different content is a conflict. State and deduplication records MUST commit
atomically. A late event MUST follow a declared replay, historical-snapshot or
refusal policy; it MUST NOT silently replace a newer live belief.

Only affected factors, their necessary separators and decision-dependent readers
SHOULD be scheduled. Expensive encoders SHOULD run once per changed content and
representation revision; feature caches MUST include tenant and data-use scope.
A transition cache MUST also include action, model revision and relevant time.

The scheduler MUST enforce finite node/edge/message/iteration/time budgets and
return updated ids, invalidated ids, deferred work, snapshot revision and whether
the response is complete. A bound in neighborhood size is not a bound in whole
world size: indexed lookups and dependency maintenance costs MUST be measured.
No implementation may claim global consistency from a truncated local update.

Invalidation and recomputation are distinct operations. A persistent queue MUST
retain deferred work with a resumable cursor or deterministic replay path. A
priority function MAY use surprise, belief uncertainty, causal reach, decision
relevance and deadline. It MUST account for queue age so unrelated traffic cannot
starve a safety-relevant dependency indefinitely. Concurrent updates MUST use a
snapshot or revision check; a plan cannot mix incompatible factor revisions.

Loops require a declared message schedule, damping/convergence test and a residual
bound or incompleteness marker. Exact inference on one factor does not establish
exactness on a loopy graph. A plan depending on stale or deferred factors MUST
report them and defer where its application gate requires complete evidence.

Graph identity and derivation use HIP-0522; extracted assertions use HIP-0526.
The world runtime SHOULD keep posterior/model state and references to those
sources, not create another authoritative document or audit store.

### §8 World API and native host contract

All world operations are under `/v1/worlds`, with model selection in data or
registered world configuration. There is no model-branded URL prefix. The host
MUST authenticate and resolve tenant/world identity before native inference.

| Method and path | Contract | Experimental reference boundary |
|---|---|---|
| `POST /v1/worlds` | Create a tenant-owned world bound to a registered model and domain | Implemented for declared fixtures |
| `GET /v1/worlds/{id}` | Read world identity and model/domain metadata | Implemented subset |
| `POST /v1/worlds/{id}/events` | Ingest one bounded observation/action event and return affected belief state | Observation fixture implemented; generic action/time schema and queue completion are incomplete |
| `GET /v1/worlds/{id}/beliefs/{entity}` | Read belief and provenance at a stated revision | Current fixture belief implemented; historical snapshots are not established |
| `POST /v1/worlds/{id}/rollouts` | Predict consequences without executing actions | Approximate latent fixture implemented |
| `POST /v1/worlds/{id}/plans` | Rank candidate plans under the declared objective and external constraints | Gaussian surrogate fixture implemented; not exact EFE |
| `POST /v1/worlds/{id}/inference` | Filter/plan through the registered categorical host model | Two-state simulation bridge implemented; general native host library exists |

The table defines operation ownership, not a promise that every deployment serves
all rows. A deployment MUST publish a versioned schema describing exactly its
supported fields, limits and errors. A client MUST NOT send a generic-profile
field to a fixture server and assume that it was used. Unknown control fields
MUST be rejected; unsupported operations MUST be explicit.

The native `WorldInference::infer` call takes belief, optional current observation
`(likelihood_action, outcome)`, candidate action sequences, and host-supplied
habits/admissibility. Its return includes an optional filtered posterior, policy
probabilities, selected index, EFE terms and `execution_authorized: false`.
The reference HTTP fixture currently exposes belief and policies only; callers
MUST NOT infer support for native observation filtering from the HTTP route name.

Example for the declared two-state simulation fixture only:

```json
{"belief": [0.8, 0.2], "policies": [[0], [1]]}
```

Its registered actions hold or swap state; its preference distribution is `[0.9,
0.1]`. The caller supplies neither A/B/C nor an execution authorization. A generic
world registry, action schema, preference revision and artifact installation are
host integrations, not undocumented extra request fields.

Errors MUST distinguish malformed input, unsupported profile, unknown or
unauthorized world, conflicting event/revision, zero evidence, exhausted budget,
unavailable backend and no admissible policy. Cross-tenant unknown and forbidden
world lookups SHOULD have indistinguishable external responses. A shared-key,
trusted-header development server is not a multi-tenant authentication service.
The unversioned `/plan/efe`, `/trace/explain` and `/interop/hstp/send` examples are
not alternative public routes specified by this HIP.

### §9 Traces, explanations and hierarchical control

A world-runtime plan trace MUST bind its tenant, request, world/snapshot revision,
model/representation/calibration/preference revisions, observed evidence, declared
objective, policy prior/precision, admissibility decisions, candidate terms,
selected candidate, budgets, incomplete dependencies and execution mode.
A library returning mathematical terms alone does not implement this trace profile.

A counterfactual MUST identify its intervention, starting snapshot, generative
model, horizon, predicted outcome and uncertainty. An alternative that was not
rolled out is an untested hypothesis, not a measured counterfactual. Zen MAY
explain computed traces but MUST NOT invent scores, flip conditions or solver
verdicts. Explanations and source data MUST obey the same access/retention policy.
Decision Packages and refresh semantics compose with HIP-1332; derivation edges
compose with HIP-0522 instead of introducing another provenance subsystem.

Hierarchical control MAY compose macro subgoals with local micro plans. Each
level MUST declare its action abstraction, clock/horizon, termination condition,
remaining resource budget and revision bindings. Replanning occurs on changed
evidence or violated assumptions. An abstract macro action MUST resolve through
the same deterministic constraints and executor as its concrete micro actions.
No level inherits permission merely because its parent selected a subgoal.

A plan MUST be treated as shadow, advisory or eligible-for-external-authorization.
Even the last mode is not execution. Policy joins on `ALLOW < ASK < DENY` as in
HIP-1332; a learned score MUST NOT weaken a denial. Enso MAY allocate additional
compute or sensing only among authorized candidates within the remaining budget.
Currency, latency and privacy ceilings MUST be enforced as hard admission limits
where policy requires them, not merely as costs in a learned score.

When routing uses market prices, the trace MUST bind the price/quote revision,
units and expiry separately from G. A router MAY minimize a declared score such
as `G + lambda_cost * estimated_cost + lambda_latency * estimated_latency` over
admissible providers. Exchange rates between nats, currency and time are policy
configuration, not a derived physical identity. Market supply/demand and price
updates remain the market's responsibility (HIP-0008); planning does not create
spending authority or replace its settlement/accounting rules.

### §10 Multimodal and predictive latent world models

A modality adapter MUST bind raw schema, units, timestamps, frame and encoder
revision to a declared representation. Image, video, audio, text, telemetry,
spatial observations, tables and graph events MAY be supported independently.
Missingness is an input condition, not a synthetic zero-valued observation.
Embeddings from unrelated encoders MUST NOT be assumed aligned because their
vectors have been truncated to the same length.

A latent world model SHOULD predict action-conditioned future representations
and observation likelihoods on the decision-relevant subgraph. Its manifest MUST
state whether it is learned from observations only, actions/outcomes, supervised
simulator state, or a combination. The training objective MUST distinguish
representation learning, transition prediction, reconstruction and calibration.
A joint-embedding objective MUST specify how representation collapse is prevented.

Frozen encoders plus small modality/dynamics adapters SHOULD be the first
cost-controlled baseline. Larger unified encoders or video teachers require a
measured gain on the same held-out decision tasks. Encoder caches, event-triggered
updates and lower-dimensional local predictors SHOULD be benchmarked before
continuous global reconstruction is introduced.

A distributional ensemble MAY estimate aleatoric variation and epistemic
uncertainty separately. Ensemble disagreement is an estimator, not proof of
calibration. A continuous implementation MUST state covariance structure,
propagation method, process noise and observation likelihood. Diagonal variance
accumulation without Jacobian transport MUST be labeled approximate.

The Gaussian objective `distance-to-target + variance + cost` is a risk surrogate.
It MUST NOT be labeled EFE unless a declared generative/recognition model derives
the claimed extrinsic and epistemic terms. Continuous variational/Laplace,
particle or Hamiltonian Monte Carlo methods MAY be independent backends; exact
categorical filtering does not require Hamiltonian dynamics or a language model.

Object-centric mixture models, Bayesian model reduction and renormalizing
hierarchies are research-backed options (§15). A small MLP regime head alone is
not evidence of any of those algorithms. Structure growth/pruning MUST retain
model-selection evidence and test forgetting, transfer, locality and data cost.

A structure-learning extension SHOULD update sufficient statistics only for the
affected object/relation hypotheses, grow a model on calibrated novelty or a
specified evidence criterion, and prune/merge by a declared model-evidence or
complexity criterion. It MUST retain the prior, evidence contribution, candidate
model revisions and decision-relevant regressions. It MUST NOT claim Bayesian
model reduction from arbitrary parameter deletion or a fixed-size neural adapter.

A renormalizing hierarchy MUST declare its spatial grouping, state/path
abstraction, temporal scale and mappings between levels. Coarse predictions MUST
be evaluated against the fine-level outcomes they summarize; macro actions must
remain realizable by admissible lower-level actions. Changes to these mappings
invalidate dependent caches and plans. These are extension requirements, not
algorithms already implemented by the finite-state core or Gaussian fixture.

### §11 Capability specialization and training

A capability SHOULD adapt the smallest sufficient part of a pinned base:
readout/calibration first, then a transition/observation adapter or low-rank update
when target evaluations justify it. A checkpoint per user is not required.
The artifact MUST bind tenant/scope, route/question or dynamics role, base digest,
representation/schema revision, artifact ABI, calibration, training provenance,
protected suites and evaluation/gate references. A mismatch MUST refuse loading;
one tenant's capability MUST NOT answer another tenant's request.

Observation-driven posterior or categorical count updates (§4, §6) differ from
neural gradient learning. Production request handling MUST NOT synchronously
change encoder or dynamics weights. Eligible captures go to a purpose/consent-
controlled buffer, then offline training, evaluation, shadow and controlled
promotion under HIP-1332, HIP-1333 and HIP-1334. This is the applicable integration
rule even where a personalization example illustrates immediate adaptation.

For readout training, captures MUST name the exact unfused feature representation;
a posterior that has fused earlier observations is not interchangeable with an
encoder feature from one event. Dataset splits MUST separate entire relevant
trajectories, entities, users or time blocks before feature extraction/fitting.
Calibration and thresholds use validation only. Test/evaluation-only material MUST
NOT be used for training, curriculum selection or prompt optimization.

Managed jobs use `/v1/train`, never a parallel `/v1/worlds/train` control plane.
A world-model backend MUST register supported objectives and adaptation modes and
reject unsupported jobs. This HIP does not assert that a particular managed
executor already supports latent-world objectives. Artifact publication MUST pass
prospectively frozen target and preservation gates from HIP-1334. Neither a
successful optimizer exit nor preservation alone establishes target improvement.

A content digest detects a changed artifact; it is not an authentication signature.
Distributed tensor artifacts MUST use the safe format required by HIP-0019,
with immutable manifests and host-controlled locations. A local weights-only
research checkpoint is not a claim of deployment-format conformance. Applying a
capability MUST NOT change policy, permissions or preference constraints.

### §12 Evaluation, compute and claims

Every claimed result MUST have a reproducible command/configuration, source and
artifact revisions, data/split lineage, environment, seed, measured resource use
and raw per-item outcomes. Research objects and claims follow HIP-1334. Synthetic
fixtures, supplied exact models, inferred observation state and real-world data
MUST be separate conditions. A source-review test is not a released-service test.

| Area | Required measurements or checks |
|---|---|
| Mathematics | VFE bound/tightness, both EFE identities, informative-action fixture, policy normalization/masks, impossible observations, invalid shapes and count conservation |
| Prediction | Held-out one/multi-step error, predictive NLL, coverage and calibration, persistence and cheap local baselines |
| Perception | True-state versus encoded-observation results; missing/noisy/conflicting modality and stale-sensor slices |
| Decisions | Accuracy, per-class precision/recall and support, expected regret, constraint violations, defer/coverage and outcome calibration |
| Information seeking | Matched pragmatic-cost cases where information matters; state and parameter epistemic ablations kept separate |
| Locality | Nodes/edges/messages touched, queue age, deferred work, residuals, consistency and cost versus a full-update reference |
| Runtime | Cold/warm/cache-hit conditions, p50/p95/p99, concurrency/queueing, memory, device/precision and CPU/GPU or energy cost |
| Adaptation | Target gain, protected-capability regression, calibration, cross-regime transfer, forgetting and rollback |
| Trace | Selected-score consistency, source/revision completeness, replay and computed counterfactual fidelity |
| Domain | Task-specific safety constraints, authorization refusals, OOD behavior and fail-safe operation |

A Kai comparison MUST identify its actual model revision and distinguish HTTP
request latency from an in-process kernel call. A supplied-model planner and a
language reader given rules in text have different information/representation
conditions; their score is a task result, not general decision superiority.
Cache reuse, option order/labels, warmup, compute budgets and failure handling MUST
be recorded. Undefined precision when no positives were predicted MUST be reported
with predicted support, not presented as evidence of zero false positives.

A comparison SHOULD include learned world model alone, Kai alone, and composed
world-model-plus-Kai under matched evidence and compute ceilings. Confidence
intervals or uncertainty estimates SHOULD respect trajectory/entity dependence.
Numerical equality across devices MUST be tested rather than inferred from a
fixed seed. An exactness claim MUST identify what is bit-identical and what merely
falls within a tolerance.

Compute starts with a bounded local smoke run and a profiled pilot. CPU is a
sufficient reference for the categorical core. A large GPU allocation, a fixed
multi-GPU training duration or expected percentage gain is not a requirement or a
result. A job MUST enforce its step/time/spend cap and record actual completion.
The smoke run MUST produce an artifact and independent held-out evaluation;
training MUST NOT be reported complete merely because a job was submitted.

### §13 Domain authorization and failure boundaries

A mathematical or synthetic profile grants no execution authority. The reference
native response always has `execution_authorized: false`. Experimental drone and
business worlds MAY ingest observations and predict, but MUST NOT use an
unqualified fixture to authorize physical or business actions.

For drones/robots, a domain-qualified executor MUST independently enforce sensor
freshness, coordinate/frame validity, flight/operating envelope, collision and
geofence constraints, communications-loss handling and a deterministic fail-safe.
A plan cannot override operator control or directly drive an actuator through the
world inference API. The qualification report MUST state its simulated and real
operating conditions and explicit out-of-domain behavior.

For businesses, the executor MUST enforce identity, role, consent, spending and
transaction limits, suppression/opt-outs where applicable, approval requirements,
idempotency and audit/compensation behavior. A predicted benefit is not permission
to send a message, place an order, move money or change an account. Irreversible
actions require the authorization the application policy specifies.

A candidate needing unauthorized sensing is inadmissible even if its information
gain is high. Loss of evidence, all-masked policies, exhausted budgets, stale
revision bindings and backend failure MUST lead to a declared defer/refusal or
qualified fail-safe, never fabricated certainty or implicit execution.

### §14 Interoperability and release conformance

IEEE 2874-2025 Spatial Web interoperability MAY be implemented as a negotiated
adapter over authenticated world/entity/event references. Such an adapter MUST
name the exact standard/profile, schema version, identity/credential mapping and
conformance tests. A YAML object with spatial labels does not establish HSML/HSTP
conformance. TEE, differential privacy, encrypted computation and signatures each
require their own stated threat model and evidence; none substitutes for the
others. This HIP requires no external interoperability server to run its core.

A release declaration MUST include supported profiles and revisions, public
conformance fixtures, local reproduction commands, known limits and qualification
scope. Native core, HTTP mounting, artifact publication and domain authorization
are separately verifiable release gates. Publishing a math crate does not mount a
service, and deploying a service does not qualify an application.

The native release order is canonical ML math crate, then engine consumer against
the published dependency, then host/schema integration and its profile tests.
A coordinated local Cargo source patch is valid source-review evidence but MUST
NOT be presented as verification of the registry release or its lockfile.
The source fixtures can be reproduced without publishing either crate:

```sh
git clone https://github.com/hanzoai/ml.git ml
git -C ml checkout 9775f7482747769737ce18ce41cbb7dd6ce4c989
cargo test --manifest-path ml/Cargo.toml -p hanzo-active-inference
git clone https://github.com/hanzoai/engine.git engine
git -C engine checkout b32563d8cbba510720ff3efde6c7bec1c87e15e3
cargo test --manifest-path engine/Cargo.toml -p hanzo-worlds \
  --config "patch.crates-io.hanzo-active-inference.path=\"$(pwd)/ml/hanzo-active-inference\""
```

No required conformance test may depend on a private repository or private model.

### §15 Research basis and extension boundaries

The following are primary research inputs, not implementation or performance claims:

- **Discrete active inference and pymdp:** finite-state belief/policy inference and
  the pragmatic/epistemic decomposition used by the categorical profile [1–3].
- **AXIOM:** object-centric, expanding mixture-based models and sparse interactions;
  useful for cheap local structure learning without assuming a giant dense model [4].
- **Scale-free active inference:** renormalizing generative models, paths as latent
  variables and spatial/temporal hierarchy; a principled extension beyond flat factors [5].
- **Active reasoning:** information gain about model hypotheses and Bayesian model
  reduction; an extension distinct from state information gain in the core [6].
- **Predictive latent models:** V-JEPA 2, LeWorldModel and Dreamer support separate
  comparisons of frozen features, compact predictive latents and imagined control;
  none makes an arbitrary distance-plus-variance objective exact EFE [7–9].
- **Temporal scientific graphs:** Hakken motivates time-split relation forecasting
  and hypothesis explanations. A predicted relation is not an observed fact [10].
- **Multimodal representations:** Qwen3 Embedding, SigLIP 2 and Qwen3-VL Embedding
  are candidate frozen encoders; their model-specific revisions, licenses, memory,
  alignment and end-to-end value must be evaluated rather than assumed [11–13].

## Rationale

Exact small categorical factors make the objective independently testable and
provide a cheap CPU reference. Local graph work is bounded and explicit instead
of hiding an expensive whole-world pass. Learned representations extend the
observation space without changing decision or authorization semantics.

Prediction, judgment, routing, language and execution stay separate because each
has a different correctness test. The shared contract permits composition: a
world model supplies predicted consequences and uncertainty, Kai reads bounded
judgments, a solver checks hard constraints, Enso budgets authorized compute and
Zen explains the actual trace. A single language model is not required to play all
five roles.

The specification names approximation and incompleteness instead of treating
confidence as knowledge. Gradients, Bayesian updates, preference changes and
permission changes are different operations, so a useful learning loop cannot
silently become an authority-escalation loop.

## Security Considerations

Tenant/world/model/feature-cache keys MUST include the authenticated scope; an
untrusted body/header MUST NOT select another tenant's capabilities. Hosts MUST
strip caller-controlled trusted identity headers. World reads, trace retrieval,
training captures and artifact access require independent scope checks.

Events and assertions are untrusted data. Prompt injection in a document, sensor
label, graph edge or generated explanation MUST NOT alter policy, tool permission,
artifact paths or executor identity. Replays, conflicting ids, stale snapshots,
malformed distributions, unbounded graphs and poisoned observations require the
atomicity, validation and finite budgets specified above.

Training poisoning requires provenance, purpose/consent, split barriers,
protected evaluations and controlled publication. Adding unspecified noise does
not establish differential privacy; signing a poisoned update does not make it
correct. A domain capability cannot modify safety policy or learn away a denial.

Traces can reveal sensor locations, business records, personal behavior or model
features. Access, retention, deletion and training permissions MUST follow those
sources; a public explanation MUST NOT expose private evidence or repository
locations. Numerical reproducibility does not grant permission to publish data.

## References

1. Da Costa et al. [Active inference on discrete state-spaces: A synthesis](https://pmc.ncbi.nlm.nih.gov/articles/PMC7732703/).
2. Heins et al. [pymdp: A Python library for active inference in discrete state spaces](https://arxiv.org/abs/2201.03904).
3. Millidge et al. [Whence the Expected Free Energy?](https://doi.org/10.1162/neco_a_01354).
4. Heins et al. [AXIOM: Learning to Play Games in Minutes with Expanding Object-Centric Models](https://arxiv.org/abs/2505.24784).
5. Friston et al. [From pixels to planning: scale-free active inference](https://arxiv.org/abs/2407.20292).
6. Friston et al. [Active inference and artificial reasoning](https://arxiv.org/abs/2512.21129).
7. Assran et al. [V-JEPA 2: Self-Supervised Video Models Enable Understanding, Prediction and Planning](https://arxiv.org/abs/2506.09985).
8. Maes et al. [LeWorldModel: Stable End-to-End Joint-Embedding Predictive Architecture from Pixels](https://arxiv.org/abs/2603.19312).
9. Hafner et al. [Mastering diverse control tasks through world models](https://doi.org/10.1038/s41586-025-08744-2).
10. Besold et al. [Hakken: Predicting future discoveries to fill the gaps in today's knowledge](https://arxiv.org/abs/2609.04494).
11. Zhang et al. [Qwen3 Embedding: Advancing Text Embedding and Reranking Through Foundation Models](https://arxiv.org/abs/2506.05176).
12. Tschannen et al. [SigLIP 2: Multilingual Vision-Language Encoders with Improved Semantic Understanding, Localization, and Dense Features](https://arxiv.org/abs/2502.14786).
13. [Qwen3-VL-Embedding and Qwen3-VL-Reranker](https://arxiv.org/abs/2601.04720).
14. IEEE [2874-2025: Standard for Spatial Web Protocol, Architecture and Governance](https://standards.ieee.org/ieee/2874/11717/).
15. [Hanzo ML mathematical reference](https://github.com/hanzoai/ml/pull/20) and [native world host boundary](https://github.com/hanzoai/engine/pull/41).
16. HIP-0019 — Tensor Operations Standard; HIP-0043 — Native Inference Engine.
17. HIP-0510 — Enso; HIP-0522 — Context Graph; HIP-0526 — Semantic Memory.
18. HIP-1332 — Kai; HIP-1333 — Train; HIP-1334 — Research.

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
