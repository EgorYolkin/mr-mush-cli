# Concerns

## Tech Debt

### Monolithic Files
| File | Lines | Problem |
|------|-------|---------|
| `src/ui/scenes/chat.js` | ~1,557 | Monolithic chat scene mixing UI, state, tool handling, streaming |
| `src/ui/input.js` | ~871 | Large input handler mixing text model, completion logic, and rendering |
| `src/config/loader.js` | ~461 | Complex recursive merging with implicit precedence rules |

**Impact:** Hard to test, hard to extend, high merge conflict risk.

### Streaming State Fragmentation
- Streaming state scattered across multiple closure variables in `chat.js`
- Risk of race conditions between token animation and stream completion

## Known Bugs

1. **Silent history recording failures** — `chat.js` lines ~748, 957, 1011, 1054: errors swallowed silently, conversations may not persist
2. **Malformed JSON tool parsing** — no recovery path when provider returns malformed tool call JSON
3. **Token animation race condition** — animation can fire after stream completes, causing visual glitches
4. **Insufficient bash environment isolation** — bash execution does not fully sanitize the environment
5. **File read before approval** — large file content loaded into memory before user approves file-write tool

## Security

| Risk | Location | Detail |
|------|----------|--------|
| Bash environment not sanitized | `src/tools/` | Inherits full shell environment including sensitive vars |
| Approval cache in plaintext | `.mrmush/approvals.json` | No integrity validation — tampered cache bypasses approvals |
| Large file reads before approval | `src/tools/` | Memory spike risk; content visible before user consents |
| No rate limiting on file writes | `src/tools/` | Model could write many files in rapid succession |

## Performance

| Bottleneck | Location | Detail |
|------------|----------|--------|
| Repo map re-parsed every prompt | `src/intelligence/` | No incremental update; slow for large repos |
| Terminal event expansion stores full output | `src/ui/scenes/chat.js` | Memory grows unbounded with expandable events |
| Symbol cache never evicted | `src/intelligence/symbol-cache.js` | Potential memory leak in long sessions |
| Config reloaded every prompt | `src/config/loader.js` | Unnecessary disk I/O per message |

## Fragile Areas

| Area | Risk |
|------|------|
| Token extraction | Multiple provider naming conventions for `usage` fields — breaks silently when providers change response shape |
| Tool markdown parsing | Single-line regex for extracting tool calls — breaks on multi-line or nested content |
| Circuit breaker | Implicit reset logic in XState machine — hard to reason about state transitions |
| File mention expansion | Silent truncation when file content exceeds token budget — user unaware context was cut |

## Scaling Limits

| Limit | Impact |
|-------|--------|
| Session history directory grows unbounded | Disk accumulation with no cleanup policy |
| Repo map indexing slow >5,000 files | Interactive latency in large monorepos |
| Memory growth with expandable terminal events | Long sessions may accumulate significant memory |
| Config file grows with multiple providers | No size validation or warning |

## Test Coverage Gaps

- Tool execution path — entirely untested
- Provider integration (live calls) — untested
- UI rendering — untested
- Config merging edge cases — untested
- Orchestrator error recovery — untested
- Approval workflow — untested

Estimated overall coverage: **<20%**
