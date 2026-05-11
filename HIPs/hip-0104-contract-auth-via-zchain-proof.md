---
hip: 0104
title: Contract Auth via Z-Chain Proof
type: Standards Track
category: Infrastructure
status: Proposed
authors: TBD
created: 2026-05-11
requires: HIP-0005 (Post-Quantum Security), HIP-0077, HIP-0078, HIP-0079, HIP-0084, HIP-0085, HIP-0086, HIP-0087
---

## Abstract

HIP-0104 defines the **contract-side auth surface** for verifying
Z-Chain auth proofs from within EVM-compatible contracts under the
strict-PQ profile. A precompile at address `0x13` accepts a
`ZCHAIN_AUTH_PROOF` envelope (the format-byte-`0x10`
STARK_FRI_SHA3_PQ proof from HIP-0078) and returns the authenticated
`AccountID` plus a `verified_at_height` flag. A complementary direct-
verify precompile at `0x14` accepts a raw `(pubkey, transcript, sig)`
tuple and returns success/failure under unmodified FIPS 204 ML-DSA-65.
Contracts call these precompiles to gate sensitive functions on
ML-DSA-65 identity without re-implementing the verifier.

## Motivation

Path 3 of the LUX_STRICT_E2E_PQ coverage matrix is partial. LP-169 /
HIP-0078 specify Z-Chain proofs for identity-state transitions but
leave the contract-call boundary unspecified. The verifier surface in
`luxfi/consensus/protocol/zchain` exists but has no HIP locking the
contract-call interface. Without HIP-0104, every contract author
re-derives an auth pattern; HIP-0087 PQ Permit, HIP-0086 TxAuthEnvelope
introspection, and HIP-0098 governance-auth checks would each need
bespoke contract code. One precompile pair closes this.

## Specification

Canonical reference: `luxfi/consensus/protocol/auth/precompile.go`
(auth-pq-surface branch) and `luxfi/coreth/core/vm/contracts_pq.go`.

### Precompile 0x13 — Z-Chain auth proof verifier

```
input: bytes
    format_byte           uint8    = 0x10  // STARK_FRI_SHA3_PQ
    proof_blob            []byte   // STARK proof bytes per HIP-0078
    public_inputs {
        zchain_root           [48]byte
        account_id            [48]byte
        action_root           [48]byte
        nonce                 uint64
    }

output: bytes (96 bytes on success, empty on failure)
    account_id            [48]byte // authenticated
    verified_at_height    uint64   // Z-Chain height of the proof
    flags                 uint64   // bit 0 = verified, bit 1 = high-value-auth
```

Gas schedule:

| step                                | gas        |
|-------------------------------------|------------|
| base verifier setup                 | 50,000     |
| STARK_FRI_SHA3_PQ verify            | 1,200,000  |
| account-id binding check            | 20,000     |
| total (typical)                     | 1,270,000  |

### Precompile 0x14 — direct ML-DSA-65 verify

```
input: bytes
    mldsa_pubkey          []byte
    transcript            [48]byte
    mldsa_signature       []byte

output: bytes (1 byte)
    0x01 on verify success, 0x00 on failure
```

Gas schedule: 800,000 (single ML-DSA-65 verify, FIPS 204).

Contracts call these via standard EVM `staticcall`:

```solidity
function verifyPQ(bytes calldata proof, bytes32 expectedAccount)
    external view returns (bool)
{
    (bool ok, bytes memory out) = address(0x13).staticcall(proof);
    if (!ok || out.length < 96) return false;
    bytes32 acct;
    assembly { acct := mload(add(out, 0x20)) }
    return acct == expectedAccount;
}
```

## Rationale

Two precompiles, not one: the Z-Chain-proof path (0x13) is the heavy
verifier suitable for cross-domain authentication (a wallet that lives
on Z-Chain proving an action to a contract on the EVM-side); the
direct verify path (0x14) is the light path suitable for HIP-0087
permits and HIP-0086 envelope introspection where the contract already
has the pubkey and signature locally. Both reuse the same canonical Go
verifier under the hood — one verifier in the tree.

## Backwards compatibility

None. Strict-PQ chains reject `ecrecover` calls at the consensus
boundary; contracts that used `ecrecover` MUST migrate to 0x13 / 0x14.
Permissive profiles MAY keep `ecrecover` active during transition.

## Reference implementation

`luxfi/consensus/protocol/auth/precompile.go` (auth-pq-surface).
EVM binding: `luxfi/coreth/core/vm/contracts_pq.go`. Test vectors:
`luxfi/coreth/core/vm/testdata/precompile_pq_v1.json`.

## Security considerations

The precompile returns the authenticated `AccountID`; contracts MUST
compare against an expected value, not trust the precompile's success
flag alone for authorisation. Gas schedule is calibrated against the
luxfi reference verifier benchmark (1.2 M gas for STARK verify, 0.8 M
gas for direct ML-DSA-65 verify); operators MUST re-benchmark on
each major release to prevent under-pricing attacks. The 48-byte
AccountID format prevents collision attacks against EVM-form 20-byte
addresses that would otherwise cause auth-skirting.

## References

- HIP-0078 — Z-Chain proof system (format byte 0x10).
- HIP-0085 — AccountID format.
- HIP-0086 — TxAuthEnvelope (transcript convention).
- HIP-0087 — PQ Permit (direct verify consumer).
- NIST FIPS 204, FIPS 202, SP 800-185, SP 800-57.
- `luxfi/consensus/protocol/auth/precompile.go`.
- `luxfi/coreth/core/vm/contracts_pq.go`.

## Copyright

CC0.
