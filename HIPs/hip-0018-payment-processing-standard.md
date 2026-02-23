---
hip: 0018
title: Payment Processing Standard
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2025-01-09
updated: 2026-02-23
requires: HIP-1, HIP-4, HIP-26, HIP-27, HIP-30
---

# HIP-18: Payment Processing Standard

## Abstract

This proposal defines the payment processing standard for the Hanzo ecosystem. Hanzo Commerce is the billing, subscription, and payment service that bridges external payment processors (primarily Stripe) with the internal credit system managed by Hanzo IAM (HIP-26). Every dollar a user pays is converted into credits. Every AI inference, API call, or compute job consumes credits. Commerce handles the money side; IAM holds the balance; the LLM Gateway (HIP-4) and Cloud services meter usage.

The system is designed around a single invariant: **IAM is the source of truth for user balances**. Commerce writes credits in; Cloud and Gateway write credits out. No service other than IAM may directly mutate a user's balance. All mutations flow through IAM's transaction API.

**Repository**: [github.com/hanzoai/commerce](https://github.com/hanzoai/commerce)
**Port**: 4242
**Docker**: `ghcr.io/hanzoai/commerce:latest`

## Motivation

### The Problem

AI usage billing is fundamentally different from SaaS billing. A typical SaaS charges a flat monthly fee for feature access. AI platforms charge per token, per image, per minute of audio, per GPU-second of fine-tuning. The unit costs span four orders of magnitude -- a GPT-3.5 completion might cost $0.0002 while a GPT-4 Vision request with a large image costs $0.30. Presenting these raw costs to users is confusing and creates billing anxiety.

Meanwhile, the Hanzo ecosystem has multiple services that incur costs:

1. **LLM Gateway** (HIP-4): Chat completions, embeddings, image generation across 100+ providers
2. **Cloud**: Hosted model inference, fine-tuning jobs, compute clusters
3. **MCP Tools**: Computer use, browser automation, search -- each with different cost profiles
4. **Agent SDK**: Multi-agent orchestration where a single user request may trigger dozens of LLM calls

Without a unified billing system, each service would need its own payment integration, balance tracking, and invoice generation. Users would face multiple bills, multiple balances, and no single view of their spend.

### Why This Matters

1. **User trust**: Users must understand what they are paying for. Opaque per-token billing erodes trust. Credits provide a simple, predictable unit.
2. **Service isolation**: LLM Gateway should not need Stripe credentials. It should check a balance, do the work, and report usage. Payment processing is not its job.
3. **Fraud prevention**: A single source of truth for balances prevents double-spending. If Cloud and Gateway each maintained independent balances, a race condition could allow a user to spend more than they have.
4. **Regulatory compliance**: Financial transactions require audit trails, PCI compliance, and dispute resolution. Centralizing this in Commerce means one team handles compliance, not five.

## Design Philosophy

This section explains the *why* behind each major design decision. Payment systems are among the most consequential infrastructure choices a company makes. Mistakes are expensive -- literally.

### Why Credits-Based Billing

AI usage is unpredictable. A user might send one message that triggers a 4-token response or one that triggers a 4,000-token response with tool calls, image generation, and web search. Showing users a per-request cost breakdown like "$0.000847 for 423 input tokens at $0.002/1K + $0.000612 for 204 output tokens at $0.003/1K" is hostile UX.

Credits provide a simple mental model: you buy credits, you spend credits. 1 credit = $0.001 USD. A $20 top-up gives you 20,000 credits. A typical GPT-4 conversation costs 50-200 credits. Users can reason about their spending without understanding tokenization, provider pricing tiers, or markup calculations.

Credits also decouple the billing unit from provider pricing. When OpenAI changes their per-token rates (which happens quarterly), we adjust the internal credit-to-token conversion without changing the user-facing credit price. The user's mental model remains stable.

The alternative -- real-time per-token billing in USD -- requires sub-cent transaction tracking, creates rounding errors that accumulate, and produces invoices with thousands of line items. Credits eliminate all three problems.

### Why Stripe Over Building Payment Infrastructure

PCI DSS compliance requires 300+ security controls across 12 requirement categories. An in-house payment system must handle card number encryption, key rotation, network segmentation, penetration testing, and annual audits. The compliance cost alone is $50K-$200K/year for a Level 3 merchant.

Stripe handles all of this. We never see, store, or transmit card numbers. Stripe's `checkout.session` creates a hosted payment page on Stripe's PCI-compliant infrastructure. Our servers only receive webhooks confirming that payment succeeded.

Beyond compliance, Stripe provides:

- **Global payment methods**: Cards, Apple Pay, Google Pay, SEPA, iDEAL, bank transfers in 135+ currencies across 45+ countries.
- **Subscription management**: Recurring billing, proration, dunning (failed payment retry), and subscription lifecycle hooks.
- **Invoicing**: Automatic invoice generation, PDF rendering, and email delivery.
- **Fraud detection**: Stripe Radar uses ML to block fraudulent transactions before they reach us.
- **Connect**: For future marketplace features where agents (HIP-25) earn revenue.

The cost is 2.9% + $0.30 per transaction. For a $20 credit purchase, that is $0.88. For the PCI compliance, global coverage, and engineering time saved, this is an excellent trade.

### Why Not Paddle

Paddle is a Merchant of Record (MoR) -- it handles sales tax, VAT, and regulatory compliance in exchange for higher fees (5% + $0.50). This is attractive for companies selling to consumers in the EU where VAT rules are complex. However:

1. **Limited payment methods**: Paddle supports fewer payment methods than Stripe, particularly in Asia and Latin America where crypto-native developers cluster.
2. **Slower payouts**: Paddle batches payouts weekly or monthly; Stripe settles in 2 business days.
3. **Less API control**: Paddle's API is opinionated about subscription models. Our credit-based system requires more flexibility than Paddle provides.
4. **Pricing**: 5% vs 2.9% adds up quickly at scale. On $1M annual revenue, that is $21K in additional fees.

For Hanzo's use case -- a B2B/B2D (business-to-developer) platform with global reach -- Stripe's flexibility and lower fees win.

### Why Not Blockchain-Only Payments

The Hanzo ecosystem includes $AI token (HIP-1) and on-chain settlement (HIP-25). Why not use blockchain for all payments?

1. **Friction**: Most developers do not have crypto wallets. Requiring wallet setup, token purchase, and gas fees for a $20 credit top-up would eliminate 90%+ of potential users.
2. **Volatility**: Token prices fluctuate. If a user buys credits with $AI at $0.50 and the price drops to $0.30 before they use the credits, who absorbs the loss?
3. **Speed**: Stripe processes a payment in 2-3 seconds. On-chain settlement takes 2-15 seconds depending on the chain and requires block confirmations for finality.
4. **Chargebacks**: Credit card users have dispute rights. Blockchain transactions are irreversible. Offering only crypto payments forfeits consumer protection, which is a regulatory risk.

The correct approach is **both**: Stripe for fiat, blockchain for crypto. Commerce accepts both and normalizes them into credits. The user does not need to know or care which payment rail was used.

### Why IAM Holds Balances

Every authenticated API call already hits IAM to validate the JWT. The LLM Gateway (HIP-4) receives a request, extracts the bearer token, and validates it against IAM's public key or calls `/api/get-account`. This round-trip is unavoidable -- you must authenticate before executing.

If balance lived in Commerce, every LLM call would require two round-trips:

```
Request -> Gateway -> IAM (auth: 3ms) -> Commerce (balance: 5ms) -> Upstream (inference: 200ms)
```

By storing balance in IAM, the auth check and balance check collapse into one operation:

```
Request -> Gateway -> IAM (auth + balance: 3ms) -> Upstream (inference: 200ms)
```

At 1,000 requests/second, eliminating the Commerce round-trip saves 5,000ms of cumulative latency per second and removes Commerce as a critical-path dependency. If Commerce goes down, users cannot *buy* credits, but they can still *use* existing credits because IAM is independent.

The tradeoff: balance is denormalized. Commerce is the authoritative ledger ("what transactions occurred"), and IAM is the balance cache ("what is the current balance"). A reconciliation job detects and corrects drift between the two. This is covered in detail in HIP-26 Section "Why Credit Balances Live in IAM."

### Why Webhook-Driven Architecture

Payment processing is inherently asynchronous. A user clicks "Pay" on a Stripe Checkout page, enters their card, waits for 3D Secure, and Stripe processes the charge. This takes 5-30 seconds. Holding a synchronous HTTP connection open for this duration is fragile.

Instead, Commerce uses webhooks:

1. Commerce creates a Stripe Checkout Session and returns the URL to the client.
2. Client redirects to Stripe's hosted checkout page.
3. User completes payment on Stripe's infrastructure.
4. Stripe sends a `checkout.session.completed` webhook to Commerce.
5. Commerce verifies the webhook signature, records the transaction, then calls IAM to add credits.

This decouples payment processing from service delivery. If Commerce is briefly unavailable when the webhook fires, Stripe retries with exponential backoff for up to 72 hours. Eventual consistency is acceptable for billing -- a 30-second delay between payment and credit delivery is imperceptible to users.

## Specification

### Architecture

```
                              +------------------------+
                              |       Stripe           |
                              |  (Checkout, Billing,   |
                              |   Webhooks, Invoices)  |
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
| Storage | `float64` in IAM user `balance` field (USD-denominated) |

Credits are stored as a USD-denominated float in IAM (1,000 credits = $1.00 balance). The "credit" is a user-facing abstraction; the IAM balance field stores the dollar equivalent. This means 20,000 credits = $20.00 balance.

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
    stripe_price_id: null
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
    stripe_price_id: "price_pro_monthly"
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
    stripe_price_id: "price_team_monthly"
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
    stripe_price_id: "price_enterprise_custom"
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

- **Upgrade**: Commerce creates Stripe Subscription -> Stripe charges monthly -> webhook `invoice.paid` -> Commerce credits IAM with included credits.
- **Renewal**: Stripe auto-charges -> webhook `invoice.paid` -> Commerce adds monthly credits. Unused credits from previous months roll over for 90 days.
- **Overage**: When a Pro/Team user exceeds included credits, usage continues at the standard rate. Overage is metered via Stripe usage records and billed at period end alongside the subscription fee.
- **Downgrade**: Commerce cancels the Stripe Subscription at period end. Remaining credits are usable until expiry. After the period ends, the user reverts to Free tier (1,000 credits/month, hard cap).
- **Payment failure**: Stripe retries 3 times over 7 days using smart retries. After 3 failures the subscription enters `past_due`. After 14 days `past_due`, the subscription is canceled and the user is downgraded to Free.

### Payment Flow

#### One-Time Credit Purchase (Fiat)

```
1. Client: POST /v1/billing/checkout { amount: 2000, currency: "usd", credits: 21000 }
2. Commerce creates Stripe Checkout Session with metadata (user_id, org_id, credits, idempotency_key)
3. Commerce returns checkout URL -> client redirects user to Stripe
4. User completes payment on Stripe's hosted page
5. Stripe fires webhook: checkout.session.completed
6. Commerce verifies webhook signature (HMAC-SHA256)
7. Commerce checks idempotency key in Redis (prevent double-processing)
8. Commerce calls IAM: POST /api/add-balance { owner: "hanzo", user: "z", amount: 21.0 }
9. Commerce records transaction: POST /api/add-transaction
   { category: "Recharge", user: "z", amount: 21.0, name: "txn_stripe_cs_..." }
10. User's IAM balance updated. Credits available immediately.
```

#### Crypto Payment Flow ($AI Token)

Commerce also accepts $AI token (HIP-1) payments on Hanzo Network (chain ID 36963). The user sends tokens to a per-user deposit address. Commerce's on-chain listener detects the Transfer event (1 block confirmation for <$1K, 6 for >=$1K), converts $AI to USD at the 10-minute TWAP oracle rate via HMM (HIP-8), and credits the user's IAM balance through the same add-balance/add-transaction flow as fiat.

### Billing API Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/v1/billing/balance` | Current credit balance | Bearer token |
| GET | `/v1/billing/transactions` | Transaction history with pagination | Bearer token |
| POST | `/v1/billing/checkout` | Create Stripe Checkout session | Bearer token |
| POST | `/v1/billing/checkout/crypto` | Create crypto payment intent | Bearer token |
| POST | `/v1/billing/subscribe` | Create or change subscription | Bearer token |
| DELETE | `/v1/billing/subscribe` | Cancel subscription | Bearer token |
| GET | `/v1/billing/subscription` | Current subscription details | Bearer token |
| GET | `/v1/billing/invoices` | List invoices | Bearer token |
| GET | `/v1/billing/invoices/:id` | Download invoice PDF | Bearer token |
| GET | `/v1/billing/usage` | Usage breakdown by period | Bearer token |
| POST | `/v1/billing/portal` | Create Stripe Customer Portal session | Bearer token |
| POST | `/webhooks/stripe` | Stripe webhook receiver | Stripe signature |

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

Commerce receives webhooks from Stripe for all payment-related events. The webhook handler follows a strict pipeline:

```python
async def handle_stripe_webhook(request):
    # 1. Verify signature (CRITICAL - prevents forgery)
    payload = request.body
    signature = request.headers["Stripe-Signature"]
    try:
        event = stripe.Webhook.construct_event(
            payload, signature, STRIPE_WEBHOOK_SECRET
        )
    except stripe.error.SignatureVerificationError:
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

    # 4. Mark as processed (72h TTL matching Stripe retry window)
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

The Gateway batches transaction submissions. Rather than calling IAM for every request, it accumulates usage per user over a 10-second window and submits a single aggregated transaction. This reduces IAM load by ~90% during high-throughput periods.

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

1. User requests refund via support or `/v1/billing/refund`.
2. Commerce validates eligibility (14-day window, sufficient credit balance).
3. Commerce creates a Stripe refund (`stripe.refunds.create`) for the original payment intent.
4. Stripe processes the refund (3-5 business days to card).
5. On webhook `charge.refunded`, Commerce debits the refunded credits from IAM via `add-transaction` with negative amount.
6. If the user's balance goes negative after the debit, the account is flagged and usage is suspended until the balance is positive.

#### Dispute (Chargeback) Flow

1. Stripe receives a chargeback from the card issuer -> webhook `charge.dispute.created`.
2. Commerce immediately freezes the user account (`suspended=true` in IAM), debits the disputed amount, creates a support ticket, and notifies the admin team.
3. Commerce submits evidence to Stripe: usage logs, IP addresses, login timestamps, and ToS acceptance.
4. Stripe arbitrates (60-90 days). On `charge.dispute.closed`: if won, Commerce unfreezes the account and restores the debited amount; if lost, the account remains suspended until the balance is positive.

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

```json
POST /v1/billing/auto-recharge
Authorization: Bearer <access_token>

{
  "enabled": true,
  "threshold": 1000,
  "amount": 20000,
  "max_monthly": 5,
  "payment_method": "pm_..."
}
```

When the metering pipeline detects a balance crossing below the threshold, it enqueues an auto-recharge job. The job creates a Stripe PaymentIntent using the stored payment method, processes the charge, and credits the balance without user interaction. Auto-recharge is rate-limited (max 5/month by default) to prevent runaway charges from buggy clients or compromised API keys.

## Implementation Roadmap

### Phase 1: Core Billing (Completed)

- [x] Stripe Checkout integration for one-time credit purchases
- [x] Webhook handler for `checkout.session.completed`
- [x] IAM balance update via `/api/add-balance`
- [x] Transaction recording via `/api/add-transaction`
- [x] Balance and transaction query endpoints
- [x] Idempotency key tracking in Redis

### Phase 2: Subscriptions (Completed)

- [x] Stripe Subscription creation for Pro/Team tiers
- [x] Monthly credit allocation on `invoice.paid`
- [x] Subscription upgrade/downgrade with proration
- [x] Dunning (failed payment) handling
- [x] Subscription cancellation flow

### Phase 3: Usage Metering (In Progress)

- [ ] LLM Gateway batched transaction submission
- [ ] Per-model credit cost configuration
- [ ] Real-time usage dashboard
- [ ] Usage breakdown by model, service, and time period
- [ ] Overage billing via Stripe metered usage

### Phase 4: Multi-Org and Enterprise (Planned)

- [ ] Org-level billing with shared pool mode
- [ ] Individual credit allocation per member
- [ ] Enterprise invoice billing (NET 30)
- [ ] Custom rate cards for enterprise customers
- [ ] SOC 2 Type II audit trail exports

### Phase 5: Crypto Payments (Planned)

- [ ] $AI token payment acceptance on Hanzo Network
- [ ] USDC/USDT acceptance via Lux Bridge (HIP-101)
- [ ] On-chain settlement receipts
- [ ] Token-to-credit conversion via HMM oracle (HIP-8)

## Security Considerations

### PCI DSS Compliance

Commerce achieves PCI compliance by **never handling cardholder data**. All payment forms are hosted by Stripe (Checkout Sessions, Elements, or Customer Portal). Commerce servers never see, store, process, or transmit card numbers, CVVs, or expiration dates. This qualifies Hanzo as a **SAQ A** merchant -- the simplest PCI self-assessment level.

### Webhook Signature Verification

Every Stripe webhook is verified using HMAC-SHA256:

```python
# Stripe signs webhooks with the webhook signing secret.
# The signature includes a timestamp to prevent replay attacks.
signature = request.headers["Stripe-Signature"]
# Format: t=<timestamp>,v1=<signature>

expected = hmac_sha256(
    key=STRIPE_WEBHOOK_SECRET,
    message=f"{timestamp}.{payload}"
)

# Reject if:
# 1. Signature does not match (forged webhook)
# 2. Timestamp is > 300 seconds old (replay attack)
# 3. Event ID already processed (duplicate delivery)
```

### Idempotency

Every payment operation uses idempotency keys to prevent double-charging:

1. **Stripe Checkout**: The `idempotency_key` in session metadata ensures retried webhooks do not create duplicate credits.
2. **IAM Transactions**: The transaction `name` field (`txn_stripe_{event_id}`) acts as a unique constraint. IAM rejects duplicate transaction names.
3. **Redis deduplication**: Processed webhook event IDs are stored in Redis with a 72-hour TTL matching Stripe's retry window.

These three layers provide defense-in-depth against double-processing.

### Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/v1/billing/checkout` | 10 | per minute per user |
| `/v1/billing/subscribe` | 5 | per minute per user |
| `/v1/billing/balance` | 60 | per minute per user |
| `/v1/billing/transactions` | 30 | per minute per user |
| `/v1/billing/usage` | 10 | per minute per user |
| `/webhooks/stripe` | 1000 | per minute (global) |

Rate limiting is enforced via Redis sliding window counters. Exceeding the limit returns `429 Too Many Requests` with a `Retry-After` header.

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
    "stripe_event_id": "evt_...",
    "stripe_session_id": "cs_...",
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
6. [HIP-27: Secrets Management Standard](./hip-0027-secrets-management-standard.md) - KMS for Stripe keys and secrets
7. [HIP-30: Event Streaming Standard](./hip-0030-event-streaming-standard.md) - Billing event distribution
8. [HIP-32: Object Storage Standard](./hip-0032-object-storage-standard.md) - Invoice PDF storage
9. [HIP-101: Hanzo-Lux Bridge Protocol](./hip-0101-hanzo-lux-bridge-protocol-integration.md) - Cross-chain payment acceptance
10. [Stripe Checkout Documentation](https://stripe.com/docs/payments/checkout)
11. [Stripe Webhooks Best Practices](https://stripe.com/docs/webhooks/best-practices)
12. [Stripe Billing / Subscriptions](https://stripe.com/docs/billing/subscriptions/overview)
13. [PCI DSS Quick Reference Guide](https://www.pcisecuritystandards.org/document_library)
14. [Hanzo Commerce Repository](https://github.com/hanzoai/commerce)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
