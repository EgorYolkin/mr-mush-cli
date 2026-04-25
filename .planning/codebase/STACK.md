# Technology Stack

**Analysis Date:** 2026-04-25

## Languages

**Primary:**
- JavaScript (ES modules) - All runtime code, CLI implementation, providers, tooling
- Node.js 18+ - Runtime environment

**Secondary:**
- Python - Harbor agent integration for Terminal-Bench 2.0 evaluation framework (`integrations/harbor/mr_mush_agent.py`)
- YAML - Theme configuration files
- TOML - User and project configuration

## Runtime

**Environment:**
- Node.js 18 or higher (ES modules with `"type": "module"` in package.json)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` present

## Frameworks

**Core UI:**
- `@clack/prompts` ^0.9.1 - Terminal UI components and interactive prompts
- `chalk` ^5.4.1 - Terminal color and styling
- `figures` ^6.1.0 - Unicode symbols for terminal UI

**Configuration & Parsing:**
- `smol-toml` ^1.6.1 - TOML parser for `.mrmush/config.toml` and `~/.mrmush/config.toml`
- `yaml` ^2.8.3 - YAML parser for theme configuration
- `zod` ^4.3.6 - Runtime schema validation for config loading

**Code Analysis & Intelligence:**
- `web-tree-sitter` ^0.24.7 - WebAssembly Tree-sitter parser (core language parsing)
- `tree-sitter-javascript` ^0.23.1 - JavaScript grammar for AST parsing
- `tree-sitter-python` ^0.23.6 - Python grammar for AST parsing
- `tree-sitter-typescript` ^0.23.2 - TypeScript/JSX grammar for AST parsing

**State Machine & Orchestration:**
- `xstate` ^5.30.0 - State machine library for task orchestration and workflow management

**Internationalization:**
- `@messageformat/core` ^3.4.0 - MessageFormat parsing for multi-language support

**Language Server Protocol:**
- `vscode-languageserver-protocol` ^3.17.5 - LSP protocol implementation
- `vscode-jsonrpc` ^8.2.1 - JSON-RPC transport for LSP

## Key Dependencies

**Critical:**
- `web-tree-sitter` - Enables AST parsing and code intelligence features (repo map, symbol cache)
- `xstate` - Powers task orchestration, tool approval flows, and multi-agent routing
- `zod` - Validates all user and project configuration at runtime

**Infrastructure:**
- `@clack/prompts` - Interactive terminal UI for chat, tool approvals, setup flow
- `chalk` + `figures` - Terminal styling and visual indicators

## Configuration

**Environment:**
- Global config: `~/.mrmush/config.toml` (user-level settings)
- Project config: `.mrmush/config.toml` (project-level overrides)
- Project prompts: `MRMUSH.md`, `AGENTS.md` (custom system and agent instructions)

**Schema Definition:**
- `src/config/schema.js` - Zod schema defining config structure and defaults
- `src/config/loader.js` - Config loading, merging, and validation logic

**Environment Variable Overrides:**
- `MRMUSH_PROVIDER` - Active provider (openai|anthropic|google|deepseek|ollama|lmstudio)
- `MRMUSH_MODEL` - Active model identifier
- `MRMUSH_PROFILE` - Active profile (default)
- `MRMUSH_THINKING` - Thinking level (off|minimal|low|medium|high|xhigh)
- `MRMUSH_LOCALE` - UI language (en|ru)
- `MRMUSH_OLLAMA_BASE_URL` - Ollama server URL (defaults to http://localhost:11434)
- `OLLAMA_HOST` - Alternative Ollama host configuration
- Provider-specific API keys:
  - `OPENAI_API_KEY` - OpenAI API key (Codex CLI integration)
  - `ANTHROPIC_API_KEY` - Anthropic API key (Claude CLI integration)
  - `GEMINI_API_KEY` - Google Gemini API key
  - `DEEPSEEK_API_KEY` - DeepSeek API key

**Build:**
- No build step required (native ES modules)
- Type checking via JSDoc comments where needed

## Platform Requirements

**Development:**
- Node.js 18+
- macOS or Linux (bash shell required for tool execution)

**Production:**
- Node.js 18+
- macOS or Linux
- Terminal with 256-color support
- One or more AI provider CLIs installed:
  - Anthropic Claude CLI (`claude` binary)
  - OpenAI Codex CLI (`codex` binary)
  - Or remote API access to: OpenAI, Google Gemini, DeepSeek
  - Or local: Ollama, LM Studio

---

*Stack analysis: 2026-04-25*
