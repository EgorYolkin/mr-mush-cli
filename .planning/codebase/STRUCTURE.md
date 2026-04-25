# Directory Structure

## Layout

```
agents-engine-cli/
├── bin/
│   ├── mr-mush.js                  # Interactive TUI entry point
│   └── mr-mush-harbor.js           # Harbor/Terminal-Bench headless adapter
│
├── src/
│   ├── router.js                   # Scene navigation state machine
│   ├── commands/
│   │   └── index.js                # All /command handlers (config, model, provider, prompt, resume…)
│   ├── providers/
│   │   ├── anthropic.js            # Anthropic Claude adapter
│   │   ├── openai.js               # OpenAI adapter
│   │   ├── openai-compatible.js    # Generic OpenAI-compatible adapter
│   │   ├── google.js               # Google Gemini adapter
│   │   ├── deepseek.js             # DeepSeek adapter
│   │   ├── ollama.js               # Ollama (local) adapter
│   │   └── lmstudio.js             # LM Studio (local) adapter
│   ├── tools/
│   │   ├── orchestrator.js         # XState task machine, domain routing
│   │   ├── approval-ui.js          # User approval prompts for tool calls
│   │   ├── definitions.js          # Tool definitions (bash, file-write, etc.)
│   │   ├── normalize.js            # Tool call normalization across providers
│   │   └── native-loop.js          # Native tool loop execution
│   ├── ui/
│   │   ├── scenes/
│   │   │   └── chat.js             # Main chat scene (1,557 lines — monolithic)
│   │   ├── input.js                # Multi-line input handler (871 lines)
│   │   ├── mush-card.js            # Status card / header component
│   │   └── theme.js                # Theme configuration
│   ├── intelligence/
│   │   ├── repo-map.js             # AST-based repository mapper (tree-sitter)
│   │   └── symbol-cache.js         # Symbol extraction cache
│   ├── config/
│   │   ├── loader.js               # TOML config loading and merging (461 lines)
│   │   └── schema.js               # Zod validation schema
│   ├── history/
│   │   ├── session.js              # JSONL session storage
│   │   └── index.js                # Session index and metrics
│   ├── update/
│   │   ├── checker.js              # Version check against npm registry
│   │   └── installer.js            # npm-based self-update
│   ├── bench/
│   │   └── ...                     # Benchmarking utilities
│   ├── i18n/
│   │   └── index.js                # Locale loading and t() helper
│   └── prompts/
│       └── ...                     # System prompt templates for workers
│
├── integrations/
│   └── harbor/
│       └── mr_mush_agent.py        # Python Harbor adapter for Terminal-Bench 2.0
│
├── jobs/                           # Background job definitions
│
├── tests/
│   ├── bench/                      # Benchmark tests
│   ├── providers/                  # Provider unit tests
│   ├── update-checker.test.js      # Update checker tests
│   └── update-installer.test.js    # Installer tests
│
├── locales/
│   ├── en.json                     # English strings
│   └── ru.json                     # Russian strings
│
├── .mrmush/
│   ├── config.toml                 # Project-level config
│   └── approvals.json              # Project-scoped tool approval cache
│
├── MRMUSH.md                       # Project system prompt injected into LLM context
├── AGENTS.md                       # Agent-specific prompt file
├── package.json
└── README.md
```

## Key Locations

| Purpose | Path |
|---------|------|
| CLI entry | `bin/mr-mush.js` |
| Harbor entry | `bin/mr-mush-harbor.js` |
| Scene router | `src/router.js` |
| Commands | `src/commands/index.js` |
| Provider interface | `src/providers/*.js` |
| Tool orchestration | `src/tools/orchestrator.js` |
| Tool approval | `src/tools/approval-ui.js` |
| Main chat UI | `src/ui/scenes/chat.js` |
| Config loading | `src/config/loader.js` |
| Session history | `src/history/` |
| Repo intelligence | `src/intelligence/` |
| Localization | `locales/`, `src/i18n/` |
| Project prompt | `MRMUSH.md` |
| Approval cache | `.mrmush/approvals.json` |

## Naming Conventions

- `*.js` — all source files are CommonJS modules (no TypeScript, no ESM)
- Files named by domain/responsibility, not by type
- Provider adapters follow `{provider-name}.js` convention
- Scene files live under `src/ui/scenes/`
- Test files co-located in `tests/` with matching names (`*.test.js`)
