# HIP-002: Hanzo Node RPC API Documentation

**HIP Number**: 002
**Title**: Hanzo Node RPC API Documentation
**Author**: Hanzo AI Team
**Status**: Active
**Type**: Standards Track
**Created**: 2024-01-20
**Framework**: Warp (Rust Web Framework)

## Abstract

This HIP documents the complete RPC API surface for Hanzo Node, which is built using the **Warp** web framework for Rust. The API follows RESTful principles and provides comprehensive endpoints for AI agent orchestration, job management, tool execution, and system configuration.

## Architecture

### Web Framework: Warp

Hanzo Node uses **Warp** - a composable, functional web framework for Rust with these benefits:
- **Type-safe routing** with compile-time guarantees
- **Composable filters** for middleware and request handling
- **Built on hyper** for high performance HTTP
- **Async/await native** with Tokio runtime
- **WebSocket support** for real-time communication
- **Server-Sent Events (SSE)** for streaming responses

### Server Structure

```rust
// crates/hanzo-http-api/src/node_api_router.rs
use warp::Filter;

pub fn v2_routes(
    node_commands_sender: Sender<NodeCommand>,
    node_name: String,
) -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
    general_routes
        .or(vecfs_routes)
        .or(job_routes)
        .or(wallet_routes)
        .or(tool_routes)
        .or(mcp_server_routes)
        // ... more routes
}
```

## API Endpoints (v2)

### Base URL
```
http://localhost:3690/v2
```

### Authentication
All endpoints require Bearer token authentication:
```
Authorization: Bearer <API_V2_KEY>
```

## Core Endpoints

### 1. General System Routes

#### GET /v2/public_keys
Returns node's public keys for encryption and signing.
```json
{
  "signature_public_key": "string",
  "encryption_public_key": "string"
}
```

#### GET /v2/health_check
Health check endpoint for monitoring.
```json
{
  "status": "healthy",
  "version": "1.1.10",
  "uptime": 3600
}
```

#### POST /v2/initial_registration
Register a new node with the network.
```json
// Request
{
  "registration_code": "string",
  "node_name": "string"
}

// Response
{
  "message": "Registration successful",
  "node_name": "@@hanzo.node",
  "encryption_public_key": "string",
  "identity_public_key": "string",
  "api_v2_key": "string"
}
```

### 2. LLM Provider Management

#### POST /v2/add_llm_provider
Add a new LLM provider configuration.
```json
{
  "provider": "OpenAI|Anthropic|Together|Ollama",
  "api_key": "string",
  "base_url": "string (optional)",
  "models": ["model1", "model2"]
}
```

#### DELETE /v2/remove_llm_provider
Remove an LLM provider.
```json
{
  "provider": "string"
}
```

#### POST /v2/test_llm_provider
Test LLM provider connectivity.
```json
{
  "provider": "string",
  "model": "string",
  "test_prompt": "string"
}
```

### 3. Job Management

#### POST /v2/create_job
Create a new AI job.
```json
{
  "job_type": "Inference|Training|Analysis",
  "model": "string",
  "prompt": "string",
  "parameters": {},
  "tools": ["tool1", "tool2"]
}
```

#### GET /v2/job_status/{job_id}
Get job execution status.
```json
{
  "job_id": "string",
  "status": "pending|running|completed|failed",
  "progress": 0.75,
  "result": {}
}
```

#### POST /v2/cancel_job
Cancel a running job.
```json
{
  "job_id": "string"
}
```

### 4. Tool Management

#### GET /v2/list_all_hanzo_tools
List all available tools.
```json
{
  "tools": [
    {
      "name": "calculator",
      "version": "1.0.0",
      "enabled": true,
      "config": {}
    }
  ]
}
```

#### POST /v2/set_hanzo_tool
Configure a tool.
```json
{
  "tool_name": "string",
  "enabled": boolean,
  "config": {}
}
```

#### POST /v2/duplicate_tool
Create a copy of an existing tool.
```json
{
  "source_tool": "string",
  "new_name": "string",
  "config_overrides": {}
}
```

### 5. Vector Filesystem (VecFS)

#### POST /v2/upload_file_to_folder
Upload file with embeddings.
```json
{
  "folder_path": "string",
  "file_name": "string",
  "content": "base64_string",
  "generate_embedding": true
}
```

#### POST /v2/search_items
Vector similarity search.
```json
{
  "query": "string",
  "folder": "string",
  "limit": 10,
  "threshold": 0.8
}
```

#### GET /v2/retrieve_vector_resource
Get vector resource by ID.
```json
{
  "resource_id": "string",
  "include_embedding": false
}
```

### 6. Agent Management

#### POST /v2/add_agent
Register a new agent.
```json
{
  "name": "string",
  "type": "assistant|specialist|coordinator",
  "capabilities": ["capability1", "capability2"],
  "model": "string",
  "system_prompt": "string"
}
```

#### GET /v2/get_all_agents
List all registered agents.
```json
{
  "agents": [
    {
      "id": "string",
      "name": "string",
      "type": "string",
      "status": "active|inactive",
      "capabilities": []
    }
  ]
}
```

#### POST /v2/update_agent
Update agent configuration.
```json
{
  "agent_id": "string",
  "updates": {
    "system_prompt": "string",
    "capabilities": []
  }
}
```

### 7. MCP (Model Context Protocol) Servers

#### GET /v2/mcp_servers
List MCP server configurations.
```json
{
  "servers": [
    {
      "name": "string",
      "url": "string",
      "enabled": true,
      "tools": []
    }
  ]
}
```

#### POST /v2/add_mcp_server
Add MCP server.
```json
{
  "name": "string",
  "url": "string",
  "api_key": "string (optional)"
}
```

#### POST /v2/import_mcp_server_from_github_url
Import MCP server from GitHub.
```json
{
  "github_url": "string",
  "branch": "main"
}
```

### 8. Wallet Management

#### POST /v2/create_local_wallet
Create a new local wallet.
```json
{
  "wallet_type": "local|coinbase_mpc",
  "network": "ethereum|bitcoin|solana"
}
```

#### GET /v2/list_wallets
List all wallets.
```json
{
  "wallets": [
    {
      "id": "string",
      "type": "string",
      "address": "string",
      "balance": "0.0"
    }
  ]
}
```

#### GET /v2/get_wallet_balance
Get wallet balance.
```json
{
  "wallet_id": "string",
  "include_pending": true
}
```

### 9. Cron Jobs

#### POST /v2/add_cron_task
Schedule a recurring task.
```json
{
  "name": "string",
  "schedule": "0 */6 * * *",
  "job_config": {
    "type": "string",
    "parameters": {}
  }
}
```

#### GET /v2/list_all_cron_tasks
List scheduled tasks.
```json
{
  "tasks": [
    {
      "id": "string",
      "name": "string",
      "schedule": "string",
      "next_run": "ISO8601",
      "enabled": true
    }
  ]
}
```

### 10. Embedding Management

#### GET /v2/default_embedding_model
Get default embedding model.
```json
{
  "model": "qwen3-next",
  "dimension": 1536
}
```

#### POST /v2/default_embedding_model
Set default embedding model.
```json
{
  "model": "string",
  "dimension": integer
}
```

#### GET /v2/supported_embedding_models
List supported embedding models.
```json
{
  "models": [
    {
      "name": "qwen3-next",
      "dimension": 1536,
      "available": true
    }
  ]
}
```

## WebSocket Endpoints

### WS /v2/ws
Real-time bidirectional communication.
```javascript
// Client -> Server
{
  "type": "subscribe",
  "channels": ["jobs", "agents", "system"]
}

// Server -> Client
{
  "type": "event",
  "channel": "jobs",
  "data": {
    "job_id": "string",
    "status": "completed"
  }
}
```

## Server-Sent Events (SSE)

### GET /v2/sse
Server-sent events for real-time updates.
```
GET /v2/sse
Accept: text/event-stream

// Response stream
event: job_update
data: {"job_id": "123", "progress": 0.5}

event: agent_message
data: {"agent_id": "456", "message": "Processing..."}
```

## Error Responses

All errors follow this format:
```json
{
  "code": 400,
  "error": "Bad Request",
  "message": "Detailed error description"
}
```

### Error Codes
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `429` - Rate Limited
- `500` - Internal Server Error

## Rate Limiting

Default rate limits:
- 100 requests per minute per API key
- 10 concurrent jobs per node
- 1000 tool executions per hour

## Testing

### Integration Tests

The codebase includes comprehensive integration tests in `/hanzo-bin/hanzo-node/tests/`:

```rust
// Test example from tests/it/node_integration_tests.rs
#[tokio::test]
async fn test_api_v2_health_check() {
    let node = setup_test_node().await;

    let response = client
        .get(&format!("{}/v2/health_check", node.api_url))
        .bearer_auth(&node.api_key)
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), 200);
}
```

### Test Coverage

Current test files cover:
- ✅ Job management (`job_*.rs`)
- ✅ Tool configuration (`tool_config_override_test.rs`)
- ✅ WebSocket communication (`websocket_tests.rs`)
- ✅ Database operations (`db_*.rs`)
- ✅ Cron jobs (`cron_job_tests.rs`)
- ✅ Node operations (`node_*.rs`)
- ✅ Authentication (`a3_micropayment_flow_tests.rs`)
- ⚠️  Partial coverage for new endpoints

## Swagger Documentation

When compiled with `swagger-ui` feature:
```
cargo build --features swagger-ui
```

Access Swagger UI at:
```
http://localhost:3690/v2/swagger-ui/
```

## Performance Characteristics

Using Warp framework provides:
- **Throughput**: 100,000+ requests/second
- **Latency**: < 1ms for simple endpoints
- **Concurrent connections**: 10,000+
- **WebSocket connections**: 5,000+
- **Memory usage**: ~100MB base

## Security Considerations

1. **TLS Support**: Use HTTPS in production
2. **API Key Rotation**: Rotate keys regularly
3. **Request Validation**: All inputs validated
4. **Rate Limiting**: Prevent abuse
5. **CORS**: Configured per environment

## Migration from v1

For clients using v1 API:
1. Update base URL to `/v2`
2. Use Bearer token authentication
3. Update request/response formats
4. Handle new error format

## Future Enhancements

1. **GraphQL API**: For flexible querying
2. **gRPC Support**: For high-performance RPC
3. **OpenAPI 3.0**: Full specification
4. **Metrics Endpoint**: Prometheus format
5. **Admin API**: Separate admin endpoints

## References

- [Warp Documentation](https://github.com/seanmonstar/warp)
- [Hanzo Node Repository](https://github.com/hanzo-ai/hanzo-node)
- [Model Context Protocol](https://github.com/anthropics/mcp)
- [REST API Best Practices](https://restfulapi.net/)

## Copyright

This document is licensed under Apache 2.0.