---
hip: 0041
title: CLI Standard
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2026-02-23
requires: HIP-0004, HIP-0040
---

# HIP-41: CLI Standard

## Abstract

The Hanzo CLI is the primary developer tool for interacting with the Hanzo AI platform from the terminal. It is a single Go binary (`hanzo`) that provides authenticated access to the LLM Gateway (HIP-4), model management, deployment, and platform operations. The CLI integrates with container runtimes for reproducible AI workloads, supports real-time token streaming, and composes with standard Unix tools via stdin/stdout pipes.

**Repository**: [github.com/hanzoai/cli](https://github.com/hanzoai/cli)
**Package**: `@hanzoai/cli` (npm), `hanzoai-cli` (pip)
**Binary**: `hanzo`

## Motivation

### The Problem

The Hanzo platform exposes a comprehensive REST API through the LLM Gateway (HIP-4). Developers can interact with it using `curl`, HTTP client libraries, or the language-specific SDKs. However, raw API access creates friction in five areas:

1. **Authentication ceremony**: Every API call requires a bearer token. Obtaining one means running an OAuth flow, storing the token, refreshing it before expiry, and injecting it into every request header. Developers who just want to ask a model a question should not need to manage JWT lifecycles.

2. **No streaming display**: The LLM Gateway streams tokens via Server-Sent Events (SSE). `curl` can receive the stream, but rendering it character-by-character in a terminal requires parsing SSE frames, handling partial UTF-8 sequences, and managing terminal state. This is plumbing that every developer rebuilds.

3. **Model discovery friction**: The platform serves 100+ models across multiple providers. Discovering which models are available, their context lengths, pricing, and capabilities requires reading documentation or making multiple API calls. A CLI can present this as a searchable table.

4. **Deployment gap**: Pushing code to Hanzo Platform (HIP-14) requires building a container image, pushing to a registry, and triggering a deployment via the platform API. Without a CLI, developers must script this themselves or use the web UI, which breaks CI/CD automation.

5. **No composability**: The Unix philosophy depends on programs that read stdin and write stdout. `curl` outputs raw JSON with SSE framing. Piping a prompt file into an AI model and getting clean text back requires a purpose-built tool.

### Why a CLI Solves This

A CLI is the natural interface for developers who live in terminals. It handles authentication, streaming, model selection, and output formatting behind a simple command surface. It integrates with shell scripts, CI/CD pipelines, Makefiles, and other Unix tools. A web dashboard cannot be piped into `grep`. A CLI can.

## Design Philosophy

### Why Go for the CLI Binary

The CLI must ship as a single binary with zero runtime dependencies. A developer should be able to `curl` the binary, make it executable, and run it. No Python interpreter, no Node.js runtime, no shared libraries.

Go produces statically-linked binaries by default. Cross-compilation to Linux/macOS/Windows on amd64/arm64 is a single `GOOS=... GOARCH=... go build` invocation. The resulting binary starts in under 50ms, which is critical for CLI tools that may be called hundreds of times in a script. The binary size is ~15MB, small enough to vendor in CI images.

The alternative is Rust, which produces comparable binaries but has a steeper learning curve and slower compile times. Since the Hanzo ecosystem already uses Go extensively (IAM, blockchain node, SDK), Go reduces the cognitive overhead for contributors.

### Why Container Runtime Integration

AI workloads have complex dependencies: CUDA drivers, Python packages with native extensions, model weights that are tens of gigabytes. Container images provide reproducible environments. The CLI integrates with Docker and Podman to run inference locally with GPU passthrough, build deployment images with correct CUDA/cuDNN versions, cache model weights in named volumes, and isolate conflicting dependency trees. `hanzo run --model zen-72b --gpu` translates to the correct `docker run` incantation with NVIDIA runtime, volume mounts, and port mappings.

### Why OpenAI-Compatible Commands

The OpenAI CLI established conventions that AI developers already know: `chat`, `complete`, `embed`. Mirroring these command names reduces the learning curve to near zero. A developer migrating from OpenAI to Hanzo changes `openai chat` to `hanzo chat` and everything else works the same. The LLM Gateway (HIP-4) already provides an OpenAI-compatible REST API. The CLI extends this compatibility to the command-line interface.

### Why Not Just curl

| Concern | curl | hanzo CLI |
|---------|------|-----------|
| Authentication | Manual header injection | Automatic token management |
| Streaming | Raw SSE frames | Rendered text with cursor control |
| Model selection | Must know model IDs | Tab-completable model names |
| Output format | Raw JSON | text, json, yaml selectable |
| Error handling | HTTP status codes | Human-readable error messages |
| Configuration | None (flags on every call) | Persistent config file |
| Pipe support | JSON in, JSON out | Text in, text out (or JSON) |

### Why a Plugin System

The core CLI covers the common cases. The Hanzo ecosystem includes specialized tools (MCP servers, agent frameworks, workflow engines) that benefit from CLI integration without bloating the core binary. Plugins are standalone binaries named `hanzo-<name>`. When a user runs `hanzo foo`, the CLI looks for `hanzo-foo` in `$PATH`. This is the same pattern used by `git`, `kubectl`, and `docker`. No plugin registry, no dynamic loading, no version conflicts.

## Specification

### Command Structure

```
hanzo [command] [subcommand] [flags]
```

Global flags available on all commands:

| Flag | Short | Env Var | Description |
|------|-------|---------|-------------|
| `--api-key` | `-k` | `HANZO_API_KEY` | API key for authentication |
| `--base-url` | `-u` | `HANZO_BASE_URL` | LLM Gateway URL (default: `https://llm.hanzo.ai`) |
| `--org` | `-o` | `HANZO_ORG` | Organization name |
| `--output` | | `HANZO_OUTPUT` | Output format: `text`, `json`, `yaml` (default: `text`) |
| `--verbose` | `-v` | | Enable verbose/debug output |
| `--quiet` | `-q` | | Suppress non-essential output |
| `--no-color` | | `NO_COLOR` | Disable colored output (respects [no-color.org](https://no-color.org)) |
| `--config` | | `HANZO_CONFIG` | Config file path (default: `~/.hanzo/config.yaml`) |

### Core Commands

#### `hanzo auth` -- Authentication

Manages OAuth authentication with Hanzo IAM (HIP-26).

```
hanzo auth login       # Opens browser for OAuth login via hanzo.id
hanzo auth logout      # Revokes tokens and clears local credentials
hanzo auth status      # Shows current authentication state
hanzo auth token       # Prints the current access token to stdout
hanzo auth refresh     # Forces a token refresh
```

**`hanzo auth login`** initiates an OAuth 2.0 Authorization Code Grant with PKCE:

1. CLI starts a local HTTP server on a random port (e.g., `http://localhost:48291/callback`)
2. CLI opens `https://hanzo.id/login/oauth/authorize` in the user's default browser with:
   - `client_id=hanzo-cli-client-id`
   - `redirect_uri=http://localhost:48291/callback`
   - `response_type=code`
   - `scope=openid profile email`
   - `code_challenge=<S256 challenge>`
   - `code_challenge_method=S256`
3. User authenticates at hanzo.id
4. IAM redirects to `http://localhost:48291/callback?code=<code>&state=<state>`
5. CLI exchanges the authorization code for tokens
6. Tokens are stored in `~/.hanzo/credentials.json` with mode `0600`
7. Local HTTP server shuts down

For headless environments (CI, SSH sessions), `hanzo auth login --headless` prints the authorization URL and waits for the user to paste the callback URL manually.

**`hanzo auth token`** prints the current access token to stdout, refreshing it if expired:

```bash
curl -H "Authorization: Bearer $(hanzo auth token)" https://llm.hanzo.ai/v1/models
```

#### `hanzo chat` -- Interactive Chat

Sends messages to a chat model via the LLM Gateway.

```
hanzo chat [message]                         # One-shot message
hanzo chat --interactive                     # Interactive REPL
hanzo chat --model zen-72b "Explain monads"  # Specific model
hanzo chat --system "You are a Go expert"    # System prompt
hanzo chat --file context.txt "Summarize"    # Attach file as context
echo "Fix this bug" | hanzo chat             # Pipe from stdin
cat code.py | hanzo chat --model zen-72b     # Pipe code for review
```

Flags:

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--model` | `-m` | Config default or `zen-72b` | Model identifier |
| `--system` | `-s` | None | System prompt |
| `--temperature` | `-t` | `0.7` | Sampling temperature (0.0-2.0) |
| `--max-tokens` | | Model default | Maximum tokens to generate |
| `--top-p` | | `1.0` | Nucleus sampling threshold |
| `--stream` | | `true` | Stream tokens (disable with `--no-stream`) |
| `--interactive` | `-i` | `false` | Start interactive chat REPL |
| `--file` | `-f` | None | Attach file(s) as context (repeatable) |
| `--json` | | `false` | Request JSON mode output |
| `--stop` | | None | Stop sequence(s) (repeatable) |

**Streaming behavior**: By default, tokens stream to the terminal as they are generated. The CLI handles SSE frame parsing, partial UTF-8 reassembly, and terminal cursor management. When stdout is not a TTY (piped to another command), streaming is disabled and the complete response is written at once.

**Interactive mode** (`hanzo chat -i`) provides a REPL with multi-line input (terminated by blank line or Ctrl+D), conversation history within the session, `/clear` to reset history, `/model <name>` to switch models, `/system <prompt>` to update the system prompt, `/save <file>` and `/load <file>` for conversation persistence, and Up/Down arrow for input history.

#### `hanzo complete` -- Text Completion

Sends a prompt for text completion (non-chat models).

```
hanzo complete "The capital of France is"
hanzo complete --model zen-7b < prompt.txt
echo "Once upon a time" | hanzo complete --max-tokens 500
```

Flags mirror `hanzo chat` except `--system` and `--interactive` are not available. Uses the `/v1/completions` endpoint.

#### `hanzo embed` -- Embeddings

Generates embedding vectors for text input.

```
hanzo embed "Hello world"
hanzo embed --model text-embedding-3-small < document.txt
hanzo embed --input-file sentences.jsonl --output embeddings.jsonl
```

| Flag | Default | Description |
|------|---------|-------------|
| `--model` | `text-embedding-3-small` | Embedding model |
| `--dimensions` | Model default | Output dimensions |
| `--input-file` | stdin | JSONL file with one text per line |
| `--output` | stdout | Output file for embeddings |
| `--encoding-format` | `float` | `float` or `base64` |

#### `hanzo models` -- Model Management

```
hanzo models list                    # List all available models
hanzo models list --provider hanzo   # Filter by provider
hanzo models list --capability chat  # Filter by capability
hanzo models info zen-72b           # Detailed model information
```

**`hanzo models list`** output (text format):

```
MODEL                 PROVIDER    CONTEXT   COST/1K-IN   COST/1K-OUT
zen-1b               hanzo       32768     $0.0001      $0.0002
zen-7b               hanzo       32768     $0.0003      $0.0006
zen-14b              hanzo       65536     $0.0005      $0.0010
zen-32b              hanzo       65536     $0.0008      $0.0016
zen-72b              hanzo       131072    $0.0012      $0.0024
zen-480b             hanzo       131072    $0.0060      $0.0120
gpt-4o               openai      128000    $0.0025      $0.0100
claude-sonnet-4-20250514     anthropic   200000    $0.0030      $0.0150
```

**`hanzo models info <model>`** output:

```
Model:          zen-72b
Provider:       hanzo
Architecture:   Zen MoDE (Mixture of Distilled Experts)
Parameters:     72B (12B active)
Context:        131072 tokens
Capabilities:   chat, completion, function_calling, vision
Input Cost:     $0.0012 / 1K tokens
Output Cost:    $0.0024 / 1K tokens
Max Output:     16384 tokens
```

#### `hanzo deploy` -- Deployment

Deploys applications to Hanzo Platform (HIP-14).

```
hanzo deploy                          # Deploy current directory
hanzo deploy --dockerfile Dockerfile  # Specify Dockerfile
hanzo deploy --env NODE_ENV=prod      # Set environment variables
hanzo deploy --name my-app            # Set application name
hanzo deploy --region us-east-1       # Target region
hanzo deploy logs                     # Stream deployment logs
hanzo deploy status                   # Show deployment status
hanzo deploy rollback                 # Roll back to previous version
hanzo deploy list                     # List all deployments
```

The deploy command detects project type from files (Dockerfile, package.json, go.mod, pyproject.toml), builds a container image, pushes it to the Hanzo Container Registry (HIP-33), triggers a deployment via the Platform API, and streams build/deployment logs until healthy or failed. If no Dockerfile is present, the CLI generates one using buildpack heuristics.

#### `hanzo logs` -- Log Streaming

```
hanzo logs                     # Logs from current project
hanzo logs --app my-app        # Logs from specific app
hanzo logs --follow            # Stream logs continuously
hanzo logs --since 1h          # Logs from last hour
hanzo logs --tail 100          # Last 100 lines
hanzo logs --filter "ERROR"    # Filter log lines
```

Logs are fetched from the Hanzo Observability stack (HIP-31) and streamed via WebSocket.

#### `hanzo config` -- Configuration Management

```
hanzo config set model zen-72b       # Set default model
hanzo config set base_url https://... # Set custom endpoint
hanzo config get model               # Get a config value
hanzo config list                    # Show all config
hanzo config reset                   # Reset to defaults
hanzo config edit                    # Open config in $EDITOR
```

### Configuration

#### File: `~/.hanzo/config.yaml`

```yaml
api_key: ""                              # Prefer env var HANZO_API_KEY
base_url: "https://llm.hanzo.ai"        # LLM Gateway endpoint
organization: "hanzo"                    # Default organization
model: "zen-72b"                         # Default model for chat/complete
output: "text"                           # Default output format
stream: true                             # Enable streaming by default
temperature: 0.7                         # Default temperature
max_tokens: 0                            # 0 = model default

auth:
  method: "oauth"                        # "oauth" or "api_key"
  iam_url: "https://hanzo.id"            # IAM endpoint

container:
  runtime: "docker"                      # "docker" or "podman"
  gpu: false                             # Enable GPU passthrough by default
  cache_dir: "~/.hanzo/models"           # Model cache directory

plugin_paths:
  - "~/.hanzo/plugins"

auto_update:
  enabled: true
  channel: "stable"                      # "stable", "beta", or "nightly"
  check_interval: "24h"
```

#### Environment Variables

Precedence order (highest to lowest): command-line flags, environment variables, config file, built-in defaults.

| Variable | Description | Default |
|----------|-------------|---------|
| `HANZO_API_KEY` | API key for bearer token auth | |
| `HANZO_BASE_URL` | LLM Gateway base URL | `https://llm.hanzo.ai` |
| `HANZO_ORG` | Organization name | `hanzo` |
| `HANZO_MODEL` | Default model | `zen-72b` |
| `HANZO_OUTPUT` | Output format | `text` |
| `HANZO_CONFIG` | Config file path | `~/.hanzo/config.yaml` |
| `HANZO_NO_UPDATE` | Disable auto-update checks | `false` |
| `HANZO_IAM_URL` | IAM endpoint for OAuth | `https://hanzo.id` |
| `NO_COLOR` | Disable colored output | |

#### Credential Storage: `~/.hanzo/credentials.json`

```json
{
  "access_token": "eyJhbGciOi...",
  "refresh_token": "eyJhbGciOi...",
  "token_type": "Bearer",
  "expires_at": "2026-03-02T10:30:00Z",
  "scope": "openid profile email"
}
```

File permissions MUST be `0600`. The CLI refuses to read credentials files with group or world permissions.

### Pipe and Redirection Support

The CLI detects whether stdin/stdout are TTYs and adjusts behavior accordingly.

**stdin is a pipe**: Read the entire pipe content as the user message (for `chat`/`complete`) or input text (for `embed`).

```bash
cat prompt.txt | hanzo chat --model zen-72b
git diff HEAD~1 | hanzo chat --system "Review this diff for bugs"
hanzo chat "List 10 random words" | sort | uniq
```

**stdout is a pipe**: Disable streaming, suppress progress indicators, write raw response text. JSON output mode writes valid JSON to stdout and diagnostics to stderr.

```bash
hanzo chat "Write a haiku" > haiku.txt
hanzo chat --output json "List prime numbers" | jq '.choices[0].message.content'
```

**stderr**: All diagnostic messages, progress indicators, and errors go to stderr, ensuring stdout remains clean for piping.

### Output Formats

**`text`** (default): Human-readable output. For chat/complete, the raw response text. For models list, a formatted table. For embeddings, space-separated floats.

**`json`**: Machine-readable JSON matching the OpenAI API response schema. Enables integration with `jq` and other JSON tools.

**`yaml`**: Same structure as JSON but in YAML format for configuration pipelines and human-readable structured output.

### Streaming Protocol

The CLI implements the SSE streaming protocol as defined by the LLM Gateway (HIP-4):

1. CLI sends a POST to `/v1/chat/completions` with `stream: true`
2. Gateway returns `Content-Type: text/event-stream`
3. CLI parses SSE frames:
   ```
   data: {"id":"chatcmpl-...","choices":[{"delta":{"content":"Hello"}}]}
   data: {"id":"chatcmpl-...","choices":[{"delta":{"content":" world"}}]}
   data: [DONE]
   ```
4. CLI writes each `delta.content` to stdout immediately
5. On `[DONE]`, CLI prints a trailing newline and exits

Error handling during streaming: network interruptions trigger exponential backoff retries (max 3); malformed SSE frames are skipped with a stderr warning; HTTP errors mid-stream print to stderr and exit non-zero.

### Plugin System

Plugins extend the CLI with custom subcommands. A plugin is any executable binary named `hanzo-<name>` found in `$PATH` or `~/.hanzo/plugins/`.

**Discovery**: When the user runs `hanzo foo`, the CLI checks built-in commands first, then searches for `hanzo-foo` in `~/.hanzo/plugins/`, configured `plugin_paths`, and `$PATH`.

**Execution**: The plugin binary is executed with the remaining arguments. Configuration is passed via environment variables (`HANZO_API_KEY`, `HANZO_BASE_URL`, `HANZO_ORG`, `HANZO_CONFIG`).

**Plugin manifest** (optional): A `hanzo-<name>.yaml` file alongside the binary enables `hanzo help` integration and tab completion:

```yaml
name: mcp
version: 1.2.0
description: "Model Context Protocol tools"
commands:
  - name: list
    description: "List available MCP servers"
  - name: run
    description: "Run an MCP server"
```

**Known plugins**:

| Plugin | Binary | Description |
|--------|--------|-------------|
| MCP | `hanzo-mcp` | Model Context Protocol tools (HIP-10) |
| Agent | `hanzo-agent` | Multi-agent orchestration (HIP-9) |
| Flow | `hanzo-flow` | Workflow execution (HIP-13) |
| Platform | `hanzo-platform` | Platform management (HIP-14) |

### Shell Completions

```bash
hanzo completion bash > /etc/bash_completion.d/hanzo
hanzo completion zsh > "${fpath[1]}/_hanzo"
hanzo completion fish > ~/.config/fish/completions/hanzo.fish
hanzo completion powershell > hanzo.ps1
```

Completions cover all commands, subcommands, flags, model names (cached from `hanzo models list`), plugin subcommands (from manifests), and config keys.

### Auto-Update Mechanism

The CLI checks for updates on a configurable interval (default: every 24 hours). The check is non-blocking and runs in the background after command execution.

1. CLI fetches `https://api.hanzo.ai/v1/cli/version` for the latest version
2. If newer, prints a notice to stderr: `A new version of hanzo is available: v1.5.0 (current: v1.4.2)`
3. `hanzo update` downloads the appropriate binary, verifies its SHA256 checksum, and replaces the old binary atomically (write to temp file, then rename)

Disable with `HANZO_NO_UPDATE=true` or `auto_update.enabled: false`. CI environments should always disable auto-update. Channels: **stable** (semver releases), **beta** (weekly), **nightly** (from main HEAD).

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Usage error (invalid flags, missing arguments) |
| 3 | Authentication error (expired token, invalid key) |
| 4 | Network error (connection refused, timeout) |
| 5 | API error (rate limit, server error) |
| 6 | Configuration error (missing config, invalid values) |
| 10 | Model not found |
| 11 | Insufficient credits |
| 12 | Deployment failed |

```bash
hanzo chat "test" 2>/dev/null
case $? in
  0) echo "OK" ;;
  3) hanzo auth login && hanzo chat "test" ;;
  11) echo "Add credits at https://hanzo.ai/billing" ;;
  *) echo "Error: exit code $?" ;;
esac
```

## Implementation

### Build and Distribution

The CLI is built with Go's standard toolchain, producing a single statically-linked binary for each target platform.

| OS | Architecture | Binary Name |
|----|-------------|-------------|
| Linux | amd64 | `hanzo-linux-amd64` |
| Linux | arm64 | `hanzo-linux-arm64` |
| macOS | amd64 | `hanzo-darwin-amd64` |
| macOS | arm64 | `hanzo-darwin-arm64` |
| Windows | amd64 | `hanzo-windows-amd64.exe` |

```bash
# Release build with version embedding
go build -ldflags "-s -w \
  -X main.version=${VERSION} \
  -X main.commit=${GIT_SHA} \
  -X main.date=${BUILD_DATE}" \
  -o hanzo .
```

#### Installation Methods

| Method | Command |
|--------|---------|
| Direct download | `curl -fsSL https://cli.hanzo.ai/install.sh \| sh` |
| Homebrew | `brew tap hanzoai/tap && brew install hanzo` |
| npm | `npm install -g @hanzoai/cli` |
| pip | `pip install hanzoai-cli` |
| Go | `go install github.com/hanzoai/cli@latest` |

The install script detects OS and architecture, downloads the correct binary, verifies the SHA256 checksum, and places it in `/usr/local/bin/hanzo` (or `~/.local/bin/hanzo` if `/usr/local/bin` is not writable). The npm and pip packages wrap the Go binary, downloading the correct platform binary at install time.

### Internal Architecture

```
cmd/hanzo/
    main.go              # Entry point, command registration
    auth.go              # OAuth PKCE flow, token management
    chat.go              # Chat with streaming and REPL
    complete.go          # Text completion
    embed.go             # Embedding generation
    models.go            # Model listing and info
    deploy.go            # Deployment to Hanzo Platform
    logs.go              # Log streaming via WebSocket
    config.go            # Config get/set/list/edit
    update.go            # Self-update with checksum verification
    completion.go        # Shell completion generation
    plugin.go            # Plugin discovery and execution
internal/
    api/                 # HTTP client, SSE parser, retry logic
    auth/                # OAuth flow, credential storage, token refresh
    config/              # Config file parsing, env overlay, defaults
    container/           # Docker/Podman runtime, GPU detection
    output/              # Text, JSON, YAML, table formatters
    plugin/              # Plugin discovery, manifest parsing, execution
```

Dependencies: `cobra` (CLI framework), `viper` (config), `lipgloss` (terminal styling), and the Go standard library for HTTP, JSON, YAML, and OS interaction. No external HTTP client libraries.

### CI/CD Integration

```yaml
# GitHub Actions example
- name: Install Hanzo CLI
  run: curl -fsSL https://cli.hanzo.ai/install.sh | sh

- name: Deploy
  env:
    HANZO_API_KEY: ${{ secrets.HANZO_API_KEY }}
    HANZO_NO_UPDATE: "true"
  run: hanzo deploy --name ${{ github.repository }} --env GIT_SHA=${{ github.sha }}
```

In CI, use `HANZO_API_KEY` instead of OAuth. API keys are created at `https://console.hanzo.ai/settings/api-keys` and scoped to specific organizations and permissions. Use `--output json` for machine-parseable output in scripts.

### Telemetry

The CLI collects anonymous usage telemetry: command name, OS/arch, CLI version, command duration, and error codes. It does NOT collect prompts, responses, user content, API keys, tokens, file contents, or IP addresses. Opt-out via `hanzo config set telemetry false` or `HANZO_TELEMETRY=false`.

## Security Considerations

### Credential Protection

- **File permissions**: Credentials stored in `~/.hanzo/credentials.json` with mode `0600`. The CLI refuses to read credential files with group or world read permissions.
- **No credentials in logs**: The CLI never prints tokens, API keys, or secrets to stdout or stderr. Verbose mode redacts bearer tokens (showing only the first 8 characters).
- **Memory clearing**: After token refresh, the old token is zeroed in memory before garbage collection.
- **Keychain integration** (planned): macOS Keychain, Linux libsecret/kwallet, Windows Credential Manager. File-based storage remains as fallback.

### Token Lifecycle

- Access tokens expire after 168 hours (7 days, per IAM configuration)
- The CLI refreshes tokens automatically when they are within 5 minutes of expiry
- Refresh tokens expire after 720 hours (30 days)
- `hanzo auth logout` revokes both tokens server-side and deletes the local credential file
- Expired refresh tokens trigger a re-authentication prompt

### API Key Security

API keys are long-lived secrets. The CLI recommends OAuth for interactive use and API keys only for CI/CD. Keys should be passed via `HANZO_API_KEY` environment variable, not `--api-key` flag (flags appear in process listings and shell history). The CLI prints a warning if `--api-key` is used directly.

### Binary Verification

Release binaries are signed and checksummed. SHA256 checksums are published at `https://cli.hanzo.ai/checksums.txt`. Binaries are signed with the Hanzo release GPG key. Both the install script and `hanzo update` verify checksums before installing or replacing the binary.

### Network Security

All API communication uses HTTPS. The CLI refuses HTTP endpoints unless `--insecure` is explicitly passed (for local development). TLS verification uses the system CA store; custom CAs can be added via `HANZO_CA_CERT`. The CLI sets `User-Agent: hanzo-cli/<version> (<os>; <arch>)`.

### Plugin Security

Plugins are arbitrary executables. The CLI does not sandbox them. Users are responsible for vetting plugins. The CLI only searches `$PATH` and configured `plugin_paths`, does not download or install plugins automatically, does not execute with elevated privileges, and passes credentials via environment variables (not CLI arguments).

## Backwards Compatibility

The CLI follows semantic versioning and will remain at v1.x.x. Breaking changes to command syntax, output format, or config schema require a major version bump. When the config schema changes, the CLI automatically migrates `~/.hanzo/config.yaml` on first run, backing up to `~/.hanzo/config.yaml.bak`. If the LLM Gateway introduces breaking API changes, the CLI provides a compatibility layer for at least one minor version with deprecation warnings.

## References

1. [HIP-4: LLM Gateway - Unified AI Provider Interface](./hip-0004-llm-gateway-unified-ai-provider-interface.md) -- The API the CLI consumes
2. [HIP-9: Agent SDK - Multi-Agent Orchestration](./hip-0009-agent-sdk-multi-agent-orchestration-framework.md) -- Agent plugin integration
3. [HIP-10: Model Context Protocol Integration](./hip-0010-model-context-protocol-mcp-integration-standards.md) -- MCP plugin integration
4. [HIP-14: Application Deployment Standard](./hip-0014-application-deployment-standard.md) -- `hanzo deploy` target platform
5. [HIP-26: Identity & Access Management Standard](./hip-0026-identity-access-management-standard.md) -- OAuth authentication via hanzo.id
6. [HIP-31: Observability & Metrics Standard](./hip-0031-observability-metrics-standard.md) -- `hanzo logs` data source
7. [HIP-33: Container Registry Standard](./hip-0033-container-registry-standard.md) -- Image push target for deployments
8. [HIP-40: SDK Standard](./hip-0040-sdk-standard.md) -- SDK conventions the CLI follows
9. [OpenAI CLI](https://github.com/openai/openai-python) -- Command naming conventions
10. [Cobra](https://github.com/spf13/cobra) -- CLI framework
11. [RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636) -- PKCE specification for OAuth
12. [no-color.org](https://no-color.org) -- Convention for disabling terminal colors
13. [Hanzo CLI Repository](https://github.com/hanzoai/cli)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
