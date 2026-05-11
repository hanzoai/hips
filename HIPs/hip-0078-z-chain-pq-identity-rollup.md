---
hip: 0078
title: Z-Chain — Post-Quantum Identity & Attestation Rollup
type: Standards Track
category: Infrastructure
status: Draft
authors: Hanzo AI
requires: HIP-0005 (Post-Quantum Security), HIP-0070 (Quantum Computing), HIP-0077 (Mesh Identity, Gossip & Payments), HIP-0079 (Q-Chain Finality Blocks), HIP-0084 (Pulsar-M DKG)
---

## Abstract

Z-Chain is the post-quantum rollup for **bulky identity, validator-set,
DKG-transcript, and attestation state** on the Lux primary network. It
is **post-quantum from v1** — STARK / FRI over Goldilocks with
cSHAKE-256 Merkle commitments. Pairing-based proof systems
(Groth16 / BN254, KZG) are explicitly forbidden on the wire and
refused by the strict-PQ verifier; the wire reserves IDs for them so
audit pipelines name a misconfiguration precisely.

Z-Chain is the **identity layer**. Q-Chain (HIP-0079) is the
**finality layer**. Pulsar-M (HIP-0084) is the **threshold-signing
primitive** Q-Chain consumes. The three layers replace the prior
single-chain "all of the above" design with a compact, fully-PQ stack:

```
Lux primary network
├── Q-Chain   (HIP-0079)  small finality blocks, frequent, consensus-critical
├── Z-Chain   (HIP-0078)  PQ STARK/FRI rollup, bulky identity / validator state
└── Pulsar-M  (HIP-0084)  threshold ML-DSA DKG + signing (consumed by Q-Chain)
```

The core principle: **ML-DSA-65 identity material does not enter every
finality block.** Z-Chain holds the bulky state; Q-Chain references its
roots; Pulsar-M produces the threshold cert that finalises the Q-Block.

## Motivation

ML-DSA-65 public keys are 1.95 KB; signatures 3.31 KB (FIPS 204
Table 2). For a 64-validator committee, validator-set state runs to
hundreds of kilobytes per epoch. Naively duplicating that into every
finality block makes mainnet bandwidth dominated by static identity
material; finality stalls every time the committee rotates.

The fix is a rollup chain that proves identity-state transitions and
exposes only their roots to consensus — a standard L2 pattern applied
to validator identity, but with the rollup proof system itself
constrained to be PQ.

The earlier `quasar` mode (HIP-0077) rolled per-validator ML-DSA sigs
into a Groth16 proof on a chain we initially called Z-Chain — but
Groth16/BN254 is pairing-based, classically broken under Shor. That
collapses the defense-in-depth claim. HIP-0078 fixes this by mandating
a STARK / FRI / SHA-3 rollup as the **v1** Z-Chain — not "later PQ",
PQ from genesis. Groth16/BN254 is the explicit anti-pattern.

## Specification

### Chain roles

| chain      | purpose                              | content                                                                | size profile        |
|------------|--------------------------------------|------------------------------------------------------------------------|---------------------|
| Q-Chain    | Quasar finality (HIP-0079)           | compact finality blocks + roots                                        | small, per-block    |
| Z-Chain    | identity & attestation rollup (this HIP) | validator registry, DKG transcripts, revocations, epoch commitments  | bulky, per-epoch    |
| Pulsar-M   | threshold signing (HIP-0084)         | DKG ceremony state, threshold sigs                                     | per-epoch + per-block |

Q-Chain references Z-Chain roots; Z-Chain produces those roots; the
two chains are linked by `EpochCommitment` records and the rule that
Q-Chain finality MUST anchor to the latest accepted Z-Chain epoch root.

### Z-Chain state

```
ZState {
    validator_registry_root      // hash-based authenticated tree
    identity_root                 // ML-DSA-65 pubkey commitments
    revocation_root               // revoked / rotated keys
    stake_weight_root             // weights, slashing positions
    dkg_epoch_root                // accepted DKG transcripts
    committee_selection_root      // current epoch's committee derivation
    slashing_root                 // pending and applied slashes
}
```

Every root is a hash-based authenticated tree head (Merkle / hash
accumulator). No KZG, no pairing-friendly accumulators, no curve-based
commitments. Hash family is exclusively FIPS 202 / SP 800-185.

### EpochCommitment

```
EpochCommitment {
    version                  uint16
    network_id               uint32
    chain_id                 uint32
    epoch                    uint64
    hash_suite_id            HashSuiteID    // = 0x01 SHA3_NIST canonical
    sig_scheme_id            SigSchemeID    // = 0x52 Pulsar-M-65 default; 0x53 for high-value roots
    proof_system_id          ProofSystemID  // = 0x10 STARK_FRI_SHA3_PQ canonical
    validator_registry_root  [32]byte
    identity_root            [32]byte
    revocation_root          [32]byte
    stake_weight_root        [32]byte
    committee_root           [32]byte
    dkg_transcript_root      [32]byte
    group_public_key_hash    [32]byte
    zchain_state_root        [32]byte
    previous_epoch_commitment_hash [32]byte
}
```

Each Q-Block (HIP-0079) MUST bind `zchain_state_root`,
`validator_set_root`, `committee_root`, `dkg_transcript_root`, and
`group_public_key_hash` to the latest accepted EpochCommitment for the
current epoch.

### Z-Chain proof obligations (v1)

Z-Chain produces a STARK proof per epoch transition that establishes:

1. **Validator registration is valid.** ML-DSA-65 identity signature
   verifies against the registering pubkey under unmodified FIPS 204
   ML-DSA.Verify.
2. **Validator update is valid.** Previous key authorized the
   rotation to the new key (signed transition).
3. **Revocation is valid.** Revocation key or governance-path
   signature authorized the removal.
4. **Stake / weight update is valid.** Update follows the staking
   protocol; sum-conservation; no negative weights.
5. **Committee selection is valid.** Selected committee derives
   deterministically from `validator_registry_root` plus the epoch
   randomness beacon (Lux randomness layer; out of scope for this HIP).
6. **DKG participant set matches committee.** Pulsar-M DKG
   participants = `committee_root` entries; no impostors.
7. **DKG transcript commitment is valid.** Transcript root matches
   the accepted public messages from the Pulsar-M ceremony
   (HIP-0084 §"Transcript binding").
8. **`group_public_key_hash` corresponds to accepted DKG output.**
9. **Q-Chain reference is consistent.** Q-Block height that triggered
   the epoch transition has roots consistent with this EpochCommitment.

Out of scope for v1: per-block threshold-signing transcripts.
Threshold sigs verify directly at Q-Chain via Pulsar-M's
public-key-based verifier; their soundness does not need a Z-Chain
proof.

### Proof system

**ProofSystemID = `STARK_FRI_SHA3_PQ` (0x10) is the only acceptable
production proof system.**

| ID    | name                                | status      |
|-------|-------------------------------------|-------------|
| 0x00  | None                                 | wire-only (no proof in this slot)        |
| 0x10  | `STARK_FRI_SHA3_PQ`                  | **canonical** — Plonky3-style, cSHAKE256 Merkle + Fiat-Shamir |
| 0x11  | `STARK_FRI_KECCAK_PQ`                | secondary — Keccak Merkle (FIPS 202; valid PQ alternative)    |
| 0x20  | `RISC_ZERO_STARK_RAW`                | engineering prototype only — raw STARK receipt, no Groth16 wrapper |
| 0x21  | `PLONKY3_STARK_FRI`                  | engineering prototype; Plonky3 toolkit direct use             |
| 0x80  | `GROTH16_BN254_CLASSICAL_FORBIDDEN_IN_PQ` | refusal marker — never produced in strict-PQ mode        |
| 0x81  | `KZG_CLASSICAL_FORBIDDEN_IN_PQ`      | refusal marker                                                |

Strict-PQ verifiers MUST refuse any cert whose `proof_system_id`
returns true from `ProofSystemID.IsForbiddenInPQMode()`.

### Reference implementation

**Recommendation: Plonky3 fork with cSHAKE256 Merkle + Fiat-Shamir.**

Sourcing notes:
- Plonky3 is a polynomial-IOP toolkit; we use its FRI + Merkle + AIR
  primitives but swap the default Keccak/SHA-256 hash for cSHAKE256
  to align with FIPS 202 / SP 800-185 normative.
- Plonky3's verifier has documented caveats (panic-on-malformed-proof
  warnings in its README); strict-PQ deployments MUST wrap the
  verifier with malformed-proof fuzzing as a launch gate.
- RISC Zero raw STARK (`0x20`) is acceptable as an engineering
  prototype path for proving the identity-registry state machine in
  Rust/RISC-V. **Strict-PQ mainnet MUST NOT use the Groth16 receipt;
  use only the raw STARK / FRI receipt path.** RISC Zero default
  parameters target ~98-bit conjectured security per their docs;
  production Z-Chain MUST configure to ≥ 128-bit classical and
  ≥ NIST PQ Cat 3 (matching ML-DSA-65 / Pulsar-M-65) and document
  the parameter choice in the spec.

The custom Plonky3-PQ fork lives at `~/work/lux/plonky3-pq` (planned
location); audit gate is mandatory before mainnet activation.

### Cert envelope changes

Q-Chain finality certs (HIP-0079) add three explicit fields when a
proof is attached (epoch boundaries, Z-Chain anchor updates):

```
proof_system_id    ProofSystemID  // 0x10 normative; cert is refused if 0x80 / 0x81
zchain_state_root  [32]byte       // anchors the latest accepted EpochCommitment
zchain_proof       []byte         // optional: Z-Chain proof bytes
```

`ProofSystemID` is bound into `Certificate.TranscriptHash()` per the
HIP-0077 F1 fix pattern; a flipped byte breaks signature verification.

### Verifier API

Strict-PQ verifier (Go reference):

```go
func VerifyZChainEpochProof(
    ctx        context.Context,
    proof      []byte,
    publicIn   ZChainPublicInputs,
    suiteID    config.HashSuiteID,    // must == HashSuiteSHA3NIST (0x01)
    proofSysID config.ProofSystemID,  // must == ProofSystemSTARKFRISHA3PQ (0x10)
) error
```

Constant-time guarantees: verifier MUST run in time independent of
proof contents on accepted vs rejected proofs. Memory budget: ≤ 64 MB
per verification on standard validator hardware.

### Migration

**Phase 1 (today).** Quasar mode emits per-validator ML-DSA-65 sigs
in the Q witness slot. No rollup proof. Cert size linear in committee
size; tolerable up to ~32 validators.

**Phase 2 (Z-Chain v1 ships).** Strict-PQ STARK/FRI/SHA-3 prover
goes live at `~/work/lux/plonky3-pq`. Q-Block envelope gains
`proof_system_id` field. Existing Q-Chains begin emitting
`proof_system_id = 0x00` until they upgrade. Forbidden markers
(0x80, 0x81) become refusal triggers.

**Phase 3 (mandatory).** Flag day announced 6 months ahead.
Post-flag-day, Q-Block certs without a valid
`proof_system_id = 0x10` proof are refused. Validator identity moves
to Z-Chain. Pulsar-M DKG transcripts post to Z-Chain. Q-Chain
becomes pure finality spine; Z-Chain holds all bulky state.

## Security considerations

- **No classical primitive in the trust path.** Hash, commitment,
  Fiat-Shamir, recursion — all FIPS 202 / SP 800-185. The `0x80` and
  `0x81` ProofSystemIDs are explicit forbidden markers, not fallback.
- **STARK soundness reduces to hash-collision resistance.** cSHAKE256
  is FIPS-approved; PQ-secure under classical and quantum models.
  Round-by-round soundness via the standard FRI analysis (Block et
  al., ASIACRYPT 2023 and follow-ups).
- **Validator-set tampering.** A malicious validator-set update must
  produce a valid Z-Chain proof; without it, Q-Chain refuses the
  EpochCommitment. Trust delegation: from Q-Chain consensus to
  Z-Chain proof-system soundness.
- **Recursion-overflow.** Plonky3 recursion has constant proof size
  but prover budget grows with depth. Cap recursion depth at
  network-wide config; refuse certs above the cap.
- **DA assumption.** Z-Chain state must be retrievable. v1 uses Lux
  DA layer (out of scope for this HIP). DA failure → validators
  cannot produce new Z-Chain proofs → Q-Chain stalls. This is the
  correct failure mode (chain halt, not validator compromise).
- **End-to-end security claim.** The mainnet headline security
  level is bounded by `min(Pulsar-M parameter set, Z-Chain proof
  configuration)`. If Z-Chain proof is configured at 98-bit
  conjectured security, the chain MUST NOT advertise NIST PQ Cat 3
  end-to-end. Configure to ≥ 128-bit classical / ≥ Cat 3 PQ to
  match Pulsar-M-65.

## Adoption order

1. Plonky3 fork with cSHAKE256 Merkle + Fiat-Shamir lands at
   `~/work/lux/plonky3-pq`.
2. Reference Z-Chain prover implements obligations 1–9 against a
   mock validator set.
3. KAT cross-validation: each validator-registration proof verifies
   an actual ML-DSA-65 sig under unmodified FIPS 204 ML-DSA.Verify.
4. Verifier-totality fuzzing — every malformed proof returns an
   error, never panics.
5. External cryptanalysis engagement (start 2026 Q3).
6. Q-Block envelope (HIP-0079) gains `proof_system_id`.
7. Phase 2 ships behind feature flag.
8. Phase 3 mandatory; flag day published.

## References

- FIPS 204 — *Module-Lattice-Based Digital Signature Standard*.
- FIPS 202 — *SHA-3 Standard: Permutation-Based Hash and Extendable-Output Functions*.
- NIST SP 800-185 — *cSHAKE / KMAC / TupleHash / ParallelHash*.
- NIST IR 8214C — *First Call for Multi-Party Threshold Schemes*.
- Plonky3 — https://github.com/Plonky3/Plonky3
- Block, Garreta, Riahi, Tang — *"Fiat-Shamir Bulletproofs are Non-Malleable"* (FRI round-by-round-soundness analogue), ASIACRYPT 2023.
- RISC Zero zkVM whitepaper.
- HIP-0077 — Mesh Identity, Gossip & Payments (parent).
- HIP-0079 — Q-Chain Finality Blocks (consumer of Z-Chain roots).
- HIP-0084 — Pulsar-M DKG (consumer of Z-Chain identity state).
