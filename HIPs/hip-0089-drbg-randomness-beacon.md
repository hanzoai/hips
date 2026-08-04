---
hip: 0089
title: DRBG / Randomness Beacon (SP 800-90A/B)
type: Standards Track
category: Cryptography
status: Draft
author: Hanzo AI
created: 2026-05-11
requires: HIP-0005 (Post-Quantum Security), HIP-0077, HIP-0078, HIP-0079, HIP-0084
---



# HIP-0089: DRBG / Randomness Beacon (SP 800-90A/B)

## Abstract

HIP-0089 specifies the randomness beacon and DRBG (Deterministic
Random Bit Generator) construction under the strict-PQ profile,
together with the SP 800-90B health testing and conditioning the
entropy feeding it must pass. The
beacon emits per-block randomness derived from a `Hash-DRBG` (NIST SP
800-90A Rev. 1, §10.1) instantiated over SHA3-384, reseeded each epoch
from a quantum-random entropy source supplemented with
beacon participants' ML-DSA-65 contributions threshold-aggregated via
Pulsar-M (HIP-0084). The beacon output is bound into Q-Chain blocks
via the existing TupleHash256 transcript (HIP-0079). LP-131's
ECVRF-Ed25519 randomness is classical and explicitly NOT used under
strict-PQ.

## Motivation

Path 13 of the LUX_STRICT_E2E_PQ coverage matrix is partial: quantum
entropy is available but bound to no SP 800-90A DRBG construction, and
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
    seed_material = entropy_in (≥ 384 bits of conditioned QRNG)
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

### Entropy source validation (SP 800-90B)

`entropy_in` is only as good as the source behind it, so the QRNG
is validated continuously per SP 800-90B rather than
sampled and trusted. Two online health tests run on every sample,
permanently.

**Repetition count** detects a stuck source. It tracks the longest run
of identical consecutive samples and alarms when the run exceeds

```
C = 1 + ceil(-log2(alpha) / H_min)
```

where `alpha` is the false-positive probability (2^-20) and `H_min` is
the assessed min-entropy per sample.

**Adaptive proportion** detects a biased source. Over a sliding window
of W samples (512 or 1024) it counts occurrences of the most recent
sample value and alarms when that count exceeds the cutoff for the
claimed `H_min`.

At startup, and after any device reconnect, a source MUST pass 1,024
consecutive samples through both tests before one bit of its output
reaches the DRBG. On failure the source is quarantined immediately,
the failure is counted and alerted, and instantiation and reseed draw
from the remaining healthy sources.

**A quarantined source MUST NOT be replaced by a classical PRNG.** If
every quantum source is quarantined, instantiation and reseed fail and
the beacon stalls. A stalled beacon is a detected liveness fault; a
silently classical one is an undetected soundness fault, and under
strict-PQ the second is not a degraded mode of the first.

### Conditioning

Raw quantum bits are near-uniform, not uniform: dark counts, intensity
fluctuation and digitization each leave bias. Entropy is conditioned
before it becomes `entropy_in`, and the conditioner MUST be a strong
extractor rather than a hash of convenience.

```
Raw quantum bits
    |
    v
Von Neumann debiasing (optional pre-filter)
    |
    v
SP 800-90B health tests (continuous)
    |
    v
Toeplitz hashing (primary extractor)
    |
    v
entropy_in -> instantiation / reseed
```

**Toeplitz hashing is the primary extractor.** It is a strong
extractor by the Leftover Hash Lemma, needs only a short seed — the
first row of the matrix, fixed per device and stored with it — to
process arbitrarily long input, and costs O(n log n) via FFT. Output
length follows the entropy deficit:

```
m = n * H_min - 2*log2(1/epsilon)
```

for `n` raw input bits, min-entropy `H_min` per bit, and statistical
distance `epsilon` from uniform.

**Von Neumann debiasing** — emit the first bit of a differing pair,
discard equal pairs — removes first-order bias only, never higher-order
correlation. It is a pre-filter, or a fallback where Toeplitz
extraction is infeasible, and never the extractor on its own.

Because instantiation and each reseed consume ≥ 384 conditioned bits,
the raw draw per reseed is `(384 + 2*log2(1/epsilon)) / H_min` bits.
The extraction ratio, not the raw sample rate, is what the epoch
cadence must be budgeted against.

## Rationale

Hash-DRBG over SHA3-384 is the FIPS-aligned PQ-friendly construction
in SP 800-90A: hash-only (no symmetric block cipher), no AES-CTR
dependency, and matches the strict-PQ profile's 384-bit hash floor.
QRNG entropy provides PQ-source seed material; Pulsar-M
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
- HIP-0079, HIP-0084 — Q-Chain transcript and Pulsar-M.
- LP-131 — ECVRF (classical, explicitly NOT used under strict-PQ).
- `luxfi/consensus/protocol/auth/beacon.go`.

## Copyright

CC0.
