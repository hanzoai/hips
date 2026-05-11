---
hip: 0089
title: DRBG / Randomness Beacon (SP 800-90A)
type: Standards Track
category: Cryptography
status: Proposed
authors: TBD
created: 2026-05-11
requires: HIP-0005 (Post-Quantum Security), HIP-0073 (QRNG), HIP-0077, HIP-0078, HIP-0079, HIP-0084
---

## Abstract

HIP-0089 specifies the randomness beacon and DRBG (Deterministic
Random Bit Generator) construction under the strict-PQ profile. The
beacon emits per-block randomness derived from a `Hash-DRBG` (NIST SP
800-90A Rev. 1, §10.1) instantiated over SHA3-384, reseeded each epoch
from a HIP-0073 quantum-random entropy source supplemented with
beacon participants' ML-DSA-65 contributions threshold-aggregated via
Pulsar-M (HIP-0084). The beacon output is bound into Q-Chain blocks
via the existing TupleHash256 transcript (HIP-0079). LP-131's
ECVRF-Ed25519 randomness is classical and explicitly NOT used under
strict-PQ.

## Motivation

Path 13 of the LUX_STRICT_E2E_PQ coverage matrix is partial: HIP-0073
covers QRNG entropy but does not bind to SP 800-90A DRBG construction;
LP-131 specifies ECVRF-Ed25519-SHA512 — entirely classical. Without a
locked PQ randomness beacon, validator-committee selection, leader
election, and on-chain randomness (used by lotteries, NFT drops,
zk-coin shuffles, the Pulsar-M committee seed in HIP-0084) all run on
either classical primitives or undefined-quality entropy. The strict-PQ
profile requires the entire randomness chain to be FIPS 203/204/205
compatible.

## Specification

Canonical reference: `luxfi/consensus/protocol/auth/beacon.go`
(auth-pq-surface branch).

```
HashDRBG state (per SP 800-90A §10.1.1):
    V                 [48]byte    // 384-bit internal state
    C                 [48]byte    // 384-bit constant
    reseed_counter    uint64
    security_strength = 256       // FIPS PQ Cat 5 floor

instantiation:
    seed_material = entropy_in (≥ 384 bits from HIP-0073 QRNG)
                  || nonce_in    (≥ 192 bits)
                  || personalization "LUX-BEACON-V1"
    V = SHA3-384("INIT" || seed_material)
    C = SHA3-384("CONST" || V || seed_material)
    reseed_counter = 1

generate(num_bits):
    output ← SHA3-384(V) truncated/extended to num_bits
    V = (V + C + reseed_counter) mod 2^384
    reseed_counter += 1
    return output

reseed:
    triggered at epoch boundary OR when reseed_counter ≥ 2^48
    additional_input = QRNG entropy ⊕ Pulsar-M aggregated contribution
    V = SHA3-384("RESEED" || V || additional_input)
    reseed_counter = 1
```

Per-block beacon output:

```
beacon_round(H) = HashDRBG.generate(384)
beacon_commit(H) = TupleHash256(
    "BEACON-V1",
    [ height_be8, beacon_round(H), epoch_be8, drbg_state_root ],
    384
)
```

`beacon_commit(H)` is included in the Q-Block transcript (HIP-0079
clause 7) and signed by Pulsar-M-65. Subsequent randomness consumers
(committee selection, leader election, on-chain RNG opcode) derive
their values via TupleHash256 with consumer-specific cust strings
(`COMMITTEE-V1`, `LEADER-V1`, `RNG-V1`).

## Rationale

Hash-DRBG over SHA3-384 is the FIPS-aligned PQ-friendly construction
in SP 800-90A: hash-only (no symmetric block cipher), no AES-CTR
dependency, and matches the strict-PQ profile's 384-bit hash floor.
QRNG entropy (HIP-0073) provides PQ-source seed material; Pulsar-M
aggregation prevents any single validator from biasing the beacon.
Epoch-cadence reseed bounds backtracking resistance. Per SP 800-90A
§8.3, security strength 256 matches NIST PQ Cat 5.

## Backwards compatibility

None. Strict-PQ refuses ECVRF-Ed25519 (LP-131) at the consensus
boundary. The classical VRF lives only on permissive profiles.
Existing contracts using `block.difficulty` / RANDAO-style opcodes
read from the PQ beacon directly under strict-PQ.

## Reference implementation

`luxfi/consensus/protocol/auth/beacon.go` (auth-pq-surface).
QRNG source binding: `luxfi/qrng` adapter. KAT vectors:
`luxfi/consensus/protocol/auth/testdata/hash_drbg_v1.json`. The
generator passes the NIST CAVP DRBGVS test vectors for Hash-DRBG /
SHA-3 family.

## Security considerations

Hash-DRBG provides backtracking resistance via the additive `V + C +
counter` update; an attacker who observes the current state cannot
recover prior outputs without inverting SHA3-384. Forward-prediction
resistance is provided by periodic reseed (every epoch or 2^48
generates). Pulsar-M committee threshold over QRNG contributions
prevents single-validator bias; a Byzantine subset below threshold
cannot influence the beacon. Beacon output is bound into Q-Block
transcripts, so post-finality tampering is impossible without
invalidating Pulsar-M-65 finality.

## References

- NIST SP 800-90A Rev. 1 — DRBG constructions.
- NIST SP 800-90B — entropy sources.
- NIST FIPS 202 + SP 800-185 — SHA-3 family.
- HIP-0073 — QRNG entropy source.
- HIP-0079, HIP-0084 — Q-Chain transcript and Pulsar-M.
- LP-131 — ECVRF (classical, explicitly NOT used under strict-PQ).
- `luxfi/consensus/protocol/auth/beacon.go`.

## Copyright

CC0.
