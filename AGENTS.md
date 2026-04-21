# Repository Guidelines

## Project Structure & Module Organization

This repository is a Node.js ESM CLI package. The executable entry point is `bin/mr-mush.js`, which boots the Mr. Mush CLI, locale, UI, and routing. Core source lives in `src/`:

- `src/router.js` coordinates boot, setup, and chat scenes.
- `src/config/` loads and validates TOML-backed configuration with Zod schemas.
- `src/providers/` contains provider integrations such as OpenAI, Anthropic, Google, Ollama, and LM Studio.
- `src/ui/` contains terminal UI setup, themes, components, input handling, and scenes.
- `src/i18n/` loads localized messages from `locales/en.json` and `locales/ru.json`.

There is no dedicated `tests/` directory yet. Add one when introducing the test suite.

## Build, Test, and Development Commands

- `npm install` installs runtime dependencies from `package-lock.json`.
- `node bin/mr-mush.js` runs Mr. Mush locally from the working tree.
- `npm link` exposes the `mr-mush` command globally.
- `npm test` is not defined yet; add a package script before using it in CI.

Prefer standard script names: `test`, `lint`, `format`, and `start`.

## Coding Style & Naming Conventions

Use JavaScript ES modules with explicit `.js` import extensions. Keep functions small, and prefer immutable object updates over in-place mutation. Match the existing style: two-space indentation, double quotes, trailing commas in multiline calls/objects, and semicolons.

Use descriptive names for exported functions and constants. Fixed option lists use uppercase names such as `PROVIDER_IDS`; modules and files use lowercase names like `schema.js`.

## Testing Guidelines

No test framework is currently configured. When adding tests, use Vitest or Node’s built-in test runner, and add the command to `package.json`. Cover configuration parsing, provider selection, router scene transitions, and UI boundaries. Name test files consistently, for example `schema.test.js`.

Target at least 80% coverage for new feature work and include regression tests for bug fixes.

## Commit & Pull Request Guidelines

The repository uses Conventional Commits, for example `feat: initialize mr mush cli`. Use formats such as `feat: add provider cache`, `fix: handle invalid config`, or `test: cover router boot flow`.

Pull requests should include a summary, verification commands, linked issues when applicable, and terminal output for user-facing CLI changes. Note new environment variables, config fields, or migration steps.

## Security & Configuration Tips

Never hardcode API keys or tokens. Provider credentials should come from CLI auth or environment variables such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `GEMINI_API_KEY`. Validate external config through `src/config/schema.js`, and keep user-facing errors clear without leaking secret values.
