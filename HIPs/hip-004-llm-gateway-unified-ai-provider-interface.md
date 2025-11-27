---
hip: 004
title: LLM Gateway - Unified AI Provider Interface
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2025-01-09
requires: HIP-1
---

# HIP-4: LLM Gateway - Unified AI Provider Interface

## Abstract

This proposal defines the LLM Gateway specification, Hanzo's unified proxy for 100+ LLM providers with OpenAI-compatible API, intelligent routing, cost optimization, and enterprise features. The gateway serves as the central infrastructure for all AI operations in the Hanzo ecosystem.

**Repository**: [github.com/hanzoai/llm](https://github.com/hanzoai/llm)  
**Port**: 4000  
**Docker**: `hanzoai/llm-gateway:latest`

## Motivation

Current AI infrastructure challenges:
1. **Provider Fragmentation**: Each provider has different APIs
2. **Cost Management**: No unified billing or optimization
3. **Reliability Issues**: Single points of failure
4. **Feature Gaps**: Providers have different capabilities
5. **Compliance Requirements**: No unified audit/security layer

The LLM Gateway provides a single, unified interface to all AI providers.

## Specification

### Architecture Overview

```yaml
Components:
  Router:
    - Provider selection
    - Load balancing
    - Failover handling
    - Cost optimization
    
  Proxy:
    - Request transformation
    - Response normalization
    - Streaming support
    - Error handling
    
  Cache:
    - Semantic caching
    - Embedding cache
    - Response cache
    - TTL management
    
  Analytics:
    - Usage tracking
    - Cost monitoring
    - Performance metrics
    - Audit logging
```

### Supported Providers

```yaml
Tier 1 (Full Support):
  - OpenAI (GPT-4, GPT-3.5, DALL-E, Whisper)
  - Anthropic (Claude 3.5, Claude 3)
  - Google (Gemini Pro, Gemini Ultra)
  - Hanzo (HLLMs, Jin models)
  
Tier 2 (Core Features):
  - Together AI
  - Anyscale
  - Replicate
  - Cohere
  - AI21 Labs
  - Hugging Face
  
Tier 3 (Basic Support):
  - Ollama (local)
  - LM Studio (local)
  - Azure OpenAI
  - AWS Bedrock
  - Google Vertex AI
  
Specialized:
  - ElevenLabs (voice)
  - Runway (video)
  - Midjourney (images)
  - Stability AI (images)
```

### API Specification

#### Configuration

```yaml
# /app/config.yaml
server:
  port: 4000
  host: 0.0.0.0
  
routing:
  default_provider: openai
  fallback_providers:
    - anthropic
    - together
  
  rules:
    - pattern: "code.*"
      provider: anthropic
    - pattern: "image.*"
      provider: dalle3
    - pattern: "voice.*"
      provider: elevenlabs
      
cache:
  enabled: true
  ttl: 3600
  max_size: 10GB
  
providers:
  openai:
    api_key: ${OPENAI_API_KEY}
    models:
      - gpt-4-turbo
      - gpt-3.5-turbo
    rate_limit: 10000/min
    
  anthropic:
    api_key: ${ANTHROPIC_API_KEY}
    models:
      - claude-3-opus
      - claude-3-sonnet
    rate_limit: 5000/min
```

#### OpenAI-Compatible API

```python
# Python client example
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:4000/v1",
    api_key="sk-hanzo-..."
)

# Text completion
response = client.chat.completions.create(
    model="gpt-4",  # or "claude-3", "gemini-pro", etc.
    messages=[
        {"role": "user", "content": "Hello!"}
    ],
    temperature=0.7,
    stream=True
)

# Image generation
image = client.images.generate(
    model="dall-e-3",
    prompt="A sunset over mountains",
    size="1024x1024"
)

# Embeddings
embedding = client.embeddings.create(
    model="text-embedding-3-large",
    input="Sample text"
)

# Audio transcription
transcription = client.audio.transcriptions.create(
    model="whisper-1",
    file=audio_file
)
```

### Routing Engine

```python
class RoutingEngine:
    """
    Intelligent routing based on multiple factors
    """
    def select_provider(self, request):
        # 1. Check request pattern rules
        for rule in self.rules:
            if rule.matches(request):
                return rule.provider
        
        # 2. Cost optimization
        if request.optimize_for == "cost":
            return self.cheapest_provider(request)
        
        # 3. Performance optimization
        if request.optimize_for == "speed":
            return self.fastest_provider(request)
        
        # 4. Capability matching
        providers = self.filter_by_capability(request)
        
        # 5. Load balancing
        return self.load_balance(providers)
```

### Cost Management

```yaml
Pricing Tiers:
  Economy:
    - Mixtral-8x7B: $0.0002/1K tokens
    - Llama-3-70B: $0.0009/1K tokens
    - GPT-3.5: $0.0010/1K tokens
    
  Standard:
    - GPT-4-Turbo: $0.01/1K tokens
    - Claude-3-Sonnet: $0.003/1K tokens
    - Gemini-Pro: $0.00125/1K tokens
    
  Premium:
    - GPT-4: $0.03/1K tokens
    - Claude-3-Opus: $0.015/1K tokens
    - Gemini-Ultra: $0.02/1K tokens
    
Budget Controls:
  - Per-user limits
  - Per-project quotas
  - Automatic fallback to cheaper models
  - Real-time cost tracking
```

### Caching Layer

```python
class SemanticCache:
    """
    Intelligent caching with semantic similarity
    """
    def __init__(self):
        self.embedding_model = "text-embedding-3-small"
        self.similarity_threshold = 0.95
        
    async def get(self, prompt):
        # Generate embedding
        embedding = await self.embed(prompt)
        
        # Search cache
        similar = self.vector_search(
            embedding, 
            threshold=self.similarity_threshold
        )
        
        if similar:
            return similar.response
            
        return None
        
    async def set(self, prompt, response):
        embedding = await self.embed(prompt)
        self.store(embedding, prompt, response)
```

### Monitoring & Analytics

```yaml
Metrics:
  Performance:
    - Request latency (p50, p95, p99)
    - Token generation speed
    - Cache hit rate
    - Error rate
    
  Usage:
    - Requests per second
    - Tokens per minute
    - Active users
    - Model distribution
    
  Cost:
    - Cost per request
    - Cost per user
    - Provider breakdown
    - Savings from cache
    
Alerting:
  - Rate limit approaching
  - Provider outage detected
  - Budget exceeded
  - Anomaly detection
```

### Enterprise Features

#### Multi-Tenancy
```python
class TenantManager:
    def authenticate(self, api_key):
        tenant = self.get_tenant(api_key)
        return TenantContext(
            id=tenant.id,
            limits=tenant.limits,
            providers=tenant.allowed_providers,
            models=tenant.allowed_models
        )
```

#### Audit Logging
```json
{
  "timestamp": "2025-01-09T10:30:00Z",
  "tenant_id": "tenant_123",
  "user_id": "user_456",
  "request": {
    "model": "gpt-4",
    "prompt_tokens": 150,
    "max_tokens": 500
  },
  "response": {
    "provider": "openai",
    "completion_tokens": 230,
    "latency_ms": 1250
  },
  "cost": {
    "amount": 0.0038,
    "currency": "USD"
  }
}
```

#### Data Privacy
```yaml
Privacy Controls:
  - PII detection and masking
  - Data retention policies
  - GDPR compliance
  - Encryption at rest/transit
  - No logging mode
```

### Deployment Options

#### Docker Compose
```yaml
version: '3.8'

services:
  llm-gateway:
    image: hanzoai/llm-gateway:latest
    ports:
      - "4000:4000"
    environment:
      - DATABASE_URL=postgresql://...
      - REDIS_URL=redis://...
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    volumes:
      - ./config.yaml:/app/config.yaml
      
  postgres:
    image: postgres:15
    environment:
      - POSTGRES_DB=llm_gateway
      - POSTGRES_PASSWORD=secret
      
  redis:
    image: redis:7-alpine
    
  prometheus:
    image: prom/prometheus
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
```

#### Kubernetes
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: llm-gateway
spec:
  replicas: 3
  selector:
    matchLabels:
      app: llm-gateway
  template:
    metadata:
      labels:
        app: llm-gateway
    spec:
      containers:
      - name: gateway
        image: hanzoai/llm-gateway:latest
        ports:
        - containerPort: 4000
        env:
        - name: OPENAI_API_KEY
          valueFrom:
            secretKeyRef:
              name: llm-secrets
              key: openai-key
```

### SDK Support

```python
# Python SDK
from hanzoai import LLMGateway

gateway = LLMGateway(
    api_key="sk-hanzo-...",
    base_url="https://api.hanzo.ai/v1"
)

response = gateway.chat.completions.create(
    model="auto",  # Automatic selection
    messages=[{"role": "user", "content": "Hello"}],
    optimize_for="cost"  # or "speed", "quality"
)
```

```typescript
// TypeScript SDK
import { LLMGateway } from '@hanzoai/llm-gateway';

const gateway = new LLMGateway({
  apiKey: 'sk-hanzo-...',
  baseURL: 'https://api.hanzo.ai/v1'
});

const response = await gateway.chat.completions.create({
  model: 'auto',
  messages: [{ role: 'user', content: 'Hello' }],
  optimizeFor: 'cost'
});
```

## Implementation Roadmap

### Phase 1: Core Gateway (Q1 2025)
- OpenAI-compatible API
- Top 10 providers
- Basic routing
- Simple caching

### Phase 2: Enterprise Features (Q2 2025)
- Multi-tenancy
- Advanced routing
- Semantic caching
- Audit logging

### Phase 3: Optimization (Q3 2025)
- Cost optimization
- Performance tuning
- Auto-scaling
- ML-based routing

### Phase 4: Advanced Features (Q4 2025)
- Custom models
- Fine-tuning proxy
- Federated inference
- Edge deployment

## Security Considerations

### API Security
- API key rotation
- Rate limiting per tenant
- IP allowlisting
- Request signing

### Data Security
- End-to-end encryption
- PII detection/masking
- Secure key storage (KMS)
- Compliance logging

## References

1. [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
2. [LiteLLM Proxy](https://github.com/BerriAI/litellm)
3. [HIP-1: $AI Token](./hip-1.md)
4. [HIP-2: HLLMs](./hip-2.md)
5. [LLM Gateway Repository](https://github.com/hanzoai/llm)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).