---
hip: 0048
title: Decentralized Identity (DID) Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-02-23
---

# HIP-48: Decentralized Identity (DID) Standard

## Abstract

This proposal defines the `did:hanzo:` Decentralized Identifier method for the Hanzo ecosystem. It specifies how humans, AI agents, services, and devices obtain self-sovereign identities that are cryptographically verifiable, on-chain anchored, and interoperable with the W3C DID Core specification.

Hanzo DID builds on three existing pillars: Hanzo IAM (HIP-26) as the identity provider and credential issuer, Hanzo KMS (HIP-27) for DID private key custody and lifecycle, and the Hanzo L1 chain (HIP-24) as the verifiable data registry where DID documents are anchored. The result is an identity layer that works for both traditional OAuth login flows and decentralized agent-to-agent authentication --- without requiring users or agents to choose one model over the other.

The DID service exposes a resolver, a registrar, and a Verifiable Credential issuance endpoint. It runs on port 8048 and is published as a standalone service at `did.hanzo.ai`.

**Repository**: [github.com/hanzoai/did](https://github.com/hanzoai/did)
**Port**: 8048
**Docker**: `ghcr.io/hanzoai/did:latest`
**Production**: https://did.hanzo.ai

## Motivation

### The Identity Gap Between Web2 and Web3

Hanzo IAM (HIP-26) provides excellent centralized identity: OAuth 2.0, OIDC, SAML, session management, credit balances. It works perfectly for browser-based login flows where a human clicks "Sign in with Hanzo" and gets redirected.

But the Hanzo ecosystem increasingly operates in contexts where centralized OAuth is insufficient:

1. **Agent-to-agent authentication**: When Agent A calls Agent B's RPC endpoint (HIP-25), there is no browser. There is no redirect URI. There is no human to click "Authorize." The agents need a way to prove their identity to each other without involving IAM as a real-time intermediary. If IAM is down, agent commerce stops --- an unacceptable single point of failure for autonomous systems.

2. **Cross-ecosystem interoperability**: A Hanzo agent interacting with agents on other networks (Ethereum, Solana, Fediverse) cannot present a hanzo.id JWT and expect it to be validated. The remote system has no trust relationship with hanzo.id. DIDs solve this by anchoring identity in a verifiable data registry (the blockchain) that anyone can read and verify without trusting the issuer's uptime.

3. **Credential portability**: A user's reputation, certifications, and attestations should survive the issuer. If Hanzo issues a credential saying "this agent passed safety evaluation HIP-210," that credential should remain verifiable even if Hanzo's servers are temporarily unreachable. Verifiable Credentials (VCs), anchored to DIDs, provide this property.

4. **Regulatory compliance**: The EU's eIDAS 2.0 regulation and the proposed US Digital Identity Act both reference W3C DIDs and Verifiable Credentials as recognized identity frameworks. Building on W3C standards positions Hanzo for regulatory acceptance without future protocol rewrites.

5. **Key sovereignty**: In the current IAM model, Hanzo holds all private keys (JWT signing keys, OAuth client secrets). The user trusts Hanzo not to impersonate them. DIDs invert this: the subject holds their own private key, and the DID document (published on-chain) contains only the public key. Hanzo can issue credentials *about* a subject, but cannot act *as* that subject.

### Why Not Just Extend IAM?

IAM is an authentication system. It answers "who is this user right now?" by checking a session or validating a JWT. DIDs are an identity system. They answer "who is this entity, period?" by resolving a persistent identifier to a document containing public keys and service endpoints.

These are complementary, not competing, concerns. IAM continues to handle login, session management, and credit balances. The DID layer adds persistent, decentralized, cryptographically self-sovereign identity that survives IAM downtime, works across organizational boundaries, and supports the Verifiable Credentials data model.

The integration point is clean: IAM issues Verifiable Credentials (signed attestations) linked to DIDs. The DID resolver verifies those credentials without calling IAM at verification time. This is the same separation of concerns as a passport office (issuer) versus a border agent (verifier) --- the border agent checks the passport's cryptographic seal, not whether the passport office is currently open.

## Design Philosophy

### Why W3C DID Over Proprietary Identity

We could invent a `hanzo://identity/...` scheme that is simpler to implement and optimized for our specific use cases. We deliberately chose not to, for three reasons:

1. **Network effects**: The W3C DID specification is implemented by hundreds of organizations. Any system that can resolve `did:web:` or `did:key:` can, with a single resolver plugin, also resolve `did:hanzo:`. A proprietary scheme starts with zero external tooling.

2. **Specification stability**: The W3C DID Core specification reached Recommendation status in July 2022. It is not moving. Building on a stable foundation means our identity layer does not need to track upstream specification churn.

3. **Credential ecosystem**: Verifiable Credentials (W3C VC Data Model 2.0) are designed to work with DIDs. By using `did:hanzo:`, we gain native compatibility with the entire VC ecosystem: issuance, presentation, selective disclosure, revocation. A proprietary scheme would require reimplementing all of this.

The trade-off is that W3C DID documents are more verbose than a minimal custom format. We accept this cost because the interoperability benefits dominate.

### Why On-Chain Anchoring

DID methods exist that require no blockchain: `did:key` derives the DID from the public key itself; `did:web` publishes the DID document at a web URL. We use on-chain anchoring (Hanzo L1, chain ID 36963) because:

1. **Tamper evidence**: A DID document stored on a web server can be silently modified. A DID document anchored on-chain has a verifiable history of every change, with timestamps and signatures. When Agent A presents a credential signed by key X, a verifier can confirm that key X was listed in the DID document at the time the credential was issued --- not just that it is listed now.

2. **Censorship resistance**: If did.hanzo.ai goes down, `did:web:did.hanzo.ai:...` becomes unresolvable. A `did:hanzo:` identifier anchored on-chain remains resolvable by anyone running a Hanzo L1 node or querying a public RPC endpoint.

3. **Key rotation auditability**: When a DID controller rotates keys (critical for security hygiene), the chain records the rotation. Verifiers can distinguish between "this key was legitimately rotated" and "this key was replaced by an attacker." Web-based methods lack this property without additional infrastructure.

4. **Agent economy**: HIP-25 defines agent wallets and RPC billing on the Hanzo L1. Anchoring agent DIDs on the same chain means identity resolution and payment settlement share infrastructure. The agent's DID document contains its wallet address as a service endpoint, creating a single on-chain entity for both identity and commerce.

The trade-off is transaction cost and latency. Creating or updating a DID document requires an on-chain transaction (gas fee, block confirmation time). We mitigate this with a DID registry smart contract that batches operations and a caching resolver that serves reads from a local index.

### Why DIDs for AI Agents, Not Just Humans

Most DID implementations focus on human identity: passports, diplomas, professional credentials. Hanzo extends DIDs to AI agents because agents are becoming autonomous economic actors (HIP-25) that need the same identity properties as humans:

1. **Accountability**: When an agent generates harmful content or makes an unauthorized transaction, its DID provides an auditable identity trail. The DID document links to the agent's controller (human or organization), creating a chain of responsibility.

2. **Capability attestation**: A Verifiable Credential can attest that an agent has passed safety evaluation (HIP-210), has been trained on specific data, or has been authorized to access certain resources. Other agents and services can verify these credentials before interacting.

3. **Reputation**: In a multi-agent marketplace, agents accumulate reputation through verified interactions. The DID is the persistent anchor for that reputation, surviving agent upgrades, migrations, and even changes in the underlying model.

4. **Consent and delegation**: An agent's DID document specifies its controller. The controller (a human or an organization with their own DID) can delegate specific capabilities to the agent, creating verifiable delegation chains. This is essential for enterprises deploying autonomous agents with bounded authority.

### Why MPC for Threshold Signatures

For high-value DIDs (organizational identities, agents managing significant funds), single-key custody is a single point of failure. If the key is compromised, the identity is compromised. If the key is lost, the identity is lost.

Multi-Party Computation (MPC) threshold signatures address this by splitting the private key into shares distributed across multiple parties. A signature requires cooperation of a threshold (e.g., 2-of-3) of share holders. No single party ever holds the complete private key.

We integrate MPC at the KMS layer (HIP-27) rather than at the DID layer. The DID document contains a standard public key; the fact that the corresponding private key is split across MPC shares is an implementation detail invisible to verifiers. This maintains W3C compatibility while providing operational security.

## Specification

### DID Method: `did:hanzo`

#### Method Syntax

```
did:hanzo:<method-specific-id>
```

The `method-specific-id` follows one of these patterns:

| Pattern | Example | Use Case |
|---------|---------|----------|
| Ethereum address | `did:hanzo:0x1234...abcd` | Agent or user with on-chain wallet |
| Human-readable name | `did:hanzo:dev` | Named agent (resolved via registry) |
| Organization-scoped | `did:hanzo:hanzo:alice` | User within an organization |
| UUID | `did:hanzo:f47ac10b-58cc-4372-a567-0e02b2c3d479` | Ephemeral or programmatic identities |

Human-readable names are resolved through the DID Registry smart contract, which maps names to Ethereum addresses. This is analogous to ENS but scoped to the Hanzo L1.

#### DID Document Structure

Every `did:hanzo:` identifier resolves to a DID Document conforming to W3C DID Core 1.0:

```json
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/security/suites/jws-2020/v1",
    "https://hanzo.ai/ns/did/v1"
  ],
  "id": "did:hanzo:dev",
  "controller": "did:hanzo:hanzo:z",
  "alsoKnownAs": [
    "did:lux:dev",
    "did:ai:dev"
  ],

  "verificationMethod": [
    {
      "id": "did:hanzo:dev#key-1",
      "type": "EcdsaSecp256k1VerificationKey2019",
      "controller": "did:hanzo:dev",
      "blockchainAccountId": "eip155:36963:0xAgentAddress"
    },
    {
      "id": "did:hanzo:dev#key-2",
      "type": "JsonWebKey2020",
      "controller": "did:hanzo:dev",
      "publicKeyJwk": {
        "kty": "OKP",
        "crv": "Ed25519",
        "x": "base64url-encoded-public-key"
      }
    },
    {
      "id": "did:hanzo:dev#key-pq",
      "type": "MLDSAVerificationKey2025",
      "controller": "did:hanzo:dev",
      "publicKeyMultibase": "z6Mk..."
    }
  ],

  "authentication": [
    "did:hanzo:dev#key-1",
    "did:hanzo:dev#key-2"
  ],

  "assertionMethod": [
    "did:hanzo:dev#key-1"
  ],

  "keyAgreement": [
    {
      "id": "did:hanzo:dev#key-agree-1",
      "type": "X25519KeyAgreementKey2020",
      "controller": "did:hanzo:dev",
      "publicKeyMultibase": "z6LS..."
    }
  ],

  "capabilityInvocation": [
    "did:hanzo:dev#key-1"
  ],

  "capabilityDelegation": [
    "did:hanzo:dev#key-1"
  ],

  "service": [
    {
      "id": "did:hanzo:dev#rpc",
      "type": "AgentRPCService",
      "serviceEndpoint": "https://bot.hanzo.ai/rpc/dev"
    },
    {
      "id": "did:hanzo:dev#wallet",
      "type": "SafeWallet",
      "serviceEndpoint": "safe:eip155:36963:0xSafeAddress"
    },
    {
      "id": "did:hanzo:dev#iam",
      "type": "OIDCProvider",
      "serviceEndpoint": "https://hanzo.id"
    },
    {
      "id": "did:hanzo:dev#messaging",
      "type": "DIDCommMessaging",
      "serviceEndpoint": "https://did.hanzo.ai/didcomm/dev",
      "routingKeys": ["did:hanzo:dev#key-agree-1"]
    }
  ]
}
```

#### Verification Relationships Explained

Each verification relationship in the DID document serves a distinct purpose. Understanding these is critical for implementers:

| Relationship | Purpose | Example |
|-------------|---------|---------|
| `authentication` | Prove you are the DID subject | Agent login to another agent's API |
| `assertionMethod` | Sign Verifiable Credentials | Agent attesting it completed a task |
| `keyAgreement` | Establish encrypted channels | Agent-to-agent encrypted messaging |
| `capabilityInvocation` | Invoke capabilities on resources | Agent executing a delegated action |
| `capabilityDelegation` | Delegate capabilities to others | Organization granting agent authority |

A single key MAY appear in multiple relationships. In practice, we recommend separate keys for `authentication` and `keyAgreement` to limit blast radius if one key is compromised.

### DID Registry Smart Contract

The DID Registry is deployed on the Hanzo L1 (chain ID 36963). It stores the minimal on-chain representation of each DID: the document hash, the controller, and a version counter.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IHanzoDIDRegistry {
    event DIDRegistered(
        string indexed did,
        address indexed controller,
        bytes32 documentHash,
        uint256 version
    );

    event DIDUpdated(
        string indexed did,
        address indexed controller,
        bytes32 documentHash,
        uint256 version
    );

    event DIDDeactivated(
        string indexed did,
        address indexed controller,
        uint256 version
    );

    event DIDDelegateChanged(
        string indexed did,
        address indexed delegate,
        bytes32 delegateType,
        uint256 validity
    );

    /// @notice Register a new DID.
    /// @param did The DID string (e.g., "did:hanzo:dev").
    /// @param documentHash IPFS CID or SHA-256 hash of the full DID document.
    function register(string calldata did, bytes32 documentHash) external;

    /// @notice Update an existing DID document.
    ///         Only callable by the current controller.
    /// @param did The DID to update.
    /// @param documentHash New document hash.
    function update(string calldata did, bytes32 documentHash) external;

    /// @notice Deactivate a DID. Irreversible.
    /// @param did The DID to deactivate.
    function deactivate(string calldata did) external;

    /// @notice Add a time-limited delegate for a DID.
    /// @param did The DID granting delegation.
    /// @param delegateType Type of delegation (e.g., "auth", "assertion").
    /// @param delegate Address of the delegate.
    /// @param validity Duration in seconds.
    function addDelegate(
        string calldata did,
        bytes32 delegateType,
        address delegate,
        uint256 validity
    ) external;

    /// @notice Resolve a DID to its current document hash and metadata.
    /// @param did The DID to resolve.
    /// @return controller The current controller address.
    /// @return documentHash The current document hash.
    /// @return version The current version number.
    /// @return active Whether the DID is active.
    function resolve(string calldata did)
        external
        view
        returns (
            address controller,
            bytes32 documentHash,
            uint256 version,
            bool active
        );
}
```

The full DID document is stored off-chain (IPFS or the DID service database) to minimize gas costs. Only the hash is on-chain, providing integrity verification without storing kilobytes of JSON in contract storage.

### DID Lifecycle

#### Create

```
1. Subject generates keypair (locally or via KMS HIP-27)
2. Subject constructs DID Document
3. Subject computes documentHash = SHA-256(DIDDocument)
4. Subject calls DIDRegistry.register(did, documentHash) on Hanzo L1
5. Subject uploads full DID Document to IPFS and/or did.hanzo.ai
6. DID is now resolvable
```

#### Resolve

```
1. Verifier receives a DID (e.g., "did:hanzo:dev")
2. Verifier queries did.hanzo.ai/1.0/identifiers/did:hanzo:dev
   OR queries the DID Registry contract directly
3. Resolver returns DID Document + resolution metadata
4. Verifier extracts the needed verification method
5. Verifier uses the public key to verify signatures/credentials
```

The resolver implements the W3C DID Resolution specification. The response includes resolution metadata (content type, created/updated timestamps, deactivated flag) alongside the DID document.

#### Update

```
1. Controller modifies the DID Document (e.g., rotates a key)
2. Controller computes new documentHash
3. Controller calls DIDRegistry.update(did, newDocumentHash)
4. Controller uploads new DID Document
5. Version counter increments; old versions remain in chain history
```

Only the controller address can update the DID. The controller is set at registration time and can be transferred via `changeController()`.

#### Deactivate

```
1. Controller calls DIDRegistry.deactivate(did)
2. DID is marked as inactive in the registry
3. Resolution returns deactivated=true in metadata
4. Credentials issued by this DID remain verifiable (historical)
   but new credentials MUST NOT be accepted
```

Deactivation is irreversible. This is a deliberate design choice: a "reactivated" DID could confuse verifiers about the validity window of credentials. If a subject needs a new identity after deactivation, they create a new DID.

### Verifiable Credentials

#### Credential Issuance

Hanzo IAM (HIP-26) acts as a credential issuer. When a user or agent authenticates via IAM, IAM can issue Verifiable Credentials attesting to properties of the subject.

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://hanzo.ai/ns/credentials/v1"
  ],
  "type": ["VerifiableCredential", "HanzoAgentCredential"],
  "issuer": "did:hanzo:hanzo-iam",
  "issuanceDate": "2026-02-23T00:00:00Z",
  "expirationDate": "2027-02-23T00:00:00Z",
  "credentialSubject": {
    "id": "did:hanzo:dev",
    "type": "AIAgent",
    "name": "dev",
    "organization": "hanzo",
    "capabilities": [
      "code-generation",
      "code-review",
      "mcp-tool-use"
    ],
    "safetyEvaluation": {
      "framework": "HIP-0210",
      "result": "pass",
      "evaluatedAt": "2026-02-20T12:00:00Z"
    },
    "computeTier": "tier-3",
    "maxTokenBudget": 1000000
  },
  "credentialStatus": {
    "id": "https://did.hanzo.ai/credentials/status/1",
    "type": "StatusList2021Entry",
    "statusPurpose": "revocation",
    "statusListIndex": "42",
    "statusListCredential": "https://did.hanzo.ai/credentials/status-list/1"
  },
  "proof": {
    "type": "EcdsaSecp256k1Signature2019",
    "created": "2026-02-23T00:00:00Z",
    "verificationMethod": "did:hanzo:hanzo-iam#key-1",
    "proofPurpose": "assertionMethod",
    "proofValue": "z58DAdFfa9SkqZMVPxAQpic7ndTn..."
  }
}
```

#### Credential Types

| Credential Type | Issuer | Subject | Purpose |
|----------------|--------|---------|---------|
| `HanzoAgentCredential` | IAM | Agent DID | Attest agent identity and capabilities |
| `SafetyEvaluationCredential` | Safety Framework (HIP-210) | Agent DID | Attest safety evaluation results |
| `OrganizationMembershipCredential` | IAM | User/Agent DID | Attest org membership and role |
| `ComputeAuthorizationCredential` | Cloud (HIP-37) | Agent DID | Authorize compute resource access |
| `ModelTrainingCredential` | Training pipeline | Model DID | Attest training data provenance |
| `BiasAuditCredential` | Bias framework (HIP-220) | Model DID | Attest bias evaluation results |

#### Credential Revocation

Credentials are revoked using StatusList2021 (W3C standard). The DID service maintains a bitstring-based status list. To revoke credential at index 42, bit 42 in the status list is flipped from 0 to 1. Verifiers check the status list before accepting a credential.

This approach is privacy-preserving: verifiers download the entire status list (a compact bitstring) rather than querying "is credential X revoked?" --- which would leak which credentials are being verified.

### Agent-to-Agent Authentication

When Agent A wants to call Agent B's RPC endpoint, the authentication flow uses DID-based challenge-response:

```
Agent A                                    Agent B
   │                                          │
   │  1. GET /rpc/info                        │
   │  ────────────────────────────────────►   │
   │                                          │
   │  2. { did: "did:hanzo:agent-b",          │
   │       authEndpoint: "/rpc/auth" }        │
   │  ◄────────────────────────────────────   │
   │                                          │
   │  3. POST /rpc/auth                       │
   │     { did: "did:hanzo:agent-a" }         │
   │  ────────────────────────────────────►   │
   │                                          │
   │  4. { challenge: "<random-nonce>" }      │
   │  ◄────────────────────────────────────   │
   │                                          │
   │  Agent B resolves did:hanzo:agent-a      │
   │  to get Agent A's public key             │
   │                                          │
   │  5. POST /rpc/auth/verify                │
   │     { did: "did:hanzo:agent-a",          │
   │       challenge: "<random-nonce>",       │
   │       signature: sign(nonce, key-a),     │
   │       credentials: [VC1, VC2] }          │
   │  ────────────────────────────────────►   │
   │                                          │
   │  Agent B verifies:                       │
   │    a) Signature against DID Document     │
   │    b) VCs against issuer DIDs            │
   │    c) VC revocation status               │
   │                                          │
   │  6. { token: "<session-token>",          │
   │       expiresIn: 3600 }                  │
   │  ◄────────────────────────────────────   │
   │                                          │
   │  7. POST /rpc/invoke (with token)        │
   │  ────────────────────────────────────►   │
```

This flow does not require IAM to be online. Agent B resolves Agent A's DID from the on-chain registry (or a cached copy), verifies the signature locally, and checks Verifiable Credentials against their issuer DIDs. The entire verification is decentralized.

### Key Management Integration

DID private keys are managed through Hanzo KMS (HIP-27). The DID service does not store private keys directly; it delegates all signing operations to KMS.

#### Standard Key Custody

For typical agents and users:

```
DID Service                    KMS (HIP-27)
     │                              │
     │  POST /api/v1/crypto/sign    │
     │  { keyId: "did-dev-key-1",   │
     │    algorithm: "ES256K",      │
     │    data: "<hash-to-sign>" }  │
     │  ──────────────────────────► │
     │                              │
     │  { signature: "0x..." }      │
     │  ◄────────────────────────── │
```

The private key never leaves KMS. The DID service sends the hash of the data to be signed, and KMS returns the signature. This means a compromised DID service cannot exfiltrate private keys.

#### MPC Threshold Custody

For high-value DIDs (organizational identities, agents with large wallets):

```
DID Service        KMS Node A        KMS Node B        KMS Node C
     │                 │                 │                 │
     │  Sign request   │                 │                 │
     │  ─────────────► │                 │                 │
     │                 │  MPC round 1    │                 │
     │                 │ ◄─────────────► │                 │
     │                 │                 │  MPC round 1    │
     │                 │                 │ ◄─────────────► │
     │                 │  MPC round 2    │                 │
     │                 │ ◄─────────────► │                 │
     │                 │                 │  MPC round 2    │
     │                 │                 │ ◄─────────────► │
     │                 │                 │                 │
     │  Signature      │                 │                 │
     │  ◄───────────── │                 │                 │
```

A 2-of-3 MPC threshold means any two KMS nodes can cooperate to produce a valid signature, but no single node holds enough information to sign alone. The resulting signature is a standard ECDSA/EdDSA signature --- verifiers cannot distinguish it from a single-key signature. This is critical for maintaining W3C compatibility.

#### Post-Quantum Key Support

Following HIP-5 (Post-Quantum Security), DID documents MAY include ML-DSA (CRYSTALS-Dilithium) verification methods alongside classical keys. This provides crypto-agility: verifiers that support ML-DSA can use the post-quantum key; others fall back to secp256k1 or Ed25519.

```json
{
  "id": "did:hanzo:dev#key-pq",
  "type": "MLDSAVerificationKey2025",
  "controller": "did:hanzo:dev",
  "publicKeyMultibase": "z6Mk..."
}
```

The transition plan is:
1. **Now**: All DIDs have classical keys. PQ keys are optional.
2. **2027**: New DIDs MUST include at least one PQ key.
3. **2029**: Credential issuers SHOULD prefer PQ signatures.
4. **2030+**: Classical-only credentials are deprecated.

### API Endpoints

#### DID Resolution

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/1.0/identifiers/{did}` | Resolve a DID to its document (W3C DID Resolution) |
| GET | `/1.0/identifiers/{did}?versionId={n}` | Resolve a specific version |
| GET | `/1.0/identifiers/{did}?versionTime={iso8601}` | Resolve at a point in time |

#### DID Registration

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/1.0/create` | Create a new DID |
| POST | `/1.0/update` | Update a DID document |
| POST | `/1.0/deactivate` | Deactivate a DID |

#### Verifiable Credentials

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/1.0/credentials/issue` | Issue a Verifiable Credential |
| POST | `/1.0/credentials/verify` | Verify a Verifiable Credential |
| POST | `/1.0/credentials/revoke` | Revoke a credential |
| GET | `/1.0/credentials/status/{listId}` | Fetch a StatusList2021 |

#### Agent Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/1.0/auth/challenge` | Request an authentication challenge |
| POST | `/1.0/auth/verify` | Verify a signed challenge |
| POST | `/1.0/auth/present` | Present Verifiable Credentials |

#### Discovery

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/.well-known/did.json` | DID service metadata |
| GET | `/.well-known/did-configuration.json` | Domain-DID linkage (W3C) |
| GET | `/health` | Health check |

### Architecture

```
                         Internet
                            │
                  ┌─────────┴─────────┐
                  │      Traefik      │
                  │  did.hanzo.ai:443 │
                  └─────────┬─────────┘
                            │
                  ┌─────────┴─────────┐
                  │   DID Service     │
                  │   (Go/Rust)       │
                  │     :8048         │
                  └──┬──────┬──────┬──┘
                     │      │      │
          ┌──────────┘      │      └──────────┐
          │                 │                 │
  ┌───────┴───────┐ ┌──────┴──────┐ ┌────────┴────────┐
  │  PostgreSQL   │ │  Hanzo L1   │ │   Hanzo KMS     │
  │  (DID docs,   │ │  (DID       │ │   (key custody, │
  │   VCs, cache) │ │   registry) │ │    signing)     │
  └───────────────┘ └─────────────┘ └─────────────────┘
                            │
                    ┌───────┴───────┐
                    │     IPFS      │
                    │  (document    │
                    │   storage)    │
                    └───────────────┘
```

### Service Integration Map

```
┌─────────────────────────────────────────────────────────────┐
│                    Hanzo DID Service (HIP-48)                │
│                      did.hanzo.ai:8048                       │
└──────┬──────────┬──────────┬──────────┬──────────┬──────────┘
       │          │          │          │          │
       ▼          ▼          ▼          ▼          ▼
   HIP-26     HIP-27     HIP-24     HIP-25     HIP-09
   IAM        KMS        L1 Chain   Agent      Agent SDK
                                    Wallet
   Issues     Stores     Anchors    Links      Uses DIDs
   VCs        DID keys   DID docs   DID to     for agent
   for DIDs   securely   on-chain   wallets    auth
```

## Implementation

### DID Service

The DID service is a standalone Go binary that implements the W3C DID Resolution and DID Registration specifications. It exposes a REST API on port 8048.

```go
package main

import (
    "github.com/hanzoai/did/resolver"
    "github.com/hanzoai/did/registrar"
    "github.com/hanzoai/did/credentials"
    "github.com/hanzoai/did/registry"
)

func main() {
    // Connect to Hanzo L1 for on-chain DID registry
    chain := registry.NewChainClient(registry.Config{
        RPCURL:          "https://api.hanzo.ai/ext/bc/hanzo/rpc",
        ChainID:         36963,
        RegistryAddress: "0xDIDRegistryContractAddress",
    })

    // Connect to KMS for signing operations
    kms := credentials.NewKMSClient(credentials.KMSConfig{
        URL:          "https://kms.hanzo.ai",
        ProjectSlug:  "hanzo-did",
        Environment:  "prod",
    })

    // Connect to IAM for credential issuance authorization
    iam := credentials.NewIAMClient(credentials.IAMConfig{
        URL:      "https://hanzo.id",
        ClientID: "${DID_IAM_CLIENT_ID}",
    })

    srv := did.NewServer(did.Config{
        Port:     8048,
        Chain:    chain,
        KMS:      kms,
        IAM:      iam,
        Database: "postgresql://...",
    })

    srv.ListenAndServe()
}
```

### Production Deployment

```yaml
# compose.yml
services:
  did:
    image: ghcr.io/hanzoai/did:latest
    ports:
      - "8048:8048"
    environment:
      DID_CHAIN_RPC: https://api.hanzo.ai/ext/bc/hanzo/rpc
      DID_CHAIN_ID: "36963"
      DID_REGISTRY_ADDRESS: "0x..."
      KMS_CLIENT_ID: "${KMS_CLIENT_ID}"
      KMS_CLIENT_SECRET: "${KMS_CLIENT_SECRET}"
      KMS_URL: https://kms.hanzo.ai
      KMS_PROJECT_SLUG: hanzo-did
      KMS_ENVIRONMENT: prod
      IAM_URL: https://hanzo.id
      DATABASE_URL: "${DID_DATABASE_URL}"
    labels:
      - "traefik.http.routers.did.rule=Host(`did.hanzo.ai`)"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8048/health"]
      interval: 30s

  postgres:
    image: ghcr.io/hanzoai/sql:16-alpine
    environment:
      POSTGRES_DB: hanzo_did
```

### Database Schema

The DID service uses PostgreSQL (HIP-29) for caching DID documents, storing issued credentials, and maintaining status lists.

| Table | Description | Primary Key |
|-------|-------------|-------------|
| `did_documents` | Cached DID documents (authoritative source is on-chain) | `did` |
| `did_versions` | Historical versions of DID documents | `did` + `version` |
| `credentials` | Issued Verifiable Credentials | `credential_id` |
| `status_lists` | StatusList2021 bitstrings for revocation | `list_id` |
| `resolution_cache` | Short-lived cache for external DID resolution | `did` |

### SDK Integration

#### Go

```go
import "github.com/hanzoai/did/sdk"

client := sdk.NewClient("https://did.hanzo.ai")

// Resolve a DID
doc, meta, err := client.Resolve("did:hanzo:dev")
if err != nil {
    log.Fatalf("resolution failed: %v", err)
}

// Verify a credential
valid, err := client.VerifyCredential(credentialJSON)
if err != nil {
    log.Fatalf("verification failed: %v", err)
}

// Create a DID (requires KMS credentials for signing)
newDID, err := client.Create(sdk.CreateOptions{
    Method:     "hanzo",
    Controller: "did:hanzo:hanzo:z",
    Services: []sdk.Service{
        {Type: "AgentRPCService", Endpoint: "https://bot.hanzo.ai/rpc/my-agent"},
    },
})
```

#### Python

```python
from hanzoai.did import DIDClient

client = DIDClient("https://did.hanzo.ai")

# Resolve
doc = client.resolve("did:hanzo:dev")
print(doc.verification_method[0].public_key)

# Verify credential
result = client.verify_credential(credential_json)
assert result.verified is True

# Agent authentication
challenge = client.request_challenge("did:hanzo:agent-b")
proof = client.sign_challenge(challenge, key_id="did:hanzo:agent-a#key-1")
token = client.authenticate("did:hanzo:agent-b", proof)
```

#### JavaScript

```javascript
import { DIDClient } from '@hanzoai/did'

const client = new DIDClient('https://did.hanzo.ai')

// Resolve
const { document, metadata } = await client.resolve('did:hanzo:dev')

// Verify credential
const { verified, errors } = await client.verifyCredential(credentialJSON)

// Present credentials for agent auth
const token = await client.authenticate({
  target: 'did:hanzo:agent-b',
  credentials: [safetyCredential, capabilityCredential],
})
```

## Security Considerations

### Key Compromise

If a DID's private key is compromised:

1. **Controller rotates the key**: The controller (which may use a different key) updates the DID document to remove the compromised key and add a new one. The on-chain update creates a verifiable record of when the rotation occurred.
2. **Credentials issued with the compromised key**: Verifiers check the DID document's `versionTime` against the credential's `issuanceDate`. If the key was valid at issuance time, the credential remains valid. If issued after compromise (detected via the rotation timestamp), the credential is rejected.
3. **If the controller key is compromised**: This is the worst case. The subject must use a pre-registered recovery mechanism (social recovery, time-locked recovery address, or MPC threshold with the compromised share excluded). Without a recovery mechanism, the DID must be abandoned and a new one created.

### Privacy

DID documents are public (they must be, for verification to work). This means:

- **Do not put PII in DID documents**: No email addresses, phone numbers, or physical addresses. Use Verifiable Credentials with selective disclosure for personal data.
- **Correlation risk**: A DID that appears in multiple contexts can be correlated. For privacy-sensitive interactions, subjects SHOULD use peer DIDs (ephemeral, pairwise identifiers) rather than their primary DID.
- **Service endpoint disclosure**: Listing an RPC endpoint in the DID document reveals the agent's service URL. For agents requiring location privacy, use relay endpoints or onion routing.

### Replay Attacks

The challenge-response authentication protocol (Section: Agent-to-Agent Authentication) includes a nonce and a timestamp. Agents MUST:

1. Generate cryptographically random nonces (minimum 32 bytes).
2. Reject challenges older than 300 seconds.
3. Never accept the same nonce twice (maintain a nonce cache with TTL).

### Smart Contract Security

The DID Registry contract:

1. **Access control**: Only the controller can update or deactivate a DID. Controller changes require the current controller's signature.
2. **Reentrancy**: The contract has no external calls that could enable reentrancy. State changes precede any potential external interaction.
3. **Gas limits**: The `register()` and `update()` functions have bounded gas costs (no unbounded loops). DID strings are limited to 256 bytes.
4. **Upgrade path**: The contract uses a transparent proxy pattern for upgradeability. The proxy admin is a multi-sig controlled by the Hanzo governance council.

### Denial of Service

The DID service rate-limits resolution requests to prevent abuse:

| Endpoint | Rate Limit | Burst |
|----------|-----------|-------|
| `/1.0/identifiers/*` | 1000 req/min per IP | 100 |
| `/1.0/create` | 10 req/min per authenticated user | 5 |
| `/1.0/credentials/issue` | 100 req/min per issuer DID | 20 |
| `/1.0/auth/*` | 100 req/min per DID | 20 |

Resolution results are cached for 60 seconds (configurable). On-chain resolution is used only when the cache misses or when `no-cache` is requested.

## References

1. [W3C Decentralized Identifiers (DIDs) v1.0](https://www.w3.org/TR/did-core/) - Core DID specification (W3C Recommendation)
2. [W3C Verifiable Credentials Data Model v2.0](https://www.w3.org/TR/vc-data-model-2.0/) - VC specification
3. [W3C DID Resolution](https://w3c-ccg.github.io/did-resolution/) - DID resolution specification
4. [StatusList2021](https://www.w3.org/TR/vc-status-list/) - Credential revocation mechanism
5. [DIDComm Messaging v2.0](https://identity.foundation/didcomm-messaging/spec/v2.0/) - Agent-to-agent messaging
6. [ERC-1056: Ethereum Lightweight Identity](https://eips.ethereum.org/EIPS/eip-1056) - Inspiration for on-chain registry design
7. [HIP-24: Hanzo Sovereign L1 Chain Architecture](./hip-0024-hanzo-sovereign-l1-chain-architecture.md) - On-chain DID anchoring
8. [HIP-25: Bot Agent Wallet & RPC Billing Protocol](./hip-0025-bot-agent-wallet-rpc-billing-protocol.md) - Agent DID and wallet integration
9. [HIP-26: Identity & Access Management Standard](./hip-0026-identity-access-management-standard.md) - IAM as credential issuer
10. [HIP-27: Secrets Management Standard](./hip-0027-secrets-management-standard.md) - KMS for DID key custody
11. [HIP-5: Post-Quantum Security](./hip-0005-post-quantum-security-for-ai-infrastructure.md) - ML-DSA key support
12. [HIP-9: Agent SDK](./hip-0009-agent-sdk-multi-agent-orchestration-framework.md) - Multi-agent orchestration
13. [HIP-210: Safety Evaluation Framework](./hip-0210-safety-evaluation-framework.md) - Agent safety credentials
14. [NIST FIPS 204: ML-DSA](https://csrc.nist.gov/pubs/fips/204/final) - Post-quantum digital signature standard

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
