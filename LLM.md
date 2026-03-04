# LLM.md - Hanzo Improvement Proposals (HIPs)

## Repository

Formal specifications and governance for Hanzo AI L1 blockchain.

```
HIPs/          # Individual proposals
docs/          # Supporting documentation
README.md      # Index
```

## Active HIPs

| HIP | Status | Title | Key Points |
|-----|--------|-------|------------|
| 0 | Final | L1 Architecture | Sovereign L1 via Lux, PoI consensus, 2s blocks, GPU validators, HANZO token |
| 1 | Draft | Hamiltonian LLMs | Unified multimodal (text/vision/audio/3D). Variants: 7B/32B/175B/1T. Named "Hamiltonian" not "Hanzo" |
| 5 | Final | Post-Quantum Crypto | ML-KEM-768, ML-DSA-65, liboqs v0.11. 5 privacy tiers (Open to GPU TEE-I/O) |
| 6 | Draft | Per-User Fine-Tuning | Per-USER models (not domain-specific). On-chain training ledger, encrypted training |
| 7 | Draft | Active Inference | VERSES/Active Inference, EFE minimization, IEEE 2874 Spatial Web |
| 26 | Draft | IAM Standard | RFC 6749/OIDC-compliant IAM at hanzo.id. Multi-tenant (5 domains), PKCE, credit balances |

## Related Ecosystems

- **Zoo (ZIPs)**: EVM L2 on Lux (not sovereign L1). Eco-1 with z-JEPA. 501(c)(3), 100% airdrop genesis
- **Lux (LPs)**: LP-25 appchain launching, LP-102 immutable training ledger, LP-103 cross-chain AI

## HANZO Tokenomics (1B total)

| Allocation | % |
|-----------|---|
| Training Rewards | 30% |
| Compute Providers | 20% |
| Model Developers | 15% |
| Community Treasury | 15% |
| Team (4yr vest) | 10% |
| Public Sale | 5% |
| Liquidity | 5% |

Utility: 0.01 HANZO/interaction, 0.001-0.1/1K tokens, 10+ to mint Model NFT, veHANZO governance.

## Proposal Process

1. Copy `docs/templates/hip-template.md` to `HIPs/hip-X.md`
2. Submit PR, community discussion, Last Call (14 days), Final
3. Status flow: Draft -> Review -> Last Call -> Final (or Withdrawn/Superseded)

## Commands

```bash
make validate-hip HIP=hip-X   # Format check
make check-links               # Reference check
act -j validate                # Local CI
cargo test --package hanzo-pqc # PQC tests
```

## Performance Targets

- First token <100ms (32B), streaming 50+ tok/s, training feedback <1s
- 10K+ concurrent users, 1M+ daily interactions, 100K+ active models
- BitDelta 10x memory savings, 4-bit inference, 90% cache hit

## Integration

- Hanzo <-> Lux: sovereign L1 via LP-25, shared PQC
- Hanzo <-> Zoo: shared HLLM architecture, model portability
- IEEE 2874: HSML, HSTP, Universal Data Graph

## OAuth/OIDC RFC Compliance (2026-03-05)

All Hanzo IAM endpoints are RFC 6749/OIDC standard. Legacy Casdoor paths still served for backward compat.

| RFC Path | Legacy Path | Purpose |
|----------|-------------|---------|
| `/oauth/authorize` | `/login/oauth/authorize` | Authorization endpoint |
| `/oauth/token` | `/api/login/oauth/access_token` | Token exchange |
| `/oauth/introspect` | `/api/login/oauth/introspect` | Token introspection |
| `/oauth/revoke` | — | Token revocation |
| `/oauth/userinfo` | `/api/userinfo` | UserInfo endpoint |
| `/oauth/device` | — | Device authorization |
| `/oauth/logout` | — | End session |
| `/.well-known/openid-configuration` | same | OIDC discovery |
| `/.well-known/jwks` | same | JSON Web Key Set |

SDKs updated: Python (hanzo-iam), JS (@hanzo/iam-sdk), Go (iamsdk), CLI (hanzo-cli).

## References

- VERSES/AXIOM, Friston Active Inference, NIST FIPS 203/204
- liboqs v0.11, MCP, FlashAttention-2, BitDelta
- RFC 6749 (OAuth 2.0), RFC 7636 (PKCE), RFC 7662 (Introspection), RFC 7009 (Revocation)
- RFC 8414 (AS Metadata), RFC 8628 (Device Auth), OIDC Core 1.0, OIDC Discovery 1.0
