---
hip: 0012
title: Search Interface Standard
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2025-01-09
updated: 2026-02-23
requires: HIP-4
---

# HIP-12: Search Interface Standard

## Abstract

This proposal defines the search interface standard for the Hanzo ecosystem. It specifies a two-layer architecture: a high-performance Rust search engine for indexing, retrieval, and hybrid search, and a generative search UI layer that synthesizes AI answers with inline citations from multiple source types. All search functionality in the Hanzo ecosystem MUST implement this interface.

**Engine Repository**: [github.com/hanzoai/search](https://github.com/hanzoai/search)
**Engine Port**: 7700
**UI Port**: 3000
**Engine Runtime**: Rust (Meilisearch fork, v1.36.0)
**UI Runtime**: Next.js + Supabase

## Motivation

The Hanzo ecosystem requires a unified search standard to:

1. **Provide AI-native answers**: Users expect synthesized answers with citations, not ranked link lists
2. **Unify retrieval**: Internal docs, web results, and knowledge bases searched through one interface
3. **Enable generative UI**: Streaming markdown responses with inline source references
4. **Complement Chat (HIP-11)**: Search is transactional (query-answer-done); chat is conversational (multi-turn, memory, persona)
5. **Self-host the full stack**: No dependency on third-party search APIs for core functionality
6. **Integrate with LLM Gateway**: Leverage HIP-4 for model selection, cost optimization, and provider failover during synthesis

Without standardization, search experiences fragment across applications, retrieval pipelines diverge, and citation formats become inconsistent.

## Design Philosophy

### Why Generative Search UI

Traditional search returns ten blue links. The user clicks through, reads, evaluates, and synthesizes an answer themselves. This model was designed in the 1990s for a web of static pages.

Generative search inverts this. The system retrieves relevant documents, synthesizes a coherent answer, and presents it with citations the user can verify. The user gets an answer, not a reading list. Time-to-answer drops from minutes to seconds.

This is the paradigm shift from Google-style search to AI-native search. The search engine becomes a retrieval backend; the LLM becomes the synthesis frontend. The UI streams the answer in real time, with numbered citations linking to source material.

### Why Perplexity-Style Over Google-Style

Perplexity proved that LLM-powered search with source citations is the dominant UX pattern for knowledge retrieval. The flow is: query, retrieve from multiple sources, synthesize with an LLM, cite every claim. Users trust the answer because they can click through to verify.

Hanzo Search builds on this pattern but self-hosted and integrated with our LLM Gateway (HIP-4). This means:

- **No vendor lock-in**: We control the retrieval and synthesis pipeline end-to-end
- **Model flexibility**: Any model via HIP-4, not locked to one provider
- **Private data**: Internal knowledge bases never leave the deployment boundary
- **Cost control**: Route synthesis to the most cost-effective model for the query complexity
- **Customization**: Search modes, source weighting, and UI all under our control

### Why a Rust Search Engine (Meilisearch Fork)

The core engine is a Rust workspace (v1.36.0) forked from Meilisearch. Rust gives us:

- **Sub-50ms query latency**: No garbage collection pauses, zero-cost abstractions
- **Memory safety**: No segfaults in production, critical for a long-running search service
- **Single binary**: Deploy `hanzo-search` without runtime dependencies
- **Hybrid search**: The `milli` crate combines BM25 full-text ranking with vector similarity in a single query path
- **Battle-tested**: Meilisearch has millions of deployments; we inherit that stability

The workspace contains 20+ crates: `milli` (core engine), `index-scheduler` (async indexing), `filter-parser` (query DSL), `meilisearch-auth` (API keys and tenants), `async-openai` (LLM integration for embeddings), and others.

### Why Next.js + Supabase for the UI Layer

Next.js gives us server-side rendering for fast initial page load and React Server Components for streaming AI responses. When the LLM generates tokens, they flow through a server component to the client without JavaScript hydration overhead.

Supabase provides auth (integrates with IAM via OAuth), a PostgreSQL database (with pgvector for embedding storage), and real-time subscriptions (for collaborative search or live-updating results) in one open-source package. No vendor lock-in.

### Why Separate from Chat (HIP-11)

Chat and search solve different problems with different UX optimization targets:

| Dimension | Chat (HIP-11) | Search (HIP-12) |
|-----------|---------------|-----------------|
| Interaction | Multi-turn conversation | Single query-answer |
| Memory | Session history, persona | Stateless per query |
| Optimization | Engagement, depth | Time-to-answer, accuracy |
| Sources | Model knowledge | Retrieved documents with citations |
| Output | Free-form response | Structured answer + sources |
| Port | 3081 | 3000 |

Combining them would compromise both. Chat needs long context windows and memory management. Search needs fast retrieval and citation tracking. They share the LLM Gateway (HIP-4) but nothing else.

## Specification

### System Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│   Browser    │────▶│  Search UI       │────▶│ LLM Gateway  │
│   Client     │◀────│  (Next.js:3000)  │◀────│   (HIP-4)    │
└─────────────┘     └──────────────────┘     └──────────────┘
                           │    │                     │
                    ┌──────┘    └──────┐              ▼
                    ▼                  ▼        ┌──────────┐
             ┌──────────────┐  ┌────────────┐  │   100+   │
             │ Search Engine│  │  Supabase  │  │ Providers│
             │ (Rust:7700)  │  │  (pgvector)│  └──────────┘
             └──────────────┘  └────────────┘
                    │                  │
                    ▼                  ▼
             ┌──────────────┐  ┌────────────┐
             │ Index Storage│  │ PostgreSQL │
             │   (LMDB)     │  │ (Auth/Hist)│
             └──────────────┘  └────────────┘
```

### Query Pipeline

The generative search pipeline processes a user query through five stages:

```
1. PARSE       User query → intent classification + query rewriting
2. RETRIEVE    Parallel retrieval from multiple source types
3. RANK        Score and deduplicate results across sources
4. SYNTHESIZE  LLM generates answer with inline citations
5. STREAM      Streaming markdown delivered to client via SSE
```

#### Stage 1: Parse

```typescript
interface ParsedQuery {
  original: string;         // Raw user input
  rewritten: string;        // LLM-rewritten for retrieval
  intent: SearchIntent;     // web | academic | code | news | docs
  entities: string[];       // Extracted named entities
  embedding: number[];      // Query embedding vector (1536-dim)
}

type SearchIntent = "web" | "academic" | "code" | "news" | "docs";
```

The query rewriter uses a lightweight LLM call (or rule-based heuristics for common patterns) to transform conversational queries into retrieval-optimized forms. "What's the best way to deploy a Rust binary on Kubernetes?" becomes the embedding query "Rust binary Kubernetes deployment" and the web query "deploy Rust application Kubernetes best practices".

#### Stage 2: Retrieve

Retrieval runs in parallel across configured source types:

```typescript
interface RetrievalSource {
  type: "engine" | "web" | "vector" | "knowledge_base";
  weight: number;           // 0.0-1.0, used in ranking
  config: SourceConfig;
}

// Source configurations
interface EngineSource {
  type: "engine";
  endpoint: string;         // Hanzo Search engine (port 7700)
  index: string;            // Target index name
  limit: number;
}

interface WebSource {
  type: "web";
  provider: "brave" | "google" | "bing";
  api_key: string;
  limit: number;
}

interface VectorSource {
  type: "vector";
  connection: string;       // pgvector connection string
  table: string;
  embedding_column: string;
  similarity: "cosine" | "l2" | "inner_product";
  limit: number;
}

interface KnowledgeBaseSource {
  type: "knowledge_base";
  id: string;               // KB identifier
  endpoint: string;         // API endpoint
  limit: number;
}
```

#### Stage 3: Rank

Results from all sources are scored and merged:

```typescript
interface RankedResult {
  id: string;
  title: string;
  url: string;
  snippet: string;          // Relevant text excerpt
  content: string;          // Full text (for LLM context)
  source_type: string;      // Which retrieval source
  source_name: string;      // Display name (e.g., "Brave Search")
  score: number;            // Normalized 0.0-1.0
  metadata: Record<string, any>;
}
```

Scoring combines:
- **Relevance**: BM25 or cosine similarity from the source
- **Source weight**: Configured per-source priority
- **Freshness**: Recency bonus for time-sensitive queries
- **Authority**: Domain reputation score for web results

Deduplication uses URL normalization and content fingerprinting (SimHash) to collapse near-duplicate results.

#### Stage 4: Synthesize

The top-K ranked results are assembled into an LLM prompt:

```typescript
interface SynthesisRequest {
  query: string;
  results: RankedResult[];  // Top-K (default: 10)
  mode: SearchIntent;
  model?: string;           // Override model selection
  max_tokens?: number;      // Default: 2048
}
```

The synthesis prompt instructs the model to:
1. Answer the query using ONLY information from the provided sources
2. Cite sources using `[N]` notation, where N maps to the source index
3. Structure the answer with markdown headings when appropriate
4. Include a brief "Key takeaway" at the top for quick scanning
5. Flag when sources conflict or information is uncertain

#### Stage 5: Stream

The response streams to the client using Server-Sent Events:

```typescript
// Answer token
event: token
data: {"content": "Rust binaries can be deployed", "index": 0}

// Citation reference (emitted when [N] appears in stream)
event: citation
data: {"index": 1, "source_id": "src_abc", "url": "https://...", "title": "..."}

// Related questions
event: related
data: {"questions": ["How to optimize Rust binary size?", "Kubernetes pod resource limits for Rust"]}

// Completion
event: done
data: {
  "query_id": "q_789",
  "model": "zen-32b",
  "tokens": {"prompt": 4200, "completion": 680, "total": 4880},
  "sources_used": 6,
  "latency_ms": 2340
}

// Error
event: error
data: {"code": "synthesis_failed", "message": "LLM returned empty response"}
```

### Core Data Models

#### Search Request

```typescript
interface SearchRequest {
  // Required
  query: string;

  // Optional configuration
  mode?: SearchIntent;       // Default: auto-detect
  sources?: string[];        // Source type filter
  limit?: number;            // Max sources to retrieve (default: 10)
  model?: string;            // LLM model override
  stream?: boolean;          // Default: true
  language?: string;         // ISO 639-1 code

  // Filters
  domain_filter?: string[];  // Include only these domains
  domain_block?: string[];   // Exclude these domains
  date_range?: {
    from?: string;           // ISO 8601
    to?: string;
  };

  // Context
  user_id?: string;          // For personalization
  session_id?: string;       // For search history grouping
}
```

#### Search Response

```typescript
interface SearchResponse {
  // Identifiers
  query_id: string;
  query: string;

  // Generated answer
  answer: string;            // Markdown with [N] citations
  answer_tokens: number;

  // Sources used in synthesis
  sources: Source[];

  // Auto-generated follow-up queries
  related_questions: string[];

  // Metadata
  model: string;
  mode: SearchIntent;
  latency_ms: number;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
}

interface Source {
  index: number;             // Citation number [N]
  title: string;
  url: string;
  snippet: string;
  favicon?: string;
  source_type: string;
  published_date?: string;
}
```

### API Endpoints

#### Search

```yaml
# Generative search (primary endpoint)
POST /api/search
Headers:
  Authorization: Bearer <token>
  Accept: text/event-stream   # For SSE streaming
Body: SearchRequest
Response: Stream of SSE events (see Stage 5)

# Non-streaming variant
POST /api/search
Headers:
  Authorization: Bearer <token>
  Accept: application/json
Body: SearchRequest
Response: SearchResponse
```

#### Sources

```yaml
# Get sources for a completed search
GET /api/search/:query_id/sources
Response:
  sources: Source[]
  total: number

# Get full content of a specific source
GET /api/search/:query_id/sources/:index
Response:
  source: Source
  full_content: string
```

#### Search History

```yaml
# List recent searches
GET /api/search/history
Query:
  page?: number
  limit?: number (default: 20)
  mode?: SearchIntent
Response:
  searches: SearchHistoryEntry[]
  total: number

# Delete search history
DELETE /api/search/history
Response:
  success: boolean
```

#### Engine Proxy (Direct Meilisearch API)

```yaml
# Index documents (proxied to engine on port 7700)
POST /api/engine/indexes/:index/documents
Headers:
  Authorization: Bearer <master-key>
Body: Document[]
Response:
  taskUid: number
  status: "enqueued"

# Direct search (non-generative, engine only)
POST /api/engine/indexes/:index/search
Body:
  q: string
  limit?: number
  filter?: string
  sort?: string[]
  attributesToRetrieve?: string[]
Response:
  hits: Document[]
  query: string
  processingTimeMs: number
  estimatedTotalHits: number
```

### Search Modes

Each mode adjusts source weights, synthesis prompts, and UI layout:

| Mode | Primary Sources | Synthesis Style | UI Features |
|------|----------------|-----------------|-------------|
| **web** | Brave/Google + engine | Balanced summary | Source cards, images |
| **academic** | Scholar APIs + engine | Formal with methodology | Paper cards, DOI links |
| **code** | GitHub + engine + docs | Code examples with explanation | Syntax highlighting, copy buttons |
| **news** | News APIs + engine | Timeline-aware, multi-perspective | Date grouping, outlet badges |
| **docs** | Internal knowledge bases | Precise, step-by-step | Code blocks, API examples |

Mode is auto-detected from query content but can be overridden in the request.

### Engine Configuration

The Rust search engine accepts configuration via CLI flags, environment variables, or a config file:

```toml
# config.toml
[server]
http_addr = "0.0.0.0:7700"
master_key = "HANZO_SEARCH_MASTER_KEY"
max_index_size = "100GB"
max_task_db_size = "10GB"

[indexing]
max_indexing_memory = "2GiB"
max_indexing_threads = 4

[experimental]
enable_metrics = true
enable_logs_route = true
vector_store = true     # Enable hybrid search
```

### Authentication and Authorization

Search uses a layered auth model:

1. **UI Layer**: Supabase Auth federated through IAM (HIP-26) via OAuth
2. **Engine Layer**: API key-based with tenant isolation
3. **LLM Gateway**: Bearer token forwarded from UI session

```typescript
interface SearchAPIKey {
  uid: string;
  key: string;              // Hashed
  name: string;
  actions: SearchAction[];
  indexes: string[];        // ["*"] for all
  expires_at?: string;      // ISO 8601
}

type SearchAction =
  | "search"                // Query indexes
  | "documents.add"         // Index documents
  | "documents.delete"      // Remove documents
  | "indexes.create"        // Create indexes
  | "indexes.delete"        // Delete indexes
  | "settings.update"       // Modify index settings
  | "stats.get"             // Read metrics
  | "*";                    // Admin
```

### Rate Limiting

```yaml
Tiers:
  free:
    searches_per_minute: 10
    searches_per_day: 200
    max_sources_per_query: 5
    engine_documents: 10000

  pro:
    searches_per_minute: 60
    searches_per_day: 5000
    max_sources_per_query: 15
    engine_documents: 1000000

  enterprise:
    searches_per_minute: 300
    searches_per_day: unlimited
    max_sources_per_query: 30
    engine_documents: unlimited
```

### Error Handling

```typescript
interface SearchError {
  error: {
    code: SearchErrorCode;
    message: string;
    details?: any;
    query_id?: string;
    timestamp: number;
  };
}

enum SearchErrorCode {
  // Client errors
  INVALID_QUERY = "invalid_query",
  QUERY_TOO_LONG = "query_too_long",       // > 2000 chars
  UNAUTHORIZED = "unauthorized",
  RATE_LIMITED = "rate_limited",
  INVALID_MODE = "invalid_mode",
  INDEX_NOT_FOUND = "index_not_found",

  // Server errors
  RETRIEVAL_FAILED = "retrieval_failed",    // Source unavailable
  SYNTHESIS_FAILED = "synthesis_failed",    // LLM error
  ENGINE_ERROR = "engine_error",            // Rust engine error
  GATEWAY_ERROR = "gateway_error",          // HIP-4 unavailable
  INTERNAL_ERROR = "internal_error"
}
```

## Implementation

### Repository Structure

```
search/                          # Rust search engine
├── crates/
│   ├── meilisearch/             # HTTP server (Actix)
│   ├── milli/                   # Core indexing + search engine
│   ├── index-scheduler/         # Async task queue for indexing
│   ├── filter-parser/           # Query filter DSL parser
│   ├── meilisearch-auth/        # API key + tenant management
│   ├── meilisearch-types/       # Shared type definitions
│   ├── http-client/             # HTTP client utilities
│   ├── dump/                    # Index snapshot/restore
│   ├── file-store/              # File-backed storage
│   ├── flatten-serde-json/      # JSON flattening for indexing
│   ├── json-depth-checker/      # JSON validation
│   ├── meili-snap/              # Snapshot testing
│   ├── meilitool/               # CLI admin tool
│   ├── openapi-generator/       # API spec generation
│   ├── benchmarks/              # Performance benchmarks
│   ├── fuzzers/                 # Fuzz testing
│   ├── tracing-trace/           # Distributed tracing
│   ├── build-info/              # Build metadata
│   └── xtask/                   # Build automation
├── external-crates/
│   ├── async-openai/            # LLM client for embeddings
│   └── reqwest-eventsource/     # SSE client
├── workloads/                   # Test datasets
├── Cargo.toml                   # Workspace root
├── Dockerfile                   # Multi-stage build
└── config.toml                  # Default configuration
```

The generative UI layer lives in a separate deployment (Next.js application) that connects to the engine and LLM Gateway.

### Deployment

#### Docker Compose

```yaml
# compose.yml
services:
  search-ui:
    image: hanzoai/search-ui:latest
    ports:
      - "3000:3000"
    environment:
      - SEARCH_ENGINE_URL=http://search-engine:7700
      - LLM_GATEWAY_URL=http://gateway:4000
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
      - BRAVE_SEARCH_API_KEY=${BRAVE_SEARCH_API_KEY}
      - IAM_OAUTH_CLIENT_ID=${IAM_OAUTH_CLIENT_ID}
      - IAM_OAUTH_CLIENT_SECRET=${IAM_OAUTH_CLIENT_SECRET}
    depends_on:
      - search-engine
      - gateway

  search-engine:
    image: hanzoai/search:latest
    ports:
      - "7700:7700"
    volumes:
      - search_data:/meili_data
    environment:
      - MEILI_MASTER_KEY=${SEARCH_MASTER_KEY}
      - MEILI_ENV=production

  gateway:
    image: hanzoai/llm-gateway:latest
    ports:
      - "4000:4000"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}

  supabase-db:
    image: supabase/postgres:15
    ports:
      - "5432:5432"
    volumes:
      - pg_data:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=search
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

volumes:
  search_data:
  pg_data:
```

#### Quick Start

```bash
# Clone and start
git clone https://github.com/hanzoai/search
cd search

# Engine only (Rust)
cargo build --release
./target/release/hanzo-search --master-key="your-key"

# Full stack with generative UI
cp .env.example .env
# Edit .env with API keys
docker compose up -d

# Index documents
curl -X POST 'http://localhost:7700/indexes/docs/documents' \
  -H 'Authorization: Bearer your-key' \
  -H 'Content-Type: application/json' \
  --data-binary @documents.json

# Generative search
curl -N 'http://localhost:3000/api/search' \
  -H 'Accept: text/event-stream' \
  -H 'Content-Type: application/json' \
  -d '{"query": "How does hybrid search work?"}'
```

### SDKs

| Language | Package | Repository |
|----------|---------|------------|
| Go | `github.com/hanzoai/search-go` | [hanzoai/search-go](https://github.com/hanzoai/search-go) |
| JavaScript / TypeScript | `@hanzo/search` | [hanzoai/search-js](https://github.com/hanzoai/search-js) |
| Python | `hanzo-search` | [hanzoai/search-python](https://github.com/hanzoai/search-python) |
| Rust | `hanzo-search` | [hanzoai/search-rust](https://github.com/hanzoai/search-rust) |

SDK usage for generative search:

```typescript
import { HanzoSearch } from '@hanzo/search';

const search = new HanzoSearch({
  uiUrl: 'https://search.hanzo.ai',
  engineUrl: 'https://search-engine.hanzo.ai',
  apiKey: 'sk-hanzo-...',
});

// Generative search with streaming
const stream = await search.query('What is hybrid search?', {
  mode: 'docs',
  stream: true,
});

for await (const event of stream) {
  if (event.type === 'token') process.stdout.write(event.content);
  if (event.type === 'citation') console.log(`[${event.index}] ${event.title}`);
  if (event.type === 'done') console.log(`\n${event.sources_used} sources, ${event.latency_ms}ms`);
}

// Direct engine search (non-generative)
const results = await search.engine.index('docs').search('hybrid search', {
  limit: 20,
  filter: 'category = "architecture"',
});
```

## Security Considerations

1. **Query sanitization**: Strip injection attempts before forwarding to engine or LLM
2. **Source validation**: Verify URLs and content from web sources before displaying
3. **API key isolation**: Engine API keys scoped to specific indexes and actions
4. **PII filtering**: Optionally strip personal data from queries before web search
5. **Content filtering**: Flag and filter harmful content in synthesized answers
6. **Rate limiting**: Per-user and per-key limits at both UI and engine layers
7. **TLS everywhere**: All inter-service communication over TLS
8. **Audit logging**: Log all queries with user attribution for compliance

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Engine query latency | < 50ms p95 | Full-text + vector hybrid |
| Time to first token | < 500ms | Including retrieval + LLM cold start |
| Full answer latency | < 3s p95 | End-to-end for typical web query |
| Concurrent queries | > 500 | Per engine instance |
| Index throughput | > 10K docs/sec | Bulk indexing |
| Max index size | 100GB | Per index, configurable |

## Testing

```bash
# Engine unit tests (Rust)
cargo test --workspace

# Engine benchmarks
cargo bench --package benchmarks

# UI unit tests
pnpm test

# Integration tests (full pipeline)
pnpm test:integration

# Load testing
k6 run tests/load/search-pipeline.js
```

## References

1. [HIP-4: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md)
2. [HIP-10: Model Context Protocol](./hip-0010-model-context-protocol-mcp-integration-standards.md)
3. [HIP-11: Chat Interface Standard](./hip-0011-chat-interface-standard.md)
4. [HIP-26: Identity and Access Management](./hip-0026-identity-access-management-standard.md)
5. [Hanzo Search Engine Repository](https://github.com/hanzoai/search)
6. [Meilisearch Documentation](https://www.meilisearch.com/docs)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
