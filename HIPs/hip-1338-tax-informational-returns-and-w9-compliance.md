---
hip: 1338
title: Tax — Informational Returns, Tax Profiles & Form 1099 Compliance
author: Hanzo AI Team
type: Standards Track
category: Application
status: Final
capability: tax
implementation-go: shipped
created: 2026-11-01
requires: HIP-0106, HIP-0118, HIP-0136, HIP-1001, HIP-1220
---

# HIP-1338: Tax — Informational Returns, Tax Profiles & Form 1099 Compliance

## Abstract

Package `tax` (`/v1/tax`) governs how organizations and entities operating on Hanzo commerce rails exchange tax identification profiles (Form W-9, Form W-8BEN, Form W-8BEN-E), classify transactions, prepare informational returns (Form 1099-NEC, Form 1099-MISC), and generate electronic submission bundles for tax compliance.

This proposal specifies the dual payer/payee model, cryptographic sealing of Taxpayer Identification Numbers (TINs) via Hanzo KMS, and cross-organization grant protocols.

## Motivation

Autonomous agentic commerce, headless payments, and marketplace transactions generate complex reporting obligations across multiple jurisdictions. Companies transacting on Hanzo rails must furnish annual Copy B statements to payees and report payments to tax authorities. 

Storing unencrypted TINs or relying on third-party SaaS tax processors introduces catastrophic data leakage risks. Furthermore, manual collection of W-9 forms creates operational friction that stalls agent transactions. A sovereign, self-contained tax subsystem is required to automate transaction classification, seal credentials under organization KMS master keys, and provide verifiable audit trails.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as in RFC 2119.

### 1. Dual Payer / Payee Architecture

Every organization formed on Hanzo functions in dual roles:
* **As Payee**: Maintains a single active tax profile (W-9 for domestic U.S. persons; W-8BEN / W-8BEN-E for foreign individuals and entities). Controls which payers are granted access to read certification details and receives furnished Copy B statements in its inbox.
* **As Payer**: Requests counterparty tax documentation, ingests settled transactions from the event and books plane (`hanzoai/treasury`), classifies reportable amounts, drafts 1099-NEC / 1099-MISC returns for payees exceeding annual thresholds, and exports the IRS IRIS transmission bundle.

### 2. TIN Encryption via Hanzo KMS

* Taxpayer Identification Numbers (SSN, EIN, ITIN) MUST be sealed under the organization's dedicated KMS master key (`newSealer(deps.MasterKey)`).
* Plaintext TINs MUST NOT be logged or returned in general member queries.
* SuperAdmin accounts MUST NOT be permitted to read plaintext TINs or execute W-9 signature certifications; only the organization's verified administrator may certify tax profiles.

### 3. Inter-Organization Grant Protocol

* Reading another organization's tax documentation requires an explicit cryptographic grant recorded in the payee's encrypted database.
* Grants are revocable at any time by the payee administrator.
* Queries spanning counterparties are routed strictly to the elected writer replica to guarantee immediate consistency upon grant revocation.

### 4. HTTP Endpoints

| Method | Path | Description |
|:---|:---|:---|
| `GET` | `/v1/tax/profile` | Read the organization's active tax profile |
| `PUT` | `/v1/tax/profile` | Update and certify tax profile (W-9 / W-8) |
| `POST` | `/v1/tax/grants` | Grant counterparty permission to view tax profile |
| `DELETE` | `/v1/tax/grants/:grant_id` | Revoke a counterparty's tax profile grant |
| `GET` | `/v1/tax/statements` | List received 1099 Copy B statements |
| `GET` | `/v1/tax/1099s` | List generated 1099 drafts for payees |
| `POST` | `/v1/tax/1099s/generate` | Classify transactions and compile annual 1099 drafts |
| `POST` | `/v1/tax/1099s/:id/furnish` | Finalize and deliver Copy B statement to payee |
| `GET` | `/v1/tax/export/irs` | Export encrypted IRS transmission return bundle |
