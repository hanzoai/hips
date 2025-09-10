---
hip: 18
title: Payment Processing Standard
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2025-01-09
requires: HIP-1
---

# HIP-18: Payment Processing Standard

## Abstract

This proposal defines the payment processing standard for $AI token and fiat payments. All payments MUST use this interface.

**Repository**: [github.com/hanzoai/pay](https://github.com/hanzoai/pay)  
**Port**: 4242

## Motivation

We need ONE standard way to:
- Process $AI token payments
- Handle fiat conversions
- Manage subscriptions

## Specification

### Payment Request

```typescript
interface PaymentRequest {
  amount: number;
  currency: "AI" | "USD" | "EUR";
  recipient: string;
  metadata?: Record<string, any>;
}
```

### Payment Status

```typescript
interface PaymentStatus {
  id: string;
  status: "pending" | "completed" | "failed";
  txHash?: string;
  amount: number;
  currency: string;
}
```

### API Endpoints

```yaml
POST /api/payments/create
  Body: PaymentRequest
  Response: {paymentId: string, paymentUrl: string}
  
GET /api/payments/:id/status
  Response: PaymentStatus
```

## Implementation

Payments integrate with blockchain and Stripe:

```
Payment Request → Pay (HIP-18) → $AI Contract (HIP-1)
                              ↓
                          Stripe (fiat)
```

## References

1. [HIP-1: $AI Token](./hip-1.md)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).