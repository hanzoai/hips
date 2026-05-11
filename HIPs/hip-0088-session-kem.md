---
hip: 0088
title: Session KEM (ML-KEM-768/1024 for P2P)
type: Standards Track
category: Cryptography
status: Proposed
authors: TBD
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

Canonical reference: `luxfi/consensus/protocol/auth/session_kem.go`
(auth-pq-surface branch). Also: `luxfi/zap/handshake.go`.

```
SessionInit (client → server):
    profile_id        uint8
    kem_scheme_id     uint8       // 0x60 ML-KEM-768 | 0x61 ML-KEM-1024
                                  // 0x62 X-Wing (forbidden under strict-PQ)
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
2. `kem_scheme_id ∈ {0x60, 0x61}`; `0x62` (X-Wing) rejected.
3. Both ML-DSA-65 signatures verify under unmodified FIPS 204 against
   the respective party's pubkey.
4. `kem_scheme_id = 0x60` (ML-KEM-768) is the default; `0x61` is
   required when either side advertises `role=high-value`.
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

None. Strict-PQ refuses classical key exchange (X25519, ECDH) and
X-Wing at the handshake boundary. The permissive profile (0x02) MAY
accept X-Wing; the FIPS profile (0x03) MAY accept ML-KEM only.

## Reference implementation

`luxfi/consensus/protocol/auth/session_kem.go`. ZAP integration:
`luxfi/zap/handshake.go`. ML-KEM primitive: `luxfi/crypto/mlkem`. KAT
vectors: `luxfi/consensus/protocol/auth/testdata/session_kem_v1.json`.

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
- LP-115 — X-Wing (referenced for the transitional profile only).
- `luxfi/consensus/protocol/auth/session_kem.go`.

## Copyright

CC0.
