---
hip: 0021
title: Hanzo IDE - Integrated Development Environment
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2025-01-20
requires: HIP-0, HIP-10, HIP-20
---

# HIP-21: Hanzo IDE - Integrated Development Environment

## Abstract

This proposal defines the Hanzo IDE standard -- an AI-native development environment where artificial intelligence is the primary interface, not a bolt-on feature. The IDE integrates the Model Context Protocol (HIP-0010) with 260+ structured tools, Language Server Protocol backends for code intelligence, tree-sitter for cross-language AST analysis, persistent memory across sessions, and a terminal-first architecture with optional GUI. Every developer action -- code generation, refactoring, debugging, testing, deployment, and code review -- is AI-assisted through well-defined tool interfaces rather than free-form text generation.

**Repository**: [github.com/hanzoai/mcp](https://github.com/hanzoai/mcp)
**Package**: `hanzo-mcp` (PyPI) / `@hanzoai/mcp` (NPM)
**CLI**: `hanzo-mcp`

## Motivation

Modern development environments face a fundamental architectural mismatch with AI:

1. **Plugin sandboxing**: VS Code extensions cannot deeply integrate with the editor core. AI tools run in isolated extension hosts with limited access to workspace state, terminal output, and editor internals. This makes coordinated multi-step operations (think, plan, edit, test, commit) fragile and slow.

2. **GUI-centric interaction**: Traditional IDEs assume the developer drives every action through menus, keybindings, and mouse clicks. AI assistance is confined to autocomplete dropdowns and sidebar chat panels. The AI cannot initiate complex workflows, manage workspace layout, or coordinate multiple tools simultaneously.

3. **Context fragmentation**: Copilot-style tools see only the current file and a narrow context window. They lack access to git history, project architecture, dependency graphs, test results, build output, and deployment state. Without full project context, AI suggestions are shallow.

4. **Unreliable generation**: Free-form code generation produces syntactically plausible but semantically incorrect output. Without structured tool interfaces, the AI guesses at file paths, function signatures, and project conventions instead of querying them directly.

5. **No persistent learning**: Each session starts from zero. The AI forgets project conventions, architectural decisions, past debugging sessions, and developer preferences. There is no memory system to accumulate project knowledge over time.

The Hanzo IDE addresses these problems by making AI the primary interface rather than an afterthought. The AI operates through 260+ MCP tools with well-defined schemas, has full codebase context via LSP and tree-sitter, persists knowledge across sessions, and follows a disciplined think-plan-implement-validate loop.

## Design Philosophy

### Why AI-Native IDE

Traditional IDEs (VS Code, IntelliJ, Xcode) were designed around a human manually writing every line of code. AI was bolted on later as plugins -- GitHub Copilot as an autocomplete extension, ChatGPT as a sidebar panel. These integrations are inherently limited by the plugin architecture: they cannot modify the editor itself, they cannot coordinate multi-file refactors atomically, and they cannot drive complex workflows that span editing, testing, building, and deploying.

An AI-native IDE inverts this relationship. The AI is the primary execution engine. It reads files, edits code, runs tests, inspects build output, manages git operations, and deploys services -- all through structured tool calls. The human provides intent ("fix this failing test", "add pagination to the API", "deploy to staging") and the AI executes a plan. The human reviews, approves, and course-corrects. This is not autocomplete. This is delegation.

The key insight is that AI is better at mechanical coding tasks (writing boilerplate, fixing lint errors, updating imports, writing test scaffolding) while humans are better at architectural decisions, requirement analysis, and judgment calls. The IDE should allocate work accordingly.

### Why Claude Code as the Foundation

Claude Code (Anthropic's CLI agent) demonstrated that terminal-based AI coding is more powerful than GUI-based copilots. The terminal provides:

- **Full codebase access**: The agent reads any file, searches with grep/ripgrep, and navigates with glob patterns. No context window limitations from IDE plugin sandboxing.
- **Command execution**: The agent runs tests, builds, linters, formatters, and deployment scripts directly. It observes output and iterates.
- **File editing**: Precise string-replacement edits with verification, not wholesale file rewrites that lose context.
- **Iterative workflow**: Think, plan, implement, validate -- in a loop. The agent tries, observes failure, adjusts, and retries. This mirrors how experienced developers actually work.

Hanzo IDE adopts these Claude Code patterns as core primitives. The MCP tools (`read`, `write`, `edit`, `zsh`, `search`, `find`, `ast`, `lsp`, `browser`) directly implement the Claude Code interaction model. Any AI model that speaks MCP can drive the IDE, not just Claude.

### Why MCP-Powered

The Model Context Protocol (HIP-0010) provides 260+ tools organized into coherent categories. Each tool has a typed JSON schema defining its inputs and outputs. This is fundamentally more reliable than asking an AI to generate bash commands or raw code:

- **Type safety**: Tool schemas catch invalid arguments before execution. A `read` tool requires an absolute file path -- the AI cannot accidentally pass a relative path or a URL.
- **Composability**: Complex operations are sequences of simple tool calls. Refactoring a function is: `ast` (find references) then `lsp` (get definition) then `edit` (rename) then `zsh` (run tests). Each step produces structured output the next step consumes.
- **Auditability**: Every tool call is logged with inputs, outputs, and timing. The audit trail shows exactly what the AI did and why. This is critical for security review and debugging.
- **Extensibility**: New tools are added by implementing the MCP tool interface. No changes to the AI model or IDE core. Third-party tools integrate through the same protocol.
- **Model independence**: Any LLM that can produce JSON tool calls works with MCP tools. The IDE is not locked to a single AI provider.

### Why Not Fork VS Code

VS Code is open source (MIT license) and has a massive extension ecosystem. Forking it was considered and rejected for specific technical reasons:

1. **Extension Host isolation**: VS Code extensions run in a separate Node.js process. They communicate with the editor via a narrow RPC interface. An AI agent that needs to read terminal output, modify editor layout, coordinate multiple extensions, and access the filesystem simultaneously cannot do so from within an extension host.

2. **Electron overhead**: VS Code runs on Electron (Chromium + Node.js). This adds 300-500 MB of memory overhead before any extensions load. A terminal-first IDE with optional GUI avoids this cost.

3. **Extension API limitations**: The VS Code extension API does not expose programmatic control over the integrated terminal, task runners, debug adapters, or source control in ways that support autonomous AI operation. Many operations require user interaction (confirmation dialogs, quick picks) that block automated workflows.

4. **Maintenance burden**: Tracking upstream VS Code changes while maintaining deep AI modifications is a significant engineering cost. The VS Code codebase is 2M+ lines of TypeScript. Merge conflicts on core modifications would be continuous.

Instead, the Hanzo IDE is a purpose-built runtime for AI-driven development. It uses standard protocols (MCP, LSP, DAP) and standard tools (tree-sitter, ripgrep, git) rather than a monolithic editor framework.

## Specification

### Architecture Overview

```
+---------------------------------------------------------------+
|                        Hanzo IDE                               |
+---------------------------------------------------------------+
|  Human Interface                                               |
|  +---------------------------+  +---------------------------+  |
|  |  Terminal (primary)       |  |  GUI (optional)           |  |
|  |  - Claude Code patterns   |  |  - @hanzo/ui components  |  |
|  |  - Interactive prompts    |  |  - File tree / editor     |  |
|  |  - Streaming output       |  |  - Diff viewer            |  |
|  +---------------------------+  +---------------------------+  |
+---------------------------------------------------------------+
|  AI Agent Layer                                                |
|  +----------------------------------------------------------+ |
|  |  Think -> Plan -> Implement -> Validate -> Learn          | |
|  |  - Multi-model support (Claude, GPT, Zen, Ollama)        | |
|  |  - Tool selection and orchestration                       | |
|  |  - Error recovery and retry logic                         | |
|  |  - Session memory and project context                     | |
|  +----------------------------------------------------------+ |
+---------------------------------------------------------------+
|  MCP Tool Layer (260+ tools)                                   |
|  +----------+ +----------+ +----------+ +----------+          |
|  | File Ops | | Code     | | Shell    | | Browser  |          |
|  | read     | | lsp      | | zsh      | | navigate |          |
|  | write    | | ast      | | npx      | | click    |          |
|  | edit     | | refactor | | uvx      | | fill     |          |
|  | find     | | search   | | curl     | | screenshot|         |
|  | tree     | | think    | | wget     | | evaluate |          |
|  +----------+ +----------+ +----------+ +----------+          |
|  +----------+ +----------+ +----------+ +----------+          |
|  | Git      | | Memory   | | Screen   | | Computer |          |
|  | status   | | recall   | | capture  | | click    |          |
|  | diff     | | create   | | record   | | type     |          |
|  | commit   | | manage   | | analyze  | | hotkey   |          |
|  | pr create| | facts    | | session  | | screenshot|         |
|  +----------+ +----------+ +----------+ +----------+          |
+---------------------------------------------------------------+
|  Language Intelligence Layer                                   |
|  +----------------------------------------------------------+ |
|  |  LSP Servers          | Tree-sitter Parsers              | |
|  |  - gopls (Go)         | - 8 languages supported          | |
|  |  - pyright (Python)   | - AST-based code search          | |
|  |  - tsserver (TS/JS)   | - Structural pattern matching    | |
|  |  - rust-analyzer      | - Cross-language symbol index    | |
|  |  - clangd (C/C++)     | - Incremental parsing            | |
|  +----------------------------------------------------------+ |
+---------------------------------------------------------------+
|  Runtime Layer                                                 |
|  +----------------------------------------------------------+ |
|  |  Process Manager | Sandbox | Background Tasks             | |
|  |  - Auto-background long commands (>45s)                   | |
|  |  - Process kill / signal support                          | |
|  |  - stdout/stderr log capture                              | |
|  |  - Per-command timeout enforcement                        | |
|  +----------------------------------------------------------+ |
+---------------------------------------------------------------+
```

### Core: Terminal-First with Optional GUI

The IDE is terminal-first. The primary interaction mode is a conversational loop in the terminal where the developer states intent and the AI executes through MCP tools. This is the Claude Code pattern.

```
Developer: "Add rate limiting to the /api/chat endpoint"

AI: [think] The /api/chat endpoint is in routes/chat.py. Need to:
    1. Check existing middleware for rate limiting patterns
    2. Add rate limiting decorator using Redis backend
    3. Add configuration for rate limits
    4. Write tests

AI: [read] routes/chat.py -- reading current implementation
AI: [search] "rate_limit" across codebase -- checking existing patterns
AI: [edit] routes/chat.py -- adding @rate_limit(calls=60, period=60)
AI: [edit] middleware/rate_limit.py -- creating Redis-backed limiter
AI: [edit] tests/test_rate_limit.py -- adding test cases
AI: [zsh] pytest tests/test_rate_limit.py -v -- running tests

Result: 3 files modified, 4 tests passing. Rate limiting active.
```

The optional GUI layer provides visual tools for tasks where graphical display adds value: diff viewing, file tree navigation, image/screenshot viewing, and architecture diagrams. The GUI is built with `@hanzo/ui` components and communicates with the same MCP tool layer.

### AI Integration: The Agent Loop

The IDE AI follows a strict operational loop for every task:

**1. Think**: Analyze the request. Identify constraints, dependencies, and risks. Use the `think` tool to record reasoning without taking action.

**2. Plan**: Outline the sequence of changes. Identify files to read, edits to make, tests to run. Summarize the plan for human review.

**3. Implement**: Execute the plan through MCP tool calls. Make changes incrementally -- one file at a time, one logical edit at a time. Prefer `edit` (surgical string replacement) over `write` (full file overwrite).

**4. Validate**: Run tests, linters, type checkers, and build commands. Observe output. If validation fails, return to step 1 with the error context.

**5. Learn**: Record insights, architectural decisions, and project conventions in the memory system. Update project documentation if significant patterns were discovered.

This loop is enforced at the protocol level. The AI agent cannot skip validation or bypass the planning step. The CTO review pattern from the Hanzo development workflow (CLAUDE.md) integrates directly -- the agent summarizes what was done and awaits human confirmation before proceeding to the next task.

### MCP Tools: The 260+ Tool Catalog

Tools are organized by category. Each tool has a JSON schema defining required and optional parameters, return types, and error conditions.

#### File Operations

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `read` | Read file contents with line numbers | `file_path`, `offset`, `limit` |
| `write` | Write/overwrite file contents | `file_path`, `content` |
| `edit` | Surgical string replacement in files | `file_path`, `old_string`, `new_string` |
| `find` | Find files by glob pattern | `pattern`, `path`, `type` |
| `tree` | Display directory tree structure | `path`, `depth` |
| `search` | Regex search across file contents | `pattern`, `path`, `include` |

The `edit` tool is the preferred mechanism for code modification. It performs exact string matching and replacement, ensuring the AI does not accidentally overwrite unrelated code. The `write` tool is reserved for creating new files or complete rewrites.

#### Code Intelligence

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `lsp` | Language Server Protocol operations | `action`, `file`, `line`, `character` |
| `ast` | AST-based code structure search | `pattern`, `path` |
| `refactor` | Structural code transformations | `action`, `file`, `line`, `new_name` |

LSP actions include:
- `definition`: Go to definition of symbol at cursor position
- `references`: Find all references to a symbol across the project
- `rename`: Rename a symbol across the entire codebase
- `diagnostics`: Get errors and warnings for a file
- `hover`: Get type information and documentation at a position
- `completion`: Get code completions at cursor position

AST search uses tree-sitter grammars to find code structures by pattern. Unlike text search, it understands syntax:

```
ast("function_name", "./src")     # Find function definitions
ast("class.*Service", "./src")    # Find service classes
ast("def test_", "./tests")       # Find test functions
```

Refactoring actions include:
- `rename`: Symbol rename with LSP awareness (updates all references)
- `rename_batch`: Batch rename across codebase with parallel processing
- `extract_function`: Extract code block into a new function
- `extract_variable`: Extract expression into a named variable
- `inline`: Inline a variable or function
- `move`: Move symbol to a different file
- `change_signature`: Add/remove/reorder function parameters
- `find_references`: List all usages of a symbol
- `organize_imports`: Sort and clean imports

#### Shell and Process Management

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `zsh` | Execute shell commands | `command`, `timeout`, `cwd` |
| `npx` | Run Node.js packages | `package`, `args` |
| `uvx` | Run Python packages | `package`, `args` |
| `ps` | Process management | `id`, `kill`, `logs` |
| `curl` | HTTP requests without shell escaping | `url`, `method`, `json` |
| `jq` | JSON processing | `filter`, `input`, `file` |
| `wget` | File downloads and site mirroring | `url`, `mirror`, `output` |

Shell commands that exceed 45 seconds automatically background. The process manager tracks background tasks and provides log retrieval via `ps --logs <id>`.

#### Browser Automation

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `browser` | Full Playwright browser control | `action`, `selector`, `url` |

The browser tool exposes 90+ Playwright actions organized by category:

- **Navigation**: `navigate`, `reload`, `go_back`, `go_forward`
- **Input**: `click`, `fill`, `type`, `press`, `select_option`
- **Content**: `get_text`, `get_attribute`, `get_html`
- **Assertions**: `expect_visible`, `expect_text`, `expect_url`
- **Screenshots**: `screenshot` (full page or element)
- **Network**: `route` (mock/block requests), `wait_for_response`
- **Multi-context**: `new_context` for parallel isolated sessions

This enables end-to-end testing, web scraping, and visual verification directly from the IDE.

#### Native Computer Control

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `computer` | Native OS automation | `action`, `x`, `y`, `text` |
| `screen` | Screen recording and analysis | `action`, `duration` |

Computer control uses native platform APIs (Quartz on macOS) for sub-5ms mouse operations and sub-2ms keyboard operations. This enables:

- GUI application testing
- Screenshot-based visual verification
- Automated demo recording
- Accessibility testing

Screen recording captures activity, extracts keyframes at activity points, compresses frames, and returns them for AI analysis. A 30-second session produces approximately 30 compressed keyframes totaling around 500 KB.

#### Memory and Knowledge

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `recall_memories` | Search stored memories | `queries`, `scope`, `limit` |
| `create_memories` | Store new information | `statements` |
| `manage_memories` | Atomic create/update/delete | `creations`, `updates`, `deletions` |
| `recall_facts` | Search knowledge bases | `queries`, `kb_name` |
| `store_facts` | Add facts to knowledge bases | `facts`, `kb_name`, `scope` |
| `manage_knowledge_bases` | Create/list/delete KBs | `action`, `kb_name` |
| `summarize_to_memory` | Summarize and store | `content`, `topic`, `scope` |

Memory operates at three scopes:
- **Session**: Ephemeral, cleared when the session ends
- **Project**: Persists across sessions for the current project
- **Global**: Persists across all projects

This enables the AI to remember project conventions ("this project uses tabs, not spaces"), architectural decisions ("we chose Redis over Memcached because..."), and debugging history ("the flaky test in auth_test.go is caused by timezone handling").

#### Reasoning and Review

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `think` | Record reasoning without side effects | `thought` |
| `critic` | Critical analysis and devil's advocate | `analysis` |
| `review` | Balanced constructive code review | `focus`, `work_description` |

The `think` tool is used for complex reasoning and brainstorming. It produces no side effects -- it simply logs the thought process. This is essential for the plan phase of the agent loop.

The `critic` tool forces adversarial analysis: looking for bugs, edge cases, security issues, performance problems, and missing tests. It is used before finalizing any change.

The `review` tool provides balanced code review with recognition of strengths and constructive suggestions for improvement.

### Language Support via LSP

The IDE auto-installs language servers as needed:

| Language | Server | Features |
|----------|--------|----------|
| Go | `gopls` | Definition, references, rename, diagnostics, formatting |
| Python | `pyright` | Type checking, definition, references, completions |
| TypeScript/JavaScript | `typescript-language-server` | Full TS/JS intelligence |
| Rust | `rust-analyzer` | Comprehensive Rust support |
| Java | `jdtls` | Eclipse JDT-based Java support |
| C/C++ | `clangd` | LLVM-based C/C++ intelligence |
| Ruby | `solargraph` | Ruby language server |
| Lua | `lua-language-server` | Lua intelligence |

LSP operations are exposed through the `lsp` MCP tool with a uniform interface regardless of the underlying server.

### Code Search: Unified Multi-Modal

The IDE provides five complementary search modes, all accessible through MCP tools:

1. **Text search** (`search` tool): Ripgrep-powered regex search across file contents. Supports glob filtering, context lines, line numbers, and file-type filtering.

2. **AST search** (`ast` tool): Tree-sitter-powered structural code search. Finds functions, classes, methods by pattern with full syntactic awareness across 8 languages.

3. **Symbol search** (`lsp` tool with `references`/`definition`): LSP-powered semantic search. Finds all references to a symbol, its definition, and its type hierarchy.

4. **File search** (`find` tool): Glob-based file path matching. Finds files by name pattern with type filtering (file, directory).

5. **Memory search** (`recall_memories`/`recall_facts`): Vector-similarity search across stored project knowledge. Finds relevant past decisions, conventions, and debugging history.

These modes compose naturally. A typical refactoring starts with `ast` to find the structural pattern, confirms with `lsp` to get all references, uses `search` for string occurrences in comments and documentation, and checks `recall_memories` for past decisions about the code being modified.

### Git Integration

Git operations are performed through the `zsh` tool executing standard git commands and the `gh` CLI for GitHub operations:

```
# Status and diff
zsh("git status")
zsh("git diff --staged")

# Commit (always via HEREDOC for clean formatting)
zsh('git commit -m "$(cat <<EOF\nFix rate limiting on chat endpoint\nEOF\n)"')

# PR creation
zsh('gh pr create --title "Add rate limiting" --body "$(cat <<EOF\n## Summary\n- Added Redis-backed rate limiting\n- 60 requests per minute per user\n\n## Test plan\n- [x] Unit tests for rate limiter\n- [x] Integration test with Redis\nEOF\n)"')
```

The agent follows strict git safety rules:
- Never force push to main/master
- Never amend commits without explicit instruction
- Never skip pre-commit hooks
- Always stage specific files, not `git add -A`
- Never commit `.env` files or credentials
- Always create new commits rather than amending after hook failures

### Project Analysis

The IDE can discover and map project architecture through tool composition:

1. **Directory structure**: `tree` tool with configurable depth
2. **Dependency mapping**: `read` on package.json / go.mod / pyproject.toml / Cargo.toml
3. **Entry points**: `ast` search for main functions, route handlers, exported APIs
4. **Test coverage**: `find` for test files, `ast` for test functions
5. **Configuration**: `search` for environment variables, config file patterns
6. **Documentation**: `read` on README, CLAUDE.md, LLM.md files

Results are stored in project-scoped memory so subsequent sessions start with full context.

## Implementation

### hanzo-mcp: The MCP Server

The reference implementation is `hanzo-mcp`, available in Python, Rust, and TypeScript. It implements the full MCP tool catalog as a server that any MCP-compatible client can connect to.

```bash
# Install
pip install hanzo-mcp

# Run as MCP server (stdio transport)
hanzo-mcp

# Run with specific tools enabled
hanzo-mcp --tools fs,proc,lsp,ast,browser,memory

# Configuration via environment
HANZO_SCREEN_DURATION=30
HANZO_SCREEN_TARGET_FRAMES=30
HANZO_SCREEN_MAX_SIZE=768
```

### LSP Integration

Language servers are managed automatically. On first use of the `lsp` tool for a given language, the server is installed and started:

```python
# LSP tool dispatches to appropriate server
lsp(action="definition", file="main.go", line=42, character=15)
# -> Starts gopls if not running
# -> Returns: {"file": "handler.go", "line": 10, "character": 5}

lsp(action="references", file="auth.py", line=20, character=8)
# -> Starts pyright if not running
# -> Returns: [{"file": "auth.py", "line": 20}, {"file": "test_auth.py", "line": 5}, ...]

lsp(action="diagnostics", file="server.ts")
# -> Returns: [{"line": 15, "message": "Type 'string' is not assignable to type 'number'", "severity": "error"}]
```

### Tree-sitter for AST Parsing

Tree-sitter provides incremental, error-tolerant parsing for 8 languages:

- Rust, JavaScript, TypeScript, Python, Go, Java, C, C++

AST queries enable structural pattern matching that text search cannot:

```python
# Find all async functions in Python files
ast("async def", "./src", line_number=True)

# Find all struct definitions in Go
ast("type.*struct", "./pkg", line_number=True)

# Find all test functions
ast("func Test", "./tests")

# Find all React components (capitalized function exports)
ast("export.*function [A-Z]", "./components")
```

### Playwright for Browser Testing

The browser tool wraps Playwright's full API, enabling:

```python
# Navigate and interact
browser(action="navigate", url="http://localhost:3000")
browser(action="fill", selector="#email", text="test@example.com")
browser(action="fill", selector="#password", text="secret")
browser(action="click", selector="button[type=submit]")

# Assert state
browser(action="expect_url", expected="*/dashboard")
browser(action="expect_visible", selector=".welcome-message")

# Screenshot for visual verification
browser(action="screenshot", full_page=True)

# Device emulation
browser(action="emulate", device="iphone_14")
browser(action="navigate", url="http://localhost:3000")
browser(action="screenshot")  # Mobile screenshot

# Network mocking
browser(action="route", pattern="**/api/users", response={"body": "[{\"name\": \"Test\"}]"})
```

### Screen Recording for Visual Debugging

Screen recording captures developer or AI activity for analysis:

```python
# Record a 30-second session
screen(action="session", duration=30)
# -> Records screen
# -> Detects activity (movement, clicks, typing)
# -> Extracts ~30 keyframes at activity points
# -> Compresses to ~768px @ 60% quality
# -> Returns frames + activity analysis (~500KB total)

# Single screenshot
screen(action="capture")

# Analyze existing recording
screen(action="analyze", path="recording.mp4")
```

This enables visual debugging workflows where the AI observes the screen, identifies UI issues, and suggests fixes based on visual evidence.

### Developer Personality Modes

The `mode` tool activates different development personalities that tune the AI's behavior:

```python
mode(action="list")        # Show available modes
mode(action="activate", name="guido")   # Python-focused mode
mode(action="activate", name="linus")   # Systems programming mode
mode(action="current")     # Show active mode
```

Modes adjust the AI's priorities, coding style preferences, and review criteria to match different development contexts.

## Security

### Sandboxed Command Execution

All shell commands execute within a sandboxed environment:

- **Timeout enforcement**: Default 30-second timeout per command, configurable up to 600 seconds. Commands exceeding 45 seconds auto-background.
- **Working directory isolation**: Each command runs in the project directory. No implicit directory changes persist between commands.
- **Signal handling**: Background processes can be killed via `ps --kill <id>` with configurable signals.

### File Access Permissions

The IDE enforces file access boundaries:

- **Read**: Any file on the filesystem is readable (necessary for full codebase context).
- **Write**: Files are only written within the project directory and explicitly approved paths.
- **Edit**: The `edit` tool requires reading the file first. Edits fail if the `old_string` is not found, preventing blind overwrites.

### Secret Detection

The git integration includes secret detection:

- `.env` files are never staged or committed.
- Files matching `credentials*`, `*.pem`, `*.key` patterns trigger warnings.
- The AI is instructed to warn the user if they request committing files that likely contain secrets.
- Pre-commit hooks are never skipped (`--no-verify` is never used unless the user explicitly requests it).

### Audit Trail

Every MCP tool call is logged with:

- **Timestamp**: When the tool was invoked
- **Tool name**: Which tool was called
- **Parameters**: Input arguments (with sensitive values redacted)
- **Result**: Output (truncated for large results)
- **Duration**: How long the tool call took
- **Context**: Which agent loop phase (think/plan/implement/validate) the call occurred in

The audit trail is stored in the session memory and can be recalled for debugging or compliance review.

### Destructive Action Protection

The IDE prevents accidental destructive operations:

- `git push --force` to main/master is blocked (warning issued, user must explicitly confirm)
- `git reset --hard`, `git checkout .`, `git clean -f` require explicit user request
- `rm -rf` on project root or home directory is blocked
- Database drop/truncate commands trigger confirmation prompts

## Integration Points

### With Model Context Protocol (HIP-0010)

The IDE is the primary consumer of MCP tools. It implements the full MCP client specification with support for stdio, SSE, and HTTP transports. Tool discovery is dynamic -- the IDE queries the MCP server for available tools at connection time and adapts its capabilities accordingly.

### With Agent SDK (HIP-0009)

The IDE agent is built on the Hanzo Agent SDK. It uses the agent's think-act-observe loop, memory system, and tool orchestration. Multi-agent scenarios are supported: a planning agent can delegate to specialized coding, testing, and deployment agents.

### With Hanzo Node (HIP-0020)

For computationally intensive tasks (large codebase analysis, model inference, integration test suites), the IDE can submit work to the decentralized compute network via Hanzo Node. This enables:

- Running test suites on cloud GPU instances
- Large-scale refactoring across monorepos
- Model fine-tuning on project-specific data

### With Personalized AI (HIP-0022)

The memory system feeds into the personalization pipeline. Developer interactions, coding style preferences, and project conventions collected by the IDE are used to fine-tune personalized models that better match individual developer workflows.

### With Hanzo IAM (HIP-0026)

Authentication for IDE cloud features (remote workspaces, team collaboration, shared memory) uses Hanzo IAM via OAuth2/OIDC. API keys for AI providers are managed through Hanzo KMS.

## Deployment

### Local Installation

```bash
# Python (recommended)
pip install hanzo-mcp

# Or via uv
uv tool install hanzo-mcp

# Rust (faster startup, native UI automation)
cargo install hanzo-mcp

# Verify installation
hanzo-mcp --version
```

### Claude Code Integration

The primary deployment mode is as an MCP server for Claude Code:

```json
{
  "mcpServers": {
    "hanzo": {
      "command": "hanzo-mcp",
      "args": ["--tools", "all"]
    }
  }
}
```

This gives Claude Code access to all 260+ Hanzo IDE tools alongside its built-in capabilities.

### Docker Development Environment

```yaml
# compose.yml
services:
  ide:
    image: ghcr.io/hanzoai/mcp:latest
    ports:
      - "3000:3000"
    volumes:
      - .:/workspace
    environment:
      - HANZO_API_KEY=${HANZO_API_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
```

### Cloud IDE (ide.hanzo.ai)

The hosted version runs on Hanzo infrastructure:

- **URL**: https://ide.hanzo.ai
- **Auth**: Hanzo IAM (hanzo.id) OAuth2
- **Storage**: Persistent workspaces on MinIO/S3
- **Compute**: Kubernetes pods with configurable resources
- **GPU**: Optional GPU attachment for ML workloads

## Monitoring

### Metrics

```yaml
prometheus_metrics:
  # Tool usage
  - hanzo_mcp_tool_calls_total{tool, status}
  - hanzo_mcp_tool_duration_seconds{tool}

  # Agent loop
  - hanzo_ide_agent_loops_total{phase}
  - hanzo_ide_agent_loop_duration_seconds

  # LSP
  - hanzo_ide_lsp_requests_total{language, action}
  - hanzo_ide_lsp_response_time_seconds{language}

  # Memory
  - hanzo_ide_memory_operations_total{scope, action}
  - hanzo_ide_memory_entries_count{scope}

  # Sessions
  - hanzo_ide_sessions_active
  - hanzo_ide_session_duration_seconds
```

### Health Check

```bash
# Local health check
hanzo-mcp --health

# Remote health check
curl https://ide.hanzo.ai/api/health
```

## Backward Compatibility

The Hanzo IDE is backward compatible with standard development tooling:

- **LSP**: Any LSP-compatible editor can use the same language servers.
- **Git**: Standard git workflows are preserved. The IDE uses git CLI, not a custom VCS.
- **Build systems**: Make, npm scripts, cargo, go build -- all work unchanged through the `zsh` tool.
- **CI/CD**: GitHub Actions, GitLab CI, Jenkins -- all compatible. The IDE can trigger and monitor CI runs.
- **File formats**: No proprietary project files. The IDE reads standard config files (package.json, go.mod, pyproject.toml, Cargo.toml, Makefile).

Developers can use the Hanzo IDE MCP tools alongside any existing editor. The tools are not exclusive to a single client.

## Future Work

1. **Collaborative editing**: Multiple developers and AI agents editing the same codebase simultaneously with conflict resolution.
2. **Visual programming**: Drag-and-drop workflow builder (HIP-0013) integrated with the code editor for hybrid visual/textual programming.
3. **Voice interface**: Spoken intent translated to tool calls for hands-free development.
4. **Autonomous agents**: Long-running background agents that monitor code quality, update dependencies, and fix CI failures without human intervention.
5. **Cross-project intelligence**: Memory and patterns shared across projects within an organization, enabling the AI to apply lessons learned in one project to another.

## References

1. [HIP-0000: Hanzo AI Architecture Framework](./hip-0000-hanzo-ai-architecture-framework.md)
2. [HIP-0009: Agent SDK](./hip-0009-agent-sdk-multi-agent-orchestration-framework.md)
3. [HIP-0010: Model Context Protocol](./hip-0010-model-context-protocol-mcp-integration-standards.md)
4. [HIP-0020: Blockchain Node](./hip-0020-blockchain-node-standard.md)
5. [HIP-0022: Personalized AI](./hip-0022-personalized-ai-own-your-ai.md)
6. [HIP-0026: Identity and Access Management](./hip-0026-identity-access-management-standard.md)
7. [HIP-0300: Unified MCP Tools Architecture](./hip-0300-unified-mcp-tools-architecture.md)
8. [Model Context Protocol Specification](https://modelcontextprotocol.io)
9. [Language Server Protocol Specification](https://microsoft.github.io/language-server-protocol/)
10. [Tree-sitter Documentation](https://tree-sitter.github.io/tree-sitter/)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
