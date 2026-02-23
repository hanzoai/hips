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

## Design Philosophy

### Why Both SPDX and CycloneDX (Not Just One)

The SBOM ecosystem has two dominant formats, and the industry has not converged on one:

| Aspect | SPDX | CycloneDX |
|--------|------|-----------|
| Governing body | Linux Foundation (ISO/IEC 5962:2021) | OWASP Foundation |
| Primary strength | License compliance, provenance | Vulnerability tracking, risk analysis |
| Format options | JSON, XML, YAML, RDF, tag-value | JSON, XML, Protocol Buffers |
| Federal adoption | NTIA references both | CISA recommends both |
| Tooling ecosystem | Stronger in license analysis | Stronger in security scanning |
| Version | 2.3 (current), 3.0 (in progress) | 1.6 (current) |

US federal agencies accept both formats. The EU CRA does not mandate a specific format. Different customers and compliance frameworks prefer different formats. A defense contractor following NIST 800-218 may require SPDX. A European SaaS company following ENISA guidelines may prefer CycloneDX.

Generating both is cheap. The internal representation is the same dependency graph -- serialization to either format is a trivial transformation. Refusing to support one format to "pick a winner" would be a false economy that costs customer deals.

**Decision**: Generate and store both formats for every artifact. Serve whichever the consumer requests via content negotiation on the API.

### Why Git Stamp (Not Just SBOM)

An SBOM tells you what is inside an artifact. It does not tell you *how* it got there. Consider this attack scenario:

1. Attacker compromises a CI runner
2. Attacker modifies the build to inject a backdoor dependency
3. The SBOM faithfully records the backdoor dependency as a component
4. The SBOM is "correct" but the artifact is compromised

A Git Stamp prevents this by creating a cryptographic chain of custody:

```
Source Code (git commit SHA)
    |
    v
Build Environment (attested builder identity, OS, toolchain versions)
    |
    v
Build Process (hermetic, with input/output hashes recorded via in-toto)
    |
    v
Output Artifact (container image digest, binary hash)
    |
    v
Signature (cosign keyless signing via GitHub Actions OIDC)
    |
    v
On-chain Anchor (Lux L1 transaction with artifact digest + SBOM hash)
```

Each link in this chain is independently verifiable. A consumer can:

- Verify the cosign signature proves the artifact was built by `hanzoai` GitHub Actions
- Verify the in-toto attestation proves the build inputs (source + deps) produced the exact output
- Verify the on-chain anchor proves the SBOM existed at a specific point in time and has not been modified

This is the difference between "trust us, here is the ingredients list" and "here is a mathematically verifiable proof of exactly how this artifact was assembled."

### Why SLSA Level 3 (Not Level 1 or Level 4)

SLSA (Supply chain Levels for Software Artifacts) defines four levels of supply chain integrity:

| Level | Requirement | What It Proves |
|-------|-------------|----------------|
| **L1** | Documented build process, provenance exists | "We have a build system" |
| **L2** | Hosted build service, signed provenance | "A known CI system built this" |
| **L3** | Hardened build platform, non-falsifiable provenance | "The builder cannot lie about what it built" |
| **L4** | Hermetic, reproducible builds with two-party review | "Anyone can independently verify the build" |

**Level 1** is trivially satisfied by having GitHub Actions workflows -- we already exceed it. **Level 2** adds signed provenance, which cosign keyless signing already provides. **Level 3** requires that the build platform itself cannot be subverted to produce false provenance. GitHub Actions satisfies this with its OIDC identity: the provenance token is issued by GitHub's identity provider, not by the workflow itself, so a compromised workflow cannot forge a different identity.

**Level 4** requires fully hermetic, reproducible builds where two independent builders produce bit-identical output. This is aspirational for most software. Go binaries are largely reproducible, but container images contain timestamps, layer ordering variations, and non-deterministic package manager output. Achieving L4 for Docker images requires Bazel or Nix-based builds, which is a significant infrastructure investment we defer to Phase 4.

**Decision**: Target SLSA Level 3 for all container images and Go binaries. Document the path to Level 4 for future work.

### Why On-Chain Anchoring (Not Just a Database)

Storing SBOM records in a database is sufficient for internal use. On-chain anchoring provides three properties that a database cannot:

1. **Immutability**: Once a provenance record is anchored to Lux L1, it cannot be altered or deleted. Even if an attacker compromises the SBOM service, they cannot retroactively change the historical record.

2. **Third-party verifiability**: Anyone with access to the Lux blockchain can independently verify that a specific SBOM existed at a specific time. No trust in Hanzo infrastructure is required.

3. **Timestamping without a trusted third party**: The block timestamp proves the SBOM was generated before a certain time. This matters for vulnerability disclosure: if a CVE is announced on Tuesday and our SBOM from Monday shows we already patched it, the on-chain timestamp is proof.

The anchoring is lightweight. We do not store the full SBOM on-chain -- that would be expensive and unnecessary. We store a single transaction containing:

```
{
  artifact_digest: "sha256:abc123...",    // 32 bytes
  sbom_spdx_hash:  "sha256:def456...",    // 32 bytes
  sbom_cdx_hash:   "sha256:789abc...",    // 32 bytes
  provenance_hash: "sha256:fedcba...",    // 32 bytes
  git_commit:      "a1b2c3d4e5f6...",     // 20 bytes
  timestamp:       1740268800             //  8 bytes
}
```

Total on-chain cost: ~156 bytes per artifact per release. At Lux L1 transaction costs, this is negligible.

### Why Sigstore/Cosign (Not GPG or Notation)

Three signing approaches exist for container artifacts:

| Approach | Key Management | Verification | Ecosystem Support |
|----------|---------------|--------------|-------------------|
| **GPG** | Manual key distribution, web of trust | Complex, requires public keyservers | Git commits, Linux packages |
| **Notation** (Microsoft) | Azure Key Vault or custom KMS | Plugin-based, less mature | Azure/AWS-focused |
| **Cosign** (Sigstore) | Keyless via OIDC, or KMS-backed keys | Simple CLI, broad adoption | GHCR, Docker Hub, OCI registries |

Cosign with keyless signing is the clear choice for CI/CD:

- **No key management**: Keyless signing uses ephemeral keys tied to the GitHub Actions OIDC identity. No long-lived signing keys to rotate, store, or protect.
- **Identity-based trust**: The signature proves "this artifact was built by a GitHub Actions workflow in the `hanzoai` organization." The verifier trusts GitHub's identity provider, not a specific key.
- **OCI-native**: Signatures are stored as OCI artifacts in the same registry as the image. No external signature store needed.
- **Transparency log**: Signatures are recorded in Rekor (Sigstore's transparency log), providing an independent audit trail.

For cases where keyless signing is insufficient (offline verification, air-gapped environments), we fall back to KMS-backed cosign keys managed through HIP-0027.

## Specification

### SBOM Generation

Every Hanzo CI/CD pipeline (HIP-0036) MUST generate an SBOM at build time. The SBOM is produced by Syft (Anchore) for container images and language-specific tools for source packages.

#### Container Images

```bash
# Generate SPDX JSON
syft ghcr.io/hanzoai/${SERVICE}@sha256:${DIGEST} \
  -o spdx-json=sbom.spdx.json

# Generate CycloneDX JSON
syft ghcr.io/hanzoai/${SERVICE}@sha256:${DIGEST} \
  -o cyclonedx-json=sbom.cdx.json
```

#### Language-Specific Sources

| Language | Tool | Input | Output |
|----------|------|-------|--------|
| Go | `syft dir:.` or `go version -m` | `go.mod` + binary | Module list with versions |
| Python | `syft dir:.` or `pip-audit` | `uv.lock` / `requirements.txt` | Package list with versions |
| Node.js | `syft dir:.` or `npm audit` | `pnpm-lock.yaml` / `package-lock.json` | Package list with versions |
| Rust | `syft dir:.` or `cargo-audit` | `Cargo.lock` | Crate list with versions |

#### SBOM Minimum Fields (NTIA Compliance)

Every SBOM document MUST include these fields per NTIA minimum elements:

| Field | SPDX Path | CycloneDX Path | Example |
|-------|-----------|----------------|---------|
| Supplier name | `packages[].supplier` | `components[].supplier.name` | `Hanzo AI Inc` |
| Component name | `packages[].name` | `components[].name` | `iam` |
| Component version | `packages[].versionInfo` | `components[].version` | `1.584.0` |
| Unique identifier | `packages[].SPDXID` | `components[].bom-ref` | `SPDXRef-Package-iam` |
| Dependency relationship | `relationships[]` | `dependencies[]` | `DEPENDS_ON` |
| Author of SBOM | `creationInfo.creators` | `metadata.authors` | `Tool: syft-1.x` |
| Timestamp | `creationInfo.created` | `metadata.timestamp` | `2026-02-23T00:00:00Z` |

### Git Stamp Attestation

The Git Stamp is an in-toto attestation envelope that binds an artifact to its source provenance. It is generated automatically in CI after a successful build.

#### Attestation Structure

```json
{
  "_type": "https://in-toto.io/Statement/v1",
  "subject": [
    {
      "name": "ghcr.io/hanzoai/iam",
      "digest": {
        "sha256": "abc123def456..."
      }
    }
  ],
  "predicateType": "https://slsa.dev/provenance/v1",
  "predicate": {
    "buildDefinition": {
      "buildType": "https://github.com/hanzoai/sbom/build/v1",
      "externalParameters": {
        "source": {
          "uri": "git+https://github.com/hanzoai/iam@refs/heads/main",
          "digest": {
            "sha1": "a1b2c3d4e5f6..."
          }
        }
      },
      "internalParameters": {
        "github": {
          "event_name": "push",
          "repository_id": "123456789",
          "repository_owner_id": "hanzoai"
        }
      }
    },
    "runDetails": {
      "builder": {
        "id": "https://github.com/hanzoai/sbom/.github/workflows/build.yml@refs/heads/main"
      },
      "metadata": {
        "invocationId": "https://github.com/hanzoai/iam/actions/runs/987654321",
        "startedOn": "2026-02-23T10:00:00Z",
        "finishedOn": "2026-02-23T10:05:30Z"
      }
    }
  }
}
```

This attestation is SLSA v1.0 provenance format. It records:

- **Subject**: The exact artifact (by digest) this attestation describes
- **Source**: The git repository and commit that was built
- **Builder**: The CI workflow that performed the build
- **Invocation**: The specific CI run, with timestamps

#### Signing the Attestation

```bash
# Keyless signing via GitHub Actions OIDC
cosign attest --yes \
  --predicate provenance.json \
  --type slsaprovenance1 \
  ghcr.io/hanzoai/${SERVICE}@sha256:${DIGEST}
```

The `--yes` flag enables keyless mode. Cosign requests an OIDC token from GitHub Actions, uses it to obtain a short-lived signing certificate from Sigstore's Fulcio CA, signs the attestation, and records the signature in Sigstore's Rekor transparency log.

### Container Image Signing

In addition to SBOM and provenance attestations, every release image MUST be signed:

```bash
# Sign the image (keyless, in CI)
cosign sign --yes \
  --oidc-issuer=https://token.actions.githubusercontent.com \
  ghcr.io/hanzoai/${SERVICE}@sha256:${DIGEST}

# Verify the image (anywhere)
cosign verify \
  --certificate-oidc-issuer=https://token.actions.githubusercontent.com \
  --certificate-identity-regexp="github.com/hanzoai/.*" \
  ghcr.io/hanzoai/${SERVICE}@sha256:${DIGEST}
```

### On-Chain Anchoring

After SBOM generation, signing, and attestation, the provenance summary is anchored to Lux L1.

```
CI Pipeline completes
  |
  v
Compute hashes: artifact digest, SBOM hashes, provenance hash
  |
  v
POST sbom.hanzo.ai/api/v1/anchor
  {
    "artifact": "ghcr.io/hanzoai/iam@sha256:abc123...",
    "git_commit": "a1b2c3d4e5f6...",
    "git_ref": "refs/tags/v1.584.0",
    "sbom_spdx_sha256": "def456...",
    "sbom_cdx_sha256": "789abc...",
    "provenance_sha256": "fedcba...",
    "slsa_level": 3
  }
  |
  v
SBOM Service creates Lux L1 transaction via luxfi/coreth
  |
  v
Transaction hash returned to CI as proof of anchoring
  |
  v
Anchor receipt attached as OCI artifact to the image
```

The SBOM service holds a Lux wallet (key managed via KMS, HIP-0027) with sufficient LUX for transaction fees. Anchoring transactions use the `data` field of a standard transfer to the SBOM contract address.

### Vulnerability Scanning

Every SBOM is automatically scanned against known vulnerability databases.

#### Scan Pipeline

```bash
# Scan SBOM against NVD, OSV, and GitHub Advisory Database
grype sbom:sbom.cdx.json \
  --output json \
  --fail-on critical
```

Grype (Anchore) consumes the CycloneDX SBOM and matches components against:

- **NVD** (National Vulnerability Database) -- US government CVE database
- **OSV** (Open Source Vulnerabilities) -- Google's aggregated vulnerability database
- **GitHub Advisory Database** -- GitHub's curated security advisories

#### Severity Policy

| Severity | CI Behavior | SLA |
|----------|-------------|-----|
| **Critical** (CVSS >= 9.0) | Build MUST fail | Patch within 24 hours |
| **High** (CVSS 7.0-8.9) | Build MUST fail | Patch within 7 days |
| **Medium** (CVSS 4.0-6.9) | Warning, build continues | Patch within 30 days |
| **Low** (CVSS < 4.0) | Informational | Track in backlog |

Exceptions to the fail policy require security team approval and are tracked in the SBOM service as time-limited exemptions with a mandatory remediation date.

#### Continuous Monitoring

SBOM is not a point-in-time artifact. New CVEs are disclosed daily against existing component versions. The SBOM service runs a nightly re-scan of all production SBOMs:

```
Nightly at 02:00 UTC:
  For each deployed service:
    1. Fetch latest SBOM from registry
    2. Scan against updated vulnerability databases
    3. Compare results to previous scan
    4. If new CRITICAL/HIGH findings: create alert + Slack notification
    5. If finding already has exemption: skip
    6. Update dashboard
```

This catches the Log4Shell scenario: a new CVE is disclosed, and within hours, every affected Hanzo service is identified automatically.

### License Compliance

The SBOM enables automated license detection and compatibility checking.

#### License Detection

Syft identifies licenses from:

- Package metadata (npm `license`, Go `LICENSE`, PyPI classifiers)
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
  +---> PostgreSQL (sbom database)
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

## Migration Guide

### For Existing Repositories

1. **Week 1**: Add the `sbom-and-sign` job to your `docker-deploy.yml` workflow. Use the template from `hanzoai/build`.

2. **Week 2**: Install cosign locally and verify your images: `cosign verify --certificate-oidc-issuer=https://token.actions.githubusercontent.com ghcr.io/hanzoai/YOUR-SERVICE:latest`

3. **Week 3**: Review vulnerability scan results. Address any CRITICAL/HIGH findings before enabling the fail gate.

4. **Week 4**: Enable `--fail-on critical` in Grype. Enable `--fail-on high` after clearing the backlog.

5. **Week 5**: Review license scan results. Address any copyleft dependencies. Enable license policy enforcement.

### For New Repositories

Use the `hanzoai/template` repository, which includes SBOM generation, signing, and attestation pre-configured.

## Future Work

### Phase 1: Foundation (Q1 2026)
- SBOM generation for all container images (Syft)
- Cosign keyless signing in CI
- Vulnerability scanning with Grype
- SBOM service API at sbom.hanzo.ai:8074

### Phase 2: Attestation (Q2 2026)
- SLSA Level 3 provenance attestations
- On-chain anchoring to Lux L1
- License compliance enforcement
- Nightly re-scan pipeline

### Phase 3: Ecosystem (Q3 2026)
- SBOM for non-container artifacts (Go binaries, Python wheels, npm packages)
- Customer-facing SBOM portal
- Integration with Kubernetes admission controller (reject unsigned images)
- VEX (Vulnerability Exploitability eXchange) support for false-positive management

### Phase 4: Reproducibility (Q4 2026)
- SLSA Level 4 target for Go binaries
- Nix-based reproducible container builds
- Independent rebuild verification
- SBOM-to-SBOM dependency graph (transitive SBOM for composed services)

## References

1. [NTIA Minimum Elements for a Software Bill of Materials](https://www.ntia.gov/sites/default/files/publications/sbom_minimum_elements_report_0.pdf)
2. [SPDX Specification v2.3](https://spdx.github.io/spdx-spec/v2.3/)
3. [CycloneDX Specification v1.6](https://cyclonedx.org/specification/overview/)
4. [SLSA Framework](https://slsa.dev/)
5. [Sigstore / Cosign](https://docs.sigstore.dev/)
6. [in-toto Attestation Framework](https://in-toto.io/)
7. [US Executive Order 14028](https://www.whitehouse.gov/briefing-room/presidential-actions/2021/05/12/executive-order-on-improving-the-nations-cybersecurity/)
8. [EU Cyber Resilience Act](https://digital-strategy.ec.europa.eu/en/policies/cyber-resilience-act)
9. [Syft - SBOM Generator](https://github.com/anchore/syft)
10. [Grype - Vulnerability Scanner](https://github.com/anchore/grype)
11. [HIP-0027: Secrets Management Standard](./hip-0027-secrets-management-standard.md)
12. [HIP-0033: Container Registry Standard](./hip-0033-container-registry-standard.md)
13. [HIP-0036: CI/CD Build System Standard](./hip-0036-ci-cd-build-system-standard.md)
14. [HIP-0020: Blockchain Node Standard](./hip-0020-blockchain-node-standard.md)
15. [HIP-0024: Hanzo Sovereign L1 Chain Architecture](./hip-0024-hanzo-sovereign-l1-chain-architecture.md)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
