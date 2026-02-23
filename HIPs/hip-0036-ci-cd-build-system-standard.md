---
hip: 0036
title: CI/CD Build System Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2025-01-15
requires: HIP-0027, HIP-0033
---

# HIP-0036: CI/CD Build System Standard

## Abstract

This proposal defines the CI/CD build system standard for the Hanzo ecosystem. All 260+ repositories under the `hanzoai` GitHub organization MUST follow this specification for automated testing, building, releasing, and deploying software artifacts.

Hanzo Build provides standardized GitHub Actions workflows, reusable composite actions, and deployment patterns that enforce consistent quality gates across every project -- from the IAM identity provider to the LLM Gateway, from Rust ML frameworks to React frontends.

**Repository**: [github.com/hanzoai/build](https://github.com/hanzoai/build)
**Secret Management**: [kms.hanzo.ai](https://kms.hanzo.ai) (Hanzo KMS, HIP-0033)
**Primary Registry**: [ghcr.io/hanzoai](https://ghcr.io/hanzoai)

## Motivation

### The Problem at Scale

Managing CI/CD for 260+ repositories creates compounding problems:

1. **Configuration drift**: Without a standard, each repo invents its own workflow. Team A uses `npm test`, Team B uses `pnpm test`, Team C uses `yarn test`. Multiply this by every build step and you get 260 slightly different pipelines that nobody fully understands.

2. **Secret sprawl**: If each repo stores its own Docker Hub token as a GitHub Secret, rotating that token means updating 260+ repositories. Miss one and its nightly build silently breaks. With 20+ secrets per repo, this becomes a full-time job.

3. **Registry fragmentation**: Some repos push to Docker Hub, some to GHCR, some to both, some to neither. Consumers cannot predict where an image lives or what tags it uses.

4. **Deployment inconsistency**: One repo deploys via SSH + docker-compose, another via kubectl, another via Helm. Incident response requires knowing which method each service uses.

5. **Wasted compute**: Without shared caching strategies, every build downloads the same Go modules, Node packages, and Docker layers from scratch.

### The Solution

A single source of truth -- `github.com/hanzoai/build` -- that provides:
- Reusable workflow templates called from every repo
- Centralized secret injection from Hanzo KMS
- Standardized Docker build with multi-arch support
- Deterministic registry push order (GHCR first, Docker Hub second)
- Deployment patterns for both Docker Compose and Kubernetes targets

## Design Philosophy

This section explains the **why** behind each architectural decision. CI/CD is foundational infrastructure -- the wrong choice here multiplies across every repository and every deploy.

### Why GitHub Actions (Not Jenkins, GitLab CI, or CircleCI)

GitHub Actions is the execution platform for all Hanzo CI/CD. The rationale:

- **Co-location with source code**: All Hanzo repositories live on GitHub. The workflow YAML is version-controlled alongside the code it builds. A PR that changes build logic is reviewed in the same diff as the code change. Jenkins requires a separate Jenkinsfile repo or in-repo Jenkinsfiles that drift from the Jenkins server configuration.

- **No infrastructure to maintain**: GitHub-hosted runners are managed by GitHub. We do not operate Jenkins controllers, GitLab runners, or CircleCI executors. For 260+ repos, this eliminates a significant ops burden.

- **Native integration with GitHub features**: Branch protection rules, required status checks, PR reviews, CODEOWNERS, and deployment environments are first-class GitHub concepts. Actions integrates with all of them without glue code.

- **Marketplace ecosystem**: Pre-built actions for Docker buildx, semantic-release, Cypress, GoReleaser, and hundreds of other tools. We compose these rather than writing shell scripts.

- **Cost model**: GitHub Actions is free for public repositories (which most Hanzo repos are). Private repos get 2,000 free minutes/month on the Team plan. This is sufficient for our workload.

**Trade-off acknowledged**: GitHub Actions has weaker support for complex DAG workflows compared to Tekton or Argo Workflows. We accept this because our pipelines are linear enough (test -> build -> release -> deploy) that DAG expressiveness is not a bottleneck.

### Why KMS for CI/CD Secrets (Not GitHub Secrets)

This is the most important architectural decision in this HIP.

GitHub Secrets are scoped to a single repository (or organization, but org-level secrets are all-or-nothing). When a Docker Hub token is rotated, the naive approach requires:

```
260 repos x 1 manual update = 260 manual secret rotations
```

With Hanzo KMS (at `kms.hanzo.ai`, powered by Infisical):

```
1 KMS update = all 260 repos pick up the new token on next build
```

The secret injection flow works as follows:

```
GitHub Actions workflow starts
  |
  v
POST kms.hanzo.ai/api/v1/auth/universal-auth/login
  - Sends KMS_CLIENT_ID + KMS_CLIENT_SECRET (these two ARE GitHub Secrets)
  - Receives short-lived ACCESS_TOKEN
  |
  v
GET kms.hanzo.ai/api/v3/secrets/raw/{SECRET_NAME}
  - Sends ACCESS_TOKEN as Bearer token
  - Fetches DOCKERHUB_USERNAME, DOCKERHUB_TOKEN, DIGITALOCEAN_ACCESS_TOKEN, etc.
  |
  v
Secrets injected as step outputs -> consumed by subsequent steps
```

Each repository stores exactly TWO GitHub Secrets: `KMS_CLIENT_ID` and `KMS_CLIENT_SECRET`. These are a Universal Auth identity that grants read access to the `/ci` secret path in the `gitops` workspace. All other secrets live in KMS.

**Why this matters for security**:
- KMS provides audit logs for every secret access (who fetched what, when)
- Access tokens are short-lived (15 minutes), not permanent like GitHub Secrets
- Secret rotation is atomic: update once in KMS, every build uses the new value
- Principle of least privilege: each repo's KMS identity can be scoped to only the secrets it needs

### Why Multi-Arch Builds (linux/amd64 + linux/arm64)

Hanzo infrastructure runs on two architectures:

| Environment | Architecture | Examples |
|-------------|-------------|----------|
| Production K8s | AMD64 | DigitalOcean droplets, hanzo-k8s cluster |
| Developer machines | ARM64 | Apple Silicon MacBooks (M1/M2/M3/M4) |
| CI runners | AMD64 | GitHub-hosted ubuntu-latest |

Without multi-arch images, developers running `docker pull ghcr.io/hanzoai/iam:latest` on Apple Silicon get an AMD64 image that runs under Rosetta emulation -- 2-5x slower and with subtle behavior differences.

Multi-arch manifests solve this. A single image tag (`ghcr.io/hanzoai/iam:latest`) contains both architectures. Docker automatically selects the native one.

The build uses `docker/setup-qemu-action` for cross-compilation and `docker/setup-buildx-action` for multi-platform builds:

```yaml
- uses: docker/setup-qemu-action@v3
- uses: docker/setup-buildx-action@v3
- uses: docker/build-push-action@v5
  with:
    platforms: linux/amd64,linux/arm64
```

**Trade-off acknowledged**: Multi-arch builds take 2-3x longer than single-arch builds because each platform compiles separately. We accept this because builds are not in the critical path for developer iteration (developers build locally) and the production correctness guarantee is worth the extra CI minutes.

### Why GHCR Primary, Docker Hub Secondary

The registry push strategy is: GHCR MUST succeed, Docker Hub is continue-on-error.

```yaml
# GHCR: must succeed (the build fails if this fails)
- name: Push to GHCR
  uses: docker/build-push-action@v5
  with:
    push: true
    tags: ghcr.io/hanzoai/${{ env.IMAGE }}:latest

# Docker Hub: best-effort (the build succeeds even if this fails)
- name: Push to Docker Hub
  continue-on-error: true
  uses: docker/build-push-action@v5
  with:
    push: true
    tags: hanzoai/${{ env.IMAGE }}:latest
```

Rationale:

| Factor | GHCR | Docker Hub |
|--------|------|------------|
| Pull rate limits | None for authenticated GitHub users | 100/6hr anonymous, 200/6hr authenticated |
| Cost for private repos | Free (included with GitHub plan) | $5-$9/month per private repo |
| Auth for K8s pulls | GITHUB_TOKEN (already available) | Separate imagePullSecret required |
| Public discoverability | Lower (GitHub Packages UI) | Higher (hub.docker.com search) |
| Uptime/reliability | GitHub SLA | Has had outages affecting pulls |

GHCR is the source of truth. Docker Hub is a convenience mirror for public consumers. If Docker Hub is down or rate-limited, our builds and deployments are unaffected.

### Why Not ArgoCD/Flux for GitOps (Yet)

Our current deployment model is imperative:

```
CI builds image -> CI runs kubectl set image -> K8s rolls out new pods
```

ArgoCD and Flux provide declarative GitOps: a Git repository defines the desired state, and a controller in the cluster continuously reconciles toward it. This is superior in theory but premature for our current scale:

- **Two clusters**: We operate hanzo-k8s and lux-k8s. ArgoCD's value scales with cluster count. At 2 clusters, the overhead of running and maintaining ArgoCD (its own HA setup, RBAC, UI, SSO integration) exceeds the benefit.
- **Deployment frequency**: Most services deploy 1-3 times per day. We do not need continuous reconciliation for this cadence.
- **Migration cost**: Moving 40+ services to ArgoCD ApplicationSets requires writing and testing manifests for each. This is a month of work for marginal immediate gain.

We will adopt ArgoCD when we exceed 5 clusters or need multi-environment promotion (dev -> staging -> production) with drift detection. This HIP does not preclude that migration; the standardized workflow templates can be updated to push manifests to a GitOps repo instead of running kubectl directly.

## Specification

### Standard Workflow Templates

Every Hanzo repository MUST include workflows from the following template set. Not all templates are required for every repo -- a pure library needs only `build.yml` and `test.yml`, while a deployable service needs all four.

#### 1. `build.yml` -- Build and Test

Triggered on every push to `main`/`master` and on every pull request.

```yaml
name: Build

on:
  push:
    branches: [main, master]
  pull_request:

jobs:
  test:
    name: Tests
    runs-on: ubuntu-latest
    # Language-specific service containers (PostgreSQL, Redis, etc.)
    services:
      postgres:
        image: ghcr.io/hanzoai/sql:latest
        env:
          POSTGRES_USER: hanzo
          POSTGRES_PASSWORD: hanzo123
          POSTGRES_DB: test_db
        ports: ["5432:5432"]
        options: >-
          --health-cmd="pg_isready -U hanzo"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=5
    steps:
      - uses: actions/checkout@v4

      # Go projects
      - uses: actions/setup-go@v4
        with:
          go-version: '1.23'
          cache-dependency-path: ./go.mod
      - run: go test -v -race ./...

      # Node.js projects
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'  # or 'yarn' for legacy repos
      - run: pnpm install && pnpm test

      # Python projects
      - uses: astral-sh/setup-uv@v4
      - run: uv sync --all-extras && uv run pytest -v

  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # Go: gofumpt via golangci-lint
      # Node: eslint via pnpm lint
      # Python: ruff via uv run ruff check .
      # Rust: clippy via cargo clippy

  build:
    name: Build
    runs-on: ubuntu-latest
    needs: [test]
    steps:
      - uses: actions/checkout@v4
      # Language-specific build with race detection (Go),
      # production bundle (Node), or release build (Rust)
```

#### 2. `release.yml` -- Semantic Versioning and Release

Triggered only on push to `main`/`master`, after all build jobs succeed.

```yaml
  tag-release:
    name: Create Tag
    runs-on: ubuntu-latest
    if: github.repository == 'hanzoai/${{ env.REPO }}' && github.event_name == 'push'
    needs: [test, lint, build]
    outputs:
      new-release-published: ${{ steps.semantic.outputs.new_release_published }}
      new-release-version: ${{ steps.semantic.outputs.new_release_version }}
    steps:
      - uses: actions/checkout@v4
      - uses: cycjimmy/semantic-release-action@v4
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Semantic release reads conventional commit messages to determine version bumps:
- `fix:` -> patch (1.0.0 -> 1.0.1)
- `feat:` -> minor (1.0.0 -> 1.1.0)
- `BREAKING CHANGE:` -> major (1.0.0 -> 2.0.0)

**Note**: Go packages MUST NOT be bumped above v1.x.x per Hanzo convention. The `.releaserc` in Go repos caps at minor/patch.

#### 3. `docker.yml` -- Docker Build and Registry Push

Triggered after a successful release tag. This is the core of the containerized build pipeline.

```yaml
  docker-release:
    name: Docker Release
    runs-on: ubuntu-latest
    permissions:
      contents: write
      packages: write
    needs: [tag-release]
    if: needs.tag-release.outputs.new-release-published == 'true'
    steps:
      - uses: actions/checkout@v4

      # -- Secret injection from KMS --
      - name: Fetch CI secrets from Hanzo KMS
        id: kms
        env:
          KMS_CLIENT_ID: ${{ secrets.KMS_CLIENT_ID }}
          KMS_CLIENT_SECRET: ${{ secrets.KMS_CLIENT_SECRET }}
        run: |
          set -euo pipefail
          KMS_URL="${KMS_URL:-https://kms.hanzo.ai}"

          ACCESS_TOKEN="$(
            curl -fsS -X POST "${KMS_URL}/api/v1/auth/universal-auth/login" \
              -H "Content-Type: application/json" \
              -d "$(jq -nc --arg cid "$KMS_CLIENT_ID" \
                           --arg cs  "$KMS_CLIENT_SECRET" \
                    '{clientId: $cid, clientSecret: $cs}')" \
            | jq -r '.accessToken'
          )"

          fetch_secret() {
            curl -fsS \
              "${KMS_URL}/api/v3/secrets/raw/${1}?\
          workspaceSlug=gitops&environment=prod&\
          secretPath=/ci&viewSecretValue=true&\
          include_imports=true" \
              -H "Authorization: Bearer ${ACCESS_TOKEN}" \
            | jq -r '.secret.secretValue'
          }

          for name in DOCKERHUB_USERNAME DOCKERHUB_TOKEN; do
            val="$(fetch_secret "$name")"
            echo "::add-mask::${val}"
            echo "${name}=${val}" >> "$GITHUB_OUTPUT"
          done

      # -- Multi-arch build setup --
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3

      # -- Registry authentication --
      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Log in to Docker Hub
        id: dockerhub-login
        continue-on-error: true
        uses: docker/login-action@v3
        with:
          registry: docker.io
          username: ${{ steps.kms.outputs.DOCKERHUB_USERNAME }}
          password: ${{ steps.kms.outputs.DOCKERHUB_TOKEN }}

      # -- Image metadata --
      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: |
            ghcr.io/hanzoai/${{ env.IMAGE_NAME }}
          tags: |
            type=semver,pattern={{version}},value=${{ needs.tag-release.outputs.new-release-version }}
            type=raw,value=latest,enable={{is_default_branch}}
            type=sha,prefix={{branch}}-

      # -- Build and push (GHCR: required) --
      - name: Build and push to GHCR
        uses: docker/build-push-action@v5
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      # -- Mirror to Docker Hub (best-effort) --
      - name: Push to Docker Hub
        if: steps.dockerhub-login.outcome == 'success'
        continue-on-error: true
        uses: docker/build-push-action@v5
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: hanzoai/${{ env.IMAGE_NAME }}:latest
          cache-from: type=gha
```

#### 4. `deploy.yml` -- Deployment

Triggered after a successful Docker build on the default branch. Supports two deployment targets.

```yaml
  deploy:
    name: Deploy
    needs: [docker-release]
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      # -- Fetch deploy secrets from KMS --
      - name: Fetch deploy secrets
        id: kms
        env:
          KMS_CLIENT_ID: ${{ secrets.KMS_CLIENT_ID }}
          KMS_CLIENT_SECRET: ${{ secrets.KMS_CLIENT_SECRET }}
        run: |
          # Same KMS login pattern as docker.yml
          # Fetches: DIGITALOCEAN_ACCESS_TOKEN

      # -- Kubernetes deployment (preferred) --
      - name: Install doctl
        uses: digitalocean/action-doctl@v2
        with:
          token: ${{ steps.kms.outputs.do_token }}

      - name: Deploy to K8s
        run: |
          doctl kubernetes cluster kubeconfig save hanzo-k8s
          kubectl -n hanzo set image deployment/$SERVICE \
            $SERVICE=ghcr.io/hanzoai/$SERVICE:latest
          kubectl -n hanzo rollout status deployment/$SERVICE \
            --timeout=300s

      - name: Health check
        run: |
          kubectl wait --for=condition=available \
            deployment/$SERVICE -n hanzo --timeout=120s
```

### Caching Strategy

Builds MUST use GitHub Actions cache to avoid redundant downloads.

| Language | Cache Mechanism | Configuration |
|----------|----------------|---------------|
| Go | `actions/setup-go` built-in | `cache-dependency-path: ./go.mod` |
| Node.js | `actions/setup-node` built-in | `cache: 'pnpm'` (or `'yarn'`) |
| Python | `astral-sh/setup-uv` built-in | Automatic uv cache |
| Rust | `actions/cache` manual | `~/.cargo/registry`, `target/` |
| Docker | GitHub Actions cache backend | `cache-from: type=gha`, `cache-to: type=gha,mode=max` |

Docker layer caching deserves special attention. The `type=gha` cache backend stores Docker layers in the GitHub Actions cache (10 GB per repo). This means a build that changes only the application layer reuses the base image, dependency install, and compilation layers from cache. For a Go project like IAM, this reduces build time from ~8 minutes to ~2 minutes.

### Image Tagging Convention

All Docker images MUST use the following tag scheme:

```
ghcr.io/hanzoai/{service}:{tag}

Tags:
  latest              - Latest build from default branch
  {semver}            - Semantic version (e.g., 1.5.2)
  {branch}-{sha}      - Branch name + short commit SHA (e.g., main-a1b2c3d)
```

Examples:
```
ghcr.io/hanzoai/iam:latest
ghcr.io/hanzoai/iam:1.5.2
ghcr.io/hanzoai/iam:main-a1b2c3d
ghcr.io/hanzoai/llm-gateway:latest
ghcr.io/hanzoai/llm-gateway:2.1.0
```

### Service Container Images

CI workflows that require databases or caches MUST use Hanzo-maintained service images:

| Service | Image | Notes |
|---------|-------|-------|
| PostgreSQL | `ghcr.io/hanzoai/sql:latest` | PostgreSQL with extensions |
| Redis | `ghcr.io/hanzoai/kv:latest` | Redis-compatible KV store |
| MongoDB | `mongo:7` | Upstream (no Hanzo fork needed) |
| MinIO | `minio/minio:latest` | S3-compatible object storage |

### Branch Protection Requirements

All repositories MUST configure branch protection on `main`/`master`:

1. **Required status checks**: All jobs in `build.yml` must pass
2. **Require PR review**: At least one approving review before merge
3. **Require linear history**: Squash or rebase merges only (no merge commits)
4. **Signed commits**: Encouraged but not required (GPG or SSH signing)

### Conventional Commits

All commit messages MUST follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>[optional scope]: <description>

Types:
  feat:     New feature (triggers minor version bump)
  fix:      Bug fix (triggers patch version bump)
  docs:     Documentation only
  style:    Formatting, no code change
  refactor: Code change that neither fixes nor adds
  perf:     Performance improvement
  test:     Adding or fixing tests
  ci:       CI/CD changes
  chore:    Build process or auxiliary tool changes
```

Semantic-release reads these to determine the next version number automatically. No manual version bumping.

## Implementation

### Repository Structure

Every Hanzo repository with CI/CD follows this structure:

```
.github/
  workflows/
    build.yml           # Test + lint + build (PR and push)
    docker-deploy.yml   # Docker build + registry push + deploy (push only)
    sync.yml            # Optional: sync fork with upstream
  CODEOWNERS            # Required reviewers per path
Dockerfile              # Multi-stage, multi-target
compose.yml             # Local development (NOT docker-compose.yml)
Makefile                # Developer-facing commands
version.txt             # Current version (read by CI)
.releaserc              # Semantic-release configuration
```

### KMS Secret Organization

Secrets in Hanzo KMS are organized by workspace and path:

```
Workspace: gitops
Environment: prod
Path: /ci

Secrets:
  DOCKERHUB_USERNAME        # Docker Hub service account
  DOCKERHUB_TOKEN           # Docker Hub access token
  DIGITALOCEAN_ACCESS_TOKEN # DO API token for K8s deploy
  SLACK_WEBHOOK             # Build notification webhook
  DEPLOY_SSH_KEY            # SSH key for Docker Compose targets
```

Each repository's KMS Universal Auth identity is scoped to read only from `/ci`. A repository that also needs application-level secrets (e.g., database URLs for E2E tests) gets additional path access as needed.

### Deployment Targets

Hanzo services deploy to one of two target types:

#### Target 1: Kubernetes (hanzo-k8s)

The preferred deployment target. The CI workflow:

1. Authenticates to DigitalOcean via `doctl` using a KMS-sourced token
2. Configures `kubectl` for the `hanzo-k8s` cluster
3. Updates the deployment image tag: `kubectl set image deployment/SERVICE`
4. Waits for rollout: `kubectl rollout status`
5. Verifies health: `kubectl wait --for=condition=available`

```
Services on hanzo-k8s (24.199.76.156):
  IAM, KMS, Platform, Cloud, Console, Gateway,
  Commerce, hanzo-app, web3, registry, bootnode-api
  PostgreSQL, Redis, MongoDB, MinIO
```

#### Target 2: Docker Compose (legacy)

For services not yet migrated to K8s. The CI workflow:

1. SSHes into the target server using a KMS-sourced SSH key
2. Pulls the latest image: `docker pull ghcr.io/hanzoai/SERVICE:latest`
3. Restarts the service: `docker compose up -d SERVICE`
4. Verifies health via HTTP check

This target is being phased out in favor of K8s. New services MUST deploy to K8s.

### Reusable Workflow Pattern

The `github.com/hanzoai/build` repository provides reusable workflows that individual repos call:

```yaml
# In any Hanzo repo: .github/workflows/docker-deploy.yml
name: Docker Build and Deploy

on:
  push:
    branches: [main, master]

jobs:
  build-and-deploy:
    uses: hanzoai/build/.github/workflows/docker-k8s.yml@main
    with:
      image-name: my-service
      k8s-namespace: hanzo
      k8s-deployment: my-service
    secrets:
      KMS_CLIENT_ID: ${{ secrets.KMS_CLIENT_ID }}
      KMS_CLIENT_SECRET: ${{ secrets.KMS_CLIENT_SECRET }}
```

This reduces per-repo workflow files from 150+ lines to ~15 lines while maintaining full customizability via `with:` inputs.

## Security

### Threat Model

| Threat | Mitigation |
|--------|-----------|
| Leaked secrets in git history | All secrets fetched from KMS at runtime; never written to files or env that persists |
| Compromised GitHub Actions runner | KMS access tokens expire in 15 minutes; runner has no persistent credentials |
| Supply chain attack via Actions | Pin action versions to SHA, not mutable tags (`actions/checkout@abc123` not `@v4`) |
| Malicious PR running CI | PRs from forks do not have access to secrets; workflows use `pull_request_target` carefully |
| Container image tampering | GHCR images are content-addressed by digest; Kubernetes can pin to digest |
| Privilege escalation in deploy | KMS identities follow least privilege; CI identity cannot read production database credentials |

### Secret Hygiene Rules

1. **No secrets in git**: Not in code, not in config files, not in `.env` files. All secrets come from KMS.
2. **Two GitHub Secrets maximum**: `KMS_CLIENT_ID` and `KMS_CLIENT_SECRET`. Everything else is fetched dynamically.
3. **Mask all secrets**: Every fetched secret MUST be masked with `::add-mask::` before use.
4. **Short-lived tokens**: KMS access tokens expire in 15 minutes. If a build takes longer, re-authenticate.
5. **Audit trail**: KMS logs every secret access. Anomalous patterns (unusual repo, unusual time) trigger alerts.

### Image Scanning

All Docker images SHOULD be scanned before push using Trivy:

```yaml
- name: Scan image
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: ghcr.io/hanzoai/${{ env.IMAGE }}:${{ env.VERSION }}
    format: 'sarif'
    output: 'trivy-results.sarif'
    severity: 'CRITICAL,HIGH'

- name: Upload scan results
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: 'trivy-results.sarif'
```

Critical vulnerabilities SHOULD block the release. High vulnerabilities SHOULD be reviewed within 7 days.

### Supply Chain Security

- **Action pinning**: Prefer SHA-pinned actions over tag references. Tags are mutable; a compromised action could be re-tagged to inject malicious code.
- **Dependabot**: All repos MUST enable Dependabot for GitHub Actions workflow updates.
- **SLSA provenance**: Docker builds use `provenance: false` currently (buildx provenance attestations cause issues with some registries). We will enable SLSA Level 2 provenance when registry support stabilizes.

## Monitoring and Observability

### Build Metrics

CI workflows emit metrics to the Hanzo observability stack:

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `ci.build.duration_seconds` | Total workflow duration | > 15 minutes |
| `ci.test.duration_seconds` | Test job duration | > 10 minutes |
| `ci.docker.build_seconds` | Docker build + push duration | > 8 minutes |
| `ci.deploy.duration_seconds` | Deploy + health check duration | > 5 minutes |
| `ci.build.failure_rate` | Rolling 24h failure rate | > 20% |
| `ci.cache.hit_rate` | Docker/dependency cache hit rate | < 50% |

### Deployment Notifications

Build results are posted to Slack via webhook:

```
[IAM] Deploy succeeded
  Version: 1.5.2
  Commit: a1b2c3d "feat: apply application.DefaultGroup for OAuth signups"
  Duration: 3m 42s
  Cluster: hanzo-k8s
```

Failed builds include the failure step and a link to the workflow run.

## Migration Guide

### For Existing Repositories

1. **Add KMS credentials**: Set `KMS_CLIENT_ID` and `KMS_CLIENT_SECRET` as GitHub Secrets. Request a Universal Auth identity from the platform team.

2. **Replace inline secrets**: Remove any `DOCKERHUB_TOKEN`, `DEPLOY_SSH_KEY`, etc. from GitHub Secrets. Add the KMS fetch step to your workflow.

3. **Adopt standard workflow**: Copy the template from `hanzoai/build` or use the reusable workflow pattern.

4. **Update Dockerfile**: Ensure multi-stage build with named targets (`STANDARD`, `ALLINONE`).

5. **Add branch protection**: Configure required status checks matching your `build.yml` job names.

6. **Enable Dependabot**: Add `.github/dependabot.yml` for Actions and language-specific dependency updates.

### For New Repositories

Use the `hanzoai/template` repository which includes all standard CI/CD configuration pre-configured.

```bash
gh repo create hanzoai/my-new-service \
  --template hanzoai/template \
  --public
```

## Future Work

### Phase 1: Current (Q1 2025)
- Standardized workflows across all 260+ repos
- KMS-first secret management
- Multi-arch Docker builds
- K8s deployment via kubectl

### Phase 2: Maturation (Q2-Q3 2025)
- Reusable workflow library in `hanzoai/build`
- SLSA Level 2 provenance on all images
- Trivy scanning as a required gate
- Build dashboard with aggregate metrics

### Phase 3: GitOps (Q4 2025)
- ArgoCD for K8s deployments (when cluster count > 5)
- Manifest repo (`hanzoai/deploy`) as deployment source of truth
- Environment promotion: staging -> production with approval gates
- Drift detection and automatic reconciliation

### Phase 4: Advanced (2026)
- Self-hosted runners for GPU workloads (ML model builds)
- Ephemeral preview environments per PR
- Canary deployments with automated rollback
- Cost optimization: spot instances for CI, build queueing

## References

1. [GitHub Actions Documentation](https://docs.github.com/en/actions)
2. [Docker Buildx Multi-Platform Builds](https://docs.docker.com/build/building/multi-platform/)
3. [Conventional Commits Specification](https://www.conventionalcommits.org/)
4. [Semantic Release](https://github.com/semantic-release/semantic-release)
5. [SLSA Supply Chain Security Framework](https://slsa.dev/)
6. [HIP-0014: Application Deployment Standard](./hip-0014-application-deployment-standard.md)
7. [HIP-0033: KMS Secret Management](./hip-0033-kms-secret-management.md)
8. [Hanzo IAM CI/CD](https://github.com/hanzoai/iam/tree/main/.github/workflows) -- Reference implementation
9. [Hanzo Build Repository](https://github.com/hanzoai/build)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
