---
hip: 0901
title: Proof of AI (PoAI) — Native Execution Proofs, Canonical Contract & Operator-LLM Governance
author: Hanzo AI Team
type: Standards Track
category: Core
status: Final
created: 2026-06-23
updated: 2026-06-24
mirrors: LP-302, ZIP-0419
requires: HIP-0001, HIP-0005
---

# HIP-901: Proof of AI (PoAI)

## Abstract

This proposal specifies **Proof of AI (PoAI)**: the canonical, post-quantum
execution-layer proof system built into the Hanzo inference, training, and
embedding engine so that a node operator cannot charge a user — or earn a
consensus reward, or drive on-chain governance — for AI work it did not actually
perform.

PoAI is **one proof system, not four**. Inference, embedding, training, and
data-sharing are all expressed as the same object — a **computation graph of
matrix multiplications** — so a single Freivalds (1977) matrix-product verifier
over the prime field `F_p`, `p = 2^61 − 1`, evaluated on the **exact int8
accumulator** of the engine's quantized matmul path, verifies all of them.
Training is forward **plus** backward (backprop is also matmul); data-sharing is
the one orthogonal concern, handled by the post-quantum confidentiality envelope,
not by the matmul check. A `workloadType` field selects the binding: **PoE**
(embedding), **PoI** (inference), **PoT** (training), **PoC** (contribution).

There is **one canonical contract implementation**, shared across the whole
ecosystem: it lives in `luxfi/standard` at `contracts/ai/thinking/` and is
consumed everywhere — Hanzo included — via `@luxfi/standard/ai/thinking`. There
is no second implementation. PoAI carries a **leaderless operator-LLM
governance-execution** layer (`ThinkingGovernor`/`ThinkingParameters` settle
canonical YES/NO + knob medians on-chain; `AIExecute`/`AIPolicy`/`AIApproval`
read any contract state typed and execute arbitrary approved operations under a
timelock). PoAI is **public, leaderless, decentralized, operator-safe, and
post-quantum / nation-state-proof**.

The Freivalds core and the determinism prerequisites it depends on are **built
and tested** (`hanzo-engine/src/poi.rs`, 14 `#[test]`), with byte-parity mirrors
in the Go verifier (`luxfi/crypto/poi`, 22 `Test*`) and the Solidity
(`ComputeWitnessLib.sol`).

## Motivation

Hanzo is a decentralized AI cloud: inference, training, and embedding run on
independently operated nodes, and users pay per unit of AI work. That economic
model has a hole that a centralized provider does not have — **a node operator
who returns a plausible-looking answer without running the model robs the user,
and nothing in a normal request/response exchange exposes it.**

The standard answer — sign the output — does not close the hole. **A signature
proves authorship, not computation.** It says "this node produced these bytes";
it says nothing about whether those bytes came from a 671B mixture-of-experts
model the user paid for or from a 0.6B model, a cache, or a guess. The work is
what was purchased, and the work is exactly what a signature leaves unproven.

The threat has a sharpest edge worth naming. **The cheapest cheat is a one-bit
modal guess.** For a classification or routing decision, an operator who emits
the most likely label without running the network is usually right and always
cheaper. Any honest proof system must catch even this minimal deviation — a
single fabricated output entry — or it protects nothing.

The same gap recurs in **consensus and governance**. PoAI rewards useful AI work
(it is the basis of Proof of AI consensus, ZIP-0419) and it lets verified AI
*govern* — so "the AI decided" must mean a *verifiable* quorum of operator
models, never an oracle anyone can spoof. PoAI's design goal follows directly:
make the proof bind to the *computation*, catch the smallest possible cheat,
never reject an honest operator, and survive a future quantum adversary. Because
an LLM forward pass is overwhelmingly matrix multiplication, and because the
dishonest case is *fabricating* a product matrix rather than mis-computing it, a
probabilistic matrix-product check is exactly the right tool.

## Specification

### The four proofs over one primitive (one computation graph)

PoAI generalizes to inference, embedding, training, and data-sharing because the
compute-bearing ones are the same object: a **computation graph whose
load-bearing nodes are GEMMs**. All four PoAI proofs are the **same
matmul-verification primitive** applied to the GEMMs of a different workload,
selected by a `workloadType` field. There is one verifier, not four.

| Proof | `workloadType` | Workload | What the primitive verifies |
|-------|----------------|----------|-----------------------------|
| **PoE** | `embedding` | Embedding / encoder forward pass | The tower's GEMMs produced the claimed vector |
| **PoI** | `inference` | Decoder forward pass (the dominant case) | Each opened layer's `C = A·B` was actually computed |
| **PoT** | `training` | A training step | The forward GEMMs **and the backward GEMMs** — backprop is also matmul |
| **PoC** | `contribution` | A contributor's training round | PoT **+** proof-of-improvement **+** privacy via DeltaSoup |

- **PoE (embedding).** An embedding forward pass is a stack of GEMMs ending in a
  pooled vector. PoE proves the vector is the genuine output of the named model
  on the named input, so an embedding provider cannot return a cheap or random
  vector and bill for the real encoder.
- **PoI (inference).** The primary case. A decoder forward pass is ~95% matmul;
  PoI opens a challenged layer and verifies its product. This is the
  one-bit-guess defense made concrete.
- **PoT (training).** Backpropagation is **also** matrix multiplication — the
  gradient of a linear layer is itself a pair of GEMMs (`dX = dY·Wᵀ`,
  `dW = Xᵀ·dY`). So the **same** Freivalds primitive that checks a forward layer
  checks a backward layer; PoT proves a claimed training step actually ran the
  forward and backward passes it billed for.
- **PoC (contribution).** A contributor in a federated/distillation round must
  prove three things: (1) **PoT** — the training step ran; (2)
  **proof-of-improvement** — the resulting weight delta measurably improves the
  objective on a committed evaluation set, not noise; (3) **privacy** — the delta
  is aggregated through **DeltaSoup** (Byzantine-robust trim-mean aggregation
  with contributor reputation and differential privacy; see
  `gym/src/gym/quantization/deltasoup.py`), so a contributor proves a *useful,
  honest* gradient without exposing raw private data.

**Data-sharing is the orthogonal fourth concern.** It is not a matmul to verify;
it is a read-authorization question — *which operator may decrypt which prompt* —
handled by the post-quantum confidentiality envelope (§ Post-quantum stack),
entirely separate from the Freivalds core. The matmul check answers "was it
computed"; the envelope answers "who may see it"; the two never braid.

### The core: Freivalds over the exact int8 accumulator

An LLM forward pass is **~95% matrix multiplications `C = A·B`**. Recomputing `C`
to check an operator costs the same `O(t·k·n)` as doing the work — useless as a
verification asymmetry. **Freivalds (1977)** breaks the symmetry: for a random
challenge vector `r`, verify

```
A·(B·r) == C·r
```

in `O(t·k + k·n + t·n)` — one order cheaper than the multiply. If `C ≠ A·B`, a
random `r` exposes it with probability **≥ 1 − 1/p per challenge vector**; `k`
independent vectors drive the soundness error to `≤ (1/p)^k`. An honest operator
passes deterministically; an operator who **fabricated** `C` (the one-bit guess,
the wrong model, the skipped multiply) is caught with overwhelming probability.

The verifier works over the Mersenne prime field `F_p`, **`p = 2^61 − 1`**,
evaluated on the **exact integer accumulator** of the engine's int8 path
(`i8·i8 → i32`, reduced into `[0, p)`). This is the load-bearing design choice:
**integer arithmetic is bit-exact across CPU, GPU, and every backend**, so the
check has **zero false-reject** — the determinism the rest of PoAI relies on.
Soundness error is `1/p ≈ 2^−61` per vector; two vectors give `≤ 2^−122`.

Crucially, the soundness argument is **information-theoretic** — it holds against
an *unbounded* adversary — so the core is **post-quantum by construction**: a
quantum computer gives no advantage in guessing a uniformly-random `r` over
`F_p`. Combined with keccak commitments (PQ-secure) and the PQ keyed crypto
below, PoAI is post-quantum end to end.

The released core (`hanzo-engine/src/poi.rs`) is backend-agnostic and
dependency-free — it needs no forward pass to run, so its soundness is
unit-tested in isolation:

- `Mat` — a dense row-major integer matrix (`Vec<i64>`), the int8 path's exact
  accumulators.
- `freivalds_verify(a, b, c, r)` — checks `A·(B·r) == C·r` over `F_p` for one
  vector, with a shape contract that **fails closed** on any dimension mismatch.
- `freivalds_verify_multi(a, b, c, challenges)` — true iff **every** challenge
  vector passes; a tampered `C` fails at least one except with probability
  `≤ (1/p)^k`.
- `derive_challenges(seed, n, k)` — reproducibly expands `k` length-`n` vectors
  over `F_p` from a seed. The seed is derived **after the prover commits**
  (production: keccak over an on-chain beacon ‖ task ‖ root), so the prover
  cannot pre-pick `A, B, C` to satisfy a known `r`.

This core has **14 `#[test]` functions** in `poi.rs` (honest `A·B` passes; a
single tampered output entry is caught, including signed/negative entries;
field reduction of negative entries; challenge derivation is deterministic
across prover and verifier; wrong dimensions fail closed; a deep one-entry cheat
in a larger random matmul is caught; keccak `derive_challenges` golden-parity
with the chain). The supporting `poi_transcript.rs`, `poi_graph.rs`, and
`poi_forward.rs` carry the transcript, graph, and forward-pass wiring.

### Determinism prerequisites (shipped)

Bit-exactness of the accumulator is necessary but not sufficient: two honest runs
must also make the **same discrete decisions**, or an honest re-derivation
diverges and the proof false-rejects. Two sources of nondeterminism are pinned:

1. **Greedy-decode tie-break (sampler).** At temperature 0, argmax ties are
   broken by the **lowest token id**. Two honest runs that tie pick the same
   token.
2. **Canonical MoE expert top-k (ops).** Expert selection sorts by **score
   descending, then index ascending**, so the *same* experts are routed
   deterministically. This covers **every MoE model in the zen zoo** —
   proof-bearing runs set canonical routing on.

### Commit-now, verify-later

PoAI is **optimistic**: the expensive verification happens only on dispute, and
the happy path adds almost nothing.

- **At execution (cheap, always-on side-effect):** the prover emits an
  **activation-trace commitment** as a Merkle Mountain Range over per-`(layer,
  token, tap)` leaves, hashed with **keccak** using **RFC-6962 lone-node
  promotion** (not the malleable Bitcoin duplicate-last). A forward pass over a
  large model produces terabytes of activations; the MMR keeps only the
  `O(log N)` peak hashes (**~768 bytes of frontier**) and drops activations as
  they are hashed. The forward-pass hook is `Option<&mut ProofTranscript>`
  threaded through the context — when proofs are off it is a single not-taken
  branch with **no hashing, no allocation, no copy**.
- **On dispute (cheap, challenger-side):** a verifier derives a layer index and
  challenge vector `r` from an on-chain beacon **after** commitment, the prover
  opens that one layer's `A`, `B`, `C` with MMR inclusion proofs, and
  `freivalds_verify_multi` runs on a **single random layer** —
  `O(t·k + k·n + t·n + log N)`. Sparse cheats are pinned by interactive
  **bisection** to the first divergent layer (`O(log L)` rounds), so soundness is
  independent of how many layers a single challenge samples.

### The reportData binding

The proof must not be replayable, splice-able across tasks, or re-pointable at a
different model or input. The transcript chains **challenge → model → input →
output** through a keccak commitment (`transcriptRoot`) whose fields bind:

- **modelSpecHash** — **measured**, not labeled: a keccak Merkle root over the
  **quantized weight bytes the engine actually loaded** (with the quant-type
  discriminant per leaf, so re-quantizing to a different scheme yields a
  different root). The model identity is what ran, not what was claimed.
- **inputCommitment** — keccak over the canonical token ids (the prompt).
- **quantizationSpec / kernelVersion** — the decoding regime is part of identity,
  so a genuine model at the wrong temperature or a different reduction order is
  rejected.
- **activationTraceRoot** — the MMR close, with the leaf count bound in.
- **outputCommitment** — keccak over the canonical output token ids.

This `transcriptRoot` feeds the on-chain `reportData`, so an attestation cannot
be replayed or mis-attributed.

### Floating point: handled by tier, not by tolerance

A "Freivalds with an epsilon tolerance" for floating point would be **unsound** (a
tolerance the cheat hides under) **and false-rejecting** (honest reductions
differ). PoAI therefore routes by numeric tier rather than weakening the check;
one **profile gate** over all tiers enforces *no proof → no mint, no settle, no
act*:

| Tier | Numeric regime | Mechanism |
|------|----------------|-----------|
| Quantized | int8 / exact integer accumulator | **Software-only exact Freivalds** (the core) |
| Floating | fp16 / bf16 / fp8 | **Deterministic-fp** (pin the reduction order → bit-reproducible) **or** TEE / confidential-compute attestation |
| Small | small models / decisions | **zkML** (a succinct proof of the whole computation) |

### Architecture-family coverage

The one primitive plus per-modality I/O commitment and deterministic
pre/post-processing covers the whole zen zoo:

- **Dense transformers** — direct Freivalds on each layer's GEMM.
- **MoE** — the transcript additionally commits the router logits and the
  selected expert indices per token; the verifier recomputes the router, checks
  the **canonical** top-k chose the same experts (the determinism prerequisite),
  then Freivalds-checks only the **selected** experts' GEMMs (sparse). A
  mis-routed or under-routed run is caught.
- **Linear-recurrent / SSM / Gated-DeltaNet** — per-step Freivalds **plus
  state-chaining**: step *t*'s committed output is bound as step *t+1*'s
  committed input, so an intermediate state cannot be swapped.
- **Multimodal (ViT / audio)** — the vision and audio towers are GEMMs →
  Freivalds; the preprocessed input (pixel tensor / audio features) is committed
  by hash and preprocessing is pinned (resize/normalize, and FFT→mel as
  deterministic commit-and-recompute).
- **Diffusion / Transfusion** — the same step-chaining primitive as
  linear-recurrent, applied across denoising/generation steps (one primitive,
  two payoffs).

### One canonical contract — consumed everywhere

There is **one** on-chain implementation of PoAI. It lives in **`luxfi/standard`
at `contracts/ai/thinking/`** and is consumed by every Lux-descended chain —
Hanzo included — via `@luxfi/standard/ai/thinking`. There is **no second
implementation** to drift against; Hanzo's settlement and mint paths compose
these contracts, they do not fork them. Pinned `pragma solidity ^0.8.30`, SPDX
`BSD-3-Clause` extended by the LP-0012 ecosystem grant (§ Ecosystem license). The
load-bearing pieces:

- **`ComputeWitnessLib.sol`** — the on-chain Freivalds + Merkle-inclusion witness
  check, **byte-for-byte identical** to the prover (`poi_transcript.rs`) and the
  Go watcher (`crypto/poi/transcript.go`): same domain tag
  (`DOMAIN_MATMUL_LEAF = "hanzo/poi/matmul-leaf/v1"`), same canonical
  `(rows,cols,data)` serialization, same keccak fold, same `BE32(j)‖BE64(i)`
  challenge derivation, same `P = 2^61 − 1`. `provesFraud` returns true iff an
  opened matmul was committed under the root *and* its output is fabricated; an
  honest pass has no such matmul, so an honest operator can never be slashed.
- **`AIComputeRegistry.sol`** — the **global no-double-mint** ledger, keyed on the
  chain-independent `keccak(DOMAIN ‖ modelSpec ‖ promptHash ‖ outputHash)`
  (`DOMAIN = "hanzo/poi/compute-claim/v1"`). First-correct-proof wins; a second
  claim from any miner on any chain reverts, so one unit of work mints once
  network-wide.
- **`AChainRootOracle.sol`** — the trustless, permissionless, **post-quantum**
  relay of A-Chain (aivm) state to any EVM: a validator quorum signs `(root,
  height)` with ML-DSA, anyone may relay, the oracle verifies the quorum on-chain
  via the ML-DSA precompile (`IMLDSAVerify`). Forging a root requires breaking
  ML-DSA or corrupting `≥ threshold` of the validator set.
- **`MinerStakeRegistry.sol`** — bond/slash: a miner bonds in proportion to
  declared capacity; the fraud-proof verifier slashes a *proven* discrepancy
  automatically (the math, not a vote); a cooldown stops exit-before-fraud-proof.
- **`AICoin.sol` / `AICoinMiner.sol`** — the **fair-mined** native coin:
  `MAX_SUBSIDY = 1,000,000,000` AI, no pre-mine, supply from zero, the emission
  slope **halving every four years** (`HALVING_PERIOD = 4 * 365 days`), the
  geometric sum equal to exactly `MAX`. Multiple verified-cognition mint paths
  (`AICoinMiner` against A-Chain receipts, `ThinkingMiner` against
  governance-consensus share) share **one** cap; a minter is always a
  proof-enforcing contract, never an EOA — the god-key defense.

### Operator-LLM governance and execution (leaderless)

PoAI lets verified AI **govern and act** on-chain. Two decision primitives over
one bonded operator set, plus a three-tier execution surface — all in
`contracts/ai/thinking/`, all leaderless (no proposer, no admin key on the
decision path):

- **`ThinkingGovernor.sol`** decides a categorical **policy**: each bonded
  node-operator LLM emits a structured verdict `{vote, confidence}`,
  secp256k1-signs the **canonical consensus preimage** —
  `keccak256(abi.encodePacked(bytes32 modelSpecHash, uint8 vote, uint16
  confidenceBucket))`, byte-for-byte identical to the Go operator in
  `hanzo-evm/operator/canonical/governance.go` — and submits it. The contract
  `ecrecover`s the signer, tallies by `{vote, confidenceBucket}`, and on a strict
  majority records a canonical `Vote.Yes`/`Vote.No` decision on-chain
  (`getThought(taskId).canonicalVote`). The free-form rationale is *deliberately
  excluded* from consensus (hash-addressed audit evidence, never byte-identical).
- **`ThinkingParameters.sol`** decides a continuous **value**: each operator's
  LLM proposes a number in a declared `[lo, hi]`, signs a domain-separated
  judgment binding `block.chainid + address(this)`, and the chain settles to the
  **median** of a sortition-sampled quorum — *unweighted* (one operator, one
  proposal), the Byzantine-robust regime against any minority `< 50%`. Sortition
  seeded by `blockhash(openBlock)` makes committee share track population share,
  so capturing the median requires a majority of the whole population, not
  proposal spam. The live value is the loop-closing read `valueOf(spec, knobKey)`.
- **`AIExecute.sol`** is the one surface validator consensus uses to read and act,
  decomplected by risk into three tiers:
  - **READ** — `read*` staticcalls any getter and hands back a **typed** value
    (`readBool`/`readUint`/`readInt`/`readAddress`/`readBytes32`/`readMany`).
  - **ENACT (Tier 1)** — `enact` reads a knob the validators **decided** in
    `ThinkingParameters` and splices its value as the sole argument of
    `target.selector(value)`; a 32-byte word ABI-encodes to any single type, so
    one call sets bool/uint/int/address/bytes32 — low-risk, idempotent, **no
    timelock** (the value *is* the consensus output).
  - **EXECUTE (Tier 2/3)** — `execute` runs an **arbitrary** operation (any
    target, method, args, native value) that the validators approved *by its
    hash*, gated by a **timelock window** (later of declared earliest and
    `approvedAt + minDelay` — more delay allowed, never less), **predecessor**
    ordering, **one-shot**, a **guardian veto** (`cancel` during the window), and
    the optional **policy guard**. `hashOperation` binds `chainId + address(this)`
    so an approval is non-replayable across chains/instances; `execute` is
    **permissionless** (the approval is the authority, not the caller) and returns
    the call's raw typed return data.
- **`AIApproval.sol`** binds `AIExecute` to the real quorum by a single identity:
  **a Thought's `promptHash` IS the operation hash**. `confirm(taskId)` reads
  `governor.getThought(taskId)`, requires `Status.Settled` **and**
  `canonicalVote == Vote.Yes`, then stamps the approval of `thought.promptHash` at
  the current block time (the timelock anchor). `confirm` is **permissionless**
  (anyone may stamp an already-settled YES; nobody can manufacture one) and
  **one-shot**, with **no admin, no owner, no override** — the only path to an
  approval is a real quorum YES. It is an adapter, not a second governor.
- **`AIPolicy.sol`** is an orthogonal defense-in-depth guard (target/selector
  allowlists, native-value cap, per-target rate limit), each gate off by default,
  governed by a Safe or the timelock — so a compromised quorum still cannot reach
  outside the envelope a deployment set.

### Post-quantum stack

PoAI is post-quantum end to end. Freivalds soundness is information-theoretic and
keccak commitments are PQ-secure; all keyed crypto uses NIST PQ schemes (grounded
in `luxfi/node`):

- **X-Wing KEM promptseal** — `crypto/promptseal` seals a user's prompt to an
  operator's registered public key so the prompt is **never plaintext on the
  wire** and only the chosen operator, inside its compute boundary, can open it.
  The KEM is **X-Wing** — the standardized **hybrid of X25519 and ML-KEM-768**
  (HPKE over `cloudflare/circl`, `KEM_XWING`/`KDF_HKDF_SHA256`/
  `AEAD_ChaCha20Poly1305`, domain `hanzo/poi/prompt-seal/v1`) — confidential if
  *either* X25519 *or* ML-KEM-768 holds; the AAD binds the `intentID` so a sealed
  prompt cannot be replayed under a different request. X-Wing precompile at
  `0x…2221`. This is how **data-sharing** is bound: read-authorization is the
  envelope's job, orthogonal to the matmul check.
- **ML-DSA precompile (44/65/87)** at `0x…012202` — verifies ML-DSA-44 (`0x44`,
  NIST Level 2), ML-DSA-65 (`0x65`, Level 3), ML-DSA-87 (`0x87`, Level 5)
  (`precompile/mldsa`). Validator and A-Chain-root quorums sign with ML-DSA.
- **SLH-DSA** precompile at `0x…012203` (`precompile/slhdsa`) — conservative,
  structure-free hash-based PQ signatures.
- **P3Q precompile** at slot **`0x012205`** (`precompile/p3q`,
  `ContractP3QVerifyAddress`) — a new PQ-proof primitive at its own slot,
  orthogonal to the classical ZK/Pulsar precompiles, each independently complete.
- **Warp `MLDSACertSet`** — `luxfi/warp` `EnvelopeV2` carries an optional ML-DSA
  attestation lane (`warp/envelope.go`; LP-105), so cross-chain PoAI attestation
  travels post-quantum and `AChainRootOracle` verifies the same scheme on the
  destination EVM.

### Canon properties

PoAI is, and the contract layer enforces:

- **Public** — verifier, contracts, and every decision are open and on-chain.
- **Leaderless** — no proposer, no privileged caller on the decision or execution
  path; `confirm`/`execute` permissionless; the authority is a settled quorum
  verdict, never an account.
- **Decentralized** — one bonded operator set drives both decision primitives;
  sortition makes committee share track population share.
- **Operator-safe** — an operator runs its own LLM and signs its own verdict; an
  honest operator is never slashed (bit-exact integer arithmetic + lowest-id
  argmax + canonical MoE top-k); the guardian veto + policy guard bound a
  compromised quorum.
- **Post-quantum / nation-state-proof** — information-theoretic Freivalds
  soundness, keccak commitments, X-Wing/ML-DSA/SLH-DSA/P3Q keyed crypto.

### Ownership and selectable trust

PoAI exists to make decentralization safe for users, so **users own their data
and own their AI**. A user chooses where work runs:

- **Trusted DAO-operated nodes** — a vetted, reputation-bearing operator set; or
- **User-operated nodes** — the user runs their own engine.

Either way the *same* PoAI proof governs payment and slashing, so a user can pick
a trust level anywhere from "decentralized with cryptographic recourse" to "as
trusted as a centralized cloud" without changing the protocol.

## Rationale

- **Why Freivalds rather than re-execution?** Re-execution gives no verification
  asymmetry — it costs as much as the work. Freivalds is one polynomial order
  cheaper and catches a *fabricated* output (which is the actual attack) with
  probability `≥ 1 − 1/p`.
- **Why the exact int8 accumulator?** It is the only regime where the check is
  simultaneously **sound** (no tolerance to hide under) and **false-reject-free**
  (bit-exact across all backends). Floating point is pushed to deterministic-fp /
  TEE / zkML rather than degrading the integer check.
- **Why information-theoretic soundness?** Because it makes PoAI **post-quantum by
  construction** — the bound holds against an unbounded adversary, so settlement
  survives a future quantum computer with no scheme migration.
- **Why a signature is not enough.** A signature authenticates the *author* of
  bytes; PoAI authenticates the *computation* that produced them. The
  decentralized-cloud threat is precisely an authenticated-but-uncomputed answer.
- **Why one primitive for four proofs.** Embedding, inference, forward training,
  and backward training are all GEMM-dominated, and backprop is itself matmul.
  One verifier keeps the trusted surface small and means PoE/PoI/PoT/PoC share the
  same soundness argument. Data-sharing is *not* forced into the same check — it
  is an orthogonal confidentiality concern.
- **Why one canonical contract.** A single implementation in `luxfi/standard`
  consumed via `@luxfi/standard/ai/thinking` means no drift between Hanzo, Zoo,
  Lux, and Pars — one verifier, one registry, one coin, one governor.
- **Why decomplect governance from execution.** `ThinkingGovernor`/`Parameters`
  *decide*; `AIExecute` *acts*; `AIApproval` is a thin adapter binding a settled
  verdict to an operation hash; `AIPolicy` is an orthogonal guard. Each concern in
  one place.

## Security Considerations

- **Soundness.** Per challenge vector, a fabricated product is caught with
  probability `≥ 1 − 1/p`, `p = 2^61 − 1`; `k` vectors give `≤ (1/p)^k`
  (`≤ 2^−122` at `k = 2`). The shape contract fails closed, so malformed openings
  cannot pass.
- **Post-quantum.** The Freivalds bound is information-theoretic (holds against an
  unbounded adversary); keccak commitments are PQ-secure; keyed crypto is
  X-Wing/ML-DSA/SLH-DSA/P3Q. Forging settlement requires breaking a NIST PQ scheme
  *or* corrupting a validator quorum — the nation-state-resistant bar.
- **Challenge unpredictability.** `r` (and the opened layer) are derived from an
  on-chain beacon **after** the prover commits the activation-trace and weights
  roots, so the prover cannot tune operands to a known challenge.
- **Commitment integrity.** RFC-6962 promotion avoids the CVE-2012-2459
  duplicate-last malleability; leaf/node domain separation hardens against
  second-preimage attacks; the leaf count is bound into the close so a subtree
  cannot be reinterpreted as the whole tree.
- **Replay / mis-attribution.** The `reportData` binding chains challenge →
  measured model → input → output; `modelSpecHash` is measured over loaded
  quantized weight bytes, and `quantizationSpec`/`kernelVersion` fold the decoding
  regime into identity. The op hash binds `chainId + executor`, so a governance
  approval is non-replayable across chains/instances.
- **No double-mint.** `AIComputeRegistry` keys on the chain-independent
  computation commitment; one unit of work mints once, network-wide.
- **Operator safety & break-glass.** Integer arithmetic plus the shipped
  determinism prerequisites (lowest-id argmax, canonical MoE top-k) mean two
  honest runs agree bit-for-bit; an honest operator is never slashed. A malicious
  governance approval can be vetoed by the guardian during its timelock window and
  is bounded by the policy guard even if the quorum is compromised.

## Reference Implementation

- **Engine core (built, tested):** `hanzo-engine/src/poi.rs` — `Mat`,
  `freivalds_verify`, `freivalds_verify_multi`, `derive_challenges`;
  backend-agnostic, dependency-free; **14 `#[test]`**. Transcript/graph/forward
  wiring in `poi_transcript.rs`, `poi_graph.rs`, `poi_forward.rs`; adversarial
  suite in `tests/poi_adversarial.rs`.
- **Determinism prerequisites (shipped):** lowest-id argmax greedy tie-break in
  the sampler; canonical score-descending / index-ascending MoE expert top-k in
  ops.
- **Chain verifier (canonical, the one the chain consumes):** `luxfi/crypto/poi`
  — `freivalds.go`, `transcript.go`, `wire.go`; **22 `Test*`** across
  `freivalds_test.go`, `transcript_test.go`, `wire_test.go`, `scale_test.go`,
  `adversarial_test.go`.
- **Canonical contracts (one implementation):** `luxfi/standard`
  `contracts/ai/thinking/` — `ComputeWitnessLib`, `AIComputeRegistry`,
  `AChainRootOracle`, `MinerStakeRegistry`, `AICoin`, `AICoinMiner`,
  `ThinkingMiner`, `ThinkingGovernor`, `ThinkingParameters`, `AIExecute`,
  `AIApproval`, `AIPolicy` (+ `ComputeProofLib`, `ComputeProfile`,
  `ComputeVerifier`, `AttestationRootRegistry`, `AIReceiptRoots`). Consumed via
  `@luxfi/standard/ai/thinking`.
- **PQ:** `crypto/promptseal` (X-Wing), `precompile/mldsa` (`0x…012202`,
  44/65/87), `precompile/slhdsa` (`0x…012203`), `precompile/p3q` (`0x…012205`),
  `precompile/xwing` (`0x…2221`), `warp/envelope.go` (`MLDSACertSet`).
- **Soundness companion:** `zooai/proofs/proof-of-inference-soundness.tex`.

## Status

**Built and tested:**

- The Freivalds verifier core (`poi.rs`) and the determinism prerequisites are
  implemented and pass **14 `#[test]`** in `hanzo-engine` — honest `A·B` passes
  every challenge; a single tampered output entry is caught (including
  signed/negative entries); challenge derivation is deterministic across prover
  and verifier; wrong dimensions fail closed; a deep one-entry cheat in a larger
  random matmul is caught; keccak `derive_challenges` is golden-parity with the
  chain. The canonical Go verifier (`luxfi/crypto/poi`) carries **22 `Test*`**
  across the Freivalds, transcript, wire, scale, and adversarial suites, and the
  Solidity `ComputeWitnessLib` is byte-identical to both.

**Enforced (canonical contract):**

- The chain refuses to mint, settle, or act on a reward without a valid proof at
  the required tier — the profile gate is live in `luxfi/standard`
  `contracts/ai/thinking/`, with the global no-double-mint registry
  (`AIComputeRegistry`), the trustless PQ root oracle (`AChainRootOracle`),
  bond/slash (`MinerStakeRegistry`), and the fair-mined capped/halving coin
  (`AICoin`/`AICoinMiner`).

**Governance-execution (built):**

- `ThinkingGovernor` + `ThinkingParameters` settle canonical YES/NO + knob
  medians on-chain from the operator-LLM quorum; `AIExecute` + `AIApproval` +
  `AIPolicy` let consensus read any state typed and execute arbitrary approved
  operations under timelock + predecessor + one-shot + guardian veto + policy
  guard.

**PQ stack (built):** X-Wing promptseal + precompile, ML-DSA (44/65/87) +
SLH-DSA + P3Q (`0x012205`) precompiles, warp `MLDSACertSet`.

**Increment in flight:** end-to-end zen-model proof **emission** — a real forward
pass over a zen model emitting the activation-trace transcript a challenger opens
and Freivalds-verifies against the bound `reportData`. The verifier, the
on-chain gate, the canonical contracts, and the proof format are all in place
and tested; wiring a live zen-model forward pass to emit the transcript is the
remaining engineering. The proof system itself is canonical and enforced today.

**Live node-binary support:**

| Binary | Role | Carries the primitive via | Status |
|---|---|---|---|
| `hanzo-engine` | prover-side core | native `src/poi.rs` (Freivalds + determinism prereqs, 14 tests) | released |
| `hanzod` | Hanzo node (Rust) | embeds `hanzo-engine` (path dep) → inherits the prover core | available via embed |
| `luxd` | Lux node (Go) | `luxfi/crypto/poi` verifier (in-module) | verifier available |
| `zood` | Zoo node (Go) | `luxfi/crypto/poi` verifier (in-module) | verifier available |

On-chain enforcement (`luxfi/standard` `contracts/ai/thinking/`) is the binding
authority on every one of these chains regardless of node binary.

## Ecosystem license (LP-0012)

The canonical PoAI work — the Rust prover core (`hanzo-engine/src/poi.rs`), the
Go verifier (`luxfi/crypto/poi`), and the Solidity contracts (`luxfi/standard`
`contracts/ai/thinking/`) — is licensed **BSD-3-Clause** (the per-file
`SPDX-License-Identifier` is authoritative) **extended by the LP-0012 ecosystem
grant**: production use is granted to chains **descending from the Lux primary
network** (Hanzo, Zoo, Pars, and other Lux-descended L1s/L2s/L3s). Hanzo runs
PoAI under this grant. Commercial licensing beyond these terms is by arrangement
— contact **lux.network**. See LP-0012 and `luxfi/standard` `LICENSING.md`.

## References

1. R. Freivalds, *Probabilistic Machines Can Use Less Running Time* (1977).
2. HIP-1: $AI Token — Hanzo's Native Currency (`./hip-0001-ai-coin-hanzos-native-currency.md`)
3. HIP-5: Post-Quantum Security for AI Infrastructure (`./hip-0005-post-quantum-security-for-ai-infrastructure.md`)
4. LP-302 — Proof of AI (PoAI), Lux mirror.
5. ZIP-0419 — Proof of AI (PoAI), Zoo mirror.
6. LP-0012 — Permissionless + ecosystem license.
7. `hanzo-engine/src/poi.rs` — Freivalds core (14 `#[test]`).
8. `luxfi/crypto/poi` — canonical Go verifier (22 `Test*`).
9. `luxfi/standard` `contracts/ai/thinking/` — canonical contract.
10. RFC 6962 — Certificate Transparency (Merkle lone-node promotion).

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
