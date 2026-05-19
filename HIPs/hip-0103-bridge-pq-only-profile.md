---
hip: 0103
title: Bridge PQ-Only Profile
type: Standards Track
category: Infrastructure
status: Proposed
author: TBD
created: 2026-05-11
requires: HIP-0005 (Post-Quantum Security), HIP-0077, HIP-0078, HIP-0079, HIP-0084, HIP-0085, HIP-0086, HIP-0098 (Governance / Upgrade Keys), HIP-0101 (Hanzo↔Lux Bridge), HIP-0102 (Bridge Protocol)
---

## Abstract

HIP-0103 defines the **Bridge PQ-Only Profile**: a strict-PQ
bridge-counterparty contract. A bridge running under this profile
refuses any inbound state root that is not finalised under a
strict-PQ profile (`LUX_STRICT_PQ` 0x01, `ZooStrictPQ` 0x04,
`HanzoStrictPQ` 0x05). Counterparty finality is verified by checking
a Pulsar-M-65 (FIPS 204 ML-DSA-65 verifier) signature over a Q-Chain
block transcript (HIP-0079); high-value transfers above a configurable
cap require Pulsar-M-87 (HIP-0084 high-value mode) and a HIP-0098
governance authorisation. Classical bridge programs (LP-017 FROST /
CGGMP21) are refused.

## Motivation

Path 9 of the LUX_STRICT_E2E_PQ coverage matrix is partial. LP-017's
18 native bridge programs use FROST (Ed25519) and CGGMP21 (secp256k1).
HIP-0101 names ML-DSA-65 for the Hanzo↔Lux bridge but has no profile
equality gate; HIP-0102 specifies the bridge protocol but does not
mandate refusal of non-strict-PQ inbound state. Without HIP-0103, a
strict-PQ chain can receive bridged value whose counterparty is
classical, undermining the entire end-to-end posture. The bridge is
the trust-equivalence point; the profile-equality check is the lock.

## Specification

Canonical reference: `luxfi/consensus/protocol/auth/bridge_profile.go`
(auth-pq-surface branch).

```
BridgeInbound {
    profile_id            uint8   // local chain's profile
    counterparty_profile  uint8   // remote chain's claimed profile
    counterparty_chain_id uint64
    qchain_block_root     [48]byte // remote Q-Chain block root (HIP-0079)
    qchain_transcript     [48]byte // remote transcript hash
    pulsar_m_signature    []byte   // remote Pulsar-M cert
    pulsar_m_group_key    []byte   // remote group pubkey (committed on remote Z-Chain)
    high_value_flag       bool    // triggers HIP-0098 governance auth
    governance_auth       []byte  // HIP-0098 GovernanceAuthorization (if high_value)
    transfer_descriptor   []byte  // amount, sender, recipient, asset
}

transcript = TupleHash256(
    "BRIDGE-INBOUND-V1",
    [ profile_id, counterparty_profile,
      counterparty_chain_id_be8, qchain_block_root, qchain_transcript,
      pulsar_m_group_key, hv_flag_byte, transfer_descriptor ],
    384
)
```

Acceptance rule (strict-PQ bridge):

1. `counterparty_profile ∈ {0x01, 0x04, 0x05}` — any other value is
   refused.
2. `counterparty_profile` field-byte-equality check passes against the
   counterparty's canonical profile fields (HashSuiteID = 0x01,
   IdentitySchemeID = 0x42, FinalitySchemeID = 0x52,
   ProofPolicyID = 0x10, all Forbid* = true).
3. `pulsar_m_signature` verifies under unmodified FIPS 204 ML-DSA-65
   against `pulsar_m_group_key` over `qchain_transcript`.
4. `pulsar_m_group_key` matches the counterparty's
   `group_public_key_hash` stored locally from prior bridge sync.
5. `qchain_block_root` chains correctly to a prior anchor; the
   anchor cadence is at most one block per minute.
6. If `high_value_flag == true`, `governance_auth` is a valid
   HIP-0098 `GovernanceAuthorization` for the transfer, threshold-signed
   by Pulsar-M-87.
7. `transfer_descriptor` decodes to a sane (amount, sender, recipient,
   asset) tuple bounded by per-asset caps.

High-value cap default: 100,000 LUX (or chain-configured equivalent).
Transfers above cap REQUIRE the governance-auth path.

## Rationale

Profile-byte-equality (HIP-0077/0078/0079/0084 §"Mirrored profile" in
LP/ZIP forms) is checked field-by-field, not just by ProfileID byte —
this prevents a malicious bridge participant from claiming
`ProfileID = 0x01` while the chain actually runs with
`ForbidPairings = false`. The verifier reuses the unmodified FIPS 204
ML-DSA-65 verifier; no bridge-specific cryptography. High-value flag
+ governance auth provides defence-in-depth on the only attack vector
that has historically lost the most value across bridges: a bulk
unauthorised transfer.

## Backwards compatibility

None. Bridges running under HIP-0103 refuse all non-strict-PQ inbound
state. Operators who need to bridge to a permissive-profile chain must
run a separate bridge instance under the permissive profile (0x02) and
that instance MUST NOT be reachable from a strict-PQ chain.

## Reference implementation

`luxfi/consensus/protocol/auth/bridge_profile.go` (auth-pq-surface).
Existing bridge contracts under LP-017 / HIP-0101 / HIP-0102 are
extended with the profile-equality precondition before any inbound
state transition is applied. KAT vectors:
`luxfi/consensus/protocol/auth/testdata/bridge_profile_v1.json`.

## Security considerations

The profile-equality check is the only mitigation against a malicious
counterparty silently downgrading its profile after onboarding. Group
public-key pinning (clause 4) prevents committee-substitution attacks.
High-value cap forces governance accountability for the largest
transfer classes. The bridge inherits the security of the weaker
counterparty profile — if either side runs permissive, transferred
value is permissive-grade, hence the strict refusal.

## References

- HIP-0079 — Q-Chain block transcript verified by Pulsar-M.
- HIP-0084 — Pulsar-M-65 (normal) and Pulsar-M-87 (high-value).
- HIP-0098 — governance-auth path for high-value transfers.
- HIP-0101, HIP-0102 — Hanzo↔Lux bridge baseline.
- LP-017 — classical bridge programs (refused under strict-PQ).
- NIST FIPS 204, FIPS 202, SP 800-185.
- `luxfi/consensus/protocol/auth/bridge_profile.go`.

## Copyright

CC0.
