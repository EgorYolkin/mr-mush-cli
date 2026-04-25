# Testing

## Framework

No formal test framework detected — tests appear to be plain Node.js scripts or use a lightweight runner. Test files use `.test.js` suffix.

## Test Files

```
tests/
├── bench/                      # Benchmarking utilities
├── providers/                  # Provider-level unit tests
├── update-checker.test.js      # npm update checker tests
└── update-installer.test.js    # Self-update installer tests
```

## What's Tested

- **Update checker** — version comparison logic against npm registry
- **Update installer** — npm-based self-update flow
- **Providers** — partial coverage of provider adapters
- **Benchmarks** — performance tests in `tests/bench/`

## What's NOT Tested

Major coverage gaps identified:

| Area | Status |
|------|--------|
| Tool execution path (bash/file) | Not tested |
| Provider integration (live API calls) | Not tested |
| UI rendering (`src/ui/scenes/chat.js`) | Not tested |
| Config merging edge cases | Not tested |
| Orchestrator error recovery | Not tested |
| Approval workflow | Not tested |
| Session history recording | Not tested |
| Command handlers (`src/commands/index.js`) | Not tested |

## Running Tests

```bash
# Check syntax validity
node --check src/ui/scenes/chat.js
node --check src/ui/input.js

# Run test files directly
node tests/update-checker.test.js
node tests/update-installer.test.js
```

## Coverage

Overall coverage is **low** — estimated <20% of application code paths are covered. The core chat loop, tool execution, provider adapters, and UI rendering are entirely untested.

## Mocking

No formal mocking library in use. Tests rely on direct module invocation or manual stubs where needed.
