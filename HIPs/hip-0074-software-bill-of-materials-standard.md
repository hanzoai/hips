---
hip: 0074
title: Software Bill of Materials & Git Stamp Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-02-23
requires: HIP-0027, HIP-0033, HIP-0036
---


# HIP-0074: Software Bill of Materials & Git Stamp Standard

## Abstract

This proposal defines the Software Bill of Materials (SBOM) and Git Stamp standard for the Hanzo ecosystem. Every deployed artifact -- container image, binary, library, or package -- MUST carry a machine-readable inventory of its components (the SBOM) and a cryptographic attestation linking it to the exact source code, build environment, and dependency tree that produced it (the Git Stamp).

Hanzo SBOM provides automated generation of industry-standard SBOM documents in both SPDX and CycloneDX formats, cryptographic signing via Sigstore/cosign, build provenance attestations targeting SLSA Level 3, and on-chain anchoring to the Lux Network for immutable audit trails. It integrates with every stage of the Hanzo CI/CD pipeline (HIP-0036), stores signed artifacts in the Container Registry (HIP-0033), manages signing keys through KMS (HIP-0027), and publishes provenance records to the blockchain (HIP-0020/HIP-0024).

**Repository**: [github.com/hanzoai/sbom](https://github.com/hanzoai/sbom)
**API Port**: 8074
**Production**: https://sbom.hanzo.ai
**Docker**: `ghcr.io/hanzoai/sbom:latest`

## Motivation

### Why Software Supply Chain Security Matters

On December 13, 2020, the cybersecurity firm FireEye disclosed that attackers had compromised SolarWinds Orion, a network monitoring tool used by 18,000 organizations including the US Treasury, Department of Homeland Security, and major technology companies. The attackers injected malicious code into the Orion build system. Every customer who installed the legitimate, signed software update received the backdoor. The software was signed. The hashes matched. The update server was authentic. The supply chain itself was the attack vector.

On December 9, 2021, a critical vulnerability (CVE-2021-44228) was disclosed in Apache Log4j, a logging library embedded in virtually every Java application on earth. The vulnerability allowed remote code execution by simply sending a crafted string to any application that logged user input. Organizations scrambled to determine which of their services used Log4j, at what version, and whether they were exposed. Most could not answer these questions quickly because they had no inventory of their software components. The median time to patch was 17 days -- 17 days of known exploitability because organizations did not know what they had deployed.

These are not edge cases. They are the predictable consequence of deploying software without knowing what is inside it.

An SBOM is the ingredients label for software. It answers three questions:

1. **What components are in this artifact?** -- Libraries, frameworks, runtimes, and their exact versions
2. **Where did each component come from?** -- Package registries, source repositories, vendored copies
3. **What are the known risks?** -- CVEs affecting those versions, license obligations, end-of-life status

A Git Stamp extends this by answering a fourth question:

4. **Who built this, from what source, in what environment, and can you prove it?** -- Cryptographic attestation binding the artifact to its complete provenance chain

### Regulatory Drivers

This is no longer optional. Two major regulatory frameworks now mandate SBOM:

**US Executive Order 14028** (May 12, 2021) -- "Improving the Nation's Cybersecurity" -- requires all software sold to the US federal government to include an SBOM. Section 4(e) directs NIST to publish minimum SBOM elements, which became NTIA's "Minimum Elements for a Software Bill of Materials" (July 2021). Any Hanzo customer in the federal supply chain needs SBOM from us.

**EU Cyber Resilience Act (CRA)** (entered into force December 2024, enforcement begins September 2026) -- requires all products with digital elements sold in the EU to maintain and provide an SBOM, implement vulnerability handling processes, and provide security updates for the product lifetime. The CRA applies to Hanzo because our services process data for EU customers and our open-source libraries are distributed to EU developers.

Non-compliance is not a theoretical risk. The CRA carries fines up to 15 million EUR or 2.5% of global annual turnover.

### The Hanzo-Specific Problem

Hanzo operates 260+ repositories producing container images, Go binaries, Python packages, Rust crates, npm packages, and WASM modules. Without automated SBOM:

- When a CVE is disclosed, we cannot quickly enumerate which services are affected
- When a dependency license changes (as happened with Elasticsearch in 2021), we cannot assess the blast radius
- When a customer asks for our software composition, we have no machine-readable answer
- When we deploy to production, we cannot cryptographically prove that the running binary corresponds to a specific reviewed commit

This HIP solves all four problems.

## Specification

- License files in source (SPDX license identifier matching)
- SPDX license expressions for complex multi-license packages

#### License Policy

| License Category | Policy | Examples |
|-----------------|--------|----------|
| **Permissive** | Allowed | MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC |
| **Weak copyleft** | Allowed with review | LGPL-2.1, MPL-2.0, EPL-2.0 |
| **Strong copyleft** | Requires legal review | GPL-2.0, GPL-3.0, AGPL-3.0 |
| **Non-commercial** | Blocked | CC-BY-NC, SSPL, BSL (for competing use) |
| **Unknown** | Requires manual classification | No license detected |

The CI pipeline flags license violations as warnings. Strong copyleft and non-commercial licenses in direct dependencies block the build.

## Implementation

### CI/CD Integration (HIP-0036)

The SBOM workflow is added as a post-build step in every Hanzo CI pipeline:

```yaml
# .github/workflows/docker-deploy.yml (addition to HIP-0036 standard)
  sbom-and-sign:
    name: SBOM, Sign, Attest
    needs: [docker-release]
    if: needs.docker-release.outputs.digest != ''
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
      id-token: write    # Required for cosign keyless signing
    env:
      IMAGE: ghcr.io/hanzoai/${{ env.SERVICE }}
      DIGEST: ${{ needs.docker-release.outputs.digest }}
    steps:
      - uses: actions/checkout@v4

      # Install tools
      - name: Install Syft
        uses: anchore/sbom-action/download-syft@v0

      - name: Install Grype
        uses: anchore/scan-action/download-grype@v4

      - name: Install Cosign
        uses: sigstore/cosign-installer@v3

      # Generate SBOMs
      - name: Generate SPDX SBOM
        run: syft ${IMAGE}@${DIGEST} -o spdx-json=sbom.spdx.json

      - name: Generate CycloneDX SBOM
        run: syft ${IMAGE}@${DIGEST} -o cyclonedx-json=sbom.cdx.json

      # Vulnerability scan
      - name: Scan for vulnerabilities
        run: |
          grype sbom:sbom.cdx.json \
            --output json --output table \
            --fail-on critical

      # License check
      - name: Check license compliance
        run: |
          syft ${IMAGE}@${DIGEST} -o json \
            | jq -r '.artifacts[].licenses[].value' \
            | sort -u > detected-licenses.txt
          # Fail if AGPL/GPL/SSPL detected in direct deps
          if grep -qiE '(AGPL|GPL-3|SSPL)' detected-licenses.txt; then
            echo "::error::Copyleft license detected. Requires legal review."
            exit 1
          fi

      # Sign image
      - name: Sign container image
        run: cosign sign --yes ${IMAGE}@${DIGEST}

      # Attach SBOM as OCI artifact
      - name: Attach SPDX SBOM
        run: cosign attach sbom --sbom sbom.spdx.json ${IMAGE}@${DIGEST}

      # Create and sign SLSA provenance attestation
      - name: Attest provenance
        run: |
          cosign attest --yes \
            --predicate provenance.json \
            --type slsaprovenance1 \
            ${IMAGE}@${DIGEST}

      # Anchor to Lux L1
      - name: Anchor provenance on-chain
        env:
          SBOM_API_URL: https://sbom.hanzo.ai
          KMS_CLIENT_ID: ${{ secrets.KMS_CLIENT_ID }}
          KMS_CLIENT_SECRET: ${{ secrets.KMS_CLIENT_SECRET }}
        run: |
          SPDX_HASH=$(sha256sum sbom.spdx.json | cut -d' ' -f1)
          CDX_HASH=$(sha256sum sbom.cdx.json | cut -d' ' -f1)
          PROV_HASH=$(sha256sum provenance.json | cut -d' ' -f1)

          curl -fsS -X POST "${SBOM_API_URL}/api/v1/anchor" \
            -H "Content-Type: application/json" \
            -d "{
              \"artifact\": \"${IMAGE}@${DIGEST}\",
              \"git_commit\": \"${GITHUB_SHA}\",
              \"git_ref\": \"${GITHUB_REF}\",
              \"sbom_spdx_sha256\": \"${SPDX_HASH}\",
              \"sbom_cdx_sha256\": \"${CDX_HASH}\",
              \"provenance_sha256\": \"${PROV_HASH}\",
              \"slsa_level\": 3
            }"
```

### SBOM Service API

The SBOM service at `sbom.hanzo.ai:8074` provides a REST API for querying, verifying, and managing SBOM data.

#### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/v1/anchor` | Submit provenance for on-chain anchoring |
| `GET` | `/api/v1/sbom/{artifact}` | Retrieve SBOM for an artifact (content-negotiation for format) |
| `GET` | `/api/v1/provenance/{artifact}` | Retrieve SLSA provenance for an artifact |
| `GET` | `/api/v1/verify/{artifact}` | Verify full provenance chain (signature + SBOM + on-chain) |
| `GET` | `/api/v1/vulnerabilities/{artifact}` | List known vulnerabilities for an artifact |
| `GET` | `/api/v1/licenses/{artifact}` | List detected licenses for an artifact |
| `GET` | `/api/v1/anchor/{tx_hash}` | Retrieve on-chain anchor receipt |
| `GET` | `/api/v1/search?cve={CVE-ID}` | Find all artifacts affected by a CVE |
| `GET` | `/api/v1/search?component={name}&version={ver}` | Find all artifacts containing a component |
| `GET` | `/health` | Health check |
| `GET` | `/metrics` | Prometheus metrics |

#### Content Negotiation

The `/api/v1/sbom/{artifact}` endpoint respects the `Accept` header:

| Accept Header | Response Format |
|---------------|-----------------|
| `application/spdx+json` | SPDX 2.3 JSON |
| `application/vnd.cyclonedx+json` | CycloneDX 1.6 JSON |
| `application/json` (default) | CycloneDX 1.6 JSON |
| `text/xml` | CycloneDX 1.6 XML |

### Storage Architecture

```
SBOM Service (sbom.hanzo.ai:8074)
  |
  +---> SQL (sbom database)
  |       - Artifact metadata, scan results, exemptions
  |       - Indexed by artifact digest for fast CVE lookups
  |
  +---> OCI Registry (ghcr.io/hanzoai)
  |       - SBOM documents stored as OCI referrers
  |       - Cosign signatures and attestations
  |
  +---> Lux L1 (via luxfi/coreth)
  |       - Provenance anchors (156 bytes per artifact)
  |       - Immutable, third-party verifiable
  |
  +---> Rekor (Sigstore transparency log)
          - Cosign signature records
          - Independent audit trail
```

### Verification Flow

A consumer verifying an artifact follows this chain:

```
1. Pull image digest
   docker pull ghcr.io/hanzoai/iam:1.584.0
   -> sha256:abc123...

2. Verify cosign signature
   cosign verify \
     --certificate-oidc-issuer=https://token.actions.githubusercontent.com \
     --certificate-identity-regexp="github.com/hanzoai/.*" \
     ghcr.io/hanzoai/iam@sha256:abc123...
   -> Signature valid. Signed by github.com/hanzoai/iam/.github/workflows/...

3. Verify SLSA provenance
   cosign verify-attestation \
     --type slsaprovenance1 \
     --certificate-oidc-issuer=https://token.actions.githubusercontent.com \
     --certificate-identity-regexp="github.com/hanzoai/.*" \
     ghcr.io/hanzoai/iam@sha256:abc123...
   -> Provenance valid. Built from commit a1b2c3d4 on 2026-02-23

4. Fetch SBOM
   curl -H "Accept: application/spdx+json" \
     https://sbom.hanzo.ai/api/v1/sbom/ghcr.io/hanzoai/iam@sha256:abc123...
   -> SPDX document with 247 components

5. Verify on-chain anchor
   curl https://sbom.hanzo.ai/api/v1/verify/ghcr.io/hanzoai/iam@sha256:abc123...
   -> {
        "verified": true,
        "lux_tx": "0xdeadbeef...",
        "block_number": 12345678,
        "block_timestamp": "2026-02-23T10:06:00Z",
        "sbom_hashes_match": true,
        "provenance_hash_match": true
      }
```

Each step is independently verifiable. Step 2 requires only cosign and the Sigstore public infrastructure. Step 3 requires only cosign. Step 5 requires only a Lux L1 RPC endpoint. No trust in Hanzo infrastructure is required for verification.

## Security

### Threat Model

| Threat | Attack Vector | Mitigation |
|--------|--------------|------------|
| Compromised build produces false SBOM | Attacker modifies CI workflow | SLSA L3: provenance is non-falsifiable (GitHub OIDC identity) |
| SBOM tampered after generation | Attacker modifies stored SBOM | Cosign signature + on-chain hash anchor |
| Dependency confusion attack | Malicious package with same name | SBOM records package source URLs; verification against known registries |
| CVE database poisoning | False CVE injected into scan database | Multiple database sources (NVD, OSV, GHSA); cross-reference |
| Signing key compromise | Attacker obtains signing key | Keyless signing: no long-lived keys. OIDC tokens expire in minutes |
| On-chain anchor replay | Attacker re-anchors old SBOM for new artifact | Anchor includes artifact digest; cannot be reused for different artifact |
| SBOM service compromise | Attacker gains access to sbom.hanzo.ai | On-chain anchors are immutable; Rekor transparency log is independent |

### Key Management Integration (HIP-0027)

The SBOM service uses two types of keys:

1. **Signing keys** (cosign): Keyless by default. For offline verification scenarios, KMS-backed keys are stored at `kms.hanzo.ai` under the path `/sbom/signing`.

2. **Lux wallet key** (anchoring): The wallet private key for on-chain transactions is stored in KMS at `/sbom/lux-wallet`. The SBOM service authenticates to KMS via Universal Auth.

```
SBOM Service
  |
  +---> KMS Universal Auth (client ID + secret)
  |       -> Short-lived access token
  |
  +---> KMS /sbom/signing (cosign key, if not keyless)
  +---> KMS /sbom/lux-wallet (Lux L1 wallet for anchoring)
```

## Monitoring and Observability

### Prometheus Metrics

The SBOM service exposes metrics at `:8074/metrics`:

| Metric | Type | Description |
|--------|------|-------------|
| `sbom_generation_duration_seconds` | Histogram | Time to generate SBOM from image |
| `sbom_scan_duration_seconds` | Histogram | Time to complete vulnerability scan |
| `sbom_vulnerabilities_total` | Gauge | Current known vulnerabilities by severity |
| `sbom_anchor_duration_seconds` | Histogram | Time to anchor provenance on-chain |
| `sbom_anchor_failures_total` | Counter | Failed on-chain anchoring attempts |
| `sbom_verification_requests_total` | Counter | Verification API calls by result |
| `sbom_components_total` | Gauge | Total tracked components across all artifacts |
| `sbom_licenses_by_category` | Gauge | Component count by license category |

### Alert Thresholds

| Condition | Severity | Action |
|-----------|----------|--------|
| New CRITICAL CVE in production artifact | P1 | Page on-call, Slack alert |
| New HIGH CVE in production artifact | P2 | Slack alert, 7-day SLA |
| SBOM generation failure in CI | P3 | Slack alert, investigate |
| On-chain anchoring failure | P3 | Retry; alert after 3 consecutive failures |
| License policy violation in build | P3 | Block build, notify legal |
| Nightly scan database unreachable | P4 | Alert, retry next cycle |

11. [HIP-0027: Secrets Management Standard](./hip-0027-secrets-management-standard.md)
12. [HIP-0033: Container Registry Standard](./hip-0033-container-registry-standard.md)
13. [HIP-0036: CI/CD Build System Standard](./hip-0036-ci-cd-build-system-standard.md)
14. [HIP-0020: Blockchain Node Standard](./hip-0020-blockchain-node-standard.md)
15. [HIP-0024: Hanzo Sovereign L1 Chain Architecture](./hip-0024-hanzo-sovereign-l1-chain-architecture.md)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
