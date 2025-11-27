---
hip: 0011
title: Chat Interface Standard
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2025-01-09
requires: HIP-4
---

# HIP-11: Chat Interface Standard

## Abstract

This proposal defines the comprehensive chat interface standard for AI model interactions across the Hanzo ecosystem. It establishes the canonical implementation for conversational AI, including message formats, session management, streaming protocols, multimodal support, and Model Context Protocol (MCP) integration. All chat applications in the Hanzo ecosystem MUST implement this interface to ensure consistency and interoperability.

**Repository**: [github.com/hanzoai/chat](https://github.com/hanzoai/chat)  
**Port**: 3081  
**Status**: Production-ready (LibreChat fork with Hanzo extensions)

## Motivation

The Hanzo ecosystem requires a unified chat interface to:

1. **Standardize Interactions**: Provide consistent chat experience across all AI models
2. **Enable Multimodality**: Support text, images, files, and code in conversations
3. **Tool Integration**: Leverage MCP for AI tool use and function calling
4. **Session Persistence**: Maintain conversation history and context
5. **Enterprise Features**: Support multi-user, authentication, and audit trails
6. **Provider Agnostic**: Work seamlessly with 100+ LLM providers via HIP-4

Without standardization, each application would implement chat differently, leading to fragmentation and poor user experience.

## Specification

### Core Data Models

#### Message Format

```typescript
interface Message {
  // Unique identifier
  id: string;
  
  // Message role in conversation
  role: "user" | "assistant" | "system" | "function" | "tool";
  
  // Message content (text, structured data, or multimodal)
  content: string | MessageContent[];
  
  // Metadata
  timestamp: number;
  model?: string;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
  
  // Optional fields
  name?: string;           // For function/tool messages
  function_call?: {         // AI requesting function execution
    name: string;
    arguments: string;
  };
  tool_calls?: ToolCall[];  // Multiple tool invocations
  
  // Multimodal attachments
  attachments?: Attachment[];
  
  // User feedback
  feedback?: {
    rating: number;         // 1-5 stars
    comment?: string;
  };
}

interface MessageContent {
  type: "text" | "image" | "file" | "code";
  text?: string;
  image_url?: {
    url: string;
    detail?: "low" | "high" | "auto";
  };
  file?: {
    url: string;
    mime_type: string;
    name: string;
    size: number;
  };
  code?: {
    language: string;
    content: string;
  };
}

interface Attachment {
  id: string;
  type: "image" | "document" | "audio" | "video" | "code";
  url: string;
  name: string;
  size: number;
  mime_type: string;
  metadata?: Record<string, any>;
}

interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}
```

#### Session Management

```typescript
interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  model: string;
  
  // Timestamps
  created: number;
  updated: number;
  
  // User management
  user_id: string;
  shared_with?: string[];    // User IDs with access
  public?: boolean;           // Publicly accessible
  
  // Configuration
  settings: {
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    stop_sequences?: string[];
    system_prompt?: string;
  };
  
  // MCP tools
  enabled_tools?: string[];   // Tool IDs from MCP registry
  
  // Metadata
  tags?: string[];
  folder_id?: string;
  archived?: boolean;
  
  // Usage tracking
  usage?: {
    total_tokens: number;
    total_cost: number;      // In cents
    message_count: number;
  };
}

interface Folder {
  id: string;
  name: string;
  user_id: string;
  parent_id?: string;        // For nested folders
  created: number;
  updated: number;
}
```

### API Endpoints

#### Session Management

```yaml
# Create new session
POST /api/chat/sessions
Body:
  title?: string
  model: string
  settings?: SessionSettings
Response:
  session: ChatSession

# List sessions with pagination
GET /api/chat/sessions
Query:
  page?: number (default: 1)
  limit?: number (default: 20, max: 100)
  folder_id?: string
  archived?: boolean
  search?: string
Response:
  sessions: ChatSession[]
  total: number
  page: number
  pages: number

# Get specific session
GET /api/chat/sessions/:id
Response:
  session: ChatSession

# Update session
PATCH /api/chat/sessions/:id
Body:
  title?: string
  settings?: SessionSettings
  tags?: string[]
  folder_id?: string
  archived?: boolean
Response:
  session: ChatSession

# Delete session
DELETE /api/chat/sessions/:id
Response:
  success: boolean

# Share session
POST /api/chat/sessions/:id/share
Body:
  user_ids?: string[]
  public?: boolean
Response:
  share_url?: string
```

#### Message Operations

```yaml
# Send message (streaming response)
POST /api/chat/sessions/:id/messages
Headers:
  Accept: text/event-stream  # For SSE streaming
Body:
  content: string | MessageContent[]
  attachments?: Attachment[]
  tools?: string[]           # MCP tool IDs to enable
Response:
  Stream of SSE events (see Streaming Protocol)

# Edit message
PATCH /api/chat/messages/:id
Body:
  content: string | MessageContent[]
Response:
  message: Message
  
# Delete message
DELETE /api/chat/messages/:id
Response:
  success: boolean

# Regenerate response
POST /api/chat/messages/:id/regenerate
Body:
  model?: string             # Override model
  settings?: SessionSettings # Override settings
Response:
  Stream of SSE events
```

#### File Operations

```yaml
# Upload file for attachment
POST /api/chat/files
Headers:
  Content-Type: multipart/form-data
Body:
  file: File
  session_id?: string
Response:
  attachment: Attachment

# Get file
GET /api/chat/files/:id
Response:
  File content with appropriate Content-Type

# Delete file
DELETE /api/chat/files/:id
Response:
  success: boolean
```

### Streaming Protocol

Server-Sent Events (SSE) format for real-time streaming:

```typescript
// Token streaming
event: token
data: {"content": "Hello", "index": 0}

event: token
data: {"content": " world", "index": 1}

// Tool use
event: tool_call
data: {"id": "call_123", "name": "calculator", "arguments": "{\"expression\": \"2+2\"}"}

event: tool_result
data: {"id": "call_123", "result": "4"}

// Completion metadata
event: done
data: {
  "message_id": "msg_456",
  "model": "claude-3-opus",
  "tokens": {
    "prompt": 10,
    "completion": 2,
    "total": 12
  },
  "cost": 0.0024  // In dollars
}

// Error handling
event: error
data: {"code": "rate_limit", "message": "Rate limit exceeded"}
```

### Model Context Protocol (MCP) Integration

```typescript
interface MCPTool {
  id: string;
  name: string;
  description: string;
  parameters: JSONSchema;
  handler: (params: any) => Promise<any>;
}

// Tool registration
POST /api/chat/tools
Body:
  tool: MCPTool
Response:
  id: string

// Tool execution (internal)
interface ToolExecution {
  tool_id: string;
  call_id: string;
  parameters: any;
  result?: any;
  error?: string;
  duration_ms: number;
}
```

### WebSocket Support

Alternative to SSE for bidirectional communication:

```javascript
// WebSocket connection
ws://localhost:3081/api/chat/ws

// Client → Server messages
{
  "type": "session.join",
  "session_id": "sess_123"
}

{
  "type": "message.send",
  "content": "Hello",
  "attachments": []
}

{
  "type": "message.stop"  // Cancel generation
}

// Server → Client messages
{
  "type": "token",
  "content": "Hello"
}

{
  "type": "message.complete",
  "message": Message
}

{
  "type": "error",
  "error": {
    "code": "invalid_session",
    "message": "Session not found"
  }
}
```

### Authentication & Authorization

```typescript
interface AuthContext {
  user_id: string;
  email: string;
  roles: string[];
  permissions: string[];
  api_key?: string;
  oauth_provider?: string;
}

// JWT-based authentication
interface JWTPayload {
  sub: string;          // User ID
  email: string;
  roles: string[];
  exp: number;
  iat: number;
}

// API key authentication
interface APIKey {
  id: string;
  key: string;          // Hashed
  name: string;
  user_id: string;
  permissions: string[];
  created: number;
  last_used?: number;
  expires?: number;
}
```

### Rate Limiting

```yaml
Tiers:
  free:
    requests_per_minute: 20
    requests_per_day: 500
    max_tokens_per_request: 2000
    concurrent_sessions: 3
    
  pro:
    requests_per_minute: 60
    requests_per_day: 5000
    max_tokens_per_request: 4000
    concurrent_sessions: 10
    
  enterprise:
    requests_per_minute: 300
    requests_per_day: unlimited
    max_tokens_per_request: 32000
    concurrent_sessions: unlimited
```

### Error Handling

```typescript
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
    timestamp: number;
    request_id: string;
  };
}

// Standard error codes
enum ErrorCode {
  // Client errors (4xx)
  INVALID_REQUEST = "invalid_request",
  UNAUTHORIZED = "unauthorized",
  FORBIDDEN = "forbidden",
  NOT_FOUND = "not_found",
  RATE_LIMITED = "rate_limited",
  INVALID_MODEL = "invalid_model",
  CONTEXT_LENGTH_EXCEEDED = "context_length_exceeded",
  
  // Server errors (5xx)
  INTERNAL_ERROR = "internal_error",
  MODEL_ERROR = "model_error",
  GATEWAY_ERROR = "gateway_error",
  SERVICE_UNAVAILABLE = "service_unavailable"
}
```

## Rationale

### Why This Design?

- **Single Interface**: One canonical way to chat with AI models across the ecosystem
- **Model Agnostic**: Works with any model via HIP-4 (LLM Gateway)
- **Streaming First**: Real-time responses are the default for better UX
- **Multimodal Native**: Built-in support for images, files, and code
- **MCP Integration**: Seamless tool use and function calling
- **Enterprise Ready**: Authentication, rate limiting, and audit trails

### Why LibreChat Base?

- **Proven Implementation**: Battle-tested with millions of users
- **Feature Complete**: Already implements most requirements
- **Active Development**: Regular updates and improvements
- **Open Source**: Can be forked and customized

### Architecture Decisions

1. **SSE over WebSockets for streaming**: Better proxy support, simpler implementation
2. **Session-based over stateless**: Maintains context for better conversations
3. **File storage abstraction**: Support for S3, local, and other providers
4. **JWT + API keys**: Flexible authentication for different use cases

## Implementation

### System Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│   Client    │────▶│  Chat API    │────▶│ LLM Gateway  │
│  (Browser)  │◀────│   (HIP-11)   │◀────│   (HIP-4)    │
└─────────────┘     └──────────────┘     └──────────────┘
                           │                      │
                           ▼                      ▼
                    ┌──────────────┐       ┌──────────┐
                    │   Database   │       │   100+   │
                    │  (Sessions)  │       │ Providers│
                    └──────────────┘       └──────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ File Storage │
                    │  (S3/Local)  │
                    └──────────────┘
```

### Deployment Configuration

```yaml
# docker-compose.yml
version: '3.8'

services:
  chat:
    image: hanzoai/chat:latest
    ports:
      - "3081:3081"
    environment:
      - DATABASE_URL=postgresql://user:pass@db:5432/chat
      - REDIS_URL=redis://redis:6379
      - LLM_GATEWAY_URL=http://gateway:4000
      - JWT_SECRET=${JWT_SECRET}
      - S3_BUCKET=${S3_BUCKET}
    depends_on:
      - db
      - redis
      - gateway
    
  db:
    image: postgres:16
    volumes:
      - chat_data:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=chat
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
    
  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    
  gateway:
    image: hanzoai/llm-gateway:latest
    ports:
      - "4000:4000"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      # ... other provider keys

volumes:
  chat_data:
  redis_data:
```

### Quick Start

```bash
# Clone repository
git clone https://github.com/hanzoai/chat
cd chat

# Configure environment
cp .env.example .env
# Edit .env with your configuration

# Start with Docker
docker compose up -d

# Or start development server
npm install
npm run dev

# Access at http://localhost:3081
```

## Security Considerations

1. **Input Validation**: Sanitize all user inputs to prevent injection attacks
2. **Rate Limiting**: Prevent abuse and ensure fair resource usage
3. **Authentication**: Require authentication for all non-public endpoints
4. **Encryption**: Use TLS for all communications, encrypt sensitive data at rest
5. **Audit Logging**: Log all significant actions for compliance
6. **Content Filtering**: Optional content moderation for enterprise deployments
7. **CORS Policy**: Strict CORS configuration for API endpoints
8. **File Scanning**: Scan uploaded files for malware
9. **Token Management**: Secure storage and rotation of API keys
10. **Session Security**: Implement session timeouts and secure cookies

## Testing

### Unit Tests
```bash
npm run test:unit
```

### Integration Tests
```bash
npm run test:integration
```

### Load Testing
```bash
# Using k6
k6 run tests/load/chat-api.js
```

### Security Testing
```bash
# OWASP ZAP scan
npm run test:security
```

## Compliance

- **GDPR**: User data deletion, export capabilities
- **SOC 2**: Audit trails, access controls
- **HIPAA**: Optional encryption and access controls for healthcare
- **CCPA**: California privacy requirements

## Migration Guide

For applications currently using other chat interfaces:

1. **Map message formats** to the standard schema
2. **Implement session management** if stateless
3. **Update streaming protocol** to SSE format
4. **Add MCP tool registration** for function calling
5. **Migrate user data** preserving conversation history

## Performance Targets

- **Latency**: < 100ms to first token
- **Throughput**: > 1000 concurrent sessions
- **Availability**: 99.9% uptime SLA
- **Message Storage**: Unlimited with pagination
- **File Size**: Up to 100MB per attachment

## References

1. [HIP-4: LLM Gateway Standard](./hip-4.md)
2. [HIP-10: Model Context Protocol](./hip-10.md)
3. [LibreChat Documentation](https://docs.librechat.ai)
4. [OpenAI Chat Completions API](https://platform.openai.com/docs/api-reference/chat)
5. [Anthropic Messages API](https://docs.anthropic.com/claude/reference/messages)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).