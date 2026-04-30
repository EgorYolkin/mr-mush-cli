import test from "node:test";
import assert from "node:assert/strict";
import { evaluateWritePolicy } from "../../src/tools/file-write.js";

const CWD = "/home/user/project";

test("evaluateWritePolicy: allows file inside cwd", () => {
  const result = evaluateWritePolicy("src/index.js", CWD, { content: "hello" });
  assert.equal(result.ok, true);
  assert.equal(result.resolved, "/home/user/project/src/index.js");
});

test("evaluateWritePolicy: blocks path traversal with ..", () => {
  const result = evaluateWritePolicy("../../etc/passwd", CWD, { content: "x" });
  assert.equal(result.ok, false);
  assert.match(result.error, /escapes working directory/);
});

test("evaluateWritePolicy: blocks absolute path outside cwd", () => {
  const result = evaluateWritePolicy("/etc/passwd", CWD, { content: "x" });
  assert.equal(result.ok, false);
  assert.match(result.error, /escapes working directory/);
});

test("evaluateWritePolicy: blocks .git directory", () => {
  const result = evaluateWritePolicy(".git/config", CWD, { content: "x" });
  assert.equal(result.ok, false);
  assert.match(result.error, /\.git.*not allowed/);
});

test("evaluateWritePolicy: blocks node_modules", () => {
  const result = evaluateWritePolicy("node_modules/foo/index.js", CWD, { content: "x" });
  assert.equal(result.ok, false);
  assert.match(result.error, /node_modules.*not allowed/);
});

test("evaluateWritePolicy: blocks .env", () => {
  const result = evaluateWritePolicy(".env", CWD, { content: "x" });
  assert.equal(result.ok, false);
  assert.match(result.error, /\.env.*not allowed/);
});

test("evaluateWritePolicy: blocks .env.local", () => {
  const result = evaluateWritePolicy(".env.local", CWD, { content: "x" });
  assert.equal(result.ok, false);
  assert.match(result.error, /\.env\.local.*not allowed/);
});

test("evaluateWritePolicy: blocks .env.production", () => {
  const result = evaluateWritePolicy(".env.production", CWD, { content: "x" });
  assert.equal(result.ok, false);
  assert.match(result.error, /\.env\.production.*not allowed/);
});

test("evaluateWritePolicy: blocks files exceeding max size", () => {
  const bigContent = "x".repeat(513 * 1024);
  const result = evaluateWritePolicy("big.txt", CWD, {
    content: bigContent,
    max_file_size_kb: 512,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /exceeds max size/);
});

test("evaluateWritePolicy: allows files under max size", () => {
  const content = "x".repeat(100);
  const result = evaluateWritePolicy("small.txt", CWD, {
    content,
    max_file_size_kb: 512,
  });
  assert.equal(result.ok, true);
});

test("evaluateWritePolicy: custom denied_paths", () => {
  const result = evaluateWritePolicy("secrets/key.pem", CWD, {
    content: "x",
    denied_paths: ["secrets", ".git"],
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /secrets.*not allowed/);
});

test("evaluateWritePolicy: nested path traversal attempt", () => {
  const result = evaluateWritePolicy("src/../../../etc/passwd", CWD, { content: "x" });
  assert.equal(result.ok, false);
  assert.match(result.error, /escapes working directory/);
});

test("evaluateWritePolicy: allows deeply nested file inside cwd", () => {
  const result = evaluateWritePolicy("src/a/b/c/d.js", CWD, { content: "hello" });
  assert.equal(result.ok, true);
});
