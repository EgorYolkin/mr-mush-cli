import test from "node:test";
import assert from "node:assert/strict";
import { runWithNativeTools } from "../../src/tools/native-loop.js";

test("runWithNativeTools replays DeepSeek reasoning_content on the next tool sub-request", async () => {
  let callCount = 0;

  const provider = {
    id: "deepseek",
    async exec(_config, _prompt, _runtimeOverrides, _signal, options) {
      callCount += 1;

      if (callCount === 1) {
        return {
          text: "",
          usage: null,
          toolCalls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "bash",
                arguments: "{\"cmd\":\"find . -maxdepth 1\"}",
              },
            },
          ],
          assistantMessage: {
            role: "assistant",
            content: "",
            reasoning_content: "Need directory listing before answering.",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "bash",
                  arguments: "{\"cmd\":\"find . -maxdepth 1\"}",
                },
              },
            ],
          },
        };
      }

      const assistantTurn = options.messages.find(
        (message) => message.role === "assistant",
      );
      assert.equal(
        assistantTurn.reasoning_content,
        "Need directory listing before answering.",
      );
      assert.equal(assistantTurn.tool_calls.length, 1);
      assert.equal(options.messages.at(-1).role, "tool");

      return {
        text: "Done.",
        usage: { total_tokens: 9 },
        toolCalls: [],
        assistantMessage: {
          role: "assistant",
          content: "Done.",
        },
      };
    },
  };

  const result = await runWithNativeTools({
    provider,
    config: {
      promptStack: null,
      tools: { bash: { max_calls: 4 } },
    },
    prompt: "Inspect repo",
    runtimeOverrides: {},
    signal: null,
    context: { i18n: null, cwd: process.cwd() },
    onToken: null,
    executeToolCall: async () => ({
      tool: "bash",
      cmd: "find . -maxdepth 1",
      exit_code: 0,
      stdout: "./index.js",
      stderr: "",
      truncated: false,
      blocked: false,
    }),
  });

  assert.equal(callCount, 2);
  assert.equal(result.text, "Done.");
  assert.equal(result.assistantMessage.content, "Done.");
});

test("runWithNativeTools replays tool call type for DeepSeek streaming assistant messages", async () => {
  let callCount = 0;

  const provider = {
    id: "deepseek",
    async exec(_config, _prompt, _runtimeOverrides, _signal, options) {
      callCount += 1;

      if (callCount === 1) {
        return {
          text: "",
          usage: null,
          toolCalls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "bash",
                arguments: "{\"cmd\":\"cat index.js\"}",
              },
            },
          ],
          assistantMessage: {
            role: "assistant",
            content: "",
            reasoning_content: "Need to inspect index.js first.",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "bash",
                  arguments: "{\"cmd\":\"cat index.js\"}",
                },
              },
            ],
          },
        };
      }

      const assistantTurn = options.messages.find(
        (message) => message.role === "assistant",
      );
      assert.equal(assistantTurn.tool_calls[0].type, "function");

      return {
        text: "Done.",
        usage: null,
        toolCalls: [],
        assistantMessage: {
          role: "assistant",
          content: "Done.",
        },
      };
    },
  };

  await runWithNativeTools({
    provider,
    config: {
      promptStack: null,
      tools: { bash: { max_calls: 4 } },
    },
    prompt: "Inspect repo",
    runtimeOverrides: {},
    signal: null,
    context: { i18n: null, cwd: process.cwd() },
    onToken: null,
    executeToolCall: async () => ({
      tool: "bash",
      cmd: "cat index.js",
      exit_code: 0,
      stdout: "console.log('ok');",
      stderr: "",
      truncated: false,
      blocked: false,
    }),
  });
});

test("runWithNativeTools emits assistant tool intent once for a multi-tool turn", async () => {
  let callCount = 0;
  const assistantIntentCalls = [];
  const toolResultCalls = [];

  const provider = {
    id: "deepseek",
    async exec() {
      callCount += 1;

      if (callCount === 1) {
        return {
          text: "Let me start by inspecting the directory structure and reading the relevant files.",
          usage: null,
          toolCalls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "bash",
                arguments: "{\"cmd\":\"pwd\"}",
              },
            },
            {
              id: "call_2",
              type: "function",
              function: {
                name: "bash",
                arguments: "{\"cmd\":\"ls\"}",
              },
            },
          ],
          assistantMessage: {
            role: "assistant",
            content:
              "Let me start by inspecting the directory structure and reading the relevant files.",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "bash",
                  arguments: "{\"cmd\":\"pwd\"}",
                },
              },
              {
                id: "call_2",
                type: "function",
                function: {
                  name: "bash",
                  arguments: "{\"cmd\":\"ls\"}",
                },
              },
            ],
          },
        };
      }

      return {
        text: "Done.",
        usage: null,
        toolCalls: [],
        assistantMessage: {
          role: "assistant",
          content: "Done.",
        },
      };
    },
  };

  await runWithNativeTools({
    provider,
    config: {
      promptStack: null,
      tools: { bash: { max_calls: 4 } },
    },
    prompt: "Inspect repo",
    runtimeOverrides: {},
    signal: null,
    context: { i18n: null, cwd: process.cwd() },
    onToken: null,
    onAssistantToolIntent: async (payload) => {
      assistantIntentCalls.push(payload);
    },
    onToolResult: async (payload) => {
      toolResultCalls.push(payload);
    },
    executeToolCall: async (call) => ({
      tool: "bash",
      cmd: call.args.cmd,
      exit_code: 0,
      stdout: "",
      stderr: "",
      truncated: false,
      blocked: false,
    }),
  });

  assert.equal(assistantIntentCalls.length, 1);
  assert.equal(
    assistantIntentCalls[0].assistantText,
    "Let me start by inspecting the directory structure and reading the relevant files.",
  );
  assert.equal(assistantIntentCalls[0].toolCalls.length, 2);
  assert.equal(toolResultCalls.length, 2);
  assert.equal(toolResultCalls[0].toolCall.id, "call_1");
  assert.equal(toolResultCalls[1].toolCall.id, "call_2");
});
