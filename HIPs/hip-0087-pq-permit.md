---
hip: 0087
title: PQ Permit (replaces EIP-2612)
type: Standards Track
category: Cryptography
status: Proposed
authors: TBD
created: 2026-05-11
requires: HIP-0005 (Post-Quantum Security), HIP-0077, HIP-0085 (AccountID), HIP-0086 (TxAuthEnvelope)
---

## Abstract

HIP-0087 specifies the post-quantum replacement for EIP-2612 `permit`.
A PQ Permit is a typed off-chain authorization signed by the token
owner's ML-DSA-65 key over a TupleHash256 transcript bound by the
cust string `PERMIT-V1` (SP 800-185). The transcript commits to
`(profile_id, chain_id, verifying_contract, owner_account_id,
spender_account_id, value, nonce, deadline)`. A contract verifies the
permit via the Z-Chain auth precompile (HIP-0104) or directly via the
`ML-DSA.Verify` precompile. The replay protection follows EIP-2612's
per-owner nonce pattern. The whole flow is profile-gated; a
strict-PQ chain refuses any classical `permit`.

## Motivation

EIP-2612 is keyed to secp256k1 ECDSA — irrecoverable under Shor. The
DeFi `permit` flow (gasless approvals, single-tx swaps, meta-tx)
underpins thousands of contracts. Without a PQ replacement, ERC-20
permits become a classical island inside a PQ chain. The replacement
must be drop-in for contract authors (one verify call) while remaining
profile-gated at the auth boundary.

## Specification

Canonical reference: `luxfi/consensus/protocol/auth/permit.go`
(auth-pq-surface branch).

```
PermitMessage {
    version              uint8    = 0x01
    profile_id           uint8
    identity_scheme_id   uint8    = 0x42
    hash_suite_id        uint8    = 0x01
    chain_id             uint64
    verifying_contract   [20]byte // EVM-form
    owner_account_id     [48]byte
    spender_account_id   [48]byte
    value                [32]byte // u256 big-endian
    nonce                uint64
    deadline             uint64
}

transcript = TupleHash256(
    "PERMIT-V1",
    [ version, profile_id, identity_scheme_id, hash_suite_id,
      chain_id_be8, verifying_contract, owner_account_id,
      spender_account_id, value, nonce_be8, deadline_be8 ],
    384
)

signature = ML-DSA.Sign(owner_account_key, transcript)
```

The owner publishes `(PermitMessage, owner_pubkey, signature)`. The
contract calls a thin verifier (either the Z-Chain proof precompile in
HIP-0104 or a direct `ML-DSA.Verify` precompile at address `0x14`)
and on success increments the owner's nonce and updates
`allowance[owner][spender] = value`.

Acceptance:

1. `profile_id` matches chain pin; otherwise reject.
2. `chain_id` matches.
3. `verifying_contract == msg.sender`.
4. `now <= deadline`.
5. `nonce == nonces[owner]`.
6. `AccountID == SHA3-384("LUX-ACCOUNT-V1" || owner_pubkey)`.
7. `ML-DSA.Verify(owner_pubkey, transcript, signature) == true`.

Failure of any check is a hard revert; no recovery.

## Rationale

Reusing TupleHash256 over a profile-bound transcript matches HIP-0086.
Domain separation by cust string (`PERMIT-V1` vs `TX-AUTH-V1`)
prevents cross-context signature reuse. The 20-byte
`verifying_contract` retains EVM ABI familiarity for contract
authors. Per-owner nonce mirrors EIP-2612, so the migration cost for
existing token contracts is a verifier swap, not a flow redesign.

## Backwards compatibility

None. EIP-2612 permits are refused under strict-PQ. Token contracts
deployed on strict-PQ chains expose only the PQ Permit interface;
contracts that need both expose two separate methods and operators
disable the classical method on profile activation.

## Reference implementation

`luxfi/consensus/protocol/auth/permit.go` (auth-pq-surface). EVM
precompile binding: `luxfi/coreth/core/vm/contracts_pq.go`. KAT
vectors: `luxfi/consensus/protocol/auth/testdata/permit_v1.json`.

## Security considerations

`deadline` bounds the permit's validity; off-chain leakage past the
deadline is harmless. Per-owner nonce prevents replay within validity
window. Cross-chain replay prevented by `chain_id`. Cross-contract
replay prevented by `verifying_contract`. Cross-profile replay
prevented by `profile_id`. ML-DSA-65 signature size (~3309 B) makes
the permit unsuitable for tightly gas-constrained chains but well
within Lux gas budget; profile activation should be accompanied by
gas-schedule update (HIP-0104 §"Gas schedule").

## References

- EIP-2612 — secp256k1 baseline (superseded under strict-PQ).
- HIP-0085, HIP-0086 — AccountID and TxAuthEnvelope.
- HIP-0104 — Z-Chain auth precompile.
- NIST FIPS 204, FIPS 202, SP 800-185, SP 800-57.
- `luxfi/consensus/protocol/auth/permit.go`.

## Copyright

CC0.
