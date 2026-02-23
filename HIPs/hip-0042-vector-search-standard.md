---
hip: 0042
title: Vector Search Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-02-23
requires: HIP-0004
---

# HIP-42: Vector Search Standard

## Abstract

This proposal defines the standard for Hanzo Vector, the high-performance vector database
and similarity search infrastructure that powers retrieval-augmented generation (RAG),
semantic search, recommendation engines, and embedding-based retrieval across all services
in the Hanzo ecosystem. Hanzo Vector is built on Qdrant, a Rust-based vector database
purpose-built for approximate nearest neighbor (ANN) search, and is distributed as
`hanzoai/vector:latest`. It exposes a gRPC API on port 6333 and an HTTP REST API on
port 6334.

**Repository**: [github.com/hanzoai/vector](https://github.com/hanzoai/vector)
**Ports**: 6333 (gRPC), 6334 (HTTP REST)
**Docker**: `hanzoai/vector:latest`
**License**: Apache-2.0

## Motivation

Every AI-native service in the Hanzo ecosystem requires vector similarity search for at
least one of the following:

1. **RAG pipelines**: LLM Gateway (HIP-0004) needs to retrieve relevant context from
   document embeddings before generating responses. Without vector search, LLMs hallucinate
   or produce answers without grounding in source material.
2. **Semantic search**: Chat, Search, and Cloud services need to find documents, code
   snippets, and knowledge base entries by meaning rather than exact keyword match.
3. **Recommendation**: Commerce and content services need to suggest related items based
   on embedding similarity -- products, articles, models, datasets.
4. **Deduplication**: Identifying near-duplicate content (images, text, code) by comparing
   embedding distances rather than byte-level hashing.
5. **Agent memory**: Agent SDK (HIP-0009) and MCP (HIP-0010) need long-term memory
   retrieval where an agent recalls past interactions by semantic similarity.

Previously, the Hanzo infrastructure used pgvector (the PostgreSQL extension) for all
vector operations. This worked for prototyping but introduced three problems at scale:

- **Performance ceiling**: pgvector uses IVFFlat indexing by default. At 10M+ vectors,
  query latency exceeds 100ms even with HNSW indexing enabled. A dedicated vector database
  with optimized HNSW implementation, SIMD-accelerated distance calculations, and
  purpose-built memory management achieves sub-10ms latency at the same scale.
- **Resource contention**: Vector search is CPU- and memory-intensive. Running ANN queries
  on the same PostgreSQL instance that serves transactional workloads (IAM sessions,
  billing records, user data) causes mutual performance degradation. Heavy vector queries
  spike CPU and evict PostgreSQL's buffer cache; conversely, long transactions hold locks
  that delay vector index builds.
- **Missing features**: pgvector lacks scalar/product/binary quantization, payload-based
  filtering during search (it requires a separate WHERE clause that cannot leverage the
  vector index), multi-vector search, recommendation API, collection snapshots, and
  distributed sharding. These are not nice-to-haves -- they are requirements for
  production RAG at scale.

Hanzo Vector solves all three by deploying Qdrant as a dedicated vector search service,
optimized for ANN workloads and decoupled from the relational database.

## Design Philosophy

This section explains every major design decision and why the alternatives were rejected.
Vector search is foundational to every AI feature in the Hanzo ecosystem. A wrong choice
here propagates to every service that performs retrieval, recommendation, or semantic
matching.

### Why Qdrant over Pinecone

Pinecone is a fully managed vector database with no self-hosting option. This creates
three problems for Hanzo:

- **Vendor lock-in**: Pinecone's API is proprietary. If Pinecone changes pricing, imposes
  rate limits, or discontinues a tier, there is no migration path that does not require
  rewriting every client. Hanzo operates its own infrastructure on DOKS clusters; depending
  on a managed-only service contradicts our self-hosted-first principle.
- **Data residency**: Pinecone runs on AWS regions. Hanzo's compliance requirements may
  demand data stay within specific jurisdictions or on our own infrastructure. With a
  managed-only service, we cannot control where vectors are stored or processed.
- **Cost at scale**: Pinecone charges per vector stored and per query. At 100M+ vectors
  with sustained query traffic, the cost exceeds running Qdrant on our own hardware by
  an order of magnitude. Vector search is a commodity workload -- paying a premium for
  managed hosting is only justified when operational complexity is high. Qdrant is a
  single binary with minimal operational overhead.

Qdrant is Apache-2.0 licensed, self-hostable, and provides a richer feature set (payload
filtering, quantization, snapshot/restore, recommendation API) than Pinecone's current
offering.

### Why Qdrant over Milvus

Milvus is a capable open-source vector database, but its architecture is complex:

- **Component count**: Milvus requires etcd (metadata), MinIO (object storage), and Pulsar
  (message queue) as mandatory dependencies. A minimal Milvus deployment is four services.
  Qdrant is a single binary with embedded storage -- zero external dependencies.
- **Operational overhead**: Each Milvus component has its own failure modes, upgrade
  procedures, and resource requirements. etcd quorum loss, Pulsar topic compaction, MinIO
  bucket corruption -- each adds a distinct class of incidents. Qdrant's failure mode is
  simple: the process crashes and restarts, replaying its WAL.
- **Developer experience**: Milvus's SDK requires understanding its distributed concepts
  (segments, channels, sealed/growing segments) even for simple queries. Qdrant's API is
  a straightforward CRUD interface on collections and points.

For our current scale (tens of millions of vectors, single-digit-millisecond latency
requirements), Qdrant's simpler architecture provides the same performance with far less
operational burden. If we reach billions of vectors with petabyte-scale storage, Milvus's
distributed architecture may become relevant -- but that is a future HIP.

### Why Qdrant over pgvector

pgvector is the right choice when vectors are tightly coupled with relational metadata and
the dataset is small (under 1M vectors). We use both:

- **pgvector**: For metadata-heavy queries where the relational filter is the primary
  access pattern and vector similarity is secondary. Example: "find all documents owned
  by user X, ordered by similarity to query Q." The ownership filter is best served by
  a B-tree index on the user_id column; the vector similarity is a secondary sort.
- **Qdrant**: For pure similarity search where the vector index is the primary access
  pattern and payload filtering is secondary. Example: "find the 10 most similar documents
  to query Q, optionally filtered by category." The HNSW index on the vector is the
  primary structure; the payload filter is applied during graph traversal.

pgvector's limitations for dedicated vector workloads:

- No scalar, product, or binary quantization (memory efficiency)
- No tunable HNSW parameters (m, ef_construct, ef are fixed or limited)
- No native recommendation API (requires manual query construction)
- No collection snapshots or point-in-time recovery for vector data
- No built-in sharding or replication for vector indices
- No SIMD-optimized distance calculations (relies on PostgreSQL's generic math)

### Why Rust

Qdrant is written in Rust. This matters for a data-critical search engine:

- **No garbage collection pauses**: Java-based vector databases (Elasticsearch, Vespa)
  experience GC pauses that cause latency spikes during search. Qdrant's memory management
  is deterministic -- search latency is consistent regardless of heap pressure.
- **Memory safety**: Buffer overflows, use-after-free, and data races are compile-time
  errors in Rust. For a database that manages billions of floating-point vectors in memory,
  memory corruption bugs are catastrophic and difficult to diagnose. Rust eliminates this
  class of bugs entirely.
- **SIMD acceleration**: Qdrant uses SIMD intrinsics (AVX2, AVX-512, NEON) for distance
  calculations. Rust's `unsafe` blocks allow direct SIMD access with the compiler
  verifying all surrounding safe code. This achieves C-level performance for the hot path
  (distance computation) while keeping the rest of the codebase memory-safe.
- **Single binary deployment**: No JVM, no Python interpreter, no runtime dependencies.
  The Docker image is a statically linked binary on a minimal base.

### Why Not ChromaDB

ChromaDB is a Python-based embedding database popular for prototyping. It is not suitable
for production workloads:

- **Python runtime**: GIL contention limits concurrent query throughput. A single ChromaDB
  instance cannot saturate more than one CPU core for search operations.
- **Scale ceiling**: ChromaDB's in-memory index is limited by Python's memory management.
  At 10M+ vectors, memory fragmentation and GC overhead degrade performance significantly.
  Qdrant handles billions of vectors with mmap-backed storage and quantization.
- **No persistence guarantees**: ChromaDB's persistence layer (DuckDB + Parquet) is
  designed for analytics, not for a write-ahead log with crash recovery guarantees.
- **No distributed mode**: ChromaDB runs as a single process. No replication, no sharding,
  no failover. Qdrant supports distributed deployments with shard replication.

ChromaDB is excellent for rapid prototyping and local development. For production, Qdrant
is the standard.

## Specification

### Core Concepts

#### Collections

A collection is a named group of vectors with a fixed dimensionality and distance metric.
Collections are the primary unit of organization, analogous to a table in a relational
database or an index in Elasticsearch.

```json
{
  "name": "documents",
  "vectors": {
    "size": 1536,
    "distance": "Cosine"
  },
  "optimizers_config": {
    "default_segment_number": 2,
    "indexing_threshold": 20000
  },
  "replication_factor": 1,
  "write_consistency_factor": 1
}
```

Each collection has:

- **Vector configuration**: Dimensionality and distance metric (immutable after creation)
- **Optimizer configuration**: Segment management and indexing thresholds
- **Replication factor**: Number of shard replicas (for distributed deployments)
- **Write consistency factor**: Minimum replicas that must acknowledge a write

#### Points

A point is the fundamental unit of data. Each point contains:

- **ID**: UUID or unsigned 64-bit integer, unique within the collection
- **Vector**: A dense floating-point array of fixed dimensionality
- **Payload**: Arbitrary JSON metadata attached to the point

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "vector": [0.042, -0.118, 0.391, "... 1536 floats total"],
  "payload": {
    "source": "knowledge-base",
    "category": "technical",
    "created_at": "2026-02-23T10:00:00Z",
    "org_id": "hanzo",
    "text": "Original document text for retrieval"
  }
}
```

#### Payloads

Payloads are JSON objects stored alongside vectors. Unlike pure vector databases that
store only IDs (requiring a separate metadata lookup), Qdrant stores payloads co-located
with vectors. This eliminates the "fan-out" problem where a search returns IDs that must
be resolved against a separate database.

Payload fields are automatically indexed for filtering. Supported field types:

| Type | Example | Filter Operations |
|------|---------|-------------------|
| `keyword` | `"category": "tech"` | match, match_any, match_except |
| `integer` | `"priority": 5` | match, range (gt, gte, lt, lte) |
| `float` | `"score": 0.95` | range |
| `bool` | `"published": true` | match |
| `text` | `"title": "Vector DB"` | full-text match |
| `geo` | `"location": {"lat": 37.7, "lon": -122.4}` | geo_bounding_box, geo_radius |
| `datetime` | `"created": "2026-02-23T00:00:00Z"` | range |

#### Shards

Each collection is divided into shards. Shards are the unit of distribution and
parallelism. In standalone mode, all shards reside on the single node. In distributed
mode, shards are distributed across nodes with configurable replication.

### Distance Metrics

Hanzo Vector supports three distance metrics, chosen at collection creation time:

| Metric | Formula | Use Case | Range |
|--------|---------|----------|-------|
| **Cosine** | `1 - (A . B) / (\|A\| * \|B\|)` | Text embeddings, normalized vectors | [0, 2] |
| **Euclidean** | `sqrt(sum((A_i - B_i)^2))` | Image embeddings, spatial data | [0, inf) |
| **Dot Product** | `-(A . B)` | Pre-normalized embeddings, MaxIP | (-inf, inf) |

**Default**: Cosine. Most embedding models (OpenAI, Cohere, Voyage) produce
L2-normalized vectors where cosine similarity is the natural metric.

**Note on Dot Product**: Qdrant returns the negated dot product so that lower scores
are always "closer" (consistent with Cosine and Euclidean). For maximum inner product
search, negate the result.

### Indexing: HNSW

Qdrant uses HNSW (Hierarchical Navigable Small World) as its primary ANN index. HNSW
builds a multi-layer navigable graph where each node is a vector and edges connect nearby
points. Search starts at the top layer (sparse, long-range links) and descends to the
bottom layer (dense, short-range links), performing greedy nearest-neighbor traversal at
each level.

#### HNSW Parameters

| Parameter | Default | Description | Trade-off |
|-----------|---------|-------------|-----------|
| `m` | 16 | Max edges per node per layer | Higher = better recall, more memory |
| `ef_construct` | 100 | Beam width during index build | Higher = better index quality, slower build |
| `ef` | 128 | Beam width during search | Higher = better recall, slower search |
| `full_scan_threshold` | 10000 | Below this count, skip HNSW and brute-force | Avoids index overhead for tiny collections |
| `max_indexing_threads` | 0 (auto) | Parallel threads for index building | 0 = use all available cores |

**Tuning guidance**:

- For recall-critical workloads (RAG, agent memory): increase `ef` to 256 or 512.
  Search latency increases from ~5ms to ~15ms but recall improves from 95% to 99%+.
- For throughput-critical workloads (real-time recommendation): keep `ef` at 64-128.
  Accept ~95% recall for sub-5ms latency.
- `m` is set once at index creation. Changing it requires reindexing. The default of 16
  works well for dimensionalities up to 2048. For higher dimensions, increase to 32 or 64.

### Quantization

Quantization reduces memory footprint by compressing vectors from 32-bit floats to lower
precision representations. Qdrant supports three quantization methods:

#### Scalar Quantization

Converts each float32 component to int8 (1 byte), reducing memory by 4x with minimal
recall loss (~1-2%).

```json
{
  "scalar": {
    "type": "int8",
    "quantile": 0.99,
    "always_ram": true
  }
}
```

- **Memory**: 1536-dim vector goes from 6KB to 1.5KB
- **Use case**: General-purpose, best default for most workloads
- **Trade-off**: ~1% recall loss, 4x memory reduction, ~30% faster search

#### Product Quantization

Divides the vector into sub-vectors and quantizes each independently using a codebook.
Achieves 8-32x compression.

```json
{
  "product": {
    "compression": "x16",
    "always_ram": true
  }
}
```

- **Memory**: 1536-dim vector goes from 6KB to ~384 bytes (x16) or ~192 bytes (x32)
- **Use case**: Large-scale deployments where memory is the bottleneck
- **Trade-off**: 3-5% recall loss, requires longer training phase during index build

#### Binary Quantization

Converts each float to a single bit (positive = 1, negative = 0). Achieves 32x
compression. Most effective with high-dimensional embeddings from models that produce
roughly balanced positive/negative values (e.g., OpenAI, Cohere).

```json
{
  "binary": {
    "always_ram": true
  }
}
```

- **Memory**: 1536-dim vector goes from 6KB to 192 bytes
- **Use case**: Billion-scale collections where memory cost dominates
- **Trade-off**: 5-10% recall loss, mitigated by rescoring with original vectors

### Filtering

Qdrant applies payload filters during HNSW graph traversal, not as a post-processing
step. This is critical for performance: a post-filter approach retrieves K candidates and
then filters, potentially returning fewer than K results. Qdrant's approach guarantees
exactly K filtered results by continuing graph traversal until K matching points are found.

#### Filter Conditions

```json
{
  "filter": {
    "must": [
      { "key": "org_id", "match": { "value": "hanzo" } },
      { "key": "created_at", "range": { "gte": "2026-01-01T00:00:00Z" } }
    ],
    "must_not": [
      { "key": "status", "match": { "value": "deleted" } }
    ],
    "should": [
      { "key": "category", "match": { "value": "technical" } },
      { "key": "category", "match": { "value": "engineering" } }
    ]
  }
}
```

- **must**: All conditions must match (AND)
- **must_not**: None of the conditions may match (NOT)
- **should**: At least one condition must match (OR)

#### Supported Filter Operations

| Operation | Description | Example |
|-----------|-------------|---------|
| `match` | Exact value match | `{"key": "status", "match": {"value": "active"}}` |
| `match_any` | Match any of values | `{"key": "tag", "match": {"any": ["ai", "ml"]}}` |
| `match_except` | Match none of values | `{"key": "tag", "match": {"except": ["draft"]}}` |
| `range` | Numeric/datetime range | `{"key": "score", "range": {"gte": 0.8}}` |
| `geo_bounding_box` | Geographic rectangle | `{"key": "loc", "geo_bounding_box": {...}}` |
| `geo_radius` | Geographic circle | `{"key": "loc", "geo_radius": {"center": ..., "radius": 1000}}` |
| `values_count` | Array length filter | `{"key": "tags", "values_count": {"gte": 2}}` |
| `is_empty` | Field exists check | `{"key": "deleted_at", "is_empty": {}}` |
| `nested` | Filter on nested objects | `{"key": "metadata", "nested": {"filter": ...}}` |

### API

#### Connection Parameters

```yaml
grpc_host: vector.hanzo.svc.cluster.local
grpc_port: 6333
http_host: vector.hanzo.svc.cluster.local
http_port: 6334
api_key: <from K8s secret "vector", key "api-key">
tls: false  # intra-cluster
```

#### Collections API

**Create collection**:

```
PUT /collections/{name}
```

```json
{
  "vectors": {
    "size": 1536,
    "distance": "Cosine"
  },
  "optimizers_config": {
    "indexing_threshold": 20000
  },
  "quantization_config": {
    "scalar": { "type": "int8", "always_ram": true }
  }
}
```

**Multi-vector collection** (for models that produce multiple embeddings per document):

```
PUT /collections/{name}
```

```json
{
  "vectors": {
    "title": { "size": 384, "distance": "Cosine" },
    "content": { "size": 1536, "distance": "Cosine" },
    "image": { "size": 512, "distance": "Euclidean" }
  }
}
```

**Get collection info**: `GET /collections/{name}`

**Delete collection**: `DELETE /collections/{name}`

**List collections**: `GET /collections`

**Update collection parameters**: `PATCH /collections/{name}`

#### Points API

**Upsert points** (insert or update):

```
PUT /collections/{name}/points
```

```json
{
  "points": [
    {
      "id": "doc-001",
      "vector": [0.042, -0.118, "..."],
      "payload": {
        "source": "knowledge-base",
        "org_id": "hanzo",
        "text": "Document content"
      }
    }
  ]
}
```

**Search (nearest neighbors)**:

```
POST /collections/{name}/points/search
```

```json
{
  "vector": [0.042, -0.118, "..."],
  "limit": 10,
  "filter": {
    "must": [
      { "key": "org_id", "match": { "value": "hanzo" } }
    ]
  },
  "with_payload": true,
  "with_vectors": false,
  "params": {
    "hnsw_ef": 128,
    "exact": false
  }
}
```

**Scroll (paginated retrieval)**:

```
POST /collections/{name}/points/scroll
```

```json
{
  "filter": {
    "must": [
      { "key": "category", "match": { "value": "technical" } }
    ]
  },
  "limit": 100,
  "offset": "last-point-id",
  "with_payload": true
}
```

**Recommend (find similar to positive examples, dissimilar from negative)**:

```
POST /collections/{name}/points/recommend
```

```json
{
  "positive": ["doc-001", "doc-005"],
  "negative": ["doc-099"],
  "limit": 10,
  "filter": {
    "must": [
      { "key": "org_id", "match": { "value": "hanzo" } }
    ]
  }
}
```

**Delete points**: `POST /collections/{name}/points/delete`

**Get points by ID**: `POST /collections/{name}/points`

#### Batch Operations

For bulk ingestion (initial data load, embedding pipeline output), use the batch upsert
endpoint with payloads of up to 1000 points per request:

```
PUT /collections/{name}/points?wait=false
```

Setting `wait=false` returns immediately and processes the upsert asynchronously. This
is appropriate for bulk ingestion where the caller does not need immediate confirmation
that each point is searchable.

**Recommended batch size**: 100-500 points per request. Larger batches consume more memory
during processing; smaller batches increase HTTP overhead.

**Parallel ingestion**: Use 4-8 concurrent connections for maximum throughput. Qdrant
handles concurrent writes to different segments safely.

#### Snapshots

Snapshots are point-in-time backups of a collection's data and index:

**Create snapshot**: `POST /collections/{name}/snapshots`

**List snapshots**: `GET /collections/{name}/snapshots`

**Download snapshot**: `GET /collections/{name}/snapshots/{snapshot_name}`

**Restore from snapshot**: Upload the snapshot file to a new or existing collection.

Snapshots are stored locally on the node. For disaster recovery, snapshots should be
uploaded to object storage (Hanzo Object Storage, HIP-0032) via a CronJob.

### Multi-Tenancy

Hanzo Vector supports multi-tenancy through two mechanisms:

#### Collection-per-Tenant

Each tenant (organization) gets its own collection. This provides the strongest isolation:
separate indices, separate resource consumption, separate snapshots.

```
collections:
  hanzo-documents     # org: hanzo
  lux-documents       # org: lux
  zoo-documents       # org: zoo
```

**Use when**: Tenants have different vector dimensionalities, different distance metrics,
or strict data isolation requirements.

#### Payload-Based Tenancy

All tenants share a single collection. Tenant isolation is enforced by mandatory payload
filters on every query:

```json
{
  "vector": [0.042, -0.118, "..."],
  "filter": {
    "must": [
      { "key": "tenant_id", "match": { "value": "hanzo" } }
    ]
  },
  "limit": 10
}
```

**Use when**: Tenants share the same embedding model and dimensionality, and operational
simplicity (fewer collections to manage) outweighs isolation concerns.

**Important**: The application layer MUST enforce the tenant filter. Qdrant does not have
built-in tenant isolation -- it is the caller's responsibility to include the filter on
every query. The Hanzo Vector SDK enforces this by requiring a `tenant_id` parameter on
all search methods.

### Integration with LLM Gateway (HIP-0004)

The primary consumer of Hanzo Vector is the LLM Gateway's RAG pipeline:

```
User Query
    |
    v
LLM Gateway (HIP-0004)
    |
    +--> Embeddings Service --> embed(query) --> query_vector
    |
    +--> Hanzo Vector --> search(query_vector, filter, limit=5) --> context_docs
    |
    +--> LLM Provider --> generate(query + context_docs) --> response
    |
    v
User Response
```

1. **Query embedding**: The LLM Gateway calls the Embeddings service to convert the user's
   natural language query into a vector. Default model: `text-embedding-3-small` (1536
   dimensions, cosine similarity).
2. **Vector search**: The query vector is sent to Hanzo Vector with optional payload
   filters (org_id, source, date range). Qdrant returns the top-K most similar documents
   with their payloads.
3. **Context assembly**: The Gateway assembles the retrieved documents into a context
   window, respecting the target LLM's maximum context length.
4. **Generation**: The LLM generates a response grounded in the retrieved context.

### Integration with Embeddings Service

Hanzo Vector does not generate embeddings. It stores and searches pre-computed vectors.
Embedding generation is handled by the Embeddings service, which is accessible through
the LLM Gateway's `/embeddings` endpoint (OpenAI-compatible):

```
POST /v1/embeddings
{
  "model": "text-embedding-3-small",
  "input": "What is vector search?"
}
```

The pipeline for document ingestion:

1. **Extract text**: Parse documents (PDF, HTML, Markdown, code) into text chunks
2. **Generate embeddings**: Call `/v1/embeddings` with each chunk
3. **Upsert to Vector**: Store the embedding + metadata payload in Qdrant
4. **Index**: Qdrant automatically builds/updates the HNSW index

Supported embedding models (via LLM Gateway):

| Model | Dimensions | Provider | Use Case |
|-------|-----------|----------|----------|
| `text-embedding-3-small` | 1536 | OpenAI | General purpose (default) |
| `text-embedding-3-large` | 3072 | OpenAI | High-accuracy retrieval |
| `embed-english-v3.0` | 1024 | Cohere | English-optimized |
| `embed-multilingual-v3.0` | 1024 | Cohere | Multilingual |
| `voyage-3` | 1024 | Voyage AI | Code and technical docs |

## Implementation

### Container Image

The Dockerfile is minimal:

```dockerfile
ARG QDRANT_VERSION=1.13

FROM qdrant/qdrant:v${QDRANT_VERSION} AS base
FROM base

LABEL maintainer="dev@hanzo.ai"
LABEL org.opencontainers.image.source="https://github.com/hanzoai/vector"
LABEL org.opencontainers.image.description="Hanzo Vector - High-performance vector search"
LABEL org.opencontainers.image.vendor="Hanzo AI"

EXPOSE 6333 6334

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:6333/healthz || exit 1
```

Key points:

- **Base image**: `qdrant/qdrant:v1.13` (Rust binary on Debian slim, ~80MB compressed)
- **No custom compilation**: We use the upstream Qdrant binary as-is. Custom patches
  would create a maintenance burden and diverge from upstream security fixes.
- **Two ports**: 6333 for gRPC (primary, higher throughput), 6334 for HTTP REST (debugging,
  admin, lower overhead for simple queries)

### Configuration

Production `config.yaml` (mounted from ConfigMap):

```yaml
storage:
  storage_path: /qdrant/storage
  snapshots_path: /qdrant/snapshots

  # WAL configuration
  wal:
    wal_capacity_mb: 64
    wal_segments_ahead: 0

  # Optimizer configuration
  optimizers:
    deleted_threshold: 0.2
    vacuum_min_vector_number: 1000
    default_segment_number: 2
    max_segment_size_kb: 0
    memmap_threshold_kb: 50000
    indexing_threshold_kb: 20000
    flush_interval_sec: 5
    max_optimization_threads: 0

  # Performance tuning
  performance:
    max_search_threads: 0  # auto-detect
    max_optimization_threads: 0

service:
  host: 0.0.0.0
  grpc_port: 6333
  http_port: 6334
  api_key: ${VECTOR_API_KEY}
  enable_tls: false

  # CORS for admin dashboard
  enable_cors: true

cluster:
  enabled: false  # standalone mode
```

### Health Checks

**Readiness probe** (is the instance ready to accept queries?):

```yaml
httpGet:
  path: /healthz
  port: 6334
initialDelaySeconds: 5
periodSeconds: 10
failureThreshold: 3
```

**Liveness probe** (is the instance alive?):

```yaml
httpGet:
  path: /healthz
  port: 6334
initialDelaySeconds: 15
periodSeconds: 30
failureThreshold: 5
```

### Resource Allocation

```yaml
resources:
  requests:
    cpu: 500m
    memory: 1Gi
  limits:
    cpu: 4000m
    memory: 8Gi
```

Vector search is CPU- and memory-intensive. The memory limit must accommodate:
- HNSW index (in-memory graph structure)
- Quantized vectors (if `always_ram: true`)
- WAL buffer
- Query execution buffers

### Storage

```yaml
volumeClaimTemplates:
  - metadata:
      name: vector-data
    spec:
      accessModes: [ReadWriteOnce]
      resources:
        requests:
          storage: 50Gi
```

Storage holds the WAL, segment files, snapshots, and (if using mmap) the vector data.
50Gi provides headroom for ~50M vectors at 1536 dimensions with scalar quantization.

### K8s Manifest Structure

All manifests live in `universe/infra/k8s/vector/`:

```yaml
# kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - statefulset.yaml
  - service.yaml
  - secret.yaml
  - configmap.yaml
```

### CI/CD Pipeline

The deploy workflow (`.github/workflows/deploy.yml`):

**Stage 1: Build**

1. Checkout source from `github.com/hanzoai/vector`
2. Authenticate to Hanzo KMS (Universal Auth) to fetch CI secrets
3. Build multi-arch image (`linux/amd64`, `linux/arm64`) via Docker Buildx
4. Push to GHCR (`ghcr.io/hanzoai/vector`) with tags: `latest`, git SHA, semver
5. Push to Docker Hub (`docker.io/hanzoai/vector`) as fallback (continue-on-error)

**Stage 2: Deploy (main branch only)**

1. Authenticate to Hanzo KMS for DigitalOcean API token
2. Configure `kubectl` for `hanzo-k8s` cluster via `doctl`
3. Rolling update: `kubectl -n hanzo set image statefulset/vector vector=ghcr.io/hanzoai/vector:latest`
4. Wait for rollout: `kubectl -n hanzo rollout status statefulset/vector --timeout=180s`

### Client SDKs

| Language | Package | Install |
|----------|---------|---------|
| Python | [hanzo-vector](https://pypi.org/project/hanzo-vector) | `pip install hanzo-vector` |
| Go | [hanzo/vector-go](https://github.com/hanzoai/vector-go) | `go get github.com/hanzoai/vector-go` |
| Node.js | [@hanzo/vector](https://github.com/hanzoai/vector-client) | `npm install @hanzo/vector` |

All three wrap the Qdrant client libraries (`qdrant-client`, `go-client`, `@qdrant/js-client-rest`)
with Hanzo-specific defaults: automatic tenant filtering, KMS secret resolution, connection
pooling, and structured logging.

**Python SDK example**:

```python
from hanzo_vector import VectorClient

client = VectorClient(
    url="http://vector.hanzo.svc:6334",
    api_key=os.environ["VECTOR_API_KEY"],
    tenant_id="hanzo",
)

# Upsert documents
client.upsert(
    collection="documents",
    points=[
        {
            "id": "doc-001",
            "vector": embedding,  # from LLM Gateway /v1/embeddings
            "payload": {"source": "kb", "text": "..."},
        }
    ],
)

# Search with automatic tenant filtering
results = client.search(
    collection="documents",
    query_vector=query_embedding,
    limit=10,
    filter={"category": "technical"},
)
```

## Deployment

### Standalone Mode (Current)

Single StatefulSet with one replica. All shards reside on the single node. This is the
current production configuration.

```
vector-0 (StatefulSet pod)
  |- gRPC :6333
  |- HTTP :6334
  |- storage: /qdrant/storage (PVC: vector-data, 50Gi)
```

**Scale ceiling**: A single Qdrant node on a 16-core machine with 64GB RAM can handle
~100M vectors at 1536 dimensions with scalar quantization, serving ~10K queries/sec at
sub-10ms p99 latency.

### Distributed Mode (Future)

When the dataset or query throughput exceeds single-node capacity, Qdrant supports
distributed deployment with automatic sharding and replication:

```
vector-0 (shard 1 primary, shard 3 replica)
vector-1 (shard 2 primary, shard 1 replica)
vector-2 (shard 3 primary, shard 2 replica)
```

Configuration changes for distributed mode:

```yaml
cluster:
  enabled: true
  p2p:
    port: 6335
  consensus:
    tick_period_ms: 100
```

This will be specified in a future HIP when scale requirements demand it.

## Security

### API Key Authentication

All API requests must include an API key in the `api-key` header or `Authorization:
Bearer` header:

```bash
curl -H "api-key: ${VECTOR_API_KEY}" \
  http://vector.hanzo.svc:6334/collections
```

The API key is stored in a K8s Secret:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: vector
  namespace: hanzo
type: Opaque
stringData:
  api-key: "<generated-value>"
```

In production, this secret is synced from Hanzo KMS (`kms.hanzo.ai`) via the KMS
Operator.

### Network Isolation

- **Service type**: ClusterIP (no external exposure)
- **No NodePort, no LoadBalancer, no Ingress**
- Only pods within the `hanzo` namespace can reach ports 6333/6334
- The Qdrant Web UI (served on the HTTP port) is accessible only via `kubectl port-forward`
  for debugging

### TLS Encryption

TLS is supported but not enabled for intra-cluster communication. The reasoning mirrors
HIP-0028 (Key-Value Store):

- All traffic stays within the DOKS VPC, encrypted at the network layer
- TLS adds latency overhead on every query
- If cross-cluster replication or external access is required, TLS will be enabled via
  Qdrant's built-in TLS configuration

### Collection-Level Access Control

Qdrant's single API key provides cluster-wide access. For collection-level isolation,
the Hanzo Vector SDK enforces access control at the application layer:

- Each service is configured with a list of allowed collections
- The SDK rejects operations on collections not in the allow-list
- Audit logs record all collection access with caller identity

For stricter isolation, use the collection-per-tenant model where each tenant's API key
is scoped to their collections via an API gateway (future work).

### Payload Encryption at Rest

Qdrant stores payload data in segment files on disk. For sensitive payloads (PII,
proprietary content), encryption at rest is provided by:

1. **Volume encryption**: DOKS volumes are encrypted at the block level by DigitalOcean
2. **Application-level encryption**: The Hanzo Vector SDK supports encrypting payload
   fields before storage using AES-256-GCM with keys from Hanzo KMS. Encrypted fields
   are stored as opaque byte strings and decrypted on retrieval.

## Consumers

Services in the Hanzo ecosystem that connect to Vector:

| Service | Use Case | Collection Pattern |
|---------|----------|--------------------|
| LLM Gateway | RAG context retrieval | `{org}-documents` |
| Chat | Conversation history search | `{org}-chat-history` |
| Search | Semantic search index | `{org}-search-index` |
| Agent SDK | Agent long-term memory | `{org}-agent-memory` |
| MCP | Tool context retrieval | `{org}-mcp-context` |
| Cloud | Model registry search | `models` |
| Commerce | Product recommendations | `{org}-products` |
| Zen | Model capability matching | `zen-capabilities` |

### Collection Naming Convention

All collections SHOULD follow the pattern `{org}-{purpose}` or `{purpose}` for
system-wide collections. This enables:

- Per-org monitoring and quota enforcement
- Targeted snapshot/backup schedules
- Clear ownership when debugging resource consumption

## Monitoring

### Built-in Metrics

Qdrant exposes Prometheus metrics on the HTTP port at `/metrics`:

```bash
curl http://vector.hanzo.svc:6334/metrics
```

Key metrics:

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `collections_total` | Number of collections | Informational |
| `vectors_total` | Total vectors across collections | Capacity planning |
| `grpc_responses_duration_seconds` | Search latency histogram | p99 > 50ms |
| `rest_responses_duration_seconds` | REST API latency | p99 > 100ms |
| `app_info` | Version and build info | Informational |
| `segment_count` | Segments per collection | > 20 (needs optimization) |

### Health Endpoint

```bash
# Quick health check
curl http://vector.hanzo.svc:6334/healthz

# Detailed telemetry
curl -H "api-key: ${VECTOR_API_KEY}" \
  http://vector.hanzo.svc:6334/telemetry
```

### Collection-Level Monitoring

```bash
# Collection statistics
curl -H "api-key: ${VECTOR_API_KEY}" \
  http://vector.hanzo.svc:6334/collections/{name}

# Response includes:
# - vectors_count
# - indexed_vectors_count
# - points_count
# - segments_count
# - optimizer_status
# - index status (indexed vs indexing)
```

## Backward Compatibility

This is a new infrastructure component. There is no backward-compatibility concern with
existing services. Services currently using pgvector for vector operations will migrate
incrementally:

1. **Phase 1**: Deploy Hanzo Vector alongside existing pgvector
2. **Phase 2**: New vector workloads target Hanzo Vector; existing pgvector workloads
   remain unchanged
3. **Phase 3**: Migrate existing pgvector collections to Hanzo Vector using the bulk
   ingestion pipeline
4. **Phase 4**: Remove pgvector dependency from services that have fully migrated

pgvector remains available for metadata-heavy queries where relational joins are needed
alongside vector similarity.

## Future Work

1. **Distributed mode**: When dataset exceeds single-node capacity (~100M vectors),
   deploy Qdrant in cluster mode with 3+ nodes, automatic sharding, and shard replication.
   This will require a new HIP.
2. **Sparse vectors**: Qdrant supports sparse vectors (SPLADE, BM25) for hybrid
   lexical+semantic search. Evaluate for Search service integration.
3. **Multi-vector search**: Use named vectors for multimodal retrieval (text + image +
   code embeddings in a single collection).
4. **Automated embedding pipeline**: CronJob or streaming pipeline that watches for new
   documents in Object Storage (HIP-0032) and automatically generates embeddings and
   upserts to Vector.
5. **Collection-scoped API keys**: When Qdrant adds native RBAC (on their roadmap),
   replace application-level access control with database-level enforcement.
6. **GPU-accelerated search**: Evaluate Qdrant's experimental GPU index support for
   ultra-high-throughput workloads.
7. **Cross-cluster replication**: For disaster recovery, replicate collections between
   `hanzo-k8s` and a secondary cluster.
8. **Prometheus integration**: Deploy dedicated metrics exporter with Grafana dashboards
   for collection-level monitoring.

## Reference Implementation

**Repository**: [github.com/hanzoai/vector](https://github.com/hanzoai/vector)

**Key Files**:

- `Dockerfile` -- Multi-arch container image based on Qdrant 1.13
- `.github/workflows/deploy.yml` -- CI/CD: build, push to GHCR/Docker Hub, deploy to K8s
- `config/config.yaml` -- Full reference configuration
- `config/init-collections.sh` -- Bootstrap script for default collections

**K8s Manifests** (`universe/infra/k8s/vector/`):

- `statefulset.yaml` -- StatefulSet `vector` with PVC and health checks
- `service.yaml` -- ClusterIP Service on ports 6333 (gRPC) and 6334 (HTTP)
- `configmap.yaml` -- Qdrant configuration (storage, optimizer, service)
- `secret.yaml` -- API key secret
- `kustomization.yaml` -- Kustomize aggregation

**Status**: Specified, pending initial deployment on `hanzo-k8s`

## References

1. [HIP-0: Hanzo AI Architecture Framework](./hip-0000-hanzo-ai-architecture-framework.md)
2. [HIP-4: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md)
3. [HIP-9: Agent SDK](./hip-0009-agent-sdk-multi-agent-orchestration-framework.md)
4. [HIP-10: MCP Integration Standards](./hip-0010-model-context-protocol-mcp-integration-standards.md)
5. [HIP-28: Key-Value Store Standard](./hip-0028-key-value-store-standard.md)
6. [HIP-32: Object Storage Standard](./hip-0032-object-storage-standard.md)
7. [Qdrant Documentation](https://qdrant.tech/documentation/)
8. [HNSW Algorithm Paper](https://arxiv.org/abs/1603.09320) -- Malkov & Yashunin, 2018
9. [Product Quantization for Nearest Neighbor Search](https://hal.inria.fr/inria-00514462v2/document) -- Jegou et al., 2011

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
