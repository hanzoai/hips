---
hip: 12
title: Search Interface Standard
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2025-01-09
requires: HIP-4
---

# HIP-12: Search Interface Standard

## Abstract

This proposal defines the search interface standard. All search functionality in the Hanzo ecosystem MUST implement this interface.

**Repository**: [github.com/hanzoai/search](https://github.com/hanzoai/search)  
**Port**: 3000

## Motivation

We need ONE standard way to:
- Search with AI enhancement
- Generate search results
- Provide citations

## Specification

### Search Request

```typescript
interface SearchRequest {
  query: string;
  limit?: number;
  filters?: Record<string, any>;
}
```

### Search Response

```typescript
interface SearchResult {
  id: string;
  title: string;
  url: string;
  snippet: string;
  score: number;
}

interface SearchResponse {
  results: SearchResult[];
  answer?: string;  // AI-generated answer
  citations?: string[];
}
```

### API Endpoint

```yaml
POST /api/search
  Body: SearchRequest
  Response: SearchResponse
```

## Implementation

Search connects to LLM Gateway (HIP-4) for AI enhancement:

```
Query → Search (HIP-12) → LLM Gateway (HIP-4) → AI Answer
                      ↓
                  Web Results
```

## References

1. [HIP-4: LLM Gateway](./hip-4.md)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).