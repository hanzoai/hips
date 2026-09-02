---
hip: "0085"
title: Wallet PQ Account Type (ML-DSA-65 native, 48-byte AccountID)
type: Standards Track
category: Cryptography
status: Final
author: Hanzo AI
created: 2026-05-11
requires: HIP-0005, HIP-0077, HIP-0078, HIP-0079, HIP-0084
---


# HIP-0085: Wallet PQ Account Type (ML-DSA-65 native, 48-byte AccountID)

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

## Specification

The canonical reference is `luxfi/consensus/protocol/auth/account_id.go`,
`DeriveAccountID`. Key fields:

```
AccountID    = cSHAKE256(profile_be4 || chain_be4 || u8(scheme) || pubkey,
                         48, "", "LUX_ACCOUNT_ID_V1")   // 48 bytes
              The four inputs are absorbed in one pass, fixed-width first
              and the variable-length pubkey last; the customization tag
              is the domain separator, so no length framing is needed.
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

Domain separation: the cSHAKE256 customization tag `LUX_ACCOUNT_ID_V1`
prevents cross-domain reuse of the AccountID hash under SP 800-185, and
binding `profileID` and `chainID` into the preimage is what stops one
AccountID being replayed across security postures or chains. The tag is
the schema identity: bumping it is a hard fork of account derivation,
with no window in which both forms resolve. ML-DSA-65 pubkeys are ~1952 B; the 48-byte AccountID is
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
