---
hip: "0036"
title: CI/CD Build System Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Final
implementation-go: partial
created: 2025-01-15
requires: HIP-0027, HIP-0033, HIP-0142
---


# HIP-0036: CI/CD Build System Standard

## Abstract

CI is **Hanzo Git Actions** at `git.hanzo.ai`, executed by **`act_runner`** —
one runner, capability-routed, serving `hanzoai`, `luxfi`, `zooai`, `parsdao` and
`zenlm`. Workflows live in **`.hanzo/workflows/`**. GitHub Actions is not part of
this path and has no runners here; a workflow left under `.github/workflows/`
queues forever while looking like CI.

A repository needs two files: `hanzo.yml` at the root, which declares what to
test and what images to build (HIP-0142), and a short `.hanzo/workflows/cicd.yml`
that imports the one reusable workflow. Build and test logic lives in
`hanzoai/ci`, once, and no repository carries its own.

A build ends at a **published image**. It does not deploy. What runs in a cluster
is declared in `hanzoai/universe` and applied by `cd.hanzo.ai`; `ci.hanzo.ai`
reports whether the two agree.

**Reusable workflow**: `hanzoai/ci/.hanzo/workflows/build.yml@v1`
**Runner labels**: `hanzoai/.github` → `RUNNERS.md`, the single source of truth
**Registry**: `oci.hanzo.ai/<org>/<app>` (HIP-0033)

## Motivation

### The Problem at Scale

Managing CI/CD for 260+ repositories creates compounding problems:

1. **Configuration drift**: Without a standard, each repo invents its own workflow. Team A uses `npm test`, Team B uses `pnpm test`, Team C uses `yarn test`. Multiply this by every build step and you get 260 slightly different pipelines that nobody fully understands.

2. **Secret sprawl**: if each repository stores its own registry token, rotating that token means editing every repository that holds it. Miss one and its next build breaks silently. With twenty-odd secrets per repository this is a full-time job that produces nothing.

3. **Registry fragmentation**: repositories pushed to one registry, another, both or neither, so a consumer could not predict where an image lived or what tags it carried.

4. **Deployment inconsistency**: One repo deploys via SSH + docker-compose, another via kubectl, another via Helm. Incident response requires knowing which method each service uses.

5. **Wasted compute**: Without shared caching strategies, every build downloads the same Go modules, Node packages, and Docker layers from scratch.

### The Solution

One reusable workflow — `hanzoai/ci` — that every repository imports, driven
entirely by that repository's `hanzo.yml`. No per-repo build logic, one place to
fix a build step, and one place secrets are fetched.

## Design Philosophy

### Why our own forge runs our own CI

Secret rotation is the concrete reason. With a per-repository secret store, one
rotated credential is an edit in every repository that holds it; miss one and its
next build breaks silently. Secrets are fetched from KMS at build time instead,
so a rotation is one write and every subsequent build picks it up. The only
long-lived values a repository holds are the machine identity it authenticates
with.

The second reason is that the fleet's builds need hardware GitHub-hosted runners
do not have — Metal GPU, macOS, Windows, Linux arm64 with CUDA — and a single
capability-routed runner serves all of it beside the fungible amd64 bulk.

### Why Multi-Arch Builds (linux/amd64 + linux/arm64)

Hanzo infrastructure runs on two architectures:

| Environment | Architecture | Examples |
|-------------|-------------|----------|
| Production K8s | AMD64 | DigitalOcean droplets, Kubernetes cluster  |
| Developer machines | ARM64 | Apple Silicon MacBooks (M1/M2/M3/M4) |
| CI runners | AMD64 and ARM64 | the in-cluster `act_runner` pool, plus native arm64 hosts |

Without multi-arch images, a developer on Apple Silicon pulling a service image gets an amd64 image under emulation -- several times slower, and with behaviour differences that show up as flaky tests rather than as an obvious wrong-architecture error.

A multi-arch manifest list solves it: one tag carries both architectures and the client selects the native one.

The build uses `docker/setup-qemu-action` for cross-compilation and `docker/setup-buildx-action` for multi-platform builds:

```yaml
- uses: docker/setup-qemu-action@v3
- uses: docker/setup-buildx-action@v3
- uses: docker/build-push-action@v5
  with:
    platforms: linux/amd64,linux/arm64
```

**Trade-off acknowledged**: Multi-arch builds take 2-3x longer than single-arch builds because each platform compiles separately. We accept this because builds are not in the critical path for developer iteration (developers build locally) and the production correctness guarantee is worth the extra CI minutes.

### Why one registry

An image lives at exactly one address. A second registry was previously mirrored
on a best-effort push, and the mirror is the problem rather than the fallback — a
"convenience mirror" a build is permitted to fail is a set of tags that disagree
with the source of truth, at a cadence nobody watches, and a consumer cannot tell
which one they pulled. HIP-0033 is the one statement of where an image is
published, and the org prefix never mixes: `hanzoai` for Hanzo, `luxfi` for Lux,
`zooai` for Zoo.

### Why a build ends at an image

The pipeline publishes an image and stops. It holds no cluster credential, runs
no `kubectl`, and cannot roll anything out. What runs is declared in
`hanzoai/universe` as a pinned tag, and `cd.hanzo.ai` reconciles the cluster
toward that declaration.

That split is what makes drift nameable rather than a feeling. Four values form
one causal line — `head → built → declared → running` — and a service is current
exactly when all four agree. Each way they disagree names the arrow that did not
happen: `unbuilt` (head produced no image), `unshipped` (an image was proved that
the pin never named), `unsynced` (the pin and the cluster disagree, compared by
digest), `untested` (a passing build whose tests did not execute). A pipeline
that deploys directly can report success while running something nobody declared,
and has no way to say which of the four steps failed.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### 1. Two files per repository

A repository declares itself with `hanzo.yml` at the root (HIP-0142 specifies the
manifest and its `kind` field) and imports the one reusable workflow:

```yaml
# hanzo.yml — what to test, what to build
images:
  - { name: api, context: ./api, repo: oci.hanzo.ai/hanzoai/<repo>, tag-suffix: api }
test:
  - { name: api, run: "pytest -q" }
kms: { path: /deploy, environment: prod }
```

```yaml
# .hanzo/workflows/cicd.yml — the whole workflow
name: CI/CD
on:
  push: { branches: [main], tags: ["v*"] }
  pull_request:
  workflow_dispatch:
jobs:
  cicd:
    uses: hanzoai/ci/.github/workflows/build.yml@v2
    secrets: inherit
```

**The caller's directory and the callee's path are governed by different rules,
and conflating them breaks the build.** `.hanzo/workflows/` is where the forge
*scans* for this repository's workflows, so the caller MUST live there (§2). The
`uses:` line is a reference into another repository at a pinned tag — the forge
resolves it by path at that tag, not by scanning — so it names whatever path the
reusable workflow occupies there. Today that is
`hanzoai/ci/.github/workflows/build.yml@v2`. Copy the line from `hanzoai/ci`'s
own caller rather than from memory; it is the one place both halves are known to
agree.

A `v*` tag is what produces a published immutable image tag. Without that
trigger, a release tag builds nothing and there is no version for the declared
state to pin.

A repository MUST NOT carry its own build, test, release or publish logic. Where
one exists, the fix is to move the specifics into `hanzo.yml` and delete the
rest — a second implementation of the pipeline is the defect this HIP exists to
prevent.

### 2. `.hanzo/workflows/`, and nothing left under `.github/workflows/`

Hanzo Git collects workflows from the **first** entry of `WORKFLOW_DIRS` that
exists — not the union. The moment one file lands in `.hanzo/workflows/`, every
remaining file under `.github/workflows/` stops running, and it stops **silently**:
the checks that would go red are the ones no longer running, so the repository
reports green over a pipeline that is not there. A half-finished migration runs
neither lane.

Find the dead files in any repository:

```bash
comm -23 <(ls .github/workflows) <(ls .hanzo/workflows)   # anything listed is dead
```

Moving a file is not reviving it. Two things break on the way across, and both
MUST be handled deliberately:

- **`runs-on: ubuntu-latest` matches no runner in this fleet, deliberately.**
  Hanzo Git hosts roughly 1,400 mirrored repositories whose upstream workflows
  all ask for it; advertising that label would hand the fleet to their CI. An
  unmatched label does not fail — it **queues until the timeout**, which reads as
  a hung build rather than a misconfiguration. Use a label from `RUNNERS.md`.
- **Anything reading a GitHub-only surface** — `github.event.pull_request`, PR
  comments, GitHub Releases, the compare API, GitHub App tokens, CodeQL's
  `security-events` upload, OIDC trusted publishing — has no equivalent here. Port
  it deliberately, or drop it and say so out loud.

In a fork, most files under `.github/workflows/` are the **upstream project's**
CI: label bots, reviewer assignment, stale bots, release trains for packages we
do not publish. Moving those runs someone else's automation on our fleet. Sort
every file into revive / rewrite / drop, then **delete the directory** — a dead
file cannot accumulate in a directory that does not exist.

The one repository that keeps files in both is `hanzoai/ci` itself, and for a
reason that is not an exception to this rule: its `.hanzo/workflows/cicd.yml` is
its own caller, gated like any other repository, while the reusable workflow it
publishes for everyone else is an artifact addressed by path at a tag. It is
consumed by reference, never scanned.

### 3. Runner labels

`hanzoai/.github` → `RUNNERS.md` is the single source of truth for the label
taxonomy, and both the runner configuration and every workflow's `runs-on`
consume it. The canonical label for new workflows is the compound
`<org>-<os>-<arch>` — `hanzo-linux-amd64`, `lux-macos-arm64`. Every runner also
advertises the compatibility aliases that route to the same capability; author
against the canonical form and treat the aliases as history.

A `runs-on` value names a **capability**, not a machine. The in-cluster runner
serves the fungible amd64-Linux bulk with no physical-host dependency; native
host runners serve only what the cluster cannot — Metal GPU, macOS, Windows, and
Linux arm64 with CUDA.

### 4. Secrets

Secrets are fetched from KMS at build time (HIP-0027, HIP-0136). A repository
holds the machine identity it authenticates with and nothing else: no vendor
token, no registry password, no cluster credential.

The build MUST NOT hold a credential for anything it does not itself call. In
particular it holds **no cloud provider token and no kubeconfig**, because it
does not deploy (§Deployment below). An upstream credential a *service* needs at
runtime is never handed to the build at all — that is egress's custody (HIP-0143).

### 5. What a build produces

A build produces images and stops. It publishes to **one** destination —
`oci.hanzo.ai/<org>/<app>`, the fleet registry — authenticated with the build's
IAM identity through a per-repository registry token, never a registry password.
HIP-0033 is the one statement of where an image goes; `ghcr.io/<org>` is for
already-published open source that outside users pull, and there is no mirror, no
second push and no best-effort publication lane.

The org prefix never mixes: Hanzo under `hanzoai`, Lux under `luxfi`, Zoo under
`zooai`, on whichever host applies.

### 6. Caching

Builds MUST cache dependency downloads and image layers.

| Language | Cache Mechanism | Configuration |
|----------|----------------|---------------|
| Go | `actions/setup-go` built-in | `cache-dependency-path: ./go.mod` |
| Node.js | `actions/setup-node` built-in | `cache: 'pnpm'` (or `'yarn'`) |
| Python | `astral-sh/setup-uv` built-in | Automatic uv cache |
| Rust | `actions/cache` manual | `~/.cargo/registry`, `target/` |
| Docker | GitHub Actions cache backend | `cache-from: type=gha`, `cache-to: type=gha,mode=max` |

Layer caching is the one that matters: a build that changes only the application
layer reuses the base image, the dependency install and the compilation layers,
which is the difference between a build measured in minutes and one measured in
tens of seconds. The cache backend is the forge's, reached the same way through
`act_runner`'s GitHub-Actions-compatible surface.

### 7. Image tagging

All images MUST use this tag scheme:

```
oci.hanzo.ai/<org>/{service}:{tag}

Tags:
  latest              - Latest build from default branch
  {semver}            - Semantic version (e.g., 1.5.2)
  {branch}-{sha}      - Branch name + short commit SHA (e.g., main-a1b2c3d)
```

Examples:
```
oci.hanzo.ai/hanzoai/iam:latest
oci.hanzo.ai/hanzoai/iam:1.5.2
oci.hanzo.ai/hanzoai/iam:main-a1b2c3d
oci.hanzo.ai/luxfi/node:1.17.32
```

A floating tag never reaches a cluster: `hanzoai/universe` pins a semver tag, and
`latest` exists for local pulls and nothing else.

### 8. Service containers in a test job

A test job that needs a store MUST use ours, named for what we run (HIP-0138):

| service | image |
|---|---|
| `sql` | `oci.hanzo.ai/hanzoai/sql` |
| `kv` | `oci.hanzo.ai/hanzoai/kv` |
| `datastore` | `oci.hanzo.ai/hanzoai/datastore` |
| `s3` | `oci.hanzo.ai/hanzoai/s3` |

There is no DocumentDB service and no MongoDB image; nothing in the fleet runs
one, so a test standing one up is testing against an engine that will not be
there. A test that needs no server SHOULD use the embedded SQLite path instead of
a service container at all — it is faster and it is what the service runs.

### 9. Branch protection

All repositories MUST configure branch protection on `main`:

1. **Required status checks**: every job of the reusable workflow must pass
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
hanzo.yml               # what to test, what to build (HIP-0142)
.hanzo/
  workflows/
    cicd.yml            # ~7 lines: imports hanzoai/ci
Dockerfile              # multi-stage, multi-target
compose.yml             # local development (never docker-compose.yml)
Makefile                # developer-facing commands
```

There is no `.github/workflows/` directory. A repository that still has one has
not finished §2, and the files in it either run by accident or do not run at
all.

### Secrets a build may read

The path convention is HIP-0136's — the path names the app that READS the secret,
the key is exactly the environment variable it becomes, and the environment is
`prod`. A build reads under the release pipeline's own path:

```
hanzo/deploy/<NAME>@prod
```

`deploy` is a purpose rather than an app, and it is the one standing exception to
HIP-0136's rule, because nothing reads it but the release pipeline and the
pipeline is not a deployed app. It stays until the pipeline is one.

What is **not** there any more, and must not come back: a registry mirror's
username and token, a cloud provider API token, and an SSH key for a compose
host. The first has no second registry to authenticate to (§5); the second and
third would let a build reach a cluster, which is the authority §Deployment
removes.

### Deployment

**The pipeline does not deploy.** It publishes an image, and that is the end of
its authority. It holds no cloud provider token, no kubeconfig and no SSH key,
which is why a compromised build cannot reach a cluster.

What runs is declared in `hanzoai/universe` — `charts/app/values/<ns>/<name>.yaml`
pins the semver tag — and `cd.hanzo.ai` reconciles the cluster toward that
declaration within one poll. Promoting a build is therefore an edit to the
declared state, reviewable as a diff, and rolling back is the same edit in
reverse.

`ci.hanzo.ai` reads the four values and never writes: no deploy, no retry, no
promotion. Two readings it depends on are worth knowing, because both were wrong
before they were fixed. A run's **jobs** are read rather than its single
conclusion — a run that fails at the gate built nothing, a run that fails at the
receipt has already built, pinned and proved the release live, and both report
`failure`. And a commit the forge never constructed a run for is **absent**, not
failed: there is no log to open, so it is not drawn as a failure.

## Security

### Threat Model

| Threat | Mitigation |
|--------|-----------|
| Leaked secrets in git history | All secrets fetched from KMS at runtime; never written to files or env that persists |
| Compromised runner | KMS access tokens are short-lived; the runner holds no persistent credential, and no cluster credential at all |
| Supply chain attack via a third-party action | Pin to a full commit SHA, never a mutable tag |
| Malicious PR running CI | PRs from forks do not have access to secrets; workflows use `pull_request_target` carefully |
| Container image tampering | GHCR images are content-addressed by digest; Kubernetes can pin to digest |
| Privilege escalation in deploy | The build cannot deploy: it has no cluster credential, and the declared state is a reviewed edit in `hanzoai/universe` |
| A workflow that looks like CI and is not | One file in `.hanzo/workflows/` retires the whole `.github/workflows/` directory silently; §2 is how that is detected |

### Secret Hygiene Rules

1. **No secrets in git**: Not in code, not in config files, not in `.env` files. All secrets come from KMS.
2. **One stored identity**: the machine identity the build authenticates to KMS with. Everything else is fetched at build time. Secrets are set **on the forge**, since `.hanzo/workflows/` is what the forge reads; GitHub's secret store is not in this path at all.
3. **Mask all secrets**: Every fetched secret MUST be masked with `::add-mask::` before use.
4. **Short-lived tokens**: KMS access tokens expire in 15 minutes. If a build takes longer, re-authenticate.
5. **Audit trail**: KMS logs every secret access. Anomalous patterns (unusual repo, unusual time) trigger alerts.

### Image Scanning

All Docker images SHOULD be scanned before push using Trivy:

```yaml
- name: Scan image
  uses: aquasecurity/trivy-action@<full-sha>   # v0.28.0
  with:
    image-ref: oci.hanzo.ai/hanzoai/${{ env.IMAGE }}:${{ env.VERSION }}
    format: 'table'
    exit-code: '1'
    severity: 'CRITICAL,HIGH'
```

Critical vulnerabilities SHOULD block the release; high vulnerabilities SHOULD be
reviewed within seven days.

The scanner's finding is the gate, read from its exit code. A SARIF upload to
GitHub's code-scanning surface is **not** available here — that is one of the
GitHub-only surfaces §2 names — so a workflow that uploads SARIF and treats a
successful upload as the check has no gate at all.

### Supply Chain Security

- **Action pinning**: Prefer SHA-pinned actions over tag references. Tags are mutable; a compromised action could be re-tagged to inject malicious code.
- **Dependency updates**: repositories SHOULD run automated dependency updates for their workflow's third-party actions, with the same SHA-pinning rule applied to the update.
- **Provenance**: the build stamp and the bill of materials are HIP-0074's; that HIP states what is emitted today and what is target-not-yet-served, and this one does not restate it.

## Monitoring

`ci.hanzo.ai` answers one question per service: **is what we wrote what is
running?** It reads four values that form one causal line, and reports the arrow
that did not happen rather than a pass or a fail:

```
head ──build──▶ built ──pin──▶ declared ──reconcile──▶ running
```

| value | read from |
|---|---|
| **head** | the repository's default branch |
| **built** | the newest commit whose run produced an image |
| **declared** | `charts/app/values/<ns>/<name>.yaml` in `hanzoai/universe` |
| **running** | the workload's image in the cluster, by digest |

Three matching values are not health, which is why head is read at all: built,
declared and running can agree perfectly while `main` has moved on and nothing
since has built. `unbuilt` is counted only once a build has STOPPED without
producing an image, so a push in flight is not reported as drift.

It reads the cluster through its own ServiceAccount — `get` and `list` on
workloads, nothing else, no stored credential — and it never writes: no deploy,
no retry, no promotion.

## Migration status

The cutover from `arcd` to `act_runner` is done and `arcd` is retired; the
runbook and teardown live in `hanzoai/universe`. What remains is per-repository:
every repository that still carries workflow files under `.github/workflows/`
must sort them into revive / rewrite / drop and delete the directory (§2). Until
a repository has done that, one of two things is true of it — either it is still
running its GitHub-era pipeline on the forge by accident, or it landed one file
in `.hanzo/workflows/` and silently stopped running everything else.

## References

1. [`hanzoai/ci`](https://github.com/hanzoai/ci) -- the one reusable workflow
2. `hanzoai/.github` -> `RUNNERS.md` -- the runner label taxonomy, single source of truth
3. [HIP-0142: One Manifest, Five Kinds](./hip-0142-one-manifest-five-kinds.md) -- `hanzo.yml`, and every reader of it
4. [HIP-0033: Container Registry Standard](./hip-0033-container-registry-standard.md) -- where an image is published
5. [HIP-0027: Secrets Management Standard](./hip-0027-secrets-management-standard.md) -- where a build's secrets come from
6. [HIP-0136: One Secret, One Path](./hip-0136-one-secret-one-path.md) -- how a secret is addressed
7. [HIP-0143: Egress -- The Outbound Trust Boundary](./hip-0143-egress-outbound-trust-boundary.md) -- why a runtime credential never reaches a build
8. [HIP-0014: Application Deployment Standard](./hip-0014-application-deployment-standard.md)
9. [HIP-1122: Deploy -- The GitOps Plane](./hip-1122-deploy-gitops-plane.md) -- what reconciles the declared state
10. [Conventional Commits Specification](https://www.conventionalcommits.org/)
11. [SLSA Supply Chain Security Framework](https://slsa.dev/)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
