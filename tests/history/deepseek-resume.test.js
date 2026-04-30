import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSession, loadSession, recordMessage } from "../../src/history/session.js";
import { buildMessagesFromTranscript } from "../../src/ui/scenes/chat.js";

test("resumed DeepSeek sessions rebuild assistant turns with reasoning_content", async () => {
  const historyDir = await fs.mkdtemp(path.join(os.tmpdir(), "mrmush-history-"));

  try {
    await fs.writeFile(path.join(historyDir, "index.json"), "{}\n", "utf8");

    const session = await createSession(historyDir, {
      provider: "deepseek",
      model: "deepseek-v4-flash",
    });

    await recordMessage(historyDir, session.id, {
      role: "user",
      content: "Inspect repo",
    });
    await recordMessage(historyDir, session.id, {
      role: "assistant",
      content: "",
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
    });
    await recordMessage(historyDir, session.id, {
      role: "assistant",
      content: "Repo has one file.",
    });

    const loaded = await loadSession(historyDir, session.id);
    const transcript = loaded.messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({
        role: message.role,
        text: message.content,
        ...(message.assistantPayload
          ? { assistantPayload: message.assistantPayload }
          : {}),
      }));

    const messages = buildMessagesFromTranscript(
      null,
      transcript,
      "What next?",
      "deepseek",
    );

    assert.equal(messages[1].role, "assistant");
    assert.equal(messages[1].reasoning_content, "Need to inspect files first.");
    assert.equal(messages[2].content, "Repo has one file.");
    assert.equal(messages[3].content, "What next?");
  } finally {
    await fs.rm(historyDir, { recursive: true, force: true });
  }
});
