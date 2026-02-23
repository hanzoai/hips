---
hip: 0054
title: Zero Trust Architecture Standard
author: Hanzo AI Team
type: Standards Track
category: Security
status: Draft
created: 2026-02-23
requires: HIP-0026, HIP-0027
---

# HIP-54: Zero Trust Architecture Standard

## Abstract

This proposal defines the Zero Trust networking architecture for the Hanzo ecosystem. The core principle is simple: **never trust, always verify**. Every request between services, from agents, or by human operators is authenticated, authorized, and encrypted --- regardless of network location.

Hanzo ZT replaces traditional perimeter security (firewalls, VPNs, trusted internal networks) with identity-based access control at every layer. Service-to-service communication uses mutual TLS (mTLS) with SPIFFE-issued identities. Agent-to-service calls use short-lived JWT tokens issued by IAM (HIP-0026). Human operators access infrastructure through a BeyondCorp-style proxy, not a VPN. Cross-cluster traffic flows over WireGuard tunnels. Network policies at the Kubernetes pod level enforce microsegmentation, ensuring each service can reach only its declared dependencies.

The policy engine runs on port 8054 and evaluates every access decision against a declarative policy set. All decisions --- allow and deny --- are logged to an immutable audit trail.

**Repository**: [github.com/hanzoai/zt](https://github.com/hanzoai/zt)
**Port**: 8054 (policy engine)
**Docker**: `ghcr.io/hanzoai/zt:latest`

## Motivation

### Why AI Infrastructure Is a High-Value Target

AI workloads are fundamentally different from traditional web applications. The assets they process --- trained model weights, fine-tuning datasets, inference prompts, generated outputs --- have extraordinary value:

1. **Model weights are intellectual property**: A single frontier model represents millions of dollars in compute and research. If an attacker exfiltrates weights from a GPU node, they have stolen the core asset of the business. Traditional web applications store data in databases behind well-understood access patterns; model weights live on GPU memory, shared filesystems, and object stores with less mature access controls.

2. **Prompts contain sensitive data**: Users send proprietary business data, personal information, and confidential documents to LLM APIs. A compromised inference service leaks not just one user's data but every user's data flowing through it.

3. **GPU clusters are expensive lateral movement targets**: A compromised service in a GPU cluster can hijack compute for cryptocurrency mining or unauthorized training. GPU time at scale costs $2-10/hour per card; a 64-GPU cluster breach costs $3,000-15,000/day in stolen compute.

4. **Long-lived model artifacts**: Unlike web request/response cycles, model artifacts persist for months or years. A breach that exposes model weights has unlimited replay value --- the attacker can use the stolen model indefinitely. This makes "harvest now, decrypt later" attacks especially dangerous for AI infrastructure.

### Why Not Traditional Perimeter Security

Perimeter security assumes the network has an inside and an outside. Everything inside the firewall is trusted; everything outside is not. This model fails for modern infrastructure:

- **Cloud networks have no perimeter**: Hanzo runs on DigitalOcean Kubernetes, where the "internal network" is a shared VPC with other tenants. The hypervisor boundary is the only true isolation, and it is controlled by the cloud provider, not us.
- **Containers are ephemeral**: Pod IPs change on every restart. Firewall rules based on IP addresses become stale within minutes. In a Kubernetes cluster with 50+ services restarting daily, IP-based rules are unmaintainable.
- **Lateral movement is the primary threat**: Most breaches start with a single compromised service (a dependency vulnerability, a leaked credential, a misconfigured endpoint). Once inside the perimeter, the attacker moves laterally to higher-value targets. If the internal network is flat and trusted, one compromised pod can reach every other pod.
- **Multi-cluster reality**: Hanzo operates two Kubernetes clusters (hanzo-k8s and lux-k8s) plus CI/CD runners, developer machines, and edge deployments. There is no single perimeter to defend.

Zero Trust eliminates the concept of a trusted internal network. Every connection is verified. A compromised pod in the `hanzo` namespace cannot reach the `postgres` service unless its SPIFFE identity has an explicit policy granting that access.

## Design Philosophy

### Why Identity-Based Over IP-Based

Traditional network security uses IP addresses and port numbers to define access rules: "allow 10.0.1.0/24 to reach 10.0.2.5:5432". This is brittle for three reasons:

1. **IP addresses are not identities**: In Kubernetes, a pod's IP is assigned from a CIDR pool and recycled when the pod restarts. The IP that belonged to the `iam` service five minutes ago now belongs to `chat`. IP-based rules cannot distinguish them.

2. **CIDR ranges are coarse**: Allowing a /24 subnet grants access to every pod in that range. You cannot express "only the gateway service can reach postgres" --- you can only express "anything in this IP range can reach this IP".

3. **No cryptographic binding**: An IP address can be spoofed on many network configurations. Even where anti-spoofing is enforced (as in most cloud VPCs), the mapping from IP to workload is maintained by the orchestrator, not cryptographically proven.

SPIFFE (Secure Production Identity Framework for Everyone) solves this by assigning each workload a cryptographic identity --- a SPIFFE ID like `spiffe://hanzo.ai/ns/hanzo/sa/iam` --- backed by an X.509 certificate. The identity is:
- **Cryptographically verifiable**: The certificate is signed by a trusted CA.
- **Workload-specific**: Tied to the Kubernetes service account, namespace, and cluster.
- **Automatically rotated**: SPIRE issues short-lived certificates (default: 1 hour) and rotates them without service restarts.

### Why mTLS for Service-to-Service

Mutual TLS means both sides of a connection present certificates. Standard TLS (what browsers use) only authenticates the server; the client is anonymous at the transport layer. mTLS authenticates both:

- **Server proves identity**: "I am postgres, here is my certificate signed by the Hanzo CA."
- **Client proves identity**: "I am iam, here is my certificate signed by the Hanzo CA."

This means the postgres service can enforce "only accept connections from iam, gateway, and cloud" at the TLS handshake, before any application code runs. A compromised `chat` service cannot even establish a TCP connection to postgres --- the handshake fails because chat's SPIFFE ID is not in postgres's authorized set.

The alternative --- application-layer authentication only (e.g., database passwords) --- leaves the transport layer open. An attacker who compromises any pod can sniff traffic between other pods on the same node (if network encryption is not enforced). mTLS encrypts all traffic and authenticates both endpoints, eliminating network-layer eavesdropping entirely.

### Why WireGuard Over IPSec

Cross-cluster traffic between hanzo-k8s and lux-k8s needs encryption. The two industry options are IPSec and WireGuard:

| Factor | WireGuard | IPSec |
|--------|-----------|-------|
| Codebase | ~4,000 lines of code | ~400,000 lines |
| Configuration | Single key pair per peer | IKEv2 negotiation, phase 1/2, SAs, SPDs |
| Performance | In-kernel, ~1 Gbps on small VMs | Comparable throughput, higher CPU overhead |
| Key exchange | Static keys + optional PSK | IKE with complex SA lifecycle |
| Attack surface | Minimal (small, auditable code) | Large (CVE history in IKE daemons) |
| NAT traversal | Built-in (UDP-based) | Requires NAT-T extension |
| Roaming | Automatic (endpoint updates) | Requires re-negotiation |

WireGuard's simplicity is the decisive advantage. IPSec works, but its configuration complexity --- security associations, IKE phases, transform sets, traffic selectors --- is a continuous source of misconfiguration and operational incidents. WireGuard has one knob: a peer's public key and allowed IPs. This is the kind of system where correctness is inspectable.

The tradeoff: WireGuard has a smaller ecosystem of enterprise management tooling. For our two-cluster topology, this is irrelevant --- we manage peer configurations declaratively via Kubernetes.

### Why BeyondCorp Over VPN for Operators

Traditional operator access uses VPNs: connect to the corporate VPN, then SSH/kubectl to production. This model has two problems:

1. **VPN is binary access**: Once connected, the operator has network access to *everything* on the internal network. There is no granularity. A junior engineer debugging a logging issue has the same network reach as a senior SRE performing a database migration.

2. **VPN is a single point of compromise**: If the VPN credentials leak (phishing, malware, credential stuffing), the attacker has full internal network access. Every VPN breach in recent years (Pulse Secure, Fortinet, Cisco AnyConnect) resulted in full network compromise because VPN = perimeter crossing.

BeyondCorp-style access replaces the VPN with an identity-aware proxy. Every request (SSH, kubectl, web console) goes through the proxy, which:
- Authenticates the operator via IAM (HIP-0026) with MFA
- Checks the operator's role and the target resource against policy
- Logs the access decision
- Proxies only the specific connection, not blanket network access

An operator who is authorized to view logs for the `chat` service can do exactly that --- and nothing else. No lateral movement, no broad network access, no VPN tunnel.

## Specification

### Workload Identity: SPIFFE/SPIRE

#### SPIFFE ID Format

Every workload in the Hanzo ecosystem receives a SPIFFE ID following this schema:

```
spiffe://hanzo.ai/<cluster>/<namespace>/<service-account>
```

Examples:

| Service | SPIFFE ID |
|---------|-----------|
| IAM | `spiffe://hanzo.ai/hanzo-k8s/hanzo/iam` |
| LLM Gateway | `spiffe://hanzo.ai/hanzo-k8s/hanzo/gateway` |
| PostgreSQL | `spiffe://hanzo.ai/hanzo-k8s/hanzo/postgres` |
| Lux Validator | `spiffe://hanzo.ai/lux-k8s/lux/validator` |
| CI Runner | `spiffe://hanzo.ai/ci/github-actions/deploy` |

#### SPIRE Server Architecture

```
┌───────────────────────────────────────────────────┐
│                  hanzo-k8s cluster                 │
│                                                   │
│  ┌──────────────┐                                 │
│  │ SPIRE Server │  Root CA for hanzo.ai trust     │
│  │  (x2 HA)     │  domain. Issues intermediate    │
│  └──────┬───────┘  CAs to SPIRE Agents.           │
│         │                                         │
│   ┌─────┼─────────────────────┐                   │
│   │     │                     │                   │
│  ┌▼──────────┐  ┌──────────┐  ┌──────────┐       │
│  │SPIRE Agent│  │SPIRE Agent│  │SPIRE Agent│      │
│  │ (node 1)  │  │ (node 2)  │  │ (node 3)  │     │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘    │
│        │               │               │          │
│   ┌────┴────┐    ┌─────┴────┐   ┌─────┴────┐    │
│   │iam  gw │    │chat cloud│   │postgres  │     │
│   │pods    │    │pods      │   │redis     │     │
│   └────────┘    └──────────┘   └──────────┘     │
└───────────────────────────────────────────────────┘
```

SPIRE Agents run as a DaemonSet (one per node). They attest workloads using the Kubernetes Workload Attestor, which verifies the pod's service account, namespace, and node. Workloads receive X.509 SVIDs (SPIFFE Verifiable Identity Documents) with a default TTL of 1 hour.

#### Certificate Lifecycle

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| SVID TTL | 1 hour | Short-lived limits breach window |
| CA TTL | 24 hours | Intermediate CAs rotate daily |
| Root CA TTL | 1 year | Root rotation is a manual ceremony |
| Key algorithm | ECDSA P-256 | Fast verification, small certificates |
| Rotation trigger | 50% of TTL remaining | Ensures overlap for zero-downtime |

### mTLS Enforcement

All service-to-service communication within the cluster MUST use mTLS. This is enforced at two layers:

1. **Sidecar proxy (Envoy)**: Each pod runs an Envoy sidecar that terminates and originates mTLS connections using SPIRE-issued SVIDs. Application code connects to `localhost`; Envoy handles encryption transparently.

2. **Network policy fallback**: Kubernetes NetworkPolicy objects deny all traffic that does not pass through the mTLS sidecar. This prevents services from bypassing the proxy.

#### Service Authorization Policy

Access between services is governed by a declarative policy file evaluated by the ZT policy engine:

```yaml
# zt-policy.yaml
apiVersion: zt.hanzo.ai/v1
kind: ServiceAccessPolicy
metadata:
  name: hanzo-core-policy
spec:
  rules:
    # IAM can reach PostgreSQL and Redis
    - from:
        spiffe: "spiffe://hanzo.ai/hanzo-k8s/hanzo/iam"
      to:
        - spiffe: "spiffe://hanzo.ai/hanzo-k8s/hanzo/postgres"
          ports: [5432]
        - spiffe: "spiffe://hanzo.ai/hanzo-k8s/hanzo/redis"
          ports: [6379]

    # LLM Gateway can reach IAM (token validation) and models
    - from:
        spiffe: "spiffe://hanzo.ai/hanzo-k8s/hanzo/gateway"
      to:
        - spiffe: "spiffe://hanzo.ai/hanzo-k8s/hanzo/iam"
          ports: [8000]
        - spiffe: "spiffe://hanzo.ai/hanzo-k8s/hanzo/postgres"
          ports: [5432]

    # Chat can reach Gateway only (no direct DB access)
    - from:
        spiffe: "spiffe://hanzo.ai/hanzo-k8s/hanzo/chat"
      to:
        - spiffe: "spiffe://hanzo.ai/hanzo-k8s/hanzo/gateway"
          ports: [4000]

  # Default deny: any connection not explicitly allowed is rejected
  defaultAction: DENY
```

### Microsegmentation via Network Policies

Every service gets a Kubernetes NetworkPolicy that mirrors the ZT policy. This provides defense-in-depth: even if the mTLS sidecar is bypassed (a container escape, a misconfigured pod), the kernel-level network policy blocks unauthorized traffic.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: postgres-ingress
  namespace: hanzo
spec:
  podSelector:
    matchLabels:
      app: postgres
  policyTypes:
    - Ingress
  ingress:
    # Only IAM, Gateway, Cloud, and Console can reach PostgreSQL
    - from:
        - podSelector:
            matchLabels:
              app: iam
        - podSelector:
            matchLabels:
              app: gateway
        - podSelector:
            matchLabels:
              app: cloud
        - podSelector:
            matchLabels:
              app: console
      ports:
        - protocol: TCP
          port: 5432
```

The principle: **each service gets minimal network access**. The `chat` service, which only talks to the LLM Gateway API, has no network path to PostgreSQL, Redis, or MinIO. If chat is compromised, the attacker's lateral movement is confined to the gateway API surface.

### WireGuard Overlay Network

#### Cross-Cluster Mesh

The two production clusters (hanzo-k8s and lux-k8s) connect via a WireGuard mesh. Each cluster runs a WireGuard gateway pod that peers with the other cluster:

```
hanzo-k8s (24.199.76.156)         lux-k8s (24.144.69.101)
┌─────────────────────┐           ┌─────────────────────┐
│  ┌───────────────┐  │  WireGuard│  ┌───────────────┐  │
│  │  wg-gateway   │◄─┼──────────┼──►│  wg-gateway   │  │
│  │  10.10.0.1    │  │  UDP 51820│  │  10.10.0.2    │  │
│  └───────┬───────┘  │           │  └───────┬───────┘  │
│          │          │           │          │          │
│  ┌───────┴───────┐  │           │  ┌───────┴───────┐  │
│  │ Service mesh  │  │           │  │ Lux validators│  │
│  │ (Hanzo svcs)  │  │           │  │ (15 nodes)    │  │
│  └───────────────┘  │           │  └───────────────┘  │
└─────────────────────┘           └─────────────────────┘
```

#### WireGuard Configuration

```ini
# hanzo-k8s wg-gateway
[Interface]
PrivateKey = <from-kms>
Address = 10.10.0.1/24
ListenPort = 51820

[Peer]
# lux-k8s gateway
PublicKey = <lux-k8s-public-key>
AllowedIPs = 10.10.0.2/32, 10.244.0.0/16
Endpoint = 24.144.69.101:51820
PersistentKeepalive = 25
```

WireGuard private keys are stored in KMS (HIP-0027) and injected at pod startup. They never appear in Git, ConfigMaps, or environment variables.

### Agent-to-Service Authentication

AI agents (HIP-0009, HIP-0025) authenticate to Hanzo services using short-lived JWT tokens:

1. **Agent requests token**: The agent authenticates with IAM (HIP-0026) using its machine identity credentials.
2. **IAM issues JWT**: The token contains the agent's identity, scopes, organization, and expiry. Default TTL: 15 minutes.
3. **Agent presents token**: Every API call includes the JWT as a Bearer token.
4. **Service validates JWT**: The receiving service verifies the signature against IAM's JWKS endpoint, checks expiry, and evaluates scopes.

```
Agent                    IAM (hanzo.id)              LLM Gateway
  │                          │                           │
  │ POST /api/login/oauth    │                           │
  │ (client_credentials)     │                           │
  ├─────────────────────────►│                           │
  │                          │                           │
  │ { access_token, 900s }   │                           │
  │◄─────────────────────────┤                           │
  │                          │                           │
  │ POST /v1/chat/completions│                           │
  │ Authorization: Bearer <jwt>                          │
  ├──────────────────────────┼──────────────────────────►│
  │                          │                           │
  │                          │  GET /.well-known/jwks    │
  │                          │◄──────────────────────────┤
  │                          │  (cached 1h)              │
  │                          │─────────────────────────►│
  │                          │                           │
  │                          │  JWT valid, scopes OK     │
  │  { response }            │                           │
  │◄─────────────────────────┼───────────────────────────┤
```

Short-lived tokens are critical for agents because:
- Agents are more likely to be compromised than human-operated services (they run autonomously, often with broad tool access)
- A 15-minute token limits the blast radius of a leaked credential
- Token refresh forces periodic re-authentication, allowing IAM to revoke access promptly

### BeyondCorp Access for Operators

Human operators access production infrastructure through the ZT access proxy, not SSH or VPN:

```
Operator                 ZT Proxy (8054)            Target Service
  │                          │                           │
  │ HTTPS (with IAM cookie)  │                           │
  ├─────────────────────────►│                           │
  │                          │                           │
  │  1. Validate IAM session │                           │
  │  2. Check MFA status     │                           │
  │  3. Evaluate role policy │                           │
  │  4. Log access decision  │                           │
  │                          │                           │
  │  [ALLOW: role=sre,       │                           │
  │   target=postgres,       │                           │
  │   action=read-only]      │                           │
  │                          │  mTLS connection           │
  │                          ├──────────────────────────►│
  │  Proxied response        │                           │
  │◄─────────────────────────┤◄──────────────────────────┤
```

Operator access policies use role-based rules:

```yaml
apiVersion: zt.hanzo.ai/v1
kind: OperatorAccessPolicy
metadata:
  name: production-access
spec:
  rules:
    - role: sre
      targets:
        - service: postgres
          actions: [read, write]
        - service: redis
          actions: [read, write]
        - service: "*"
          actions: [logs, metrics]

    - role: developer
      targets:
        - service: gateway
          actions: [logs, metrics]
        - service: chat
          actions: [logs, metrics]

    - role: oncall
      targets:
        - service: "*"
          actions: [read, write, restart]
      conditions:
        - requireMFA: true
        - requireIncident: true  # Must reference an active incident
```

### Certificate Management

The ZT system integrates with KMS (HIP-0027) for all key material:

| Certificate | Issuer | Storage | Rotation |
|-------------|--------|---------|----------|
| SPIRE Root CA | Self-signed | KMS (`zt-root-ca` project) | Annual (manual ceremony) |
| SPIRE Intermediate CAs | Root CA | SPIRE Server memory | Daily (automatic) |
| Workload SVIDs | Intermediate CA | SPIRE Agent memory | Hourly (automatic) |
| WireGuard keys | Generated locally | KMS (`zt-wireguard` project) | 90 days |
| Envoy sidecar certs | SPIRE Agent | In-memory (SDS API) | Hourly (automatic) |
| Operator TLS certs | Let's Encrypt | cert-manager | 60 days |

The SPIRE Root CA private key is the most sensitive asset in the Zero Trust system. It is stored in KMS with the `zt-root-ca` project restricted to a single Machine Identity with no UI access. The key is extracted only during the annual rotation ceremony.

### Audit Trail

Every access decision --- allow and deny --- is logged to the audit trail:

```json
{
  "timestamp": "2026-02-23T14:30:00Z",
  "decision": "ALLOW",
  "source": {
    "spiffe_id": "spiffe://hanzo.ai/hanzo-k8s/hanzo/gateway",
    "pod": "gateway-7f8b9c6d4-x2k9p",
    "node": "worker-3"
  },
  "destination": {
    "spiffe_id": "spiffe://hanzo.ai/hanzo-k8s/hanzo/postgres",
    "port": 5432
  },
  "policy_matched": "hanzo-core-policy/rule-2",
  "latency_us": 42
}
```

Audit logs are written to a dedicated PostgreSQL table with append-only permissions (the ZT service account can `INSERT` but not `UPDATE` or `DELETE`). Logs are retained for 365 days and are queryable via the ZT API for incident response.

## Implementation

### Policy Engine

The ZT policy engine runs as a Kubernetes Deployment on port 8054:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: zt-policy-engine
  namespace: hanzo
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: zt
          image: ghcr.io/hanzoai/zt:latest
          ports:
            - containerPort: 8054
              name: policy
            - containerPort: 8055
              name: health
          env:
            - name: ZT_SPIRE_SOCKET
              value: /run/spire/sockets/agent.sock
            - name: ZT_POLICY_PATH
              value: /etc/zt/policies/
            - name: ZT_AUDIT_DSN
              valueFrom:
                secretKeyRef:
                  name: zt-secrets
                  key: AUDIT_DATABASE_URL
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "500m"
          readinessProbe:
            httpGet:
              path: /healthz
              port: 8055
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8055
            initialDelaySeconds: 15
            periodSeconds: 30
```

Three replicas provide high availability. The policy engine is stateless --- all state lives in the policy files (mounted as a ConfigMap) and the audit database. Any replica can evaluate any request.

### Rollout Strategy

#### Phase 1: Observe (Weeks 1-4)
Deploy the ZT policy engine in **audit-only mode**. All traffic is allowed, but every connection is logged with what the decision *would have been* under the proposed policy. This produces a map of actual service-to-service communication patterns, validating the policy before enforcement.

#### Phase 2: Enforce Non-Critical (Weeks 5-8)
Enable enforcement for non-critical services first: `chat`, `search`, `flow`. These services are stateless and can tolerate brief connectivity disruptions during policy tuning. Monitor for false denials and adjust policies.

#### Phase 3: Enforce Critical (Weeks 9-12)
Enable enforcement for critical path services: `iam`, `gateway`, `postgres`, `redis`. At this point, the policy has been validated by 8 weeks of observation and partial enforcement. Roll out with canary deployments --- enforce on one replica first, monitor, then expand.

#### Phase 4: Full Zero Trust (Week 13+)
Default-deny is active across all namespaces and clusters. New services must submit a policy declaration before deployment. The ZT policy engine rejects connections from services without a declared policy.

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/healthz` | Health check (port 8055) |
| POST | `/v1/evaluate` | Evaluate an access decision |
| GET | `/v1/policies` | List active policies |
| PUT | `/v1/policies/{name}` | Update a policy |
| GET | `/v1/audit` | Query audit log |
| GET | `/v1/graph` | Service dependency graph (from audit data) |
| GET | `/metrics` | Prometheus metrics |

### Prometheus Metrics

```
# Access decisions
zt_decisions_total{decision="allow|deny", source="...", dest="..."}

# Policy evaluation latency
zt_evaluation_duration_seconds{quantile="0.5|0.9|0.99"}

# SVID rotation events
zt_svid_rotations_total{service="..."}

# WireGuard tunnel status
zt_wireguard_peer_up{cluster="hanzo-k8s|lux-k8s"}
```

## Security Considerations

### Threat Model

| Threat | Without Zero Trust | With Zero Trust |
|--------|-------------------|-----------------|
| Compromised pod | Full lateral movement across flat network | Confined to declared dependencies only |
| Leaked service credential | Access to any internal service | Access only to that service's declared scope |
| Network eavesdropping | Plaintext internal traffic visible | All traffic mTLS-encrypted |
| Stolen operator VPN | Full internal network access | No VPN; identity-aware proxy limits access by role |
| Supply chain attack | Malicious dependency reaches all services | NetworkPolicy blocks unauthorized egress |
| Certificate theft | Long-lived certs enable persistent access | 1-hour SVIDs limit window; rotation is automatic |

### Defense in Depth Layers

The Zero Trust architecture provides five independent layers of defense. An attacker must bypass all five to move laterally:

1. **SPIFFE identity**: The workload must have a valid, non-expired SVID from SPIRE
2. **mTLS handshake**: The destination must accept the source's certificate
3. **Policy evaluation**: The ZT policy engine must return ALLOW for the (source, destination, port) tuple
4. **NetworkPolicy**: The Kubernetes CNI must permit the packet at the kernel level
5. **Application auth**: The destination service performs its own authentication (e.g., database password, API key)

### Compliance Mapping

| Framework | Requirement | How ZT Satisfies |
|-----------|------------|-------------------|
| SOC 2 CC6.1 | Logical access controls | SPIFFE identity + policy evaluation |
| SOC 2 CC6.6 | Network security | mTLS + microsegmentation |
| SOC 2 CC7.2 | Monitoring | Audit trail of all access decisions |
| NIST 800-207 | Zero Trust Architecture | Full implementation of NIST ZTA principles |
| PCI DSS 1.3 | Network segmentation | Kubernetes NetworkPolicy + mTLS |
| HIPAA 164.312(e) | Transmission security | mTLS encryption on all links |
| GDPR Art. 32 | Security of processing | Encryption, access control, audit |

### Integration with Post-Quantum Security (HIP-0005)

The SPIFFE certificates and WireGuard keys used in this architecture are classical (ECDSA P-256, Curve25519). As post-quantum migration proceeds per HIP-0005, the key algorithm for SVIDs will transition to hybrid mode (ECDSA + ML-DSA-65). WireGuard will transition to a PQ-safe KEM when kernel support is available. The Zero Trust architecture is algorithm-agnostic --- it cares about identity and policy, not the specific cryptographic primitive.

## References

1. [NIST SP 800-207: Zero Trust Architecture](https://csrc.nist.gov/publications/detail/sp/800-207/final) - The foundational NIST document on Zero Trust
2. [SPIFFE Specification](https://spiffe.io/docs/latest/spiffe-about/overview/) - Secure Production Identity Framework for Everyone
3. [SPIRE Documentation](https://spiffe.io/docs/latest/spire-about/) - SPIFFE Runtime Environment
4. [WireGuard Protocol](https://www.wireguard.com/papers/wireguard.pdf) - Jason Donenfeld's original WireGuard paper
5. [BeyondCorp: A New Approach to Enterprise Security](https://research.google/pubs/pub43231/) - Google's original BeyondCorp paper
6. [HIP-0026: Identity & Access Management Standard](./hip-0026-identity-access-management-standard.md) - IAM for authentication
7. [HIP-0027: Secrets Management Standard](./hip-0027-secrets-management-standard.md) - KMS for key material storage
8. [HIP-0005: Post-Quantum Security](./hip-0005-post-quantum-security-for-ai-infrastructure.md) - PQC migration roadmap
9. [HIP-0009: Agent SDK](./hip-0009-agent-sdk-multi-agent-orchestration-framework.md) - Agent authentication patterns
10. [HIP-0025: Bot Agent Wallet & RPC Billing](./hip-0025-bot-agent-wallet-rpc-billing-protocol.md) - Agent identity and billing
11. [Kubernetes Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/) - Pod-level network segmentation
12. [Hanzo ZT Repository](https://github.com/hanzoai/zt)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
