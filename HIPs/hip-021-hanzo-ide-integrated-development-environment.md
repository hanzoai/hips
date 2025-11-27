---
hip: 021
title: Hanzo IDE - Integrated Development Environment
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2025-01-20
requires: HIP-0, HIP-20
---

# HIP-21: Hanzo IDE - Integrated Development Environment

## Abstract

This proposal defines the Hanzo IDE standard - a comprehensive development environment integrating AI agents, Model Context Protocol (MCP), and decentralized compute. The IDE provides a unified interface for development with continuous AI personalization.

**Production URL**: [ide.hanzo.ai](https://ide.hanzo.ai)
**Repository**: [github.com/hanzo-ai/ide](https://github.com/hanzo-ai/ide)

## Motivation

Developers need an integrated environment that:
- Provides AI-assisted development with personalized models
- Supports decentralized compute and confidential computation
- Integrates seamlessly with Hanzo ecosystem
- Enables continuous learning from developer interactions

## Specification

### Architecture

```yaml
# Core Components
frontend:
  framework: Next.js 14
  ui: @hanzo/ui
  websocket: Socket.IO
  
backend:
  server: FastAPI
  runtime: Docker/K8s/WASM
  mcp: Model Context Protocol
  
integrations:
  node: Hanzo Node (HIP-20)
  compute: Decentralized GPU pool
  storage: MinIO/S3
  database: PostgreSQL
  cache: Redis
```

### MCP Integration

The IDE implements Model Context Protocol for tool management:

```python
class MCPClient:
    """Enhanced MCP client with SSE, HTTP, and stdio support"""
    
    async def initialize(self):
        """Initialize connection to MCP server"""
        
    async def call_tool(self, name: str, arguments: dict):
        """Execute tool via MCP protocol"""
        
    async def list_tools(self) -> List[Tool]:
        """Get available tools from server"""
```

### Runtime Support

Multiple runtime environments for code execution:

```yaml
runtimes:
  - native: Rust-based high-performance
  - docker: Containerized isolation
  - kubernetes: Orchestrated scaling
  - deno: Secure JavaScript/TypeScript
  - python: Data science workflows
  - mcp: Tool execution protocol
  - wasm: Browser-based execution
```

### Privacy Tiers

Graduated privacy levels for computation:

```yaml
tiers:
  0: Open computation (public)
  1: Encrypted transport (TLS)
  2: Encrypted storage (at-rest)
  3: Confidential compute (TEE)
  4: TEE with I/O protection
```

## Implementation

### Production Deployment

```yaml
# compose.prod.yml
services:
  ide:
    image: hanzo/ide:latest
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://...
      
  hanzo-node:
    image: hanzo/node:latest
    volumes:
      - models:/models
    deploy:
      resources:
        reservations:
          devices:
            - capabilities: [gpu]
              
  traefik:
    image: traefik:v3.0
    ports:
      - "443:443"
    command:
      - "--certificatesresolvers.letsencrypt.acme.email=ops@hanzo.ai"
```

### API Endpoints

```yaml
# IDE API
POST /api/execute
  Execute code in runtime
  
POST /api/chat
  Chat with AI assistant
  
WS /api/ws
  WebSocket for real-time updates
  
# MCP API  
POST /api/mcp/initialize
  Initialize MCP connection
  
POST /api/mcp/tools
  List available tools
  
POST /api/mcp/execute
  Execute MCP tool
```

### Security Model

```yaml
authentication:
  - OAuth2/OIDC
  - API keys
  - JWT tokens
  
authorization:
  - RBAC policies
  - Resource quotas
  - Rate limiting
  
encryption:
  - TLS 1.3 minimum
  - E2E encryption for sensitive data
  - PQC algorithms (ML-KEM, ML-DSA)
```

## Deployment

### Cloud Deployment

```bash
# Deploy to ide.hanzo.ai
./scripts/deploy-production.sh

# Health check
curl https://ide.hanzo.ai/api/health

# Monitor
docker compose -f compose.prod.yml logs -f
```

### Local Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Access at http://localhost:3001
```

## Integration Points

### With Hanzo Node (HIP-20)

```python
class HanzoNodeIntegration:
    async def submit_compute(self, task: ComputeTask):
        """Submit task to decentralized compute network"""
        
    async def get_compute_proof(self, task_id: str):
        """Get proof of computation"""
```

### With Personalized AI (HIP-22)

```python
class PersonalizationEngine:
    async def collect_interactions(self):
        """Collect user-LLM interactions"""
        
    async def trigger_finetuning(self):
        """Hourly fine-tuning pipeline"""
        
    async def deploy_bitdelta(self):
        """Deploy compressed personal model"""
```

## Monitoring

### Metrics

```yaml
prometheus:
  - ide_requests_total
  - ide_compute_tasks
  - ide_mcp_calls
  - ide_model_updates
  
grafana:
  - Dashboard: IDE Performance
  - Dashboard: Compute Usage
  - Dashboard: User Activity
```

## Migration Path

From OpenHands to Hanzo IDE:

1. **Branding**: Replace OpenHands with Hanzo IDE
2. **MCP**: Integrate Model Context Protocol
3. **Node**: Connect to Hanzo Node network
4. **Personalization**: Enable continuous learning
5. **Deploy**: Launch on ide.hanzo.ai

## Reference Implementation

**Repository**: [hanzo-ai/ide](https://github.com/hanzo-ai/ide)

**Production URL**: [ide.hanzo.ai](https://ide.hanzo.ai)

**Key Files**:
- `/frontend/src/app/` - Next.js 14 application
- `/backend/api/main.py` - FastAPI backend server
- `/backend/mcp/client.py` - Model Context Protocol client
- `/backend/runtime/` - Multi-runtime execution engines
- `/backend/compute/node.py` - Hanzo Node integration
- `/docker/compose.prod.yml` - Production deployment config
- `/tests/integration/` - Integration test suite

**Status**: Deployed to Production

**Tech Stack**:
- **Frontend**: Next.js 14, @hanzo/ui, Socket.IO
- **Backend**: FastAPI, asyncio, Docker/K8s
- **MCP**: Enhanced client with SSE/HTTP/stdio
- **Storage**: MinIO/S3, PostgreSQL, Redis

**Runtimes Supported**:
- Native (Rust)
- Docker containers
- Kubernetes orchestration
- Deno (TypeScript)
- Python (data science)
- MCP tools
- WebAssembly

**Privacy Tiers**: 0 (open) → 4 (TEE + I/O protection)

**Monitoring**: Prometheus metrics + Grafana dashboards

## References

1. [HIP-0: Architecture](./hip-0.md)
2. [HIP-20: Blockchain Node](./hip-20.md)
3. [HIP-22: Personalized AI](./hip-22.md)
4. [Model Context Protocol](https://modelcontextprotocol.io)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).