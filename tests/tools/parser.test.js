import test from "node:test";
import assert from "node:assert/strict";
import { parseToolCall, formatToolResultForModel } from "../../src/tools/parser.js";

test("parseToolCall: valid bash tool call", () => {
  const text = 'Some text\n```agents-tool\n{"name":"bash","args":{"cmd":"ls -la"}}\n```\nAfter text';
  const result = parseToolCall(text);
  assert.equal(result.ok, true);
  assert.deepEqual(result.call, { name: "bash", args: { cmd: "ls -la" } });
  assert.equal(result.before, "Some text");
  assert.equal(result.after, "After text");
});

test("parseToolCall: valid write_file tool call", () => {
  const text = '```agents-tool\n{"name":"write_file","args":{"path":"src/index.js","content":"hello"}}\n```';
  const result = parseToolCall(text);
  assert.equal(result.ok, true);
  assert.deepEqual(result.call, { name: "write_file", args: { path: "src/index.js", content: "hello" } });
});

test("parseToolCall: no tool block returns null", () => {
  const result = parseToolCall("Just regular text with ```code blocks```");
  assert.equal(result, null);
});

test("parseToolCall: invalid JSON returns error", () => {
  const text = '```agents-tool\n{invalid json}\n```';
  const result = parseToolCall(text);
  assert.equal(result.ok, false);
  assert.match(result.error, /Invalid agents-tool JSON/);
});

test("parseToolCall: missing args returns error", () => {
  const text = '```agents-tool\n{"name":"bash"}\n```';
  const result = parseToolCall(text);
  assert.equal(result.ok, false);
  assert.match(result.error, /args must be an object/);
});

test("parseToolCall: empty bash cmd returns error", () => {
  const text = '```agents-tool\n{"name":"bash","args":{"cmd":""}}\n```';
  const result = parseToolCall(text);
  assert.equal(result.ok, false);
  assert.match(result.error, /non-empty string/);
});

test("parseToolCall: unsupported tool returns error", () => {
  const text = '```agents-tool\n{"name":"unknown","args":{"foo":"bar"}}\n```';
  const result = parseToolCall(text);
  assert.equal(result.ok, false);
  assert.match(result.error, /Unsupported tool/);
});

test("parseToolCall: write_file missing path", () => {
  const text = '```agents-tool\n{"name":"write_file","args":{"content":"x"}}\n```';
  const result = parseToolCall(text);
  assert.equal(result.ok, false);
  assert.match(result.error, /path must be a non-empty string/);
});

test("parseToolCall: write_file missing content", () => {
  const text = '```agents-tool\n{"name":"write_file","args":{"path":"foo.js"}}\n```';
  const result = parseToolCall(text);
  assert.equal(result.ok, false);
  assert.match(result.error, /content must be a string/);
});

test("parseToolCall: trims bash cmd", () => {
  const text = '```agents-tool\n{"name":"bash","args":{"cmd":"  ls  "}}\n```';
  const result = parseToolCall(text);
  assert.equal(result.ok, true);
  assert.equal(result.call.args.cmd, "ls");
});

test("formatToolResultForModel: formats tool result as JSON block", () => {
  const result = formatToolResultForModel({ tool: "bash", stdout: "hello" });
  assert.match(result, /Tool result:/);
  assert.match(result, /```json/);
  assert.match(result, /"tool": "bash"/);
});
