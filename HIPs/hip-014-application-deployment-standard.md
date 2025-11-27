---
hip: 014
title: Application Deployment Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2025-01-09
---

# HIP-14: Application Deployment Standard

## Abstract

This proposal defines the application deployment standard for the Hanzo platform. All applications MUST follow this deployment specification.

**Repository**: [github.com/hanzoai/platform](https://github.com/hanzoai/platform)

## Motivation

We need ONE standard way to:
- Deploy applications
- Scale services
- Manage resources

## Specification

### Application Manifest

```yaml
# hanzo.yaml
name: my-app
runtime: node-20
build:
  command: npm run build
  output: dist
  
deploy:
  instances: 3
  memory: 512MB
  cpu: 0.5
  
services:
  - type: web
    port: 3000
    healthcheck: /health
    
env:
  - name: DATABASE_URL
    secret: true
```

### Deployment API

```typescript
interface Deployment {
  id: string;
  app: string;
  version: string;
  status: "building" | "deploying" | "running" | "failed";
  url: string;
}
```

### Commands

```bash
hanzo deploy         # Deploy from hanzo.yaml
hanzo scale 5        # Scale to 5 instances
hanzo logs           # View logs
hanzo rollback       # Rollback to previous
```

## Implementation

Platform manages containers via Kubernetes:

```
App → Platform (HIP-14) → Kubernetes → Pods
```

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).