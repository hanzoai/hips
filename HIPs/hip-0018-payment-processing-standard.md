---
hip: "0018"
title: Payment Processing Standard
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Final
implementation-go: shipped
created: 2025-01-09
updated: 2026-02-23
requires: HIP-0001, HIP-0004, HIP-0026, HIP-0027, HIP-1061, HIP-0139
capability: billing
---


# HIP-0018: Payment Processing Standard

## Abstract

This proposal defines the payment processing standard for the Hanzo ecosystem. Hanzo Commerce is the billing, subscription, and payment service that bridges the **native Hanzo PSP (Hanzo Pay — the same payment engine white-labeled as `lux-pay` on Lux and per-brand elsewhere)** with the internal credit system managed by Hanzo IAM (HIP-26). Card data is tokenized inside the Hanzo Vault PCI CDE; on-chain rails settle $AI directly. Every dollar a user pays is converted into credits. Every AI inference, API call, or compute job consumes credits. Commerce handles the money side; IAM holds the balance; the LLM Gateway (HIP-4) and Cloud services meter usage.

> **No external-processor dependency.** First-party Hanzo/Lux/Zoo/Zen surfaces process payments through the native PSP, never through a third-party processor that can deplatform us. Commerce keeps a *pluggable* provider-adapter interface so a brand MAY add a regional rail, but no first-party flow depends on one.

The system is designed around a single invariant: **one ledger holds the balance, and every reader and writer addresses the same wallet.** As shipped, that ledger is commerce's native finance ledger — 18-decimal exact money over `big.Int`, no float anywhere on the path (`hanzoai/cloud` `spend.go:43-45`) — keyed per org by `principal.WalletOf`, the address the debit writes and the gate reads. An earlier revision of this HIP named IAM as the balance's home; the code refutes that — IAM holds identity, and the balance read the customer sees goes over the internal plane to commerce (`apps/billing/balance.go:75-76`).

**Repository**: [github.com/hanzoai/commerce](https://github.com/hanzoai/commerce)
**Port**: 4242
**Docker**: `ghcr.io/hanzoai/commerce:latest`

The native PSP (**Hanzo Pay**, the same engine white-labeled as `lux-pay` / per-brand) provides:

- **Sovereignty**: No external party can disable, freeze, or deplatform a first-party flow. The rail is ours; outages and policy changes are ours to manage.
- **PCI offload, in-house**: Card data never touches Commerce or any app server. The **Hanzo Vault** CDE (a dedicated PCI-DSS-scoped tokenization service) holds the card-handling surface; everything else operates on opaque tokens, keeping the broad system out of PCI scope exactly as an external processor would — but under our control.
- **Hosted checkout**: A native hosted payment page (served from the Vault/PSP boundary) so app servers only ever receive a signed completion webhook.
- **Subscription management**: Recurring billing, proration, dunning (failed-payment retry), and lifecycle hooks.
- **Invoicing**: Invoice generation, PDF rendering, and email delivery.
- **Fraud detection**: Risk scoring on the native rail; on-chain rails are inherently irreversible (no chargeback exposure).
- **Marketplace payouts**: Connect-style transfers for agent revenue (HIP-25) settle natively, including on-chain $AI to any wallet.

The compliance burden the standard once cited as a reason to outsource (PCI DSS: 300+ controls across 12 categories) is met by scoping the CDE to **Hanzo Vault** alone, not by handing the customer relationship to a party that can revoke it.

### Pluggable Provider Adapters (Optional, Per-Brand)

Commerce keeps a provider-adapter interface so a brand MAY plug an additional rail (regional cards, bank transfer, a Merchant-of-Record for EU VAT, etc.). These are **optional, per-brand, and never on a first-party critical path** — the native PSP is always the default and the only rail a first-party surface is required to support. Adapters are registered explicitly; none is implicit or default. (Notably, no first-party surface registers an external processor that can deplatform the ecosystem.)

### Why Not Blockchain-Only Payments

The Hanzo ecosystem includes $AI token (HIP-1) and on-chain settlement (HIP-25). Why not use blockchain for all payments?

1. **Friction**: Most developers do not have crypto wallets. Requiring wallet setup, token purchase, and gas fees for a $20 credit top-up would eliminate 90%+ of potential users.
2. **Volatility**: Token prices fluctuate. If a user buys credits with $AI at $0.50 and the price drops to $0.30 before they use the credits, who absorbs the loss?
3. **Speed**: The native PSP processes a card payment in 2-3 seconds. On-chain settlement takes 2-15 seconds depending on the chain and requires block confirmations for finality.
4. **Chargebacks**: Card users have dispute rights. Blockchain transactions are irreversible. Offering only crypto payments forfeits consumer protection, which is a regulatory risk.

The correct approach is **both**: the native PSP for fiat, blockchain for crypto. Commerce accepts both and normalizes them into credits. The user does not need to know or care which payment rail was used.

## Specification

### The billing capability — what `/v1/billing` the customer reads actually is

The capability named `billing` (HIP-0139) is the customer's own money endpoint in
`hanzoai/cloud`: **nine read operations, all GET, all free** — `/v1/billing/
{balance, usage, usage/accounts}` and `/v1/finance/{balance, credits, usage,
invoices, payment-methods, ledger}` (`manifest/apps.go:137`, package doc
`apps/billing/billing.go`). It owns **no store**: balance and usage are read
from the co-resident commerce ledger over the internal plane
(`apps/billing/balance.go:75-76`), falling back to a verbatim S2S proxy only
on a split deploy, so the wire is commerce's either way. The tenant is
`principal.Org`, the validated IAM owner claim; the commerce subject is
pinned server-side to that org and no client-supplied subject or org is ever
forwarded.

The rest of this document — checkout, subscriptions, webhooks, refunds,
payouts — is the money surface **commerce** serves under the same
`/v1/billing` product prefix; two capabilities share the product and the
address split is the manifest's, not this table's. The whole `/v1/billing/`
tree, both halves, is on the spend gate's never-refuse list (`spend.go:444`):
the path to payment is never gated, because gating it deadlocks every unpaid
and lapsed customer at once.

Stated for HIP-0139 §6: the billing capability meters nothing and is **free**
in those words (`plugin/billing/main.go:21` declares `Price: cloud.Free`);
it publishes **no events** on the bus, so a customer's webhooks receive
nothing from it (the webhooks in this document are INBOUND, from the PSP to
commerce); it emits nothing to observability beyond the request span; its
stage is **ga** — the money read is agentic-OS core; and it forks, embeds or
mirrors **no OSS upstream**. What an attacker gets from the wrong
implementation: a balance read keyed on a caller-supplied subject is a
cross-tenant ledger read, and a reader addressing a different wallet than the
debit writes is the class of bug that has shipped here three times
(`spend.go:35-41`) — an org admitted on the platform's own pool for as long
as the platform stays funded.

### Architecture

```
                              +------------------------+
                              |  Hanzo Pay (native PSP)|
                              |  + Hanzo Vault (PCI    |
                              |   CDE: card tokens)    |
                              |  Checkout/Billing/Hooks|
                              +------+------+----------+
                                     |      |
                           webhooks  |      |  checkout sessions
                                     |      |
                              +------v------v----------+
                              |    Hanzo Commerce      |
                              |    (payment logic)     |
                              |      :4242             |
                              +------+--------+--------+
                                     |        |
                      +--------------+--------+-------------+
                      |              |                      |
               add-balance    add-transaction          get-account
                      |              |                      |
                      v              v                      v
               +----------------------------------------------+
               |           Hanzo IAM (HIP-26)                 |
               |     (user balances, transactions)            |
               |            hanzo.id :8000                    |
               +----------------------------------------------+
                      ^              ^
                      |              |
               token validation  debit transactions
                      |              |
         +------------+-+     +------+----------+
         |  LLM Gateway |     |   Hanzo Cloud   |
         |   (HIP-4)    |     |  (compute jobs) |
         |    :4000      |     |                 |
         +--------------+     +-----------------+
```

### Credit System

#### Credit Definition

| Property | Value |
|----------|-------|
| Unit name | credit |
| USD value | 1 credit = $0.001 USD |
| Minimum purchase | 1,000 credits ($1.00) |
| Maximum single purchase | 10,000,000 credits ($10,000) |
| Precision | Integer (no fractional credits) |
| Storage | exact 18-decimal atto-USD over `big.Int` on the commerce finance ledger — never a float (`spend.go:43-45`) |

Credits are stored USD-denominated on the finance ledger (1,000 credits = $1.00 balance). The "credit" is a user-facing abstraction; the ledger stores the exact dollar equivalent. This means 20,000 credits = $20.00 balance, and one atto-dollar is enough to be admitted — there is no cent-flooring on the gate.

#### Credit Pricing Tiers

Bulk purchases receive volume discounts:

| Purchase Amount | Credits | Bonus | Effective Rate |
|----------------|---------|-------|----------------|
| $5 | 5,000 | 0% | $0.001/credit |
| $20 | 21,000 | 5% | $0.000952/credit |
| $50 | 55,000 | 10% | $0.000909/credit |
| $100 | 115,000 | 15% | $0.000870/credit |
| $500 | 600,000 | 20% | $0.000833/credit |
| $1,000+ | Custom | 25%+ | Negotiated |

#### AI Usage Credit Costs

Credit costs are derived from provider pricing plus a margin. The LLM Gateway publishes a rate card:

| Operation | Model Tier | Credits | Approx. USD |
|-----------|-----------|---------|-------------|
| Chat completion (1K input tokens) | Economy (Mixtral, Llama) | 1 | $0.001 |
| Chat completion (1K input tokens) | Standard (GPT-4-Turbo, Claude Sonnet) | 10 | $0.01 |
| Chat completion (1K input tokens) | Premium (GPT-4, Claude Opus) | 30 | $0.03 |
| Chat completion (1K output tokens) | Economy | 2 | $0.002 |
| Chat completion (1K output tokens) | Standard | 15 | $0.015 |
| Chat completion (1K output tokens) | Premium | 60 | $0.06 |
| Image generation (1024x1024) | DALL-E 3 | 40 | $0.04 |
| Embedding (1K tokens) | text-embedding-3-small | 0.1 | $0.0001 |
| Audio transcription (1 minute) | Whisper | 6 | $0.006 |
| Computer use (1 action) | Operative | 5 | $0.005 |

These rates are stored in the LLM Gateway configuration and updated when provider pricing changes. Commerce does not need to know the rates; it only processes the debit transactions that Gateway and Cloud submit to IAM.

### Subscription Tiers

```yaml
tiers:
  free:
    name: "Free"
    price_monthly: 0
    credits_monthly: 1000
    psp_price_id: null
    overage: blocked
    features:
      - "1,000 credits/month (~100 GPT-4 messages)"
      - "Community support"
      - "3 requests/minute rate limit"
      - "Standard models only"

  pro:
    name: "Pro"
    price_monthly: 20
    credits_monthly: 50000
    psp_price_id: "price_pro_monthly"
    overage: pay_as_you_go
    features:
      - "50,000 credits/month (~5,000 GPT-4 messages)"
      - "Priority support"
      - "60 requests/minute rate limit"
      - "All models including Premium tier"
      - "MCP tool access"
      - "Usage analytics dashboard"

  team:
    name: "Team"
    price_monthly: 100
    credits_monthly: 150000
    psp_price_id: "price_team_monthly"
    overage: pay_as_you_go
    features:
      - "150,000 credits/month"
      - "5 team members included ($15/additional)"
      - "Shared org billing"
      - "120 requests/minute rate limit"
      - "Admin dashboard"
      - "SSO via IAM (HIP-26)"

  enterprise:
    name: "Enterprise"
    price_monthly: custom
    credits_monthly: custom
    psp_price_id: "price_enterprise_custom"
    overage: invoice
    features:
      - "Custom credit allocation"
      - "Unlimited team members"
      - "Dedicated support and SLA"
      - "Custom rate limits"
      - "Volume discounts (25%+)"
      - "Invoice billing (NET 30)"
      - "SOC 2 compliance reports"
```

Free-tier credits reset monthly and do not accumulate. Paid-tier included credits roll over for 90 days. Purchased credits (one-time top-ups) never expire.

#### Subscription Lifecycle

- **Upgrade**: Commerce creates a PSP subscription -> the PSP charges monthly -> webhook `invoice.paid` -> Commerce credits IAM with included credits.
- **Renewal**: the PSP auto-charges -> webhook `invoice.paid` -> Commerce adds monthly credits. Unused credits from previous months roll over for 90 days.
- **Overage**: When a Pro/Team user exceeds included credits, usage continues at the standard rate. Overage is metered via PSP usage records and billed at period end alongside the subscription fee.
- **Downgrade**: Commerce cancels the PSP subscription at period end. Remaining credits are usable until expiry. After the period ends, the user reverts to Free tier (1,000 credits/month, hard cap).
- **Payment failure**: the PSP retries 3 times over 7 days using smart retries. After 3 failures the subscription enters `past_due`. After 14 days `past_due`, the subscription is canceled and the user is downgraded to Free.

### Payment Flow

#### One-Time Credit Purchase (Fiat)

```
1. Client: POST /v1/billing/topup { amount: 2000, currency: "usd", credits: 21000 }
2. Commerce creates a PSP checkout session with metadata (user_id, org_id, credits, idempotency_key)
3. Commerce returns checkout URL -> client redirects user to the native hosted checkout
4. User completes payment on the native hosted checkout page (Hanzo Vault CDE)
5. PSP fires webhook: checkout.session.completed
6. Commerce verifies webhook signature (HMAC-SHA256)
7. Commerce checks idempotency key in KV (prevent double-processing)
8. Commerce calls IAM: POST /api/add-balance { owner: "hanzo", user: "z", amount: 21.0 }
9. Commerce records transaction: POST /api/add-transaction
   { category: "Recharge", user: "z", amount: 21.0, name: "txn_psp_cs_..." }
10. User's IAM balance updated. Credits available immediately.
```

#### Crypto Payment Flow ($AI Token)

Commerce also accepts $AI token (HIP-1) payments on Hanzo Network (chain ID 36963). The user sends tokens to a per-user deposit address. Commerce's on-chain listener detects the Transfer event (1 block confirmation for <$1K, 6 for >=$1K), converts $AI to USD at the 10-minute TWAP oracle rate via HMM (HIP-8), and credits the user's IAM balance through the same add-balance/add-transaction flow as fiat.

### Billing API Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/v1/billing/balance` | Current credit balance | Bearer token |
| GET | `/v1/billing/transactions` | Transaction history with pagination | Bearer token |
| POST | `/v1/billing/topup` | Card top-up: charge and credit the ledger | Bearer token |
| POST | `/v1/billing/crypto/deposit` | Create crypto payment intent | Bearer token |
| POST | `/v1/billing/subscribe/card` | Create or change a card subscription | Bearer token |
| POST | `/v1/billing/subscriptions/:id/cancel` | Cancel subscription | Bearer token |
| GET | `/v1/billing/subscriptions` | Current subscription details | Bearer token |
| GET | `/v1/billing/invoices` | List invoices | Bearer token |
| GET | `/v1/billing/invoices/:id/pdf` | Download invoice PDF | Bearer token |
| GET | `/v1/billing/usage` | Usage breakdown by period | Bearer token |
| GET, POST | `/v1/billing/portal/methods` | Saved payment methods via the portal | Bearer token |
| POST | `/v1/billing/webhooks/:provider` | inbound PSP webhook receiver (commerce; under `/v1` like everything else, and never behind the spend gate — `spend.go:444`) | PSP signature |

#### Response Examples

**GET /v1/billing/balance** returns the user's current credit state:

```json
{
  "balance": 15420, "balance_usd": 15.42, "tier": "pro",
  "credits_included": 50000, "credits_used": 34580, "credits_remaining": 15420,
  "period_start": "2026-02-01T00:00:00Z", "period_end": "2026-03-01T00:00:00Z",
  "auto_recharge": { "enabled": true, "threshold": 1000, "amount": 20000 }
}
```

**GET /v1/billing/transactions** returns paginated transaction history. Each transaction includes `id`, `timestamp`, `category` (Purchase/Recharge), `credits` (negative for debits), `balance_after`, and `metadata` with model/token/provider details.

**GET /v1/billing/usage?period=2026-02** returns usage aggregated by model (`gpt-4-turbo`, `claude-3-sonnet`, etc.), by service (`llm-gateway`, `cloud`, `mcp`), and optionally by day when `granularity=daily` is specified.

### Webhook Handling

Commerce receives webhooks from the native PSP for all payment-related events. The webhook handler follows a strict pipeline:

```python
async def handle_psp_webhook(request):
    # 1. Verify signature (CRITICAL - prevents forgery)
    payload = request.body
    signature = request.headers["X-Webhook-Signature"]
    try:
        event = psp.verify_event(
            payload, signature, psp_webhook_secret
        )
    except psp.SignatureError:
        return Response(status=400, body="Invalid signature")

    # 2. Check idempotency (prevent double-processing)
    event_id = event["id"]
    if await redis.exists(f"webhook:processed:{event_id}"):
        return Response(status=200, body="Already processed")

    # 3. Route by event type
    handlers = {
        "checkout.session.completed": handle_checkout_completed,
        "invoice.paid": handle_invoice_paid,
        "invoice.payment_failed": handle_payment_failed,
        "customer.subscription.updated": handle_subscription_updated,
        "customer.subscription.deleted": handle_subscription_deleted,
        "charge.dispute.created": handle_dispute_created,
        "charge.refunded": handle_refund,
    }
    handler = handlers.get(event["type"])
    if handler:
        await handler(event)

    # 4. Mark as processed (72h TTL matching the PSP retry window)
    await redis.set(f"webhook:processed:{event_id}", "1", ex=259200)

    return Response(status=200)
```

#### Handled Webhook Events

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Add credits to user's IAM balance |
| `invoice.paid` | Add subscription credits; record payment |
| `invoice.payment_failed` | Send warning email; flag account |
| `customer.subscription.updated` | Update tier in IAM user properties |
| `customer.subscription.deleted` | Downgrade to Free tier |
| `charge.dispute.created` | Freeze account; debit disputed amount; create support ticket |
| `charge.dispute.closed` | Unfreeze if won; maintain debit if lost |
| `charge.refunded` | Debit refunded credits from IAM balance |

### Usage Metering

The LLM Gateway and Cloud services do not interact with Commerce directly for debits. They submit usage to IAM via the transaction API:

```
LLM Gateway receives request
    |
    +-- 1. Validate JWT (IAM)
    +-- 2. Check balance from JWT claims or /api/get-account
    +-- 3. If insufficient balance: return 402 Payment Required
    +-- 4. Execute LLM request (provider API)
    +-- 5. Calculate cost:
    |      input_tokens * input_rate + output_tokens * output_rate
    |      -> convert to USD -> round to credits
    +-- 6. Submit debit transaction to IAM:
    |      POST /api/add-transaction
    |      {
    |        "category": "Purchase",
    |        "user": "<user>",
    |        "amount": -0.012,    // negative = debit
    |        "detail": "gpt-4-turbo: 847 in + 400 out tokens"
    |      }
    +-- 7. Return response to user
```

The Gateway batches transaction submissions. Rather than calling IAM for every request, it accumulates usage per user over a 10-second window and submits a single aggregated transaction.

```yaml
metering:
  batch_interval: 10s
  batch_max_size: 100
  minimum_charge: 0.001       # 1 credit minimum debit
  balance_check: jwt_claims   # or "api_call"
  insufficient_balance_code: 402
  retry_on_iam_failure: true
  retry_max_attempts: 3
  retry_backoff: exponential
```

### Multi-Organization Billing

Each organization in IAM has independent billing. A user who belongs to multiple organizations (e.g., `z@hanzo.ai` is a member of both `hanzo` and `zoo`) has a separate balance in each organization context.

```
Organization: hanzo
  User: z
    Balance: $150.00
    Tier: Enterprise
    Transactions: [org-scoped]

Organization: zoo
  User: z
    Balance: $25.00
    Tier: Pro
    Transactions: [org-scoped]
```

When the LLM Gateway processes a request, the organization context is determined by the OAuth application that issued the token. A token from `app-cloud` (organization: `hanzo`) bills against the `hanzo` org balance. A token from `app-zoo` bills against the `zoo` org balance.

Organizations can choose between two billing modes:

- **Shared pool** (default for Team/Enterprise): One org-level balance. All members draw from the shared pool. The org owner manages top-ups and subscriptions.
- **Individual allocation**: Org admin allocates credits to each member. Members cannot exceed their allocation without admin approval.

### Refund and Dispute Handling

#### Refund Policy

- **Unused credits**: Full refund within 14 days of purchase.
- **Partially used credits**: Pro-rated refund for unused portion within 14 days.
- **After 14 days**: No refund for credit purchases.
- **Subscriptions**: Cancel anytime; no refund for current period; access continues until period end.

#### Refund Flow

1. User requests refund via support (a self-serve `/v1/billing/refund` route is a target, not yet served).
2. Commerce validates eligibility (14-day window, sufficient credit balance).
3. Commerce creates a refund via the PSP (`psp.refunds.create`) for the original payment intent.
4. The PSP processes the refund (3-5 business days to card).
5. On webhook `charge.refunded`, Commerce debits the refunded credits from IAM via `add-transaction` with negative amount.
6. If the user's balance goes negative after the debit, the account is flagged and usage is suspended until the balance is positive.

#### Dispute (Chargeback) Flow

1. The PSP receives a chargeback from the card issuer -> webhook `charge.dispute.created`.
2. Commerce immediately freezes the user account (`suspended=true` in IAM), debits the disputed amount, creates a support ticket, and notifies the admin team.
3. Commerce submits evidence to the PSP: usage logs, IP addresses, login timestamps, and ToS acceptance.
4. The card network arbitrates (60-90 days). On `charge.dispute.closed`: if won, Commerce unfreezes the account and restores the debited amount; if lost, the account remains suspended until the balance is positive.

### Invoice Generation

Commerce generates monthly invoices for all users with non-zero activity. Each invoice includes:

- **Header**: Hanzo AI Inc., 548 Market St, Suite 45000, San Francisco, CA 94104
- **Line items**: Subscription fee, credit purchases, overage charges
- **Usage summary**: Credits consumed by service (LLM Gateway, Cloud, MCP) with request counts
- **Balance**: Opening balance, credits added, usage consumed, closing balance
- **Payment**: Method used (card ending, wire reference, or $AI tx hash)

Invoices are stored as PDFs in MinIO (HIP-32) and emailed to the user. Enterprise customers on Net-30 receive invoices with payment instructions instead of automatic billing.

### Auto-Recharge

Users can configure automatic credit purchases when their balance drops below a threshold:

The configuration write (`POST /v1/billing/auto-recharge`) is a target, not yet
served; today the recharge sweep runs operator-side (`POST
/v1/billing/recharge/run-all`) against stored settings.

```json
{
  "enabled": true,
  "threshold": 1000,
  "amount": 20000,
  "max_monthly": 5,
  "payment_method": "pm_..."
}
```

When the metering pipeline detects a balance crossing below the threshold, it enqueues an auto-recharge job. The job creates a PSP payment intent using the stored (tokenized) payment method, processes the charge, and credits the balance without user interaction. Auto-recharge is rate-limited (max 5/month by default) to prevent runaway charges from buggy clients or compromised API keys.

## Implementation Roadmap

### Phase 2: Subscriptions (Completed)

- [x] Native PSP subscription creation for Pro/Team tiers
- [x] Monthly credit allocation on `invoice.paid`
- [x] Subscription upgrade/downgrade with proration
- [x] Dunning (failed payment) handling
- [x] Subscription cancellation flow

## Security Considerations

### PCI DSS Compliance

Commerce achieves PCI compliance by **never handling cardholder data**. Cardholder data is confined to the **Hanzo Vault** CDE — the only PCI-DSS-scoped component — which hosts the payment form (native hosted checkout) and issues opaque tokens. Commerce and every app server operate on tokens only; they never see, store, process, or transmit card numbers, CVVs, or expiration dates. Commerce qualifies as a **SAQ A** surface; the Vault carries the full SAQ D / RoC scope, isolated from the rest of the ecosystem.

### Webhook Signature Verification

Every native-PSP webhook is verified using HMAC-SHA256:

```python
# The PSP signs webhooks with the webhook signing secret (held in KMS).
# The signature includes a timestamp to prevent replay attacks.
signature = request.headers["X-Webhook-Signature"]
# Format: t=<timestamp>,v1=<signature>

expected = hmac_sha256(
    key=psp_webhook_secret,   # from KMS, never plaintext
    message=f"{timestamp}.{payload}"
)

# Reject if:
# 1. Signature does not match (forged webhook)
# 2. Timestamp is > 300 seconds old (replay attack)
# 3. Event ID already processed (duplicate delivery)
```

### Idempotency

Every payment operation uses idempotency keys to prevent double-charging:

1. **PSP Checkout**: The `idempotency_key` in session metadata ensures retried webhooks do not create duplicate credits.
2. **IAM Transactions**: The transaction `name` field (`txn_psp_{event_id}`) acts as a unique constraint. IAM rejects duplicate transaction names.
3. **Deduplication store**: Processed webhook event IDs are persisted with a 72-hour TTL matching the PSP's retry window.

These three layers provide defense-in-depth against double-processing.

### Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/v1/billing/topup` | 10 | per minute per user |
| `/v1/billing/subscribe/card` | 5 | per minute per user |
| `/v1/billing/balance` | 60 | per minute per user |
| `/v1/billing/transactions` | 30 | per minute per user |
| `/v1/billing/usage` | 10 | per minute per user |
| `/webhooks/psp` | 1000 | per minute (global) |

Rate limiting is enforced via KV sliding window counters. Exceeding the limit returns `429 Too Many Requests` with a `Retry-After` header.

### Audit Trail

Every financial event produces an immutable audit record:

```json
{
  "event_id": "evt_audit_001",
  "timestamp": "2026-02-23T10:30:15.123Z",
  "action": "credit_purchase",
  "actor": {
    "user_id": "hanzo/z",
    "ip": "203.0.113.42",
    "user_agent": "Mozilla/5.0..."
  },
  "details": {
    "psp_event_id": "evt_...",
    "psp_session_id": "cs_...",
    "amount_usd": 20.00,
    "credits_added": 21000,
    "balance_before": 5000,
    "balance_after": 26000,
    "idempotency_key": "ik_abc123"
  },
  "integrity": "sha256:ab3f..."
}
```

Audit records are append-only (never updated or deleted), integrity-protected with SHA-256 hash chains, retained for 7 years (financial regulatory minimum), and exportable for SOC 2 and compliance audits.

### Fraud Prevention

- **Velocity checks**: Commerce flags users who make >5 purchases in 1 hour or >$500 in 24 hours for manual review.
- **Chargeback response**: Disputes trigger immediate account freeze and balance debit. Evidence is automatically compiled from usage logs.
- **Free-tier abuse**: Free-tier credit resets are tied to verified email addresses. Multiple accounts with the same email or phone are detected and consolidated.

### Insufficient Balance Handling

When a user's balance reaches zero during an API request:

1. The LLM Gateway returns `402 Payment Required` with a link to the billing page.
2. Streaming responses are terminated gracefully -- partial completions are delivered with a final chunk indicating billing exhaustion.
3. If auto-recharge is enabled, it triggers immediately, and the request can be retried.

## References

1. [HIP-1: $AI Token](./hip-0001-ai-coin-hanzos-native-currency.md) - Native currency for crypto payments
2. [HIP-4: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md) - Primary usage metering source
3. [HIP-8: HMM (Hanzo Market Maker)](./hip-0008-hmm-hanzo-market-maker-native-dex-for-ai-compute-resources.md) - Token price oracle for crypto-to-credit conversion
4. [HIP-25: Bot Agent Wallet & RPC Billing Protocol](./hip-0025-bot-agent-wallet-rpc-billing-protocol.md) - Agent-level billing built on Commerce
5. [HIP-26: Identity & Access Management Standard](./hip-0026-identity-access-management-standard.md) - Balance storage and transaction ledger
6. [HIP-27: Secrets Management Standard](./hip-0027-secrets-management-standard.md) - KMS for PSP keys and secrets
7. [HIP-1061: MQ — Queues and Streams](./hip-1061-mq-queues-and-streams.md) - Billing event distribution
8. HIP-32: Object Storage Standard - Invoice PDF storage
9. [HIP-101: Hanzo-Lux Bridge Protocol](./hip-0101-hanzo-lux-bridge-protocol-integration.md) - Cross-chain payment acceptance
10. [Hanzo Pay (native PSP) — `github.com/lux-pay`](https://github.com/lux-pay) (white-labeled `lux-pay` on Lux)
11. [Hanzo Vault — PCI CDE / card tokenization](https://github.com/hanzoai/vault)
12. [PCI DSS v4.0 — SAQ A / SAQ D scoping](https://www.pcisecuritystandards.org/)
13. [PCI DSS Quick Reference Guide](https://www.pcisecuritystandards.org/document_library)
14. [Hanzo Commerce Repository](https://github.com/hanzoai/commerce)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
