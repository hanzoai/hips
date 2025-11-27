---
hip: 010
title: Model Context Protocol (MCP) Integration Standards
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2025-01-09
requires: HIP-2, HIP-9
---

# HIP-10: Model Context Protocol (MCP) Integration Standards

## Abstract

This proposal defines the Model Context Protocol (MCP) integration standards for the Hanzo ecosystem. MCP enables seamless tool use, context management, and extensibility for AI models through a standardized protocol for connecting models to external tools and data sources.

**Repository**: [github.com/hanzoai/mcp](https://github.com/hanzoai/mcp)  
**NPM**: `@hanzoai/mcp`  
**CLI**: `hanzo-mcp`

## Motivation

Current AI tool integration challenges:
1. **Fragmented Interfaces**: Each tool has different APIs
2. **Context Loss**: Tools don't share context effectively
3. **Limited Extensibility**: Hard to add new capabilities
4. **Poor Standardization**: No common protocol
5. **Security Gaps**: Insufficient sandboxing and permissions

MCP provides a unified protocol for AI-tool interaction.

## Specification

### Protocol Overview

```yaml
MCP Architecture:
  Transport Layer:
    - JSON-RPC 2.0
    - WebSocket/HTTP
    - Bidirectional communication
    
  Session Management:
    - Persistent connections
    - Context preservation
    - State synchronization
    
  Tool Registry:
    - Dynamic discovery
    - Capability negotiation
    - Version management
    
  Security:
    - Permission system
    - Sandboxed execution
    - Audit logging
```

### Core MCP Messages

```typescript
// Tool Registration
interface ToolRegistration {
  jsonrpc: "2.0";
  method: "tools/register";
  params: {
    name: string;
    description: string;
    input_schema: JSONSchema;
    output_schema: JSONSchema;
    permissions: Permission[];
  };
}

// Tool Execution
interface ToolExecution {
  jsonrpc: "2.0";
  method: "tools/execute";
  params: {
    tool: string;
    arguments: any;
    context?: Context;
  };
}

// Context Update
interface ContextUpdate {
  jsonrpc: "2.0";
  method: "context/update";
  params: {
    entries: ContextEntry[];
    merge_strategy: "replace" | "merge" | "append";
  };
}
```

### Tool Definition Standard

```yaml
# Tool manifest (mcp-tool.yaml)
name: web_search
version: 1.0.0
description: Search the web for information

input:
  type: object
  properties:
    query:
      type: string
      description: Search query
    max_results:
      type: integer
      default: 10
  required: [query]

output:
  type: object
  properties:
    results:
      type: array
      items:
        type: object
        properties:
          title: string
          url: string
          snippet: string

permissions:
  - network:http
  - rate_limit:100/min

implementation:
  runtime: node
  handler: ./search.js
  timeout: 30000
```

### Hanzo MCP Server

```python
class HanzoMCPServer:
    """
    MCP server implementation for Hanzo
    """
    def __init__(self):
        self.tools = {}
        self.contexts = {}
        self.sessions = {}
        
    async def handle_request(self, request):
        """Route JSON-RPC requests"""
        if request.method == "tools/list":
            return self.list_tools()
        elif request.method == "tools/execute":
            return await self.execute_tool(request.params)
        elif request.method == "context/get":
            return self.get_context(request.params)
        elif request.method == "context/update":
            return self.update_context(request.params)
            
    async def execute_tool(self, params):
        """Execute tool with sandboxing"""
        tool = self.tools[params.tool]
        
        # Validate permissions
        if not self.check_permissions(tool, params.session_id):
            raise PermissionError(f"Tool {tool.name} not authorized")
            
        # Sandbox execution
        sandbox = ToolSandbox(
            memory_limit="512MB",
            cpu_limit="1 core",
            timeout=tool.timeout
        )
        
        result = await sandbox.execute(
            tool.handler,
            params.arguments,
            context=self.contexts[params.session_id]
        )
        
        return result
```

### Built-in Tools

```yaml
Core Tools:
  filesystem:
    - read_file
    - write_file
    - list_directory
    - create_directory
    
  network:
    - http_request
    - websocket_connect
    - dns_lookup
    
  database:
    - sql_query
    - redis_get/set
    - mongodb_find
    
  compute:
    - execute_code
    - run_notebook
    - shell_command
    
  ai:
    - call_model
    - generate_embedding
    - semantic_search
```

### Tool Implementation Examples

#### Web Search Tool
```javascript
// search.js
export default async function search({ query, max_results = 10 }) {
  // Use Hanzo search service
  const response = await fetch('https://api.hanzo.ai/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.HANZO_API_KEY}`
    },
    body: JSON.stringify({ query, limit: max_results })
  });
  
  const data = await response.json();
  
  return {
    results: data.results.map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet
    }))
  };
}
```

#### Code Execution Tool
```python
# code_executor.py
import subprocess
import tempfile
import os

async def execute_code(language: str, code: str, timeout: int = 30):
    """Execute code in sandboxed environment"""
    
    # Create temporary file
    with tempfile.NamedTemporaryFile(
        mode='w',
        suffix=_get_extension(language),
        delete=False
    ) as f:
        f.write(code)
        temp_file = f.name
    
    try:
        # Execute based on language
        if language == "python":
            result = subprocess.run(
                ["python", temp_file],
                capture_output=True,
                text=True,
                timeout=timeout
            )
        elif language == "javascript":
            result = subprocess.run(
                ["node", temp_file],
                capture_output=True,
                text=True,
                timeout=timeout
            )
        else:
            raise ValueError(f"Unsupported language: {language}")
            
        return {
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode
        }
    finally:
        os.unlink(temp_file)
```

### Context Management

```python
class MCPContext:
    """
    Manages context across tool executions
    """
    def __init__(self):
        self.entries = {}
        self.history = []
        self.metadata = {}
        
    def add_entry(self, key: str, value: Any, type: str = "text"):
        """Add context entry"""
        entry = ContextEntry(
            key=key,
            value=value,
            type=type,
            timestamp=time.time()
        )
        self.entries[key] = entry
        self.history.append(entry)
        
    def get_relevant_context(self, query: str, max_entries: int = 10):
        """Retrieve relevant context for query"""
        # Semantic search through context
        embeddings = self.generate_embeddings([query] + [e.value for e in self.entries.values()])
        
        similarities = cosine_similarity(embeddings[0], embeddings[1:])
        top_indices = np.argsort(similarities)[-max_entries:]
        
        return [list(self.entries.values())[i] for i in top_indices]
```

### Claude Desktop Integration

```json
// Claude Desktop config (~/.claude/config.json)
{
  "mcpServers": {
    "hanzo": {
      "command": "hanzo-mcp",
      "args": ["serve"],
      "env": {
        "HANZO_API_KEY": "sk-hanzo-..."
      }
    }
  }
}
```

### Security Model

```python
class MCPSecurity:
    """
    Security layer for MCP
    """
    def __init__(self):
        self.permissions = PermissionManager()
        self.sandbox = Sandbox()
        self.audit = AuditLogger()
        
    def check_permission(self, tool: str, action: str, session: Session):
        """Check if action is permitted"""
        # Default deny
        if not session.authenticated:
            return False
            
        # Check tool permissions
        tool_perms = self.permissions.get_tool_permissions(tool)
        if action not in tool_perms:
            return False
            
        # Check user permissions
        user_perms = self.permissions.get_user_permissions(session.user_id)
        if not user_perms.can_execute(tool, action):
            return False
            
        # Log for audit
        self.audit.log(session.user_id, tool, action)
        
        return True
```

### Performance Optimization

```yaml
Caching:
  Tool Results:
    - Cache deterministic tool outputs
    - TTL based on tool type
    - Invalidation on context change
    
  Context:
    - In-memory context cache
    - Persistent context storage
    - Lazy loading of large contexts
    
Connection Pooling:
  - Reuse WebSocket connections
  - Connection multiplexing
  - Automatic reconnection
  
Batching:
  - Batch multiple tool calls
  - Parallel execution when possible
  - Result aggregation
```

### SDK Usage

#### Python SDK
```python
from hanzoai.mcp import MCPClient, Tool

# Initialize client
client = MCPClient("ws://localhost:3000/mcp")

# Register custom tool
@client.tool(
    name="calculator",
    description="Perform calculations"
)
async def calculator(expression: str) -> float:
    return eval(expression)  # Simplified example

# Use in agent
result = await client.execute_tool(
    "web_search",
    {"query": "Hanzo AI"}
)
```

#### TypeScript SDK
```typescript
import { MCPClient, Tool } from '@hanzoai/mcp';

// Initialize client
const client = new MCPClient('ws://localhost:3000/mcp');

// Register tool
client.registerTool({
  name: 'calculator',
  description: 'Perform calculations',
  handler: async (expression: string) => {
    return eval(expression); // Simplified
  }
});

// Execute tool
const result = await client.executeTool('web_search', {
  query: 'Hanzo AI'
});
```

## Implementation Roadmap

### Phase 1: Core Protocol (Q1 2025)
- JSON-RPC implementation
- Basic tool registry
- Simple context management
- Claude Desktop integration

### Phase 2: Standard Tools (Q2 2025)
- File system tools
- Network tools
- Database tools
- AI tools

### Phase 3: Advanced Features (Q3 2025)
- Tool composition
- Context optimization
- Performance caching
- Security hardening

### Phase 4: Ecosystem (Q4 2025)
- Tool marketplace
- Community tools
- Enterprise features
- Edge deployment

## Security Considerations

### Tool Security
- Sandboxed execution environment
- Resource limits (CPU, memory, network)
- Permission-based access control
- Input validation and sanitization

### Protocol Security
- TLS for transport encryption
- Message authentication
- Rate limiting
- Audit logging

## References

1. [Model Context Protocol Spec](https://modelcontextprotocol.io)
2. [JSON-RPC 2.0](https://www.jsonrpc.org/specification)
3. [Claude Desktop MCP](https://claude.ai/docs/mcp)
4. [HIP-9: Agent SDK](./hip-9.md)
5. [MCP Repository](https://github.com/hanzoai/mcp)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).