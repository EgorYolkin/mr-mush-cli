# Coding Conventions

**Analysis Date:** 2026-04-25

## Naming Patterns

**Files:**
- Kebab-case for multi-word files: `ast-parser.js`, `file-write.js`, `action-selector.js`, `repo-map.js`
- Descriptive names that indicate purpose
- Scene/component files group related functionality: `src/ui/scenes/chat.js`, `src/ui/scenes/setup.js`

**Functions:**
- camelCase for function names: `parseFileSymbols()`, `loadConfig()`, `checkForUpdate()`, `runBashCommand()`
- Descriptive verb-noun pattern: `buildRepoMap()`, `resolveOllamaBaseUrl()`, `normalizeHeadlessOptions()`
- Async functions consistently use async/await: `async function loadState()`, `async function saveConfig()`

**Variables:**
- camelCase for all variable declarations: `tempRoot`, `currentVersion`, `latestVersion`, `dottedPath`
- SCREAMING_SNAKE_CASE for constants: `REMOTE_PACKAGE_URL`, `APP_DIR_NAME`, `CONFIG_FILE_NAME`, `DEFAULT_MAX_FILES`, `FETCH_TIMEOUT_MS`
- Prefix underscore for private/internal utilities: `safeEnv()` (module-private), `truncate()` (module-private)
- Descriptive Boolean names with is/has prefix: `isExported()`, `isTopLevelSymbol()`, `timedOut`, `outputTruncated`

**Types:**
- PascalCase for classes: `class Router`, `class EventEmitter`
- Interface-like objects returned from functions are plain objects (not typed, using Zod schemas for validation)

## Code Style

**Formatting:**
- No explicit linter/formatter configured (no .prettierrc, .eslintrc found)
- 2-space indentation observed throughout codebase
- Lines typically kept under 100 characters, some reach 120+
- No semicolons at statement ends (but used where needed in JSDoc)

**Linting:**
- No ESLint config detected
- Code appears hand-formatted with consistent style

**Module System:**
- ECMAScript modules (ESM) exclusively: `import ... from`, `export function`, `export class`
- package.json has `"type": "module"` 
- Relative imports for local modules: `import { loadConfig } from "../config/loader.js"`
- Absolute imports from node built-ins: `import fs from "node:fs/promises"`

## Import Organization

**Order:**
1. Node.js built-in imports: `import fs from "node:fs/promises"`
2. Third-party package imports: `import { z } from "zod"`
3. Local relative imports: `import { loadConfig } from "../config/loader.js"`

**Path Aliases:**
- No path aliases in use; all imports are relative paths

**Example:**
```javascript
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { getRepoMapResult } from "../intelligence/index.js";
import { builtInConfig, userConfigSchema } from "./schema.js";
```

## Error Handling

**Patterns:**
- Explicit try-catch blocks for async operations
- Functions return result objects with `ok` boolean flag and either `error` or data fields
- Example from `src/tools/parser.js`:
```javascript
try {
  parsed = JSON.parse(match[1].trim());
} catch (err) {
  return {
    ok: false,
    error: `Invalid agents-tool JSON: ${err.message}`,
  };
}
```

- Promise-based error handling: `.catch(() => null)` to silently fallback
- Example from `src/router.js`:
```javascript
this.context.config = await loadConfig({...}).catch(() => null);
```

- Comprehensive error validation at system boundaries
- Runtime type narrowing with `typeof` and `instanceof` checks
- Example from `src/tools/approvals.js`:
```javascript
if (typeof cmd !== "string" || cmd.trim().length === 0) {
  return { ok: false, error: "Empty command" };
}
```

**Zod for Validation:**
- Config schemas use Zod for runtime validation: `src/config/schema.js`
- `userConfigSchema.parse()` validates and throws on invalid data
- `userConfigSchema.safeParse()` returns `{success, data, error}` for graceful handling
- Error details extracted with helper: `flattenZodIssues(error)`

## Logging

**Framework:** Native `console` or custom logging (none detected in standard output paths)

**Patterns:**
- No console.log statements in production code observed
- Error contexts logged via error messages in result objects
- Example: `stderr: err.message` in `src/tools/bash.js`

## Comments

**When to Comment:**
- Explains WHY, not WHAT: "keep the incomplete line buffered until the next chunk"
- Comments in Russian alongside English code (i18n context)
- No excessive comments; code is self-documenting through names

**JSDoc/TSDoc:**
- Not used; functions have descriptive names and are context-clear
- Configuration objects documented via Zod schemas

## Function Design

**Size:** 
- Functions typically 20-60 lines
- Larger functions (100+ lines) factor out utility sub-functions
- Example: `src/intelligence/repo-map.js` has `estimateTokens()`, `isDeniedPath()`, `fileWeight()` extracted

**Parameters:**
- Single parameter objects for functions with multiple options: `function buildRepoMap(dirPath, options)`
- Default values handled via object spreading: `const { mode = "dense", tokenBudget = 2000 } = options`
- Destructuring in function signatures for clarity

**Return Values:**
- Async functions return Promises
- Result objects with `ok` flag + data/error fields for error handling
- Explicit nullable returns (`return null`) when entity not found

**Example from `src/update/checker.js`:**
```javascript
export function compareVersions(current, remote) {
  const currentParsed = parseVersion(current);
  const remoteParsed = parseVersion(remote);
  if (!currentParsed || !remoteParsed) return 0;
  // ... logic ...
  return 0;
}
```

## Module Design

**Exports:**
- Named exports preferred: `export function loadConfig()`, `export class Router`
- One default export per file only when single main export
- Grouped exports from single module: `export { loadConfig, saveConfig, bootstrapConfig }`

**Barrel Files:**
- Minimal use; each module is explicit about what it exports
- Example: `src/ui/components/index.js` aggregates component exports

**File Cohesion:**
- One primary concern per file: `router.js` = scene navigation, `schema.js` = config validation
- Related utilities grouped: `src/config/` contains both `schema.js` and `loader.js`

---

*Convention analysis: 2026-04-25*
