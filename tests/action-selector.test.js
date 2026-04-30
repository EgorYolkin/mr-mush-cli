import test from "node:test";
import assert from "node:assert/strict";

import { classifyPrompt, selectAction } from "../src/orchestrator/action-selector.js";

test("classifyPrompt routes backend prompts by taxonomy", () => {
  const result = classifyPrompt("Implement API auth migration for the server database.");

  assert.equal(result.domain, "backend");
  assert.equal(result.action, "build");
  assert.ok(result.confidence >= 0.55);
});

test("classifyPrompt falls back to general for unmatched prompts", () => {
  const result = classifyPrompt("Write a short note for the release.");

  assert.equal(result.domain, "general");
  assert.equal(result.action, "respond");
});

test("classifyPrompt short greeting stays heuristic and avoids router escalation", () => {
  const result = classifyPrompt("hello");

  assert.equal(result.domain, "general");
  assert.equal(result.action, "respond");
  assert.equal(result.source, "heuristic");
  assert.equal(result.confidence, 0.99);
});

test("classifyPrompt project structure questions stay on heuristic analysis path", () => {
  const result = classifyPrompt("what is this project? show me the repo map");

  assert.equal(result.domain, "analysis");
  assert.equal(result.action, "explain");
  assert.equal(result.source, "heuristic");
  assert.equal(result.confidence, 0.97);
});

test("selectAction prefers provider JSON result when heuristic is weak", async () => {
  const fakeProvider = {
    id: "anthropic",
    exec: async () => ({
      text: "{\"domain\":\"analysis\",\"action\":\"review\",\"confidence\":0.91}",
      usage: null,
    }),
  };

  const result = await selectAction("Please review this patch for regressions.", fakeProvider, {
    activeModel: "claude-sonnet-4-6",
    orchestrator: {
      router_model: "claude-haiku-4-5-20251001",
    },
  });

  assert.deepEqual(result, {
    domain: "analysis",
    action: "review",
    confidence: 0.91,
    source: "llm",
  });
});
