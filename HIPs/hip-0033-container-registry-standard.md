---
hip: 0033
title: Container Registry Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2025-01-15
requires: HIP-0032
---

# HIP-33: Container Registry Standard

## Abstract

This proposal defines the container registry standard for the Hanzo ecosystem.
Hanzo Registry provides OCI-compatible container image storage, serving as the
canonical source for all Hanzo service images across three tiers: GitHub Container
Registry (GHCR) as the primary public registry, Docker Hub as the secondary
distribution channel, and an in-cluster self-hosted registry for fast K8s pulls.

**Repository**: [github.com/hanzoai/registry](https://github.com/hanzoai/registry)

Every container artifact produced by Hanzo MUST flow through this standard.
The goal is simple: one build, three destinations, zero ambiguity about where
images live or how they are authenticated.

## Motivation

We need ONE standard way to:

- Build multi-architecture container images
- Push images to multiple registries with clear priority semantics
- Pull images into Kubernetes clusters at maximum speed
- Authenticate registry access through Hanzo IAM
- Sign and verify images for supply chain integrity
- Store non-container OCI artifacts (Helm charts, ML models, WASM modules)

## Design Philosophy

### Why Own Registry Over Just GHCR/Docker Hub

The naive approach is to use GHCR or Docker Hub exclusively. This fails at scale
for three concrete reasons:

**1. Speed.** AI service images are large. A typical Hanzo service image with
model weights, CUDA runtime, and Python dependencies is 5-15 GB. Pulling that
from an external registry over the public internet takes minutes. An in-cluster
registry on the same network fabric delivers the same image in seconds. For
Kubernetes rolling deployments where every second of pull time extends the
rollout window, this is the difference between a 30-second deploy and a
5-minute deploy.

**2. Rate limits.** Docker Hub enforces pull rate limits: 100 pulls per 6 hours
for anonymous users, 200 for authenticated free accounts. A Kubernetes cluster
with 15 nodes that restarts pods frequently will hit these limits. GHCR is more
generous but still rate-limited for high-frequency CI runners. An in-cluster
registry has no rate limits.

**3. Availability isolation.** If Docker Hub or GitHub has an outage, your
cluster cannot pull images and cannot schedule new pods. An in-cluster registry
decouples your runtime availability from third-party SLA. Your existing pods
continue running, and new pods can still be scheduled from cached layers.

The self-hosted registry acts as both a primary pull source and a pull-through
cache for upstream images. Kubernetes is configured to try the in-cluster
registry first, falling back to GHCR only if the local copy is missing.

### Why OCI Over Docker Registry v2 Only

The Docker Registry HTTP API v2 was designed for one thing: container images.
The OCI Distribution Specification v1.1 generalizes this to any content-addressable
artifact. This matters because Hanzo stores more than container images:

| Artifact Type | Docker v2 | OCI v1.1 |
|---|---|---|
| Container images | Yes | Yes |
| Helm charts | No | Yes |
| WASM modules | No | Yes |
| ML model weights | No | Yes |
| Signed metadata | No | Yes |
| SBOMs | No | Yes |

By standardizing on OCI, we get a single registry that stores container images
alongside Helm charts for deployment, ML model artifacts for inference servers,
and WASM modules for edge compute. One address scheme, one authentication
system, one garbage collection policy.

The OCI spec is also the direction the industry is moving. Docker itself now
implements OCI distribution. Helm 3 stores charts as OCI artifacts. Sigstore
signs OCI artifacts. Building on OCI means we are building on the convergent
standard, not a legacy protocol.

### Why Multi-Registry Strategy

The three-tier strategy exists because each registry serves a different audience:

```
Build (GitHub Actions)
  |
  +---> GHCR (ghcr.io/hanzoai/*)        [REQUIRED - must succeed]
  |       Public images, CI integration
  |       Free for public repos
  |       Tightly coupled to GitHub Actions auth
  |
  +---> Docker Hub (hanzoai/*)           [SECONDARY - continue-on-error]
  |       Widest reach, `docker pull hanzoai/iam`
  |       Discoverability on hub.docker.com
  |       Rate-limited, credentials via KMS
  |
  +---> In-Cluster Registry              [TERTIARY - K8s pull source]
          Fastest pulls (cluster-local)
          Pull-through cache for upstream
          No rate limits
```

**GHCR must succeed** because it is the source of truth. If the GHCR push fails,
the build fails. This is deliberate: we never want a state where Docker Hub has
an image that GHCR does not.

**Docker Hub is continue-on-error** because it is a distribution convenience, not
a source of truth. Docker Hub credentials come from KMS and may rotate or
temporarily fail. We do not want a Docker Hub authentication issue to block a
production deployment. The actual Kubernetes deployment pulls from GHCR, not
Docker Hub.

**The in-cluster registry is populated** either by explicit push from CI or by
pull-through caching when Kubernetes first requests an image. It is not a CI
target; it is a runtime optimization.

### How It Connects to Other HIPs

```
HIP-0032 (CI/CD Standard)
  |
  +---> HIP-0033 (this) Container Registry Standard
  |       Defines WHERE images go and HOW they are authenticated
  |
  +---> HIP-0036 (Build Standard)
          Defines HOW images are built (buildx, multi-arch, caching)

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
# Primary (GHCR) - source of truth
ghcr.io/hanzoai/{service}:{tag}
ghcr.io/hanzoai/{service}:latest
ghcr.io/hanzoai/{service}:{semver}
ghcr.io/hanzoai/{service}:{branch}-{sha}

# Secondary (Docker Hub) - distribution mirror
docker.io/hanzoai/{service}:{tag}

# Tertiary (in-cluster) - runtime cache
registry.hanzo.svc:5000/hanzoai/{service}:{tag}
```

The `{service}` name MUST match the GitHub repository name. Examples:

| Repository | GHCR Image | Docker Hub Image |
|---|---|---|
| `hanzoai/iam` | `ghcr.io/hanzoai/iam` | `hanzoai/iam` |
| `hanzoai/cloud` | `ghcr.io/hanzoai/cloud` | `hanzoai/cloud` |
| `hanzoai/llm` | `ghcr.io/hanzoai/llm` | `hanzoai/llm` |
| `hanzoai/chat` | `ghcr.io/hanzoai/chat` | `hanzoai/chat` |

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

The build pipeline runs in GitHub Actions. The canonical workflow structure is:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      # 1. Fetch credentials from Hanzo KMS
      - name: Fetch CI secrets from Hanzo KMS
        id: kms
        env:
          KMS_CLIENT_ID: ${{ secrets.KMS_CLIENT_ID }}
          KMS_CLIENT_SECRET: ${{ secrets.KMS_CLIENT_SECRET }}
        run: |
          # Authenticate to KMS via Universal Auth
          ACCESS_TOKEN="$(curl -fsS -X POST \
            "${KMS_URL:-https://kms.hanzo.ai}/api/v1/auth/universal-auth/login" \
            -H "Content-Type: application/json" \
            -d "{\"clientId\":\"$KMS_CLIENT_ID\",\"clientSecret\":\"$KMS_CLIENT_SECRET\"}" \
            | jq -r '.accessToken')"

          # Fetch Docker Hub credentials
          for name in DOCKERHUB_USERNAME DOCKERHUB_TOKEN; do
            val="$(curl -fsS \
              "${KMS_URL}/api/v3/secrets/raw/${name}?workspaceSlug=gitops&environment=prod&secretPath=/ci&viewSecretValue=true" \
              -H "Authorization: Bearer ${ACCESS_TOKEN}" \
              | jq -r '.secret.secretValue')"
            echo "${name}=${val}" >> "$GITHUB_OUTPUT"
          done

      # 2. Set up multi-arch build environment
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3

      # 3. Authenticate to both registries
      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Log in to Docker Hub
        id: dockerhub
        continue-on-error: true
        uses: docker/login-action@v3
        with:
          registry: docker.io
          username: ${{ steps.kms.outputs.DOCKERHUB_USERNAME }}
          password: ${{ steps.kms.outputs.DOCKERHUB_TOKEN }}

      # 4. Build and push to GHCR (MUST succeed)
      - name: Build and push to GHCR
        uses: docker/build-push-action@v5
        with:
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta-ghcr.outputs.tags }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      # 5. Push to Docker Hub (continue-on-error)
      - name: Push to Docker Hub
        if: steps.dockerhub.outcome == 'success'
        continue-on-error: true
        uses: docker/build-push-action@v5
        with:
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta-dockerhub.outputs.tags }}
          cache-from: type=gha
```

Key implementation details:

- **Step 1**: Credentials are never stored as GitHub Secrets directly. They are
  fetched at runtime from Hanzo KMS via Universal Auth. This means credential
  rotation in KMS immediately takes effect without touching GitHub settings.
- **Step 3**: GHCR uses `GITHUB_TOKEN` (auto-provisioned by Actions). Docker Hub
  uses KMS-sourced credentials. The Docker Hub login is `continue-on-error: true`
  so that a credential rotation glitch does not block the build.
- **Step 4**: GHCR push is mandatory. Build failure here fails the entire job.
- **Step 5**: Docker Hub push is conditional on successful login AND is itself
  `continue-on-error`. This is the "GHCR primary, Docker Hub secondary" policy.
- **Caching**: GitHub Actions cache (`type=gha`) stores layer cache across builds.
  The `cache-to: type=gha,mode=max` ensures all layers are cached, not just the
  final stage.

### Kubernetes Pull Configuration

Kubernetes clusters are configured to pull images from GHCR with in-cluster
fallback:

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

When a node requests an image from `registry.hanzo.svc:5000`, the registry
checks its local storage first. On a cache miss, it pulls from GHCR, caches
the layers locally, and serves them to the node. Subsequent pulls from any
node in the cluster hit the local cache.

### Deployment via CI

The deploy step uses `kubectl set image` to trigger a rolling update:

```yaml
deploy:
  needs: build
  steps:
    - name: Configure kubectl
      run: doctl kubernetes cluster kubeconfig save hanzo-k8s

    - name: Deploy to K8s
      run: |
        kubectl -n hanzo set image deployment/iam \
          iam=ghcr.io/hanzoai/iam:latest
        kubectl -n hanzo rollout status deployment/iam --timeout=300s

    - name: Verify health
      run: |
        kubectl wait --for=condition=available deployment/iam \
          -n hanzo --timeout=120s
```

## Security

### Authentication Architecture

Registry authentication flows through Hanzo IAM. The Docker registry v2
authentication protocol works as follows:

```
1. Client attempts: docker pull registry.hanzo.ai/myimage
2. Registry returns: 401 with WWW-Authenticate header
3. Client requests token: GET /api/registry/token?service=registry.hanzo.ai&scope=repository:myimage:pull
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
- Registry verifies tokens via the JWKS endpoint at `/api/registry/jwks`

### Signing Key Management

The registry token signing key follows a strict resolution chain:

1. `REGISTRY_SIGNING_KEY` env var (inline PEM or `kms://SECRET_NAME` reference)
2. `REGISTRY_SIGNING_KEY_FILE` env var (path to PEM file)
3. `REGISTRY_SIGNING_KEY_SECRET` env var (KMS secret name, default: `IAM_REGISTRY_SIGNING_KEY`)

In production (`ENVIRONMENT=production`), a persistent signing key MUST be
configured. The server will panic on startup if KMS key resolution fails.
In development, an ephemeral RSA key is generated per process for convenience.

### Credential Sources

| Registry | Credential Source | Auth Method |
|---|---|---|
| GHCR (CI push) | `GITHUB_TOKEN` (auto) | Token via GitHub Actions |
| GHCR (K8s pull) | `ghcr-pull-secret` | Image pull secret |
| Docker Hub (CI push) | KMS `DOCKERHUB_TOKEN` | Username/password via KMS |
| In-cluster (push) | IAM user credentials | Basic auth -> JWT |
| In-cluster (pull) | IAM user credentials | Basic auth -> JWT |

Docker Hub credentials are NEVER stored as GitHub Secrets. They are fetched at
CI runtime from Hanzo KMS via Universal Auth:

```bash
# KMS authentication (from CI workflow)
ACCESS_TOKEN="$(curl -fsS -X POST \
  "https://kms.hanzo.ai/api/v1/auth/universal-auth/login" \
  -H "Content-Type: application/json" \
  -d '{"clientId":"...","clientSecret":"..."}'
  | jq -r '.accessToken')"

# Secret retrieval
DOCKERHUB_TOKEN="$(curl -fsS \
  "https://kms.hanzo.ai/api/v3/secrets/raw/DOCKERHUB_TOKEN?workspaceSlug=gitops&environment=prod&secretPath=/ci" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  | jq -r '.secret.secretValue')"
```

This means credential rotation happens in KMS. No GitHub settings, no manual
updates to CI configs, no secrets in source code.

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

1. Kubernetes continues pulling from GHCR (slower but functional)
2. Redeploy the registry from Helm chart
3. Cache repopulates organically on next pulls

GHCR and Docker Hub are managed by GitHub and Docker respectively. Our disaster
recovery concern is limited to the in-cluster tier.

### Migration Path

For teams currently using ad-hoc image management:

1. **Week 1**: Adopt GHCR naming convention (`ghcr.io/hanzoai/{service}`)
2. **Week 2**: Add Docker Hub as secondary push target
3. **Week 3**: Deploy in-cluster registry, configure pull-through
4. **Week 4**: Add Trivy scanning and cosign signing to CI
5. **Week 5**: Enable webhook-driven deployments

## Reference Implementation

The IAM service (`github.com/hanzoai/iam`) serves as the reference
implementation for this standard. Its CI workflow at
`.github/workflows/docker-deploy.yml` demonstrates:

- KMS-sourced credentials
- Multi-arch buildx builds
- GHCR primary push (required)
- Docker Hub secondary push (continue-on-error)
- K8s rolling deployment from GHCR
- Health verification after deploy

Its `controllers/registry_token.go` demonstrates:

- Docker registry v2 token authentication
- IAM-backed credential validation
- Role-based access control (admin: push+pull, user: pull-only)
- RSA-signed JWT token generation
- JWKS public key endpoint for token verification
- KMS-backed signing key resolution with ephemeral fallback

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
