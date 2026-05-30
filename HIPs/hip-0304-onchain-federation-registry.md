---
hip: 0304
title: "Hanzo Onchain Federation Registry"
author: Zach Kelling (zach@hanzo.ai)
type: Standards Track
category: Interface
status: Draft
created: 2026-05-29
requires: HIP-0303, HIP-0014
tags: [federation, registry, brand, white-label, discovery, precompile, post-quantum]
---

# HIP-0304: Hanzo Onchain Federation Registry

## Abstract

HIP-0304 adopts LP-0011's onchain federation registry — an EVM precompile at the canonical address `0x0000000000000000000000000000000000011001` — on the Hanzo subnet (chainId 36963 mainnet, 36964 testnet, 36964 devnet) running on the Lux primary network. Hanzo apps (Market, Exchange, IAM, Base, agents, MCP servers, skills) MAY publish their `(brandId, appId, domain, url, wellKnownHash, owner)` tuple onchain to give chain-native consumers — bots, automated marketplaces, MCP discovery infrastructure, agent routers — a verifiable answer to "what canonical app implements `(hanzo, market)` today?". The registry is the chain-native successor to HIP-0303's HTTP-only `/.well-known/<appId>.json` discovery; the two layers compose, they do not replace each other.

## Motivation

HIP-0303 standardised `/.well-known/<appId>.json` as the HTTP federation surface for Hanzo apps. Two Hanzo-specific use cases push beyond HTTP:

1. **Agent / bot discovery.** Hanzo Market's whole reason to exist is "agents can discover other agents". An agent (running onchain via HIP-0025 wallet-RPC billing) querying "what's the canonical Hanzo skill marketplace?" should be able to resolve that question via `staticcall` to a precompile, not by depending on its caller having pre-configured the right HTTPS endpoint. HTTP-only discovery puts a trust root outside the agent's reach.

2. **MCP server registries.** HIP-0010 (MCP integration) anticipates a directory of MCP servers each app exposes. A Hanzo subnet smart contract that wants to wire an MCP server to a service mesh should be able to verify, against the chain, that "yes, `https://hanzo.market/mcp` is the canonical MCP endpoint for `(hanzo, market)`, signed off by the brand owner". HIP-0303 alone can't deliver that.

Onchain registration provides verifiable origin binding. The `wellKnownHash` commits the registry to a specific JSON document; a verifier fetches the live document, computes its keccak hash, and asserts it matches the chain. A compromised CDN or DNS hijack cannot substitute a forged document without also compromising the onchain owner key.

## Specification

### 1. Inherits LP-0011

This HIP **wholly inherits** the LP-0011 specification — schema, commit-reveal flow, ML-DSA-65 strict-PQ profile, JCS canonicalisation, 90-day re-attestation, 0.01 LUX registration fee, and address `0x0000000000000000000000000000000000011001`. The precompile MUST be byte-identical across Lux primary C-Chain and the Hanzo subnet; consumers SHOULD be able to point a single client library at either RPC endpoint without code changes.

Where this HIP says "consumer", "registrant", "watcher", "owner" — see LP-0011 for normative meaning.

### 2. Hanzo subnet activation

| Network | Chain ID | Precompile address | Activation |
|---------|----------|---------------------|------------|
| Hanzo mainnet | 36963 | `0x0000000000000000000000000000000000011001` | enabled at activation height |
| Hanzo testnet | 36964 | `0x0000000000000000000000000000000000011001` | enabled at activation height |
| Hanzo devnet  | 36964 | `0x0000000000000000000000000000000000011001` | always enabled |

The subnet runs its own activation flag (`hip0304-onchain-federation-registry`) gated on subnet validator-set consensus; Lux primary-network activation (LP-0011) is independent.

### 3. Hanzo brand registration discipline

Per HIP-0303, only Hanzo source repos carry Hanzo brand data. Hanzo apps that wish to register on the Hanzo subnet (or on Lux mainnet, or both — these are independent registrations per LP-0011 chainId binding) MUST:

1. Register with `brandId = bytes32("hanzo")` (lowercase ASCII, byte-padded).
2. Use one of the canonical Hanzo `appId` values:

   | appId (bytes32 form) | Canonical app | Canonical domain |
   |----------------------|---------------|-------------------|
   | `bytes32("market")`   | `hanzoai/market` | `hanzo.market` |
   | `bytes32("exchange")` | `hanzoai/exchange` | `hanzo.exchange` |
   | `bytes32("iam")`      | `hanzoai/iam` | `hanzo.id` |
   | `bytes32("base")`     | `hanzoai/base-studio` | `hanzo.base` |
   | `bytes32("studio")`   | `hanzoai/studio` | `hanzo.studio` |
   | `bytes32("docs")`     | `hanzoai/docs` | `docs.hanzo.ai` |
   | `bytes32("mcp")`      | (forthcoming MCP directory) | TBD |
   | `bytes32("agents")`   | (forthcoming agent directory) | TBD |

3. Set `ownerPubKey` to an ML-DSA-65 (FIPS 204, LP-4400) public key for forward compatibility with strict-PQ activation. Hanzo subnet ships strict-PQ-enabled by default per HIP-0005.

### 4. Cross-subnet registration

Hanzo apps that serve traffic from multiple networks (e.g. `hanzo.market` answers from both Lux mainnet and Hanzo subnet RPC) SHOULD register independently on each chain. The LP-0011 replay-protection scheme uses `block.chainid` in the commit hash, so the same calldata cannot be replayed; each network requires its own commit-reveal round.

A future companion HIP MAY define a Warp-based mirror that lets Lux primary registrations be discoverable read-only on the Hanzo subnet (and vice versa) without re-registering. Out of scope for v0.

### 5. Hanzo bot / agent / skill discovery

A Hanzo Market consumer (the Market UI, a third-party agent runtime, or an onchain router) discovers the canonical Hanzo Market by:

```solidity
import {IFederationRegistry} from "@luxfi/lps/contracts/IFederationRegistry.sol";

contract MarketDiscovery {
    IFederationRegistry constant REGISTRY =
        IFederationRegistry(0x0000000000000000000000000000000000011001);

    function getHanzoMarket() external view returns (string memory url, bytes32 wellKnownHash) {
        IFederationRegistry.AppRegistration[] memory rs =
            REGISTRY.getByBrandApp(bytes32("hanzo"), bytes32("market"));
        require(rs.length > 0, "hanzo.market not registered");
        return (rs[0].url, rs[0].wellKnownHash);
    }
}
```

The consumer then fetches `https://<url>/.well-known/market.json`, JCS-canonicalises the response per LP-0011 §4, hashes it, and asserts equality with `wellKnownHash`. Any divergence (DNS hijack, CDN attack, stale cache) is detectable at the consumer.

### 6. MCP discovery binding

Hanzo apps that expose an MCP endpoint per HIP-0010 SHOULD include the MCP root URL in the `/.well-known/<appId>.json` payload under a `mcp` key:

```json
{
  "brandId": "hanzo",
  "appId": "market",
  "title": "Hanzo Market",
  "domain": "hanzo.market",
  "url": "https://hanzo.market",
  "mcp": {
    "url": "https://hanzo.market/mcp",
    "version": "2025-03-26",
    "auth": ["bearer", "mtls-h2"]
  },
  ...
}
```

Because `wellKnownHash` commits the entire JSON document, the MCP URL is implicitly attested as part of the federated registration. A consumer that verifies `wellKnownHash` also verifies the MCP discovery payload.

### 7. Liquidity isolation

Per HIP-0303 §6, Hanzo source trees MUST NOT mention Liquidity. The Hanzo subnet's federation registry MUST reject registrations with `brandId = bytes32("liquidity")` — this is enforced at the precompile level via a hardcoded brand blocklist (`{"liquidity"}`). Liquidity's own federation registry lives on  (chainId 8675309) per Liquidity-side governance and is not bridged into Hanzo.

## Rationale

**Why mirror LP-0011 verbatim on the Hanzo subnet?** Address-stable, ABI-stable, semantically-stable. A Hanzo agent ported from Lux mainnet to Hanzo subnet, or vice versa, should not have to recompile. The mirror lets each subnet decide whether to enable the precompile flag locally without forking the ABI.

**Why allow registration on either chain (or both)?** Hanzo subnet has independent block production, finality, and RPC. Some Hanzo apps will live primarily on the subnet (agent routers, MCP directories) and prefer subnet-local discovery. Others (the Hanzo Market UI, IAM) are bridged through Lux primary network and prefer mainnet discovery. The dual-registration model lets each app pick the chain whose security model best matches its use case.

**Why hardcode `liquidity` as blocklisted at the precompile level?** It's the simplest enforcement of the cross-org boundary. Brand-allowlist gating is deferred (LP-0011 ships FCFS); brand-blocklist gating is one constant in the precompile and forecloses a known compliance hazard at zero ongoing cost.

**Why ML-DSA-65 by default?** Hanzo subnet ships strict-PQ-enabled (HIP-0005). Registrations without `ownerPubKey` become read-only at activation. Apps that defer PQ key generation will be unable to update their registrations after the strict-PQ flag flips, which would be embarrassing and avoidable.

## Backwards Compatibility

HIP-0304 is additive. HIP-0303's HTTP discovery continues to work unchanged. Apps with no onchain registration are unaffected. Consumers MAY use HTTP only, onchain only, or both.

The cross-org `(brandId, appId)` namespace is shared across LP-0011 / HIP-0304 / ZIP-0032 / equivalents at the **schema** level (same `bytes32` types, same canonical lowercase ASCII forms) but **registrations are per-chain** (LP-0011 §6 replay protection). A `(hanzo, market)` registered on Lux mainnet is distinct from `(hanzo, market)` on Hanzo subnet.

## Reference Implementation

- Precompile (Go, Hanzo subnet EVM): inherits the LP-0011 reference implementation; subnet activation flag wired in `~/work/hanzo/subnet-evm/precompile/contracts/federationregistry/` (forthcoming)
- Solidity reference contract: deployed at the same address on subnet
- TS/Go client: `@luxfi/federation-registry` (single client targets any LP-0011-compliant chain via chainId selection)

## Security Considerations

All LP-0011 security considerations apply unchanged. Hanzo-subnet-specific:

- **Cross-chain registration confusion**: a consumer that queries the Hanzo subnet registry for `(hanzo, market)` and gets a stale or attacker-controlled registration MUST NOT assume that registration is canonical on Lux mainnet. Cross-chain consumers SHOULD query both chains and reconcile.
- **Subnet activation skew**: if the Hanzo subnet activates HIP-0304 before Lux mainnet activates LP-0011 (or vice versa), the dual-chain registration model has a temporal gap. Apps SHOULD register on whichever chain is live first; the other chain's registration is filed when its flag activates.
- **MCP payload integrity**: because `wellKnownHash` covers the whole JSON document including `mcp.url`, swapping MCP servers requires an `update()` call that rotates the well-known hash. Forgetting to update breaks the verifier's MCP discovery (the cached MCP URL becomes verifiably wrong).
- **Hanzo subnet PQ posture**: strict-PQ profile is the Hanzo default (HIP-0005). Registrations created with secp256k1-only keys will transition to read-only at strict-PQ activation. App owners MUST generate ML-DSA-65 keys before that activation height or face inability to update / revoke.
- **Brand-blocklist enforcement**: the Liquidity blocklist is enforced at precompile entry. A future LP/HIP that expands or contracts this list MUST update the precompile constant; no governance backdoor exists.

## See Also

- LP-0011 — Onchain Federation Registry (canonical spec; this HIP inherits from it)
- HIP-0303 — Hanzo Brand Sovereignty and Federated App Discovery (HTTP `/.well-known/` predecessor)
- HIP-0005 — Post-Quantum Security for AI Infrastructure (Hanzo strict-PQ defaults)
- HIP-0010 — MCP Integration Standards
- HIP-0014 — Application Deployment Standard
- HIP-0025 — Bot/Agent Wallet-RPC Billing Protocol
- ZIP-0032 — Zoo subnet adoption of the same registry
- IETF RFC 8615 — Well-Known URIs
- IETF RFC 8785 — JSON Canonicalization Scheme
