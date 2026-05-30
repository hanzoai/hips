---
hip: 0304
title: "Hanzo adopts LP-0011: Onchain Federation Registry"
author: Zach Kelling (zach@hanzo.ai)
type: Standards Track
category: Interface
status: Draft
created: 2026-05-29
requires: HIP-0303, HIP-0014
references: LP-0011
tags: [federation, registry, brand, white-label, discovery, precompile, post-quantum, pointer]
---

# HIP-0304: Hanzo adopts LP-0011 — Onchain Federation Registry

## Abstract

Hanzo adopts [LP-0011](https://github.com/luxfi/lps/blob/main/LPs/lp-0011-onchain-federation-registry.md) verbatim on the Hanzo subnet. The Lux Proposal is the canonical spec for the EVM precompile at address `0x0000000000000000000000000000000000011001`, the schema, the commit-reveal flow, the JCS canonicalisation (RFC 8785), the 90-day re-attestation cadence, the 0.01 LUX anti-sybil fee, and the strict-PQ ML-DSA-65 owner-key profile. The precompile MUST be byte-identical across Lux primary C-Chain and the Hanzo subnet so a single client library targets either RPC endpoint without code changes.

This document records Hanzo subnet activation, the canonical Hanzo `appId` map, and Hanzo-specific composition with MCP discovery; the normative text lives in LP-0011.

## Hanzo-specific notes

- **Activation**: subnet flag `hip0304-onchain-federation-registry` is gated on Hanzo subnet validator-set consensus and is independent from Lux primary-network LP-0011 activation.

  | Network | Chain ID | Precompile address |
  |---------|----------|---------------------|
  | Hanzo mainnet | 36963 | `0x0000000000000000000000000000000000011001` |
  | Hanzo testnet | 36964 | `0x0000000000000000000000000000000000011001` |
  | Hanzo devnet  | 36964 | `0x0000000000000000000000000000000000011001` |

- **Canonical Hanzo `appId` table** (lowercase ASCII, byte-padded to `bytes32`):

  | `appId` | Canonical app | Canonical domain |
  |---------|---------------|-------------------|
  | `market`   | `hanzoai/market` | `hanzo.market` |
  | `exchange` | `hanzoai/exchange` | `hanzo.exchange` |
  | `iam`      | `hanzoai/iam` | `hanzo.id` |
  | `base`     | `hanzoai/base-studio` | `hanzo.base` |
  | `studio`   | `hanzoai/studio` | `hanzo.studio` |
  | `docs`     | `hanzoai/docs` | `docs.hanzo.ai` |
  | `mcp`      | (forthcoming MCP directory) | TBD |
  | `agents`   | (forthcoming agent directory) | TBD |

- **Strict-PQ by default**: Hanzo subnet ships strict-PQ-enabled per HIP-0005. Registrations MUST set `ownerPubKey` to an ML-DSA-65 (FIPS 204, LP-4400) public key; registrations created with secp256k1-only keys become read-only at the strict-PQ activation height.
- **MCP discovery binding**: Hanzo apps that expose an MCP endpoint per HIP-0010 SHOULD include the MCP root URL inside `/.well-known/<appId>.json` under an `mcp` key (`{ "url", "version", "auth" }`). Because LP-0011's `wellKnownHash` covers the whole JSON document, the MCP URL is implicitly attested as part of the federated registration; rotating MCP endpoints requires a registry `update()` call.
- **Liquidity blocklist**: the Hanzo subnet's federation precompile MUST reject registrations with `brandId == bytes32("liquidity")` (hardcoded blocklist constant); Liquidity's federation registry lives on  (chainId 8675309) and is not bridged into Hanzo.
- **Cross-chain registration**: Hanzo apps serving traffic from both Lux mainnet and Hanzo subnet SHOULD register independently on each chain — LP-0011 §6 binds `block.chainid` into every commit hash so the same calldata cannot be replayed.
- **v0.2 Registry/Resolver split**: Hanzo subnet implementations MUST deploy BOTH precompiles atomically — `0x0000000000000000000000000000000000011001` (`FederationRegistry` resolver) AND `0x0000000000000000000000000000000000011002` (`BrandConfigStore`). Partial deployment is rejected by node bootstrap. The resolver address is unchanged from v0.1 so existing federation aggregator clients keep working without code changes.

## Reference implementation (Hanzo)

- Precompile (Go, Hanzo subnet EVM): inherits the LP-0011 reference implementation; subnet activation flag wired in `~/work/hanzo/subnet-evm/precompile/contracts/federationregistry/` (forthcoming)
- Solidity reference contract: deployed at the same address on the Hanzo subnet
- Client library: `@luxfi/federation-registry` (chainId selection targets either chain)

## See also

- [LP-0011](https://github.com/luxfi/lps/blob/main/LPs/lp-0011-onchain-federation-registry.md) — canonical spec
- [ZIP-0032](https://github.com/zooai/zips/blob/main/ZIPs/zip-0032-onchain-federation-registry.md) — Zoo's adoption pointer
- HIP-0303 — Hanzo's adoption of LP-0010 (HTTP `/.well-known/` predecessor)
- HIP-0005 — Post-Quantum Security for AI Infrastructure (Hanzo strict-PQ defaults)
- HIP-0010 — Model Context Protocol (MCP) Integration Standards
- HIP-0014 — Application Deployment Standard
- HIP-0025 — Bot/Agent Wallet-RPC Billing Protocol
- IETF RFC 8615 — Well-Known URIs
- IETF RFC 8785 — JSON Canonicalization Scheme
