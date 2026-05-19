---
hip: 0088
title: Session KEM (ML-KEM-768/1024 for P2P)
type: Standards Track
category: Cryptography
status: Proposed
author: TBD
created: 2026-05-11
requires: HIP-0005 (Post-Quantum Security), HIP-0077 (Mesh Identity), HIP-0084 (Pulsar-M DKG)
---

## Abstract

HIP-0088 locks the post-quantum session KEM under the strict-PQ
profile. The ZAP wire handshake (HIP-0077) negotiates an `ML-KEM-768`
(FIPS 203, NIST PQ Cat 3) shared secret by default and `ML-KEM-1024`
(Cat 5) for high-value sessions. The hybrid X-Wing (X25519 + ML-KEM-768)
mode is available as an explicit transitional profile but is refused
under strict-PQ. The derived shared secret is fed to an HKDF-Extract
keyed by `KMAC256` (SP 800-185) and produces the AEAD key for
`AES-256-GCM` or `ChaCha20-Poly1305` transport.

## Motivation

Path 12 of the LUX_STRICT_E2E_PQ coverage matrix is partial: LP-022
(ZAP) is the wire protocol and LP-072 specifies ML-KEM as a primitive,
but no spec mandates ML-KEM under strict-PQ at the handshake boundary.
HIP-0077 references ML-KEM-768 informationally but does not lock the
KEM-derived transport key path. Without HIP-0088, P2P session
encryption can silently fall back to classical X25519, defeating the
end-to-end PQ posture.

## Specification

Canonical references:
- `luxfi/consensus/config/pq_mode.go` — `KeyExchangeID` enum (canonical wire bytes).
- `luxfi/node/network/kem/scheme.go` — ML-KEM session primitives (FIPS 203).
- `luxfi/node/network/peer/handshake.go` — handshake state machine.

The KEM `auth/session_kem.go` path named in earlier drafts does not exist;
session-KEM lives in `node/network/kem/` (encapsulate/decapsulate +
shared-secret derivation) and `node/network/peer/handshake.go` (mutual
authentication transcript). Canonical wire bytes are sourced from
`config.KeyExchangeID` and shared with `protocol/auth` via type alias.

```
SessionInit (client → server):
    profile_id        uint8
    kem_scheme_id     uint8       // 0x01 ML-KEM-768 | 0x02 ML-KEM-1024
                                  // 0x90 X25519Unsafe (forbidden under strict-PQ)
    client_kem_pubkey []byte      // 1184 B for 768, 1568 B for 1024
    client_nonce      [32]byte
    client_mldsa_sig  []byte      // ML-DSA.Sign over (init_bytes)

SessionAccept (server → client):
    server_id            [48]byte // AccountID
    kem_ciphertext       []byte   // 1088 B for 768, 1568 B for 1024
    server_nonce         [32]byte
    server_mldsa_sig     []byte   // ML-DSA.Sign over (init_bytes || accept_bytes_no_sig)

shared_secret = ML-KEM.Decap(client_kem_secret, kem_ciphertext)
                = ML-KEM.Encap(client_kem_pubkey).ss  // identity

transcript = TupleHash256(
    "SESSION-KEM-V1",
    [ profile_id, kem_scheme_id, client_kem_pubkey, kem_ciphertext,
      client_nonce, server_nonce, server_id ],
    384
)

session_key = KMAC256(shared_secret,
                      transcript,
                      256,                  // 256-bit AEAD key
                      "LUX-SESSION-KDF-V1")
```

Acceptance under strict-PQ:

1. `profile_id` matches chain pin.
2. `kem_scheme_id ∈ {0x01, 0x02}`; `0x90` (X25519Unsafe) rejected.
3. Both ML-DSA-65 signatures verify under unmodified FIPS 204 against
   the respective party's pubkey.
4. `kem_scheme_id = 0x01` (ML-KEM-768) is the default; `0x02`
   (ML-KEM-1024) is required when either side advertises
   `role=high-value`.
5. Session key is rotated every 1 hour or 2^28 records, whichever
   comes first.

## Rationale

ML-KEM-768 is NIST PQ Cat 3, matching ML-DSA-65's identity scheme.
ML-KEM-1024 is Cat 5 for high-value (governance, bridge, treasury)
flows. X-Wing is useful only as a transition tool for connecting to
legacy classical-only peers; under strict-PQ the X25519 leg adds zero
cryptanalytic surface and would silently weaken the posture if not
explicitly refused. KMAC256 over the transcript matches the SP 800-185
key-derivation pattern used elsewhere in the strict-PQ stack.

## Backwards compatibility

None. Strict-PQ refuses classical key exchange (X25519, ECDH) at the
handshake boundary. The permissive profile (0x02) MAY accept hybrid
constructions; the FIPS profile (0x03) MAY accept ML-KEM only.

## Reference implementation

ML-KEM primitive + session derivation: `luxfi/node/network/kem/`.
Handshake state machine: `luxfi/node/network/peer/handshake.go`.
Canonical wire byte registry: `luxfi/consensus/config/pq_mode.go`
(`KeyExchangeID`).

## Security considerations

ML-KEM-768 provides IND-CCA2 security at NIST Cat 3 per FIPS 203.
Mutual ML-DSA-65 signatures over the handshake transcript bind
identity to the KEM key exchange, preventing unknown-key-share attacks
and identity misbinding. Session key rotation bounds the volume of
data protected by any single derived key. The KMAC256 KDF cust string
`LUX-SESSION-KDF-V1` provides domain separation against other KDF
paths in the strict-PQ stack.

## References

- NIST FIPS 203 — ML-KEM primitive.
- NIST FIPS 204 — ML-DSA mutual auth.
- NIST FIPS 202 + SP 800-185 — KMAC256, TupleHash256.
- NIST SP 800-57 — key management.
- `luxfi/consensus/config/pq_mode.go` — canonical `KeyExchangeID`.
- `luxfi/node/network/kem/scheme.go`, `luxfi/node/network/peer/handshake.go`.

## Copyright

CC0.
