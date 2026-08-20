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
| [HIP-0063](./HIPs/hip-0063-feature-flags-standard.md) | Feature Flags & Experimentation Standard | Standards Track | Interface | Draft |
| [HIP-0064](./HIPs/hip-0064-log-aggregation-standard.md) | Log Aggregation & Search Standard | Standards Track | Infrastructure | Draft |
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
| [HIP-0901](./HIPs/hip-0901-proof-of-ai-native-execution-proofs.md) | Proof of AI (PoAI) — Native Execution Proofs, Canoni... | Standards Track | Core | Active |
| [HIP-0902](./HIPs/hip-0902-proof-of-code.md) | Proof of Code — Consensus over Git Refs | Standards Track | Core | Draft |
| [HIP-0903](./HIPs/hip-0903-agentic-company.md) | The Agentic Company — Autonomous Firms on Hanzo | Informational | Meta | Draft |
| [HIP-1000](./HIPs/hip-1000-authors-royalty.md) | Authors — A Royalty on Deployed Open Source | Standards Track | Application | Active |
| [HIP-1001](./HIPs/hip-1001-books-double-entry-ledger.md) | Books — The Double-Entry Ledger | Standards Track | Application | Active |
| [HIP-1002](./HIPs/hip-1002-cart.md) | Cart — The Basket a Sale Begins In | Standards Track | Application | Draft |
| [HIP-1003](./HIPs/hip-1003-enablement.md) | Enablement — Off, Beta, GA | Standards Track | Platform | Active |
| [HIP-1004](./HIPs/hip-1004-licensing.md) | Licensing — Signed Tokens for Paid Binaries | Standards Track | Security | Draft |
| [HIP-1005](./HIPs/hip-1005-payments.md) | Payments — Taking a Card | Standards Track | Application | Active |
| [HIP-1006](./HIPs/hip-1006-store.md) | Store — Storefronts, Listings and Checkout | Standards Track | Application | Active |
| [HIP-1020](./HIPs/hip-1020-chain-registry.md) | Chain Registry | Standards Track | Interface | Draft |
| [HIP-1021](./HIPs/hip-1021-chain-rpc-door.md) | Chain JSON-RPC Door | Standards Track | Interface | Draft |
| [HIP-1022](./HIPs/hip-1022-native-balance-reads.md) | Native Balance Reads | Standards Track | Interface | Draft |
| [HIP-1030](./HIPs/hip-1030-openapi-the-served-contract.md) | OpenAPI — The Served Contract | Standards Track | Interface | Active |
| [HIP-1031](./HIPs/hip-1031-commands-the-callable-projection.md) | Commands — The Callable Projection | Standards Track | Interface | Draft |
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
| [HIP-1068](./HIPs/hip-1068-tags-the-browser-half.md) | Tags — The Browser Half | Standards Track | Interface | Draft |
| [HIP-1069](./HIPs/hip-1069-tel-numbers-calls-and-messages.md) | Tel — Numbers, Calls and Messages | Standards Track | Interface | Draft |
| [HIP-1070](./HIPs/hip-1070-git-webhook-the-push-door.md) | Git Webhook — The Push Door | Standards Track | Infrastructure | Draft |
| [HIP-1071](./HIPs/hip-1071-pipelines-a-derived-board.md) | Pipelines — A Derived Board | Standards Track | Interface | Draft |

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
