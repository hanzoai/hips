---
hip: 0303
title: "Hanzo Brand Sovereignty and Federated App Discovery"
author: Zach Kelling (zach@hanzo.ai)
type: Meta
category: Governance
status: Final
created: 2026-05-29
requires: HIP-0014, HIP-0018
tags: [brand, white-label, federation, governance]
---

# HIP-303: Hanzo Brand Sovereignty and Federated App Discovery

## Abstract

Hanzo apps (Market, Exchange, IAM, Base, agents, MCP, etc.) consume the canonical `@hanzo/brand` package for their identity and ship with **only Hanzo brand data** in their source trees. White-label forks under other orgs (Lux, Zoo, Pars, Liquidity) own their brand independently — no cross-org brand presets live in Hanzo repos. Apps expose `/.well-known/<appId>.json` per IETF RFC 8615 so federated discovery surfaces (cross-org skill marketplaces, multi-exchange aggregators, etc.) can resolve a peer's brand identity, chain bindings, and capabilities at runtime. Federation peer lists ship empty in source and are populated via runtime ConfigMap at deploy time.

## Motivation

Two failure modes drove this HIP:

1. **`hanzoai/exchange` was forked from `zooai/exchange` and shipped with Zoo branding** — Zoo Labs Foundation copyright, ZOO/ZLUX/ZBTC tokens, `zoo.ngo` CSP, Zoo three-circle logo SVGs, `zoo-build-linux-amd64` CI runners. The shim worked because shipped users never saw the brand layer, but production deploys carried a regulated-compliance liability (Hanzo deployment carrying Zoo Labs Foundation copyright).
2. **`hanzoai/exchange` declared `@hanzoai/brand: ^1.2.0`** which 404s on npm. The canonical Hanzo brand package is `@hanzo/brand@1.3.0`. CI/CD installs broke silently because the lockfile was committed.

The fix is structural: each Hanzo app SOURCE TREE carries ONLY Hanzo brand data; the brand package is the published, versioned `@hanzo/brand@1.3.0`; runtime ConfigMap (not source) supplies federation peers.

## Specification

### 1. Canonical Hanzo brand package

`@hanzo/brand` (currently `1.3.0`, source at `~/work/hanzo/brand`) is the single source of truth for Hanzo brand identity. All Hanzo apps consume it as a dependency:

```json
{
  "dependencies": {
    "@hanzo/brand": "^1.3.0"
  }
}
```

Deprecated: `@hanzoai/brand` (broken — not published to npm, returns 404). Any remaining references MUST be replaced with `@hanzo/brand`.

### 2. Brand data isolation

Hanzo source repos (`hanzoai/*` on GitHub) MUST carry only Hanzo brand data. Specifically forbidden:

- Brand presets for Lux, Zoo, Pars, Liquidity, or any other org
- K8s manifests for non-Hanzo deployments (e.g. `hanzo-exchange.yaml` lives in `hanzoai/exchange`, NOT in `luxfi/exchange`)
- Federation peer URLs pointing to other orgs' deployments
- Cross-org logo SVGs, CSS color tokens, or copyright strings
- Code comments referencing other orgs' brand identity

Exempt:

- Genuine OSS dependency imports (`import { foo } from '@luxfi/exchange'` is fine — `@luxfi/exchange` is a real tooling dep)
- Chain identity metadata (e.g. "this skill targets the Hanzo subnet on Lux primary network, chainId 36963") — that's network metadata, not brand
- Image references to OSS upstream (e.g. `ghcr.io/luxfi/node` in Dockerfiles that pull the luxd binary)

### 3. White-label by fork, not by env-preset

Hanzo's canonical apps live in `hanzoai/*`. Forks for other brands live in those brands' org namespaces:

| Canonical | Description | Known forks |
|-----------|-------------|-------------|
| `hanzoai/market` | Bot / skill / agent marketplace | future: `zooai/market`, `parsai/market` |
| `hanzoai/exchange` | Hanzo Exchange (shim over `@luxfi/exchange`) | n/a |
| `hanzoai/iam` | IAM (auth + OAuth/OIDC + MPC keys) | white-labeled by domain at runtime — same code, brand from JWKS issuer config |
| `hanzoai/base-studio` | Hanzo Base studio | n/a |

No `BRAND_ID=<id>` runtime multiplexing in Hanzo's canonical apps. Each fork ships with its own brand JSON; bundled non-Hanzo presets are removed.

### 4. Federation discovery — `/.well-known/<appId>.json`

Each Hanzo app exposes its identity at `/.well-known/<appId>.json` per IETF RFC 8615:

```json
{
  "brandId": "hanzo",
  "appId": "market",
  "title": "Hanzo Market",
  "domain": "hanzo.market",
  "url": "https://hanzo.market",
  "github": "https://github.com/hanzoai/market",
  "chain": {
    "id": 36963,
    "name": "Hanzo Mainnet",
    "rpcUrl": "https://api.lux.network/mainnet/ext/bc/hanzo/rpc",
    "explorerUrl": "https://explore-hanzo.lux.network"
  },
  "peers": [],
  "capabilities": ["publish", "search", "install", "personas"],
  "apiVersion": "1",
  "apiBase": "https://hanzo.market/api/v1"
}
```

Same shape as LP-0010 and ZIP-0025. Federation peers (e.g. `https://zoo.market`, `https://parsai/market`) ship empty in source; operators mount a custom file via ConfigMap at deploy time.

### 5. Hanzo subnet branding

The Hanzo subnet runs on the Lux primary network (chainId 36963). Hanzo apps that surface chain identity (block explorers, bridges, etc.) MAY display the chain name "Hanzo Mainnet" without that constituting cross-brand pollution — chain identity is network metadata, not brand identity. The chain is named after the deployment, not the org.

The inverse holds for Lux's explorer: `luxfi/explore` displaying "Hanzo subnet" or showing a Hanzo logo as a chain identifier is network metadata, not cross-brand pollution.

### 6. Liquidity isolation

Hanzo source trees MUST NOT contain references to Liquidity (the regulated US securities ATS at `liquidityio/*`). Specifically: zero substring matches for `Liquidity.io`, `@liquidityio/*`, or any Liquidity surface name in Hanzo source. Hanzo Inc. and Liquidity LLC have distinct legal and compliance scopes; source-level mention blurs that boundary.

The inverse rule (Liquidity must not reference Hanzo) is codified in `liquidityio/*` CLAUDE.md.

## Rationale

**Why `@hanzo/brand`, not `@hanzoai/brand`?** Historical accident — `@hanzo/brand` is the npm-published canonical (1.3.0 at time of writing). `@hanzoai/brand` was a name claim that never published. Standardizing on `@hanzo/brand` lets us delete the 404 risk surface entirely.

**Why federation via `/.well-known/`?** RFC 8615 is the standard. Re-using it means cross-org aggregator UIs (e.g. a future "Hanzo Market that browses skills from Zoo Market and Pars Market") get standard HTTP caching, CDN behavior, and operator mental models for free.

**Why fork over multi-tenant?** Each org's engineering team owns their fork's release cadence. Multi-tenant runtime would make Hanzo upstream the dependency bottleneck for every brand's release.

## Backwards Compatibility

- `@hanzoai/brand` consumers MUST migrate to `@hanzo/brand@1.3.0`. The two are not API-compatible — `@hanzoai/brand` was never published.
- Apps that previously assumed `BRAND_ID=<id>` selected between bundled presets will find only Hanzo + generic in `public/brands/`. Other-org deploys must fork.

## Reference Implementation

| Repo | Commit | Action |
|------|--------|--------|
| `hanzoai/market` | `29a77cb` + `da7008e` | Bot Hub → Hanzo Market rebrand (145 files); only Hanzo + generic presets remain |
| `hanzoai/exchange` | `56ae5c8` | `@hanzoai/brand` (404) → `@hanzo/brand@1.3.0`; massive Zoo→Hanzo cleanup (was forked from Zoo) |
| `hanzoai/iam` | `9a1fd61b` | 13+ Liquidity refs removed; `/.well-known/iam.json` shipped |
| `hanzoai/base-studio` | `c38131a` | `/.well-known/base.json` shipped (no crossover found) |
| `@hanzo/brand` | `1.3.0` | Canonical published Hanzo brand package |

## Security Considerations

- **Brand spoofing via ConfigMap mount**: Operators must restrict ConfigMap write access via RBAC. A compromised ConfigMap could spoof peer URLs.
- **TLS-only**: `/.well-known/<appId>.json` MUST be served via HTTPS.
- **Liquidity isolation**: Enforced socially today. Future HIP MAY codify as a pre-merge CI check (`gh-actions/no-liquidity-refs`).

## See Also

- LP-0010 — Lux ecosystem's same architecture
- ZIP-0025 — Zoo ecosystem's same architecture
- HIP-0014 — Application Deployment Standard
- IETF RFC 8615 — Well-Known URIs
