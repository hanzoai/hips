---
hip: 0098
title: Governance / Upgrade Keys (ML-DSA-87 / SLH-DSA cold roots)
type: Standards Track
category: Cryptography
status: Proposed
author: TBD
created: 2026-05-11
requires: HIP-0005 (Post-Quantum Security), HIP-0077, HIP-0078, HIP-0079, HIP-0084, HIP-0085, HIP-0086
---

## Abstract

HIP-0098 specifies the **governance and upgrade-key scheme** under
the strict-PQ profile. Routine governance (DAO proposals, parameter
votes) is authenticated by ML-DSA-87 (FIPS 204, NIST PQ Cat 5),
threshold-aggregated via Pulsar-M-87 (HIP-0084 high-value mode).
Cold-root upgrade keys (genesis, network-upgrade, slashing-pause,
emergency-stop) use SLH-DSA-256s (FIPS 205, stateless hash-based,
break-glass-grade) under a `k-of-n` multi-signature scheme with `k ≥
⌈2n/3⌉ + 1`. The two-tier separation (lattice-based for warm
governance, hash-based for cold trust roots) provides defense-in-depth:
loss of one cryptanalytic assumption does not lose the upgrade path.

## Motivation

Paths 10 and 11 of the LUX_STRICT_E2E_PQ coverage matrix are hard
gaps. LP-085 / LP-086 (Lux DAO + Governor) are entirely classical
(secp256k1, BLS). ZIP-0017 (Zoo DAO Governance) likewise. LP-071
specifies SLH-DSA as a "break-glass" primitive but no spec locks it as
the cold-root upgrade-key scheme. Without HIP-0098, mainnet activation
of the strict-PQ profile is impossible — the upgrade path itself
remains a classical island that can be compromised by Shor.

## Specification

Canonical reference: `luxfi/consensus/protocol/auth/governance.go`
(auth-pq-surface branch).

### Warm governance (frequent)

```
GovernanceAuthorization {
    profile_id           uint8
    identity_scheme_id   uint8   = 0x43  // ML_DSA_87
    hash_suite_id        uint8   = 0x01
    chain_id             uint64
    governance_action_id [32]byte // SHA3-256 of proposal canonical bytes
    nonce                uint64
    threshold_pubkey_hash [48]byte // Pulsar-M-87 group key hash
    pulsar_m_signature   []byte   // ~4627 B FIPS 204 ML-DSA-87 sig
}

transcript = TupleHash256(
    "GOV-WARM-V1",
    [ profile_id, identity_scheme_id, hash_suite_id, chain_id_be8,
      governance_action_id, nonce_be8, threshold_pubkey_hash ],
    384
)
```

Verifier: unmodified `ML-DSA.Verify` at parameter set 87.
Threshold-aggregated output verifies as single-party FIPS 204 ML-DSA-87.

### Cold-root upgrade

```
ColdUpgradeAuthorization {
    profile_id            uint8
    identity_scheme_id    uint8   = 0x70  // SLH-DSA-256s (FIPS 205)
    hash_suite_id         uint8   = 0x01
    chain_id              uint64
    upgrade_root_hash     [48]byte // canonical hash of upgrade descriptor
    quorum_threshold_k    uint8
    quorum_size_n         uint8
    signers []{
        slhdsa_pubkey  []byte   // ~64 B SLH-DSA-256s pubkey
        slhdsa_sig     []byte   // ~29792 B SLH-DSA-256s signature
    }
}

transcript = TupleHash256(
    "COLD-UPGRADE-V1",
    [ profile_id, identity_scheme_id, hash_suite_id, chain_id_be8,
      upgrade_root_hash, k_byte, n_byte ],
    384
)
```

Acceptance:

1. `k ≥ ⌈2n/3⌉ + 1`; `n ≥ 5` for mainnet, `n ≥ 3` for tenant chains.
2. Each `signers[i].slhdsa_pubkey` is a registered cold-root pubkey
   in the chain's genesis or last cold-rotation transaction.
3. Each `signers[i].slhdsa_sig` verifies under unmodified
   `SLH-DSA.Verify` against `transcript`.
4. At least `k` distinct valid signatures present.

Cold rotation is itself a cold-root-authorised action; rotation
cadence at least every 4 years (matches SLH-DSA-256s long-lived key
profile).

## Rationale

ML-DSA-87 for warm governance: same algorithm family as identity,
single verifier in code, threshold-aggregable via Pulsar-M-87. SLH-DSA
for cold roots: hash-based security relies only on SHA-3 collision
resistance — orthogonal to lattice assumptions in ML-DSA. Loss of
M-LWE security under future cryptanalysis still leaves SLH-DSA intact
to authorise emergency upgrades. The two-tier separation matches NIST
SP 800-57 Part 1 Rev. 5 §5.6.1 cryptoperiod guidance for long-lived
keys.

## Backwards compatibility

None. Classical secp256k1 and BLS governance signatures are refused
under strict-PQ at the chain-upgrade-acceptance boundary. The LP-085 /
LP-086 / ZIP-0017 governance contracts must be re-deployed against
HIP-0098 verifiers before profile activation.

## Reference implementation

`luxfi/consensus/protocol/auth/governance.go` (auth-pq-surface).
ML-DSA-87 binding: `luxfi/crypto/mldsa/level5`. SLH-DSA binding:
`luxfi/crypto/slhdsa`. KAT vectors:
`luxfi/consensus/protocol/auth/testdata/governance_v1.json`.

## Security considerations

SLH-DSA-256s signatures are large (~30 KB) and slow (~ms-seconds to
sign); this is acceptable for cold-root operations that fire once per
network-upgrade. The stateless variant `s` is used rather than the
fast variant `f` to bound signature size and verification time at the
expense of signing time — cold roots prioritise verifier cost and
proof brevity. ML-DSA-87 signatures (~4627 B) are larger than ML-DSA-65
but the high-value cadence (governance, bridge cap moves, treasury)
is low enough that on-chain bandwidth impact is negligible.
Defense-in-depth: a hypothetical break of lattice assumptions cannot
unlock upgrade rights; a hypothetical SHA-3 break cannot unlock
warm-governance rights.

## References

- NIST FIPS 204 — ML-DSA (parameter set 87).
- NIST FIPS 205 — SLH-DSA primitive.
- NIST SP 800-57 — key-management guidance.
- LP-070, LP-071, LP-073 — primitive specs.
- HIP-0084 — Pulsar-M-87 high-value mode.
- `luxfi/consensus/protocol/auth/governance.go`.

## Copyright

CC0.
