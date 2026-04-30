---
topic: src/ui/ package coupling & component design
reviewers: [claude-cli]
reviewed_at: 2026-04-25T15:45:00Z
files_reviewed:
  - src/ui/components/index.js
  - src/ui/scenes/chat.js
  - src/ui/scenes/setup.js
---

# Code Review — UI Package Coupling

## Claude CLI Review

## 1. Summary

`components/index.js` is a dead letter. It exports three functions (`header`, `chatMessage`, `divider`) that neither `chat.js` nor `setup.js` actually use — every scene has independently re-implemented its own rendering, layout math, and escape-sequence management. The result is a 1,557-line monolith where message formatting, streaming state, session orchestration, file-mention resolution, and ANSI escape control all coexist with no internal seams. `createComponents(theme, i18n)` exists as a good intention that never connected to anything real.

---

## 2. Root Causes

**Why did this happen?**

- **chat.js grew organically.** The streaming live-region problem is genuinely complex — it requires coordinating `clearLiveRegion`, `renderLiveRegion`, cursor-up escape sequences, and passive-input frame composition. That complexity made it easier to keep everything in one closure where all the mutable state is visible, rather than passing it through a boundary.

- **`createComponents` has the wrong API shape.** It returns static render-to-stdout functions but the chat scene needs frame builders — functions that *return* `{ text, blockHeight, cursorUpLines }` so the live-region math can compose them. There was no natural way to plug the component factory into the existing rendering model, so chat.js ignored it and built its own.

- **setup.js is fine as-is.** It uses `@clack/prompts` directly because that's the right level of abstraction for wizard-style prompts. The coupling concern there is minor.

---

## 3. Specific Issues

**A. Dead component factory** — `src/ui/components/index.js:1–25`
The entire file is unused. `header`, `chatMessage`, `divider` never appear in either scene.

**B. Layout utilities duplicated or left unfinished**
- `chat.js:37–90` — `wrapText`, `visibleLength`, `fitText`, `frameWidth` are private to chat.js. `visibleLength` at line 82 is a stub (it just calls `.length`, ignoring ANSI escape codes), which means it'll measure incorrectly for colored text.
- `components/index.js` has no layout utilities at all, despite being the nominal shared layer.

**C. Theme/color access pattern repeated 12+ times**
`chat.js:28–30` defines `color(theme, name, fallback)` and `activeTheme(context)`, then every frame builder calls them inline. The same `context.config.ui?.message_dot ?? theme.symbols?.messageDot ?? "⬢"` triple-fallback appears at lines **263, 307, 325, 344, 369** — five identical expressions for the dot symbol.

**D. `buildAiMessageFrame` / `buildUserMessageFrame` are the real component primitives**
`chat.js:260–320` — these return `{ text, blockHeight, cursorUpLines }` which is a solid frame object model. The live-region system at lines **1147–1167** depends on this exact shape. This is the actual component contract; it just lives in the wrong place.

**E. Streaming live-region state entangled in per-request closure** (`chat.js:1064–1215`)
`liveRegionCursorUpLines`, `liveRegionBlockHeight`, `activeBlockMode`, `clearLiveRegion`, `renderLiveRegion`, `resetLiveRegionState` are all local vars inside the `while(true)` loop. They reference `passiveInput` from the outer scope. Correct for runtime but untestable and impossible to reuse.

**F. `resetTerminalSurface` defined in setup.js** (`setup.js:24–26`)
A generic terminal utility living in a scene file. `chat.js` has its own variant at line 866 without a named function. Both scenes independently manage terminal surface state.

**G. Hardcoded Russian strings** (`chat.js:372`) — `"collapse" / "expand"` bypass the i18n system. **This is a bug.**

---

## 4. Proposed Component Boundaries

```
src/ui/
  components/
    layout.js          # frameWidth, wrapText, fitText, visibleLength (with ANSI stripping)
    frame.js           # buildAiMessageFrame, buildUserMessageFrame,
                       #   buildToolEventFrame, buildTerminalEventFrame,
                       #   buildExpandableTerminalEventFrame
                       # All return { text, blockHeight, cursorUpLines }
    theme.js           # activeTheme(context), color(theme, name, fallback),
                       #   resolveSymbol(config, theme) — the dot-fallback chain
    terminal.js        # resetTerminalSurface, INLINE_TERMINAL_MODE,
                       #   cursor escape helpers (clearRegion, cursorUp)
    live-region.js     # createLiveRegion(getPassiveInputFrame) → { render, clear, reset }
                       # Pure state machine — no provider/session coupling
    pending.js         # formatPendingLine, startPendingAnimation, stopPendingAnimation
  scenes/
    chat.js            # Orchestration only: input loop, provider call, session, commands
    setup.js           # Wizard flow — stays mostly as-is, uses terminal.js
```

**Key principle:** Components return strings or frame objects. Scenes own the event loop and call `process.stdout.write`. Components never call `process.stdout.write` directly.

---

## 5. Refactoring Path

Each step is independently shippable and leaves the app working:

| # | Step | What moves | Risk |
|---|------|-----------|------|
| 1 | Extract `layout.js` | `wrapText`, `fitText`, `frameWidth` from `chat.js:37–90`. Fix `visibleLength` to strip ANSI. | Low |
| 2 | Extract `theme.js` | `activeTheme`, `color`, `resolveSymbol`. Deduplicate 5 copy-pasted dot expressions. | Low |
| 3 | Extract `terminal.js` | `INLINE_TERMINAL_MODE`, `resetTerminalSurface`. Add shared `clearRegion(lines)`. | Medium |
| 4 | Extract `frame.js` | All `build*Frame` functions. Already pure — mechanical move. | Low |
| 5 | Extract `live-region.js` | `createLiveRegion(getPassiveInputFrame)` encapsulating cursor state. | **High** |
| 6 | Fix i18n bug | Replace `chat.js:372` hardcoded Russian with `i18n.t("chat.expand/collapse")`. | Low |
| 7 | Delete/repurpose `components/index.js` | It's unused. Either delete or turn into barrel re-export. | Low |

**Start with `frame.js`** — highest value, lowest risk. The live-region extraction needs integration test coverage first.

---

## 6. Risk Assessment

**What "debuggable" means concretely:** frame builders being pure (`context → { text, blockHeight, cursorUpLines }`) means you can unit-test them by asserting on the returned string without spawning a TTY. The live-region state machine being a named object (`liveRegion.render(frame)`, `liveRegion.clear()`) means you can log its state transitions without reading through 200 lines of closure.

| Step | Risk | What Could Break |
|------|------|-----------------|
| layout.js | Low | Pure functions, easy to snapshot-test |
| theme.js | Low | Cosmetic; a missed fallback breaks colors, not crashes |
| terminal.js | Medium | Wrong escape sequences corrupt terminal state |
| frame.js | Low | Already pure; just moving them |
| live-region.js | **High** | Streaming/resize/abort interactions are subtle |
| i18n fix | Low | Additive locale key |
