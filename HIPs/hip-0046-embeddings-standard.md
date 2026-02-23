---
hip: 0046
title: Embeddings Standard
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2026-02-23
requires: HIP-0004, HIP-0042
---

# HIP-46: Embeddings Standard

## Abstract

This proposal defines the Embeddings Standard for the Hanzo ecosystem. It specifies a unified, OpenAI-compatible API for text and multimodal embedding generation served through the LLM Gateway (HIP-0004). The standard covers multi-provider routing, batch processing, dimension reduction, caching, chunking strategies, and integration with downstream consumers including Search (HIP-0012), Vector stores (HIP-0042), Agent memory (HIP-0009), and Chat RAG pipelines.

**Gateway Endpoint**: `POST /v1/embeddings`
**Gateway Port**: 4000
**Protocol**: OpenAI-compatible REST API

## Motivation

Embeddings are the foundational representation layer for semantic operations across the Hanzo ecosystem. Every system that performs retrieval, similarity matching, clustering, or semantic search depends on dense vector representations of text, images, or other modalities.

Current challenges:

1. **Provider Diversity**: OpenAI, Cohere, and local models each excel at different embedding tasks. No single provider dominates all use cases.
2. **Dimension-Cost Tradeoff**: Applications need different vector sizes. A 256-dim vector suffices for coarse filtering; 3072-dim vectors are needed for fine-grained retrieval.
3. **Scale**: RAG pipelines ingest millions of document chunks. Per-request embedding is too slow; batch processing is required.
4. **Redundant Computation**: The same text fragments are embedded repeatedly across services. Caching eliminates this waste.
5. **Fragmented Integration**: Without a standard, each service implements its own embedding client, chunking logic, and normalization. Bugs and inconsistencies multiply.

This HIP provides a single specification that all Hanzo services MUST use for embedding generation.

## Design Philosophy

### Why Multi-Provider Embeddings

Different embedding models have different strengths. OpenAI `text-embedding-3-large` produces the highest-quality vectors for English retrieval tasks. `text-embedding-3-small` runs 5x faster at 60% of the cost for acceptable quality. Cohere `embed-v3` leads on multilingual benchmarks across 100+ languages. Local models via Engine eliminate network latency and data egress concerns for sensitive workloads.

The Gateway routes embedding requests to the optimal provider based on the model field in the request. Callers specify what they want; the Gateway handles where it runs. This decouples application logic from provider selection, enabling transparent migration when better models emerge.

### Why OpenAI-Compatible API

The OpenAI embeddings API is the de facto standard. Every major embedding library, vector database, and RAG framework supports it natively. By implementing the same interface, any existing OpenAI client works against the Hanzo Gateway without code changes. A developer using `openai.embeddings.create()` in Python simply changes the `base_url` to the Gateway and gains multi-provider routing, caching, and cost optimization for free.

Inventing a proprietary API would require building and maintaining client libraries for every language, writing migration guides, and convincing developers to adopt a non-standard interface. The marginal benefit is zero; the cost is substantial.

### Why Not Train Our Own Embedding Models

Training competitive embedding models requires:

- **Massive paired datasets**: Billions of (query, document) pairs with relevance labels
- **Contrastive learning infrastructure**: Multi-GPU training with hard negative mining
- **Evaluation benchmarks**: MTEB, BEIR, and domain-specific test suites
- **Ongoing maintenance**: Models degrade as language shifts; retraining is continuous

OpenAI and Cohere each invest hundreds of millions of dollars in training data curation and model development. Their embedding models are commodities priced at fractions of a cent per million tokens. The correct strategy is to leverage their models through the Gateway and focus engineering effort on the application layer: chunking, retrieval, re-ranking, and synthesis.

If a domain-specific embedding model is needed (e.g., for code, scientific papers, or blockchain data), fine-tuning an open model via Engine is the path. This is covered in the Local Models section.

### Why Dimension Reduction Support

OpenAI `text-embedding-3-*` models support Matryoshka Representation Learning (MRL). The full embedding is 3072 dimensions, but it can be truncated to 256, 512, or 1024 dimensions with graceful quality degradation. This is not naive truncation; the model is trained so that the first N dimensions capture the most important semantic information.

The practical impact:

| Dimensions | Storage per Vector | Index Memory (1M vectors) | Quality (MTEB) |
|------------|-------------------|--------------------------|-----------------|
| 3072       | 12,288 bytes      | ~12 GB                   | 64.6            |
| 1024       | 4,096 bytes       | ~4 GB                    | 62.1            |
| 512        | 2,048 bytes       | ~2 GB                    | 60.8            |
| 256        | 1,024 bytes       | ~1 GB                    | 58.4            |

For a vector store with 100M documents, reducing from 3072 to 256 dimensions saves 1.1 TB of storage and proportionally reduces query latency. The Gateway exposes this via the `dimensions` parameter, making it trivial for callers to select their quality-cost tradeoff.

### Why Batch Processing

Embedding generation is embarrassingly parallel. Each input text is independent; there are no sequential dependencies. The batch API accepts up to 2048 inputs per request and processes them concurrently on the provider side. This reduces:

- **Network overhead**: 1 HTTP request instead of 2048
- **Authentication overhead**: 1 API key validation instead of 2048
- **Connection overhead**: 1 TLS handshake instead of 2048

In practice, batch embedding is 10-50x faster than sequential per-request embedding for document ingestion workloads. The Gateway further optimizes by splitting oversized batches into provider-optimal chunk sizes and reassembling results.

## Specification

### API Endpoint

```
POST /v1/embeddings
Content-Type: application/json
Authorization: Bearer sk-hanzo-...
```

All requests go through the LLM Gateway (HIP-0004) at port 4000. The Gateway handles provider routing, authentication, rate limiting, and response normalization.

### Request Schema

```json
{
  "model": "text-embedding-3-large",
  "input": "The quick brown fox jumps over the lazy dog",
  "encoding_format": "float",
  "dimensions": 1024,
  "user": "user-abc123"
}
```

#### Fields

| Field              | Type                    | Required | Default   | Description                                              |
|--------------------|-------------------------|----------|-----------|----------------------------------------------------------|
| `model`            | string                  | Yes      | -         | Model identifier (see Available Models)                  |
| `input`            | string or string[]      | Yes      | -         | Text(s) to embed. Max 2048 items in array.               |
| `encoding_format`  | string                  | No       | `"float"` | `"float"` or `"base64"`. Base64 reduces payload by ~25%. |
| `dimensions`       | integer                 | No       | Model default | Output dimensions. Only supported by MRL-capable models. |
| `user`             | string                  | No       | -         | End-user identifier for abuse tracking.                  |

#### Input Constraints

- **String input**: Single text, max token length per model (see Available Models table).
- **Array input**: Array of strings, max 2048 items. Total tokens across all items must not exceed the model's batch token limit.
- **Empty strings**: Rejected with 400 error. Embeddings of empty text are undefined.
- **Encoding**: Input MUST be valid UTF-8. The Gateway rejects malformed sequences.

### Response Schema

```json
{
  "object": "list",
  "data": [
    {
      "object": "embedding",
      "embedding": [0.0023, -0.0092, 0.0156, ...],
      "index": 0
    }
  ],
  "model": "text-embedding-3-large",
  "usage": {
    "prompt_tokens": 8,
    "total_tokens": 8
  }
}
```

#### Fields

| Field                 | Type     | Description                                          |
|-----------------------|----------|------------------------------------------------------|
| `object`              | string   | Always `"list"`.                                     |
| `data`                | array    | Array of embedding objects, one per input.            |
| `data[].object`       | string   | Always `"embedding"`.                                |
| `data[].embedding`    | float[]  | The embedding vector. Length equals `dimensions`.     |
| `data[].index`        | integer  | Position in the input array (0-indexed).             |
| `model`               | string   | The model that generated the embeddings.             |
| `usage.prompt_tokens` | integer  | Total tokens consumed across all inputs.             |
| `usage.total_tokens`  | integer  | Same as `prompt_tokens` (embeddings have no output). |

#### Base64 Encoding

When `encoding_format` is `"base64"`, the `embedding` field contains a base64-encoded string of little-endian float32 values instead of a JSON array:

```json
{
  "object": "embedding",
  "embedding": "AGDwPQAAkL0AAHA+...",
  "index": 0
}
```

Decoding in Python:

```python
import base64
import numpy as np

raw = base64.b64decode(data["embedding"])
vector = np.frombuffer(raw, dtype=np.float32)
```

Base64 encoding reduces JSON payload size by approximately 25% and eliminates floating-point serialization overhead. Recommended for batch operations.

### Available Models

| Model                      | Provider | Dimensions | Max Tokens | Pricing (per 1M tokens) | Strengths                    |
|----------------------------|----------|------------|------------|--------------------------|------------------------------|
| `text-embedding-3-large`   | OpenAI   | 3072*      | 8191       | $0.13                    | Highest quality English      |
| `text-embedding-3-small`   | OpenAI   | 1536*      | 8191       | $0.02                    | Fast, cost-effective         |
| `text-embedding-ada-002`   | OpenAI   | 1536       | 8191       | $0.10                    | Legacy, wide compatibility   |
| `embed-english-v3.0`       | Cohere   | 1024       | 512        | $0.10                    | English retrieval            |
| `embed-multilingual-v3.0`  | Cohere   | 1024       | 512        | $0.10                    | 100+ languages               |
| `embed-english-light-v3.0` | Cohere   | 384        | 512        | $0.10                    | Lightweight English          |
| `hanzo/bge-large`          | Engine   | 1024       | 8192       | Self-hosted              | On-prem, no data egress      |
| `hanzo/e5-large`           | Engine   | 1024       | 512        | Self-hosted              | On-prem, multilingual        |
| `hanzo/clip-vit-l-14`      | Engine   | 768        | N/A        | Self-hosted              | Multimodal (text + image)    |

*Supports Matryoshka dimension reduction: 256, 512, 1024, or full size.

#### Model Selection Guidelines

```yaml
Use Cases:
  high_quality_retrieval:
    model: text-embedding-3-large
    dimensions: 3072
    rationale: Maximum semantic fidelity for critical search

  general_rag:
    model: text-embedding-3-large
    dimensions: 1024
    rationale: Good quality at 1/3 storage cost

  real_time_search:
    model: text-embedding-3-small
    dimensions: 512
    rationale: Sub-10ms latency, acceptable quality

  multilingual:
    model: embed-multilingual-v3.0
    rationale: Best cross-language performance

  cost_sensitive:
    model: text-embedding-3-small
    dimensions: 256
    rationale: Lowest cost, suitable for coarse filtering

  air_gapped:
    model: hanzo/bge-large
    rationale: No external API calls, full data sovereignty

  multimodal:
    model: hanzo/clip-vit-l-14
    rationale: Shared text-image embedding space
```

### Batch API

For bulk embedding workloads (document ingestion, index rebuilding), the batch API provides asynchronous processing with higher throughput limits and lower per-token cost.

#### Create Batch

```
POST /v1/embeddings/batches
Content-Type: application/json
Authorization: Bearer sk-hanzo-...
```

```json
{
  "model": "text-embedding-3-large",
  "input_file_id": "file-abc123",
  "dimensions": 1024,
  "encoding_format": "base64",
  "metadata": {
    "purpose": "document_ingestion",
    "collection": "knowledge_base_v2"
  }
}
```

The `input_file_id` references a JSONL file uploaded via the Files API, where each line is:

```jsonl
{"custom_id": "doc-001", "input": "First document text..."}
{"custom_id": "doc-002", "input": "Second document text..."}
```

#### Batch Response

Returns a batch object with `id`, `status` (`queued` / `processing` / `completed` / `failed`), `request_counts` (total/completed/failed), and `output_file_id`. Poll status via `GET /v1/embeddings/batches/{batch_id}`. When completed, the output file is JSONL with `custom_id`, `embedding`, `index`, and `tokens` per line.

#### Batch Pricing

Batch embeddings are billed at 50% of the real-time rate. For `text-embedding-3-large`: $0.065 per 1M tokens instead of $0.13.

### Caching

The Gateway implements a semantic embedding cache to eliminate redundant computation.

#### Cache Architecture

```
┌────────────────┐     ┌───────────────┐     ┌──────────────┐
│  Embedding     │────▶│  Cache Layer  │────▶│  Provider    │
│  Request       │     │  (Redis)      │     │  (OpenAI,    │
│                │◀────│               │◀────│   Cohere)    │
└────────────────┘     └───────────────┘     └──────────────┘
```

#### Cache Key Computation

Cache keys are computed as:

```
key = SHA-256(model || dimensions || encoding_format || normalize(input))
```

Where `normalize(input)` applies:
1. Unicode NFC normalization
2. Whitespace collapsing (multiple spaces to single)
3. Leading/trailing whitespace removal

This ensures that semantically identical inputs with trivial formatting differences produce cache hits.

#### Cache Configuration

```yaml
embedding_cache:
  enabled: true
  backend: redis
  ttl: 86400          # 24 hours default
  max_entries: 10_000_000
  max_memory: 8GB
  eviction: lru

  # Per-model TTL overrides
  model_ttl:
    text-embedding-3-large: 604800   # 7 days (expensive)
    text-embedding-3-small: 86400    # 1 day (cheap)

  # Skip cache for these patterns
  bypass:
    - "hanzo/*"        # Local models have no API cost
```

#### Cache Metrics

The Gateway exposes cache metrics via Prometheus (HIP-0031):

```
hanzo_embedding_cache_hits_total{model="text-embedding-3-large"}
hanzo_embedding_cache_misses_total{model="text-embedding-3-large"}
hanzo_embedding_cache_hit_rate{model="text-embedding-3-large"}
hanzo_embedding_cache_size_bytes
hanzo_embedding_cache_evictions_total
```

### Chunking Strategies

Embedding models have finite context windows. Documents exceeding the model's max token limit MUST be split into chunks before embedding. The Gateway does not perform chunking; it is the responsibility of the caller. Three strategies are recommended.

**Fixed-Size Chunking**: Split text into chunks of a fixed token count with configurable overlap. Default: 512 tokens, 64-token overlap (12.5%). Simple, predictable, works for uniform content like chat logs.

**Semantic Chunking**: Split at natural boundaries (paragraphs, sections) while respecting token limits. Produces higher-quality embeddings because each chunk contains a coherent unit of meaning. Best for structured documents.

**Recursive Chunking**: Split hierarchically -- first by section headers, then paragraphs, then sentences, then token boundaries. Most robust for heterogeneous documents. Falls back gracefully when structure is absent.

#### Strategy Selection

| Document Type      | Strategy   | Chunk Size | Overlap | Rationale                          |
|--------------------|------------|------------|---------|------------------------------------|
| Knowledge base     | Semantic   | 512        | -       | Coherent units for retrieval       |
| Source code        | Recursive  | 1024       | 128     | Preserve function boundaries       |
| Chat logs          | Fixed      | 256        | 32      | Uniform message lengths            |
| Academic papers    | Recursive  | 512        | 64      | Respect section structure          |
| API documentation  | Semantic   | 384        | -       | One endpoint per chunk             |

### Normalization

All embedding vectors MUST be L2-normalized before storage in vector databases. Normalized vectors have unit length (||v|| = 1), which makes cosine similarity equivalent to dot product. Dot product is computationally cheaper (no division), so normalization enables faster similarity search.

#### Normalization Formula

```
v_normalized = v / ||v||_2

where ||v||_2 = sqrt(sum(v_i^2))
```

#### Implementation

```python
import numpy as np

def normalize(embedding: list[float]) -> list[float]:
    v = np.array(embedding, dtype=np.float32)
    norm = np.linalg.norm(v)
    if norm == 0:
        return v.tolist()
    return (v / norm).tolist()
```

OpenAI models return pre-normalized vectors. Cohere models do not; the Gateway normalizes Cohere outputs before returning them to callers. Local models vary; the Gateway checks and normalizes as needed.

The Gateway normalizes per-provider: OpenAI vectors are pre-normalized (skipped), Cohere and Engine outputs are normalized before returning to callers.

### Integration Points

#### Vector Store Ingestion (HIP-0042)

The primary consumer of embeddings. Documents are chunked, embedded, and inserted into vector collections:

```python
from hanzo import embeddings, vector

# Chunk the document
chunks = semantic_chunk(document.text, max_tokens=512)

# Generate embeddings via Gateway
response = embeddings.create(
    model="text-embedding-3-large",
    input=chunks,
    dimensions=1024
)

# Insert into vector store
vector.upsert(
    collection="knowledge_base",
    vectors=[
        {
            "id": f"{document.id}-{d.index}",
            "values": d.embedding,
            "metadata": {
                "document_id": document.id,
                "chunk_index": d.index,
                "text": chunks[d.index]
            }
        }
        for d in response.data
    ]
)
```

#### Search Indexing (HIP-0012)

The Search engine uses embeddings for hybrid search (BM25 + vector similarity):

```python
# Index document with embedding for hybrid search
search.index(
    index="documents",
    document={
        "id": doc.id,
        "title": doc.title,
        "content": doc.content,
        "_vectors": {
            "default": embeddings.create(
                model="text-embedding-3-large",
                input=doc.content[:8000],
                dimensions=1024
            ).data[0].embedding
        }
    }
)
```

#### Agent Memory (HIP-0009)

Agents embed memories for semantic recall. Store uses `text-embedding-3-small` at 512 dimensions for cost efficiency. Recall embeds the query with the same model and performs vector similarity search against the agent's memory collection.

#### Chat RAG Pipeline

Chat (HIP-0011) uses embeddings for retrieval-augmented generation: embed the user query, retrieve top-k relevant chunks from the vector store, inject them as system context, and generate the response via LLM Gateway. The embedding model for RAG queries should match the model used during document ingestion to ensure consistent vector space alignment.

### Multimodal Embeddings

Multimodal embeddings map text and images into the same vector space, enabling cross-modal search (e.g., searching images with text queries).

CLIP-based models are available via Engine for self-hosted deployments. Text inputs use the standard `input` field. Image inputs use `{"type": "image", "data": "<base64>"}`. Both produce vectors in the same 768-dimensional space, enabling cross-modal similarity via dot product.

#### Roadmap

| Phase | Model          | Modalities       | Status   |
|-------|----------------|------------------|----------|
| 1     | CLIP ViT-L/14  | Text + Image     | Available|
| 2     | SigLIP         | Text + Image     | Planned  |
| 3     | ImageBind      | Text + Image + Audio + Video | Planned |
| 4     | Unified Embed  | All modalities   | Research |

Multimodal embedding API extensions will be specified in a future HIP when the interface stabilizes.

### Rate Limits and Quotas

Rate limits are enforced per API key at the Gateway level. Limits vary by model tier and account plan.

#### Default Rate Limits

| Plan        | Requests/min | Tokens/min   | Batch Quota/day |
|-------------|-------------|--------------|-----------------|
| Free        | 60          | 100,000      | 500,000 tokens  |
| Developer   | 500         | 1,000,000    | 10M tokens      |
| Team        | 3,000       | 10,000,000   | 100M tokens     |
| Enterprise  | 10,000      | 50,000,000   | Unlimited       |

All responses include `X-RateLimit-*` headers: `Limit-Requests`, `Limit-Tokens`, `Remaining-Requests`, `Remaining-Tokens`, `Reset-Requests`, `Reset-Tokens`. On 429, clients SHOULD implement exponential backoff with jitter.

### Error Handling

Errors follow the OpenAI error format: `{"error": {"message", "type", "code", "param"}}`.

#### Error Codes

| HTTP Status | Code                    | Description                                 |
|-------------|-------------------------|---------------------------------------------|
| 400         | `invalid_request`       | Malformed request body or missing fields    |
| 400         | `invalid_model`         | Model not found or not an embedding model   |
| 400         | `invalid_dimensions`    | Dimensions not supported by model           |
| 400         | `input_too_long`        | Input exceeds model's max token limit       |
| 400         | `batch_too_large`       | More than 2048 inputs in array              |
| 401         | `invalid_api_key`       | Missing or invalid API key                  |
| 403         | `insufficient_quota`    | Account has no remaining embedding quota    |
| 429         | `rate_limit_exceeded`   | Rate limit hit; retry after indicated time  |
| 500         | `provider_error`        | Upstream provider returned an error         |
| 503         | `provider_unavailable`  | Provider is down; failover in progress      |

### Monitoring and Observability

The Gateway exposes embedding-specific metrics via Prometheus (HIP-0031) and logs to the unified observability stack.

#### Prometheus Metrics

```
# Latency histogram by model and provider
hanzo_embedding_latency_seconds{model, provider, status}

# Request counter by model
hanzo_embedding_requests_total{model, provider, status, encoding_format}

# Token counter by model
hanzo_embedding_tokens_total{model, provider}

# Batch size histogram
hanzo_embedding_batch_size{model}

# Dimension usage counter
hanzo_embedding_dimensions_used{model, dimensions}

# Cache metrics
hanzo_embedding_cache_hits_total{model}
hanzo_embedding_cache_misses_total{model}
hanzo_embedding_cache_hit_rate{model}

# Provider health
hanzo_embedding_provider_up{provider}
hanzo_embedding_provider_latency_p99{provider}
```

#### Alert Rules

Recommended alerts: `EmbeddingLatencyHigh` (p99 > 2s for 5m), `EmbeddingProviderDown` (provider_up == 0 for 1m, critical), `EmbeddingCacheHitRateLow` (hit_rate < 0.3 for 15m), `EmbeddingErrorRateHigh` (error rate > 5% for 5m, critical).

#### Structured Logging

Every embedding request produces a structured JSON log entry containing: timestamp, model, provider, dimensions, input_count, total_tokens, latency_ms, cache_hit, user_id, and api_key_hash. Raw input text MUST NOT appear in logs at INFO level.

### Gateway Routing Configuration

The Gateway routes embedding requests based on the `model` field. Provider selection, failover, and load balancing are configured in the Gateway config:

```yaml
# /app/config.yaml (LLM Gateway)
embeddings:
  providers:
    openai:
      api_key: ${OPENAI_API_KEY}
      models:
        - text-embedding-3-large
        - text-embedding-3-small
        - text-embedding-ada-002
      rate_limit: 10000/min
      timeout: 30s
      retry:
        max_attempts: 3
        backoff: exponential

    cohere:
      api_key: ${COHERE_API_KEY}
      models:
        - embed-english-v3.0
        - embed-multilingual-v3.0
        - embed-english-light-v3.0
      rate_limit: 5000/min
      timeout: 30s

    engine:
      base_url: http://engine:8080
      models:
        - hanzo/bge-large
        - hanzo/e5-large
        - hanzo/clip-vit-l-14
      rate_limit: 0   # No limit for local models
      timeout: 10s

  failover:
    text-embedding-3-large:
      - text-embedding-3-small    # Same provider, smaller model
      - embed-english-v3.0        # Different provider
    embed-english-v3.0:
      - text-embedding-3-small    # Cross-provider failover

  defaults:
    encoding_format: float
    normalize: true
```

### Client Examples

#### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://llm.hanzo.ai/v1",
    api_key="sk-hanzo-..."
)

# Single embedding
response = client.embeddings.create(
    model="text-embedding-3-large",
    input="Hanzo provides unified AI infrastructure",
    dimensions=1024
)
vector = response.data[0].embedding
print(f"Dimensions: {len(vector)}")  # 1024

# Batch embedding
texts = ["First document", "Second document", "Third document"]
response = client.embeddings.create(
    model="text-embedding-3-small",
    input=texts,
    encoding_format="base64"
)
for item in response.data:
    print(f"Index {item.index}: {len(item.embedding)} chars (base64)")
```

#### JavaScript (Hanzo SDK)

```javascript
import { HanzoAI } from '@hanzoai/sdk'

const hanzo = new HanzoAI({ apiKey: 'sk-hanzo-...' })

const response = await hanzo.embeddings.create({
  model: 'text-embedding-3-large',
  input: ['Hello world', 'Goodbye world'],
  dimensions: 512
})

for (const item of response.data) {
  console.log(`Index ${item.index}: [${item.embedding.slice(0, 3).join(', ')}...]`)
}
```

#### cURL

```bash
curl -X POST https://llm.hanzo.ai/v1/embeddings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-hanzo-..." \
  -d '{
    "model": "text-embedding-3-large",
    "input": "Sample text",
    "dimensions": 1024
  }'
```

## Security Considerations

1. **Data in Transit**: All API communication MUST use TLS 1.3. The Gateway terminates TLS; upstream provider calls use TLS.
2. **Data at Rest**: Cached embeddings in Redis SHOULD be encrypted at rest when the deployment requires it. Embeddings themselves are not directly invertible to source text, but they can leak semantic information.
3. **API Key Scoping**: Embedding API keys can be scoped to specific models and rate limits. A key with `embedding:read` scope cannot access chat completions.
4. **Input Logging**: Raw input text MUST NOT be logged at INFO level. Only token counts, model names, and latency are logged by default. Debug-level logging of inputs requires explicit opt-in.
5. **Provider Key Isolation**: Provider API keys (OpenAI, Cohere) are stored in KMS (HIP-0027) and injected at runtime. They never appear in config files, logs, or error messages.

## Backwards Compatibility

This HIP introduces a new endpoint with no backwards compatibility concerns. The API is fully OpenAI-compatible. Future revisions MUST only add fields, never remove or rename them.

## Test Vectors

Conformance tests: (1) embed `"hello"` with `text-embedding-3-small` at 8 dimensions, verify vector length and values within tolerance 0.001; (2) embed `["hello", "world"]`, verify 2 results with indices [0, 1]; (3) embed `"hello"` with `text-embedding-3-large` at 256 dimensions, verify L2 norm equals 1.0 within tolerance 0.0001.

## Reference Implementation

The reference implementation lives in the LLM Gateway codebase:

- **Gateway**: [github.com/hanzoai/llm](https://github.com/hanzoai/llm) -- `src/embeddings/`
- **Python SDK**: [github.com/hanzoai/python-sdk](https://github.com/hanzoai/python-sdk) -- `hanzoai/embeddings.py`
- **JS SDK**: [github.com/hanzoai/js-sdk](https://github.com/hanzoai/js-sdk) -- `src/resources/embeddings.ts`
- **Go SDK**: [github.com/hanzoai/go-sdk](https://github.com/hanzoai/go-sdk) -- `embeddings.go`

## References

- [HIP-0004: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md)
- [HIP-0009: Agent SDK](./hip-0009-agent-sdk-multi-agent-orchestration-framework.md)
- [HIP-0012: Search Interface Standard](./hip-0012-search-interface-standard.md)
- [HIP-0042: Vector Store Standard](./hip-0042-vector-store-standard.md)
- [OpenAI Embeddings API Reference](https://platform.openai.com/docs/api-reference/embeddings)
- [Cohere Embed API Reference](https://docs.cohere.com/reference/embed)
- [Matryoshka Representation Learning (Kusupati et al., 2022)](https://arxiv.org/abs/2205.13147)
- [MTEB: Massive Text Embedding Benchmark](https://huggingface.co/spaces/mteb/leaderboard)

## Copyright

Copyright 2026 Hanzo AI Inc. All rights reserved.
