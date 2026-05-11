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

HIP-0104 defines the **contract-side auth surface** for verifying PQ
signatures and Z-Chain auth proofs from within EVM-compatible contracts
under the strict-PQ profile. Four precompiles are pinned in the EVM
0x0301..0x0304 block:

- `0x0301` `pq_verify_mldsa65` — FIPS 204 ML-DSA-65 verify
- `0x0302` `pq_verify_mldsa87` — FIPS 204 ML-DSA-87 verify (high-value)
- `0x0303` `pq_verify_slh_dsa` — FIPS 205 SLH-DSA verify (hash-based backstop)
- `0x0304` `pq_verify_z_auth_proof` — STARK_FRI_SHA3_PQ Z-Chain auth proof

Each precompile returns `(bool ok, bytes payload)` per the canonical Go
function-pointer interface in `luxfi/consensus/protocol/auth/precompile.go`.
Contracts call these precompiles to gate sensitive functions on
PQ identity without re-implementing the verifier.

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

Canonical references:
- `luxfi/consensus/protocol/auth/precompile.go` — function-pointer types
  and the four `PrecompileAddrPQVerify*` constants.
- `luxfi/coreth/core/vm/contracts_pq.go` — EVM wiring (gas schedule
  lives here, not in consensus).

### Precompile 0x0301 — `pq_verify_mldsa65`

```
input: bytes
    mldsa_pubkey          []byte
    transcript            [48]byte
    mldsa_signature       []byte

output: (bool ok, bytes payload)
    ok      = true on verify success
    payload empty on success, error-detail bytes on failure
```

Verifies a FIPS 204 ML-DSA-65 signature. Used by HIP-0087 permits and
HIP-0086 envelope introspection where the contract already has the
pubkey and signature locally.

### Precompile 0x0302 — `pq_verify_mldsa87`

Same shape as 0x0301; verifies a FIPS 204 ML-DSA-87 signature (NIST PQ
Cat 5). Used for high-value contract authorisation (treasury,
governance roots).

### Precompile 0x0303 — `pq_verify_slh_dsa`

Same shape as 0x0301; verifies a FIPS 205 SLH-DSA signature. The
hash-based backstop for account recovery / breakglass operations.

### Precompile 0x0304 — `pq_verify_z_auth_proof`

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

output: (bool ok, bytes payload)
    ok      = true on verify success
    payload encodes account_id (48 B), verified_at_height (u64), flags
            (u64) on success
```

The heavy verifier suitable for cross-domain authentication: a wallet
that lives on Z-Chain proving an action to a contract on the EVM side.

Gas-schedule numbers live in the coreth wiring
(`core/vm/contracts_pq.go`) and are calibrated against the canonical
verifier benchmark in `luxfi/consensus`. Operators MUST re-benchmark on
each major release to prevent under-pricing attacks.

Contracts call these via standard EVM `staticcall`:

```solidity
function verifyPQ(bytes calldata proof, bytes32 expectedAccount)
    external view returns (bool)
{
    (bool ok, bytes memory out) = address(0x0304).staticcall(proof);
    if (!ok || out.length < 48) return false;
    bytes32 acct;
    assembly { acct := mload(add(out, 0x20)) }
    return acct == expectedAccount;
}
```

## Rationale

Four precompiles, one per primitive: ML-DSA-65 and ML-DSA-87 (lattice
identity at Cat 3 and Cat 5), SLH-DSA (stateless hash-based backstop),
and the Z-Chain proof path (heavy STARK verifier). Each reuses the
same canonical Go verifier under the hood — one verifier in the tree.

## Backwards compatibility

None. Strict-PQ chains reject `ecrecover` calls at the consensus
boundary; contracts that used `ecrecover` MUST migrate to one of
0x0301..0x0304. Permissive profiles MAY keep `ecrecover` active during
transition.

## Reference implementation

`luxfi/consensus/protocol/auth/precompile.go`. EVM binding:
`luxfi/coreth/core/vm/contracts_pq.go`. Test vectors:
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
