import test from "node:test";
import assert from "node:assert/strict";
import { deepseekProvider } from "../../src/providers/deepseek.js";

test("deepseek-reasoner does not opt into native tool calling", async () => {
  assert.equal(await deepseekProvider.supportsToolCalling("deepseek-reasoner"), false);
  assert.equal(await deepseekProvider.supportsToolCalling("deepseek-v4-flash"), true);
});
