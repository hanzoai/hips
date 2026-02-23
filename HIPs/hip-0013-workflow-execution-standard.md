---
hip: 0013
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

This proposal defines the Workflow Execution Standard for Hanzo Flow, a visual DAG-based AI workflow builder forked from Langflow. Flow enables AI engineers to design, test, and deploy LangChain-based pipelines through a drag-and-drop canvas, then export production-ready Python or TypeScript artifacts. All workflow systems in the Hanzo ecosystem MUST implement the interfaces defined in this specification.

**Repository**: [github.com/hanzoai/flow](https://github.com/hanzoai/flow)
**Production**: [flow.hanzo.ai](https://flow.hanzo.ai)
**PyPI**: `hanzoai-flow`

## Motivation

AI workflow development today suffers from three fundamental problems:

1. **Code-only tooling excludes non-coders.** LangChain is powerful but requires fluency in Python, prompt engineering patterns, and async programming. Product managers, domain experts, and junior engineers cannot participate in pipeline design.

2. **No single pane of glass.** Teams use scattered notebooks, scripts, and ad-hoc APIs. There is no canonical representation of an AI pipeline that can be versioned, diffed, reviewed, and rolled back like source code.

3. **Provider lock-in.** Most workflow tools call LLM providers directly. Switching models means rewriting integration code. There is no uniform abstraction for model selection, billing, and observability.

4. **No Hanzo integration.** Existing tools lack first-class support for the Hanzo LLM Gateway (HIP-1), MCP tools (HIP-10), IAM authentication (HIP-26), and credit-based billing (HIP-18).

5. **Workflow vs. automation confusion.** Teams conflate AI pipeline construction (prompt chains, RAG, agent loops) with business process automation (webhooks, schedules, CRM integrations). These are distinct concerns requiring distinct tools.

Hanzo Flow solves all five by providing a visual DAG builder backed by LangChain, integrated with Hanzo infrastructure, and clearly scoped to AI pipeline construction.

## Design Philosophy

### Why Langflow Over Alternatives

**Langflow vs. LangChain directly.** LangChain is a library, not an IDE. It provides chain primitives but no visual composition, no live preview, no collaborative editing. Langflow wraps LangChain in a React Flow canvas where each node is a LangChain component. Users drag nodes, draw edges, configure parameters, and test in real time. The visual canvas is the IDE; the exported code is the deployment artifact.

**Langflow vs. Flowise.** Flowise is the closest competitor. Both are visual LangChain builders. However, Flowise has a smaller component library, weaker TypeScript export support, and no extension mechanism for custom nodes. Langflow's component system is Python-native, making it trivial to wrap any LangChain class as a node.

**Langflow vs. Dify.** Dify bundles its own model hosting, document processing, and vector store. This is convenient for standalone use but conflicts with Hanzo's architecture where the LLM Gateway (HIP-1) handles model routing, KMS (HIP-27) manages secrets, and the platform (HIP-26) handles auth. Dify's opinionated stack would require gutting most of its backend. Langflow's lightweight architecture makes it a better fork target.

**Langflow vs. n8n / Zapier / Make.** These are business process automation tools. They excel at webhook-triggered integrations, CRM sync, and scheduled tasks. They are not designed for LLM chain composition, prompt engineering, or RAG pipeline development. See the separation from Auto (below).

### Why Fork

A fork rather than a plugin is necessary because our requirements touch Langflow's core execution engine, not just its UI:

- **LLM Gateway integration.** All LLM calls MUST route through the Hanzo LLM Gateway (`llm.hanzo.ai`). This means replacing Langflow's direct provider connections with Gateway-proxied calls, adding API key injection, model aliasing, and fallback routing.
- **MCP tool nodes.** Hanzo's 260+ MCP tools must appear as first-class nodes in the canvas. This requires a custom node loader that reads MCP tool schemas and generates Flow components dynamically.
- **IAM authentication.** Flow must authenticate users via Hanzo IAM (HIP-26) using OAuth2/OIDC, with organization-scoped access to flows and templates.
- **Credit billing hooks.** Every flow execution must meter LLM token usage and debit the user's Hanzo credit balance (HIP-18). This requires intercepting execution at the DAG engine level.
- **Zen model selectors.** Users must be able to select from Hanzo's Zen model family with model cards showing parameter counts, context windows, and pricing -- not raw provider model IDs.

### Why Separate From Auto (HIP-34)

Flow and Auto serve different users with different mental models:

| Dimension | Flow (HIP-13) | Auto (HIP-34) |
|-----------|---------------|----------------|
| **User** | AI engineers, ML engineers, prompt engineers | Business users, ops teams, product managers |
| **Metaphor** | DAG of AI components (chains, agents, tools) | Trigger-action automation (if X then Y) |
| **Primitives** | LLMs, embeddings, vector stores, agents, parsers | Webhooks, schedules, API calls, conditionals |
| **Output** | AI artifacts (responses, embeddings, classifications) | Side effects (emails sent, records updated, files moved) |
| **Execution** | Synchronous or streaming, latency-sensitive | Async, retry-tolerant, eventually consistent |
| **Export** | Python/TypeScript code for production deployment | JSON workflow definitions for the Auto runtime |

Flow outputs AI artifacts. Auto orchestrates business processes. They complement each other: an Auto workflow might trigger a Flow pipeline as one of its steps. But their design surfaces, execution models, and target users are fundamentally different.

### Why Visual + Code Export

The visual canvas is not a replacement for code -- it is a design tool that produces code. The workflow is:

1. **Design** on the canvas: drag nodes, draw edges, configure parameters, test with sample inputs.
2. **Test** interactively: run the flow, inspect intermediate outputs at each node, iterate on prompts.
3. **Export** to Python or TypeScript: the canvas generates a clean, readable script using LangChain primitives.
4. **Deploy** the exported code: run it as a FastAPI service, a CLI tool, or an Agent SDK (HIP-9) component.

This means the canvas is always the source of truth during development, but production never depends on the canvas runtime. Teams can review exported code in pull requests, run it in CI, and deploy it without Flow infrastructure.

## Specification

### Component Types

Every node on the Flow canvas is an instance of a component type. The standard component categories are:

#### LLM Components

Nodes that call language models through the Hanzo LLM Gateway.

```yaml
LLM:
  - ChatModel          # Conversational LLM (chat completions)
  - CompletionModel    # Text completion LLM
  - ZenModelSelector   # Hanzo Zen model family picker (Hanzo-specific)
  - ModelRouter        # Route to different models based on input characteristics
```

#### Embedding Components

Nodes that produce vector embeddings from text.

```yaml
Embeddings:
  - OpenAIEmbeddings     # Via Gateway
  - HuggingFaceEmbeddings
  - CohereEmbeddings     # Via Gateway
  - CustomEmbeddings     # User-provided embedding function
```

#### Vector Store Components

Nodes that store and retrieve vectors for similarity search.

```yaml
VectorStores:
  - Pinecone
  - Weaviate
  - Chroma
  - pgvector          # PostgreSQL with pgvector extension
  - FAISS             # In-memory, for prototyping
  - Qdrant
```

#### Agent Components

Nodes that implement autonomous agent loops.

```yaml
Agents:
  - ReActAgent         # Reasoning + acting loop
  - PlanAndExecute     # Planning then sequential execution
  - OpenAIFunctions    # Function-calling agent
  - HanzoAgent         # Agent SDK (HIP-9) integration
  - ConversationalAgent
```

#### Tool Components

Nodes that provide tools to agents or chains.

```yaml
Tools:
  - MCPTool            # Any Hanzo MCP tool (Hanzo-specific)
  - SearchTool         # Web search
  - CalculatorTool
  - PythonREPL         # Sandboxed Python execution
  - APITool            # Call external APIs
  - SQLTool            # Query databases
  - BrowserTool        # Web browsing
```

#### Chain Components

Nodes that compose LLM calls with logic.

```yaml
Chains:
  - LLMChain           # Prompt template + LLM
  - SequentialChain    # Ordered chain of sub-chains
  - RouterChain        # Route input to different chains
  - ConversationChain  # Chat with memory
  - RetrievalQA        # RAG: retrieve then answer
  - MapReduceChain     # Process documents in parallel then combine
  - SummarizeChain     # Summarize long documents
```

#### Memory Components

Nodes that maintain state across LLM calls.

```yaml
Memory:
  - ConversationBuffer    # Full conversation history
  - ConversationSummary   # Summarized history
  - ConversationWindow    # Last N messages
  - EntityMemory          # Track entities mentioned
  - VectorStoreMemory     # Similarity-based recall
```

#### Output Parser Components

Nodes that parse LLM output into structured formats.

```yaml
OutputParsers:
  - JSONParser           # Parse JSON from LLM output
  - PydanticParser       # Parse into Pydantic models
  - ListParser           # Parse comma/newline separated lists
  - RegexParser          # Extract via regex patterns
  - StructuredOutputParser
```

#### I/O Components

Nodes for input/output handling.

```yaml
IO:
  - TextInput            # User text input
  - FileInput            # Upload documents
  - ChatInput            # Conversational input
  - TextOutput           # Display text
  - ChatOutput           # Conversational output
  - WebhookInput         # Receive external triggers
  - WebhookOutput        # Send results externally
```

### Hanzo-Specific Components

These components exist only in Hanzo Flow and integrate with Hanzo infrastructure.

#### LLM Gateway Node

Routes all LLM calls through the Hanzo LLM Gateway (`llm.hanzo.ai`).

```python
class LLMGatewayNode(Component):
    """
    Proxies LLM calls through Hanzo Gateway.
    Supports all 100+ providers via a single endpoint.
    """
    display_name = "Hanzo LLM Gateway"

    inputs = [
        StrInput(name="model", display_name="Model", required=True,
                 info="Model identifier (e.g., zen-72b, gpt-4, claude-3-opus)"),
        SecretStrInput(name="api_key", display_name="API Key",
                       info="Hanzo API key. Auto-injected from IAM session."),
        StrInput(name="gateway_url", display_name="Gateway URL",
                 value="https://llm.hanzo.ai", advanced=True),
        FloatInput(name="temperature", display_name="Temperature",
                   value=0.7, range_spec=RangeSpec(min=0, max=2, step=0.1)),
        IntInput(name="max_tokens", display_name="Max Tokens", value=4096),
    ]

    def build(self) -> ChatOpenAI:
        return ChatOpenAI(
            model=self.model,
            openai_api_key=self.api_key,
            openai_api_base=self.gateway_url,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
        )
```

#### MCP Tool Node

Dynamically loads any of Hanzo's 260+ MCP tools as a Flow component.

```python
class MCPToolNode(Component):
    """
    Wraps a Hanzo MCP tool as a Flow node.
    Tool schemas are loaded dynamically from the MCP registry.
    """
    display_name = "MCP Tool"

    inputs = [
        DropdownInput(name="tool_name", display_name="Tool",
                      options_loader=load_mcp_tools,
                      info="Select from 260+ MCP tools"),
        DictInput(name="tool_params", display_name="Parameters",
                  info="Tool-specific parameters (auto-populated from schema)"),
    ]

    def build(self) -> BaseTool:
        schema = mcp_registry.get_schema(self.tool_name)
        return MCPLangChainTool(
            name=self.tool_name,
            description=schema.description,
            args_schema=schema.to_pydantic(),
            mcp_client=self.get_mcp_client(),
        )
```

#### Zen Model Selector

Provides a rich model picker showing Hanzo's Zen model family with metadata.

```python
class ZenModelSelector(Component):
    """
    Model selector showing Zen family with parameter counts,
    context windows, pricing per 1M tokens, and capability tags.
    """
    display_name = "Zen Model Selector"

    inputs = [
        DropdownInput(name="model", display_name="Zen Model",
                      options=[
                          "zen-1b   | 1B params   | 32K ctx  | $0.10/1M",
                          "zen-8b   | 8B params   | 128K ctx | $0.30/1M",
                          "zen-72b  | 72B params  | 128K ctx | $1.00/1M",
                          "zen-480b | 480B params | 256K ctx | $5.00/1M",
                      ]),
        FloatInput(name="temperature", display_name="Temperature", value=0.7),
    ]

    def build(self) -> ChatOpenAI:
        model_id = self.model.split("|")[0].strip()
        return ChatOpenAI(
            model=model_id,
            openai_api_key=self.get_iam_api_key(),
            openai_api_base="https://llm.hanzo.ai",
            temperature=self.temperature,
        )
```

#### Credit Billing Hook

Intercepts flow execution to meter token usage and debit credits.

```python
class CreditBillingHook(Component):
    """
    Meters LLM token usage during flow execution and
    creates billing transactions against the user's Hanzo credit balance.
    """
    display_name = "Credit Billing"

    inputs = [
        StrInput(name="org_id", display_name="Organization",
                 info="Hanzo organization to bill"),
        BoolInput(name="enforce_balance", display_name="Enforce Balance",
                  value=True, info="Reject execution if balance insufficient"),
    ]

    def build(self) -> CallbackHandler:
        return BillingCallbackHandler(
            iam_client=self.get_iam_client(),
            org_id=self.org_id,
            enforce_balance=self.enforce_balance,
        )
```

### Flow Definition Schema

A flow is a JSON document describing a directed acyclic graph of components.

```json
{
  "id": "uuid-v4",
  "name": "Customer Support RAG",
  "description": "RAG pipeline for answering customer questions",
  "version": 3,
  "created_at": "2025-06-15T10:30:00Z",
  "updated_at": "2025-07-01T14:22:00Z",
  "created_by": "user-uuid",
  "org_id": "hanzo",
  "tags": ["rag", "support", "production"],
  "nodes": [
    {
      "id": "node-1",
      "type": "TextInput",
      "position": {"x": 100, "y": 200},
      "data": {
        "input_value": "",
        "display_name": "User Question"
      }
    },
    {
      "id": "node-2",
      "type": "OpenAIEmbeddings",
      "position": {"x": 300, "y": 200},
      "data": {
        "model": "text-embedding-3-small"
      }
    },
    {
      "id": "node-3",
      "type": "pgvector",
      "position": {"x": 500, "y": 200},
      "data": {
        "connection_string": "${secrets.PG_VECTOR_URL}",
        "collection_name": "support_docs",
        "search_type": "similarity",
        "k": 5
      }
    },
    {
      "id": "node-4",
      "type": "LLMGatewayNode",
      "position": {"x": 500, "y": 400},
      "data": {
        "model": "zen-72b",
        "temperature": 0.3,
        "max_tokens": 2048
      }
    },
    {
      "id": "node-5",
      "type": "RetrievalQA",
      "position": {"x": 700, "y": 300},
      "data": {
        "chain_type": "stuff",
        "return_source_documents": true
      }
    }
  ],
  "edges": [
    {"source": "node-1", "target": "node-2", "sourceHandle": "text", "targetHandle": "input"},
    {"source": "node-2", "target": "node-3", "sourceHandle": "embeddings", "targetHandle": "embeddings"},
    {"source": "node-1", "target": "node-5", "sourceHandle": "text", "targetHandle": "query"},
    {"source": "node-3", "target": "node-5", "sourceHandle": "retriever", "targetHandle": "retriever"},
    {"source": "node-4", "target": "node-5", "sourceHandle": "llm", "targetHandle": "llm"}
  ]
}
```

### DAG Execution Engine

The execution engine processes flows as directed acyclic graphs.

**Topological sort.** Before execution, the engine computes a topological ordering of nodes. Nodes with no incoming edges execute first. A node executes only after all its dependencies have completed.

**Parallel execution.** Independent branches (nodes with no shared ancestry in the current frontier) execute concurrently. The engine uses Python's `asyncio.gather` to run independent branches in parallel, bounded by a configurable concurrency limit.

**Streaming support.** LLM nodes support streaming output via Server-Sent Events (SSE). When a flow contains a streaming-capable LLM node connected to an output node, the API returns a streaming response. Intermediate nodes buffer their output; only the final output node streams to the client.

**Error propagation.** If a node fails, the engine marks all downstream nodes as `skipped` and returns a partial result containing outputs from all nodes that completed successfully, plus the error from the failed node.

```python
class DAGExecutor:
    """Executes a flow DAG with parallel branch support."""

    async def execute(self, flow: Flow, inputs: dict) -> ExecutionResult:
        graph = self.build_graph(flow)
        order = topological_sort(graph)
        levels = self.compute_levels(order, graph)

        outputs = {}
        for level in levels:
            # All nodes in a level are independent -- execute in parallel
            tasks = [
                self.execute_node(node, outputs, inputs)
                for node in level
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            for node, result in zip(level, results):
                if isinstance(result, Exception):
                    return ExecutionResult(
                        status="failed",
                        outputs=outputs,
                        error={"node": node.id, "message": str(result)},
                    )
                outputs[node.id] = result

        return ExecutionResult(status="completed", outputs=outputs)
```

### API Specification

All API endpoints require OAuth2 bearer tokens from Hanzo IAM.

#### Flow CRUD

```
GET    /api/v1/flows                    # List flows (paginated, filterable)
POST   /api/v1/flows                    # Create flow
GET    /api/v1/flows/{flow_id}          # Get flow by ID
PUT    /api/v1/flows/{flow_id}          # Update flow
DELETE /api/v1/flows/{flow_id}          # Delete flow
GET    /api/v1/flows/{flow_id}/versions # List flow versions
GET    /api/v1/flows/{flow_id}/versions/{version} # Get specific version
POST   /api/v1/flows/{flow_id}/rollback/{version} # Rollback to version
```

#### Flow Execution

```
POST   /api/v1/run/{flow_id}           # Execute flow (sync)
POST   /api/v1/run/{flow_id}/stream    # Execute flow (streaming SSE)
POST   /api/v1/run/{flow_id}/async     # Execute flow (async, returns job ID)
GET    /api/v1/jobs/{job_id}           # Poll async job status
GET    /api/v1/jobs/{job_id}/result    # Get async job result
DELETE /api/v1/jobs/{job_id}           # Cancel async job
```

#### Templates

```
GET    /api/v1/templates               # List marketplace templates
GET    /api/v1/templates/{template_id} # Get template
POST   /api/v1/templates               # Publish flow as template
POST   /api/v1/flows/from-template/{template_id} # Create flow from template
```

#### Components

```
GET    /api/v1/components              # List available component types
GET    /api/v1/components/{type}       # Get component schema
GET    /api/v1/components/mcp          # List available MCP tools as components
```

#### Execution Request Format

```json
POST /api/v1/run/{flow_id}
{
  "inputs": {
    "text_input": "What is our refund policy?"
  },
  "tweaks": {
    "node-4": {
      "temperature": 0.1,
      "max_tokens": 1024
    }
  },
  "session_id": "optional-session-for-memory"
}
```

#### Execution Response Format

```json
{
  "id": "exec-uuid",
  "flow_id": "flow-uuid",
  "status": "completed",
  "duration_ms": 2340,
  "outputs": {
    "node-5": {
      "result": "Our refund policy allows returns within 30 days...",
      "source_documents": [
        {"page_content": "...", "metadata": {"source": "refund-policy.pdf"}}
      ]
    }
  },
  "usage": {
    "total_tokens": 1847,
    "prompt_tokens": 1203,
    "completion_tokens": 644,
    "cost_credits": 0.0018,
    "model": "zen-72b"
  }
}
```

### Versioning

Flow definitions are versioned using an append-only snapshot model.

- Every save creates a new version. Versions are monotonically increasing integers.
- Each version stores the complete flow JSON (not a diff). This simplifies rollback at the cost of storage.
- The `GET /versions` endpoint returns version metadata (timestamp, author, description) without the full flow body.
- Rollback creates a new version whose content matches the target version. History is never rewritten.
- Diff is computed client-side by comparing two version snapshots. The UI highlights added/removed/modified nodes and edges.

### Template Marketplace

Pre-built flows for common patterns are available in the template marketplace.

| Template | Description | Components Used |
|----------|-------------|-----------------|
| **RAG Chatbot** | Conversational RAG with memory | TextInput, Embeddings, pgvector, RetrievalQA, ConversationBuffer |
| **Document Summarizer** | Summarize uploaded documents | FileInput, SummarizeChain, MapReduce, TextOutput |
| **Code Assistant** | Code generation with context | ChatInput, LLMGateway, PythonREPL, ChatOutput |
| **Classification Pipeline** | Classify text into categories | TextInput, LLMChain, JSONParser, WebhookOutput |
| **Multi-Agent Research** | Collaborative research agents | ChatInput, HanzoAgent, SearchTool, BrowserTool, ChatOutput |
| **Data Extraction** | Extract structured data from text | FileInput, LLMChain, PydanticParser, APITool |

### Code Export

Flows export to production-ready Python or TypeScript.

#### Python Export

```python
# Exported from Hanzo Flow: "Customer Support RAG"
# Version: 3 | Exported: 2025-07-01T14:30:00Z

from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_community.vectorstores import PGVector
from langchain.chains import RetrievalQA

# LLM via Hanzo Gateway
llm = ChatOpenAI(
    model="zen-72b",
    openai_api_base="https://llm.hanzo.ai",
    openai_api_key=os.environ["HANZO_API_KEY"],
    temperature=0.3,
    max_tokens=2048,
)

# Embeddings via Hanzo Gateway
embeddings = OpenAIEmbeddings(
    model="text-embedding-3-small",
    openai_api_base="https://llm.hanzo.ai",
    openai_api_key=os.environ["HANZO_API_KEY"],
)

# Vector store
vectorstore = PGVector(
    connection_string=os.environ["PG_VECTOR_URL"],
    collection_name="support_docs",
    embedding_function=embeddings,
)

# RAG chain
chain = RetrievalQA.from_chain_type(
    llm=llm,
    chain_type="stuff",
    retriever=vectorstore.as_retriever(search_kwargs={"k": 5}),
    return_source_documents=True,
)

def run(query: str) -> dict:
    return chain.invoke({"query": query})

if __name__ == "__main__":
    import sys
    result = run(sys.argv[1])
    print(result["result"])
```

#### TypeScript Export

```typescript
// Exported from Hanzo Flow: "Customer Support RAG"
// Version: 3 | Exported: 2025-07-01T14:30:00Z

import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { RetrievalQAChain } from "langchain/chains";

const llm = new ChatOpenAI({
  modelName: "zen-72b",
  configuration: { baseURL: "https://llm.hanzo.ai" },
  openAIApiKey: process.env.HANZO_API_KEY!,
  temperature: 0.3,
  maxTokens: 2048,
});

const embeddings = new OpenAIEmbeddings({
  modelName: "text-embedding-3-small",
  configuration: { baseURL: "https://llm.hanzo.ai" },
  openAIApiKey: process.env.HANZO_API_KEY!,
});

const vectorstore = await PGVectorStore.initialize(embeddings, {
  postgresConnectionOptions: { connectionString: process.env.PG_VECTOR_URL! },
  tableName: "support_docs",
});

const chain = RetrievalQAChain.fromLLM(llm, vectorstore.asRetriever({ k: 5 }));

export async function run(query: string): Promise<string> {
  const result = await chain.invoke({ query });
  return result.text;
}
```

## Implementation

### Architecture

```
                        ┌──────────────────────────────┐
                        │       flow.hanzo.ai           │
                        ├───────────────┬──────────────┤
                        │  React + RF   │  FastAPI     │
                        │  (Canvas UI)  │  (Backend)   │
                        ├───────────────┴──────────────┤
                        │  PostgreSQL  │  Redis        │
                        │  (flows,     │  (sessions,   │
                        │   versions)  │   job queue)  │
                        └──────┬───────┴──────┬────────┘
                               │              │
                ┌──────────────┴──┐    ┌──────┴──────────┐
                │  llm.hanzo.ai   │    │  hanzo.id       │
                │  (LLM Gateway)  │    │  (IAM / OAuth)  │
                └─────────────────┘    └─────────────────┘
```

### Production Deployment

- **URL**: `flow.hanzo.ai`
- **Cluster**: hanzo-k8s (`24.199.76.156`)
- **Namespace**: `hanzo`
- **Replicas**: 2 (backend), 1 (worker pool)
- **Resources**: 2 CPU / 4Gi RAM per backend replica, 4 CPU / 8Gi RAM per worker

### Frontend

- **Framework**: React 18 with TypeScript
- **Canvas**: React Flow (reactflow) for DAG visualization and editing
- **State**: Zustand for canvas state, React Query for API state
- **Styling**: Tailwind CSS with Hanzo design tokens
- **Build**: Vite, deployed as static assets behind CDN

### Backend

- **Framework**: FastAPI (Python 3.11+)
- **ORM**: SQLAlchemy 2.0 with async support
- **LangChain**: langchain 0.2+, langchain-community, langchain-openai
- **Task queue**: Celery with Redis broker for async flow execution
- **Streaming**: Server-Sent Events via Starlette StreamingResponse

### Database Schema

```sql
-- Flow definitions
CREATE TABLE flows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    org_id VARCHAR(128) NOT NULL,
    created_by UUID NOT NULL,
    is_public BOOLEAN DEFAULT FALSE,
    tags TEXT[],
    current_version INT DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Flow version snapshots
CREATE TABLE flow_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flow_id UUID REFERENCES flows(id) ON DELETE CASCADE,
    version INT NOT NULL,
    data JSONB NOT NULL,           -- Complete flow JSON
    description VARCHAR(500),
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (flow_id, version)
);

-- Execution history
CREATE TABLE flow_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flow_id UUID REFERENCES flows(id),
    flow_version INT NOT NULL,
    status VARCHAR(20) NOT NULL,    -- pending, running, completed, failed
    inputs JSONB,
    outputs JSONB,
    error JSONB,
    usage JSONB,                    -- token counts, cost
    duration_ms INT,
    session_id VARCHAR(128),
    executed_by UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Template marketplace
CREATE TABLE flow_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(64),
    data JSONB NOT NULL,
    author_id UUID NOT NULL,
    org_id VARCHAR(128),
    is_official BOOLEAN DEFAULT FALSE,
    install_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_flows_org ON flows(org_id);
CREATE INDEX idx_executions_flow ON flow_executions(flow_id, created_at DESC);
CREATE INDEX idx_templates_category ON flow_templates(category);
```

### Authentication

All API requests require a valid OAuth2 bearer token from Hanzo IAM (`hanzo.id`).

```python
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer

security = HTTPBearer()

async def get_current_user(token = Depends(security)):
    user = await iam_client.validate_token(token.credentials)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")
    return user

async def check_flow_access(flow_id: str, user = Depends(get_current_user)):
    flow = await get_flow(flow_id)
    if flow.org_id not in user.organizations:
        raise HTTPException(status_code=403, detail="Access denied")
    return flow
```

### Execution Workers

Long-running flows execute on dedicated Celery workers to avoid blocking the API.

```python
from celery import Celery

app = Celery("flow", broker=os.environ["REDIS_URL"])

@app.task(bind=True, max_retries=1, time_limit=300)
def execute_flow_task(self, flow_id: str, version: int, inputs: dict, user_id: str):
    """Execute a flow asynchronously on a worker."""
    flow = load_flow(flow_id, version)
    executor = DAGExecutor(
        billing_hook=CreditBillingHook(user_id=user_id),
        timeout=300,
    )
    result = asyncio.run(executor.execute(flow, inputs))
    store_execution_result(flow_id, version, inputs, result, user_id)
    return result.to_dict()
```

## Security

### Sandboxed Code Execution

Custom Python components (PythonREPL, custom nodes) execute in sandboxed environments.

- **Container isolation.** Each code execution runs in a short-lived container with no network access (except explicitly whitelisted endpoints), no filesystem writes outside `/tmp`, and resource limits (CPU: 1 core, RAM: 512Mi, timeout: 30s).
- **Import whitelist.** Only approved Python packages are importable. The whitelist includes LangChain, NumPy, Pandas, and standard library modules. `os`, `subprocess`, `socket`, and `ctypes` are blocked.
- **Output sanitization.** All outputs from sandboxed execution are serialized to JSON and size-limited (max 1MB per node output) before returning to the DAG engine.

### API Key Scoping

Each flow can be assigned a scoped API key for external invocation.

```json
{
  "key_id": "flow_key_xxxx",
  "flow_id": "flow-uuid",
  "permissions": ["execute"],
  "rate_limit": "100/hour",
  "ip_whitelist": ["203.0.113.0/24"],
  "expires_at": "2026-01-01T00:00:00Z"
}
```

- Keys are created via `POST /api/v1/flows/{flow_id}/keys`.
- Keys grant execute-only access to a single flow. They cannot read, modify, or delete the flow definition.
- Keys are stored hashed (bcrypt) in PostgreSQL. The plaintext key is returned only once at creation.

### Rate Limiting

Flow execution is rate-limited at three levels:

1. **Per-user**: 100 executions per hour (configurable per plan).
2. **Per-flow**: 1000 executions per hour (configurable per flow).
3. **Per-organization**: 10,000 executions per hour (configurable per org).

Rate limits are enforced in Redis using sliding window counters. When a limit is exceeded, the API returns `429 Too Many Requests` with a `Retry-After` header.

### Audit Logging

Every flow execution produces an immutable audit log entry.

```json
{
  "event": "flow.executed",
  "flow_id": "flow-uuid",
  "flow_version": 3,
  "user_id": "user-uuid",
  "org_id": "hanzo",
  "ip_address": "203.0.113.42",
  "status": "completed",
  "duration_ms": 2340,
  "tokens_used": 1847,
  "credits_charged": 0.0018,
  "timestamp": "2025-07-01T14:30:00Z"
}
```

Audit logs are:
- Written to a dedicated `flow_audit_log` table in PostgreSQL.
- Retained for 90 days (configurable per org).
- Queryable via `GET /api/v1/audit?flow_id=...&since=...&until=...`.
- Exportable in JSON Lines format for external SIEM integration.

### Secret Management

Flow definitions MUST NOT contain plaintext secrets. All secrets are referenced using `${secrets.KEY_NAME}` syntax and resolved at execution time from Hanzo KMS (HIP-27).

```json
{
  "type": "pgvector",
  "data": {
    "connection_string": "${secrets.PG_VECTOR_URL}"
  }
}
```

The execution engine resolves secrets by calling KMS with the user's IAM token. Secrets are injected into node configurations in memory and never persisted to the flow definition or execution logs.

## Interaction With Other HIPs

| HIP | Relationship |
|-----|--------------|
| HIP-1 (LLM Gateway) | All LLM calls route through the Gateway. Flow never calls providers directly. |
| HIP-9 (Agent SDK) | Flow can embed Agent SDK agents as nodes. Exported code can be deployed as Agent SDK components. |
| HIP-10 (MCP) | MCP tools appear as first-class Flow nodes via dynamic schema loading. |
| HIP-18 (Payments) | Credit billing hooks meter token usage and debit user balances. |
| HIP-26 (IAM) | OAuth2/OIDC authentication for all API access. Organization-scoped flow ownership. |
| HIP-27 (Secrets) | All secrets in flow definitions resolved from KMS at execution time. |
| HIP-34 (Auto) | Auto can trigger Flow executions as steps in business process automations. Flow does not replace Auto. |

## Implementation Roadmap

### Phase 1: Core Fork (Q1 2025)
- Fork Langflow, rebrand to Hanzo Flow
- Integrate LLM Gateway node (replace direct provider calls)
- Add IAM OAuth2 authentication
- Deploy to flow.hanzo.ai on hanzo-k8s

### Phase 2: Hanzo Components (Q2 2025)
- MCP Tool node with dynamic schema loading
- Zen Model Selector with pricing metadata
- Credit Billing Hook
- Secret resolution from KMS

### Phase 3: Production Features (Q3 2025)
- Flow versioning with diff/rollback
- Python and TypeScript code export
- Template marketplace with official templates
- Async execution with Celery workers

### Phase 4: Scale (Q4 2025)
- Collaborative editing (multi-user canvas)
- Custom component marketplace (user-published nodes)
- Flow analytics dashboard (execution metrics, cost tracking)
- Enterprise features (RBAC, SSO, audit export)

## References

1. [HIP-1: LLM Gateway Standard](./hip-0001-llm-gateway-provider-proxy-standard.md)
2. [HIP-9: Agent SDK](./hip-0009-agent-sdk-multi-agent-orchestration-framework.md)
3. [HIP-10: MCP Integration](./hip-0010-model-context-protocol-mcp-integration-standards.md)
4. [HIP-18: Payment Processing](./hip-0018-payment-processing-standard.md)
5. [HIP-26: Identity Access Management](./hip-0026-identity-access-management-standard.md)
6. [HIP-27: Secrets Management](./hip-0027-secrets-management-standard.md)
7. [Langflow](https://github.com/langflow-ai/langflow)
8. [LangChain](https://python.langchain.com/)
9. [React Flow](https://reactflow.dev/)
10. [Hanzo Flow Repository](https://github.com/hanzoai/flow)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
