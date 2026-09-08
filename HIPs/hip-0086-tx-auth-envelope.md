---
hip: "0086"
title: TxAuthEnvelope (typed PQ transaction signing)
type: Standards Track
category: Cryptography
status: Final
implementation-go: shipped
author: Hanzo AI
created: 2026-05-11
requires: HIP-0005, HIP-0077, HIP-0078, HIP-0079, HIP-0084, HIP-0085
---


# HIP-0086: TxAuthEnvelope (typed PQ transaction signing)

## Abstract

HIP-0086 specifies **TxAuthEnvelope**, the canonical transaction
signing envelope under the strict-PQ profile. Every user-originated
transaction commits to `(chain_id, account_id, nonce, payload_hash,
profile_id, identity_scheme_id, hash_suite_id)` via a TupleHash256
transcript (SP 800-185) bound by the cust string `TX-AUTH-V1`, and is
authenticated by an ML-DSA-65 (FIPS 204) signature over the
transcript. The verifier is the unmodified FIPS 204 `ML-DSA.Verify`
routine; the envelope is the only thing a strict-PQ chain accepts at
the transaction boundary.

## Specification

Canonical reference: `luxfi/consensus/protocol/auth/tx_envelope.go`
(auth-pq-surface branch).

```
TxAuthEnvelope {
    version            uint8       = 0x01
    profile_id         uint8       // 0x01 Lux | 0x04 Zoo | 0x05 Hanzo
    identity_scheme_id uint8       = 0x42  // ML_DSA_65
    hash_suite_id      uint8       = 0x01  // SHA3_NIST
    chain_id           uint64
    account_id         [48]byte    // HIP-0085 AccountID
    nonce              uint64
    payload_hash       [48]byte    // SHA3-384 of canonical payload
    expiration         uint64      // unix seconds; 0 = none
    mldsa_pubkey       []byte      // ~1952 B FIPS 204 pubkey
    mldsa_signature    []byte      // ~3309 B FIPS 204 signature
}

transcript = TupleHash256(
    "TX-AUTH-V1",                  // cust string per SP 800-185
    [ version, profile_id, identity_scheme_id, hash_suite_id,
      chain_id_be8, account_id, nonce_be8, payload_hash,
      expiration_be8, mldsa_pubkey ],
    384                            // output bits = MinHashOutputBits
)

signature = ML-DSA.Sign(account_private_key, transcript)
```

Acceptance rule:

1. `profile_id` MUST equal the chain's pinned ProfileID; mismatch =
   reject (`ErrProfileMismatch`).
2. `identity_scheme_id` MUST equal `0x42`; any other value rejected.
3. `hash_suite_id` MUST equal `0x01`.
4. `AccountID == cSHAKE256(profile_be4 || chain_be4 || u8(scheme) || pubkey,
   48, "", "LUX_ACCOUNT_ID_V1")`, per HIP-0085.
5. `ML-DSA.Verify(mldsa_pubkey, transcript, mldsa_signature)` MUST
   return true under unmodified FIPS 204.
6. `nonce` MUST equal the account's next-expected nonce.
7. If `expiration != 0`, `now < expiration`.

Failure of any check is a hard reject; no fallback path.

## Backwards compatibility

None. Strict-PQ chains reject classical secp256k1 RLP transactions at
the consensus boundary. Permissive profiles (0x02) may accept both
during operator-controlled transition windows.

## Reference implementation

`luxfi/consensus/protocol/auth/tx_envelope.go` (auth-pq-surface).
Encoders / decoders: `luxfi/wallet/pq/tx.go`. KAT vectors:
`luxfi/consensus/protocol/auth/testdata/tx_envelope_v1.json`.

## Security considerations

The transcript binds `profile_id` and `chain_id`; a signature valid on
Lux mainnet is not valid on Zoo mainnet nor on a permissive sibling.
Replay across nonces is prevented by the account-scoped nonce check.
Replay across chains is prevented by chain_id. Replay across profiles
is prevented by the profile_id binding. ML-DSA-65 signatures are
~3309 B; an envelope at typical payload sizes is ~5.5 KB on the wire
— larger than secp256k1 but well within consensus budget.

## References

- HIP-0085 — AccountID derivation.
- HIP-0079 — sibling transcript pattern (Q-Block).
- NIST FIPS 204 — verifier target.
- NIST SP 800-185 — TupleHash256.
- NIST SP 800-57 — key management.
- `luxfi/consensus/config/profiles.go` — profile pin.
- `luxfi/consensus/protocol/auth/` — canonical implementation.

## Copyright

CC0.
