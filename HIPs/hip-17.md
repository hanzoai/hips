---
hip: 17
title: Analytics Event Standard
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2025-01-09
---

# HIP-17: Analytics Event Standard

## Abstract

This proposal defines the analytics event standard. All analytics in the Hanzo ecosystem MUST use this format.

**Repository**: [github.com/hanzoai/analytics](https://github.com/hanzoai/analytics)

## Motivation

We need ONE standard way to:
- Track events
- Measure metrics
- Generate insights

## Specification

### Event Format

```typescript
interface AnalyticsEvent {
  timestamp: number;
  event: string;
  userId?: string;
  properties?: Record<string, any>;
  context?: {
    ip?: string;
    userAgent?: string;
    sessionId?: string;
  };
}
```

### Metrics Query

```typescript
interface MetricsQuery {
  metric: string;
  timeRange: {start: number, end: number};
  groupBy?: string;
  filters?: Record<string, any>;
}
```

### API Endpoints

```yaml
POST /api/events
  Body: AnalyticsEvent
  Response: {success: boolean}
  
POST /api/metrics/query
  Body: MetricsQuery
  Response: {data: any[], total: number}
```

## Implementation

Analytics stores events in time-series database:

```
Event → Analytics (HIP-17) → TimescaleDB → Metrics
```

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).