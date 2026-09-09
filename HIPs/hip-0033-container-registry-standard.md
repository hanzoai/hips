---
hip: "0033"
title: Container Registry Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Final
implementation-go: partial
created: 2025-01-15
---


# HIP-0033: Container Registry Standard

## Abstract

The fleet registry is **`oci.hanzo.ai`** — an OCI registry backed by our own
object store, authenticated by Hanzo IAM, with repositories org-namespaced as
`oci.hanzo.ai/<org>/<app>`. Images and Helm charts share the one store; 190 CD
Applications pull `oci.hanzo.ai/charts` on every sync, so it is load-bearing
rather than an experiment.

`ghcr.io/<org>` keeps one purpose: **already-published open-source artifacts that
outside users pull**. It is not a mirror and not a fallback.

**This is a target, and the migration is unfinished.** Measured on 2026-09-09,
most first-party workloads still resolve from GHCR and 13 resolve from
`oci.hanzo.ai`; the counts are in §Conformance status. What is settled is the
direction and the rules below, not the current distribution.

**Repository**: [github.com/hanzoai/registry](https://github.com/hanzoai/registry)

The org prefix never mixes. Hanzo publishes under `hanzoai`, Lux under `luxfi`,
Zoo under `zooai`, on whichever of the two hosts applies. A Lux image under a
Hanzo prefix is a defect regardless of which registry it sits in.

## Design Philosophy

### Why our own registry

**Quotas.** The move off GHCR as the push target was to escape a third party's
push and artifact quotas. A build fleet that cannot push because a monthly
allowance ran out is not a build fleet.

**Speed.** Service images carrying model weights, a CUDA runtime and a Python
dependency tree run to 5-15 GB. Pulling that across the public internet takes
minutes; pulling it from a registry on the same fabric takes seconds. In a
rolling deployment every second of pull time extends the rollout window.

**Availability.** If the registry a cluster pulls from is somebody else's, that
company's outage is our inability to schedule a pod. Running pods survive; new
ones do not start.

**One store for images and charts.** A chart and the image it deploys are one
release. Keeping them in two systems means two authentications, two retention
policies, and two ways for a chart to reference an image that was never
published.

### Why IAM authorizes the pull, and there is no registry password

Per-repository authorization happens at `hanzo.id/v1/iam/registry/token`
(HIP-0111): a client presents an IAM identity and receives a token scoped to the
repository it asked for. There is no registry account, no shared push password
and no per-repo credential to rotate — the same rule as everywhere else in the
estate, that IAM is the sole authority for identity and tokens.

A build reaches the registry through the public ingress exactly as an outside
client does, so a build is granted no path an external client would not have. The
registry Service itself is not opened to the build fleet.

### How It Connects to Other HIPs

```
HIP-0036 (CI/CD Build System Standard)
  |       Defines HOW images are built (buildx, multi-arch, caching)
  |
  +---> HIP-0033 (this) Container Registry Standard
          Defines WHERE images go and HOW they are authenticated

HIP-0014 (Application Deployment)
  |
  +---> Pulls images FROM registries defined in HIP-0033
```

Build (HIP-0036) produces artifacts. Registry (HIP-0033) stores and distributes
them. Deployment (HIP-0014) consumes them. Each HIP owns exactly one concern.

## Specification

### OCI Compliance

All Hanzo registries MUST implement the OCI Distribution Specification v1.1.
This includes:

- Content-addressable storage using SHA-256 digests
- Manifest and manifest list (multi-arch index) support
- Blob upload (monolithic and chunked)
- Tag listing and deletion
- Referrers API for artifact relationships

### Image Naming Convention

Images follow a strict naming hierarchy:

```
# The fleet registry — the push target and the pull source
oci.hanzo.ai/<org>/<app>:{tag}

# Charts, in the same store
oci.hanzo.ai/charts/<chart>:{version}

# Published open source, for outside users only
ghcr.io/<org>/<app>:{tag}
```

`<app>` MUST match the repository name, and `<org>` MUST be the repository's own
org. Examples:

| Repository | Fleet image | Published OSS image |
|---|---|---|
| `hanzoai/iam` | `oci.hanzo.ai/hanzoai/iam` | `ghcr.io/hanzoai/iam` |
| `hanzoai/cloud` | `oci.hanzo.ai/hanzoai/cloud` | `ghcr.io/hanzoai/cloud` |
| `luxfi/node` | `oci.hanzo.ai/luxfi/node` | `ghcr.io/luxfi/node` |
| `zooai/<app>` | `oci.hanzo.ai/zooai/<app>` | `ghcr.io/zooai/<app>` |

There is no Docker Hub target. A "convenience mirror" a build is permitted to
fail produces tags that disagree with the source of truth, at a cadence nobody
watches, and a consumer cannot tell which they pulled.

### Tag Strategy

Tags convey meaning. Every image MUST be tagged according to this scheme:

| Tag Pattern | Meaning | Mutable | Example |
|---|---|---|---|
| `latest` | Most recent build from default branch | Yes | `iam:latest` |
| `{semver}` | Semantic version from release | No | `iam:1.584.0` |
| `{branch}-{sha}` | Branch build with commit SHA | No | `iam:main-a1b2c3d` |
| `{branch}` | Latest build from named branch | Yes | `iam:main` |

Immutable tags (semver, branch-sha) MUST NOT be overwritten. Mutable tags
(`latest`, branch-only) are updated on each push to the corresponding branch.

### Multi-Architecture Support

All images MUST be built as multi-architecture manifest lists supporting:

- `linux/amd64` - Standard x86_64 servers and CI runners
- `linux/arm64` - ARM servers (Graviton, Ampere) and Apple Silicon dev

The build uses Docker Buildx with QEMU emulation for cross-compilation:

```yaml
# From actual CI workflow
- name: Set up QEMU
  uses: docker/setup-qemu-action@v3

- name: Set up Docker Buildx
  uses: docker/setup-buildx-action@v3

- name: Build and push
  uses: docker/build-push-action@v5
  with:
    platforms: linux/amd64,linux/arm64
    push: true
```

### Image Variants

Some services provide multiple image variants via Dockerfile multi-stage targets:

| Target | Suffix | Purpose |
|---|---|---|
| `STANDARD` | (none) | Production image, minimal footprint |
| `ALLINONE` | `-allinone` | Self-contained with embedded database |
| `DEV` | `-dev` | Development image with debug tools |

Example:

```
ghcr.io/hanzoai/iam:latest          # STANDARD target
ghcr.io/hanzoai/iam-allinone:latest # ALLINONE target
```

### Metadata Labels

All images MUST include OCI standard labels via the `metadata-action`:

```yaml
- name: Extract metadata
  uses: docker/metadata-action@v5
  with:
    images: ghcr.io/hanzoai/{service}
    tags: |
      type=ref,event=branch
      type=semver,pattern={{version}}
      type=raw,value=latest,enable={{is_default_branch}}
      type=sha,prefix={{branch}}-
```

This produces labels including:

- `org.opencontainers.image.source` - Link to source repository
- `org.opencontainers.image.version` - Semantic version
- `org.opencontainers.image.revision` - Git commit SHA
- `org.opencontainers.image.created` - Build timestamp

### Garbage Collection

The in-cluster registry MUST run garbage collection to reclaim storage from
unreferenced layers. Policy:

- **Untagged manifests**: Delete after 24 hours
- **Unused layers**: Delete when no manifest references them
- **Retention**: Keep the last 10 tagged versions per repository
- **Schedule**: Run GC daily at 03:00 UTC during low-traffic window

### Webhook Notifications

The registry MUST emit webhook notifications on image push events. These
notifications drive downstream automation:

```json
{
  "events": [{
    "action": "push",
    "target": {
      "repository": "hanzoai/iam",
      "tag": "latest",
      "digest": "sha256:abc123...",
      "mediaType": "application/vnd.oci.image.manifest.v1+json"
    },
    "timestamp": "2025-01-15T10:30:00Z",
    "actor": {
      "name": "github-actions"
    }
  }]
}
```

Consumers include:

- Kubernetes deployment controllers (trigger rollout on new `:latest`)
- Vulnerability scanners (scan new images on push)
- Audit logging (record who pushed what and when)

## Implementation

### Build and Push Pipeline

The pipeline is HIP-0036's and is not restated here: one reusable workflow in
`hanzoai/ci`, imported by a short `.hanzo/workflows/cicd.yml`, driven by the
repository's `hanzo.yml`. No repository writes its own push steps.

What this HIP states about the push:

1. **One destination.** The build pushes to `oci.hanzo.ai/<org>/<app>`. There is
   no second push, no mirror, and no `continue-on-error` publication lane.
2. **The credential is an IAM token, obtained per repository.** The build
   authenticates to `hanzo.id/v1/iam/registry/token` with its machine identity
   and receives a token scoped to the repository it named. No registry password
   exists to store, leak or rotate.
3. **The push crosses the public ingress**, exactly as an outside client's would.
   The registry Service is not reachable from the build fleet directly, so a
   compromised build has the reach of an internet client and no more.
4. **Multi-arch is one manifest list**, `linux/amd64` and `linux/arm64`, so a
   single tag serves an amd64 cluster node and an arm64 developer machine without
   emulation.

### Kubernetes Pull Configuration

Kubernetes pulls from `oci.hanzo.ai`, with the pull identity supplied as an
`imagePullSecret` synced from KMS. Without a credential the kubelet asks
anonymously and the pull fails in a way that reads as a missing image rather than
a missing credential, so the secret is not optional:

```yaml
# K8s deployment spec
apiVersion: apps/v1
kind: Deployment
metadata:
  name: iam
  namespace: hanzo
spec:
  template:
    spec:
      containers:
        - name: iam
          image: ghcr.io/hanzoai/iam:latest
          imagePullPolicy: Always
      imagePullSecrets:
        - name: ghcr-pull-secret
```

For tagged releases, the pull policy changes:

```yaml
# Tagged release - no need to re-pull
image: ghcr.io/hanzoai/iam:1.584.0
imagePullPolicy: IfNotPresent
```

### In-Cluster Registry as Pull-Through Cache

The self-hosted registry runs as a Kubernetes deployment with pull-through
proxy configuration:

```yaml
# registry config.yml
version: 0.1
proxy:
  remoteurl: https://ghcr.io
  username: $GHCR_PULL_USER
  password: $GHCR_PULL_TOKEN
storage:
  filesystem:
    rootdirectory: /var/lib/registry
  maintenance:
    uploadpurging:
      enabled: true
      age: 24h
      interval: 1h
  delete:
    enabled: true
http:
  addr: :5000
  headers:
    X-Content-Type-Options: [nosniff]
```

When a node requests an image from `localhost:5000`, the registry
checks its local storage first. On a cache miss, it pulls from GHCR, caches
the layers locally, and serves them to the node. Subsequent pulls from any
node in the cluster hit the local cache.

### Deployment via CI

The deploy step uses `kubectl set image` to trigger a rolling update:

```yaml
deploy:
  needs: build
  steps:
    - name: Deploy
      run: |
        kubectl set image deployment/iam \
          iam=ghcr.io/hanzoai/iam:v1.33.25
        kubectl rollout status deployment/iam --timeout=300s

    - name: Verify health
      run: |
        kubectl wait --for=condition=available deployment/iam \
          --timeout=120s
```

## Security

### Authentication Architecture

Registry authentication flows through Hanzo IAM. The Docker registry v2
authentication protocol works as follows:

```
1. Client attempts: docker pull oci.hanzo.ai/hanzoai/myimage
2. Registry returns: 401 with WWW-Authenticate header
3. Client requests token: GET /v1/iam/registry/token?service=oci.hanzo.ai&scope=repository:hanzoai/myimage:pull
   (with Basic auth credentials)
4. IAM validates credentials against user database
5. IAM returns signed JWT with access claims
6. Client retries pull with Bearer token
7. Registry validates JWT signature via JWKS endpoint
```

IAM implements this via `GetRegistryToken` (see `controllers/registry_token.go`):

- Authenticates user via Basic auth against IAM user database
- Admin users receive all requested actions (pull, push, delete)
- Non-admin users receive pull-only access regardless of request
- Returns a 15-minute RS256-signed JWT with access claims
- Registry verifies tokens via the JWKS endpoint at `/v1/iam/registry/jwks`

### Signing Key Management

The registry token signing key follows a strict resolution chain:

1. `REGISTRY_SIGNING_KEY` env var (inline PEM or `kms://SECRET_NAME` reference)
2. `REGISTRY_SIGNING_KEY_FILE` env var (path to PEM file)
3. `REGISTRY_SIGNING_KEY_SECRET` env var (KMS secret name, default: `IAM_REGISTRY_SIGNING_KEY`)

In production (`ENVIRONMENT=production`), a persistent signing key MUST be
configured. The server will panic on startup if KMS key resolution fails.
In development, an ephemeral RSA key is generated per process for convenience.

### Credential Sources

| Operation | Credential | Auth method |
|---|---|---|
| Push to `oci.hanzo.ai` | the build's IAM machine identity | `client_credentials` → per-repository registry token |
| Pull from `oci.hanzo.ai` | an `imagePullSecret` synced from KMS | the same token flow, presented by the kubelet |
| Pull an upstream base image | none | anonymous, from wherever it is published |

There is no registry username and no registry password anywhere in that table.
The only durable credential is the machine identity, which IAM issues and IAM
revokes — one authority, per HIP-0111 — and a build never holds a credential for
a registry it does not itself push to.

Rotation therefore happens in one place and takes effect on the next build. No
forge settings to edit, no manifests to re-sync, no secret in source.

### Image Signing with Sigstore

All release images SHOULD be signed using cosign (Sigstore project) for supply
chain verification:

```bash
# Sign after push (in CI)
cosign sign --yes \
  --oidc-issuer=https://token.actions.githubusercontent.com \
  ghcr.io/hanzoai/iam@sha256:${DIGEST}

# Verify before pull (in cluster)
cosign verify \
  --certificate-oidc-issuer=https://token.actions.githubusercontent.com \
  --certificate-identity-regexp="github.com/hanzoai/.*" \
  ghcr.io/hanzoai/iam@sha256:${DIGEST}
```

Cosign uses keyless signing with GitHub Actions OIDC identity. No long-lived
signing keys to manage. The signature proves that the image was built by a
GitHub Actions workflow in the `hanzoai` organization.

### Vulnerability Scanning

All images MUST be scanned for known vulnerabilities before deployment:

```yaml
# In CI pipeline
- name: Scan for vulnerabilities
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: ghcr.io/hanzoai/${{ env.SERVICE }}:${{ env.TAG }}
    format: sarif
    output: trivy-results.sarif
    severity: CRITICAL,HIGH
    exit-code: 1   # Fail build on CRITICAL/HIGH findings

- name: Upload scan results
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: trivy-results.sarif
```

Scan policy:

- **CRITICAL**: Build MUST fail. No exceptions.
- **HIGH**: Build MUST fail. Exceptions require security team approval.
- **MEDIUM**: Warning. Tracked in issue backlog.
- **LOW**: Informational. No action required.

### SBOM Generation

Software Bill of Materials MUST be generated for all release images:

```bash
# Generate SBOM as OCI artifact
syft ghcr.io/hanzoai/iam:${VERSION} -o spdx-json > sbom.spdx.json

# Attach SBOM to image in registry
cosign attach sbom --sbom sbom.spdx.json \
  ghcr.io/hanzoai/iam@sha256:${DIGEST}
```

The SBOM is stored as an OCI artifact referencing the parent image, using the
OCI Referrers API. This allows consumers to discover the SBOM from the image
digest without out-of-band communication.

## Operations

### Monitoring

The in-cluster registry exposes Prometheus metrics:

```
registry_storage_blobs_total          # Total stored blobs
registry_storage_blobs_size_bytes     # Total storage used
registry_http_requests_total          # Request count by method/status
registry_http_request_duration_seconds # Request latency histogram
```

Alert thresholds:

| Metric | Threshold | Action |
|---|---|---|
| Storage usage | > 80% capacity | Trigger GC, alert on-call |
| Pull latency p99 | > 5s | Check network, storage IOPS |
| 5xx error rate | > 1% | Page on-call |
| Auth failure rate | > 10% | Investigate credential issues |

### Disaster Recovery

The in-cluster registry is a cache, not a source of truth. If it is lost:

The registry's durability is its object store's, not the pod's: the workload is
replaceable and the blobs are not held on its disk. Recovery is redeploying the
workload against the same bucket.

What that does not cover is the bucket. The store MUST be backed up on the same
terms as any other durable state (HIP-0065), because an image nothing can pull is
an outage that no amount of re-running CI shortens — the build that produced a
given digest may no longer be reproducible.

## Reference Implementation

The registry token endpoint in `hanzoai/iam` is the reference implementation of
the authorization half. The build half is `hanzoai/ci`'s one reusable workflow
(HIP-0036); no repository has a reference workflow of its own to copy, which is
the point.

The IAM registry-token handler demonstrates:

- Docker registry v2 token authentication
- IAM-backed credential validation
- Role-based access control (admin: push+pull, user: pull-only)
- RSA-signed JWT token generation
- JWKS public key endpoint for token verification
- KMS-backed signing key resolution with ephemeral fallback

## Conformance status

Measured against the running cluster on 2026-09-09.

**GHCR, still the majority pull source.** Every first-party image running in the cluster resolves from
GHCR under its own org, and the orgs do not mix: 189 `ghcr.io/hanzoai`, 73
`ghcr.io/luxfi`, 13 `ghcr.io/zooai`. The remainder are upstream base images
(`python`, `docker.io/library`, `rancher/*`, `quay.io/jetstack`, `registry.k8s.io/*`),
which is what the standard expects — third-party images are pulled, not published.

**Docker Hub, retiring.** `hub.docker.com/v2/repositories/hanzoai/{iam,console,commerce}`
each still return `200`, so the old mirror's tags are still published and still
resolvable. Nothing in the cluster runs from `docker.io/hanzoai`. Those
repositories are the residue of the three-tier scheme this revision removes; they
are stale from the moment the second push stopped, and the honest fix is to
archive them rather than leave tags that look current.

**`oci.hanzo.ai`, the target.** `oci.hanzo.ai/v2/` returns `401` — an OCI registry
demanding a token, not a `404` from a host that has no registry behind it — and 13
running images resolve from `oci.hanzo.ai/hanzoai`. The `registry:2` workload backing
it runs in `hanzo-build` and `hanzo`.

The token flow in §Authentication is the one that carries the `401`: a client is
sent to `/v1/iam/registry/token` on IAM, which is the estate's `/v1/` shape and not
an `/api/` path.

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
