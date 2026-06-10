---
hip: 0303
title: "Hanzo adopts LP-0010: Brand Sovereignty and Federation Discovery"
author: Zach Kelling (zach@hanzo.ai)
type: Meta
category: Governance
status: Final
created: 2026-05-29
requires: HIP-0014, HIP-0018
references: LP-0010
tags: [brand, white-label, federation, governance, pointer]
---

# HIP-0303: Hanzo adopts LP-0010 — Brand Sovereignty and Federation Discovery

## Abstract

Hanzo adopts [LP-0010](https://github.com/luxfi/lps/blob/main/LPs/lp-0010-brand-sovereignty-and-federation-discovery.md) verbatim. The Lux Proposal is the canonical spec for the schema, the per-org sovereignty rule, the white-label-by-fork model, the `/.well-known/<appId>.json` discovery endpoint (IETF RFC 8615), and the ConfigMap peer overlay. Hanzo's `hanzoai/*` repos carry only Hanzo brand data; HTTP federation discovery for Hanzo apps happens at `/.well-known/<appId>.json` per the shared spec.

This document records Hanzo-specific adoption details and the commit log; the normative text lives in LP-0010.

## Hanzo-specific notes

- **Canonical brand package**: `@hanzo/brand@1.3.0` (npm, source at `~/work/hanzo/brand`). Deprecated alias `@hanzoai/brand` 404s on npm — do not use; any remaining references MUST migrate to `@hanzo/brand`.
- **Hanzo subnet branding**: the Hanzo subnet runs on the Lux primary network (chainId 36963). Hanzo apps that surface chain identity (block explorers, bridges) MAY display the chain name "Hanzo Mainnet" — chain identity is network metadata, not brand identity, and is therefore exempt from LP-0010's cross-brand pollution rule. The inverse also holds: Lux's canonical explorer displaying "Hanzo subnet" or a Hanzo chain logo is network metadata, not cross-brand pollution.
- **Hanzo source-tree scope**: `hanzoai/*` GitHub repos host Hanzo brand data only. No Lux / Zoo / Pars brand presets, k8s manifests, or federation peer URLs in source. Cross-org image references (`ghcr.io/luxfi/node` pulled as an upstream OSS dep) are exempt per LP-0010 §7.
- **IAM white-labeling**: `hanzoai/iam` is white-labeled by domain at runtime (same code, brand resolved from the JWKS issuer config) rather than by fork.

## Reference implementation (Hanzo)

| Repo | Commit | Action |
|------|--------|--------|
| `hanzoai/market` | `29a77cb` + `da7008e` | Bot Hub → Hanzo Market rebrand (145 files); only Hanzo + generic presets remain |
| `hanzoai/exchange` | `56ae5c8` | `@hanzoai/brand` (404) → `@hanzo/brand@1.3.0`; Zoo→Hanzo cleanup (had been forked from Zoo) |
| `hanzoai/iam` | `9a1fd61b` | Cross-brand refs removed; added `/.well-known/iam.json` |
| `hanzoai/base-studio` | `c38131a` | Added `/.well-known/base.json` |
| `@hanzo/brand` | `1.3.0` | Canonical published Hanzo brand package |

## See also

- [LP-0010](https://github.com/luxfi/lps/blob/main/LPs/lp-0010-brand-sovereignty-and-federation-discovery.md) — canonical spec
- [ZIP-0031](https://github.com/zooai/zips/blob/main/ZIPs/zip-0031-brand-sovereignty-and-federation-discovery.md) — Zoo's adoption pointer
- HIP-0304 — onchain registry sibling (adopts LP-0011)
- HIP-0005 — Post-Quantum Security for AI Infrastructure
- HIP-0010 — Model Context Protocol (MCP) Integration Standards
- HIP-0014 — Application Deployment Standard
- IETF RFC 8615 — Well-Known URIs
