---
hip: 0079
title: Q-Chain — Quasar Finality Block Standard
type: Standards Track
category: Infrastructure
status: Draft
authors: Hanzo AI
requires: HIP-0077 (Mesh Identity), HIP-0078 (Z-Chain PQ Rollup), HIP-0084 (Pulsar-M DKG)
---

## Abstract

Q-Chain is the **compact finality-block log** for the Quasar consensus
engine. Each Q-Block carries the minimum information needed for
finality: roots of the validator / DKG / identity state held in
Z-Chain (HIP-0078) plus a single Pulsar-M-65 threshold signature
(HIP-0084) that proves the current epoch's committee finalised the
block. Q-Chain does **not** carry raw ML-DSA validator pubkeys, raw
ML-DSA per-validator signatures, raw DKG transcript messages, or raw
attestation blobs — those live in Z-Chain.

The result: a finality lane whose per-block size is bounded and
small (a few hundred bytes plus one ~3.3 KB Pulsar-M-65 signature),
independent of validator-set size. Adding validators makes Z-Chain
heavier, not Q-Chain.

## Motivation

The naive design that puts every validator's identity material into
every finality block produces O(N) per-block bandwidth and pushes the
mainnet bottleneck onto static state that doesn't change per round.
Splitting Q-Chain (compact finality) from Z-Chain (bulky identity
rollup) collapses per-block bandwidth to O(1) regardless of N.

This HIP pins the wire format, transcript binding, and consumer
contract for Q-Blocks. Z-Chain (HIP-0078) and Pulsar-M (HIP-0084)
are the dependencies on either side.

## Specification

### Q-Block structure

```
QBlock {
    version                      uint16
    network_id                   uint32
    chain_id                     uint32
    height                       uint64
    round_or_view                uint32
    parent_qblock_hash           [32]byte

    // State roots — Z-Chain anchors. Each MUST equal the latest
    // accepted EpochCommitment field for the current epoch.
    lux_state_root               [32]byte    // Lux primary state at this height
    zchain_state_root            [32]byte    // anchors EpochCommitment.zchain_state_root
    validator_set_root           [32]byte    // anchors EpochCommitment.validator_registry_root
    committee_root               [32]byte    // anchors EpochCommitment.committee_root
    dkg_transcript_root          [32]byte    // anchors EpochCommitment.dkg_transcript_root
    group_public_key_hash        [32]byte    // anchors EpochCommitment.group_public_key_hash

    // Payload anchors — block-specific data lives elsewhere.
    payload_root                 [32]byte    // application transactions
    da_root                      [32]byte    // data-availability commitment

    // Cert envelope.
    proof_system_id              ProofSystemID  // = 0x10 STARK_FRI_SHA3_PQ canonical (0x80/0x81 refused)
    hash_suite_id                HashSuiteID    // = 0x01 SHA3_NIST canonical
    sig_scheme_id                SigSchemeID    // = 0x52 Pulsar-M-65 default; 0x53 for high-value roots

    // Signature.
    signer_bitmap_or_weight_commitment  []byte  // who attested (committee bitmap or weight Merkle root)
    pulsar_m_threshold_signature        []byte  // single threshold sig over the canonical transcript
}
```

### What Q-Chain MUST NOT carry

Hard exclusions:

- Full validator ML-DSA-65 public keys (live in Z-Chain `identity_root`).
- Per-validator ML-DSA-65 identity signatures (live in Z-Chain validator-registration proofs).
- Full DKG ceremony messages (live in Z-Chain `dkg_transcript_root`).
- Per-validator attestation blobs (live in Z-Chain).
- Z-Chain proof bytes for non-epoch-boundary blocks (the cert
  references `zchain_state_root` by hash; the proof itself only
  ships at epoch boundaries).

A Q-Block that carries any of these violates the spec and MUST be
rejected. The wire format does not have fields to hold them; this is
an enforcement-by-construction guarantee.

### Canonical transcript binding

The transcript Pulsar-M signs over for a Q-Block is computed as:

```
TranscriptHash = TupleHash256(
    [ "Q-Chain/v1",
      version,           // 2 bytes BE
      network_id,        // 4
      chain_id,          // 4
      height,            // 8
      round_or_view,     // 4
      parent_qblock_hash,
      lux_state_root,
      zchain_state_root,
      validator_set_root,
      committee_root,
      dkg_transcript_root,
      group_public_key_hash,
      payload_root,
      da_root,
      [proof_system_id],          // 1
      [hash_suite_id],             // 1
      [sig_scheme_id],             // 1
      signer_bitmap_or_weight_commitment ],
    customization = "PULSAR-M-Q-BLOCK-V1")
```

`TupleHash256` per NIST SP 800-185 is used for unambiguous length-prefixed
tuple hashing. Customisation tags pin the protocol version; bumping
"v1" → "v2" is the only way to reuse the same transcript bytes for a
breaking change. Hash family is `HashSuiteID = 0x01 SHA3_NIST` only —
HashSuite-mismatched Q-Blocks are not produceable on Lux primary network.

### Acceptance rule

A full node accepts a Q-Block at height H iff **every** of the
following holds:

1. `parent_qblock_hash` matches the chain tip.
2. `zchain_state_root` matches the latest accepted Z-Chain epoch root.
3. `validator_set_root` matches the latest accepted Z-Chain
   `validator_registry_root` (per EpochCommitment).
4. `committee_root` matches the latest accepted Z-Chain
   `committee_root`.
5. `dkg_transcript_root` matches the latest accepted Z-Chain
   `dkg_transcript_root`.
6. `group_public_key_hash` matches the latest accepted Z-Chain
   `group_public_key_hash`.
7. `proof_system_id` is NOT in the forbidden set
   (`IsForbiddenInPQMode() == false`); strict-PQ networks require
   `0x10 STARK_FRI_SHA3_PQ`.
8. `hash_suite_id == 0x01 SHA3_NIST`.
9. `sig_scheme_id` ∈ {`0x52 Pulsar-M-65`, `0x53 Pulsar-M-87`} for
   mainnet; testnet may also accept `0x51 Pulsar-M-44`.
10. `signer_bitmap_or_weight_commitment` satisfies the configured
    threshold (43-of-64 default per HIP-0084).
11. `pulsar_m_threshold_signature` verifies under unmodified
    FIPS 204 ML-DSA.Verify against the canonical transcript hash and
    the group public key derived from `group_public_key_hash`.

If any check fails, the block is rejected and a slashing-evidence
record is produced per HIP-0084 §"Identifiable abort".

### Production defaults

| parameter            | value                          |
|----------------------|--------------------------------|
| `version`            | `0x0001`                       |
| `proof_system_id`    | `0x10` (STARK_FRI_SHA3_PQ)     |
| `hash_suite_id`      | `0x01` (SHA3_NIST)             |
| `sig_scheme_id`      | `0x52` (Pulsar-M-65)           |
| committee size       | 64                             |
| BFT fault bound      | f = 21                         |
| threshold            | 43-of-64                       |
| epoch length         | network-configurable; start 1 hour |
| DKG cadence          | once per epoch (HIP-0084)      |
| online signing       | preprocessing-enabled          |
| abort handling       | identifiable abort required    |

High-value roots (governance, bridges, slashing, archival) MAY
upgrade `sig_scheme_id` to `0x53 Pulsar-M-87` for the duration of
the operation. Block consumers MUST accept either.

### What changes for Quasar mode

`PQModeQuasar` (consensus/config/pq_mode.go) maps to:

- `proof_system_id = 0x10 STARK_FRI_SHA3_PQ`
- `hash_suite_id = 0x01 SHA3_NIST`
- `sig_scheme_id = 0x52 Pulsar-M-65` (default) or `0x53 Pulsar-M-87` (high-value)

The legacy "Pulsar.R + Groth16/BN254 Z-Chain rollup" wire shape from
the prior HIP-0077 is retired with the migration to Z-Chain v1
(HIP-0078 Phase 3 flag day).

## Security considerations

- **No silent downgrade.** A Q-Block that carries
  `proof_system_id = 0x80` or `0x81` is refused before signature
  verification. The forbidden markers exist on the wire so a
  misconfigured operator's block is named, not silently accepted.
- **Single threshold sig per block.** Multi-sig fallback paths
  (per-validator BLS + ML-DSA, classical/PQ hybrid) are NOT in this
  HIP. A future variant MAY add hybrid-cert support but it lives in a
  follow-up HIP, not here.
- **Root tampering.** All root fields are bound into the transcript;
  flipping any one breaks signature verification.
- **Signer-bitmap forgery.** Bitmap is bound into the transcript and
  validated against `committee_root`; an attacker who flips a bit
  must produce a valid Pulsar-M sig over the modified transcript,
  which reduces to forging Pulsar-M.
- **Replay across networks.** `network_id` and `chain_id` are bound
  into the transcript; a Q-Block valid on Lux mainnet is not valid
  on a tenant network.

## Adoption order

1. Wire format frozen (this HIP).
2. `consensus/pkg/wire/qblock.go` reference encoder/decoder.
3. Test vectors at `~/work/lux/consensus/qblock-vectors/` covering
   acceptance, refusal-on-forbidden-proof-system, transcript binding.
4. Quasar driver (`consensus/protocol/quasar/`) consumes Q-Blocks
   from `WitnessSet.Run` outputs.
5. Q-Chain VM at `chains/quasarvm` (planned location) implements
   acceptance rule.
6. Phase 2 of HIP-0078 ships, gating the `proof_system_id = 0x10`
   requirement on Lux primary network.

## References

- HIP-0077 — Mesh Identity, Gossip & Payments (parent).
- HIP-0078 — Z-Chain PQ Identity Rollup (root source).
- HIP-0084 — Pulsar-M DKG (signing primitive).
- FIPS 204 — ML-DSA verification target.
- FIPS 202 + NIST SP 800-185 — TupleHash256 transcript family.
