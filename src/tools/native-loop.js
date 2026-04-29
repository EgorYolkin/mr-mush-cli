import { TOOL_DEFINITIONS } from "./definitions.js";
import { formatToolsOpenAI, normalizeToolCallOpenAI, formatToolResultOpenAI } from "./normalize.js";
import { formatToolsGoogle, normalizeToolCallGoogle, formatToolResultGoogle } from "./normalize.js";

/**
 * Build the initial messages array for a native tool calling conversation.
 *
 * @param {object|null} promptStack
 * @param {string} prompt
 * @param {object[]|null} messages - Pre-built message history (overrides prompt)
 * @returns {object[]}
 */
function buildInitialMessages(promptStack, prompt, messages) {
  if (messages?.length) return messages;
  const result = [];
  if (promptStack?.text) {
    result.push({ role: "system", content: promptStack.text });
  }
  result.push({ role: "user", content: prompt });
  return result;
}

/**
 * Format tool definitions for a specific provider.
 *
 * @param {string} providerId
 * @returns {object}
 */
function formatTools(providerId) {
  if (providerId === "google") {
    return formatToolsGoogle(TOOL_DEFINITIONS);
  }
  return formatToolsOpenAI(TOOL_DEFINITIONS);
}

/**
 * Normalize raw tool calls from a provider response to internal format.
 *
 * @param {string} providerId
 * @param {object[]} rawToolCalls
 * @returns {Array<{ name: string, args: object, id: string }>}
 */
function normalizeToolCalls(providerId, rawToolCalls) {
  if (providerId === "google") {
    return rawToolCalls.map((tc) => normalizeToolCallGoogle(tc, tc.id));
  }
  return rawToolCalls.map(normalizeToolCallOpenAI);
}

/**
 * Append assistant turn + tool results to the message history.
 *
 * @param {string} providerId
 * @param {object[]} messages - Mutated in place
 * @param {string} assistantText
 * @param {object[]} normalizedCalls - Internal tool calls
 * @param {Array<{ id: string, name: string, result: object }>} results
 */
function appendToolRound(
  providerId,
  messages,
  assistantText,
  normalizedCalls,
  results,
  assistantMessage = null,
) {
  if (providerId === "google") {
    // Gemini: assistant turn with functionCall parts, then user turn with functionResponse parts
    messages.push({
      role: "assistant",
      content: assistantText,
      toolCalls: normalizedCalls,
    });
    for (const result of results) {
      messages.push({
        role: "tool",
        content: formatToolResultGoogle(result),
      });
    }
  } else {
    // OpenAI-compatible: assistant message with tool_calls, then tool role messages
    messages.push(
      assistantMessage ?? {
        role: "assistant",
        content: assistantText || null,
        tool_calls: normalizedCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        })),
      },
    );
    for (const result of results) {
      messages.push(formatToolResultOpenAI(result));
    }
  }
}

/**
 * Run a multi-turn native tool calling loop.
 *
 * @param {object} params
 * @param {object} params.provider
 * @param {object} params.config
 * @param {string} params.prompt
 * @param {object[]|null} params.messages
 * @param {object} params.runtimeOverrides
 * @param {AbortSignal|null} params.signal
 * @param {object} params.context
 * @param {Function|null} params.onToken
 * @param {Function|null} params.beforeApproval
 * @param {Function|null} params.afterApproval
 * @param {Function|null} params.beforeToolCall
 * @param {Function|null} params.onAssistantToolIntent
 * @param {Function|null} params.onToolResult
 * @param {Function} params.executeToolCall - Shared tool execution function
 * @returns {Promise<{ text: string, usage: object|null }>}
 */
export async function runWithNativeTools({
  provider,
  config,
  prompt,
  messages = null,
  runtimeOverrides,
  signal,
  context,
  onToken,
  beforeApproval = null,
  afterApproval = null,
  beforeToolCall = null,
  onAssistantToolIntent = null,
  onToolResult = null,
  executeToolCall,
}) {
  const maxCalls = config.tools?.bash?.max_calls ?? 8;
  const tools = formatTools(provider.id);
  let currentMessages = buildInitialMessages(config.promptStack, prompt, messages);
  let lastResponse = null;

  for (let callIndex = 0; callIndex <= maxCalls; callIndex += 1) {
    const isFirstTurn = callIndex === 0;

    const response = await provider.exec(
      { ...config, i18n: context.i18n },
      prompt,
      runtimeOverrides,
      signal,
      {
        messages: currentMessages,
        tools,
        onToken: isFirstTurn ? onToken : null,
      },
    );
    lastResponse = response;

    const rawToolCalls = response.toolCalls ?? [];
    if (!rawToolCalls.length) {
      return response;
    }

    if (beforeToolCall) beforeToolCall();

    const normalizedCalls = normalizeToolCalls(provider.id, rawToolCalls);

    if (onAssistantToolIntent) {
      await onAssistantToolIntent({
        assistantText: response.text ?? "",
        assistantMessage: response.assistantMessage ?? null,
        toolCalls: normalizedCalls,
      });
    }

    const toolResults = [];

    for (const call of normalizedCalls) {
      let result;

      if (callIndex >= maxCalls) {
        result = {
          tool: call.name,
          cmd: call.args?.cmd ?? "",
          exit_code: null,
          stdout: "",
          stderr: `tool call limit exceeded (${maxCalls})`,
          truncated: false,
          blocked: true,
        };
      } else {
        result = await executeToolCall(call, config.tools, context, {
          beforeApproval,
          afterApproval,
        });
      }

      const toolResult = { id: call.id, name: call.name, result };
      toolResults.push(toolResult);

      if (onToolResult) {
        await onToolResult({
          assistantText: response.text ?? "",
          toolCall: call,
          toolResult: result,
        });
      }
    }

    appendToolRound(
      provider.id,
      currentMessages,
      response.text ?? "",
      normalizedCalls,
      toolResults,
      response.assistantMessage ?? null,
    );
  }

  return lastResponse ?? { text: "", usage: null };
}
