---
hip: 013
title: Workflow Execution Standard
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2025-01-09
requires: HIP-9
---

# HIP-13: Workflow Execution Standard

## Abstract

This proposal defines the workflow execution standard for multi-step agent tasks. All workflow systems MUST implement this interface.

**Repository**: [github.com/hanzoai/flow](https://github.com/hanzoai/flow)

## Motivation

We need ONE standard way to:
- Define multi-step workflows
- Execute agent tasks in sequence
- Handle branching logic

## Specification

### Workflow Definition

```yaml
workflow:
  name: "Example Workflow"
  steps:
    - id: "step1"
      agent: "researcher"
      action: "search"
      input: "${query}"
      
    - id: "step2"
      agent: "writer"
      action: "summarize"
      input: "${step1.output}"
      
    - id: "step3"
      condition: "${step2.length > 1000}"
      agent: "editor"
      action: "condense"
      input: "${step2.output}"
```

### Execution Interface

```typescript
interface WorkflowExecution {
  id: string;
  workflow: string;
  status: "pending" | "running" | "completed" | "failed";
  currentStep: string;
  outputs: Record<string, any>;
}
```

### API Endpoint

```yaml
POST /api/workflows/execute
  Body: {workflow: WorkflowDefinition, inputs: Record<string, any>}
  Response: WorkflowExecution
```

## Implementation

Workflows use Agent SDK (HIP-9) for execution:

```
Workflow (HIP-13) → Agent SDK (HIP-9) → Agents
```

## References

1. [HIP-9: Agent SDK](./hip-9.md)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).