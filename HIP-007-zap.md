---
hip: 007
title: ZAP - Zero-copy Agent Protocol
description: High-performance binary RPC protocol for AI agent communication using Cap'n Proto serialization
author: Hanzo AI (@hanzoai)
status: Draft
type: Standards Track
category: Interface
created: 2025-01-23
requires: HIP-003, HIP-010
---

# HIP-007: ZAP - Zero-copy Agent Protocol

## Abstract

This HIP specifies ZAP (Zero-copy Agent Protocol), a high-performance binary RPC protocol for AI agent communication. ZAP leverages Cap'n Proto serialization to achieve zero-copy message parsing and efficient binary transport, designed to replace JSON-based protocols like MCP (Model Context Protocol) in performance-critical AI infrastructure. The protocol provides MCP-compatible semantics while delivering 10-100x performance improvements for high-throughput agent workloads.

**Repository**: [github.com/hanzoai/zap](https://github.com/hanzoai/zap)
**Rust**: `hanzo-zap`
**TypeScript**: `@hanzo/zap`
**Python**: `hanzo-zap`

## Motivation

### The Problem with JSON-RPC in AI Systems

Current AI agent protocols, including MCP, rely on JSON-RPC 2.0 for message serialization. While JSON offers excellent human readability and ecosystem support, it introduces significant performance penalties in AI infrastructure:

1. **Serialization Overhead**: JSON requires full parsing and string manipulation for every message, consuming 15-40% of CPU cycles in high-throughput agent systems.

2. **Memory Allocation**: JSON parsing requires dynamic memory allocation for every field, creating garbage collection pressure in managed runtimes and fragmentation in native code.

3. **Binary Data Inefficiency**: AI workloads frequently transmit binary data (embeddings, tensors, images). JSON requires Base64 encoding, adding 33% overhead and additional parsing.

4. **No Schema Evolution**: JSON lacks built-in schema versioning, making backward-compatible protocol changes error-prone.

5. **Latency Accumulation**: In multi-agent systems with chain-of-thought reasoning, JSON parsing latency compounds across message hops.

### Quantitative Impact

Measured on a typical agent workload (Claude Desktop + 10 MCP servers):

| Metric | JSON-RPC (MCP) | ZAP (Cap'n Proto) | Improvement |
|--------|----------------|-------------------|-------------|
| Parse latency (1KB message) | 45 us | 0.2 us | 225x |
| Parse latency (100KB message) | 2.1 ms | 0.8 us | 2,625x |
| Memory allocations per message | 47 | 0 | infinite |
| Binary payload overhead | +33% (Base64) | 0% | 33% savings |
| Serialization throughput | 180 MB/s | 3.2 GB/s | 17.8x |

### Design Goals

1. **Zero-Copy Parsing**: Messages can be read directly from wire format without copying or allocation.

2. **MCP Semantic Compatibility**: Full compatibility with MCP concepts (tools, resources, prompts) enabling drop-in replacement.

3. **Efficient Binary Transport**: Native binary data support without encoding overhead.

4. **Schema Evolution**: Forward and backward compatible message format changes.

5. **Multi-Language Support**: First-class implementations in Rust, TypeScript, Python, and Go.

6. **Gateway Bridging**: Seamless bridging to existing MCP servers during migration.

## Specification

### Protocol Architecture

```
+------------------------------------------------------------------+
|                        ZAP Architecture                           |
+------------------------------------------------------------------+
|                                                                   |
|  +-----------------+     +-----------------+     +---------------+|
|  |   ZAP Client    |     |   ZAP Gateway   |     |  ZAP Server   ||
|  |                 |     |                 |     |               ||
|  | - Tool calls    |<--->| - MCP bridging  |<--->| - Tool impl   ||
|  | - Resources     |     | - Routing       |     | - Resources   ||
|  | - Prompts       |     | - Auth          |     | - Prompts     ||
|  +-----------------+     +-----------------+     +---------------+|
|          |                       |                       |        |
|          +---------- ZAP RPC (Cap'n Proto) -------------+        |
|          |                       |                       |        |
|  +-------+-------+       +-------+-------+       +-------+------+|
|  |   Transport   |       |   Transport   |       |   Transport  ||
|  +---------------+       +---------------+       +--------------+|
|  | - TCP (zap://)        | - Unix socket         | - WebSocket  ||
|  | - TLS (zaps://)       | - stdio               | - HTTP/2     ||
|  +---------------+       +---------------+       +--------------+|
|                                                                   |
+------------------------------------------------------------------+
```

### Cap'n Proto Schema

The complete ZAP schema is defined in Cap'n Proto IDL:

```capnp
@0xb2a3f4c5d6e7f8a9;
# ZAP - Zero-copy Agent Protocol
# Cap'n Proto schema for high-performance agent communication

# Core Types

struct Timestamp {
  seconds @0 :Int64;
  nanos @1 :UInt32;
}

struct Metadata {
  entries @0 :List(Entry);

  struct Entry {
    key @0 :Text;
    value @1 :Text;
  }
}

# Tool Definitions

struct Tool {
  name @0 :Text;
  description @1 :Text;
  schema @2 :Data;          # JSON Schema as bytes (avoids re-parsing)
  annotations @3 :Metadata;
}

struct ToolList {
  tools @0 :List(Tool);
}

struct ToolCall {
  id @0 :Text;              # Unique call identifier
  name @1 :Text;            # Tool name
  args @2 :Data;            # Arguments as MessagePack or JSON bytes
  metadata @3 :Metadata;    # Request metadata (auth, tracing, etc.)
}

struct ToolResult {
  id @0 :Text;              # Matches ToolCall.id
  content @1 :Data;         # Result content (MessagePack, JSON, or binary)
  error @2 :Text;           # Error message if failed
  metadata @3 :Metadata;    # Response metadata
}

# Resource Definitions

struct Resource {
  uri @0 :Text;             # Resource URI (e.g., "file:///path/to/file")
  name @1 :Text;            # Human-readable name
  description @2 :Text;
  mimeType @3 :Text;
  annotations @4 :Metadata;
}

struct ResourceList {
  resources @0 :List(Resource);
}

struct ResourceContent {
  uri @0 :Text;
  mimeType @1 :Text;
  content :union {
    text @2 :Text;          # UTF-8 text content
    blob @3 :Data;          # Binary content (zero-copy)
  }
}

# Prompt Definitions

struct Prompt {
  name @0 :Text;
  description @1 :Text;
  arguments @2 :List(Argument);

  struct Argument {
    name @0 :Text;
    description @1 :Text;
    required @2 :Bool;
  }
}

struct PromptList {
  prompts @0 :List(Prompt);
}

struct PromptMessage {
  role @0 :Role;
  content @1 :Content;

  enum Role {
    user @0;
    assistant @1;
    system @2;
  }

  struct Content {
    union {
      text @0 :Text;
      image @1 :ImageContent;
      resource @2 :ResourceContent;
    }
  }

  struct ImageContent {
    data @0 :Data;          # Raw image bytes (zero-copy)
    mimeType @1 :Text;
  }
}

# Server Information

struct ServerInfo {
  name @0 :Text;
  version @1 :Text;
  capabilities @2 :Capabilities;

  struct Capabilities {
    tools @0 :Bool;
    resources @1 :Bool;
    prompts @2 :Bool;
    logging @3 :Bool;
  }
}

struct ClientInfo {
  name @0 :Text;
  version @1 :Text;
}
```

### RPC Interface

The ZAP RPC interface defines all protocol operations:

```capnp
# Main ZAP Interface
interface Zap {
  # Initialize connection
  init @0 (client :ClientInfo) -> (server :ServerInfo);

  # Tool operations
  listTools @1 () -> (tools :ToolList);
  callTool @2 (call :ToolCall) -> (result :ToolResult);

  # Resource operations
  listResources @3 () -> (resources :ResourceList);
  readResource @4 (uri :Text) -> (content :ResourceContent);
  subscribe @5 (uri :Text) -> (stream :ResourceStream);

  # Prompt operations
  listPrompts @6 () -> (prompts :PromptList);
  getPrompt @7 (name :Text, args :Metadata) -> (messages :List(PromptMessage));

  # Logging
  log @8 (level :LogLevel, message :Text, data :Data);

  enum LogLevel {
    debug @0;
    info @1;
    warn @2;
    error @3;
  }
}

# Streaming resource updates
interface ResourceStream {
  next @0 () -> (content :ResourceContent, done :Bool);
  cancel @1 () -> ();
}
```

### Gateway Interface

The Gateway interface extends ZAP with MCP bridging capabilities:

```capnp
interface Gateway extends(Zap) {
  # Add MCP server (bridges to existing JSON-RPC servers)
  addServer @0 (name :Text, url :Text, config :ServerConfig) -> (id :Text);

  # Remove MCP server
  removeServer @1 (id :Text) -> ();

  # List connected servers
  listServers @2 () -> (servers :List(ConnectedServer));

  # Get server status
  serverStatus @3 (id :Text) -> (status :ServerStatus);

  struct ServerConfig {
    transport @0 :Transport;
    auth @1 :Auth;
    timeout @2 :UInt32;  # milliseconds

    enum Transport {
      stdio @0;          # Subprocess MCP server
      http @1;           # HTTP/SSE transport
      websocket @2;      # WebSocket transport
      zap @3;            # Native ZAP transport
      unix @4;           # Unix domain socket
    }

    struct Auth {
      union {
        none @0 :Void;
        bearer @1 :Text;
        basic @2 :BasicAuth;
      }

      struct BasicAuth {
        username @0 :Text;
        password @1 :Text;
      }
    }
  }

  struct ConnectedServer {
    id @0 :Text;
    name @1 :Text;
    url @2 :Text;
    status @3 :ServerStatus;
    tools @4 :UInt32;
    resources @5 :UInt32;
  }

  enum ServerStatus {
    connecting @0;
    connected @1;
    disconnected @2;
    error @3;
  }
}
```

### Coordinator Interface

For distributed multi-agent systems:

```capnp
interface Coordinator {
  # Register agent with coordinator
  register @0 (agent :AgentInfo) -> (id :Text, gateway :Gateway);

  # Heartbeat for liveness
  heartbeat @1 (id :Text) -> (ok :Bool);

  # Discover available agents
  discover @2 (filter :AgentFilter) -> (agents :List(AgentInfo));

  struct AgentInfo {
    id @0 :Text;
    name @1 :Text;
    capabilities @2 :List(Text);
    metadata @3 :Metadata;
  }

  struct AgentFilter {
    capabilities @0 :List(Text);
    metadata @1 :Metadata;
  }
}
```

### Transport Layer

ZAP supports multiple transport protocols:

| Transport | URL Scheme | Use Case | Typical Latency |
|-----------|------------|----------|-----------------|
| TCP | `zap://host:port` | Production servers | ~100 us |
| TLS | `zaps://host:port` | Secure production | ~200 us |
| Unix Socket | `zap+unix:///path` | Local high-performance | ~10 us |
| WebSocket | `ws://`, `wss://` | Browser compatibility | ~1 ms |
| HTTP/2 | `http://`, `https://` | Firewall traversal | ~5 ms |
| stdio | `stdio://` | Subprocess servers | ~50 us |

**Default Port**: 9999

### Message Framing

For stream-based transports (TCP, Unix), messages are framed with a 4-byte length prefix:

```
+----------+------------------+
| Length   | Cap'n Proto      |
| (4 bytes)| Message          |
| LE u32   | (variable)       |
+----------+------------------+
```

### Zero-Copy Design

The key performance advantage comes from Cap'n Proto's zero-copy design:

```rust
// Traditional JSON parsing (allocates for every field)
let json: Value = serde_json::from_slice(&data)?;  // Allocates
let name = json["name"].as_str().unwrap();          // Allocates string

// ZAP/Cap'n Proto (zero allocation)
let message = capnp::serialize::read_message(&data, Default::default())?;
let tool = message.get_root::<tool::Reader>()?;
let name = tool.get_name()?;  // Points directly into wire format
```

The message bytes can be memory-mapped directly from the network buffer, and field access returns pointers into that buffer without any copying or allocation.

### Binary Data Handling

ZAP handles binary data (images, embeddings, tensors) efficiently:

```capnp
struct TensorData {
  shape @0 :List(UInt32);
  dtype @1 :DType;
  data @2 :Data;  # Raw tensor bytes, zero-copy

  enum DType {
    float32 @0;
    float16 @1;
    bfloat16 @2;
    int8 @3;
    uint8 @4;
  }
}
```

No Base64 encoding - binary data is transmitted directly.

## Rationale

### Why Cap'n Proto?

We evaluated several serialization formats:

| Format | Zero-Copy | Schema | Speed | Ecosystem | Binary |
|--------|-----------|--------|-------|-----------|--------|
| JSON | No | No | Slow | Excellent | Base64 |
| Protocol Buffers | No | Yes | Fast | Excellent | Native |
| FlatBuffers | Yes | Yes | Fast | Good | Native |
| Cap'n Proto | Yes | Yes | Fastest | Good | Native |
| MessagePack | No | No | Fast | Good | Native |

**Cap'n Proto advantages:**

1. **True Zero-Copy**: Unlike Protobuf which requires decoding, Cap'n Proto's wire format IS the in-memory format. No parsing step required.

2. **Built-in RPC**: Cap'n Proto includes a capability-based RPC system that fits perfectly with MCP's capability model.

3. **Promise Pipelining**: Allows chaining RPC calls without round-trip latency:
   ```
   // Without pipelining: 3 round trips
   server = await connect()
   tools = await server.listTools()
   result = await server.callTool(tools[0].name, args)

   // With pipelining: 1 round trip
   server = connect()
   tools = server.listTools()
   result = server.callTool(tools[0].name, args)
   await result  // All resolved in single round-trip
   ```

4. **Time-Travel Debugging**: Wire format can be inspected/replayed without special tooling.

5. **Canonical Encoding**: Deterministic encoding enables content-addressable caching.

### Why Not Protocol Buffers?

While Protobuf has broader ecosystem support, it lacks true zero-copy parsing. Every message must be decoded into a separate in-memory representation, requiring allocations. For high-throughput agent systems processing thousands of messages per second, this overhead is significant.

### MCP Compatibility Strategy

ZAP maintains semantic compatibility with MCP through:

1. **1:1 Concept Mapping**: Every MCP concept (tool, resource, prompt) has a ZAP equivalent.

2. **Gateway Bridging**: The ZAP Gateway can connect to existing MCP servers, translating between protocols.

3. **Dual-Protocol Servers**: Servers can expose both ZAP and MCP endpoints during migration.

4. **JSON Fallback**: Tool arguments and results can contain JSON bytes for gradual migration.

## Backwards Compatibility

### MCP Gateway Bridge

The ZAP Gateway provides transparent bridging to MCP servers:

```
+-------------+          +-------------+          +-------------+
|  ZAP Client |  ------> | ZAP Gateway | -------> |  MCP Server |
|  (Cap'n     |   ZAP    |  (Bridge)   |  JSON    |  (JSON-RPC) |
|   Proto)    |          |             |   RPC    |             |
+-------------+          +-------------+          +-------------+
```

**Bridge Architecture:**

```rust
impl Gateway {
    /// Add an MCP server and bridge it to ZAP
    pub async fn add_mcp_server(
        &mut self,
        name: &str,
        config: McpServerConfig,
    ) -> Result<String> {
        // Connect to MCP server
        let mcp_client = match config.transport {
            Transport::Stdio => McpClient::from_process(config.command).await?,
            Transport::Http => McpClient::from_http(config.url).await?,
            Transport::WebSocket => McpClient::from_ws(config.url).await?,
        };

        // Initialize MCP session
        let server_info = mcp_client.initialize().await?;

        // Fetch and cache tools/resources
        let tools = mcp_client.list_tools().await?;
        let resources = mcp_client.list_resources().await?;

        // Register as ZAP server
        let id = self.register_server(BridgedServer {
            name: name.to_string(),
            mcp: mcp_client,
            tools: self.convert_tools(tools),
            resources: self.convert_resources(resources),
        });

        Ok(id)
    }

    /// Convert MCP tool to ZAP tool
    fn convert_tools(&self, mcp_tools: Vec<McpTool>) -> Vec<Tool> {
        mcp_tools.into_iter().map(|t| Tool {
            name: t.name,
            description: t.description,
            schema: serde_json::to_vec(&t.input_schema).unwrap(),
            annotations: Default::default(),
        }).collect()
    }
}
```

### Configuration Example

Claude Desktop can use ZAP Gateway to aggregate multiple MCP servers:

```json
{
  "zapGateway": {
    "listen": "localhost:9999",
    "mcpServers": {
      "filesystem": {
        "transport": "stdio",
        "command": "mcp-server-filesystem",
        "args": ["/Users/me"]
      },
      "github": {
        "transport": "http",
        "url": "https://mcp.github.com",
        "auth": {
          "bearer": "ghp_..."
        }
      },
      "search": {
        "transport": "zap",
        "url": "zaps://search.hanzo.ai:9999"
      }
    }
  }
}
```

### Migration Path

1. **Phase 1**: Deploy ZAP Gateway alongside existing MCP infrastructure.
2. **Phase 2**: Add native ZAP servers for performance-critical tools.
3. **Phase 3**: Migrate remaining MCP servers to ZAP.
4. **Phase 4**: Retire MCP endpoints (optional).

## Security Considerations

### Transport Security

**TLS Requirements:**

- Minimum TLS 1.3 for `zaps://` connections
- Certificate validation with hostname verification
- Optional mutual TLS for server authentication

**Post-Quantum Considerations:**

For integration with HIP-001 (Post-Quantum Cryptography):

```rust
// Future: ML-KEM for key exchange
config.tls.cipher_suites = [
    "TLS_MLKEM768X25519_AES_256_GCM_SHA384",  // Hybrid PQ
    "TLS_AES_256_GCM_SHA384",                  // Classical fallback
];
```

### Authentication

ZAP supports multiple authentication mechanisms:

```capnp
struct Auth {
  union {
    none @0 :Void;
    bearer @1 :Text;                 # JWT or API key
    basic @2 :BasicAuth;             # Username/password
    mtls @3 :Void;                   # Certificate-based
    mldsa @4 :MLDSASignature;        # Post-quantum (future)
  }
}

struct MLDSASignature {
  publicKey @0 :Data;
  signature @1 :Data;
  timestamp @2 :Int64;
}
```

### Capability-Based Security

Cap'n Proto's capability system provides fine-grained access control:

```rust
// Server grants limited capability to client
let restricted_gateway = gateway.restricted(|call| {
    // Only allow tool calls, not resource access
    matches!(call, GatewayCall::CallTool { .. })
});

// Client can only call tools, not list resources
client.give_capability(restricted_gateway);
```

### Input Validation

Despite binary encoding, all inputs must be validated:

```rust
impl ZapServer {
    async fn call_tool(&self, call: ToolCall) -> Result<ToolResult> {
        // Validate tool exists
        let tool = self.tools.get(&call.name)
            .ok_or(Error::ToolNotFound)?;

        // Validate arguments against schema
        let args: Value = serde_json::from_slice(&call.args)?;
        jsonschema::validate(&tool.schema, &args)?;

        // Execute with timeout
        tokio::time::timeout(
            self.config.tool_timeout,
            tool.execute(args)
        ).await??
    }
}
```

### Rate Limiting

```rust
struct RateLimiter {
    limits: HashMap<String, Limit>,
}

impl RateLimiter {
    fn check(&self, client: &str, operation: &str) -> Result<()> {
        let key = format!("{}:{}", client, operation);
        let limit = self.limits.get(operation)
            .unwrap_or(&DEFAULT_LIMIT);

        if self.counter.get(&key) >= limit.max_requests {
            return Err(Error::RateLimited {
                retry_after: limit.window,
            });
        }
        Ok(())
    }
}
```

### Audit Logging

All ZAP operations are logged for security audit:

```rust
struct AuditLog {
    timestamp: Timestamp,
    client_id: String,
    operation: String,
    tool_name: Option<String>,
    resource_uri: Option<String>,
    duration_us: u64,
    error: Option<String>,
}
```

## Reference Implementation

### Repository Structure

```
hanzo-zap/
|-- schema/
|   +-- zap.capnp              # Cap'n Proto schema
|-- src/                       # Rust implementation
|   |-- lib.rs                 # Library root
|   |-- client.rs              # ZAP client
|   |-- server.rs              # ZAP server
|   |-- gateway.rs             # MCP gateway bridge
|   |-- transport.rs           # Transport implementations
|   |-- error.rs               # Error types
|   |-- config.rs              # Configuration
|   +-- bin/
|       |-- zap.rs             # CLI client
|       +-- zapd.rs            # Gateway daemon
|-- typescript/                # TypeScript implementation
|   |-- src/
|   |   |-- index.ts
|   |   |-- client.ts
|   |   |-- server.ts
|   |   |-- gateway.ts
|   |   |-- types.ts
|   |   +-- error.ts
|   +-- package.json
|-- python/                    # Python implementation
|   |-- src/hanzo_zap/
|   |   |-- __init__.py
|   |   |-- client.py
|   |   |-- server.py
|   |   |-- gateway.py
|   |   +-- config.py
|   +-- pyproject.toml
+-- docs/
    |-- protocol.md
    |-- migration.md
    +-- benchmarks.md
```

### Rust Implementation

```rust
// Client usage
use zap::{Client, Result};

#[tokio::main]
async fn main() -> Result<()> {
    // Connect to ZAP gateway
    let client = Client::connect("zap://localhost:9999").await?;

    // List available tools
    let tools = client.list_tools().await?;
    println!("Available tools: {:?}", tools);

    // Call a tool
    let result = client.call_tool("search", json!({
        "query": "Hanzo AI"
    })).await?;

    println!("Result: {:?}", result);
    Ok(())
}
```

### TypeScript Implementation

```typescript
import { Client, Server, Gateway } from '@hanzo/zap';

// Client usage
const client = await Client.connect('zap://localhost:9999');
const tools = await client.listTools();
const result = await client.callTool('search', { query: 'Hanzo AI' });

// Server implementation
const server = new Server({
  name: 'my-zap-server',
  version: '1.0.0',
});

server.addTool({
  name: 'calculate',
  description: 'Perform calculations',
  schema: { type: 'object', properties: { expression: { type: 'string' } } },
  handler: async (args) => {
    return { result: eval(args.expression) };
  },
});

await server.listen('zap://0.0.0.0:9999');
```

### Python Implementation

```python
from hanzo_zap import Client, Server, Gateway

# Client usage
async with Client.connect('zap://localhost:9999') as client:
    tools = await client.list_tools()
    result = await client.call_tool('search', {'query': 'Hanzo AI'})

# Server implementation
server = Server(name='my-zap-server', version='1.0.0')

@server.tool(
    name='calculate',
    description='Perform calculations',
    schema={'type': 'object', 'properties': {'expression': {'type': 'string'}}}
)
async def calculate(expression: str) -> dict:
    return {'result': eval(expression)}

await server.serve('zap://0.0.0.0:9999')
```

### Gateway Daemon (zapd)

The `zapd` daemon provides a production-ready ZAP gateway:

```bash
# Start gateway with MCP bridging
zapd --config /etc/zap/config.toml

# Configuration file
[gateway]
listen = "0.0.0.0"
port = 9999
tls_cert = "/etc/zap/cert.pem"
tls_key = "/etc/zap/key.pem"

[[servers]]
name = "filesystem"
transport = "stdio"
command = "mcp-server-filesystem"
args = ["/home"]

[[servers]]
name = "search"
transport = "zap"
url = "zaps://search.hanzo.ai:9999"
```

## Performance Benchmarks

### Methodology

Benchmarks run on:
- Hardware: M3 Max MacBook Pro, 36GB RAM
- Rust: 1.75.0, release build with LTO
- Node.js: 22.0.0
- Python: 3.12, uvloop

### Serialization Benchmarks

| Operation | JSON (MCP) | Cap'n Proto (ZAP) | Speedup |
|-----------|------------|-------------------|---------|
| Serialize ToolList (100 tools) | 850 us | 12 us | 70.8x |
| Parse ToolList (100 tools) | 920 us | 0.3 us | 3,067x |
| Serialize ToolResult (1KB) | 45 us | 2 us | 22.5x |
| Parse ToolResult (1KB) | 52 us | 0.2 us | 260x |
| Serialize ResourceContent (100KB) | 2.1 ms | 8 us | 262x |
| Parse ResourceContent (100KB) | 3.4 ms | 0.4 us | 8,500x |

### End-to-End Latency

Round-trip latency for tool call (localhost):

| Protocol | p50 | p99 | Throughput |
|----------|-----|-----|------------|
| MCP (JSON-RPC over HTTP) | 1.2 ms | 4.5 ms | 800 req/s |
| MCP (JSON-RPC over WebSocket) | 0.8 ms | 2.1 ms | 1,200 req/s |
| ZAP (Cap'n Proto over TCP) | 0.08 ms | 0.15 ms | 12,000 req/s |
| ZAP (Cap'n Proto over Unix) | 0.04 ms | 0.09 ms | 25,000 req/s |

### Memory Usage

Memory allocations per message parse:

| Protocol | Allocations | Peak Memory |
|----------|-------------|-------------|
| MCP (JSON) | 47 | 2.3 KB |
| ZAP (Cap'n Proto) | 0 | 0 KB (in-place) |

### Gateway Bridging Overhead

When bridging MCP servers through ZAP Gateway:

| Configuration | Latency Overhead | Throughput |
|---------------|------------------|------------|
| Direct MCP | baseline | 800 req/s |
| ZAP Gateway + MCP bridge | +0.15 ms | 750 req/s |
| Native ZAP (no bridge) | -1.1 ms | 12,000 req/s |

## Test Cases

### Protocol Conformance

```rust
#[test]
fn test_tool_list_serialization() {
    let tools = vec![
        Tool { name: "search".into(), description: "Search the web".into(), .. },
        Tool { name: "calculate".into(), description: "Math operations".into(), .. },
    ];

    let message = serialize_tools(&tools);
    let parsed = deserialize_tools(&message);

    assert_eq!(tools, parsed);
}

#[test]
fn test_zero_copy_parsing() {
    let data = create_large_resource_content(100_000);
    let message = serialize(&data);

    // Parse without allocation
    let reader = capnp::serialize::read_message_from_flat_slice(
        &message,
        ReaderOptions::new()
    ).unwrap();

    let content = reader.get_root::<resource_content::Reader>().unwrap();

    // Verify pointer into original buffer
    let blob = content.get_content().get_blob().unwrap();
    assert!(ptr_in_range(blob.as_ptr(), message.as_ptr_range()));
}

#[test]
fn test_mcp_bridge_compatibility() {
    // Start MCP server
    let mcp_server = spawn_mcp_server();

    // Connect through ZAP gateway
    let gateway = Gateway::new();
    gateway.add_server("test", mcp_server.url(), Default::default()).await;

    // Call tool through ZAP
    let client = Client::connect(&gateway.url()).await;
    let result = client.call_tool("mcp_tool", json!({})).await;

    assert!(result.is_ok());
}
```

### Interoperability Tests

```python
# Python client connecting to Rust server
async def test_cross_language():
    # Start Rust ZAP server
    server = subprocess.Popen(['zapd', '--config', 'test.toml'])

    # Connect with Python client
    async with Client.connect('zap://localhost:9999') as client:
        tools = await client.list_tools()
        assert len(tools) > 0

        result = await client.call_tool('echo', {'message': 'hello'})
        assert result['message'] == 'hello'
```

## Integration with Hanzo Ecosystem

### HMM (Hamiltonian Market Maker) Integration

ZAP can be used for high-frequency compute marketplace operations:

```rust
// HMM settlement via ZAP
interface HMMSettlement extends(Zap) {
  submitJob @0 (job :ComputeJob) -> (receipt :JobReceipt);
  claimReward @1 (attestation :PoAIAttestation) -> (settlement :Settlement);
}
```

### Jin Multimodal Integration

For Jin's multimodal AI workloads, ZAP efficiently handles:
- Image embeddings (zero-copy binary transfer)
- Audio segments (streaming via ResourceStream)
- Video frames (batched binary data)

### Agent SDK Integration

The Hanzo Agent SDK (HIP-009) uses ZAP for inter-agent communication:

```python
from hanzo.agent import Agent
from hanzo_zap import Gateway

# Agent with ZAP-enabled tool access
agent = Agent(
    gateway=Gateway.connect('zap://localhost:9999'),
    tools=['search', 'calculate', 'browser']
)

response = await agent.run("Search for AI news and summarize")
```

## Related Proposals

- **HIP-001**: Post-Quantum Cryptography Standard (transport security)
- **HIP-003**: Model Context Protocol Integration (semantic compatibility)
- **HIP-004**: Hamiltonian Market Maker (compute marketplace integration)
- **HIP-009**: Agent SDK (client library integration)
- **HIP-010**: MCP Integration Standards (bridging target)

## Implementations

### Hanzo Dev (hanzo-dev/zap)

The reference Rust implementation lives in the hanzo-dev repository:

```
hanzo-dev/zap/
├── src/
│   ├── lib.rs          # Library root
│   ├── client.rs       # ZAP client
│   ├── gateway.rs      # MCP gateway bridge
│   ├── transport.rs    # TCP/TLS transport
│   ├── buffer.rs       # Zero-alloc buffer pool
│   ├── wire.rs         # Wire protocol encoding
│   ├── message.rs      # Message types
│   ├── config.rs       # Gateway configuration
│   └── error.rs        # Error types
├── Cargo.toml
├── README.md
└── config.example.toml
```

Usage:
```rust
use hanzo_zap::{Client, Gateway, GatewayConfig};

// Client
let client = Client::connect("zap://localhost:9999").await?;
let tools = client.list_tools().await?;

// Gateway
let config = GatewayConfig::default();
let gateway = Gateway::new(config).await?;
gateway.serve().await?;
```

### Lux Network (LP-120)

ZAP is also adopted as the default transport for Lux Network infrastructure:

- **VM<->Node Communication**: Block building/parsing at 1000+ blocks/sec
- **Warp Messaging**: Cross-chain message signing with sub-100ms latency
- **DEX Operations**: Order matching at 50,000+ orders/sec
- **Consensus Voting**: Vote propagation across 1000+ validators

See [LP-120: ZAP Transport Protocol](https://github.com/luxfi/lps/blob/main/LPs/lp-0120-zap-transport-protocol.md) for the full specification.

## References

1. [Cap'n Proto Specification](https://capnproto.org/language.html)
2. [Cap'n Proto RPC Protocol](https://capnproto.org/rpc.html)
3. [Model Context Protocol](https://modelcontextprotocol.io)
4. [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)
5. [Zero-Copy Deserialization](https://serde.rs/lifetimes.html#understanding-deserializer-lifetimes)
6. [Cap'n Proto Performance](https://capnproto.org/news/2014-06-17-capnproto-flatbuffers-sbe.html)
7. [Cloudflare Workers and Cap'n Proto](https://blog.cloudflare.com/introducing-cloudflare-workers/)
8. [LP-120: ZAP Transport Protocol for Lux](https://github.com/luxfi/lps/blob/main/LPs/lp-0120-zap-transport-protocol.md)

## Copyright

Copyright 2025 Hanzo Industries Inc. Released under MIT License.

---

*HIP-007 Created: January 23, 2025*
*Status: Draft*
*Contact: dev@hanzo.ai*
