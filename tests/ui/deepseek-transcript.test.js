import test from "node:test";
import assert from "node:assert/strict";
import { buildMessagesFromTranscript } from "../../src/ui/scenes/chat.js";

test("buildMessagesFromTranscript preserves DeepSeek replay payload and skips UI-only entries", () => {
  const messages = buildMessagesFromTranscript(
    { text: "system prompt" },
    [
      { role: "user", text: "Inspect repo" },
      {
        role: "assistant",
        text: "",
        assistantPayload: {
          content: "",
          reasoning_content: "Need to inspect files first.",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "bash",
                arguments: "{\"cmd\":\"find .\"}",
              },
            },
          ],
        },
      },
      {
        role: "assistant",
        text: "find .\n./index.js",
        meta: { kind: "terminal_event" },
      },
      { role: "assistant", text: "Repo has one file." },
    ],
    "What next?",
    "deepseek",
  );

  assert.deepEqual(messages, [
    { role: "system", content: "system prompt" },
    { role: "user", content: "Inspect repo" },
    {
      role: "assistant",
      content: "",
      reasoning_content: "Need to inspect files first.",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "bash",
            arguments: "{\"cmd\":\"find .\"}",
          },
        },
      ],
    },
    { role: "assistant", content: "Repo has one file." },
    { role: "user", content: "What next?" },
  ]);
});
