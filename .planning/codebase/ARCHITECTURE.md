# Architecture

## Pattern

**Multi-layered, scene-based CLI application** with a state machine router, pluggable provider abstraction, XState-driven task orchestration, and controlled tool execution with approval workflows.

## Layers

```
User Input
    ↓
Scene Router (src/router.js) — boot → setup → chat state machine
    ↓
Command System (src/commands/) — /config, /model, /provider, /prompt, /resume, etc.
    ↓
Task Orchestrator (src/tools/orchestrator.js) — domain classification, worker spawning
    ↓
Provider Adapters (src/providers/) — Anthropic, OpenAI, Google, Ollama, DeepSeek, LM Studio
    ↓
Tool Execution (src/tools/) — bash/file with policy evaluation + approval workflow
    ↓
Session Recording (src/history/) — JSONL conversation persistence
```

## Entry Points

- `bin/mr-mush.js` — interactive TUI CLI entry point
- `bin/mr-mush-harbor.js` — Harbor/Terminal-Bench 2.0 headless adapter
- `src/router.js` — scene navigation state machine

## Key Abstractions

### Provider Pattern
Each LLM provider implements a consistent interface:
```js
{ id, source, binary, exec, fetchModels, getAuthRequirements, capabilities }
```
Providers: `src/providers/anthropic.js`, `openai.js`, `google.js`, `ollama.js`, `deepseek.js`, `lmstudio.js`

### Task Orchestration (XState)
`src/tools/orchestrator.js` — XState machine with states:
- `idle → routing → dispatching → executing → success/error`
- Routes prompts to domain workers (devops, backend, frontend, analysis, general)
- Circuit breaker built in (`circuit-open` state)

### Prompt Stack Composition
Immutable multi-layer prompt system built at execution time:
```
system → profile → provider → project (MRMUSH.md / AGENTS.md)
```
Managed in `src/commands/index.js` via `/prompt` commands.

### Approval Workflow Pattern
Tool execution flow:
```
Tool call → policy evaluation → allowlist check → user approval UI → cache approval → execute
```
- `src/tools/approval-ui.js` — interactive approval prompts
- `.mrmush/approvals.json` — project-scoped approval cache

### Repository Intelligence
`src/intelligence/` — AST-based repo mapping using tree-sitter:
- Symbol extraction → weighted file/function ranking → token-budgeted output
- Configured via repo map modes (full, selective, off)

## Data Flow

```
User message
    → command router (slash commands handled inline)
    → task orchestrator (domain classification via LLM)
    → worker spawned with appropriate system prompt
    → provider called with tool definitions
    → tool calls extracted from stream
    → bash/file tools executed (with approval)
    → response streamed to terminal UI
    → conversation saved to JSONL session file
```

## Configuration System

`src/config/` — Zod-validated TOML config with layered merging:
```
~/.mrmush/config.toml (global)
    ↓ merged with
.mrmush/config.toml (project-level)
    ↓ overridden by
MRMUSH_* environment variables
```

## Session History

`src/history/` — JSONL-based:
- One file per session
- Session index for `/resume` command
- Metrics aggregation (token usage, message counts)

## Localization

`src/i18n/` + `locales/en.json`, `locales/ru.json` — runtime locale switching via `MRMUSH_LOCALE`.
