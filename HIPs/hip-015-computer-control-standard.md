---
hip: 015
title: Computer Control Standard
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2025-01-09
requires: HIP-9
---

# HIP-15: Computer Control Standard

## Abstract

This proposal defines the computer control standard for AI agents to interact with desktop applications. All computer control MUST use this interface.

**Repository**: [github.com/hanzoai/operative](https://github.com/hanzoai/operative)

## Motivation

We need ONE standard way for agents to:
- Control mouse and keyboard
- Take screenshots
- Interact with applications

## Specification

### Control Actions

```typescript
interface ScreenAction {
  type: "click" | "type" | "key" | "screenshot" | "drag";
  coordinates?: {x: number, y: number};
  text?: string;
  key?: string;
}
```

### Screen State

```typescript
interface ScreenState {
  screenshot: string;  // base64
  resolution: {width: number, height: number};
  activeWindow: string;
}
```

### API Endpoints

```yaml
POST /api/control/action
  Body: ScreenAction
  Response: {success: boolean}
  
GET /api/control/screenshot
  Response: ScreenState
```

## Implementation

Computer control runs in Docker with virtual display:

```
Agent (HIP-9) → Operative (HIP-15) → Virtual Display → Application
```

## References

1. [HIP-9: Agent SDK](./hip-9.md)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).