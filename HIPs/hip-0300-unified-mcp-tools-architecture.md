# HIP-0300: Unified MCP Tools Architecture

| HIP | Title | Status | Author | Created |
|-----|-------|--------|--------|---------|
| 0300 | Unified MCP Tools Architecture | Draft | Hanzo AI Team | 2025-01-21 |

## Abstract

This HIP proposes consolidating hanzo-mcp's 52+ individual tools into 8 core orthogonal tools following Unix philosophy. Each tool handles one axis (bytes, processes, symbols, diffs, UI) with minimal overlap, composable via stable identifiers.

## Principles

1. **De-dupe**: One canonical way to do a thing; everything else is alias/shim
2. **Unify**: Identical envelope + paging + error model + path/range semantics
3. **Orthogonal**: Each tool does one axis with minimal overlap
4. **Composable**: Tools are pure-ish functions over stable IDs (uri, hash, proc_id), so agents can pipe outputs reliably

## Specification

### The 8 Core Tools

| Tool | Domain | Axis | Key Actions |
|------|--------|------|-------------|
| **ws** | Workspace | Context | detect, capabilities, help, schema |
| **fs** | Filesystem | Bytes + Paths | read, write, stat, list, apply_patch, search_text |
| **code** | Semantics | Symbols | definition, references, rename, format, diagnostics |
| **proc** | Processes | Execution | exec, ps, kill, logs |
| **test** | Testing | Verification | list, run, status |
| **vcs** | Version Control | Diffs + History | status, diff, apply, commit, branch |
| **net** | Network | HTTP/API | request, download, open |
| **ui** | Interface | Screen/Browser | click, type, screenshot, focus, record |

Optional (heavy dependencies):

| Tool | Domain | Key Actions |
|------|--------|-------------|
| **llm** | LLM Providers | query, stream, embed, consensus |
| **memory** | Persistent Storage | recall, create, update, facts |
| **hanzo** | Platform | cloud, deploy, auth, node |

### Hard De-dupe Rules (Non-negotiable)

#### 1. One Edit Primitive

Only `fs.apply_patch(base_hash=...)` mutates existing files.
- Prevents stale edits
- Enables transactions/replay
- Makes "review before apply" natural

```python
# The ONLY way to edit files
fs(action="apply_patch", uri="file:///...", patch="...", base_hash="abc123")
```

#### 2. One Search Primitive Per Axis

| Axis | Tool | Action |
|------|------|--------|
| Text (grep) | fs | `search_text` |
| Symbols | code | `search_symbol` |

Never mix these.

#### 3. One Execution Primitive

All command execution goes through `proc.exec`.
`test.run` is a normalized preset on top of it.

```python
# All execution
proc(action="exec", command="npm test")

# Testing (wrapper over proc.exec)
test(action="run", suite="unit")
```

#### 4. One Diff Primitive

- `vcs.diff` for repo diffs
- `fs.diff(hash_a, hash_b)` optional, content-hash based

### Unified Envelope

Every tool returns:

```json
{
  "ok": true,
  "data": { },
  "error": null,
  "meta": {
    "tool": "fs",
    "action": "read",
    "trace_id": "...",
    "backend": "ripgrep|lsp|...",
    "paging": { "cursor": null, "more": false }
  }
}
```

Error response (codes > strings):

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "CONFLICT",
    "message": "base_hash mismatch",
    "details": { "expected": "abc123", "actual": "def456" }
  },
  "meta": { }
}
```

### Composability Primitives

Stable identifiers for chaining outputs:

| ID | Format | Example |
|----|--------|---------|
| `uri` | `file:///...` always | `file:///src/main.py` |
| `hash` | Content hash from fs.read/stat | `sha256:abc123...` |
| `range` | `{start:{line,col}, end:{line,col}}` 0-based | `{start:{line:10,col:0}}` |
| `ref` | Log/blob handles | `stdout_ref:proc_123` |
| `symbol_id` | Stable IDs from LSP/TS | `sym:UserService.auth` |

**Example pipe:**

```
1. fs.search_text("error") → {matches:[{uri, range}]}
2. fs.read(uri, range+context) → {text, hash}
3. fs.apply_patch(uri, patch, base_hash=hash)
4. test.run()
5. vcs.diff()
```

No tool needs to "know" the others—just consumes normalized IDs.

### Tool Specifications

#### ws (Workspace)

| Action | Description | Returns |
|--------|-------------|---------|
| `detect` | Auto-detect project | `{root, languages, build, test, vcs, backends}` |
| `capabilities` | List available backends | `{lsp: [...], vcs: "git", ...}` |
| `help` | Tool manpage + examples | Markdown |
| `schema` | JSON Schema for all actions | JSON Schema |

#### fs (Filesystem)

| Action | Description | Key Params |
|--------|-------------|------------|
| `read` | Read file | `uri`, `range?`, `encoding?` |
| `write` | Create new file | `uri`, `content` |
| `stat` | File metadata | `uri` → `{size, hash, mtime}` |
| `list` | List directory | `uri`, `depth?`, `pattern?` |
| `mkdir` | Create directory | `uri` |
| `rm` | Remove (guarded) | `uri`, `confirm` |
| `apply_patch` | Edit file | `uri`, `patch`, `base_hash` |
| `search_text` | Ripgrep search | `pattern`, `path?`, `paging?` |
| `diff` | Content diff | `hash_a`, `hash_b` |

**Critical**: `apply_patch` is the ONLY mutation for existing files.

#### code (Semantics)

| Action | Description | Key Params |
|--------|-------------|------------|
| `definition` | Go to definition | `uri`, `position` |
| `references` | Find references | `uri`, `position` |
| `rename` | Rename symbol | `uri`, `position`, `new_name` |
| `format` | Format code | `uri`, `range?` |
| `diagnostics` | Get errors/warnings | `uri` |
| `search_symbol` | Search symbols | `query`, `scope?` |
| `hover` | Hover information | `uri`, `position` |
| `completion` | Code completion | `uri`, `position` |

Backends negotiated via `ws.capabilities`: LSP → TreeSitter → heuristic.
All results normalized to `{uri, range, snippet, symbol_id}`.

#### proc (Processes)

| Action | Description | Key Params |
|--------|-------------|------------|
| `exec` | Run command | `command`, `cwd?`, `env?`, `timeout?` |
| `ps` | List processes | `filter?` |
| `kill` | Kill process | `proc_id`, `signal?` |
| `logs` | Get process logs | `proc_id`, `tail?`, `since?` |

Returns: `{proc_id, exit_code, stdout_ref, stderr_ref}`

No filesystem edits or parsing—just runs things.

#### test (Testing)

| Action | Description | Key Params |
|--------|-------------|------------|
| `list` | List test suites | `path?` |
| `run` | Run tests | `suite?`, `filter?`, `parallel?` |
| `status` | Get test status | `run_id` |

Normalizes: `{pass, fail, skip, duration, failure_locations}`.

Opinionated wrapper over `proc.exec`.

#### vcs (Version Control)

| Action | Description | Key Params |
|--------|-------------|------------|
| `status` | Working tree status | - |
| `diff` | Show diff | `ref?`, `staged?` |
| `apply` | Apply patch | `patch` |
| `commit` | Create commit | `message`, `files?` |
| `branch` | Branch operations | `op` (list, create, delete) |
| `checkout` | Switch branch | `ref` |
| `log` | Commit history | `limit?`, `path?` |

Outputs diffs in unified patch format; integrates with `fs.apply_patch`.

#### net (Network)

| Action | Description | Key Params |
|--------|-------------|------------|
| `request` | HTTP request | `url`, `method`, `headers?`, `body?` |
| `download` | Download file | `url`, `output` |
| `open` | Open URL in browser | `url` |

Separate from `proc` to avoid "curl in shell" duplication.

#### ui (Interface)

| Action | Description | Key Params |
|--------|-------------|------------|
| `click` | Click at position | `x`, `y`, `button?` |
| `type` | Type text | `text` |
| `screenshot` | Capture screen | `region?` |
| `focus` | Focus window | `title?`, `pid?` |
| `record` | Start recording | `duration?` |
| `stop` | Stop recording | - |
| `session` | Record + analyze | `duration` |

Consolidates computer + screen tools.

### Built-in Actions (Every Tool)

| Action | Description |
|--------|-------------|
| `help` | Short manpage + examples |
| `schema` | JSON Schema for each action |
| `status` | Tool status (enabled, version, backend) |

### Modes (Convention, Not Tools)

| Mode | Allowed Actions |
|------|-----------------|
| `inspect` | read, search, diagnose only |
| `apply` | patch, rename |
| `verify` | test, run |
| `ship` | commit, tag, release |

Encoded as `meta.intent` hints or config, not baked into actions.

## Consolidation Mapping

```
# Old → New

# Filesystem (7 → 1)
read            → fs(action="read")
write           → fs(action="write")
edit            → fs(action="apply_patch")  # base_hash required
tree            → fs(action="list", depth=...)
find            → fs(action="list", pattern=...)
search          → fs(action="search_text")
ast             → code(action="search_symbol")

# Shell (8 → 1)
zsh/bash        → proc(action="exec")
ps              → proc(action="ps")
npx             → proc(action="exec", command="npx ...")
uvx             → proc(action="exec", command="uvx ...")
open            → net(action="open") or ui(action="focus")
curl            → net(action="request")
wget            → net(action="download")

# Computer (2 → 1)
computer        → ui(action="click|type|...")
screen          → ui(action="session|record|stop")

# Code (2 → 1)
lsp             → code(action="definition|references|...")
refactor        → code(action="rename|format|...")

# Git (implicit)
git commands    → vcs(action="status|diff|commit|...")

# Testing (new)
test runners    → test(action="run|list|status")
```

## Implementation

### Phase 1: Foundation

1. Implement `UnifiedToolBase` with envelope + schema/help
2. Implement `fs.apply_patch` with `base_hash` preconditions
3. Implement `ws.detect` / `ws.capabilities`

### Phase 2: Core Tools

4. Merge `lsp` + `refactor` → `code` with backend fallback
5. Merge `screen` + `computer` → `ui`
6. Wrap test runners into `test.run` over `proc.exec`

### Phase 3: Polish

7. Add paging/cursor support to all search/list actions
8. Implement `vcs` as thin wrapper over git
9. Add `net` for HTTP without shell

### Base Class

```python
class UnifiedToolBase(BaseTool):
    """Base for unified tools with action routing and envelope."""

    name: str
    _handlers: dict[str, Callable]
    _schemas: dict[str, dict]

    def action(self, name: str, schema: dict = None):
        """Decorator to register action handler with schema."""
        def decorator(fn):
            self._handlers[name] = fn
            if schema:
                self._schemas[name] = schema
            return fn
        return decorator

    async def call(self, ctx, action: str = "help", **kwargs) -> dict:
        if action == "help":
            return self._envelope({"actions": self._get_help()})
        if action == "schema":
            return self._envelope({"schemas": self._schemas})
        if action not in self._handlers:
            return self._error("UNKNOWN_ACTION", f"Unknown: {action}",
                             available=list(self._handlers.keys()))
        try:
            result = await self._handlers[action](ctx, **kwargs)
            return self._envelope(result, action=action)
        except ConflictError as e:
            return self._error("CONFLICT", str(e), details=e.details)
        except Exception as e:
            return self._error("ERROR", str(e))

    def _envelope(self, data, action=None, paging=None):
        return {
            "ok": True,
            "data": data,
            "error": None,
            "meta": {
                "tool": self.name,
                "action": action,
                "paging": paging or {"cursor": None, "more": False}
            }
        }

    def _error(self, code, message, **details):
        return {
            "ok": False,
            "data": None,
            "error": {"code": code, "message": message, **details},
            "meta": {"tool": self.name}
        }
```

### Entry Points

```toml
[project.entry-points."hanzo.tools"]
ws = "hanzo_tools.ws:TOOLS"
fs = "hanzo_tools.fs:TOOLS"
code = "hanzo_tools.code:TOOLS"
proc = "hanzo_tools.proc:TOOLS"
test = "hanzo_tools.test:TOOLS"
vcs = "hanzo_tools.vcs:TOOLS"
net = "hanzo_tools.net:TOOLS"
ui = "hanzo_tools.ui:TOOLS"

# Optional
llm = "hanzo_tools.llm:TOOLS"
memory = "hanzo_tools.memory:TOOLS"
hanzo = "hanzo_tools.hanzo:TOOLS"
```

## Anti-patterns to Avoid

1. **Mega-tool with 70 actions** - Kills orthogonality
2. **Multiple edit primitives** (edit/write/patch) - Pick `apply_patch`
3. **Mixing UI automation with semantic code ops** - Keep separate
4. **Non-normalized paths/ranges** - Agents hallucinate conversions
5. **Strings for errors** - Use typed error codes

## Rationale

### Why 8 Tools?

Each handles one orthogonal axis:
- **ws**: Project context
- **fs**: Bytes and paths
- **code**: Symbols and semantics
- **proc**: Process execution
- **test**: Verification
- **vcs**: History and diffs
- **net**: Network requests
- **ui**: Screen interaction

No overlap. Maximum composability.

### Why Clean Break?

- Deprecation paths add complexity
- Old clients can pin to v0.11.x
- New clients get clean API immediately
- Less code to maintain

### Why base_hash for Edits?

Prevents race conditions and stale edits:
```python
# Read file, get hash
result = fs(action="read", uri="file:///main.py")
hash = result["data"]["hash"]

# Edit with precondition
fs(action="apply_patch", uri="file:///main.py",
   patch="...", base_hash=hash)  # Fails if file changed
```

## Backwards Compatibility

**No backward compatibility.** This is a breaking change.

Clients using v0.11.x should:
1. Pin to `hanzo-mcp<0.12`
2. Or migrate to unified tools

## Security Considerations

- Same permission model applies
- Same sandboxing for file/shell operations
- `fs.rm` requires explicit `confirm=true`
- `proc.exec` respects existing restrictions

## Test Cases

1. **help action** - Returns manpage for all tools
2. **schema action** - Returns valid JSON Schema
3. **unknown action** - Returns structured error with available actions
4. **base_hash conflict** - Returns CONFLICT error with details
5. **paging** - Large results paginate correctly
6. **composability** - Pipe outputs chain without interpretation

## Implementation Status

### Python Implementation

Repository: `hanzo/mcp` (Python)

| Tool | Status | Actions |
|------|--------|---------|
| **proc** | ✅ Full | exec, ps, kill, logs, help |
| **fs** | ✅ Full | read, write, edit, patch, tree, find, search, info |
| **think** | ✅ Full | think, critic, review |
| **memory** | ✅ Full | recall, create, update, delete, manage, facts, summarize |
| **browser** | ✅ Full | 90+ Playwright actions |
| **ui** | ✅ Full | click, type, screenshot, focus, record, session |
| **mode** | ✅ Full | list, activate, show, current |
| **plan** | ✅ Full | create, update, list, get |

**Test Coverage**: ~95% across all tools

### Rust Implementation

Repository: `hanzo/mcp/rust`

| Tool | Status | Actions | Notes |
|------|--------|---------|-------|
| **proc** (`ShellTool`) | ✅ Full | exec, ps, kill, logs, help | Auto-backgrounding at 45s |
| **fs** (`FsTool`) | ✅ Full | read, write, edit, patch, tree, find, search, info | Tree-sitter AST search |
| **think** (`ThinkTool`) | ✅ Full | think, critic, review | All review focus areas |
| **memory** (`MemoryTool`) | ✅ Full | recall, create, update, delete, manage, facts, summarize | Session/project/global scopes |
| **browser** (`BrowserTool`) | ⚠️ Partial | 90+ actions via Playwright | Requires Playwright runtime |
| **ui** (`UiTool`) | ✅ Full | macOS native + cross-platform | Quartz backend on macOS |
| **mode** (`ModeTool`) | ✅ Full | list, activate, show, current | 10+ developer modes |
| **plan** (`PlanTool`) | ✅ Full | create, update, list, get | Task management |

**Rust-specific features:**
- Tree-sitter AST search (8 languages: Rust, JS, TS, Python, Go, Java, C, C++)
- Native macOS UI automation via Quartz
- Process auto-backgrounding with 45s timeout
- Unified search with modality detection (Text, AST, Symbol, Vector, Memory, File)

**Test Coverage**: ~90% parity with Python tests

### Test Files (Rust)

```
rust/tests/
├── test_shell_tools.rs    # proc tool tests
├── test_fs_tools.rs       # fs tool tests
├── test_search_tools.rs   # unified search tests
├── test_think_tools.rs    # think/critic/review tests
├── test_memory_tools.rs   # memory operations tests
└── test_browser_tools.rs  # browser automation tests
```

### Search Modalities (Rust)

```rust
pub enum SearchModality {
    Text,    // Ripgrep-based text search
    Ast,     // Tree-sitter AST search
    Symbol,  // Symbol/definition search
    Vector,  // Semantic vector search
    Memory,  // Memory/knowledge search
    File,    // File pattern search
}
```

Modality auto-detection:
- Natural language queries → Vector + Text
- Code patterns (`class`, `fn`, `def`) → AST + Text
- Single identifiers → Symbol + Text
- File paths/extensions → File + Text

### Key Rust Structures

```rust
// Process execution
pub struct ProcToolArgs {
    pub action: String,
    pub command: Option<Value>,  // String or Array
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub timeout: Option<u64>,
    pub shell: Option<String>,
    pub proc_id: Option<String>,
}

// Filesystem operations
pub struct FsToolArgs {
    pub action: String,
    pub path: Option<String>,
    pub content: Option<String>,
    pub old_text: Option<String>,
    pub new_text: Option<String>,
    pub pattern: Option<String>,
    pub depth: Option<usize>,
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}

// Think/reasoning
pub struct ThinkToolArgs {
    pub action: String,
    pub thought: Option<String>,
    pub analysis: Option<String>,
    pub work_description: Option<String>,
    pub focus: Option<String>,
    pub code_snippets: Option<Vec<String>>,
    pub file_paths: Option<Vec<String>>,
    pub context: Option<String>,
}
```

### Building & Testing

```bash
# Build Rust MCP
cd hanzo/mcp/rust
cargo build --release

# Run all tests
cargo test

# Run specific test module
cargo test -p hanzo-mcp test_shell_tools

# Run with verbose output
cargo test -- --nocapture
```

## Copyright

This document is licensed under the MIT License.
