# External Integrations

**Analysis Date:** 2026-04-25

## APIs & External Services

**Model Providers:**
- **OpenAI** - Chat models via `codex` CLI wrapper
  - Models: gpt-5.4, other OpenAI models
  - SDK/Client: `codex` binary (external CLI)
  - Auth: Handled by local Codex CLI installation
  - Implementation: `src/providers/openai.js` - spawns `codex exec` subprocess

- **Anthropic** - Claude models via `claude` CLI wrapper
  - Models: claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001
  - SDK/Client: `claude` binary (external CLI)
  - Auth: Handled by local Claude CLI installation
  - Implementation: `src/providers/anthropic.js` - spawns `claude` subprocess
  - Support for extended thinking via `--effort` flag

- **Google Gemini** - Remote API integration
  - Models: gemini-2.5-pro and other Gemini models dynamically fetched
  - SDK/Client: Native `fetch` HTTP client
  - Auth: `GEMINI_API_KEY` environment variable
  - Endpoint: `https://generativelanguage.googleapis.com/v1beta/`
  - Implementation: `src/providers/google.js`
  - Capabilities: Native tool calling, streaming via SSE
  - Tool format: Google Gemini `functionCall` format

- **DeepSeek** - Remote API integration
  - Models: deepseek-chat, deepseek-reasoner
  - SDK/Client: Native `fetch` HTTP client
  - Auth: `DEEPSEEK_API_KEY` environment variable
  - Endpoint: `https://api.deepseek.com/v1/chat/completions` (OpenAI-compatible)
  - Implementation: `src/providers/deepseek.js`
  - Capabilities: Native tool calling, streaming

- **Ollama** - Local LLM inference
  - Models: Dynamically fetched from running Ollama instance
  - SDK/Client: Native `fetch` HTTP client
  - Connection: Configurable via `MRMUSH_OLLAMA_BASE_URL` or `OLLAMA_HOST` (defaults to `http://localhost:11434`)
  - Endpoint: `/api/tags`, `/api/show`, `/v1/chat/completions` (OpenAI-compatible)
  - Implementation: `src/providers/ollama.js`
  - Tool-capable models: llama3.1+, qwen2.5+, mistral, command-r, hermes3, firefunction
  - Capabilities: Dynamic tool calling based on model detection

- **LM Studio** - Local LLM inference
  - Models: Dynamically fetched from running LM Studio instance
  - SDK/Client: Native `fetch` HTTP client
  - Connection: Fixed at `http://localhost:1234`
  - Endpoint: `/v1/models`, `/v1/chat/completions` (OpenAI-compatible)
  - Implementation: `src/providers/lmstudio.js`
  - Capabilities: Optimistic tool calling (graceful degradation if unsupported)

## Tool Calling & Streaming

**OpenAI-Compatible Protocol:**
- `src/providers/openai-compatible.js` - Shared implementation for OpenAI-compatible APIs
- Supports streaming via `stream: true` and `include_usage: true` in request body
- Accumulates streaming tool call deltas into complete function calls
- Used by: DeepSeek, Ollama, LM Studio providers
- Tool format: `{ id, function: { name, arguments } }`

**Streaming:**
- Server-sent events (SSE) for Gemini and OpenAI-compatible providers
- Token accumulation and callback via `onToken` option
- Cancellation via AbortSignal

## Data Storage

**Configuration Storage:**
- TOML format files:
  - User-level: `~/.mrmush/config.toml`
  - Project-level: `.mrmush/config.toml`
- Theme configuration: `~/.mrmush/theme.yaml`

**Session History:**
- Local filesystem storage in `~/.mrmush/history/` (managed by `src/history/store.js`)
- Session metadata and transcript persistence
- Metrics per session (token usage, timing)

**File Storage:**
- Local filesystem only
- Tool-enabled write operations to project files via `write_file` tool
- Denied paths: `.git`, `node_modules`, `.env*`, `.mrmush/` (configurable)

**Caching:**
- In-memory cache for model lists per provider
- TTL configurable via `cache.models_ttl_ms` (defaults to 1 hour)

## Authentication & Identity

**Auth Providers:**
- **OpenAI**: Via local `codex` CLI - no direct HTTP auth in this codebase
- **Anthropic**: Via local `claude` CLI - no direct HTTP auth in this codebase
- **Google Gemini**: Direct API key (`GEMINI_API_KEY` environment variable)
  - Passed via query parameter: `?key=<api_key>`
- **DeepSeek**: Direct API key (`DEEPSEEK_API_KEY` environment variable)
  - Passed via Authorization header: `Bearer <api_key>`
- **Ollama**: No authentication required (local instance)
- **LM Studio**: No authentication required (local instance)

**Session Management:**
- No persistent user session tokens
- Per-request transient state in `xstate` state machine
- Language preference stored in local config

## Monitoring & Observability

**Error Tracking:**
- None - errors logged to stderr or caught in UI error handling
- Structured error messages for user display

**Logs:**
- Console-based logging only (no persistent logging infrastructure)
- Streamed token output for real-time feedback
- Tool execution output captured in session transcript

**Metrics Collected:**
- Token usage per request (from provider responses)
- Message counts per session
- Session duration
- Stored in `~/.mrmush/history/` per session

## CI/CD & Deployment

**Hosting:**
- Not a service - standalone CLI application
- Distributed via npm registry
- GitHub releases available

**Package Distribution:**
- npm package: `mr-mush`
- Git repository: `https://github.com/EgorYolkin/mr-mush-cli`
- Update checking: Fetches latest version from `https://raw.githubusercontent.com/EgorYolkin/mr-mush-cli/main/package.json`

**CI Pipeline:**
- No explicit CI configuration detected
- Update installation via `npm install git+https://github.com/EgorYolkin/mr-mush-cli.git`

## Environment Configuration

**Required env vars:**
- Provider-specific API keys (varies by provider):
  - `GEMINI_API_KEY` - Required for Google Gemini
  - `DEEPSEEK_API_KEY` - Required for DeepSeek
  - `OPENAI_API_KEY` - Required for OpenAI (if using `codex` CLI)
  - `ANTHROPIC_API_KEY` - Required for Anthropic (if using `claude` CLI)

**Optional env vars:**
- `MRMUSH_PROVIDER` - Default provider to use
- `MRMUSH_MODEL` - Default model to use
- `MRMUSH_PROFILE` - Default profile
- `MRMUSH_THINKING` - Extended thinking level
- `MRMUSH_LOCALE` - UI language
- `MRMUSH_OLLAMA_BASE_URL` - Ollama server URL
- `OLLAMA_HOST` - Alternative Ollama configuration

**Secrets location:**
- Environment variables only (no .env file management in the app)
- User is responsible for managing `.bashrc`, `.zshrc`, or environment setup

## Webhooks & Callbacks

**Incoming:**
- Harbor integration webhook endpoint: `bin/mr-mush-harbor.js` accepts CLI arguments for batch execution
- No HTTP server - runs as CLI tool only

**Outgoing:**
- None - only provider API calls for inference
- No callback mechanisms to external services

## Integration Points

**Bash Tool Execution:**
- Direct subprocess spawning via `src/tools/bash.js`
- Supports: pwd, ls, find, rg, cat, sed, head, tail, tree, git commands
- Configurable allowlist in `.mrmush/config.toml`
- Timeout: 30 seconds (configurable)
- Max output: 20,000 chars (configurable)
- Max calls per session: 8 (configurable)

**File Write Tool:**
- Direct filesystem write operations via `src/tools/file-write.js`
- Requires approval via policy layer (`src/tools/policy.js`)
- Max file size: 512 KB (configurable)
- Denied paths: `.git`, `node_modules`, `.env*`, `.mrmush/` (configurable)

**Harbor Benchmark Integration:**
- Python agent wrapper: `integrations/harbor/mr_mush_agent.py`
- Spawns headless mush process via `src/bench/headless.js`
- Accepts JSON instruction and returns structured result
- Used for Terminal-Bench 2.0 evaluation framework

**Code Intelligence (LSP):**
- `vscode-languageserver-protocol` ^3.17.5 imported but LSP client is stubbed (`src/intelligence/lsp-client.js`)
- Placeholder for future LSP symbol annotation
- Currently uses local Tree-sitter parsing only

---

*Integration audit: 2026-04-25*
