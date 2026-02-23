---
hip: 0027
title: Secrets Management Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2025-01-15
---

# HIP-27: Secrets Management Standard

## Abstract

This proposal defines the secrets management standard for the Hanzo ecosystem,
centered on Hanzo KMS at **kms.hanzo.ai**. Hanzo KMS is a self-hosted fork of
Infisical that provides centralized, auditable, Kubernetes-native secrets
management for all Hanzo services. It replaces scattered environment variables,
CI/CD secrets, and manual `kubectl create secret` operations with a single
source of truth.

Every secret in the Hanzo ecosystem --- API keys, database credentials, OAuth
client secrets, encryption keys --- flows through KMS. Services authenticate
via Universal Auth (machine identity with client ID/secret), receive a
short-lived bearer token, and fetch secrets at runtime. In Kubernetes, the
`KMSSecret` custom resource automates syncing secrets from KMS into native
`Secret` objects, eliminating human involvement in the secret lifecycle.

**Repository**: [github.com/hanzoai/kms](https://github.com/hanzoai/kms)
**Production**: https://kms.hanzo.ai
**Docker**: `ghcr.io/hanzoai/kms:latest`
**Cluster**: hanzo-k8s (`24.199.76.156`)

## Motivation

Before KMS, Hanzo secrets were managed through a patchwork of mechanisms:

1. **Hardcoded in compose files**: `compose.yml` files contained plaintext
   credentials. Anyone with repository access could read database passwords.
2. **GitHub Actions secrets**: CI/CD credentials lived in GitHub's secret
   store, invisible to audit and impossible to rotate without manual updates
   to every workflow.
3. **Manual kubectl**: Operators ran `kubectl create secret` by hand,
   introducing drift between what was deployed and what was documented.
4. **Duplicated across services**: The same PostgreSQL password appeared in
   IAM, Cloud, Console, and Platform deployments --- each copy managed
   independently.
5. **No audit trail**: When a secret was accessed, changed, or leaked, there
   was no way to know who did what, when.

These problems compound at scale. With 15+ services on hanzo-k8s and growing,
manual secrets management became the single largest operational risk.

## Design Philosophy

### Why Infisical Over HashiCorp Vault

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

Infisical was chosen because:

- **Modern UI**: Developers can browse projects, environments, and secrets
  in a web interface that resembles a `.env` file editor. No learning curve.
- **Environment-based organization**: Secrets are organized as project >
  environment > folder > key-value, which maps directly to our dev/staging/
  production workflow.
- **Built-in secret rotation**: Infisical supports automatic rotation for
  database credentials and API keys without external tooling.
- **Kubernetes operator**: The Infisical Secrets Operator provides the
  `InfisicalSecret` CRD (which we rebrand as `KMSSecret` under the
  `secrets.lux.network` API group) for native K8s integration.
- **Open source with BSL**: Business Source License allows self-hosting
  and modification. We fork, rebrand, and deploy without vendor lock-in.
- **Single binary**: Infisical runs as a single Node.js application with
  PostgreSQL and Redis backends --- the same infrastructure we already
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

### Why Universal Auth Over mTLS

Machine-to-machine authentication for secret access could use mutual TLS
(mTLS), where each service presents a client certificate. We chose Universal
Auth (client ID + client secret -> bearer token) for pragmatic reasons:

- **CI/CD simplicity**: GitHub Actions can `POST` to the login endpoint,
  receive a bearer token, and fetch secrets --- three HTTP calls, zero
  certificate management. With mTLS, every CI runner would need a client
  certificate provisioned, rotated, and securely stored.
- **No certificate infrastructure**: mTLS requires a Certificate Authority,
  certificate issuance, revocation lists (CRL/OCSP), and rotation
  automation. This is a substantial system to build and operate. Universal
  Auth requires only storing a client ID and client secret.
- **Short-lived tokens**: Universal Auth tokens expire (default: 7200
  seconds). If a token leaks, the blast radius is limited. With mTLS,
  a leaked client certificate is valid until revoked --- and revocation
  is notoriously unreliable.
- **Debuggability**: Bearer tokens appear in HTTP headers and are easy to
  trace in logs (redacted). mTLS authentication happens at the TLS layer,
  invisible to application-level logging and debugging.

The trade-off: Universal Auth credentials (clientId/clientSecret) must be
bootstrapped into each service somehow. In K8s, we store them as a
`Secret` that is created once and referenced by `KMSSecret` resources.
This is the one secret that is not managed by KMS itself --- a
necessary bootstrap dependency.

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

#### Projects

Each deployable service gets its own project. This provides:
- **Isolation**: A compromised service identity can only read its own secrets.
- **Audit granularity**: Access logs are per-project.
- **Team ownership**: Different teams manage different projects.

Current projects in production:

| Project Slug | Service | Secret Count |
|-------------|---------|-------------|
| `hanzo-iam` | IAM (hanzo.id) | 23 |
| `gateway` | LLM Gateway (llm.hanzo.ai) | 12 |
| `chat` | Hanzo Chat | 8 |
| `cloud` | Hanzo Cloud | 15 |
| `console` | Console (console.hanzo.ai) | 10 |
| `commerce` | Commerce API | 8 |
| `platform` | PaaS Platform | 14 |
| `bootnode` | Bootnode API | 6 |
| `flow` | Workflow Engine | 9 |
| `zen` | Zen Model Serving | 7 |

#### Environments

Standard environment slugs. Every project MUST have these:

| Slug | Purpose | Access Level |
|------|---------|-------------|
| `dev` | Local development | All developers |
| `staging` | Pre-production testing | Dev team + CI |
| `prod` / `production` | Live services | CI + service identities only |

#### Folders

Optional sub-grouping within environments. Used for organizing large
projects. Example: `/database/`, `/api-keys/`, `/oauth/`.

### Universal Auth Flow

Universal Auth is the sole machine-to-machine authentication method.
Every service that needs secrets authenticates through this flow.

#### Step 1: Login

```
POST https://kms.hanzo.ai/api/v1/auth/universal-auth/login
Content-Type: application/json

{
  "clientId": "31052e02-d1d6-4846-8c8f-3fb1efe90e3b",
  "clientSecret": "st.abc123..."
}
```

Response:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": 7200,
  "accessTokenMaxTTL": 7200,
  "tokenType": "Bearer"
}
```

#### Step 2: Fetch Secrets

```
GET https://kms.hanzo.ai/api/v3/secrets/raw?environment=prod&workspaceSlug=hanzo-iam&secretPath=/
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

Response:

```json
{
  "secrets": [
    {
      "secretKey": "DATABASE_URL",
      "secretValue": "postgresql://...",
      "type": "shared",
      "version": 3
    },
    {
      "secretKey": "REDIS_URL",
      "secretValue": "redis://...",
      "type": "shared",
      "version": 1
    }
  ]
}
```

#### Step 3: Use Secrets

The service injects fetched values into its runtime configuration.
Secrets MUST NOT be written to disk, logged, or cached beyond the
current process lifetime.

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
kubectl -n hanzo create secret generic <service>-kms-auth \
  --from-literal=clientId=<machine-identity-client-id> \
  --from-literal=clientSecret=<machine-identity-client-secret> \
  --dry-run=client -o yaml | kubectl apply -f -
```

This is an intentional design constraint. The bootstrap secret is a
"root of trust" --- it cannot be managed by the system it bootstraps.

### CI/CD Integration

#### GitHub Actions Pattern

Services that deploy via GitHub Actions fetch secrets at workflow runtime
instead of storing them as GitHub Actions secrets.

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Authenticate with KMS
        id: kms-auth
        run: |
          TOKEN=$(curl -s -X POST \
            https://kms.hanzo.ai/api/v1/auth/universal-auth/login \
            -H "Content-Type: application/json" \
            -d "{\"clientId\":\"${{ secrets.KMS_CLIENT_ID }}\",\"clientSecret\":\"${{ secrets.KMS_CLIENT_SECRET }}\"}" \
            | jq -r '.accessToken')
          echo "::add-mask::$TOKEN"
          echo "token=$TOKEN" >> $GITHUB_OUTPUT

      - name: Fetch deployment secrets
        run: |
          SECRETS=$(curl -s \
            "https://kms.hanzo.ai/api/v3/secrets/raw?environment=prod&workspaceSlug=my-service&secretPath=/" \
            -H "Authorization: Bearer ${{ steps.kms-auth.outputs.token }}")

          # Extract individual secrets
          echo "DOCKERHUB_USERNAME=$(echo $SECRETS | jq -r '.secrets[] | select(.secretKey=="DOCKERHUB_USERNAME") | .secretValue')" >> $GITHUB_ENV
          echo "::add-mask::$(echo $SECRETS | jq -r '.secrets[] | select(.secretKey=="DOCKERHUB_TOKEN") | .secretValue')"
          echo "DOCKERHUB_TOKEN=$(echo $SECRETS | jq -r '.secrets[] | select(.secretKey=="DOCKERHUB_TOKEN") | .secretValue')" >> $GITHUB_ENV
```

Note: `KMS_CLIENT_ID` and `KMS_CLIENT_SECRET` are the only two values
stored as GitHub Actions secrets. All other credentials are fetched from
KMS at runtime. This reduces the GitHub secret surface from dozens of
secrets per repository to exactly two.

#### SDK Integration

For services that fetch secrets programmatically at startup:

```go
// Go - using luxfi/kms-go SDK
import "github.com/luxfi/kms-go/sdk"

client := sdk.NewClient(sdk.Config{
    SiteURL:      "https://kms.hanzo.ai",
    ClientID:     os.Getenv("KMS_CLIENT_ID"),
    ClientSecret: os.Getenv("KMS_CLIENT_SECRET"),
})

secrets, err := client.ListSecrets(sdk.ListSecretsOptions{
    ProjectSlug: "hanzo-iam",
    Environment: "prod",
    SecretPath:  "/",
})
if err != nil {
    log.Fatalf("failed to fetch secrets from KMS: %v", err)
}

for _, s := range secrets {
    os.Setenv(s.SecretKey, s.SecretValue)
}
```

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
GET /api/v1/audit-logs?projectId=<id>&startDate=2025-01-01&endDate=2025-01-31
Authorization: Bearer <admin-token>
```

## Implementation

### Production Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   hanzo-k8s cluster                     │
│                                                         │
│  ┌───────────┐     ┌────────────────┐                   │
│  │ KMS (x2)  │────▶│ PostgreSQL     │                   │
│  │ port 8080 │     │ (kms database) │                   │
│  └─────┬─────┘     └────────────────┘                   │
│        │                                                │
│        │           ┌────────────────┐                   │
│        └──────────▶│ Redis          │                   │
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
    path: /api/status
    port: 8080
  initialDelaySeconds: 60
  periodSeconds: 10

livenessProbe:
  httpGet:
    path: /api/status
    port: 8080
  initialDelaySeconds: 120
  periodSeconds: 30
```

### KMS's Own Secrets (Bootstrap Problem)

KMS itself requires secrets to operate: `ROOT_ENCRYPTION_KEY`,
`AUTH_SECRET`, `DB_CONNECTION_URI`, `REDIS_URL`. These cannot be
stored in KMS (circular dependency). They are stored as a standard
K8s `Secret` named `kms-secrets`, created once during initial cluster
provisioning and documented in a secure offline location.

This is the irreducible bootstrap dependency. Every secrets management
system has one. We acknowledge it explicitly rather than hiding it.

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

- **At rest**: AES-256-GCM encryption of all secret values in PostgreSQL.
  The `ROOT_ENCRYPTION_KEY` is a 256-bit key generated during initial
  setup and stored as a K8s Secret.
- **In transit**: TLS 1.3 for all API communication. The KMS Ingress
  terminates TLS with a certificate from Let's Encrypt (via cert-manager).
- **In memory**: Secret values exist in plaintext only in the KMS
  application process memory during request handling. They are not cached
  in Redis or written to temporary files.

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

## Migration Guide

### From Environment Variables in Git

Before (insecure):
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
kubectl -n hanzo create secret generic my-service-secrets \
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
   kubectl -n hanzo create secret generic <service>-kms-auth \
     --from-literal=clientId=<id> \
     --from-literal=clientSecret=<secret> \
     --dry-run=client -o yaml | kubectl apply -f -
   ```
8. Apply the `KMSSecret` resource (see specification above).
9. Verify sync: `kubectl -n hanzo get secret <service>-secrets -o yaml`

### Rotating a Machine Identity Secret

1. In KMS UI, navigate to the Machine Identity.
2. Regenerate the client secret (old secret remains valid for a grace
   period).
3. Update the bootstrap K8s secret:
   ```bash
   kubectl -n hanzo create secret generic <service>-kms-auth \
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
   kubectl -n hanzo rollout restart deployment/<service>
   ```
5. **Review audit logs** to determine the scope of the breach.

## References

1. [Infisical Documentation](https://infisical.com/docs/documentation/getting-started/introduction)
2. [HIP-5: Post-Quantum Security for AI Infrastructure](./hip-0005-post-quantum-security-for-ai-infrastructure.md)
3. [HIP-4: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md)
4. [NIST SP 800-57: Key Management](https://csrc.nist.gov/publications/detail/sp/800-57-part-1/rev-5/final)
5. [Kubernetes Secrets Best Practices](https://kubernetes.io/docs/concepts/configuration/secret/)
6. [SOC 2 Trust Services Criteria](https://www.aicpa.org/interestareas/frc/assuranceadvisoryservices/sorhome)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
