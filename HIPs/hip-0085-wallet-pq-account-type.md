---
hip: 0085
title: Wallet PQ Account Type (ML-DSA-65 native, 48-byte AccountID)
type: Standards Track
category: Cryptography
status: Proposed
author: TBD
created: 2026-05-11
requires: HIP-0005 (Post-Quantum Security), HIP-0077 (Mesh Identity), HIP-0078 (Z-Chain), HIP-0079 (Q-Chain), HIP-0084 (Pulsar-M DKG)
---

## Abstract

HIP-0085 specifies the **native PQ wallet account type** under the
strict-PQ profile. The primary on-chain identifier is a 48-byte
`AccountID` derived deterministically from an ML-DSA-65 (FIPS 204)
public key. HD derivation follows BIP-32 with the canonical Lux path
`m / 44' / 9000' / nid' / 0 / n`. A 20-byte EVM-compatibility address
is also defined as a `Keccak-256` truncation of the same public key,
but the AccountID is the primary identifier; the 20-byte form is a
compatibility projection. Wallet vendors target this HIP to ship a
single canonical PQ account format across Hanzo, Lux, and Zoo.

## Motivation

LUX_STRICT_PQ requires every user-side signature to be ML-DSA-65. Today
HD wallets target secp256k1 with 20-byte Keccak truncations. There is
no canonical 48-byte AccountID that locks an ML-DSA-65 public key to
an on-chain identity under the strict-PQ profile. Without this HIP,
wallets either reuse EVM 20-byte addresses (collision-prone for the
larger pubkey) or invent per-vendor formats. The PQ-side AccountID
must be primary, not derived from the EVM projection.

## Specification

The canonical reference is `luxfi/consensus/protocol/auth/account.go`
(auth-pq-surface branch). Key fields:

```
AccountID    = SHA3-384(domain || mldsa_pubkey)        // 48 bytes
              where domain = "LUX-ACCOUNT-V1" (15-byte cust string,
              SP 800-185 cSHAKE-style)
EVMAddress   = Keccak-256(mldsa_pubkey)[12:32]         // 20 bytes
DerivationPath  m / 44' / 9000' / nid' / 0 / n         // BIP-32, slip-44 9000
IdentityScheme  0x42 ML_DSA_65                         // FIPS 204
HashSuite       0x01 SHA3_NIST                         // FIPS 202 + SP 800-185
ProfileID       0x05 HanzoStrictPQ (HIPs canonical reservation)
```

`AccountID` is the canonical wire identifier in TxAuthEnvelope
(HIP-0086) and the Z-Chain identity rollup (HIP-0078). EVMAddress is
emitted only by the EVM-compatibility adapter for read-side RPC and
event log indexing; settlement is keyed by AccountID. The 48-byte
length is chosen to match the `MinHashOutputBits = 384` profile pin
and to make truncation collisions cryptographically negligible at the
profile's NIST PQ Cat 3 floor.

## Rationale

SHA3-384 over the cust-string-prefixed public key matches the
strict-PQ profile's hash floor (384 bits) and is FIPS 202 / SP 800-185
compliant. The 20-byte EVM projection retains tooling compatibility
without conflating identity scope. BIP-32 derivation reuses Lux's
existing slip-44 9000 allocation; ML-DSA-65 keygen is seeded by
`SHAKE-256(bip32_child_seed)` per `luxfi/crypto/mldsa`.

## Backwards compatibility

None. The strict-PQ profile rejects secp256k1-signed transactions at
the consensus boundary; EVM-form addresses without a registered
ML-DSA-65 public key on Z-Chain are not credit-bearing accounts. Hanzo
will run a permissive profile (0x02) for transition operators.

## Reference implementation

`luxfi/consensus/protocol/auth/account.go` (auth-pq-surface branch).
ML-DSA-65 primitive: `luxfi/crypto/mldsa`. KAT test vectors:
`luxfi/crypto/mldsa/testdata/account_v1.json`.

## Security considerations

Domain separation: the 15-byte cust prefix `LUX-ACCOUNT-V1` prevents
cross-domain reuse of the AccountID hash under SP 800-185 cSHAKE
construction. ML-DSA-65 pubkeys are ~1952 B; the 48-byte AccountID is
a collision-resistant commitment that does not leak the public key
preimage. EVM-form 20-byte addresses provide ~80-bit collision
resistance — sufficient for the compatibility lane but not for
identity binding, hence AccountID is primary. Per HIP-0005, classical
schemes MUST NOT appear in the account-derivation path; ML-DSA-65 is
the single primitive.

## References

- HIP-0077, HIP-0078, HIP-0079, HIP-0084 — strict-PQ stack.
- NIST FIPS 204 — ML-DSA primitive.
- NIST FIPS 202 + SP 800-185 — SHA-3 / cSHAKE / KMAC / TupleHash.
- NIST SP 800-57 — Key Management.
- `luxfi/consensus/config/profiles.go` — canonical profile pin.
- `luxfi/consensus/protocol/auth/` — canonical Go surface.

## Copyright

CC0.
