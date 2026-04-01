---
hip: 0301
title: Python SDK Agent Runtime Protocols
author: Hanzo AI
type: Standards Track
category: Core
status: Draft
created: 2026-03-31
requires: HIP-9, HIP-10, HIP-300
---

# HIP-0301: Python SDK Agent Runtime Protocols

## Abstract

Standardize protocol abstractions for the Hanzo Python SDK's agent runtime layer, covering tool execution, permission management, conversation lifecycle, session compaction, hierarchical configuration, and MCP client transport.

## Motivation

Analysis of clean-room agent harness implementations (claw-code) revealed architectural patterns that improve testability, security, and extensibility of the SDK's agent runtime. These patterns address concrete gaps in the current SDK:

1. **Stubbed MCP client** - No JSON-RPC transport; tool listing returns empty
2. **Missing permission data model** - No structured representation of allow/deny/prompt decisions
3. **No session compaction** - Long-running agents hit context limits with no recovery
4. **Flat configuration** - Single config source, no project-level overrides or MCP server discovery
5. **Basic SSE parsing** - Frame boundaries split across chunk boundaries cause dropped events
6. **No PKCE** - OAuth flow uses plain challenge method, violating OAuth 2.1

## Specification

### 1. MCP Client Protocol

JSON-RPC 2.0 client supporting stdio and HTTP transports for connecting to MCP tool servers.

```python
class McpConnection(Protocol):
    """Transport-agnostic MCP connection."""

    async def send(self, request: JsonRpcRequest) -> JsonRpcResponse: ...
    async def close(self) -> None: ...

class StdioMcpTransport:
    """Spawns MCP server as subprocess, communicates over stdin/stdout."""

    def __init__(self, command: list[str], env: dict[str, str] | None = None): ...
    async def connect(self) -> McpConnection: ...

class HttpMcpTransport:
    """Connects to MCP server over HTTP+SSE."""

    def __init__(self, url: str, headers: dict[str, str] | None = None): ...
    async def connect(self) -> McpConnection: ...
```

Tool names from MCP servers are normalized to `mcp__<server>__<tool>` to prevent collisions across servers. The client maintains a tool cache refreshed on `tools/list` responses, with cache invalidation on `notifications/tools/list_changed`.

**Key types:**

| Type | Description |
|------|-------------|
| `JsonRpcRequest` | `{jsonrpc: "2.0", method: str, params: dict, id: str}` |
| `JsonRpcResponse` | `{jsonrpc: "2.0", result: Any, id: str}` or error variant |
| `McpToolDefinition` | `{name: str, description: str, input_schema: dict}` |
| `McpServerConfig` | `{command: list[str], env: dict, args: list[str]}` |

**Integration:** The `McpConnection` protocol replaces the current stubbed `_mcp_client` attribute on `ApiClient`. Existing `tools/execute` calls route through the connection when the tool name matches the `mcp__` prefix pattern.

**Backwards compatibility:** Tools without the `mcp__` prefix continue routing to the Hanzo API as before. The `McpConnection` protocol is optional; agents function without MCP servers configured.

### 2. Protocol Abstractions

Three core protocols enabling dependency injection and mock-based testing.

```python
class ToolExecutor(Protocol):
    """Executes a tool by name with given input."""

    async def execute(
        self, name: str, input: dict, session_id: str
    ) -> ToolResult: ...

class PermissionPrompter(Protocol):
    """Asks the user (or policy engine) for tool execution permission."""

    async def request_permission(
        self, tool_name: str, input: dict
    ) -> PermissionDecision: ...

class ApiClient(Protocol):
    """Sends messages to the model API and yields streaming responses."""

    async def send_message(
        self, messages: list[Message], tools: list[ToolDef]
    ) -> AsyncIterator[StreamEvent]: ...
```

**Key types:**

| Type | Fields |
|------|--------|
| `ToolResult` | `{output: str, error: str \| None, is_error: bool}` |
| `PermissionDecision` | `Allow \| Deny(reason: str) \| Escalate` |
| `StreamEvent` | `ContentDelta \| ToolUse \| MessageStop \| Error` |

**Integration:** The agent runtime loop accepts these protocols as constructor arguments instead of concrete implementations. Production code passes the real implementations; tests pass mocks.

**Backwards compatibility:** Existing concrete classes implement these protocols implicitly via structural subtyping. No existing call sites change.

### 3. SSE Parser Hardening

Replace the current line-by-line SSE parser with a stateful frame buffer that handles chunk boundaries correctly.

```python
class SseFrameBuffer:
    """Accumulates raw bytes and yields complete SSE frames."""

    def __init__(self) -> None:
        self._buffer: str = ""

    def feed(self, chunk: str) -> list[SseFrame]:
        """Feed a chunk of data, return any complete frames."""
        self._buffer += chunk
        frames: list[SseFrame] = []
        while "\n\n" in self._buffer:
            raw_frame, self._buffer = self._buffer.split("\n\n", 1)
            frames.append(self._parse_frame(raw_frame))
        return frames

    @staticmethod
    def _parse_frame(raw: str) -> SseFrame: ...
```

**Key types:**

| Type | Fields |
|------|--------|
| `SseFrame` | `{event: str \| None, data: str, id: str \| None, retry: int \| None}` |

**Integration:** Replaces the existing `_process_sse_line` method in `_streaming.py`. The `SseFrameBuffer` is instantiated per-request and fed raw chunks from the HTTP response body.

**Backwards compatibility:** The public `Stream` and `AsyncStream` interfaces are unchanged. Only the internal parsing strategy changes.

### 4. Hierarchical Configuration

Three-tier configuration: User (`~/.config/hanzo/settings.json`) > Project (`.hanzo/settings.json`) > Local (`.hanzo/settings.local.json`). Lower tiers override higher. Local tier is gitignored.

```python
@dataclass(frozen=True)
class HanzoConfig:
    """Merged configuration from all tiers."""

    api_key: str | None = None
    model: str = "claude-sonnet-4-20250514"
    mcp_servers: dict[str, McpServerConfig] = field(default_factory=dict)
    permissions: dict[str, PermissionMode] = field(default_factory=dict)
    custom_instructions: str = ""

def load_config(project_root: Path | None = None) -> HanzoConfig:
    """Load and merge configs: user < project < local."""
    ...
```

**MCP server discovery:** The `mcp_servers` field at each tier is merged by server name. A server defined in the project tier can be disabled in the local tier by setting `"disabled": true`.

**Sensitive fields:** `api_key` and `oauth_credentials` can only be set in the user tier. Project and local tiers attempting to set these fields are ignored with a warning logged.

**Integration:** `load_config()` is called once at agent startup. The resulting `HanzoConfig` is passed to the agent runtime constructor, replacing the current flat `os.environ`-based configuration.

**Backwards compatibility:** Environment variables (`HANZO_API_KEY`, `HANZO_MODEL`) continue to work and take highest precedence. The config file tiers fill in values not set via environment.

### 5. Session Compaction

Token-budget-aware compaction that preserves the system prompt, recent messages, and a summary of compacted history.

```python
class SessionCompactor:
    """Compacts conversation history to fit within token budget."""

    def __init__(self, max_tokens: int, reserve_recent: int = 3): ...

    def compact(self, messages: list[Message]) -> list[Message]:
        """Return compacted message list fitting within max_tokens.

        Strategy:
        1. System prompt always preserved (index 0)
        2. Last `reserve_recent` turns always preserved
        3. Middle messages summarized into a single assistant message
        4. Tool results in compacted range replaced with "[compacted]"
        """
        ...
```

**Key types:**

| Type | Description |
|------|-------------|
| `Message` | Existing SDK message type with `role`, `content`, `token_count` |
| `CompactionResult` | `{messages: list[Message], compacted_count: int, tokens_saved: int}` |

**Integration:** The agent loop calls `compact()` before each API request when the total token count exceeds `max_tokens * 0.9`. The compaction summary is generated by the model itself via a dedicated summarization call, or falls back to truncation if the summarization call fails.

**Backwards compatibility:** Compaction is opt-in. When `max_tokens` is not configured, the agent loop behaves as before with no compaction.

### 6. OAuth PKCE

S256 challenge method for the authorization code flow, with atomic credential persistence.

```python
class PkceChallenge:
    """PKCE S256 challenge for OAuth 2.1 compliance."""

    verifier: str   # 43-128 char random string, base64url-encoded
    challenge: str  # SHA-256 hash of verifier, base64url-encoded

    @classmethod
    def generate(cls) -> PkceChallenge:
        """Generate a new PKCE verifier/challenge pair."""
        ...

class OAuthFlow:
    """OAuth 2.1 authorization code flow with PKCE."""

    def __init__(self, client_id: str, redirect_uri: str, token_url: str): ...

    async def authorize(self, auth_url: str, scopes: list[str]) -> TokenResponse:
        """Run the full PKCE flow: generate challenge, open browser,
        listen for callback, exchange code."""
        ...
```

**Credential persistence:** Tokens are written atomically (write to temp file, then `os.rename`) to `~/.config/hanzo/credentials.json` with `0600` permissions. Refresh token rotation is handled transparently.

**Integration:** Replaces the plain challenge method in the existing `auth.py` module. The `OAuthFlow` class is used by `load_config()` when no API key is configured and interactive auth is available.

**Backwards compatibility:** API key authentication continues to work and takes precedence. PKCE is only used for interactive OAuth flows.

### 7. Permission Data Model

Structured tracking of tool permission decisions with per-tool and per-server granularity.

```python
class PermissionMode(Enum):
    ALLOW = "allow"       # Execute without prompting
    DENY = "deny"         # Block execution, return denial message
    PROMPT = "prompt"     # Ask PermissionPrompter before execution

@dataclass
class PermissionRule:
    tool_pattern: str         # Glob pattern: "mcp__*", "fs.write", etc.
    mode: PermissionMode
    reason: str | None = None

class PermissionPolicy:
    """Evaluates permission rules for tool execution requests."""

    def __init__(self, rules: list[PermissionRule]) -> None: ...

    def evaluate(self, tool_name: str) -> PermissionMode:
        """Return the mode for a tool. First matching rule wins.
        Default is PROMPT if no rules match."""
        ...
```

**Audit trail:** Every permission evaluation is logged as a structured record: `{timestamp, tool_name, mode, rule_matched, session_id}`. Denials include the denial reason.

**Integration:** `PermissionPolicy` is constructed from the `permissions` field in `HanzoConfig` (Section 4). The agent loop calls `policy.evaluate(tool_name)` before executing any tool. When the result is `PROMPT`, the `PermissionPrompter` protocol (Section 2) is invoked.

**Backwards compatibility:** When no permission rules are configured, all tools default to `PROMPT` mode, matching current behavior where the agent prompts before every tool execution.

## Rationale

**Protocol abstractions** enable mock-based testing without network calls. The current SDK requires a live API connection to test agent loop logic. With `ToolExecutor`, `PermissionPrompter`, and `ApiClient` as protocols, tests inject controlled implementations.

**Hierarchical config** follows the established pattern in Claude Code, VS Code, and git. Teams share project-level MCP server configurations while individual developers override locally. The user tier provides secure defaults.

**Session compaction** prevents unbounded context growth in long-running agent sessions. Without compaction, agents that run for more than ~30 turns hit context limits and fail. The compaction strategy preserves the most recent context and a summary of earlier work.

**PKCE** is required by OAuth 2.1 (RFC 9126) and prevents authorization code interception attacks. The plain challenge method currently used is deprecated.

**SSE frame buffering** fixes a class of bugs where network chunking splits an SSE event across two TCP segments. The current line-by-line parser drops the partial event.

**Permission data model** enables both interactive and policy-driven permission management. The glob pattern matching allows broad rules (`mcp__*: allow`) alongside specific overrides (`mcp__server__dangerous_tool: deny`).

## Reference Implementation

All implementations target `hanzoai` package in `python-sdk/pkg/hanzoai/`:

| File | Component |
|------|-----------|
| `protocols.py` | `ToolExecutor`, `PermissionPrompter`, `ApiClient` protocols |
| `mcp.py` | `McpConnection`, `StdioMcpTransport`, `HttpMcpTransport` |
| `config.py` | `HanzoConfig`, `load_config()`, hierarchical merging |
| `session.py` | `SessionCompactor`, compaction strategy |
| `auth.py` | `PkceChallenge`, `OAuthFlow` (updated) |
| `_streaming.py` | `SseFrameBuffer` (updated) |
| `permissions.py` | `PermissionMode`, `PermissionRule`, `PermissionPolicy` |

## Security Considerations

- **PKCE** prevents authorization code interception attacks by binding the authorization request to the token exchange via a cryptographic verifier
- **Permission data model** enables audit trails for every tool execution decision, supporting compliance requirements
- **Credential storage** uses atomic writes (`write` + `os.rename`) to prevent partial/corrupt credential files, with `0600` permissions to prevent other-user reads
- **Hierarchical config scoping** prevents project configs from setting `api_key` or `oauth_credentials`, ensuring credentials are only sourced from the user tier or environment variables
- **MCP tool name normalization** prevents tool name collisions that could cause one MCP server's tool to shadow another's

## References

1. [HIP-9: Agent SDK](./hip-0009-agent-sdk-multi-agent-orchestration-framework.md)
2. [HIP-10: MCP Integration Standards](./hip-0010-model-context-protocol-mcp-integration-standards.md)
3. [HIP-300: Unified MCP Tools Architecture](./hip-0300-unified-mcp-tools-architecture.md)
4. [RFC 7636: PKCE for OAuth](https://datatracker.ietf.org/doc/html/rfc7636)
5. [RFC 9126: OAuth 2.0 Pushed Authorization Requests](https://datatracker.ietf.org/doc/html/rfc9126)
6. [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)
7. [Server-Sent Events (W3C)](https://html.spec.whatwg.org/multipage/server-sent-events.html)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
