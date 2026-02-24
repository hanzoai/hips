---
hip: 008
title: Unified Payment Platform — PCI Vault, Ledger, and Network Tokenization
description: >-
  A complete payment infrastructure replacing Stripe dependency with
  PCI DSS v4.0 compliant card vault, double-entry ledger, multi-processor
  routing, network tokenization, crypto payments, and subscription billing.
author: Hanzo AI (@hanzoai)
status: Draft
type: Standards Track
category: Infrastructure
created: 2026-02-23
requires: HIP-005
---

# HIP-008: Unified Payment Platform

## Abstract

This proposal defines a self-hosted, PCI DSS v4.0 compliant payment platform
that unifies card tokenization, payment processing, subscription billing, and
cryptocurrency payments under a single API. The architecture comprises three
independently deployable services — **Vault** (PCI CDE), **Commerce** (billing
and orchestration), and a **double-entry Ledger** — interconnected via mTLS with
SPIFFE/SPIRE identity attestation.

The platform eliminates third-party payment processor lock-in by routing
transactions across multiple processors (Stripe, Adyen, Square, PayPal,
Braintree, Recurly) via a unified interface, while adding first-class support
for network tokenization (Visa VTS, Mastercard MDES) and custodial/non-custodial
cryptocurrency payments.

## Motivation

### Problems with Current State

1. **Processor Lock-in**: Direct Stripe integration couples business logic to a
   single provider. Migrating requires rewriting checkout flows, webhook
   handlers, and subscription logic.

2. **PCI Scope Creep**: Without an isolated vault, card data touches application
   code, expanding PCI DSS audit scope to the entire platform.

3. **No Financial Ledger**: Payment state is scattered across processor
   webhooks, application databases, and reconciliation spreadsheets. No
   authoritative double-entry record exists.

4. **No Crypto Payments**: No infrastructure for accepting cryptocurrency
   payments (custodial wallets or non-custodial on-chain verification).

5. **No Network Tokenization**: Raw PANs stored instead of network tokens,
   increasing breach risk and missing interchange fee reductions.

### Design Goals

- **PCI DSS v4.0 Level 1** compliance for the Vault CDE
- **Zero processor lock-in** via abstracted payment intents
- **Double-entry accounting** with zero-sum invariant enforcement
- **Sub-100ms tokenization** latency for checkout flows
- **First-class crypto** with both custodial and non-custodial models
- **Network token lifecycle** management (provisioning, cryptogram generation)
- **Multi-tenant** with cryptographic tenant isolation

## Specification

### Architecture Overview

The platform follows a three-zone isolation model:

```
                    ┌──────────────────────────────────────────────────┐
                    │                 ZONE 1: PUBLIC API               │
                    │                                                  │
                    │   ┌──────────┐    ┌──────────┐    ┌──────────┐  │
                    │   │ API      │    │ Checkout  │    │ Webhook  │  │
                    │   │ Gateway  │    │ Sessions  │    │ Receiver │  │
                    │   └────┬─────┘    └────┬─────┘    └────┬─────┘  │
                    │        │               │               │        │
                    └────────┼───────────────┼───────────────┼────────┘
                             │               │               │
                    ┌────────┼───────────────┼───────────────┼────────┐
                    │        ▼               ▼               ▼        │
                    │              ZONE 2: PAYMENTS CORE               │
                    │                                                  │
                    │   ┌──────────┐    ┌──────────┐    ┌──────────┐  │
                    │   │ Payment  │    │ Billing  │    │ Processor│  │
                    │   │ Intents  │    │ Engine   │    │ Router   │  │
                    │   └────┬─────┘    └────┬─────┘    └────┬─────┘  │
                    │        │               │               │        │
                    │        │          ┌────┴─────┐         │        │
                    │        │          │ Ledger   │         │        │
                    │        │          │(Dbl-Entry)│        │        │
                    │        │          └──────────┘         │        │
                    └────────┼──────────────────────────────┼────────┘
                             │   mTLS (SPIFFE/SPIRE)        │
                    ┌────────┼──────────────────────────────┼────────┐
                    │        ▼                              ▼        │
                    │              ZONE 3: VAULT CDE                  │
                    │                                                  │
                    │   ┌──────────┐    ┌──────────┐    ┌──────────┐  │
                    │   │ Card     │    │ Network  │    │ HSM Key  │  │
                    │   │Tokenizer │    │ Token    │    │ Manager  │  │
                    │   │          │    │ Lifecycle│    │          │  │
                    │   └──────────┘    └──────────┘    └──────────┘  │
                    │                                                  │
                    └──────────────────────────────────────────────────┘
```

### Service Breakdown

#### Vault (Zone 3 — PCI CDE)

**Repository**: `hanzoai/vault`
**Namespace**: `hanzo-vault`
**SPIFFE ID**: `spiffe://hanzo.ai/hanzo-vault/vault-tokenizer`

The Vault is the only component that handles raw card data (PANs). All other
services interact exclusively with opaque tokens.

**Capabilities**:
- AES-256-GCM envelope encryption (DEK per card, KEK in HSM)
- Token format: `tok_` + 48 hex characters (cryptographically random)
- PAN fingerprinting: SHA-256 for deduplication
- Card brand detection (Visa, Mastercard, Amex, Discover, JCB, UnionPay, Diners)
- Network token provisioning via Visa VTS and Mastercard MDES APIs
- RBAC with 4 roles: `tokenizer`, `operator`, `key_admin`, `auditor`
- Immutable audit logging with HMAC-SHA256 chain integrity

**API Surface**:

| Method | Path | RBAC | Description |
|--------|------|------|-------------|
| POST | `/vault/cards` | tokenizer | Tokenize a card (PAN → token) |
| POST | `/vault/cards/{token}/detokenize` | operator | Retrieve card data |
| GET | `/vault/cards/{token}` | tokenizer | Get card metadata (no PAN) |
| DELETE | `/vault/cards/{token}` | operator | Soft-delete card |
| POST | `/vault/cards/{token}/rotate` | key_admin | Rotate encryption key |
| POST | `/vault/network-tokens` | operator | Provision network token |
| POST | `/vault/network-tokens/{id}/cryptogram` | operator | Generate payment cryptogram |
| DELETE | `/vault/network-tokens/{id}` | operator | Suspend network token |

**Encryption Architecture**:

```
HSM Master Key (MK)
  └── wraps → Key Encryption Key (KEK)
                └── wraps → Data Encryption Key (DEK) [per card]
                              └── encrypts → PAN + expiry + CVV
```

Key rotation: DEK quarterly, KEK annually, MK ceremony (dual-control, split
knowledge).

#### Commerce (Zone 2 — Payments Core)

**Repository**: `hanzoai/commerce`
**Namespace**: `hanzo`
**Live**: `commerce.hanzo.ai`

Commerce orchestrates payment flows, manages subscriptions, and maintains the
financial ledger. It never sees raw card data — only vault tokens.

**Payment Intent Lifecycle**:

```
created → requires_payment_method → processing → succeeded
                                               → failed
                                               → canceled
```

**Processor Router**:

The router selects an optimal payment processor based on:
1. Card brand and BIN range
2. Currency and geography
3. Processor health and latency
4. Cost optimization (interchange rates)
5. Merchant preference overrides

Supported processors:

| Processor | Cards | ACH/SEPA | Wallets | Crypto |
|-----------|-------|----------|---------|--------|
| Stripe | Yes | Yes | Apple/Google Pay | No |
| Adyen | Yes | Yes | All | No |
| Square | Yes | No | Apple/Google Pay | No |
| PayPal | No | No | PayPal | No |
| Braintree | Yes | No | Venmo | No |
| Bitcoin | No | No | No | BTC/Lightning |
| Ethereum | No | No | No | ETH/ERC-20 |

**Subscription Engine**:

Built on Temporal workflows for reliable state management:

```
Subscription Workflow
  ├── Trial Phase (optional)
  │     └── timer → convert or cancel
  ├── Active Phase
  │     ├── recurring charge (cron schedule)
  │     ├── proration on plan change
  │     ├── usage metering aggregation
  │     └── dunning on payment failure
  ├── Past Due Phase
  │     ├── retry schedule (1d, 3d, 7d, 14d)
  │     └── escalation notifications
  └── Canceled/Expired
```

#### Ledger (Zone 2 — Double-Entry Accounting)

**Location**: `commerce/billing/ledger/`

The ledger enforces financial integrity through the double-entry invariant:
**every entry's postings must sum to zero**.

**Account Types**:

| Type | Normal Balance | Examples |
|------|---------------|----------|
| asset | debit | `cash`, `accounts_receivable`, `crypto_holdings` |
| liability | credit | `customer_deposits`, `refunds_payable` |
| revenue | credit | `subscription_revenue`, `transaction_fees` |
| expense | debit | `processor_fees`, `chargebacks` |

**Schema** (PostgreSQL):

```sql
-- Accounts
CREATE TABLE ledger_accounts (
    id          UUID PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('asset','liability','revenue','expense')),
    currency    TEXT NOT NULL DEFAULT 'USD',
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name, currency)
);

-- Entries (transactions)
CREATE TABLE ledger_entries (
    id              UUID PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    idempotency_key TEXT,
    description     TEXT NOT NULL,
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, idempotency_key)
);

-- Postings (debits and credits)
CREATE TABLE ledger_postings (
    id         UUID PRIMARY KEY,
    entry_id   UUID NOT NULL REFERENCES ledger_entries(id),
    account_id UUID NOT NULL REFERENCES ledger_accounts(id),
    amount     BIGINT NOT NULL,  -- positive = debit, negative = credit
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Constraint: all postings in an entry must sum to zero
CREATE CONSTRAINT TRIGGER enforce_zero_sum
    AFTER INSERT ON ledger_postings
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_entry_balance();
```

**Authorization Holds**:

For card-present and pre-auth flows, the ledger supports holds:

```
authorize $100 → hold created (pending_amount += $100)
capture  $80  → hold partially captured, $80 posted, $20 released
void          → hold fully released, no posting
```

### Cryptocurrency Payments

#### Custodial Model

```
Customer → Payment Intent (crypto) → Commerce generates deposit address
         → Customer sends BTC/ETH → Commerce monitors mempool
         → Confirmation threshold met → Payment succeeds
         → Ledger: debit crypto_holdings, credit customer_payment
```

Supported: BTC (on-chain + Lightning), ETH, ERC-20 tokens (USDC, USDT, DAI).

#### Non-Custodial Model

```
Customer → Payment Intent (crypto) → Commerce returns payment request
         → Customer signs tx in their wallet → Commerce verifies on-chain
         → Confirmation threshold met → Payment succeeds
```

No private keys held. Verification via block explorer APIs or direct node RPC.

### Network Tokenization

Network tokens replace raw PANs with scheme-issued tokens (Visa VTS, Mastercard
MDES), reducing fraud liability and unlocking lower interchange rates.

**Lifecycle**:

```
1. Tokenize card in Vault → get vault token (tok_...)
2. Provision network token → Vault calls VTS/MDES with raw PAN
3. Network returns: network_token + token_reference_id
4. On payment: request cryptogram from network → one-time-use code
5. Send network_token + cryptogram to processor (not raw PAN)
6. On card update: network auto-updates via Account Updater
```

**Benefits**:
- 2-5 basis point interchange reduction
- Automatic card-on-file updates (no expired card failures)
- Reduced fraud liability (cryptogram is single-use)
- Processors see network token, never raw PAN

### API Surface (OpenAPI 3.1)

The complete API specification is defined in `commerce/api/openapi.yaml`
(3,726 lines, 65 paths, 82 operations, 67 schemas).

**Key Endpoint Groups**:

| Group | Paths | Description |
|-------|-------|-------------|
| Payment Intents | `/v1/payment-intents/*` | Create, confirm, capture, cancel |
| Setup Intents | `/v1/setup-intents/*` | Save payment methods without charging |
| Customers | `/v1/customers/*` | CRUD + payment methods |
| Refunds | `/v1/refunds/*` | Full and partial refunds |
| Disputes | `/v1/disputes/*` | Chargeback management |
| Bank Transfers | `/v1/bank-transfers/*` | ACH/SEPA/wire |
| Crypto | `/v1/crypto/*` | Custodial + non-custodial |
| Network Tokens | `/v1/network-tokens/*` | VTS/MDES lifecycle |
| Vault | `/v1/vault/*` | Card tokenization (proxied to CDE) |
| Subscriptions | `/v1/subscriptions/*` | Recurring billing |
| Invoices | `/v1/invoices/*` | Invoice lifecycle |
| Credit Notes | `/v1/credit-notes/*` | Refund credits |
| Metering | `/v1/metering/*` | Usage-based billing events |
| Webhooks | `/v1/webhooks/*` | Event delivery |

### Security Model

#### Trust Boundaries

```
Internet ──┤ WAF + Rate Limit ├── Zone 1 (Public API)
                                      │
                              ┌───────┤ mTLS ├───────┐
                              │                       │
                        Zone 2 (Payments)       Zone 3 (Vault CDE)
                              │                       │
                              └───── NetworkPolicy ───┘
                                  (deny-all default)
```

#### SPIFFE Identity Matrix

| Source | Destination | Allowed Operations |
|--------|-------------|-------------------|
| `hanzo/api-gateway` | `hanzo/commerce` | All payment APIs |
| `hanzo/commerce` | `hanzo-vault/vault-tokenizer` | tokenize, detokenize, metadata |
| `hanzo/commerce` | `hanzo-vault/vault-tokenizer` | network token ops |
| `hanzo-vault/vault-tokenizer` | HSM (CloudHSM) | key operations |
| `hanzo-vault/vault-tokenizer` | PostgreSQL | card storage |

#### Kubernetes Network Policies

Zone 3 (Vault CDE) enforces:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: vault-deny-all
  namespace: hanzo-vault
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
  ingress: []   # deny all by default
  egress: []    # deny all by default
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: vault-allow-commerce
  namespace: hanzo-vault
spec:
  podSelector:
    matchLabels:
      app: vault-service
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: hanzo
          podSelector:
            matchLabels:
              app: commerce
      ports:
        - port: 8443
          protocol: TCP
```

### Deployment

#### Commerce (existing)

- **Image**: `ghcr.io/hanzoai/commerce:latest`
- **Cluster**: hanzo-k8s (`24.199.76.156`)
- **Namespace**: `hanzo`
- **Strategy**: `Recreate` (ReadWriteOnce PVC)
- **Storage**: 10Gi PVC (`commerce-data`, `do-block-storage`)
- **Secrets**: KMS Universal Auth (`commerce-kms-auth`)
- **Health**: `GET /health` → `{"status":"ok","version":"..."}`

#### Vault (new)

- **Image**: `ghcr.io/hanzoai/vault:latest`
- **Cluster**: hanzo-k8s
- **Namespace**: `hanzo-vault` (isolated CDE)
- **Strategy**: `Recreate`
- **Storage**: PostgreSQL (encrypted at rest)
- **Secrets**: HSM credentials via KMS
- **Health**: `GET /health`
- **mTLS**: SPIRE agent socket mounted

### KMS Integration

All payment processor credentials are managed through KMS (Infisical). The
architecture follows "secret zero" — each service has a single KMS Universal
Auth credential in K8s, and all other secrets are fetched at runtime.

**Secret Path Convention**:
```
/tenants/{orgName}/stripe/STRIPE_LIVE_ACCESS_TOKEN
/tenants/{orgName}/stripe/STRIPE_PUBLISHABLE_KEY
/tenants/{orgName}/square/SQUARE_PRODUCTION_ACCESS_TOKEN
/tenants/{orgName}/paypal/PAYPAL_LIVE_EMAIL
/tenants/{orgName}/vault/HSM_PIN
/tenants/{orgName}/vault/HSM_SLOT_ID
```

## Rationale

### Why Self-Hosted Vault vs Stripe Vault?

Stripe's tokenization is locked to Stripe processing. A self-hosted vault
enables:
- Multi-processor routing with the same tokens
- Network token provisioning (Stripe doesn't expose VTS/MDES)
- Crypto payment methods alongside traditional cards
- Full control over encryption keys and audit logs
- Elimination of per-token fees at scale

### Why Double-Entry Ledger vs Event Sourcing?

Event sourcing provides audit trails but doesn't enforce financial invariants.
Double-entry accounting:
- Guarantees every debit has a corresponding credit (zero-sum constraint)
- Produces balance sheets and P&L statements directly
- Maps to established accounting standards (GAAP/IFRS)
- Authorization holds model naturally as pending entries

### Why Three Zones vs Two?

PCI DSS v4.0 Requirement 1.2 mandates network segmentation between CDE and
non-CDE. The three-zone model:
- Minimizes PCI audit scope (only Zone 3 is in-scope for SAQ D)
- Allows Zone 2 services to scale independently
- Enables different security postures per zone (e.g., Zone 3 gets HSM, FIPS mode)

### Why SPIFFE/SPIRE vs mTLS with cert-manager?

SPIFFE provides:
- Workload identity attestation (not just TLS encryption)
- Automatic certificate rotation (SVIDs expire in hours, not months)
- Cross-cluster identity federation
- Integration with K8s pod identity (node attestor)

## Build Order

### Phase 1: Foundation (Weeks 1-2)

1. **Vault Dockerfile + CI/CD** — Multi-stage Alpine build, GHCR push, Trivy scan
2. **Vault PostgreSQL backend** — Replace MemoryStore with persistent storage
3. **Vault K8s manifests** — Namespace, deployment, service, NetworkPolicies
4. **Commerce K8s fixes** — Recreate strategy, PVC, proper secrets

### Phase 2: Integration (Weeks 3-4)

5. **mTLS/SPIFFE** — SPIRE agent integration for Vault ↔ Commerce
6. **Ledger PostgreSQL** — Migrate in-memory ledger to persistent store
7. **Processor router** — Multi-processor routing with health checks
8. **Checkout sessions** — Unified checkout flow using vault tokens

### Phase 3: Advanced Features (Weeks 5-8)

9. **HSM integration** — AWS CloudHSM PKCS#11 for key management
10. **Network tokenization** — Visa VTS and Mastercard MDES integration
11. **Crypto payments** — BTC/ETH custodial and non-custodial flows
12. **Subscription engine** — Temporal workflows for recurring billing

### Phase 4: Compliance (Weeks 9-12)

13. **PCI DSS gap assessment** — QSA engagement
14. **Penetration testing** — External firm
15. **SOC 2 evidence collection** — Automated K8s state snapshots
16. **Key ceremony** — HSM master key initialization (dual-control)

## Security Considerations

### PCI DSS v4.0 Requirements Mapping

| Requirement | Implementation |
|-------------|---------------|
| 1.2 Network segmentation | 3-zone K8s namespaces + NetworkPolicies |
| 2.2 Secure configuration | CIS benchmarks, no default credentials |
| 3.4 PAN encryption | AES-256-GCM with HSM-managed keys |
| 3.5 Key management | HSM (CloudHSM), dual-control ceremonies |
| 4.1 Strong cryptography | TLS 1.3, mTLS between zones |
| 6.4 Change management | CI/CD with SAST, dependency scanning |
| 7.1 Access control | RBAC (4 roles), SPIFFE identity |
| 8.3 Authentication | mTLS SVIDs + API keys |
| 10.1 Audit logging | Immutable chain-hashed logs, 1yr retention |
| 11.3 Penetration testing | Quarterly external, annual internal |
| 12.10 Incident response | Emergency key rotation runbook |

### Cryptographic Standards

- **Encryption**: AES-256-GCM (NIST SP 800-38D)
- **Key Derivation**: HKDF-SHA256 (RFC 5869)
- **Token Generation**: crypto/rand (256-bit entropy)
- **PAN Fingerprint**: SHA-256 (one-way, non-reversible)
- **Audit Chain**: HMAC-SHA256 (tamper detection)
- **TLS**: 1.3 minimum, ECDHE key exchange

### Emergency Procedures

**Key Compromise Response** (15-minute lockdown):

1. Apply emergency NetworkPolicy (deny all ingress to vault)
2. Rotate compromised DEKs (re-encrypt affected cards)
3. Revoke SPIFFE SVIDs for compromised workloads
4. Notify PCI QSA within 24 hours
5. Begin forensic investigation

**Data Breach Notification**:

- Payment processor notification: 24 hours
- Card brand notification: 72 hours
- Customer notification: Per jurisdiction (GDPR: 72h, CCPA: 30d)

## Backwards Compatibility

This proposal introduces new services and APIs. Existing Commerce endpoints
remain unchanged. The migration path:

1. Deploy Vault alongside existing direct-Stripe integration
2. Migrate card-on-file customers to vault tokens (background job)
3. Route new payments through vault + processor router
4. Deprecate direct Stripe API calls after migration complete
5. Remove Stripe SDK dependency from Commerce

## Reference Implementation

### Repositories

| Repository | Description | Status |
|-----------|-------------|--------|
| `hanzoai/vault` | PCI CDE — card tokenization | Core logic implemented |
| `hanzoai/commerce` | Payments, billing, ledger | v1.33.0 live |
| `hanzoai/commerce/api/openapi.yaml` | Full API specification | 3,726 lines |
| `hanzoai/commerce/billing/ledger/` | Double-entry ledger | Go + tests |
| `hanzoai/vault/compliance/` | PCI network architecture | 1,076 lines |

### Test Results

Ledger: 31 tests passing (double-entry validation, idempotency, holds,
payment/refund/payout/dispute recording, balance accuracy).

Commerce: 117 model tests, 9 processor integration tests, billing engine tests,
router tests — all passing.

## Related Proposals

- **HIP-005** (KMS): Secret management infrastructure used for credential storage
- **HIP-001** (Post-Quantum Crypto): Future migration path for vault encryption
- **HIP-003** (Network Architecture): Base network topology this builds upon

## Copyright

Copyright 2026 Hanzo AI Inc. All rights reserved.

This document is licensed under the Creative Commons Attribution 4.0
International License (CC-BY-4.0).
