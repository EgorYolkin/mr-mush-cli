import test from "node:test";
import assert from "node:assert/strict";
import { ReadableStream } from "node:stream/web";
import { openAiCompatibleChat } from "../../src/providers/openai-compatible.js";

test("openAiCompatibleChat returns assistantMessage with reasoning_content in non-stream mode", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: "",
              reasoning_content: "Need to inspect files first.",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "bash",
                    arguments: "{\"cmd\":\"git status --short\"}",
                  },
                },
              ],
            },
          },
        ],
        usage: { total_tokens: 42 },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );

  try {
    const result = await openAiCompatibleChat({
      baseUrl: "https://example.com",
      providerName: "DeepSeek",
      model: "deepseek-v4-flash",
      prompt: "Inspect repo",
    });

    assert.equal(result.text, "");
    assert.equal(result.assistantMessage.reasoning_content, "Need to inspect files first.");
    assert.equal(result.assistantMessage.tool_calls.length, 1);
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.usage.total_tokens, 42);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openAiCompatibleChat accumulates streaming reasoning_content deltas", async () => {
  const originalFetch = globalThis.fetch;
  const chunks = [
    'data: {"choices":[{"delta":{"role":"assistant","reasoning_content":"First "}}]}\n',
    'data: {"choices":[{"delta":{"reasoning_content":"second ","tool_calls":[{"index":0,"id":"call_1","function":{"name":"bash","arguments":"{\\"cmd\\":\\"ls"}}]}}]}\n',
    'data: {"choices":[{"delta":{"content":"Done","tool_calls":[{"index":0,"function":{"arguments":" -la\\"}"}}]}}],"usage":{"total_tokens":17}}\n',
    "data: [DONE]\n",
  ];

  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
          controller.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );

  const receivedTokens = [];

  try {
    const result = await openAiCompatibleChat({
      baseUrl: "https://example.com",
      providerName: "DeepSeek",
      model: "deepseek-v4-flash",
      prompt: "Inspect repo",
      onToken: (token) => receivedTokens.push(token),
    });

    assert.equal(receivedTokens.join(""), "Done");
    assert.equal(result.assistantMessage.reasoning_content, "First second ");
    assert.equal(result.assistantMessage.tool_calls[0].type, "function");
    assert.equal(
      result.assistantMessage.tool_calls[0].function.arguments,
      "{\"cmd\":\"ls -la\"}",
    );
    assert.equal(result.toolCalls[0].type, "function");
    assert.equal(result.usage.total_tokens, 17);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
