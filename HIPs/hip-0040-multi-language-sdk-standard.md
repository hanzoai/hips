---
hip: 0040
title: Multi-Language SDK Standard
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2025-01-09
updated: 2026-02-23
requires: HIP-0004
---

# HIP-40: Multi-Language SDK Standard

## Abstract

Hanzo publishes official client libraries for Python, TypeScript/JavaScript, Go, and Rust. All four SDKs are auto-generated from a single OpenAPI specification using [Stainless](https://www.stainless.com/), ensuring byte-level API parity across languages. The SDKs provide typed, ergonomic access to the Hanzo AI platform -- chat completions, embeddings, images, audio, files, models, fine-tuning, and administrative endpoints -- through the LLM Gateway defined in HIP-4.

The API surface is OpenAI-compatible by design. Existing OpenAI SDK users can switch to Hanzo by changing `base_url` and `api_key`. This drop-in compatibility is the single most important adoption lever for an AI platform.

| Language | Package | Repository | Registry |
|----------|---------|------------|----------|
| Python | `hanzoai` | [github.com/hanzoai/python-sdk](https://github.com/hanzoai/python-sdk) | [PyPI](https://pypi.org/project/hanzoai/) |
| TypeScript/JS | `hanzoai` | [github.com/hanzoai/js-sdk](https://github.com/hanzoai/js-sdk) | [npm](https://www.npmjs.com/package/hanzoai) |
| Go | `github.com/hanzoai/go-sdk` | [github.com/hanzoai/go-sdk](https://github.com/hanzoai/go-sdk) | [pkg.go.dev](https://pkg.go.dev/github.com/hanzoai/go-sdk) |
| Rust | `hanzoai` | [github.com/hanzoai/rust-sdk](https://github.com/hanzoai/rust-sdk) | [crates.io](https://crates.io/crates/hanzoai) |

**Documentation**: [docs.hanzo.ai](https://docs.hanzo.ai)
**Base URL**: `https://api.hanzo.ai/v1` (production)

## Motivation

### The Problem

The Hanzo AI platform exposes a REST API with dozens of endpoints, streaming responses, file uploads, paginated lists, and typed error codes. Without official SDKs, every developer integrating Hanzo must:

1. **Write HTTP boilerplate**: Construct URLs, serialize JSON, parse responses, handle streaming SSE, manage retries, implement exponential backoff. This is 200-500 lines of plumbing code before writing a single line of application logic.

2. **Guess at types**: The API returns nested JSON objects. Without typed response models, developers rely on `dict` / `any` / `interface{}` and discover field names by reading raw responses at runtime. Typos in field access become silent bugs.

3. **Handle errors inconsistently**: A 429 rate limit response requires backoff and retry. A 401 requires re-authentication. A 500 might be transient. Without SDK-level error classification, each developer implements (or skips) this logic independently.

4. **Duplicate across languages**: A team using Python for ML training, TypeScript for the frontend, and Go for the backend must implement and maintain three separate HTTP clients. When the API adds a field, three codebases need updating.

5. **Risk security mistakes**: API keys get logged in debug output. TLS verification gets disabled "temporarily" in development and ships to production. Retry logic sends the same request with the same idempotency key, causing duplicate charges.

### Why Auto-Generated SDKs Solve This

A single OpenAPI specification defines every endpoint, parameter, response type, and error code. Stainless reads this specification and generates idiomatic client code for each target language. When the API changes, the spec is updated, Stainless regenerates all four SDKs, automated tests run, and new versions are published. No human writes HTTP client code.

This eliminates all five problems:

- **No boilerplate**: The SDK handles serialization, streaming, retries, and timeouts.
- **Full type safety**: Every request parameter and response field has a concrete type. IDEs provide autocompletion. Compilers catch misuse.
- **Consistent error handling**: All SDKs classify errors identically (400 = `BadRequestError`, 429 = `RateLimitError`, etc.) and implement the same retry policy.
- **One source of truth**: API changes propagate to all four languages simultaneously.
- **Security by default**: Keys are never logged. TLS is enforced. Sensitive headers are redacted in debug output.

## Design Philosophy

This section explains the *why* behind each major design decision.

### Why Stainless Over Hand-Written SDKs

The traditional approach to multi-language SDKs is to assign a team to each language. This fails at scale. When the API adds a parameter, four teams must coordinate. When a bug is found in retry logic, four teams must fix it. When a new language is needed, a new team must be hired.

Stainless inverts this. One engineer maintains the OpenAPI spec. Stainless generates idiomatic code for each language -- not template-stamped boilerplate, but code that follows each language's conventions (Python uses `snake_case`, Go uses `PascalCase`, TypeScript uses `camelCase`). The generated code includes typed request/response models, streaming helpers, pagination iterators, file upload utilities, and comprehensive test suites.

The tradeoff is reduced flexibility. If the Go SDK needs a Go-specific feature that does not map to the OpenAPI spec, it requires a Stainless extension or a hand-written wrapper. In practice, this is rare -- the OpenAPI spec is expressive enough for 99% of use cases.

| Factor | Hand-Written | Stainless-Generated |
|--------|-------------|-------------------|
| Languages supported | N engineers for N languages | 1 spec for N languages |
| API parity | Drift over time | Guaranteed by construction |
| Time to add endpoint | Days (per language) | Minutes (spec change) |
| Type coverage | Varies by team | 100% from spec |
| Test coverage | Varies by team | Generated from spec |
| Maintenance burden | O(N * endpoints) | O(1 * endpoints) |

### Why OpenAI-Compatible

OpenAI established the de facto standard API for LLM inference. Anthropic, Google, Mistral, and dozens of other providers have adopted compatible endpoints. The AI developer ecosystem has standardized on this interface:

- `POST /v1/chat/completions` for conversational inference
- `POST /v1/embeddings` for vector embeddings
- `POST /v1/images/generations` for image generation
- `POST /v1/audio/transcriptions` for speech-to-text

By maintaining wire-level compatibility with this interface, Hanzo achieves zero-friction adoption. A developer using `openai.ChatCompletion.create()` can switch to Hanzo by changing two configuration values:

```python
# Before (OpenAI direct)
client = OpenAI(api_key="sk-openai-...")

# After (Hanzo -- access 100+ providers)
client = OpenAI(
    api_key="sk-hanzo-...",
    base_url="https://api.hanzo.ai/v1"
)
```

The Hanzo SDKs extend this base with platform-specific features (cost tracking, key management, team budgets, guardrails) while maintaining backward compatibility with any OpenAI-compatible client.

### Why These Four Languages

The language selection covers 95%+ of AI developer workflows:

| Language | Use Case | Ecosystem Coverage |
|----------|----------|-------------------|
| **Python** | ML training, data science, Jupyter notebooks, research | ~70% of AI/ML developers |
| **TypeScript** | Web frontends, Node.js backends, serverless functions | ~60% of web developers |
| **Go** | Infrastructure, CLIs, cloud services, Kubernetes operators | ~30% of platform engineers |
| **Rust** | Performance-critical systems, blockchain, edge inference | ~10% of systems developers |

Ruby, Java, .NET, and other languages are supported through the OpenAI-compatible API. Any OpenAI SDK in any language works with Hanzo by changing the base URL. Official Hanzo SDKs for these languages are community-maintained and not auto-generated, as the engineering cost of maintaining Stainless configurations for low-demand languages exceeds the benefit.

### Why Typed Clients Over Raw HTTP

Consider this untyped Python call:

```python
import requests
r = requests.post("https://api.hanzo.ai/v1/chat/completions", json={
    "model": "gpt-4",
    "mesages": [{"role": "user", "content": "Hello"}]  # typo: "mesages"
})
data = r.json()
print(data["choises"][0]["message"]["content"])  # typo: "choises"
```

Both typos (`mesages`, `choises`) silently fail at runtime. The request returns a 400 error. The response access throws a `KeyError`. The developer debugs by reading raw JSON.

With the typed SDK:

```python
from hanzoai import Hanzo

client = Hanzo(api_key="sk-hanzo-...")
response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello"}]
)
print(response.choices[0].message.content)
```

The IDE flags `mesages` as an unknown parameter. The type checker rejects `choises` because `response.choices` is a typed list. Errors are caught before the code runs.

## Specification

### OpenAPI Specification

The canonical API definition lives in the Stainless configuration repository. The OpenAPI spec is the single source of truth for:

- Every endpoint URL and HTTP method
- Request parameters (path, query, header, body) with types and constraints
- Response schemas with all fields typed
- Error response formats
- Authentication requirements
- Pagination patterns
- Streaming event schemas

**Spec versioning**: The OpenAPI spec is versioned with semantic versioning. Breaking changes (removed fields, changed types) increment the major version. Additive changes (new endpoints, new optional fields) increment the minor version. The current API version is communicated via the `X-Hanzo-API-Version` header.

**Spec location**: The spec is maintained in the Stainless platform and exported to each SDK repository as `api.md` -- a human-readable API reference generated from the spec.

### Generation Pipeline

```
OpenAPI Spec (Stainless) → Code Generator → [python-sdk, js-sdk, go-sdk, rust-sdk]
                                                    ↓
                                            [PyPI, npm, Go proxy, crates.io]
```

The pipeline runs on every spec change:

1. **Spec update**: An engineer modifies the OpenAPI spec in Stainless.
2. **Code generation**: Stainless generates idiomatic client code for all four languages.
3. **Pull requests**: Stainless opens PRs against each SDK repository with the generated changes.
4. **Automated tests**: CI runs the generated test suite plus any hand-written integration tests.
5. **Review and merge**: An SDK maintainer reviews the diff and merges.
6. **Publish**: CI publishes the new version to the appropriate package registry (PyPI, npm, Go proxy module, crates.io). Changelogs are auto-generated from the spec diff.

### Authentication

All SDKs support three authentication methods:

#### API Key (Primary)

The simplest and most common method. The API key is sent in the `Authorization` header as a Bearer token.

```
Authorization: Bearer sk-hanzo-...
```

The key is read from:
1. The `api_key` constructor parameter (highest priority)
2. The `HANZO_API_KEY` environment variable (fallback)

API keys are org-scoped. A key created for organization `hanzo` can only access resources within that organization. Keys are created and managed via the Hanzo Console (HIP-38) or the `/key/generate` API endpoint.

#### OAuth Token

For user-facing applications that authenticate via Hanzo IAM (HIP-26), the OAuth access token is passed as the API key. The LLM Gateway validates the JWT against IAM's JWKS endpoint and extracts the user identity and organization from the token claims.

#### Org-Scoped Headers

For multi-tenant applications where a single API key serves multiple organizations:

```
Authorization: Bearer sk-hanzo-master-key
X-Hanzo-Organization: acme-corp
X-Hanzo-Team: ml-research
```

The master key must have cross-org permissions. The `X-Hanzo-Organization` header scopes the request to a specific org's models, budgets, and rate limits.

### Base URL Configuration

| Environment | Base URL |
|-------------|----------|
| Production | `https://api.hanzo.ai/v1` |
| Sandbox | `https://sandbox.api.hanzo.ai/v1` |
| Self-hosted | Configurable (e.g., `http://localhost:4000`) |

All SDKs accept a `base_url` parameter to override the default. The SDK strips trailing slashes and validates the URL format at construction time.

### Core API Surface

The following endpoints are available across all four SDKs. Method names follow each language's conventions (Python: `snake_case`, Go: `PascalCase`, TypeScript: `camelCase`).

#### Chat Completions

```
POST /v1/chat/completions
POST /openai/deployments/{model}/chat/completions
POST /engines/{model}/chat/completions
```

Supports all OpenAI chat completion parameters: `model`, `messages`, `temperature`, `top_p`, `n`, `stream`, `stop`, `max_tokens`, `presence_penalty`, `frequency_penalty`, `logit_bias`, `user`, `tools`, `tool_choice`, `response_format`.

Hanzo-specific extensions: `metadata` (arbitrary key-value pairs for cost tracking), `mock_response` (return a canned response for testing), `tags` (categorize requests for analytics).

#### Embeddings

```
POST /v1/embeddings
POST /openai/deployments/{model}/embeddings
POST /engines/{model}/embeddings
```

Parameters: `model`, `input` (string or array of strings), `encoding_format` (`float` or `base64`), `dimensions`.

#### Images

```
POST /v1/images/generations
POST /v1/images/edits
POST /v1/images/variations
```

Parameters: `model`, `prompt`, `n`, `size`, `quality`, `style`, `response_format`.

#### Audio

```
POST /v1/audio/transcriptions
POST /v1/audio/translations
POST /v1/audio/speech
```

File upload support varies by language (see File Uploads section).

#### Files

```
POST /v1/files
GET  /v1/files
GET  /v1/files/{file_id}
GET  /v1/files/{file_id}/content
DELETE /v1/files/{file_id}
```

Used for fine-tuning data upload and batch processing.

#### Models

```
GET /v1/models
GET /v1/models/{model}
DELETE /v1/models/{model}
```

Lists available models across all configured providers, with cost, context window, and capability metadata.

#### Fine-Tuning

```
POST /v1/fine_tuning/jobs
GET  /v1/fine_tuning/jobs
GET  /v1/fine_tuning/jobs/{job_id}
POST /v1/fine_tuning/jobs/{job_id}/cancel
GET  /v1/fine_tuning/jobs/{job_id}/events
GET  /v1/fine_tuning/jobs/{job_id}/checkpoints
```

#### Moderations

```
POST /v1/moderations
```

#### Completions (Legacy)

`POST /v1/completions` -- maintained for backward compatibility with GPT-3 era code.

### Streaming

All SDKs support Server-Sent Events (SSE) streaming for chat completions and completions. The streaming interface is language-idiomatic:

**Python**:
```python
stream = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Write a poem"}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")
```

**TypeScript**:
```typescript
const stream = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Write a poem' }],
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

**Go**:
```go
stream := client.Chat.Completions.NewStreaming(ctx, hanzoai.ChatCompletionNewParams{
    Model:    hanzoai.F("gpt-4"),
    Messages: hanzoai.F([]hanzoai.ChatCompletionMessageParamUnion{
        hanzoai.UserMessage("Write a poem"),
    }),
})
for stream.Next() {
    chunk := stream.Current()
    fmt.Print(chunk.Choices[0].Delta.Content)
}
if err := stream.Err(); err != nil {
    log.Fatal(err)
}
```

Rust follows the same pattern using `stream.next().await` with typed `ChatCompletionChunk` objects.

All streaming connections use HTTP/1.1 chunked transfer encoding with `text/event-stream` content type. The SDK handles SSE parsing, reconnection on transient errors, and buffer management. Each chunk is a typed object, not a raw string.

### Error Handling

All SDKs use a consistent error hierarchy mapped from HTTP status codes:

| Status Code | Error Type | Retryable | Description |
|-------------|-----------|-----------|-------------|
| 400 | `BadRequestError` | No | Malformed request (invalid JSON, missing required field) |
| 401 | `AuthenticationError` | No | Invalid or missing API key |
| 403 | `PermissionDeniedError` | No | Key lacks required scope or org access |
| 404 | `NotFoundError` | No | Endpoint or resource does not exist |
| 408 | `RequestTimeoutError` | Yes | Server did not respond in time |
| 409 | `ConflictError` | Yes | Concurrent modification conflict |
| 422 | `UnprocessableEntityError` | No | Valid JSON but semantically invalid |
| 429 | `RateLimitError` | Yes | Rate limit exceeded; check `Retry-After` header |
| >= 500 | `InternalServerError` | Yes | Server error; transient |
| N/A | `APIConnectionError` | Yes | Network unreachable, DNS failure, TLS error |

Every error object exposes:
- `status_code`: The HTTP status code (or `None` for connection errors)
- `message`: Human-readable error description
- `headers`: Response headers (includes `x-request-id` for support tickets)
- `body`: Raw response body for debugging

### Retry Logic

All SDKs implement automatic retry with exponential backoff for retryable errors. The default configuration:

| Parameter | Default | Configurable |
|-----------|---------|-------------|
| Max retries | 2 | Yes (`max_retries`) |
| Initial delay | 0.5s | No (hardcoded) |
| Max delay | 8.0s | No (hardcoded) |
| Backoff multiplier | 2.0 | No (hardcoded) |
| Jitter | Full (0 to delay) | No (hardcoded) |

The retry policy respects the `Retry-After` header from 429 responses. If the server specifies a wait time, the SDK uses that instead of calculated backoff.

Retries use the same idempotency key (if provided) to prevent duplicate side effects. For non-idempotent requests (POST without idempotency key), only connection errors and 409 Conflict are retried. The `max_retries` parameter is configurable at both client and per-request level.

### Pagination

List endpoints use cursor-based pagination with opaque cursor tokens (not page numbers) for consistency under concurrent writes. All SDKs provide auto-pagination iterators:

```python
# Python: auto-paginate
for model in client.models.list():
    print(model.id)
```

```typescript
// TypeScript: auto-paginate
for await (const model of client.models.list()) {
  console.log(model.id);
}
```

Manual pagination is available via `has_next_page()` / `get_next_page()` methods on all page objects.

### SDK Configuration

All SDKs accept the following configuration at construction time:

| Parameter | Type | Default | Env Variable | Description |
|-----------|------|---------|-------------|-------------|
| `api_key` | string | -- | `HANZO_API_KEY` | API key for authentication |
| `base_url` | string | `https://api.hanzo.ai/v1` | `HANZO_BASE_URL` | API base URL |
| `timeout` | duration | 60s | `HANZO_TIMEOUT` | Request timeout |
| `max_retries` | int | 2 | `HANZO_MAX_RETRIES` | Max retry attempts |
| `default_headers` | map | `{}` | -- | Headers sent with every request |
| `default_query` | map | `{}` | -- | Query params sent with every request |
| `organization` | string | -- | `HANZO_ORGANIZATION` | Default organization |
| `log_level` | string | `warn` | `HANZO_LOG` | Logging verbosity |

**Python-specific**: `http_client` (custom `httpx.Client`), async support via `AsyncHanzo`.
**TypeScript-specific**: `fetch` (custom fetch implementation), `logger` (custom logger).
**Go-specific**: `HTTPClient` (custom `*http.Client`), `option.WithMiddleware`.
**Rust-specific**: `reqwest::Client` override, feature flags for async runtimes.

### Versioning

SDKs version independently from the API and follow semantic versioning. Current versions: Python 2.x, TypeScript 0.x, Go 0.x, Rust 0.x -- all targeting API v1.

API version pinning is supported via the `X-Hanzo-API-Version` header (passed via `default_headers`), allowing the server to evolve while clients receive consistent responses until they explicitly upgrade.

### File Uploads

File upload support is language-idiomatic. Python accepts `pathlib.Path`, file objects, or `(name, bytes, mime)` tuples. TypeScript accepts `fs.ReadStream`, `File`, `fetch` `Response`, or the `toFile()` helper. Go accepts `io.Reader`. Rust accepts `reqwest::multipart::Part`.

```python
# Python
from pathlib import Path
response = client.audio.transcriptions.create(file=Path("/path/to/audio.mp3"), model="whisper-1")
```

```typescript
// TypeScript
import fs from 'fs';
await client.audio.transcriptions.create({ file: fs.createReadStream('/path/to/audio.mp3'), model: 'whisper-1' });
```

### Raw Response Access

All SDKs expose the underlying HTTP response (headers, status code, raw body) for cases where the typed response is insufficient. Python uses `.with_raw_response`, TypeScript uses `.asResponse()` or `.withResponse()`, Go returns raw `*http.Response` via options, and Rust exposes the `reqwest::Response`.

### Logging and Debugging

All SDKs support configurable log levels (`debug`, `info`, `warn`, `error`, `off`) via the `log_level` constructor parameter or the `HANZO_LOG` environment variable. At `debug` level, all HTTP requests and responses are logged with headers and bodies. Authentication headers (`Authorization`, `X-Api-Key`) are automatically redacted to `sk-han...REDACTED`.

## Implementation

### Chat Completion: All Four Languages

The canonical example -- a chat completion request -- implemented in all four SDKs:

#### Python

```python
from hanzoai import Hanzo

client = Hanzo()  # reads HANZO_API_KEY from environment

response = client.chat.completions.create(
    model="gpt-4",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "What is the capital of France?"},
    ],
    temperature=0.7,
    max_tokens=256,
)

print(response.choices[0].message.content)
# Paris is the capital of France.

print(f"Tokens used: {response.usage.total_tokens}")
print(f"Request ID: {response.id}")
```

Python also provides `AsyncHanzo` for async/await usage with the same API surface.

#### TypeScript

```typescript
import Hanzo from 'hanzoai';

const client = new Hanzo();  // reads HANZO_API_KEY from environment

const response = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'What is the capital of France?' },
  ],
  temperature: 0.7,
  max_tokens: 256,
});

console.log(response.choices[0].message.content);
// Paris is the capital of France.

console.log(`Tokens used: ${response.usage?.total_tokens}`);
console.log(`Request ID: ${response.id}`);
```

#### Go

```go
package main

import (
    "context"
    "fmt"
    "log"

    "github.com/hanzoai/go-sdk"         // imported as hanzoai
    "github.com/hanzoai/go-sdk/option"
)

func main() {
    client := hanzoai.NewClient(
        option.WithAPIKey("sk-hanzo-..."), // or reads HANZO_API_KEY
    )

    response, err := client.Chat.Completions.New(
        context.Background(),
        hanzoai.ChatCompletionNewParams{
            Model: hanzoai.F("gpt-4"),
            Messages: hanzoai.F([]hanzoai.ChatCompletionMessageParamUnion{
                hanzoai.SystemMessage("You are a helpful assistant."),
                hanzoai.UserMessage("What is the capital of France?"),
            }),
            Temperature: hanzoai.F(0.7),
            MaxTokens:   hanzoai.F(int64(256)),
        },
    )
    if err != nil {
        log.Fatal(err)
    }

    fmt.Println(response.Choices[0].Message.Content)
    fmt.Printf("Tokens used: %d\n", response.Usage.TotalTokens)
    fmt.Printf("Request ID: %s\n", response.ID)
}
```

#### Rust

```rust
use hanzoai::Client;
use hanzoai::chat::{CreateChatCompletionRequest, ChatCompletionMessage};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = Client::from_env()?;  // reads HANZO_API_KEY

    let response = client
        .chat()
        .completions()
        .create(CreateChatCompletionRequest {
            model: "gpt-4".into(),
            messages: vec![
                ChatCompletionMessage::system("You are a helpful assistant."),
                ChatCompletionMessage::user("What is the capital of France?"),
            ],
            temperature: Some(0.7),
            max_tokens: Some(256),
            ..Default::default()
        })
        .await?;

    println!("{}", response.choices[0].message.content.as_deref().unwrap_or(""));
    println!("Tokens used: {}", response.usage.total_tokens);
    println!("Request ID: {}", response.id);

    Ok(())
}
```

### OpenAI Drop-In Compatibility

Existing OpenAI SDK code works unchanged by pointing at the Hanzo backend. This works because the LLM Gateway (HIP-4) implements the OpenAI wire protocol:

```python
from openai import OpenAI
client = OpenAI(api_key="sk-hanzo-...", base_url="https://api.hanzo.ai/v1")
response = client.chat.completions.create(model="gpt-4", messages=[{"role": "user", "content": "Hello!"}])
```

The Hanzo-native SDKs add typed access to platform-specific features (key management, budgets, team controls, guardrails) not available through the generic OpenAI client.

### Hanzo-Specific Extensions

Beyond the OpenAI-compatible surface, the Hanzo SDKs expose platform management endpoints not available in the generic OpenAI client:

```python
# Key management
key = client.key.generate(models=["gpt-4"], max_budget=100.0, budget_duration="30d")
client.key.delete(key_id=key.key_id)

# Spend tracking
spend = client.spend.list(start_date="2025-01-01", end_date="2025-01-31")

# Model management
client.model.create(model_name="my-ft-model", litellm_params={"model": "ft:gpt-4:hanzo:abc123"})

# Team and org management
team = client.team.create(team_alias="ml-research", max_budget=500.0, models=["gpt-4"])
org = client.organization.list()
```

### Package Structure

| SDK | Entry Point | Structure | Dependencies | Min Version |
|-----|-------------|-----------|-------------|-------------|
| Python | `pkg/hanzoai/_client.py` | `resources/`, `types/`, `_streaming.py` | `httpx`, `pydantic`, `anyio` | Python >= 3.12 |
| TypeScript | `src/index.ts` | `resources/`, `streaming.ts`, `error.ts` | None (native `fetch`) | TypeScript >= 4.7 |
| Go | `client.go` | Flat files per resource, `option/`, `internal/` | None (stdlib only) | Go >= 1.21 |
| Rust | `crates/` workspace | `hanzo-guard`, `hanzo-extract`, `hanzo-pqc`, `hanzo-kbs` | `reqwest`, `serde`, `tokio` | Rust 2021 edition |

All SDKs follow the same resource structure: each API namespace (chat, embeddings, images, audio, files, models, fine-tuning) maps to a separate module/file with typed request parameters and response models.

### Testing

Each SDK ships with three categories of tests: **unit tests** (mock HTTP, no network), **integration tests** (real API calls against sandbox), and **Prism tests** (Stainless mock server validating against the OpenAPI spec). Run via `uv run pytest` (Python), `yarn test` (TypeScript), `go test ./...` (Go), or `cargo test` (Rust).

## Security Considerations

### API Key Protection

- **Never logged**: API keys are redacted in all log output, even at `debug` level. The redaction pattern replaces the key with `sk-han...REDACTED`.
- **Never serialized**: API keys are excluded from `repr()`, `toString()`, `fmt.Stringer`, and `Debug` trait implementations.
- **Memory handling**: Keys are stored in memory only for the lifetime of the client. SDKs do not write keys to disk, temporary files, or crash dumps.
- **Environment precedence**: Constructor parameter > environment variable. This prevents environment pollution from overriding explicit configuration.

### Transport Security

- **TLS 1.3 required**: All SDKs enforce TLS 1.2 minimum, with TLS 1.3 preferred. Connections using TLS 1.0 or 1.1 are rejected.
- **Certificate validation**: TLS certificate validation is always enabled. There is no configuration option to disable it. Self-signed certificates for development must be added to the system trust store.
- **Connection reuse**: SDKs use HTTP/1.1 keep-alive (or HTTP/2 where supported) to amortize TLS handshake cost across requests.

### Key Rotation and Org-Scoped Access

API keys can be rotated without downtime: generate a new key, update the client configuration, delete the old key. SDKs do not cache keys between requests, so updates take effect immediately.

API keys are scoped to an organization. A key created for org `hanzo` cannot access resources in org `lux`. This is enforced server-side by the LLM Gateway (HIP-4). The `organization` constructor parameter sets the `X-Hanzo-Organization` header on all requests.

### Input Validation and Dependency Security

SDKs validate inputs client-side before sending requests. Required fields raise errors at call time (not after a network round-trip). Type checking is enforced by Pydantic (Python), the TypeScript compiler, the Go compiler, and the Rust compiler. Enum parameters are validated against allowed values.

The TypeScript and Go SDKs have zero runtime dependencies, eliminating supply chain risk. Python pins minimum secure versions (`h11>=0.16.0`, `urllib3>=2.6.0`). Rust uses `deny.toml` for dependency auditing.

## Compatibility

All OpenAI-compatible endpoints (chat completions, streaming, embeddings, images, audio, files, fine-tuning, moderations) are fully drop-in compatible. The Assistants API is supported via passthrough. Hanzo-specific extensions (key management, budget tracking, multi-provider routing, team management) are additive and do not break OpenAI compatibility.

Through the LLM Gateway (HIP-4), the SDKs provide access to 100+ AI providers including OpenAI, Anthropic, Google Gemini, AWS Bedrock, Azure OpenAI, Mistral, Cohere, Together AI, Ollama, and Zen (Hanzo). The model identifier in the request determines the provider. The SDKs are provider-agnostic; routing is handled by the gateway.

## References

1. [Stainless](https://www.stainless.com/) - API SDK generation platform
2. [OpenAPI Specification](https://spec.openapis.org/oas/v3.1.0) - API description format
3. [HIP-4: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md) - Unified AI provider interface (backend for all SDK requests)
4. [HIP-26: Identity & Access Management](./hip-0026-identity-access-management-standard.md) - OAuth token validation for SDK authentication
5. [HIP-38: Admin Console](./hip-0038-admin-console-standard.md) - Key management and budget UI
6. [OpenAI API Reference](https://platform.openai.com/docs/api-reference) - Wire-compatible API specification
7. [Server-Sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html) - Streaming protocol specification
8. [RFC 6750](https://datatracker.ietf.org/doc/html/rfc6750) - Bearer Token Usage (authentication scheme)
9. [Hanzo Python SDK](https://github.com/hanzoai/python-sdk) - Python client library
10. [Hanzo JS SDK](https://github.com/hanzoai/js-sdk) - TypeScript/JavaScript client library
11. [Hanzo Go SDK](https://github.com/hanzoai/go-sdk) - Go client library
12. [Hanzo Rust SDK](https://github.com/hanzoai/rust-sdk) - Rust client library
13. [Hanzo API Docs](https://docs.hanzo.ai) - Full API documentation

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
