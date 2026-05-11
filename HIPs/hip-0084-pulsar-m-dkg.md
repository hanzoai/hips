---
hip: 0084
title: Pulsar-M — Threshold ML-DSA DKG & Signing
type: Standards Track
category: Cryptography
status: Draft
authors: Hanzo AI
requires: HIP-0005 (Post-Quantum Security), HIP-0077 (Mesh Identity), HIP-0078 (Z-Chain), HIP-0079 (Q-Chain)
---

## Abstract

Pulsar-M is the **threshold ML-DSA primitive** consumed by Q-Chain
finality (HIP-0079). It produces signatures byte-equal to single-party
FIPS 204 ML-DSA — the threshold-aggregated output verifies under the
unmodified FIPS 204 ML-DSA.Verify routine. Targeting NIST MPTC Class
N1 (signing) + N4 (ML keygen / DKG) per IR 8214C.

Pulsar-M is **distinct from** the cryptographic primitive
specification at `~/work/lux/pulsar-m/spec/pulsar-m.tex`. The spec
PDF is the NIST submission package; this HIP is the **deployment
contract** between Q-Chain (the consumer) and Pulsar-M (the
producer).

## Motivation

Q-Chain (HIP-0079) requires a single threshold signature per
finality block — small enough to fit a compact Q-Block envelope, but
secure under the same ML-DSA verifier ML-DSA-65 single-party uses.
Per-validator FIPS 204 sigs would inflate Q-Block size linearly with
committee size. A threshold variant collapses N signatures into one
without changing the verifier.

The HIP fixes the deployment-side parameters: committee size,
threshold, epoch cadence, transcript binding, abort handling,
identifiable-abort evidence shape. The cryptographic content
(protocol description, security games, parameter sets) lives in the
spec PDF and is the NIST MPTC submission.

## Specification

### Production defaults

| parameter             | value                                      | rationale                                              |
|-----------------------|--------------------------------------------|--------------------------------------------------------|
| sig scheme            | `0x52 Pulsar-M-65`                         | NIST PQ Cat 3, ML-DSA-65 verifier-compatible           |
| hash family           | `0x01 SHA3_NIST` (cSHAKE256/KMAC256/TupleHash256) | FIPS 202 + SP 800-185, FIPS-aligned             |
| committee size `n`    | 64                                         | balance of latency, communication cost, fault tolerance|
| BFT fault bound `f`   | 21                                         | n = 3f + 1                                             |
| threshold `t`         | 43                                         | t = 2f + 1                                             |
| corruption model      | honest majority at threshold layer         | Quorus-style; documented in spec §"Adversary model"    |
| DKG cadence           | once per epoch                             | not per block — DKG is heavy, signing is light         |
| epoch length          | network-configurable; default 1 hour       | tune operationally                                     |
| online signing        | preprocessing-enabled                      | offline rounds 1–2 + non-interactive online            |
| abort handling        | identifiable abort, signed evidence        | slashing-grade attribution                             |

High-value roots (governance, bridges, slashing, archival
checkpoints) use `0x53 Pulsar-M-87` (NIST PQ Cat 5). Devnet / testnet
may use `0x51 Pulsar-M-44` for fuzzing and CI; mainnet refuses 0x51.

### DKG flow

```
1. Validator registers ML-DSA-65 identity on Z-Chain (HIP-0078).
2. Z-Chain updates validator_registry_root.
3. Epoch boundary triggers committee selection.
4. Lux randomness beacon supplies committee_seed.
5. validator_registry_root + committee_seed → committee (64 of N).
6. committee_root posted to Z-Chain.
7. Pulsar-M DKG:
     Round 1: Pedersen commitments per party
     Round 2: share + blind delivery, recipient verification
     Round 3: complaint / abort with signed evidence
8. Output: group_public_key, party shares (s_i, u_i)
9. dkg_transcript_root + group_public_key_hash posted to Z-Chain.
10. Z-Chain proves committee membership, transcript validity, key derivation.
11. Q-Chain begins accepting finality blocks under group_public_key_hash.
```

### Online signing flow

```
For each Q-Block at height H:
  1. Driver computes canonical transcript hash (HIP-0079 §"Canonical transcript binding").
  2. Pulsar-M committee runs:
       Round 1: per-party commit (Gaussian-sampled mask)
       Round 2: per-party response (using share s_i, challenge c, mask)
  3. Aggregate: combine responses into FIPS 204 σ = (c̃, z, h).
  4. If rejection-sampling fails (||z|| > γ1 - β or ||r0|| > γ2 - β),
     restart with fresh masks. Restart is bounded; a committee that
     consistently fails restart has a misconfigured DKG and aborts
     identifiably.
  5. Signed σ is the Q-Block's threshold signature.
```

The 2-round threshold structure reuses Pulsar's R-LWE protocol
skeleton (`~/work/lux/pulsar`), retargeted to Module-LWE per the
spec PDF. Output is byte-equal to single-party FIPS 204 ML-DSA-65.

### Identifiable abort

A party that deviates produces a verifiable complaint:

```
Complaint {
    epoch                 uint64
    party_id              uint32
    deviation_type        enum     // BAD_COMMIT / BAD_SHARE / BAD_RESPONSE / TIMEOUT
    evidence              []byte   // protocol-specific witness
    complainer_signature  []byte   // ML-DSA-65 sig from a non-deviating party
}
```

Complaints are submitted to Z-Chain. A valid complaint with quorum
attribution slashes the deviating party's stake per the slashing
protocol (out of scope for this HIP).

### Wire format

The Q-Block (HIP-0079) carries `pulsar_m_threshold_signature` as
the standard FIPS 204 ML-DSA-65 byte encoding (3309 bytes for `0x52`,
4627 bytes for `0x53`). No threshold-specific framing on the wire —
the verifier is the unmodified FIPS 204 verifier.

The DKG ceremony's intermediate messages are encoded per the
Pulsar-M technical specification (`~/work/lux/pulsar-m/spec/pulsar-m.tex`,
§"Encodings", frozen at end-August 2026). DKG transcripts post to
Z-Chain as a Merkle root over the canonical-encoded message log;
individual messages are retrievable via DA layer.

### Group public key

The group public key produced by Pulsar-M DKG is a valid FIPS 204
ML-DSA-65 public key — distributed uniformly over the public-key
space, indistinguishable from a single-party `ML-DSA.KeyGen` output
under M-LWE assumption (see spec PDF §"Output indistinguishability").
This is the entire point of the Pulsar-M family: the threshold
ceremony produces a key the broader ecosystem accepts as ML-DSA-65.

## NIST submission posture

This HIP describes the **deployment** of Pulsar-M into Lux
infrastructure. The **NIST MPTC submission** is the spec PDF + Go
reference implementation + KAT suite + experimental-evaluation
report at `~/work/lux/pulsar-m`, target package deadline 2026-Nov-16.

| MPTC dimension          | Pulsar-M target                                  |
|-------------------------|--------------------------------------------------|
| class                   | N (NIST-specified primitive)                     |
| subclass                | N1 (signing) + N4 (ML keygen / DKG)              |
| primitive               | ML-DSA / FIPS 204                                |
| interchangeability      | unmodified FIPS 204 verifier accepts σ           |
| hash family             | SHAKE256 / cSHAKE256 / KMAC256 / TupleHash256    |
| security target         | NIST PQ Cat 3 (suggested); Cat 2 + Cat 5 also shipped |
| primary parameter set   | Pulsar-M-65 (mainnet); Pulsar-M-44 + -87 (additional)  |

Baseline references:

- **Quorus** — primary baseline. MPC-friendly ML-DSA variant, FIPS 204-compatible verification, DKG, threshold signing with offline preprocessing. Honest-majority assumption. Scales to ~64 parties. NIST MPTC preview submission.
- **Mithril** — small-N latency baseline (N ≤ 8). Useful for bridge / sequencer / wallet committees, not for the public-validator path.
- **Olingo** — robustness + identifiable-abort design reference. Raccoon-based.

## Security considerations

- **Adversary model.** Static + adaptive corruption up to t-1 = 42
  parties per epoch. Adaptive corruption proof is a stretch goal for
  the round-1 MPTC submission and a hard requirement for round 2.
- **Mobile adversary.** Across epochs, HJKY97-style mobile adversary;
  proactive resharing is the defence (epoch boundaries reset
  share material). Spec §"MOB" has the formal game.
- **Rejection-restart non-leakage.** Per-round PRNG keying domain-
  separated by `(sid, κ, T)` so multi-attempt sign on same `(pk, μ)`
  doesn't leak across restarts. Spec §"RESTART-NL".
- **Beacon-quorum binding.** Reshare quorum is beacon-randomised, not
  deterministic. Closes HIP-0077 red-review F10.
- **No application-level logging in secret-touching paths.** Pulsar-M
  reference implementation enforces this via a no-secret-logs CI gate.
- **Constant-time reshare.** F9 fix (`dkg2.constTimePolyEqual` pattern)
  ports forward into Pulsar-M's reshare path.

## Production safety

- **DKG cadence pinned at epoch boundaries.** Per-block DKG is
  forbidden — too slow, too fragile, defeats the offline/online split.
- **Committee bound to Z-Chain root.** A Pulsar-M ceremony whose
  participants don't match `committee_root` is rejected by Q-Chain
  acceptance check (HIP-0079 §"Acceptance rule" item 4).
- **Group public key bound to Z-Chain.** A signature against a
  group key not in `group_public_key_hash` is refused.

## Adoption order

1. Pulsar-M reference implementation (`~/work/lux/pulsar-m/ref/go/`)
   completes through Sign + Verify with KAT cross-validation against
   FIPS 204 reference.
2. KAT suite freezes at end-August 2026 (encoding-freeze gate).
3. Pulsar-M `mptc-preview-2026` tag cut.
4. NIST MPTC package submitted 2026-Nov-16.
5. Lux validator-side integration: `consensus/protocol/quasar/`
   gains a Pulsar-M producer that satisfies the QWitnessProducer
   interface.
6. Z-Chain integration: DKG transcripts post to Z-Chain via the
   identity-registry path (HIP-0078 §"Z-Chain proof obligations").
7. Q-Chain integration: Q-Block envelope (HIP-0079) consumes
   Pulsar-M-65 signatures.

## References

- FIPS 204 — Module-Lattice-Based Digital Signature Standard.
- FIPS 202 + NIST SP 800-185 — SHA-3 family + cSHAKE/KMAC/TupleHash.
- NIST IR 8214C — First Call for Multi-Party Threshold Schemes.
- Quorus — NIST MPTC preview (primary baseline).
- Mithril — NIST MPTC preview (small-N benchmark).
- Olingo — ePrint 2025/1789 (robustness reference).
- Boschini, Kaviani, Lai, Malavolta, Takahashi, Tibouchi — *Corona* — ePrint 2024/1113 (R-LWE protocol skeleton).
- Pulsar-M technical specification — `~/work/lux/pulsar-m/spec/pulsar-m.tex`.
- HIP-0077 — Mesh Identity (parent).
- HIP-0078 — Z-Chain (identity rollup that anchors DKG transcripts + group keys).
- HIP-0079 — Q-Chain (consumer of Pulsar-M signatures).
