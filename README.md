# Hanzo Improvement Proposals (HIPs)

Hanzo Improvement Proposals (HIPs) are the primary mechanism for proposing new features, gathering community input, and documenting design decisions for the [Hanzo AI](https://hanzo.ai) ecosystem. This process ensures that changes to the Hanzo platform are transparently reviewed and achieve community consensus before implementation.

## What is a HIP?

A Hanzo Improvement Proposal (HIP) is a design document that provides information to the Hanzo community about a proposed change to the system. HIPs serve as the formal pathway to introduce improvements and build agreement on their adoption. They are used for:
- Proposing new AI architectures, models, and infrastructure
- Defining standards for agent frameworks, protocols, and interfaces
- Collecting community input on platform design
- Documenting design decisions with pedagogical context (why we built what we built)

## Quick Start

- New to HIPs? Begin with [HIP-0000](./HIPs/hip-0000-hanzo-ai-architecture-framework.md), the Hanzo AI Architecture overview
- Create a new HIP: copy [`docs/templates/hip-template.md`](./docs/templates/hip-template.md)
  to `HIPs/hip-<NNNN>-<slug>.md`, then run `python3 scripts/lint-hips.py`
- View all HIPs: See the complete index below

## HIP Index

| Number | Title | Type | Category | Status |
|:-------|:------|:-----|:---------|:-------|
| [HIP-0000](./HIPs/hip-0000-hanzo-ai-architecture-framework.md) | Hanzo AI Architecture & Framework | Meta | - | Draft |
| [HIP-0001](./HIPs/hip-0001-ai-coin-hanzos-native-currency.md) | AI Token - Hanzo's Native Currency | Standards Track | Core | Draft |
| [HIP-0002](./HIPs/hip-0002-hamiltonian-large-language-models-hllms-specification.md) | Hamiltonian Large Language Models (HLLMs) Specification | Standards Track | Core | Draft |
| [HIP-0003](./HIPs/hip-0003-jin-multimodal-ai-architecture.md) | Jin Multimodal AI Architecture | Standards Track | Core | Draft |
| [HIP-0004](./HIPs/hip-0004-llm-gateway-unified-ai-provider-interface.md) | LLM Gateway - Unified AI Provider Interface | Standards Track | Interface | Draft |
| [HIP-0005](./HIPs/hip-0005-post-quantum-security-for-ai-infrastructure.md) | Post-Quantum Security for AI Infrastructure | Standards Track | Security | Draft |
| [HIP-0006](./HIPs/hip-0006-per-user-fine-tuning-architecture-for-personalized-ai.md) | Per-User Fine-Tuning Architecture for Personalized AI | Standards Track | Core | Draft |
| [HIP-0007](./HIPs/hip-0007-active-inference-integration-for-hamiltonian-llms.md) | Active Inference Integration for Hamiltonian LLMs | Standards Track | Core | Draft |
| [HIP-0008](./HIPs/hip-0008-hmm-hanzo-market-maker-native-dex-for-ai-compute-resources.md) | HMM (Hanzo Market Maker) - Native DEX for AI Compute... | Standards Track | Core | Draft |
| [HIP-0009](./HIPs/hip-0009-agent-sdk-multi-agent-orchestration-framework.md) | Agent SDK - Multi-Agent Orchestration Framework | Standards Track | Core | Draft |
| [HIP-0010](./HIPs/hip-0010-model-context-protocol-mcp-integration-standards.md) | Model Context Protocol (MCP) Integration Standards | Standards Track | Interface | Active |
| [HIP-0011](./HIPs/hip-0011-chat-interface-standard.md) | Chat Interface Standard | Standards Track | Interface | Draft |
| [HIP-0012](./HIPs/hip-0012-search-interface-standard.md) | Search Interface Standard | Standards Track | Interface | Draft |
| [HIP-0013](./HIPs/hip-0013-workflow-execution-standard.md) | Workflow Execution Standard | Standards Track | Core | Draft |
| [HIP-0014](./HIPs/hip-0014-application-deployment-standard.md) | Application Deployment Standard | Standards Track | Infrastructure | Draft |
| [HIP-0015](./HIPs/hip-0015-computer-control-standard.md) | Computer Control Standard | Standards Track | Interface | Draft |
| [HIP-0017](./HIPs/hip-0017-analytics-event-standard.md) | Analytics Event Standard | Standards Track | Interface | Draft |
| [HIP-0018](./HIPs/hip-0018-payment-processing-standard.md) | Payment Processing Standard | Standards Track | Interface | Draft |
| [HIP-0019](./HIPs/hip-0019-tensor-operations-standard.md) | Tensor Operations Standard | Standards Track | Core | Draft |
| [HIP-0020](./HIPs/hip-0020-blockchain-node-standard.md) | Blockchain Node Standard | Standards Track | Core | Draft |
| [HIP-0024](./HIPs/hip-0024-hanzo-sovereign-l1-chain-architecture.md) | Hanzo Sovereign L1 Chain Architecture | Standards Track | Core | Draft |
| [HIP-0025](./HIPs/hip-0025-bot-agent-wallet-rpc-billing-protocol.md) | Bot Agent Wallet & RPC Billing Protocol | Standards Track | Core | Draft |
| [HIP-0026](./HIPs/hip-0026-identity-access-management-standard.md) | Identity & Access Management Standard | Standards Track | Infrastructure | Active |
| [HIP-0027](./HIPs/hip-0027-secrets-management-standard.md) | Secrets Management Standard | Standards Track | Infrastructure | Active |
| [HIP-0028](./HIPs/hip-0028-key-value-store-standard.md) | Key-Value Store Standard | Standards Track | Infrastructure | Active |
| [HIP-0029](./HIPs/hip-0029-relational-database-standard.md) | Relational Database Standard | Standards Track | Infrastructure | Active |
| [HIP-0030](./HIPs/hip-0030-event-streaming-standard.md) | Event Streaming Standard | Standards Track | Infrastructure | Draft |
| [HIP-0033](./HIPs/hip-0033-container-registry-standard.md) | Container Registry Standard | Standards Track | Infrastructure | Active |
| [HIP-0035](./HIPs/hip-0035-image-video-generation-standard.md) | Image & Video Generation Standard | Standards Track | Interface | Draft |
| [HIP-0036](./HIPs/hip-0036-ci-cd-build-system-standard.md) | CI/CD Build System Standard | Standards Track | Infrastructure | Draft |
| [HIP-0039](./HIPs/hip-0039-zen-model-architecture.md) | Zen Model Architecture | Standards Track | Core | Draft |
| [HIP-0040](./HIPs/hip-0040-multi-language-sdk-standard.md) | Multi-Language SDK Standard | Standards Track | Interface | Draft |
| [HIP-0041](./HIPs/hip-0041-cli-standard.md) | The Hanzo CLI — a Projection of the Served API | Standards Track | Interface | Draft |
| [HIP-0042](./HIPs/hip-0042-vector-search-standard.md) | Vector Search Standard | Standards Track | Infrastructure | Active |
| [HIP-0043](./HIPs/hip-0043-llm-inference-engine-standard.md) | Hanzo Engine — LLM Inference Engine Standard | Standards Track | Core | Active |
| [HIP-0045](./HIPs/hip-0045-documentation-framework-standard.md) | Documentation Framework Standard | Standards Track | Interface | Draft |
| [HIP-0046](./HIPs/hip-0046-embeddings-standard.md) | Embeddings Standard | Standards Track | Interface | Draft |
| [HIP-0047](./HIPs/hip-0047-analytics-datastore-standard.md) | Analytics Datastore Standard | Standards Track | Infrastructure | Active |
| [HIP-0049](./HIPs/hip-0049-dns-service-standard.md) | DNS Service Standard | Standards Track | Infrastructure | Active |
| [HIP-0050](./HIPs/hip-0050-edge-computing-standard.md) | Hanzo Edge — Edge AI Runtime Standard | Standards Track | Infrastructure | Draft |
| [HIP-0060](./HIPs/hip-0060-serverless-functions-standard.md) | Serverless Functions (FaaS) Standard | Standards Track | Infrastructure | Draft |
| [HIP-0061](./HIPs/hip-0061-notification-service-standard.md) | Notification & Messaging Service Standard | Standards Track | Interface | Draft |
| [HIP-0063](./HIPs/hip-0063-feature-flags-standard.md) | Feature Flags Standard | Standards Track | Interface | Draft |
| [HIP-0065](./HIPs/hip-0065-backup-disaster-recovery-standard.md) | Backup & Disaster Recovery Standard | Standards Track | Infrastructure | Draft |
| [HIP-0068](./HIPs/hip-0068-ingress-standard.md) | Ingress Standard | Standards Track | Infrastructure | Active |
| [HIP-0069](./HIPs/hip-0069-service-discovery-and-auto-bridge.md) | Service Discovery & Auto-Bridge | Standards Track | Infrastructure | Active |
| [HIP-0074](./HIPs/hip-0074-software-bill-of-materials-standard.md) | Software Bill of Materials & Git Stamp Standard | Standards Track | Infrastructure | Draft |
| [HIP-0077](./HIPs/hip-0077-mesh-identity-gossip-and-payments.md) | Mesh Identity, Gossip & Payments (PQ) | Standards Track | Infrastructure | Draft |
| [HIP-0078](./HIPs/hip-0078-z-chain-pq-identity-rollup.md) | Z-Chain — Post-Quantum Identity & Attestation Rollup | Standards Track | Infrastructure | Draft |
| [HIP-0079](./HIPs/hip-0079-q-chain-finality-blocks.md) | Q-Chain — Quasar Finality Block Standard | Standards Track | Infrastructure | Draft |
| [HIP-0084](./HIPs/hip-0084-pulsar-m-dkg.md) | Pulsar-M — Threshold ML-DSA DKG & Signing | Standards Track | Cryptography | Draft |
| [HIP-0085](./HIPs/hip-0085-wallet-pq-account-type.md) | Wallet PQ Account Type (ML-DSA-65 native, 48-byte Ac... | Standards Track | Cryptography | Active |
| [HIP-0086](./HIPs/hip-0086-tx-auth-envelope.md) | TxAuthEnvelope (typed PQ transaction signing) | Standards Track | Cryptography | Active |
| [HIP-0087](./HIPs/hip-0087-pq-permit.md) | PQ Permit (replaces EIP-2612) | Standards Track | Cryptography | Active |
| [HIP-0088](./HIPs/hip-0088-session-kem.md) | Session KEM (ML-KEM-768/1024 for P2P) | Standards Track | Cryptography | Active |
| [HIP-0089](./HIPs/hip-0089-drbg-randomness-beacon.md) | DRBG / Randomness Beacon (SP 800-90A/B) | Standards Track | Cryptography | Draft |
| [HIP-0095](./HIPs/hip-0095-qos-challenge-system.md) | QoS Challenge System | Standards Track | Core | Draft |
| [HIP-0096](./HIPs/hip-0096-ai-compute-contribution-rewards.md) | AI Compute Contribution Rewards | Standards Track | Core | Draft |
| [HIP-0097](./HIPs/hip-0097-clean-node-identity-did-hanzo-name.md) | Node Identity and the did:hanzo: DID Method | Standards Track | Core | Draft |
| [HIP-0098](./HIPs/hip-0098-governance-upgrade-keys.md) | Governance / Upgrade Keys (ML-DSA-87 / SLH-DSA cold ... | Standards Track | Cryptography | Draft |
| [HIP-0101](./HIPs/hip-0101-hanzo-lux-bridge-protocol-integration.md) | Hanzo-Lux Bridge Protocol Integration | Standards Track | Bridge | Draft |
| [HIP-0102](./HIPs/hip-0102-omnichain-bridge.md) | Omnichain Bridge Integration | Standards Track | Bridge | Draft |
| [HIP-0103](./HIPs/hip-0103-bridge-pq-only-profile.md) | Bridge PQ-Only Profile | Standards Track | Infrastructure | Draft |
| [HIP-0104](./HIPs/hip-0104-contract-auth-via-zchain-proof.md) | Contract Auth via Z-Chain Proof | Standards Track | Infrastructure | Draft |
| [HIP-0105](./HIPs/hip-0105-in-process-extension-runtime-standard.md) | In-Process Extension Runtime Standard | Standards Track | Infrastructure | Active |
| [HIP-0106](./HIPs/hip-0106-hanzo-plugin-contract.md) | The Hanzo Plugin Contract | Standards Track | Infrastructure | Active |
| [HIP-0107](./HIPs/hip-0107-streaming-replication-over-vfs.md) | Streaming Replication over VFS | Standards Track | Infrastructure | Draft |
| [HIP-0108](./HIPs/hip-0108-on-demand-supervisor.md) | On-Demand Subsystem Supervisor + Warm Pool | Standards Track | Infrastructure | Draft |
| [HIP-0109](./HIPs/hip-0109-hanzo-ml-cloud-toolkit.md) | Hanzo ML Cloud Toolkit | Standards Track | Infrastructure | Draft |
| [HIP-0111](./HIPs/hip-0111-iam-authentication-standard.md) | Hanzo IAM Authentication Standard | Standards Track | Infrastructure | Active |
| [HIP-0113](./HIPs/hip-0113-cognitive-sidecar-and-hanzo-engine-provider-runtime.md) | Cognitive Sidecar & Hanzo Engine Provider Runtime fo... | Standards Track | Core | Draft |
| [HIP-0114](./HIPs/hip-0114-zap-inter-vm-cognitive-transport.md) | ZAP — Inter-VM Cognitive Transport for Thinking Chains | Standards Track | Core | Draft |
| [HIP-0115](./HIPs/hip-0115-hanzo-frontend-delivery.md) | Hanzo Frontend Delivery | Standards Track | Infrastructure | Active |
| [HIP-0116](./HIPs/hip-0116-plugin-vm-model.md) | Hanzo Plugin & VM Model | Standards Track | Infrastructure | Superseded |
| [HIP-0117](./HIPs/hip-0117-cloud-in-a-box.md) | Cloud-in-a-Box — One Binary, Three Modes | Standards Track | Infrastructure | Draft |
| [HIP-0118](./HIPs/hip-0118-superadmin-and-tenant-isolation-model.md) | SuperAdmin & Tenant Isolation Model | Standards Track | Security | Draft |
| [HIP-0119](./HIPs/hip-0119-hanzo-service-conventions.md) | Hanzo Service Conventions | Standards Track | Infrastructure | Active |
| [HIP-0120](./HIPs/hip-0120-zap-native-transport-and-grpc-elimination.md) | ZAP-Native Transport & gRPC Elimination | Standards Track | Core | Draft |
| [HIP-0121](./HIPs/hip-0121-byo-compute-fleet-and-metered-billing.md) | BYO Compute Fleet & Metered Billing | Standards Track | Core | Draft |
| [HIP-0122](./HIPs/hip-0122-zip-zap-native-application-server.md) | zip — The ZAP-Native Application Server Core | Standards Track | Infrastructure | Active |
| [HIP-0123](./HIPs/hip-0123-visor-fleet-autoscaling.md) | Visor — Fleet & Fabric Autoscaling Across Any Provider | Standards Track | Infrastructure | Draft |
| [HIP-0124](./HIPs/hip-0124-byo-provider-and-ai.md) | Bring-Your-Own Provider & AI — Unified Dashboard and... | Standards Track | Platform | Active |
| [HIP-0125](./HIPs/hip-0125-consensus-plugin-placement-platform.md) | Consensus-Backed Plugin-Placement Platform | Standards Track | Infrastructure | Draft |
| [HIP-0126](./HIPs/hip-0126-integrations-connectors-and-the-extension-runtime.md) | Integrations, Connectors & the Extension Runtime — O... | Standards Track | Interface | Draft |
| [HIP-0127](./HIPs/hip-0127-v8-architecture-distribution-language-seam.md) | V8 · Open Edition — Architecture, Distribution & the... | Standards Track | Meta | Active |
| [HIP-0128](./HIPs/hip-0128-resource-surface-standard.md) | Resource Surface Standard — Generated REST over ZAP | Standards Track | Core | Draft |
| [HIP-0129](./HIPs/hip-0129-eval-the-judgment-plane.md) | Eval — The Judgment Plane | Standards Track | Infrastructure | Draft |
| [HIP-0130](./HIPs/hip-0130-open-core-split.md) | Open-Core Split — the Tenancy Line, the Composition ... | Standards Track | Core | Draft |
| [HIP-0132](./HIPs/hip-0132-one-telemetry-plane.md) | One Telemetry Plane — One Door, One Schema, Many Lenses | Standards Track | Infrastructure | Draft |
| [HIP-0133](./HIPs/hip-0133-entity-groups.md) | Entity Groups — Placement, Durability, Splitting and... | Standards Track | Core | Draft |
| [HIP-0134](./HIPs/hip-0134-one-process-one-socket-one-identity.md) | One Process, One Socket, One Identity | Standards Track | Core | Active |
| [HIP-0135](./HIPs/hip-0135-what-is-public.md) | What Is Public | Process | Governance | Active |
| [HIP-0136](./HIPs/hip-0136-one-secret-one-path.md) | One Secret, One Path | Standards Track | Infrastructure | Active |
| [HIP-0137](./HIPs/hip-0137-one-license.md) | One License | Process | Governance | Active |
| [HIP-0138](./HIPs/hip-0138-unified-hanzo-cloud-binary.md) | Cloud — Unified Hanzo Binary | Standards Track | Infrastructure | Superseded |
| [HIP-0139](./HIPs/hip-0139-capability.md) | Capability | Standards Track | Infrastructure | Active |
| [HIP-0140](./HIPs/hip-0140-proposing-a-capability.md) | Proposing a Capability | Meta | Core | Draft |
| [HIP-0141](./HIPs/hip-0141-substitution.md) | Substitution | Standards Track | Core | Draft |
| [HIP-0200](./HIPs/hip-0200-responsible-ai-principles.md) | Responsible AI Principles and Commitments | Meta | - | Draft |
| [HIP-0201](./HIPs/hip-0201-model-risk-management.md) | Model Risk Management | Meta | - | Draft |
| [HIP-0210](./HIPs/hip-0210-safety-evaluation-framework.md) | Safety Evaluation Framework | Meta | - | Draft |
| [HIP-0220](./HIPs/hip-0220-bias-detection-mitigation.md) | Bias Detection & Mitigation | Meta | - | Draft |
| [HIP-0230](./HIPs/hip-0230-ai-transparency-explainability.md) | AI Transparency & Explainability | Meta | - | Draft |
| [HIP-0240](./HIPs/hip-0240-ai-incident-response.md) | AI Incident Response | Meta | - | Draft |
| [HIP-0250](./HIPs/hip-0250-sustainability-standards-alignment.md) | Sustainability Standards Alignment Matrix | Meta | - | Draft |
| [HIP-0251](./HIPs/hip-0251-ai-compute-carbon-footprint.md) | AI Compute Carbon Footprint | Meta | - | Draft |
| [HIP-0260](./HIPs/hip-0260-efficient-model-practices.md) | Efficient Model Practices | Meta | - | Draft |
| [HIP-0270](./HIPs/hip-0270-ai-supply-chain-responsibility.md) | AI Supply Chain Responsibility | Meta | - | Draft |
| [HIP-0300](./HIPs/hip-0300-unified-mcp.md) | Unified MCP — one door, and local servers that forwa... | Standards Track | Interface | Review |
| [HIP-0301](./HIPs/hip-0301-python-sdk-agent-runtime-protocols.md) | Agent Runtime Protocols & Cross-Platform Parity | Standards Track | Core | Draft |
| [HIP-0302](./HIPs/hip-0302-encrypted-sqlite-replication-standard.md) | Hanzo Replicate: Encrypted SQLite Durability for Bas... | Standards Track | Infrastructure | Active |
| [HIP-0303](./HIPs/hip-0303-brand-sovereignty-and-federation-discovery.md) | Hanzo adopts LP-0010: Brand Sovereignty and Federati... | Meta | Governance | Active |
| [HIP-0305](./HIPs/hip-0305-esign-shared-db-tenancy.md) | esign: shared-DB tenancy via team-where, not file-pe... | Standards Track | Infrastructure | Active |
| [HIP-0306](./HIPs/hip-0306-aml-transaction-monitoring.md) | AML Transaction Monitoring, Screening and Case Manag... | Standards Track | Infrastructure | Draft |
| [HIP-0400](./HIPs/hip-0400-service-crd.md) | Service CRD | Standards Track | Operator | Active |
| [HIP-0401](./HIPs/hip-0401-datastore-crd.md) | Datastore CRD | Standards Track | Operator | Draft |
| [HIP-0402](./HIPs/hip-0402-sql-crd.md) | SQL CRD | Standards Track | Operator | Active |
| [HIP-0403](./HIPs/hip-0403-kv-crd.md) | KV CRD | Standards Track | Operator | Active |
| [HIP-0404](./HIPs/hip-0404-docdb-crd.md) | DocDB CRD | Standards Track | Operator | Draft |
| [HIP-0405](./HIPs/hip-0405-s3-crd.md) | S3 CRD | Standards Track | Operator | Active |
| [HIP-0406](./HIPs/hip-0406-dns-crd.md) | DNS CRD | Standards Track | Operator | Active |
| [HIP-0407](./HIPs/hip-0407-base-crd.md) | Base CRD | Standards Track | Operator | Active |
| [HIP-0408](./HIPs/hip-0408-iam-crd.md) | IAM CRD | Standards Track | Operator | Active |
| [HIP-0409](./HIPs/hip-0409-kms-crd.md) | KMS CRD | Standards Track | Operator | Active |
| [HIP-0410](./HIPs/hip-0410-llm-crd.md) | LLM CRD | Standards Track | Operator | Active |
| [HIP-0411](./HIPs/hip-0411-ingress-crd.md) | Ingress CRD | Standards Track | Operator | Active |
| [HIP-0412](./HIPs/hip-0412-gateway-crd.md) | Gateway CRD | Standards Track | Operator | Active |
| [HIP-0413](./HIPs/hip-0413-mpc-crd.md) | MPC CRD | Standards Track | Operator | Active |
| [HIP-0414](./HIPs/hip-0414-network-crd.md) | Network CRD | Standards Track | Operator | Active |
| [HIP-0418](./HIPs/hip-0418-indexer-crd.md) | Indexer CRD | Standards Track | Operator | Active |
| [HIP-0419](./HIPs/hip-0419-explorer-crd.md) | Explorer CRD | Standards Track | Operator | Active |
| [HIP-0504](./HIPs/hip-0504-unified-design-system.md) | Unified Cross-Platform Design System | Standards Track | Interface | Draft |
| [HIP-0506](./HIPs/hip-0506-hanzo-studio-agentic-creative-runtime.md) | Hanzo Studio — Agentic Multi-Modal Creative Runtime | Standards Track | Application | Draft |
| [HIP-0512](./HIPs/hip-0512-experiment-the-evidence-plane.md) | Experiment — The Evidence Plane | Standards Track | Infrastructure | Active |
| [HIP-0516](./HIPs/hip-0516-translate.md) | Translate — One Endpoint, Two Tiers, Permissive Weights | Standards Track | Core | Active |
| [HIP-0517](./HIPs/hip-0517-branch-naming.md) | Branch Naming — main is the Trunk, Everywhere | Process | Meta | Active |
| [HIP-0518](./HIPs/hip-0518-aml-the-obligation-plane.md) | AML — The Obligation Plane | Standards Track | Interface | Draft |
| [HIP-0519](./HIPs/hip-0519-one-identity-boundary.md) | One Identity Boundary | Standards Track | Infrastructure | Active |
| [HIP-0520](./HIPs/hip-0520-serving-topology.md) | Serving Topology — Three Tiers, Horizontally Scalabl... | Standards Track | Infrastructure | Draft |
| [HIP-0521](./HIPs/hip-0521-org-hierarchy.md) | Org Hierarchy | Standards Track | Security | Draft |
| [HIP-0522](./HIPs/hip-0522-the-context-graph.md) | The Context Graph — Edges, Decisions and Derivation ... | Standards Track | Core | Draft |
| [HIP-0901](./HIPs/hip-0901-proof-of-ai-native-execution-proofs.md) | Proof of AI (PoAI) — Native Execution Proofs, Canoni... | Standards Track | Core | Active |
| [HIP-0902](./HIPs/hip-0902-proof-of-code.md) | Proof of Code — Consensus over Git Refs | Standards Track | Core | Draft |
| [HIP-0903](./HIPs/hip-0903-agentic-company.md) | The Agentic Company — Autonomous Firms on Hanzo | Informational | Meta | Draft |
| [HIP-1000](./HIPs/hip-1000-authors-royalty.md) | Authors — A Royalty on Deployed Open Source | Standards Track | Application | Active |
| [HIP-1001](./HIPs/hip-1001-books-double-entry-ledger.md) | Books — The Double-Entry Ledger | Standards Track | Application | Active |
| [HIP-1002](./HIPs/hip-1002-cart.md) | Cart — The Basket a Sale Begins In | Standards Track | Application | Draft |
| [HIP-1004](./HIPs/hip-1004-licensing.md) | Licensing — Signed Tokens for Paid Binaries | Standards Track | Security | Draft |
| [HIP-1005](./HIPs/hip-1005-payments.md) | Payments — Taking a Card | Standards Track | Application | Active |
| [HIP-1006](./HIPs/hip-1006-store.md) | Store — Storefronts, Listings and Checkout | Standards Track | Application | Active |
| [HIP-1020](./HIPs/hip-1020-chain-registry.md) | Chain Registry | Standards Track | Interface | Draft |
| [HIP-1021](./HIPs/hip-1021-chain-rpc-door.md) | Chain JSON-RPC Door | Standards Track | Interface | Draft |
| [HIP-1022](./HIPs/hip-1022-native-balance-reads.md) | Native Balance Reads | Standards Track | Interface | Draft |
| [HIP-1030](./HIPs/hip-1030-openapi-the-served-contract.md) | OpenAPI — The Served Contract | Standards Track | Interface | Active |
| [HIP-1032](./HIPs/hip-1032-errors-the-fault-lens.md) | Errors — The Fault Lens | Standards Track | Interface | Active |
| [HIP-1040](./HIPs/hip-1040-appearance.md) | Appearance | Standards Track | Interface | Draft |
| [HIP-1041](./HIPs/hip-1041-authz.md) | Authz | Standards Track | Security | Draft |
| [HIP-1042](./HIPs/hip-1042-avatar.md) | Avatar | Standards Track | Interface | Draft |
| [HIP-1043](./HIPs/hip-1043-csrf.md) | CSRF | Standards Track | Security | Draft |
| [HIP-1044](./HIPs/hip-1044-org-settings.md) | Org Settings | Standards Track | Security | Draft |
| [HIP-1045](./HIPs/hip-1045-orgs.md) | Orgs | Standards Track | Security | Draft |
| [HIP-1046](./HIPs/hip-1046-risk.md) | Risk | Standards Track | Application | Draft |
| [HIP-1047](./HIPs/hip-1047-security-scanning.md) | Security Scanning | Standards Track | Security | Draft |
| [HIP-1048](./HIPs/hip-1048-team.md) | Team | Standards Track | Application | Draft |
| [HIP-1049](./HIPs/hip-1049-validators.md) | Validators | Standards Track | Infrastructure | Draft |
| [HIP-1060](./HIPs/hip-1060-pubsub-the-tenant-door-on-the-bus.md) | Pubsub — The Tenant Door on the Bus | Standards Track | Infrastructure | Draft |
| [HIP-1061](./HIPs/hip-1061-mq-queues-and-streams.md) | MQ — Queues and Streams | Standards Track | Infrastructure | Draft |
| [HIP-1062](./HIPs/hip-1062-tasks-the-durable-run.md) | Tasks — The Durable Run | Standards Track | Infrastructure | Draft |
| [HIP-1063](./HIPs/hip-1063-auto-flows-that-run-themselves.md) | Auto — Flows That Run Themselves | Standards Track | Interface | Draft |
| [HIP-1064](./HIPs/hip-1064-flow-the-canvas-plane.md) | Flow — The Canvas Plane | Standards Track | Interface | Draft |
| [HIP-1065](./HIPs/hip-1065-connectors-a-users-own-credentials.md) | Connectors — A User's Own Credentials | Standards Track | Security | Draft |
| [HIP-1066](./HIPs/hip-1066-channels-one-inbox.md) | Channels — One Inbox | Standards Track | Interface | Draft |
| [HIP-1067](./HIPs/hip-1067-destinations-conversions-forwarded.md) | Destinations — Conversions Forwarded | Standards Track | Interface | Draft |
| [HIP-1069](./HIPs/hip-1069-tel-numbers-calls-and-messages.md) | Tel — Numbers, Calls and Messages | Standards Track | Interface | Draft |
| [HIP-1100](./HIPs/hip-1100-ads-paid-campaigns.md) | Ads — Paid Campaigns | Standards Track | Infrastructure | Draft |
| [HIP-1101](./HIPs/hip-1101-allowance-free-ceiling.md) | Allowance — The Free Lane's Ceiling | Standards Track | Infrastructure | Draft |
| [HIP-1102](./HIPs/hip-1102-ask-grounded-answer.md) | Ask — The Grounded Answer | Standards Track | Interface | Draft |
| [HIP-1103](./HIPs/hip-1103-audit-tamper-evident-trail.md) | Audit — The Tamper-Evident Trail | Standards Track | Infrastructure | Draft |
| [HIP-1104](./HIPs/hip-1104-base-hosted-backend.md) | Base — The Hosted Backend | Standards Track | Infrastructure | Draft |
| [HIP-1105](./HIPs/hip-1105-benchmark-measurement-arena.md) | Benchmark — The Measurement Arena | Standards Track | Infrastructure | Draft |
| [HIP-1106](./HIPs/hip-1106-blueprint-priced-stack.md) | Blueprint — The Priced Stack | Standards Track | Interface | Draft |
| [HIP-1107](./HIPs/hip-1107-bot-machines-and-runs.md) | Bot — Your Machines and the Runs on Them | Standards Track | Infrastructure | Draft |
| [HIP-1110](./HIPs/hip-1110-campaign.md) | Campaign — One Go-To-Market Push | Standards Track | Interface | Draft |
| [HIP-1111](./HIPs/hip-1111-captable.md) | Captable — Who Owns What | Standards Track | Interface | Draft |
| [HIP-1112](./HIPs/hip-1112-catalog.md) | Catalog — Cross-Org Discovery | Standards Track | Interface | Draft |
| [HIP-1113](./HIPs/hip-1113-cloudflare.md) | Cloudflare — The Per-Org Asset Plane | Standards Track | Infrastructure | Draft |
| [HIP-1114](./HIPs/hip-1114-code.md) | Code — Search and Symbols | Standards Track | Infrastructure | Draft |
| [HIP-1115](./HIPs/hip-1115-compliance.md) | Compliance — Verification of Record | Standards Track | Interface | Draft |
| [HIP-1116](./HIPs/hip-1116-content.md) | Content — The Marketing Loop | Standards Track | Interface | Draft |
| [HIP-1117](./HIPs/hip-1117-crawl.md) | Crawl — A Page as Markdown | Standards Track | Infrastructure | Draft |
| [HIP-1120](./HIPs/hip-1120-crm-sales-pipeline.md) | CRM — The Sales Pipeline | Standards Track | Interface | Draft |
| [HIP-1121](./HIPs/hip-1121-dataroom-shared-documents.md) | Dataroom — Documents Shared by Link | Standards Track | Interface | Draft |
| [HIP-1122](./HIPs/hip-1122-deploy-gitops-plane.md) | Deploy — The GitOps Plane | Standards Track | Infrastructure | Draft |
| [HIP-1123](./HIPs/hip-1123-domain-registration.md) | Domain — Name Registration | Standards Track | Infrastructure | Draft |
| [HIP-1124](./HIPs/hip-1124-engine-runtime-lens.md) | Engine — The Serving Runtime Lens | Standards Track | Infrastructure | Draft |
| [HIP-1125](./HIPs/hip-1125-esign-signatures.md) | Esign — Documents Out for Signature | Standards Track | Interface | Draft |
| [HIP-1126](./HIPs/hip-1126-framework-doctype-engine.md) | Framework — The DocType Engine | Standards Track | Core | Draft |
| [HIP-1127](./HIPs/hip-1127-gateway-edge-policy.md) | Gateway — Live Edge Policy | Standards Track | Infrastructure | Draft |
| [HIP-1130](./HIPs/hip-1130-guide-launch-journey.md) | Guide — The Launch Journey | Standards Track | Interface | Draft |
| [HIP-1131](./HIPs/hip-1131-help-support-desk.md) | Help — The Support Desk | Standards Track | Interface | Draft |
| [HIP-1132](./HIPs/hip-1132-index-search.md) | Index — Full-Text Search | Standards Track | Infrastructure | Draft |
| [HIP-1133](./HIPs/hip-1133-ingress-embedded-edge.md) | Ingress — The Embedded Edge | Standards Track | Infrastructure | Draft |
| [HIP-1134](./HIPs/hip-1134-kms-secret-custody.md) | KMS — Secret Custody | Standards Track | Infrastructure | Draft |
| [HIP-1135](./HIPs/hip-1135-legal-documents.md) | Legal — Documents Drafted, Signed and Filed | Standards Track | Interface | Draft |
| [HIP-1136](./HIPs/hip-1136-marketing-lifecycle-email.md) | Marketing — Lifecycle Email | Standards Track | Interface | Draft |
| [HIP-1137](./HIPs/hip-1137-marketplace-listings.md) | Marketplace — Listings and Installs | Standards Track | Interface | Draft |
| [HIP-1140](./HIPs/hip-1140-ml-model-serving.md) | ML — Model Serving | Standards Track | Infrastructure | Draft |
| [HIP-1141](./HIPs/hip-1141-prefs-personal-settings.md) | Prefs — Personal Settings | Standards Track | Interface | Draft |
| [HIP-1142](./HIPs/hip-1142-prompts-versioned-library.md) | Prompts — The Versioned Library | Standards Track | Interface | Draft |
| [HIP-1143](./HIPs/hip-1143-referrals-attribution.md) | Referrals — Attribution | Standards Track | Interface | Draft |
| [HIP-1144](./HIPs/hip-1144-registry-artifact-control-plane.md) | Registry — The Artifact Control Plane | Standards Track | Infrastructure | Draft |
| [HIP-1145](./HIPs/hip-1145-research-experiment-record.md) | Research — The Experiment Record | Standards Track | Infrastructure | Draft |
| [HIP-1146](./HIPs/hip-1146-sandboxes-compute-primitive.md) | Sandboxes — The Compute Primitive | Standards Track | Infrastructure | Draft |
| [HIP-1147](./HIPs/hip-1147-search-hybrid-retrieval.md) | Search — Hybrid Retrieval | Standards Track | Interface | Draft |
| [HIP-1150](./HIPs/hip-1150-seo-search-visibility.md) | SEO — Search Visibility as Data | Standards Track | Interface | Draft |
| [HIP-1151](./HIPs/hip-1151-settings-product-configuration.md) | Settings — Per-Product Org Configuration | Standards Track | Infrastructure | Draft |
| [HIP-1152](./HIPs/hip-1152-share-public-tunnel.md) | Share — A Public URL for a Local Service | Standards Track | Infrastructure | Draft |
| [HIP-1153](./HIPs/hip-1153-social-channel-publishing.md) | Social — Publishing to Connected Channels | Standards Track | Interface | Draft |
| [HIP-1154](./HIPs/hip-1154-sync-endpoint-reconciliation.md) | Sync — Two Endpoints Kept in Step | Standards Track | Infrastructure | Draft |
| [HIP-1155](./HIPs/hip-1155-taxonomy-catalogue-shape.md) | Taxonomy — The Catalogue's Shape | Standards Track | Interface | Draft |
| [HIP-1156](./HIPs/hip-1156-templates-starter-gallery.md) | Templates — The Starter Kit Gallery | Standards Track | Interface | Draft |
| [HIP-1160](./HIPs/hip-1160-todo-work-item-board.md) | Todo — The Work Item Board | Standards Track | Application | Draft |
| [HIP-1161](./HIPs/hip-1161-wallets-key-custody.md) | Wallets — Key Custody | Standards Track | Core | Draft |
| [HIP-1162](./HIPs/hip-1162-world-the-news-feed.md) | World — The News Feed | Standards Track | Application | Draft |
| [HIP-1163](./HIPs/hip-1163-x402-pay-per-request.md) | x402 — Pay Per Request | Standards Track | Core | Draft |
| [HIP-1164](./HIPs/hip-1164-provisioning-stores-on-demand.md) | Provisioning — Stores on Demand | Standards Track | Core | Draft |
| [HIP-1165](./HIPs/hip-1165-s3-buckets-and-objects.md) | S3 — Buckets and Objects | Standards Track | Core | Draft |
| [HIP-1167](./HIPs/hip-1167-dataset-the-versioned-snapshot.md) | Dataset — The Versioned Snapshot | Standards Track | Core | Draft |
| [HIP-1172](./HIPs/hip-1172-visor-compute-you-rent.md) | visor — Compute You Rent | Standards Track | Infrastructure | Draft |
| [HIP-1173](./HIPs/hip-1173-network-the-zero-trust-overlay.md) | Network — The Zero Trust Overlay | Standards Track | Infrastructure | Draft |
| [HIP-1180](./HIPs/hip-1180-link-account-registry.md) | Link — The Account Registry | Standards Track | Core | Draft |
| [HIP-1181](./HIPs/hip-1181-plan-tier-catalog.md) | Plan — The Tier Catalog | Standards Track | Core | Draft |
| [HIP-1189](./HIPs/hip-1189-web3-chain-access.md) | Web3 — Chain Access | Standards Track | Core | Draft |
| [HIP-1190](./HIPs/hip-1190-event-product-analytics.md) | Event — The Product Analytics Plane | Standards Track | Core | Draft |
| [HIP-1198](./HIPs/hip-1198-graph-assertion-plane.md) | Graph — The Assertion Plane | Standards Track | Infrastructure | Draft |
| [HIP-1200](./HIPs/hip-1200-account.md) | Account — The Caller's Own Surface | Standards Track | Application | Draft |
| [HIP-1201](./HIPs/hip-1201-admission.md) | Admission — Launch Control | Standards Track | Platform | Draft |
| [HIP-1202](./HIPs/hip-1202-entitlements.md) | Entitlements — What an Org May Run | Standards Track | Platform | Draft |
| [HIP-1203](./HIPs/hip-1203-affiliates.md) | Affiliates — Commission on Referred Spend | Standards Track | Application | Draft |
| [HIP-1210](./HIPs/hip-1210-agents-define-run-keep.md) | Agents — Define, Run, Keep the Run | Standards Track | Application | Draft |
| [HIP-1211](./HIPs/hip-1211-ai-the-model-api.md) | AI — The Model API | Standards Track | Infrastructure | Draft |
| [HIP-1212](./HIPs/hip-1212-exec-the-code-interpreter.md) | Exec — The Code Interpreter | Standards Track | Infrastructure | Draft |
| [HIP-1213](./HIPs/hip-1213-tools-the-tool-plane.md) | Tools — The Tool Plane | Standards Track | Infrastructure | Draft |
| [HIP-1214](./HIPs/hip-1214-lsp-live-code-intelligence.md) | LSP — Live Code Intelligence | Standards Track | Application | Draft |
| [HIP-1220](./HIPs/hip-1220-commerce-the-merchant-half.md) | Commerce — The Merchant Half | Standards Track | Application | Draft |
| [HIP-1221](./HIPs/hip-1221-treasury-the-reserve-fund.md) | Treasury — The Reserve Fund | Standards Track | Application | Draft |
| [HIP-1222](./HIPs/hip-1222-pricing-the-price-list.md) | Pricing — The Price List and Who May See It | Standards Track | Platform | Draft |
| [HIP-1230](./HIPs/hip-1230-platform-the-container-plane.md) | Platform — The Container Plane | Standards Track | Infrastructure | Draft |
| [HIP-1231](./HIPs/hip-1231-projects-the-site-store.md) | Projects — The Site Store | Standards Track | Application | Draft |
| [HIP-1232](./HIPs/hip-1232-git-repository-hosting.md) | Git — Repository Hosting | Standards Track | Infrastructure | Draft |
| [HIP-1240](./HIPs/hip-1240-o11y-the-observability-plane.md) | O11y — The Observability Plane | Standards Track | Infrastructure | Draft |
| [HIP-1241](./HIPs/hip-1241-metrics-one-store-three-signals.md) | Metrics — One Native Store, Three Signals | Standards Track | Infrastructure | Draft |
| [HIP-1242](./HIPs/hip-1242-leaderboard-who-leads.md) | Leaderboard — Who Uses AI Most | Standards Track | Application | Draft |
| [HIP-1250](./HIPs/hip-1250-integrations-the-connection-registry.md) | Integrations — The Connection Registry | Standards Track | Infrastructure | Draft |
| [HIP-1251](./HIPs/hip-1251-websearch-the-live-web.md) | Websearch — The Live Web | Standards Track | Infrastructure | Draft |
| [HIP-1252](./HIPs/hip-1252-meet-the-join-decision.md) | Meet — The Join Decision | Standards Track | Infrastructure | Draft |
| [HIP-1253](./HIPs/hip-1253-explorer-chain-data.md) | Explorer — Chain Data | Standards Track | Infrastructure | Draft |
| [HIP-1260](./HIPs/hip-1260-knowledge.md) | Knowledge — Wiki and Agent Memory | Standards Track | Application | Draft |
| [HIP-1261](./HIPs/hip-1261-label.md) | Label — Ground Truth | Standards Track | Application | Draft |
| [HIP-1262](./HIPs/hip-1262-reference.md) | Reference — Lookup Sets | Standards Track | Application | Draft |
| [HIP-1310](./HIPs/hip-1310-webhooks-outbound-delivery.md) | Webhooks — Outbound Delivery | Standards Track | Infrastructure | Draft |
| [HIP-1311](./HIPs/hip-1311-experiments-the-ab-plane.md) | Experiments — The A/B Plane | Standards Track | Interface | Draft |
| [HIP-1312](./HIPs/hip-1312-company-the-formation-machine.md) | Company — The Formation Machine | Standards Track | Application | Draft |
| [HIP-1313](./HIPs/hip-1313-usage-the-metered-record.md) | Usage — The Metered Record | Standards Track | Infrastructure | Draft |
| [HIP-1320](./HIPs/hip-1320-admin-the-operator-console.md) | Admin — The Operator Console | Standards Track | Infrastructure | Draft |

## HIP Process

1. **Have an idea** - Discuss with the community
2. **Draft your HIP** - Copy `docs/templates/hip-template.md`
3. **Submit a Pull Request** - To the hanzoai/hips repository
4. **Get reviewed** - HIP editors review for completeness
5. **Build consensus** - Community discussion and feedback
6. **Last Call** - Final 14-day review period
7. **Final** - Accepted as standard

## Types of HIPs

`scripts/lint-hips.py` holds the machine copy of these three vocabularies and
fails the build on any value outside them. This section and that file must agree.

- **Standards Track**: describes one thing we build and maintain. Exactly one
  public repository, and exactly one HIP for it. Requires a category.
- **Process**: how we work — numbering, branch names, what is public. Not 1:1
  with a repository, and not expected to be.
- **Meta**: governance, principles, and commitments.
- **Informational**: guidance that normatively requires nothing.

### Categories

Standards Track HIPs carry exactly one:

`Core` · `Interface` · `Infrastructure` · `Security` · `Cryptography` ·
`Operator` · `Bridge` · `Governance` · `Meta` · `Application` · `Platform`

### Status

| Status | Meaning |
|:-------|:--------|
| `Draft` | Written, not yet reviewed |
| `Review` | Under review by HIP editors |
| `Last Call` | Final 14-day review window |
| `Final` | Accepted as standard; changing it needs a new HIP |
| `Active` | Accepted and continuously updated (living standards) |
| `Superseded` | Replaced; MUST name its successor in `superseded-by` |
| `Withdrawn` | Abandoned by its author |

There is one spelling per state. `Proposed`, `Implemented` and `Accepted` were
each a second name for one of the above and have been folded into it.

## Resources

- Documentation: [docs.hanzo.ai](https://docs.hanzo.ai)
- Discord: [discord.gg/CJCyAsm9Vr](https://discord.gg/CJCyAsm9Vr)
- GitHub: [github.com/hanzoai](https://github.com/hanzoai)
- Twitter: [@hanzoai](https://twitter.com/hanzoai)

## License

All HIPs are released under CC0 1.0 Universal Public Domain Dedication.

---

<div align="center">
  <strong>Building the future of AI infrastructure, one proposal at a time.</strong>
</div>

## Reading order

Every HIP by number is indexed below. This is the order it is learnable in, derived from the corpus rather than curated: a HIP's `requires:` names what a reader must already hold, so what the most HIPs require is what to read first. Regenerated by `scripts/update-index.py`.

### Start here

| | Required by | |
|:--|--:|:--|
| [HIP-0000](./HIPs/hip-0000-hanzo-ai-architecture-framework.md) | — | Hanzo AI Architecture & Framework — the map |
| [HIP-0139](./HIPs/hip-0139-capability.md) | 118 | Capability |
| [HIP-0026](./HIPs/hip-0026-identity-access-management-standard.md) | 116 | Identity & Access Management Standard |
| [HIP-0106](./HIPs/hip-0106-hanzo-plugin-contract.md) | 115 | The Hanzo Plugin Contract |

### Then the invariants

| | Required by | |
|:--|--:|:--|
| [HIP-0027](./HIPs/hip-0027-secrets-management-standard.md) | 23 | Secrets Management Standard |
| [HIP-0119](./HIPs/hip-0119-hanzo-service-conventions.md) | 15 | Hanzo Service Conventions |
| [HIP-0005](./HIPs/hip-0005-post-quantum-security-for-ai-infrastructure.md) | 15 | Post-Quantum Security for AI Infrastructure |
| [HIP-0077](./HIPs/hip-0077-mesh-identity-gossip-and-payments.md) | 11 | Mesh Identity, Gossip & Payments (PQ) |
| [HIP-0111](./HIPs/hip-0111-iam-authentication-standard.md) | 9 | Hanzo IAM Authentication Standard |
| [HIP-0135](./HIPs/hip-0135-what-is-public.md) | 9 | What Is Public |
| [HIP-0084](./HIPs/hip-0084-pulsar-m-dkg.md) | 9 | Pulsar-M — Threshold ML-DSA DKG & Signing |
| [HIP-0302](./HIPs/hip-0302-encrypted-sqlite-replication-standard.md) | 9 | Hanzo Replicate: Encrypted SQLite Durability for Base Services |
| [HIP-0004](./HIPs/hip-0004-llm-gateway-unified-ai-provider-interface.md) | 8 | LLM Gateway - Unified AI Provider Interface |
| [HIP-0079](./HIPs/hip-0079-q-chain-finality-blocks.md) | 8 | Q-Chain — Quasar Finality Block Standard |
| [HIP-0078](./HIPs/hip-0078-z-chain-pq-identity-rollup.md) | 8 | Z-Chain — Post-Quantum Identity & Attestation Rollup |
| [HIP-0105](./HIPs/hip-0105-in-process-extension-runtime-standard.md) | 7 | In-Process Extension Runtime Standard |
| [HIP-0114](./HIPs/hip-0114-zap-inter-vm-cognitive-transport.md) | 7 | ZAP — Inter-VM Cognitive Transport for Thinking Chains |
| [HIP-0519](./HIPs/hip-0519-one-identity-boundary.md) | 7 | One Identity Boundary |
| [HIP-0118](./HIPs/hip-0118-superadmin-and-tenant-isolation-model.md) | 6 | SuperAdmin & Tenant Isolation Model |
| [HIP-0128](./HIPs/hip-0128-resource-surface-standard.md) | 5 | Resource Surface Standard — Generated REST over ZAP |
| [HIP-0068](./HIPs/hip-0068-ingress-standard.md) | 5 | Ingress Standard |
| [HIP-0085](./HIPs/hip-0085-wallet-pq-account-type.md) | 5 | Wallet PQ Account Type (ML-DSA-65 native, 48-byte AccountID) |
| [HIP-0120](./HIPs/hip-0120-zap-native-transport-and-grpc-elimination.md) | 5 | ZAP-Native Transport & gRPC Elimination |
| [HIP-0126](./HIPs/hip-0126-integrations-connectors-and-the-extension-runtime.md) | 5 | Integrations, Connectors & the Extension Runtime — One Registry, One Way |

### The capabilities

One capability, one HIP (HIP-0139). 115 of them, grouped as `capabilities.yaml` groups them.

**Identity & Trust** — who you are · what you may touch · where secrets live

[HIP-0026](./HIPs/hip-0026-identity-access-management-standard.md) `iam` · [HIP-1041](./HIPs/hip-1041-authz.md) `authz` · [HIP-1046](./HIPs/hip-1046-risk.md) `risk` · [HIP-1047](./HIPs/hip-1047-security-scanning.md) `security` · [HIP-1048](./HIPs/hip-1048-team.md) `team` · [HIP-1049](./HIPs/hip-1049-validators.md) `validators` · [HIP-1103](./HIPs/hip-1103-audit-tamper-evident-trail.md) `audit` · [HIP-1115](./HIPs/hip-1115-compliance.md) `compliance` · [HIP-1134](./HIPs/hip-1134-kms-secret-custody.md) `kms` · [HIP-1161](./HIPs/hip-1161-wallets-key-custody.md) `wallets` · [HIP-1167](./HIPs/hip-1167-dataset-the-versioned-snapshot.md) `dataset` · [HIP-1200](./HIPs/hip-1200-account.md) `account` · [HIP-1202](./HIPs/hip-1202-entitlements.md) `entitlements` · [HIP-1261](./HIPs/hip-1261-label.md) `label` · [HIP-1262](./HIPs/hip-1262-reference.md) `reference` · [HIP-1320](./HIPs/hip-1320-admin-the-operator-console.md) `admin`

**Intelligence** — models · agents · evaluation — the mind of the cloud

[HIP-0129](./HIPs/hip-0129-eval-the-judgment-plane.md) `evals` · [HIP-0516](./HIPs/hip-0516-translate.md) `translate` · [HIP-1102](./HIPs/hip-1102-ask-grounded-answer.md) `ask` · [HIP-1105](./HIPs/hip-1105-benchmark-measurement-arena.md) `benchmark` · [HIP-1114](./HIPs/hip-1114-code.md) `code` · [HIP-1124](./HIPs/hip-1124-engine-runtime-lens.md) `engine` · [HIP-1140](./HIPs/hip-1140-ml-model-serving.md) `ml` · [HIP-1142](./HIPs/hip-1142-prompts-versioned-library.md) `prompts` · [HIP-1145](./HIPs/hip-1145-research-experiment-record.md) `research` · [HIP-1146](./HIPs/hip-1146-sandboxes-compute-primitive.md) `sandboxes` · [HIP-1210](./HIPs/hip-1210-agents-define-run-keep.md) `agents` · [HIP-1211](./HIPs/hip-1211-ai-the-model-api.md) `ai` · [HIP-1212](./HIPs/hip-1212-exec-the-code-interpreter.md) `exec` · [HIP-1213](./HIPs/hip-1213-tools-the-tool-plane.md) `tools` · [HIP-1214](./HIPs/hip-1214-lsp-live-code-intelligence.md) `lsp`

**Data** — the stores every capability writes to and reads from

[HIP-1104](./HIPs/hip-1104-base-hosted-backend.md) `base` · [HIP-1112](./HIPs/hip-1112-catalog.md) `catalog` · [HIP-1117](./HIPs/hip-1117-crawl.md) `crawl` · [HIP-1132](./HIPs/hip-1132-index-search.md) `index` · [HIP-1147](./HIPs/hip-1147-search-hybrid-retrieval.md) `search` · [HIP-1154](./HIPs/hip-1154-sync-endpoint-reconciliation.md) `sync` · [HIP-1155](./HIPs/hip-1155-taxonomy-catalogue-shape.md) `taxonomy` · [HIP-1164](./HIPs/hip-1164-provisioning-stores-on-demand.md) `provisioning` · [HIP-1165](./HIPs/hip-1165-s3-buckets-and-objects.md) `s3` · [HIP-1251](./HIPs/hip-1251-websearch-the-live-web.md) `websearch` · [HIP-1260](./HIPs/hip-1260-knowledge.md) `knowledge`

**Streams** — messaging · durable tasks · async orchestration

[HIP-0061](./HIPs/hip-0061-notification-service-standard.md) `notify` · [HIP-1060](./HIPs/hip-1060-pubsub-the-tenant-door-on-the-bus.md) `pubsub` · [HIP-1061](./HIPs/hip-1061-mq-queues-and-streams.md) `mq` · [HIP-1062](./HIPs/hip-1062-tasks-the-durable-run.md) `tasks` · [HIP-1063](./HIPs/hip-1063-auto-flows-that-run-themselves.md) `auto` · [HIP-1064](./HIPs/hip-1064-flow-the-canvas-plane.md) `flow` · [HIP-1066](./HIPs/hip-1066-channels-one-inbox.md) `channels` · [HIP-1067](./HIPs/hip-1067-destinations-conversions-forwarded.md) `destinations` · [HIP-1069](./HIPs/hip-1069-tel-numbers-calls-and-messages.md) `tel` · [HIP-1250](./HIPs/hip-1250-integrations-the-connection-registry.md) `integrations` · [HIP-1310](./HIPs/hip-1310-webhooks-outbound-delivery.md) `webhooks`

**Observability** — see everything — telemetry · analytics · usage

[HIP-1030](./HIPs/hip-1030-openapi-the-served-contract.md) `openapi` · [HIP-1190](./HIPs/hip-1190-event-product-analytics.md) `event` · [HIP-1240](./HIPs/hip-1240-o11y-the-observability-plane.md) `o11y` · [HIP-1241](./HIPs/hip-1241-metrics-one-store-three-signals.md) `metrics` · [HIP-1242](./HIPs/hip-1242-leaderboard-who-leads.md) `leaderboard` · [HIP-1313](./HIPs/hip-1313-usage-the-metered-record.md) `usage`

**Commerce** — the economy — meter · price · bill · reward

[HIP-0018](./HIPs/hip-0018-payment-processing-standard.md) `billing` · [HIP-1000](./HIPs/hip-1000-authors-royalty.md) `authors` · [HIP-1001](./HIPs/hip-1001-books-double-entry-ledger.md) `books` · [HIP-1004](./HIPs/hip-1004-licensing.md) `licensing` · [HIP-1100](./HIPs/hip-1100-ads-paid-campaigns.md) `ads` · [HIP-1101](./HIPs/hip-1101-allowance-free-ceiling.md) `allowance` · [HIP-1110](./HIPs/hip-1110-campaign.md) `campaign` · [HIP-1111](./HIPs/hip-1111-captable.md) `captable` · [HIP-1120](./HIPs/hip-1120-crm-sales-pipeline.md) `crm` · [HIP-1136](./HIPs/hip-1136-marketing-lifecycle-email.md) `marketing` · [HIP-1137](./HIPs/hip-1137-marketplace-listings.md) `marketplace` · [HIP-1143](./HIPs/hip-1143-referrals-attribution.md) `referrals` · [HIP-1163](./HIPs/hip-1163-x402-pay-per-request.md) `x402` · [HIP-1181](./HIPs/hip-1181-plan-tier-catalog.md) `plan` · [HIP-1203](./HIPs/hip-1203-affiliates.md) `affiliates` · [HIP-1220](./HIPs/hip-1220-commerce-the-merchant-half.md) `commerce` · [HIP-1221](./HIPs/hip-1221-treasury-the-reserve-fund.md) `treasury` · [HIP-1222](./HIPs/hip-1222-pricing-the-price-list.md) `pricing` · [HIP-1311](./HIPs/hip-1311-experiments-the-ab-plane.md) `experiments`

**Platform** — the cloud fabric — deploy · provision · route · host

[HIP-0063](./HIPs/hip-0063-feature-flags-standard.md) `flags` · [HIP-1113](./HIPs/hip-1113-cloudflare.md) `cloudflare` · [HIP-1122](./HIPs/hip-1122-deploy-gitops-plane.md) `deploy` · [HIP-1123](./HIPs/hip-1123-domain-registration.md) `domain` · [HIP-1127](./HIPs/hip-1127-gateway-edge-policy.md) `gateway` · [HIP-1133](./HIPs/hip-1133-ingress-embedded-edge.md) `ingress` · [HIP-1144](./HIPs/hip-1144-registry-artifact-control-plane.md) `registry` · [HIP-1172](./HIPs/hip-1172-visor-compute-you-rent.md) `visor` · [HIP-1173](./HIPs/hip-1173-network-the-zero-trust-overlay.md) `network` · [HIP-1201](./HIPs/hip-1201-admission.md) `admission` · [HIP-1230](./HIPs/hip-1230-platform-the-container-plane.md) `platform` · [HIP-1231](./HIPs/hip-1231-projects-the-site-store.md) `projects`

**Applications** — the user-facing surfaces built on all of the above

[HIP-0060](./HIPs/hip-0060-serverless-functions-standard.md) `functions` · [HIP-0074](./HIPs/hip-0074-software-bill-of-materials-standard.md) `sbom` · [HIP-1106](./HIPs/hip-1106-blueprint-priced-stack.md) `blueprint` · [HIP-1107](./HIPs/hip-1107-bot-machines-and-runs.md) `bot` · [HIP-1116](./HIPs/hip-1116-content.md) `content` · [HIP-1121](./HIPs/hip-1121-dataroom-shared-documents.md) `dataroom` · [HIP-1125](./HIPs/hip-1125-esign-signatures.md) `esign` · [HIP-1126](./HIPs/hip-1126-framework-doctype-engine.md) `framework` · [HIP-1130](./HIPs/hip-1130-guide-launch-journey.md) `guide` · [HIP-1131](./HIPs/hip-1131-help-support-desk.md) `help` · [HIP-1135](./HIPs/hip-1135-legal-documents.md) `legal` · [HIP-1141](./HIPs/hip-1141-prefs-personal-settings.md) `prefs` · [HIP-1150](./HIPs/hip-1150-seo-search-visibility.md) `seo` · [HIP-1151](./HIPs/hip-1151-settings-product-configuration.md) `settings` · [HIP-1152](./HIPs/hip-1152-share-public-tunnel.md) `share` · [HIP-1153](./HIPs/hip-1153-social-channel-publishing.md) `social` · [HIP-1156](./HIPs/hip-1156-templates-starter-gallery.md) `templates` · [HIP-1160](./HIPs/hip-1160-todo-work-item-board.md) `todo` · [HIP-1162](./HIPs/hip-1162-world-the-news-feed.md) `world` · [HIP-1180](./HIPs/hip-1180-link-account-registry.md) `link` · [HIP-1232](./HIPs/hip-1232-git-repository-hosting.md) `git` · [HIP-1252](./HIPs/hip-1252-meet-the-join-decision.md) `meet` · [HIP-1312](./HIPs/hip-1312-company-the-formation-machine.md) `company`

**Chain** — the networks the cloud speaks to — enumerate · call · read balances

[HIP-1189](./HIPs/hip-1189-web3-chain-access.md) `web3` · [HIP-1253](./HIPs/hip-1253-explorer-chain-data.md) `explorer`
