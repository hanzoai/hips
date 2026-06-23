---
hip: 0901
title: Proof of AI — Native Execution Proofs (Embedding/Inference/Training/Contribution)
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-06-23
---

# HIP-901: Proof of AI — Native Execution Proofs

## Abstract

This proposal specifies **Proof of AI (PoAI)**: the native execution-layer proofs built into
the Hanzo inference, training, and embedding engine so that a node operator cannot charge a user
for AI work it did not actually perform. PoAI is **four proofs over one primitive**, keyed by a
`workloadType` field: **PoE** (embedding), **PoI** (inference), **PoT** (training), and **PoC**
(contribution). The shared primitive is a Freivalds (1977) matrix-product verifier over the prime
field `F_p`, `p = 2^61 − 1`, evaluated on the **exact int8 accumulator** of the engine's quantized
matmul path — making the check bit-exact and false-reject-free across CPU, GPU, and backends.

The Freivalds core and the determinism prerequisites it depends on are **built and tested**
(`hanzo-engine/src/poi.rs`, released in `hanzoai/engine` v1.2.5). The end-to-end emission slice —
a real zen-model forward pass producing the activation-trace transcript a challenger opens and
Freivalds-verifies — is the **next** increment; its design is merged
(`docs/proof-of-inference/forward-pass-commitment-design.md`) but it is **not yet live**.

## Motivation

Hanzo is a decentralized AI cloud: inference, training, and embedding run on independently
operated nodes, and users pay per unit of AI work. That economic model has a hole that a
centralized provider does not have — **a node operator who returns a plausible-looking answer
without running the model robs the user, and nothing in a normal request/response exchange
exposes it.**

The standard answer — sign the output — does not close the hole. **A signature proves
authorship, not computation.** It says "this node produced these bytes"; it says nothing about
whether those bytes came from a 671B mixture-of-experts model the user paid for or from a 0.6B
model, a cache, or a guess. The work is what was purchased, and the work is exactly what a
signature leaves unproven.

The threat has a sharpest edge worth naming. **The cheapest cheat is a one-bit modal guess.**
For a classification or routing decision, an operator who emits the most likely label without
running the network is usually right and always cheaper. Any honest proof system must catch even
this minimal deviation — a single fabricated output entry — or it protects nothing.

PoAI's design goal follows directly: make the proof bind to the *computation*, catch the smallest
possible cheat, and never reject an honest operator. Because an LLM forward pass is overwhelmingly
matrix multiplication, and because the dishonest case is *fabricating* a product matrix rather
than mis-computing it, a probabilistic matrix-product check is exactly the right tool.

## Specification

### The four proofs over one primitive

All four PoAI proofs are the **same matmul-verification primitive** applied to the GEMMs of a
different workload, selected by a `workloadType` field. There is one verifier, not four.

| Proof | `workloadType` | Workload | What the primitive verifies |
|-------|----------------|----------|-----------------------------|
| **PoE** | `embedding` | Embedding / encoder forward pass | The tower's GEMMs produced the claimed vector |
| **PoI** | `inference` | Decoder forward pass (the dominant case) | Each opened layer's `C = A·B` was actually computed |
| **PoT** | `training` | A training step | The forward GEMMs **and the backward GEMMs** — backprop is also matmul |
| **PoC** | `contribution` | A contributor's training round | PoT **+** proof-of-improvement **+** privacy via DeltaSoup |

- **PoE (embedding).** An embedding forward pass is a stack of GEMMs ending in a pooled vector.
  PoE proves the vector is the genuine output of the named model on the named input, so an
  embedding provider cannot return a cheap or random vector and bill for the real encoder.
- **PoI (inference).** The primary case. A decoder forward pass is ~95% matmul; PoI opens a
  challenged layer and verifies its product. This is the one-bit-guess defense made concrete.
- **PoT (training).** Backpropagation is **also** matrix multiplication — the gradient of a
  linear layer is itself a pair of GEMMs (`dX = dY·Wᵀ`, `dW = Xᵀ·dY`). So the **same** Freivalds
  primitive that checks a forward layer checks a backward layer; PoT proves a claimed training
  step actually ran the forward and backward passes it billed for.
- **PoC (contribution).** A contributor in a federated/distillation round must prove three things:
  (1) **PoT** — the training step ran; (2) **proof-of-improvement** — the resulting weight delta
  measurably improves the objective on a committed evaluation set, not noise; (3) **privacy** —
  the delta is aggregated through **DeltaSoup** (Byzantine-robust trim-mean aggregation with
  contributor reputation and differential privacy; see `gym/src/gym/quantization/deltasoup.py`),
  so a contributor proves a *useful, honest* gradient without exposing raw private data.

### The core: Freivalds over the exact int8 accumulator

An LLM forward pass is **~95% matrix multiplications `C = A·B`**. Recomputing `C` to check an
operator costs the same `O(t·k·n)` as doing the work — useless as a verification asymmetry.
**Freivalds (1977)** breaks the symmetry: for a random challenge vector `r`, verify

```
A·(B·r) == C·r
```

in `O(t·k + k·n + t·n)` — one order cheaper than the multiply. If `C ≠ A·B`, a random `r` exposes
it with probability **≥ 1 − 1/p per challenge vector**; `k` independent vectors drive the
soundness error to `≤ (1/p)^k`. An honest operator passes deterministically; an operator who
**fabricated** `C` (the one-bit guess, the wrong model, the skipped multiply) is caught with
overwhelming probability.

The verifier works over the Mersenne prime field `F_p`, **`p = 2^61 − 1`**, evaluated on the
**exact integer accumulator** of the engine's int8 path (`i8·i8 → i32`, reduced into `[0, p)`).
This is the load-bearing design choice: **integer arithmetic is bit-exact across CPU, GPU, and
every backend**, so the check has **zero false-reject** — the determinism the rest of PoAI relies
on. Soundness error is `1/p ≈ 2^−61` per vector; two vectors give `≤ 2^−122`.

The released core (`hanzo-engine/src/poi.rs`, `hanzoai/engine` v1.2.5) is backend-agnostic and
dependency-free — it needs no forward pass to run, so its soundness is unit-tested in isolation:

- `Mat` — a dense row-major integer matrix (`Vec<i64>`), the int8 path's exact accumulators.
- `freivalds_verify(a, b, c, r)` — checks `A·(B·r) == C·r` over `F_p` for one vector, with a
  shape contract that **fails closed** on any dimension mismatch.
- `freivalds_verify_multi(a, b, c, challenges)` — true iff **every** challenge vector passes; a
  tampered `C` fails at least one except with probability `≤ (1/p)^k`.
- `derive_challenges(seed, n, k)` — reproducibly expands `k` length-`n` vectors over `F_p` from a
  seed. The seed is derived **after the prover commits** (production: keccak over an on-chain
  beacon ‖ task ‖ root), so the prover cannot pre-pick `A, B, C` to satisfy a known `r`.

### Determinism prerequisites (shipped in v1.2.5)

Bit-exactness of the accumulator is necessary but not sufficient: two honest runs must also make
the **same discrete decisions**, or an honest re-derivation diverges and the proof false-rejects.
Two sources of nondeterminism are pinned, both shipped in v1.2.5:

1. **Greedy-decode tie-break (sampler).** At temperature 0, argmax ties are broken by the
   **lowest token id**. Two honest runs that tie pick the same token.
2. **Canonical MoE expert top-k (ops).** Expert selection sorts by **score descending, then
   index ascending**, so the *same* experts are routed deterministically. This covers **every MoE
   model in the zen zoo** — proof-bearing runs set canonical routing on.

### Commit-now, verify-later

PoAI is **optimistic**: the expensive verification happens only on dispute, and the happy path
adds almost nothing.

- **At execution (cheap, always-on side-effect):** the prover emits an **activation-trace
  commitment** as a Merkle Mountain Range over per-`(layer, token, tap)` leaves, hashed with
  **keccak** using **RFC-6962 lone-node promotion** (not the malleable Bitcoin duplicate-last).
  A forward pass over a large model produces terabytes of activations; the MMR keeps only the
  `O(log N)` peak hashes (**~768 bytes of frontier**) and drops activations as they are hashed.
  The forward-pass hook is `Option<&mut ProofTranscript>` threaded through the context — when
  proofs are off it is a single not-taken branch with **no hashing, no allocation, no copy**.
- **On dispute (cheap, challenger-side):** a verifier derives a layer index and challenge vector
  `r` from an on-chain beacon **after** commitment, the prover opens that one layer's `A`, `B`,
  `C` with MMR inclusion proofs, and `freivalds_verify_multi` runs on a **single random layer** —
  `O(t·k + k·n + t·n + log N)`. Sparse cheats are pinned by interactive **bisection** to the
  first divergent layer (`O(log L)` rounds), so soundness is independent of how many layers a
  single challenge samples.

### The reportData binding

The proof must not be replayable, splice-able across tasks, or re-pointable at a different model
or input. The transcript chains **challenge → model → input → output** through a keccak commitment
(`transcriptRoot`) whose fields bind:

- **modelSpecHash** — **measured**, not labeled: a keccak Merkle root over the **quantized weight
  bytes the engine actually loaded** (with the quant-type discriminant per leaf, so re-quantizing
  to a different scheme yields a different root). The model identity is what ran, not what was
  claimed.
- **inputCommitment** — keccak over the canonical token ids (the prompt).
- **quantizationSpec / kernelVersion** — the decoding regime is part of identity, so a genuine
  model at the wrong temperature or a different reduction order is rejected.
- **activationTraceRoot** — the MMR close, with the leaf count bound in.
- **outputCommitment** — keccak over the canonical output token ids.

This `transcriptRoot` feeds the on-chain `reportData`, so an attestation cannot be replayed or
mis-attributed.

### Floating point: handled by tier, not by tolerance

A "Freivalds with an epsilon tolerance" for floating point would be **unsound** (a tolerance the
cheat hides under) **and false-rejecting** (honest reductions differ). PoAI therefore routes by
numeric tier rather than weakening the check:

| Tier | Numeric regime | Mechanism |
|------|----------------|-----------|
| Quantized | int8 / exact integer accumulator | **Software-only exact Freivalds** (the core) |
| Floating | fp16 / bf16 / fp8 | **Deterministic-fp** (pin the reduction order → bit-reproducible) **or** TEE / confidential-compute attestation |
| Small | small models / decisions | **zkML** (a succinct proof of the whole computation) |

### Architecture-family coverage

The one primitive plus per-modality I/O commitment and deterministic pre/post-processing covers
the whole zen zoo:

- **Dense transformers** — direct Freivalds on each layer's GEMM.
- **MoE** — the transcript additionally commits the router logits and the selected expert indices
  per token; the verifier recomputes the router, checks the **canonical** top-k chose the same
  experts (the determinism prerequisite), then Freivalds-checks only the **selected** experts'
  GEMMs (sparse). A mis-routed or under-routed run is caught.
- **Linear-recurrent / SSM / Gated-DeltaNet** — per-step Freivalds **plus state-chaining**: step
  *t*'s committed output is bound as step *t+1*'s committed input, so an intermediate state cannot
  be swapped.
- **Multimodal (ViT / audio)** — the vision and audio towers are GEMMs → Freivalds; the
  preprocessed input (pixel tensor / audio features) is committed by hash and preprocessing is
  pinned (resize/normalize, and FFT→mel as deterministic commit-and-recompute).
- **Diffusion / Transfusion** — the same step-chaining primitive as linear-recurrent, applied
  across denoising/generation steps (one primitive, two payoffs).

### Ownership and selectable trust

PoAI exists to make decentralization safe for users, so **users own their data and own their
AI**. A user chooses where work runs:

- **Trusted DAO-operated nodes** — a vetted, reputation-bearing operator set; or
- **User-operated nodes** — the user runs their own engine.

Either way the *same* PoAI proof governs payment and slashing, so a user can pick a trust level
anywhere from "decentralized with cryptographic recourse" to "as trusted as a centralized cloud"
without changing the protocol.

## Rationale

- **Why Freivalds rather than re-execution?** Re-execution gives no verification asymmetry — it
  costs as much as the work. Freivalds is one polynomial order cheaper and catches a *fabricated*
  output (which is the actual attack) with probability `≥ 1 − 1/p`.
- **Why the exact int8 accumulator?** It is the only regime where the check is simultaneously
  **sound** (no tolerance to hide under) and **false-reject-free** (bit-exact across all backends).
  Floating point is pushed to deterministic-fp / TEE / zkML rather than degrading the integer
  check.
- **Why a signature is not enough.** A signature authenticates the *author* of bytes; PoAI
  authenticates the *computation* that produced them. The decentralized-cloud threat is precisely
  an authenticated-but-uncomputed answer.
- **Why one primitive for four proofs.** Embedding, inference, forward training, and backward
  training are all GEMM-dominated, and backprop is itself matmul. One verifier keeps the trusted
  surface small and means PoE/PoI/PoT/PoC share the same soundness argument.

## Security Considerations

- **Soundness.** Per challenge vector, a fabricated product is caught with probability
  `≥ 1 − 1/p`, `p = 2^61 − 1`; `k` vectors give `≤ (1/p)^k`. The shape contract fails closed, so
  malformed openings cannot pass.
- **Challenge unpredictability.** `r` (and the opened layer) are derived from an on-chain beacon
  **after** the prover commits the activation-trace and weights roots, so the prover cannot tune
  operands to a known challenge.
- **Commitment integrity.** RFC-6962 promotion avoids the CVE-2012-2459 duplicate-last
  malleability; leaf/node domain separation hardens against second-preimage attacks; the leaf
  count is bound into the close so a subtree cannot be reinterpreted as the whole tree.
- **Replay / mis-attribution.** The `reportData` binding chains challenge → measured model → input
  → output; `modelSpecHash` is measured over loaded quantized weight bytes, and
  `quantizationSpec`/`kernelVersion` fold the decoding regime into identity.
- **False-reject avoidance.** Integer arithmetic plus the shipped determinism prerequisites
  (lowest-id argmax, canonical MoE top-k) mean two honest runs agree bit-for-bit; an honest
  operator is never slashed.

## Reference Implementation

- **Engine core (built, tested):** `hanzo-engine/src/poi.rs` — `Mat`, `freivalds_verify`,
  `freivalds_verify_multi`, `derive_challenges`; backend-agnostic, dependency-free. Released in
  `hanzoai/engine` **v1.2.5**.
- **Determinism prerequisites (shipped, v1.2.5):** lowest-id argmax greedy tie-break in the
  sampler; canonical score-descending / index-ascending MoE expert top-k in ops.
- **Forward-pass emission design (merged, not yet live):**
  `hanzo-engine/docs/proof-of-inference/forward-pass-commitment-design.md` — the
  ActivationTraceMMR, the zero-overhead forward-pass hook, the `transcriptRoot` binding, and the
  challenge → open-one-layer → Freivalds flow.
- **Chain-side verifier mirror:** the canonical on-chain verifier mirror in `luxfi/crypto/poi`
  v1.19.23.
- **On-chain enforcement:** slashing / settlement in `luxdao/contracts` v2.1.0.
- **Soundness companion:** `zooai/proofs/proof-of-inference-soundness.tex`.

## Status — honest

**Built and tested:**

- The Freivalds verifier core (`poi.rs`) and the determinism prerequisites are implemented and
  pass **8 green tests** in `hanzoai/engine` v1.2.5 — honest `A·B` passes every challenge; a
  single tampered output entry is caught (including signed/negative entries); challenge derivation
  is deterministic across prover and verifier; wrong dimensions fail closed; a deep one-entry cheat
  in a larger random matmul is caught.

**Not yet live:**

- **End-to-end zen-model proof emission** — a real forward pass over a zen model emitting the
  activation-trace transcript that a challenger opens and Freivalds-verifies — is the **next**
  increment. Its design is merged
  (`docs/proof-of-inference/forward-pass-commitment-design.md`); the first true "live" is a green
  end-to-end test in which an honest int8 zen MoE inference emits the transcript, a challenged
  layer verifies, and a faked / cheap-model / mis-routed run is caught. That test does **not** yet
  pass.

**Live node-binary support:**

The PoAI primitive reaches each node binary by a single path — the Rust engine carries the
prover-side core, the Go nodes carry the chain-side verifier, and EVM enforcement is node-agnostic.

| Binary | Role | Carries the primitive via | Status |
|---|---|---|---|
| `hanzo-engine` v1.2.5 | prover-side core | native `src/poi.rs` (Freivalds + determinism prereqs, 8 green tests) | released |
| `hanzod` 1.1.20 | Hanzo node (Rust) | embeds `hanzo-engine` ≥ v1.2.5 (path dep) → inherits the prover core | available via embed |
| `luxd` | Lux node (Go) | `luxfi/crypto/poi` v1.19.23 (dep bumped; package builds in-module) | verifier available |
| `zood` | Zoo node (Go) | `luxfi/crypto/poi` v1.19.23 (verified to compile in-module) | verifier available; full dep-graph sync pending upstream tag settling |

On-chain enforcement (`luxdao/contracts` v2.1.0, *no valid proof → no mint, no settle*) is live in
the EVM on every one of these chains; what is *not* yet wired into the node forward path is the
emission of the activation-trace transcript, per the increment above.

## References

1. R. Freivalds, *Probabilistic Machines Can Use Less Running Time* (1977).
2. HIP-1: $AI Token — Hanzo's Native Currency (`./hip-0001-ai-coin-hanzos-native-currency.md`)
3. HIP-5: Post-Quantum Security for AI Infrastructure (`./hip-0005-post-quantum-security-for-ai-infrastructure.md`)
4. `hanzo-engine/src/poi.rs` — Freivalds core (`hanzoai/engine` v1.2.5)
5. `hanzo-engine/docs/proof-of-inference/forward-pass-commitment-design.md` — emission design
6. RFC 6962 — Certificate Transparency (Merkle lone-node promotion)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
