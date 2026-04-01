---
hip: 0301
title: Agent Runtime Protocols & Cross-Platform Parity
author: Hanzo AI
type: Standards Track
category: Core
status: Draft
created: 2026-03-31
requires: HIP-9, HIP-10, HIP-300
---

# HIP-0301: Agent Runtime Protocols & Cross-Platform Parity

## Abstract

Standardize the agent runtime layer across all Hanzo platforms (Rust CLI/TUI, Python CLI/TUI, JS/TS CLI, Web UI, multi-channel bot). Covers protocol abstractions, MCP client transport, SSE parsing, hierarchical configuration, session compaction, OAuth PKCE, permission management, LSP integration, hook execution, sandboxing, input modes, git operations, multi-provider auth, agent subcommands, WebSocket bridging, Rust utility crates, package naming, and a cross-platform conformance test suite ensuring identical behavior across Python, Rust, and JS.

## Platforms

| Platform | Package | Status |
|----------|---------|--------|
| Rust CLI/TUI | @hanzo/dev (hanzo-dev crate) | Production |
| Python CLI/TUI | hanzo-dev (PyPI) | Production |
| JS/TS CLI | @hanzo/dev (npm) | Production |
| Web UI | hanzo/cloud | Production |
| Multi-channel bot | @hanzo/bot | Production |

## Motivation

Analysis of clean-room agent harness implementations revealed architectural patterns that improve testability, security, and extensibility of the SDK's agent runtime. These patterns address concrete gaps:

1. **Stubbed MCP client** - No JSON-RPC transport; tool listing returns empty
2. **Missing permission data model** - No structured representation of allow/deny/prompt decisions
3. **No session compaction** - Long-running agents hit context limits with no recovery
4. **Flat configuration** - Single config source, no project-level overrides or MCP server discovery
5. **Basic SSE parsing** - Frame boundaries split across chunk boundaries cause dropped events
6. **No PKCE** - OAuth flow uses plain challenge method, violating OAuth 2.1
7. **No LSP integration** - Agents lack IDE-quality code intelligence
8. **No hook system** - No way to run pre/post checks on tool execution
9. **No sandboxing** - Filesystem access is unrestricted
10. **No cross-platform conformance** - Python, Rust, and JS implementations diverge silently

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

### 8. LSP Client

Package: `hanzo-lsp`. Subprocess-based Language Server Protocol client providing code intelligence to the agent runtime.

```python
class LspClient:
    """Manages an LSP server subprocess and dispatches requests."""

    def __init__(self, command: list[str], root_uri: str): ...

    async def start(self) -> None:
        """Spawn the LSP server, send initialize/initialized."""
        ...

    async def diagnostics(self, uri: str) -> list[Diagnostic]: ...
    async def goto_definition(self, uri: str, line: int, col: int) -> Location | None: ...
    async def find_references(self, uri: str, line: int, col: int) -> list[Location]: ...
    async def hover(self, uri: str, line: int, col: int) -> str | None: ...
    async def shutdown(self) -> None: ...
```

**Key types:**

| Type | Fields |
|------|--------|
| `Diagnostic` | `{uri: str, range: Range, severity: int, message: str, source: str}` |
| `Location` | `{uri: str, range: Range}` |
| `Range` | `{start: Position, end: Position}` |
| `Position` | `{line: int, character: int}` |

**Context enrichment:** Diagnostics and hover info are injected into the system prompt as structured context before tool calls that read or edit files. This gives the agent IDE-quality awareness of type errors, unused imports, and symbol locations without requiring the user to paste compiler output.

**Integration:** The `LspClient` is started lazily on first file-related tool use. The agent runtime detects the project language and spawns the appropriate server (e.g., `pyright` for Python, `rust-analyzer` for Rust, `typescript-language-server` for TS).

### 9. Hook Runner

Package: `hanzo-hooks`. Pre/post tool use hooks executed as shell scripts, enabling policy enforcement and side effects outside the agent loop.

```python
@dataclass
class HookConfig:
    event: str            # "pre_tool_use" | "post_tool_use"
    command: str          # Shell command to execute
    tool_pattern: str     # Glob pattern matching tool names
    timeout_ms: int = 5000

class HookRunner:
    """Executes hooks before/after tool invocations."""

    def __init__(self, hooks: list[HookConfig]): ...

    async def run_pre(self, tool_name: str, input: dict) -> HookResult:
        """Run matching pre-hooks. Exit code semantics:
        0 = allow, 2 = deny. Any other code = error (deny + log)."""
        ...

    async def run_post(self, tool_name: str, input: dict, result: ToolResult) -> None:
        """Run matching post-hooks. Failures are logged, never block."""
        ...
```

**Exit code semantics:**

| Exit Code | Meaning |
|-----------|---------|
| 0 | Allow - tool execution proceeds |
| 2 | Deny - tool execution blocked, denial reason from stderr |
| Other | Error - tool execution blocked, error logged |

**Environment:** Hook scripts receive `HANZO_TOOL_NAME`, `HANZO_TOOL_INPUT` (JSON), and `HANZO_SESSION_ID` as environment variables. Post-hooks additionally receive `HANZO_TOOL_OUTPUT`.

**Integration:** `HookRunner` is invoked by the agent loop between permission evaluation (Section 7) and actual tool execution. Pre-hook denial overrides an `ALLOW` permission decision. Hook configs are defined in `HanzoConfig.hooks` (Section 4).

### 10. Sandbox

Package: `hanzo-sandbox`. Container detection and filesystem isolation for tool execution.

```python
class IsolationMode(Enum):
    OFF = "off"                       # No filesystem restrictions
    WORKSPACE_ONLY = "workspace"      # Restrict to project root
    ALLOW_LIST = "allowlist"          # Restrict to explicit paths

@dataclass
class SandboxConfig:
    mode: IsolationMode = IsolationMode.WORKSPACE_ONLY
    allowed_paths: list[str] = field(default_factory=list)

class Sandbox:
    """Filesystem isolation and container detection."""

    def __init__(self, config: SandboxConfig, workspace: Path): ...

    def check_path(self, path: Path) -> bool:
        """Return True if the path is allowed under current isolation mode."""
        ...

    @staticmethod
    def detect_container() -> str | None:
        """Detect container runtime. Returns 'docker', 'podman', 'k8s', or None."""
        ...
```

**Container detection:** Checks `/proc/1/cgroup`, `/.dockerenv`, `/run/.containerenv`, and `KUBERNETES_SERVICE_HOST` in order. When running inside a container, the default isolation mode is `OFF` (the container itself is the sandbox).

**Linux unshare:** On Linux hosts (not in containers), `WORKSPACE_ONLY` mode uses `unshare(2)` to create a mount namespace with a read-only bind mount of `/` and a read-write bind mount of the workspace. This is a best-effort enhancement; the mode falls back to path checking when unshare is unavailable.

**Integration:** `Sandbox.check_path()` is called by `ToolExecutor` before any filesystem operation. Path violations return a `ToolResult` with `is_error=True` and a message describing the denied path.

### 11. Vim Keybindings

Input mode system for the TUI, implementing a subset of Vim motions sufficient for efficient command-line editing.

**Modes:**

| Mode | Entry | Behavior |
|------|-------|----------|
| Insert | `i`, `a`, `o`, `A`, `I` from Normal | Characters inserted at cursor |
| Normal | `Esc` from Insert | Motions and operators apply to buffer |
| Visual | `v` from Normal | Selection between anchor and cursor |
| Command | `:` from Normal | Ex-style commands (`:w`, `:q`, `:set`) |

**Supported motions:** `h`, `j`, `k`, `l`, `w`, `b`, `e`, `0`, `$`, `^`, `gg`, `G`, `f<char>`, `t<char>`.

**Supported operators:** `d` (delete), `c` (change), `y` (yank), `p`/`P` (paste). Operators compose with motions: `dw`, `ci"`, `yy`.

**Two-char sequences:** `dd` (delete line), `yy` (yank line), `cc` (change line), `gg` (go to top). Handled via a pending-operator state machine with a 500ms timeout.

**Integration:** The keybinding mode is configured in `HanzoConfig` as `input_mode: "vim" | "emacs" | "default"`. The TUI input handler dispatches to the appropriate mode handler. Vim mode state (current mode, register, pending operator) is per-input-widget.

### 12. Git Slash Commands

Built-in slash commands for common git workflows, executed as subprocess calls to `git`.

| Command | Behavior |
|---------|----------|
| `/branch <name>` | `git checkout -b <name>` from current HEAD |
| `/commit` | Stage tracked changes, generate commit message from diff, `git commit` |
| `/commit-push-pr` | `/commit` + `git push -u origin HEAD` + `gh pr create` |
| `/worktree <name>` | `git worktree add ../<repo>-<name> -b <name>` |
| `/diff` | `git diff` of staged + unstaged, injected as context |
| `/stash` | `git stash push -m "hanzo: <timestamp>"` |

**Commit message generation:** The diff output is sent to the model with a system prompt requesting a conventional-commit-formatted message. The user is shown the proposed message and can accept or edit before commit.

**Integration:** Slash commands are registered in the agent's command table alongside tool-based commands. They do not go through the permission system (they are user-initiated, not agent-initiated).

### 13. Multi-Provider Auth

Unified authentication supporting multiple LLM providers with provider-specific OAuth flows.

```python
class AuthProvider(Enum):
    ANTHROPIC = "anthropic"   # PKCE authorization code
    OPENAI = "openai"         # Device code flow
    HANZO = "hanzo"           # PKCE authorization code via hanzo.id

@dataclass
class ProviderCredential:
    provider: AuthProvider
    access_token: str
    refresh_token: str | None
    expires_at: float

class CredentialStore:
    """Manages credentials for multiple providers."""

    def __init__(self, path: Path = DEFAULT_CREDENTIALS_PATH): ...

    def get(self, provider: AuthProvider) -> ProviderCredential | None: ...
    def store(self, cred: ProviderCredential) -> None: ...
    def refresh(self, provider: AuthProvider) -> ProviderCredential: ...
```

**Auto-detect:** When no explicit provider is configured, the auth system checks for credentials in order: Hanzo, Anthropic, OpenAI. The first valid credential wins.

**Credential storage:** All credentials stored in `~/.config/hanzo/credentials.json` with `0600` permissions. Keyed by provider name. Atomic writes via temp file + `os.rename`.

**Integration:** Extends the `OAuthFlow` from Section 6 with provider-specific endpoints and flow types. The `CredentialStore` replaces direct file reads in the current auth module.

### 14. Agent Commands

Slash commands that delegate to subagent instances with role-specific system prompts.

| Command | System Prompt Prefix | Behavior |
|---------|---------------------|----------|
| `/plan` | "You are a planning agent..." | Analyze task, produce step-by-step plan. No tool use. |
| `/solve` | "You are a problem-solving agent..." | Reason through a problem. Read-only tool access. |
| `/code` | "You are a coding agent..." | Implement changes. Full tool access. |
| `/auto` | "You are an autonomous agent..." | Execute plan end-to-end. Full tool access + self-review. |

**Subagent lifecycle:** Each command spawns a new agent loop with the specified system prompt prepended to the user's instruction. The subagent shares the parent's `HanzoConfig`, `PermissionPolicy`, and `HookRunner`. Conversation history is isolated; the subagent receives only the user's instruction and the current file context.

**Integration:** Agent commands are registered as slash commands. The `/auto` command chains `/plan` then `/code` then `/solve` (for review) in sequence, passing each stage's output as context to the next.

### 15. WebSocket DevBridge

Go controller that bridges the hanzo/cloud web UI to the `hanzo-app-server` backend via WebSocket.

```go
type DevBridge struct {
    Server      *http.Server
    AppAddr     string            // hanzo-app-server address
    AllowOrigin []string          // validated origins
}

func (b *DevBridge) HandleWS(w http.ResponseWriter, r *http.Request) {
    // 1. Validate Origin header against AllowOrigin
    // 2. Extract and verify JWT from Hanzo IAM
    // 3. Upgrade to WebSocket
    // 4. Bidirectional proxy: WS frames <-> app-server JSON-RPC
}
```

**Auth:** Every WebSocket connection requires a valid Hanzo IAM JWT. The `owner` claim scopes all downstream requests to the user's organization.

**Origin validation:** The `Origin` header is checked against an explicit allow-list. Connections from unrecognized origins are rejected with 403.

**Protocol:** Client sends JSON-RPC requests as WebSocket text frames. The bridge forwards to `hanzo-app-server` over HTTP, streams SSE responses back as WebSocket text frames. Binary frames are rejected.

**Integration:** Deployed as a sidecar in the hanzo/cloud K8s pod. The web UI connects to the bridge instead of directly to the app server, gaining auth enforcement and origin validation.

### 16. Rust Utility Crates

Standalone Rust crates extracted from the hanzo-dev runtime for reuse across the ecosystem.

#### hanzo-sse

Zero-dependency SSE frame parser. Rust equivalent of Section 3.

```rust
pub struct SseFrameBuffer {
    buffer: String,
}

impl SseFrameBuffer {
    pub fn feed(&mut self, chunk: &str) -> Vec<SseFrame>;
}

pub struct SseFrame {
    pub event: Option<String>,
    pub data: String,
    pub id: Option<String>,
    pub retry: Option<u64>,
}
```

#### hanzo-backoff

Overflow-safe exponential retry with jitter.

```rust
pub struct Backoff {
    base_ms: u64,
    max_ms: u64,
    attempt: u32,
}

impl Backoff {
    pub fn next_delay(&mut self) -> Duration;
    pub fn reset(&mut self);
}
```

Uses `saturating_mul` and `saturating_pow` to prevent overflow at high attempt counts. Jitter is full-jitter (uniform random in `[0, delay]`).

#### hanzo-md-render

Streaming Markdown renderer with syntax highlighting for TUI output.

```rust
pub struct MdRenderer {
    theme: Theme,
}

impl MdRenderer {
    pub fn render_chunk(&mut self, chunk: &str) -> Vec<StyledSpan>;
    pub fn flush(&mut self) -> Vec<StyledSpan>;
}
```

Handles incremental input: code fences are buffered until closed, then syntax-highlighted in a single pass. Inline formatting (bold, italic, code) is applied per-chunk.

### 17. hanzo-dev Package Rename

The `hanzo-repl` crate/package is renamed to `hanzo-dev` across all platforms to align with the `@hanzo/dev` naming convention.

| Before | After |
|--------|-------|
| `hanzo-repl` (crate) | `hanzo-dev` (crate) |
| `hanzo-repl` (PyPI) | `hanzo-dev` (PyPI) |
| `@hanzo/repl` (npm) | `@hanzo/dev` (npm) |

**Migration:** The old package names are reserved and publish a single version that re-exports from the new name with a deprecation warning. The old names will be yanked after 90 days.

### 18. Cross-Platform Parity

Unified conformance test suite verifying that Python, Rust, and JS implementations produce identical results for core behaviors.

**Test domains:**

| Domain | What is verified |
|--------|-----------------|
| SSE parsing | Identical frame output for 50+ edge-case inputs (split chunks, empty data, multi-line data, BOM, retry fields) |
| MCP normalization | Tool name `mcp__<server>__<tool>` produced identically across platforms for the same server/tool input |
| Permission policy | Same rule set produces same `evaluate()` result for same tool name across platforms |
| Session compaction | Same message list + token budget produces same compacted output (modulo summary text) |
| OAuth PKCE | Same verifier produces same S256 challenge across platforms |
| Config loading | Same file hierarchy produces same merged `HanzoConfig` across platforms |
| Backoff timing | Same attempt sequence produces same delay sequence (within jitter bounds) |

**Test format:** Test vectors are stored as JSON files in `test-vectors/`. Each platform's test runner loads the same vectors and asserts identical output. The vectors are the source of truth; platform implementations conform to them.

**CI:** A single CI job runs all three platform test suites against the shared vectors. A platform cannot merge if its output diverges from the vectors.

## Rationale

**Protocol abstractions** enable mock-based testing without network calls. The current SDK requires a live API connection to test agent loop logic.

**Hierarchical config** follows the established pattern used by git and VS Code. Teams share project-level MCP server configurations while individual developers override locally.

**Session compaction** prevents unbounded context growth in long-running agent sessions. Without compaction, agents that run for more than ~30 turns hit context limits and fail.

**PKCE** is required by OAuth 2.1 (RFC 9126) and prevents authorization code interception attacks.

**SSE frame buffering** fixes a class of bugs where network chunking splits an SSE event across two TCP segments.

**Permission data model** enables both interactive and policy-driven permission management.

**LSP integration** gives agents the same code intelligence humans get from IDEs, reducing hallucinated symbol names and missed type errors.

**Hook runner** enables enterprise policy enforcement (e.g., blocking writes to production configs) without modifying the agent runtime itself.

**Sandbox** prevents filesystem escapes. Container detection avoids double-sandboxing overhead.

**Cross-platform parity** ensures users get identical behavior regardless of which platform they use. The shared test vectors are the specification.

## Reference Implementation

### Python SDK (`hanzoai` package, `python-sdk/pkg/hanzoai/`)

| File | Component |
|------|-----------|
| `protocols.py` | `ToolExecutor`, `PermissionPrompter`, `ApiClient` protocols |
| `mcp.py` | `McpConnection`, `StdioMcpTransport`, `HttpMcpTransport` |
| `config.py` | `HanzoConfig`, `load_config()`, hierarchical merging |
| `session.py` | `SessionCompactor`, compaction strategy |
| `auth.py` | `PkceChallenge`, `OAuthFlow`, `CredentialStore` |
| `_streaming.py` | `SseFrameBuffer` |
| `permissions.py` | `PermissionMode`, `PermissionRule`, `PermissionPolicy` |
| `lsp.py` | `LspClient` |
| `hooks.py` | `HookRunner`, `HookConfig` |
| `sandbox.py` | `Sandbox`, `SandboxConfig`, `IsolationMode` |

### Rust crates (`hanzo-dev` workspace)

| Crate | Component |
|-------|-----------|
| `hanzo-dev` | TUI runtime, vim keybindings, slash commands, agent commands |
| `hanzo-sse` | `SseFrameBuffer` |
| `hanzo-backoff` | `Backoff` |
| `hanzo-md-render` | `MdRenderer` |
| `hanzo-lsp` | `LspClient` |
| `hanzo-hooks` | `HookRunner` |
| `hanzo-sandbox` | `Sandbox` |

### Go services

| Package | Component |
|---------|-----------|
| `devbridge` | WebSocket DevBridge controller |

### Cross-platform test vectors (`test-vectors/`)

| File | Domain |
|------|--------|
| `sse-frames.json` | SSE parsing edge cases |
| `mcp-normalization.json` | Tool name normalization |
| `permission-policy.json` | Rule evaluation |
| `session-compaction.json` | Compaction output |
| `oauth-pkce.json` | PKCE challenge generation |
| `config-merge.json` | Hierarchical config merging |
| `backoff-timing.json` | Retry delay sequences |

## Security Considerations

- **PKCE** prevents authorization code interception attacks by binding the authorization request to the token exchange via a cryptographic verifier
- **Permission data model** enables audit trails for every tool execution decision, supporting compliance requirements
- **Credential storage** uses atomic writes (`write` + `os.rename`) to prevent partial/corrupt credential files, with `0600` permissions
- **Hierarchical config scoping** prevents project configs from setting `api_key` or `oauth_credentials`
- **MCP tool name normalization** prevents tool name collisions that could cause one MCP server's tool to shadow another's
- **Hook runner** exit code 2 (deny) cannot be overridden by the agent; only the user can modify hook configs
- **Sandbox** path traversal attacks (e.g., `../../etc/passwd`) are caught by canonicalizing paths before checking against the allow list
- **WebSocket DevBridge** validates both JWT and Origin header, preventing CSRF-style WebSocket hijacking
- **Multi-provider credentials** are stored with `0600` permissions and never logged or included in error messages

## References

1. [HIP-9: Agent SDK](./hip-0009-agent-sdk-multi-agent-orchestration-framework.md)
2. [HIP-10: MCP Integration Standards](./hip-0010-model-context-protocol-mcp-integration-standards.md)
3. [HIP-300: Unified MCP Tools Architecture](./hip-0300-unified-mcp-tools-architecture.md)
4. [RFC 7636: PKCE for OAuth](https://datatracker.ietf.org/doc/html/rfc7636)
5. [RFC 9126: OAuth 2.0 Pushed Authorization Requests](https://datatracker.ietf.org/doc/html/rfc9126)
6. [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)
7. [Server-Sent Events (W3C)](https://html.spec.whatwg.org/multipage/server-sent-events.html)
8. [Language Server Protocol Specification](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/)
9. [RFC 8628: OAuth 2.0 Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
