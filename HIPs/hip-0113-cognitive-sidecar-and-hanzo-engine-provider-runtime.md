---
hip: 0113
title: Cognitive Sidecar & Hanzo Engine Provider Runtime for Thinking Chains
author: Hanzo AI
type: Standards Track
category: Core
status: Draft
created: 2026-06-21
requires: 0023, 0024, 0043, 0114
---

# HIP-0113: Cognitive Sidecar & Hanzo Engine Provider Runtime for Thinking Chains

## Abstract

This HIP specifies Hanzo's two roles in a **Thinking Chain** — a deterministic
chain paired with a verifiable cognitive layer, where thought informs state but
never mutates consensus directly.

First, the **Hanzo Engine** is the off-chain **Tier-2** inference runtime that a
bonded provider quorum runs. Providers load registered models through the engine's
C ABI (`hanzo_ffi_infer` / `hanzo_ffi_embed`), turn the deterministic result into
a `output_hash` / `embedding_hash`, and settle agreement through a commit-reveal
quorum on the Lux A-Chain, earning a **Proof-of-Thought (PoT)** receipt. The
engine is NEVER on the C-Chain consensus path.

Second, every node MAY run a node-local **Cognitive Sidecar**: a thinking agent
(Hanzo Engine runtime + ZAP tools + proposal analyzer + simulation client +
red-team agent + vote recommender) that sits *behind a signer firewall*. The agent
produces artifacts — `ProposalDraft`, `VoteRecommendation`, `ConfigPatch`,
`RiskReport`, `SimulationRequest`, `OperatorAction`, `BridgeHealthAlert` — but
MUST NOT hold validator keys or mutate consensus. A separate signer/policy layer,
governed by a node-local `[ai.autonomy]` policy and bounded by **human-in-the-loop
levels 0–5**, decides what (if anything) becomes a transaction.

This HIP composes with — does not replace — HIP-0023 (the decentralized compute
swarm that supplies provider GPUs) and HIP-0024 (the Hanzo sovereign L1 that hosts
the precompiles). It is one of four sibling artifacts sharing one canon: the Lux
*Thinking Chains* proposal (the L0/consensus-layer primitive and bridge
precompiles), the Zoo *Beluga L3 Thinking-Chain Architecture* ZIP (the first
deployment), and the Zoo *Thinking Chains* paper (the conceptual treatment and
Subsampled Cognitive Consensus analysis).

## Motivation

Two distinct needs drive this HIP, and conflating them is the mistake prior
"AI-on-chain" designs made.

**Need 1 — large-model cognition a chain can settle on.** Governance and
application logic want judgments only a frontier model can make (summarize a
200-page report, rank grant applications, multi-criteria proposal analysis). A live
LLM call is nondeterministic across hardware and model versions and unbounded in
latency — any of which forks a network. The resolution is to run the large model
*off-chain* and return a *settlement object* whose validity is checked by
re-deriving a hash, not by re-running a model. Hanzo already ships the runtime that
does exactly this: the native engine over a stable C ABI, plus a Go operator that
turns engine output into the commit/reveal payloads an on-chain quorum precompile
settles (`chains/hanzo-evm/operator`, `chains/hanzo-evm/precompile/aiquorum`). This
HIP specifies that runtime as the canonical **Tier-2 provider**.

**Need 2 — a node that can reason about its own operation without ever touching
consensus.** Operators want a validator that can read a governance proposal and
draft an analysis, notice a bridge health regression, recommend a vote, or propose
a config change — but they MUST NOT let a model hold a validator key or steer
block production. The resolution is the **Cognitive Sidecar**: the agent is a pure
*producer of artifacts*; a deterministic signer/policy layer is the only thing that
can turn an artifact into a transaction, and only within an explicit autonomy
policy and human-loop level. This is the decomplecting move — separating *what
cognition produces* from *when the node may act on it*.

### Why not just an oracle, or just an on-chain model

A trusted oracle reintroduces a single point of trust and gives no provenance. A
tiny fully-on-chain model (Tier 1, the Lux inference precompile at
`0x0300…0003`) is real and useful for in-block classifiers and embeddings, but is
capped at toy capability.
The Thinking Chain pattern uses *the strongest mechanism each kind of cognition
allows*: byte-identical execution where possible (Tier 1, not this HIP's subject),
bonded-quorum settlement where not (Tier 2, the Hanzo Engine — this HIP).

## Specification

The keywords MUST, MUST NOT, SHALL, SHOULD, MAY are used per RFC 2119. All hashing
is keccak-256 unless stated. "Structured output" means a fixed-shape value (class
label, ranked ID list, vote+confidence bucket, or fixed-width embedding/hash) —
**never prose**.

### 1. Roles and shared canon

This HIP uses the shared role vocabulary of the Thinking Chains canon:

| Role | Meaning |
|------|---------|
| C | contracts / escrow / bridge (the requesting domain) |
| A | AI inference / quorum / model-registry (the settling domain) |
| D | DEX / market |
| S | simulation |
| R | reputation |
| G | governance |
| M | memory |

Hanzo's Tier-2 provider runtime operates in role **A**. The Cognitive Sidecar is a
node-local actor that *produces inputs for* C/G/S/R but is never itself a consensus
participant.

A **Thinking Chain** is the pair *(deterministic chain, verifiable cognitive
layer)* such that (i) the state transition is deterministic and reproducible from
committed inputs alone; (ii) cognition MAY produce inputs to the state transition,
but only structured, hash-addressed outputs that are themselves committed; (iii) no
state transition reads a live, uncommitted cognitive result. Thought *informs*
state; thought never *is* the consensus mechanism.

### 2. The two tiers

There are exactly two inference tiers, and Hanzo's engine lives in Tier 2.

**Tier 1 — deterministic int8 in-consensus.** A small model runs byte-identically
inside block execution through the Lux inference precompile at `0x0300…0003` (the
`0x0303` shorthand in the canon; a pure-Go, CGO=0 int8 transformer evaluator in the
AI-reserved `0x0300…00xx` range). Every validator computes the identical
`output_hash` / `embedding_hash`; no GPU, no Hanzo Engine. Tier 1 is the *only*
inference that may directly produce a state-transition input, precisely because it
is deterministic. **Tier 1 is out of scope for this HIP** beyond the boundary it
defines: a Tier-1 call MUST NOT recursively invoke Tier 2 within the same
transaction.

**Tier 2 — large-model off-chain provider quorum.** Models that cannot be made
byte-identical on-chain run *off-chain*, on a bonded provider set, through the
**Hanzo Engine**. Providers run `hanzo_ffi_infer` / `hanzo_ffi_embed`, produce
`output_hash` / `embedding_hash`, and commit-reveal into the A-Chain quorum. The
A-Chain settles agreement and exports a PoT receipt. **This is where the Hanzo
Engine lives. The Hanzo Engine is NEVER on the C-Chain consensus path.**

### 3. The Bridge Law (binding)

> **C-Chain consensus state MUST NOT depend on a live query whose result is not
> already committed and certified.**

The A-Chain settles the provider quorum; the C-Chain (or an L3 such as Beluga)
imports the settled receipt by Merkle proof against a committed `receipt_root`, in
a *separate* transaction. C consensus never blocks on, or branches on, an
uncommitted A-Chain value. The slogan, identical across all four artifacts:

> **ZAP transports; proofs commit; receipts settle; VMs execute.**

ZAP (HIP-0114) carries intents, receipts, and agent/operator messages; it is a
transport and never a proof. A message carries no consensus weight until a
committed proof or receipt certifies it.

### 4. The Hanzo Engine as Tier-2 provider runtime

#### 4.1 The engine FFI surface (the cdylib providers run)

The provider runtime is `libhanzo_engine_ffi` — a C ABI over the native engine,
built once (lazily, from environment) holding every configured model, so a non-Rust
caller (the Go operator over cgo) can drive any loaded model in-process. The full
ABI is fixed (`engine/hanzo-engine-ffi/include/hanzo_engine_ffi.h`,
`engine/hanzo-engine-ffi/src/lib.rs`):

| Symbol | Purpose | Return contract |
|--------|---------|-----------------|
| `hanzo_ffi_ready()` | Load all `HANZO_FFI_MODELS` if needed | `1` ready, `0` fail |
| `hanzo_ffi_infer(model, prompt, &out, &out_len)` | Text generation (greedy) | `0` ok; `-1` bad args, `-2` engine unavailable, `-3` inference failed |
| `hanzo_ffi_embed(model, text, &out, &out_count)` | Native-dimension embedding | `0` ok; errors as above |
| `hanzo_ffi_load(name, kind, source)` | Add a model to the live engine | `0` ok; `-3` bad spec / conflict |
| `hanzo_ffi_unload(name)` | Remove a model (refuses to go empty) | `0` ok; `-3` not found / last model |
| `hanzo_ffi_list(&out, &out_len)` | Newline-joined routable ids | `0` ok |
| `hanzo_ffi_free` / `hanzo_ffi_free_f32` | Release returned buffers | — |

Model configuration is the `HANZO_FFI_MODELS` spec: a `;`-separated list of
`name=kind:source`, `kind ∈ {gguf, plain, embedding}`. The first entry is the
default model; `HANZO_FFI_TOK_DIR` resolves a GGUF tokenizer. Example:

```
HANZO_FFI_MODELS="zen-nano=gguf:/models/zen-5-flash.gguf;zen-embed=embedding:/models/zen-embedding-0.6B"
HANZO_FFI_TOK_DIR=/models/zen-nano-fused
```

A provider MUST use greedy decoding for any consensus-relevant job: greedy decoding
on a fixed engine build is bit-identical for the same `(model, prompt)` on the same
host, which is the property that lets two honest providers produce the same hash.

#### 4.2 ModelSpec discipline (registration is mandatory for consensus models)

A governance- or consensus-relevant model MUST be registered. The registration
record is the **ModelSpec**, whose keccak digest (`model_spec_hash`) is the only
thing stored on-chain; the preimage is reproduced by every operator. The canonical
fields and hash are byte-identical between the off-chain operator
(`chains/hanzo-evm/operator/canonical/modelspec.go`) and the on-chain precompile
(`aiquorum.ComputeModelSpecHash`):

```
ModelSpec {
    model_id            string   // routable model name (the HANZO_FFI_MODELS key, e.g. "zen-nano")
    model_hash          bytes32  // pins exact weights (e.g. keccak/sha of the .gguf)
    tokenizer_hash      bytes32  // pins the fused tokenizer dir
    runtime_version     string   // pins the engine build (e.g. "hanzo-engine/ffi-greedy-v1")
    sampling_hash       bytes32  // pins the decoding policy (greedy / temperature 0)
    prompt_template_hash bytes32 // pins the chat/prompt template
    embedding_model_hash bytes32 // pins the embedding model (zero if none)
}

model_spec_hash = keccak256(
    u32be(len(model_id)) || model_id ||
    model_hash(32) || tokenizer_hash(32) ||
    u32be(len(runtime_version)) || runtime_version ||
    sampling_hash(32) || prompt_template_hash(32) || embedding_model_hash(32) )
```

Field order is canonical and load-bearing: reordering any two adjacent fields
changes the digest while leaving every value unchanged — exactly the bug this one
shared definition exists to prevent. Two operators with different weights, a
drifted tokenizer, or a different engine build hash to *different* specs and never
quorum together. The on-chain `engine_build_hash` and `quantization` are folded
into `runtime_version` and `model_hash` respectively (an operator publishes the
exact engine build string and the quantized weight hash it runs); a verifier that
wants them broken out reads the published ModelSpec record off-chain.

#### 4.3 The Tier-2 provider flow: sample → infer → commit → reveal → settle

For a job whose on-chain record carries `(job_id, model_spec_hash, prompt_hash, N,
threshold, reward)`:

1. **Sample (select).** The A-Chain quorum precompile selects an `N`-member
   committee from an eligible set strictly larger than `N` (margin
   `E ≥ N + max(2, N/2)`) via a deterministic, replayable beacon. A selected
   provider proceeds; others do not. Selection is replayable by any verifier
   (`isSelected`), so no provider can predict or pin membership.
2. **Infer.** The selected provider runs the registered model through the engine —
   `hanzo_ffi_infer(model, prompt)` for the causal output and, if the job carries
   an embedding, `hanzo_ffi_embed(model, text)`. The provider computes the
   consensus `output_hash` per mode (§4.4) and `embedding_hash` (§4.5).
3. **Commit.** The provider draws a fresh 256-bit CSPRNG nonce and submits an
   **operator-bound** commit (`commitResponse`). The commit binds the provider's
   own 20-byte address (§4.6), so a peer who observes the commit on the wire cannot
   replay it as their own.
4. **Reveal.** Inside the reveal window the provider reveals
   `(output_hash, embedding_hash, nonce)` (`revealResponse`). The precompile
   recomputes the commit from the revealed fields and the *committing* operator and
   rejects any mismatch.
5. **Settle.** After the reveal window, `settle` tallies by `output_hash`: if
   `≥ threshold` providers revealed the identical `output_hash`, that value is
   canonical; agreeing providers are paid from the job reward, the result is
   exported as a PoT receipt under the A-Chain `receipt_root`, and value is
   conserved. Withholders are slashed (§7); honest minority answers are not.

The capstone proof (`chains/hanzo-evm/operator/capstone`) drives this entire
pipeline against the **real** engine (cgo FFI) and the **real** `aiquorum`
precompile and asserts that the on-chain canonical hash is byte-identical to the
engine output the honest providers produced — no fabricated hashes anywhere.

#### 4.4 output_hash — two modes

The chain treats `output_hash` as an opaque 32-byte value and only decides whether
`≥ threshold` operators submitted the same bytes. The *meaning* of those bytes is
defined off-chain (`chains/hanzo-evm/operator/canonical/output.go`):

- **RAW mode** — free-text jobs:
  `output_hash = keccak256( deterministic UTF-8 model output )`. The bytes are
  exactly what `hanzo_ffi_infer` returns. A single different token yields a
  different hash and excludes that operator — the chain counts byte-agreement, not
  semantic agreement.
- **GOVERNANCE mode** — the consensus hash covers ONLY the structured decision,
  never the prose rationale:
  ```
  canonical_output_bytes = model_spec_hash(32) || vote_byte(1) || u16be(bucket_bps)(2)   // 35 bytes
  output_hash            = keccak256(canonical_output_bytes)
  ```
  `vote_byte ∈ {yes=1, no=2, abstain=3}` (0 is reserved/invalid); `bucket_bps` is
  the model's confidence snapped to a coarse grid (default 1000 bps, 11 buckets) by
  integer round-half-to-even, so small numeric wobble between operators collapses to
  the same bucket. Binding `model_spec_hash` into the preimage means a decision can
  only equal another decision made under the identical spec.

The model is constrained to emit exactly one strict-schema JSON object
(`{"vote","confidence_bps","rationale","citations","model_spec"}`); the parser
rejects unknown fields, trailing data, and a `model_spec` that does not echo the
job's spec. On an invalid decision the operator retries inference once, then
**abstains** (a real abstain vote at zero confidence) — fail-secure, never a guess.
`rationale` and `citations` are non-consensus audit metadata, retained
hash-addressed (RFC 8785 canonical JSON), never gating the quorum.

#### 4.5 embedding_hash — int8 quantization

When a job carries an embedding, the float32 vector from `hanzo_ffi_embed` is
deterministically quantized to int8 and hashed
(`chains/hanzo-evm/operator/canonical/embedding.go`):

```
scale = max(|v_i|) / 127                     (all-zero vector => scale = 1)
q_i   = round_half_to_even(v_i / scale) clamped to [-127, 127]
canonical_serialized = u32be(dim) || int8[dim] || f32be(scale)
embedding_hash       = keccak256(canonical_serialized)
```

Symmetric int8 (range `[-127, 127]`, not `-128`) keeps the grid centered on zero;
the scale is serialized as the same float32 used in the division so a verifier
reconstructs the identical grid. A non-finite component (NaN/±Inf) is rejected
**before** any arithmetic (fail-closed) — a `float→int8` conversion of a non-finite
value is implementation-defined and disagrees across architectures (arm64 FCVTZS
saturates, amd64 CVTTSD2SI yields integer-indefinite), so an unchecked ±Inf would
silently split the embedding quorum. The operator declines such a job rather than
committing a host-dependent hash.

> **Cross-hardware caveat (binding policy).** Bit-identical embedding floats are
> guaranteed only for the *same engine build on the same host*. Across
> heterogeneous hosts the low bits can differ (different BLAS, FMA contraction,
> GPU vs CPU), which can flip a boundary-rounded int8 or shift the whole grid.
> Therefore operators in one embedding quorum MUST run matching engine builds on
> matching hardware (pinned by `runtime_version` + `embedding_model_hash`), OR the
> embedding is carried as non-consensus metadata. This is the single most fragile
> point in the wire spec and is called out explicitly for the reviewer.

#### 4.6 Operator binding (defense in depth)

A provider is bound to its result two independent ways
(`chains/hanzo-evm/operator/operator.go`):

- **Commit binds the address (on-chain).**
  ```
  commit = keccak256(
      job_id(32) || model_spec_hash(32) || prompt_hash(32) ||
      output_hash(32) || embedding_hash(32) || operator(20) || nonce(32) )
  ```
  The precompile enforces this at reveal: a peer cannot replay another operator's
  commit because recomputation with their own address differs. In GOVERNANCE mode
  `output_hash` has only a few dozen possible values, so the nonce MUST be a fresh
  256-bit CSPRNG value or an observer could brute-force the preimage and break
  hiding before reveal.
- **Reveal is key-signed (off-chain).** The reveal payload is secp256k1-signed over
  a domain-separated digest (`"hanzo/aiquorum/reveal/v1"`); the operator address is
  recovered from the signature, so a relay or gateway cannot forge a reveal. The
  signature library emits canonical low-S; a malleated copy is refused.

Together: address-in-commit (on-chain) + key-signed-reveal (off-chain). An attacker
needs both the address and the key to impersonate an operator.

#### 4.7 Committee diversity (anti-monoculture)

To avoid a model monoculture in which a single bad model, build, or operator
silently captures a quorum, committee composition for governance-class jobs MUST
enforce diversity caps, expressed as fractions of the committee `N`:

| Cap | Meaning | Default |
|-----|---------|---------|
| `max_per_operator` | most committee seats one operator address may hold | 1 |
| `max_per_vendor` | most seats sharing one declared model vendor/source | ⌈N/3⌉ |
| `max_per_hardware` | most seats sharing one declared hardware class | ⌈N/2⌉ |
| `max_per_runtime` | most seats sharing one `runtime_version` | ⌈N/2⌉ |

A committee that cannot be filled within these caps from the eligible set means the
job's spec is under-diversified; the request fails closed rather than settling on a
monoculture. (The exact registry-level realization is the A-Chain's; this HIP
states the requirement Hanzo providers register the metadata for: declared vendor,
hardware class, and `runtime_version`.)

### 5. The Cognitive Sidecar

#### 5.1 Architecture and the signer firewall

Each Hanzo node runs three cooperating but isolated components:

```
┌──────────────────────────── node process boundary ──────────────────────────┐
│                                                                              │
│   consensus engine        VM (EVM / precompiles)        Cognitive Sidecar    │
│   (block production,       (state transition,            (thinking agent)     │
│    validator keys)          Tier-1 0x0300…0003)                               │
│        │                        │                              │             │
│        │                        │                     ┌────────┴─────────┐   │
│        │                        │                     │ Hanzo Engine rt  │   │
│        │                        │                     │ ZAP tools        │   │
│        │                        │                     │ proposal analyzer│   │
│        │                        │                     │ simulation client│   │
│        │                        │                     │ red-team agent   │   │
│        │                        │                     │ vote recommender │   │
│        │                        │                     └────────┬─────────┘   │
│        │                        │                              │ artifacts   │
│        │                        │                     ╔════════▼═════════╗   │
│        │                        │                     ║  SIGNER FIREWALL ║   │
│        │                        │                     ║  (policy engine) ║   │
│        │                        │                     ╚════════╤═════════╝   │
│        ▼                        ▼                              │ (maybe) tx  │
│   [validator keys] ◄── NEVER reachable by the agent ──────────┘             │
└──────────────────────────────────────────────────────────────────────────────┘
```

The **signer firewall** is the load-bearing boundary. It is an in-process trust
boundary with these binding invariants:

- **SF1 — Key isolation.** The agent MUST NOT have read access to validator
  signing keys, nor to any KMS handle that can sign on the node's behalf. Keys live
  with the consensus engine / signer; the agent address space never holds them.
- **SF2 — Artifacts, not transactions.** The agent's only output is a typed
  *artifact* (§5.2). It cannot construct, sign, or broadcast a transaction. The
  signer/policy layer is the sole component that can turn an artifact into a tx.
- **SF3 — One-way data flow at the boundary.** The agent emits artifacts to the
  firewall; the firewall never hands the agent a signing capability in return. The
  channel is a queue of artifacts, not an RPC into the signer.
- **SF4 — Policy is the gate.** The firewall admits an artifact toward signing only
  if the node's `[ai.autonomy]` policy permits that artifact type at its
  human-loop level (§6), it is not in `[ai.forbidden]`, and any `[human_required]`
  condition is satisfied.
- **SF5 — No consensus mutation.** Nothing the agent produces can alter block
  production, validator selection, or the state transition except by becoming a
  *normal transaction* that the signer chose to send and that the chain validates
  like any other.

#### 5.2 Artifact types

The agent produces exactly these typed artifacts. Each is a structured object
(never free prose used as a state input); prose fields within an artifact are
evidence only.

| Artifact | Produced by | Carries | Typical level |
|----------|-------------|---------|---------------|
| `ProposalDraft` | proposal analyzer | a draft governance proposal (title, body hash, parameter changes) for human review | 1 |
| `VoteRecommendation` | vote recommender | `{proposal_id, vote, confidence_bucket, rationale_hash}` | 1 |
| `ConfigPatch` | operator/agent | a proposed node/operator config delta (bounded set of keys) | 2–3 |
| `RiskReport` | red-team agent | findings on a proposal/upgrade/bridge state; severity-ranked | 0–1 |
| `SimulationRequest` | simulation client | a request to S-role to simulate a proposed action before enacting | 0 |
| `OperatorAction` | operator/agent | a bounded local operator action (e.g. restart a provider model via `hanzo_ffi_load`/`unload`) | 2–3 |
| `BridgeHealthAlert` | bridge monitor | a `receipt_root`/intent backlog or proof-failure alert | 0–1 |

An artifact MAY reference a Tier-2 PoT receipt (e.g. a `VoteRecommendation` derived
from a Governance Thought Receipt). When it does, the *structured field* of the
receipt is what the artifact carries; the receipt's prose rationale stays
hash-addressed evidence.

#### 5.3 The agent's tools

The agent's toolset is fixed and side-effect-scoped:

- **Hanzo Engine runtime** — local Tier-1-class inference for the agent's own
  reasoning (drafting, classification, ranking) via the same FFI (§4.1). This is
  the agent *thinking*; it is not a consensus path.
- **ZAP tools (HIP-0114)** — read node-local/inter-VM messages (intents, receipts,
  operator messages) and emit agent messages. ZAP transports only; an agent message
  carries no consensus weight.
- **Proposal analyzer** — reads committed governance proposals and produces
  `ProposalDraft` / `RiskReport` / `VoteRecommendation`.
- **Simulation client (S-role)** — issues `SimulationRequest` and reads simulation
  results to inform a recommendation before any action.
- **Red-team agent** — adversarially analyzes a proposal, upgrade, or bridge state
  and produces a `RiskReport`.
- **Vote recommender** — combines proposal analysis, simulation, and (optionally) a
  Tier-2 Governance Thought Receipt into a `VoteRecommendation`.

### 6. Autonomy policy and human-in-the-loop levels

#### 6.1 Human-in-the-loop levels 0–5

Every agent pathway is bounded by an explicit level. Raising a level is itself a
gated authority expansion (constitutional rule C7).

| Level | Name | Meaning on a Hanzo node |
|-------|------|-------------------------|
| 0 | Observe | The agent records artifacts as evidence; no signer interaction, no on-chain effect. |
| 1 | Recommend | An artifact becomes an on-chain *recommendation*; a human/DAO must enact it. |
| 2 | Bounded local autonomy | The signer may act within a pre-approved, bounded *local* policy (e.g. restart a model, apply a whitelisted config key) with NO external value movement and NO consensus effect. |
| 3 | Policy-gated tx | The signer may send a transaction that satisfies a registered policy predicate (e.g. route a sub-threshold operation), within rate and value caps. |
| 4 | Human approval | An artifact triggers a transaction that requires explicit human approval before the signer broadcasts it. |
| 5 | Constitutional | Changes to the constitution or to the levels themselves — DAO vote + timelock, never autonomous. |

`RiskReport`, `SimulationRequest`, and `BridgeHealthAlert` default to Level 0–1
(evidence/recommend). `ConfigPatch` and `OperatorAction` default to Level 2 and MAY
be raised to Level 3 only for registered, bounded predicates under C7. Governance
transactions (enacting a vote) are never below Level 4 unless an explicit, bounded
Level-3 policy is registered.

#### 6.2 The `[ai.*]` policy schema (TOML)

The node's autonomy is configured in a node-local TOML block. The signer firewall
reads it; the agent does not get to edit it (editing it is itself a `ConfigPatch`
gated at Level ≥ 4).

```toml
[ai]
# Master switch. When false, the sidecar runs at Level 0 regardless of the rest.
enabled = true
# The cap that no per-artifact setting may exceed. A per-artifact level higher
# than this is clamped down to it.
max_level = 3

[ai.autonomy]
# Per-artifact-type human-loop level (0..5). Absent => 0 (observe).
proposal_draft       = 1
vote_recommendation  = 1
risk_report          = 1
simulation_request   = 0
config_patch         = 2
operator_action      = 2
bridge_health_alert  = 1

[ai.autonomy.bounds]
# Hard caps the signer enforces for any agent-originated tx (Levels 2–3).
max_tx_per_hour      = 6
max_value_wei        = "0"          # "0" = no value movement permitted at all
allowed_config_keys  = ["engine.model", "engine.threads", "log.level"]
allowed_operator_actions = ["model_reload", "model_unload", "cache_flush"]
# Registered policy predicates that gate Level-3 txs (by id; defined on-chain/DAO).
policy_predicates    = ["route_subthreshold_v1"]

[ai.forbidden]
# Absolute denials. The signer rejects these even if a level would otherwise allow.
touch_validator_keys = true         # always true; stated for auditability
mutate_consensus     = true         # always true
send_value           = true         # this node never lets the agent move value
modify_ai_policy     = true         # agent cannot raise its own autonomy
deregister_operator  = true

[human_required]
# Conditions that force Level-4 human approval regardless of per-artifact level.
governance_enact     = true         # enacting any governance vote needs a human
upgrade_or_migration = true         # any chain upgrade / migration needs a human
above_value_wei      = "0"          # any value-moving tx needs a human
unregistered_model   = true         # acting on output from an unregistered model
```

Enforcement rules (binding):

- The effective level of an artifact is `min(ai.autonomy.<type>, ai.max_level)`,
  and `0` if `ai.enabled = false`.
- Any `[ai.forbidden]` flag that is `true` is an absolute denial; it overrides every
  level and every bound. `touch_validator_keys` and `mutate_consensus` are
  structurally always true (they restate SF1/SF5) and are listed for auditability.
- Any `[human_required]` condition that matches forces Level 4 (human approval)
  before the signer may broadcast, regardless of the per-artifact level.
- `[ai.autonomy.bounds]` are hard caps the signer checks at sign time: a tx
  exceeding `max_tx_per_hour`, `max_value_wei`, an unlisted config key, or an
  unlisted operator action is rejected by the signer, not the agent.

### 7. Constitutional rules and slashing

#### 7.1 Constitutional rules (binding)

A Hanzo node participating in a Thinking Chain MUST enforce the shared constitution.
These restate the canon verbatim:

- **C1 — Deterministic consensus.** The state transition is deterministic and
  reproducible from committed inputs alone.
- **C2 — No live thought in state transition.** No state transition reads a live,
  uncommitted inference result (the Bridge Law, §3).
- **C3 — Cross-chain effects require committed proofs.** Any effect derived from
  another chain's cognition requires a verified proof against a committed root.
- **C4 — Structured outputs only.** Consensus inputs are structured and
  hash-addressed. Prose is evidence only, never a consensus input.
- **C5 — Bounded recursion.** Cognitive calls are bounded by recursion depth and
  resource budget; unbounded or self-triggering chains of thought are rejected
  (§7.3).
- **C6 — Replay-protected receipts.** Receipts are bound to `intent_id` and a
  settlement height; a receipt is consumable at most once.
- **C7 — Authority expansion gated.** Raising a human-loop level, or widening a
  model's permitted actions, requires a human/DAO decision plus timelock.
- **C8 — Bounded cognition budget.** Tier-1 in-consensus inference is gas-metered
  and depth-bounded; Tier-2 requests carry an explicit fee and committee budget.
- **C9 — Preserve dissent.** The confidence and dissent distribution of a cognitive
  judgment is preserved on-chain, not collapsed to a single value.
- **C10 — Governance models registered.** Any model used for a governance decision
  MUST be ModelSpec-registered by weight-commitment hash (§4.2); an unregistered
  model cannot produce a consensus input.
- **C11 — Inspectable without an LLM.** Every committed cognitive input is verifiable
  by re-deriving a hash or checking a Merkle proof — a validator or auditor confirms
  validity without running any model.

#### 7.2 Slashing — objective protocol violations only

A provider's bond is slashed ONLY for objective, on-chain-detectable protocol
violations, never for honest dissent:

| Slashable (objective) | Detected by |
|-----------------------|-------------|
| Commit-then-withhold (commit, never reveal) | reveal window expiry with a prior commit |
| Double-reveal / reveal inconsistent with commit | commit recompute mismatch at reveal |
| Wrong-runtime (output under a spec the operator did not commit) | `model_spec_hash` binding in commit |
| Forged receipt / forged reveal signature | secp256k1 recovery ≠ operator, or commit does not bind revealed fields |
| Replay (re-using a committed receipt or another's commit) | `intent_id` / operator-bound commit |

**Honest dissent is NOT slashable.** A provider whose structured output is a
minority-but-honest answer — that committed and revealed correctly — keeps its bond.
Its dissent is preserved in the distribution (C9). Punishing dissent would collapse
the confidence distribution and incentivize herding; punishing withholding targets
the only behavior that actually denies the chain an answer.

#### 7.3 Recursion and resource budgets

- A Tier-1 call MUST NOT invoke Tier 2 within the same transaction (no
  in-consensus escalation to off-chain cognition).
- The Cognitive Sidecar MUST enforce a per-trigger recursion budget: an agent
  pathway that would re-trigger itself (an artifact whose enactment produces the
  same artifact) is bounded by a depth counter and a per-hour rate cap
  (`[ai.autonomy.bounds].max_tx_per_hour`), and self-triggering chains are rejected
  (C5).
- A Tier-2 request carries an explicit fee and committee budget (C8); a provider
  that cannot run within budget declines rather than partially computing.

## Rationale

**Why the signer firewall is in-process, not a separate trust domain.** The agent
needs low-latency access to the same committed state the node already holds (to
analyze proposals and bridge health). Putting it in-process keeps that cheap; the
firewall provides the isolation that a process boundary would, by making *key
access* and *tx construction* unreachable from the agent rather than relying on
network segmentation. The boundary that matters is the capability boundary (no
keys, no tx), not the address-space boundary.

**Why artifacts, not direct action.** Decomplecting *what cognition produces* from
*when the node acts on it* is the whole design. An artifact is inert; a transaction
is not. Keeping the agent on the inert side of that line means a compromised or
hallucinating model can at worst produce a bad *recommendation*, which the policy
layer and (at Level ≥ 4) a human must still ratify.

**Why ModelSpec registration is mandatory for consensus models.** Without pinning
weights, tokenizer, runtime, sampling, and template, two "honest" operators can
silently diverge and no quorum forms — or worse, a quorum forms around a model
nobody can reproduce. The single shared `model_spec_hash` definition (identical
off-chain and on-chain) is what makes agreement *mean* "same model, same inputs."

**Why structured-outputs-only.** Prose is not reproducible, not comparable, and not
safely hashable into a decision. Constraining consensus inputs to structured outputs
(and demoting prose to hash-addressed evidence) is what makes Subsampled Cognitive
Consensus and C11 (inspectable without an LLM) possible at once.

**Why this composes with HIP-0023 and HIP-0024.** HIP-0023 (compute swarm) supplies
and schedules the GPUs a Tier-2 provider runs on; this HIP defines what a provider
*does* with that GPU to settle a quorum. HIP-0024 (sovereign L1) hosts the
precompiles and the AI-COIN economics; this HIP defines the off-chain runtime and
the node-local agent that feed them. Neither is replaced.

## Security Considerations

### Signer-firewall isolation and key safety

The agent never holds validator keys (SF1) and cannot construct or broadcast a
transaction (SF2). The only path from cognition to chain is an artifact that the
signer/policy layer chose to enact (SF3–SF5). A fully compromised agent therefore
cannot sign a block, move value (`[ai.forbidden].send_value`), deregister the
operator, or raise its own autonomy (`modify_ai_policy`). The worst case is a flood
of artifacts, bounded by `max_tx_per_hour` and rejected at the signer. KMS handles
that can sign are out of the agent's address space.

### Prompt and model manipulation

A malicious proposal or input could attempt prompt injection to steer the agent's
recommendation. Mitigations: (i) the agent's output is a *recommendation*, gated by
human-loop level (manipulation cannot directly cause an action below Level 2, and
never a value-moving or governance-enacting one without a human); (ii) GOVERNANCE
mode constrains the model to a strict JSON schema and rejects unknown fields,
trailing data, and a wrong `model_spec`, so injected free-text cannot become a
consensus input; (iii) acting on output from an *unregistered* model forces Level-4
human approval (`[human_required].unregistered_model`).

### Model monoculture

If one model, build, vendor, or operator captured a committee, a single systematic
error or a single compromised operator could forge agreement. The diversity caps of
§4.7 (`max_per_operator` / `vendor` / `hardware` / `runtime`) and the eligible-set
margin `E ≥ N + max(2, N/2)` make a committee that is structurally diverse and not
predictable by any withholding subset. A spec that cannot fill a diverse committee
fails closed rather than settling on a monoculture.

### Determinism boundary (the fragile point)

Bit-identical engine output is guaranteed only for the same engine build on the
same host (greedy decoding). The embedding path is the most fragile: cross-hardware
low-bit float differences can flip a boundary-rounded int8 (§4.5). The mitigations
are policy, not code — pin `runtime_version` + `embedding_model_hash` within an
embedding quorum, fail closed on non-finite components, or carry embeddings as
non-consensus metadata. This is surfaced explicitly for the reviewer and the red
team.

### Autonomy-policy enforcement

Enforcement lives in the signer, not the agent, so an agent cannot evade it. Every
`[ai.forbidden]` flag is an absolute denial that overrides any level; every
`[human_required]` condition forces Level-4 human approval; `[ai.autonomy.bounds]`
are checked at sign time. The policy itself is immutable to the agent
(`modify_ai_policy` forbidden); changing it is a `ConfigPatch` gated at Level ≥ 4
and, for level changes, C7 (human/DAO + timelock).

### Recursion budgets

A self-triggering chain of thought (an artifact whose enactment reproduces the same
artifact) is bounded by a depth counter and `max_tx_per_hour`, and rejected per C5.
Tier-1 cannot escalate to Tier-2 in one transaction. Tier-2 requests are
fee-bounded and committee-bounded (C8).

### Replay and front-running

The operator-bound commit (address in the preimage) blocks a peer from replaying an
observed commit; the 256-bit CSPRNG nonce keeps GOVERNANCE-mode commits hiding
despite the small output space; the secp256k1-signed reveal blocks a relay from
forging a reveal; `intent_id` and once-only receipt consumption block receipt
replay.

## Reference Implementation

| Component | Path | Role |
|-----------|------|------|
| Engine FFI cdylib (the provider runtime) | `hanzo/engine/hanzo-engine-ffi` (`src/lib.rs`, `include/hanzo_engine_ffi.h`) | `hanzo_ffi_infer` / `embed` / `ready` / `load` / `unload` / `list` over the native engine |
| Off-chain operator | `hanzo/chains/hanzo-evm/operator/operator.go` | engine→reveal: run, hash, nonce, operator-bound commit, signed reveal |
| Canonical wire spec (shared truth) | `hanzo/chains/hanzo-evm/operator/canonical/` (`modelspec.go`, `commit.go`, `output.go`, `embedding.go`, `governance.go`) | ModelSpec hash, commit, output_hash (raw/governance), int8 embedding_hash |
| A-Chain quorum precompile | `hanzo/chains/hanzo-evm/precompile/aiquorum` (`0x0300…0012`) | register / request / commit / reveal / settle / pay / slash |
| End-to-end capstone proof | `hanzo/chains/hanzo-evm/operator/capstone` | real engine (cgo) + real precompile; canonical hash == engine output, value conserved |
| Tier-1 boundary (not this HIP) | `lux/precompile/inference` (`0x0300…0003`) | deterministic int8 transformer, CGO=0 |

Build and run the live quorum against the real engine:

```bash
HANZO_FFI_MODELS="zen-nano=gguf:/models/zen-5-flash.gguf;zen-embed=embedding:/models/zen-embedding-0.6B" \
  HANZO_FFI_TOK_DIR=/models/zen-nano-fused \
  GOWORK=off CGO_ENABLED=1 SDKROOT=$(xcrun --show-sdk-path) CPATH=$SDKROOT/usr/include \
  go run ./cmd/capstone        # human-readable trace
  go test ./capstone -run Capstone -v
```

## References

- *Thinking Chains* (Lux Proposal) — the L0/consensus-layer primitive and the
  C→A bridge precompiles; the protocol Hanzo providers serve.
- *Beluga L3 Thinking-Chain Architecture* (Zoo ZIP) — the first deployment of a
  Thinking Chain; names this HIP as the Tier-2 provider runtime and ModelSpec
  registration source.
- *Proof-of-Thought Receipts on Zoo* (Zoo ZIP) — the `AInferenceReceipt`
  settlement object Hanzo's Tier-2 quorum exports.
- *Thinking Chains* (Zoo paper) — the conceptual treatment and Subsampled
  Cognitive Consensus analysis.
- [HIP-0114: ZAP — Inter-VM Cognitive Transport](./hip-0114-zap-inter-vm-cognitive-transport.md)
- [HIP-0023: Decentralized AI Compute Swarm Protocol](./hip-0023-decentralized-ai-compute-swarm-protocol.md)
- [HIP-0024: Hanzo Sovereign L1 Chain Architecture](./hip-0024-hanzo-sovereign-l1-chain-architecture.md)
- [HIP-0043: LLM Inference Engine Standard](./hip-0043-llm-inference-engine-standard.md)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
