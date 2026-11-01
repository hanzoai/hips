---
hip: 1336
title: Patent — Inventorship Conception Provenance & Tamper-Evident Conception Ledger
author: Hanzo AI Team
type: Standards Track
category: Application
status: Final
capability: patent
implementation-go: shipped
created: 2026-11-01
requires: HIP-0106, HIP-0118, HIP-0136, HIP-0512
---

# HIP-1336: Patent — Inventorship Conception Provenance & Tamper-Evident Conception Ledger

## Abstract

Package `patent` (`/v1/patent`) provides a contemporaneous, tamper-evident record of human conception versus machine execution for patentable inventions developed using AI coding agents and autonomous models. Governed by the USPTO's Revised Inventorship Guidance for AI-Assisted Inventions and *Thaler v. Vidal*, 43 F.4th 1207 (Fed. Cir. 2022), patent inventorship requires proof of a definite and permanent operative idea formed in a human mind prior to tool application (*Pfaff v. Wells*, 525 U.S. 55).

This specification standardizes the append-only ledger for human Idea entries, machine Implementation records, and assembled Disclosures with role-gated approvals.

## Motivation

AI-assisted software development creates an acute evidentiary challenge: source code and git commit histories demonstrate physical reduction to practice, but fail to establish human conception. A git log whose sequence is controlled by its author is an editable draft, not legal evidence. 

Under 35 U.S.C. §115, inventorship oaths must be executed by natural persons. When autonomous agents generate large swathes of novel algorithms or architectures, an applicant must be able to prove to an examiner or a court that a natural person conceived the operative mechanism before the prompt was dispatched. Without a verifiable, monotonic append-only ledger tying human problem formulation directly to machine execution, claims risk rejection for lack of human inventorship.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as in RFC 2119.

### 1. The Three Kinds and Graph Edges

The patent plane records three core entity types within the tenant's sovereign database:

1. **Idea (`idea`)**: A human conception entry documenting the problem, alternatives evaluated, rejected mechanisms, and claimed architectural decisions in the inventor's prose.
   * Closed kind set: `problem`, `alternative`, `architecture`, `mechanism`, `decision`, `rejection`.
   * Rejections are explicitly tracked as evidence that a specific solution was deliberately selected rather than stochastically emitted.
2. **Implementation (`implementation`)**: A record of machine execution detailing the commit SHA, model identifier, prompt digest, and an explicit list of human `idea` IDs it implements.
   * An implementation without cited human idea IDs indicates machine-first origination.
3. **Disclosure (`disclosure`)**: The assembled patent disclosure citing specific idea and implementation IDs, accompanied by cryptographic role-gated approvals (`author`, `cto`, `reviewer`, `attorney`, `counsel`).
   * Decisions: `approved`, `rejected`, `needs-work`.

### 2. Monotonic Append-Only Ledger

* Records MUST be written to the tenant's encrypted per-org SQLite database (`_entities` table).
* Every record is assigned a monotonic sequential sequence number (`seq`) and a content hash computed strictly by the server.
* Modifications MUST append a new version; prior versions are permanently retained and immutable.
* Client timestamps and client sequence numbers MUST NOT be trusted.

### 3. Proof Verification (`GET /v1/patent/proof`)

The endpoint `GET /v1/patent/proof` folds the organization's invention records in append order into a cryptographic root:
* Verifies whether every cited `idea` strictly precedes the `implementation` that depends upon it.
* Emits a verification status: `verified`, `inverted` (implementation preceded idea), or `unanchored` (when external hardware/blockchain attestation is unconfigured).

### 4. HTTP Endpoints

| Method | Path | Description |
|:---|:---|:---|
| `GET` | `/v1/patent/ideas` | List recorded human conception ideas |
| `POST` | `/v1/patent/ideas` | Record a human conception entry |
| `GET` | `/v1/patent/implementations` | List machine implementation records |
| `POST` | `/v1/patent/implementations` | Link an AI execution run to human idea IDs |
| `GET` | `/v1/patent/disclosures` | List assembled disclosures |
| `POST` | `/v1/patent/disclosures` | Create a disclosure bundle |
| `POST` | `/v1/patent/disclosures/:id/approve` | Submit role-gated sign-off |
| `GET` | `/v1/patent/proof` | Generate cryptographic inventorship proof |
