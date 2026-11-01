---
hip: 1340
title: Principal — Cryptographic Identity Statements & Authorization Clearance Plane
author: Hanzo AI Team
type: Standards Track
category: Security
status: Final
capability: principal
implementation-go: shipped
created: 2026-11-01
requires: HIP-0054, HIP-0097, HIP-0111, HIP-1115, HIP-1161
---

# HIP-1340: Principal — Cryptographic Identity Statements & Authorization Clearance Plane

## Abstract

Package `principal` (`/v1/principal`) defines the formal clearance and cryptographic verification plane for cross-organization entity authorization, sanctions/compliance checks, and payment clearance. Operating in conjunction with Hanzo IAM (`hanzo.id`) and sovereign DID identities (`did:hanzo:<org>:<user>`), `principal` provides automated, data-driven decisions on whether organizations may transact, contract, or exchange payments on Hanzo rails.

This proposal specifies the payment clearance lifecycle, regulatory obligation determination, and verifiable cryptographic identity statements.

## Motivation

Cross-organization commerce, B2B contracting, and multi-tenant billing require deterministic compliance boundaries. Transactions between entities can trigger regulatory, sanctions (OFAC), anti-money laundering (FATF Travel Rule), and tax withholding obligations. 

Traditional architectures rely on asynchronous, out-of-band compliance reviews that interrupt transactions and introduce subjective delays. `principal` formalizes clearance as an immediate, rule-based data object (`Clearance`), evaluating payer/payee status, category of service, jurisdictions, and reporting thresholds synchronously before funds move.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as in RFC 2119.

### 1. Payment Clearance Model (`Clearance`)

Before a transaction settles between two organizations, the payment rail requests a decision from `/v1/principal/clearance`:
* **Clearance Identifier**: Unique string prefixed with `clr_`.
* **Parties**: Payer organization and payee organization.
* **Transaction Parameters**: Gross amount, currency/rail, service category (`services`, `attorney`, `rents`, `royalties`, `merchandise`, `other`), and performance location.
* **Decision Properties**:
  * `allowed`: Boolean indicating whether the payment is cleared to proceed immediately.
  * `status`: Payee classification (`us`, `foreign`, or `unknown`).
  * `required_before_payment`: Array of blocking steps (e.g. missing W-9 certification, manual review).
  * `reporting_obligations`: Array of tax/regulatory reporting liabilities incurred (e.g. 1099-NEC).
  * `withholding`: Required statutory tax withholding amounts, if any.
  * `rules`: Ordered citation of all platform and legal rules governing the decision.

### 2. Cryptographic Identity Statements

* Sovereign principals emit signed statements attesting to clearances, accreditations, and membership proofs.
* Verifiers validate statements client-side against the entity's public keys published at `https://hanzo.id/.well-known/jwks.json` and DID documents ([HIP-0097](https://hips.hanzo.ai/hip-0097-clean-node-identity-did-hanzo-name)).
* Statements provide non-repudiable audit trails for SOC2, ISO 27001, and financial regulatory audits.

### 3. HTTP Endpoints

| Method | Path | Description |
|:---|:---|:---|
| `POST` | `/v1/principal/clearance` | Evaluate transaction parameters and issue payment clearance |
| `GET` | `/v1/principal/clearance/:id` | Retrieve an existing clearance decision record |
| `POST` | `/v1/principal/statements` | Issue a cryptographically signed principal statement |
| `POST` | `/v1/principal/verify` | Verify the cryptographic integrity of an identity statement |
