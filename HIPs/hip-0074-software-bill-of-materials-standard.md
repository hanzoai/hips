---
hip: 0074
title: Software Bill of Materials & Git Stamp Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Final
created: 2026-02-23
requires: HIP-0027, HIP-0033, HIP-0036, HIP-0139
capability: sbom
---


# HIP-0074: Software Bill of Materials & Git Stamp Standard

## Abstract

This proposal defines the Software Bill of Materials (SBOM) and Git Stamp standard for the Hanzo ecosystem. Every deployed artifact -- container image, binary, library, or package -- MUST carry a machine-readable inventory of its components (the SBOM) and a cryptographic attestation linking it to the exact source code, build environment, and dependency tree that produced it (the Git Stamp).

Hanzo SBOM provides automated generation of industry-standard SBOM documents in both SPDX and CycloneDX formats, cryptographic signing via Sigstore/cosign, build provenance attestations targeting SLSA Level 3, and on-chain anchoring to the Lux Network for immutable audit trails. It integrates with every stage of the Hanzo CI/CD pipeline (HIP-0036), stores signed artifacts in the Container Registry (HIP-0033), manages signing keys through KMS (HIP-0027), and publishes provenance records to the blockchain (HIP-0020/HIP-0024).

**Serving**: `apps/sbom` in `hanzoai/cloud`, at `/v1/sbom` — there is no
standalone sbom service, port or image. Generation, signing and attestation run
in CI; the capability is the component store CI posts into and the console and
CVE queries read back. On-chain anchoring and the Sigstore chain are the target
this HIP specifies; the addresses in this document that belong to them are
marked where they are not yet served.

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

      # Ingest into the component store — the one served endpoint
      - name: Ingest SBOM
        run: |
          curl -fsS -X POST "https://api.hanzo.ai/v1/sbom" \
            -H "Authorization: Bearer ${CI_TOKEN}" \
            -H "Content-Type: application/json" \
            --data-binary @sbom.cdx.json
```

The on-chain anchoring step this pipeline once carried posted to an
`/api/v1/anchor` address no process serves; anchoring is target-not-yet-served
and returns to the pipeline in the change that serves it.

### The shipped surface

**sbom** (`manifest/apps.go:345`) serves three routes under `/v1/sbom`
(`apps/sbom/sbom.go`):

- `POST /v1/sbom` — ingest one CycloneDX SBOM keyed by image digest.
  SuperAdmin/CI only: the gate reads the validated principal's admin claim and
  fails closed off the HTTP path (`apps/sbom/sbom.go:238-242`).
- `GET /v1/sbom/{ref}` — resolve the component set by image digest or image
  ref, for the console. A raw handler declared with prose beside the route —
  the ref is a wildcard segment a typed op cannot carry.
- `GET /v1/sbom/health` — liveness plus datastore connectivity, not JWT-gated.

The store is global by design: an SBOM belongs to an image DIGEST, not a
tenant — the digest is content-addressed, so any tenant deploying that image
resolves the same component set. There is deliberately no org predicate;
ingest is admin-gated and resolve exposes only the immutable bill of materials
of an image, no tenant data. The rows live in the shared analytics datastore,
table `hanzo.sbom_component`, a `ReplacingMergeTree(ingested_at)` so a
re-ingest replaces rather than stacks (`apps/sbom/sbom.go`); the package opens
no second connection.

Stated for HIP-0139 §6: the capability is **free**, said in those words
(`plugin/sbom/main.go:21`, `Price: cloud.Free`). It publishes no events on the
bus, so a customer's webhooks receive nothing from it, and it emits nothing to
observability beyond the request span every route gets. Its stage is the one
`manifest.App.Stage` declares and this text does not restate it (HIP-0139 §8):
the copy here read `beta` with a line citation after the row had become `ga`,
and a cited line number is the fastest of all copies to rot. Upstream: it forks and embeds
nothing — syft, grype and cosign are CI tools invoked in the pipeline, never
linked into the binary, and the CycloneDX document is a format consumed, not
code inherited.

The provenance, verification, vulnerability and license query addresses this
HIP's earlier revisions listed (`/api/v1/provenance`, `/api/v1/verify`,
`/api/v1/vulnerabilities`, `/api/v1/licenses`, `/api/v1/anchor`,
`/api/v1/search`) are target-not-yet-served: no process answers them today,
and when they land they land under `/v1/sbom` per HIP-0139 §3, not under a
second host or an `/api/` prefix.

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

4. Resolve the component set
   curl https://api.hanzo.ai/v1/sbom/ghcr.io/hanzoai/iam@sha256:abc123...
   -> the ingested CycloneDX component set for that digest
```

Steps 1–3 require only cosign and the Sigstore public infrastructure — no
trust in Hanzo. Step 4 is the served store. The fifth step earlier revisions
showed — verifying an on-chain anchor — is target-not-yet-served, and its
property when it lands is the same: verification against the chain requires
only an RPC endpoint, not this platform.

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

Signing is keyless by default: cosign's OIDC identity, no long-lived key
anywhere. When offline verification or on-chain anchoring lands, its keys are
KMS refs under `/sbom/*` resolved at use — never env, never a file — per
HIP-0027; nothing holds such a key today.

## Monitoring and Observability

The capability exports no metric family of its own: there is no `sbom_*`
metric and no `/metrics` endpoint, because there is no standalone service.
What a customer can read back under `/v1/o11y` is the request span every route
already gets; `GET /v1/sbom/health` answers liveness and datastore
connectivity. CVE alerting rides the CI scan (`grype --fail-on critical`
blocks the build) rather than a capability-local alert pipeline.

11. [HIP-0027: Secrets Management Standard](./hip-0027-secrets-management-standard.md)
12. [HIP-0033: Container Registry Standard](./hip-0033-container-registry-standard.md)
13. [HIP-0036: CI/CD Build System Standard](./hip-0036-ci-cd-build-system-standard.md)
14. [HIP-0020: Blockchain Node Standard](./hip-0020-blockchain-node-standard.md)
15. [HIP-0024: Hanzo Sovereign L1 Chain Architecture](./hip-0024-hanzo-sovereign-l1-chain-architecture.md)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
