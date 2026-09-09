---
hip: "0027"
title: Secrets Management Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
implementation-go: partial
created: 2025-01-15
---


# HIP-0027: Secrets Management Standard

## Abstract

There is **one** KMS surface: `api.hanzo.ai/v1/kms`. It answers `path` / `env` /
`name`, resolving to `/orgs/<org>/<path>/<NAME>`, and it is the only store any
service reads. The `/api/v1/` and `/api/v3/` surface earlier revisions of this
HIP documented is gone; it carried the `/api/` prefix the estate does not use
(HIP-0119) and it returns `404`.

**Where a secret sits is HIP-0136's question, not this one's.** That HIP is
normative for the path, and it supersedes the project-per-service layout §Secret
Organization Model used to specify. This HIP covers what KMS is, how a service
authenticates to it, and how the `KMSSecret` CRD gets a value into a pod.

This proposal defines the secrets management standard for the Hanzo ecosystem. Hanzo KMS is the centralized,
auditable, Kubernetes-native secret store for all Hanzo services, built on the
canonical `luxfi/kms` primitives. It replaces scattered environment variables,
CI/CD secrets, and manual `kubectl create secret` operations with a single
source of truth.

Every secret in the Hanzo ecosystem --- API keys, database credentials, OAuth
client secrets, encryption keys --- flows through KMS. Services authenticate
via Universal Auth (machine identity with client ID/secret), receive a
short-lived bearer token, and fetch secrets at runtime. In Kubernetes, the
`KMSSecret` custom resource automates syncing secrets from KMS into native
`Secret` objects, eliminating human involvement in the secret lifecycle.

**Repository**: [github.com/luxfi/kms](https://github.com/luxfi/kms) — `hanzoai/kms` is archived
**Production**: https://kms.hanzo.ai
**Docker**: `ghcr.io/luxfi/kms`

## Motivation

Before KMS, Hanzo secrets were managed through a patchwork of mechanisms:

1. **Hardcoded in compose files**: `compose.yml` files contained plaintext
   credentials. Anyone with repository access could read database passwords.
2. **GitHub Actions secrets**: CI/CD credentials lived in GitHub's secret
   store, invisible to audit and impossible to rotate without manual updates
   to every workflow.
3. **Manual kubectl**: Operators ran `kubectl create secret` by hand,
   introducing drift between what was deployed and what was documented.
4. **Duplicated across services**: The same SQL password appeared in
   IAM, Cloud, Console, and Platform deployments --- each copy managed
   independently.
5. **No audit trail**: When a secret was accessed, changed, or leaked, there
   was no way to know who did what, when.

These problems compound at scale. With 15+ services on hanzo-k8s and growing,
manual secrets management became the single largest operational risk.

## Design Philosophy

### Why our own KMS over HashiCorp Vault

HashiCorp Vault is the industry default for secrets management, but it
carries significant operational overhead:

- **Unseal ceremony**: Vault starts sealed. Every restart (node reboot,
  deployment, OOM kill) requires unseal keys. In a two-replica K8s
  deployment, this means manual intervention or complex auto-unseal
  configurations with cloud KMS --- defeating the purpose of self-hosting.
- **HA complexity**: Vault HA requires Raft consensus or Consul backend.
  Both add operational surfaces. Consul alone is a distributed system that
  needs its own monitoring, backup, and upgrade procedures.
- **Configuration language**: Vault policies use HCL, a domain-specific
  language that developers must learn. Access control requires writing and
  deploying policy files.
- **No native UI for developers**: Vault's UI exists but is designed for
  operators. Developers adding a new API key must understand mount paths,
  engines, and policy bindings.

The design was chosen because:

- **Modern UI**: Developers can browse projects, environments, and secrets
  in a web interface that resembles a `.env` file editor. No learning curve.
- **Environment-based organization**: Secrets are organized as project >
  environment > folder > key-value, which maps directly to our dev/staging/
  production workflow.
- **Built-in secret rotation**: the server supports automatic rotation for
  database credentials and API keys without external tooling.
- **Kubernetes operator**: our own operator provides the `KMSSecret` CRD in one
  API group, `kms.hanzo.ai/v1`. The second group this HIP used to name,
  `secrets.lux.network`, is not installed; `kmssecrets.kms.hanzo.ai` is the only
  one, and universe declares it.
- **Open source with BSL**: Business Source License allows self-hosting
  and modification. We fork, rebrand, and deploy without vendor lock-in.
- **Single binary**: the server is a single Go binary with
  SQL and KV backends --- the same infrastructure we already
  operate for other services.

### Why Not AWS Secrets Manager or GCP Secret Manager

Cloud-managed secret services (AWS Secrets Manager, GCP Secret Manager,
Azure Key Vault) are excellent --- for workloads that will never leave
that cloud. Hanzo's infrastructure has specific constraints:

- **Multi-cloud portability**: Our K8s clusters run on DigitalOcean today.
  We may move to bare metal, Hetzner, or a different cloud provider. Managed
  secret services are inherently cloud-locked: AWS Secrets Manager is only
  accessible from AWS networks without complex VPN/peering configurations.
- **Cost at scale**: AWS Secrets Manager charges $0.40/secret/month plus
  $0.05 per 10,000 API calls. With 200+ secrets across environments and
  services polling every 60 seconds, costs become non-trivial and
  unpredictable.
- **Unified access model**: A self-hosted KMS means every service ---
  whether running in K8s, in CI/CD, or on a developer's laptop --- uses
  the same HTTPS API. No IAM roles, service accounts, or cloud-specific
  SDKs required.
- **Data sovereignty**: Some customers and compliance frameworks require
  that encryption keys and credentials never leave infrastructure we
  control. Self-hosted KMS satisfies this requirement.

### Why the KMSSecret CRD

Kubernetes-native secret sync via Custom Resource Definitions eliminates
the most error-prone step in the secret lifecycle: getting secrets from
the source of truth into the cluster where workloads consume them.

Without the CRD, the workflow is:
1. Operator adds secret to KMS UI
2. Operator runs `kubectl create secret` with the new value
3. Operator restarts the affected deployment
4. Hope that step 2 was not forgotten, typo-free, and applied to the
   correct namespace

With the CRD, the workflow is:
1. Operator adds secret to KMS UI
2. The KMS Operator detects the change within `resyncInterval` seconds
3. The K8s `Secret` is updated automatically
4. Workloads consuming the secret via `envFrom` or `valueFrom` pick up
   the change on next pod restart (or immediately if using mounted volumes)

Steps 2-4 are automated. No human in the loop after step 1.

## Specification

### Secret Organization Model

Secrets in KMS are organized hierarchically:

```
Organization
  └── Project
        └── Environment
              └── Folder
                    └── Key = Value
```

#### Organizations

Top-level organizational boundary. Maps to Hanzo business units:

| Organization | Purpose |
|-------------|---------|
| `hanzo` | Hanzo AI core services |
| `lux` | Lux blockchain infrastructure |
| `zoo` | Zoo Labs Foundation services |
| `pars` | Pars network services |

#### Projects and paths

**HIP-0136 is normative here.** A secret is addressed by four coordinates and
nothing else — `<org>/<app>/<NAME>@<env>` — where `app` is the app that READS the
secret and `NAME` is exactly the environment variable the value becomes.

Earlier revisions of this HIP specified a project per deployable service
(`hanzo-iam`, `gateway`, `chat`, `cloud`, `console`, …) so that "a compromised
service identity can only read its own secrets". That is not what shipped: every
`kmsSecrets` declaration in the fleet takes the org's project and distinguishes
the service by path alone. The one exception is `base`, which holds its own
project with its own machine identity, and which HIP-0136 explicitly protects
from being folded in — it carries the IAM signing keys, and moving them into the
shared project would let every app in the namespace read them.

**The isolation goal is not superseded; it is unmet.** One project per org means
one machine identity per namespace, so `secretsPath` organizes and does not
authorize. Closing that gap means one machine identity per app — a change to
identity topology, and its own proposal. See §Security.

#### Environments

Standard environment slugs. Every project MUST have these:

| Slug | Purpose |
|------|---------|
| `prod` | live services; the chart default and the only environment on this plane |

`default` is not an environment. It is a leaked upstream spelling, and it is what
made a present secret read as absent for eighteen hours: a query at the right
path and the wrong env returns `total: 0`, which is indistinguishable from a
secret that never existed (HIP-0136 §Motivation).

#### Folders

Optional sub-grouping within environments. Used for organizing large
projects. Example: `/database/`, `/api-keys/`, `/oauth/`.

### Authenticating, and reading a secret

A service authenticates as itself with the machine identity IAM already issued it
— `client_credentials`, `client_secret_basic`, and RFC 8707 `resource` naming the
KMS it is calling (HIP-0111). There is no second credential type and no auth
stack of KMS's own; IAM is the sole authority for identity and tokens.

#### Step 1: get an access token

```
POST https://hanzo.id/v1/iam/oauth/token
Authorization: Basic base64(clientId:clientSecret)
grant_type=client_credentials&resource=hanzo-kms
```

#### Step 2: read the secret

```
GET https://api.hanzo.ai/v1/kms/secrets?path=/gateway&env=prod&name=IAM_CLIENT_SECRET
Authorization: Bearer <access token>
```

The three query parameters are the address: `path` names the app that reads the
secret, `name` is exactly the environment variable it becomes, `env` is `prod`.
They resolve to `/orgs/<org>/<path>/<NAME>`, and the org comes from the validated
token, never from the request — a caller that could name its own org could read
another tenant's store.

**A read that returns nothing is not evidence of absence.** A path-filtered list
returning `total: 0` and a genuinely empty store are the same response, and
treating them as the same is how a migration deletes a live credential. Absence
is established only by enumerating the store the chart actually reads (HIP-0136
§Migration).

#### Step 3: use it

The value is injected into the service's runtime configuration. In Kubernetes it
does not travel this path at all: the `KMSSecret` controller reads it and writes a
native `Secret` the pod mounts, which is the next section.

### Machine Identity Lifecycle

Each service is represented by a Machine Identity in KMS. The identity
lifecycle follows these steps:

1. **Create Identity**: In the KMS UI, create a Machine Identity with a
   descriptive name (e.g., `iam-service`, `gateway-service`).
2. **Enable Universal Auth**: Attach Universal Auth credentials to the
   identity. KMS generates a `clientId` and `clientSecret`.
3. **Grant Project Access**: Assign the identity to the relevant project
   with the minimum required role (typically `Viewer` for read-only
   secret access).
4. **Bootstrap Credentials**: Store the `clientId` and `clientSecret` in
   the target environment (K8s secret, CI/CD variable, etc.).
5. **Rotate Periodically**: Regenerate the `clientSecret` and update the
   bootstrap credential. The `clientId` remains stable.

### KMSSecret Custom Resource Definition

The `KMSSecret` CRD is the Kubernetes-native interface for syncing
secrets from KMS into the cluster.

#### API Group and Version

```
apiVersion: secrets.lux.network/v1alpha1
kind: KMSSecret
```

#### Full Specification

```yaml
apiVersion: secrets.lux.network/v1alpha1
kind: KMSSecret
metadata:
  name: <service>-kms-sync
  namespace: hanzo
  labels:
    app.kubernetes.io/name: <service>
    app.kubernetes.io/component: secrets
    app.kubernetes.io/part-of: hanzo-universe
spec:
  # KMS API endpoint
  hostAPI: https://kms.hanzo.ai

  # How often (in seconds) to re-sync secrets from KMS
  # Lower values = faster propagation, higher API load
  # Recommended: 60 for production, 30 for staging
  resyncInterval: 60

  # Authentication configuration
  authentication:
    universalAuth:
      credentialsRef:
        # K8s Secret containing clientId and clientSecret
        secretName: <service>-kms-auth
        secretNamespace: hanzo
      secretsScope:
        # KMS project slug
        projectSlug: <project-slug>
        # KMS environment slug
        envSlug: production
        # Path within the environment
        secretsPath: /

  # Target K8s Secret to create/update
  managedSecretReference:
    secretName: <service>-secrets
    secretNamespace: hanzo
    secretType: Opaque
```

#### Bootstrap Secret

Every `KMSSecret` resource references a bootstrap secret containing
the Machine Identity credentials. This is the ONE secret that must be
created manually:

```bash
kubectl create secret generic <service>-kms-auth \
  --from-literal=clientId=<machine-identity-client-id> \
  --from-literal=clientSecret=<machine-identity-client-secret> \
  --dry-run=client -o yaml | kubectl apply -f -
```

This is an intentional design constraint. The bootstrap secret is a
"root of trust" --- it cannot be managed by the system it bootstraps.

### CI/CD integration

CI is Hanzo Git Actions executed by `act_runner`, and the pipeline is one reusable
workflow in `hanzoai/ci` (HIP-0036). A repository does not write its own KMS
fetch: the reusable workflow does it, once, using the build's machine identity,
and the secret is addressed at `hanzo/deploy/<NAME>@prod`.

The only durable value a repository stores is that machine identity, and it is
set **on the forge**, since `.hanzo/workflows/` is what the forge reads.

Two things a build must not be given, because it does not need them: a cloud
provider token or kubeconfig (it does not deploy — HIP-0036 §Deployment), and any
upstream vendor credential a *service* needs at runtime (that is egress's
custody — HIP-0143).

### Secret Rotation Policy

| Secret Type | Rotation Frequency | Method |
|------------|-------------------|--------|
| Database passwords | 90 days | KMS auto-rotation |
| API keys (third-party) | 90 days | Manual + KMS update |
| OAuth client secrets | 180 days | Coordinated with IAM |
| Encryption keys | 365 days | Key versioning |
| Machine Identity secrets | 180 days | KMS regenerate |
| JWT signing keys | 90 days | Rolling deployment |

### Audit Logging

KMS logs every secret access with:

- **Who**: Machine Identity ID or user email
- **What**: Secret key name (never the value)
- **When**: ISO 8601 timestamp
- **Where**: Source IP address
- **Action**: `read`, `create`, `update`, `delete`
- **Project**: Project slug and environment

Audit logs are retained for 365 days and are queryable via the KMS API:

```
GET /v1/kms/audit?path=<path>&from=2026-01-01&to=2026-01-31
Authorization: Bearer <admin-token>
```

## Implementation

### Production Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Kubernetes cluster                    │
│                                                         │
│  ┌───────────┐     ┌────────────────┐                   │
│  │ KMS (x2)  │────▶│ SQL            │                   │
│  │ port 8080 │     │ (kms database) │                   │
│  └─────┬─────┘     └────────────────┘                   │
│        │                                                │
│        │           ┌────────────────┐                   │
│        └──────────▶│ KV             │                   │
│                    │ (session/cache)│                   │
│                    └────────────────┘                   │
│                                                         │
│  ┌──────────────────┐                                   │
│  │ KMS Operator      │    watches KMSSecret CRDs        │
│  │ (kms-operator)    │───▶ syncs to K8s Secrets         │
│  └──────────────────┘                                   │
│                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │   IAM    │ │ Gateway  │ │   Chat   │ │  Cloud   │   │
│  │ (reads)  │ │ (reads)  │ │ (reads)  │ │ (reads)  │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
└─────────────────────────────────────────────────────────┘
          ▲
          │ HTTPS (port 443 via Ingress)
          │
    ┌─────┴──────┐
    │ CI/CD      │  GitHub Actions, developer laptops
    │ (reads)    │
    └────────────┘
```

### Deployment Specification

KMS runs as a Deployment with 2 replicas for high availability:

```yaml
spec:
  replicas: 2
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
```

Pod anti-affinity ensures replicas land on different nodes:

```yaml
affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
    - weight: 100
      podAffinityTerm:
        labelSelector:
          matchExpressions:
          - key: app
            operator: In
            values: ["kms"]
        topologyKey: kubernetes.io/hostname
```

### Helm Chart: kms-standalone

The `kms-standalone` Helm chart supports automated bootstrap:

```yaml
kms:
  autoBootstrap:
    enabled: true
    # Create additional organizations beyond the default
    additionalOrganizations:
      - hanzo
      - lux
      - zoo
      - pars
    # Grant org-admin to these emails during org creation
    additionalOrganizationAdminEmails:
      - z@hanzo.ai
    # Secret template key for bootstrap token
    additionalOrganizationsTokenSecretKey: token
```

This ensures that on first deployment, all four organizations exist and
the specified admin has access across all of them.

### Resource Requirements

```yaml
resources:
  requests:
    memory: "512Mi"
    cpu: "250m"
  limits:
    memory: "2Gi"
    cpu: "1000m"
```

### Health Checks

```yaml
readinessProbe:
  httpGet:
    path: /healthz
    port: 8080
  initialDelaySeconds: 60
  periodSeconds: 10

livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
  initialDelaySeconds: 120
  periodSeconds: 30
```

### KMS's Own Secrets (Bootstrap Problem)

KMS cannot fetch its own master key from the KMS it is. That circularity is
irreducible — every secret store has one — and it is stated here rather than
hidden.

What is reducible is how much sits inside it. The bootstrap set is the master key
and the identity it authenticates with, held as a K8s `Secret` created once at
cluster provisioning and recorded offline. It is deliberately **not** a database
connection string and a cache URL: those were in the bootstrap set only because
KMS ran on a database of its own, and a store that keeps per-org encrypted files
(HIP-1134) has no such connection to bootstrap. Every value that leaves the
bootstrap set is one fewer secret living outside the system that manages secrets.

`stringData` is not an escape hatch anywhere else. Charts carry references and
never values, and `templates/kmssecret.yaml` has no field that would accept one —
on purpose, and this HIP does not add one.

## Security

### Threat Model

| Threat | Mitigation |
|--------|-----------|
| Compromised service identity | Scoped to single project; revoke identity immediately |
| KMS database breach | All secrets encrypted at rest with ROOT_ENCRYPTION_KEY (AES-256-GCM) |
| Network interception | All communication over HTTPS with TLS 1.3 |
| Insider threat | Audit logs capture all access; role-based access control |
| KMS service compromise | Two replicas on separate nodes; encrypted backups |
| Leaked bearer token | Tokens expire after 7200s; IP allowlisting available |
| Git secret leak | Secrets never exist in git; KMS is sole source of truth |
| CI/CD secret exfiltration | Only KMS_CLIENT_ID and KMS_CLIENT_SECRET in CI; short-lived tokens |

### Zero-Trust Principles

1. **Every service authenticates independently**: No shared credentials
   between services. IAM has its own Machine Identity; Gateway has its
   own. Compromising one does not compromise another.
2. **Minimum privilege**: Machine Identities get `Viewer` role (read-only)
   on their specific project. No service can read another service's secrets.
3. **No implicit trust**: Even services within the same K8s namespace must
   authenticate with KMS. Network proximity grants no privilege.
4. **Short-lived credentials**: Bearer tokens expire. Even if captured from
   a log or network trace, they become useless within hours.

### Encryption

- **At rest**: AES-256-GCM encryption of all secret values in SQL.
  The `ROOT_ENCRYPTION_KEY` is a 256-bit key generated during initial
  setup and stored as a K8s Secret.
- **In transit**: TLS 1.3 for all API communication. The KMS Ingress
  terminates TLS with a certificate from Let's Encrypt (via cert-manager).
- **In memory**: Secret values exist in plaintext only in the KMS
  application process memory during request handling. They are not cached
  in KV or written to temporary files.

### Compliance Mapping

| Framework | Requirement | How KMS Satisfies |
|-----------|------------|-------------------|
| SOC 2 CC6.1 | Logical access security | Machine Identity auth, RBAC |
| SOC 2 CC6.3 | Access revocation | Identity deletion, token expiry |
| SOC 2 CC7.2 | System monitoring | Audit logs, access tracking |
| HIPAA 164.312(a) | Access control | Per-project isolation, RBAC |
| HIPAA 164.312(e) | Transmission security | TLS 1.3 |
| GDPR Art. 32 | Security of processing | AES-256-GCM, audit trail |
| PCI DSS 3.4 | Render PAN unreadable | Encryption at rest |

```yaml
# compose.yml - DO NOT DO THIS
environment:
  DATABASE_URL: "postgresql://user:password@host:5432/db"
  API_KEY: "sk-live-abc123"
```

After (KMS-backed):
```yaml
# compose.yml
environment:
  KMS_CLIENT_ID: "${KMS_CLIENT_ID}"
  KMS_CLIENT_SECRET: "${KMS_CLIENT_SECRET}"
# Service fetches all other secrets from KMS at startup
```

### From GitHub Actions Secrets

Before (many secrets):
```yaml
env:
  DOCKERHUB_USERNAME: ${{ secrets.DOCKERHUB_USERNAME }}
  DOCKERHUB_TOKEN: ${{ secrets.DOCKERHUB_TOKEN }}
  DO_ACCESS_TOKEN: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}
  DATABASE_URL: ${{ secrets.DATABASE_URL }}
  REDIS_URL: ${{ secrets.REDIS_URL }}
```

After (two secrets):
```yaml
env:
  KMS_CLIENT_ID: ${{ secrets.KMS_CLIENT_ID }}
  KMS_CLIENT_SECRET: ${{ secrets.KMS_CLIENT_SECRET }}
# Fetch everything else from KMS at runtime
```

### From kubectl create secret

Before (manual, error-prone):
```bash
kubectl create secret generic my-service-secrets \
  --from-literal=DB_URL=postgresql://... \
  --from-literal=API_KEY=sk-... \
  --from-literal=REDIS_URL=redis://...
```

After (automated):
```yaml
# Apply once:
apiVersion: secrets.lux.network/v1alpha1
kind: KMSSecret
metadata:
  name: my-service-kms-sync
  namespace: hanzo
spec:
  hostAPI: https://kms.hanzo.ai
  resyncInterval: 60
  authentication:
    universalAuth:
      credentialsRef:
        secretName: my-service-kms-auth
        secretNamespace: hanzo
      secretsScope:
        projectSlug: my-service
        envSlug: production
        secretsPath: /
  managedSecretReference:
    secretName: my-service-secrets
    secretNamespace: hanzo
    secretType: Opaque
# Secrets auto-sync every 60 seconds. No manual steps.
```

## Operational Procedures

### Adding a New Service to KMS

1. Create a project in KMS UI (`kms.hanzo.ai`) with slug matching the
   service name.
2. Add environments: `dev`, `staging`, `production`.
3. Add all secret key-value pairs to each environment.
4. Create a Machine Identity named `<service>-service`.
5. Enable Universal Auth on the identity.
6. Grant the identity `Viewer` role on the project.
7. Create the bootstrap K8s secret:
   ```bash
   kubectl create secret generic <service>-kms-auth \
     --from-literal=clientId=<id> \
     --from-literal=clientSecret=<secret> \
     --dry-run=client -o yaml | kubectl apply -f -
   ```
8. Apply the `KMSSecret` resource (see specification above).
9. Verify sync: `kubectl get secret <service>-secrets -o yaml`

### Rotating a Machine Identity Secret

1. In KMS UI, navigate to the Machine Identity.
2. Regenerate the client secret (old secret remains valid for a grace
   period).
3. Update the bootstrap K8s secret:
   ```bash
   kubectl create secret generic <service>-kms-auth \
     --from-literal=clientId=<id> \
     --from-literal=clientSecret=<new-secret> \
     --dry-run=client -o yaml | kubectl apply -f -
   ```
4. The KMS Operator will use the new credentials on next resync cycle.
5. Verify by checking operator logs for successful sync.

### Emergency Secret Revocation

If a secret is suspected compromised:

1. **Rotate the secret value** in KMS UI immediately.
2. **Revoke the Machine Identity** if the identity credentials were
   compromised (not just the secret value).
3. **Force resync** by deleting and re-creating the `KMSSecret` resource.
4. **Restart affected pods** to pick up the new K8s Secret values:
   ```bash
   kubectl rollout restart deployment/<service>
   ```
5. **Review audit logs** to determine the scope of the breach.

## References

1. `luxfi/kms` -- the primitives all server logic lives in
2. [HIP-5: Post-Quantum Security for AI Infrastructure](./hip-0005-post-quantum-security-for-ai-infrastructure.md)
3. [HIP-4: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md)
4. [NIST SP 800-57: Key Management](https://csrc.nist.gov/publications/detail/sp/800-57-part-1/rev-5/final)
5. [Kubernetes Secrets Best Practices](https://kubernetes.io/docs/concepts/configuration/secret/)
6. [SOC 2 Trust Services Criteria](https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2)

## Conformance status

Measured on 2026-09-09.

**Ships.** `kmssecrets.kms.hanzo.ai/v1` is installed and reconciled, with 174
`KMSSecret` resources live across the estate — `hanzo-build`, `collab`, `enso`,
`extract-svc` and others. A representative resource carries exactly the fields
§KMSSecret specifies (`projectSlug`, `envSlug`, `secretsPath`, `keys`, `rename`,
`managedSecretName`, `creationPolicy`) plus `transport: iam`, so the operator
reaches KMS with an IAM identity rather than a bespoke token — which is the
authentication §Authenticating specifies, already in production.
`kms.hanzo.ai/v1/health` returns `200` with a build revision.

**Corrected in this revision.** §Authentication and §Secret Retrieval documented
`POST /api/v1/auth/universal-auth/login` and `GET /api/v3/secrets/raw`, which both
return `404` and carry an `/api/` prefix no Hanzo surface uses. They described the
third-party product this standard was originally derived from rather than the
server that answers. They are replaced by the IAM `client_credentials` flow and
`api.hanzo.ai/v1/kms`.

**Still open, and the reason this HIP is not Final.** Two deployments of one
service hold the data between them — `api.hanzo.ai/v1/kms` and the standalone at
`kms.hanzo.ai`, which every chart's `kmsSecrets` still reaches through the
CRD's `hostAPI`. That is one program deployed twice with its data split, not two
architectures, and it must never be written up as one. A name present in one and
absent from the other returns `total: 0` from the wrong door, which is
indistinguishable from a secret that never existed. HIP-0136 §Migration carries
the collapse sequence; until it lands, "which KMS" is a question a reader can
still be forced to ask, and that is exactly the question this standard exists to
delete.

**The isolation goal remains unmet.** One project per org means one machine
identity per namespace, so any app in a namespace can read any path in that
project. `secretsPath` organizes; it does not authorize. Closing it means one
machine identity per app, which is a change of identity topology and belongs in
its own proposal.

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).