---
hip: 1342
title: Sensei — L1–L9 Certification Standard, sensei.group Gate & Agent-to-Human Hiring Protocol
author: Hanzo AI
type: Standards Track
category: Platform
status: Draft
implementation-go: partial
created: 2026-11-19
requires: HIP-0024, HIP-0097, HIP-0119, HIP-1332, HIP-1335, HIP-1340
---

# HIP-1342: Sensei — L1–L9 Certification Standard, sensei.group Gate & Agent-to-Human Hiring Protocol

## Abstract

This proposal specifies the **Hanzo Sensei Certification Standard**, the nine-level engineering competency ladder (**L1–L9**) delivered through **Hanzo University** (`hanzo.university`, authored in `hanzo-docs/docs`), the cryptographic **L3+ marketplace gate** enforced by **`sensei.group`** (`hanzoai/sensei.group`) as a curated human specialist lens over `hanzo.market` (`hanzoai/market`), on-chain credential attestation on **Hanzo Network** (EVM Chain ID `36963`, HIP-0024), and the **Agent-to-Human Hiring Protocol** (`POST /v1/sensei/hire` and MCP tool `hire_sensei`) through which autonomous AI agents escalate bounded tasks and contract verified L3–L9 human Senseis.

Foundational mastery (**L1–L3**) MUST remain free forever to maximize global developer onboarding into certified agentic engineering. Advanced specialization exams (**L4–L9**) are priced at `$100` per proctored certification attempt, paired with an optional monthly courseware subscription unlocking interactive compute sandboxes, multi-GPU training environments, and study laboratories across all nine levels.

## Motivation

Two structural failures limit collaboration between autonomous AI agents and human domain specialists:

1. **Unverifiable human credentials.** Resumes and self-reported titles provide no machine-verifiable guarantee that a practitioner can operate deterministic MCP loops, isolate sovereign microVMs, debug zero-copy wire frames, or align frontier models without regressions. When an enterprise buyer or an autonomous agent contracts a human specialist on an open marketplace, unvetted listings create unacceptable operational and security risk.
2. **Missing machine-callable escalation rails.** Autonomous agents (`hanzo dev`, `hanzo team`) routinely encounter irreversible security sign-offs, novel distributed systems faults, legal privilege boundaries, or sub-threshold Kai calibration scores (HIP-1332). Without a typed API and MCP contract to discover, clear, escrow, and hire verified human specialists, autonomous workflows either stall silently or proceed unsafely past their competence envelope.

Defining a single nine-tier competency standard (`L1–L9`), anchoring credentials to `did:hanzo:` principals (HIP-0097) on Hanzo Network (`36963`), enforcing `minLevel >= 3` at `sensei.group`, and exposing a deterministic `hire_sensei` protocol resolves both problems under one auditable specification.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as in RFC 2119.

### 1. Competency Hierarchy (L1–L9)

The Sensei standard defines nine cumulative engineering levels grouped into three tracks: **Foundation (L1–L3)**, **Systems & Cloud (L4–L6)**, and **Frontier Machine Learning (L7–L9)**.

| Level | Designation | Normative Competency Scope | Marketplace Gate |
| :--- | :--- | :--- | :--- |
| **L1** | Associate | Enso workspace state design, Kai calibrated probability decisions (`/v1/decisions`), Zen 6 model selection (`zen6`, `zen6-flash`, `zen6-max`, `zen6-coder`, `zen6-free`, `zen-vl`), and strict JSON Schema prompting | `hanzo.id` L1 credential |
| **L2** | Practitioner | Closed-loop agentic coding (`hanzo dev`), MCP server authoring and security (`npx -y hanzo mcp`), local `hanzod` daemon operation, and automated test verification | Eligible to publish MCP skills on `hanzo.market` |
| **L3** | **Certified Sensei** | Full-stack Hanzo OS applications, Hanzo Base (`/v1/base`, `/v1/schema`), IAM PKCE integration, multi-channel Bots, and verified domain templates (`job-crm`, `content-crm`, `trade-crm`, `legal-discovery`) | **Unlocks `sensei.group` (`minLevel >= 3`) & `hire_sensei` eligibility** |
| **L4** | Systems Sensei | High-performance distributed systems, Zero-Copy App Proto (`zap-proto.io`), arena memory layouts, zero-allocation IPC/RPC routing, and polyglot ZAP bindings | `sensei.group` L4+ tier |
| **L5** | Cloud Sensei | Sovereign cloud orchestration (`hanzo up`), Visor / Kata / Firecracker microVM isolation, KMS measured-boot secret release, hardware TEE confidential compute attestation, and post-quantum PKI (`hanzo-ca`) | `sensei.group` L5+ tier |
| **L6** | Swarm Sensei | Multi-agent DAG orchestration, git worktree isolation, Byzantine-resilient agent consensus, Kai arbitration gates, spend allowances, and `hire_sensei` escalation design | `sensei.group` L6+ tier |
| **L7** | Fine-Tuning Sensei | Corpus deduplication and decontamination, execution-verified synthetic trajectory generation, LoRA, QLoRA (`NF4`), and 1-bit **BitDelta** multi-tenant weight-delta serving | `sensei.group` L7+ tier |
| **L8** | Alignment Sensei | Post-training alignment in `hanzo-ml`: SFT diagnostics, Direct Preference Optimization (DPO), reward modeling (RLHF), and Group Relative Policy Optimization (**GRPO**) with verifiable sandbox rewards | `sensei.group` L8+ tier |
| **L9** | Principal Fellow | Custom frontier model architecture on **Zen / `qwen3+`** backbones (`Qwen3ForCausalLM`, `Qwen3MoeForCausalLM`), 4D distributed pre-training, Model Soups (SLERP, DARE-TIES), and calibrated FP8 / AWQ / GGUF quantization | `sensei.group` L9 Principal Fellow tier |

#### 1.1 Zen Frontier Backbone Invariant

All L7–L9 training, merging, and quantization curricula and grading harnesses targeting Zen language models MUST exclusively use **`qwen3+`** model architectures and tokenizers (alongside next-generation Zen Hamiltonian/hybrid architectures). Implementations and courseware MUST NOT target or ship legacy pre-`qwen3` checkpoints.

### 2. Tuition, Examination Fees & Compute Subscriptions

To keep entry accessible while funding isolated hardware grading clusters:

1. **L1–L3 Free Forever**: Courseware, local verification harnesses, and credential issuance for **L1**, **L2**, and **L3** MUST be offered at `$0` (`Free Forever`) on `hanzo.university` and `docs.hanzo.ai/docs/university`.
2. **L4–L9 Proctored Exam Fee (`$100` / Attempt)**: Each proctored practical certification attempt for **L4**, **L5**, **L6**, **L7**, **L8**, or **L9** MUST charge a flat `$100` USD-equivalent fee settled via Hanzo Commerce (`/v1/billing` or USDC/AI on Chain ID `36963`) prior to provisioning the isolated exam cluster.
3. **Optional Monthly Courseware Subscription**: Hanzo University MAY offer a recurring monthly subscription that unlocks managed browser microVMs, ZAP benchmark nodes, and multi-GPU `hanzo-ml` training sandboxes across L1–L9. Holding a monthly subscription MUST NOT bypass practical exam grading criteria; every candidate MUST pass the deterministic verification harness for the target level.

### 3. On-Chain Credential Attestation (`eip155:36963`)

Every earned Sensei certification MUST be issued as a W3C Verifiable Credential bound to the candidate's `did:hanzo:<subject>` identifier (HIP-0097) AND anchored on **Hanzo Network** (EVM Chain ID `36963`, HIP-0024):

```json
{
  "@context": ["https://www.w3.org/ns/credentials/v2"],
  "type": ["VerifiableCredential", "HanzoSenseiCredential"],
  "issuer": "did:hanzo:university",
  "validFrom": "2026-11-19T00:00:00Z",
  "credentialSubject": {
    "id": "did:hanzo:alice",
    "senseiLevel": 3,
    "designation": "Certified Sensei",
    "examDigest": "0x8b4e9c1a7f32d00491e2b8c4f61a7d33e90211c8a4b7d6e5f0123456789abcde",
    "chain": "eip155:36963"
  }
}
```

1. **Registry Verification**: Verifiers (`sensei.group`, `hanzo.market`, and external callers) MUST reject any Sensei claim whose on-chain attestation on Chain ID `36963` is absent, expired, or marked revoked by `did:hanzo:university`.
2. **Cumulative Monotonicity**: A candidate MUST hold valid level `L - 1` before an attestation for level `L` (`2 <= L <= 9`) is minted.

### 4. The `sensei.group` L3+ Marketplace Lens

`hanzo.market` (HIP-1335) indexes all public ecosystem listings. **`sensei.group`** (`hanzoai/sensei.group`) operates as a strict, curated human-specialist lens over `hanzo.market` subject to the following invariants:

1. **Minimum Level Gate (`minLevel >= 3`)**: `sensei.group` directory queries, category feeds, and matching endpoints MUST enforce `senseiLevel >= 3`. Profiles with `senseiLevel < 3` (unverified, L1, or L2) MUST NOT appear in `sensei.group` search results or hiring pools.
2. **Visible Badge Provenance**: Every specialist card and profile rendered on `sensei.group` MUST display the practitioner's highest verified badge (`L3` through `L9`), domain specializations, and `did:hanzo:` attestation reference.
3. **Unified Escrow & Principal Clearance**: Hiring a Sensei through `sensei.group` settles through the `hanzo.market` job escrow lifecycle (`/v1/marketplace/jobs`) gated by synchronous `principal` clearance (`POST /v1/principal/clearance`, HIP-1340) on `eip155:36963`.

### 5. Agent-to-Human Hiring Protocol (`hire_sensei`)

Autonomous AI agents (`hanzo dev`, `hanzo team`, custom MCP clients) escalate tasks and contract certified human Senseis via HTTP (`POST /v1/sensei/hire`) or the corresponding MCP tool `hire_sensei`.

#### 5.1 Request Schema

A request with `minLevel < 3` MUST be rejected with HTTP `422 Unprocessable Entity` and error code `sensei_level_below_gate`.

```json
{
  "attempt": "0x4f91a2c80e7b3d1652a09c44e8b71f3390d2c5a1847e6b2039f1c8d4e5a6b701",
  "minLevel": 5,
  "domain": "confidential-compute",
  "title": "Audit SEV-SNP KMS key-release policy before production cutover",
  "contextUri": "https://git.hanzo.ai/acme/sovereign-deploy/pulls/42",
  "acceptanceCriteria": [
    "Verify PCR/RTMR policy rejects unsigned initramfs digests",
    "Sign principal attestation statement upon completion"
  ],
  "maxBudgetUsdc": "600.00",
  "deadlineSeconds": 86400,
  "escalationReason": {
    "kaiConfidence": 0.61,
    "threshold": 0.90,
    "trigger": "security_boundary_signoff"
  }
}
```

#### 5.2 MCP Tool Descriptor (`hire_sensei`)

Every `sensei.group`-enabled MCP surface MUST advertise `hire_sensei` with the following input constraints:

| Field | Type | Constraint |
| :--- | :--- | :--- |
| `minLevel` | integer | Required; integer in `[3, 9]`. Values `< 3` MUST be refused. |
| `domain` | string | Required; canonical domain slug (`engineering`, `ai-ml`, `architecture`, `distributed-systems`, `confidential-compute`, `security`, `design`, `product`). |
| `title` | string | Required; `10..200` UTF-8 characters summarizing the human deliverable. |
| `acceptanceCriteria` | array of strings | Required; `1..20` falsifiable verification checks or commands. |
| `maxBudgetUsdc` | decimal string | Required; positive decimal bounded by the calling agent's `/v1/allowance` grant. |
| `deadlineSeconds` | integer | Optional; `300..2592000` (5 minutes to 30 days). |
| `attempt` | hex string | Required on HTTP (`0x` + 64 hex chars) for idempotent job creation across retries. |

#### 5.3 Lifecycle & Resolution

1. **Allowance & Principal Pre-Check**: The gateway verifies that the calling agent's API key holds `spend` permission within its remaining `/v1/allowance` ceiling and obtains a `Clearance` decision (`HIP-1340`).
2. **Escrow Lock & Matching**: Funds lock into job escrow on `eip155:36963`, and eligible human practitioners holding `senseiLevel >= minLevel` receive signed dispatch notifications.
3. **Deliverable Verification & Settlement**: The contracted Sensei submits the signed artifact or pull request; automated checks (and Kai rubric verification where configured) confirm `acceptanceCriteria`, releasing escrowed funds to the Sensei's `did:hanzo:` payout address and returning the structured resolution payload to the waiting agent workflow.

### 6. HTTP Endpoints

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/v1/sensei/roster` | List verified Senseis filtered by `minLevel` (`>= 3`, default `3`), `domain`, and availability |
| `GET` | `/v1/sensei/credentials/:did` | Resolve active L1–L9 Verifiable Credentials and Chain `36963` attestation status for a `did:hanzo:` subject |
| `POST` | `/v1/sensei/hire` | Create or resume an idempotent Agent-to-Human Sensei hiring & escrow job (`minLevel >= 3`) |
| `GET` | `/v1/sensei/jobs/:id` | Poll status, human deliverable artifacts, and verification receipts for an active Sensei engagement |

## Rationale

- **Free L1–L3 vs. `$100` L4–L9**: Making L1–L3 free removes financial barriers for capable engineers worldwide to learn the Hanzo OS stack and qualify for `sensei.group` (`L3`). Conversely, L4–L9 evaluations spin up dedicated multi-core ZAP clusters, hardware TEE instances, and multi-GPU `hanzo-ml` nodes; a `$100` per-attempt exam fee deters automated Sybil grinding and covers isolated grading compute while keeping certification an order of magnitude more accessible than legacy vendor bootcamps.
- **Lens over `hanzo.market` rather than a siloed ledger**: Implementing `sensei.group` as a `minLevel >= 3` lens over `/v1/marketplace` and `/v1/principal` reuses one battle-tested escrow, tax-clearance (HIP-1338, HIP-1340), and DID registry (HIP-0097) instead of maintaining duplicate settlement contracts.

## Security Considerations

- **Agent Budget Exhaustion**: A compromised or hallucinating agent loop invoking `hire_sensei` repeatedly could drain organizational funds. Implementations MUST bind `hire_sensei` to explicit per-key `/v1/allowance` ceilings, require idempotent `attempt` nonces, and reject calls from keys lacking the `spend` capability grant (HIP-1335).
- **Credential Forgery & Replay**: Accepting client-supplied badge claims in UI or API requests allows unvetted actors to impersonate L3+ Senseis. `sensei.group` and `/v1/sensei/hire` MUST resolve `senseiLevel` exclusively from issuer-signed attestations anchored on Chain ID `36963` and check revocation bitmaps before matching.
- **Exam Sandbox Escape**: L4–L9 practical exams execute candidate-supplied code and kernels. Grading harnesses MUST run inside ephemeral hardware-isolated microVMs (`kata-fc` / `visor`) with no ambient credentials and strict egress blocks.
- **Prompt Injection via Deliverable Return**: Human-submitted text or code returned to an autonomous agent could carry adversarial instructions. Agents resuming from `/v1/sensei/jobs/:id` SHOULD treat returned artifacts as untrusted inputs validated through deterministic compiler, test, and schema gates.

## References

- HIP-0024 — Hanzo Sovereign L1 Chain Architecture (`chainId: 36963`)
- HIP-0097 — Node Identity and the `did:hanzo:` DID Method
- HIP-0119 — Hanzo Service Conventions
- HIP-1332 — Kai: The Decision Model
- HIP-1335 — Listings: One Market for Apps, Skills, Mods, Plugins, Automations and Packs
- HIP-1340 — Principal: Cryptographic Identity Statements & Authorization Clearance Plane

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
